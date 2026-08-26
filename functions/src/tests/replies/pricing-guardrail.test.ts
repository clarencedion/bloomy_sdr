import { describe, it, expect } from "vitest";
import { generateGroundedReply, validateReplyGroundedness } from "../../services/reply-generator.js";
import type { OfferDoc } from "../../types/domain.js";

describe("Zero-Hallucination Pricing Guardrail (REQ-067)", () => {
  const mockOffer: OfferDoc = {
    id: "offer_web",
    workspaceId: "ws_default",
    businessId: "biz_bloomy",
    name: "Refonte & Modernisation Web",
    description: "Création de sites web",
    targetPersonas: [],
    valuePropositions: ["Performance et conversion"],
    proofPoints: ["+40% de conversion"],
    pricingGuardrails: {
      startingPrice: 1500,
      currency: "EUR",
      pricingModel: "fixed",
      canDiscloseInColdReply: true
    },
    prohibitedPromises: ["garantie de résultats sous 30 jours", "100% remboursé"],
    createdAt: new Date() as any,
    updatedAt: new Date() as any
  };

  it("should refuse 50% discount request, explain customized diagnosis, and route to human escalation", async () => {
    const result = await generateGroundedReply({
      workspaceId: "ws_default",
      businessId: "biz_bloomy",
      latestInboundMessage: {
        subject: "Re: Diagnostic",
        bodyText: "Votre offre m'intéresse, mais pouvez-vous nous faire 50% de remise sur le tarif ?",
        senderEmail: "negotiator@prospect.fr"
      },
      classification: {
        intent: "QUESTION",
        objectionType: "PRICE",
        confidence: 0.9,
        detectedQuestions: ["Demande de remise 50%"]
      }
    });

    // Zero-hallucination guardrail check
    expect(result.draft.pricingGuardrailPassed).toBe(false);
    expect(result.requiresHumanEscalation).toBe(true);
    expect(result.escalationReason).toContain("Discount");
    expect(result.draft.bodyText.toLowerCase()).not.toContain("d'accord pour 50%");
    expect(result.draft.bodyText.toLowerCase()).not.toContain("nous acceptons");
  });

  it("should disclose starting price when explicitly permitted by pricingGuardrails", async () => {
    const result = await generateGroundedReply({
      workspaceId: "ws_default",
      businessId: "biz_bloomy",
      latestInboundMessage: {
        subject: "Re: Diagnostic",
        bodyText: "Bonjour, quels sont vos tarifs pour une refonte de site ?",
        senderEmail: "client@prospect.fr"
      },
      classification: {
        intent: "QUESTION",
        objectionType: "PRICE",
        confidence: 0.92,
        detectedQuestions: ["Tarifs et prix"]
      }
    });

    expect(result.draft.pricingDisclosed).toBe(true);
    expect(result.draft.pricingGuardrailPassed).toBe(true);
    expect(result.draft.bodyText).toContain("1500");
  });

  it("should detect prohibited promises during validation pass", () => {
    const badDraft = "Bonjour, nous vous offrons une garantie de résultats sous 30 jours pour votre site.";
    const validation = validateReplyGroundedness(badDraft, mockOffer, null);

    expect(validation.passed).toBe(false);
    expect(validation.prohibitedPromisesDetected).toContain("garantie de résultats sous 30 jours");
  });

  it("should detect unapproved discounts in validation pass", () => {
    const discountDraft = "Bonjour, nous vous accordons exceptionnellement 50% de remise sur votre projet.";
    const validation = validateReplyGroundedness(discountDraft, mockOffer, null);

    expect(validation.passed).toBe(false);
    expect(validation.pricingGuardrailPassed).toBe(false);
  });
});
