import { describe, expect, it } from "vitest";
import type { ConversationDoc, MessageDoc } from "@/types/firestore";

describe("Conversation & Message Model (REQ-062)", () => {
  it("should validate conversation and message schema types and initial states", () => {
    const conversation: ConversationDoc = {
      id: "conv_company123_contact456",
      workspaceId: "ws_default",
      businessId: "biz_devcomm",
      companyId: "company123",
      contactId: "contact456",
      outreachId: "outreach789",
      status: "sequence_active",
      instantlyLeadId: "lead_xyz",
      unreadHumanAttention: false,
      messageCount: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const outboundMsg: MessageDoc = {
      id: "msg_1",
      conversationId: conversation.id,
      direction: "outbound",
      senderEmail: "outreach@devcomm.fr",
      recipientEmail: "prospect@acme.fr",
      subject: "Proposition Audit",
      bodyText: "Bonjour, voici notre diagnostic...",
      sentAt: new Date()
    };

    const inboundMsg: MessageDoc = {
      id: "msg_2",
      conversationId: conversation.id,
      direction: "inbound",
      senderEmail: "prospect@acme.fr",
      recipientEmail: "outreach@devcomm.fr",
      subject: "Re: Proposition Audit",
      bodyText: "Merci pour le retour. Quand pouvons-nous en parler ?",
      bodyHtml: "<p>Merci pour le retour. Quand pouvons-nous en parler ?</p>",
      sentAt: new Date()
    };

    expect(conversation.status).toBe("sequence_active");
    expect(conversation.messageCount).toBe(1);
    expect(outboundMsg.direction).toBe("outbound");
    expect(inboundMsg.direction).toBe("inbound");
    expect(inboundMsg.bodyText).toContain("Quand pouvons-nous en parler ?");
  });
});
