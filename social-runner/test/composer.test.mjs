import { describe, expect, it } from "vitest";
import {
  clearComposer,
  composerMatches,
  normaliseForCompare,
  readComposer,
  sendFromComposer,
  splitLines,
  stripControlChars,
  typeAndVerify,
  typeIntoComposer
} from "../src/composer.mjs";
import { createMockComposer, createMockPage } from "../src/drivers/mock-social-channel-driver.mjs";

function setup(options) {
  const page = createMockPage();
  const composer = createMockComposer(page, options);
  return { page, composer, timeline: page.timeline };
}

const textEvents = (timeline) => timeline.filter((event) => event.type === "keyboard.insertText").map((event) => event.text);
const keyEvents = (timeline) =>
  timeline.filter((event) => event.type === "keyboard.press" || event.type === "composer.press").map((event) => event.key);

describe("typeIntoComposer", () => {
  it("types each line with insertText and Shift+Enter between lines, never a line break", async () => {
    const { page, composer, timeline } = setup();
    await typeIntoComposer(page, composer, "Bonjour,\r\nJ'ai vu votre boutique.\nUne question ?");

    const inserted = textEvents(timeline);
    expect(inserted).toEqual(["Bonjour,", "J'ai vu votre boutique.", "Une question ?"]);
    for (const text of inserted) expect(text).not.toMatch(/[\r\n]/);
    expect(keyEvents(timeline)).toEqual(["Shift+Enter", "Shift+Enter"]);
    expect(timeline.some((event) => event.type === "keyboard.type" || event.type === "composer.pressSequentially")).toBe(false);
    expect(page.sent).toEqual([]);
    expect(composer.text).toBe("Bonjour,\nJ'ai vu votre boutique.\nUne question ?");
  });

  it("keeps blank lines as paragraph breaks without inserting empty text", async () => {
    const { page, composer, timeline } = setup();
    await typeIntoComposer(page, composer, "Bonjour,\n\nÀ bientôt");
    expect(textEvents(timeline)).toEqual(["Bonjour,", "À bientôt"]);
    expect(keyEvents(timeline)).toEqual(["Shift+Enter", "Shift+Enter"]);
    expect(composer.text).toBe("Bonjour,\n\nÀ bientôt");
  });

  it("treats a lone carriage return as a line break, not as Enter", async () => {
    const { page, composer, timeline } = setup();
    await typeIntoComposer(page, composer, "Ligne 1\rLigne 2");
    expect(textEvents(timeline)).toEqual(["Ligne 1", "Ligne 2"]);
    expect(keyEvents(timeline)).not.toContain("Enter");
    expect(page.sent).toEqual([]);
  });

  it("clears leftover text first, so the composer holds exactly this message", async () => {
    const { page, composer } = setup();
    composer.text = "ancien brouillon restauré";
    await typeIntoComposer(page, composer, "Nouveau message");
    expect(composer.text).toBe("Nouveau message");
    expect(page.sent).toEqual([]);
  });

  it("never presses Enter while typing", async () => {
    const { page, composer, timeline } = setup();
    await typeAndVerify(page, composer, "Un\nDeux\nTrois");
    expect(keyEvents(timeline)).not.toContain("Enter");
    expect(page.sent).toEqual([]);
  });
});

describe("typeAndVerify", () => {
  it("returns true when the composer reads back the message", async () => {
    const { page, composer } = setup();
    await expect(typeAndVerify(page, composer, "Bonjour\nMerci")).resolves.toBe(true);
  });

  it("returns false (after one retry) when the editor drops characters", async () => {
    const { page, composer, timeline } = setup({ mangle: (text) => text.replace(/o/g, "") });
    await expect(typeAndVerify(page, composer, "Bonjour")).resolves.toBe(false);
    expect(textEvents(timeline)).toEqual(["Bonjour", "Bonjour"]);
    expect(page.sent).toEqual([]);
  });
});

describe("sendFromComposer / clearComposer", () => {
  it("sendFromComposer presses Enter on the composer and nothing else", async () => {
    const { page, composer, timeline } = setup();
    await typeIntoComposer(page, composer, "Bonjour");
    timeline.length = 0;
    await sendFromComposer(page, composer);
    expect(timeline.filter((event) => event.type !== "send")).toEqual([{ type: "composer.press", key: "Enter" }]);
    expect(page.sent).toEqual(["Bonjour"]);
  });

  it("clearComposer empties the composer without sending", async () => {
    const { page, composer } = setup();
    composer.text = "à effacer";
    await expect(clearComposer(page, composer)).resolves.toBe(true);
    expect(composer.text).toBe("");
    expect(page.sent).toEqual([]);
  });

  it("readComposer returns an empty string when the composer cannot be read", async () => {
    await expect(readComposer({ innerText: async () => Promise.reject(new Error("detached")) })).resolves.toBe("");
  });
});

describe("composerMatches (pure)", () => {
  it.each([
    ["Bonjour,\n\nMerci", "Bonjour,\nMerci"],
    ["  Bonjour   Merci ", "Bonjour Merci"],
    ["Bonjour\u00a0!", "Bonjour !"],
    ["Bon\u200bjour", "Bonjour"],
    ["Cafe\u0301", "Café"]
  ])("%j matches %j", (actual, expected) => {
    expect(composerMatches(actual, expected)).toBe(true);
  });

  it.each([
    ["Bonjour", "Bonjour !"],
    ["", "Bonjour"],
    ["Bonjour Lise", "Bonjour Lisa"]
  ])("%j does not match %j", (actual, expected) => {
    expect(composerMatches(actual, expected)).toBe(false);
  });

  it("normaliseForCompare collapses every whitespace run", () => {
    expect(normaliseForCompare("a\n\n b\t c")).toBe("a b c");
  });
});

describe("splitLines / stripControlChars", () => {
  it("splits on every line-ending flavour", () => {
    expect(splitLines("a\r\nb\rc\nd")).toEqual(["a", "b", "c", "d"]);
  });

  it("strips terminal escape sequences and other control characters, keeps line breaks and tabs", () => {
    const esc = String.fromCharCode(27);
    expect(stripControlChars(`Bon${esc}[2Jjour\r\nà\tvous${String.fromCharCode(7)}`)).toBe("Bon[2Jjour\nà\tvous");
  });
});
