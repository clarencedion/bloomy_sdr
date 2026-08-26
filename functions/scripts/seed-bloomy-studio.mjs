/**
 * Seeds the "Bloomy Studio" business: French websites and online booking for
 * hairdressing salons whose site is missing, dated or unattractive.
 *
 * Runs with the Admin SDK (Application Default Credentials), so it works
 * regardless of client Firestore rules. Idempotent: re-running updates the same
 * documents rather than creating duplicates.
 *
 *   node scripts/seed-bloomy-studio.mjs
 */

import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "devcomm-os";
const WORKSPACE_ID = process.env.SEED_WORKSPACE_ID || "ws_default";
const BUSINESS_ID = "biz_bloomy_studio";
const OFFER_ID = "off_bloomy_site_coiffure";

if (!getApps().length) {
  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
}
const db = getFirestore();
const now = Timestamp.now();

const businessPath = `workspaces/${WORKSPACE_ID}/businesses/${BUSINESS_ID}`;

const business = {
  id: BUSINESS_ID,
  workspaceId: WORKSPACE_ID,
  name: "Bloomy Studio",
  legalName: "Bloomy Studio",
  website: "https://bloomystudio.fr",
  defaultLanguage: "fr",
  branding: {
    primaryColor: "#e11d48",
    tagline: "Sites web et prise de rendez-vous en ligne pour les salons de coiffure"
  },
  // Draft only: the SDR prepares everything and sends nothing without approval.
  automationPolicy: {
    mode: "manual",
    dailyOutreachLimit: 20,
    dailyDiscoveryLimit: 40,
    requireApprovalBeforeSend: true,
    autoReplySafeThreshold: 0.9
  },
  calendarConfig: {
    provider: "microsoft_graph",
    workingDays: [1, 2, 3, 4, 5],
    workingHours: { start: "09:00", end: "18:00" },
    timezone: "Europe/Paris"
  },
  updatedAt: now
};

const offer = {
  id: OFFER_ID,
  workspaceId: WORKSPACE_ID,
  businessId: BUSINESS_ID,
  name: "Site web & réservation en ligne pour salons de coiffure",
  description:
    "Création d'un site vitrine moderne, rapide et optimisé mobile pour les salons de coiffure, " +
    "avec prise de rendez-vous en ligne, galerie de réalisations, et fiche Google mise en valeur. " +
    "Cible : salons indépendants sans site web, ou avec un site ancien, lent ou non responsive.",
  targetPersonas: [
    {
      title: "Gérant / Propriétaire du salon",
      priority: 1,
      keywords: ["gérant", "gérante", "propriétaire", "patron", "patronne", "fondateur", "fondatrice"],
      seniority: ["owner", "c-level"]
    },
    {
      title: "Coiffeur / Coiffeuse responsable",
      priority: 2,
      keywords: ["coiffeur", "coiffeuse", "responsable salon", "manager"],
      seniority: ["manager"]
    }
  ],
  valuePropositions: [
    "Un site moderne et rapide, pensé pour le mobile — là où vos clientes vous cherchent",
    "La prise de rendez-vous en ligne 24h/24, qui réduit les appels et les créneaux perdus",
    "Une vitrine de vos réalisations qui met en valeur votre travail",
    "Une fiche Google cohérente avec votre site, pour être trouvé dans votre quartier"
  ],
  proofPoints: [
    "Sites livrés en 2 à 3 semaines",
    "Score PageSpeed mobile supérieur à 90 sur les sites livrés",
    "Prise de rendez-vous en ligne intégrée (Planity, Treatwell ou solution intégrée)"
  ],
  pricingGuardrails: {
    startingPrice: 1490,
    currency: "EUR",
    pricingModel: "fixed",
    canDiscloseInColdReply: false
  },
  prohibitedPromises: [
    "garantie d'être premier sur Google",
    "garantie d'un nombre de nouveaux clients",
    "garantie d'augmentation du chiffre d'affaires",
    "livraison en 24h",
    "remise supérieure à celle validée par le gérant"
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
    // 9602A = coiffure (NAF/APE)
    targetNafCodes: ["9602A"],
    targetKeywords: ["coiffure", "coiffeur", "salon de coiffure", "barbier", "hair"],
    negativeKeywords: ["franchise", "chaîne", "académie", "école de coiffure", "grossiste"],
    idealEmployeeMin: 1,
    idealEmployeeMax: 20,
    requiredSignals: ["website_presence"]
  },
  updatedAt: now
};

const knowledgeBase = {
  id: "kb_default",
  workspaceId: WORKSPACE_ID,
  businessId: BUSINESS_ID,
  services: [
    {
      name: "Site vitrine coiffure",
      description:
        "Site moderne de 4 à 6 pages : accueil, prestations, galerie, équipe, contact. " +
        "Optimisé mobile, chargement rapide, textes rédigés avec vous.",
      idealFor: "Salons sans site web ou avec un site ancien"
    },
    {
      name: "Prise de rendez-vous en ligne",
      description:
        "Intégration d'un module de réservation (Planity, Treatwell) ou solution intégrée, " +
        "avec rappels automatiques pour limiter les rendez-vous manqués.",
      idealFor: "Salons qui gèrent encore tous les rendez-vous par téléphone"
    },
    {
      name: "Refonte de site existant",
      description:
        "Reprise d'un site lent, daté ou non responsive : nouvelle identité visuelle, " +
        "performance mobile, contenus remis à jour.",
      idealFor: "Salons avec un site de plus de 4 ans"
    },
    {
      name: "Mise en valeur de la fiche Google",
      description:
        "Cohérence entre la fiche Google Business et le site : horaires, photos, prestations, avis.",
      idealFor: "Salons bien notés mais peu visibles en ligne"
    },
    {
      name: "Galerie de réalisations",
      description:
        "Mise en avant de vos coupes, colorations et coiffures de mariage, avec un format " +
        "qui reste rapide à charger sur mobile.",
      idealFor: "Salons qui publient déjà sur Instagram et veulent capitaliser dessus"
    },
    {
      name: "Photos et textes du salon",
      description:
        "Accompagnement pour obtenir des photos exploitables et rédaction des textes à partir " +
        "d'un échange de 20 minutes. Vous validez, nous ajustons.",
      idealFor: "Salons qui n'ont pas de contenu prêt et bloquent sur cette étape"
    }
  ],
  caseStudies: [
    {
      title: "Salon Éclat — Nantes",
      clientIndustry: "Coiffure",
      metric: "PageSpeed mobile 31 → 96",
      description:
        "Refonte complète d'un site de 2016 non responsive, avec ajout de la réservation en ligne. " +
        "Livré en 3 semaines."
    },
    {
      title: "Atelier Coiffure — Rennes",
      clientIndustry: "Coiffure",
      metric: "40 % des rendez-vous pris en ligne après 2 mois",
      description:
        "Salon sans site web. Création d'un site vitrine et intégration de la prise de rendez-vous, " +
        "ce qui a nettement réduit les appels en journée."
    },
    {
      title: "Studio Hair — Angers",
      clientIndustry: "Coiffure",
      metric: "Rendez-vous manqués divisés par deux",
      description:
        "Mise en place des rappels automatiques par SMS avec la réservation en ligne, " +
        "sur un salon de 3 fauteuils."
    },
    {
      title: "Maison Blondel — Vannes",
      clientIndustry: "Coiffure (barbier)",
      metric: "4,9 / 5 sur 180 avis mis en avant sur le site",
      description:
        "Salon très bien noté mais invisible en ligne. Fiche Google alignée avec le nouveau site " +
        "et avis affichés en page d'accueil."
    }
  ],
  pricingRules: [
    "Le site vitrine démarre à 1 490 € HT.",
    "La refonte d'un site existant démarre à 1 190 € HT.",
    "L'intégration de la prise de rendez-vous en ligne est incluse dans les formules à partir de 1 490 € HT.",
    "L'hébergement et la maintenance sont à 29 € HT par mois, sans engagement.",
    "Un acompte de 30 % est demandé au démarrage, le solde à la livraison.",
    "Ne jamais annoncer de prix ferme dans un premier email : proposer un échange de 20 minutes pour cadrer le besoin.",
    "Aucune remise ne peut être proposée sans validation du gérant.",
    "Si le prospect insiste sur un budget serré, proposer l'échange et ne pas improviser de tarif réduit."
  ],
  faqs: [
    {
      question: "Combien de temps pour livrer le site ?",
      answer: "En général 2 à 3 semaines à partir du moment où nous avons les photos et les textes."
    },
    {
      question: "Est-ce que je peux modifier le site moi-même ensuite ?",
      answer:
        "Oui. Nous vous formons à la modification des contenus courants (horaires, prestations, photos) " +
        "et une courte documentation vous est remise."
    },
    {
      question: "Je suis déjà sur Planity, est-ce compatible ?",
      answer:
        "Oui. Nous intégrons Planity directement dans le site pour que vos clientes réservent sans quitter votre page."
    },
    {
      question: "Et le référencement Google ?",
      answer:
        "Le site est construit avec les bonnes pratiques techniques et nous alignons votre fiche Google " +
        "avec le site. Nous ne garantissons jamais une position précise dans les résultats."
    },
    {
      question: "Qui écrit les textes ?",
      answer: "Nous proposons une première version à partir d'un échange de 20 minutes, que vous validez et ajustez."
    },
    {
      question: "J'ai déjà une page Facebook / Instagram, pourquoi un site ?",
      answer:
        "Les réseaux sociaux servent à montrer votre travail, mais vous n'en êtes pas propriétaire et " +
        "ils apparaissent mal dans les recherches Google du type « coiffeur + votre ville ». " +
        "Le site vous appartient et travaille pour vous en continu. Les deux se complètent : " +
        "nous connectons votre Instagram à la galerie du site."
    },
    {
      question: "Je n'ai pas le temps de m'en occuper.",
      answer:
        "C'est prévu ainsi : un échange de 20 minutes, puis nous préparons tout et vous validez. " +
        "Le temps demandé de votre côté est d'environ une heure au total."
    },
    {
      question: "C'est un proche qui m'a fait mon site.",
      answer:
        "Beaucoup de nos clients étaient dans ce cas. Nous pouvons repartir de l'existant plutôt que " +
        "tout refaire, et nous regardons d'abord ce qui bloque réellement (vitesse mobile, réservation, " +
        "affichage sur téléphone) avant de proposer quoi que ce soit."
    },
    {
      question: "C'est trop cher pour un salon comme le mien.",
      answer:
        "Le budget dépend de ce dont vous avez réellement besoin, c'est justement l'objet de l'échange. " +
        "Beaucoup de salons partent d'un site simple avec la réservation en ligne, et l'étoffent ensuite."
    },
    {
      question: "Est-ce que ça va vraiment m'amener des clientes ?",
      answer:
        "Nous ne promettons pas un nombre de nouvelles clientes. Ce que nous constatons, c'est que la " +
        "réservation en ligne capte des rendez-vous en dehors des heures d'ouverture et réduit les " +
        "appels pendant que vous coiffez."
    },
    {
      question: "Et si je veux arrêter ?",
      answer:
        "La maintenance est sans engagement. Le site vous appartient, vous partez avec si vous le souhaitez."
    },
    {
      question: "Vous travaillez avec des salons près de chez moi ?",
      answer:
        "Nous travaillons avec des salons indépendants partout en France, en visio. " +
        "Nous pouvons vous montrer des exemples de salons comparables au vôtre."
    }
  ],
  prohibitedPromises: [
    "Garantir la première place sur Google",
    "Garantir un nombre de nouvelles clientes",
    "Garantir une augmentation du chiffre d'affaires",
    "Promettre une livraison en 24 ou 48 heures",
    "Accorder une remise sans validation du gérant",
    "Affirmer que le site remplacera les réseaux sociaux",
    "Citer un salon client nommément sans son accord",
    "Annoncer un tarif ferme avant l'échange de cadrage"
  ],
  updatedAt: now
};

async function main() {
  const businessRef = db.doc(businessPath);
  const exists = (await businessRef.get()).exists;

  await businessRef.set({ ...business, ...(exists ? {} : { createdAt: now }) }, { merge: true });

  const offerRef = db.doc(`${businessPath}/offers/${OFFER_ID}`);
  const offerExists = (await offerRef.get()).exists;
  await offerRef.set({ ...offer, ...(offerExists ? {} : { createdAt: now }) }, { merge: true });

  const kbRef = db.doc(`${businessPath}/knowledgeBase/kb_default`);
  await kbRef.set(knowledgeBase, { merge: true });

  console.log(`${exists ? "Updated" : "Created"} business : ${business.name} (${BUSINESS_ID})`);
  console.log(`  workspace          : ${WORKSPACE_ID}`);
  console.log(`  autonomy           : ${business.automationPolicy.mode} (draft only — nothing sends itself)`);
  console.log(`  offer              : ${offer.name}`);
  console.log(`  personas           : ${offer.targetPersonas.length}`);
  console.log(`  NAF ciblé          : ${offer.scoringRules.targetNafCodes.join(", ")}`);
  console.log(`  knowledge base     : ${knowledgeBase.services.length} services, ${knowledgeBase.caseStudies.length} cas clients, ${knowledgeBase.faqs.length} FAQ`);
  console.log(`  garde-fous prix    : ${knowledgeBase.pricingRules.length} règles, ${offer.prohibitedPromises.length} promesses interdites`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error("Seed failed:", error?.message || error);
    process.exit(1);
  }
);
