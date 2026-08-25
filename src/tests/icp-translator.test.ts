import { describe, expect, it } from "vitest";
import { deterministicIcpTranslation } from "../../functions/src/services/icp-translator";


describe("Root: ICP Translation and Signal Selector Consistency", () => {
  it("translates florist prompt with correct NAF and website_technical signal module (REQ-011, REQ-012, REQ-013)", () => {
    const res = deterministicIcpTranslation("Trouver des fleuristes à Nantes sans site web");
    expect(res.cities).toContain("Nantes");
    expect(res.departments).toContain("44");
    expect(res.nafCodes.some(c => c.includes("47.76") || c.includes("4776"))).toBe(true);
    expect(res.researchStrategy.enabledSignalProviders).toContain("website_technical");
    expect(res.researchStrategy.enabledSignalProviders).toContain("google_places");
  });

  it("translates consulting prompt with industrial scale and no website auditing (REQ-012, REQ-013)", () => {
    const res = deterministicIcpTranslation("PME industrielles en France pour formation commerciale");
    expect(res.segment).toBe("commercial_performance");
    expect(res.minEmployeeCount).toBeGreaterThanOrEqual(20);
    expect(res.researchStrategy.enabledSignalProviders).toContain("company_scale");
    expect(res.researchStrategy.enabledSignalProviders).toContain("company_hiring");
    expect(res.researchStrategy.enabledSignalProviders).not.toContain("website_technical");
  });

  it("selects ecommerce signal module for bakeries with online ordering (REQ-013)", () => {
    const res = deterministicIcpTranslation("Boulangeries à Lyon avec commande en ligne et click and collect");
    expect(res.cities).toContain("Lyon");
    expect(res.researchStrategy.enabledSignalProviders).toContain("website_ecommerce");
  });
});
