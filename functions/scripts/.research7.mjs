import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId: "devcomm-os" });
const db = getFirestore();
const CAMPAIGN = "OS7TyLk8Fstb2DCkU8HJ";

const { researchCompany } = await import("../lib/services/research-company.js");

const comps = await db.collection("companies").where("discoveryCampaignId","==",CAMPAIGN).get();
console.log(`Researching ${comps.size} salons (scoped to this campaign only)...\n`);

for (const doc of comps.docs) {
  const name = doc.data().name?.slice(0, 45);
  try {
    const t = Date.now();
    await researchCompany(doc.id);
    const after = (await doc.ref.get()).data();
    const score = after.opportunityScore?.overallScore;
    const state = after.opportunityScore?.qualificationState;
    console.log(`  OK   ${String(name).padEnd(47)} score=${score ?? "-"} state=${state ?? "-"} status=${after.status} (${((Date.now()-t)/1000).toFixed(1)}s)`);
  } catch (e) {
    console.log(`  FAIL ${String(name).padEnd(47)} ${String(e.message).slice(0,90)}`);
  }
}
process.exit(0);
