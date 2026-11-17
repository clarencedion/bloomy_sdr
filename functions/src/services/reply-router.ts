import { resolveConversationOfferId } from "./conversation-offer.js";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
import { writeLog } from "../utils/logger.js";
import type { ReplyClassification, ReplyDraft, MessageDoc, ConversationDoc } from "../types/domain.js";
import { classifyReply } from "./reply-classifier.js";
import { executeDeterministicUnsubscribe } from "./unsubscribe-handler.js";
import { generateGroundedReply } from "./reply-generator.js";
import { dispatchReplyAccordingToPolicy } from "./reply-dispatcher.js";
import { escalateConversation } from "./human-escalator.js";
import { parseSchedulingIntent } from "./slot-parser.js";
import { proposeOpenSlots } from "./booking-negotiator.js";
import { bookMeetingAtomically } from "./meeting-creator.js";

export interface RouteInboundReplyInput {
  conversationId: string;
  messageId: string;
  leadEmail: string;
  subject?: string;
  bodyText: string;
  workspaceId?: string;
  businessId?: string;
  providerEventType?: string;
  offerId?: string;
  bypassDelay?: boolean;
}

export interface RouteInboundReplyResult {
  classification: ReplyClassification;
  routedAction: string;
  draft?: ReplyDraft;
  policyMode?: string;
  meetingBooked?: boolean;
}

/**
 * Classifies an inbound reply, updates message & conversation documents,
 * generates grounded responses, and executes deterministic unsubscription,
 * scheduling negotiation, atomic booking, human escalation, or autonomous safe dispatch
 * (REQ-063 through REQ-075).
 */
export async function routeInboundReply(
  input: RouteInboundReplyInput
): Promise<RouteInboundReplyResult> {
  const now = Timestamp.now();
  const convRef = adminDb.collection("conversations").doc(input.conversationId);
  const msgRef = convRef.collection("messages").doc(input.messageId);

  // 1. Run Reply Classification (REQ-063, REQ-064)
  const classification = await classifyReply({
    subject: input.subject,
    bodyText: input.bodyText,
    leadEmail: input.leadEmail,
    providerEventType: input.providerEventType,
    workspaceId: input.workspaceId,
    businessId: input.businessId
  });

  // 2. Persist classification on MessageDoc
  await msgRef.set(
    {
      replyClassification: classification
    },
    { merge: true }
  );

  let routedAction = "dialogue_updated";
  let generatedDraft: ReplyDraft | undefined;
  let policyMode: string | undefined;
  let meetingBooked = false;

  // 3. Fast-Path A: Deterministic Unsubscribe (REQ-065)
  if (classification.intent === "UNSUBSCRIBE") {
    await executeDeterministicUnsubscribe({
      leadEmail: input.leadEmail,
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      conversationId: input.conversationId,
      reason: "Prospect requested unsubscribe in email reply"
    });

    await convRef.set(
      {
        status: "suppressed",
        latestIntent: "UNSUBSCRIBE",
        latestObjection: undefined,
        unreadHumanAttention: false,
        updatedAt: now
      },
      { merge: true }
    );
    routedAction = "unsubscribed_and_suppressed";
  }
  // 4. Fast-Path B: Deterministic Out of Office
  else if (classification.intent === "OUT_OF_OFFICE") {
    await convRef.set(
      {
        latestIntent: "OUT_OF_OFFICE",
        unreadHumanAttention: false,
        updatedAt: now
      },
      { merge: true }
    );
    routedAction = "ignored_out_of_office";
  }
  // 5. Fast-Path C: Hostile / Threat / Low Confidence Human Escalation (REQ-069)
  else if (classification.intent === "ANGRY" || classification.requiresHumanAttention || classification.confidence < 0.8) {
    const reason = classification.intent === "ANGRY"
      ? "Hostile sentiment or legal threat detected"
      : classification.confidence < 0.8
        ? `Low intent classification confidence (${Math.round(classification.confidence * 100)}%)`
        : classification.reasoning || "Human attention flagged by classifier";

    await escalateConversation({
      conversationId: input.conversationId,
      reason,
      messageId: input.messageId,
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      leadEmail: input.leadEmail
    });

    await convRef.set(
      {
        latestIntent: classification.intent,
        latestObjection: classification.objectionType || undefined,
        updatedAt: now
      },
      { merge: true }
    );
    routedAction = "escalated_to_human";
  }
  // 6. Conversational Scheduling & Atomic Booking Path (REQ-071 through REQ-075)
  else {
    // Parse scheduling intent
    const schedulingIntent = await parseSchedulingIntent({
      messageText: input.bodyText
    });

    // Load conversation metadata
    let convData: ConversationDoc | undefined;
    let history: MessageDoc[] = [];
    let offerId = input.offerId;

    try {
      const [convSnap, msgsSnap] = await Promise.all([
        convRef.get(),
        convRef.collection("messages").orderBy("sentAt", "asc").get()
      ]);
      history = msgsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as MessageDoc[];
      if (convSnap.exists) {
        convData = convSnap.data() as ConversationDoc;
        offerId = offerId || (await resolveConversationOfferId(convData));
      }
    } catch {
      // safe fallback
    }

    // Path 6A: Prospect confirmed a specific time slot -> Attempt Atomic Booking (REQ-074)
    if (
      (classification.intent === "BOOKING_REQUEST" || classification.intent === "POSITIVE") &&
      schedulingIntent.intentType === "CONFIRM_SLOT" &&
      schedulingIntent.specificSlotRequested
    ) {
      const bookRes = await bookMeetingAtomically({
        workspaceId: input.workspaceId,
        businessId: input.businessId,
        conversationId: input.conversationId,
        contactId: convData?.contactId,
        companyId: convData?.companyId,
        startTime: schedulingIntent.specificSlotRequested.start,
        endTime: schedulingIntent.specificSlotRequested.end,
        prospectEmail: input.leadEmail,
        source: "conversational"
      });

      if (bookRes.success) {
        meetingBooked = true;
        routedAction = "meeting_booked_atomically";

        // Draft confirmation reply
        const confirmationDraft: ReplyDraft = {
          subject: `Re: ${input.subject || "Échange"} - Confirmation du rendez-vous`,
          bodyText: `Bonjour,\n\nC'est parfait, notre rendez-vous est bien confirmé pour le créneau convenu. L'invitation calendrier avec le lien de visio vient de vous être envoyée.\n\nAu plaisir d'échanger prochainement,\nBien cordialement,`,
          citedKnowledgePoints: ["Créneau confirmé"],
          pricingGuardrailPassed: true,
          pricingDisclosed: false,
          prohibitedPromisesChecked: true,
          confidence: 0.98,
          draftedAt: new Date().toISOString(),
          status: "draft"
        };

        const dispatchResult = await dispatchReplyAccordingToPolicy({
          conversationId: input.conversationId,
          draft: confirmationDraft,
          classification,
          workspaceId: input.workspaceId,
          businessId: input.businessId,
          leadEmail: input.leadEmail,
          latestMessageId: input.messageId,
          bypassDelay: input.bypassDelay
        });

        generatedDraft = confirmationDraft;
        policyMode = dispatchResult.policyMode;
      } else if (bookRes.conflict) {
        // Slot taken -> Propose alternative conflict-free open slots (REQ-073)
        const proposal = await proposeOpenSlots({
          workspaceId: input.workspaceId,
          businessId: input.businessId,
          schedulingIntent
        });

        const conflictDraft: ReplyDraft = {
          subject: `Re: ${input.subject || "Échange"}`,
          bodyText: `Bonjour,\n\nCe créneau vient tout juste d'être réservé dans mon agenda. ${proposal.formattedProposalFr}\n\nBien cordialement,`,
          citedKnowledgePoints: ["Créneaux alternatifs proposés"],
          pricingGuardrailPassed: true,
          pricingDisclosed: false,
          prohibitedPromisesChecked: true,
          confidence: 0.9,
          draftedAt: new Date().toISOString(),
          status: "draft"
        };

        const dispatchResult = await dispatchReplyAccordingToPolicy({
          conversationId: input.conversationId,
          draft: conflictDraft,
          classification,
          workspaceId: input.workspaceId,
          businessId: input.businessId,
          leadEmail: input.leadEmail,
          latestMessageId: input.messageId,
          bypassDelay: input.bypassDelay
        });

        generatedDraft = conflictDraft;
        policyMode = dispatchResult.policyMode;
        routedAction = "booking_conflict_alternatives_proposed";
      } else {
        // The prospect confirmed a slot and it could not be booked for any
        // other reason (an unattributed conversation, an invalid time, a
        // calendar error). Silently dropping a positive answer is the worst
        // outcome; a person takes it from here.
        await escalateConversation({
          conversationId: input.conversationId,
          reason: `Prospect confirmed a slot but the meeting could not be booked: ${bookRes.error ?? "unknown error"}`,
          messageId: input.messageId,
          workspaceId: input.workspaceId,
          businessId: input.businessId,
          leadEmail: input.leadEmail
        });
        routedAction = "escalated_to_human";
      }
    }
    // Path 6B: Prospect asks for availability or proposes vague window -> Propose conflict-free slots (REQ-073)
    else if (
      (classification.intent === "BOOKING_REQUEST" || classification.intent === "POSITIVE") &&
      schedulingIntent.hasSchedulingIntent
    ) {
      const proposal = await proposeOpenSlots({
        workspaceId: input.workspaceId,
        businessId: input.businessId,
        schedulingIntent
      });

      const slotDraft: ReplyDraft = {
        subject: `Re: ${input.subject || "Échange"}`,
        bodyText: `Bonjour,\n\nAvec grand plaisir pour échanger ! ${proposal.formattedProposalFr}\n\nBien cordialement,`,
        citedKnowledgePoints: ["Créneaux calendrier proposés"],
        pricingGuardrailPassed: true,
        pricingDisclosed: false,
        prohibitedPromisesChecked: true,
        confidence: 0.92,
        draftedAt: new Date().toISOString(),
        status: "draft"
      };

      const dispatchResult = await dispatchReplyAccordingToPolicy({
        conversationId: input.conversationId,
        draft: slotDraft,
        classification,
        workspaceId: input.workspaceId,
        businessId: input.businessId,
        leadEmail: input.leadEmail,
        latestMessageId: input.messageId,
        bypassDelay: input.bypassDelay
      });

      generatedDraft = slotDraft;
      policyMode = dispatchResult.policyMode;
      routedAction = "calendar_slots_proposed";
    }
    // Path 6C: Standard Grounded Reply Draft (REQ-066, REQ-067, REQ-068)
    else {
      const replyGenResult = await generateGroundedReply({
        workspaceId: input.workspaceId,
        businessId: input.businessId,
        offerId,
        conversationHistory: history,
        latestInboundMessage: {
          subject: input.subject,
          bodyText: input.bodyText,
          senderEmail: input.leadEmail
        },
        classification
      });

      generatedDraft = replyGenResult.draft;

      const dispatchResult = await dispatchReplyAccordingToPolicy({
        conversationId: input.conversationId,
        draft: replyGenResult.draft,
        classification,
        requiresHumanEscalation: replyGenResult.requiresHumanEscalation,
        escalationReason: replyGenResult.escalationReason,
        workspaceId: input.workspaceId,
        businessId: input.businessId,
        leadEmail: input.leadEmail,
        latestMessageId: input.messageId,
        bypassDelay: input.bypassDelay
      });

      policyMode = dispatchResult.policyMode;
      routedAction = dispatchResult.action;
    }

    await convRef.set(
      {
        latestIntent: classification.intent,
        latestObjection: classification.objectionType || undefined,
        updatedAt: now
      },
      { merge: true }
    );
  }

  await writeLog({
    type: "reply.routed",
    level: "info",
    message: `Inbound reply from ${input.leadEmail} processed (Intent: ${classification.intent}) -> Action: ${routedAction}`,
    metadata: {
      conversationId: input.conversationId,
      messageId: input.messageId,
      leadEmail: input.leadEmail,
      intent: classification.intent,
      objectionType: classification.objectionType,
      confidence: classification.confidence,
      routedAction,
      policyMode,
      meetingBooked
    }
  });

  return {
    classification,
    routedAction,
    draft: generatedDraft,
    policyMode,
    meetingBooked
  };
}

