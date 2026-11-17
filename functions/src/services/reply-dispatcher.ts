import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
import { resolveSenderEmail } from "./sender-resolver.js";
import { writeLog } from "../utils/logger.js";
import { getBusiness } from "./business-service.js";
import { escalateConversation } from "./human-escalator.js";
import { mentionsCommercialTerms } from "./pricing-guardrail.js";
import { getReplyTransport } from "./reply-transport.js";
import { deliverReply, undeliveredReplyNotice } from "./reply-delivery.js";
import type {
  ReplyDraft,
  ReplyClassification,
  ConversationDoc,
  MessageDoc
} from "../types/domain.js";

export interface DispatchReplyInput {
  conversationId: string;
  draft: ReplyDraft;
  classification?: ReplyClassification;
  requiresHumanEscalation?: boolean;
  escalationReason?: string;
  workspaceId?: string;
  businessId?: string;
  leadEmail?: string;
  latestMessageId?: string;
  bypassDelay?: boolean;
}

export type DispatchAction =
  | "auto_dispatched"
  | "queued_for_human_review"
  | "queued_for_one_click_approval"
  | "escalated_to_human";

export interface DispatchReplyResult {
  action: DispatchAction;
  policyMode: "manual" | "assisted" | "autonomous_safe";
  draft: ReplyDraft;
  autoSendScheduledFor?: string;
  outboundMessageId?: string;
}

const SAFE_INTENTS = ["QUESTION", "OBJECTION", "POSITIVE", "BOOKING_REQUEST"];

/**
 * Dispatches or queues AI reply drafts based on the Business Automation Policy (REQ-068).
 */
export async function dispatchReplyAccordingToPolicy(
  input: DispatchReplyInput
): Promise<DispatchReplyResult> {
  const workspaceId = input.workspaceId || "ws_default";
  // No fallback business (ADR-016 #6): an unattributed conversation stays in
  // manual mode, because no business ever chose an autonomy level for it.
  const businessId = input.businessId;
  const now = Timestamp.now();
  const convRef = adminDb.collection("conversations").doc(input.conversationId);

  // 1. Fetch Business automation policy
  let policyMode: "manual" | "assisted" | "autonomous_safe" = "manual";
  let autoReplySafeThreshold = 0.85;

  try {
    const business = businessId ? await getBusiness(workspaceId, businessId) : null;
    if (business?.automationPolicy) {
      policyMode = business.automationPolicy.mode || "manual";
      autoReplySafeThreshold = business.automationPolicy.autoReplySafeThreshold ?? 0.85;
    }
  } catch (err) {
    await writeLog({
      type: "dispatcher.policy_fetch_warning",
      level: "warning",
      message: `Failed to fetch policy for ${businessId}, defaulting to MANUAL mode: ${err instanceof Error ? err.message : String(err)}`
    });
  }

  // 2. Immediate Escalation Check
  if (input.requiresHumanEscalation) {
    const reason = input.escalationReason || "Human escalation required by draft guardrails";
    await escalateConversation({
      conversationId: input.conversationId,
      reason,
      messageId: input.latestMessageId,
      workspaceId,
      businessId,
      leadEmail: input.leadEmail
    });

    const draftWithStatus: ReplyDraft = {
      ...input.draft,
      status: "queued_for_approval"
    };

    await convRef.set(
      {
        draftResponse: draftWithStatus,
        updatedAt: now
      },
      { merge: true }
    );

    return {
      action: "escalated_to_human",
      policyMode,
      draft: draftWithStatus
    };
  }

  // 3. Evaluate Policy Mode

  // --- MODE A: MANUAL ---
  if (policyMode === "manual") {
    const draftWithStatus: ReplyDraft = {
      ...input.draft,
      status: "queued_for_approval"
    };

    await convRef.set(
      {
        status: "in_dialogue",
        draftResponse: draftWithStatus,
        unreadHumanAttention: true,
        humanAttentionRequired: true,
        updatedAt: now
      },
      { merge: true }
    );

    await writeLog({
      type: "reply.queued_manual",
      level: "info",
      message: `Reply draft for ${input.conversationId} queued for manual SDR review (Policy: MANUAL)`,
      metadata: { conversationId: input.conversationId, leadEmail: input.leadEmail }
    });

    return {
      action: "queued_for_human_review",
      policyMode: "manual",
      draft: draftWithStatus
    };
  }

  // --- MODE B: ASSISTED ---
  if (policyMode === "assisted") {
    const draftWithStatus: ReplyDraft = {
      ...input.draft,
      status: "queued_for_approval"
    };

    await convRef.set(
      {
        status: "in_dialogue",
        draftResponse: draftWithStatus,
        unreadHumanAttention: true,
        humanAttentionRequired: true,
        updatedAt: now
      },
      { merge: true }
    );

    await writeLog({
      type: "reply.queued_assisted",
      level: "info",
      message: `Reply draft for ${input.conversationId} queued for 1-click SDR approval (Policy: ASSISTED)`,
      metadata: { conversationId: input.conversationId, leadEmail: input.leadEmail }
    });

    return {
      action: "queued_for_one_click_approval",
      policyMode: "assisted",
      draft: draftWithStatus
    };
  }

  // --- MODE C: AUTONOMOUS_SAFE (REQ-068) ---
  const confidence = input.draft.confidence;
  const isConfidenceSafe = confidence >= autoReplySafeThreshold;
  const isIntentSafe = input.classification?.intent ? SAFE_INTENTS.includes(input.classification.intent) : true;
  const areGuardrailsPassed = input.draft.pricingGuardrailPassed && input.draft.prohibitedPromisesChecked;
  // Fail-closed by design (ADR-019): a reply the broad commercial-vocabulary
  // heuristic flags is confirmed by a person. The heuristic can miss wordings;
  // the lasting guarantee is that unattended commercial text is written by code.
  // The pricing check above is a detector of known misstatements, not a gate.
  const mentionsCommercial = mentionsCommercialTerms(`${input.draft.subject}\n${input.draft.bodyText}`);
  // Nothing is marked sent unless something can actually send it.
  const transport = await getReplyTransport({ workspaceId, businessId });

  if (isConfidenceSafe && isIntentSafe && areGuardrailsPassed && !mentionsCommercial && transport) {
    // Auto-dispatch response
    const msgId = `msg_out_auto_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const scheduledDelayMinutes = input.bypassDelay ? 0 : 10;
    const scheduledTime = new Date(Date.now() + scheduledDelayMinutes * 60 * 1000).toISOString();

    const draftWithStatus: ReplyDraft = {
      ...input.draft,
      status: "auto_dispatched",
      autoSendScheduledFor: scheduledTime,
      sentAt: new Date().toISOString(),
      sentMessageId: msgId
    };

    const senderEmail = await resolveSenderEmail({ workspaceId, businessId });
    const recipientEmail = input.leadEmail || "";
    // Delivered first (suppression re-checked inside); recorded as sent only
    // once the provider accepted it.
    const conversationSnap = await convRef.get();
    const delivery = await deliverReply({
      workspaceId,
      businessId,
      conversationId: input.conversationId,
      contactId: (conversationSnap.data() as ConversationDoc | undefined)?.contactId,
      to: recipientEmail,
      from: senderEmail,
      subject: input.draft.subject,
      bodyText: input.draft.bodyText
    });
    if (!delivery.delivered) {
      await escalateConversation({
        conversationId: input.conversationId,
        reason: undeliveredReplyNotice(delivery),
        messageId: input.latestMessageId,
        workspaceId,
        businessId,
        leadEmail: input.leadEmail
      });
      const heldDraft: ReplyDraft = { ...input.draft, status: "queued_for_approval" };
      await convRef.set({ draftResponse: heldDraft, updatedAt: now }, { merge: true });
      return { action: "escalated_to_human", policyMode: "autonomous_safe", draft: heldDraft };
    }

    // Store outbound message
    const outboundMessage: MessageDoc = {
      id: msgId,
      conversationId: input.conversationId,
      direction: "outbound",
      senderEmail,
      recipientEmail,
      subject: input.draft.subject,
      bodyText: input.draft.bodyText,
      providerMessageId: delivery.providerMessageId,
      sentAt: now
    };

    await convRef.collection("messages").doc(msgId).set(outboundMessage);

    await convRef.set(
      {
        status: "in_dialogue",
        draftResponse: draftWithStatus,
        unreadHumanAttention: false,
        humanAttentionRequired: false,
        lastMessageAt: now,
        updatedAt: now
      },
      { merge: true }
    );

    // Increment messageCount atomically or safe update
    const convSnap = await convRef.get();
    if (convSnap.exists) {
      const curCount = (convSnap.data() as ConversationDoc).messageCount || 0;
      await convRef.set({ messageCount: curCount + 1 }, { merge: true });
    }

    await writeLog({
      type: "reply.auto_dispatched",
      level: "info",
      message: `Safe auto-reply dispatched to ${input.leadEmail || "lead"} (Confidence: ${Math.round(confidence * 100)}%, Policy: AUTONOMOUS_SAFE)`,
      metadata: {
        conversationId: input.conversationId,
        outboundMessageId: msgId,
        leadEmail: input.leadEmail,
        confidence,
        intent: input.classification?.intent,
        citedKnowledgePoints: input.draft.citedKnowledgePoints
      }
    });

    return {
      action: "auto_dispatched",
      policyMode: "autonomous_safe",
      draft: draftWithStatus,
      autoSendScheduledFor: scheduledTime,
      outboundMessageId: msgId
    };
  }

  // If safety criteria not met under AUTONOMOUS_SAFE, escalate to human
  const escalationReason = !transport
    ? "Replies are not sent by the SDR yet: answer this one from your mailbox (Instantly Unibox)."
    : mentionsCommercial
      ? "The reply mentions price, free items, discounts or commitment: a person confirms these before sending."
      : `Autonomous safe threshold not met (Confidence: ${confidence}, Threshold: ${autoReplySafeThreshold}, Guardrails: ${areGuardrailsPassed})`;
  await escalateConversation({
    conversationId: input.conversationId,
    reason: escalationReason,
    messageId: input.latestMessageId,
    workspaceId,
    businessId,
    leadEmail: input.leadEmail
  });

  const fallbackDraft: ReplyDraft = {
    ...input.draft,
    status: "queued_for_approval"
  };

  await convRef.set(
    {
      draftResponse: fallbackDraft,
      updatedAt: now
    },
    { merge: true }
  );

  return {
    action: "escalated_to_human",
    policyMode: "autonomous_safe",
    draft: fallbackDraft
  };
}
