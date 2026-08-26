import { describe, expect, it } from "vitest";
import { getInboxSummary, listInboxConversations } from "../../services/inbox-service.js";
import { adminDb } from "../../config/firebase.js";
import { Timestamp } from "firebase-admin/firestore";
import type { ConversationDoc } from "../../types/domain.js";

describe("SDR Inbox Filtering & Summaries (REQ-070)", () => {
  const workspaceId = `ws_test_inbox_filter_${Date.now()}`;
  const businessId = `biz_test_filter_${Date.now()}`;

  it("should compute accurate summary counts for all inbox status tabs", async () => {
    const now = Timestamp.now();

    // Seed test conversations in Firestore
    const conv1: ConversationDoc = {
      id: `conv_test_${Date.now()}_1`,
      workspaceId,
      businessId,
      companyId: "comp_attention_1",
      contactId: "contact_1",
      status: "in_dialogue",
      unreadHumanAttention: true,
      humanAttentionRequired: true,
      messageCount: 2,
      createdAt: now,
      updatedAt: now
    };

    const conv2: ConversationDoc = {
      id: `conv_test_${Date.now()}_2`,
      workspaceId,
      businessId,
      companyId: "comp_dialogue_2",
      contactId: "contact_2",
      status: "in_dialogue",
      unreadHumanAttention: false,
      humanAttentionRequired: false,
      messageCount: 3,
      createdAt: now,
      updatedAt: now
    };

    const conv3: ConversationDoc = {
      id: `conv_test_${Date.now()}_3`,
      workspaceId,
      businessId,
      companyId: "comp_booked_3",
      contactId: "contact_3",
      status: "meeting_booked",
      unreadHumanAttention: false,
      humanAttentionRequired: false,
      messageCount: 4,
      createdAt: now,
      updatedAt: now
    };

    const conv4: ConversationDoc = {
      id: `conv_test_${Date.now()}_4`,
      workspaceId,
      businessId,
      companyId: "comp_escalated_4",
      contactId: "contact_4",
      status: "human_escalated",
      unreadHumanAttention: false,
      humanAttentionRequired: false,
      messageCount: 2,
      createdAt: now,
      updatedAt: now
    };

    const conv5: ConversationDoc = {
      id: `conv_test_${Date.now()}_5`,
      workspaceId,
      businessId,
      companyId: "comp_suppressed_5",
      contactId: "contact_5",
      status: "suppressed",
      unreadHumanAttention: false,
      humanAttentionRequired: false,
      messageCount: 1,
      createdAt: now,
      updatedAt: now
    };

    await adminDb.collection("conversations").doc(conv1.id).set(conv1);
    await adminDb.collection("conversations").doc(conv2.id).set(conv2);
    await adminDb.collection("conversations").doc(conv3.id).set(conv3);
    await adminDb.collection("conversations").doc(conv4.id).set(conv4);
    await adminDb.collection("conversations").doc(conv5.id).set(conv5);

    const summary = await getInboxSummary({ workspaceId, businessId });

    expect(summary.total).toBe(5);
    expect(summary.needsAttention).toBe(1); // conv1
    expect(summary.inDialogue).toBe(2); // conv1, conv2
    expect(summary.meetingBooked).toBe(1); // conv3
    expect(summary.humanEscalated).toBe(1); // conv4
    expect(summary.suppressed).toBe(1); // conv5
  });

  it("should filter conversations by tab correctly", async () => {
    // 1. Needs attention tab
    const attentionList = await listInboxConversations({
      workspaceId,
      businessId,
      tab: "needs_attention"
    });
    expect(attentionList.some((c) => c.companyId === "comp_attention_1")).toBe(true);

    // 2. Meeting booked tab
    const bookedList = await listInboxConversations({
      workspaceId,
      businessId,
      tab: "meeting_booked"
    });
    expect(bookedList.length).toBe(1);
    expect(bookedList[0].companyId).toBe("comp_booked_3");

    // 3. Search filter
    const searchList = await listInboxConversations({
      workspaceId,
      businessId,
      tab: "all",
      search: "comp_suppressed_5"
    });
    expect(searchList.length).toBe(1);
    expect(searchList[0].companyId).toBe("comp_suppressed_5");
  });
});
