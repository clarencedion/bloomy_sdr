import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deterministicIcpTranslation, extractTradeKeywords } from "../../services/icp-translator.js";

const cwd = process.cwd();
const base = cwd.endsWith("/functions") ? cwd : join(cwd, "functions");
const source = readFileSync(join(base, "src/services/icp-translator.ts"), "utf8");

/**
 * A campaign brief becomes the search the SDR actually runs, so a bad
 * translation is not a cosmetic problem - it decides who gets contacted.
 * Every case below comes from a brief a real user typed.
 */

describe("Keywords are the trade, not the brief's verbs", () => {
  it("does not turn an English brief into a search for verbs", () => {
    // Reported live: this exact brief produced ["want","sell","website","hairdressers"].
    // The stopword list was French-only, so English verbs survived and the SDR
    // would have searched Google Places for "want Paris".
    const keywords = extractTradeKeywords("I want to sell website to hairdressers in Paris");
    expect(keywords).not.toContain("want");
    expect(keywords).not.toContain("sell");
    expect(keywords).not.toContain("website");
  });

  it("does not turn a French brief into a search for verbs", () => {
    // Also live: ["veux","sites","internet","coiffeurs"].
    const keywords = extractTradeKeywords("Je veux vendre des sites internet a des coiffeurs a Paris");
    expect(keywords).not.toContain("veux");
    expect(keywords).not.toContain("sites");
    expect(keywords).not.toContain("internet");
  });

  it("drops place names, which are geography and not a trade", () => {
    expect(extractTradeKeywords("des plombiers a Nantes et Rennes")).not.toContain("nantes");
  });

  it("strips the intent words but cannot verify what remains is a trade", () => {
    // The honest limit of a blocklist: it removes words known to describe
    // intent, it does not validate that the remainder names a business type.
    // "something" survives because no list can enumerate every non-trade noun.
    //
    // That limit is acceptable only because falling back is no longer silent -
    // `discovery.icp.fallback_used` is logged as a warning, so a weak keyword
    // list is visible rather than quietly driving a campaign.
    const keywords = extractTradeKeywords("I want to sell something");
    expect(keywords).not.toContain("want");
    expect(keywords).not.toContain("sell");
    expect(keywords).toEqual(["something"]);
  });
});

describe("The trade is recognised", () => {
  it("maps hairdressers to the salon trade and its NAF code, in either language", () => {
    for (const brief of [
      "I want to sell website to hairdressers in Paris",
      "Je veux vendre des sites internet a des coiffeurs a Paris"
    ]) {
      const result = deterministicIcpTranslation(brief);
      expect(result.keywords).toContain("salon de coiffure");
      expect(result.keywords).toContain("coiffeur");
      expect(result.nafCodes).toContain("96.02A");
      // Search queries are run against French listings.
      expect(result.keywords.join(" ")).not.toMatch(/hairdress/i);
    }
  });
});

describe("Geography beyond a city name", () => {
  it("resolves a city to its department", () => {
    const result = deterministicIcpTranslation("des coiffeurs a Paris");
    expect(result.cities).toContain("Paris");
    expect(result.departments).toContain("75");
  });

  it("resolves a region to every department it contains", () => {
    const result = deterministicIcpTranslation("des coiffeurs en Bretagne");
    expect(result.regions.join(" ")).toMatch(/Bretagne/i);
    expect(result.departments).toEqual(expect.arrayContaining(["22", "29", "35", "56"]));
  });

  it("resolves Île-de-France with or without the accent", () => {
    for (const brief of ["salons en Île-de-France", "salons en Ile-de-France"]) {
      expect(deterministicIcpTranslation(brief).departments).toEqual(
        expect.arrayContaining(["75", "92", "93", "94"])
      );
    }
  });

  it("resolves a department named in words", () => {
    expect(deterministicIcpTranslation("coiffeurs en Loire-Atlantique").departments).toContain("44");
  });

  it("resolves a department given as a number", () => {
    expect(deterministicIcpTranslation("coiffeurs dans le 44").departments).toContain("44");
  });

  it("does not read an arbitrary two-digit number as an area", () => {
    // "20 salariés" is a size, not a department; 20 is not a French department.
    expect(deterministicIcpTranslation("entreprises de 20 salariés").departments).not.toContain("20");
  });
});

describe("Provider selection cannot silently omit a provider", () => {
  it("routes each configured provider to its own key and endpoint", () => {
    // This was a two-branch ternary: selecting a third provider reached for the
    // OpenAI key, found none, and dropped to the fallback with no error. A live
    // campaign was built from that fallback.
    expect(source).toContain('providerName === "qwen"');
    expect(source).toContain('providerName === "openai"');
    expect(source).toContain("QWEN_DEFAULT_BASE_URL");
  });

  it("never falls back to the built-in parser silently", () => {
    // The fallback recognises a handful of trades and infers no NAF code, so
    // using it is a real degradation the owner has to be able to see.
    expect(source).toContain("discovery.icp.fallback_used");
    expect(source).toContain('level: "warning"');
  });
});
