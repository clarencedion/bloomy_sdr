import { checkPricingStatements } from "./pricing-guardrail.js";
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
  // The signal providers and this validator were written with different key
  // names (the Places provider stores `google_review_count`, this file read
  // `google_places_review_count`): every true review count in a message was
  // reported "non étayée" (found on 2026-11-11: 13 of 30 live DM drafts).
  // Both spellings are read; the first that holds a value wins.
  const evidenceValue = (...keys: string[]): unknown => {
    for (const key of keys) {
      if (evidenceMap.has(key)) return evidenceMap.get(key);
    }
    return undefined;
  };

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

  // 2. Google Reviews Claim Verification — every count the message quotes,
  // thousands written the French way included ("1 200 avis").
  const verifiedReviews = evidenceValue("google_places_review_count", "google_review_count") as number | undefined;
  const reviewClaims = new Set(
    [...fullText.matchAll(/(?<![\d.,])(\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+)\s*avis/gi)].map((match) =>
      parseInt(match[1].replace(/[ \u00a0\u202f]/g, ""), 10)
    )
  );
  for (const claimedReviews of reviewClaims) {
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

  // 3. Google Rating Claim Verification — as messages really phrase it: "note
  // de 4,9 sur Google", "note parfaite de 5", "noté 4,8/5", "294 avis à 5
  // étoiles". The old pattern needed "/5", "sur 5" or "étoiles" right after
  // "note de N", so "une note de 4,9 sur Google" was never compared (review of
  // 2026-11-11: a 3.1 business could be told it had 4,9).
  const verifiedRating = evidenceValue("google_places_rating", "google_rating") as number | undefined;
  const ratingClaims = new Set<number>();
  const RATING_NUMBER = "(?<![\\d.,])(\\d(?:[.,]\\d)?)(?!\\d|[.,]\\d)";
  const ratingPatterns: Array<{ pattern: RegExp; needsContext?: boolean }> = [
    // "note de 4,9", "note parfaite de 5", "note Google de 4,8", "note moyenne 4,6".
    {
      pattern: new RegExp(
        `(?<![\\p{L}])notes?(?:\\s+(?:moyenne|parfaite|globale|excellente|google|clients?|clientèle))*\\s+(?:de\\s+)?${RATING_NUMBER}`,
        "giu"
      )
    },
    // "noté 5 sur Google", "notée 4,9/5": the number comes straight after.
    { pattern: new RegExp(`(?<![\\p{L}])noté(?:e|s|es)?\\s+${RATING_NUMBER}`, "giu") },
    // "4,9/5", "4.8 sur 5" (not "2 sur 5 de vos pages").
    { pattern: new RegExp(`${RATING_NUMBER}\\s*(?:\\/\\s*5(?!\\d)|sur\\s*5(?!\\d|[.,]\\d|\\s+(?:de|des|d['’])))`, "giu") },
    // "294 avis à 5 étoiles" — but "hôtel 4 étoiles" is not a review score: the sentence must speak of reviews.
    { pattern: new RegExp(`${RATING_NUMBER}\\s*étoiles?`, "giu"), needsContext: true }
  ];
  for (const { pattern, needsContext } of ratingPatterns) {
    for (const match of fullText.matchAll(pattern)) {
      if (needsContext) {
        const from = Math.max(0, fullText.lastIndexOf(".", match.index ?? 0) + 1);
        const to = fullText.indexOf(".", (match.index ?? 0) + match[0].length);
        const sentence = fullText.slice(from, to === -1 ? undefined : to);
        if (!/avis|google|(?<![\p{L}])not[eé]/iu.test(sentence)) continue;
      }
      const value = parseFloat(match[1].replace(",", "."));
      if (value >= 1 && value <= 5) ratingClaims.add(value);
    }
  }
  for (const claimedRating of ratingClaims) {
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
    const verifiedScore = evidenceValue("pagespeed_mobile_score", "mobile_pagespeed_score") as number | undefined;

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

  // 6b. Commercial terms (REQ-067). A figure, free component, discount,
  // commitment or tax basis the offer does not declare is an unsupported
  // claim like any other — the same check the reply engine runs.
  const pricing = checkPricingStatements(fullText, offer?.pricingGuardrails);
  for (const violation of pricing.violations) {
    unsupportedClaims.push(`Conditions commerciales non validées : ${violation.detail}.`);
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
