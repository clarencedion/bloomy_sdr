import { describe, it, expect, beforeAll } from "vitest";
import { generateGroundedReply } from "../../services/reply-generator.js";
import { saveKnowledgeBase, createOffer, createBusiness } from "../../services/business-service.js";
import type { KnowledgeBaseDoc, OfferDoc } from "../../types/domain.js";

describe("KnowledgeBase Grounded Response Engine (REQ-066)", () => {
  const mockOffer: Omit<OfferDoc, "id" | "createdAt" | "updatedAt"> = {
    workspaceId: "ws_default",
    businessId: "biz_bloomy",
    name: "Refonte & Modernisation Web",
    description: "Création de sites web haute conversion pour artisans et PME",
    targetPersonas: [],
    valuePropositions: ["Augmentation du taux de conversion", "Design mobile-first ultra rapide"],
    proofPoints: ["+40% de conversion moyenne", "Score PageSpeed > 90/100"],
    pricingGuardrails: {
      startingPrice: 1500,
      currency: "EUR",
      pricingModel: "fixed",
      canDiscloseInColdReply: true
    },
    prohibitedPromises: ["garantie de résultats sous 30 jours", "100% remboursé"]
  };

  const mockKb: Partial<KnowledgeBaseDoc> = {
    services: [
      {
        name: "Refonte de site vitrine & e-commerce",
        description: "Modernisation complète et optimisation mobile",
        idealFor: "Artisans, commerçants et PME locales"
      }
    ],
    caseStudies: [
      {
        title: "Atelier Floral Nantes",
        clientIndustry: "Fleuriste / Artisanat",
        metric: "+40% de commandes en ligne",
        description: "Refonte complète sous 3 semaines avec optimisation mobile"
      }
    ],
    faqs: [
      {
        question: "Combien de temps prend une refonte de site ?",
        answer: "Une refonte complète prend en moyenne 3 semaines entre le cadrage initial et la mise en ligne."
      },
      {
        question: "Comment gérez-vous la maintenance ?",
        answer: "Nous assurons une garantie technique et des mises à jour régulières de sécurité."
      }
    ],
    pricingRules: ["À partir de 1 500 € pour un site vitrine standard"],
    prohibitedPromises: ["1ère place Google garantie"]
  };

  beforeAll(async () => {
    await createBusiness("ws_default", {
      id: "biz_bloomy",
      name: "Bloomy Digital Studio",
      defaultLanguage: "fr",
      branding: { primaryColor: "#4f46e5", tagline: "Web & Growth" },
      automationPolicy: {
        mode: "autonomous_safe",
        dailyOutreachLimit: 50,
        dailyDiscoveryLimit: 50,
        requireApprovalBeforeSend: false,
        autoReplySafeThreshold: 0.85
      },
      calendarConfig: {
        provider: "cal_com",
        workingDays: [1, 2, 3, 4, 5],
        workingHours: { start: "09:00", end: "18:00" },
        timezone: "Europe/Paris"
      }
    });
    await createOffer("ws_default", "biz_bloomy", mockOffer);
    await saveKnowledgeBase("ws_default", "biz_bloomy", mockKb);
  });

  it("should answer delivery timeline questions citing the 3-week timeline from KnowledgeBase", async () => {
    const result = await generateGroundedReply({
      workspaceId: "ws_default",
      businessId: "biz_bloomy",
      latestInboundMessage: {
        subject: "Re: Diagnostic pour votre site",
        bodyText: "Bonjour, combien de temps prend une refonte complète de notre site ?",
        senderEmail: "gerant@fleuriste-paris.fr"
      },
      classification: {
        intent: "QUESTION",
        confidence: 0.92,
        detectedQuestions: ["Délai de réalisation de la prestation"]
      }
    });

    expect(result.draft.bodyText.toLowerCase()).toContain("3 semaines");
    expect(result.draft.citedKnowledgePoints && result.draft.citedKnowledgePoints.length).toBeGreaterThan(0);
    expect(result.draft.pricingGuardrailPassed).toBe(true);
    expect(result.requiresHumanEscalation).toBe(false);
  });

  it("should cite floral case studies when asked for florist/artisan references", async () => {
    const result = await generateGroundedReply({
      workspaceId: "ws_default",
      businessId: "biz_bloomy",
      latestInboundMessage: {
        subject: "Re: Diagnostic",
        bodyText: "Bonjour, avez-vous des exemples ou des références de sites de fleuristes déjà réalisés ?",
        senderEmail: "contact@fleurs-nantes.fr"
      },
      classification: {
        intent: "QUESTION",
        confidence: 0.95,
        detectedQuestions: ["Références clients et exemples sectoriels"]
      }
    });

    expect(
      result.draft.bodyText.toLowerCase().includes("floral") ||
      result.draft.bodyText.toLowerCase().includes("fleur") ||
      result.draft.bodyText.toLowerCase().includes("réalisation")
    ).toBe(true);
    expect(result.draft.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("should handle existing provider objection with consultative non-aggressive positioning", async () => {
    const result = await generateGroundedReply({
      workspaceId: "ws_default",
      businessId: "biz_bloomy",
      latestInboundMessage: {
        subject: "Re: Diagnostic",
        bodyText: "Merci mais nous avons déjà une agence web qui s'occupe de notre site.",
        senderEmail: "contact@entreprise.fr"
      },
      classification: {
        intent: "OBJECTION",
        objectionType: "EXISTING_PROVIDER",
        confidence: 0.92
      }
    });

    expect(result.draft.bodyText.toLowerCase()).toContain("partenaire");
    expect(result.draft.bodyText.toLowerCase()).toContain("audit");
    expect(result.draft.status).toBe("draft");
  });
});
