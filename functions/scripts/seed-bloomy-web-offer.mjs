/**
 * Seeds Bloomy's real offer + knowledge base.
 *
 * Terms confirmed by the owner on 2026-11-10:
 *   0 € de création · 49 € HT/mois · engagement 24 mois · 1er mois réglé à la commande.
 *
 * Proof points come only from what can be checked:
 *   - studio.bloomy.one (public site): "110 réalisations", "un studio de deux
 *     personnes", "environ quatre semaines pour un site vitrine", "le domaine,
 *     le code et les contenus restent à votre nom", "vous modifiez vos
 *     contenus vous-même, sans ticket ni facture", "une heure de formation".
 *   - bloomy-studio/src/lib/portfolio.ts: 20 client sites marked `client` and
 *     not `offline` — 15 florists, 1 hair salon, 1 body shop, 1 technical
 *     cleaning company, 1 B2B consultancy, 1 hospitality project.
 *
 * The previous version of this file carried four case studies ("tattoo studio
 * Nantes, PageSpeed 28 → 94", "hair salon Rennes, 40 % of bookings online",
 * "garage Angers, quote requests x2", "restaurant Vannes") that exist in no
 * CRM record or portfolio entry, a 1 490 € + 29 €/mois price list, and a rule
 * forbidding any price in a first email. All three are gone. Clients are
 * referred to by trade and city, never by name (knowledge-base rule).
 *
 * The SDR engine reads all of this as data. Nothing here is special-cased in
 * code: the same fields drive a consulting offer with no public price.
 *
 * The knowledge base is OFFER-NEUTRAL (2026-11-10, offer A/B test): it reaches
 * every prompt whatever offer the prospect is pitched, so it states no price,
 * no commitment length and no payment terms. Those live only on each offer
 * (description, value propositions, pricingGuardrails, approvedTerms), where
 * describePricingTerms states them and checkPricingStatements checks them.
 * The variants themselves are written by seed-offer-experiment.mjs.
 *
 *   node functions/scripts/seed-bloomy-web-offer.mjs [--business biz_bloomy] [--offer <offerId>] [--dry-run | --plan]
 *
 *   --dry-run  prints the offer and knowledge base; touches no database.
 *   --plan     reads Firestore (read-only) and prints exactly which document
 *              would be updated and what it holds today. Writes nothing.
 *   (none)     writes. Run --plan first.
 *
 * It never deletes. It updates in place only an offer it recognises as one it
 * seeded (id off_web_refonte, or exactly one of the names it has used), or the
 * one named with --offer; any other offer is left untouched and listed. If
 * several match, it stops.
 *
 * --offer exists for the live case found on 2026-11-10: every Bloomy company
 * and campaign points at an offer this script did not create
 * ("Refonte & Modernisation Web", 1 500 €). Updating that document keeps
 * every reference valid; creating a new one would leave them on the old terms.
 */
const DRY_RUN = process.argv.includes("--dry-run");
const PLAN = process.argv.includes("--plan");
const idx = process.argv.indexOf("--business");
const BUSINESS_ID = idx > -1 ? process.argv[idx + 1] : "biz_bloomy";
const offerIdx = process.argv.indexOf("--offer");
const TARGET_OFFER_ID = offerIdx > -1 ? process.argv[offerIdx + 1] : undefined;
const WORKSPACE_ID = "ws_default";

const offer = {
  name: "Site internet professionnel — 0 € de création, 49 € HT/mois",
  description:
    "Un site internet professionnel conçu pour le métier du client — vitrine, prise de rendez-vous " +
    "ou demande de devis selon l'activité — sans frais de création. 49 € HT par mois, engagement " +
    "24 mois, premier mois réglé à la commande. Pour tout commerce, artisan ou indépendant, " +
    "qu'il ait déjà un site ou non.",
  targetPersonas: [
    {
      title: "Gérant / Propriétaire",
      priority: 1,
      keywords: ["gérant", "gérante", "propriétaire", "fondateur", "fondatrice", "patron", "artisan"],
      seniority: ["owner", "c-level"]
    },
    { title: "Responsable de l'établissement", priority: 2, keywords: ["responsable", "manager"] }
  ],
  valuePropositions: [
    "0 € de création : le site est inclus dans l'abonnement de 49 € HT par mois",
    "Un site pensé pour votre métier, rapide et lisible sur mobile",
    "Le domaine, le code et les contenus restent à votre nom",
    "Vous modifiez vos contenus vous-même, sans ticket ni facture"
  ],
  proofPoints: [
    "110 réalisations présentées sur studio.bloomy.one/realisations (sites clients, projets récents et projets concept)",
    "20 sites clients en ligne : fleuristes, salon de coiffure, carrosserie, nettoyage technique, conseil, hôtellerie",
    "Environ quatre semaines pour un site vitrine, une fois les contenus réunis",
    "Un studio de deux personnes : vous parlez directement à ceux qui conçoivent votre site"
  ],
  pricingGuardrails: {
    startingPrice: 49,
    currency: "EUR",
    pricingModel: "subscription",
    canDiscloseInColdReply: true,
    setupFee: 0,
    monthlyPrice: 49,
    commitmentMonths: 24,
    taxLabel: "HT",
    approvedTerms: [
      "0 € de création",
      "Création du site offerte",
      "49 € HT par mois",
      "Engagement de 24 mois",
      "Premier mois réglé à la commande",
      "Le domaine, le code et les contenus restent à votre nom"
    ],
    // Inserted word for word in every first DM (social-dm-terms.ts).
    termsLine: "Notre formule : 0 € de création, puis 49 € HT par mois, engagement 24 mois."
  },
  prohibitedPromises: [
    "garantie d'être premier sur Google",
    "garantie d'un nombre de nouveaux clients",
    "garantie d'augmentation du chiffre d'affaires",
    "livraison en 24h",
    "livraison en 48h"
  ],
  scoringWeights: {
    companyFitWeight: 0.25,
    needStrengthWeight: 0.45,
    commercialScaleWeight: 0.2,
    evidenceConfidenceWeight: 0.1
  },
  scoringRules: {
    minScoreForQualification: 55,
    highPriorityThreshold: 80,
    minEvidenceConfidence: 60,
    idealEmployeeMin: 1,
    idealEmployeeMax: 20,
    requiredSignals: ["website_technical", "pagespeed"]
  }
};

const knowledgeBase = {
  services: [
    {
      name: "Site adapté à votre métier",
      description: "Les pages dont votre activité a besoin, rapides et lisibles sur mobile.",
      idealFor: "Commerces, artisans et indépendants sans site ou avec un site daté"
    },
    {
      name: "Rendez-vous ou devis en ligne",
      description: "Selon le métier : réservation, demande de devis ou prise de contact qui arrive complète.",
      idealFor: "Métiers sur rendez-vous ou sur devis"
    },
    {
      name: "Modifications en autonomie",
      description: "Vous modifiez vos contenus vous-même, sans ticket ni facture. Une heure de formation est prévue.",
      idealFor: "Tous les clients"
    },
    {
      name: "Boutique en ligne (option sur devis)",
      description: "Vente en ligne en supplément de l'offre de base. Prix sur devis uniquement.",
      idealFor: "Commerces qui vendent des produits"
    },
    {
      name: "Design entièrement sur mesure (option sur devis)",
      description: "Une identité graphique créée de zéro, au-delà de la personnalisation incluse. Prix sur devis uniquement.",
      idealFor: "Marques qui veulent une identité unique"
    }
  ],
  // Real, live client sites (portfolio.ts, kind "client", not offline), by
  // trade and city. No metric: none has been measured (portfolio.ts rule).
  caseStudies: [
    {
      title: "Fleuristes — 15 sites en ligne (Marboz, Paris, Reims, Roanne, Vertou…)",
      clientIndustry: "Fleuristes",
      metric: "",
      description: "Sites livrés et en ligne, visibles sur studio.bloomy.one/realisations."
    },
    {
      title: "Salon de coiffure — Dol-de-Bretagne",
      clientIndustry: "Coiffure",
      metric: "",
      description: "Site livré et en ligne, visible sur studio.bloomy.one/realisations."
    },
    {
      title: "Carrosserie automobile — Saint-Priest",
      clientIndustry: "Automobile",
      metric: "",
      description: "Site livré et en ligne, visible sur studio.bloomy.one/realisations."
    },
    {
      title: "Nettoyage technique et ascenseurs — Montreuil",
      clientIndustry: "Services aux entreprises",
      metric: "",
      description: "Site livré et en ligne, visible sur studio.bloomy.one/realisations."
    },
    {
      title: "Cabinet de conseil B2B — Paris",
      clientIndustry: "Conseil",
      metric: "",
      description: "Site livré et en ligne, visible sur studio.bloomy.one/realisations."
    }
  ],
  // Offer-neutral: the figures are the offer's, never the knowledge base's.
  pricingRules: [
    "Les conditions (prix, engagement, modalités de paiement) sont celles de l'offre présentée à ce prospect : n'en mentionner aucune autre.",
    "Boutique en ligne et design entièrement sur mesure : options sur devis. Ne jamais annoncer de prix pour ces options : proposer un échange.",
    "Aucune remise, aucun mois offert, aucune autre condition sans validation de l'équipe.",
    "Conditions de fin de contrat et de renouvellement : ne pas improviser, l'équipe les confirme elle-même."
  ],
  faqs: [
    {
      question: "Combien ça coûte ? Où est le piège ?",
      answer:
        "Les conditions sont celles de l'offre qui vous a été présentée, toutes écrites dans le contrat. " +
        "Le domaine, le code et les contenus restent à votre nom."
    },
    {
      question: "Combien de temps pour avoir mon site ?",
      answer: "Environ quatre semaines pour un site vitrine, une fois vos contenus réunis (photos, textes, logo)."
    },
    {
      question: "Puis-je modifier le site moi-même ?",
      answer: "Oui, vous modifiez vos contenus vous-même, sans ticket ni facture. Une heure de formation est prévue."
    },
    {
      question: "Vous travaillez avec mon métier ?",
      answer:
        "Oui, nous concevons des sites pour tous les métiers : 110 réalisations sont présentées sur studio.bloomy.one/realisations, " +
        "dont des sites en ligne pour des fleuristes, un salon de coiffure, une carrosserie et une entreprise de nettoyage."
    },
    {
      question: "J'ai déjà Instagram, pourquoi un site ?",
      answer:
        "Instagram montre votre travail mais ne vous appartient pas et ressort mal sur les recherches Google locales. Nous connectons les deux."
    },
    {
      question: "Je peux arrêter quand ?",
      answer:
        "La durée d'engagement est celle de l'offre qui vous a été présentée. " +
        "Pour les conditions précises de fin de contrat, l'équipe vous répond directement."
    },
    {
      question: "Et une boutique en ligne ?",
      answer: "C'est une option sur devis, en supplément de l'offre de base. L'équipe vous fait une proposition après un court échange."
    },
    {
      question: "Est-ce que ça va m'amener des clients ?",
      answer:
        "Nous ne promettons pas de chiffres. Ce que nous constatons : un site clair capte des demandes en dehors des heures d'ouverture."
    }
  ],
  prohibitedPromises: [
    "Garantir la première place sur Google",
    "Garantir un nombre de nouveaux clients",
    "Garantir une augmentation du chiffre d'affaires",
    "Promettre une livraison en 24 ou 48 heures",
    "Citer un client nommément sans son accord"
  ]
};

if (DRY_RUN) {
  console.log(JSON.stringify({ businessId: BUSINESS_ID, offer, knowledgeBase }, null, 2));
  process.exit(0);
}

// Pinned to devcomm-os: this machine's default Google project is the
// production CRM, and functions/lib initialises against the default project.
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
const { adminDb, adminApp } = await import("../lib/config/firebase.js");
if (adminApp.options.projectId && adminApp.options.projectId !== PROJECT_ID) {
  console.error("functions/lib is bound to another project — refusing.");
  process.exit(1);
}
const { Timestamp } = await import("firebase-admin/firestore");

const base = `workspaces/${WORKSPACE_ID}/businesses/${BUSINESS_ID}`;
const business = await adminDb.doc(base).get();
if (!business.exists) {
  console.error(`Business ${BUSINESS_ID} does not exist in ${WORKSPACE_ID}. Nothing written.`);
  process.exit(1);
}
const now = Timestamp.now();

// Offers this script has written before, by id or by exact name. Nothing
// else is touched: an owner-created offer with a similar name is not ours.
const SEEDED_ID = "off_web_refonte";
const SEEDED_NAMES = new Set([
  "Refonte & création de site web pour commerces locaux",
  "Site internet professionnel — 0 € de création, 49 € HT/mois"
]);
const existing = await adminDb.collection(`${base}/offers`).get();
const ours = TARGET_OFFER_ID
  ? existing.docs.filter((d) => d.id === TARGET_OFFER_ID)
  : existing.docs.filter((d) => d.id === SEEDED_ID || SEEDED_NAMES.has(d.data().name ?? ""));
if (TARGET_OFFER_ID && ours.length === 0) {
  console.error(`Offer ${TARGET_OFFER_ID} does not exist under ${BUSINESS_ID}. Nothing written.`);
  process.exit(1);
}
const others = existing.docs.filter((d) => !ours.includes(d));
if (ours.length > 1) {
  console.error(`Several offers look seeded by this script (${ours.map((d) => d.id).join(", ")}). Merge them by hand; nothing written.`);
  process.exit(1);
}
const offerRef = ours[0]?.ref ?? adminDb.collection(`${base}/offers`).doc(SEEDED_ID);

if (PLAN) {
  console.log(`Business ${BUSINESS_ID}: would ${ours.length ? "UPDATE" : "CREATE"} offer ${offerRef.id}`);
  if (ours[0]) {
    const current = ours[0].data();
    console.log(`  current name: ${current.name}`);
    console.log(`  current pricingGuardrails: ${JSON.stringify(current.pricingGuardrails ?? null)}`);
  }
  console.log(`  untouched offers: ${others.map((d) => `${d.id} (${d.data().name})`).join("; ") || "none"}`);
  console.log(`  knowledge base: would REPLACE ${base}/knowledgeBase/default`);
  process.exit(0);
}

// Not merged: the old offer's fields (fixed 1 490 € price, hidden pricing)
// must not survive underneath the new ones.
await offerRef.set({
  id: offerRef.id,
  workspaceId: WORKSPACE_ID,
  businessId: BUSINESS_ID,
  ...offer,
  createdAt: ours[0]?.data().createdAt ?? now,
  updatedAt: now
});

await adminDb.doc(`${base}/knowledgeBase/default`).set({
  id: "default",
  workspaceId: WORKSPACE_ID,
  businessId: BUSINESS_ID,
  ...knowledgeBase,
  updatedAt: now
});

const offers = await adminDb.collection(`${base}/offers`).get();
console.log(`Business ${BUSINESS_ID}:`);
console.log(`  offers: ${offers.size}`);
offers.forEach((d) => console.log(`    ${d.data().name}`));
console.log(
  `  knowledge base: ${knowledgeBase.services.length} services, ${knowledgeBase.caseStudies.length} références réelles, ` +
    `${knowledgeBase.faqs.length} FAQ, ${knowledgeBase.pricingRules.length} règles prix`
);
process.exit(0);
