import type {
  ClaimValidationResult,
  ClaimValidationStatus,
  EvidenceItem,
  KnowledgeBaseDoc,
  OfferDoc,
  PersonalizationFact
} from "../types/domain.js";

export interface ClaimValidationInput {
  sequence: {
    subject?: string;
    body?: string;
    followUp1?: string;
    followUp2?: string;
    linkedinNote?: string;
    linkedinFollowUp?: string;
  };
  company: {
    id?: string;
    name?: string;
    city?: string;
    employeeCount?: number;
    establishmentCount?: number;
    industry?: string;
    domain?: string;
    website?: string;
  };
  evidenceItems?: EvidenceItem[];
  personalizationFacts?: PersonalizationFact[];
  offer?: Partial<OfferDoc> | null;
  knowledgeBase?: Partial<KnowledgeBaseDoc> | null;
}

const ROBOTIC_AI_BUZZWORDS = [
  "dans un monde en constante évolution",
  "j'espère que ce message vous trouve bien",
  "j'espère que vous allez bien",
  "en tant que leader",
  "pionnier dans votre domaine",
  "synergie",
  "révolutionner",
  "solution innovante et disruptive",
  "notre solution innovante",
  "permettez-moi de me présenter",
  "catalyseur de croissance"
];

const SOFT_OPT_OUT_PATTERNS = [
  /si ce sujet n(?:'|’)?est pas pertinent/i,
  /si vous préférez ne pas être contacté/i,
  /dites-le-moi simplement et je ne vous relancerai pas/i,
  /je ne vous relancerai pas/i,
  /si vous ne souhaitez plus recevoir/i,
  /répondez simplement ['"]?stop['"]?/i,
  /n(?:'|’)?hésitez pas à me le dire pour que je ne vous relance pas/i,
  /dites-le-moi simplement/i
];

const KNOWN_CITIES = [
  "paris", "marseille", "lyon", "toulouse", "nice", "nantes", "strasbourg",
  "montpellier", "bordeaux", "lille", "rennes", "reims", "toulon", "saint-étienne",
  "le havre", "grenoble", "dijon", "angers", "nîmes", "villeurbanne", "clermont-ferrand",
  "aix-en-provence", "brest", "tours", "amiens", "limoges", "annecy", "perpignan", "boulogne-billancourt"
];

function countWords(str: string): number {
  if (!str) return 0;
  return str.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Validates outreach sequence draft against verified EvidenceItem[] facts,
 * company metadata, offer guardrails, and French B2B copywriting rules (FACT != INFERENCE invariant).
 */
export function validateOutreachClaims(input: ClaimValidationInput): ClaimValidationResult {
  const { sequence, company, evidenceItems = [], personalizationFacts: _personalizationFacts = [], offer, knowledgeBase } = input;

  const verifiedClaims: string[] = [];
  const unsupportedClaims: string[] = [];
  const prohibitedPromisesDetected: string[] = [];
  const warnings: string[] = [];

  const fullText = [
    sequence.subject,
    sequence.body,
    sequence.followUp1,
    sequence.followUp2,
    sequence.linkedinNote,
    sequence.linkedinFollowUp
  ]
    .filter(Boolean)
    .join("\n\n");

  const bodyText = sequence.body ?? "";
  const wordCount = countWords(bodyText);

  // Evidence map for quick lookup
  const evidenceMap = new Map<string, unknown>();
  for (const item of evidenceItems) {
    if (item.confidence >= 70) {
      evidenceMap.set(item.key, item.value);
    }
  }

  // 1. Employee / Headcount Claim Verification
  const employeeClaimMatch = fullText.match(
    /(?:équipe|effectif|taille|salariés|collaborateurs|personnes|employés)\s*(?:de|d')?\s*(\d+)|(\d+)\s*(?:salariés|collaborateurs|personnes|employés|membres)/i
  );
  if (employeeClaimMatch) {
    const claimedCount = parseInt(employeeClaimMatch[1] || employeeClaimMatch[2], 10);
    const officialCount = company.employeeCount;

    if (typeof officialCount === "number" && officialCount > 0) {
      const diff = Math.abs(claimedCount - officialCount);
      if (diff === 0 || diff / officialCount <= 0.2) {
        verifiedClaims.push(`Effectif mentionné (${claimedCount}) correspond à l'effectif officiel (${officialCount}).`);
      } else {
        unsupportedClaims.push(
          `Effectif mentionné (${claimedCount} salariés) ne correspond pas à l'effectif déclaré (${officialCount}).`
        );
      }
    } else {
      unsupportedClaims.push(
        `Effectif de ${claimedCount} salariés affirmé sans justificatif de registre ou preuve vérifiée.`
      );
    }
  }

  // 2. Google Reviews Claim Verification
  const reviewCountMatch = fullText.match(/(\d+)\s*avis(?:\s*clients|\s*google)?/i);
  if (reviewCountMatch) {
    const claimedReviews = parseInt(reviewCountMatch[1], 10);
    const verifiedReviews = evidenceMap.get("google_places_review_count") as number | undefined;

    if (typeof verifiedReviews === "number") {
      const diff = Math.abs(claimedReviews - verifiedReviews);
      if (diff === 0 || diff / Math.max(1, verifiedReviews) <= 0.15) {
        verifiedClaims.push(`Nombre d'avis (${claimedReviews}) vérifié via Google Places (${verifiedReviews} avis).`);
      } else {
        unsupportedClaims.push(
          `Nombre d'avis mentionné (${claimedReviews}) diverge des données Google Places vérifiées (${verifiedReviews} avis).`
        );
      }
    } else {
      unsupportedClaims.push(
        `Affirmation de ${claimedReviews} avis Google non étayée par une preuve Google Places vérifiée.`
      );
    }
  }

  // 3. Google Rating Claim Verification
  const ratingMatch = fullText.match(/(?:note(?:\s*moyenne)?\s*(?:de)?\s*|noté\s*)(\d+(?:[.,]\d+)?)\s*(?:\/5|sur\s*5|étoiles)/i);
  if (ratingMatch) {
    const claimedRating = parseFloat(ratingMatch[1].replace(",", "."));
    const verifiedRating = evidenceMap.get("google_places_rating") as number | undefined;

    if (typeof verifiedRating === "number") {
      if (Math.abs(claimedRating - verifiedRating) <= 0.2) {
        verifiedClaims.push(`Note Google (${claimedRating}/5) vérifiée avec la note réelle (${verifiedRating}/5).`);
      } else {
        unsupportedClaims.push(
          `Note Google mentionnée (${claimedRating}/5) diffère de la note réelle (${verifiedRating}/5).`
        );
      }
    } else {
      unsupportedClaims.push(
        `Note Google de ${claimedRating}/5 mentionnée sans preuve vérifiée.`
      );
    }
  }

  // 4. PageSpeed Score Claim Verification
  const pageSpeedMatch = fullText.match(/(?:pagespeed|score|performance)(?:\s*mobile)?\s*(?:de)?\s*(\d+)\s*(?:\/100|sur\s*100|%)/i);
  if (pageSpeedMatch) {
    const claimedScore = parseInt(pageSpeedMatch[1], 10);
    const verifiedScore = evidenceMap.get("pagespeed_mobile_score") as number | undefined;

    if (typeof verifiedScore === "number") {
      if (Math.abs(claimedScore - verifiedScore) <= 5) {
        verifiedClaims.push(`Score PageSpeed (${claimedScore}/100) vérifié par audit PageSpeed (${verifiedScore}/100).`);
      } else {
        unsupportedClaims.push(
          `Score PageSpeed mentionné (${claimedScore}/100) diffère de l'audit réel (${verifiedScore}/100).`
        );
      }
    } else {
      unsupportedClaims.push(
        `Score technique de ${claimedScore}/100 mentionné sans audit PageSpeed vérifié.`
      );
    }
  }

  // 5. Geographic City Alignment Check
  const lowerCompanyCity = (company.city ?? "").toLowerCase().trim();
  for (const city of KNOWN_CITIES) {
    const cityRegex = new RegExp(`(?:^|\\s|['’])(?:à|sur|dans la région de|vers|de|d')\\s*${city}(?:\\s|[.,;!?]|$)`, "iu");
    if (cityRegex.test(fullText)) {
      const cityName = city.charAt(0).toUpperCase() + city.slice(1);
      if (lowerCompanyCity && lowerCompanyCity.includes(city)) {
        verifiedClaims.push(`Localisation géographique (${cityName}) confirmée avec le siège (${company.city}).`);
      } else if (lowerCompanyCity && !lowerCompanyCity.includes(city)) {
        unsupportedClaims.push(
          `Localisation '${cityName}' mentionnée dans le message alors que l'entreprise est implantée à '${company.city}'.`
        );
      }
    }
  }

  // 6. Prohibited Promises Check
  const prohibitedRules = [
    ...(offer?.prohibitedPromises ?? []),
    ...(knowledgeBase?.prohibitedPromises ?? []),
    "garantie à 100%",
    "doubler votre chiffre d'affaires",
    "numéro 1 garanti sur google",
    "résultats garantis à 100%"
  ];

  for (const rule of prohibitedRules) {
    if (!rule || !rule.trim()) continue;
    const ruleLower = rule.toLowerCase().trim();
    if (fullText.toLowerCase().includes(ruleLower)) {
      prohibitedPromisesDetected.push(rule);
    }
  }

  // 7. Robotic AI Buzzwords Guardrail (REQ-052)
  for (const buzzword of ROBOTIC_AI_BUZZWORDS) {
    const buzzIndex = fullText.toLowerCase().indexOf(buzzword.toLowerCase());
    if (buzzIndex !== -1) {
      const originalSnippet = fullText.slice(buzzIndex, buzzIndex + buzzword.length);
      warnings.push(`Formulation générique / cliché IA détectée : "${originalSnippet}".`);
    }
  }

  // 8. Word Count Guardrail (REQ-052)
  if (wordCount > 0 && wordCount < 50) {
    warnings.push(`Corps d'email très court (${wordCount} mots), risque de manque de clarté.`);
  } else if (wordCount > 160) {
    warnings.push(`Corps d'email trop long (${wordCount} mots), la recommandation est de 80 à 140 mots.`);
  }

  // 9. Soft Opt-Out Verification (REQ-053)
  const hasOptOut = SOFT_OPT_OUT_PATTERNS.some((pattern) => pattern.test(fullText));
  if (!hasOptOut) {
    warnings.push("Phrase de désengagement poli manquante (ex: 'Si ce sujet n’est pas pertinent, dites-le-moi simplement').");
  }

  // 10. Status Determination
  let status: ClaimValidationStatus = "VALID";
  let passed = true;

  if (prohibitedPromisesDetected.length > 0) {
    status = "PROHIBITED_PROMISES_DETECTED";
    passed = false;
  } else if (unsupportedClaims.length > 0) {
    status = "UNSUPPORTED_CLAIMS_DETECTED";
    passed = false;
  } else if (warnings.length > 0) {
    status = "WARNINGS_ONLY";
    passed = true;
  }

  return {
    passed,
    status,
    verifiedClaims,
    unsupportedClaims,
    prohibitedPromisesDetected,
    warnings,
    wordCount,
    hasOptOut,
    checkedAt: new Date().toISOString()
  };
}
