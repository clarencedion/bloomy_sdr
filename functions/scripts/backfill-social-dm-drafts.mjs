/**
 * Prepares Instagram/Facebook DM drafts for a business's existing prospects, so
 * a social session (`npm run social:send`) has a queue on day one.
 *
 * Why it exists: DM drafts were only ever written right after research, and
 * only for companies with no outreach at all. Every Bloomy prospect researched
 * before Phase 23 already holds an email draft (written against the previous
 * offer), so none of them would ever get a DM.
 *
 * For each company of the business that has an Instagram or Facebook profile
 * and has never been contacted (no sent/replied outreach, no first-DM lock,
 * not do-not-contact, not disqualified):
 *   1. its unsent EMAIL drafts are set aside (status "rejected", reason
 *      "superseded_by_dm") — one prospect is contacted on one channel, and
 *      those drafts pitch the old offer anyway;
 *   2. a DM draft is written with the business's CURRENT offer (run the offer
 *      seed first) through the normal generator — same prompts, offer checks
 *      and AI-spend recording as the pipeline.
 *
 * Nothing is sent. Drafts appear in Approvals and in the session queue.
 *
 *   node functions/scripts/backfill-social-dm-drafts.mjs --business biz_bloomy            # plan only (read-only)
 *   node functions/scripts/backfill-social-dm-drafts.mjs --business biz_bloomy --write    # write
 *   options: --limit N (default 200)   --workspace ws_default
 *
 *   --redraft: instead, rewrite the DM drafts that exist and are still
 *   unreviewed (status "draft", never edited by a person), with the current
 *   offer and prompts — e.g. after an offer gained a terms line. Approved,
 *   rejected, sent or hand-edited drafts are never touched. Plan by default,
 *   --write to apply.
 *
 * Requires `npm run --prefix functions build`. Pinned to devcomm-os: this
 * machine's default Google project is the production CRM.
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
const { Timestamp } = fnRequire("firebase-admin/firestore");
const { resolveCompanySocialProfiles } = fnRequire("./lib/services/social/social-profile.js");
const { canContactSocial } = fnRequire("./lib/services/social/social-gate.js");
const { generateSocialDm } = fnRequire("./lib/services/social-dm-generation.js");
const { getActiveAiProvider } = fnRequire("./lib/services/ai-structured-call.js");

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : fallback;
};
const BUSINESS_ID = arg("--business");
const WORKSPACE_ID = arg("--workspace", "ws_default");
const LIMIT = Number(arg("--limit", "200"));
const WRITE = process.argv.includes("--write");
const REDRAFT = process.argv.includes("--redraft");
if (!BUSINESS_ID) {
  console.error("--business <id> is required.");
  process.exit(1);
}

const business = await adminDb.doc(`workspaces/${WORKSPACE_ID}/businesses/${BUSINESS_ID}`).get();
if (!business.exists) {
  console.error(`Business ${BUSINESS_ID} not found in ${WORKSPACE_ID}.`);
  process.exit(1);
}
const offers = await adminDb.collection(`workspaces/${WORKSPACE_ID}/businesses/${BUSINESS_ID}/offers`).get();
console.log(`Business: ${business.data().name} (${BUSINESS_ID})`);
console.log(`Offers: ${offers.docs.map((d) => `${d.data().name} [${JSON.stringify(d.data().pricingGuardrails ?? {})}]`).join(" | ") || "none"}`);

const provider = await getActiveAiProvider();
if (WRITE && provider.isMock) {
  console.error("The active AI provider is the mock: refusing to write drafts nobody should send. Configure Qwen or Anthropic first.");
  process.exit(1);
}
console.log(`AI provider: ${provider.name} (${provider.model})${provider.isMock ? " — MOCK" : ""}`);

const SENT = new Set(["sent", "replied", "exported"]);
const companies = await adminDb
  .collection("companies")
  .where("workspaceId", "==", WORKSPACE_ID)
  .where("businessId", "==", BUSINESS_ID)
  .get();

const plan = [];
const skipped = {};
const skip = (reason) => (skipped[reason] = (skipped[reason] ?? 0) + 1);

for (const doc of companies.docs) {
  if (plan.length >= LIMIT) break;
  const company = doc.data();
  if (company.doNotContact) { skip("do_not_contact"); continue; }
  if (company.status === "disqualified") { skip("disqualified"); continue; }
  if (company.socialDmSentAt) { skip("already_dm"); continue; }

  const outreach = await adminDb
    .collection("outreach")
    .where("workspaceId", "==", WORKSPACE_ID)
    .where("companyId", "==", doc.id)
    .get();
  if (outreach.docs.some((o) => SENT.has(String(o.data().status)))) { skip("already_contacted"); continue; }
  const dms = outreach.docs.filter((o) => o.data().channel === "social_dm");
  if (REDRAFT) {
    if (!dms.length) { skip("no_dm_draft"); continue; }
    // Only a draft nobody reviewed yet: an approval was given to that text.
    if (dms.some((o) => o.data().status !== "draft")) { skip(`dm_${dms.find((o) => o.data().status !== "draft").data().status}`); continue; }
    // Nor one a person edited: edits keep the status "draft". `humanEditedAt`
    // marks them; older edits are recognisable by the claim validation the
    // edit path writes and the DM generator never does.
    // (A DM the old email generator took over also has claimValidationStatus,
    // with its subject or follow-up: that one was never edited, it is repaired.)
    if (dms.some((o) => o.data().humanEditedAt || (o.data().claimValidationStatus && !(o.data().generatedSubject || o.data().followUp1)))) { skip("dm_edited_by_a_person"); continue; }
  } else if (dms.length) { skip("dm_draft_exists"); continue; }

  const profiles = await resolveCompanySocialProfiles(doc.id);
  const network = profiles.instagram ? "instagram" : profiles.facebook ? "facebook" : null;
  if (!network) { skip("no_social_profile"); continue; }
  const verdict = await canContactSocial({
    workspaceId: WORKSPACE_ID,
    businessId: BUSINESS_ID,
    companyId: doc.id,
    network,
    handle: profiles[network].handle,
    purpose: "first_dm"
  });
  if (!verdict.allowed && verdict.reason !== "test_mode_enabled") { skip(verdict.reason ?? "refused"); continue; }

  const emailDrafts = outreach.docs.filter((o) => o.data().channel !== "social_dm" && o.data().channel !== "contact_form" && o.data().status === "draft");
  plan.push({ id: doc.id, name: company.name, profiles, emailDrafts, dmId: dms[0]?.id });
}

console.log(`\nCompanies of the business: ${companies.size}`);
console.log(`${REDRAFT ? "Will REWRITE the unreviewed DM draft of" : "Will prepare a DM draft for"}: ${plan.length}`);
console.log(`  with Instagram: ${plan.filter((p) => p.profiles.instagram).length}, with Facebook: ${plan.filter((p) => p.profiles.facebook).length}`);
console.log(`  old email drafts to set aside: ${plan.reduce((n, p) => n + p.emailDrafts.length, 0)}`);
console.log(`Skipped: ${JSON.stringify(skipped)}`);

if (!WRITE) {
  console.log("\nPlan only — nothing written. Re-run with --write to prepare the drafts.");
  process.exit(0);
}

let written = 0;
const failures = [];
for (const item of plan) {
  try {
    const now = Timestamp.now();
    for (const draft of item.emailDrafts) {
      await draft.ref.set(
        { status: "rejected", rejectionReason: "superseded_by_dm", rejectedBy: "backfill-social-dm-drafts", updatedAt: now },
        { merge: true }
      );
    }
    // force: an explicit operator run, so a paused automation does not block it.
    // onlyIfUnreviewed: the plan above is minutes old by now; a draft a person
    // approved or edited meanwhile is refused (and listed below), and the
    // write itself is refused if the draft changed during the model call.
    await generateSocialDm({ companyId: item.id, force: true, ...(REDRAFT ? { onlyIfUnreviewed: true } : {}) });
    written++;
    process.stdout.write(`\r  ${written}/${plan.length} drafts written`);
  } catch (error) {
    failures.push(`${item.name ?? item.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(`\nDone: ${written} DM drafts ${REDRAFT ? "rewritten" : "prepared"}, ${failures.length} failed.`);
for (const failure of failures.slice(0, 20)) console.log(`  - ${failure}`);
process.exit(0);
