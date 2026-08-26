import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
import { writeLog } from "../utils/logger.js";
import type { ConversationDoc } from "../types/domain.js";

export interface EscalateConversationInput {
  conversationId: string;
  reason: string;
  messageId?: string;
  workspaceId?: string;
  businessId?: string;
  leadEmail?: string;
}

export interface EscalateConversationResult {
  success: boolean;
  conversationId: string;
  reason: string;
  escalatedAt: string;
}

/**
 * Executes human escalation routing for high-risk, hostile, low-confidence, or custom pricing inquiries (REQ-069).
 * Pauses active automated sequences, sets priority alert flags, and records audit logs.
 */
export async function escalateConversation(
  input: EscalateConversationInput
): Promise<EscalateConversationResult> {
  const now = Timestamp.now();
  const convRef = adminDb.collection("conversations").doc(input.conversationId);
  const convSnap = await convRef.get();
  const convData = convSnap.exists ? (convSnap.data() as ConversationDoc) : null;

  // 1. Update Conversation document state
  await convRef.set(
    {
      status: "human_escalated",
      unreadHumanAttention: true,
      humanAttentionRequired: true,
      escalationReason: input.reason,
      updatedAt: now
    },
    { merge: true }
  );

  // 2. Pause active outreach sequences for this contact/company (REQ-069)
  const companyId = convData?.companyId;
  const contactId = convData?.contactId;

  if (contactId || companyId) {
    let outreachQuery = adminDb.collection("outreach").where("status", "in", ["sent", "approved", "active"]);
    if (contactId) {
      outreachQuery = outreachQuery.where("contactId", "==", contactId);
    } else if (companyId) {
      outreachQuery = outreachQuery.where("companyId", "==", companyId);
    }

    try {
      const outreachSnaps = await outreachQuery.get();
      for (const doc of outreachSnaps.docs) {
        await doc.ref.set(
          {
            status: "paused",
            pauseReason: `Human escalation: ${input.reason}`,
            updatedAt: now
          },
          { merge: true }
        );
      }
    } catch (err) {
      await writeLog({
        type: "escalation.pause_outreach_warning",
        level: "warning",
        message: `Failed to pause outreach on escalation: ${err instanceof Error ? err.message : String(err)}`
      });
    }
  }

  // 3. Write structured audit log
  await writeLog({
    type: "reply.human_escalated",
    level: "warning",
    message: `Conversation ${input.conversationId} escalated to human rep: ${input.reason} (Lead: ${input.leadEmail || convData?.contactId || "unknown"})`,
    metadata: {
      conversationId: input.conversationId,
      messageId: input.messageId,
      workspaceId: input.workspaceId || convData?.workspaceId,
      businessId: input.businessId || convData?.businessId,
      leadEmail: input.leadEmail,
      reason: input.reason,
      escalatedAt: new Date().toISOString()
    }
  });

  return {
    success: true,
    conversationId: input.conversationId,
    reason: input.reason,
    escalatedAt: new Date().toISOString()
  };
}
