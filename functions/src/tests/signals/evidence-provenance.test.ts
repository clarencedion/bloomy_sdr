import { describe, it, expect } from "vitest";
import {
  validateEvidenceItem,
  storeEvidenceItems,
  getEvidenceForCompany
} from "../../services/evidence-service.js";
import type { EvidenceItem, EvidenceNature } from "../../types/domain.js";

describe("Evidence Provenance & Fact vs Inference Barrier (REQ-021 & REQ-022)", () => {
  it("accepts valid evidence items tagged as fact, derived_metric, or ai_interpretation", () => {
    const factItem: Omit<EvidenceItem, "id"> = {
      workspaceId: "ws_1",
      businessId: "biz_1",
      companyId: "comp_1",
      signalProvider: "company_registry",
      key: "siren",
      value: "808123456",
      sourceType: "official_registry",
      sourceUrl: "https://annuaire-entreprises.data.gouv.fr/entreprise/808123456",
      confidence: 100,
      nature: "fact",
      collectedAt: new Date()
    };

    const metricItem: Omit<EvidenceItem, "id"> = {
      workspaceId: "ws_1",
      businessId: "biz_1",
      companyId: "comp_1",
      signalProvider: "website_technical",
      key: "mobile_pagespeed_score",
      value: 34,
      sourceType: "pagespeed",
      confidence: 95,
      nature: "derived_metric",
      collectedAt: new Date()
    };

    const aiItem: Omit<EvidenceItem, "id"> = {
      workspaceId: "ws_1",
      businessId: "biz_1",
      companyId: "comp_1",
      signalProvider: "company_hiring",
      key: "likely_expanding_sales_team",
      value: true,
      sourceType: "ai_interpretation",
      confidence: 75,
      nature: "ai_interpretation",
      collectedAt: new Date()
    };

    expect(() => validateEvidenceItem(factItem)).not.toThrow();
    expect(() => validateEvidenceItem(metricItem)).not.toThrow();
    expect(() => validateEvidenceItem(aiItem)).not.toThrow();
  });

  it("strictly rejects evidence items with invalid or unverified nature discriminators", () => {
    const invalidNatureItem = {
      workspaceId: "ws_1",
      businessId: "biz_1",
      companyId: "comp_1",
      signalProvider: "company_registry",
      key: "siren",
      value: "808123456",
      sourceType: "official_registry",
      confidence: 100,
      nature: "unverified_guess" as unknown as EvidenceNature,
      collectedAt: new Date()
    };

    expect(() => validateEvidenceItem(invalidNatureItem as any)).toThrow(
      /Invalid evidence nature: 'unverified_guess'/
    );
  });

  it("strictly rejects evidence items with invalid confidence scores or empty keys", () => {
    const outOfBoundsConfidence = {
      workspaceId: "ws_1",
      businessId: "biz_1",
      companyId: "comp_1",
      signalProvider: "company_registry",
      key: "siren",
      value: "808123456",
      sourceType: "official_registry",
      confidence: 150, // Invalid: > 100
      nature: "fact" as const,
      collectedAt: new Date()
    };

    const emptyKeyItem = {
      workspaceId: "ws_1",
      businessId: "biz_1",
      companyId: "comp_1",
      signalProvider: "company_registry",
      key: "   ",
      value: "808123456",
      sourceType: "official_registry",
      confidence: 90,
      nature: "fact" as const,
      collectedAt: new Date()
    };

    expect(() => validateEvidenceItem(outOfBoundsConfidence as any)).toThrow(/confidence must be a number between 0 and 100/);
    expect(() => validateEvidenceItem(emptyKeyItem as any)).toThrow(/key must be a non-empty string/);
  });

  it("persists evidence items with workspaceId, businessId, and companyId", async () => {
    const companyId = `comp_prov_test_${Date.now()}`;
    const stored = await storeEvidenceItems("ws_test", "biz_test", companyId, [
      {
        signalProvider: "company_registry",
        key: "legal_name",
        value: "Alpha Corp SAS",
        sourceType: "official_registry",
        confidence: 95,
        nature: "fact",
        collectedAt: new Date()
      },
      {
        signalProvider: "google_places",
        key: "google_rating",
        value: 4.8,
        sourceType: "google_places",
        confidence: 90,
        nature: "fact",
        collectedAt: new Date()
      }
    ]);

    expect(stored.length).toBe(2);
    expect(stored[0].companyId).toBe(companyId);
    expect(stored[0].workspaceId).toBe("ws_test");
    expect(stored[0].businessId).toBe("biz_test");
    expect(stored[0].nature).toBe("fact");

    const retrieved = await getEvidenceForCompany(companyId);
    expect(retrieved.length).toBe(2);
    expect(retrieved.map((i) => i.key)).toContain("legal_name");
    expect(retrieved.map((i) => i.key)).toContain("google_rating");
  });
});
