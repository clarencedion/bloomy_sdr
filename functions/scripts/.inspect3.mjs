import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId: "devcomm-os" });
const db = getFirestore();
const CAMPAIGN = "OS7TyLk8Fstb2DCkU8HJ";

const comps = await db.collection("companies").where("discoveryCampaignId","==",CAMPAIGN).get();
console.log("=== does each company have lastActivityAt? ===");
comps.forEach(x => { const y=x.data();
  console.log(` ${y.name.slice(0,40).padEnd(42)} needsResearch=${y.needsResearch} lastActivityAt=${y.lastActivityAt ? "YES" : "*** MISSING ***"}`);
});

console.log("\n=== what the research runner would actually pick up ===");
try {
  const q = await db.collection("companies")
    .where("needsResearch","==",true)
    .orderBy("lastActivityAt","asc")
    .limit(50).get();
  console.log(`runner query returned: ${q.size} companies`);
  q.forEach(d => console.log("   -", d.data().name?.slice(0,50)));
} catch (e) {
  console.log("runner query FAILED:", e.code, "-", e.message.slice(0,180));
}

console.log("\n=== total companies with needsResearch=true (no orderBy) ===");
const all = await db.collection("companies").where("needsResearch","==",true).get();
console.log("count:", all.size);
process.exit(0);
