import { describe, it, expect } from "vitest";
import { PagespeedSignalProvider } from "../../providers/signals/pagespeed-provider.js";
import type { SignalContext } from "../../providers/signals/signal-provider.js";

describe("Google PageSpeed & Core Web Vitals Signal Provider (REQ-031)", () => {
  const provider = new PagespeedSignalProvider();

  it("supports companies with website or domain", () => {
    const validContext: SignalContext = {
      workspaceId: "ws_test",
      businessId: "biz_bloomy",
      company: {
        id: "comp_web_1",
        name: "Fleuriste Le Jardin",
        domain: "fleuriste-jardin.fr"
      }
    };

    const invalidContext: SignalContext = {
      workspaceId: "ws_test",
      businessId: "biz_bloomy",
      company: {
        id: "comp_no_web",
        name: "Artisan Sans Site"
      }
    };

    expect(provider.supports(validContext)).toBe(true);
    expect(provider.supports(invalidContext)).toBe(false);
  });

  it("parses Google PageSpeed API fixture and extracts mobile score, LCP, and FCP", async () => {
    const mockPageSpeedData = {
      lighthouseResult: {
        categories: {
          performance: {
            score: 0.28 // Mobile score 28/100
          }
        },
        audits: {
          "largest-contentful-paint": {
            numericValue: 4250.6, // 4.25 seconds
            displayValue: "4.3 s"
          },
          "first-contentful-paint": {
            numericValue: 1820.2, // 1.82 seconds
            displayValue: "1.8 s"
          },
          viewport: {
            score: 0 // Viewport not configured / fail
          }
        }
      }
    };

    const context: SignalContext = {
      workspaceId: "ws_test",
      businessId: "biz_bloomy",
      company: {
        id: "comp_artisan_speed",
        name: "Artisan Boulanger",
        website: "https://boulangerie-nantes.fr",
        rawProviderData: {
          pagespeed: mockPageSpeedData
        }
      }
    };

    const result = await provider.collect(context);

    expect(result.error).toBeUndefined();
    expect(result.providerId).toBe("pagespeed");
    expect(result.costEstimateUsd).toBe(0);
    expect(result.evidence.length).toBe(4);

    const evidenceMap = new Map(result.evidence.map((e) => [e.key, e]));

    // Mobile score
    const speedScore = evidenceMap.get("mobile_pagespeed_score");
    expect(speedScore?.value).toBe(28);
    expect(speedScore?.nature).toBe("derived_metric");
    expect(speedScore?.confidence).toBe(90);
    expect(speedScore?.sourceType).toBe("pagespeed");

    // LCP
    const lcp = evidenceMap.get("lcp_seconds");
    expect(lcp?.value).toBe(4.25);
    expect(lcp?.nature).toBe("derived_metric");
    expect(lcp?.confidence).toBe(85);

    // FCP
    const fcp = evidenceMap.get("fcp_seconds");
    expect(fcp?.value).toBe(1.82);
    expect(fcp?.nature).toBe("derived_metric");

    // Mobile friendly (false because score < 50 and viewport score is 0)
    const mobileFriendly = evidenceMap.get("mobile_friendly");
    expect(mobileFriendly?.value).toBe(false);
    expect(mobileFriendly?.nature).toBe("derived_metric");
  });

  it("handles empty or invalid PageSpeed payload gracefully without throwing", async () => {
    const context: SignalContext = {
      workspaceId: "ws_test",
      businessId: "biz_bloomy",
      company: {
        id: "comp_error_case",
        name: "Unreachable Site",
        domain: "invalid-site-domain-999.test",
        rawProviderData: {
          pagespeed: {}
        }
      }
    };

    const result = await provider.collect(context);
    expect(result.providerId).toBe("pagespeed");
    expect(result.error).toBeDefined();
    expect(result.evidence).toEqual([]);
  });
});
