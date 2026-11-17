import { describe, expect, it } from "vitest";
import { detectBlocker, normaliseText, redactUrl } from "../src/blockers.mjs";

describe("detectBlocker — URLs", () => {
  const cases = [
    ["https://www.instagram.com/accounts/login/?next=%2Ffleursdelise%2F", "login"],
    ["https://www.instagram.com/accounts/login/two_factor?next=/", "login"],
    ["https://www.instagram.com/challenge/AbCdEf/", "checkpoint"],
    ["https://www.instagram.com/challenge/?next=/direct/inbox/", "checkpoint"],
    ["https://www.facebook.com/checkpoint/1501092823525282/?next=https%3A%2F%2Fwww.facebook.com%2F", "checkpoint"],
    ["https://www.instagram.com/accounts/suspended/", "checkpoint"],
    ["https://www.facebook.com/two_step_verification/two_factor/", "checkpoint"],
    ["https://www.facebook.com/login/?next=https%3A%2F%2Fwww.facebook.com%2Fmessages%2F", "login"],
    ["https://www.facebook.com/login.php", "login"],
    ["https://m.facebook.com/login/device-based/regular/login/", "login"],
    ["https://www.facebook.com/recaptcha/challenge", "captcha"],
    ["chrome-error://chromewebdata/", "unexpected"],
    ["https://example.com/phishing", "unexpected"]
  ];
  it.each(cases)("%s → %s", (url, kind) => {
    expect(detectBlocker({ url })?.kind).toBe(kind);
  });

  it.each([
    "https://www.instagram.com/fleursdelise/",
    "https://www.instagram.com/direct/t/1234567890/",
    "https://www.instagram.com/direct/inbox/",
    "https://www.facebook.com/fleursdelise",
    "https://www.facebook.com/messages/t/1234567890",
    "https://www.messenger.com/t/1234567890",
    "https://www.facebook.com/profile.php?id=100064",
    "about:blank"
  ])("lets a normal page through: %s", (url) => {
    expect(detectBlocker({ url, text: "Fleurs de Lise\nPublications\nAbonnés" })).toBeNull();
  });

  it("does not take a login redirect parameter for a checkpoint", () => {
    expect(detectBlocker({ url: "https://www.instagram.com/accounts/login/?next=/checkpoint/" })?.kind).toBe("login");
  });
});

describe("detectBlocker — interface text (FR + EN)", () => {
  const cases = [
    ["Try Again Later\nWe restrict certain activity to protect our community.", "rate_limited"],
    ["Réessayez plus tard\nNous limitons certaines activités pour protéger notre communauté.", "rate_limited"],
    ["Action Blocked", "action_blocked"],
    ["Action bloquée", "action_blocked"],
    ["You're Temporarily Blocked", "action_blocked"],
    ["Vous êtes temporairement bloqué(e)", "action_blocked"],
    ["Vous ne pouvez pas envoyer de messages pour le moment", "action_blocked"],
    ["You can\u2019t message this account", "action_blocked"],
    ["Confirm it's you", "checkpoint"],
    ["Confirmez qu\u2019il s\u2019agit bien de vous", "checkpoint"],
    ["Help us confirm it's you", "checkpoint"],
    ["Please complete the CAPTCHA", "captcha"],
    ["Je ne suis pas un robot", "captcha"],
    ["Connectez-vous à Facebook", "login"],
    ["Log in to continue", "login"],
    ["Restaurer l'historique des discussions — saisissez votre code PIN", "unexpected"]
  ];
  it.each(cases)("%s → %s", (text, kind) => {
    expect(detectBlocker({ url: "https://www.instagram.com/fleursdelise/", text })?.kind).toBe(kind);
  });

  it("returns the matched pattern as detail, never the page text", () => {
    const blocker = detectBlocker({ text: "Secret prospect bio. Try again later. More text." });
    expect(blocker).toEqual({ kind: "rate_limited", detail: "try again later" });
  });

  it("returns null without URL or text", () => {
    expect(detectBlocker({})).toBeNull();
    expect(detectBlocker()).toBeNull();
  });
});

describe("helpers", () => {
  it("normaliseText removes accents, straightens apostrophes and collapses spaces", () => {
    expect(normaliseText("  Réessayez\n  PLUS   tard — qu\u2019il ")).toBe("reessayez plus tard — qu'il");
  });

  it("redactUrl keeps origin and path only", () => {
    expect(redactUrl("https://www.facebook.com/checkpoint/123/?next=https%3A%2F%2Fx&token=abc")).toBe(
      "https://www.facebook.com/checkpoint/123/"
    );
    expect(redactUrl("not a url")).toBeUndefined();
  });
});
