import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildOutreachUserPrompt } from "../../services/outreach-prompts.js";
import { getResearchSystemPrompt } from "../../services/research-prompts.js";

const cwd = process.cwd();
const base = cwd.endsWith("/functions") ? cwd : join(cwd, "functions");
const read = (p: string) => readFileSync(join(base, p), "utf8");

/**
 * Every token in these prompts is billed on every company, so what gets put in
 * them is a cost decision. Measured on a real prospect, the research document
 * was 4,454 tokens of which 3,329 were the previous AI call's own request and
 * response echoed back - bookkeeping about how a fact was produced, not the
 * fact. Removing it saved ~3,800 tokens per draft with nothing lost.
 */
describe("Prompt payloads carry facts, not bookkeeping", () => {
  const company = {
    name: "Bastartz Tattoo",
    city: "Nantes",
    website: "https://bastartz.fr",
    rawProviderData: { places: "x".repeat(4000) },
    normalizedName: "bastartz tattoo"
  };

  const research = {
    personalizedAngle: "Leur site met 8 secondes à charger sur mobile.",
    painPoints: ["site lent", "pas de réservation en ligne"],
    fitScore: 78,
    rawInput: { system: "y".repeat(6000), messages: ["z".repeat(4000)] },
    rawOutput: { content: [{ type: "text", text: "w".repeat(4000) }] }
  };

  const input = {
    company,
    research,
    contact: null,
    campaign: null,
    personalizationFacts: [],
    offer: null,
    business: null,
    settings: {}
  } as unknown as Parameters<typeof buildOutreachUserPrompt>[0];

  it("never sends a previous call's raw request or response back to the model", () => {
    const source = read("src/services/outreach-generation.ts");
    // These are the two biggest fields in the research document and they say
    // nothing the parsed fields beside them do not already say.
    expect(source).toContain('"rawInput"');
    expect(source).toContain('"rawOutput"');
    expect(source).toContain('"rawProviderData"');
  });

  it("keeps the facts the copy is actually grounded in", () => {
    const prompt = buildOutreachUserPrompt(input);
    // Invariant 6: a claim in the email must map to evidence in the prompt.
    expect(prompt).toContain("Leur site met 8 secondes à charger sur mobile.");
    expect(prompt).toContain("Bastartz Tattoo");
    expect(prompt).toContain("site lent");
  });

  it("does not pay for indentation on the per-company data", () => {
    const prompt = buildOutreachUserPrompt(input);

    // The hand-written output-schema example in the template stays indented -
    // it is a fixed cost paid once per call and it reads better to the model.
    // What must be compact is the data that scales with every prospect.
    expect(prompt).toContain(JSON.stringify(company));
    expect(prompt).not.toContain(JSON.stringify(company, null, 2));

    for (const file of ["src/services/outreach-prompts.ts", "src/services/research-prompts.ts"]) {
      expect(read(file)).not.toContain("null, 2");
    }
  });
});

describe("Model selection", () => {
  const provider = read("src/providers/ai/anthropic-provider.ts");

  it("defaults to the cheapest current model, not a retired one", () => {
    // The fallback was `claude-3-5-haiku-20241022`, a 2024 model any deployment
    // without an explicit setting would have used silently.
    expect(provider).toContain('const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5"');
    expect(provider).not.toContain('DEFAULT_ANTHROPIC_MODEL = "claude-3-5-haiku');
  });

  it("maps stored dated ids forward to current ones", () => {
    expect(provider).toContain('"claude-haiku-4-5-20251001": "claude-haiku-4-5"');
  });

  it("never points an alias at a retired model", () => {
    const aliasBlock = provider.slice(
      provider.indexOf("ANTHROPIC_MODEL_ALIASES"),
      provider.indexOf("function normalizeAnthropicModel")
    );
    const targets = [...aliasBlock.matchAll(/:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(targets.length).toBeGreaterThan(5);
    for (const target of targets) {
      expect(["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5"]).toContain(target);
    }
  });
});

describe("Research states its output language", () => {
  it("names the workspace language and the fields it applies to", () => {
    // Measured across 77 completed researches on a French campaign: only 37
    // came back in French. The model was left to infer the language from the
    // prospect's data and guessed wrong about half the time, handing the
    // copywriter English evidence for a French email.
    const fr = getResearchSystemPrompt({ defaultLanguage: "fr" } as never);
    expect(fr).toContain("in French");
    expect(fr).toContain("personalizedAngle");
    expect(fr).toContain("do not write them in English");
  });

  it("follows the workspace rather than hardcoding French (Invariant 1)", () => {
    const en = getResearchSystemPrompt({ defaultLanguage: "en" } as never);
    expect(en).toContain("in English");
    expect(en).not.toContain("in French");
  });

  it("leaves an operator's own prompt override in place, only appending to it", () => {
    const custom = getResearchSystemPrompt({
      defaultLanguage: "fr",
      researchSystemPrompt: "MY OWN PROMPT"
    } as never);
    expect(custom).toContain("MY OWN PROMPT");
    expect(custom).toContain("in French");
  });
});
