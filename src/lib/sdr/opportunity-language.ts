/**
 * Turns a generic `OpportunityScore` into the plain-language answer to
 * "why are we contacting them?".
 *
 * Strictly business-agnostic: every line rendered comes from evidence the
 * scoring engine already produced (`breakdown.*Reasons`, `detectedNeeds`,
 * `buyingTriggers`). No offer-, industry- or business-specific branching.
 */

import type { OpportunityScore, QualificationState } from "@/types/domain";

export interface OpportunityReason {
  /** Short plain-language claim, e.g. "Strong local reputation". */
  label: string;
  /** Whether this reason argues for or against contacting them. */
  kind: "strength" | "concern";
}

export interface OpportunitySummary {
  score: number;
  /** Plain-language verdict shown instead of the raw qualification state. */
  verdict: string;
  /** Colour intent for badges: high / medium / low. */
  band: "high" | "medium" | "low";
  reasons: OpportunityReason[];
  /** The angle the SDR will lead with, when the engine produced one. */
  angle?: string;
}

const VERDICTS: Record<QualificationState | "UNKNOWN", string> = {
  HIGH_PRIORITY: "Top opportunity",
  QUALIFIED: "Good opportunity",
  NEEDS_MORE_EVIDENCE: "Still checking",
  DISQUALIFIED: "Not a fit",
  UNKNOWN: "Being reviewed"
};

/** Sentence-cases an engine-produced reason without mangling proper nouns. */
function tidy(reason: string): string {
  const trimmed = reason.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function scoreBand(score: number): "high" | "medium" | "low" {
  if (score >= 75) return "high";
  if (score >= 50) return "medium";
  return "low";
}

/**
 * Builds the "why this is an opportunity" list, strengths first, capped so the
 * card stays scannable.
 */
export function describeOpportunity(
  score: OpportunityScore | undefined,
  options: { maxReasons?: number } = {}
): OpportunitySummary | null {
  if (!score) return null;
  const max = options.maxReasons ?? 4;

  const strengths = [
    ...(score.detectedNeeds ?? []),
    ...(score.breakdown?.needStrengthReasons ?? []),
    ...(score.breakdown?.companyFitReasons ?? []),
    ...(score.breakdown?.commercialValueReasons ?? []),
    ...(score.buyingTriggers ?? [])
  ]
    .map(tidy)
    .filter(Boolean);

  const concerns = (score.breakdown?.penalties ?? []).map(tidy).filter(Boolean);

  const seen = new Set<string>();
  const reasons: OpportunityReason[] = [];

  for (const label of strengths) {
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    reasons.push({ label, kind: "strength" });
    if (reasons.length >= max) break;
  }

  // Always leave room for one concern so the user sees the honest picture.
  for (const label of concerns) {
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    reasons.push({ label, kind: "concern" });
    break;
  }

  const overall = Math.round(score.overallScore ?? 0);

  return {
    score: overall,
    verdict: VERDICTS[score.qualificationState ?? "UNKNOWN"] ?? VERDICTS.UNKNOWN,
    band: scoreBand(overall),
    reasons,
    angle: score.recommendedAngle?.trim() || undefined
  };
}
