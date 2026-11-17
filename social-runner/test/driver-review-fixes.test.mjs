/**
 * Phase 23 review fixes in the browser drivers, on fake pages (no browser):
 * the pinned composer (#2), Meta's verdict on a sent bubble (#3), the empty
 * text guard and the matcher's "nothing safe to click" rule (minors).
 */
import { describe, expect, it } from "vitest";
import {
  SEND_STATUS,
  SEVERAL_CHAT_WINDOWS,
  confirmBubble,
  deliveryVerdict,
  pinComposer,
  pinSingleComposer,
  sendMarkers
} from "../src/drivers/common.mjs";
import { createWebDmDriver } from "../src/drivers/web-dm-driver.mjs";
import { INSTAGRAM_CONFIG } from "../src/drivers/instagram-driver.mjs";
import { matchThreads } from "../src/inbox-matcher.mjs";

const TEXT = "Bonjour,\nj'ai découvert vos compositions sur Instagram, elles sont superbes.";

describe("send markers and verdicts (finding #3)", () => {
  it.each([
    ["Échec de l'envoi · Réessayer", "echec de l'envoi"],
    ["Not Delivered", "not delivered"],
    ["Couldn’t send. Tap to retry.", "couldn't send"],
    ["Le message n'a pas été envoyé", "n'a pas ete envoye"]
  ])("%s is a failure", (text, marker) => {
    expect(sendMarkers(text).failed).toBe(marker);
  });

  it.each(["Envoi…", "Sending...", "Envoi en cours"])("%s is pending", (text) => {
    expect(sendMarkers(text).pending).not.toBeNull();
    expect(sendMarkers(text).failed).toBeNull();
  });

  it("timestamps and read receipts are neither", () => {
    expect(sendMarkers("Vu · 14:32")).toEqual({ failed: null, pending: null });
    expect(sendMarkers("Je vous envoie le lien")).toEqual({ failed: null, pending: null });
  });

  it("judges one observation", () => {
    expect(deliveryVerdict(null, TEXT)).toBe("unreadable");
    expect(deliveryVerdict({ composerText: "", bubbleFound: true, markerText: "Échec de l'envoi" }, TEXT)).toBe("failed");
    expect(deliveryVerdict({ composerText: TEXT, bubbleFound: false, markerText: "" }, TEXT)).toBe("in_composer");
    expect(deliveryVerdict({ composerText: "", bubbleFound: false, markerText: "" }, TEXT)).toBe("absent");
    expect(deliveryVerdict({ composerText: "", bubbleFound: true, markerText: "Envoi…" }, TEXT)).toBe("pending");
    expect(deliveryVerdict({ composerText: "", bubbleFound: true, markerText: "14:32" }, TEXT)).toBe("shown");
  });
});

/** A fake clock and a composer whose in-page inspection returns scripted observations. */
function scriptedConfirm(observations) {
  const clock = { now: 0 };
  const seen = [...observations];
  let last = seen[0];
  const composer = {
    attached: async () => true,
    evaluate: async (_fn, args) => {
      expect(args.snippet).toBe("j'ai découvert vos compositions sur Inst");
      if (seen.length) last = seen.shift();
      return last;
    }
  };
  const options = { now: () => clock.now, sleep: async (ms) => (clock.now += ms), timeoutMs: 12000, settleMs: 3000, pollMs: 400 };
  return { composer, options, page: {} };
}

const shown = { composerText: "", bubbleFound: true, markerText: "14:32" };

describe("confirmBubble (finding #3)", () => {
  it("an optimistic bubble that turns into 'Échec de l'envoi' is FAILED, not delivered", async () => {
    const failed = { composerText: "", bubbleFound: true, markerText: "Échec de l'envoi · Réessayer" };
    const { composer, options, page } = scriptedConfirm([shown, shown, failed]);
    await expect(confirmBubble(page, TEXT, composer, options)).resolves.toBe(SEND_STATUS.FAILED);
  });

  it("a bubble that stays clean for the settle time is DELIVERED", async () => {
    const { composer, options, page } = scriptedConfirm([shown]);
    await expect(confirmBubble(page, TEXT, composer, options)).resolves.toBe(SEND_STATUS.DELIVERED);
  });

  it("a bubble still 'Envoi…' at the deadline is UNCONFIRMED", async () => {
    const { composer, options, page } = scriptedConfirm([{ composerText: "", bubbleFound: true, markerText: "Envoi…" }]);
    await expect(confirmBubble(page, TEXT, composer, options)).resolves.toBe(SEND_STATUS.UNCONFIRMED);
  });

  it("text still in the composer, or no bubble, is UNCONFIRMED", async () => {
    const stuck = scriptedConfirm([{ composerText: TEXT, bubbleFound: false, markerText: "" }]);
    await expect(confirmBubble(stuck.page, TEXT, stuck.composer, stuck.options)).resolves.toBe(SEND_STATUS.UNCONFIRMED);
    const absent = scriptedConfirm([{ composerText: "", bubbleFound: false, markerText: "" }]);
    await expect(confirmBubble(absent.page, TEXT, absent.composer, absent.options)).resolves.toBe(SEND_STATUS.UNCONFIRMED);
  });

  it("a composer that left the page is replaced by the conversation's current one", async () => {
    const clock = { now: 0 };
    const gone = { attached: async () => false, evaluate: async () => expect.unreachable("the detached composer is not read") };
    const current = { evaluate: async () => shown };
    const status = await confirmBubble({}, TEXT, gone, {
      relocate: async () => current,
      now: () => clock.now,
      sleep: async (ms) => (clock.now += ms)
    });
    expect(status).toBe(SEND_STATUS.DELIVERED);
  });
});

/**
 * A fake DOM with Playwright's lazy-locator semantics: `.first()` is resolved
 * again at every action, while an element handle stays on its element.
 */
function lazyComposers() {
  const elements = [];
  const element = (name) => ({ name, text: "", connected: true, presses: [] });
  const handleOf = (el) => ({
    evaluate: async (fn) => fn({ isConnected: el.connected, blur: () => undefined }),
    click: async () => undefined,
    innerText: async () => el.text,
    press: async (key) => el.presses.push(key),
    dispose: async () => undefined
  });
  const firstNow = () => elements[0];
  const lazyFirst = {
    waitFor: async () => {
      if (!elements.length) throw new Error("Timeout");
    },
    elementHandle: async () => (elements.length ? handleOf(firstNow()) : null),
    press: async (key) => firstNow().presses.push(key)
  };
  const locator = {
    filter: () => ({ first: () => lazyFirst, count: async () => elements.length })
  };
  return { elements, element, locator, lazyFirst };
}

describe("the pinned composer (finding #2)", () => {
  it("keeps acting on the element it was pinned to when another chat window comes first", async () => {
    const dom = lazyComposers();
    const ours = dom.element("ours");
    dom.elements.push(ours);
    const pinned = await pinComposer(dom.lazyFirst);

    const intruder = dom.element("intruder");
    dom.elements.unshift(intruder);
    await pinned.press("Enter");
    expect(ours.presses).toEqual(["Enter"]);
    expect(intruder.presses).toEqual([]);
    // What a lazy .first() would have done:
    await dom.lazyFirst.press("Enter");
    expect(intruder.presses).toEqual(["Enter"]);
  });

  it("knows when its element left the page", async () => {
    const dom = lazyComposers();
    const ours = dom.element("ours");
    dom.elements.push(ours);
    const pinned = await pinComposer(dom.lazyFirst);
    await expect(pinned.attached()).resolves.toBe(true);
    ours.connected = false;
    await expect(pinned.attached()).resolves.toBe(false);
  });

  it("refuses to pin when a second composer is visible", async () => {
    const dom = lazyComposers();
    dom.elements.push(dom.element("a"), dom.element("b"));
    await expect(pinSingleComposer(() => dom.locator, 10)).resolves.toEqual({ ok: false, reason: SEVERAL_CHAT_WINDOWS });
  });

  it("pins the single composer, or reports none", async () => {
    const dom = lazyComposers();
    await expect(pinSingleComposer(() => dom.locator, 10)).resolves.toEqual({ ok: false, reason: "no_composer" });
    dom.elements.push(dom.element("only"));
    const found = await pinSingleComposer(() => dom.locator, 10);
    expect(found.ok).toBe(true);
    expect(found.composer.pinned).toBe(true);
  });
});

describe("never click an element by an empty text (minor)", () => {
  it("openThread with no URL, no name and an empty text returns thread_not_found without querying the page", async () => {
    const driver = createWebDmDriver(INSTAGRAM_CONFIG);
    const page = {
      getByText: (text) => expect.unreachable(`getByText(${JSON.stringify(text)})`),
      getByRole: () => expect.unreachable("getByRole")
    };
    await expect(driver.openThread(page, { text: "" })).resolves.toEqual({ ok: false, reason: "thread_not_found" });
    await expect(driver.openThread(page, { text: "   ", role: "button", name: "" })).resolves.toEqual({ ok: false, reason: "thread_not_found" });
  });

  it("matchThreads leaves unmatched a row with nothing safe to click", () => {
    const snapshot = ["- list:", "  - listitem:", "    - button:", "      - link:", "        - /url: /fleursdelise/"].join("\n");
    const matches = matchThreads(snapshot, [{ conversationId: "c1", companyName: "Fleurs de Lise", handle: "fleursdelise", ourTexts: [] }]);
    expect(matches.has("c1")).toBe(false);
  });
});

describe("a row with nothing to click but a known thread URL (re-review: missed new replies)", () => {
  // Only a profile link in the row: no thread link, no name, no text.
  const bareRow = ["- list:", "  - listitem:", "    - button:", "      - link:", "        - /url: /fleursdelise/"].join("\n");
  const THREAD = "https://www.instagram.com/direct/t/777/";
  const lise = { conversationId: "c1", companyName: "Fleurs de Lise", handle: "fleursdelise", ourTexts: [] };

  it("is matched and opened by the conversation's recorded thread URL", () => {
    const matches = matchThreads(bareRow, [{ ...lise, threadUrl: THREAD }]);
    expect(matches.get("c1")).toMatchObject({ url: THREAD, matchedBy: "profile_link", lastFromUs: false });
  });

  it.each([
    ["a profile URL", "https://www.instagram.com/fleursdelise/"],
    ["another site", "https://evil.example/direct/t/777/"],
    ["a look-alike host", "https://instagram.com.evil.example/direct/t/777/"],
    ["plain http", "http://www.instagram.com/direct/t/777/"],
    ["not a URL", "direct/t/777"],
    ["an empty string", "  "]
  ])("is still left unmatched when the recorded URL is %s", (_label, threadUrl) => {
    expect(matchThreads(bareRow, [{ ...lise, threadUrl }]).has("c1")).toBe(false);
  });

  it("a row's own thread link still wins over the recorded URL", () => {
    const linked = ["- list:", "  - link:", "    - /url: /direct/t/555/", "    - img \"fleursdelise\""].join("\n");
    expect(matchThreads(linked, [{ ...lise, threadUrl: THREAD }]).get("c1")).toMatchObject({ url: "/direct/t/555/" });
  });

  it.each([
    ["Messenger", "https://www.messenger.com/t/1000123/"],
    ["Facebook", "https://www.facebook.com/messages/e2ee/t/1000123/"]
  ])("accepts a %s thread URL", (_label, threadUrl) => {
    expect(matchThreads(bareRow, [{ ...lise, threadUrl }]).get("c1")).toMatchObject({ url: threadUrl });
  });
});
