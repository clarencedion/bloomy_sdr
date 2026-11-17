/**
 * MockSocialChannelDriver: an in-memory network for offline tests.
 *
 * It ships with a fake page whose keyboard behaves like the Instagram and
 * Messenger composers that matter here: Shift+Enter adds a line, Enter SENDS.
 * Tests therefore observe sends where they would really happen (an Enter
 * reaching the composer), not where the code under test claims to send.
 *
 * Every interaction is appended to `timeline`, which tests share with their
 * scripted key source to check ordering ("no send without an Enter for that
 * message").
 *
 * `browserKey` plays the operator typing in the BROWSER window instead of the
 * terminal: it clicks the conversation's composer (as a person would) and
 * presses the key there, so tests can check what the session does about a
 * message that left without it.
 */
import { normaliseForCompare } from "../composer.mjs";

/** A page with just the surface composer.mjs and the session machines touch. */
export function createMockPage({ timeline = [] } = {}) {
  const page = {
    timeline,
    currentUrl: "about:blank",
    /** Texts that left through an Enter in a composer. */
    sent: [],
    /** Every composer a conversation opened, oldest first. */
    composers: [],
    focused: null,
    url: () => page.currentUrl,
    keyboard: {
      async insertText(text) {
        timeline.push({ type: "keyboard.insertText", text });
        page.focused?.receiveText(text);
      },
      async press(key) {
        timeline.push({ type: "keyboard.press", key });
        page.focused?.receiveKey(key);
      },
      async type(text) {
        timeline.push({ type: "keyboard.type", text });
        throw new Error("keyboard.type must never be used: it turns line breaks into Enter");
      }
    },
    async waitForTimeout() {},
    /** The operator, in the browser window: clicks the open conversation's composer and presses `key`. */
    browserKey(key) {
      const composer = page.composers.at(-1);
      if (!composer) throw new Error("No conversation is open in the browser");
      timeline.push({ type: "browser.key", key });
      page.focused = composer;
      composer.receiveKey(key);
    }
  };
  return page;
}

/**
 * A composer. `mangle` lets a test simulate an editor that drops characters,
 * so the read-back check has something to catch.
 */
export function createMockComposer(page, { mangle } = {}) {
  const composer = {
    text: "",
    selectedAll: false,
    /** False once the element left the page (closed window, re-rendered thread). */
    isAttached: true,
    async attached() {
      return composer.isAttached;
    },
    async click() {
      page.focused = composer;
    },
    async blur() {
      page.timeline.push({ type: "composer.blur" });
      if (page.focused === composer) page.focused = null;
    },
    async innerText() {
      return composer.text;
    },
    async press(key) {
      page.timeline.push({ type: "composer.press", key });
      page.focused = composer;
      composer.receiveKey(key);
    },
    async pressSequentially(text) {
      page.timeline.push({ type: "composer.pressSequentially", text });
      throw new Error("pressSequentially must never be used: it turns line breaks into Enter");
    },
    receiveText(text) {
      if (composer.selectedAll) {
        composer.text = "";
        composer.selectedAll = false;
      }
      composer.text += mangle ? mangle(text) : text;
    },
    receiveKey(key) {
      if (key === "Shift+Enter") {
        composer.text += "\n";
      } else if (key === "ControlOrMeta+A") {
        composer.selectedAll = true;
      } else if (key === "Backspace") {
        composer.text = composer.selectedAll ? "" : composer.text.slice(0, -1);
        composer.selectedAll = false;
      } else if (key === "Enter") {
        // What the real composers do: Enter sends whatever is in the box.
        if (composer.text) {
          page.sent.push(composer.text);
          page.timeline.push({ type: "send", text: composer.text, composer: page.composers.indexOf(composer) });
        }
        composer.text = "";
        composer.selectedAll = false;
      }
    }
  };
  return composer;
}

/**
 * @param {{
 *   page: ReturnType<typeof createMockPage>,
 *   network?: "instagram" | "facebook",
 *   profiles?: Record<string, "ok" | string | import("../blockers.mjs").Blocker>,
 *   blockers?: Array<import("../blockers.mjs").Blocker | null>,
 *   confirm?: boolean | "delivered" | "failed" | "unconfirmed" | ((text: string) => boolean | string),
 *   loggedIn?: boolean,
 *   identity?: string,
 *   home?: { blocker?: import("../blockers.mjs").Blocker },
 *   inbox?: { snapshot?: string, blocker?: import("../blockers.mjs").Blocker },
 *   threads?: Record<string, { url: string, snapshot: string, blocker?: import("../blockers.mjs").Blocker }>,
 *   composerOptions?: { mangle?: (text: string) => string },
 *   threadStates?: Record<string, string | ((when: { typed: boolean, calls: number }) => string)>,
 *   threadCheck?: false | "blind"
 * }} script
 *   `profiles` maps a profile URL to what opening it yields (default "ok");
 *   `blockers` is the queue `checkBlocker` answers from (null = clear);
 *   `confirm` overrides what confirmSent reports (true = "delivered", false = "unconfirmed");
 *   `loggedIn` / `identity` / `home` script the session start;
 *   `threads` maps a thread URL, row name or text to its content;
 *   `threadStates` maps a profile URL to what `threadState` answers ("empty",
 *   "has_content", "unknown", or a function of the call) — by default a
 *   conversation is "empty" until a message was sent in it;
 *   `threadCheck`: false = the network has no such check (no `threadState`
 *   method), "blind" = it answers "empty" even after a send.
 */
export function createMockSocialChannelDriver(script) {
  const {
    page,
    network = "instagram",
    profiles = {},
    blockers = [],
    confirm,
    inbox = {},
    threads = {},
    composerOptions,
    threadStates = {},
    threadCheck,
    loggedIn = true,
    identity,
    home = {}
  } = script;
  const calls = [];
  const record = (op, detail = {}) => {
    calls.push({ op, ...detail });
    page.timeline.push({ type: `driver.${op}`, ...detail });
  };

  function openComposer(url) {
    page.currentUrl = url;
    const composer = createMockComposer(page, composerOptions);
    page.composers.push(composer);
    page.focused = composer;
    return composer;
  }

  const threadCalls = new Map();
  async function threadState(_page, composer, profile, { typed = false } = {}) {
    record("threadState", { url: profile?.url, typed });
    const calls = (threadCalls.get(profile?.url) ?? 0) + 1;
    threadCalls.set(profile?.url, calls);
    const scripted = threadStates[profile?.url];
    if (scripted !== undefined) {
      const state = typeof scripted === "function" ? scripted({ typed, calls }) : scripted;
      return { state, ...(state === "empty" ? {} : { why: "scripted" }) };
    }
    if (threadCheck === "blind") return { state: "empty" };
    // A message left from this conversation's composer: it is no longer new.
    const index = page.composers.indexOf(composer);
    const sentHere = page.timeline.some((event) => event.type === "send" && event.composer === index);
    return sentHere ? { state: "has_content", why: "text:message" } : { state: "empty" };
  }

  return {
    network,
    homeUrl: "https://mock.invalid/",
    calls,

    async isLoggedIn() {
      record("isLoggedIn");
      return loggedIn;
    },

    async openHome() {
      record("openHome");
      page.currentUrl = "https://www.instagram.com/";
      return home.blocker ? { ok: false, reason: home.blocker } : { ok: true };
    },

    async activeIdentity() {
      record("activeIdentity");
      return identity;
    },

    async openConversation(_page, profile) {
      record("openConversation", { url: profile.url });
      const outcome = profiles[profile.url] ?? "ok";
      if (outcome !== "ok") return { ok: false, reason: outcome };
      return { ok: true, composer: openComposer(`https://www.instagram.com/direct/t/${encodeURIComponent(profile.handle)}/`) };
    },

    async closeConversation() {
      record("closeConversation");
    },

    async confirmSent(_page, text) {
      record("confirmSent");
      const answer =
        typeof confirm === "function"
          ? confirm(text)
          : confirm !== undefined
            ? confirm
            : page.sent.some((sent) => normaliseForCompare(sent) === normaliseForCompare(text));
      if (answer === true) return "delivered";
      if (answer === false) return "unconfirmed";
      return answer;
    },

    async checkBlocker() {
      record("checkBlocker");
      return blockers.length ? blockers.shift() : null;
    },

    ...(threadCheck === false ? {} : { threadState }),

    /** The composer on screen now: the newest one still attached. */
    async currentComposer() {
      record("currentComposer");
      return page.composers.filter((composer) => composer.isAttached).at(-1) ?? null;
    },

    threadUrl: () => (page.currentUrl.includes("/t/") ? page.currentUrl : undefined),

    async openInbox() {
      record("openInbox");
      return inbox.blocker ? { ok: false, reason: inbox.blocker } : { ok: true };
    },

    async listThreads() {
      record("listThreads");
      return inbox.snapshot ?? "";
    },

    async openThread(_page, ref) {
      record("openThread", { ref });
      const thread = threads[ref.url] ?? threads[ref.name] ?? threads[ref.text];
      if (!thread) return { ok: false, reason: "thread_not_found" };
      if (thread.blocker) return { ok: false, reason: thread.blocker };
      page.currentThread = thread;
      return { ok: true, composer: openComposer(thread.url) };
    },

    async threadSnapshot() {
      record("threadSnapshot");
      return page.currentThread?.snapshot ?? "";
    }
  };
}
