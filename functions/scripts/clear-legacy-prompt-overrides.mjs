/**
 * Clears workspace-global prompt overrides that name a single business.
 *
 * `settings/global` can override the generic research/outreach prompts. Those
 * overrides were written for one business ("Tu es un copywriter B2B pour X"),
 * but they apply to EVERY business in the workspace - so any other business
 * generated research and emails in the wrong company's voice, and rejected its
 * own ideal prospects. The built-in prompts are business-agnostic and receive
 * the correct per-business context, so removing the overrides restores correct
 * behaviour.
 *
 * The previous values are copied to settings/legacyPromptOverrides first.
 *
 *   node functions/scripts/clear-legacy-prompt-overrides.mjs [--apply]
 */
const { adminDb } = await import("../lib/config/firebase.js");
const apply = process.argv.includes("--apply");

const OVERRIDE_KEYS = [
  "researchSystemPrompt",
  "researchUserPrompt",
  "outreachSystemPrompt",
  "outreachUserPrompt",
  "companyContext"
];

const ref = adminDb.doc("settings/global");
const data = (await ref.get()).data() || {};

const present = OVERRIDE_KEYS.filter((k) => typeof data[k] === "string" && data[k].trim());
console.log("Global prompt overrides found:");
for (const k of present) console.log(`  ${k.padEnd(22)} ${data[k].length} chars`);
if (!present.length) {
  console.log("  (none) — already using the generic prompts.");
  process.exit(0);
}

if (!apply) {
  console.log("\nDry run. Re-run with --apply to back up and clear them.");
  process.exit(0);
}

const backup = {};
for (const k of present) backup[k] = data[k];
await adminDb.doc("settings/legacyPromptOverrides").set(
  { ...backup, archivedAt: new Date().toISOString() },
  { merge: true }
);

const { FieldValue } = await import("firebase-admin/firestore");
const updates = {};
for (const k of present) updates[k] = FieldValue.delete();
await ref.update(updates);

console.log(`\nBacked up to settings/legacyPromptOverrides and cleared ${present.length} override(s).`);
console.log("The generic prompts now run with per-business context.");
process.exit(0);
