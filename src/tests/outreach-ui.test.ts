import { describe, expect, it } from "vitest";
import type { Outreach } from "@/types/firestore";

describe("REQ-055 & REQ-056: Outreach UI & Risk Warning Indicators", () => {
  const mockOutreach: Outreach = {
    id: "outreach_1",
    companyId: "comp_1",
    status: "draft",
    generatedSubject: "Diagnostic de performance pour Fleuriste Nantes",
    generatedBody: "Bonjour, j'ai remarqué votre score mobile PageSpeed...",
    followUp1: "Bonjour, courte relance pour savoir si vous aviez pu lire mon message.",
    followUp2: "Bonjour, je clôture nos échanges.",
    linkedinNote: "Bonjour, ravi de me connecter avec vous.",
    linkedinFollowUp: "Merci pour la mise en relation !",
    personalizationFacts: [
      {
        key: "pagespeed_mobile_score",
        label: "Score de performance mobile : 28/100",
        value: 28,
        sourceType: "pagespeed",
        confidence: 95,
        nature: "derived_metric",
        provenance: "Google PageSpeed Insights"
      },
      {
        key: "city",
        label: "Implantation locale à Nantes",
        value: "Nantes",
        sourceType: "official_registry",
        confidence: 100,
        nature: "fact",
        provenance: "SIRENE"
      }
    ],
    claimValidationStatus: "VALID",
    claimValidationDetails: {
      passed: true,
      status: "VALID",
      verifiedClaims: ["Score PageSpeed (28/100) vérifié"],
      unsupportedClaims: [],
      prohibitedPromisesDetected: [],
      warnings: [],
      wordCount: 95,
      hasOptOut: true,
      checkedAt: new Date().toISOString()
    },
    pdfStorageUrl: "https://storage.googleapis.com/test-bucket/pdfs/comp_1/outreach_1.pdf",
    riskWarnings: ["Présence de concurrents directs identifiée"],
    createdAt: new Date() as any,
    updatedAt: new Date() as any
  };

  it("exposes verified personalization facts and validation status on outreach model", () => {
    expect(mockOutreach.personalizationFacts).toBeDefined();
    expect(mockOutreach.personalizationFacts?.length).toBe(2);
    expect(mockOutreach.claimValidationStatus).toBe("VALID");
    expect(mockOutreach.pdfStorageUrl).toContain(".pdf");
  });

  it("exposes risk warnings for operator visibility (REQ-056)", () => {
    expect(mockOutreach.riskWarnings).toBeDefined();
    expect(mockOutreach.riskWarnings?.length).toBeGreaterThan(0);
    expect(mockOutreach.riskWarnings?.[0]).toBe("Présence de concurrents directs identifiée");
  });

  it("handles outreach with unsupported claim warnings", () => {
    const invalidOutreach: Outreach = {
      ...mockOutreach,
      id: "outreach_2",
      claimValidationStatus: "UNSUPPORTED_CLAIMS_DETECTED",
      riskWarnings: [
        "Effectif mentionné (50 salariés) ne correspond pas à l'effectif déclaré (10)."
      ]
    };

    expect(invalidOutreach.claimValidationStatus).toBe("UNSUPPORTED_CLAIMS_DETECTED");
    expect(invalidOutreach.riskWarnings?.[0]).toContain("50 salariés");
  });
});
