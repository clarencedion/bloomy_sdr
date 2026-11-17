import type { SignalContext, SignalProvider, SignalResult } from "./signal-provider.js";
import type { EvidenceItem } from "../../types/domain.js";

/**
 * Detects active recruitment from a company's own careers pages.
 *
 * This is the strongest free qualifier for anyone selling TO a sales
 * organisation: a company advertising for commerciaux demonstrably HAS a sales
 * force, which is exactly the precondition for sales training or enablement.
 * Headcount alone cannot tell you that - a 200-person manufacturer may have
 * three salespeople, and a 25-person software firm may have twelve.
 *
 * Deliberately reads only the prospect's own site. Job-board scraping is a
 * licensing and reliability problem, and the careers page is both authoritative
 * and free.
 */

const CAREERS_PATHS = [
  "/recrutement",
  "/carrieres",
  "/carrière",
  "/nous-rejoindre",
  "/rejoignez-nous",
  "/jobs",
  "/careers",
  "/emploi",
  "/offres-emploi"
];

/** Roles that indicate a sales organisation exists. */
const SALES_ROLE_TERMS = [
  "commercial",
  "commerciale",
  "commerciaux",
  "business developer",
  "business development",
  "account manager",
  "account executive",
  "ingénieur d'affaires",
  "ingenieur d'affaires",
  "chargé d'affaires",
  "charge d'affaires",
  "directeur commercial",
  "responsable commercial",
  "sales manager",
  "sdr",
  "télévendeur",
  "televendeur",
  "vendeur",
  "attaché commercial"
];

const TECH_ROLE_TERMS = [
  "développeur",
  "developpeur",
  "developer",
  "webmaster",
  "intégrateur web",
  "chef de projet digital",
  "growth"
];

const HIRING_MARKERS = [
  "nous recrutons",
  "rejoignez-nous",
  "offre d'emploi",
  "offres d'emploi",
  "poste à pourvoir",
  "postes à pourvoir",
  "cdi",
  "cdd",
  "alternance",
  "we are hiring",
  "join our team",
  "open positions"
];

function countOccurrences(haystack: string, terms: string[]): string[] {
  return terms.filter((term) => haystack.includes(term));
}

export class HiringSignalProvider implements SignalProvider {
  readonly id = "company_hiring";
  readonly name = "Hiring & Recruitment Signals";
  readonly description =
    "Detects active recruitment from the company's own careers pages, and whether it is hiring sales roles.";
  readonly capabilities = [
    "is_hiring",
    "is_hiring_sales",
    "hiring_sales_roles",
    "is_hiring_tech",
    "careers_page_url"
  ];
  readonly costPerExecutionUsd = 0;
  readonly timeoutMs = 20000;

  supports(context: SignalContext): boolean {
    return Boolean(context.company?.website || context.company?.domain);
  }

  async collect(context: SignalContext): Promise<SignalResult> {
    const startTime = Date.now();
    const now = new Date();
    // Recruitment changes slowly; a week-old reading is still actionable.
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const base = context.company?.website || `https://${context.company?.domain}`;
    let origin: string;
    try {
      origin = new URL(base).origin;
    } catch {
      return {
        providerId: this.id,
        evidence: [],
        costEstimateUsd: 0,
        durationMs: Date.now() - startTime,
        error: "No usable website URL for hiring detection."
      };
    }

    let combined = "";
    let careersUrl: string | null = null;

    for (const path of CAREERS_PATHS) {
      const url = `${origin}${path}`;
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(6000),
          redirect: "follow",
          headers: { "User-Agent": "Mozilla/5.0 (compatible; SDR-Research/1.0)" }
        });
        if (!response.ok) continue;
        const html = (await response.text()).toLowerCase();
        // A soft-404 returns 200 with the homepage; require a hiring marker.
        if (!HIRING_MARKERS.some((marker) => html.includes(marker))) continue;
        combined += ` ${html}`;
        careersUrl = careersUrl ?? url;
      } catch {
        // Path absent or slow: try the next one.
      }
    }

    const evidence: Array<Omit<EvidenceItem, "id" | "workspaceId" | "businessId" | "companyId">> = [];
    const isHiring = combined.length > 0;
    const salesRoles = countOccurrences(combined, SALES_ROLE_TERMS);
    const techRoles = countOccurrences(combined, TECH_ROLE_TERMS);

    const push = (
      key: string,
      value: unknown,
      nature: EvidenceItem["nature"],
      confidence: number
    ) => {
      evidence.push({
        signalProvider: this.id,
        key,
        value: value as EvidenceItem["value"],
        sourceType: "website",
        sourceUrl: careersUrl ?? origin,
        confidence,
        nature,
        collectedAt: now,
        expiresAt,
        costUsd: 0
      });
    };

    push("is_hiring", isHiring, "fact", isHiring ? 85 : 60);
    push("is_hiring_sales", salesRoles.length > 0, "derived_metric", salesRoles.length > 0 ? 85 : 60);
    push("is_hiring_tech", techRoles.length > 0, "derived_metric", techRoles.length > 0 ? 80 : 60);
    if (salesRoles.length) push("hiring_sales_roles", salesRoles.slice(0, 6), "fact", 85);
    if (careersUrl) push("careers_page_url", careersUrl, "fact", 95);

    return {
      providerId: this.id,
      evidence,
      costEstimateUsd: 0,
      durationMs: Date.now() - startTime
    };
  }
}
