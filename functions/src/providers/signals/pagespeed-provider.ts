import type { SignalContext, SignalProvider, SignalResult } from "./signal-provider.js";
import type { EvidenceItem } from "../../types/domain.js";
import { getIntegrationSecrets, type IntegrationSecrets } from "../../utils/settings.js";

export interface PageSpeedLighthouseResult {
  lighthouseResult?: {
    categories?: {
      performance?: {
        score?: number;
      };
    };
    audits?: {
      "largest-contentful-paint"?: {
        numericValue?: number;
        displayValue?: string;
      };
      "first-contentful-paint"?: {
        numericValue?: number;
        displayValue?: string;
      };
      viewport?: {
        score?: number;
      };
    };
  };
}

export class PagespeedSignalProvider implements SignalProvider {
  readonly id = "pagespeed";
  readonly name = "Google PageSpeed Insights & Core Web Vitals";
  readonly description = "Audits mobile performance, Core Web Vitals (LCP, FCP), and mobile-friendliness via Google PageSpeed Insights REST API.";
  readonly capabilities = [
    "mobile_pagespeed_score",
    "lcp_seconds",
    "fcp_seconds",
    "mobile_friendly"
  ];
  readonly costPerExecutionUsd = 0;

  supports(context: SignalContext): boolean {
    if (context.company.rawProviderData && typeof context.company.rawProviderData === "object" && "pagespeed" in (context.company.rawProviderData as object)) {
      return true;
    }
    return Boolean(context.company.website || context.company.domain);
  }

  async collect(context: SignalContext): Promise<SignalResult> {
    const startTime = Date.now();
    const evidence: Array<Omit<EvidenceItem, "id" | "workspaceId" | "businessId" | "companyId">> = [];

    const rawUrl = context.company.website || (context.company.domain ? `https://${context.company.domain}` : undefined);
    if (!rawUrl && (!context.company.rawProviderData || !("pagespeed" in (context.company.rawProviderData as object)))) {
      return {
        providerId: this.id,
        evidence: [],
        costEstimateUsd: 0,
        durationMs: Date.now() - startTime,
        error: "No website or domain provided for PageSpeed audit."
      };
    }

    const targetUrl = rawUrl && rawUrl.startsWith("http") ? rawUrl : rawUrl ? `https://${rawUrl}` : "https://example.com";

    try {
      let data: PageSpeedLighthouseResult | null = null;

      // 1. Check for fixture / mock in rawProviderData
      if (
        context.company.rawProviderData &&
        typeof context.company.rawProviderData === "object" &&
        "pagespeed" in (context.company.rawProviderData as object)
      ) {
        data = (context.company.rawProviderData as { pagespeed: PageSpeedLighthouseResult }).pagespeed;
      }

      // 2. Otherwise query live Google PageSpeed REST API
      if (!data) {
        const secrets: Partial<IntegrationSecrets> = await getIntegrationSecrets().catch(() => ({} as Partial<IntegrationSecrets>));
        const apiKey = secrets.googleApiKey; // Optional Google API key

        const apiUrl = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
        apiUrl.searchParams.set("url", targetUrl);
        apiUrl.searchParams.set("strategy", "mobile");
        apiUrl.searchParams.set("category", "performance");
        if (apiKey) {
          apiUrl.searchParams.set("key", apiKey);
        }

        const response = await fetch(apiUrl.toString(), {
          signal: AbortSignal.timeout(8000),
          headers: {
            "Accept": "application/json"
          }
        });

        if (!response.ok) {
          return {
            providerId: this.id,
            evidence: [],
            costEstimateUsd: 0,
            durationMs: Date.now() - startTime,
            error: `Google PageSpeed API returned status ${response.status}`
          };
        }

        data = (await response.json()) as PageSpeedLighthouseResult;
      }

      if (!data?.lighthouseResult) {
        return {
          providerId: this.id,
          evidence: [],
          costEstimateUsd: 0,
          durationMs: Date.now() - startTime,
          error: "Invalid or empty lighthouse result from PageSpeed API."
        };
      }

      const lighthouse = data.lighthouseResult;
      const now = new Date();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days TTL

      // Extract Performance Score (0 - 100)
      const rawScore = lighthouse.categories?.performance?.score;
      if (rawScore !== undefined && rawScore !== null) {
        const score = Math.round(rawScore * 100);
        evidence.push({
          signalProvider: this.id,
          key: "mobile_pagespeed_score",
          value: score,
          sourceType: "pagespeed",
          sourceUrl: targetUrl,
          confidence: 90,
          nature: "derived_metric",
          collectedAt: now,
          expiresAt,
          costUsd: 0
        });
      }

      // Extract Largest Contentful Paint (LCP) in seconds
      const lcpNumeric = lighthouse.audits?.["largest-contentful-paint"]?.numericValue;
      if (lcpNumeric !== undefined && lcpNumeric !== null) {
        const lcpSeconds = Number((lcpNumeric / 1000).toFixed(2));
        evidence.push({
          signalProvider: this.id,
          key: "lcp_seconds",
          value: lcpSeconds,
          sourceType: "pagespeed",
          sourceUrl: targetUrl,
          confidence: 85,
          nature: "derived_metric",
          collectedAt: now,
          expiresAt,
          costUsd: 0
        });
      }

      // Extract First Contentful Paint (FCP) in seconds
      const fcpNumeric = lighthouse.audits?.["first-contentful-paint"]?.numericValue;
      if (fcpNumeric !== undefined && fcpNumeric !== null) {
        const fcpSeconds = Number((fcpNumeric / 1000).toFixed(2));
        evidence.push({
          signalProvider: this.id,
          key: "fcp_seconds",
          value: fcpSeconds,
          sourceType: "pagespeed",
          sourceUrl: targetUrl,
          confidence: 85,
          nature: "derived_metric",
          collectedAt: now,
          expiresAt,
          costUsd: 0
        });
      }

      // Extract Mobile Friendliness / Viewport status
      const viewportAudit = lighthouse.audits?.viewport?.score;
      const isMobileFriendly = viewportAudit === 1 || (rawScore !== undefined && rawScore >= 0.5);
      evidence.push({
        signalProvider: this.id,
        key: "mobile_friendly",
        value: isMobileFriendly,
        sourceType: "pagespeed",
        sourceUrl: targetUrl,
        confidence: 85,
        nature: "derived_metric",
        collectedAt: now,
        expiresAt,
        costUsd: 0
      });

      return {
        providerId: this.id,
        evidence,
        costEstimateUsd: 0,
        durationMs: Date.now() - startTime
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        providerId: this.id,
        evidence: [],
        costEstimateUsd: 0,
        durationMs: Date.now() - startTime,
        error: errorMsg
      };
    }
  }
}
