import { z } from "zod";
import { extractFirstJsonObject } from "../utils/json-extract.js";
import { boundedScore, boundedText, boundedTextArray, forgivingEnum } from "../utils/ai-schema.js";

const cleanStringArray = boundedTextArray(4000);

/**
 * Bounded by truncation, not rejection. An over-long segment label or one
 * missing narrative field used to discard the whole research for a company
 * after the AI call had already been paid for - 49% of runs over four days.
 *
 * `fitScore` and `confidence` stay strict: they are the output the pipeline
 * acts on, and a defaulted score would be a claim about a prospect that no
 * evidence supports (Invariant 6).
 */
export const researchOutputSchema = z
  .object({
    companySummary: boundedText(4000),
    segment: boundedText(100),
    fitScore: boundedScore(),
    confidence: boundedScore(),
    detectedNeeds: cleanStringArray,
    painPoints: cleanStringArray,
    buyingTriggers: cleanStringArray,
    bestOffer: boundedText(1000).optional(),
    // Legacy field name; kept optional so previously stored research validates.
    bestDevcommOffer: boundedText(1000).optional(),
    targetPersonas: cleanStringArray,
    personalizedAngle: boundedText(1500),
    reasoningSummary: boundedText(1500),
    risks: cleanStringArray,
    recommendedNextAction: forgivingEnum(["approve_outreach", "enrich_more", "reject"] as const, "enrich_more"),
    // Drop malformed entries instead of rejecting the whole research payload:
    // one bad URL from a discovery provider used to fail the entire company.
    sourceUrls: z
      .unknown()
      .transform((value) => {
        const items = Array.isArray(value) ? value : [];
        return [
          ...new Set(
            items
              .filter((item): item is string => typeof item === "string")
              .map((item) => item.trim())
              .filter((item) => {
                try {
                  const parsed = new URL(item);
                  return parsed.protocol === "http:" || parsed.protocol === "https:";
                } catch {
                  return false;
                }
              })
          )
        ].slice(0, 10);
      })
  })
  .superRefine((output, ctx) => {
    // A research result with no score is not a weak result, it is no result.
    for (const field of ["fitScore", "confidence"] as const) {
      if (!Number.isFinite(output[field])) {
        ctx.addIssue({ code: "custom", path: [field], message: `${field} is required and must be a number.` });
      }
    }
  })
  .transform((output) => {
    let recommendedNextAction = output.recommendedNextAction;
    if (output.fitScore < 40) recommendedNextAction = "reject";
    if (output.confidence < 60 && recommendedNextAction === "approve_outreach") recommendedNextAction = "enrich_more";
    if (output.fitScore < 70 && recommendedNextAction === "approve_outreach") recommendedNextAction = "enrich_more";
    return { ...output, segment: output.segment || "low_fit", recommendedNextAction };
  });

export type ResearchOutput = z.infer<typeof researchOutputSchema>;

export function parseResearchJson(raw: unknown) {
  if (typeof raw === "string") {
    return researchOutputSchema.parse(JSON.parse(extractFirstJsonObject(raw)));
  }
  return researchOutputSchema.parse(raw);
}
