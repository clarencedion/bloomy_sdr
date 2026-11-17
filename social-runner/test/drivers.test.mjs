import { describe, expect, it } from "vitest";
import { confirmationSnippet, threadUrlOf } from "../src/drivers/common.mjs";
import { FACEBOOK_CONFIG } from "../src/drivers/facebook-driver.mjs";
import { INSTAGRAM_CONFIG } from "../src/drivers/instagram-driver.mjs";
import { createSocialChannelDriver } from "../src/drivers/social-channel-driver.mjs";

describe("driver factory", () => {
  it("returns one driver per network, all with the full interface", () => {
    for (const network of ["instagram", "facebook"]) {
      const driver = createSocialChannelDriver(network);
      expect(driver.network).toBe(network);
      for (const method of [
        "isLoggedIn",
        "openConversation",
        "closeConversation",
        "confirmSent",
        "checkBlocker",
        "threadUrl",
        "openInbox",
        "listThreads",
        "openThread",
        "threadSnapshot"
      ]) {
        expect(typeof driver[method], `${network}.${method}`).toBe("function");
      }
    }
    expect(() => createSocialChannelDriver("tiktok")).toThrow(/Réseau inconnu/);
  });

  it("uses the inbox URLs the runner is meant to visit", () => {
    expect(INSTAGRAM_CONFIG.inboxUrl).toBe("https://www.instagram.com/direct/inbox/");
    expect(FACEBOOK_CONFIG.inboxUrl).toBe("https://www.facebook.com/messages/");
  });
});

describe("selector patterns (FR + EN)", () => {
  // "Contacter": a professional account's profile button since 2026 (checked live 2026-11-10).
  it.each(["Message", "Envoyer un message", "message", "Contacter", "Contact"])("Instagram message button: %s", (label) => {
    expect(INSTAGRAM_CONFIG.messageButton.test(label)).toBe(true);
  });

  it.each(["Messages", "Envoyer un message à…", "Suivre"])("not an Instagram message button: %s", (label) => {
    expect(INSTAGRAM_CONFIG.messageButton.test(label)).toBe(false);
  });

  it.each(["Message", "Envoyer un message", "Contacter"])("Facebook message button: %s", (label) => {
    expect(FACEBOOK_CONFIG.messageButton.test(label)).toBe(true);
  });

  it("Facebook composer label matches the chat box, not the post composer", () => {
    // The composer factory builds a getByRole query; read the regex it passes.
    let pattern;
    FACEBOOK_CONFIG.composer({ getByRole: (_role, options) => (pattern = options.name) });
    for (const label of ["Message", "Écrire un message", "Aa"]) expect(pattern.test(label)).toBe(true);
    for (const label of ["Quoi de neuf, Isaac ?", "Écrire un commentaire…", "Rechercher dans Messenger", "Messages"]) {
      expect(pattern.test(label)).toBe(false);
    }
  });

  it("Instagram's chat window closes with its own Fermer button, and names its recipient", () => {
    expect(INSTAGRAM_CONFIG.closeChatButton.test("Fermer")).toBe(true);
    expect(INSTAGRAM_CONFIG.closeChatButton.test("Fermer la discussion")).toBe(false);
    expect(typeof INSTAGRAM_CONFIG.recipientLinks).toBe("function");
  });

  it("close-chat button never matches a generic close", () => {
    expect(FACEBOOK_CONFIG.closeChatButton.test("Fermer la discussion")).toBe(true);
    expect(FACEBOOK_CONFIG.closeChatButton.test("Close chat")).toBe(true);
    expect(FACEBOOK_CONFIG.closeChatButton.test("Fermer")).toBe(false);
  });

  it.each([
    [INSTAGRAM_CONFIG.notFoundText, "Sorry, this page isn't available."],
    [INSTAGRAM_CONFIG.notFoundText, "Cette page n\u2019est pas disponible."],
    [INSTAGRAM_CONFIG.privateText, "Ce compte est privé"],
    [FACEBOOK_CONFIG.notFoundText, "Ce contenu n'est pas disponible pour le moment"]
  ])("%s matches %s", (pattern, text) => {
    expect(pattern.test(text)).toBe(true);
  });
});

describe("confirmationSnippet", () => {
  it("takes 40 characters of the first substantial line", () => {
    expect(confirmationSnippet("Bonjour,\nj'ai découvert vos compositions sur Instagram, elles sont superbes.")).toBe(
      "j'ai découvert vos compositions sur Inst"
    );
  });

  it("falls back to the longest line and collapses spaces", () => {
    expect(confirmationSnippet("Salut\n  Merci   beaucoup  ")).toBe("Merci beaucoup");
  });

  it("never cuts an emoji in half", () => {
    const flower = String.fromCodePoint(0x1f33c);
    const text = `${"a".repeat(39)}${flower}${"b".repeat(5)}`;
    expect(Array.from(confirmationSnippet(text)).at(-1)).toBe(flower);
  });

  it("is empty for an empty message", () => {
    expect(confirmationSnippet("  \n ")).toBe("");
  });
});

describe("threadUrlOf", () => {
  it.each([
    ["https://www.instagram.com/direct/t/1234567890/?hl=fr", "https://www.instagram.com/direct/t/1234567890/"],
    ["https://www.facebook.com/messages/t/987654", "https://www.facebook.com/messages/t/987654"],
    ["https://www.facebook.com/messages/e2ee/t/987654", "https://www.facebook.com/messages/e2ee/t/987654"],
    ["https://www.messenger.com/t/987654/", "https://www.messenger.com/t/987654/"]
  ])("%s is a thread", (url, expected) => {
    expect(threadUrlOf(url)).toBe(expected);
  });

  it.each(["https://www.instagram.com/fleursdelise/", "https://www.facebook.com/fleursdelise", "https://example.com/direct/t/1/", "nope"])(
    "%s is not a thread",
    (url) => {
      expect(threadUrlOf(url)).toBeUndefined();
    }
  );
});
