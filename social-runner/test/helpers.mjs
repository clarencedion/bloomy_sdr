/**
 * Offline test doubles for the session machines: scripted keys, a recording
 * SDR, a silent UI. No Firebase, no Playwright, no terminal.
 */
import { createMockPage, createMockSocialChannelDriver } from "../src/drivers/mock-social-channel-driver.mjs";

/**
 * Keys from a script. Each entry is a key name, `{ key, before }` (before()
 * runs just before the key is returned), or `{ line }` for readLine. A key
 * the prompt did not offer fails the test: the real hub would ignore it, so a
 * script relying on it is wrong. `interrupt()` plays a Ctrl+C: like the real
 * hub, every later prompt answers "q" and `isInterrupted()` turns true.
 */
export function scriptedKeys(timeline, script) {
  const queue = [...script];
  let interrupted = false;
  return {
    remaining: queue,
    interrupt() {
      timeline.push({ type: "interrupt" });
      interrupted = true;
    },
    isInterrupted: () => interrupted,
    async prompt(choices, options = {}) {
      timeline.push({ type: "prompt", choices: [...choices], timeoutMs: options.timeoutMs, drainMs: options.drainMs });
      if (interrupted) {
        timeline.push({ type: "key", key: "q" });
        return "q";
      }
      const next = queue.shift();
      if (next === undefined) throw new Error(`No scripted key left for prompt [${choices.join(", ")}]`);
      const entry = typeof next === "string" ? { key: next } : next;
      if (entry.line !== undefined) throw new Error(`Expected a key for prompt [${choices.join(", ")}], got a line`);
      entry.before?.();
      const offered = choices.includes(entry.key) || (entry.key === "timeout" && options.timeoutMs);
      if (!offered) throw new Error(`Key "${entry.key}" was not offered by prompt [${choices.join(", ")}]`);
      if (options.onTick) options.onTick(0);
      timeline.push({ type: "key", key: entry.key });
      return entry.key;
    },
    async readLine(question, initial) {
      timeline.push({ type: "readLine", initial });
      if (interrupted) return null;
      const next = queue.shift();
      if (!next || typeof next !== "object" || !("line" in next)) throw new Error("Expected a { line } entry for readLine");
      next.before?.();
      return next.line;
    }
  };
}

/** Keys chosen at random among those offered (seeded), for the invariant sweep. */
export function randomKeys(timeline, seed, lines) {
  let state = seed >>> 0 || 1;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  return {
    isInterrupted: () => false,
    async prompt(choices, options = {}) {
      timeline.push({ type: "prompt", choices: [...choices], timeoutMs: options.timeoutMs });
      const pool = options.timeoutMs ? [...choices, "timeout"] : choices;
      const key = pool[Math.floor(random() * pool.length)];
      timeline.push({ type: "key", key });
      return key;
    },
    async readLine(question, initial) {
      timeline.push({ type: "readLine", initial });
      const options = [null, "", ...lines];
      return options[Math.floor(random() * options.length)];
    }
  };
}

/** A UI that prints nothing but keeps what it was asked to show. */
export function silentUi() {
  const shown = [];
  return new Proxy(
    { shown },
    {
      get(target, property) {
        if (property in target) return target[property];
        return (...args) => shown.push({ call: property, args });
      }
    }
  );
}

/**
 * A recording SDR. Every method resolves `overrides[name](input)` or a
 * sensible default; `calls` keeps the order across methods.
 */
export function mockSdr(timeline, overrides = {}) {
  const calls = [];
  const defaults = {
    checkBeforeSend: () => ({ allowed: true }),
    checkAutoSend: () => ({ allowed: true }),
    reserveSendSlot: () => ({ ok: true, used: 1, cap: 30 }),
    recordSocialDmSent: () => ({ conversationId: "conv_c", contactId: "ct_c" }),
    recordSocialDmSkipped: () => undefined,
    recordSocialDmAutoHeld: () => undefined,
    reportSessionBlocked: () => undefined,
    canContactSocial: () => ({ allowed: true }),
    checkBeforeSocialReply: () => ({ allowed: true }),
    reportUnmatchedSocialThreads: () => undefined,
    listSocialConversations: () => [],
    extractThreadMessages: () => ({ messages: [] }),
    ingestSocialInbound: () => ({ action: "no_new", newMessages: 0 }),
    regenerateSocialDraft: () => null,
    recordSocialReplySent: () => undefined
  };
  const sdr = { calls };
  for (const [name, fallback] of Object.entries(defaults)) {
    sdr[name] = async (input) => {
      calls.push({ name, input });
      timeline.push({ type: `sdr.${name}`, input });
      return (overrides[name] ?? fallback)(input);
    };
  }
  // Pure and synchronous in the real module, so not async here either.
  sdr.newProspectMessages = (input) => {
    calls.push({ name: "newProspectMessages", input });
    return (overrides.newProspectMessages ?? (() => []))(input);
  };
  sdr.callsTo = (name) => calls.filter((call) => call.name === name).map((call) => call.input);
  return sdr;
}

export const SESSION = Object.freeze({
  sessionId: "sess_1",
  workspaceId: "ws_default",
  businessId: "biz_test",
  network: "instagram",
  operator: "tester"
});

export function queueItem(n, extra = {}) {
  return {
    outreachId: `out_${n}`,
    companyId: `co_${n}`,
    companyName: `Boutique ${n}`,
    network: "instagram",
    profile: { url: `https://www.instagram.com/boutique${n}/`, handle: `boutique${n}` },
    body: `Bonjour Boutique ${n},\nj'ai vu vos créations sur Instagram, elles sont superbes.\nUne question rapide ?`,
    pricingGuardrailPassed: true,
    mentionsCommercialTerms: false,
    riskWarnings: [],
    ...extra
  };
}

/**
 * The pending-send journal in memory (send-journal.mjs writes files): every
 * begin and settle lands on the timeline, so tests check that the note is
 * taken before the key and dropped only after the record.
 */
export function memoryJournal(timeline) {
  const entries = new Map();
  let next = 0;
  return {
    entries,
    dir: "/memory",
    begin(entry) {
      next += 1;
      const id = `j${next}`;
      entries.set(id, { id, at: new Date(0).toISOString(), ...JSON.parse(JSON.stringify(entry)) });
      timeline.push({ type: "journal.begin", id, entry });
      return id;
    },
    settle(id) {
      if (!id) return;
      entries.delete(id);
      timeline.push({ type: "journal.settle", id });
    },
    pending: () => [...entries.values()]
  };
}

/** Everything a session needs, wired to one shared timeline. */
export function harness({ keys: keyScript = [], sdr: sdrOverrides = {}, driver: driverScript = {}, keySource } = {}) {
  const timeline = [];
  const page = createMockPage({ timeline });
  const driver = createMockSocialChannelDriver({ page, ...driverScript });
  const sdr = mockSdr(timeline, sdrOverrides);
  const ui = silentUi();
  const keys = keySource ? keySource(timeline) : scriptedKeys(timeline, keyScript);
  const journal = memoryJournal(timeline);
  const ctx = { page, driver, keys, ui, sdr, journal, sleep: async () => undefined, session: { ...SESSION } };
  return { ctx, timeline, page, driver, sdr, ui, keys, journal };
}

/** A send the runner caused: the event right before it is a key the runner pressed. */
export function isRunnerSend(timeline, index) {
  const previous = timeline[index - 1];
  return timeline[index].type === "send" && (previous?.type === "composer.press" || previous?.type === "keyboard.press");
}

/**
 * The central invariant, checked on a timeline: every send the runner caused
 * happened after an "enter" answered to a prompt that offered Enter, with no
 * conversation or thread opened in between (so the Enter was for that
 * message), and one Enter approves at most one send. Sends a test simulates
 * as the human pressing a key in the browser are not the runner's and are
 * left out.
 */
export function assertEverySendFollowsItsEnter(timeline) {
  const used = new Set();
  timeline.forEach((event, index) => {
    if (!isRunnerSend(timeline, index)) return;
    let approvedBy = -1;
    for (let back = index - 1; back >= 0; back -= 1) {
      const previous = timeline[back];
      if (previous.type === "driver.openConversation" || previous.type === "driver.openThread") break;
      if (previous.type === "key" && previous.key === "enter") {
        const prompt = timeline[back - 1];
        if (prompt?.type === "prompt" && prompt.choices.includes("enter")) {
          approvedBy = back;
          break;
        }
      }
    }
    if (approvedBy < 0) throw new Error(`Send without an Enter for this message (timeline index ${index}): ${event.text}`);
    if (used.has(approvedBy)) throw new Error(`Two sends for one Enter (timeline index ${index}): ${event.text}`);
    used.add(approvedBy);
  });
}
