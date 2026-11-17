/**
 * Chooses how a business's first direct message is built.
 *
 * Why: a first DM that states the offer and its price reads as canvassing.
 * A business may instead open a conversation (ADR-025,
 * social-dm-conversation.ts): one true thing about the prospect, the
 * business's own introduction — who writes and what the business does,
 * inserted word for word — and one question; no commercial term. The offer's
 * terms then come in the reply to someone who answered.
 *
 * The introduction is refused here, before anything is written, if the
 * generator would refuse it (empty, several lines, too long, or stating a
 * commercial term): a business must not believe it runs the conversation
 * style while its drafts silently fall back to the terms line.
 *
 * --observe lists, in order of preference, what code may state about the
 * prospect before the introduction when verified evidence says it plainly
 * (social/dm-observations.ts): no_site, slow_site, not_mobile_site,
 * outdated_site, no_online_booking. At most one per message. Without it the
 * message says nothing of the prospect's online presence — the model is kept
 * off that subject in this style.
 *
 *   node functions/scripts/set-social-dm-opening.mjs --business biz_bloomy --intro "Je suis …, cofondateur de … : on crée …"            # plan (read-only)
 *   node functions/scripts/set-social-dm-opening.mjs --business biz_bloomy --intro "Je suis …, cofondateur de … : on crée …" --write    # apply
 *   node functions/scripts/set-social-dm-opening.mjs --business biz_bloomy --off --write                                                 # back to the offer's terms line
 *   options: --workspace ws_default   --observe no_site,slow_site,not_mobile_site,outdated_site
 *
 * Only `socialDmOpening` (and `updatedAt`) is written on the business
 * document. Existing drafts are not rewritten: run
 * `backfill-social-dm-drafts.mjs --redraft` for that.
 *
 * Requires `npm run --prefix functions build`. Pinned to devcomm-os: this
 * machine's default Google project is the production CRM.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ID = "devcomm-os";
for (const key of ["GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT", "FIREBASE_PROJECT_ID"]) {
  if (process.env[key] && process.env[key] !== PROJECT_ID) {
    console.error(`${key}=${process.env[key]} — refusing: this script only runs against ${PROJECT_ID}.`);
    process.exit(1);
  }
}
if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("FIRESTORE_EMULATOR_HOST is set — refusing.");
  process.exit(1);
}
process.env.GOOGLE_CLOUD_PROJECT = process.env.GCLOUD_PROJECT = PROJECT_ID;

const FUNCTIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fnRequire = createRequire(path.join(FUNCTIONS_DIR, "package.json"));
const { initializeApp, applicationDefault, getApps } = fnRequire("firebase-admin/app");
if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const { adminDb, adminApp } = fnRequire("./lib/config/firebase.js");
if (adminApp.options.projectId !== PROJECT_ID) {
  console.error("functions/lib is bound to another project — refusing.");
  process.exit(1);
}
const { FieldValue, Timestamp } = fnRequire("firebase-admin/firestore");
const { approvedIntroLine } = fnRequire("./lib/services/social-dm-conversation.js");
const { OBSERVATION_KINDS, observationKinds } = fnRequire("./lib/services/social/dm-observations.js");

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : fallback;
};
const BUSINESS_ID = arg("--business");
const WORKSPACE_ID = arg("--workspace", "ws_default");
const INTRO = arg("--intro");
const OBSERVE = arg("--observe");
const OFF = process.argv.includes("--off");
const WRITE = process.argv.includes("--write");
if (!BUSINESS_ID || (!OFF && !INTRO) || (OFF && INTRO)) {
  console.error('--business <id> and either --intro "<the sentence>" or --off are required.');
  process.exit(1);
}

const ref = adminDb.doc(`workspaces/${WORKSPACE_ID}/businesses/${BUSINESS_ID}`);
const snapshot = await ref.get();
if (!snapshot.exists) {
  console.error(`Business ${BUSINESS_ID} not found in ${WORKSPACE_ID}.`);
  process.exit(1);
}
const current = snapshot.data().socialDmOpening;
console.log(`Business: ${snapshot.data().name} (${BUSINESS_ID})`);
console.log(`Now: ${current ? JSON.stringify(current) : "the offer's terms line (no socialDmOpening)"}`);

if (OFF) {
  console.log(`Then: the offer's terms line — ${WRITE ? "WRITING" : "plan only"}`);
  if (WRITE) await ref.update({ socialDmOpening: FieldValue.delete(), updatedAt: Timestamp.now() });
} else {
  const asked = OBSERVE ? OBSERVE.split(",").map((kind) => kind.trim()).filter(Boolean) : [];
  const observations = observationKinds(asked);
  if (observations.length !== new Set(asked).size) {
    console.error(`Refused, nothing written. --observe takes only: ${OBSERVATION_KINDS.join(", ")}.`);
    process.exit(1);
  }
  const opening = { style: "conversation", introLine: INTRO.trim(), ...(observations.length ? { observations } : {}) };
  const verdict = approvedIntroLine(opening);
  if (!verdict.line) {
    console.error(`Refused, nothing written. ${verdict.problem}`);
    process.exit(1);
  }
  console.log(`Then: ${JSON.stringify(opening)} — ${WRITE ? "WRITING" : "plan only"}`);
  if (WRITE) await ref.update({ socialDmOpening: opening, updatedAt: Timestamp.now() });
}
if (!WRITE) console.log("Plan only — nothing written. Re-run with --write to apply.");
process.exit(0);
