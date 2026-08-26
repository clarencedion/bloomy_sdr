import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId: "devcomm-os" });
const db = getFirestore();
const CAMPAIGN = "OS7TyLk8Fstb2DCkU8HJ";
const comps = await db.collection("companies").where("discoveryCampaignId","==",CAMPAIGN).limit(1).get();
const d = comps.docs[0];
console.log("company:", d.data().name, "\nwebsite:", d.data().website, "\n");
const ev = await d.ref.collection("evidence").get();
const byProv = {};
ev.forEach(e => { const y=e.data(); (byProv[y.signalProvider||"?"] ||= []).push(y); });
for (const [prov, items] of Object.entries(byProv)) {
  console.log(`--- ${prov} (${items.length}) ---`);
  items.forEach(y => console.log(`   ${String(y.key).padEnd(30)} = ${JSON.stringify(y.value)?.slice(0,55).padEnd(57)} nature=${y.nature}`));
}
console.log("\n=== score breakdown ===");
const os = d.data().opportunityScore;
console.log("need reasons:", JSON.stringify(os.breakdown?.needStrengthReasons));
console.log("fit reasons:", JSON.stringify(os.breakdown?.companyFitReasons));
console.log("penalties:", JSON.stringify(os.breakdown?.penalties));
console.log("weights:", JSON.stringify(os.weights));
process.exit(0);
