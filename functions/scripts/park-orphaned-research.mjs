/**
 * Parks companies queued for research that belong to a deleted campaign.
 *
 * They have no business and no offer, so research would produce ungrounded
 * output and consume AI budget ahead of live campaigns (the runner processes
 * oldest-first). Reversible: set needsResearch back to true.
 *
 *   node functions/scripts/park-orphaned-research.mjs [--apply]
 */
import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

if (!getApps().length) {
  initializeApp({ credential: applicationDefault(), projectId: process.env.FIREBASE_PROJECT_ID || "devcomm-os" });
}
const db = getFirestore();
const apply = process.argv.includes("--apply");

const pending = await db.collection("companies").where("needsResearch", "==", true).get();
const campaignCache = new Map();

async function campaignExists(id) {
  if (!id) return false;
  if (campaignCache.has(id)) return campaignCache.get(id);
  const snap = await db.doc(`discoveryCampaigns/${id}`).get();
  campaignCache.set(id, snap.exists);
  return snap.exists;
}

const orphans = [];
for (const doc of pending.docs) {
  const d = doc.data();
  if (!(await campaignExists(d.discoveryCampaignId))) orphans.push(doc);
}

console.log(`pending research: ${pending.size}`);
console.log(`orphaned (campaign deleted): ${orphans.length}`);
console.log(`live: ${pending.size - orphans.length}`);

if (!apply) {
  console.log("\nDry run. Re-run with --apply to park the orphans.");
  process.exit(0);
}

let parked = 0;
for (const doc of orphans) {
  await doc.ref.update({
    needsResearch: false,
    skippedReason: "Campaign deleted — parked to protect AI budget",
    updatedAt: Timestamp.now()
  });
  parked++;
}
console.log(`\nParked ${parked}. Reverse with: needsResearch = true`);
process.exit(0);
