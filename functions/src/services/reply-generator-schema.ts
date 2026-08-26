import { z } from "zod";

export const ReplyDraftOutputSchema = z.object({
  subject: z.string().min(1).default("Re:"),
  bodyText: z.string().min(10),
  citedKnowledgePoints: z.array(z.string()).default([]),
  pricingDisclosed: z.boolean().default(false),
  pricingGuardrailPassed: z.boolean().default(true),
  requiresHumanEscalation: z.boolean().default(false),
  escalationReason: z.string().optional(),
  confidence: z.number().min(0).max(1).default(0.88)
});

export type ReplyDraftOutput = z.infer<typeof ReplyDraftOutputSchema>;

/**
 * Parses and validates structured JSON response from LLM into a validated ReplyDraftOutput.
 */
export function parseReplyDraftJson(raw: unknown): ReplyDraftOutput {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Handle markdown code fence wrapping
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

  const result = ReplyDraftOutputSchema.safeParse(parsed);
  if (!result.success) {
    // Safe fallback if parsing fails
    return {
      subject: "Re: Échange",
      bodyText: "Bonjour,\n\nMerci pour votre retour. Je transmets vos éléments à notre équipe qui reviendra vers vous rapidement avec les informations adaptées.\n\nBien cordialement,",
      citedKnowledgePoints: [],
      pricingDisclosed: false,
      pricingGuardrailPassed: false,
      requiresHumanEscalation: true,
      escalationReason: `Schema parsing fallback: ${result.error.message}`,
      confidence: 0.5
    };
  }

  return result.data;
}
