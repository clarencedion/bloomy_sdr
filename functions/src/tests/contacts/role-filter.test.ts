import { describe, it, expect } from "vitest";
import { isJobTitleIrrelevant, IRRELEVANT_ROLE_KEYWORDS } from "../../services/persona-ranker.js";

describe("Negative Role Filtering (REQ-044)", () => {
  it("contains extensive list of irrelevant keywords", () => {
    expect(IRRELEVANT_ROLE_KEYWORDS.length).toBeGreaterThan(20);
  });
  it("filters out accounting, financial audit, and bookkeeping roles", () => {
    const accountingTitles = [
      "Commissaire aux comptes",
      "Commissaire au compte titulaire",
      "Expert-comptable",
      "Expert comptable associé",
      "Responsable comptable",
      "Chef comptable",
      "Comptable unique",
      "Auditeur financier junior",
      "Trésorier de l'association"
    ];

    for (const title of accountingTitles) {
      expect(isJobTitleIrrelevant(title), `Expected "${title}" to be filtered out`).toBe(true);
    }
  });

  it("filters out legal, compliance, and DPO roles", () => {
    const legalTitles = [
      "Avocat associé",
      "Avocate au barreau",
      "Juriste d'entreprise",
      "Responsable des affaires juridiques",
      "Senior Legal Counsel",
      "DPO (Data Protection Officer)",
      "Responsable conformité & RGPD"
    ];

    for (const title of legalTitles) {
      expect(isJobTitleIrrelevant(title), `Expected "${title}" to be filtered out`).toBe(true);
    }
  });

  it("filters out interns, apprentices, and students", () => {
    const studentTitles = [
      "Stagiaire marketing digital",
      "Alternant commercial",
      "Alternante RH",
      "Apprenti boulanger",
      "Étudiant en stage de césure",
      "Sales Intern"
    ];

    for (const title of studentTitles) {
      expect(isJobTitleIrrelevant(title), `Expected "${title}" to be filtered out`).toBe(true);
    }
  });

  it("filters out clerical, assistants, and reception staff", () => {
    const clericalTitles = [
      "Assistante de direction",
      "Assistant administratif",
      "Secrétaire général adjoint",
      "Secrétaire médicale",
      "Réceptionniste d'accueil",
      "Standardiste"
    ];

    for (const title of clericalTitles) {
      expect(isJobTitleIrrelevant(title), `Expected "${title}" to be filtered out`).toBe(true);
    }
  });

  it("allows valid decision makers and business roles to pass through", () => {
    const validDecisionMakerTitles = [
      "Président",
      "Président Directeur Général",
      "Directeur Général",
      "Directrice Générale",
      "Gérant",
      "Gérante associée",
      "Fondateur",
      "Co-fondatrice",
      "Artisan fleuriste",
      "Directeur Commercial",
      "Head of Sales",
      "Responsable des Ventes",
      "Directeur des Opérations",
      "Directeur Marketing",
      "Chief Executive Officer",
      "Owner",
      "Managing Director"
    ];

    for (const title of validDecisionMakerTitles) {
      expect(isJobTitleIrrelevant(title), `Expected "${title}" to be allowed`).toBe(false);
    }
  });

  it("handles empty or undefined titles gracefully", () => {
    expect(isJobTitleIrrelevant(undefined)).toBe(false);
    expect(isJobTitleIrrelevant("")).toBe(false);
    expect(isJobTitleIrrelevant("   ")).toBe(false);
  });
});
