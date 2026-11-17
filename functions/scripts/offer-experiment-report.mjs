/**
 * Prints how each offer of a business's offer experiment (A/B test) is doing:
 * per variant, how many prospects were assigned it, drafted, sent, replied,
 * answered positively and booked a meeting — and the reply and positive rates
 * over sent.
 *
 * Read-only. Equality queries only (workspaceId + businessId), with field
 * projections so the large outreach documents are not downloaded whole.
 * The counting is `summarizeExperiment` (functions/src/services/offer-experiment.ts).
 *
 *   node functions/scripts/offer-experiment-report.mjs --business biz_bloomy
 *   options: --experiment <id> (default: the business's current one)   --workspace ws_default
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
const { summarizeExperiment } = fnRequire("./lib/services/offer-experiment.js");

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : fallback;
};
const BUSINESS_ID = arg("--business");
const WORKSPACE_ID = arg("--workspace", "ws_default");
if (!BUSINESS_ID) {
  console.error("--business <id> is required.");
  process.exit(1);
}

const base = `workspaces/${WORKSPACE_ID}/businesses/${BUSINESS_ID}`;
const businessSnap = await adminDb.doc(base).get();
if (!businessSnap.exists) {
  console.error(`Business ${BUSINESS_ID} not found in ${WORKSPACE_ID}.`);
  process.exit(1);
}
const business = businessSnap.data();
const current = business.offerExperiment;
const EXPERIMENT_ID = arg("--experiment", current?.id);
if (!EXPERIMENT_ID) {
  console.error(`Business ${BUSINESS_ID} has no offer experiment (business.offerExperiment). Pass --experiment <id> for a past one.`);
  process.exit(1);
}

const scoped = (collection, fields) =>
  adminDb
    .collection(collection)
    .where("workspaceId", "==", WORKSPACE_ID)
    .where("businessId", "==", BUSINESS_ID)
    .select(...fields)
    .get();

const [offersSnap, companiesSnap, outreachSnap, conversationsSnap, meetingsSnap] = await Promise.all([
  adminDb.collection(`${base}/offers`).get(),
  scoped("companies", ["offerAssignment"]),
  scoped("outreach", ["companyId", "offerId", "status", "channel"]),
  scoped("conversations", ["companyId", "latestIntent", "status"]),
  scoped("meetings", ["companyId", "status"])
]);

const allOffers = offersSnap.docs.map((doc) => ({ id: doc.id, name: doc.data().name }));
// The current experiment's variants in its order (control first). A past
// experiment's order is not stored any more: every offer is listed, and any
// assigned offer that no longer exists still gets its own row.
const order = current?.id === EXPERIMENT_ID && Array.isArray(current.offerIds) ? current.offerIds : [];
const offers = order.length
  ? order.map((id) => allOffers.find((offer) => offer.id === id) ?? { id, name: "(offre supprimée)" })
  : allOffers;

const rows = summarizeExperiment({
  experimentId: EXPERIMENT_ID,
  offers,
  companies: companiesSnap.docs.map((doc) => ({ id: doc.id, offerAssignment: doc.data().offerAssignment })),
  outreach: outreachSnap.docs.map((doc) => doc.data()),
  conversations: conversationsSnap.docs.map((doc) => doc.data()),
  meetings: meetingsSnap.docs.map((doc) => doc.data())
});

const started = current?.id === EXPERIMENT_ID && current.startedAt?.toDate ? current.startedAt.toDate().toISOString().slice(0, 10) : "?";
console.log(`Offer experiment ${EXPERIMENT_ID} — ${business.name ?? BUSINESS_ID} (${WORKSPACE_ID}/${BUSINESS_ID})`);
console.log(`Status: ${current?.id === EXPERIMENT_ID ? current.status : "not the current experiment"} · started ${started}`);
if (current?.id === EXPERIMENT_ID && current.note) console.log(`Note: ${current.note}`);

const pct = (rate) => (rate === null ? "—" : `${(rate * 100).toFixed(1)} %`);
const header = ["", "Offre", "Assignés", "Rédigés", "Envoyés", "Réponses", "Positives", "RDV", "Taux réponse", "Taux positif", "Hors variante"];
const table = rows.map((row, index) => [
  String.fromCharCode(65 + index),
  row.offerName.length > 48 ? `${row.offerName.slice(0, 47)}…` : row.offerName,
  row.assigned,
  row.drafted,
  row.sent,
  row.replied,
  row.positive,
  row.meetings,
  pct(row.replyRate),
  pct(row.positiveRate),
  row.mismatched
].map(String));
const widths = header.map((title, column) => Math.max(title.length, ...table.map((line) => line[column].length)));
const format = (line) => line.map((cell, column) => (column <= 1 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]))).join("  ");
console.log(`\n${format(header)}`);
console.log(widths.map((width) => "─".repeat(width)).join("  "));
for (const line of table) console.log(format(line));

console.log("\nEnvoyés par canal:");
rows.forEach((row, index) => {
  const channels = Object.entries(row.sentByChannel).map(([channel, count]) => `${channel} ${count}`).join(", ") || "—";
  console.log(`  ${String.fromCharCode(65 + index)} ${row.offerId}: ${channels}`);
});
const assigned = rows.reduce((sum, row) => sum + row.assigned, 0);
console.log(`\nEntreprises de l'activité : ${companiesSnap.size} · assignées dans cette expérience : ${assigned}`);
console.log(
  "Lecture : les taux sont calculés sur les envoyés. Avec moins de ~30 envoyés par variante, un écart de quelques points est du bruit."
);
process.exit(0);
