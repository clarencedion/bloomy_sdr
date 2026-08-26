import { describe, expect, it } from "vitest";
import { extractPersonalizationFacts } from "../../services/evidence-service.js";
import { MockAIProvider } from "../../providers/ai/mock-ai-provider.js";
import type { EvidenceItem } from "../../types/domain.js";

describe("REQ-049: Evidence-Grounded Copywriting", () => {
  const mockEvidence: EvidenceItem[] = [
    {
      id: "ev_1",
      workspaceId: "ws_default",
      businessId: "biz_devcomm",
      companyId: "comp_1",
      signalProvider: "pagespeed",
      key: "pagespeed_mobile_score",
      value: 28,
      sourceType: "pagespeed",
      confidence: 95,
      nature: "derived_metric",
      collectedAt: new Date()
    },
    {
      id: "ev_2",
      workspaceId: "ws_default",
      businessId: "biz_devcomm",
      companyId: "comp_1",
      signalProvider: "google_places",
      key: "google_places_review_count",
      value: 140,
      sourceType: "google_places",
      confidence: 90,
      nature: "fact",
      collectedAt: new Date()
    },
    {
      id: "ev_3",
      workspaceId: "ws_default",
      businessId: "biz_devcomm",
      companyId: "comp_1",
      signalProvider: "ai_interpretation",
      key: "inferred_pain_point",
      value: "Hypothetical low conversion",
      sourceType: "ai_interpretation",
      confidence: 50,
      nature: "ai_interpretation",
      collectedAt: new Date()
    }
  ];

  it("extracts only high-confidence facts (confidence >= 70, nature != ai_interpretation)", () => {
    const facts = extractPersonalizationFacts(mockEvidence, {
      city: "Nantes",
      employeeCount: 15
    });

    expect(facts.length).toBe(4);
    expect(facts.some((f) => f.key === "pagespeed_mobile_score" && f.value === 28)).toBe(true);
    expect(facts.some((f) => f.key === "google_places_review_count" && f.value === 140)).toBe(true);
    expect(facts.some((f) => f.key === "city" && f.value === "Nantes")).toBe(true);
    expect(facts.some((f) => f.key === "employeeCount" && f.value === 15)).toBe(true);
    // Excluded because nature is ai_interpretation and confidence is 50
    expect(facts.some((f) => f.key === "inferred_pain_point")).toBe(false);
  });

  it("injects verified personalization facts into generated outreach copy", async () => {
    const facts = extractPersonalizationFacts(mockEvidence, {
      city: "Nantes",
      employeeCount: 15
    });

    const provider = new MockAIProvider();
    const result = await provider.generateStructuredOutreach({
      company: { id: "comp_1", name: "Fleurs & Co", city: "Nantes" },
      contact: { firstName: "Sophie" },
      research: { segment: "website_modernization", fitScore: 85, confidence: 90 },
      personalizationFacts: facts,
      devcommContext: "Conseil & modernisation",
      promptVersion: "devcomm-outreach-v2",
      settings: {} as any
    });

    // Verify copy references verified facts
    expect(result.output.body).toContain("140 avis");
    expect(result.output.body).toContain("28/100");
    expect(result.output.personalizationNotes?.length).toBeGreaterThan(0);
  });
});
