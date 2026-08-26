import { describe, expect, it } from "vitest";
import type { ConversationDoc } from "@/types/firestore";

describe("SDR Inbox & Workspace Thread UI (REQ-070)", () => {
  it("should validate extended ConversationDoc fields for manual takeover and attention tracking", () => {
    const conv: ConversationDoc = {
      id: "conv_companyA_contactB",
      workspaceId: "ws_default",
      businessId: "biz_devcomm",
      companyId: "comp_123",
      contactId: "contact_456",
      status: "human_escalated",
      latestIntent: "BOOKING_REQUEST",
      latestObjection: "PRICE",
      manualTakeover: true,
      takeoverByUserId: "rep_user_99",
      takenOverAt: new Date(),
      latestRepReplyAt: new Date(),
      pinned: true,
      unreadHumanAttention: false,
      humanAttentionRequired: false,
      escalationReason: "Prospect asked for customized corporate discount",
      draftResponse: {
        subject: "Re: Proposition",
        bodyText: "Bonjour, voici nos tarifs standards...",
        status: "queued_for_approval",
        confidence: 0.88,
        pricingGuardrailPassed: true,
        prohibitedPromisesChecked: true,
        draftedAt: new Date()
      },
      messageCount: 3,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    expect(conv.manualTakeover).toBe(true);
    expect(conv.takeoverByUserId).toBe("rep_user_99");
    expect(conv.latestIntent).toBe("BOOKING_REQUEST");
    expect(conv.draftResponse?.pricingGuardrailPassed).toBe(true);
    expect(conv.status).toBe("human_escalated");
  });

  it("should categorize conversations by filter tabs correctly", () => {
    const conversations: ConversationDoc[] = [
      {
        id: "c1",
        workspaceId: "ws_default",
        businessId: "biz_devcomm",
        companyId: "comp_1",
        contactId: "contact_1",
        status: "in_dialogue",
        unreadHumanAttention: true,
        messageCount: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: "c2",
        workspaceId: "ws_default",
        businessId: "biz_devcomm",
        companyId: "comp_2",
        contactId: "contact_2",
        status: "in_dialogue",
        unreadHumanAttention: false,
        messageCount: 3,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: "c3",
        workspaceId: "ws_default",
        businessId: "biz_devcomm",
        companyId: "comp_3",
        contactId: "contact_3",
        status: "meeting_booked",
        unreadHumanAttention: false,
        messageCount: 4,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: "c4",
        workspaceId: "ws_default",
        businessId: "biz_devcomm",
        companyId: "comp_4",
        contactId: "contact_4",
        status: "human_escalated",
        unreadHumanAttention: false,
        messageCount: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    // Compute needs attention count
    const needsAttention = conversations.filter(
      (c) => c.unreadHumanAttention || c.humanAttentionRequired || c.status === "human_escalated"
    );
    expect(needsAttention.length).toBe(2); // c1 (unread), c4 (escalated)

    // Compute in dialogue count
    const inDialogue = conversations.filter((c) => c.status === "in_dialogue");
    expect(inDialogue.length).toBe(2); // c1, c2

    // Compute meeting booked count
    const booked = conversations.filter((c) => c.status === "meeting_booked");
    expect(booked.length).toBe(1); // c3
  });
});
