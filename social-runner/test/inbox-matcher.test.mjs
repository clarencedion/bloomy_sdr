import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { matchThreads, normaliseName, parseAriaSnapshot, threadLooksLike } from "../src/inbox-matcher.mjs";

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const OUR_DM = "Bonjour Fleurs de Lise, j'ai découvert vos compositions sur Instagram, elles sont superbes.\nUne question rapide ?";

describe("parseAriaSnapshot", () => {
  it("reads roles, names, inline text, /url props and single-quoted keys", () => {
    const root = parseAriaSnapshot(fixture("instagram-inbox.aria.yml"));
    const list = root.children.find((node) => node.role === "list");
    expect(list.name).toBe("Liste des fils de discussion");
    const atelier = list.children[1].children[0];
    expect(atelier.role).toBe("button");
    expect(atelier.name).toBe("Photo de profil de atelier.rose Atelier Rose Vous : Bonjour Atelier Rose, j'ai découvert vos bouquets · 1 j");
    expect(atelier.children.map((child) => child.text || child.name)).toEqual([
      "Photo de profil de atelier.rose",
      "Atelier Rose",
      "Vous : Bonjour Atelier Rose, j'ai découvert vos bouquets · 1 j"
    ]);
    const messages = root.children[0].children[1];
    expect(messages).toMatchObject({ role: "link", name: "Messages", url: "/direct/inbox/" });
  });

  it("decodes Playwright's escaped values", () => {
    const root = parseAriaSnapshot('- text: "Ligne\\nsuivante \\"citée\\" \\x41"\n- heading "Titre" [level=2]');
    expect(root.children[0].text).toBe('Ligne\nsuivante "citée" A');
    expect(root.children[1]).toMatchObject({ role: "heading", name: "Titre" });
  });

  it("tolerates garbage", () => {
    expect(parseAriaSnapshot("not yaml at all\n\n").children).toEqual([]);
    expect(parseAriaSnapshot(undefined).children).toEqual([]);
  });
});

describe("matchThreads — Instagram inbox", () => {
  const snapshot = fixture("instagram-inbox.aria.yml");
  const conversations = [
    { conversationId: "c_lise", companyName: "Fleurs de Lise", handle: "fleursdelise", ourTexts: [OUR_DM] },
    { conversationId: "c_rose", companyName: "Atelier Rose", handle: "atelier.rose", ourTexts: ["Bonjour Atelier Rose, j'ai découvert vos bouquets sur Instagram."] },
    { conversationId: "c_fleurs", companyName: "Fleurs", handle: "fleurs", ourTexts: [] },
    { conversationId: "c_absent", companyName: "Boutique Absente", handle: "absente", ourTexts: [] }
  ];
  const matches = matchThreads(snapshot, conversations);

  it("matches by handle as a whole token, not inside a longer handle", () => {
    expect(matches.get("c_lise")).toMatchObject({
      role: "button",
      name: "Photo de profil de fleursdelise Fleurs de Lise Fleurs de Lise a envoyé une pièce jointe · 2 h",
      matchedBy: "handle",
      lastFromUs: false
    });
    // "fleurs" is a prefix of "fleursdelise" and of the name "Fleurs de Lise": still its own row.
    expect(matches.get("c_fleurs")).toMatchObject({ matchedBy: "handle", text: "Fleurs" });
    expect(matches.get("c_fleurs").name).toMatch(/^Photo de profil de fleurs Fleurs Merci/);
  });

  it("flags rows whose last message is ours", () => {
    expect(matches.get("c_rose")).toMatchObject({ lastFromUs: true, matchedBy: "handle" });
  });

  it("leaves conversations that are not in the visible list unmatched", () => {
    expect(matches.has("c_absent")).toBe(false);
    expect(matches.size).toBe(3);
  });
});

describe("matchThreads — Messenger inbox", () => {
  const snapshot = fixture("facebook-inbox.aria.yml");

  it("opens the list row (thread link), never the profile link in an open thread's header", () => {
    const matches = matchThreads(snapshot, [
      { conversationId: "c_lise", companyName: "Fleurs de Lise", handle: "fleursdelise", ourTexts: ["Bonjour !"] }
    ]);
    expect(matches.get("c_lise")).toMatchObject({ url: "/messages/t/1122334455/", role: "link", lastFromUs: true });
  });

  it("matches by name when the handle is a numeric Facebook id", () => {
    const matches = matchThreads(snapshot, [{ conversationId: "c_rose", companyName: "Atelier Rose", handle: "id:100064", ourTexts: [] }]);
    expect(matches.get("c_rose")).toMatchObject({ url: "/messages/t/5566778899/", matchedBy: "name", lastFromUs: false });
  });
});

describe("matchThreads — ambiguity is never resolved by guessing", () => {
  it("drops a row two conversations claim equally", () => {
    const snapshot = ['- button "Atelier Rose · 2 h":', "  - text: Atelier Rose"].join("\n");
    const matches = matchThreads(snapshot, [
      { conversationId: "a", companyName: "Atelier Rose", handle: "id:1" },
      { conversationId: "b", companyName: "Atelier  ROSE", handle: "id:2" }
    ]);
    expect(matches.size).toBe(0);
  });

  it("drops a conversation that matches two rows equally", () => {
    const snapshot = ['- button "Atelier Rose":', "  - text: Atelier Rose", '- button "Atelier Rose ":', "  - text: Atelier Rose"].join("\n");
    expect(matchThreads(snapshot, [{ conversationId: "a", companyName: "Atelier Rose", handle: "" }]).size).toBe(0);
  });

  it("gives a contested row to the longer, more specific name", () => {
    const snapshot = ['- button "Fleurs de Lise Paris Bonjour · 4 j":', "  - text: Fleurs de Lise Paris"].join("\n");
    const matches = matchThreads(snapshot, [
      { conversationId: "short", companyName: "Fleurs de Lise", handle: "" },
      { conversationId: "long", companyName: "Fleurs de Lise Paris", handle: "" }
    ]);
    expect(matches.has("long")).toBe(true);
    expect(matches.has("short")).toBe(false);
  });

  it("ignores names shorter than three characters and handles that cannot appear in text", () => {
    const snapshot = '- button "AB · 2 h"';
    expect(matchThreads(snapshot, [{ conversationId: "x", companyName: "AB", handle: "id:42" }]).size).toBe(0);
  });
});

describe("threadLooksLike", () => {
  const thread = fixture("instagram-thread.aria.yml");

  it("accepts a thread showing one of our messages", () => {
    expect(threadLooksLike(thread, { handle: "", ourTexts: [OUR_DM] })).toBe(true);
  });

  it("accepts a thread showing the handle or linking to the profile", () => {
    expect(threadLooksLike(thread, { handle: "fleursdelise", ourTexts: [] })).toBe(true);
    const linkOnly = '- link "Voir le profil":\n  - /url: /fleursdelise/';
    expect(threadLooksLike(linkOnly, { handle: "fleursdelise", ourTexts: [] })).toBe(true);
  });

  it("rejects a thread where only the display name matches", () => {
    expect(threadLooksLike(thread, { handle: "id:999", companyName: "Fleurs de Lise", ourTexts: ["Un tout autre message envoyé ailleurs."] })).toBe(false);
  });

  it("rejects a thread of a longer handle", () => {
    expect(threadLooksLike('- text: "fleursdelise.paris"', { handle: "fleursdelise", ourTexts: [] })).toBe(false);
  });
});

describe("normaliseName", () => {
  it("drops accents, case and punctuation", () => {
    expect(normaliseName("  L'Atelier — Fleurs & Cie ! ")).toBe("l atelier fleurs cie");
  });
});
