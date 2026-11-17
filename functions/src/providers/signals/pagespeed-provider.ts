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

  /**
   * PageSpeed Insights renders the target page on Google's infrastructure.
   * Measured against real French salon sites it takes 30-40s (a genuinely slow
   * site takes longest, because Lighthouse waits for it to load) - so the
   * original 8s bound aborted every request and the audit never produced
   * evidence. Bounded generously rather than tightly: an aborted audit is
   * indistinguishable from a healthy site, which is the failure that matters.
   */
  readonly timeoutMs = 75000;
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

        // Exponential backoff on 429. Note that without `googleApiKey` the
        // public quota is exhausted almost immediately, so a persistent 429
        // means the key is missing rather than that we are querying too fast.
        let response: Response | null = null;
        const maxAttempts = 3;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          response = await fetch(apiUrl.toString(), {
            signal: AbortSignal.timeout(60000),
            headers: { Accept: "application/json" }
          });

          if (response.status !== 429 || attempt === maxAttempts - 1) break;
          await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
        }

        if (!response || !response.ok) {
          const status = response?.status ?? 0;
          return {
            providerId: this.id,
            evidence: [],
            costEstimateUsd: 0,
            durationMs: Date.now() - startTime,
            error:
              status === 429 && !apiKey
                ? "Google PageSpeed API rate limit (429). Add a Google API key in Settings to enable website speed audits."
                : `Google PageSpeed API returned status ${status}`
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
