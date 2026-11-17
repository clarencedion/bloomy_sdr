/**
 * "Is this conversation new?" — the check an automatic session makes before a
 * first message. `classifyThread` is pure; the observations below are what
 * Instagram's chat window showed on 2026-11-11 (French interface) for two
 * prospects never written to, plus what a started conversation adds.
 */
import { describe, expect, it } from "vitest";
import { classifyThread } from "../src/drivers/common.mjs";
import { INSTAGRAM_CONFIG } from "../src/drivers/instagram-driver.mjs";
import { FACEBOOK_CONFIG } from "../src/drivers/facebook-driver.mjs";
import { createWebDmDriver } from "../src/drivers/web-dm-driver.mjs";

const rules = (handle, extra = {}) => ({ ...INSTAGRAM_CONFIG.emptyThread, handle, ...extra });

/** Read live: a verified business account, new conversation. */
const WALKIN = Object.freeze({
  windowFound: true,
  displayName: "Tatouage Sans Rendez-vous Sur Paris",
  lines: [
    "Retour", "Tatouage Sans Rendez-vous Sur Paris", "Vérifié", "Développer", "Fermer", "Tatouage Sans Rendez-vous Sur Paris", "Vérifié",
    "walkin_tattoo · Instagram", "Voir profil", "Choisir un emoji", "Votre message…", "Clip vocal", "Ajouter une photo ou une vidéo",
    "Choisir un GIF ou un sticker"
  ],
  roles: ["button", "img", "link", "textbox"],
  images: 2,
  media: 0
});
/** Read live: a display name in decorated Unicode, a handle with dots. */
const GAMIN = Object.freeze({
  ...WALKIN,
  displayName: "❖ 𝐋𝐄 𝐆𝐀𝐌𝐈𝐍 𝐀 𝐃𝐈𝐗 𝐃𝐎𝐈𝐆𝐓𝐒 ❖",
  lines: WALKIN.lines.map((line) =>
    line === "Tatouage Sans Rendez-vous Sur Paris" ? "❖ 𝐋𝐄 𝐆𝐀𝐌𝐈𝐍 𝐀 𝐃𝐈𝐗 𝐃𝐎𝐈𝐆𝐓𝐒 ❖" : line === "walkin_tattoo · Instagram" ? "le.gamin.a.dix.doigts · Instagram" : line
  )
});
const withLines = (base, ...added) => ({ ...base, lines: [...base.lines, ...added] });

describe("classifyThread — a new conversation is said 'empty' only on positive evidence", () => {
  it("the two windows read live are empty", () => {
    expect(classifyThread(WALKIN, rules("walkin_tattoo"))).toEqual({ state: "empty" });
    expect(classifyThread(GAMIN, rules("le.gamin.a.dix.doigts"))).toEqual({ state: "empty" });
  });

  it("an account that is not verified has no 'Vérifié' line: still empty", () => {
    const plain = { ...WALKIN, lines: WALKIN.lines.filter((line) => line !== "Vérifié") };
    expect(classifyThread(plain, rules("walkin_tattoo")).state).toBe("empty");
  });

  it("one line that is not the interface's is a conversation already started", () => {
    for (const added of ["Bonjour, vous faites des flashs ?", "Hier 14:32", "Vu", "Vous avez envoyé une pièce jointe.", "❤️"]) {
      const verdict = classifyThread(withLines(WALKIN, added), rules("walkin_tattoo"));
      expect(verdict, added).toEqual({ state: "has_content", why: "text", unexpected: [added] });
    }
  });

  it("a message that happens to read like a label, the display name or the handle line is still seen (each appears no more often than in an empty window)", () => {
    expect(classifyThread(withLines(WALKIN, "Voir profil"), rules("walkin_tattoo"))).toEqual({ state: "has_content", why: "repeated", unexpected: ["Voir profil"] });
    expect(classifyThread(withLines(WALKIN, "Vérifié"), rules("walkin_tattoo")).state).toBe("has_content");
    expect(classifyThread(withLines(WALKIN, "Tatouage Sans Rendez-vous Sur Paris"), rules("walkin_tattoo")).state).toBe("has_content");
    expect(classifyThread(withLines(WALKIN, "walkin_tattoo · Instagram"), rules("walkin_tattoo"))).toMatchObject({ state: "has_content", why: "handle_line_repeated" });
    // A second "Retour" / "Fermer" also breaks the header the language is read from: never "empty".
    expect(classifyThread(withLines(WALKIN, "Retour"), rules("walkin_tattoo")).state).not.toBe("empty");
    expect(classifyThread(withLines(WALKIN, "Fermer"), rules("walkin_tattoo")).state).not.toBe("empty");
  });

  it("the window is read in ONE language: a message that reads like the other language's label is a message", () => {
    for (const english of ["Close", "Back", "Message...", "View profile", "Verified", "Send", "Choose an emoji"]) {
      expect(classifyThread(withLines(WALKIN, english), rules("walkin_tattoo")).state, english).toBe("has_content");
    }
  });

  it("reports every unexpected line at once (up to five), so one look tells what the window holds — and only a category leaves this Mac", () => {
    const verdict = classifyThread(withLines(WALKIN, "Bonjour", "Hier 14:32", "Vu", "Retour au travail", "Merci", "À demain", "Bien reçu"), rules("walkin_tattoo"));
    expect(verdict.state).toBe("has_content");
    expect(verdict.why).toBe("text");
    expect(verdict.unexpected).toEqual(["Bonjour", "Hier 14:32", "Vu", "Retour au travail", "Merci"]);
  });

  it("the 'verified' badge is shown twice or not at all: a single 'Vérifié' on an account that is not verified is somebody's message", () => {
    const plain = { ...WALKIN, lines: WALKIN.lines.filter((line) => line !== "Vérifié") };
    expect(classifyThread(withLines(plain, "Vérifié"), rules("walkin_tattoo"))).toEqual({ state: "has_content", why: "repeated", unexpected: ["Vérifié"] });
    expect(classifyThread(withLines(plain, "Vérifié", "Vérifié"), rules("walkin_tattoo")).state).toBe("empty");
  });

  it("the English interface is read with the English labels (same window, translated)", () => {
    const fr = ["Retour", "Développer", "Fermer", "Vérifié", "Voir profil", "Choisir un emoji", "Votre message…", "Clip vocal", "Ajouter une photo ou une vidéo", "Choisir un GIF ou un sticker"];
    const en = ["Back", "Expand", "Close", "Verified", "View profile", "Choose an emoji", "Message...", "Voice clip", "Add Photo or Video", "Choose a GIF or sticker"];
    const english = { ...WALKIN, lines: WALKIN.lines.map((line) => (fr.includes(line) ? en[fr.indexOf(line)] : line)) };
    expect(classifyThread(english, rules("walkin_tattoo")).state).toBe("empty");
    expect(classifyThread(withLines(english, "Fermer"), rules("walkin_tattoo")).state).toBe("has_content");
  });

  it("a header in no known language (a third language, a redesign) is unknown — never empty", () => {
    const german = { ...WALKIN, lines: WALKIN.lines.map((line) => ({ Retour: "Zurück", Développer: "Erweitern", Fermer: "Schließen" })[line] ?? line) };
    expect(classifyThread(german, rules("walkin_tattoo"))).toEqual({ state: "unknown", why: "interface_not_recognised" });
    expect(classifyThread({ ...WALKIN, lines: WALKIN.lines.filter((line) => line !== "Développer") }, rules("walkin_tattoo")).state).toBe("unknown");
  });

  it("a message with no text is seen by what it adds: a row, a media element, an image beyond the avatars", () => {
    expect(classifyThread({ ...WALKIN, roles: [...WALKIN.roles, "row"] }, rules("walkin_tattoo"))).toMatchObject({ state: "has_content", why: "role:row" });
    expect(classifyThread({ ...WALKIN, media: 1 }, rules("walkin_tattoo"))).toMatchObject({ state: "has_content", why: "media" });
    expect(classifyThread({ ...WALKIN, images: 3 }, rules("walkin_tattoo"))).toMatchObject({ state: "has_content", why: "images:3" });
  });

  it("a window that cannot be read, or shows no intro card for THIS prospect, is unknown — never empty", () => {
    expect(classifyThread(null, rules("walkin_tattoo")).state).toBe("unknown");
    expect(classifyThread({ windowFound: false }, rules("walkin_tattoo")).state).toBe("unknown");
    // The intro card of another account: the handle line does not match, so it is an unknown line.
    expect(classifyThread(WALKIN, rules("walkin_tatoo")).state).toBe("has_content");
    expect(classifyThread({ ...WALKIN, lines: WALKIN.lines.filter((line) => !line.includes("· Instagram")) }, rules("walkin_tattoo"))).toEqual({
      state: "unknown",
      why: "intro_card_not_found"
    });
    // A dot in a handle is a dot, not "any character".
    expect(classifyThread(GAMIN, rules("leXgaminXaXdixXdoigts")).state).toBe("has_content");
    // No display name could be read: its two lines are unknown text.
    expect(classifyThread({ ...WALKIN, displayName: "" }, rules("walkin_tattoo")).state).toBe("has_content");
  });

  it("the send button is expected only once a text sits in the composer — and in the French interface it reads 'Send' (live, 2026-11-11 18:10)", () => {
    const composerButtons = ["Votre message…", "Clip vocal", "Ajouter une photo ou une vidéo", "Choisir un GIF ou un sticker"];
    for (const button of ["Send", "Envoyer"]) {
      const typing = { ...WALKIN, lines: [...WALKIN.lines.filter((line) => !composerButtons.includes(line)), button] };
      // Before anything is typed, that line is somebody's message.
      expect(classifyThread(typing, rules("walkin_tattoo")), button).toEqual({ state: "has_content", why: "text", unexpected: [button] });
      expect(classifyThread(typing, rules("walkin_tattoo", { typed: true })).state, button).toBe("empty");
      // ...and a message is still seen then — even one that reads like the button.
      expect(classifyThread(withLines(typing, "Bonjour"), rules("walkin_tattoo", { typed: true })).state).toBe("has_content");
      expect(classifyThread(withLines(typing, button), rules("walkin_tattoo", { typed: true })).state).toBe("has_content");
    }
    // The icons the composer shows while empty may still be there with the button: also a new conversation.
    expect(classifyThread(withLines(WALKIN, "Send"), rules("walkin_tattoo", { typed: true })).state).toBe("empty");
  });
});

describe("which networks can run an automatic session", () => {
  it("Instagram's driver has the check; Facebook's does not (its empty window is not described), so --auto is refused there", () => {
    expect(typeof createWebDmDriver(INSTAGRAM_CONFIG).threadState).toBe("function");
    expect(FACEBOOK_CONFIG.emptyThread).toBeUndefined();
    expect(createWebDmDriver(FACEBOOK_CONFIG).threadState).toBeUndefined();
  });

  it("the driver answers 'unknown' when the page cannot be inspected", async () => {
    const driver = createWebDmDriver(INSTAGRAM_CONFIG);
    const page = { getByRole: () => ({ or: () => ({ filter: () => ({ count: async () => 0, first: () => null }) }) }), locator: () => ({}) };
    const composer = { evaluate: async () => { throw new Error("detached"); } };
    expect((await driver.threadState(page, composer, { handle: "walkin_tattoo" })).state).toBe("unknown");
  });
});
