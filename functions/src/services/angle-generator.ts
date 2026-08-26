import type { EvidenceItem, OfferDoc } from "../types/domain.js";

interface AngleSynthesisInput {
  company: {
    id?: string;
    name?: string;
    domain?: string;
    website?: string;
    city?: string;
    industry?: string;
    employeeCount?: number;
    establishmentCount?: number;
  };
  evidenceItems: EvidenceItem[];
  offer?: Partial<OfferDoc> | null;
  scoreBreakdown?: {
    needStrengthReasons?: string[];
    companyFitReasons?: string[];
    commercialValueReasons?: string[];
  };
}

export interface AngleSynthesisResult {
  detectedNeeds: string[];
  buyingTriggers: string[];
  recommendedAngle: string;
}

/**
 * Synthesizes verified EvidenceItem[] records into grounded detected needs,
 * buying triggers, and a recommended outreach angle.
 * Strictly respects Invariant 1 (multi-business generic) and Invariant 5 (FACT != INFERENCE).
 */
export function synthesizeAnglesAndNeeds(input: AngleSynthesisInput): AngleSynthesisResult {
  const { company, evidenceItems, offer, scoreBreakdown } = input;
  const detectedNeeds: string[] = [];
  const buyingTriggers: string[] = [];

  const evidenceMap = new Map<string, EvidenceItem>();
  for (const item of evidenceItems) {
    evidenceMap.set(item.key, item);
  }

  // 1. Extract Needs grounded in Evidence
  const pagespeedScore = evidenceMap.get("pagespeed_mobile_score")?.value;
  const pagespeedLcp = evidenceMap.get("pagespeed_lcp")?.value;
  const hasWebsite = evidenceMap.get("has_website")?.value;
  const hasSsl = evidenceMap.get("has_ssl")?.value;
  const mobileFriendly = evidenceMap.get("mobile_friendly")?.value;
  const hasEcommerce = evidenceMap.get("has_ecommerce")?.value;
  const hasBooking = evidenceMap.get("has_booking_widget")?.value;
  const copyrightYear = evidenceMap.get("copyright_year")?.value;
  const outdatedCopyright = evidenceMap.get("outdated_copyright")?.value;
  const reviewCount = evidenceMap.get("google_places_review_count")?.value as number | undefined;
  const rating = evidenceMap.get("google_places_rating")?.value as number | undefined;

  // Web Performance Needs
  if (typeof pagespeedScore === "number" && pagespeedScore <= 45) {
    const lcpInfo = typeof pagespeedLcp === "number" ? `, LCP ${pagespeedLcp.toFixed(1)}s` : "";
    detectedNeeds.push(`Performance mobile critique (PageSpeed ${pagespeedScore}/100${lcpInfo})`);
  } else if (typeof pagespeedScore === "number" && pagespeedScore <= 65) {
    detectedNeeds.push(`Vitesse de chargement mobile perfectible (PageSpeed ${pagespeedScore}/100)`);
  }

  // Web Technical & Responsive Needs
  if (hasWebsite === false) {
    detectedNeeds.push("Absence de site internet actif ou domaine non résolu");
  } else {
    if (hasSsl === false) {
      detectedNeeds.push("Site non sécurisé (certificat HTTPS manquant)");
    }
    if (mobileFriendly === false) {
      detectedNeeds.push("Affichage non responsive sur smartphone");
    }
    if (outdatedCopyright === true || (typeof copyrightYear === "number" && copyrightYear <= new Date().getFullYear() - 3)) {
      detectedNeeds.push(`Design et mentions vieillissants (copyright ${copyrightYear || "obsolète"})`);
    }
  }

  // E-Commerce & Booking Gaps
  if (hasEcommerce === false) {
    detectedNeeds.push("Absence de catalogue ou tunnel de vente e-commerce en ligne");
  }
  if (hasBooking === false) {
    detectedNeeds.push("Absence de module de prise de rendez-vous / réservation directe");
  }

  // Scale & Sales Enablement Needs
  const empCount = company.employeeCount ?? 0;
  const estCount = company.establishmentCount ?? 1;
  if (empCount >= 20 || estCount > 1) {
    detectedNeeds.push(`Coordination et performance commerciale multi-sites (${estCount} établissements, ${empCount} collaborateurs)`);
  }

  // Fallback if no specific need was found from structured keys
  if (detectedNeeds.length === 0 && scoreBreakdown?.needStrengthReasons?.length) {
    detectedNeeds.push(...scoreBreakdown.needStrengthReasons.slice(0, 3));
  }

  // 2. Extract Buying Triggers
  if (reviewCount && reviewCount >= 30) {
    const ratingStr = rating ? ` (noté ${rating}/5)` : "";
    if (typeof pagespeedScore === "number" && pagespeedScore <= 50) {
      buyingTriggers.push(`Forte notoriété locale (${reviewCount} avis Google${ratingStr}) freinée par un site mobile lent`);
    } else {
      buyingTriggers.push(`Forte attractivité commerciale (${reviewCount} avis Google${ratingStr}) propice au développement digital`);
    }
  }

  if (estCount > 1) {
    buyingTriggers.push(`Présence multi-établissements (${estCount} sites) nécessitant une cohérence de marque et d'outils`);
  }

  if (empCount >= 10 && empCount < 100) {
    buyingTriggers.push(`PME en phase de structuration (${empCount} salariés) avec potentiel d'accélération commerciale`);
  }

  if (hasWebsite === true && typeof pagespeedScore === "number" && pagespeedScore <= 40 && hasEcommerce === false) {
    buyingTriggers.push("Site vitrine existant mais sous-performant pour la conversion et la vente en ligne");
  }

  // 3. Synthesize Recommended Angle
  let recommendedAngle = "";

  // Check offer context if provided
  const offerName = (offer?.name ?? "").toLowerCase();
  const offerProps = (offer?.valuePropositions ?? []).join(" ").toLowerCase();
  const isWebOffer = offerName.includes("web") || offerName.includes("site") || offerProps.includes("pagespeed") || offerProps.includes("refonte");
  const isSalesConsulting = offerName.includes("commercial") || offerName.includes("vente") || offerProps.includes("force de vente") || offerProps.includes("prospection");

  if (typeof pagespeedScore === "number" && pagespeedScore <= 45 && (reviewCount ?? 0) >= 20) {
    recommendedAngle = "Diagnostic conversion mobile & valorisation de la notoriété locale";
  } else if (typeof pagespeedScore === "number" && pagespeedScore <= 45) {
    recommendedAngle = "Modernisation technique & optimisation de la vitesse mobile (Core Web Vitals)";
  } else if (hasWebsite === false) {
    recommendedAngle = "Création d'un canal digital moderne et acquisition de clientèle locale";
  } else if (hasEcommerce === false && (reviewCount ?? 0) >= 30) {
    recommendedAngle = "Déploiement du canal de vente e-commerce et commande en ligne";
  } else if (isSalesConsulting || (empCount >= 15 && estCount > 1)) {
    recommendedAngle = "Structuration des méthodes de vente et montée en compétences de la force commerciale";
  } else if (isWebOffer) {
    recommendedAngle = "Audit d'expérience utilisateur et refonte de l'interface digitale";
  } else if (offer?.valuePropositions?.length) {
    recommendedAngle = offer.valuePropositions[0];
  } else {
    recommendedAngle = "Diagnostic de performance et accompagnement à la croissance";
  }

  return {
    detectedNeeds: detectedNeeds.slice(0, 5),
    buyingTriggers: buyingTriggers.slice(0, 4),
    recommendedAngle
  };
}
