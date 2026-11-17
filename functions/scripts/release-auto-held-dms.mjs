/**
 * Gives back to automatic sessions the DM drafts one of them left to a person
 * for a reason that turned out to be the check's own mistake.
 *
 * Why: an automatic session only writes a first message into a conversation
 * it can prove new, and marks any other draft `autoHeldAt` so no later
 * automatic session opens that profile again (ADR-024). When the check itself
 * was wrong — on 2026-11-11 it did not know the "Send" button Instagram shows
 * once a text is typed — the mark is wrong too, and it never clears by itself.
 *
 * Only drafts (status "draft") of one business whose recorded reason is
 * EXACTLY the one given are released: a conversation that really was started
 * has another reason and keeps its mark. Only the four `autoHeld*` fields are
 * removed; nothing else is changed, nothing is deleted.
 *
 *   node functions/scripts/release-auto-held-dms.mjs --business biz_bloomy --reason "thread_not_empty:text:Send"            # plan (read-only)
 *   node functions/scripts/release-auto-held-dms.mjs --business biz_bloomy --reason "thread_not_empty:text:Send" --write    # apply
 *   options: --workspace ws_default
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

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : fallback;
};
const BUSINESS_ID = arg("--business");
const WORKSPACE_ID = arg("--workspace", "ws_default");
const REASON = arg("--reason");
const WRITE = process.argv.includes("--write");
if (!BUSINESS_ID || !REASON) {
  console.error('--business <id> and --reason "<the exact recorded reason>" are required.');
  process.exit(1);
}

const drafts = await adminDb
  .collection("outreach")
  .where("workspaceId", "==", WORKSPACE_ID)
  .where("businessId", "==", BUSINESS_ID)
  .where("channel", "==", "social_dm")
  .where("status", "==", "draft")
  .get();
const held = drafts.docs.filter((doc) => doc.data().autoHeldAt);
const matching = held.filter((doc) => doc.data().autoHeldReason === REASON);

console.log(`Business ${BUSINESS_ID}: ${held.length} draft(s) left to a person, ${matching.length} with the reason "${REASON}" — ${WRITE ? "WRITING" : "plan only"}`);
for (const doc of held) {
  const data = doc.data();
  const company = (await adminDb.collection("companies").doc(String(data.companyId)).get()).data() ?? {};
  const release = data.autoHeldReason === REASON;
  console.log(`  ${release ? "RELEASE" : "KEEP   "} ${String(company.name ?? data.companyId)} — ${data.autoHeldReason}`);
  if (release && WRITE) {
    await doc.ref.update({
      autoHeldAt: FieldValue.delete(),
      autoHeldReason: FieldValue.delete(),
      autoHeldNetwork: FieldValue.delete(),
      autoHeldInSessionId: FieldValue.delete(),
      updatedAt: Timestamp.now()
    });
  }
}
console.log(`\n${matching.length} ${WRITE ? "released" : "to release"}, ${held.length - matching.length} kept.`);
if (!WRITE) console.log("Plan only — nothing written. Re-run with --write to apply.");
process.exit(0);
