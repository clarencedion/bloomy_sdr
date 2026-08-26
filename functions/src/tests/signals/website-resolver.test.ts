import { describe, it, expect } from "vitest";
import {
  createWebsiteResolutionEvidence,
  EXCLUDED_DOMAINS_LIST,
  isExcludedDomain
} from "../../services/website-resolver.js";

describe("Anti-Annuaire Website Resolver (REQ-029)", () => {
  it("contains 60+ excluded directory and social domains", () => {
    expect(EXCLUDED_DOMAINS_LIST.length).toBeGreaterThanOrEqual(60);
    expect(EXCLUDED_DOMAINS_LIST).toContain("pages-jaunes.fr");
    expect(EXCLUDED_DOMAINS_LIST).toContain("societe.com");
    expect(EXCLUDED_DOMAINS_LIST).toContain("pappers.fr");
    expect(EXCLUDED_DOMAINS_LIST).toContain("infogreffe.fr");
    expect(EXCLUDED_DOMAINS_LIST).toContain("tripadvisor.fr");
    expect(EXCLUDED_DOMAINS_LIST).toContain("facebook.com");
    expect(EXCLUDED_DOMAINS_LIST).toContain("instagram.com");
    expect(EXCLUDED_DOMAINS_LIST).toContain("linkedin.com");
  });

  it("correctly identifies directory and social domains as excluded", () => {
    expect(isExcludedDomain("https://www.societe.com/societe/artisan-123456.html")).toBe(true);
    expect(isExcludedDomain("https://fr.pagesjaunes.fr/pros/12345")).toBe(true);
    expect(isExcludedDomain("https://www.pappers.fr/entreprise/test-123")).toBe(true);
    expect(isExcludedDomain("https://www.tripadvisor.fr/Restaurant_Review")).toBe(true);
    expect(isExcludedDomain("https://facebook.com/boulangerie")).toBe(true);
  });

  it("allows authentic independent business domains", () => {
    expect(isExcludedDomain("https://www.fleuriste-nantes.fr")).toBe(false);
    expect(isExcludedDomain("https://boulangerie-martin.com")).toBe(false);
    expect(isExcludedDomain("https://garage-dupont.fr/contact")).toBe(false);
  });

  it("createWebsiteResolutionEvidence generates verified evidence items", () => {
    const resolvedResult = {
      website: "https://fleuriste-jardin.fr",
      domain: "fleuriste-jardin.fr",
      resolvedBy: "pappers" as const
    };

    const evidence = createWebsiteResolutionEvidence(resolvedResult);
    expect(evidence.length).toBe(4);

    const evidenceMap = new Map(evidence.map((e) => [e.key, e]));

    expect(evidenceMap.get("has_website")?.value).toBe(true);
    expect(evidenceMap.get("has_website")?.nature).toBe("fact");
    expect(evidenceMap.get("has_website")?.confidence).toBe(95);

    expect(evidenceMap.get("resolved_website")?.value).toBe("https://fleuriste-jardin.fr");
    expect(evidenceMap.get("resolved_domain")?.value).toBe("fleuriste-jardin.fr");
    expect(evidenceMap.get("website_resolve_source")?.value).toBe("pappers");
  });

  it("createWebsiteResolutionEvidence handles unresolved cases", () => {
    const unresolvedResult = {
      website: undefined,
      domain: undefined,
      resolvedBy: "none" as const
    };

    const evidence = createWebsiteResolutionEvidence(unresolvedResult);
    expect(evidence.length).toBe(1);
    expect(evidence[0].key).toBe("has_website");
    expect(evidence[0].value).toBe(false);
    expect(evidence[0].nature).toBe("fact");
  });
});
