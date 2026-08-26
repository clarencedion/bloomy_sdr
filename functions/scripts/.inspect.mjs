import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId: "devcomm-os" });
const db = getFirestore();
const CAMPAIGN = "OS7TyLk8Fstb2DCkU8HJ";

const c = await db.doc(`discoveryCampaigns/${CAMPAIGN}`).get();
const d = c.data();
console.log("=== CAMPAIGN ===");
console.log("name:", d.name, "| status:", d.status);
console.log("autoQueueHighScoreCompanies:", d.autoQueueHighScoreCompanies);
console.log("minDiscoveryScoreForSave:", d.minDiscoveryScoreForSave);
console.log("minDiscoveryScoreForAutoResearch:", d.minDiscoveryScoreForAutoResearch);
console.log("minQualityScoreForAutoResearch:", d.minQualityScoreForAutoResearch);
console.log("maxCompaniesPerRun:", d.maxCompaniesPerRun, "| businessId:", d.businessId, "| offerId:", d.offerId);
console.log("providerPriority:", JSON.stringify(d.providerPriority));
console.log("signals:", JSON.stringify(d.researchStrategy?.enabledSignalProviders));
console.log("nafCodes:", JSON.stringify(d.nafCodes), "| cities:", JSON.stringify(d.cities), "| keywords:", JSON.stringify(d.keywords));

const runs = await db.collection("discoveryRuns").where("campaignId","==",CAMPAIGN).get();
console.log("\n=== RUNS:", runs.size, "===");
runs.forEach(r => { const x=r.data();
  console.log(` ${x.provider} status=${x.status} found=${x.companiesFound} created=${x.companiesCreated} queued=${x.companiesQueuedForResearch} dup=${x.companiesSkippedDuplicate} rejected=${x.companiesRejected} avgScore=${x.averageDiscoveryScore}`);
  if (x.errors?.length) console.log("   errors:", x.errors.slice(0,3));
});

const comps = await db.collection("companies").where("discoveryCampaignId","==",CAMPAIGN).get();
console.log("\n=== COMPANIES:", comps.size, "===");
comps.forEach(x => { const y=x.data();
  console.log(` ${y.name} | status=${y.status} | discoveryScore=${y.discoveryScore} | quality=${y.qualityScore} | needsResearch=${y.needsResearch} | website=${y.website||"NONE"} | city=${y.city}`);
});
process.exit(0);
