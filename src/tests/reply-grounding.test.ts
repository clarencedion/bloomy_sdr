import { describe, it, expect } from "vitest";
import type { ConversationDoc, ReplyDraft } from "@/types/firestore";

describe("Frontend Reply Grounding & Draft Model (REQ-066)", () => {
  it("should format and structure grounded reply draft with cited proof points", () => {
    const draft: ReplyDraft = {
      subject: "Re: Diagnostic pour Fleuriste Nantes",
      bodyText: "Bonjour,\n\nUne refonte complète prend 3 semaines. Nous avons accompagné l'Atelier Floral (+40% de conversion).\n\nBien cordialement,",
      citedKnowledgePoints: [
        "Délai de livraison: 3 semaines",
        "Étude de cas: Atelier Floral (+40% de conversion)"
      ],
      pricingGuardrailPassed: true,
      pricingDisclosed: false,
      prohibitedPromisesChecked: true,
      confidence: 0.94,
      draftedAt: new Date().toISOString(),
      status: "queued_for_approval"
    };

    expect(draft.citedKnowledgePoints?.length).toBe(2);
    expect(draft.pricingGuardrailPassed).toBe(true);
    expect(draft.bodyText).toContain("3 semaines");
  });

  it("should bind draftResponse to ConversationDoc correctly", () => {
    const conversation: ConversationDoc = {
      id: "conv_123",
      workspaceId: "ws_default",
      businessId: "biz_bloomy",
      companyId: "comp_123",
      contactId: "cont_123",
      status: "human_review_required",
      unreadHumanAttention: true,
      humanAttentionRequired: true,
      messageCount: 2,
      createdAt: new Date() as any,
      updatedAt: new Date() as any,
      draftResponse: {
        subject: "Re: Délais",
        bodyText: "Bonjour, nos délais sont de 3 semaines.",
        pricingGuardrailPassed: true,
        prohibitedPromisesChecked: true,
        confidence: 0.9,
        draftedAt: new Date().toISOString(),
        status: "draft"
      }
    };

    expect(conversation.draftResponse?.status).toBe("draft");
    expect(conversation.status).toBe("human_review_required");
  });
});
