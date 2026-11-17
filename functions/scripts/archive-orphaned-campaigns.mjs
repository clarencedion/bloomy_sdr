/**
 * Archives discovery campaigns whose business no longer exists.
 *
 * `discoveryCampaigns` is a top-level collection keyed by businessId, so
 * deleting a business does not cascade to it. An orphaned campaign left in
 * `active` keeps running on the nightly schedule - discovering, researching and
 * spending API budget - while being invisible in the UI, which only ever shows
 * the currently selected business.
 *
 *   node functions/scripts/archive-orphaned-campaigns.mjs [--apply] [--purge]
 *
 * --purge also deletes the companies (and their evidence) that campaign created.
 */
const { adminDb } = await import("../lib/config/firebase.js");
const { Timestamp } = await import("firebase-admin/firestore");

const apply = process.argv.includes("--apply");
const purge = process.argv.includes("--purge");

const businesses = await adminDb.collection("workspaces/ws_default/businesses").get();
const alive = new Set(businesses.docs.map((d) => d.id));
console.log("Live businesses:", [...alive].join(", ") || "(none)");

const campaigns = await adminDb.collection("discoveryCampaigns").get();
const orphans = campaigns.docs.filter((d) => {
  const businessId = d.data().businessId;
  return businessId && !alive.has(businessId);
});

if (!orphans.length) {
  console.log("\nNo orphaned campaigns.");
  process.exit(0);
}

console.log(`\nOrphaned campaigns: ${orphans.length}`);
for (const c of orphans) {
  const x = c.data();
  const companies = await adminDb.collection("companies").where("discoveryCampaignId", "==", c.id).get();
  console.log(`  "${x.name}"  status=${x.status}  business=${x.businessId} (deleted)  companies=${companies.size}`);
}

if (!apply) {
  console.log("\nDry run. Re-run with --apply (add --purge to also delete their companies).");
  process.exit(0);
}

for (const c of orphans) {
  await c.ref.update({ status: "archived", archivedAt: Timestamp.now(), updatedAt: Timestamp.now() });

  if (purge) {
    const companies = await adminDb.collection("companies").where("discoveryCampaignId", "==", c.id).get();
    for (const company of companies.docs) {
      const evidence = await company.ref.collection("evidence").get();
      for (const e of evidence.docs) await e.ref.delete();
      await company.ref.delete();
    }
    console.log(`  purged ${companies.size} companies from "${c.data().name}"`);
  }
}

console.log(`\nArchived ${orphans.length} campaign(s). They will no longer run on the nightly schedule.`);
process.exit(0);
