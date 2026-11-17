import { z } from "zod";
import { extractFirstJsonObject } from "../utils/json-extract.js";
import { boundedText, boundedTextArray, requiredText } from "../utils/ai-schema.js";

const textArray = boundedTextArray(800);

/**
 * Bounded by truncation, not rejection.
 *
 * `body` is the only universal field. Everything else is email furniture: a
 * direct message has no subject line, no follow-up sequence and no LinkedIn
 * variants, so requiring them would reject a perfectly good DM. And a body that
 * runs a few characters past its cap is trimmed rather than discarded - the cap
 * protects storage and display, which truncation satisfies completely.
 */
export const outreachOutputSchema = z.object({
  body: requiredText(3000),
  subject: boundedText(160),
  followUp1: boundedText(2000),
  followUp2: boundedText(2000),
  linkedinConnectionNote: boundedText(600),
  linkedinFollowUp: boundedText(1000),
  internalSalesNotes: boundedText(2000),
  // The model sometimes writes a sentence here rather than a title.
  suggestedPersona: boundedText(400),
  cta: boundedText(500),
  personalizationNotes: textArray,
  riskWarnings: textArray,
  landingPageDraft: z
    .object({
      headline: boundedText(300).optional(),
      intro: boundedText(1000).optional(),
      whyUs: boundedText(1000).optional(),
      // Legacy name kept so previously generated drafts still validate.
      whyDevcomm: boundedText(1000).optional(),
      likelyChallenges: textArray.optional(),
      recommendedSupport: textArray.optional(),
      cta: boundedText(500).optional()
    })
    .optional()
});

export type OutreachOutput = z.infer<typeof outreachOutputSchema>;

export function parseOutreachJson(raw: unknown) {
  if (typeof raw === "string") {
    return outreachOutputSchema.parse(JSON.parse(extractFirstJsonObject(raw)));
  }
  return outreachOutputSchema.parse(raw);
}
