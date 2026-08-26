import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId: "devcomm-os" });
const db = getFirestore();

const cRef = db.doc("discoveryCampaigns/OS7TyLk8Fstb2DCkU8HJ");
const c = (await cRef.get()).data();
const wanted = ["company_registry","google_places","website_technical","website_ecommerce","pagespeed"];
console.log("campaign signals before:", JSON.stringify(c.researchStrategy?.enabledSignalProviders));
await cRef.update({ "researchStrategy.enabledSignalProviders": wanted, updatedAt: Timestamp.now() });
console.log("campaign signals after :", JSON.stringify(wanted));

const oRef = db.doc("workspaces/ws_default/businesses/biz_bloomy_studio/offers/off_bloomy_site_coiffure");
const o = (await oRef.get()).data();
console.log("offer requiredSignals before:", JSON.stringify(o.scoringRules?.requiredSignals));
await oRef.update({ "scoringRules.requiredSignals": ["website_technical","pagespeed"], updatedAt: Timestamp.now() });
console.log("offer requiredSignals after :", JSON.stringify(["website_technical","pagespeed"]));
process.exit(0);
