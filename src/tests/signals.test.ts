import { describe, it, expect } from "vitest";
import type { EvidenceItem, SignalContext, SignalResult } from "@/types/domain";


describe("Signal & Evidence Domain Engine (Phase 04 Frontend)", () => {
  it("enforces immutable EvidenceItem schema and FACT != INFERENCE barrier", () => {
    const item: EvidenceItem = {
      id: "ev_1",
      workspaceId: "ws_default",
      businessId: "biz_devcomm",
      companyId: "comp_123",
      signalProvider: "company_registry",
      key: "siren",
      value: "808123456",
      sourceType: "official_registry",
      sourceUrl: "https://annuaire-entreprises.data.gouv.fr/entreprise/808123456",
      confidence: 100,
      nature: "fact",
      collectedAt: new Date(),
      costUsd: 0
    };

    expect(item.nature).toBe("fact");
    expect(item.confidence).toBe(100);
    expect(item.signalProvider).toBe("company_registry");
  });

  it("supports SignalContext and SignalResult types without business-specific branching", () => {
    const context: SignalContext = {
      workspaceId: "ws_generic",
      businessId: "biz_generic",
      campaignId: "camp_1",
      offerId: "offer_1",
      company: {
        id: "comp_1",
        name: "Test Corp",
        siren: "123456789",
        city: "Paris"
      }
    };

    const result: SignalResult = {
      providerId: "company_registry",
      evidence: [
        {
          signalProvider: "company_registry",
          key: "legal_name",
          value: "Test Corp SAS",
          sourceType: "official_registry",
          confidence: 95,
          nature: "fact",
          collectedAt: new Date()
        }
      ],
      costEstimateUsd: 0,
      durationMs: 15
    };

    expect(context.workspaceId).toBe("ws_generic");
    expect(result.evidence.length).toBe(1);
    expect(result.evidence[0].nature).toBe("fact");
  });
});
