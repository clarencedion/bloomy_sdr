import { describe, expect, it } from "vitest";
import { translateIcpPrompt } from "../services/icp-translator.js";
import { selectSignalStrategy } from "../services/signal-selector.js";


describe("Phase 03: Natural Language ICP Translation & Dynamic Signals", () => {
  it("translates 'Florists in Nantes for web design' into florist NAF, Nantes, and selects website_technical (REQ-011, REQ-012, REQ-013)", async () => {
    const prompt = "Find French florists in Nantes with weak digital presence to sell e-commerce websites";
    const result = await translateIcpPrompt({ prompt });

    expect(result.cities).toContain("Nantes");
    expect(result.departments).toContain("44");
    
    // NAF code check (Florists: 47.76Z or 4776Z)
    const hasFloristNaf = result.nafCodes.some(code => code.includes("47.76") || code.includes("4776"));
    expect(hasFloristNaf).toBe(true);

    // Keywords check
    const hasFloristKeyword = result.keywords.some(kw => kw.toLowerCase().includes("fleur"));
    expect(hasFloristKeyword).toBe(true);

    // Signal provider strategy check
    expect(result.researchStrategy.enabledSignalProviders).toContain("company_registry");
    expect(result.researchStrategy.enabledSignalProviders).toContain("google_places");
    expect(result.researchStrategy.enabledSignalProviders).toContain("website_technical");
    expect(result.researchStrategy.enabledSignalProviders).toContain("website_presence");
  });

  it("translates 'Sales consulting for French manufacturing SMEs' into industrial NAF, min scale >= 20, and selects company_scale/company_hiring without website_technical (REQ-012, REQ-013)", async () => {
    const prompt = "Sales consulting for French manufacturing SMEs in machining and fabrication";
    const result = await translateIcpPrompt({ prompt });

    expect(result.segment).toBe("commercial_performance");
    expect(result.minEmployeeCount).toBeGreaterThanOrEqual(20);

    // Industrial NAF codes check (machining/mechanics: 25.62B, 28.41Z, 25.11Z)
    const hasIndustrialNaf = result.nafCodes.some(code => code.startsWith("25") || code.startsWith("28"));
    expect(hasIndustrialNaf).toBe(true);

    // Dynamic signals check: includes company_scale and company_hiring, does NOT include website_technical
    expect(result.researchStrategy.enabledSignalProviders).toContain("company_registry");
    expect(result.researchStrategy.enabledSignalProviders).toContain("company_scale");
    expect(result.researchStrategy.enabledSignalProviders).toContain("company_hiring");
    expect(result.researchStrategy.enabledSignalProviders).not.toContain("website_technical");
  });

  it("translates bakery prompt in Lyon with online ordering and enables website_ecommerce", async () => {
    const prompt = "Boulangeries artisanales à Lyon pour site vitrine et commande en ligne";
    const result = await translateIcpPrompt({ prompt });

    expect(result.cities).toContain("Lyon");
    expect(result.departments).toContain("69");

    const hasBakeryNaf = result.nafCodes.some(code => code.includes("10.71") || code.includes("1071"));
    expect(hasBakeryNaf).toBe(true);

    expect(result.researchStrategy.enabledSignalProviders).toContain("website_ecommerce");
    expect(result.researchStrategy.enabledSignalProviders).toContain("website_technical");
    expect(result.researchStrategy.enabledSignalProviders).toContain("google_places");
  });

  it("enforces prompt length validation (max 1000 chars, min 3 chars)", async () => {
    await expect(translateIcpPrompt({ prompt: "" })).rejects.toThrow();
    await expect(translateIcpPrompt({ prompt: "hi" })).rejects.toThrow();
    
    const tooLongPrompt = "a".repeat(1001);
    await expect(translateIcpPrompt({ prompt: tooLongPrompt })).rejects.toThrow("1,000 characters");
  });

  it("dynamically configures scoring weights based on signal archetypes in selectSignalStrategy", () => {
    const webStrategy = selectSignalStrategy({
      prompt: "Modernisation de site web vitrine pour artisans"
    });
    expect(webStrategy.scoringWeights?.needStrengthWeight).toBeGreaterThan(0.4);

    const scaleStrategy = selectSignalStrategy({
      prompt: "PME industrielles et multi-sites pour audit logistique",
      minEmployeeCount: 50
    });
    expect(scaleStrategy.scoringWeights?.companyFitWeight).toBeGreaterThanOrEqual(0.3);
    expect(scaleStrategy.enabledSignalProviders).toContain("company_scale");
  });
});
