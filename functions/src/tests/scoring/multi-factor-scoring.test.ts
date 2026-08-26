import { describe, it, expect } from "vitest";
import { calculateOpportunityScore } from "../../services/opportunity-scorer.js";
import type { EvidenceItem, OfferDoc } from "../../types/domain.js";

describe("Multi-Factor Opportunity Scoring Engine (REQ-037, REQ-038)", () => {
  const bloomyWebOffer: Partial<OfferDoc> = {
    id: "offer_bloomy_web",
    name: "Refonte & Modernisation Web / E-Commerce",
    description: "Création et optimisation de sites web haute conversion pour commerçants et PME",
    valuePropositions: [
      "Amélioration radicale de la vitesse mobile et conversion",
      "Déploiement de tunnel e-commerce et Click & Collect",
      "Modernisation de l'identité visuelle et expérience utilisateur"
    ],
    scoringWeights: {
      companyFitWeight: 0.20,
      needStrengthWeight: 0.45,
      commercialScaleWeight: 0.20,
      evidenceConfidenceWeight: 0.15
    },
    scoringRules: {
      minScoreForQualification: 50,
      highPriorityThreshold: 80,
      minEvidenceConfidence: 60,
      targetKeywords: ["artisan", "fleuriste", "boutique", "magasin", "commerce", "deco"]
    }
  };

  it("calculates high needStrengthScore and overallScore >= 80 for strong reviews + poor PageSpeed + missing e-commerce", () => {
    const company = {
      id: "comp_fleuriste_nantes",
      name: "Atelier Floral Nantes",
      industry: "Fleuriste & Décoration",
      nafCode: "47.76Z",
      nafLabel: "Commerce de détail de fleurs, plantes, graines, engrais",
      city: "Nantes",
      postalCode: "44000",
      employeeCount: 4,
      establishmentCount: 1,
      administrativeStatus: "A",
      siren: "890123456"
    };

    const evidenceItems: EvidenceItem[] = [
      {
        id: "ev_1",
        workspaceId: "ws_test",
        businessId: "biz_bloomy",
        companyId: "comp_fleuriste_nantes",
        signalProvider: "google_places",
        key: "google_places_review_count",
        value: 140,
        sourceType: "google_places",
        confidence: 95,
        nature: "fact",
        collectedAt: new Date()
      },
      {
        id: "ev_2",
        workspaceId: "ws_test",
        businessId: "biz_bloomy",
        companyId: "comp_fleuriste_nantes",
        signalProvider: "google_places",
        key: "google_places_rating",
        value: 4.8,
        sourceType: "google_places",
        confidence: 95,
        nature: "fact",
        collectedAt: new Date()
      },
      {
        id: "ev_3",
        workspaceId: "ws_test",
        businessId: "biz_bloomy",
        companyId: "comp_fleuriste_nantes",
        signalProvider: "pagespeed",
        key: "pagespeed_mobile_score",
        value: 28,
        sourceType: "pagespeed",
        confidence: 95,
        nature: "derived_metric",
        collectedAt: new Date()
      },
      {
        id: "ev_4",
        workspaceId: "ws_test",
        businessId: "biz_bloomy",
        companyId: "comp_fleuriste_nantes",
        signalProvider: "pagespeed",
        key: "pagespeed_lcp",
        value: 4.8,
        sourceType: "pagespeed",
        confidence: 90,
        nature: "derived_metric",
        collectedAt: new Date()
      },
      {
        id: "ev_5",
        workspaceId: "ws_test",
        businessId: "biz_bloomy",
        companyId: "comp_fleuriste_nantes",
        signalProvider: "website_ecommerce",
        key: "has_ecommerce",
        value: false,
        sourceType: "website",
        confidence: 85,
        nature: "fact",
        collectedAt: new Date()
      },
      {
        id: "ev_6",
        workspaceId: "ws_test",
        businessId: "biz_bloomy",
        companyId: "comp_fleuriste_nantes",
        signalProvider: "website_technical",
        key: "mobile_friendly",
        value: false,
        sourceType: "website",
        confidence: 90,
        nature: "derived_metric",
        collectedAt: new Date()
      },
      {
        id: "ev_7",
        workspaceId: "ws_test",
        businessId: "biz_bloomy",
        companyId: "comp_fleuriste_nantes",
        signalProvider: "website_technical",
        key: "outdated_copyright",
        value: true,
        sourceType: "website",
        confidence: 80,
        nature: "derived_metric",
        collectedAt: new Date()
      }
    ];

    const result = calculateOpportunityScore({
      company,
      evidenceItems,
      offer: bloomyWebOffer,
      campaign: {
        keywords: ["fleuriste", "commerce", "boutique"],
        cities: ["Nantes"]
      }
    });

    expect(result.needStrengthScore).toBeGreaterThanOrEqual(85);
    expect(result.overallScore).toBeGreaterThanOrEqual(80);
    expect(result.qualificationState).toBe("HIGH_PRIORITY");
    expect(result.breakdown.needStrengthReasons.length).toBeGreaterThan(0);
    expect(result.detectedNeeds.length).toBeGreaterThan(0);
    expect(result.buyingTriggers.length).toBeGreaterThan(0);
    expect(result.recommendedAngle).toBeDefined();
  });
});
