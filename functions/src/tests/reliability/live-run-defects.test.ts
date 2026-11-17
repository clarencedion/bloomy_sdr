import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isUsableCompanyWebsite, describeUnusableWebsite } from "../../services/third-party-domains.js";
import { parseResearchJson } from "../../services/research-schema.js";
import { parseOutreachJson } from "../../services/outreach-schema.js";
import { detectContactForm } from "../../services/contact-form-detector.js";

const cwd = process.cwd();
const base = cwd.endsWith("/functions") ? cwd : join(cwd, "functions");
const read = (p: string) => readFileSync(join(base, p), "utf8");

/**
 * Regressions for defects found by leaving the SDR running for three days on a
 * live workspace. Every case here is taken from data it actually produced.
 */

describe("A listing is not the prospect's website", () => {
  it("rejects the exact URLs stored as company websites on the live run", () => {
    // All four were in `company.website` and were being audited for speed,
    // scraped for an email, and were candidates for a contact-form send.
    expect(isUsableCompanyWebsite("https://acceslibre.beta.gouv.fr/app/44-nantes/a/tatouage-piercing/erp/bocal-studio/")).toBe(false);
    expect(isUsableCompanyWebsite("https://desencressouslapeau.wordpress.com/2015/12/10/portrait-bastartz-detail/")).toBe(false);
    expect(isUsableCompanyWebsite("https://www.waze.com/fr/live-map/directions/fr/pays-de-la-loire/nantes/origine-tattoo-family")).toBe(false);
    expect(isUsableCompanyWebsite("https://www.planity.com/la-maison-du-tatouage-44120-vertou")).toBe(false);
    expect(isUsableCompanyWebsite("https://www.google.com/search?q=mailto%3Acontact%40aimecorbeau.com")).toBe(false);
  });

  it("still accepts a real business website", () => {
    expect(isUsableCompanyWebsite("https://bastartz-tattoo.fr")).toBe(true);
    expect(isUsableCompanyWebsite("bocal-studio.fr")).toBe(true);
    expect(isUsableCompanyWebsite("https://www.salon-exemple.fr/contact")).toBe(true);
  });

  it("rejects anything that is not a reachable http address", () => {
    expect(isUsableCompanyWebsite(undefined)).toBe(false);
    expect(isUsableCompanyWebsite("")).toBe(false);
    expect(isUsableCompanyWebsite("mailto:contact@example.fr")).toBe(false);
    expect(isUsableCompanyWebsite("javascript:alert(1)")).toBe(false);
    expect(isUsableCompanyWebsite("localhost")).toBe(false);
  });

  it("explains the rejection in words an owner can read", () => {
    expect(describeUnusableWebsite("https://www.planity.com/x")).toContain("directory or platform");
    expect(describeUnusableWebsite("https://real-salon.fr")).toBeNull();
  });

  it("refuses to look for a contact form on a third-party domain", async () => {
    // Independent of what discovery stored: submitting here would send a
    // commercial message to a government service.
    const result = await detectContactForm("https://acceslibre.beta.gouv.fr/contact");
    expect(result.channel).toBe("none");
    expect(result.reason).toContain("directory or platform");
  });

  it("keeps the listing as evidence rather than discarding it", () => {
    const source = read("src/services/run-discovery-campaign.ts");
    // Having only a booking-platform page is the need a web offer sells against.
    expect(source).toContain("company.directoryUrl = company.website");
  });
});

describe("Model output is bounded by truncation, not rejection", () => {
  const research = {
    companySummary: "x".repeat(5000),
    // The live failure: a long sentence where a short label was expected.
    segment: "Salons de tatouage indépendants situés en centre-ville avec une clientèle locale fidèle et un site vitrine obsolète",
    fitScore: 72,
    confidence: 80,
    detectedNeeds: ["site obsolète", 42, null],
    painPoints: [],
    buyingTriggers: [],
    targetPersonas: [],
    personalizedAngle: "y".repeat(4000),
    reasoningSummary: "z".repeat(4000),
    risks: [],
    recommendedNextAction: "approve_outreach",
    sourceUrls: ["https://ok.fr", "not a url"]
  };

  it("keeps a result whose fields ran long instead of discarding the company", () => {
    const parsed = parseResearchJson(research);

    expect(parsed.segment.length).toBeLessThanOrEqual(100);
    expect(parsed.companySummary.length).toBeLessThanOrEqual(4000);
    expect(parsed.fitScore).toBe(72);
    // The research was paid for before validation; losing it is the expensive
    // outcome, and 49% of runs were being lost this way.
    expect(parsed.recommendedNextAction).toBe("approve_outreach");
  });

  it("drops malformed list entries without failing the payload", () => {
    const parsed = parseResearchJson(research);
    expect(parsed.detectedNeeds).toEqual(["site obsolète"]);
    expect(parsed.sourceUrls).toEqual(["https://ok.fr"]);
  });

  it("tolerates a missing narrative field", () => {
    const { personalizedAngle, ...withoutAngle } = research;
    void personalizedAngle;
    const parsed = parseResearchJson(withoutAngle);
    // Empty reads downstream as "not provided" — it is never filled with filler.
    expect(parsed.personalizedAngle).toBe("");
  });

  it("still refuses research with no score, which is not a weak result but no result", () => {
    const { fitScore, ...noScore } = research;
    void fitScore;
    expect(() => parseResearchJson(noScore)).toThrow();
  });

  it("falls back to the cautious action on an unrecognised recommendation", () => {
    const parsed = parseResearchJson({ ...research, recommendedNextAction: "send_it_now" });
    // Never "go ahead and contact them" from an answer we did not understand.
    expect(parsed.recommendedNextAction).toBe("enrich_more");
  });

  it("keeps an email whose body ran past the cap", () => {
    const parsed = parseOutreachJson({ body: "b".repeat(3200), subject: "s".repeat(400) });
    expect(parsed.body.length).toBeLessThanOrEqual(3000);
    expect(parsed.subject.length).toBeLessThanOrEqual(160);
  });

  it("still refuses an email with no body", () => {
    expect(() => parseOutreachJson({ subject: "Bonjour" })).toThrow();
  });
});

describe("Discovery never invents a search or hides exhaustion", () => {
  it("has no hardcoded city or keyword fallback", () => {
    const provider = read("src/providers/discovery/google-places-discovery-provider.ts");
    // These were `["Nantes"]` and `["fleuriste"]`: a nationwide brief silently
    // became a one-city search that went dry after a day.
    expect(provider).not.toContain('["Nantes"]');
    expect(provider).not.toContain('["fleuriste"]');
    expect(provider).toContain("needs at least one city");
  });

  it("refuses to run a campaign with no area rather than picking one", () => {
    const source = read("src/services/run-discovery-campaign.ts");
    expect(source).toContain("discovery.campaign.no_area");
  });

  it("reports when a campaign has covered its area", () => {
    const source = read("src/services/run-discovery-campaign.ts");
    // Twelve consecutive runs created zero companies while still showing active.
    expect(source).toContain("discovery.campaign.area_exhausted");
    expect(source).toContain("emptyRunStreak");
  });

  it("rotates through areas so later cities are actually reached", () => {
    const source = read("src/services/run-discovery-campaign.ts");
    expect(source).toContain("areaCursor");
  });
});

describe("Permanently blocked work is not retried for ever", () => {
  it("records the verdict on the company, not only on the job", () => {
    const source = read("src/services/task-queue-service.ts");
    expect(source).toContain("outreachBlockedReason");
    expect(source).toContain("outreachBlockedAt");
  });

  it("skips those companies in the daily runner", () => {
    const source = read("src/jobs/daily-research-runner.ts");
    // The same 21 companies failed identically every day for the campaign's life.
    expect(source).toContain("companyData.outreachBlockedAt");
    expect(source).toContain("skippedBlocked");
  });

  it("lifts the block as soon as a contact is found", () => {
    const source = read("src/services/contact-waterfall.ts");
    expect(source).toContain("outreachBlockedAt: FieldValue.delete()");
  });

  it("stops attributing unstamped companies to a hardcoded business", () => {
    const source = read("src/jobs/daily-research-runner.ts");
    const step2 = source.slice(source.indexOf("Step 2"), source.indexOf("Step 3"));
    expect(step2).not.toContain('"biz_devcomm"');
  });
});

describe("A failed research is a failed job", () => {
  const queue = read("src/services/task-queue-service.ts");

  it("re-raises a research failure instead of completing the pipeline job", () => {
    // `researchCompany` reports failure by returning. Observed live: 70 jobs
    // recorded completed while all 50 of their research calls had failed on an
    // exhausted credit balance — no retry, no dead letter, a healthy-looking
    // queue doing nothing.
    expect(queue).toContain('if (res.status === "failed")');
  });

  it("blocks a company only on a verdict about the lead, never on an account failure", () => {
    // Exhausted credit or a missing key says nothing about the prospect;
    // stamping it would keep the company out long after the account was fixed.
    expect(queue).toContain("isLeadVerdict");
    expect(queue).toContain("!isTransient && isLeadVerdict");
  });
});
