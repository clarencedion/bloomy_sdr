import { describe, it, expect } from "vitest";
import type { OfferDoc, DiscoveryCampaign } from "@/types/firestore";

describe("Phase 02 — Multiple Offers & Campaign Inheritance (REQ-002, REQ-003)", () => {
  it("should support multiple distinct offers per business with structured personas and pricing guardrails (REQ-002)", () => {
    const websiteOffer: OfferDoc = {
      id: "off_bloomy_website",
      workspaceId: "ws_default",
      businessId: "biz_bloomy",
      name: "Website Modernization & Mobile Optimization",
      description: "Fast modern showcase website for French artisans",
      targetPersonas: [
        {
          title: "Artisan / Commerçant / Gérant",
          priority: 1,
          keywords: ["gérant", "propriétaire", "artisan", "patron", "fondateur"],
        },
      ],
      valuePropositions: [
        "Instant mobile loading (<1.5s PageSpeed)",
        "Turnkey online ordering and booking integration",
      ],
      proofPoints: [
        "95+ mobile PageSpeed scores on modern web architectures",
        "Over 30 local business website redesigns delivered",
      ],
      pricingGuardrails: {
        startingPrice: 1490,
        currency: "EUR",
        pricingModel: "fixed",
        canDiscloseInColdReply: true,
      },
      prohibitedPromises: ["guaranteed #1 Google ranking in 48 hours"],
      createdAt: { seconds: 1700000000, nanoseconds: 0 } as any,
      updatedAt: { seconds: 1700000000, nanoseconds: 0 } as any,
    };

    const ecommerceOffer: OfferDoc = {
      id: "off_bloomy_ecommerce",
      workspaceId: "ws_default",
      businessId: "biz_bloomy",
      name: "E-Commerce & Online Store Modernization",
      description: "Full e-commerce setup with online cart, payments, and inventory sync",
      targetPersonas: [
        {
          title: "Directeur E-Commerce / Fondateur",
          priority: 1,
          keywords: ["fondateur", "e-commerce", "gérant"],
        },
      ],
      valuePropositions: ["Stripe payment integration", "Automated shipping and order management"],
      proofPoints: ["Processed over €500k in local client sales"],
      pricingGuardrails: {
        startingPrice: 2490,
        currency: "EUR",
        pricingModel: "fixed",
        canDiscloseInColdReply: true,
      },
      prohibitedPromises: ["guaranteed sales volume"],
      createdAt: { seconds: 1700000000, nanoseconds: 0 } as any,
      updatedAt: { seconds: 1700000000, nanoseconds: 0 } as any,
    };

    expect(websiteOffer.businessId).toBe("biz_bloomy");
    expect(ecommerceOffer.businessId).toBe("biz_bloomy");
    expect(websiteOffer.id).not.toBe(ecommerceOffer.id);
    expect(websiteOffer.pricingGuardrails?.startingPrice).toBe(1490);
    expect(ecommerceOffer.pricingGuardrails?.startingPrice).toBe(2490);
  });

  it("should link campaigns to specific offers (REQ-003)", () => {
    const campaign: DiscoveryCampaign = {
      id: "camp_florists_nantes",
      workspaceId: "ws_default",
      businessId: "biz_bloomy",
      offerId: "off_bloomy_website",
      name: "Nantes Florists Website Redesign",
      status: "active",
      segment: "custom",
      cities: ["Nantes", "Saint-Herblain"],
      keywords: ["fleuriste", "artisan fleuriste"],
      maxCompaniesPerRun: 25,
      providerPriority: ["recherche_entreprises", "google_places"],
      autoQueueHighScoreCompanies: true,
      minDiscoveryScoreForAutoResearch: 75,
      minQualityScoreForAutoResearch: 70,
      createdAt: { seconds: 1700000000, nanoseconds: 0 } as any,
      updatedAt: { seconds: 1700000000, nanoseconds: 0 } as any,
    };

    expect(campaign.offerId).toBe("off_bloomy_website");
    expect(campaign.businessId).toBe("biz_bloomy");
    expect(campaign.workspaceId).toBe("ws_default");
  });
});
