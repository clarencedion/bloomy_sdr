/**
 * Starts the SDR over: every prospect, message, campaign, research, job and log
 * of the project is removed, and every test workspace with them — after a
 * full JSON backup. The set-up survives.
 *
 * Kept: workspaces/ws_default and its businesses (offers, offer experiment,
 * knowledge base, settings of each business), settings (incl. API keys),
 * suppressionList (people who asked never to be contacted stay suppressed),
 * apiSpendDaily (money already spent; budgets read it), webhookEvents.
 *
 * Removed (all workspaces): the prospecting collections below, and every
 * workspace other than ws_default (recursively, with its businesses).
 *
 *   node functions/scripts/reset-prospecting-data.mjs            # plan (read-only): counts
 *   node functions/scripts/reset-prospecting-data.mjs --write    # backup, then delete
 *
 * The backup lands in functions/scripts/backups/reset-<timestamp>/ (git- and
 * deploy-ignored), one JSON file per collection (subcollections included).
 * Pinned to devcomm-os: this machine's default Google project is the
 * production CRM.
 */
import fs from "node:fs";
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

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = path.resolve(SCRIPTS_DIR, "..");
const fnRequire = createRequire(path.join(FUNCTIONS_DIR, "package.json"));
const { initializeApp, applicationDefault, getApps } = fnRequire("firebase-admin/app");
if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const { adminDb, adminApp } = fnRequire("./lib/config/firebase.js");
if (adminApp.options.projectId !== PROJECT_ID) {
  console.error("functions/lib is bound to another project — refusing.");
  process.exit(1);
}

const WRITE = process.argv.includes("--write");
const KEEP_WORKSPACE = "ws_default";

/** Prospecting data, removed whole. Companies and conversations own subcollections. */
const COLLECTIONS = [
  "companies",
  "contacts",
  "outreach",
  "conversations",
  "meetings",
  "discoveryCampaigns",
  "discoveryRuns",
  "discoveryRejected",
  "leadResearch",
  "companyEvidence",
  "evidenceItems",
  "generatedDocuments",
  "jobQueue",
  "logs",
  "analyticsDaily",
  "performanceInsights",
  "automationTests",
  "socialSessions",
  "socialDmLocks"
];
const WITH_SUBCOLLECTIONS = new Set(["companies", "conversations"]);
const NEVER = new Set(["settings", "suppressionList", "apiSpendDaily", "webhookEvents", "workspaces"]);
for (const name of COLLECTIONS) if (NEVER.has(name)) throw new Error(`refusing to touch ${name}`);

const count = async (ref) => (await ref.count().get()).data().count;

const workspaces = await adminDb.collection("workspaces").listDocuments();
const doomedWorkspaces = workspaces.filter((ref) => ref.id !== KEEP_WORKSPACE);
const plan = [];
for (const name of COLLECTIONS) plan.push({ name, count: await count(adminDb.collection(name)) });

console.log(`Project ${PROJECT_ID} — ${WRITE ? "BACKUP THEN DELETE" : "plan only"}`);
for (const { name, count: n } of plan) console.log(`  ${name.padEnd(22)} ${String(n).padStart(6)} documents${WITH_SUBCOLLECTIONS.has(name) ? " (+ subcollections)" : ""}`);
console.log(`  workspaces             ${String(doomedWorkspaces.length).padStart(6)} to remove (all but ${KEEP_WORKSPACE}), recursively`);
console.log(`  kept: ${KEEP_WORKSPACE} and its businesses, ${[...NEVER].filter((n) => n !== "workspaces").join(", ")}`);
if (!WRITE) {
  console.log("\nPlan only — nothing written. Re-run with --write to back up and delete.");
  process.exit(0);
}

// ── Backup ────────────────────────────────────────────────────────────────
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = path.join(SCRIPTS_DIR, "backups", `reset-${stamp}`);
fs.mkdirSync(backupDir, { recursive: true });
const plain = (value) =>
  JSON.parse(
    JSON.stringify(value, (_key, v) =>
      v && typeof v === "object" && typeof v.toDate === "function" ? { __timestamp: v.toDate().toISOString() } : v
    )
  );

async function dumpDoc(ref) {
  const snap = await ref.get();
  const entry = { path: ref.path, data: snap.exists ? plain(snap.data()) : null, sub: {} };
  for (const sub of await ref.listCollections()) {
    const docs = await sub.listDocuments();
    entry.sub[sub.id] = [];
    for (const child of docs) entry.sub[sub.id].push(await dumpDoc(child));
  }
  return entry;
}

for (const { name } of plan) {
  const file = path.join(backupDir, `${name}.json`);
  const out = fs.createWriteStream(file);
  out.write("[\n");
  let first = true;
  let written = 0;
  if (WITH_SUBCOLLECTIONS.has(name)) {
    for (const ref of await adminDb.collection(name).listDocuments()) {
      out.write(`${first ? "" : ",\n"}${JSON.stringify(await dumpDoc(ref))}`);
      first = false;
      written += 1;
    }
  } else {
    // One read per collection, not per document.
    for (const doc of (await adminDb.collection(name).get()).docs) {
      out.write(`${first ? "" : ",\n"}${JSON.stringify({ path: doc.ref.path, data: plain(doc.data()) })}`);
      first = false;
      written += 1;
    }
  }
  out.write("\n]\n");
  await new Promise((resolve) => out.end(resolve));
  process.stdout.write(`\r  backed up ${name} (${written})            `);
}
const wsFile = path.join(backupDir, "workspaces-removed.json");
fs.writeFileSync(wsFile, JSON.stringify(await Promise.all(doomedWorkspaces.map((ref) => dumpDoc(ref)))));
console.log(`\nBackup written to ${backupDir}`);

// ── Delete ────────────────────────────────────────────────────────────────
for (const { name } of plan) {
  if (WITH_SUBCOLLECTIONS.has(name)) {
    for (const ref of await adminDb.collection(name).listDocuments()) await adminDb.recursiveDelete(ref);
  } else {
    await adminDb.recursiveDelete(adminDb.collection(name));
  }
  process.stdout.write(`\r  deleted ${name}                     `);
}
for (const ref of doomedWorkspaces) await adminDb.recursiveDelete(ref);
console.log(`\nDeleted. Remaining:`);
for (const { name } of plan) console.log(`  ${name.padEnd(22)} ${await count(adminDb.collection(name))}`);
console.log(`  workspaces             ${(await adminDb.collection("workspaces").listDocuments()).map((r) => r.id).join(", ")}`);
process.exit(0);
