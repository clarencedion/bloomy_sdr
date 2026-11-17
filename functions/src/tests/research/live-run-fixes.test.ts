import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isUsableCompanyWebsite } from "../../services/third-party-domains.js";
import { calculateOpportunityScore } from "../../services/opportunity-scorer.js";

// Found in the live run of 2026-11-10 (fresh start, tattoo & barber campaign).
const root = fs.existsSync(path.resolve(process.cwd(), "src/services")) ? process.cwd() : path.resolve(process.cwd(), "functions");

describe("a map, a directory or a booking page is not the prospect's website", () => {
  it.each([
    "https://fr.mappy.com/poi/673810430f15e1550e9f9b06",
    "https://the-tatoueur.com/region/ile-de-france/75/paris-4e-arrondissement/75004/matiere-noire-tattoo",
    "https://kipik.ink/cerbere",
    "https://www.planity.com/tattoo-13-paris-75003-6xg",
    "https://www.fresha.com/fr/lvp/dolores-paris",
    "https://www.tattoocityguide.com/proibink"
  ])("rejects %s", (url) => {
    expect(isUsableCompanyWebsite(url)).toBe(false);
  });

  it("keeps the business's own site", () => {
    expect(isUsableCompanyWebsite("https://www.legaminadixdoigts.com/")).toBe(true);
  });

  it("the website search result goes through the same check", () => {
    const source = fs.readFileSync(path.join(root, "src/services/website-resolver.ts"), "utf8");
    expect(source).toContain("if (!isUsableCompanyWebsite(found)) return { website: undefined");
  });
});

describe("company fit is measured against the campaign", () => {
  const company = {
    name: "La Bête Humaine Tatouage",
    industry: "Tatoueur",
    nafLabel: "Tatoueur",
    description: "Google Places category: Tatoueur. Rating: 4.9 (400 reviews). Query: tatoueur Paris",
    city: "Paris"
  };
  const campaign = { keywords: ["tatoueur", "salon de tatouage", "barbier"], cities: ["Paris", "Lyon"], nafCodes: ["96.09Z", "96.02A"] };

  it("without the campaign every company gets the same fit; with it, keyword and city count", () => {
    const without = calculateOpportunityScore({ company, evidenceItems: [] } as never);
    const withCampaign = calculateOpportunityScore({ company, evidenceItems: [], campaign } as never);
    expect(without.breakdown?.companyFitScore ?? (without as never as { companyFitScore: number }).companyFitScore).toBe(30);
    expect(withCampaign.breakdown?.companyFitScore ?? (withCampaign as never as { companyFitScore: number }).companyFitScore).toBeGreaterThan(30);
  });

  it("research passes the company's campaign to the scorer", () => {
    const source = fs.readFileSync(path.join(root, "src/services/research-company.ts"), "utf8");
    expect(source).toContain("campaign: campaignDoc as never");
    expect(source).toContain('adminDb.collection("discoveryCampaigns").doc(scoringCampaignId)');
  });
});

describe("a company with no site of its own scores the need it has", () => {
  const studio = { name: "Matière Noire Tattoo", industry: "Tatoueur", city: "Paris", directoryUrl: "http://www.instagram.com/matierenoiretattoo/" };
  // Measured on the directory page that used to be recorded as its website.
  const staleSignals = [
    { key: "pagespeed_mobile_score", value: 75 },
    { key: "has_cart_button", value: true },
    { key: "has_booking_widget", value: true }
  ].map((item) => ({ ...item, confidence: 90, nature: "fact", source: "test" }));

  it("Instagram only: 'no site of its own' counts, the other page's signals do not", () => {
    const score = calculateOpportunityScore({ company: studio, evidenceItems: staleSignals } as never);
    const reasons = score.breakdown?.needStrengthReasons ?? [];
    expect(reasons).toContain("Pas de site propre : présence limitée aux réseaux sociaux");
    // 10 + 35 (no site of its own) + 20 (sells nothing online) + 15 (books nothing online)
    expect(score.breakdown?.needStrengthScore).toBe(80);
    expect(reasons).not.toContain("Vitesse mobile moyenne (PageSpeed 75/100)");
  });

  it("a booking or directory page only: same, worded for the platform", () => {
    const score = calculateOpportunityScore({ company: { ...studio, directoryUrl: "https://www.planity.com/x" }, evidenceItems: [] } as never);
    expect(score.breakdown?.needStrengthReasons).toContain("Pas de site propre : présence limitée à une plateforme ou un annuaire");
  });

  it("its own site is judged on its own signals, as before", () => {
    const score = calculateOpportunityScore({ company: { ...studio, website: "https://matierenoire.fr", directoryUrl: "" }, evidenceItems: staleSignals } as never);
    expect(score.breakdown?.needStrengthReasons ?? []).not.toContain("Pas de site propre : présence limitée aux réseaux sociaux");
  });
});

describe("no draft job when nobody can be written to", () => {
  it("the pipeline logs 'no channel' instead of queuing an email that would fail", () => {
    const source = fs.readFileSync(path.join(root, "src/services/task-queue-service.ts"), "utf8");
    expect(source).toContain('type: "outreach.no_channel"');
    expect(source.indexOf("if (existing.empty && !hasEmail) {")).toBeGreaterThan(-1);
  });
});

describe("a company with no site at all", () => {
  it("is the strongest need, not the baseline 10", () => {
    const score = calculateOpportunityScore({ company: { name: "ANDP Barbier Toulouse", city: "Toulouse", website: "", directoryUrl: "" }, evidenceItems: [] } as never);
    expect(score.breakdown?.needStrengthReasons).toContain("Absence de site internet");
    expect(score.breakdown?.needStrengthScore).toBe(85);
  });

  it("is not assumed when the caller did not say (no website key) or a site of theirs was measured", () => {
    const unknown = calculateOpportunityScore({ company: { name: "X", city: "Paris" }, evidenceItems: [] } as never);
    expect(unknown.breakdown?.needStrengthReasons ?? []).not.toContain("Absence de site internet");
    const measured = calculateOpportunityScore({
      company: { name: "X", website: "", directoryUrl: "" },
      evidenceItems: [{ key: "pagespeed_mobile_score", value: 90, confidence: 90, nature: "fact", source: "t" }]
    } as never);
    expect(measured.breakdown?.needStrengthReasons ?? []).not.toContain("Absence de site internet");
  });

  it("a booking-page listing does not count 'books nothing online'", () => {
    const score = calculateOpportunityScore({ company: { name: "Tattoo 13", directoryUrl: "https://www.planity.com/tattoo-13" }, evidenceItems: [] } as never);
    expect(score.breakdown?.needStrengthReasons ?? []).not.toContain("Aucune prise de rendez-vous en ligne sur un site à eux");
  });
});

describe("research tasks get a longer execution budget than 60 s", () => {
  it("pipeline and research tasks: 240 s", () => {
    const source = fs.readFileSync(path.join(root, "src/services/task-queue-service.ts"), "utf8");
    expect(source).toContain('const HEAVY_TASKS = new Set<string>(["TASK_PIPELINE_COMPANY", "TASK_RESEARCH_COMPANY"])');
    expect(source).toContain("(HEAVY_TASKS.has(job.taskType) ? 240_000 : 60_000)");
  });
});
