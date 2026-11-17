/**
 * A rehearsal of a send session, on the real account: the start checks, then
 * for each queued prospect the contact gate, the prospect's page, the
 * "Message" button and the chat composer — and nothing else.
 *
 * It types nothing, sends nothing and records nothing in the SDR: no session
 * record, no quota, no lock, no "skipped" mark. It exists so the whole path
 * can be checked before the first real session (or after Meta changes its
 * pages) without a message leaving, and without a terminal: it asks for no
 * key, so it can run from a script.
 *
 * It stops at the first Meta blocker (login wall, checkpoint, "action
 * blocked"), exactly like a real session, and never works around it.
 */
import { clearComposer, normaliseForCompare, readComposer, typeAndVerify } from "./composer.mjs";

const NETWORK_LABELS = { instagram: "Instagram", facebook: "Facebook" };

/** Default number of prospects a rehearsal visits; it is a check, not a crawl. */
export const REHEARSAL_DEFAULT = 3;
export const REHEARSAL_MAX = 10;

/** Pause between two prospects' pages. Fixed: the runner never imitates a person's rhythm. */
const PAUSE_MS = 6_000;

const defaultWait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Start checks without the operator's confirmation key: nothing will be
 * sent, so the account is reported, not confirmed.
 * @returns {Promise<{ ok: true, identity?: string } | { ok: false, reason: string, blocker?: object }>}
 */
export async function rehearseStart(ctx, { network }) {
  const { page, driver, ui } = ctx;
  const label = NETWORK_LABELS[network] ?? network;
  const home = await driver.openHome(page);
  if (!home.ok) {
    ui.error(`${label} bloque l'accès dès l'accueil (${home.reason.kind}) : rien d'autre n'est tenté.`);
    return { ok: false, reason: `blocked:${home.reason.kind}`, blocker: home.reason };
  }
  if (!(await driver.isLoggedIn(page))) {
    ui.error(`La fenêtre n'est pas connectée à ${label} : lance « npm run social:login ».`);
    return { ok: false, reason: "not_logged_in" };
  }
  const identity = await driver.activeIdentity(page).catch(() => undefined);
  ui.info(identity ? `Compte connecté : ${identity}.` : "Compte connecté (nom non lu dans la page).");
  return { ok: true, identity };
}

/**
 * @param {{ items: Array<{ outreachId: string, profile: { url: string, handle: string }, body?: string, companyName?: string }>, max?: number, wait?: (ms: number) => Promise<void> }} options
 * @returns {Promise<{ results: Array<{ outreachId: string, outcome: "ready" | "refused" | "unavailable" | "blocked", reason?: string, composerEmpty?: boolean }>, stoppedReason?: string }>}
 */
export async function runRehearsal(ctx, { items, max = REHEARSAL_DEFAULT, wait = defaultWait }) {
  const { sdr, driver, page, ui, session } = ctx;
  const limit = Math.min(Math.max(1, max), REHEARSAL_MAX);
  const chosen = items.slice(0, limit);
  const results = [];

  for (const [index, item] of chosen.entries()) {
    if (index > 0) await wait(PAUSE_MS);
    ui.info(`\n${index + 1}/${chosen.length} — ${item.companyName ?? item.outreachId} — ${item.profile.url}`);

    const gate = await sdr.checkBeforeSend({ outreachId: item.outreachId, network: session.network });
    if (!gate.allowed) {
      ui.info(`Contrôle de contact : refusé (${gate.reason ?? "refused"}). Une vraie session passerait ce prospect.`);
      results.push({ outreachId: item.outreachId, outcome: "refused", reason: gate.reason ?? "refused" });
      continue;
    }

    const body = [gate.body, gate.generatedBody, item.body].find((value) => typeof value === "string" && value.trim());
    if (body) {
      ui.info("Message qui serait tapé :");
      for (const line of String(body).trim().split("\n")) ui.info(`  │ ${line}`);
    }
    const review = gate.review;
    if (review && review.pricingGuardrailPassed === false) {
      ui.warn("Ce brouillon demanderait la touche de confirmation séparée (contrôle des conditions non validé).");
    }

    const opened = await driver.openConversation(page, item.profile);
    if (!opened.ok) {
      if (typeof opened.reason === "object") {
        ui.error(`Blocage ${NETWORK_LABELS[session.network] ?? session.network} sur ce prospect (${opened.reason.kind}) : arrêt, comme en vraie session.`);
        results.push({ outreachId: item.outreachId, outcome: "blocked", reason: opened.reason.kind });
        return { results, stoppedReason: `blocked:${opened.reason.kind}` };
      }
      ui.warn(`Conversation impossible à ouvrir : ${opened.reason}. Une vraie session mettrait ce brouillon de côté.`);
      results.push({ outreachId: item.outreachId, outcome: "unavailable", reason: opened.reason });
      continue;
    }

    // Read only: the composer must be there and empty; nothing is typed.
    const current = await readComposer(opened.composer).catch(() => "");
    const composerEmpty = normaliseForCompare(current) === "";
    ui.ok(
      composerEmpty
        ? "Conversation ouverte, champ de message trouvé et vide : une vraie session taperait le message ici."
        : "Conversation ouverte, mais le champ de message contient déjà du texte : une vraie session le signalerait."
    );
    // What an automatic session would check before typing: is the conversation new?
    let thread;
    if (typeof driver.threadState === "function") {
      thread = await driver.threadState(page, opened.composer, item.profile, { typed: false }).catch(() => ({ state: "unknown", why: "check_failed" }));
      if (thread.state === "empty") ui.info("Conversation vierge : une session automatique pourrait y envoyer ce premier message.");
      else {
        ui.warn(`Conversation déjà entamée ou non vérifiable (${thread.why ?? thread.state}) : une session automatique la laisserait de côté.`);
        if (thread.unexpected?.length) ui.info(`Lignes inattendues dans la fenêtre de discussion : ${thread.unexpected.map((line) => `« ${line} »`).join(", ")}`);
      }
    }
    results.push({ outreachId: item.outreachId, outcome: "ready", composerEmpty, ...(thread ? { thread: thread.state } : {}) });
    await driver.closeConversation?.(page);

    const after = await driver.checkBlocker(page);
    if (after) {
      ui.error(`Blocage détecté après la visite (${after.kind}) : arrêt.`);
      return { results, stoppedReason: `blocked:${after.kind}` };
    }
  }
  return { results };
}

/** A profile link for a handle the operator names (their own or a colleague's account). */
export function profileForHandle(network, handle) {
  const clean = String(handle ?? "").trim().replace(/^@/, "");
  return network === "facebook"
    ? { url: `https://www.facebook.com/${clean}`, handle: clean.toLowerCase() }
    : { url: `https://www.instagram.com/${clean}/`, handle: clean.toLowerCase() };
}

/**
 * The typing check, on an account the operator names as safe (their own
 * business account, a colleague): opens that chat, types a real DM exactly as
 * a session does (lines, Shift+Enter between them), reads the composer back,
 * then clears it and closes the chat. It never presses Enter. If the network
 * ever sent on Shift+Enter, the safe account — not a prospect — would get it,
 * and the read-back would show the mismatch.
 * @returns {Promise<{ outcome: "typed" | "mismatch" | "unavailable" | "blocked", reason?: string, actual?: string, cleared?: boolean }>}
 */
export async function rehearseTyping(ctx, { handle, text }) {
  const { driver, page, ui, session } = ctx;
  const profile = profileForHandle(session.network, handle);
  ui.info(`\nTest de frappe dans la conversation avec ${profile.url} (compte sûr) — aucune touche Entrée.`);
  const opened = await driver.openConversation(page, profile);
  if (!opened.ok) {
    if (typeof opened.reason === "object") {
      ui.error(`Blocage (${opened.reason.kind}) : arrêt.`);
      return { outcome: "blocked", reason: opened.reason.kind };
    }
    ui.warn(`Conversation impossible à ouvrir : ${opened.reason}.`);
    return { outcome: "unavailable", reason: opened.reason };
  }
  const matched = await typeAndVerify(page, opened.composer, text);
  const actual = await readComposer(opened.composer);
  if (matched) {
    ui.ok("Le champ contient exactement le message prévu (lignes et sauts de ligne compris).");
  } else {
    ui.error("Le champ ne contient PAS le message prévu : une vraie session refuserait d'envoyer.");
    ui.info("Lu dans le champ :");
    for (const line of String(actual).split("\n")) ui.info(`  │ ${line}`);
  }
  const cleared = await clearComposer(page, opened.composer);
  ui.info(cleared ? "Champ effacé." : "Le champ n'a pas pu être effacé : vide-le à la main dans la fenêtre.");
  await driver.closeConversation?.(page);
  return { outcome: matched ? "typed" : "mismatch", actual, cleared };
}
