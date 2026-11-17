import { deliverReply, undeliveredReplyNotice } from "./reply-delivery.js";
import { resolveConversationOfferId } from "./conversation-offer.js";
import { Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { adminDb } from "../config/firebase.js";
import { resolveSenderEmail } from "./sender-resolver.js";
import { writeLog } from "../utils/logger.js";
import type { ConversationDoc, MessageDoc, ReplyClassification } from "../types/domain.js";
import { htmlToPlainText, sanitizeHtml } from "./html-sanitizer.js";
import { routeInboundReply } from "./reply-router.js";
import { executeDeterministicUnsubscribe } from "./unsubscribe-handler.js";

export type CreateConversationInput = {
  outreachId: string;
  companyId: string;
  contactId: string;
  workspaceId?: string;
  businessId?: string;
  campaignId?: string;
  opportunityId?: string;
  subject: string;
  bodyText: string;
  senderEmail: string;
  recipientEmail: string;
  instantlyLeadId?: string;
  assignedRepUserId?: string;
};

export type InboundReplyInput = {
  leadEmail: string;
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  providerMessageId?: string;
  campaignId?: string;
  workspaceId?: string;
  businessId?: string;
  uniboxUrl?: string;
};

export type WebhookStatusUpdateInput = {
  leadEmail: string;
  reason?: string;
  campaignId?: string;
  workspaceId?: string;
  businessId?: string;
};

const SOCIAL_NETWORK_NAMES = { instagram: "Instagram", facebook: "Facebook" } as const;

/**
 * Why a reply cannot leave from the web app, or null when it can.
 *
 * An Instagram or Facebook conversation is answered from the owner's local
 * session (Phase 23), never from here: the web path would look for an email
 * address the prospect never gave, then either refuse with a misleading
 * "suppressed" or record a reply that nobody sends. An HttpsError carries the
 * message to the Inbox instead of a bare "internal".
 */
export function socialWebSendRefusal(conversation: Pick<ConversationDoc, "channel">): string | null {
  const channel = conversation.channel;
  if (channel !== "instagram" && channel !== "facebook") return null;
  return `Cette conversation se poursuit sur ${SOCIAL_NETWORK_NAMES[channel]} : envoie la réponse depuis ta session (npm run social:inbox).`;
}

/** The business a company was discovered for, if it has one. */
async function resolveCompanyBusinessId(companyId?: string): Promise<string | undefined> {
  if (!companyId) return undefined;
  const snap = await adminDb.collection("companies").doc(companyId).get().catch(() => null);
  return snap?.exists ? (snap.data()?.businessId as string | undefined) || undefined : undefined;
}

/**
 * Initializes or updates a Conversation thread when an outbound outreach is sent (REQ-062).
 */
export async function createOrUpdateConversationFromOutreach(
  input: CreateConversationInput
): Promise<{ conversationId: string; messageId: string }> {
  const conversationId = `conv_${input.companyId}_${input.contactId}`;
  const convRef = adminDb.collection("conversations").doc(conversationId);
  const now = Timestamp.now();

  const convSnap = await convRef.get();
  const existing = convSnap.exists ? (convSnap.data() as ConversationDoc) : null;

  const conversationData: ConversationDoc = {
    id: conversationId,
    workspaceId: input.workspaceId || existing?.workspaceId || "ws_default",
    businessId: input.businessId || existing?.businessId || (await resolveCompanyBusinessId(input.companyId)),
    campaignId: input.campaignId || existing?.campaignId,
    opportunityId: input.opportunityId || existing?.opportunityId,
    companyId: input.companyId,
    contactId: input.contactId,
    outreachId: input.outreachId,
    status: "sequence_active",
    instantlyLeadId: input.instantlyLeadId || existing?.instantlyLeadId,
    assignedRepUserId: input.assignedRepUserId || existing?.assignedRepUserId,
    unreadHumanAttention: false,
    messageCount: (existing?.messageCount || 0) + 1,
    lastMessageAt: now,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };

  await convRef.set(conversationData, { merge: true });

  const messageId = `msg_out_${input.outreachId}_${Date.now()}`;
  const messageData: MessageDoc = {
    id: messageId,
    conversationId,
    direction: "outbound",
    senderEmail: input.senderEmail,
    recipientEmail: input.recipientEmail,
    subject: input.subject,
    bodyText: input.bodyText,
    providerMessageId: input.instantlyLeadId,
    sentAt: now
  };

  await convRef.collection("messages").doc(messageId).set(messageData);

  return { conversationId, messageId };
}

/**
 * Ingests an inbound reply webhook, updates conversation state, and stores full email body (REQ-059 & REQ-062).
 */
export async function recordInboundReply(
  input: InboundReplyInput
): Promise<{
  conversationId: string;
  messageId: string;
  contactId?: string;
  companyId?: string;
  classification?: ReplyClassification;
  routedAction?: string;
}> {
  const normalizedEmail = input.leadEmail.toLowerCase().trim();
  const now = Timestamp.now();

  // 1. Locate contact by email
  let contactSnap = await adminDb
    .collection("contacts")
    .where("normalizedEmail", "==", normalizedEmail)
    .limit(1)
    .get();

  if (contactSnap.empty) {
    contactSnap = await adminDb
      .collection("contacts")
      .where("email", "==", input.leadEmail)
      .limit(1)
      .get();
  }

  let contactId = contactSnap.empty ? undefined : contactSnap.docs[0].id;
  const contactData = contactSnap.empty ? undefined : contactSnap.docs[0].data();
  let companyId = contactData?.companyId as string | undefined;

  // 2. Fallback: try to find company by domain if contact not found
  if (!companyId && normalizedEmail.includes("@")) {
    const domain = normalizedEmail.split("@")[1];
    const companySnap = await adminDb
      .collection("companies")
      .where("domain", "==", domain)
      .limit(1)
      .get();
    if (!companySnap.empty) {
      companyId = companySnap.docs[0].id;
    }
  }

  // Attribution comes from the records the reply can be tied to — the contact,
  // then its company — never from a default business (ADR-016 #6).
  let companyScope: { workspaceId?: string; businessId?: string } = {};
  if (companyId && (!contactData?.businessId || !contactData?.workspaceId)) {
    const companyDoc = await adminDb.collection("companies").doc(companyId).get().catch(() => null);
    const data = companyDoc?.exists ? companyDoc.data() : undefined;
    companyScope = {
      workspaceId: data?.workspaceId as string | undefined,
      businessId: data?.businessId as string | undefined
    };
  }

  // 3. Fallback: Create placeholder contact if needed
  if (!contactId && companyId) {
    const newContactRef = adminDb.collection("contacts").doc();
    contactId = newContactRef.id;
    await newContactRef.set({
      id: contactId,
      // Tenant-stamped like every other contact; an unstamped one renders
      // under every business at once.
      workspaceId: input.workspaceId || companyScope.workspaceId || "ws_default",
      ...(input.businessId || companyScope.businessId ? { businessId: input.businessId || companyScope.businessId } : {}),
      companyId,
      email: input.leadEmail,
      normalizedEmail,
      status: "replied",
      qualityScore: 70,
      dataQualityWarnings: [],
      createdAt: now,
      updatedAt: now
    });
  }

  // 4. Find or create conversation
  let conversationId = contactId && companyId ? `conv_${companyId}_${contactId}` : `conv_email_${normalizedEmail.replace(/[^a-zA-Z0-9]/g, "_")}`;
  const convRef = adminDb.collection("conversations").doc(conversationId);
  const convSnap = await convRef.get();
  const existingConv = convSnap.exists ? (convSnap.data() as ConversationDoc) : null;

  const workspaceId =
    input.workspaceId || contactData?.workspaceId || companyScope.workspaceId || existingConv?.workspaceId || "ws_default";
  // Undefined when nothing ties the reply to a business. Downstream that means
  // manual mode and a human draft, never another business's offer.
  const businessId: string | undefined =
    input.businessId || contactData?.businessId || companyScope.businessId || existingConv?.businessId || undefined;

  const sanitizedHtml = sanitizeHtml(input.bodyHtml);
  const cleanBodyText = input.bodyText?.trim() || htmlToPlainText(input.bodyHtml) || "(No text content)";

  const conversationData: Partial<ConversationDoc> = {
    id: conversationId,
    workspaceId,
    businessId,
    // A business-scoped Inbox query can never match a missing businessId, so
    // an unattributed reply is flagged to be listed under every business
    // rather than under none.
    needsAttribution: !businessId,
    companyId: companyId || existingConv?.companyId || "unknown_company",
    contactId: contactId || existingConv?.contactId || "unknown_contact",
    campaignId: input.campaignId || existingConv?.campaignId,
    status: "in_dialogue",
    unreadHumanAttention: true,
    messageCount: (existingConv?.messageCount || 0) + 1,
    lastMessageAt: now,
    updatedAt: now
  };

  if (!existingConv) {
    conversationData.createdAt = now;
  }

  await convRef.set(conversationData, { merge: true });

  // 5. Append inbound message document
  const messageId = `msg_in_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const messageData: MessageDoc = {
    id: messageId,
    conversationId,
    direction: "inbound",
    senderEmail: input.leadEmail,
    // The business's own sender address; empty when no business is known.
    recipientEmail: businessId ? await resolveSenderEmail({ workspaceId, businessId }) : "",
    subject: input.subject || "Re: Diagnostic",
    bodyText: cleanBodyText,
    bodyHtml: sanitizedHtml || undefined,
    providerMessageId: input.providerMessageId,
    sentAt: now
  };

  await convRef.collection("messages").doc(messageId).set(messageData);

  // 6. Execute Reply Classification & Intent Routing (REQ-063, REQ-064, REQ-065)
  let classification: ReplyClassification | undefined;
  let routedAction: string | undefined;
  try {
    const routeRes = await routeInboundReply({
      conversationId,
      messageId,
      leadEmail: input.leadEmail,
      subject: input.subject,
      bodyText: cleanBodyText,
      workspaceId,
      businessId,
      providerEventType: "reply_received"
    });
    classification = routeRes.classification;
    routedAction = routeRes.routedAction;
  } catch (err) {
    await writeLog({
      type: "reply.routing_error",
      level: "warning",
      message: `Failed to route inbound reply: ${err instanceof Error ? err.message : String(err)}`,
      metadata: { conversationId, messageId }
    });
  }

  // 7. Update Outreach status to "replied" (if not already suppressed by unsub)
  if ((contactId || companyId) && classification?.intent !== "UNSUBSCRIBE") {
    let outreachQuery = adminDb.collection("outreach").where("status", "in", ["sent", "approved"]);
    if (contactId) {
      outreachQuery = outreachQuery.where("contactId", "==", contactId);
    } else if (companyId) {
      outreachQuery = outreachQuery.where("companyId", "==", companyId);
    }

    const outreachSnaps = await outreachQuery.get();
    for (const doc of outreachSnaps.docs) {
      await doc.ref.set(
        {
          status: "replied",
          lastInteractionAt: now,
          conversationId,
          updatedAt: now
        },
        { merge: true }
      );
    }
  }

  // 8. Update Company status to "replied"
  if (companyId && classification?.intent !== "UNSUBSCRIBE") {
    await adminDb.collection("companies").doc(companyId).set(
      {
        status: "replied",
        lastActivityAt: now,
        updatedAt: now
      },
      { merge: true }
    );
  }

  // 9. Update Contact status to "replied" (if not unsubscribed)
  if (contactId && classification?.intent !== "UNSUBSCRIBE") {
    await adminDb.collection("contacts").doc(contactId).set(
      {
        status: "replied",
        updatedAt: now
      },
      { merge: true }
    );
  }

  await writeLog({
    type: "outreach.reply_received",
    level: "info",
    message: `Inbound reply ingested from ${input.leadEmail}. Subject: ${input.subject || "Re: Diagnostic"} (Intent: ${classification?.intent || "UNCLEAR"})`,
    metadata: {
      conversationId,
      messageId,
      leadEmail: input.leadEmail,
      companyId,
      contactId,
      intent: classification?.intent,
      objectionType: classification?.objectionType,
      routedAction,
      uniboxUrl: input.uniboxUrl
    }
  });

  return { conversationId, messageId, contactId, companyId, classification, routedAction };
}

/**
 * Records a lead bounce and adds email/domain to suppressionList (REQ-057 & REQ-059).
 */
export async function recordLeadBounced(input: WebhookStatusUpdateInput): Promise<void> {
  const normalizedEmail = input.leadEmail.toLowerCase().trim();
  const now = Timestamp.now();

  // Add to suppression list
  const suppId = `supp_email_${normalizedEmail.replace(/[^a-zA-Z0-9]/g, "_")}`;
  await adminDb.collection("suppressionList").doc(suppId).set(
    {
      id: suppId,
      workspaceId: input.workspaceId || "ws_default",
      // Suppression is enforced across every business; a bounce nobody can
      // attribute still blocks. Unknown attribution is omitted, so the merge
      // keeps one already on the entry instead of nulling it.
      ...(input.businessId ? { businessId: input.businessId } : {}),
      targetType: "email",
      targetValue: normalizedEmail,
      reason: "bounce",
      createdAt: now
    },
    { merge: true }
  );

  // Update contact
  const contactSnaps = await adminDb
    .collection("contacts")
    .where("normalizedEmail", "==", normalizedEmail)
    .get();

  for (const doc of contactSnaps.docs) {
    await doc.ref.set({ status: "invalid", doNotContact: true, updatedAt: now }, { merge: true });
    const data = doc.data();
    if (data.companyId) {
      const convId = `conv_${data.companyId}_${doc.id}`;
      await adminDb.collection("conversations").doc(convId).set({ status: "lost", updatedAt: now }, { merge: true });
    }
  }

  await writeLog({
    type: "outreach.bounced",
    level: "warning",
    message: `Lead bounced: ${input.leadEmail}. Added to suppression list.`,
    metadata: { leadEmail: input.leadEmail, reason: input.reason }
  });
}

/**
 * Records a lead unsubscribe and adds email to suppressionList (REQ-057, REQ-059, REQ-065).
 */
export async function recordLeadUnsubscribed(input: WebhookStatusUpdateInput): Promise<void> {
  await executeDeterministicUnsubscribe({
    leadEmail: input.leadEmail,
    workspaceId: input.workspaceId,
    businessId: input.businessId,
    reason: input.reason || "lead_unsubscribed_webhook"
  });
}

/**
 * Fetches a conversation with its messages in chronological order.
 */
export async function getConversationWithMessages(
  conversationId: string
): Promise<{ conversation: ConversationDoc | null; messages: MessageDoc[] }> {
  const convRef = adminDb.collection("conversations").doc(conversationId);
  const convSnap = await convRef.get();
  if (!convSnap.exists) {
    return { conversation: null, messages: [] };
  }

  const conversation = { id: convSnap.id, ...convSnap.data() } as ConversationDoc;

  const messagesSnap = await convRef
    .collection("messages")
    .orderBy("sentAt", "asc")
    .get();

  const messages = messagesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as MessageDoc[];

  return { conversation, messages };
}

/**
 * Lists conversations for a workspace/business.
 */
export async function listConversations(
  workspaceId = "ws_default",
  businessId?: string,
  limitCount = 50
): Promise<ConversationDoc[]> {
  let q = adminDb
    .collection("conversations")
    .where("workspaceId", "==", workspaceId);

  if (businessId) {
    q = q.where("businessId", "==", businessId);
  }

  const snap = await q.orderBy("lastMessageAt", "desc").limit(limitCount).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })) as ConversationDoc[];
}

/**
 * Approves and dispatches an AI reply draft for a conversation (REQ-068).
 */
export async function approveAndSendReplyDraft(input: {
  conversationId: string;
  customSubject?: string;
  customBodyText?: string;
  approvedByUserId?: string;
}): Promise<{ success: boolean; messageId: string; delivered: boolean; notice?: string }> {
  const convRef = adminDb.collection("conversations").doc(input.conversationId);
  const convSnap = await convRef.get();
  if (!convSnap.exists) {
    throw new Error(`Conversation ${input.conversationId} not found.`);
  }

  const conv = convSnap.data() as ConversationDoc;
  const socialRefusal = socialWebSendRefusal(conv);
  if (socialRefusal) throw new HttpsError("failed-precondition", socialRefusal);
  const draft = conv.draftResponse;
  if (!draft) {
    throw new Error(`No reply draft found on conversation ${input.conversationId}.`);
  }

  const finalSubject = input.customSubject || draft.subject;
  const finalBodyText = input.customBodyText || draft.bodyText;
  // An escalated conversation may carry an intentionally empty draft (e.g. no
  // business could be resolved). Approving it must not send a blank email.
  if (!finalBodyText?.trim()) {
    throw new Error("The reply is empty: write the message before sending it.");
  }
  const now = Timestamp.now();
  const msgId = `msg_out_manual_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

  // 1. Store outbound message
  const senderEmail = await resolveSenderEmail({
    workspaceId: conv.workspaceId,
    businessId: conv.businessId
  });

  const outboundMessage: MessageDoc = {
    id: msgId,
    conversationId: input.conversationId,
    direction: "outbound",
    senderEmail,
    recipientEmail: "", // the prospect's address, from their latest inbound message
    subject: finalSubject,
    bodyText: finalBodyText,
    sentAt: now
  };

  // Find recipient email from last inbound message
  // The latest *inbound* message among the recent ones — the very latest may
  // be our own recorded-but-unsent reply.
  const msgsSnap = await convRef.collection("messages").orderBy("sentAt", "desc").limit(5).get();
  for (const doc of msgsSnap.docs) {
    const message = doc.data() as MessageDoc;
    if (message.direction === "inbound" && message.senderEmail) {
      outboundMessage.recipientEmail = message.senderEmail;
      break;
    }
  }
  if (!outboundMessage.recipientEmail) {
    throw new Error("No prospect address found on this conversation; reply from your mailbox.");
  }

  // Delivered — or honestly recorded as not sent. Only a delivered reply
  // closes the conversation's attention flags.
  const delivery = await deliverReply({
    workspaceId: conv.workspaceId,
    businessId: conv.businessId,
    conversationId: input.conversationId,
    contactId: conv.contactId,
    to: outboundMessage.recipientEmail,
    from: senderEmail,
    subject: finalSubject,
    bodyText: finalBodyText
  });
  if (!delivery.delivered && delivery.reason === "suppressed") {
    throw new Error(undeliveredReplyNotice(delivery));
  }
  outboundMessage.deliveryStatus = delivery.delivered ? "delivered" : "recorded_not_sent";
  if (delivery.delivered) outboundMessage.providerMessageId = delivery.providerMessageId;

  await convRef.collection("messages").doc(msgId).set(outboundMessage);

  // 2. Update conversation doc
  const updatedDraft = {
    ...draft,
    subject: finalSubject,
    bodyText: finalBodyText,
    status: "approved_and_sent" as const,
    sentAt: new Date().toISOString(),
    sentMessageId: msgId
  };

  await convRef.set(
    {
      status: "in_dialogue",
      draftResponse: updatedDraft,
      ...(delivery.delivered
        ? { unreadHumanAttention: false, humanAttentionRequired: false, pendingExternalSend: false }
        : { pendingExternalSend: true }),
      messageCount: (conv.messageCount || 0) + 1,
      lastMessageAt: now,
      updatedAt: now
    },
    { merge: true }
  );

  await writeLog({
    type: delivery.delivered ? "reply.approved_and_sent" : "reply.approved_not_sent",
    level: "info",
    message: delivery.delivered
      ? `Reply draft approved & sent for conversation ${input.conversationId} by ${input.approvedByUserId || "operator"}`
      : `Reply approved and recorded for conversation ${input.conversationId}; not sent (no reply transport).`,
    workspaceId: conv.workspaceId,
    businessId: conv.businessId,
    metadata: {
      conversationId: input.conversationId,
      messageId: msgId,
      approvedByUserId: input.approvedByUserId
    }
  });

  return {
    success: true,
    messageId: msgId,
    delivered: delivery.delivered,
    ...(delivery.delivered ? {} : { notice: undeliveredReplyNotice(delivery) })
  };
}

/**
 * Regenerates an AI reply draft for a conversation on demand (REQ-066).
 */
export async function generateReplyDraftForConversation(
  conversationId: string
): Promise<ConversationDoc> {
  const { generateGroundedReply } = await import("./reply-generator.js");
  const { conversation, messages } = await getConversationWithMessages(conversationId);
  if (!conversation) {
    throw new Error(`Conversation ${conversationId} not found.`);
  }

  // A DM thread gets a DM draft (short, no subject, offer-checked, queued for
  // the session runner) — never the email draft below.
  if (conversation.channel === "instagram" || conversation.channel === "facebook") {
    const { regenerateSocialDraft } = await import("./social/social-inbound.js");
    await regenerateSocialDraft(conversationId);
    const refreshed = await getConversationWithMessages(conversationId);
    if (!refreshed.conversation) throw new Error(`Conversation ${conversationId} not found.`);
    return refreshed.conversation;
  }

  const lastInbound = messages.filter((m) => m.direction === "inbound").slice(-1)[0];
  if (!lastInbound) {
    throw new Error(`No inbound message found to respond to in conversation ${conversationId}.`);
  }

  const result = await generateGroundedReply({
    workspaceId: conversation.workspaceId,
    businessId: conversation.businessId,
    offerId: await resolveConversationOfferId(conversation),
    conversationHistory: messages,
    latestInboundMessage: {
      subject: lastInbound.subject,
      bodyText: lastInbound.bodyText,
      senderEmail: lastInbound.senderEmail
    },
    classification: lastInbound.replyClassification
  });

  const now = Timestamp.now();
  await adminDb.collection("conversations").doc(conversationId).set(
    {
      draftResponse: result.draft,
      humanAttentionRequired: result.requiresHumanEscalation || conversation.humanAttentionRequired,
      escalationReason: result.escalationReason || conversation.escalationReason,
      updatedAt: now
    },
    { merge: true }
  );

  return {
    ...conversation,
    draftResponse: result.draft,
    updatedAt: now
  };
}
