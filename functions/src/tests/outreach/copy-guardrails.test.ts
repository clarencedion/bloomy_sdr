import { describe, expect, it } from "vitest";
import { validateOutreachClaims } from "../../services/claim-validator.js";

describe("REQ-052 & REQ-053: French Copywriting Guardrails & Soft Opt-Out", () => {
  it("enforces word count between 80 and 140 words and flags robotic buzzwords", () => {
    // 1. Text with robotic buzzword
    const buzzwordDraft = {
      subject: "Synergie et innovation pour votre entreprise",
      body: `Bonjour,

Dans un monde en constante évolution, notre solution innovante et disruptive est le catalyseur de croissance idéal pour votre entreprise.

Nous proposons de révolutionner vos méthodes de travail avec une synergie d'experts.

Seriez-vous disponible pour un échange de 20 minutes ?

Bien à vous,

Si ce sujet n'est pas pertinent, dites-le-moi simplement et je ne vous relancerai pas.`
    };

    const buzzwordResult = validateOutreachClaims({
      sequence: buzzwordDraft,
      company: { name: "SampleCorp" }
    });

    expect(buzzwordResult.warnings.some((w) => w.toLowerCase().includes("dans un monde en constante évolution"))).toBe(true);
    expect(buzzwordResult.warnings.some((w) => w.toLowerCase().includes("synergie"))).toBe(true);
  });

  it("verifies presence of mandatory soft opt-out sentence (REQ-053)", () => {
    // Missing opt-out sentence
    const missingOptOut = {
      subject: "Échange commercial",
      body: `Bonjour,

Je me permets de vous contacter pour échanger sur le développement commercial de votre entreprise et explorer de nouvelles pistes de croissance.

Nous accompagnons les dirigeants dans l'optimisation de leurs processus de vente à travers une méthodologie éprouvée et pragmatique.

Seriez-vous ouvert à un court échange téléphonique de 20 minutes cette semaine afin de faire un premier point ?

Bien cordialement,
Clarence Dion`
    };

    const resultWithoutOptOut = validateOutreachClaims({
      sequence: missingOptOut,
      company: { name: "SampleCorp" }
    });

    expect(resultWithoutOptOut.hasOptOut).toBe(false);
    expect(resultWithoutOptOut.warnings.some((w) => w.includes("désengagement poli"))).toBe(true);

    // With opt-out sentence
    const withOptOut = {
      ...missingOptOut,
      body: `${missingOptOut.body}\n\nSi ce sujet n’est pas pertinent pour vous, dites-le-moi simplement et je ne vous relancerai pas.`
    };

    const resultWithOptOut = validateOutreachClaims({
      sequence: withOptOut,
      company: { name: "SampleCorp" }
    });

    expect(resultWithOptOut.hasOptOut).toBe(true);
  });

  it("calculates precise word count for cold email body (80-140 words)", () => {
    const validBody = `Bonjour Marc,

Je me permets de vous contacter car l'optimisation des méthodes et des outils constitue un levier clé de performance pour BioNantes.

Notre équipe accompagne les entreprises afin de fluidifier leurs processus et concrétiser leurs objectifs de croissance de manière pragmatique.

L'objectif serait simplement de partager un premier diagnostic court pour identifier d'éventuels points d'optimisation prioritaires.

Seriez-vous ouvert à un court échange de 20 minutes cette semaine ?

Bien à vous,

Si ce sujet n’est pas pertinent pour vous, dites-le-moi simplement et je ne vous relancerai pas.`;

    const result = validateOutreachClaims({
      sequence: { subject: "Diagnostic", body: validBody },
      company: { name: "BioNantes" }
    });

    expect(result.wordCount).toBeGreaterThanOrEqual(80);
    expect(result.wordCount).toBeLessThanOrEqual(140);
  });
});
