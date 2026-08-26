import { getAiProvider } from "../providers/ai/index.js";
import { getGlobalSettings, getAiSecrets } from "../utils/settings.js";
import { writeLog } from "../utils/logger.js";
import { getBusiness, getKnowledgeBase, listOffers } from "./business-service.js";
import type {
  ReplyDraft,
  ReplyClassification,
  MessageDoc,
  BusinessDoc,
  OfferDoc,
  KnowledgeBaseDoc,
  PersonalizationFact
} from "../types/domain.js";

export interface GenerateGroundedReplyInput {
  workspaceId?: string;
  businessId?: string;
  offerId?: string;
  conversationHistory?: MessageDoc[];
  latestInboundMessage: {
    subject?: string;
    bodyText: string;
    senderEmail?: string;
  };
  classification?: ReplyClassification;
  personalizationFacts?: PersonalizationFact[];
}

export interface GeneratedGroundedReplyResult {
  draft: ReplyDraft;
  requiresHumanEscalation: boolean;
  escalationReason?: string;
}

/**
 * Validates the draft response against pricing guardrails and prohibited promises (REQ-066, REQ-067).
 */
export function validateReplyGroundedness(
  draftText: string,
  offer?: OfferDoc | null,
  kb?: KnowledgeBaseDoc | null
): {
  passed: boolean;
  prohibitedPromisesDetected: string[];
  pricingGuardrailPassed: boolean;
  warnings: string[];
} {
  const normalized = draftText.toLowerCase();
  const prohibitedDetected: string[] = [];
  const warnings: string[] = [];

  const allProhibited = [
    ...(offer?.prohibitedPromises || []),
    ...(kb?.prohibitedPromises || [])
  ];

  for (const promise of allProhibited) {
    if (promise && normalized.includes(promise.toLowerCase())) {
      prohibitedDetected.push(promise);
    }
  }

  // Check pricing rules
  let pricingGuardrailPassed = true;
  const guardrails = offer?.pricingGuardrails;

  // If draft mentions aggressive discounts or free promises
  if (
    normalized.includes("50% de remise") ||
    normalized.includes("50% de réduction") ||
    normalized.includes("gratuitement") ||
    normalized.includes("offert sans condition")
  ) {
    pricingGuardrailPassed = false;
    warnings.push("Unapproved discount or free offer detected in draft copy");
  }

  // If pricing is disclosed but forbidden by guardrails
  if (!guardrails?.canDiscloseInColdReply) {
    const mentionsNumericPrice = /\b\d{3,6}\s*(?:€|euros?)\b/i.test(normalized);
    if (mentionsNumericPrice) {
      pricingGuardrailPassed = false;
      warnings.push("Price figure disclosed when canDiscloseInColdReply is false");
    }
  }

  const passed = prohibitedDetected.length === 0 && pricingGuardrailPassed;

  return {
    passed,
    prohibitedPromisesDetected: prohibitedDetected,
    pricingGuardrailPassed,
    warnings
  };
}

/**
 * Generates an AI reply draft grounded in KnowledgeBase and Offer proof points (REQ-066, REQ-067).
 */
export async function generateGroundedReply(
  input: GenerateGroundedReplyInput
): Promise<GeneratedGroundedReplyResult> {
  const workspaceId = input.workspaceId || "ws_default";
  const businessId = input.businessId || "biz_devcomm";

  // 1. Fetch Business, Offers, and KnowledgeBase context
  let business: BusinessDoc | null = null;
  let kb: KnowledgeBaseDoc | null = null;
  let offer: OfferDoc | null = null;

  try {
    const [bizDoc, kbDoc, offers] = await Promise.all([
      getBusiness(workspaceId, businessId),
      getKnowledgeBase(workspaceId, businessId),
      listOffers(workspaceId, businessId)
    ]);
    business = bizDoc;
    kb = kbDoc;
    offer = input.offerId
      ? offers.find((o) => o.id === input.offerId) || offers[0] || null
      : offers[0] || null;
  } catch (err) {
    await writeLog({
      type: "reply_generator.context_fetch_warning",
      level: "warning",
      message: `Failed to fetch business context for ${businessId}: ${err instanceof Error ? err.message : String(err)}`
    });
  }

  // 2. Invoke AI Provider
  const [settings, secrets] = await Promise.all([getGlobalSettings(), getAiSecrets()]);
  const aiProvider = getAiProvider(settings, secrets);

  let rawDraftSubject = `Re: ${input.latestInboundMessage.subject || "Échange"}`;
  let rawDraftBody = "Bonjour,\n\nMerci pour votre retour. Nous serions ravis d'échanger avec vous.\n\nBien cordialement,";
  let citedKnowledgePoints: string[] = [];
  let pricingDisclosed = false;
  let pricingGuardrailPassed = true;
  let requiresHumanEscalation = false;
  let escalationReason: string | undefined = undefined;
  let confidence = 0.88;

  if (typeof aiProvider.generateReply === "function") {
    try {
      const result = await aiProvider.generateReply({
        business,
        offer,
        knowledgeBase: kb,
        personalizationFacts: input.personalizationFacts,
        conversationHistory: input.conversationHistory || [],
        latestInboundMessage: input.latestInboundMessage,
        classification: input.classification,
        settings
      });

      rawDraftSubject = result.output.subject;
      rawDraftBody = result.output.bodyText;
      citedKnowledgePoints = result.output.citedKnowledgePoints;
      pricingDisclosed = result.output.pricingDisclosed;
      pricingGuardrailPassed = result.output.pricingGuardrailPassed;
      requiresHumanEscalation = result.output.requiresHumanEscalation;
      escalationReason = result.output.escalationReason;
      confidence = result.output.confidence;
    } catch (err) {
      await writeLog({
        type: "reply_generator.ai_error",
        level: "warning",
        message: `AI generateReply failed, using fallback draft: ${err instanceof Error ? err.message : String(err)}`
      });
      requiresHumanEscalation = true;
      escalationReason = `AI reply generation error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // 3. Factual Grounding & Pricing Guardrails Validation Pass (REQ-067)
  const validation = validateReplyGroundedness(rawDraftBody, offer, kb);
  if (!validation.passed) {
    pricingGuardrailPassed = validation.pricingGuardrailPassed;
    requiresHumanEscalation = true;
    escalationReason = escalationReason || (validation.prohibitedPromisesDetected.length > 0
      ? `Prohibited promises detected: ${validation.prohibitedPromisesDetected.join(", ")}`
      : validation.warnings.join("; "));
  }

  const draft: ReplyDraft = {
    subject: rawDraftSubject,
    bodyText: rawDraftBody,
    citedKnowledgePoints,
    pricingGuardrailPassed,
    pricingDisclosed,
    prohibitedPromisesChecked: true,
    confidence,
    draftedAt: new Date().toISOString(),
    status: "draft"
  };

  return {
    draft,
    requiresHumanEscalation,
    escalationReason
  };
}
