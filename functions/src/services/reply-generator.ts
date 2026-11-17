import { getAiProvider } from "../providers/ai/index.js";
import { getGlobalSettings, getAiSecrets } from "../utils/settings.js";
import { writeLog } from "../utils/logger.js";
import { recordAiSpend } from "./cost-guardrail-service.js";
import { getBusiness, getKnowledgeBase, listOffers } from "./business-service.js";
import { checkPricingStatements, mentionsCommercialTerms } from "./pricing-guardrail.js";
import { offerNeutralKnowledgeBase } from "./offer-experiment.js";
import { runStructuredAiCall } from "./ai-structured-call.js";
import type { ReplyChannel } from "./reply-classifier-prompts.js";
import { buildReplyGeneratorUserPrompt, getReplyGeneratorSystemPrompt } from "./reply-generator-prompts.js";
import { DmReplyDraftOutputSchema } from "./reply-generator-schema.js";
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
  /** "dm": Instagram / Facebook direct message. Absent = email, unchanged. */
  channel?: ReplyChannel;
  /** DM only: the business's own booking page, which the reply may offer. */
  bookingLink?: string;
}

export interface GeneratedGroundedReplyResult {
  draft: ReplyDraft;
  requiresHumanEscalation: boolean;
  escalationReason?: string;
  /** DM only: every reason to read the draft twice before sending it, one per entry. */
  warnings?: string[];
}

/**
 * A day, date or clock time in a draft. Calendar Truth: the reply generator
 * never sees the calendar, so a DM that names a slot (or accepts the
 * prospect's) promises availability nobody checked. Links are removed first:
 * "cal.com/x/15min" names no slot.
 */
const SPECIFIC_SLOT_PATTERNS = [
  /\b(?:[01]?\d|2[0-3])\s?h(?:eures?)?(?:\s?[0-5]\d)?\b/i,
  /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/,
  /\b(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/i,
  /\b(?:demain|apr[èe]s-demain)\b/i,
  /\b\d{1,2}(?:er)?\s+(?:janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)\b/i
];

export const SPECIFIC_SLOT_WARNING =
  "The draft names a day or time: the calendar was not checked, so offer the booking link instead.";

export function proposesSpecificSlot(text: string): boolean {
  const withoutLinks = String(text ?? "").replace(/https?:\/\/\S+/gi, " ");
  return SPECIFIC_SLOT_PATTERNS.some((pattern) => pattern.test(withoutLinks));
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

  // Every commercial statement is checked against the terms the offer
  // declares, not against a fixed word list: "gratuit" is a fabrication for an
  // offer with a setup fee and the honest headline of one without.
  const pricing = checkPricingStatements(draftText, offer?.pricingGuardrails);
  const pricingGuardrailPassed = pricing.passed;
  for (const violation of pricing.violations) {
    if (!warnings.includes(violation.detail)) warnings.push(violation.detail);
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
  // A direct message has no subject line and gets no canned text: when no
  // model answers, the person writes it.
  const isDm = input.channel === "dm";
  // No fallback business (ADR-016 #6). A conversation nobody can attribute has
  // no offer, no knowledge base and no approved terms to ground a reply in;
  // answering it as some named business would pitch that business's offer to a
  // stranger. A person decides.
  const businessId = input.businessId;
  if (!businessId) {
    await writeLog({
      type: "reply_generator.unattributed",
      level: "warning",
      message: "Reply not drafted: the conversation is not attributed to any business.",
      workspaceId
    });
    return {
      draft: {
        subject: isDm ? "" : `Re: ${input.latestInboundMessage.subject || "Échange"}`,
        bodyText: "",
        citedKnowledgePoints: [],
        pricingGuardrailPassed: true,
        pricingDisclosed: false,
        prohibitedPromisesChecked: true,
        confidence: 0,
        draftedAt: new Date().toISOString(),
        status: "draft"
      },
      requiresHumanEscalation: true,
      escalationReason: "Conversation is not attributed to any business: no offer or knowledge base to ground a reply."
    };
  }

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
    offer = input.offerId
      ? offers.find((o) => o.id === input.offerId) || offers[0] || null
      : offers[0] || null;
    // While the business tests several offers, the knowledge base is shared by
    // all of them: FAQs and pricing rules stating another variant's terms are
    // withheld from this reply's prompt (offer-experiment.ts). No experiment:
    // unchanged.
    kb = offerNeutralKnowledgeBase(kbDoc, bizDoc, offer?.pricingGuardrails) ?? null;
  } catch (err) {
    await writeLog({
      type: "reply_generator.context_fetch_warning",
      level: "warning",
      message: `Failed to fetch business context for ${businessId}: ${err instanceof Error ? err.message : String(err)}`
    });
  }

  // 2. Invoke AI Provider
  let rawDraftSubject = isDm ? "" : `Re: ${input.latestInboundMessage.subject || "Échange"}`;
  let rawDraftBody = isDm ? "" : "Bonjour,\n\nMerci pour votre retour. Nous serions ravis d'échanger avec vous.\n\nBien cordialement,";
  let citedKnowledgePoints: string[] = [];
  let pricingDisclosed = false;
  let pricingGuardrailPassed = true;
  let requiresHumanEscalation = false;
  let escalationReason: string | undefined = undefined;
  let confidence = 0.88;
  // DM only: why the model itself asked for a person, kept apart from the
  // checks below so the operator sees each reason once.
  let modelEscalationReason: string | undefined;

  if (isDm) {
    // Through the structured call, not `provider.generateReply`: that method
    // hard-wires the email prompts, and its parser answers a malformed reply
    // with a canned email body. Here a failure leaves the body empty.
    try {
      const result = await runStructuredAiCall({
        operation: "social_reply_generation",
        system: getReplyGeneratorSystemPrompt("dm"),
        user: buildReplyGeneratorUserPrompt({
          business,
          offer,
          knowledgeBase: kb,
          personalizationFacts: input.personalizationFacts,
          conversationHistory: input.conversationHistory || [],
          latestInboundMessage: input.latestInboundMessage,
          classification: input.classification,
          channel: "dm",
          bookingLink: input.bookingLink
        }),
        schema: DmReplyDraftOutputSchema,
        maxTokens: 1000,
        temperature: 0.2,
        workspaceId,
        businessId
      });
      // The subject is dropped whatever the model put in it: a DM has none,
      // so nothing in it would ever reach the prospect.
      rawDraftBody = result.output.bodyText.trim();
      citedKnowledgePoints = result.output.citedKnowledgePoints;
      pricingDisclosed = result.output.pricingDisclosed;
      pricingGuardrailPassed = result.output.pricingGuardrailPassed;
      requiresHumanEscalation = result.output.requiresHumanEscalation;
      escalationReason = result.output.escalationReason;
      modelEscalationReason = requiresHumanEscalation ? escalationReason : undefined;
      confidence = result.output.confidence;
    } catch (err) {
      await writeLog({
        type: "reply_generator.ai_error",
        level: "warning",
        message: `AI direct-message reply failed, no draft written: ${err instanceof Error ? err.message : String(err)}`,
        workspaceId,
        businessId,
        metadata: { channel: "dm" }
      }).catch(() => undefined);
      requiresHumanEscalation = true;
      escalationReason = `AI reply generation error: ${err instanceof Error ? err.message : String(err)}`;
    }
  } else {
    const [settings, secrets] = await Promise.all([getGlobalSettings(), getAiSecrets()]);
    const aiProvider = getAiProvider(settings, secrets);

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

        await recordAiSpend({
          workspaceId,
          businessId,
          provider: result.provider,
          model: result.model,
          operation: "reply_generation",
          usage: {
            inputTokens: result.estimatedInputTokens,
            outputTokens: result.estimatedOutputTokens
          }
        }).catch(() => undefined);

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
  }

  // 3. Factual Grounding & Pricing Guardrails Validation Pass (REQ-067)
  // Subject included: a price or a free month in the subject line is sent too —
  // unless it is just "Re: <the prospect's own subject>", which states nothing.
  // A DM has no subject line: only its body is ever sent.
  const echoedSubject = rawDraftSubject.trim() === `Re: ${input.latestInboundMessage.subject ?? ""}`.trim();
  const validation = validateReplyGroundedness(
    isDm || echoedSubject ? rawDraftBody : `${rawDraftSubject}\n${rawDraftBody}`,
    offer,
    kb
  );
  if (!validation.passed) {
    pricingGuardrailPassed = validation.pricingGuardrailPassed;
    requiresHumanEscalation = true;
    escalationReason = escalationReason || (validation.prohibitedPromisesDetected.length > 0
      ? `Prohibited promises detected: ${validation.prohibitedPromisesDetected.join(", ")}`
      : validation.warnings.join("; "));
  }

  let warnings: string[] | undefined;
  if (isDm) {
    const namesSlot = proposesSpecificSlot(rawDraftBody);
    if (namesSlot) {
      requiresHumanEscalation = true;
      escalationReason = escalationReason || SPECIFIC_SLOT_WARNING;
    }
    const reasons = rawDraftBody
      ? [
          modelEscalationReason,
          ...validation.prohibitedPromisesDetected.map((promise) => `Prohibited promise: ${promise}`),
          ...validation.warnings,
          namesSlot ? SPECIFIC_SLOT_WARNING : undefined
        ]
      : [escalationReason];
    warnings = [...new Set(reasons.filter((reason): reason is string => Boolean(reason?.trim())))];
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
    status: "draft",
    // The same detector the autonomous email gate uses; for a DM it only
    // informs the person who sends it.
    ...(isDm ? { mentionsCommercialTerms: mentionsCommercialTerms(rawDraftBody) } : {})
  };

  return {
    draft,
    requiresHumanEscalation,
    escalationReason,
    ...(warnings ? { warnings } : {})
  };
}
