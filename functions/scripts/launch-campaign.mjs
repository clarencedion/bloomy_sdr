/**
 * "Start prospecting" from the command line: the same steps as the app's
 * launch (src/lib/sdr/launch-campaign.ts) — the natural-language prompt is
 * translated into a targeting plan by the ICP translator, the campaign is
 * written `active` with auto-queueing, and its first discovery run starts.
 * From there the SDR runs on its own: discovered companies are queued for
 * research, the task queue (every 5 minutes, in the cloud) researches them,
 * assigns the offer variant and drafts the DM or email.
 *
 *   node functions/scripts/launch-campaign.mjs --business biz_bloomy --prompt "…" [--max 15] [--prefer-dm] [--plan]
 *
 * --plan prints the translated plan and writes nothing. Pinned to devcomm-os.
 */
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

const FUNCTIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fnRequire = createRequire(path.join(FUNCTIONS_DIR, "package.json"));
const { initializeApp, applicationDefault, getApps } = fnRequire("firebase-admin/app");
if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const { adminDb, adminApp } = fnRequire("./lib/config/firebase.js");
if (adminApp.options.projectId !== PROJECT_ID) {
  console.error("functions/lib is bound to another project — refusing.");
  process.exit(1);
}
const { FieldValue } = fnRequire("firebase-admin/firestore");
const { translateIcpPrompt } = fnRequire("./lib/services/icp-translator.js");
const { runDiscoveryCampaign } = fnRequire("./lib/services/run-discovery-campaign.js");
const { writeLog } = fnRequire("./lib/utils/logger.js");

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : fallback;
};
const BUSINESS_ID = arg("--business");
const WORKSPACE_ID = arg("--workspace", "ws_default");
const PROMPT = arg("--prompt");
const MAX = Number(arg("--max", "15"));
const PREFER_DM = process.argv.includes("--prefer-dm");
const PLAN = process.argv.includes("--plan");
if (!BUSINESS_ID || !PROMPT) {
  console.error('--business <id> and --prompt "<what you want to sell to whom>" are required.');
  process.exit(1);
}

const business = (await adminDb.doc(`workspaces/${WORKSPACE_ID}/businesses/${BUSINESS_ID}`).get()).data();
if (!business) {
  console.error(`Business ${BUSINESS_ID} not found.`);
  process.exit(1);
}
// The experiment's control is the campaign's offer; each company still gets its own variant.
const offerId = business.offerExperiment?.offerIds?.[0];

const plan = await translateIcpPrompt({ prompt: PROMPT, offerId, workspaceId: WORKSPACE_ID, businessId: BUSINESS_ID });
console.log("Plan:", JSON.stringify(plan, null, 2));
if (PLAN) process.exit(0);

// Same document as buildCampaignDocument (src/lib/sdr/launch-campaign.ts).
const campaign = {
  workspaceId: WORKSPACE_ID,
  businessId: BUSINESS_ID,
  ...(offerId ? { offerId } : {}),
  name: (plan.campaignName || "New campaign").trim(),
  naturalLanguagePrompt: PROMPT.trim(),
  status: "active",
  segment: plan.segment || "custom",
  cities: plan.cities ?? [],
  departments: plan.departments ?? [],
  regions: plan.regions ?? [],
  keywords: plan.keywords ?? [],
  excludeKeywords: plan.excludeKeywords ?? [],
  nafCodes: plan.nafCodes ?? [],
  maxCompaniesPerRun: MAX,
  ...(plan.minEmployeeCount ? { minEmployeeCount: plan.minEmployeeCount } : {}),
  requireWebsite: Boolean(plan.requireWebsite),
  targetSegment: (plan.minEmployeeCount ?? 0) >= 20 ? "large_company" : "small_business",
  channels: PREFER_DM ? ["email", "social_dm"] : ["email"],
  ...(PREFER_DM ? { preferredChannel: "social_dm" } : {}),
  providerPriority: plan.providerPriority?.length ? plan.providerPriority : ["recherche_entreprises", "sirene", "google_places"],
  researchStrategy: {
    enabledSignalProviders: plan.researchStrategy?.enabledSignalProviders?.length
      ? plan.researchStrategy.enabledSignalProviders
      : ["company_registry"],
    relevanceExplanation: plan.reasoningSummary || "",
    scoringWeights: plan.researchStrategy?.scoringWeights ?? {
      companyFitWeight: 0.3,
      needStrengthWeight: 0.4,
      commercialScaleWeight: 0.2,
      evidenceConfidenceWeight: 0.1
    }
  },
  autoQueueHighScoreCompanies: true,
  minDiscoveryScoreForSave: 100,
  minDiscoveryScoreForAutoResearch: 100,
  minQualityScoreForAutoResearch: 100,
  rechercheEntreprisesPageCursor: 1,
  rechercheEntreprisesExhausted: false,
  googlePlacesPageCursor: 1,
  googlePlacesExhausted: false,
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp()
};
const ref = await adminDb.collection("discoveryCampaigns").add(campaign);
await writeLog({
  type: "discovery.campaign.created_from_nl",
  level: "info",
  message: `Campaign created: ${campaign.name}`,
  workspaceId: WORKSPACE_ID,
  businessId: BUSINESS_ID,
  metadata: { campaignId: ref.id, prompt: PROMPT.trim(), offerId }
});
console.log(`\nCampaign ${ref.id} created (active). First discovery run…`);
const result = await runDiscoveryCampaign(ref.id);
console.log("Discovery:", JSON.stringify(result, null, 2));
process.exit(0);
