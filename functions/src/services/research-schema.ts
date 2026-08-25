import { z } from "zod";
import { extractFirstJsonObject } from "../utils/json-extract.js";

const placeholders = new Set(["", "n/a", "unknown", "null", "-", "--"]);

function normalizeText(value: string) {
  const trimmed = value.trim();
  return placeholders.has(trimmed.toLowerCase()) ? "" : trimmed;
}

const cleanString = z.string().trim().max(4000).transform(normalizeText);

const cleanStringArray = z.array(cleanString).default([]).transform((items) => items.filter(Boolean).slice(0, 12));

export const researchOutputSchema = z
  .object({
    companySummary: cleanString,
    segment: z.string().trim().max(100).transform(normalizeText).default("low_fit"),
    fitScore: z.number().min(0).max(100),
    confidence: z.number().min(0).max(100),
    detectedNeeds: cleanStringArray,
    painPoints: cleanStringArray,
    buyingTriggers: cleanStringArray,
    bestDevcommOffer: z.string().trim().max(1000).transform(normalizeText),
    targetPersonas: cleanStringArray,
    personalizedAngle: z.string().trim().max(1500).transform(normalizeText),
    reasoningSummary: z.string().trim().max(1500).transform(normalizeText),
    risks: cleanStringArray,
    recommendedNextAction: z.enum(["approve_outreach", "enrich_more", "reject"]),
    sourceUrls: z.array(z.string().trim().url()).default([]).transform((items) => [...new Set(items)].slice(0, 10))
  })
  .transform((output) => {
    let recommendedNextAction = output.recommendedNextAction;
    if (output.fitScore < 40) recommendedNextAction = "reject";
    if (output.confidence < 60 && recommendedNextAction === "approve_outreach") recommendedNextAction = "enrich_more";
    if (output.fitScore < 70 && recommendedNextAction === "approve_outreach") recommendedNextAction = "enrich_more";
    return { ...output, recommendedNextAction };
  });

export type ResearchOutput = z.infer<typeof researchOutputSchema>;

export function parseResearchJson(raw: unknown) {
  if (typeof raw === "string") {
    return researchOutputSchema.parse(JSON.parse(extractFirstJsonObject(raw)));
  }
  return researchOutputSchema.parse(raw);
}
