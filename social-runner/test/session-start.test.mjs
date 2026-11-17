/**
 * Phase 23 review fix #17 (which account the window acts as), the focus
 * reminder (#1, #15) and the pure helpers behind them.
 */
import { describe, expect, it } from "vitest";
import { displayIdentity, expectedAccount, facebookIdentityFromSnapshot, identityMatches, instagramIdentityFromSnapshot } from "../src/identity.mjs";
import { FOCUS_REMINDER, prepareSession } from "../src/session-start.mjs";
import { STOP } from "../src/session-machine.mjs";
import { harness } from "./helpers.mjs";

const start = (driver, keys = ["o"], options = {}) => {
  const h = harness({ keys, driver });
  return { ...h, run: () => prepareSession(h.ctx, { network: "instagram", businessName: "Bloomy", ...options }) };
};

describe("session start (finding #17)", () => {
  it("refuses a window that is not logged in", async () => {
    const { run, timeline } = start({ loggedIn: false });
    await expect(run()).resolves.toEqual({ ok: false, reason: "not_logged_in" });
    expect(timeline.some((event) => event.type === "prompt")).toBe(false);
  });

  it("stops on a blocker on the home page", async () => {
    const blocker = { kind: "checkpoint", detail: "challenge" };
    const { run } = start({ home: { blocker } });
    await expect(run()).resolves.toEqual({ ok: false, reason: "blocked:checkpoint", blocker });
  });

  it("refuses when the window acts as another account than the business's", async () => {
    const { run, ui, timeline } = start({ identity: "clarence.perso" }, ["o"], { expected: "bloomy.studio" });
    await expect(run()).resolves.toEqual({ ok: false, reason: "wrong_account" });
    expect(timeline.some((event) => event.type === "prompt")).toBe(false);
    expect(ui.shown.some((entry) => entry.call === "error" && /@clarence\.perso/.test(entry.args[0]) && /@bloomy\.studio/.test(entry.args[0]))).toBe(true);
  });

  it("shows the matching account and still asks for an explicit O", async () => {
    const { run, timeline, ui } = start({ identity: "Bloomy.Studio" }, ["o"], { expected: "@bloomy.studio" });
    await expect(run()).resolves.toEqual({ ok: true, identity: "Bloomy.Studio" });
    expect(timeline.find((event) => event.type === "prompt").choices).toEqual(["o", "q"]);
    expect(ui.shown.some((entry) => entry.call === "info" && /conforme/.test(entry.args[0]))).toBe(true);
  });

  it("with an account it cannot read, warns and waits for O; Q stops", async () => {
    const { run, ui } = start({ identity: undefined }, ["q"], { expected: "bloomy.studio" });
    await expect(run()).resolves.toEqual({ ok: false, reason: STOP.OPERATOR });
    expect(ui.shown.some((entry) => entry.call === "warn" && /ne peux pas lire le compte/.test(entry.args[0]))).toBe(true);
  });

  it("tells the operator to keep the terminal in front before the first key", async () => {
    const { run, ui, timeline } = start({ identity: "bloomy.studio" });
    await run();
    const reminder = ui.shown.findIndex((entry) => entry.call === "warn" && entry.args[0] === FOCUS_REMINDER);
    expect(reminder).toBeGreaterThan(-1);
    expect(FOCUS_REMINDER).toMatch(/terminal/);
    expect(FOCUS_REMINDER).toMatch(/Entrée/);
    expect(timeline.some((event) => event.type === "prompt")).toBe(true);
  });
});

describe("reading the logged-in account", () => {
  const instagramNav = [
    '- navigation "Navigation principale":',
    '  - link "Accueil":',
    "    - /url: /",
    '  - link "Messages":',
    "    - /url: /direct/inbox/",
    '  - link "Photo de profil de bloomy.studio Profil":',
    "    - /url: /bloomy.studio/",
    '    - img "Photo de profil de bloomy.studio"',
    "    - text: Profil"
  ].join("\n");

  it("Instagram: the navigation's Profil link", () => {
    expect(instagramIdentityFromSnapshot(instagramNav)).toBe("bloomy.studio");
  });

  it("Instagram: a post author's profile link is not the account", () => {
    const feed = ['- link "Photo de profil de fleursdelise":', "  - /url: /fleursdelise/", '  - img "Photo de profil de fleursdelise"'].join("\n");
    expect(instagramIdentityFromSnapshot(feed)).toBeUndefined();
    expect(instagramIdentityFromSnapshot(`${instagramNav}\n${feed}`)).toBe("bloomy.studio");
  });

  // The 2026 navigation (snapshot taken live on 2026-11-10): no "Profil" text,
  // the account is the picture link next to the Direct link.
  const instagramNav2026 = [
    '- link "Accueil":',
    "  - /url: /",
    '- link "Messages Messagerie Direct - 1 nouveau lien de notification":',
    "  - /url: /direct/inbox/",
    '- link "Photo de profil de clarencedion":',
    "  - /url: /clarencedion/",
    '  - link "Photo de profil de clarencedion":',
    '    - img "Photo de profil de clarencedion"',
    "- main:",
    '  - link "Photo de profil de tom__rdgs":',
    "    - /url: /tom__rdgs/"
  ].join("\n");

  it("Instagram 2026: the picture link next to the Direct link is the account; feed pictures are not", () => {
    expect(instagramIdentityFromSnapshot(instagramNav2026)).toBe("clarencedion");
  });

  it("Instagram 2026: a picture whose label names another user than its link is not the account", () => {
    const odd = instagramNav2026.replace("- /url: /clarencedion/", "- /url: /someone.else/");
    expect(instagramIdentityFromSnapshot(odd)).toBeUndefined();
  });

  it("Instagram: two different Profil links mean unknown", () => {
    const other = ['- link "Profil":', "  - /url: /someone.else/"].join("\n");
    expect(instagramIdentityFromSnapshot(`${instagramNav}\n${other}`)).toBeUndefined();
  });

  it("Facebook: the left column's profile shortcut with a picture", () => {
    const nav = [
      '- navigation "Raccourcis":',
      '  - link "Bloomy Studio":',
      "    - /url: https://www.facebook.com/bloomystudio",
      "    - img",
      "    - text: Bloomy Studio",
      '  - link "Amis":',
      "    - /url: https://www.facebook.com/friends/",
      "    - img",
      "    - text: Amis"
    ].join("\n");
    expect(facebookIdentityFromSnapshot(nav)).toBe("Bloomy Studio");
    expect(facebookIdentityFromSnapshot('- link "Accueil":\n  - /url: /')).toBeUndefined();
  });

  it("compares with the business settings", () => {
    expect(expectedAccount({ instagram: { handle: "@Bloomy.Studio" } }, "instagram")).toBe("Bloomy.Studio");
    expect(expectedAccount({ facebook: { name: " Bloomy Studio " } }, "facebook")).toBe("Bloomy Studio");
    expect(expectedAccount({}, "facebook")).toBeUndefined();
    expect(identityMatches("bloomy.studio", "@Bloomy.Studio")).toBe(true);
    expect(identityMatches("Bloomy Studio", "bloomy studio")).toBe(true);
    expect(identityMatches("Clarence Dion", "Bloomy Studio")).toBe(false);
    expect(identityMatches(undefined, "Bloomy Studio")).toBe(false);
    expect(displayIdentity("instagram", "bloomy.studio")).toBe("@bloomy.studio");
    expect(displayIdentity("facebook", "Bloomy Studio")).toBe("Bloomy Studio");
  });
});
