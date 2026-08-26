import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId: "devcomm-os" });
const db = getFirestore();

const g = await db.doc("settings/global").get();
const gs = g.data() || {};
console.log("=== GLOBAL SETTINGS ===");
console.log("automationPaused:", gs.automationPaused);
console.log("aiProvider:", gs.aiProvider, "| testModeEnabled:", gs.testModeEnabled);
console.log("testEmailAllowlist:", JSON.stringify(gs.testEmailAllowlist || []));

const ai = await db.doc("settings/aiSecrets").get();
const ints = await db.doc("settings/integrationSecrets").get();
const a = ai.data() || {}, i = ints.data() || {};
console.log("\n=== KEYS CONFIGURED (presence only) ===");
console.log("openAi:", !!a.openAiApiKey, "| anthropic:", !!a.anthropicApiKey);
console.log("serper:", !!i.serperApiKey, "| dropcontact:", !!i.dropcontactApiKey, "| instantly:", !!i.instantlyApiKey, "| google:", !!i.googleApiKey);

console.log("\n=== RESEARCH ARTIFACTS ===");
const lr = await db.collection("leadResearch").orderBy("createdAt","desc").limit(5).get().catch(()=>({size:0,docs:[]}));
console.log("leadResearch docs:", lr.size);
const out = await db.collection("outreach").limit(5).get();
console.log("outreach docs:", out.size);
const jobs = await db.collection("jobQueue").limit(5).get().catch(()=>({size:0}));
console.log("jobQueue docs:", jobs.size);

console.log("\n=== RECENT LOGS (last 25) ===");
const logs = await db.collection("logs").orderBy("createdAt","desc").limit(25).get();
logs.forEach(l => { const x=l.data();
  const t = x.createdAt?.toDate?.().toISOString().slice(11,19) || "??";
  console.log(` ${t} [${x.level}] ${x.type} :: ${String(x.message).slice(0,110)}`);
});
process.exit(0);
