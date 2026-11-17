/**
 * The inbox sweep: find the threads of prospects we DM'd, hand their new
 * messages to the SDR, and send the reply the operator approves.
 *
 * Like session-machine.mjs it takes everything through `ctx` (no Playwright,
 * no Firebase), and every reply goes through the same `composeAndSend` loop,
 * so the "Enter for this message, or nothing leaves" rule is the same code.
 *
 * What the browser shows is untrusted prospect content. The runner only moves
 * it: the SDR wraps it for the model (extractThreadMessages) and decides what
 * it means (ingestSocialInbound). Replies are not paced by the daily cap or
 * the spacing (owner decision); suppression is checked right before each one
 * (checkBeforeSocialReply re-reads the conversation).
 *
 * A reply drafted in an earlier sweep and not sent (S, Q, a crash), or a
 * thread escalated to the operator, is offered again: its messages are no
 * longer "new", but the conversation still waits for an answer.
 *
 * An AI or SDR failure on one thread skips that thread; it is never reported
 * as a Meta block, and the sweep goes on.
 */
import { matchThreads, threadLooksLike } from "./inbox-matcher.mjs";
import { escalationOf, pendingDraftOf } from "./pending-state.mjs";
import {
  KEY,
  MAX_CONSECUTIVE_UNAVAILABLE,
  STOP,
  composeAndSend,
  errorSummary,
  fromEditLine,
  reportBlocked,
  stopOnError
} from "./session-machine.mjs";

/** Threads in a row the AI could not read before the sweep stops (the model is down, not one thread). */
const MAX_CONSECUTIVE_AI_FAILURES = 3;
/** Open-thread reasons that point at selector drift. */
const DRIFT_REASONS = new Set(["thread_not_found", "no_composer"]);

const interrupted = (ctx) => Boolean(ctx.keys.isInterrupted?.());

/** The review fields of a draft, in the shape composeAndSend displays. */
function reviewOf(draft) {
  return {
    pricingGuardrailPassed: draft.pricingGuardrailPassed,
    mentionsCommercialTerms: draft.mentionsCommercialTerms,
    warnings: draft.warnings
  };
}

/** The confirmation loop wired for a reply in `conversation`. */
function replySpec(ctx, conversation, composer) {
  const { sdr, session } = ctx;
  const recordInput = ({ finalText, edited }) => ({
    conversationId: conversation.conversationId,
    bodyText: finalText,
    edited,
    sessionId: session.sessionId,
    operator: session.operator
  });
  return {
    composer,
    // Re-reads the conversation (suppressed since the sweep started?) and checks the handle.
    checkGate: () => sdr.checkBeforeSocialReply({ conversationId: conversation.conversationId }),
    record: (sent) => sdr.recordSocialReplySent({ ...recordInput(sent), verified: sent.verified }),
    journal: (sent) => ({
      kind: "reply",
      network: session.network,
      workspaceId: session.workspaceId,
      businessId: session.businessId,
      companyName: conversation.companyName,
      conversationId: conversation.conversationId,
      text: sent.finalText,
      record: recordInput(sent)
    })
  };
}

/** A drafted reply through the confirmation loop, with R for another proposal. */
function offerDraft(ctx, conversation, composer, draft) {
  const { sdr } = ctx;
  return composeAndSend(ctx, {
    ...replySpec(ctx, conversation, composer),
    text: draft.bodyText,
    review: reviewOf(draft),
    regenerate: async () => {
      const next = await sdr.regenerateSocialDraft(conversation.conversationId);
      return next ? { text: next.bodyText, review: reviewOf(next) } : null;
    }
  });
}

/**
 * The generator escalated (or refused to draft): the operator may still write
 * a reply by hand, which goes through the same checks.
 */
async function offerManualReply(ctx, conversation, composer) {
  const { keys, ui } = ctx;
  ui.keysHint([KEY.EDIT, KEY.SKIP, KEY.QUIT], { [KEY.EDIT]: "E = écrire la réponse" });
  const key = await keys.prompt([KEY.EDIT, KEY.SKIP, KEY.QUIT]);
  if (key === KEY.SKIP) return { outcome: "skipped", reason: "operator_skip" };
  if (key !== KEY.EDIT) return { outcome: "stopped", reason: STOP.OPERATOR };
  const line = await keys.readLine("Ta réponse (\\n = retour à la ligne, vide = annuler) : ", "");
  if (line === null || !line.trim()) return { outcome: "skipped", reason: "operator_skip" };
  return composeAndSend(ctx, { ...replySpec(ctx, conversation, composer), text: fromEditLine(line), edited: true });
}

/** An AI or SDR call failed for this thread: skip it, say why, keep sweeping. */
function threadFailed(ctx, stats, step, error) {
  stats.failed += 1;
  ctx.ui.warn(`${step} impossible pour ce fil (${errorSummary(error)}) : passé, il sera repris au prochain passage.`);
  return { outcome: "failed" };
}

/**
 * The SDR drops a prospect message the AI read but that is not on the page
 * (invented or reworded text) and only counts it. A real message dropped that
 * way would otherwise vanish without a trace: the operator is told to read
 * the thread, and the count goes in the session summary.
 */
function warnNotOnPage(ctx, stats, unverified) {
  const count = Math.floor(Number(unverified));
  if (!(count > 0)) return;
  stats.notOnPage += count;
  ctx.ui.warn(
    `${count} message(s) du prospect lu(s) par l'IA mais introuvable(s) tel(s) quel(s) sur la page : écarté(s), rien n'est enregistré ni répondu pour eux. Lis ce fil toi-même dans la fenêtre du navigateur.`
  );
}

/**
 * No new prospect message: offer what the conversation still waits for (a
 * reply drafted earlier, or an escalation), provided the prospect is still
 * the one who wrote last in the thread.
 */
async function offerPending(ctx, conversation, composer, messages, stats) {
  const { ui } = ctx;
  const draft = pendingDraftOf(conversation);
  const escalation = draft ? null : escalationOf(conversation);
  if (!draft && !escalation) {
    ui.info("Rien de nouveau.");
    return { outcome: "none" };
  }
  const last = messages.at(-1);
  if (!last) {
    ui.warn("Une réponse attend dans le SDR, mais je ne lis aucun message dans ce fil : rien n'est proposé.");
    return { outcome: "none" };
  }
  if (!last.fromProspect) {
    ui.warn("Une réponse attend dans le SDR, mais le dernier message du fil est déjà le tien : rien n'est proposé (vérifie la conversation dans l'Inbox du SDR).");
    return { outcome: "none" };
  }

  let lastOurs = -1;
  messages.forEach((message, index) => {
    if (!message.fromProspect) lastOurs = index;
  });
  const unanswered = messages.slice(lastOurs + 1).map((message) => message.text);
  stats.pending += 1;
  if (unanswered.length) ui.prospectMessages(unanswered);
  if (draft) {
    ui.info("Réponse proposée lors d'un passage précédent, pas encore envoyée :");
    return offerDraft(ctx, conversation, composer, draft);
  }
  ui.warn(`À traiter par toi (signalé lors d'un passage précédent) : ${escalation.reason ?? "le SDR ne propose pas de réponse"}.`);
  return offerManualReply(ctx, conversation, composer);
}

/**
 * One thread: open, confirm identity, read, ingest, reply.
 * Returns the composeAndSend-style outcome, { outcome: "none" } when there
 * was nothing to answer, "unavailable" when the thread could not be opened,
 * "failed" when the AI or the SDR could not process it.
 */
async function handleThread(ctx, conversation, ref, stats) {
  const { sdr, driver, page, ui, session } = ctx;
  ui.thread({ companyName: conversation.companyName, handle: conversation.handle, network: session.network });

  const opened = await driver.openThread(page, { ...ref, url: ref?.url ?? conversation.threadUrl });
  if (!opened.ok) {
    if (typeof opened.reason === "object") return { outcome: "stopped", reason: `blocked:${opened.reason.kind}`, blocker: opened.reason };
    return { outcome: "unavailable", reason: opened.reason };
  }

  const snapshot = await driver.threadSnapshot(page);
  if (!threadLooksLike(snapshot, conversation)) {
    // Neither our message nor their handle is visible: this may be someone
    // else's thread. Reading it into this conversation would be worse than
    // missing a reply until the next sweep.
    ui.warn("Impossible de confirmer que c'est la bonne conversation (ni notre message ni le @ visibles) : ignorée.");
    return { outcome: "none" };
  }
  if (interrupted(ctx)) return { outcome: "stopped", reason: STOP.OPERATOR };

  let messages;
  let unverified;
  try {
    ({ messages, unverified } = await sdr.extractThreadMessages({
      workspaceId: session.workspaceId,
      businessId: session.businessId,
      network: session.network,
      ariaSnapshot: snapshot,
      ourTexts: conversation.ourTexts
    }));
  } catch (error) {
    return threadFailed(ctx, stats, "Lecture du fil par l'IA", error);
  }
  messages = Array.isArray(messages) ? messages : [];
  warnNotOnPage(ctx, stats, unverified);
  const fresh = sdr.newProspectMessages({
    messages,
    ourTexts: conversation.ourTexts,
    knownInboundKeys: conversation.knownInboundKeys,
    network: session.network,
    handle: conversation.handle
  });
  if (!fresh.length) return offerPending(ctx, conversation, opened.composer, messages, stats);
  if (interrupted(ctx)) return { outcome: "stopped", reason: STOP.OPERATOR };

  stats.newMessages += fresh.length;
  ui.prospectMessages(fresh.map((message) => message.text));
  let ingest;
  try {
    ingest = await sdr.ingestSocialInbound({
      conversationId: conversation.conversationId,
      network: session.network,
      messages: fresh,
      threadUrl: driver.threadUrl(page),
      sessionId: session.sessionId
    });
  } catch (error) {
    return threadFailed(ctx, stats, "Traitement par le SDR", error);
  }

  switch (ingest.action) {
    case "no_new":
      ui.info("Déjà enregistré.");
      return { outcome: "none" };
    case "ignored":
      stats.ignored += 1;
      ui.info("Réponse automatique ou absence : rien à répondre.");
      return { outcome: "none" };
    case "unsubscribed":
      stats.unsubscribed += 1;
      ui.ok("Demande de ne plus être contacté : enregistrée, ce prospect ne sera plus jamais contacté.");
      return { outcome: "none" };
    case "escalated":
      stats.escalated += 1;
      ui.warn(`À traiter par toi : ${ingest.reason ?? "le SDR ne propose pas de réponse"}.`);
      return offerManualReply(ctx, conversation, opened.composer);
    case "draft_ready": {
      stats.drafts += 1;
      if (!ingest.draft) return { outcome: "none" };
      return offerDraft(ctx, conversation, opened.composer, ingest.draft);
    }
    default:
      ui.warn(`Résultat inattendu du SDR (${ingest.action}) : conversation ignorée.`);
      return { outcome: "none" };
  }
}

export function newInboxStats() {
  return {
    conversations: 0,
    matched: 0,
    opened: 0,
    newMessages: 0,
    /** Prospect messages the AI read but the SDR could not find on the page (dropped). */
    notOnPage: 0,
    drafts: 0,
    pending: 0,
    replies: 0,
    unverified: 0,
    skipped: 0,
    ignored: 0,
    unsubscribed: 0,
    escalated: 0,
    failed: 0
  };
}

const awaitsOperator = (conversation) => Boolean(pendingDraftOf(conversation) || escalationOf(conversation));

/**
 * The threads to open: every matched thread where the prospect wrote last,
 * plus conversations still waiting for an answer whose thread is not in the
 * visible list but whose URL is known.
 */
function threadsToOpen(ctx, conversations, matches) {
  const { ui } = ctx;
  const toOpen = [];
  for (const conversation of conversations) {
    const ref = matches.get(conversation.conversationId);
    if (ref) {
      if (ref.lastFromUs === false) toOpen.push({ conversation, ref });
      else if (awaitsOperator(conversation)) {
        ui.warn(
          `${conversation.companyName} : une réponse attend dans le SDR, mais tu as écrit en dernier dans ce fil. Rien n'est proposé ; regarde la conversation dans l'Inbox du SDR.`
        );
      }
    } else if (awaitsOperator(conversation) && conversation.threadUrl) {
      toOpen.push({ conversation, ref: { url: conversation.threadUrl } });
    }
  }
  return toOpen;
}

/**
 * The whole sweep for one business and network. `stats` is updated as it
 * goes, so a forced exit can still record what was sent.
 *
 * @returns {Promise<ReturnType<typeof newInboxStats> & { stoppedReason?: string }>}
 */
export async function runInboxSession(ctx, { stats = newInboxStats(), excludeConversationIds } = {}) {
  const { sdr, driver, page, ui, session } = ctx;

  const conversations = await sdr.listSocialConversations({
    workspaceId: session.workspaceId,
    businessId: session.businessId,
    network: session.network
  });
  stats.conversations = conversations.length;
  if (!conversations.length) {
    ui.info("Aucune conversation en cours sur ce réseau.");
    return { ...stats };
  }

  let stoppedReason;
  try {
    const inbox = await driver.openInbox(page);
    if (!inbox.ok) {
      await reportBlocked(ctx, inbox.reason);
      return { ...stats, stoppedReason: `blocked:${inbox.reason.kind}` };
    }
    const matches = matchThreads(await driver.listThreads(page), conversations);
    stats.matched = matches.size;
    const unmatched = conversations.filter((conversation) => !matches.has(conversation.conversationId)).map((conversation) => conversation.conversationId);
    if (unmatched.length) {
      // Diagnosis only (renamed account, archived thread, selector drift): never stops the sweep.
      await sdr
        .reportUnmatchedSocialThreads({
          workspaceId: session.workspaceId,
          businessId: session.businessId,
          network: session.network,
          sessionId: session.sessionId,
          conversationIds: unmatched
        })
        .catch(() => undefined);
    }
    const toOpen = threadsToOpen(ctx, conversations, matches);
    const waiting = conversations.filter(awaitsOperator).length;
    ui.info(
      `${conversations.length} conversation(s) suivie(s), ${matches.size} visible(s) dans la boîte, ${toOpen.length} à ouvrir${waiting ? ` (dont des réponses en attente : ${waiting})` : ""}.`
    );

    let unavailableInARow = 0;
    let aiFailuresInARow = 0;
    for (const { conversation, ref } of toOpen) {
      // Ctrl+C (or a closed key hub): nothing new is opened, read or sent.
      if (interrupted(ctx)) {
        stoppedReason = STOP.OPERATOR;
        break;
      }
      if (excludeConversationIds?.has(conversation.conversationId)) {
        ui.warn(`${conversation.companyName} : une réponse précédente n'est peut-être pas enregistrée, ce fil n'est pas rouvert.`);
        continue;
      }
      stats.opened += 1;
      let result;
      try {
        result = await handleThread(ctx, conversation, ref, stats);
      } catch (error) {
        result = await stopOnError(ctx, error);
      }

      if (result.outcome === "unavailable") {
        unavailableInARow = DRIFT_REASONS.has(result.reason) ? unavailableInARow + 1 : 0;
        if (unavailableInARow >= MAX_CONSECUTIVE_UNAVAILABLE) {
          ui.error(`${unavailableInARow} fils de suite introuvables ou sans champ de message : l'interface a sans doute changé. Arrêt.`);
          result = { outcome: "stopped", reason: STOP.SELECTOR_DRIFT };
        } else {
          ui.warn(`Conversation introuvable (${result.reason}) : ignorée pour ce passage.`);
        }
      } else {
        unavailableInARow = 0;
      }
      if (result.outcome === "failed") {
        aiFailuresInARow += 1;
        if (aiFailuresInARow >= MAX_CONSECUTIVE_AI_FAILURES) {
          ui.error(`${aiFailuresInARow} fils de suite n'ont pas pu être traités par l'IA ou le SDR : arrêt du passage (ce n'est pas un blocage Meta).`);
          result = { outcome: "stopped", reason: STOP.ERROR };
        }
      } else {
        aiFailuresInARow = 0;
      }

      if (result.outcome === "sent") {
        stats.replies += 1;
        if (!result.verified) stats.unverified += 1;
        ui.ok(`Réponse envoyée à ${conversation.companyName}.`);
      } else if (result.outcome === "skipped") {
        stats.skipped += 1;
        ui.info("Passée : elle reste dans le SDR et te sera reproposée au prochain passage.");
      } else if (result.outcome === "refused") {
        ui.warn(`Réponse bloquée par le contrôle de contact : ${result.reason}.`);
      } else if (result.outcome === "stopped") {
        stoppedReason = result.reason;
        if (result.sent) {
          stats.replies += 1;
          if (!result.verified) stats.unverified += 1;
        }
        if (result.blocker) await reportBlocked(ctx, result.blocker);
        break;
      }
    }
  } catch (error) {
    // Opening or reading the inbox itself failed (renamed container, timeout).
    const result = await stopOnError(ctx, error);
    stoppedReason = result.reason;
    if (result.blocker) await reportBlocked(ctx, result.blocker);
  }
  return { ...stats, stoppedReason };
}
