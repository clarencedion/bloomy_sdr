import { describe, expect, it } from "vitest";
import { validateOutreachClaims } from "../../services/claim-validator.js";
import type { EvidenceItem } from "../../types/domain.js";

describe("REQ-050: Factual Claim Validator Pass", () => {
  const verifiedEvidence: EvidenceItem[] = [
    {
      id: "ev_1",
      workspaceId: "ws_default",
      businessId: "biz_devcomm",
      companyId: "comp_1",
      signalProvider: "pagespeed",
      key: "pagespeed_mobile_score",
      value: 32,
      sourceType: "pagespeed",
      confidence: 95,
      nature: "derived_metric",
      collectedAt: new Date()
    },
    {
      id: "ev_2",
      workspaceId: "ws_default",
      businessId: "biz_devcomm",
      companyId: "comp_1",
      signalProvider: "google_places",
      key: "google_places_review_count",
      value: 85,
      sourceType: "google_places",
      confidence: 90,
      nature: "fact",
      collectedAt: new Date()
    }
  ];

  it("passes valid draft with verified claims and correct guardrails", () => {
    const sequence = {
      subject: "Diagnostic web mobile pour TechCorp",
      body: `Bonjour,

En observant votre site web, j'ai noté un score PageSpeed mobile de 32/100 ainsi que vos 85 avis clients sur Google qui attestent d'une belle notoriété.

Nous accompagnons les PME pour moderniser leur vitesse de chargement et fluidifier le parcours client.

Seriez-vous ouvert à un court échange de 20 minutes cette semaine ?

Bien à vous,

Si ce sujet n'est pas pertinent, dites-le-moi simplement et je ne vous relancerai pas.`,
      followUp1: "Bonjour, un court mot pour savoir si un échange de 20 min était envisageable.",
      followUp2: "Bonjour, je clôture nos échanges si ce n'est pas pertinent.",
      linkedinNote: "Bonjour, ravi de me connecter avec vous autour des sujets de conversion web.",
      linkedinFollowUp: "Merci pour la connexion !"
    };

    const result = validateOutreachClaims({
      sequence,
      company: { id: "comp_1", name: "TechCorp", city: "Nantes", employeeCount: 10 },
      evidenceItems: verifiedEvidence
    });

    expect(result.passed).toBe(true);
    expect(result.status).toBe("VALID");
    expect(result.verifiedClaims.length).toBeGreaterThan(0);
    expect(result.unsupportedClaims.length).toBe(0);
  });

  it("detects and flags hallucinated employee counts (FACT != INFERENCE)", () => {
    const sequence = {
      subject: "Échange commercial",
      body: `Bonjour,

J'ai remarqué votre équipe de 50 salariés à Nantes.

Nous accompagnons les entreprises dans leur structuration.

Seriez-vous disponible pour un échange diagnostic de 20 minutes ?

Si ce sujet n'est pas pertinent, dites-le-moi simplement.`
    };

    // Official employeeCount is 10, but copy claims 50
    const result = validateOutreachClaims({
      sequence,
      company: { id: "comp_1", name: "TechCorp", city: "Nantes", employeeCount: 10 },
      evidenceItems: verifiedEvidence
    });

    expect(result.passed).toBe(false);
    expect(result.status).toBe("UNSUPPORTED_CLAIMS_DETECTED");
    expect(result.unsupportedClaims.some((c) => c.includes("50 salariés"))).toBe(true);
  });

  it("detects and flags fabricated geographic locations", () => {
    const sequence = {
      subject: "Échange commercial",
      body: `Bonjour,

Je vous contacte au sujet de votre activité à Marseille.

Seriez-vous disponible pour un échange diagnostic de 20 minutes ?

Si ce sujet n'est pas pertinent, dites-le-moi simplement.`
    };

    // Official company city is Nantes
    const result = validateOutreachClaims({
      sequence,
      company: { id: "comp_1", name: "TechCorp", city: "Nantes" },
      evidenceItems: verifiedEvidence
    });

    expect(result.passed).toBe(false);
    expect(result.status).toBe("UNSUPPORTED_CLAIMS_DETECTED");
    expect(result.unsupportedClaims.some((c) => c.includes("Marseille"))).toBe(true);
  });

  it("detects and blocks prohibited promises from offer config", () => {
    const sequence = {
      subject: "Résultats garantis",
      body: `Bonjour,

Nous pouvons doubler votre chiffre d'affaires en 30 jours avec notre méthode.

Seriez-vous disponible pour un échange de 20 minutes ?

Si ce sujet n'est pas pertinent, dites-le-moi simplement.`
    };

    const result = validateOutreachClaims({
      sequence,
      company: { id: "comp_1", name: "TechCorp", city: "Nantes" },
      offer: {
        prohibitedPromises: ["doubler votre chiffre d'affaires"]
      }
    });

    expect(result.passed).toBe(false);
    expect(result.status).toBe("PROHIBITED_PROMISES_DETECTED");
    expect(result.prohibitedPromisesDetected).toContain("doubler votre chiffre d'affaires");
  });
});
