import { z } from "zod";

export const ReplyIntentSchema = z.enum([
  "POSITIVE",
  "BOOKING_REQUEST",
  "QUESTION",
  "OBJECTION",
  "UNSUBSCRIBE",
  "OUT_OF_OFFICE",
  "WRONG_PERSON",
  "ANGRY",
  "NEUTRAL",
  "UNCLEAR"
]);

export const ObjectionTypeSchema = z.enum([
  "PRICE",
  "EXISTING_PROVIDER",
  "NO_BUDGET",
  "NOT_PRIORITY",
  "BAD_TIMING",
  "NO_TIME",
  "OTHER"
]);

export const ReplyClassificationSchema = z.object({
  intent: ReplyIntentSchema,
  objectionType: ObjectionTypeSchema.optional(),
  confidence: z.number().min(0).max(1).default(0.85),
  detectedQuestions: z.array(z.string()).default([]),
  suggestedAction: z.string().default("none"),
  reasoning: z.string().default(""),
  requiresHumanAttention: z.boolean().default(false)
});

export type ReplyClassificationOutput = z.infer<typeof ReplyClassificationSchema>;

/**
 * Validates and normalizes raw JSON string or object from LLM into typed ReplyClassification.
 */
export function parseReplyClassificationJson(raw: unknown): ReplyClassificationOutput {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      // If LLM returned text wrapped in markdown code fence
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[1]);
        } catch {
          // fallback below
        }
      }
    }
  }

  const result = ReplyClassificationSchema.safeParse(parsed);
  if (!result.success) {
    // Fallback safe classification
    return {
      intent: "UNCLEAR",
      confidence: 0.5,
      detectedQuestions: [],
      suggestedAction: "pause_sequence_escalate",
      reasoning: `Schema validation fallback: ${result.error.message}`,
      requiresHumanAttention: true
    };
  }

  return result.data;
}
