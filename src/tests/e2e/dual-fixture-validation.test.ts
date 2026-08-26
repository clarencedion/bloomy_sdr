import { describe, it, expect } from "vitest";
import { BLOOMY_FIXTURE_CONFIG, DEVCOMM_FIXTURE_CONFIG } from "../../../functions/src/tests/fixtures/e2e-fixture-runner";

describe("Phase 16 — Dual-Fixture Multi-Business Configuration & Invariant Suite (Root Suite)", () => {
  it("should have complete and isolated fixture definitions for Bloomy and Devcomm", () => {
    expect(BLOOMY_FIXTURE_CONFIG.businessId).toBe("biz_bloomy");
    expect(DEVCOMM_FIXTURE_CONFIG.businessId).toBe("biz_devcomm");

    // Bloomy Offer and KB
    expect(BLOOMY_FIXTURE_CONFIG.offer.name).toContain("E-Commerce");
    expect(BLOOMY_FIXTURE_CONFIG.offer.pricingGuardrails.canDiscloseInColdReply).toBe(true);
    expect(BLOOMY_FIXTURE_CONFIG.knowledgeBase.faqs[0].answer).toContain("3 semaines");

    // Devcomm Offer and KB
    expect(DEVCOMM_FIXTURE_CONFIG.offer.name).toContain("Skills2Drive");
    expect(DEVCOMM_FIXTURE_CONFIG.offer.pricingGuardrails.canDiscloseInColdReply).toBe(false);
    expect(DEVCOMM_FIXTURE_CONFIG.knowledgeBase.faqs[0].answer).toContain("Qualiopi");

    // Distinct target personas
    const bloomyPersonas = BLOOMY_FIXTURE_CONFIG.offer.targetPersonas.map(p => p.title.toLowerCase());
    const devcommPersonas = DEVCOMM_FIXTURE_CONFIG.offer.targetPersonas.map(p => p.title.toLowerCase());

    expect(bloomyPersonas.some(p => p.includes("fleuriste"))).toBe(true);
    expect(devcommPersonas.some(p => p.includes("directeur commercial"))).toBe(true);
    expect(devcommPersonas.some(p => p.includes("fleuriste"))).toBe(false);
  });

  it("should target distinct NAF codes and company scales", () => {
    // Bloomy targets florists (47.76Z), 3 employees
    expect(BLOOMY_FIXTURE_CONFIG.lead.nafCode).toBe("47.76Z");
    expect(BLOOMY_FIXTURE_CONFIG.lead.employeeCount).toBe(3);

    // Devcomm targets industrial manufacturing (25.62B), 45 employees, 3 sites
    expect(DEVCOMM_FIXTURE_CONFIG.lead.nafCode).toBe("25.62B");
    expect(DEVCOMM_FIXTURE_CONFIG.lead.employeeCount).toBe(45);
    expect(DEVCOMM_FIXTURE_CONFIG.lead.establishmentCount).toBe(3);
  });
});
