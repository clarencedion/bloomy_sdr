import { deliverReply, undeliveredReplyNotice } from "./reply-delivery.js";
import { Timestamp, type QueryDocumentSnapshot, type DocumentData } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
import { resolveSenderEmail } from "./sender-resolver.js";
import { writeLog } from "../utils/logger.js";
import type { ConversationDoc, ConversationStatus, MessageDoc } from "../types/domain.js";
import { HttpsError } from "firebase-functions/v2/https";
import { socialWebSendRefusal } from "./conversation-service.js";

export interface InboxSummary {
  needsAttention: number;
  inDialogue: number;
  meetingBooked: number;
  humanEscalated: number;
  suppressed: number;
  total: number;
}

export interface ListInboxConversationsOptions {
  workspaceId?: string;
  businessId?: string;
  tab?: "all" | "needs_attention" | "in_dialogue" | "meeting_booked" | "human_escalated" | "suppressed" | string;
  search?: string;
  limit?: number;
}

export interface TakeOverConversationInput {
  conversationId: string;
  userId?: string;
  workspaceId?: string;
  businessId?: string;
}

export interface ReleaseTakeoverInput {
  conversationId: string;
  userId?: string;
}

export interface SendManualReplyInput {
  conversationId: string;
  subject: string;
  bodyText: string;
  sentByUserId?: string;
  recipientEmail?: string;
  senderEmail?: string;
}

export interface UpdateConversationStatusInput {
  conversationId: string;
  status?: ConversationStatus;
  assignedRepUserId?: string;
  pinned?: boolean;
}

export interface AgentActivityItem {
  id: string;
  type: string;
  level: "debug" | "info" | "warning" | "error";
  message: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

/**
 * Computes aggregated tab counts for the human SDR Inbox (REQ-070).
 */
export async function getInboxSummary(options: {
  workspaceId?: string;
  businessId?: string;
}): Promise<InboxSummary> {
  const workspaceId = options.workspaceId || "ws_default";
  let q = adminDb.collection("conversations").where("workspaceId", "==", workspaceId);

  if (options.businessId) {
    q = q.where("businessId", "==", options.businessId);
  }

  const scopedSnap = await q.get();
  // Unattributed replies are listed under every business (see needsAttribution).
  const unattributedSnap = options.businessId
    ? await adminDb
        .collection("conversations")
        .where("workspaceId", "==", workspaceId)
        .where("needsAttribution", "==", true)
        .get()
        .catch(() => null)
    : null;
  const mergedDocs = [...scopedSnap.docs, ...(unattributedSnap?.docs ?? [])];
  const snap = { docs: mergedDocs, size: mergedDocs.length };
  let needsAttention = 0;
  let inDialogue = 0;
  let meetingBooked = 0;
  let humanEscalated = 0;
  let suppressed = 0;

  for (const doc of snap.docs) {
    const data = doc.data() as ConversationDoc;
    if (data.unreadHumanAttention || data.humanAttentionRequired) {
      needsAttention++;
    }
    if (data.status === "in_dialogue") {
      inDialogue++;
    } else if (data.status === "meeting_booked") {
      meetingBooked++;
    } else if (data.status === "human_escalated") {
      humanEscalated++;
    } else if (data.status === "suppressed") {
      suppressed++;
    }
  }

  return {
    needsAttention,
    inDialogue,
    meetingBooked,
    humanEscalated,
    suppressed,
    total: snap.size
  };
}

/**
 * Lists conversations with filtering by tab, status, and search query (REQ-070).
 */
export async function listInboxConversations(
  options: ListInboxConversationsOptions
): Promise<ConversationDoc[]> {
  const workspaceId = options.workspaceId || "ws_default";
  let q = adminDb.collection("conversations").where("workspaceId", "==", workspaceId);

  if (options.businessId) {
    q = q.where("businessId", "==", options.businessId);
  }

  let conversations: ConversationDoc[] = [];
  try {
    const snap = await q.orderBy("lastMessageAt", "desc").limit(options.limit || 50).get();
    conversations = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as ConversationDoc[];
  } catch {
    const snap = await q.limit(options.limit || 50).get();
    conversations = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as ConversationDoc[];
    conversations.sort((a, b) => {
      const tA = a.lastMessageAt ? (typeof (a.lastMessageAt as any).toMillis === "function" ? (a.lastMessageAt as any).toMillis() : new Date(a.lastMessageAt as any).getTime()) : 0;
      const tB = b.lastMessageAt ? (typeof (b.lastMessageAt as any).toMillis === "function" ? (b.lastMessageAt as any).toMillis() : new Date(b.lastMessageAt as any).getTime()) : 0;
      return tB - tA;
    });
  }

  if (options.businessId) {
    const unattributed = await adminDb
      .collection("conversations")
      .where("workspaceId", "==", workspaceId)
      .where("needsAttribution", "==", true)
      .limit(options.limit || 50)
      .get()
      .catch(() => null);
    const known = new Set(conversations.map((c) => c.id));
    for (const doc of unattributed?.docs ?? []) {
      if (!known.has(doc.id)) conversations.push({ id: doc.id, ...doc.data() } as ConversationDoc);
    }
  }

  if (options.tab && options.tab !== "all") {
    if (options.tab === "needs_attention") {
      conversations = conversations.filter(
        (c) => c.unreadHumanAttention || c.humanAttentionRequired || c.status === "human_escalated"
      );
    } else {
      conversations = conversations.filter((c) => c.status === options.tab);
    }
  }

  if (options.search?.trim()) {
    const term = options.search.toLowerCase().trim();
    conversations = conversations.filter((c) => {
      const matchCompany = c.companyId.toLowerCase().includes(term);
      const matchContact = c.contactId.toLowerCase().includes(term);
      const matchIntent = (c.latestIntent || "").toLowerCase().includes(term);
      const matchReason = (c.escalationReason || "").toLowerCase().includes(term);
      return matchCompany || matchContact || matchIntent || matchReason;
    });
  }

  return conversations;
}

/**
 * Takes manual takeover of a conversation thread, halting automated responses (REQ-070).
 */
export async function takeOverConversation(
  input: TakeOverConversationInput
): Promise<{ success: boolean; conversation: ConversationDoc }> {
  const convRef = adminDb.collection("conversations").doc(input.conversationId);
  const convSnap = await convRef.get();
  if (!convSnap.exists) {
    throw new Error(`Conversation ${input.conversationId} not found.`);
  }

  const conv = convSnap.data() as ConversationDoc;
  const now = Timestamp.now();

  const updatedFields: Partial<ConversationDoc> = {
    status: "human_escalated",
    manualTakeover: true,
    takeoverByUserId: input.userId || "human_rep",
    takenOverAt: now,
    unreadHumanAttention: false,
    humanAttentionRequired: false,
    updatedAt: now
  };

  await convRef.set(updatedFields, { merge: true });

  // Pause active outreach sequence steps for this company/contact
  if (conv.companyId || conv.contactId) {
    let outreachQuery = adminDb.collection("outreach").where("status", "in", ["sent", "approved", "active"]);
    if (conv.contactId) {
      outreachQuery = outreachQuery.where("contactId", "==", conv.contactId);
    } else if (conv.companyId) {
      outreachQuery = outreachQuery.where("companyId", "==", conv.companyId);
    }

    try {
      const outreachSnaps = await outreachQuery.get();
      for (const doc of outreachSnaps.docs) {
        await doc.ref.set(
          {
            status: "paused",
            pauseReason: `Human rep took over conversation thread manually`,
            updatedAt: now
          },
          { merge: true }
        );
      }
    } catch (err) {
      console.warn("Failed to pause outreach sequence on manual takeover", err);
    }
  }

  await writeLog({
    type: "conversation.manual_takeover",
    level: "info",
    message: `Human rep (${input.userId || "rep"}) took over conversation ${input.conversationId}`,
    metadata: {
      conversationId: input.conversationId,
      userId: input.userId,
      companyId: conv.companyId,
      contactId: conv.contactId
    }
  });

  return {
    success: true,
    conversation: {
      ...conv,
      ...updatedFields
    } as ConversationDoc
  };
}

/**
 * Releases manual takeover of a conversation thread, returning it to standard dialogue (REQ-070).
 */
export async function releaseTakeover(
  input: ReleaseTakeoverInput
): Promise<{ success: boolean; conversation: ConversationDoc }> {
  const convRef = adminDb.collection("conversations").doc(input.conversationId);
  const convSnap = await convRef.get();
  if (!convSnap.exists) {
    throw new Error(`Conversation ${input.conversationId} not found.`);
  }

  const conv = convSnap.data() as ConversationDoc;
  const now = Timestamp.now();

  const updatedFields: Partial<ConversationDoc> = {
    status: "in_dialogue",
    manualTakeover: false,
    unreadHumanAttention: false,
    humanAttentionRequired: false,
    updatedAt: now
  };

  await convRef.set(updatedFields, { merge: true });

  await writeLog({
    type: "conversation.takeover_released",
    level: "info",
    message: `Manual takeover released for conversation ${input.conversationId} by ${input.userId || "rep"}`,
    metadata: {
      conversationId: input.conversationId,
      userId: input.userId
    }
  });

  return {
    success: true,
    conversation: {
      ...conv,
      ...updatedFields
    } as ConversationDoc
  };
}

/**
 * Dispatches a manual reply written by a human sales rep (REQ-070).
 */
export async function sendManualReply(
  input: SendManualReplyInput
): Promise<{ success: boolean; messageId: string; delivered: boolean; notice?: string }> {
  const convRef = adminDb.collection("conversations").doc(input.conversationId);
  const convSnap = await convRef.get();
  if (!convSnap.exists) {
    throw new Error(`Conversation ${input.conversationId} not found.`);
  }

  const conv = convSnap.data() as ConversationDoc;
  // Instagram / Facebook replies leave from the owner's local session only.
  const socialRefusal = socialWebSendRefusal(conv);
  if (socialRefusal) throw new HttpsError("failed-precondition", socialRefusal);
  const now = Timestamp.now();
  const messageId = `msg_rep_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

  let recipientEmail = input.recipientEmail || "prospect@example.com";
  let senderEmail = await resolveSenderEmail({
    workspaceId: conv.workspaceId,
    businessId: conv.businessId,
    override: input.senderEmail
  });

  // Determine recipient from last inbound message if not explicitly provided
  if (!input.recipientEmail) {
    const lastMsgs = await convRef.collection("messages").orderBy("sentAt", "desc").limit(5).get();
    for (const d of lastMsgs.docs) {
      const m = d.data() as MessageDoc;
      if (m.direction === "inbound" && m.senderEmail) {
        recipientEmail = m.senderEmail;
        break;
      }
    }
  }

  const outboundMsg: MessageDoc = {
    id: messageId,
    conversationId: input.conversationId,
    direction: "outbound",
    senderEmail,
    recipientEmail,
    subject: input.subject,
    bodyText: input.bodyText,
    sentAt: now
  };

  // Delivered — or honestly recorded as not sent (see reply-delivery.ts).
  const delivery = await deliverReply({
    workspaceId: conv.workspaceId,
    businessId: conv.businessId,
    conversationId: input.conversationId,
    contactId: conv.contactId,
    to: recipientEmail,
    from: senderEmail,
    subject: input.subject,
    bodyText: input.bodyText
  });
  if (!delivery.delivered && delivery.reason === "suppressed") {
    throw new Error(undeliveredReplyNotice(delivery));
  }
  outboundMsg.deliveryStatus = delivery.delivered ? "delivered" : "recorded_not_sent";
  if (delivery.delivered) outboundMsg.providerMessageId = delivery.providerMessageId;

  await convRef.collection("messages").doc(messageId).set(outboundMsg);

  const updatedDraft = conv.draftResponse
    ? {
        ...conv.draftResponse,
        status: "manual_override_sent" as const,
        sentAt: new Date().toISOString(),
        sentMessageId: messageId
      }
    : undefined;

  await convRef.set(
    {
      status: "in_dialogue",
      // Only a delivered reply closes the attention flags.
      ...(delivery.delivered
        ? { unreadHumanAttention: false, humanAttentionRequired: false, pendingExternalSend: false }
        : { pendingExternalSend: true }),
      latestRepReplyAt: now,
      draftResponse: updatedDraft,
      messageCount: (conv.messageCount || 0) + 1,
      lastMessageAt: now,
      updatedAt: now
    },
    { merge: true }
  );

  await writeLog({
    type: delivery.delivered ? "conversation.rep_manual_reply" : "reply.approved_not_sent",
    level: "info",
    message: `Manual reply dispatched by rep (${input.sentByUserId || "rep"}) for conversation ${input.conversationId}`,
    metadata: {
      conversationId: input.conversationId,
      messageId,
      sentByUserId: input.sentByUserId,
      recipientEmail
    }
  });

  return {
    success: true,
    messageId,
    delivered: delivery.delivered,
    ...(delivery.delivered ? {} : { notice: undeliveredReplyNotice(delivery) })
  };
}

/**
 * Updates conversation status, assigned rep, or pinned flag (REQ-070).
 */
export async function updateConversationStatus(
  input: UpdateConversationStatusInput
): Promise<{ success: boolean }> {
  const convRef = adminDb.collection("conversations").doc(input.conversationId);
  const now = Timestamp.now();

  // Unsubscribing a social prospect is more than a status: the handle and the
  // company must be suppressed, exactly as when they say "stop" in the DM.
  if (input.status === "suppressed") {
    const snap = await convRef.get();
    const channel = (snap.data() as ConversationDoc | undefined)?.channel;
    if (channel === "instagram" || channel === "facebook") {
      const { unsubscribeSocialConversation } = await import("./social/social-inbound.js");
      await unsubscribeSocialConversation({ conversationId: input.conversationId });
      return { success: true };
    }
  }

  const updates: Record<string, unknown> = {
    updatedAt: now
  };

  if (input.status) {
    updates.status = input.status;
    if (input.status === "meeting_booked" || input.status === "in_dialogue") {
      updates.unreadHumanAttention = false;
      updates.humanAttentionRequired = false;
    }
  }
  if (input.assignedRepUserId !== undefined) {
    updates.assignedRepUserId = input.assignedRepUserId;
  }
  if (input.pinned !== undefined) {
    updates.pinned = input.pinned;
  }

  await convRef.set(updates, { merge: true });

  return { success: true };
}

/**
 * Retrieves recent autonomous agent activity stream to provide real-time visibility (REQ-070).
 */
export async function getRecentAgentActivity(options: {
  workspaceId?: string;
  businessId?: string;
  limit?: number;
}): Promise<AgentActivityItem[]> {
  const workspaceId = options.workspaceId || "ws_default";
  let q = adminDb.collection("logs").where("workspaceId", "==", workspaceId);

  if (options.businessId) {
    q = q.where("businessId", "==", options.businessId);
  }

  let docs: QueryDocumentSnapshot<DocumentData>[] = [];
  try {
    const snap = await q.orderBy("createdAt", "desc").limit(options.limit || 20).get();
    docs = snap.docs;
  } catch {
    const snap = await q.limit(options.limit || 20).get();
    docs = snap.docs.sort((a, b) => {
      const dataA = a.data();
      const dataB = b.data();
      const tA = dataA.createdAt ? (typeof dataA.createdAt.toMillis === "function" ? dataA.createdAt.toMillis() : new Date(dataA.createdAt).getTime()) : 0;
      const tB = dataB.createdAt ? (typeof dataB.createdAt.toMillis === "function" ? dataB.createdAt.toMillis() : new Date(dataB.createdAt).getTime()) : 0;
      return tB - tA;
    });
  }

  return docs.map((doc) => {
    const data = doc.data();
    let createdAtStr = new Date().toISOString();
    if (data.createdAt) {
      if (typeof data.createdAt.toDate === "function") {
        createdAtStr = data.createdAt.toDate().toISOString();
      } else if (data.createdAt instanceof Date) {
        createdAtStr = data.createdAt.toISOString();
      } else {
        createdAtStr = String(data.createdAt);
      }
    }
    return {
      id: doc.id,
      type: data.type || "agent.activity",
      level: data.level || "info",
      message: data.message || "",
      createdAt: createdAtStr,
      metadata: data.metadata || {}
    };
  });
}
