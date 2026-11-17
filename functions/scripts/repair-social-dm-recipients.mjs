/**
 * Points every unsent DM draft of a business at the prospect's OWN account.
 *
 * Why: DM drafts written before profile-trust.ts took their Instagram and
 * Facebook profiles from the links on whatever page discovery recorded as the
 * company's website — often a booking page or a directory, whose links are
 * the platform's (facebook.com/teamfresha, instagram.com/kipik.ink…). The
 * runner's gate now refuses platform and directory accounts, but drafts still
 * carry them, and uncertain ones (a stranger's account on an unrelated site)
 * are only caught here.
 *
 * For each unsent DM draft (status "draft") of the business, the profiles are
 * resolved again with the trust rule:
 *   - a network whose profile is no longer trusted is removed from the draft;
 *   - a handle trusted for two or more companies is removed too (a shared
 *     account is nobody's own);
 *   - a draft left with no profile is set aside: status "rejected", reason
 *     "no_trusted_social_profile" (nothing is deleted; the text is kept).
 * The draft's text is never touched.
 *
 *   node functions/scripts/repair-social-dm-recipients.mjs --business biz_bloomy            # plan (read-only)
 *   node functions/scripts/repair-social-dm-recipients.mjs --business biz_bloomy --write    # apply
 *   options: --workspace ws_default
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
const { Timestamp, FieldValue } = fnRequire("firebase-admin/firestore");
const { resolveCompanySocialProfilesDetailed, normaliseSocialHandle } = fnRequire("./lib/services/social/social-profile.js");

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : fallback;
};
const BUSINESS_ID = arg("--business");
const WORKSPACE_ID = arg("--workspace", "ws_default");
const WRITE = process.argv.includes("--write");
if (!BUSINESS_ID) {
  console.error("--business <id> is required.");
  process.exit(1);
}

const drafts = await adminDb
  .collection("outreach")
  .where("workspaceId", "==", WORKSPACE_ID)
  .where("businessId", "==", BUSINESS_ID)
  .where("channel", "==", "social_dm")
  .where("status", "==", "draft")
  .get();

// Resolve every draft's company first: a handle trusted for several companies is nobody's own.
const resolved = new Map();
const owners = new Map();
for (const doc of drafts.docs) {
  const companyId = doc.data().companyId;
  if (typeof companyId !== "string" || resolved.has(companyId)) continue;
  const result = await resolveCompanySocialProfilesDetailed(companyId);
  resolved.set(companyId, result);
  for (const [network, profile] of Object.entries(result.profiles)) {
    const key = `${network}:${normaliseSocialHandle(profile.handle)}`;
    if (!owners.has(key)) owners.set(key, new Set());
    owners.get(key).add(companyId);
  }
}

const plan = [];
for (const doc of drafts.docs) {
  const draft = doc.data();
  const { profiles, setAside } = resolved.get(draft.companyId) ?? { profiles: {}, setAside: [] };
  const kept = {};
  const dropped = [...setAside.map((s) => `${s.network} @${s.handle} (${s.trust}: ${s.reason})`)];
  for (const [network, profile] of Object.entries(profiles)) {
    const sharers = owners.get(`${network}:${normaliseSocialHandle(profile.handle)}`);
    if (sharers && sharers.size > 1) {
      dropped.push(`${network} @${profile.handle} (shared by ${sharers.size} companies)`);
      continue;
    }
    kept[network] = profile;
  }
  const before = JSON.stringify(Object.fromEntries(Object.entries(draft.socialProfiles ?? {}).map(([n, p]) => [n, normaliseSocialHandle(p?.handle ?? "")]).sort()));
  const after = JSON.stringify(Object.fromEntries(Object.entries(kept).map(([n, p]) => [n, normaliseSocialHandle(p.handle)]).sort()));
  if (before === after) continue;
  plan.push({ ref: doc.ref, id: doc.id, companyId: draft.companyId, before, kept, dropped, setAsideDraft: Object.keys(kept).length === 0 });
}

const name = async (companyId) => ((await adminDb.doc(`companies/${companyId}`).get()).data() ?? {}).name ?? companyId;
console.log(`Business ${BUSINESS_ID}: ${drafts.size} unsent DM drafts; ${plan.length} to repair.`);
for (const item of plan) {
  console.log(
    `  ${item.setAsideDraft ? "SET ASIDE" : "REPOINT  "}  ${String(await name(item.companyId)).slice(0, 50)}  ${item.before} → ${JSON.stringify(
      Object.fromEntries(Object.entries(item.kept).map(([n, p]) => [n, p.handle]))
    )}${item.dropped.length ? `   dropped: ${item.dropped.join("; ")}` : ""}`
  );
}
console.log(`\nTotal: ${plan.filter((p) => !p.setAsideDraft).length} repointed, ${plan.filter((p) => p.setAsideDraft).length} set aside (no trusted profile).`);

if (!WRITE) {
  console.log("\nPlan only — nothing written. Re-run with --write to apply.");
  process.exit(0);
}

const now = Timestamp.now();
for (const item of plan) {
  if (item.setAsideDraft) {
    await item.ref.update({
      status: "rejected",
      rejectionReason: "no_trusted_social_profile",
      rejectedBy: "repair-social-dm-recipients",
      updatedAt: now
    });
    continue;
  }
  const first = item.kept.instagram ?? item.kept.facebook;
  // `update` replaces socialProfiles whole: a dropped network must not survive a merge.
  await item.ref.update({
    socialProfiles: item.kept,
    socialProfileUrl: first ? first.url : FieldValue.delete(),
    recipientRepairedAt: now,
    updatedAt: now
  });
}
console.log(`\nWritten: ${plan.length} drafts.`);
process.exit(0);
