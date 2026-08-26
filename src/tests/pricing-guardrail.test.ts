import { describe, it, expect } from "vitest";
import type { OfferDoc } from "@/types/firestore";

describe("Frontend Pricing Guardrail Types & Behavior (REQ-067)", () => {
  const offerWithGuardrails: OfferDoc = {
    id: "offer_web",
    workspaceId: "ws_default",
    businessId: "biz_bloomy",
    name: "Refonte Web",
    description: "Services de refonte",
    targetPersonas: [],
    valuePropositions: ["Performance mobile"],
    proofPoints: ["+40% de conversion"],
    pricingGuardrails: {
      startingPrice: 1500,
      currency: "EUR",
      pricingModel: "fixed",
      canDiscloseInColdReply: true
    },
    prohibitedPromises: ["garantie de résultats sous 30 jours"],
    createdAt: new Date() as any,
    updatedAt: new Date() as any
  };

  it("should validate pricing guardrails structure on OfferDoc", () => {
    expect(offerWithGuardrails.pricingGuardrails?.startingPrice).toBe(1500);
    expect(offerWithGuardrails.pricingGuardrails?.canDiscloseInColdReply).toBe(true);
    expect(offerWithGuardrails.prohibitedPromises).toContain("garantie de résultats sous 30 jours");
  });

  it("should support custom quote mode where disclosure is prohibited", () => {
    const customOffer: OfferDoc = {
      ...offerWithGuardrails,
      pricingGuardrails: {
        currency: "EUR",
        pricingModel: "custom_quote",
        canDiscloseInColdReply: false
      }
    };

    expect(customOffer.pricingGuardrails?.canDiscloseInColdReply).toBe(false);
    expect(customOffer.pricingGuardrails?.pricingModel).toBe("custom_quote");
  });
});
