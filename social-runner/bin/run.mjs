#!/usr/bin/env node
/**
 * The social runner's command line: login | send | inbox.
 *
 *   npm run social:login -- --business biz_x --network instagram
 *   npm run social:send  -- --business biz_x --network instagram --max 20
 *   npm run social:send  -- --business biz_x --network instagram --auto   (automatic session, ADR-024)
 *   npm run social:inbox -- --business biz_x --network facebook
 *   npm run social:rehearse -- --business biz_x --network instagram   (no key, no typing, no send)
 *
 * Runs on the owner's Mac, in a terminal, with a visible browser. A message
 * leaves on the operator's Enter for that message, or — in a send session the
 * operator started with --auto — at the end of that message's countdown
 * (session-machine.mjs). Replies always wait for Enter.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ArgError, USAGE, parseArgs } from "../src/args.mjs";
import { createSocialChannelDriver } from "../src/drivers/social-channel-driver.mjs";
import { displayIdentity, expectedAccount } from "../src/identity.mjs";
import { newInboxStats, runInboxSession } from "../src/inbox-flow.mjs";
import { createKeyHub } from "../src/keys.mjs";
import { createSendJournal, replayPendingSends } from "../src/send-journal.mjs";
import { prepareSession } from "../src/session-start.mjs";
import { errorSummary, newSendStats, reportBlocked, runSendSession } from "../src/session-machine.mjs";
import { REHEARSAL_DEFAULT, rehearseStart, rehearseTyping, runRehearsal } from "../src/rehearsal.mjs";
import { createUi } from "../src/ui.mjs";

/**
 * Everything a session shows is also written, line by line, to a file under
 * social-runner/.state/logs/ (git-ignored, like the pending-send journal):
 * what happened can be read afterwards — or while it runs — without copying
 * the terminal. It holds draft texts and prospects' names: it stays on this Mac.
 */
let sessionLog = null;
const ui = createUi({ log: (line) => sessionLog?.(line) });
const NETWORK_LABELS = { instagram: "Instagram", facebook: "Facebook" };
const LOG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".state", "logs");

function openSessionLog() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(LOG_DIR, `${stamp}-${args.command}-${args.network}${args.auto ? "-auto" : ""}.log`);
    const write = (line) => fs.appendFileSync(file, `${line}\n`);
    write(`# ${new Date().toISOString()} ${args.command} --business ${args.businessId} --network ${args.network}${args.auto ? ` --auto (veto ${args.auto.vetoSeconds} s)` : ""}${args.max ? ` --max ${args.max}` : ""}`);
    sessionLog = write;
    return file;
  } catch {
    // No log is no reason not to run.
    return null;
  }
}

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof ArgError)) throw error;
  ui.error(error.message);
  process.stdout.write(`\n${USAGE}\n`);
  process.exit(2);
}
if (args.help) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

const label = NETWORK_LABELS[args.network];
/** Who pressed the keys, as recorded on sends: the local macOS account. */
const operator = os.userInfo().username;

/** What shutdown needs, filled in as the run progresses. */
const run = {
  keys: null,
  browser: null,
  sdr: null,
  business: null,
  journal: null,
  /** Ids a previous session may have sent without recording (pending-send journal). */
  journaled: { outreachIds: new Set(), conversationIds: new Set() },
  sessionId: null,
  sendStats: newSendStats(),
  inboxStats: newInboxStats(),
  stoppedReason: undefined,
  exiting: false
};

/**
 * Opens the browser on the network's home page and runs the start checks
 * (session-start.mjs). False when the session must not go on.
 */
async function startInBrowser(driver) {
  let page;
  try {
    page = await launchBrowser();
  } catch (error) {
    // Nothing was opened, so nothing can have gone wrong on the network: not
    // an ending a person has to look into before the next automatic session.
    run.stoppedReason = "browser_not_started";
    throw error;
  }
  const ctx = sessionContext(driver, page);
  const ready = await prepareSession(ctx, {
    network: args.network,
    businessName: run.business.name,
    expected: expectedAccount(run.business.socialAccounts, args.network)
  });
  if (!ready.ok) {
    run.stoppedReason = ready.reason;
    if (ready.blocker) await reportBlocked(ctx, ready.blocker);
    return null;
  }
  return ctx;
}

/**
 * Ends the session record, then closes the browser (cleanly, so the profile
 * keeps its cookies), then exits: firebase-admin's connection would otherwise
 * keep the process alive.
 */
async function shutdown(code) {
  if (run.exiting) return;
  run.exiting = true;
  run.keys?.close();
  try {
    sessionLog?.(`# FIN ${new Date().toISOString()} code=${code}${run.stoppedReason ? ` arrêt=${run.stoppedReason}` : ""}`);
  } catch {
    // Ignored on purpose.
  }
  if (run.sessionId && run.sdr) {
    const send = run.sendStats;
    try {
      await run.sdr.endSocialSession({
        sessionId: run.sessionId,
        sent: send.sent,
        skipped: send.skipped + send.unavailable + send.refused + run.inboxStats.skipped,
        replies: run.inboxStats.replies,
        stoppedReason: run.stoppedReason
      });
    } catch (error) {
      ui.warn(`Fin de session non enregistrée dans le SDR : ${errorSummary(error)}`);
    }
  }
  await run.browser?.close();
  process.exit(code);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    run.stoppedReason ??= "interrupted";
    void shutdown(130);
  });
}

async function launchBrowser() {
  let openBrowser;
  try {
    ({ openBrowser } = await import("../src/browser.mjs"));
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") {
      throw new Error("playwright-core n'est pas installé : lance « npm run social:install ».");
    }
    throw error;
  }
  run.browser = await openBrowser({ businessId: args.businessId, channel: args.channel });
  return run.browser.page;
}

function sessionContext(driver, page) {
  return {
    page,
    driver,
    keys: run.keys,
    ui,
    sdr: run.sdr,
    journal: run.journal,
    // Only a send session can be automatic; the inbox never reads this.
    ...(args.command === "send" && args.auto ? { auto: args.auto } : {}),
    session: {
      sessionId: run.sessionId,
      workspaceId: args.workspaceId,
      businessId: args.businessId,
      network: args.network,
      operator
    }
  };
}

async function login(driver) {
  const page = await launchBrowser();
  ui.title(`Connexion ${label}`);
  ui.info(`Profil local : ${run.browser.profileDir}`);
  ui.info("Ce dossier contient la session du compte : ne le copie pas, ne le partage pas.");
  await page.goto(driver.homeUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
  ui.info(`Connecte-toi dans la fenêtre avec le compte ${label} de l'entreprise (double authentification comprise).`);
  if (args.network === "facebook") {
    ui.info("Puis bascule sur le profil de la Page : les messages partiront en son nom.");
  }
  ui.info("Le runner ne tape rien pendant cette étape.");
  for (;;) {
    ui.info("Entrée quand c'est fait, Q pour quitter.");
    const key = await run.keys.prompt(["enter", "q"]);
    if (key !== "enter") return 0;
    if (await driver.isLoggedIn(page)) {
      const identity = await driver.activeIdentity(page).catch(() => undefined);
      ui.ok(
        identity
          ? `Connecté en tant que ${displayIdentity(args.network, identity)}. La session reste dans le profil local ; lance send ou inbox quand tu veux.`
          : "Connecté. La session reste dans le profil local ; lance send ou inbox quand tu veux."
      );
      ui.info("send et inbox vérifient le compte au démarrage (réglages de l'entreprise) et te demandent de le confirmer.");
      return 0;
    }
    ui.warn("Je ne vois pas encore de session connectée. Termine dans la fenêtre, puis Entrée.");
  }
}

/** Why the SDR refuses an automatic session, in the operator's words. */
function autoRefusal(verdict) {
  if (verdict.reason === "automation_paused") {
    return "Le SDR est en pause (réglages de l'application) : pas d'envoi automatique. Retire la pause, ou relance sans --auto pour envoyer toi-même.";
  }
  if (verdict.reason === "test_mode_enabled") return "Le mode test est actif : aucun premier DM ne part.";
  if (verdict.reason === "doubt_stop_unreviewed") {
    return "La dernière session automatique s'est arrêtée sur un doute (envoi non confirmé, texte mal saisi, conversation à vérifier, erreur ou arrêt brutal). Regarde la conversation concernée, puis lance une session normale (sans --auto), envoie ou passe au moins un message et termine-la avec Q : elle remet l'automatique en service.";
  }
  if (verdict.reason === "blocked_recently") {
    const until = verdict.retryAt ? new Date(verdict.retryAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "48 h";
    return `${label} a arrêté une session récemment : pas d'envoi automatique avant le ${until}. Relance sans --auto si tu veux regarder toi-même.`;
  }
  return `Envoi automatique refusé par le SDR (${verdict.reason ?? "refusé"}).`;
}

async function send(driver) {
  const { sdr } = run;
  const { workspaceId, businessId, network, auto } = args;
  if (auto) {
    // An automatic session only writes into a conversation it can prove is
    // new; a network whose empty chat window is not described cannot run one.
    if (typeof driver.threadState !== "function") {
      ui.error(`Pas de session automatique sur ${label} pour l'instant : le runner ne sait pas y vérifier qu'une conversation est vierge. Relance sans --auto.`);
      return 1;
    }
    const allowed = await sdr.checkAutoSend({ workspaceId, businessId, network });
    if (!allowed.allowed) {
      ui.error(autoRefusal(allowed));
      return 1;
    }
  }
  const limits = await sdr.getSocialLimits(workspaceId, businessId, network);
  const used = (await sdr.getSocialDmUsage(workspaceId, businessId, network)) ?? 0;
  const remaining = Math.max(0, limits.dailyCap - used);
  ui.info(`Aujourd'hui : ${used}/${limits.dailyCap} DM ${label}, au moins ${limits.minSpacingSeconds} s entre deux envois.`);
  if (!remaining) {
    ui.warn("Plafond du jour atteint : reprise demain.");
    return 0;
  }

  const max = Math.min(args.max ?? remaining, remaining);
  // An automatic session leaves drafts a person must read in the queue: it
  // lists far enough past them to find the ones it may send.
  const listed = await sdr.listSocialDmQueue({ workspaceId, businessId, network, limit: auto ? 100 : Math.min(100, max * 2) });
  // A draft a previous session may already have sent is never offered again here.
  const items = listed.filter((item) => !run.journaled.outreachIds.has(item.outreachId));
  if (items.length < listed.length) {
    ui.warn(`${listed.length - items.length} DM tenu(s) hors de la file : un envoi précédent n'est peut-être pas enregistré.`);
  }
  if (!items.length) {
    ui.info(`Aucun DM ${label} à envoyer (brouillon prêt, profil ${label} connu, prospect jamais contacté).`);
    return 0;
  }
  ui.info(`${items.length} DM en file, ${max} au maximum dans cette session.`);
  if (auto) {
    ui.warn(`SESSION AUTOMATIQUE : chaque message part ${auto.vetoSeconds} s après son affichage, sans touche.`);
    ui.info("S = passer le prospect affiché, Q ou Ctrl+C = arrêter. La session s'arrête seule au moindre blocage ou envoi non confirmé.");
    ui.info("Ne partent que les DM que le SDR autorise sans relecture, dans une conversation vierge. Les autres restent dans la file pour une session avec touches.");
  } else {
    ui.info("Pour chaque prospect, le runner ouvre la conversation et tape le message. Rien ne part sans ta touche Entrée.");
  }

  ({ sessionId: run.sessionId } = await sdr.startSocialSession({ workspaceId, businessId, network, mode: "send", operator, ...(auto ? { auto: true } : {}) }));
  const ctx = await startInBrowser(driver);
  if (!ctx) return 1;
  const result = await runSendSession(ctx, { items, max, stats: run.sendStats, excludeOutreachIds: run.journaled.outreachIds });
  run.stoppedReason = result.stoppedReason;

  ui.summary([
    `${result.sent} envoyé(s)${result.unverified ? `, dont ${result.unverified} à vérifier dans la conversation` : ""}`,
    `${result.skipped} passé(s), ${result.unavailable} sans conversation possible, ${result.refused} bloqué(s) par le contrôle de contact`,
    ...(result.held ? [`${result.held} laissé(s) dans la file : à relire et envoyer dans une session avec touches (sans --auto)`] : []),
    ...(result.stoppedReason ? [`Arrêt : ${result.stoppedReason}`] : [])
  ]);
  return 0;
}

/**
 * A rehearsal (rehearsal.mjs): the first prospects of the queue, opened on
 * the real account, with nothing typed, sent or recorded. Asks for no key.
 */
async function rehearse(driver) {
  const { sdr } = run;
  const { workspaceId, businessId, network } = args;
  const listed = await sdr.listSocialDmQueue({ workspaceId, businessId, network, limit: 20 });
  if (!listed.length) {
    ui.info(`Aucun DM ${label} en file (brouillon prêt, profil ${label} connu, prospect jamais contacté).`);
    return 0;
  }
  const max = Math.min(args.max ?? REHEARSAL_DEFAULT, listed.length);
  ui.info(`${listed.length} DM en file. Répétition sur ${max} prospect(s) : rien n'est tapé, rien n'est envoyé, rien n'est enregistré dans le SDR.`);
  const page = await launchBrowser();
  const ctx = sessionContext(driver, page);
  const start = await rehearseStart(ctx, { network });
  if (!start.ok) {
    run.stoppedReason = start.reason;
    return 1;
  }
  if (args.typeTo) {
    // The typing check: one real DM text, typed into a safe account's chat.
    const typed = await rehearseTyping(ctx, { handle: args.typeTo, text: listed[0].body });
    ui.summary([
      typed.outcome === "typed"
        ? "Frappe conforme : une vraie session taperait exactement ce message."
        : `Frappe : ${typed.outcome}${typed.reason ? ` (${typed.reason})` : ""} — ne lance pas de vraie session avant correction.`
    ]);
    return typed.outcome === "typed" ? 0 : 1;
  }
  const { results, stoppedReason } = await runRehearsal(ctx, { items: listed, max });
  const count = (outcome) => results.filter((result) => result.outcome === outcome).length;
  ui.summary([
    `${count("ready")} conversation(s) prête(s) à recevoir le message`,
    `${count("unavailable")} sans conversation possible, ${count("refused")} refusé(s) par le contrôle de contact`,
    ...(stoppedReason
      ? [`Arrêt : ${stoppedReason}`]
      : count("ready")
        ? ["Aucun blocage : une vraie session peut partir."]
        : ["Aucune conversation n'a pu s'ouvrir : ne lance pas de vraie session avant d'avoir compris pourquoi."])
  ]);
  return stoppedReason ? 1 : 0;
}

async function inbox(driver) {
  const { sdr } = run;
  const provider = await sdr.assertRealAi();
  ui.info(`IA : ${provider.name} (${provider.model}).`);

  ({ sessionId: run.sessionId } = await sdr.startSocialSession({
    workspaceId: args.workspaceId,
    businessId: args.businessId,
    network: args.network,
    mode: "inbox",
    operator
  }));
  const ctx = await startInBrowser(driver);
  if (!ctx) return 1;
  const result = await runInboxSession(ctx, { stats: run.inboxStats, excludeConversationIds: run.journaled.conversationIds });
  run.stoppedReason = result.stoppedReason;

  ui.summary([
    `${result.conversations} conversation(s) suivie(s), ${result.matched} trouvée(s) dans la boîte, ${result.opened} ouverte(s)`,
    `${result.newMessages} nouveau(x) message(s) : ${result.drafts} proposition(s), ${result.escalated} à traiter par toi, ${result.unsubscribed} désinscription(s), ${result.ignored} réponse(s) automatique(s)`,
    ...(result.notOnPage ? [`${result.notOnPage} message(s) lu(s) par l'IA mais introuvable(s) sur la page : écarté(s), à lire toi-même dans le fil`] : []),
    `${result.pending} réponse(s) en attente reproposée(s)${result.failed ? `, ${result.failed} fil(s) non traité(s) (IA ou SDR indisponible, repris au prochain passage)` : ""}`,
    `${result.replies} réponse(s) envoyée(s)${result.unverified ? `, dont ${result.unverified} à vérifier` : ""}, ${result.skipped} passée(s)`,
    ...(result.stoppedReason ? [`Arrêt : ${result.stoppedReason}`] : [])
  ]);
  return 0;
}

async function main() {
  // A rehearsal asks for no key, so it runs without a terminal (from a script).
  if (args.command !== "rehearse") run.keys = createKeyHub({
    onInterrupt: () => ui.warn("Arrêt demandé : fin à la prochaine étape (Ctrl+C encore pour forcer)."),
    onForceQuit: () => {
      run.stoppedReason ??= "interrupted";
      ui.warn("Arrêt forcé.");
      void shutdown(130);
    }
  });
  const driver = createSocialChannelDriver(args.network);
  if (args.command === "login") return login(driver);

  ui.info("Connexion au SDR (projet devcomm-os)…");
  run.sdr = await import("../src/sdr.mjs");
  const business = await run.sdr.describeBusiness(args.workspaceId, args.businessId);
  if (!business) {
    ui.error(`Entreprise ${args.businessId} introuvable dans ${args.workspaceId}.`);
    return 1;
  }
  run.business = business;
  const logFile = openSessionLog();
  ui.title(
    `${business.name} — ${label} — ${args.command === "send" ? "premiers DM" : args.command === "rehearse" ? "répétition (aucun envoi)" : "boîte de réception"}`
  );
  if (logFile) ui.info(`Journal de cette session : ${logFile}`);
  // Nothing is recorded during a rehearsal, not even replayed journal entries.
  if (args.command === "rehearse") return rehearse(driver);

  // Sends a previous session made but could not record: recorded now as
  // unverified (never sent again), and kept out of this session.
  run.journal = createSendJournal();
  const replay = await replayPendingSends({ journal: run.journal, sdr: run.sdr, ui });
  run.journaled = { outreachIds: replay.outreachIds, conversationIds: replay.conversationIds };
  return args.command === "send" ? send(driver) : inbox(driver);
}

main().then(
  (code) => shutdown(code),
  (error) => {
    run.stoppedReason ??= "error";
    ui.error(errorSummary(error));
    return shutdown(1);
  }
);
