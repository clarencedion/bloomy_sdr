import { describe, it, expect } from "vitest";
import { calculateOpportunityScore } from "../../services/opportunity-scorer.js";
import type { EvidenceItem, OfferDoc } from "../../types/domain.js";

describe("Four-Tier Qualification State Machine (REQ-039)", () => {
  const standardOffer: Partial<OfferDoc> = {
    id: "offer_standard",
    name: "Modernisation & Croissance",
    scoringWeights: {
      companyFitWeight: 0.30,
      needStrengthWeight: 0.30,
      commercialScaleWeight: 0.25,
      evidenceConfidenceWeight: 0.15
    },
    scoringRules: {
      minScoreForQualification: 50,
      highPriorityThreshold: 80,
      minEvidenceConfidence: 60
    }
  };

  it("classifies an administratively closed/inactive company as DISQUALIFIED", () => {
    const company = {
      id: "comp_closed",
      name: "Entreprise Fermee SAS",
      administrativeStatus: "C", // Cessée
      siren: "123456789",
      employeeCount: 0
    };

    const score = calculateOpportunityScore({
      company,
      offer: standardOffer
    });

    expect(score.qualificationState).toBe("DISQUALIFIED");
    expect(score.overallScore).toBeLessThan(50);
    expect(score.breakdown.penalties).toContain("Entreprise administrativement inactive ou fermée");
  });

  it("classifies a lead with overallScore >= 50 but evidenceConfidence < 60 as NEEDS_MORE_EVIDENCE", () => {
    const company = {
      id: "comp_unproven",
      name: "Nouvelle Entreprise SAS",
      administrativeStatus: "A",
      siren: "987654321",
      employeeCount: 10
    };

    // No evidence gathered yet -> default confidence is 40 < 60
    const score = calculateOpportunityScore({
      company,
      evidenceItems: [],
      offer: standardOffer
    });

    if (score.overallScore >= 50) {
      expect(score.qualificationState).toBe("NEEDS_MORE_EVIDENCE");
    }
    expect(score.evidenceConfidence).toBeLessThan(60);
  });

  it("classifies a lead with overallScore >= 50 and evidenceConfidence >= 60 and < 80 as QUALIFIED", () => {
    const company = {
      id: "comp_qualified",
      name: "Boutique Mode Nantes",
      administrativeStatus: "A",
      siren: "555666777",
      employeeCount: 6,
      city: "Nantes"
    };

    const evidenceItems: EvidenceItem[] = [
      {
        id: "ev_1",
        workspaceId: "ws_test",
        businessId: "biz_test",
        companyId: "comp_qualified",
        signalProvider: "company_registry",
        key: "is_active",
        value: true,
        sourceType: "official_registry",
        confidence: 100,
        nature: "fact",
        collectedAt: new Date()
      },
      {
        id: "ev_2",
        workspaceId: "ws_test",
        businessId: "biz_test",
        companyId: "comp_qualified",
        signalProvider: "pagespeed",
        key: "pagespeed_mobile_score",
        value: 55,
        sourceType: "pagespeed",
        confidence: 90,
        nature: "derived_metric",
        collectedAt: new Date()
      }
    ];

    const score = calculateOpportunityScore({
      company,
      evidenceItems,
      offer: standardOffer,
      campaign: { cities: ["Nantes"] }
    });

    expect(score.overallScore).toBeGreaterThanOrEqual(50);
    expect(score.evidenceConfidence).toBeGreaterThanOrEqual(60);
    expect(score.qualificationState).toBe("QUALIFIED");
  });

  it("classifies a lead with overallScore >= 80 and evidenceConfidence >= 60 as HIGH_PRIORITY", () => {
    const company = {
      id: "comp_high_pri",
      name: "Leader Usinage Haute Précision",
      administrativeStatus: "A",
      siren: "999888777",
      employeeCount: 45,
      establishmentCount: 2,
      nafCode: "25.62B",
      city: "Lyon",
      description: "Usinage mécanique de précision"
    };

    const evidenceItems: EvidenceItem[] = [
      {
        id: "ev_1",
        workspaceId: "ws_test",
        businessId: "biz_test",
        companyId: "comp_high_pri",
        signalProvider: "company_registry",
        key: "is_active",
        value: true,
        sourceType: "official_registry",
        confidence: 100,
        nature: "fact",
        collectedAt: new Date()
      },
      {
        id: "ev_2",
        workspaceId: "ws_test",
        businessId: "biz_test",
        companyId: "comp_high_pri",
        signalProvider: "pagespeed",
        key: "pagespeed_mobile_score",
        value: 22,
        sourceType: "pagespeed",
        confidence: 95,
        nature: "derived_metric",
        collectedAt: new Date()
      },
      {
        id: "ev_3",
        workspaceId: "ws_test",
        businessId: "biz_test",
        companyId: "comp_high_pri",
        signalProvider: "website_technical",
        key: "mobile_friendly",
        value: false,
        sourceType: "website",
        confidence: 90,
        nature: "derived_metric",
        collectedAt: new Date()
      }
    ];

    const score = calculateOpportunityScore({
      company,
      evidenceItems,
      offer: standardOffer,
      campaign: {
        nafCodes: ["25.62B"],
        cities: ["Lyon"],
        keywords: ["usinage", "mecanique"]
      }
    });

    expect(score.overallScore).toBeGreaterThanOrEqual(80);
    expect(score.evidenceConfidence).toBeGreaterThanOrEqual(60);
    expect(score.qualificationState).toBe("HIGH_PRIORITY");
  });
});
