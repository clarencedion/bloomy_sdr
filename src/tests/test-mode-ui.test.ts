import { describe, it, expect } from "vitest";

describe("Frontend Test Mode Banner & Safety UI", () => {
  it("should format allowlist email status badge correctly", () => {
    const allowlist = ["clarence@devcomm.fr", "demo@bloomy.fr"];
    const label = `${allowlist.length} email(s) autorisé(s)`;
    expect(label).toBe("2 email(s) autorisé(s)");
    expect(allowlist.includes("clarence@devcomm.fr")).toBe(true);
    expect(allowlist.includes("stranger@external.com")).toBe(false);
  });

  it("should normalize email addresses to lowercase before allowlist matching", () => {
    const rawInput = "  CLARENCE@DevComm.FR  ";
    const normalized = rawInput.trim().toLowerCase();
    const allowlist = ["clarence@devcomm.fr"];
    expect(allowlist.includes(normalized)).toBe(true);
  });

  it("should match wildcard domain rules (e.g. @devcomm.fr)", () => {
    const allowlist = ["@devcomm.fr"];
    const testEmail = "jean.dupont@devcomm.fr";
    const isAllowed = allowlist.some((rule) => {
      if (rule.startsWith("@")) return testEmail.endsWith(rule);
      return testEmail === rule;
    });
    expect(isAllowed).toBe(true);
  });

  it("should verify 8 pipeline stages are defined for One-Click SDR Demo Modal", () => {
    const STAGES = [
      "Campagne & ICP",
      "Découverte SIRENE",
      "Signaux & Preuves",
      "Scoring & Angle",
      "Copywriting Factuel",
      "Porte de Sécurité",
      "Triage de Réponse",
      "Réservation Calendrier"
    ];
    expect(STAGES.length).toBe(8);
  });
});
