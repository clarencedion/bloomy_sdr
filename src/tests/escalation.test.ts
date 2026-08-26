import { describe, it, expect } from "vitest";
import type { ConversationDoc } from "@/types/firestore";

describe("Frontend Human Escalation State (REQ-069)", () => {
  it("should hold human escalation metadata and attention required flag", () => {
    const escalatedConv: ConversationDoc = {
      id: "conv_escalated_1",
      workspaceId: "ws_default",
      businessId: "biz_devcomm",
      companyId: "comp_1",
      contactId: "cont_1",
      status: "human_escalated",
      unreadHumanAttention: true,
      humanAttentionRequired: true,
      escalationReason: "Hostile language or legal threat detected",
      messageCount: 3,
      createdAt: new Date() as any,
      updatedAt: new Date() as any
    };

    expect(escalatedConv.status).toBe("human_escalated");
    expect(escalatedConv.unreadHumanAttention).toBe(true);
    expect(escalatedConv.humanAttentionRequired).toBe(true);
    expect(escalatedConv.escalationReason).toContain("Hostile");
  });
});
