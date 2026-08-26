import { describe, it, expect } from "vitest";
import type { OpportunityScore, QualificationState } from "@/types/domain";

describe("Opportunity Scoring & Explainability Domain Models (REQ-037 to REQ-042)", () => {
  it("enforces complete OpportunityScore contract with multi-factor breakdown and weights", () => {
    const score: OpportunityScore = {
      companyFitScore: 92,
      needStrengthScore: 88,
      commercialValueScore: 75,
      evidenceConfidence: 94,
      overallScore: 86,
      qualificationState: "HIGH_PRIORITY",
      weights: {
        companyFitWeight: 0.25,
        needStrengthWeight: 0.35,
        commercialScaleWeight: 0.25,
        evidenceConfidenceWeight: 0.15
      },
      breakdown: {
        companyFitScore: 92,
        companyFitReasons: ["Code NAF en cible (match exact)", "Taille d'équipe dans la cible (45 salariés)"],
        needStrengthScore: 88,
        needStrengthReasons: ["Vitesse mobile critique (PageSpeed 28/100)", "Absence de certificat HTTPS sécurisé"],
        commercialValueScore: 75,
        commercialValueReasons: ["PME solide (45 salariés)", "Réseau de 3 établissements"],
        evidenceConfidence: 94,
        confidenceReasons: ["7 signaux vérifiés analysés"],
        penalties: []
      },
      detectedNeeds: [
        "Performance mobile critique (PageSpeed 28/100, LCP 4.8s)",
        "Site non sécurisé (certificat HTTPS manquant)"
      ],
      buyingTriggers: [
        "Forte notoriété locale (140 avis Google) freinée par un site mobile lent",
        "Présence multi-établissements (3 sites)"
      ],
      recommendedAngle: "Diagnostic conversion mobile & valorisation de la notoriété locale",
      calculatedAt: new Date()
    };

    expect(score.overallScore).toBe(86);
    expect(score.qualificationState).toBe("HIGH_PRIORITY");
    expect(score.weights.companyFitWeight + score.weights.needStrengthWeight + score.weights.commercialScaleWeight + score.weights.evidenceConfidenceWeight).toBeCloseTo(1.0, 5);
    expect(score.breakdown.companyFitReasons.length).toBe(2);
    expect(score.detectedNeeds.length).toBe(2);
    expect(score.buyingTriggers.length).toBe(2);
  });

  it("supports all four qualification states", () => {
    const states: QualificationState[] = [
      "DISQUALIFIED",
      "NEEDS_MORE_EVIDENCE",
      "QUALIFIED",
      "HIGH_PRIORITY"
    ];

    expect(states).toHaveLength(4);
    expect(states).toContain("DISQUALIFIED");
    expect(states).toContain("HIGH_PRIORITY");
  });
});
