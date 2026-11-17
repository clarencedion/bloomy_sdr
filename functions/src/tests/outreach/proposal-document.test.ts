import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildOutreachUserPrompt } from "../../services/outreach-prompts.js";

const cwd = process.cwd();
const base = cwd.endsWith("/functions") ? cwd : join(cwd, "functions");
const read = (p: string) => readFileSync(join(base, p), "utf8");

const baseInput = {
  company: { id: "c1", name: "Atelier Test", city: "Nantes" },
  research: { personalizedAngle: "Leur site est lent." },
  contact: null,
  campaign: null,
  personalizationFacts: [],
  offer: null,
  settings: {}
} as unknown as Parameters<typeof buildOutreachUserPrompt>[0];

describe("The attached document follows the owner's brief", () => {
  it("passes the brief through to the writer", () => {
    const prompt = buildOutreachUserPrompt({
      ...baseInput,
      business: { proposalDocument: { enabled: true, brief: "Montre le manque à gagner sur un an." } }
    } as unknown as Parameters<typeof buildOutreachUserPrompt>[0]);

    expect(prompt).toContain("Montre le manque à gagner sur un an.");
    expect(prompt).toContain("<proposal_document_brief>");
  });

  it("falls back to a neutral instruction rather than an empty block", () => {
    // An empty brief must not read as "write nothing".
    const prompt = buildOutreachUserPrompt(baseInput);
    expect(prompt).toContain("No specific instructions");
  });

  it("tells the model the brief governs the document, not the email", () => {
    // The whole point is a short email with a substantial attachment; without
    // this the brief would lengthen the email instead.
    const prompts = read("src/services/outreach-prompts.ts");
    expect(prompts).toContain("landingPageDraft is the attached PDF, not the email");
    expect(prompts).toContain("The email stays short whatever the document contains");
  });

  it("keeps the grounding rules over the document too", () => {
    // A document is what a prospect forwards internally, so an invented figure
    // there travels further than one in an email.
    const prompts = read("src/services/outreach-prompts.ts");
    const block = prompts.slice(prompts.indexOf("landingPageDraft is the attached PDF"));
    expect(block).toContain("every figure and every proper noun must come from the supplied data");
  });
});

describe("Attaching a document is a choice", () => {
  const generation = read("src/services/outreach-generation.ts");

  it("skips generation when the business turned it off", () => {
    expect(generation).toContain("business?.proposalDocument?.enabled !== false");
  });

  it("does not report the skip as a failure", () => {
    // Routing a deliberate skip through the catch would log a warning for
    // something that went exactly as asked.
    const block = generation.slice(
      generation.indexOf("business?.proposalDocument?.enabled !== false"),
      generation.indexOf("outreach.pdf.failed")
    );
    expect(block).not.toContain('throw new Error("skip")');
  });

  it("defaults to attaching one, so existing businesses are unaffected", () => {
    // `!== false` rather than `=== true`: a business saved before this field
    // existed keeps the behaviour it had.
    expect(generation).toContain("!== false");
  });
});
