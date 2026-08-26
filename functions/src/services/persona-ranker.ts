import type { OfferDoc, TargetPersona, PersonaMatchResult } from "../types/domain.js";

export const IRRELEVANT_ROLE_KEYWORDS = [
  // Accounting / Auditing / Finance
  "commissaire aux comptes",
  "commissaire au compte",
  "expert-comptable",
  "expert comptable",
  "expert_comptable",
  "comptable",
  "comptabilité",
  "comptabilite",
  "auditeur",
  "audit",
  "trésorier",
  "tresorier",
  "commissaire",
  
  // Legal / Compliance
  "avocat",
  "avocate",
  "juriste",
  "legal counsel",
  "legal",
  "juridique",
  "dpo",
  "data protection officer",
  "conformité",
  "conformite",
  "compliance",

  // Interns / Apprentices / Students
  "stagiaire",
  "intern",
  "alternant",
  "alternante",
  "apprenti",
  "apprentie",
  "étudiant",
  "etudiant",
  "student",
  "trainee",

  // Support / Assistants / Reception
  "assistant",
  "assistante",
  "secrétaire",
  "secretaire",
  "réceptionniste",
  "receptionniste",
  "standardiste",
  "reprographie",
  "hotesse",
  "hôte",
  "chauffeur",
  "coursier"
];

const DEFAULT_PERSONAS: TargetPersona[] = [
  {
    title: "Dirigeant / Propriétaire",
    priority: 1,
    keywords: ["gérant", "gerant", "fondateur", "fondatrice", "artisan", "patron", "patronne", "propriétaire", "proprietaire", "président", "president", "ceo", "directeur général", "directrice générale", "dg", "co-fondateur", "cofondateur", "owner", "founder"]
  },
  {
    title: "Direction Commerciale / Ventes",
    priority: 2,
    keywords: ["directeur commercial", "directrice commerciale", "head of sales", "vp sales", "sales director", "responsable commercial", "responsable des ventes", "business developer", "sales manager", "commercial"]
  },
  {
    title: "Direction Marketing / Communication",
    priority: 3,
    keywords: ["directeur marketing", "directrice marketing", "cmo", "head of marketing", "responsable marketing", "responsable communication", "chargé de communication", "marketing"]
  }
];

export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * REQ-044: Negative Role Filtering
 * Excludes accounting, legal, intern, auditor, and assistant roles from decision-maker outreach.
 */
export function isJobTitleIrrelevant(title?: string): boolean {
  if (!title) return false;
  const normalized = normalizeText(title);
  if (!normalized) return false;

  return IRRELEVANT_ROLE_KEYWORDS.some((keyword) => {
    const normKeyword = normalizeText(keyword);
    const regex = new RegExp(`(^|[^a-z0-9])${normKeyword}([^a-z0-9]|$)`, "i");
    return regex.test(normalized) || normalized.includes(normKeyword);
  });
}

export type CandidateContact = {
  id?: string;
  fullName?: string;
  role?: string;
  jobTitle?: string;
  email?: string;
  phone?: string;
  emailVerified?: boolean;
  emailQualification?: "verified" | "guessed" | "uncertain";
  confidence?: number;
  [key: string]: unknown;
};

export type RankedCandidateContact<T extends CandidateContact = CandidateContact> = T & PersonaMatchResult;

function expandAbbreviations(text: string): string[] {
  const norm = normalizeText(text);
  const variants = [norm];

  // Vice President <-> VP
  if (norm.includes("vice president") || norm.includes("vice-president")) {
    variants.push(norm.replace(/vice[- ]president/g, "vp"));
  }
  if (norm.includes("vp ") || norm.endsWith(" vp") || norm === "vp") {
    variants.push(norm.replace(/\bvp\b/g, "vice president"));
  }

  // PDG <-> President Directeur General / CEO
  if (norm.includes("pdg")) {
    variants.push(norm.replace(/\bpdg\b/g, "president directeur general"));
    variants.push(norm.replace(/\bpdg\b/g, "ceo"));
  }

  // DG <-> Directeur General
  if (norm.includes("dg ") || norm.endsWith(" dg") || norm === "dg") {
    variants.push(norm.replace(/\bdg\b/g, "directeur general"));
  }

  return [...new Set(variants)];
}

/**
 * Matches a job title/role against a list of TargetPersonas.
 */
export function matchPersona(
  role: string | undefined,
  targetPersonas: TargetPersona[]
): { matchedPersona?: TargetPersona; matchScore: number } {
  if (!role) {
    return { matchScore: 0 };
  }

  const roleVariants = expandAbbreviations(role);
  if (!roleVariants.length || !roleVariants[0]) {
    return { matchScore: 0 };
  }

  let bestPersona: TargetPersona | undefined;
  let bestScore = 0;

  for (const persona of targetPersonas) {
    // Check if persona has negative keywords that disqualify it
    if (persona.negativeKeywords?.length) {
      const hasNegative = persona.negativeKeywords.some((neg) => {
        const normNeg = normalizeText(neg);
        return roleVariants.some((v) => v.includes(normNeg));
      });
      if (hasNegative) continue;
    }

    let personaScore = 0;
    const personaTitleVariants = expandAbbreviations(persona.title);

    // Direct title match
    for (const pTitle of personaTitleVariants) {
      for (const rVar of roleVariants) {
        if (rVar === pTitle) {
          personaScore = Math.max(personaScore, 100);
        } else if (rVar.includes(pTitle) || pTitle.includes(rVar)) {
          personaScore = Math.max(personaScore, 95);
        }
      }
    }

    // Keyword matches
    for (const keyword of persona.keywords) {
      const kwVariants = expandAbbreviations(keyword);

      for (const normKeyword of kwVariants) {
        if (!normKeyword) continue;

        for (const normRole of roleVariants) {
          if (normRole === normKeyword) {
            personaScore = Math.max(personaScore, 100);
          } else if (normKeyword.includes(" ")) {
            // Multi-word phrase check
            const kwTokens = normKeyword.split(/\s+/).filter((t) => t.length > 2 && !["de", "des", "du", "la", "le", "of", "the", "and", "et"].includes(t));
            const allTokensPresent = kwTokens.length > 0 && kwTokens.every((t) => normRole.includes(t));
            
            if (normRole.includes(normKeyword)) {
              personaScore = Math.max(personaScore, 95);
            } else if (allTokensPresent) {
              personaScore = Math.max(personaScore, 90);
            }
          } else {
            // Single word keyword
            const regex = new RegExp(`(^|[^a-z0-9])${normKeyword}([^a-z0-9]|$)`, "i");
            if (regex.test(normRole)) {
              // Avoid overmatching generic words like "president" when role is "vice president of sales"
              if (normKeyword === "president" && (normRole.includes("sales") || normRole.includes("marketing") || normRole.includes("vp ") || normRole.includes("vice"))) {
                personaScore = Math.max(personaScore, 40);
              } else {
                personaScore = Math.max(personaScore, 80);
              }
            } else if (normRole.includes(normKeyword) && normKeyword.length >= 4) {
              personaScore = Math.max(personaScore, 65);
            }
          }
        }
      }
    }

    if (personaScore > bestScore) {
      bestScore = personaScore;
      bestPersona = persona;
    } else if (personaScore > 0 && personaScore === bestScore && bestPersona) {
      // Tie breaker: prefer higher priority (lower number)
      if (persona.priority < bestPersona.priority) {
        bestPersona = persona;
      }
    }
  }

  return {
    matchedPersona: bestPersona,
    matchScore: bestScore
  };
}

/**
 * REQ-043: Offer Persona Priority Ranking
 * Matches available contacts against OfferDoc.targetPersonas (ordered by priority 1, 2, 3)
 * Filters out irrelevant roles and sorts contacts deterministically.
 */
export function rankContactsForOffer<T extends CandidateContact>(
  contacts: T[],
  offer?: OfferDoc | null
): RankedCandidateContact<T>[] {
  const personas = (offer?.targetPersonas && offer.targetPersonas.length > 0)
    ? offer.targetPersonas
    : DEFAULT_PERSONAS;

  const ranked: RankedCandidateContact<T>[] = [];

  for (const contact of contacts) {
    const rawRole = contact.role ?? contact.jobTitle;
    
    // Check negative role filter
    if (isJobTitleIrrelevant(rawRole)) {
      continue;
    }

    const { matchedPersona, matchScore } = matchPersona(rawRole, personas);

    ranked.push({
      ...contact,
      personaMatched: matchedPersona?.title,
      personaPriority: matchedPersona?.priority ?? 99,
      personaMatchScore: matchScore,
      isPrimaryDecisionMaker: false
    });
  }

  // Sort contacts deterministically:
  // 1. Priority (1 before 2 before 3...)
  // 2. Email verified (true before false)
  // 3. Match score (descending 100 -> 0)
  // 4. Source confidence / quality score (descending)
  ranked.sort((a, b) => {
    const prioA = a.personaPriority ?? 99;
    const prioB = b.personaPriority ?? 99;
    if (prioA !== prioB) return prioA - prioB;

    const verA = a.emailVerified ? 1 : 0;
    const verB = b.emailVerified ? 1 : 0;
    if (verA !== verB) return verB - verA;

    const scoreA = a.personaMatchScore ?? 0;
    const scoreB = b.personaMatchScore ?? 0;
    if (scoreA !== scoreB) return scoreB - scoreA;

    const confA = typeof a.confidence === "number" ? a.confidence : 0;
    const confB = typeof b.confidence === "number" ? b.confidence : 0;
    return confB - confA;
  });

  // Assign primary decision maker to top ranked contact if eligible
  if (ranked.length > 0) {
    const primaryIndex = ranked.findIndex((c) => (c.personaPriority ?? 99) <= 3) !== -1
      ? ranked.findIndex((c) => (c.personaPriority ?? 99) <= 3)
      : 0;

    if (ranked[primaryIndex]) {
      ranked[primaryIndex].isPrimaryDecisionMaker = true;
    }
  }

  return ranked;
}
