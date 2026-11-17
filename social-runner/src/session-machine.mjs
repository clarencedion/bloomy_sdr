/**
 * The confirmation loop for one message, and the first-DM session built on it.
 *
 * No Playwright, no Firebase, no terminal in here: the page, driver, SDR calls,
 * key source and display all arrive through `ctx`, so the mock driver and
 * scripted keys exercise every path offline.
 *
 * The invariant this module exists for: a message leaves only through
 * `sendFromComposer`, called in exactly one place, once the composer has been
 * read back and matches the text shown, and only after a decision made for
 * THAT message:
 *   - an Enter the operator typed for it (keys pressed earlier are discarded
 *     by the key hub); or
 *   - in an automatic session (the operator started it with --auto, ADR-024),
 *     the end of that message's countdown without S or Q. Only first DMs,
 *     only a text the SDR allows to leave unread, only into a conversation
 *     that holds nothing yet; replies are never automatic.
 * Anything unexpected falls back to "show it again and wait" in a session with
 * keys, and to stopping the session in an automatic one — never to sending,
 * and never to typing a text a second time.
 *
 * Order of a send: type → read back → blur → show → Enter (or countdown) →
 * re-read → gate (suppression, one-DM-per-company) → daily cap / spacing →
 * blocker check → re-read → journal → send → confirm on screen → blocker
 * check → record.
 *
 * A key typed in the BROWSER window can still send a message behind the
 * session's back (the operator clicked into the composer and pressed Enter).
 * Before acting on any terminal key, the session therefore checks whether the
 * message already left; if it did, it is recorded, never typed or sent again.
 */
import { redactUrl } from "./blockers.mjs";
import {
  clearComposer,
  composerDetached,
  composerMatches,
  normaliseForCompare,
  readComposer,
  sendFromComposer,
  stripControlChars,
  typeAndVerify
} from "./composer.mjs";
import { SEND_STATUS } from "./drivers/common.mjs";
import { CONFIRM_DRAIN_MS } from "./keys.mjs";

export const KEY = Object.freeze({
  ENTER: "enter",
  EDIT: "e",
  SKIP: "s",
  QUIT: "q",
  REGENERATE: "r",
  BACK: "n",
  /** "Oui": an explicit, different key for a second confirmation (never Enter twice). */
  CONFIRM: "o",
  TIMEOUT: "timeout"
});

/** Why a session ended early. A session that simply ran out of work has none. */
export const STOP = Object.freeze({
  OPERATOR: "operator_quit",
  DAILY_CAP: "daily_cap",
  SPACING: "spacing_retry_failed",
  RECORD_FAILED: "record_failed",
  /** Several prospects in a row without a message button or composer: Meta changed its interface. */
  SELECTOR_DRIFT: "selector_drift",
  /** The conversation's composer left the page before the send. */
  COMPOSER_LOST: "composer_lost",
  /** Automatic session: the SDR does not allow it now (pause, safe mode, recent block). Suffixed with the reason. */
  AUTO_REFUSED: "auto_refused",
  /** Automatic session: the composer did not hold exactly the text to send, or changed before the send. */
  AUTO_TYPING: "auto_typing_mismatch",
  /** Automatic session: a message left, or may have left, without being seen in the thread. */
  AUTO_UNVERIFIED: "auto_unverified_send",
  /** Automatic session: the "is this conversation new?" check contradicted itself. */
  AUTO_THREAD_CHECK: "auto_thread_check",
  ERROR: "error"
});

/** Automatic session: the shortest countdown, whatever the session was given. */
export const AUTO_VETO_MIN_SECONDS = 5;

/**
 * Whether a draft may leave without a person reading it. The SDR decides
 * (`review.autoSend`, from its stored checks, the code-written terms line and
 * the claim validation — social-session-service.ts `autoSendVerdict`); the
 * runner only refuses more: a failed check or a warning on the review it was
 * handed. A draft with no verdict is not sendable — "not checked" is not
 * "passed".
 */
export function autoSendable(review) {
  return review?.autoSend?.allowed === true && review.pricingGuardrailPassed === true && !(review.warnings ?? []).length;
}

/** "empty" | "has_content" | "unknown": whether the open conversation holds nothing yet. Unknown when the network cannot tell. */
async function threadStateOf(ctx, composer, profile, options) {
  if (typeof ctx.driver.threadState !== "function") return { state: "unknown", why: "not_supported" };
  try {
    return (await ctx.driver.threadState(ctx.page, composer, profile, options)) ?? { state: "unknown" };
  } catch {
    return { state: "unknown", why: "check_failed" };
  }
}

/** Prospects in a row without a "Message" button or composer before the session stops. */
export const MAX_CONSECUTIVE_UNAVAILABLE = 3;
/**
 * Automatic session: conversations in a row that are "not new, or cannot be
 * checked" before the session stops. One is a prospect already written to;
 * three in a row is the check no longer recognising Instagram's chat window —
 * and a session that would open every profile of the queue for nothing.
 */
export const MAX_CONSECUTIVE_THREAD_REFUSALS = 3;
/** The reasons that point at selector drift rather than at one prospect's profile. */
const DRIFT_REASONS = new Set(["no_message_button", "no_composer"]);

/** Attempts at recording a send (the SDR calls are idempotent), and the pause between them. */
const RECORD_ATTEMPTS = 3;
const RECORD_RETRY_MS = 1500;

/** Meta marked our bubble as not sent: treated like a block, the session stops. */
const SEND_FAILED_BLOCKER = Object.freeze({ kind: "action_blocked", detail: "send_failed" });

const RETYPE = Symbol("retype");

const stopped = (reason, extra = {}) => ({ outcome: "stopped", reason, ...extra });
const blockedStop = (blocker) => stopped(`blocked:${blocker.kind}`, { blocker });

/**
 * The terminal edits one line, so line breaks travel as the two visible
 * characters backslash + n while the operator edits, and come back as real ones.
 */
export function toEditLine(text) {
  return String(text).replace(/\r\n|\r|\n/g, "\\n");
}

export function fromEditLine(line) {
  return String(line).replace(/\\n/g, "\n");
}

/** First line of an error, short: Playwright errors carry long call logs. */
export function errorSummary(error) {
  return stripControlChars(String(error?.message ?? error).split("\n")[0]).slice(0, 200);
}

const interrupted = (ctx) => Boolean(ctx.keys.isInterrupted?.());

function pause(ctx, ms) {
  return ctx.sleep ? ctx.sleep(ms) : new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Spacing refusal: show a countdown the operator can cut short with S or Q.
 * Enter is not accepted here; the Enter already given still stands.
 */
async function waitForSpacing(ctx, retryInSeconds) {
  const seconds = Math.max(1, Math.ceil(Number(retryInSeconds) || 1));
  ctx.ui.info(`Espacement minimum entre deux DM : envoi dans ${seconds} s (S = passer, Q = arrêter).`);
  const key = await ctx.keys.prompt([KEY.SKIP, KEY.QUIT], {
    timeoutMs: seconds * 1000,
    onTick: (left) => ctx.ui.countdown(left)
  });
  ctx.ui.countdown(0);
  return key;
}

/**
 * Automatic session: the message is on screen and in the composer; it leaves
 * when the countdown ends unless the operator presses S (skip this prospect)
 * or Q (stop the session). Enter is not offered: nothing here needs a key.
 */
async function vetoWindow(ctx, vetoSeconds) {
  const seconds = Math.max(AUTO_VETO_MIN_SECONDS, Math.ceil(Number(vetoSeconds) || 0));
  ctx.ui.info(`Envoi automatique dans ${seconds} s (S = passer ce prospect, Q = arrêter la session).`);
  const key = await ctx.keys.prompt([KEY.SKIP, KEY.QUIT], {
    timeoutMs: seconds * 1000,
    onTick: (left) => ctx.ui.countdown(left)
  });
  ctx.ui.countdown(0);
  return key;
}

function composerLost(ctx) {
  ctx.ui.error("La fenêtre de discussion de ce prospect a changé ou s'est fermée : rien n'est envoyé, la session s'arrête.");
  return stopped(STOP.COMPOSER_LOST);
}

/** Notes the send in the local journal (send-journal.mjs) before the key acts. */
function journalBegin(ctx, spec, { text, edited, viaBrowser = false }) {
  if (!ctx.journal || !spec.journal) return undefined;
  return ctx.journal.begin(spec.journal({ finalText: text, edited, viaBrowser, threadUrl: ctx.driver.threadUrl(ctx.page) }));
}

/**
 * Records a send, retrying (the SDR calls are idempotent). The journal entry
 * is removed only once the SDR has it.
 */
async function recordSent(ctx, spec, { text, edited, verified, viaBrowser, journalId }) {
  let lastError;
  for (let attempt = 0; attempt < RECORD_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await pause(ctx, RECORD_RETRY_MS * attempt);
    try {
      await spec.record({ finalText: text, edited, verified, viaBrowser: Boolean(viaBrowser), threadUrl: ctx.driver.threadUrl(ctx.page) });
      ctx.journal?.settle(journalId);
      return { outcome: "sent", verified, viaBrowser };
    } catch (error) {
      lastError = error;
    }
  }
  // The message is out but the SDR does not know. Stop: carrying on would
  // stack more unrecorded sends on top of an unknown state.
  ctx.ui.error(`Message envoyé mais NON enregistré dans le SDR : ${errorSummary(lastError)}`);
  if (journalId) {
    ctx.ui.warn("Il reste noté sur ce Mac : la prochaine session l'enregistrera « à vérifier » et ne reproposera pas ce prospect.");
  }
  return stopped(STOP.RECORD_FAILED, { sent: true, verified });
}

/**
 * After a message left (our Enter or one typed in the browser): what Meta
 * shows decides whether it is recorded as delivered, and a send-failure
 * marker or a blocker page stops the session with the send recorded as
 * unverified.
 */
async function afterSend(ctx, spec, { text, edited, journalId, viaBrowser, status }) {
  const { page, driver, ui } = ctx;
  const confirmed = status ?? (await driver.confirmSent(page, text, spec.composer));
  const pageBlocker = await driver.checkBlocker(page).catch(() => null);
  const blocker = pageBlocker ?? (confirmed === SEND_STATUS.FAILED ? SEND_FAILED_BLOCKER : null);
  const verified = confirmed === SEND_STATUS.DELIVERED && !blocker;

  if (blocker) {
    ui.warn("Meta n'a pas accepté l'envoi (ou affiche un blocage juste après) : enregistré « à vérifier », et la session s'arrête.");
  } else if (!verified) {
    ui.warn("Envoi non confirmé à l'écran : enregistré « à vérifier ». Regarde la conversation dans le navigateur.");
  }
  const recorded = await recordSent(ctx, spec, { text, edited, verified, viaBrowser, journalId });
  if (recorded.outcome !== "sent") return recorded;
  if (blocker) return { ...blockedStop(blocker), sent: true, verified };
  // Automatic session: the message is on screen, so the conversation is no
  // longer new. A check that still says "new" cannot see messages at all: its
  // "new" before the send proved nothing, and nothing more is sent on it.
  if (spec.auto && verified && (await spec.auto.threadState({ typed: false })).state === "empty") {
    ui.error("La vérification « conversation vierge » ne voit pas le message qui vient de partir : elle n'est pas fiable, la session automatique s'arrête.");
    return stopped(STOP.AUTO_THREAD_CHECK, { sent: true, verified });
  }
  return recorded;
}

/**
 * Automatic session: the text that was verified in the composer is no longer
 * there (empty or closed chat window) and no bubble shows it.
 *
 *  1. A blocker page explains it (a checkpoint replaced the app): nothing
 *     left, the session stops as blocked — reported, so the 48 h rule holds.
 *  2. The page rebuilt the composer and the one on screen still holds the
 *     whole text: nothing left either. It is emptied and the session stops.
 *  3. Otherwise it may have left — a key in the browser window — without
 *     being drawn yet. Nobody is there to look, so it is never typed again:
 *     it is recorded "to check", which also takes the one-first-message
 *     lock, so no later session can send it a second time. The session stops.
 */
async function autoTextVanished(ctx, spec, text, { reserved = false } = {}) {
  const { page, driver, ui } = ctx;
  const blocker = await driver.checkBlocker(page).catch(() => null);
  if (blocker) return blockedStop(blocker);

  const current = typeof driver.currentComposer === "function" ? await driver.currentComposer(page).catch(() => null) : null;
  if (current && current !== spec.composer && composerMatches(await readComposer(current).catch(() => ""), text)) {
    ui.error("La page a reconstruit le champ de message, qui contient toujours le texte : rien n'est parti. Je le vide, la session automatique s'arrête.");
    await clearComposer(page, current).catch(() => undefined);
    return stopped(STOP.AUTO_TYPING);
  }

  ui.error("Le texte a quitté le champ de message sans que l'envoi soit visible : il est peut-être parti. Enregistré « à vérifier », la session automatique s'arrête.");
  const journalId = journalBegin(ctx, spec, { text, edited: false, viaBrowser: true });
  // A slot taken late still counts: the message may be out.
  if (spec.reserve && !reserved) await spec.reserve().catch(() => undefined);
  const recorded = await recordSent(ctx, spec, { text, edited: false, verified: false, viaBrowser: true, journalId });
  return recorded.outcome === "sent" ? stopped(STOP.AUTO_UNVERIFIED, { sent: true, verified: false }) : recorded;
}

/** Automatic session: other text sits in the composer. Ours did not leave; nothing is retyped, the session stops. */
async function autoTextChanged(ctx, spec) {
  ctx.ui.error("Le champ de message ne contient pas (ou plus) le texte prévu : rien n'est envoyé, la session automatique s'arrête.");
  await clearComposer(ctx.page, spec.composer);
  return stopped(STOP.AUTO_TYPING);
}

/** A message that left from the browser window: journaled, counted, recorded. Never sent again. */
async function recordBrowserSend(ctx, spec, { text, edited, status, reserved }) {
  ctx.ui.warn("Le message est parti depuis la fenêtre du navigateur (touche tapée là-bas) : je l'enregistre, rien d'autre ne part pour ce message.");
  const journalId = journalBegin(ctx, spec, { text, edited, viaBrowser: true });
  // A slot taken late still counts: the message is out.
  if (spec.reserve && !reserved) await spec.reserve().catch(() => undefined);
  return afterSend(ctx, spec, { text, edited, journalId, viaBrowser: true, status });
}

/**
 * Did `text` leave without the session (a key typed in the browser window)?
 * Only an empty composer can mean that; the bubble on screen decides. Returns
 * the recorded outcome, or null when the message is still ours to handle.
 * `reserved`: a daily slot was already taken for this message.
 *
 * In an automatic session, a text that was verified in the composer and is no
 * longer there — with no bubble to show for it — is treated as possibly sent
 * (`autoTextVanished`), whatever happens next (countdown ended, S, Q, a
 * refusal): otherwise the draft would stay a draft and leave a second time.
 * `vanishIsSend: false` is for a text that never landed in the composer.
 */
async function sentBehindOurBack(ctx, spec, text, edited, { reserved = false, vanishIsSend = Boolean(spec.auto) } = {}) {
  const { page, driver } = ctx;
  const detached = await composerDetached(spec.composer);
  if (!detached && normaliseForCompare(await readComposer(spec.composer)) !== "") return null;
  const status = await driver.confirmSent(page, text, spec.composer);
  if (status === SEND_STATUS.UNCONFIRMED) {
    if (vanishIsSend) return autoTextVanished(ctx, spec, text, { reserved });
    // With keys, the person sees the window: an empty composer is retyped or
    // skipped by them, a closed one stops the session.
    return detached ? composerLost(ctx) : null;
  }
  return recordBrowserSend(ctx, spec, { text, edited, status, reserved });
}

/**
 * Leaves this message unsent (refusal, skip, quit, cap): unless it already
 * left from the browser, in which case that send is recorded instead.
 */
async function abandon(ctx, spec, text, edited, result, { reserved = false } = {}) {
  const gone = await sentBehindOurBack(ctx, spec, text, edited, { reserved });
  if (gone) return gone;
  await clearComposer(ctx.page, spec.composer);
  return result;
}

/**
 * Everything between the decision to send (the operator's Enter, or the end
 * of an automatic session's countdown) and the record. Returns a final
 * outcome, or RETYPE when the message must be typed and approved again.
 */
async function sendApproved(ctx, spec, text, edited) {
  const { page, driver, ui } = ctx;
  const { composer } = spec;
  const auto = Boolean(spec.auto);

  /**
   * Suppression, one-message-per-company and — in an automatic session — the
   * SDR's switch and the draft's own verdict. Returns the outcome that ends
   * this message, or null when it may go on.
   */
  async function gateOutcome({ reserved = false } = {}) {
    const gate = await spec.checkGate();
    if (!gate.allowed) return abandon(ctx, spec, text, edited, { outcome: "refused", reason: gate.reason ?? "refused" }, { reserved });
    // The stored draft changed after this text was shown (a web edit, a
    // redraft): the person approved the old text, so it is not sent. The new
    // version comes back at the next session. The operator's own edit (E) is
    // what they approved and is sent as typed.
    const storedNow = [gate.body, gate.generatedBody].find((value) => typeof value === "string" && value.trim());
    if (!edited && storedNow && !composerMatches(storedNow, text)) {
      ui.warn("Ce DM a été modifié dans le SDR pendant l'aperçu : il n'est pas envoyé, la nouvelle version reviendra à la prochaine session.");
      return abandon(ctx, spec, text, edited, { outcome: "skipped", reason: "draft_changed" }, { reserved });
    }
    return null;
  }

  // 1. The Enter may have reached the browser instead of the terminal: then
  // the message is already gone, and it is recorded rather than typed again.
  // (In an automatic session a text that vanished is recorded there too, and
  // RETYPE below never means typing: autoComposeAndSend stops the session.)
  const gone = await sentBehindOurBack(ctx, spec, text, edited);
  if (gone) return gone;
  const current = await readComposer(composer);
  if (normaliseForCompare(current) === "") {
    ui.warn("Le champ de message est vide : je retape le texte.");
    return RETYPE;
  }
  if (!composerMatches(current, text)) {
    ui.warn("Le champ de message a changé depuis l'aperçu : je retape le texte.");
    return RETYPE;
  }

  // 2. Suppression and one-message-per-company, as late as possible.
  const refused = await gateOutcome();
  if (refused) return refused;

  // 3. Daily cap and spacing (first DMs only). A reserved slot is never given
  // back: a send that then fails over-counts, which is the safe direction.
  let waited = false;
  if (spec.reserve) {
    let slot = await spec.reserve();
    if (!slot.ok && slot.reason === "spacing") {
      const key = await waitForSpacing(ctx, slot.retryInSeconds);
      if (key === KEY.QUIT) return abandon(ctx, spec, text, edited, stopped(STOP.OPERATOR));
      if (key === KEY.SKIP) return abandon(ctx, spec, text, edited, { outcome: "skipped", reason: "operator_skip" });
      waited = true;
      slot = await spec.reserve();
    }
    if (!slot.ok) {
      if (slot.reason === "daily_cap") {
        ui.warn(`Plafond du jour atteint (${slot.used}/${slot.cap}). Reprise demain.`);
        return abandon(ctx, spec, text, edited, stopped(STOP.DAILY_CAP));
      }
      ui.warn("L'espacement minimum n'est toujours pas respecté après l'attente : arrêt.");
      return abandon(ctx, spec, text, edited, stopped(STOP.SPACING));
    }
    ui.info(`Quota du jour : ${slot.used}/${slot.cap}.`);
  }
  const reserved = Boolean(spec.reserve);

  // 4. Last look before sending: did it leave from the browser during the
  // wait, then the page, then the composer once more (a countdown leaves time
  // for the page, the window or the text to change).
  const goneMeanwhile = await sentBehindOurBack(ctx, spec, text, edited, { reserved });
  if (goneMeanwhile) return goneMeanwhile;
  const blocker = await driver.checkBlocker(page);
  if (blocker) return blockedStop(blocker);
  if (await composerDetached(composer)) return auto ? autoTextVanished(ctx, spec, text, { reserved }) : composerLost(ctx);
  if (!composerMatches(await readComposer(composer), text)) {
    ui.warn("Le champ de message a changé pendant l'attente : je retape le texte.");
    return RETYPE;
  }

  // 4b. An automatic session has nobody to notice what changed meanwhile.
  if (auto) {
    // The spacing wait can last a minute: pause, opt-out and the draft's
    // verdict are asked again, so they are true at the moment of the send.
    if (waited) {
      const refusedNow = await gateOutcome({ reserved });
      if (refusedNow) return refusedNow;
    }
    // The conversation was new when it was opened; its history may have
    // loaded since, or the prospect may have written. Checked with the text
    // in the composer, so the interface's own "Send" button is expected.
    const thread = await spec.auto.threadState({ typed: true });
    if (thread.state !== "empty") {
      ui.error(`La conversation n'est plus vierge au moment d'envoyer (${thread.why ?? thread.state}) : rien n'est envoyé, la session automatique s'arrête.`);
      if (thread.unexpected?.length) ui.info(`Lignes inattendues dans la fenêtre de discussion : ${thread.unexpected.map((line) => `« ${line} »`).join(", ")}`);
      const left = await abandon(ctx, spec, text, edited, { outcome: "held", reason: "thread_not_empty" }, { reserved });
      return left.outcome === "held" ? stopped(STOP.AUTO_THREAD_CHECK, { leftForPerson: `thread_not_empty:${thread.why ?? thread.state}` }) : left;
    }
    // A stop asked since the countdown ended (Ctrl+C, a closed terminal)
    // found no prompt to answer: it is honoured here, last thing before the send.
    if (interrupted(ctx)) return abandon(ctx, spec, text, edited, stopped(STOP.OPERATOR), { reserved });
  }

  // 5. Journal, send, confirm on screen, check the page, record.
  const journalId = journalBegin(ctx, spec, { text, edited });
  await sendFromComposer(page, composer);
  return afterSend(ctx, spec, { text, edited, journalId, viaBrowser: false });
}

/**
 * One message from composer to record.
 *
 * @param {object} ctx  { page, driver, keys, ui, journal?, sleep? }
 * @param {{
 *   composer: any,
 *   text: string,
 *   edited?: boolean,
 *   review?: { pricingGuardrailPassed?: boolean, mentionsCommercialTerms?: boolean, warnings?: string[] },
 *   regenerate?: () => Promise<{ text: string, review: object } | null>,
 *   checkGate: () => Promise<{ allowed: boolean, reason?: string }>,
 *   reserve?: () => Promise<{ ok: boolean, reason?: string, used?: number, cap?: number, retryInSeconds?: number }>,
 *   record: (sent: { finalText: string, edited: boolean, verified: boolean, threadUrl?: string }) => Promise<unknown>,
 *   journal?: (sent: { finalText: string, edited: boolean, viaBrowser?: boolean, threadUrl?: string }) => object,
 *   auto?: { vetoSeconds: number, threadState: (options: { typed: boolean }) => Promise<{ state: string, why?: string }> },
 *   afterTyped?: () => Promise<void>
 * }} spec
 *   `journal` describes the send for the pending-send journal (send-journal.mjs).
 *   `auto`: send after a countdown instead of an Enter; `threadState` says
 *   whether the conversation is still new. Given by the first-DM session only
 *   (runQueueItem), never for a reply.
 *   `afterTyped`: called once the text sits in the composer of a session with
 *   keys, to show the operator something; it decides nothing.
 * @returns {Promise<{ outcome: "sent", verified: boolean, viaBrowser: boolean }
 *   | { outcome: "skipped" | "refused" | "held", reason: string }
 *   | { outcome: "stopped", reason: string, blocker?: object, sent?: boolean, verified?: boolean }>}
 */
export async function composeAndSend(ctx, spec) {
  const { page, keys, ui } = ctx;
  const { composer } = spec;
  let text = stripControlChars(spec.text);
  let edited = Boolean(spec.edited);
  let review = spec.review ?? {};
  if (spec.auto) return autoComposeAndSend(ctx, spec, text, review);
  let typed = await typeAndVerify(page, composer, text);
  // Information for the operator, never a decision: nothing here can send, skip or stop.
  if (typed && spec.afterTyped) await spec.afterTyped().catch(() => undefined);

  /**
   * Types `next` in place of the current text, unless the current text left
   * from the browser meanwhile (then that send is the outcome).
   */
  async function retype(next) {
    const gone = await sentBehindOurBack(ctx, spec, text, edited);
    if (gone) return gone;
    if (await composerDetached(composer)) return composerLost(ctx);
    text = next;
    typed = await typeAndVerify(page, composer, text);
    return null;
  }

  for (;;) {
    ui.message({ text, edited, typed, ...review });
    const choices = [
      ...(typed ? [KEY.ENTER] : []),
      KEY.EDIT,
      ...(spec.regenerate ? [KEY.REGENERATE] : []),
      KEY.SKIP,
      KEY.QUIT
    ];
    ui.keysHint(choices);
    const key = await keys.prompt(choices);

    // Whatever the key, a message that already left is recorded first and
    // nothing else happens to it (no skip, no retype, no second send).
    if (key !== KEY.ENTER) {
      const gone = await sentBehindOurBack(ctx, spec, text, edited);
      if (gone) {
        if (key === KEY.QUIT && gone.outcome === "sent") return stopped(STOP.OPERATOR, { sent: true, verified: gone.verified });
        return gone;
      }
    }

    if (key === KEY.SKIP) {
      await clearComposer(page, composer);
      return { outcome: "skipped", reason: "operator_skip" };
    }
    if (key === KEY.EDIT) {
      const next = await keys.readLine("Nouveau texte (\\n = retour à la ligne, vide = annuler) : ", toEditLine(text));
      let replaced = text;
      let changed = false;
      if (next !== null && normaliseForCompare(next) !== "") {
        replaced = stripControlChars(fromEditLine(next));
        changed = !composerMatches(replaced, text);
      }
      const gone = await retype(replaced);
      if (gone) return gone;
      if (changed) edited = true;
      continue;
    }
    if (key === KEY.REGENERATE && spec.regenerate) {
      ui.info("Nouvelle proposition en cours…");
      let next = null;
      try {
        next = await spec.regenerate();
      } catch (error) {
        // An AI or SDR hiccup: the current text stays, nothing is stopped.
        ui.warn(`Nouvelle proposition impossible (${errorSummary(error)}).`);
        continue;
      }
      if (!next) {
        ui.warn("Pas de nouvelle proposition possible : garde, modifie ou passe ce message.");
        continue;
      }
      const gone = await retype(stripControlChars(next.text));
      if (gone) return gone;
      review = next.review ?? {};
      edited = false;
      continue;
    }
    // Enter is not offered while the composer does not match; ignore it if it comes anyway.
    if (key === KEY.ENTER && !typed) continue;
    if (key !== KEY.ENTER) {
      // Q, or Ctrl+C (which the key hub reports as Q).
      await clearComposer(page, composer);
      return stopped(STOP.OPERATOR);
    }

    // A failed pricing check on AI text needs a second, explicit decision,
    // on a different key: a double-tapped or held Enter cannot give it. Text
    // the operator rewrote is theirs; the warning stays on screen.
    if (review.pricingGuardrailPassed === false && !edited) {
      ui.warn("Le contrôle des prix a échoué sur ce texte. O pour l'envoyer quand même, N pour revenir.");
      ui.keysHint([KEY.CONFIRM, KEY.BACK, KEY.QUIT], { [KEY.CONFIRM]: "O = envoyer quand même" });
      const confirmation = await keys.prompt([KEY.CONFIRM, KEY.BACK, KEY.QUIT], { drainMs: CONFIRM_DRAIN_MS });
      if (confirmation !== KEY.CONFIRM) {
        const gone = await sentBehindOurBack(ctx, spec, text, edited);
        if (gone) return gone;
      }
      if (confirmation === KEY.BACK) continue;
      if (confirmation !== KEY.CONFIRM) {
        await clearComposer(page, composer);
        return stopped(STOP.OPERATOR);
      }
    }

    const result = await sendApproved(ctx, spec, text, edited);
    if (result === RETYPE) {
      if (await composerDetached(composer)) return composerLost(ctx);
      typed = await typeAndVerify(page, composer, text);
      continue;
    }
    return result;
  }
}

/**
 * One first DM of an automatic session: typed once, shown, and sent when its
 * countdown ends — unless S or Q, and only while everything is exactly as
 * expected. There is no "show it again and wait" here, because nobody may be
 * there to answer, and no second typing: a text that does not land in the
 * composer as written (typeAndVerify already tried twice), or leaves it
 * before the send, stops the session.
 */
async function autoComposeAndSend(ctx, spec, text, review) {
  const { page, ui } = ctx;
  const { composer } = spec;
  // Nothing is typed for a text a person still has to read.
  if (!autoSendable(review)) return { outcome: "held", reason: "needs_review" };

  const typed = await typeAndVerify(page, composer, text);
  ui.message({ text, edited: false, typed, ...review });
  if (!typed) {
    // The text never sat in the composer as written, so an empty composer is
    // not "it left"; a bubble showing it still is.
    const gone = await sentBehindOurBack(ctx, spec, text, false, { vanishIsSend: false });
    if (gone) return gone;
    return autoTextChanged(ctx, spec);
  }

  const key = await vetoWindow(ctx, spec.auto.vetoSeconds);
  if (key !== KEY.TIMEOUT) {
    // S, Q or Ctrl+C. A message that left from the browser window meanwhile is recorded first.
    const gone = await sentBehindOurBack(ctx, spec, text, false);
    if (gone) {
      if (key === KEY.QUIT && gone.outcome === "sent") return stopped(STOP.OPERATOR, { sent: true, verified: gone.verified });
      return gone;
    }
    await clearComposer(page, composer);
    return key === KEY.SKIP ? { outcome: "skipped", reason: "operator_skip" } : stopped(STOP.OPERATOR);
  }

  const result = await sendApproved(ctx, spec, text, false);
  // The composer no longer holds the text as written (changed since the
  // countdown, or during the wait). With keys it is typed and shown again;
  // here nothing is typed twice: the session stops.
  return result === RETYPE ? autoTextChanged(ctx, spec) : result;
}

/**
 * The text to type for a queued DM: the one stored in the SDR right now when
 * the gate returns it (an edit saved on the web during the session wins over
 * the text listed at start), else the listed one.
 */
function currentBody(ctx, item, verdict) {
  const stored = [verdict?.body, verdict?.generatedBody].find((value) => typeof value === "string" && value.trim());
  if (!stored) return item.body;
  if (!composerMatches(stored, item.body)) {
    ctx.ui.info("Ce DM a été modifié dans le SDR depuis le début de la session : je tape le texte enregistré.");
  }
  return stored.trim();
}

/**
 * One queued first DM: gate, open the conversation, then the confirmation
 * loop. A conversation that cannot be opened comes back as "unavailable";
 * the session decides whether to set the draft aside (runSendSession).
 */
export async function runQueueItem(ctx, item) {
  const { sdr, driver, page, ui, session } = ctx;
  const { network } = session;
  const auto = ctx.auto;
  // The session asking is named, so the SDR does not take it for one that never ended.
  const autoScope = { workspaceId: session.workspaceId, businessId: session.businessId, network, sessionId: session.sessionId };

  // An automatic session asks the SDR before every prospect: the app's pause
  // switch (or a block recorded meanwhile) stops it here, before any page opens.
  if (auto) {
    const allowed = await sdr.checkAutoSend(autoScope);
    if (!allowed.allowed) {
      ui.warn(`Envoi automatique refusé par le SDR (${allowed.reason ?? "refusé"}) : la session s'arrête.`);
      return stopped(`${STOP.AUTO_REFUSED}:${allowed.reason ?? "refused"}`);
    }
  }

  const gateInput = { outreachId: item.outreachId, network, ...(auto ? { forAutoSend: true } : {}) };
  const before = await sdr.checkBeforeSend(gateInput);
  if (!before.allowed) {
    ui.info(`Ignoré : ${before.reason ?? "refusé par le contrôle de contact"}.`);
    return { outcome: "refused", reason: before.reason ?? "refused" };
  }
  // Ctrl+C while the gate ran: nothing new is opened.
  if (interrupted(ctx)) return stopped(STOP.OPERATOR);
  const body = currentBody(ctx, item, before);
  // The review read with the text being typed (checkBeforeSend), else the listed one.
  const review = before.review ?? {
    pricingGuardrailPassed: item.pricingGuardrailPassed,
    mentionsCommercialTerms: item.mentionsCommercialTerms,
    warnings: item.riskWarnings
  };
  // A draft a person still has to read is left in the queue, untouched, for a
  // session with keys: its conversation is not even opened.
  if (auto && !autoSendable(review)) {
    const why = review?.autoSend?.reason ?? (review?.pricingGuardrailPassed === false ? "checks_not_passed" : "not_checked");
    ui.info(`À relire par une personne (${why}) : laissé dans la file pour une session avec touches.`);
    return { outcome: "held", reason: "needs_review" };
  }

  const opened = await driver.openConversation(page, item.profile);
  if (!opened.ok) {
    if (typeof opened.reason === "object") {
      // "Action blocked" on this prospect's page may be about this account
      // only; parking the draft for a day keeps tomorrow's session from
      // starting on the same wall.
      if (opened.reason.kind === "action_blocked") {
        await sdr.recordSocialDmSkipped({ outreachId: item.outreachId, network, reason: "blocked_on_open", sessionId: session.sessionId });
      }
      return blockedStop(opened.reason);
    }
    return { outcome: "unavailable", reason: opened.reason };
  }

  // A "first" message belongs in a conversation that holds nothing yet. The
  // SDR only remembers what it sent itself; the account may have written to
  // this prospect before, by hand or with another tool. With keys the person
  // sees the thread; an automatic session checks, and leaves anything but a
  // provably new conversation to a person.
  const threadState = (options) => threadStateOf(ctx, opened.composer, item.profile, options);
  if (auto) {
    const thread = await threadState({ typed: false });
    if (thread.state !== "empty") {
      ui.warn(`Conversation déjà entamée, ou impossible à vérifier (${thread.why ?? thread.state}) : rien n'est tapé.`);
      if (thread.unexpected?.length) ui.info(`Lignes inattendues dans la fenêtre de discussion : ${thread.unexpected.map((line) => `« ${line} »`).join(", ")}`);
      // The session loop marks the draft as left to a person — unless this is
      // the third in a row, which says the check itself no longer works.
      return { outcome: "held", reason: "thread_not_empty", why: `thread_not_empty:${thread.why ?? thread.state}` };
    }
  }

  // With keys, the person decides — but the same look is shown to them: a
  // conversation that seems already started deserves a glance at the window,
  // and what the check sees once the text is typed tells, before any
  // automatic session, whether it recognises Instagram's window.
  const threadNote = async (typed) => {
    if (auto || typeof driver.threadState !== "function") return;
    const thread = await threadState({ typed });
    if (thread.state === "empty") {
      ui.info(typed ? "Vérification (information) : avec le texte tapé, la conversation est toujours reconnue comme vierge." : "Vérification (information) : conversation vierge.");
      return;
    }
    ui.warn(
      `Vérification (information) : ${typed ? "avec le texte tapé, " : ""}cette conversation n'est pas reconnue comme vierge (${thread.why ?? thread.state}). Regarde la fenêtre avant d'envoyer.`
    );
    if (thread.unexpected?.length) ui.info(`Lignes inattendues dans la fenêtre de discussion : ${thread.unexpected.map((line) => `« ${line} »`).join(", ")}`);
  };
  await threadNote(false).catch(() => undefined);

  const recordInput = ({ finalText, edited, threadUrl, viaBrowser }) => ({
    outreachId: item.outreachId,
    network,
    profile: item.profile,
    finalBody: finalText,
    edited,
    threadUrl,
    sessionId: session.sessionId,
    operator: session.operator,
    // Recorded with the send (and with its journal note): nobody pressed a
    // key for it. A message that left from a key in the browser window did
    // have a person behind it.
    ...(auto && !viaBrowser ? { auto: true } : {})
  });

  const result = await composeAndSend(ctx, {
    composer: opened.composer,
    text: body,
    review,
    ...(auto ? { auto: { vetoSeconds: auto.vetoSeconds, threadState } } : { afterTyped: () => threadNote(true) }),
    checkGate: async () => {
      // Paused or blocked during the countdown: this message does not leave.
      if (auto) {
        const allowed = await sdr.checkAutoSend(autoScope);
        if (!allowed.allowed) return { allowed: false, reason: `${STOP.AUTO_REFUSED}:${allowed.reason ?? "refused"}` };
      }
      const verdict = await sdr.checkBeforeSend(gateInput);
      // The text is the same but its verdict is not (re-checked meanwhile), or
      // the SDR gave none this time: a person reads it.
      if (auto && verdict.allowed && !autoSendable(verdict.review)) return { allowed: false, reason: "needs_review" };
      return verdict;
    },
    reserve: () => sdr.reserveSendSlot({ workspaceId: session.workspaceId, businessId: session.businessId, network }),
    record: (sent) => sdr.recordSocialDmSent({ ...recordInput(sent), verified: sent.verified }),
    journal: (sent) => ({
      kind: "first_dm",
      network,
      workspaceId: session.workspaceId,
      businessId: session.businessId,
      companyName: item.companyName,
      outreachId: item.outreachId,
      text: sent.finalText,
      record: recordInput(sent)
    })
  });

  if (result.outcome === "skipped") {
    await sdr.recordSocialDmSkipped({ outreachId: item.outreachId, network, reason: result.reason, sessionId: session.sessionId });
  }
  // The session stopped because this conversation stopped being new: the draft is left to a person.
  if (result.outcome === "stopped" && result.leftForPerson) {
    await sdr
      .recordSocialDmAutoHeld({ outreachId: item.outreachId, network, reason: result.leftForPerson, sessionId: session.sessionId })
      .catch(() => undefined);
  }
  if (auto && result.outcome === "refused") {
    // Refused at the last moment for a reason that concerns the whole session, or this draft's review.
    if (String(result.reason).startsWith(`${STOP.AUTO_REFUSED}:`)) {
      ui.warn(`Envoi automatique refusé par le SDR (${String(result.reason).slice(STOP.AUTO_REFUSED.length + 1)}) : la session s'arrête.`);
      return stopped(result.reason);
    }
    if (result.reason === "needs_review") return { outcome: "held", reason: "needs_review" };
  }
  return result;
}

/**
 * Turns an exception into a stop. Playwright throws when a selector no longer
 * matches, and the page may also have turned into a checkpoint: only a real
 * blocker found on the page is reported as one. An AI, SDR or selector error
 * is a plain error, never "Meta blocked the session".
 */
export async function stopOnError(ctx, error) {
  ctx.ui.error(`Erreur : ${errorSummary(error)}`);
  const blocker = await ctx.driver.checkBlocker(ctx.page).catch(() => null);
  return blocker ? blockedStop(blocker) : stopped(STOP.ERROR);
}

/** Records a blocked stop in the SDR. Never throws: the session is ending anyway. */
export async function reportBlocked(ctx, blocker) {
  const { sdr, session, page, ui } = ctx;
  ui.blocker(blocker);
  try {
    await sdr.reportSessionBlocked({
      sessionId: session.sessionId,
      workspaceId: session.workspaceId,
      businessId: session.businessId,
      network: session.network,
      reason: blocker.kind,
      url: redactUrl(page.url())
    });
  } catch (error) {
    ui.warn(`Arrêt non enregistré dans le SDR : ${errorSummary(error)}`);
  }
}

export function newSendStats() {
  return { sent: 0, unverified: 0, skipped: 0, unavailable: 0, refused: 0, held: 0 };
}

/**
 * A first-DM session over a queue. Stops at `max` sends, at the end of the
 * queue, or at the first stop (blocker, cap, quit, error, selector drift).
 *
 * `stats` is updated as the session goes, so a forced exit can still record
 * what was sent. `excludeOutreachIds`: drafts a previous session may already
 * have sent (pending-send journal), never offered here.
 *
 * With `ctx.auto` (an automatic session), each message leaves at the end of
 * its countdown; drafts a person must read are left in the queue (`held`),
 * and the session stops at the first send it cannot see in the thread.
 *
 * @returns {Promise<ReturnType<typeof newSendStats> & { stoppedReason?: string }>}
 */
export async function runSendSession(ctx, { items, max, stats = newSendStats(), excludeOutreachIds }) {
  const { driver, page, ui, sdr, session } = ctx;
  let stoppedReason;
  let unavailableInARow = 0;
  let threadRefusalsInARow = 0;

  for (let index = 0; index < items.length; index += 1) {
    if (stats.sent >= max) {
      ui.info(`Maximum de la session atteint (${max}).`);
      break;
    }
    // Ctrl+C (or a closed key hub) between two prospects: stop before opening the next.
    if (interrupted(ctx)) {
      stoppedReason = STOP.OPERATOR;
      break;
    }
    const item = items[index];
    if (excludeOutreachIds?.has(item.outreachId)) {
      ui.warn(`${stripControlChars(item.companyName)} : un envoi précédent n'est peut-être pas enregistré, ce prospect n'est pas proposé.`);
      continue;
    }
    ui.item({ index, total: items.length, companyName: item.companyName, network: session.network, profileUrl: item.profile.url });

    let result;
    try {
      result = await runQueueItem(ctx, item);
      if (result.outcome === "unavailable") {
        unavailableInARow = DRIFT_REASONS.has(result.reason) ? unavailableInARow + 1 : 0;
        if (unavailableInARow >= MAX_CONSECUTIVE_UNAVAILABLE) {
          ui.error(
            `${unavailableInARow} prospects de suite sans bouton « Message » ou sans champ de message : ${session.network === "facebook" ? "Facebook" : "Instagram"} a sans doute changé son interface. Arrêt (ce dernier DM reste dans la file).`
          );
          result = stopped(STOP.SELECTOR_DRIFT);
        } else {
          ui.warn(`Pas de conversation possible (${result.reason}) : DM mis de côté pour aujourd'hui.`);
          await sdr.recordSocialDmSkipped({ outreachId: item.outreachId, network: session.network, reason: result.reason, sessionId: session.sessionId });
        }
      } else if (result.outcome !== "held") {
        // A held draft opened no page: it says nothing about the interface,
        // and must not hide a run of prospects without a "Message" button.
        unavailableInARow = 0;
      }
    } catch (error) {
      result = await stopOnError(ctx, error);
    }

    // Automatic session: a conversation that was not new at opening. A typed
    // message (sent, or skipped by the operator) means the check said "new".
    if (result.outcome === "held" && result.reason === "thread_not_empty") {
      threadRefusalsInARow += 1;
      if (threadRefusalsInARow >= MAX_CONSECUTIVE_THREAD_REFUSALS) {
        ui.error(
          `${threadRefusalsInARow} conversations de suite « déjà entamées ou non vérifiables » : la vérification ne reconnaît sans doute plus la fenêtre de discussion. Arrêt (ce dernier DM reste dans la file).`
        );
        result = stopped(STOP.AUTO_THREAD_CHECK);
      } else {
        ui.info("À traiter toi-même : ce DM reste dans la file des sessions avec touches, les sessions automatiques ne rouvriront pas cette conversation.");
        try {
          await sdr.recordSocialDmAutoHeld({ outreachId: item.outreachId, network: session.network, reason: result.why ?? "thread_not_empty", sessionId: session.sessionId });
        } catch (error) {
          result = await stopOnError(ctx, error);
        }
      }
    } else if (result.outcome === "sent" || result.outcome === "skipped") {
      threadRefusalsInARow = 0;
    }

    if (result.outcome === "sent") {
      stats.sent += 1;
      if (!result.verified) stats.unverified += 1;
      ui.ok(`Envoyé à ${stripControlChars(item.companyName)}.`);
    } else if (result.outcome === "skipped") {
      stats.skipped += 1;
    } else if (result.outcome === "unavailable") {
      stats.unavailable += 1;
    } else if (result.outcome === "refused") {
      stats.refused += 1;
    } else if (result.outcome === "held") {
      stats.held = (stats.held ?? 0) + 1;
    }

    // Nobody may be watching: a message that left without showing up in the
    // thread means the page is not what the session thinks it is. It is
    // recorded "to check" and nothing else is sent.
    if (ctx.auto && result.outcome === "sent" && !result.verified) {
      ui.error("Envoi non confirmé à l'écran : la session automatique s'arrête. Regarde la conversation dans le navigateur avant de relancer.");
      stoppedReason = STOP.AUTO_UNVERIFIED;
      break;
    }

    if (result.outcome === "stopped") {
      stoppedReason = result.reason;
      if (result.sent) {
        stats.sent += 1;
        if (!result.verified) stats.unverified += 1;
      }
      // On a blocker the page is left exactly as it is: no clicks, no retries.
      if (result.blocker) await reportBlocked(ctx, result.blocker);
      break;
    }
    await driver.closeConversation(page).catch(() => undefined);
  }
  return { ...stats, stoppedReason };
}
