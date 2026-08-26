import { describe, it, expect } from "vitest";
import { calculateOpportunityScore } from "../../services/opportunity-scorer.js";
import type { EvidenceItem, OfferDoc } from "../../types/domain.js";

describe("Consulting Offer Scoring Engine (REQ-037, REQ-038)", () => {
  const devcommConsultingOffer: Partial<OfferDoc> = {
    id: "offer_devcomm_sales",
    name: "Performance & Structuration Commerciale",
    description: "Accompagnement et formation des équipes de vente pour PME et ETI industrielles",
    valuePropositions: [
      "Harmonisation des méthodes de vente multi-sites",
      "Formation et montée en compétences des commerciaux terrain",
      "Mise en place de rituels de management commercial"
    ],
    scoringWeights: {
      companyFitWeight: 0.40,
      needStrengthWeight: 0.25,
      commercialScaleWeight: 0.25,
      evidenceConfidenceWeight: 0.10
    },
    scoringRules: {
      minScoreForQualification: 50,
      highPriorityThreshold: 80,
      minEvidenceConfidence: 60,
      idealEmployeeMin: 15,
      idealEmployeeMax: 250,
      targetNafCodes: ["25.11Z", "25.62Z", "28.29B", "33.20A"],
      targetKeywords: ["industrie", "metallurgie", "usinage", "fabrication", "mecanique"]
    }
  };

  it("assigns companyFitScore >= 90 to a manufacturing company with 45 employees, target NAF, and multiple establishments", () => {
    const company = {
      id: "comp_meca_ouest",
      name: "Mécanique Ouest Industrie",
      industry: "Fabrication de structures métalliques et chaudronnerie",
      nafCode: "25.11Z",
      nafLabel: "Fabrication de structures métalliques et de parties de structures",
      city: "Rennes",
      postalCode: "35000",
      employeeCount: 45,
      establishmentCount: 3,
      administrativeStatus: "A",
      siren: "789456123",
      description: "PME industrielle spécialisée dans l'usinage de précision et la mécano-soudure"
    };

    const evidenceItems: EvidenceItem[] = [
      {
        id: "ev_scale_1",
        workspaceId: "ws_test",
        businessId: "biz_devcomm",
        companyId: "comp_meca_ouest",
        signalProvider: "company_registry",
        key: "is_active",
        value: true,
        sourceType: "official_registry",
        confidence: 100,
        nature: "fact",
        collectedAt: new Date()
      },
      {
        id: "ev_scale_2",
        workspaceId: "ws_test",
        businessId: "biz_devcomm",
        companyId: "comp_meca_ouest",
        signalProvider: "company_registry",
        key: "employee_count",
        value: 45,
        sourceType: "official_registry",
        confidence: 95,
        nature: "fact",
        collectedAt: new Date()
      }
    ];

    const result = calculateOpportunityScore({
      company,
      evidenceItems,
      offer: devcommConsultingOffer,
      campaign: {
        keywords: ["industrie", "mecanique", "fabrication"],
        nafCodes: ["25.11Z"]
      }
    });

    expect(result.companyFitScore).toBeGreaterThanOrEqual(90);
    expect(result.commercialValueScore).toBeGreaterThanOrEqual(70);
    expect(result.overallScore).toBeGreaterThanOrEqual(70);
    expect(result.qualificationState).toMatch(/QUALIFIED|HIGH_PRIORITY/);
    expect(result.breakdown.companyFitReasons).toContain("Code NAF en cible exacte (25.11Z)");
    expect(result.breakdown.companyFitReasons.some(r => r.includes("Taille d'équipe dans la cible (45 salariés)"))).toBe(true);
  });
});
