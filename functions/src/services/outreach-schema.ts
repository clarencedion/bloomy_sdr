import { z } from "zod";
import { extractFirstJsonObject } from "../utils/json-extract.js";

const placeholders = new Set(["", "n/a", "unknown", "null", "-", "--"]);

function normalizeText(value: string) {
  const trimmed = value.trim();
  return placeholders.has(trimmed.toLowerCase()) ? "" : trimmed;
}

const text = (max: number) => z.string().trim().max(max).transform(normalizeText);
const textArray = z.array(text(800)).default([]).transform((items) => items.filter(Boolean).slice(0, 12));

export const outreachOutputSchema = z.object({
  subject: text(160),
  body: text(3000),
  followUp1: text(2000),
  followUp2: text(2000),
  linkedinConnectionNote: text(600),
  linkedinFollowUp: text(1000),
  internalSalesNotes: text(2000),
  suggestedPersona: text(200),
  cta: text(500),
  personalizationNotes: textArray,
  riskWarnings: textArray,
  landingPageDraft: z
    .object({
      headline: text(300).optional(),
      intro: text(1000).optional(),
      whyDevcomm: text(1000).optional(),
      likelyChallenges: textArray.optional(),
      recommendedSupport: textArray.optional(),
      cta: text(500).optional()
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
