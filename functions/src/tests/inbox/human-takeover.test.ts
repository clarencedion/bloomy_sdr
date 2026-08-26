import { describe, expect, it } from "vitest";
import {
  takeOverConversation,
  releaseTakeover,
  sendManualReply,
  updateConversationStatus,
  getRecentAgentActivity
} from "../../services/inbox-service.js";
import { adminDb } from "../../config/firebase.js";
import { Timestamp } from "firebase-admin/firestore";
import type { ConversationDoc, MessageDoc } from "../../types/domain.js";

describe("Human SDR Takeover & Manual Intervention (REQ-070)", () => {
  const workspaceId = "ws_test_takeover";
  const businessId = "biz_test_takeover";

  it("should take over conversation manually, set status to human_escalated, and pause active sequence", async () => {
    const convId = `conv_takeover_${Date.now()}`;
    const companyId = `comp_${Date.now()}`;
    const contactId = `contact_${Date.now()}`;
    const outreachId = `out_${Date.now()}`;
    const now = Timestamp.now();

    const conv: ConversationDoc = {
      id: convId,
      workspaceId,
      businessId,
      companyId,
      contactId,
      status: "in_dialogue",
      unreadHumanAttention: true,
      humanAttentionRequired: true,
      messageCount: 2,
      createdAt: now,
      updatedAt: now
    };
    await adminDb.collection("conversations").doc(convId).set(conv);

    // Create an active outreach record for this company
    await adminDb.collection("outreach").doc(outreachId).set({
      id: outreachId,
      workspaceId,
      businessId,
      companyId,
      contactId,
      status: "sent",
      createdAt: now,
      updatedAt: now
    });

    // Rep takes over thread
    const res = await takeOverConversation({
      conversationId: convId,
      userId: "rep_user_42",
      workspaceId,
      businessId
    });

    expect(res.success).toBe(true);
    expect(res.conversation.status).toBe("human_escalated");
    expect(res.conversation.manualTakeover).toBe(true);
    expect(res.conversation.takeoverByUserId).toBe("rep_user_42");
    expect(res.conversation.unreadHumanAttention).toBe(false);

    // Verify outreach sequence step was paused
    const outreachSnap = await adminDb.collection("outreach").doc(outreachId).get();
    expect(outreachSnap.data()?.status).toBe("paused");
    expect(outreachSnap.data()?.pauseReason).toContain("Human rep took over");
  });

  it("should release takeover and restore standard dialogue status", async () => {
    const convId = `conv_release_${Date.now()}`;
    const now = Timestamp.now();

    const conv: ConversationDoc = {
      id: convId,
      workspaceId,
      businessId,
      companyId: "comp_rel",
      contactId: "contact_rel",
      status: "human_escalated",
      manualTakeover: true,
      takeoverByUserId: "rep_user_42",
      unreadHumanAttention: false,
      messageCount: 2,
      createdAt: now,
      updatedAt: now
    };
    await adminDb.collection("conversations").doc(convId).set(conv);

    const res = await releaseTakeover({
      conversationId: convId,
      userId: "rep_user_42"
    });

    expect(res.success).toBe(true);
    expect(res.conversation.status).toBe("in_dialogue");
    expect(res.conversation.manualTakeover).toBe(false);
  });

  it("should dispatch a manual reply from rep and record outbound message", async () => {
    const convId = `conv_manual_reply_${Date.now()}`;
    const now = Timestamp.now();

    const conv: ConversationDoc = {
      id: convId,
      workspaceId,
      businessId,
      companyId: "comp_reply",
      contactId: "contact_reply",
      status: "human_escalated",
      manualTakeover: true,
      unreadHumanAttention: true,
      draftResponse: {
        subject: "AI Subject",
        bodyText: "AI generated text",
        status: "queued_for_approval",
        pricingGuardrailPassed: true,
        prohibitedPromisesChecked: true,
        confidence: 0.9,
        draftedAt: now
      },
      messageCount: 1,
      createdAt: now,
      updatedAt: now
    };
    await adminDb.collection("conversations").doc(convId).set(conv);

    // Rep sends manual custom reply
    const replyRes = await sendManualReply({
      conversationId: convId,
      subject: "Re: Votre question sur Devcomm",
      bodyText: "Bonjour, je prends le relais directement pour vous présenter notre solution.",
      recipientEmail: "prospect@target.fr",
      sentByUserId: "rep_101"
    });

    expect(replyRes.success).toBe(true);
    expect(replyRes.messageId).toBeDefined();

    // Verify conversation doc state
    const convSnap = await adminDb.collection("conversations").doc(convId).get();
    const updated = convSnap.data() as ConversationDoc;
    expect(updated.status).toBe("in_dialogue");
    expect(updated.unreadHumanAttention).toBe(false);
    expect(updated.messageCount).toBe(2);
    expect(updated.draftResponse?.status).toBe("manual_override_sent");
    expect(updated.draftResponse?.sentMessageId).toBe(replyRes.messageId);

    // Verify message document in subcollection
    const msgSnap = await adminDb.collection("conversations").doc(convId).collection("messages").doc(replyRes.messageId).get();
    expect(msgSnap.exists).toBe(true);
    const msgData = msgSnap.data() as MessageDoc;
    expect(msgData.direction).toBe("outbound");
    expect(msgData.subject).toBe("Re: Votre question sur Devcomm");
    expect(msgData.recipientEmail).toBe("prospect@target.fr");
  });

  it("should update conversation status and fetch recent agent activity logs", async () => {
    const convId = `conv_status_update_${Date.now()}`;
    const now = Timestamp.now();

    await adminDb.collection("conversations").doc(convId).set({
      id: convId,
      workspaceId,
      businessId,
      companyId: "comp_status",
      contactId: "contact_status",
      status: "in_dialogue",
      unreadHumanAttention: false,
      messageCount: 1,
      createdAt: now,
      updatedAt: now
    });

    await updateConversationStatus({
      conversationId: convId,
      status: "meeting_booked",
      assignedRepUserId: "rep_clarence"
    });

    const convSnap = await adminDb.collection("conversations").doc(convId).get();
    expect(convSnap.data()?.status).toBe("meeting_booked");
    expect(convSnap.data()?.assignedRepUserId).toBe("rep_clarence");

    // Fetch agent activity logs
    const logs = await getRecentAgentActivity({ workspaceId, businessId, limit: 5 });
    expect(Array.isArray(logs)).toBe(true);
  });
});
