import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const cwd = process.cwd();
const base = cwd.endsWith("/functions") ? cwd : join(cwd, "functions");
const read = (p: string) => readFileSync(join(base, p), "utf8");

const outreachPrompt = read("src/services/outreach-prompts.ts");
const places = read("src/providers/discovery/google-places-discovery-provider.ts");

/**
 * Findings from reading 30 real drafts written by the model, not hypotheticals.
 * The French itself was good; what failed was repetition, one fabrication, and
 * one bad data field feeding the copy.
 */

describe("Copy does not read as a mail-merge", () => {
  it("assigns a closing shape per prospect instead of describing one", () => {
    // Two measured rounds. With an "e.g." sentence, one opt-out appeared 30/30.
    // Relabelling the examples "directions, NOT sentences to copy" removed those
    // exact sentences (0/10) and produced a *new* uniform template instead:
    // 10/10 opened "Si ce n'est pas...", two reproducing an example verbatim.
    // An example anchors whatever label it carries, so the prompt now has none.
    expect(outreachPrompt).toContain("{{ctaShape}}");
    expect(outreachPrompt).toContain("{{optOutShape}}");
    expect(outreachPrompt).toContain("no example sentence appears in these instructions");
  });

  it("varies the opt-out by grammar, because varying the meaning did not work", () => {
    const shapes = outreachPrompt.slice(
      outreachPrompt.indexOf("const OPT_OUT_SHAPES"),
      outreachPrompt.indexOf("/** Stable per company")
    );

    // Five shapes that all meant "you may decline" produced "Si ce n'est
    // pas..." in 20 drafts out of 20 — in French that intent has one natural
    // construction, so only a different sentence type breaks the pattern.
    expect(shapes).toContain("QUESTION");
    expect(shapes).toContain("IMPERATIVE");
    expect(shapes).toContain("FUTURE TENSE");
    expect(shapes.split("no 'si' clause").length - 1).toBeGreaterThanOrEqual(3);

    // A shape must never be a ready-made French sentence — that is an example
    // again, and examples anchor whatever label they carry.
    expect(shapes).not.toMatch(/Si ce n['’]est pas le bon moment/);
  });

  it("keys the shape to the company so a follow-up keeps its register", () => {
    expect(outreachPrompt).toContain("pickShape(CTA_SHAPES, seed)");
    expect(outreachPrompt).toContain("`${seed}#out`");
  });

  it("names the deliverability reason, so the rule is not mistaken for style", () => {
    expect(outreachPrompt).toContain("spam filters cluster on");
  });
});

describe("Copy cannot invent a place or an address", () => {
  it("requires every proper noun to come from the supplied data", () => {
    // One draft in 30 told a Paris studio it was in Dunkerque and referred to
    // "yoursite.com". Neither string existed anywhere in the company record,
    // the research or the evidence.
    expect(outreachPrompt).toContain("Every proper noun you write must appear in the data you were given");
    expect(outreachPrompt).toContain("yoursite.com");
  });

  it("tells the writer to take the town from the address", () => {
    expect(outreachPrompt).toContain("read the town from that address");
  });

  it("prefers omitting a place to guessing one", () => {
    expect(outreachPrompt).toContain("leave it out");
  });

  it("applies the same rule to direct messages", () => {
    const dm = outreachPrompt.slice(outreachPrompt.indexOf("DEFAULT_SOCIAL_DM_SYSTEM_PROMPT"));
    expect(dm).toContain("never invent a town or a web address");
  });
});

describe("The prompt's own constraints stay out of the copy", () => {
  it("requires prohibited promises to be obeyed silently", () => {
    // One draft wrote "sans promesses magiques" — defending against an
    // accusation nobody had made, and revealing that a rule sheet exists.
    expect(outreachPrompt).toContain("Obey them silently");
    expect(outreachPrompt).toContain("sans promesses magiques");
  });
});

describe("A company is filed under the town it is actually in", () => {
  it("reads the town from the postal address, not from the search query", () => {
    // 5 of 57 companies were filed under the search city: a Tours studio and a
    // Marseille one both stored as "Lille". That field is quoted to the
    // prospect, so it has to be where they are.
    expect(places).toContain("townFromAddress(place.address, city)");
  });

  it("keeps the search city separately rather than discarding it", () => {
    expect(places).toContain("searchCity: city");
  });

  it("extracts the postcode too, which Places results were not carrying", () => {
    expect(places).toContain("postalCode:");
  });

  it("falls back to the search city when the address cannot be parsed", () => {
    // A rough town beats no town; the copywriter is told to prefer the address.
    expect(places).toContain("return town && town.length > 1 ? town : fallback");
  });
});

describe("Regenerating replaces a draft, it does not queue another", () => {
  const generation = read("src/services/outreach-generation.ts");

  it("reuses the company's existing draft when forced without an id", () => {
    // `force` only reused a document when the caller already knew its id, so
    // regenerating by companyId appended a draft every time. Three rounds over
    // ten companies left 30 surplus drafts, and the badge showed more messages
    // to approve than there were people to send them to.
    expect(generation).toContain('.where("status", "==", "draft")');
    expect(generation).toContain("if (!targetId && input.force)");
  });

  it("never overwrites anything that is not still a draft", () => {
    // An approved or sent message is a record of something that happened.
    const block = generation.slice(
      generation.indexOf("if (!targetId && input.force)"),
      generation.indexOf("const outreachRef =")
    );
    expect(block).toContain('"draft"');
    expect(block).not.toContain('"sent"');
    expect(block).not.toContain('"approved"');
  });

  it("keeps the date the draft first appeared", () => {
    // The queue stays ordered by when the SDR found the prospect, not by when
    // it last rewrote the copy.
    expect(generation).toContain("delete data.createdAt;");
  });
});
