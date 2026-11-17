/**
 * Stamps every contact that lacks its workspace or business with those of its
 * company.
 *
 * Why: until 2026-11-11, contacts created by website and social enrichment
 * (company-enrichment.ts) were written without `workspaceId` / `businessId`,
 * so every workspace-scoped read (analytics, the app's lists) missed them.
 * The code now stamps new contacts; this repairs the existing ones.
 *
 * Only the two missing fields are added, from the contact's own company. A
 * contact whose company no longer exists, or whose company has no business,
 * is listed and left alone. Nothing else is changed, nothing is deleted.
 *
 *   node functions/scripts/backfill-contact-tenancy.mjs            # plan (read-only)
 *   node functions/scripts/backfill-contact-tenancy.mjs --write    # apply
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
const { tenantOf } = fnRequire("./lib/services/company-enrichment.js");

const WRITE = process.argv.includes("--write");

const contacts = (await adminDb.collection("contacts").get()).docs;
const missing = contacts.filter((doc) => !doc.data().workspaceId || !doc.data().businessId);
console.log(`Project ${PROJECT_ID}: ${contacts.length} contacts, ${missing.length} without workspace or business — ${WRITE ? "WRITING" : "plan only"}`);

let stamped = 0;
let left = 0;
for (const doc of missing) {
  const contact = doc.data();
  const companyId = typeof contact.companyId === "string" ? contact.companyId : "";
  const companySnap = companyId ? await adminDb.collection("companies").doc(companyId).get() : null;
  if (!companySnap?.exists) {
    console.log(`  LEFT    ${doc.id}: its company (${companyId || "none"}) does not exist`);
    left += 1;
    continue;
  }
  const company = companySnap.data() ?? {};
  const tenant = tenantOf(company);
  if (!tenant.businessId) {
    console.log(`  LEFT    ${doc.id}: ${String(company.name ?? companyId)} is attributed to no business`);
    left += 1;
    continue;
  }
  // Only what is missing: a stamp already there is never replaced.
  const patch = {
    ...(contact.workspaceId ? {} : { workspaceId: tenant.workspaceId }),
    ...(contact.businessId ? {} : { businessId: tenant.businessId })
  };
  console.log(`  STAMP   ${doc.id} (${String(company.name ?? companyId)}): ${JSON.stringify(patch)}`);
  if (WRITE) await doc.ref.set({ ...patch, updatedAt: Timestamp.now() }, { merge: true });
  stamped += 1;
}

console.log(`\n${stamped} ${WRITE ? "stamped" : "to stamp"}, ${left} left alone.`);
if (!WRITE) console.log("Plan only — nothing written. Re-run with --write to apply.");
process.exit(0);
