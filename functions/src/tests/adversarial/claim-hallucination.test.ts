import { describe, it, expect } from "vitest";
import { validateOutreachClaims } from "../../services/claim-validator.js";
import type { EvidenceItem } from "../../types/domain.js";

describe("Adversarial Security Audit: Evidence Provenance & Claim Grounding (Invariant 5)", () => {
  const company = {
    id: "comp_test_adversarial",
    name: "Florist Nantes SARL",
    city: "Nantes",
    employeeCount: 4
  };

  const validEvidence: EvidenceItem[] = [
    {
      id: "ev_1",
      workspaceId: "ws_default",
      businessId: "biz_bloomy",
      companyId: company.id,
      signalProvider: "google_places",
      key: "google_places_review_count",
      value: 140,
      confidence: 90,
      nature: "fact",
      sourceType: "google_places",
      collectedAt: new Date()
    },
    {
      id: "ev_2",
      workspaceId: "ws_default",
      businessId: "biz_bloomy",
      companyId: company.id,
      signalProvider: "google_places",
      key: "google_places_rating",
      value: 4.8,
      confidence: 90,
      nature: "fact",
      sourceType: "google_places",
      collectedAt: new Date()
    },
    {
      id: "ev_3",
      workspaceId: "ws_default",
      businessId: "biz_bloomy",
      companyId: company.id,
      signalProvider: "pagespeed",
      key: "pagespeed_mobile_score",
      value: 28,
      confidence: 95,
      nature: "derived_metric",
      sourceType: "pagespeed",
      collectedAt: new Date()
    }
  ];

  it("should catch fabricated employee headcount claims not supported by company metadata", () => {
    const sequence = {
      subject: "Collaboration avec votre équipe",
      body: "Bonjour, j'ai remarqué votre équipe de 50 salariés à Nantes. Nous vous accompagnons dans votre croissance. Si ce sujet n'est pas pertinent, dites-le-moi simplement."
    };

    const validation = validateOutreachClaims({
      sequence,
      company, // Official count is 4
      evidenceItems: validEvidence
    });

    expect(validation.passed).toBe(false);
    expect(validation.status).toBe("UNSUPPORTED_CLAIMS_DETECTED");
    expect(validation.unsupportedClaims.some((c) => c.includes("50 salariés"))).toBe(true);
  });

  it("should catch hallucinated Google review counts and ratings", () => {
    const sequence = {
      subject: "Vos avis clients",
      body: "Bonjour, avec 850 avis et une note de 3.2/5, nous pouvons vous aider. Si ce sujet n'est pas pertinent, dites-le-moi simplement."
    };

    const validation = validateOutreachClaims({
      sequence,
      company,
      evidenceItems: validEvidence // Real reviews: 140, rating: 4.8
    });

    expect(validation.passed).toBe(false);
    expect(validation.status).toBe("UNSUPPORTED_CLAIMS_DETECTED");
    expect(validation.unsupportedClaims.some((c) => c.includes("850"))).toBe(true);
  });

  it("should catch hallucinated PageSpeed scores without evidence backing", () => {
    const sequence = {
      subject: "Performance de votre site",
      body: "Bonjour, votre score mobile de 92/100 sur votre boutique en ligne peut encore être amélioré. Si ce sujet n'est pas pertinent, dites-le-moi simplement."
    };

    const validation = validateOutreachClaims({
      sequence,
      company,
      evidenceItems: validEvidence // Real PageSpeed is 28
    });

    expect(validation.passed).toBe(false);
    expect(validation.status).toBe("UNSUPPORTED_CLAIMS_DETECTED");
    expect(validation.unsupportedClaims.some((c) => c.includes("92/100"))).toBe(true);
  });

  it("should catch city location hallucination", () => {
    const sequence = {
      subject: "Votre présence à Marseille",
      body: "Bonjour, votre activité à Marseille est impressionnante. Seriez-vous disponible pour échanger ? Si ce sujet n'est pas pertinent, dites-le-moi simplement."
    };

    const validation = validateOutreachClaims({
      sequence,
      company, // Company is located in Nantes
      evidenceItems: validEvidence
    });

    expect(validation.passed).toBe(false);
    expect(validation.unsupportedClaims.some((c) => c.includes("Marseille"))).toBe(true);
  });

  it("should catch prohibited promises and reject with PROHIBITED_PROMISES_DETECTED", () => {
    const prohibitedDrafts = [
      "Nous pouvons doubler votre chiffre d'affaires en 30 jours !",
      "Résultats garantis à 100% avec notre méthode.",
      "Nous vous garantissons d'être le numéro 1 garanti sur Google."
    ];

    for (const draft of prohibitedDrafts) {
      const validation = validateOutreachClaims({
        sequence: {
          subject: "Offre exceptionnelle",
          body: `Bonjour, ${draft} Si ce sujet n'est pas pertinent, dites-le-moi simplement.`
        },
        company,
        evidenceItems: validEvidence
      });

      expect(validation.passed).toBe(false);
      expect(validation.status).toBe("PROHIBITED_PROMISES_DETECTED");
      expect(validation.prohibitedPromisesDetected.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("should approve authentic, evidence-grounded copy with soft opt-out sentence", () => {
    const authenticSequence = {
      subject: "Vos 140 avis Google à Nantes & boutique en ligne",
      body: "Bonjour,\n\nAvec 140 avis clients et une excellente note de 4.8/5 à Nantes, votre réputation locale est remarquable. Cependant, votre boutique mobile affiche un score PageSpeed de 28/100 sans commande directe.\n\nSeriez-vous ouvert à un court diagnostic de 20 minutes cette semaine ?\n\nSi ce sujet n'est pas pertinent pour vous, dites-le-moi simplement et je ne vous relancerai pas."
    };

    const validation = validateOutreachClaims({
      sequence: authenticSequence,
      company,
      evidenceItems: validEvidence
    });

    expect(validation.passed).toBe(true);
    expect(validation.status).toBe("VALID");
    expect(validation.unsupportedClaims.length).toBe(0);
    expect(validation.prohibitedPromisesDetected.length).toBe(0);
    expect(validation.verifiedClaims.length).toBeGreaterThanOrEqual(2);
    expect(validation.hasOptOut).toBe(true);
  });
});
