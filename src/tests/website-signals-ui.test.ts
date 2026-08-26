import { describe, it, expect } from "vitest";
import type { EvidenceItem, SignalProviderId } from "@/types/domain";

describe("Website Opportunity Signal UI & Domain Types (REQ-029 to REQ-036)", () => {
  it("supports all website opportunity signal provider IDs in domain type union", () => {
    const validProviderIds: SignalProviderId[] = [
      "website_presence",
      "website_technical",
      "website_ecommerce",
      "pagespeed",
      "company_registry",
      "google_places"
    ];

    expect(validProviderIds).toContain("pagespeed");
    expect(validProviderIds).toContain("website_technical");
    expect(validProviderIds).toContain("website_ecommerce");
  });

  it("handles website technical audit evidence schema with strict fact/derived_metric typing", () => {
    const evidenceList: EvidenceItem[] = [
      {
        id: "ev_ps_1",
        workspaceId: "ws_default",
        businessId: "biz_bloomy",
        companyId: "comp_1",
        signalProvider: "pagespeed",
        key: "mobile_pagespeed_score",
        value: 32,
        sourceType: "pagespeed",
        sourceUrl: "https://artisan-nantes.fr",
        confidence: 90,
        nature: "derived_metric",
        collectedAt: new Date(),
        costUsd: 0
      },
      {
        id: "ev_cms_1",
        workspaceId: "ws_default",
        businessId: "biz_bloomy",
        companyId: "comp_1",
        signalProvider: "website_technical",
        key: "cms_name",
        value: "WordPress",
        sourceType: "website",
        sourceUrl: "https://artisan-nantes.fr",
        confidence: 90,
        nature: "fact",
        collectedAt: new Date(),
        costUsd: 0
      },
      {
        id: "ev_ecom_1",
        workspaceId: "ws_default",
        businessId: "biz_bloomy",
        companyId: "comp_1",
        signalProvider: "website_ecommerce",
        key: "has_online_ordering",
        value: false,
        sourceType: "website",
        sourceUrl: "https://artisan-nantes.fr",
        confidence: 90,
        nature: "fact",
        collectedAt: new Date(),
        costUsd: 0
      }
    ];

    const evidenceMap = new Map(evidenceList.map((e) => [e.key, e]));

    expect(evidenceMap.get("mobile_pagespeed_score")?.value).toBe(32);
    expect(evidenceMap.get("mobile_pagespeed_score")?.nature).toBe("derived_metric");
    expect(evidenceMap.get("cms_name")?.value).toBe("WordPress");
    expect(evidenceMap.get("cms_name")?.nature).toBe("fact");
    expect(evidenceMap.get("has_online_ordering")?.value).toBe(false);
    expect(evidenceMap.get("has_online_ordering")?.nature).toBe("fact");
  });
});
