import { describe, expect, it } from "vitest";
import { MockAIProvider } from "../../providers/ai/mock-ai-provider.js";
import { outreachOutputSchema } from "../../services/outreach-schema.js";

describe("REQ-051: Multi-Touch Sequence Generation", () => {
  it("generates full 4-touch multi-channel sequence in a single coherent flow", async () => {
    const provider = new MockAIProvider();
    const result = await provider.generateStructuredOutreach({
      company: { id: "comp_10", name: "BioNantes", city: "Nantes" },
      contact: { firstName: "Marc", role: "Gérant" },
      research: { segment: "commercial_performance", fitScore: 80, confidence: 85 },
      personalizationFacts: [
        {
          key: "city",
          label: "Implantation locale à Nantes",
          value: "Nantes",
          sourceType: "official_registry",
          confidence: 100,
          nature: "fact"
        }
      ],
      devcommContext: "Performance commerciale B2B",
      promptVersion: "devcomm-outreach-v2",
      settings: {} as any
    });

    const parsed = outreachOutputSchema.parse(result.output);

    // 1. Initial Email
    expect(parsed.subject).toBeTruthy();
    expect(parsed.body).toContain("Marc");
    expect(parsed.body).toContain("BioNantes");

    // 2. Follow-Up 1 (+3 days bump)
    expect(parsed.followUp1).toBeTruthy();
    expect(parsed.followUp1).toContain("Marc");
    expect(parsed.followUp1).toContain("20 minutes");

    // 3. Follow-Up 2 (+7 days closure / breakup)
    expect(parsed.followUp2).toBeTruthy();
    expect(parsed.followUp2).toContain("clôture");

    // 4. LinkedIn Connection Note & Follow-up
    expect(parsed.linkedinConnectionNote).toBeTruthy();
    expect(parsed.linkedinConnectionNote.length).toBeLessThanOrEqual(300);
    expect(parsed.linkedinFollowUp).toBeTruthy();

    // 5. Sales Strategy & Landing Page draft
    expect(parsed.suggestedPersona).toBeTruthy();
    expect(parsed.cta).toBeTruthy();
    expect(parsed.landingPageDraft?.headline).toContain("BioNantes");
  });
});
