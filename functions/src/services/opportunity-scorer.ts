import type {
  EvidenceItem,
  OfferDoc,
  OpportunityScore,
  OpportunityScoreBreakdown,
  OpportunityScoreWeights,
  QualificationState,
  ResearchStrategy
} from "../types/domain.js";
import { synthesizeAnglesAndNeeds } from "./angle-generator.js";

export interface CampaignScoringContext {
  id?: string;
  name?: string;
  keywords?: string[];
  excludeKeywords?: string[];
  nafCodes?: string[];
  cities?: string[];
  departments?: string[];
  regions?: string[];
  minEmployeeCount?: number;
  minScoreForQualification?: number;
  researchStrategy?: ResearchStrategy;
}

export interface CompanyScoringInput {
  id?: string;
  name?: string;
  domain?: string;
  website?: string;
  city?: string;
  postalCode?: string;
  department?: string;
  region?: string;
  country?: string;
  industry?: string;
  nafCode?: string;
  nafLabel?: string;
  employeeCount?: number | null;
  establishmentCount?: number | null;
  administrativeStatus?: string;
  description?: string;
  siren?: string;
  siret?: string;
  sourceConfidence?: number;
}

export interface OpportunityScorerInput {
  company: CompanyScoringInput;
  evidenceItems?: EvidenceItem[];
  offer?: Partial<OfferDoc> | null;
  campaign?: Partial<CampaignScoringContext> | null;
}

const DEFAULT_WEIGHTS: OpportunityScoreWeights = {
  companyFitWeight: 0.25,
  needStrengthWeight: 0.35,
  commercialScaleWeight: 0.25,
  evidenceConfidenceWeight: 0.15
};

function normalizeNaf(code?: string): string {
  if (!code) return "";
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeSearchText(text?: string): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/**
 * Multi-Factor Opportunity Scoring Engine (REQ-037, REQ-038, REQ-039)
 * Evaluates collected EvidenceItem[] against Offer-driven weights and scoring rules.
 * Strictly respects Invariant 1 (multi-business generic) and Invariant 5 (FACT != INFERENCE).
 */
export function calculateOpportunityScore(input: OpportunityScorerInput): OpportunityScore {
  const { company, evidenceItems = [], offer, campaign } = input;

  const evidenceMap = new Map<string, EvidenceItem>();
  for (const item of evidenceItems) {
    evidenceMap.set(item.key, item);
  }

  const penalties: string[] = [];
  const companyFitReasons: string[] = [];
  const needStrengthReasons: string[] = [];
  const commercialValueReasons: string[] = [];
  const confidenceReasons: string[] = [];

  // ==========================================
  // 1. COMPANY FIT SCORE (0 - 100)
  // ==========================================
  let fitScore = 15; // Base starting baseline
  const compText = normalizeSearchText([
    company.name,
    company.industry,
    company.nafLabel,
    company.description
  ].filter(Boolean).join(" "));

  // Target NAF match
  const targetNafCodes = new Set([
    ...(campaign?.nafCodes ?? []),
    ...(offer?.scoringRules?.targetNafCodes ?? [])
  ].map(normalizeNaf).filter(Boolean));

  const compNaf = normalizeNaf(company.nafCode);
  if (compNaf && targetNafCodes.size > 0) {
    if (targetNafCodes.has(compNaf)) {
      fitScore += 35;
      companyFitReasons.push(`Code NAF en cible exacte (${company.nafCode})`);
    }
  } else if (compNaf) {
    fitScore += 15;
    companyFitReasons.push(`Activité NAF renseignée (${company.nafCode})`);
  }

  // Keywords match
  const targetKeywords = [
    ...(campaign?.keywords ?? []),
    ...(offer?.scoringRules?.targetKeywords ?? [])
  ].map(normalizeSearchText).filter(Boolean);

  let matchedKeywords = 0;
  for (const kw of targetKeywords) {
    if (compText.includes(kw)) {
      matchedKeywords++;
      if (matchedKeywords <= 3) {
        fitScore += 8;
        companyFitReasons.push(`Mot-clé cible détecté: "${kw}"`);
      }
    }
  }

  // Geographic territory match
  const targetCities = (campaign?.cities ?? []).map(normalizeSearchText).filter(Boolean);
  const compCity = normalizeSearchText(company.city);
  if (targetCities.length > 0) {
    if (compCity && targetCities.includes(compCity)) {
      fitScore += 15;
      companyFitReasons.push(`Localisation en zone cible (${company.city})`);
    }
  } else {
    fitScore += 15; // National coverage
  }

  // Employee range fit
  const empCount = typeof company.employeeCount === "number" ? company.employeeCount : undefined;
  const minEmp = offer?.scoringRules?.idealEmployeeMin ?? campaign?.minEmployeeCount;
  const maxEmp = offer?.scoringRules?.idealEmployeeMax;

  if (empCount !== undefined && empCount > 0) {
    if (minEmp !== undefined && empCount >= minEmp && (maxEmp === undefined || empCount <= maxEmp)) {
      fitScore += 20;
      companyFitReasons.push(`Taille d'équipe dans la cible (${empCount} salariés)`);
    } else if (empCount >= 5) {
      fitScore += 12;
      companyFitReasons.push(`Effectif déclaré (${empCount} salariés)`);
    } else {
      fitScore += 5;
    }
  }

  // Identity anchor (SIREN/SIRET)
  if (company.siren || company.siret) {
    fitScore += 10;
    companyFitReasons.push("Identifiant légal SIREN vérifié");
  }

  // Administrative status check
  const adminStatus = normalizeSearchText(company.administrativeStatus);
  const isInactive = adminStatus === "c" || adminStatus.includes("cessee") || adminStatus.includes("fermee") || adminStatus.includes("radiee");
  if (isInactive) {
    penalties.push("Entreprise administrativement inactive ou fermée");
    fitScore = 0;
  }

  // Excluded keywords
  const excludeKeywords = [
    ...(campaign?.excludeKeywords ?? []),
    ...(offer?.scoringRules?.negativeKeywords ?? [])
  ].map(normalizeSearchText).filter(Boolean);

  for (const kw of excludeKeywords) {
    if (compText.includes(kw)) {
      penalties.push(`Présence d'un mot-clé exclu: "${kw}"`);
      fitScore = Math.max(0, fitScore - 40);
      break;
    }
  }

  const companyFitScore = Math.min(100, Math.max(0, Math.round(fitScore)));

  // ==========================================
  // 2. NEED STRENGTH SCORE (0 - 100)
  // ==========================================
  let needScore = 10; // Baseline opportunity need

  /**
   * Reads the first key that is actually present.
   *
   * Signal providers and this scorer were written with different names for the
   * same facts (`ssl_active` vs `has_ssl`, `mobile_pagespeed_score` vs
   * `pagespeed_mobile_score`, ...). Every mismatched key silently evaluated to
   * `undefined`, so the corresponding need was never detected in production
   * even though fixtures using the scorer's names passed. Provider names are
   * listed first; the legacy aliases are kept so existing fixtures still work.
   */
  const readEvidence = (...keys: string[]): unknown => {
    for (const key of keys) {
      const item = evidenceMap.get(key);
      if (item?.value !== undefined && item?.value !== null) return item.value;
    }
    return undefined;
  };

  const pagespeedMobile = readEvidence("mobile_pagespeed_score", "pagespeed_mobile_score");
  const pagespeedLcp = readEvidence("lcp_seconds", "pagespeed_lcp");
  const hasWebsite = readEvidence("has_website");
  const websiteReachable = readEvidence("website_reachable");
  const hasSsl = readEvidence("ssl_active", "has_ssl");
  const mobileFriendly = readEvidence("mobile_friendly");
  const hasViewport = readEvidence("has_viewport_meta", "has_viewport");
  const hasEcommerce = readEvidence("has_cart_button", "has_online_ordering", "has_ecommerce");
  const hasBooking = readEvidence("has_booking_widget");
  const outdatedCopyright = readEvidence("is_copyright_outdated", "outdated_copyright");
  const copyrightYear = readEvidence("outdated_copyright_year", "copyright_year");
  const reviewCount = readEvidence("google_review_count", "google_places_review_count") as number | undefined;

  // A salon whose only web presence is a third-party booking listing
  // (Planity, Treatwell, ...) has no website of its own - a strong need, even
  // though the listing itself is modern and mobile-friendly.
  const thirdPartyOnly = readEvidence("third_party_presence_only") === true;
  const redirectedToSocial = readEvidence("is_redirected_to_social") === true;

  // Web Performance issues
  if (typeof pagespeedMobile === "number") {
    if (pagespeedMobile <= 35) {
      needScore += 35;
      needStrengthReasons.push(`Vitesse mobile critique (PageSpeed ${pagespeedMobile}/100)`);
    } else if (pagespeedMobile <= 60) {
      needScore += 20;
      needStrengthReasons.push(`Vitesse mobile moyenne (PageSpeed ${pagespeedMobile}/100)`);
    }
  }

  if (typeof pagespeedLcp === "number" && pagespeedLcp > 3.5) {
    needScore += 15;
    needStrengthReasons.push(`Temps de chargement LCP élevé (${pagespeedLcp.toFixed(1)}s)`);
  }

  // Missing or broken website
  if (hasWebsite === false || websiteReachable === false) {
    needScore += 40;
    needStrengthReasons.push("Absence de site internet actif ou site inaccessible");
  } else if (thirdPartyOnly || redirectedToSocial) {
    needScore += 35;
    needStrengthReasons.push(
      thirdPartyOnly
        ? "Pas de site propre : présence limitée à une plateforme de réservation tierce"
        : "Pas de site propre : présence limitée aux réseaux sociaux"
    );
  } else {
    // Insecure SSL
    if (hasSsl === false) {
      needScore += 15;
      needStrengthReasons.push("Absence de certificat HTTPS sécurisé");
    }

    // Responsive / UX issues
    if (mobileFriendly === false || hasViewport === false) {
      needScore += 25;
      needStrengthReasons.push("Expérience mobile dégradée (non responsive)");
    }

    // Outdated design / copyright
    const currentYear = new Date().getFullYear();
    if (outdatedCopyright === true || (typeof copyrightYear === "number" && copyrightYear <= currentYear - 3)) {
      needScore += 20;
      needStrengthReasons.push(`Site web vieillissant (copyright ${copyrightYear ?? "ancien"})`);
    }
  }

  // Missing commercial transactional features
  if (hasEcommerce === false) {
    needScore += 20;
    needStrengthReasons.push("Absence de vente ou commande en ligne (e-commerce)");
  }

  if (hasBooking === false) {
    needScore += 15;
    needStrengthReasons.push("Absence de module de réservation / prise de RDV");
  }

  // Multi-site commercial coaching / scale gaps
  const estCount = typeof company.establishmentCount === "number" ? company.establishmentCount : 1;
  if ((empCount ?? 0) >= 20 || estCount > 1) {
    needScore += 20;
    needStrengthReasons.push(`Enjeu de pilotage et performance commerciale multi-sites (${estCount} établissements)`);
  }

  const needStrengthScore = Math.min(100, Math.max(0, Math.round(needScore)));

  // ==========================================
  // 3. COMMERCIAL VALUE SCORE (0 - 100)
  // ==========================================
  let commercialScore = 15; // Base starting point

  // Employee scale proxy
  if (empCount !== undefined) {
    if (empCount >= 250) {
      commercialScore += 70;
      commercialValueReasons.push(`Grand compte / ETI (${empCount} salariés)`);
    } else if (empCount >= 50) {
      commercialScore += 60;
      commercialValueReasons.push(`Moyenne entreprise structurée (${empCount} salariés)`);
    } else if (empCount >= 20) {
      commercialScore += 50;
      commercialValueReasons.push(`PME solide (${empCount} salariés)`);
    } else if (empCount >= 5) {
      commercialScore += 35;
      commercialValueReasons.push(`Petite entreprise active (${empCount} salariés)`);
    } else if (empCount >= 1) {
      commercialScore += 20;
      commercialValueReasons.push(`TPE / Artisan (${empCount} salarié)`);
    }
  } else {
    commercialScore += 15;
  }

  // Multi-establishment scale
  if (estCount > 1) {
    const bonus = Math.min(25, estCount * 5);
    commercialScore += bonus;
    commercialValueReasons.push(`Réseau de ${estCount} établissements`);
  }

  // Customer traffic & traction proxy (Google Reviews)
  if (typeof reviewCount === "number" && reviewCount > 0) {
    if (reviewCount >= 100) {
      commercialScore += 30;
      commercialValueReasons.push(`Forte notoriété et flux client (${reviewCount} avis Google)`);
    } else if (reviewCount >= 30) {
      commercialScore += 20;
      commercialValueReasons.push(`Clientèle établie (${reviewCount} avis Google)`);
    } else if (reviewCount >= 10) {
      commercialScore += 10;
      commercialValueReasons.push(`Présence locale confirmée (${reviewCount} avis Google)`);
    }
  }

  // Active verified registry
  if (company.siren && !isInactive) {
    commercialScore += 10;
    commercialValueReasons.push("Entreprise en activité enregistrée");
  }

  const commercialValueScore = Math.min(100, Math.max(0, Math.round(commercialScore)));

  // ==========================================
  // 4. EVIDENCE CONFIDENCE (0 - 100)
  // ==========================================
  let evidenceConfidence = 40; // Default when no signals gathered
  if (evidenceItems.length > 0) {
    let totalWeightedConf = 0;
    let totalWeight = 0;

    for (const item of evidenceItems) {
      const natureWeight = item.nature === "fact" ? 1.2 : item.nature === "derived_metric" ? 1.0 : 0.8;
      totalWeightedConf += (item.confidence ?? 70) * natureWeight;
      totalWeight += natureWeight;
    }

    evidenceConfidence = Math.round(totalWeightedConf / Math.max(1, totalWeight));
    confidenceReasons.push(`${evidenceItems.length} signaux vérifiés analysés`);
  } else {
    confidenceReasons.push("Données initiales de découverte uniquement (aucun signal externe collecté)");
  }

  evidenceConfidence = Math.min(100, Math.max(0, evidenceConfidence));

  // ==========================================
  // 5. WEIGHTED COMPOSITE OVERALL SCORE
  // ==========================================
  const rawWeights: OpportunityScoreWeights = {
    companyFitWeight: offer?.scoringWeights?.companyFitWeight ?? campaign?.researchStrategy?.scoringWeights?.companyFitWeight ?? DEFAULT_WEIGHTS.companyFitWeight,
    needStrengthWeight: offer?.scoringWeights?.needStrengthWeight ?? campaign?.researchStrategy?.scoringWeights?.needStrengthWeight ?? DEFAULT_WEIGHTS.needStrengthWeight,
    commercialScaleWeight: offer?.scoringWeights?.commercialScaleWeight ?? campaign?.researchStrategy?.scoringWeights?.commercialScaleWeight ?? DEFAULT_WEIGHTS.commercialScaleWeight,
    evidenceConfidenceWeight: offer?.scoringWeights?.evidenceConfidenceWeight ?? campaign?.researchStrategy?.scoringWeights?.evidenceConfidenceWeight ?? DEFAULT_WEIGHTS.evidenceConfidenceWeight
  };

  const weightSum = rawWeights.companyFitWeight + rawWeights.needStrengthWeight + rawWeights.commercialScaleWeight + rawWeights.evidenceConfidenceWeight || 1.0;
  const weights: OpportunityScoreWeights = {
    companyFitWeight: rawWeights.companyFitWeight / weightSum,
    needStrengthWeight: rawWeights.needStrengthWeight / weightSum,
    commercialScaleWeight: rawWeights.commercialScaleWeight / weightSum,
    evidenceConfidenceWeight: rawWeights.evidenceConfidenceWeight / weightSum
  };

  let composite = (
    companyFitScore * weights.companyFitWeight +
    needStrengthScore * weights.needStrengthWeight +
    commercialValueScore * weights.commercialScaleWeight +
    evidenceConfidence * weights.evidenceConfidenceWeight
  );

  if (isInactive) {
    composite = Math.min(composite, 10);
  }

  const overallScore = Math.min(100, Math.max(0, Math.round(composite)));

  // ==========================================
  // 6. FOUR-TIER QUALIFICATION STATE MACHINE
  // ==========================================
  const minScore = offer?.scoringRules?.minScoreForQualification ?? campaign?.minScoreForQualification ?? 50;
  const highPriorityThreshold = offer?.scoringRules?.highPriorityThreshold ?? 80;
  const minEvidenceConfidence = offer?.scoringRules?.minEvidenceConfidence ?? 60;

  let qualificationState: QualificationState = "QUALIFIED";

  if (isInactive || overallScore < minScore || penalties.some(p => p.includes("exclu") || p.includes("inactive"))) {
    qualificationState = "DISQUALIFIED";
  } else if (evidenceConfidence < minEvidenceConfidence) {
    qualificationState = "NEEDS_MORE_EVIDENCE";
  } else if (overallScore >= highPriorityThreshold) {
    qualificationState = "HIGH_PRIORITY";
  } else {
    qualificationState = "QUALIFIED";
  }

  const breakdown: OpportunityScoreBreakdown = {
    companyFitScore,
    companyFitReasons,
    needStrengthScore,
    needStrengthReasons,
    commercialValueScore,
    commercialValueReasons,
    evidenceConfidence,
    confidenceReasons,
    penalties
  };

  // Synthesize angles and needs
  const angleSynthesis = synthesizeAnglesAndNeeds({
    company: {
      id: company.id,
      name: company.name,
      domain: company.domain,
      website: company.website,
      city: company.city,
      industry: company.industry,
      employeeCount: company.employeeCount ?? undefined,
      establishmentCount: company.establishmentCount ?? undefined
    },
    evidenceItems,
    offer,
    scoreBreakdown: breakdown
  });

  return {
    companyFitScore,
    needStrengthScore,
    commercialValueScore,
    evidenceConfidence,
    overallScore,
    qualificationState,
    weights,
    breakdown,
    detectedNeeds: angleSynthesis.detectedNeeds,
    buyingTriggers: angleSynthesis.buyingTriggers,
    recommendedAngle: angleSynthesis.recommendedAngle,
    calculatedAt: new Date()
  };
}
