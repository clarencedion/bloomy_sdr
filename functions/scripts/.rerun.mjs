import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId: "devcomm-os" });
const db = getFirestore();
const CAMPAIGN = "OS7TyLk8Fstb2DCkU8HJ";
const { researchCompany } = await import("../lib/services/research-company.js");

const comps = await db.collection("companies").where("discoveryCampaignId","==",CAMPAIGN).get();
console.log(`Re-running research on ${comps.size} salons WITH signal collection...\n`);
for (const doc of comps.docs) {
  const name = doc.data().name?.slice(0, 38);
  try {
    await researchCompany(doc.id, { force: true });
    const a = (await doc.ref.get()).data();
    const ev = await doc.ref.collection("evidence").get();
    const os = a.opportunityScore || {};
    console.log(`  ${String(name).padEnd(40)} score=${String(os.overallScore ?? "-").padStart(3)} ${String(os.qualificationState ?? "-").padEnd(20)} evidence=${ev.size} need=${os.needStrengthScore ?? "-"}`);
    if (os.detectedNeeds?.length) console.log(`      needs: ${os.detectedNeeds.slice(0,3).join(" | ")}`);
  } catch (e) {
    console.log(`  ${String(name).padEnd(40)} FAIL ${String(e.message).slice(0,80)}`);
  }
}
process.exit(0);
