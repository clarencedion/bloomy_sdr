/**
 * Seeds an offer A/B test for one business: three variant offers cloned from a
 * control offer, then `business.offerExperiment` listing all four.
 *
 * Owner request 2026-11-10: learn which commercial terms sell best for the same
 * website. The control (A) is the owner-confirmed offer seeded by
 * seed-bloomy-web-offer.mjs (0 € de création, 49 € HT/mois, 24 mois). The
 * variants keep everything of the control that is not a price — personas,
 * value propositions, proof points, prohibited promises, scoring — and carry
 * their OWN description, price value proposition, pricingGuardrails and
 * approvedTerms:
 *   B "Petit abonnement" — 0 € de création, 29 € HT/mois, 36 mois
 *   C "Mise en service"  — 490 € HT, puis 29 € HT/mois, 12 mois
 *   D "Achat unique"     — 1 490 € HT, puis 15 € HT/mois d'hébergement, sans engagement
 *
 * The engine assigns each never-contacted prospect one variant on its first
 * draft (functions/src/services/offer-experiment.ts); nothing here is read by
 * code as anything but data. Results: offer-experiment-report.mjs.
 *
 *   node functions/scripts/seed-offer-experiment.mjs --business biz_bloomy --control <offerId>           # plan (read-only, default)
 *   node functions/scripts/seed-offer-experiment.mjs --business biz_bloomy --control <offerId> --plan    # same
 *   node functions/scripts/seed-offer-experiment.mjs --business biz_bloomy --control <offerId> --write   # writes
 *   options: --workspace ws_default
 *
 *   node functions/scripts/seed-offer-experiment.mjs --business <id> --control <offerId> --dry-run < control.json
 *     Offline: reads the control offer as JSON on stdin ({ offer } or the offer
 *     itself), prints the variants and the experiment as JSON. No Firebase.
 *
 * Before writing, every variant's quotable text must pass checkPricingStatements
 * against its own terms, and the knowledge base must state no amount and pass
 * against every variant's terms (run seed-bloomy-web-offer.mjs first). Every
 * offer, the control included, must carry a terms line (the sentence code
 * puts in each first DM) that is usable and states its declared figures and
 * commitment: otherwise the DMs of an A/B test would not all state their
 * terms. Any failure: nothing is written.
 *
 * It never deletes. It creates or replaces only the three variant offers,
 * whose ids are deterministic (off_<business>_ab_b|c|d), and replaces
 * `business.offerExperiment` as a whole. Requires `npm run --prefix functions
 * build`. Pinned to devcomm-os: this machine's default Google project is the
 * production CRM.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : fallback;
};
const BUSINESS_ID = arg("--business");
const CONTROL_ID = arg("--control");
const WORKSPACE_ID = arg("--workspace", "ws_default");
const DRY_RUN = process.argv.includes("--dry-run");
const WRITE = process.argv.includes("--write");
if (!BUSINESS_ID || !CONTROL_ID) {
  console.error("--business <id> and --control <offerId> are required.");
  process.exit(1);
}
if (!/^[A-Za-z0-9_-]+$/.test(BUSINESS_ID)) {
  console.error(`--business ${BUSINESS_ID}: only letters, digits, "_" and "-" make a valid offer id suffix.`);
  process.exit(1);
}
if (WRITE && (DRY_RUN || process.argv.includes("--plan"))) {
  console.error("--write cannot be combined with --plan or --dry-run.");
  process.exit(1);
}

const EXPERIMENT_ID = "exp_offers_2026_11";
const EXPERIMENT_NOTE =
  "A/B test des conditions commerciales (novembre 2026) : A contrôle, B petit abonnement, C mise en service, D achat unique. " +
  "Chaque prospect jamais contacté reçoit une variante à sa première rédaction et la garde ; un prospect déjà contacté garde son offre.";

// Shared, figure-free part of every variant description (the control's wording).
const DESCRIPTION_LEAD =
  "Un site internet professionnel conçu pour le métier du client — vitrine, prise de rendez-vous " +
  "ou demande de devis selon l'activité —";
const DESCRIPTION_TAIL = "Pour tout commerce, artisan ou indépendant, qu'il ait déjà un site ou non.";
const OWNERSHIP = "Le domaine, le code et les contenus restent à votre nom";

const VARIANTS = [
  {
    key: "b",
    label: "Petit abonnement : 0 € de création, 29 € HT/mois",
    description: `${DESCRIPTION_LEAD} sans frais de création. 29 € HT par mois, engagement 36 mois, premier mois réglé à la commande. ${DESCRIPTION_TAIL}`,
    priceValueProposition: "0 € de création : le site est inclus dans l'abonnement de 29 € HT par mois",
    pricingGuardrails: {
      startingPrice: 29,
      currency: "EUR",
      pricingModel: "subscription",
      canDiscloseInColdReply: true,
      setupFee: 0,
      monthlyPrice: 29,
      commitmentMonths: 36,
      taxLabel: "HT",
      approvedTerms: [
        "0 € de création",
        "Création du site offerte",
        "29 € HT par mois",
        "Engagement de 36 mois",
        "Premier mois réglé à la commande",
        OWNERSHIP
      ],
      termsLine: "Notre formule : 0 € de création, puis 29 € HT par mois, engagement 36 mois."
    }
  },
  {
    key: "c",
    label: "Mise en service : 490 € HT, puis 29 € HT/mois",
    description: `${DESCRIPTION_LEAD} avec une mise en service de 490 € HT réglée à la commande, puis 29 € HT par mois, engagement 12 mois. ${DESCRIPTION_TAIL}`,
    priceValueProposition: "490 € HT de mise en service, puis 29 € HT par mois avec un engagement de 12 mois",
    pricingGuardrails: {
      startingPrice: 490,
      currency: "EUR",
      pricingModel: "subscription",
      canDiscloseInColdReply: true,
      setupFee: 490,
      monthlyPrice: 29,
      commitmentMonths: 12,
      taxLabel: "HT",
      approvedTerms: [
        "490 € HT de mise en service",
        "29 € HT par mois",
        "Engagement de 12 mois",
        "Mise en service réglée à la commande",
        OWNERSHIP
      ],
      termsLine: "Notre formule : 490 € HT de mise en service, puis 29 € HT par mois, engagement 12 mois."
    }
  },
  {
    key: "d",
    label: "Achat unique : 1 490 € HT, site livré",
    description:
      `${DESCRIPTION_LEAD} acheté une fois : 1 490 € HT, site livré, avec un acompte de 30 % à la commande. ` +
      `Hébergement et maintenance : 15 € HT par mois, sans engagement. ${DESCRIPTION_TAIL}`,
    priceValueProposition: "Un achat unique : 1 490 € HT, site livré, puis 15 € HT par mois d'hébergement et de maintenance, sans engagement",
    pricingGuardrails: {
      startingPrice: 1490,
      currency: "EUR",
      pricingModel: "fixed",
      canDiscloseInColdReply: true,
      setupFee: 1490,
      monthlyPrice: 15,
      commitmentMonths: 0,
      taxLabel: "HT",
      approvedTerms: [
        "1 490 € HT, site livré",
        "15 € HT par mois d'hébergement et de maintenance, sans engagement",
        "Acompte de 30 % à la commande",
        OWNERSHIP
      ],
      // A no-break space keeps "1 490" on one line in the DM.
      termsLine: "Notre formule : 1\u00a0490 € HT, site livré, puis 15 € HT par mois d'hébergement et de maintenance, sans engagement."
    }
  }
];

/** A value proposition of the control that states terms belongs to the control only. */
const STATES_TERMS = /€|\beuros?\b|\b(?:HT|TTC)\b|engagement|abonnement|gratuit|offert|\bmois\b/i;

const variantId = (key) => `off_${BUSINESS_ID}_ab_${key}`;

/** The variant offers' content (no ids of tenants, no timestamps), cloned from the control. */
function buildVariants(control) {
  const baseName = String(control.name ?? "").split(" — ")[0].trim();
  if (!baseName) throw new Error("The control offer has no name to derive the variants' names from.");
  const neutralValueProps = (control.valuePropositions ?? []).filter((line) => !STATES_TERMS.test(String(line)));
  return VARIANTS.map((variant) => ({
    id: variantId(variant.key),
    name: `${baseName} — ${variant.label}`,
    description: variant.description,
    targetPersonas: control.targetPersonas ?? [],
    valuePropositions: [variant.priceValueProposition, ...neutralValueProps],
    proofPoints: control.proofPoints ?? [],
    pricingGuardrails: variant.pricingGuardrails,
    prohibitedPromises: control.prohibitedPromises ?? [],
    ...(control.scoringWeights ? { scoringWeights: control.scoringWeights } : {}),
    ...(control.scoringRules ? { scoringRules: control.scoringRules } : {})
  }));
}

function experimentDoc(controlId) {
  return {
    id: EXPERIMENT_ID,
    offerIds: [controlId, ...VARIANTS.map((variant) => variantId(variant.key))],
    status: "active",
    note: EXPERIMENT_NOTE
  };
}

// ── Offline: --dry-run ─────────────────────────────────────────────────────
if (DRY_RUN) {
  const raw = JSON.parse(fs.readFileSync(0, "utf8"));
  const control = raw && typeof raw === "object" && raw.offer ? raw.offer : raw;
  console.log(
    JSON.stringify({ businessId: BUSINESS_ID, controlId: CONTROL_ID, variants: buildVariants(control), experiment: experimentDoc(CONTROL_ID) }, null, 2)
  );
  process.exit(0);
}

// ── Firestore: --plan (default) / --write, pinned to devcomm-os ────────────
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
const { checkPricingStatements, extractPrices } = fnRequire("./lib/services/pricing-guardrail.js");
const { approvedTermsLine } = fnRequire("./lib/services/social-dm-terms.js");

const base = `workspaces/${WORKSPACE_ID}/businesses/${BUSINESS_ID}`;
const businessRef = adminDb.doc(base);
const businessSnap = await businessRef.get();
if (!businessSnap.exists) {
  console.error(`Business ${BUSINESS_ID} does not exist in ${WORKSPACE_ID}. Nothing written.`);
  process.exit(1);
}
const controlSnap = await adminDb.doc(`${base}/offers/${CONTROL_ID}`).get();
if (!controlSnap.exists) {
  console.error(`Control offer ${CONTROL_ID} does not exist under ${BUSINESS_ID}. Nothing written.`);
  process.exit(1);
}
const control = { id: controlSnap.id, ...controlSnap.data() };
if (!control.pricingGuardrails) {
  console.error(`Control offer ${CONTROL_ID} declares no pricingGuardrails: there are no terms to compare. Nothing written.`);
  process.exit(1);
}
const kbSnap = await adminDb.doc(`${base}/knowledgeBase/default`).get();
const knowledgeBase = kbSnap.exists ? kbSnap.data() : {};

const variants = buildVariants(control);
const currentVariants = new Map();
for (const variant of variants) {
  const snap = await adminDb.doc(`${base}/offers/${variant.id}`).get();
  if (snap.exists) currentVariants.set(variant.id, snap.data());
}
if (variants.some((variant) => variant.id === CONTROL_ID)) {
  console.error(`The control ${CONTROL_ID} is one of the variant ids; pick the real control offer. Nothing written.`);
  process.exit(1);
}

// ── Self-consistency: each variant against its own terms, the KB against all ──
const problems = [];
const check = (label, lines, terms) => {
  for (const line of lines) {
    const text = String(line ?? "");
    if (!text.trim()) continue;
    const violations = checkPricingStatements(text, terms).violations;
    if (violations.length) problems.push(`${label}: "${text}" → ${violations.map((v) => v.code).join(", ")}`);
  }
};
const quotable = (offer) => [
  offer.name,
  offer.description,
  ...(offer.valuePropositions ?? []),
  ...(offer.proofPoints ?? []),
  ...(offer.pricingGuardrails?.approvedTerms ?? []),
  offer.pricingGuardrails?.termsLine
];
check("A (control)", quotable(control), control.pricingGuardrails);
variants.forEach((variant, index) => check(String.fromCharCode(66 + index), quotable(variant), variant.pricingGuardrails));

// Every first DM of the test states its offer's terms: each offer needs a
// usable terms line naming its declared figures and commitment.
const checkTermsLine = (label, terms) => {
  const verdict = approvedTermsLine(terms);
  if (!verdict.line) {
    problems.push(`${label}: ${verdict.problem ?? "no termsLine — its DMs would not state its terms"}`);
    return;
  }
  const stated = new Set(extractPrices(verdict.line));
  for (const [name, value] of [["setupFee", terms.setupFee], ["monthlyPrice", terms.monthlyPrice]]) {
    if (typeof value === "number" && value > 0 && !stated.has(value)) problems.push(`${label}: termsLine omits ${name} ${value} €`);
  }
  if (terms.setupFee === 0 && !stated.has(0)) problems.push(`${label}: termsLine omits the 0 € setup`);
  const months = terms.commitmentMonths;
  if (typeof months === "number" && months > 0 && !new RegExp(`(?<!\\d)${months}\\s*mois`).test(verdict.line)) {
    problems.push(`${label}: termsLine omits the ${months}-month commitment`);
  }
  if (months === 0 && !/sans engagement/i.test(verdict.line)) problems.push(`${label}: termsLine omits "sans engagement"`);
};
checkTermsLine("A (control)", control.pricingGuardrails);
variants.forEach((variant, index) => checkTermsLine(String.fromCharCode(66 + index), variant.pricingGuardrails));

const kbLines = [
  ...(knowledgeBase.pricingRules ?? []),
  ...(knowledgeBase.faqs ?? []).flatMap((faq) => [faq.question, faq.answer]),
  ...(knowledgeBase.services ?? []).map((service) => service.description)
];
for (const line of kbLines) {
  if (extractPrices(String(line ?? "")).length) problems.push(`knowledge base states an amount: "${line}"`);
}
for (const [label, terms] of [["A", control.pricingGuardrails], ...variants.map((v, i) => [String.fromCharCode(66 + i), v.pricingGuardrails])]) {
  check(`knowledge base vs ${label}`, kbLines, terms);
}

// ── What would be written ────────────────────────────────────────────────
const now = Timestamp.now();
const currentExperiment = businessSnap.data().offerExperiment;
const keepStartedAt = currentExperiment?.id === EXPERIMENT_ID && currentExperiment.startedAt;
const experiment = { ...experimentDoc(CONTROL_ID), startedAt: keepStartedAt || now };
const offerDocs = variants.map((variant) => ({
  ...variant,
  workspaceId: WORKSPACE_ID,
  businessId: BUSINESS_ID,
  createdAt: currentVariants.get(variant.id)?.createdAt ?? now,
  updatedAt: now
}));

const show = (value) =>
  JSON.stringify(
    value,
    (key, v) => (v && typeof v === "object" && typeof v.toDate === "function" ? `<Timestamp ${v.toDate().toISOString()}>` : v),
    2
  );
const terms = (g) =>
  [
    typeof g.setupFee === "number" ? `setup ${g.setupFee} €` : null,
    typeof g.monthlyPrice === "number" ? `${g.monthlyPrice} € ${g.taxLabel ?? ""}/mois` : null,
    typeof g.commitmentMonths === "number" ? (g.commitmentMonths ? `engagement ${g.commitmentMonths} mois` : "sans engagement") : null,
    g.pricingModel,
    g.canDiscloseInColdReply ? "disclose" : "no disclosure"
  ]
    .filter(Boolean)
    .join(" · ");

console.log(`Offer experiment ${EXPERIMENT_ID} — ${WORKSPACE_ID}/${BUSINESS_ID} (${businessSnap.data().name ?? "?"}) — project ${PROJECT_ID}`);
console.log(`\nA  ${CONTROL_ID}  KEEP (not written)  "${control.name}"`);
console.log(`   terms: ${terms(control.pricingGuardrails)}`);
offerDocs.forEach((doc, index) => {
  const current = currentVariants.get(doc.id);
  console.log(`\n${String.fromCharCode(66 + index)}  ${doc.id}  ${current ? `REPLACE (current name: "${current.name}")` : "CREATE"}`);
  console.log(`   terms: ${terms(doc.pricingGuardrails)}`);
  console.log(`   ${base}/offers/${doc.id} = ${show(doc).replace(/\n/g, "\n   ")}`);
});
console.log(`\nBusiness ${base}: offerExperiment ${currentExperiment ? `REPLACE (current: ${show(currentExperiment).replace(/\s+/g, " ")})` : "SET"}`);
console.log(`   offerExperiment = ${show(experiment).replace(/\n/g, "\n   ")}`);
if (currentExperiment?.id === EXPERIMENT_ID && currentExperiment.status === "stopped") {
  console.log("   note: this experiment was stopped; writing re-activates it.");
}
console.log(`\nTerms lines (inserted word for word in each first DM):`);
for (const [label, terms] of [["A", control.pricingGuardrails], ...offerDocs.map((d, i) => [String.fromCharCode(66 + i), d.pricingGuardrails])]) {
  console.log(`   ${label}  ${terms.termsLine ?? "(none)"}`);
}
console.log(`\nSelf-consistency (each variant vs its own terms; knowledge base vs A, B, C, D): ${problems.length ? "FAIL" : "OK"}`);
for (const problem of problems) console.log(`   - ${problem}`);

if (problems.length) {
  console.error("\nNothing written: fix the lines above first (the knowledge base: run seed-bloomy-web-offer.mjs).");
  process.exit(1);
}
if (!WRITE) {
  console.log("\nPlan only — nothing written. Re-run with --write to apply.");
  process.exit(0);
}

// Offers replaced whole (an earlier variant's fields must not survive), then
// the experiment, replaced whole too (`update` does not deep-merge the map).
for (const doc of offerDocs) {
  await adminDb.doc(`${base}/offers/${doc.id}`).set(doc);
}
await businessRef.update({ offerExperiment: experiment, updatedAt: now });
console.log(`\nWritten: ${offerDocs.length} variant offers, business.offerExperiment (${experiment.offerIds.length} offers, active).`);
process.exit(0);
