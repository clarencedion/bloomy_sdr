/**
 * Removes demo/test fixtures that leaked into real collections.
 *
 * The SDR demo simulation, the dual-fixture E2E tests and the calendar-sync
 * tests all write to the SAME collections the product reads from, so their
 * output shows up as real meetings, companies and drafts in the UI. A user
 * cannot tell "Échange Diagnostic Commercial — Fleurs de Loire SAS" (a demo
 * fixture) from a meeting their SDR actually booked.
 *
 *   node functions/scripts/purge-test-fixtures.mjs [--apply]
 */
const { adminDb } = await import("../lib/config/firebase.js");
const apply = process.argv.includes("--apply");

// Fixture ids follow recognisable prefixes; real records use Firestore auto-ids.
const FIXTURE_ID_PATTERNS = [
  /^ws_(?!default)/,
  /^biz_summary_/,
  /^ws_summary_/,
  /_test_/,
  /^non_existent_/,
  /^temp_company$/,
  /^comp_123$/,
  /^cont_test_/,
  /^out_ws_/,
  /^conv_ws_/,
  /^comp_demo_/,
  /^comp_ws_funnel_test_/,
  /^comp_sync_/,
  /^comp_meeting_/,
  /^comp_e2e_/,
  /^comp_fixture_/,
  /^comp_test_/
];

const FIXTURE_NAME_PATTERNS = [
  /fleurs de loire/i,
  /m[ée]cainox/i,
  /acme logistique/i,
  /paul valery/i,
  /direct sync meeting/i,
  /test discovery company/i
];

const isFixtureId = (id) => FIXTURE_ID_PATTERNS.some((p) => p.test(id));
const isFixtureText = (text) => FIXTURE_NAME_PATTERNS.some((p) => p.test(String(text ?? "")));

async function scan(collection, fields) {
  // eslint-disable-next-line no-unused-vars
  const snap = await adminDb.collection(collection).get();
  return snap.docs.filter((d) => {
    const data = d.data();
    if (isFixtureId(d.id)) return true;
    if (fields.some((f) => data[f] !== undefined && isFixtureId(String(data[f]))))
      return true;
    // A queued job pointing at a company that does not exist is dead weight.
    if (collection === "jobQueue" && data.payload?.companyId && /^(comp_123|temp_company|non_existent)/.test(String(data.payload.companyId)))
      return true;
    return fields.some((f) => isFixtureText(data[f]));
  });
}

// jobQueue and apiSpendDaily are included because test fixtures there distort
// production quotas and budget guardrails, not just what the user sees.
const targets = [
  ["meetings", ["title", "companyId"]],
  ["companies", ["name"]],
  ["contacts", ["companyId", "email"]],
  ["outreach", ["companyId"]],
  ["conversations", ["companyId"]],
  ["leadResearch", ["companyId"]],
  ["jobQueue", ["companyId"]],
  ["apiSpendDaily", ["workspaceId", "businessId"]]
];

let total = 0;
const found = [];
for (const [collection, fields] of targets) {
  const docs = await scan(collection, fields);
  total += docs.length;
  found.push([collection, docs]);
  console.log(`  ${collection.padEnd(16)} ${docs.length}`);
  docs.slice(0, 4).forEach((d) => {
    const data = d.data();
    console.log(`      ${String(data.title ?? data.name ?? d.id).slice(0, 60)}`);
  });
}

console.log(`\nTotal fixture records: ${total}`);
if (!apply) {
  console.log("Dry run. Re-run with --apply to delete them.");
  process.exit(0);
}

for (const [collection, docs] of found) {
  for (const d of docs) {
    if (collection === "companies") {
      const evidence = await d.ref.collection("evidence").get();
      for (const e of evidence.docs) await e.ref.delete();
    }
    if (collection === "conversations") {
      const messages = await d.ref.collection("messages").get();
      for (const m of messages.docs) await m.ref.delete();
    }
    await d.ref.delete();
  }
  if (docs.length) console.log(`deleted ${docs.length} from ${collection}`);
}
console.log("\nDone.");
process.exit(0);
