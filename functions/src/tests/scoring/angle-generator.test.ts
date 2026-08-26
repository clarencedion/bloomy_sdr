import { describe, it, expect } from "vitest";
import { synthesizeAnglesAndNeeds } from "../../services/angle-generator.js";
import type { EvidenceItem, OfferDoc } from "../../types/domain.js";

describe("Automated Need & Angle Synthesis Engine (REQ-041)", () => {
  it("synthesizes mobile conversion needs and triggers for a local business with high reviews and low PageSpeed", () => {
    const company = {
      name: "Boutique Déco Nantes",
      employeeCount: 3,
      establishmentCount: 1
    };

    const evidenceItems: EvidenceItem[] = [
      {
        id: "ev_1",
        workspaceId: "ws_test",
        businessId: "biz_test",
        companyId: "comp_1",
        signalProvider: "pagespeed",
        key: "pagespeed_mobile_score",
        value: 26,
        sourceType: "pagespeed",
        confidence: 95,
        nature: "derived_metric",
        collectedAt: new Date()
      },
      {
        id: "ev_2",
        workspaceId: "ws_test",
        businessId: "biz_test",
        companyId: "comp_1",
        signalProvider: "google_places",
        key: "google_places_review_count",
        value: 120,
        sourceType: "google_places",
        confidence: 95,
        nature: "fact",
        collectedAt: new Date()
      },
      {
        id: "ev_3",
        workspaceId: "ws_test",
        businessId: "biz_test",
        companyId: "comp_1",
        signalProvider: "website_ecommerce",
        key: "has_ecommerce",
        value: false,
        sourceType: "website",
        confidence: 90,
        nature: "fact",
        collectedAt: new Date()
      }
    ];

    const offer: Partial<OfferDoc> = {
      name: "Modernisation Web & E-Commerce",
      valuePropositions: ["Refonte web haute conversion", "Vente en ligne"]
    };

    const result = synthesizeAnglesAndNeeds({
      company,
      evidenceItems,
      offer
    });

    expect(result.detectedNeeds.some((n) => n.includes("PageSpeed 26/100"))).toBe(true);
    expect(result.detectedNeeds.some((n) => n.includes("e-commerce"))).toBe(true);
    expect(result.buyingTriggers.some((t) => t.includes("120 avis Google"))).toBe(true);
    expect(result.recommendedAngle).toBeDefined();
    expect(result.recommendedAngle.length).toBeGreaterThan(10);
  });

  it("synthesizes sales force structuration angle for multi-site industrial company", () => {
    const company = {
      name: "Industrie Ouest",
      employeeCount: 45,
      establishmentCount: 3
    };

    const offer: Partial<OfferDoc> = {
      name: "Performance & Structuration Commerciale",
      valuePropositions: ["Formation commerciale", "Harmonisation multi-sites"]
    };

    const result = synthesizeAnglesAndNeeds({
      company,
      evidenceItems: [],
      offer
    });

    expect(result.detectedNeeds.some((n) => n.includes("multi-sites"))).toBe(true);
    expect(result.buyingTriggers.some((t) => t.includes("3 sites"))).toBe(true);
    expect(result.recommendedAngle).toContain("force commerciale");
  });
});
