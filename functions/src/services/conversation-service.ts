import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
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
    businessId: input.businessId || existing?.businessId || "biz_devcomm",
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

  // 3. Fallback: Create placeholder contact if needed
  if (!contactId && companyId) {
    const newContactRef = adminDb.collection("contacts").doc();
    contactId = newContactRef.id;
    await newContactRef.set({
      id: contactId,
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

  const workspaceId = input.workspaceId || contactData?.workspaceId || "ws_default";
  const businessId = input.businessId || contactData?.businessId || "biz_devcomm";

  // 4. Find or create conversation
  let conversationId = contactId && companyId ? `conv_${companyId}_${contactId}` : `conv_email_${normalizedEmail.replace(/[^a-zA-Z0-9]/g, "_")}`;
  const convRef = adminDb.collection("conversations").doc(conversationId);
  const convSnap = await convRef.get();
  const existingConv = convSnap.exists ? (convSnap.data() as ConversationDoc) : null;

  const sanitizedHtml = sanitizeHtml(input.bodyHtml);
  const cleanBodyText = input.bodyText?.trim() || htmlToPlainText(input.bodyHtml) || "(No text content)";

  const conversationData: Partial<ConversationDoc> = {
    id: conversationId,
    workspaceId,
    businessId,
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
    recipientEmail: "outreach@devcomm.fr",
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
      businessId: input.businessId || "biz_devcomm",
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
}): Promise<{ success: boolean; messageId: string }> {
  const convRef = adminDb.collection("conversations").doc(input.conversationId);
  const convSnap = await convRef.get();
  if (!convSnap.exists) {
    throw new Error(`Conversation ${input.conversationId} not found.`);
  }

  const conv = convSnap.data() as ConversationDoc;
  const draft = conv.draftResponse;
  if (!draft) {
    throw new Error(`No reply draft found on conversation ${input.conversationId}.`);
  }

  const finalSubject = input.customSubject || draft.subject;
  const finalBodyText = input.customBodyText || draft.bodyText;
  const now = Timestamp.now();
  const msgId = `msg_out_manual_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

  // 1. Store outbound message
  const outboundMessage: MessageDoc = {
    id: msgId,
    conversationId: input.conversationId,
    direction: "outbound",
    senderEmail: "contact@devcomm.fr",
    recipientEmail: "lead@example.com", // will be populated from contact/message
    subject: finalSubject,
    bodyText: finalBodyText,
    sentAt: now
  };

  // Find recipient email from last inbound message
  const msgsSnap = await convRef.collection("messages").orderBy("sentAt", "desc").limit(1).get();
  if (!msgsSnap.empty) {
    const lastMsg = msgsSnap.docs[0].data() as MessageDoc;
    if (lastMsg.direction === "inbound") {
      outboundMessage.recipientEmail = lastMsg.senderEmail;
    }
  }

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
      unreadHumanAttention: false,
      humanAttentionRequired: false,
      messageCount: (conv.messageCount || 0) + 1,
      lastMessageAt: now,
      updatedAt: now
    },
    { merge: true }
  );

  await writeLog({
    type: "reply.approved_and_sent",
    level: "info",
    message: `Reply draft approved & sent for conversation ${input.conversationId} by ${input.approvedByUserId || "operator"}`,
    metadata: {
      conversationId: input.conversationId,
      messageId: msgId,
      approvedByUserId: input.approvedByUserId
    }
  });

  return { success: true, messageId: msgId };
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

  const lastInbound = messages.filter((m) => m.direction === "inbound").slice(-1)[0];
  if (!lastInbound) {
    throw new Error(`No inbound message found to respond to in conversation ${conversationId}.`);
  }

  const result = await generateGroundedReply({
    workspaceId: conversation.workspaceId,
    businessId: conversation.businessId,
    offerId: conversation.campaignId,
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
