import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId: "devcomm-os" });
const db = getFirestore();
const comps = await db.collection("companies").where("discoveryCampaignId","==","OS7TyLk8Fstb2DCkU8HJ").get();
console.log("What the 7 'websites' actually are:\n");
for (const d of comps.docs) {
  const x = d.data();
  let host = "";
  try { host = new URL(x.website).hostname.replace(/^www\./,""); } catch {}
  const isAggregator = /planity|treatwell|wavy|balinea|fresha|booksy|facebook|instagram/i.test(host);
  console.log(`  ${String(x.name).slice(0,36).padEnd(38)} ${host.padEnd(28)} ${isAggregator ? "<-- NOT their own site (booking platform)" : "own domain"}`);
}
process.exit(0);
