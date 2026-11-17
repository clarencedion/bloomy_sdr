/**
 * Automatic send sessions (--auto, ADR-024): a first DM leaves at the end of
 * its countdown, without a key — and only then. Everything here runs on the
 * mock network, whose composer sends on Enter like the real ones, so a send
 * is observed where it would really happen.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/args.mjs";
import { AUTO_VETO_MIN_SECONDS, autoSendable, composeAndSend, runSendSession, STOP } from "../src/session-machine.mjs";
import { harness, isRunnerSend, queueItem } from "./helpers.mjs";

const AUTO = Object.freeze({ vetoSeconds: 10 });
const runnerSends = (timeline) => timeline.filter((event, index) => isRunnerSend(timeline, index));
const opened = (driver) => driver.calls.filter((call) => call.op === "openConversation").map((call) => call.url);
const prompts = (timeline) => timeline.filter((event) => event.type === "prompt");
const typedLines = (timeline) => timeline.filter((event) => event.type === "keyboard.insertText");

/** The review the SDR bridge attaches to its gate answer for an automatic session (sdr.mjs checkBeforeSend). */
function reviewOf(item) {
  const warnings = item.riskWarnings ?? [];
  const sendable = item.pricingGuardrailPassed === true && !warnings.length;
  return {
    pricingGuardrailPassed: item.pricingGuardrailPassed,
    mentionsCommercialTerms: true,
    warnings,
    autoSend: sendable ? { allowed: true } : { allowed: false, reason: "checks_not_passed" }
  };
}

/**
 * A harness whose session is automatic and whose SDR answers like the real
 * bridge: each draft comes with its review and automatic verdict. `keys`: one
 * answer per countdown ("timeout" = nobody pressed anything).
 */
function autoHarness({ items = [], sdr = {}, ...rest } = {}) {
  const byId = new Map(items.map((item) => [item.outreachId, item]));
  const h = harness({
    ...rest,
    sdr: { checkBeforeSend: ({ outreachId }) => ({ allowed: true, review: reviewOf(byId.get(outreachId) ?? queueItem(0)) }), ...sdr }
  });
  h.ctx.auto = AUTO;
  return h;
}

/** Is this prompt a message's countdown (not the spacing wait, which also has a timer)? */
const isCountdown = (prompt) => prompt?.type === "prompt" && prompt.timeoutMs === AUTO.vetoSeconds * 1000 && prompt.choices.join() === "s,q";

/**
 * The automatic invariant, on a timeline: every send the runner caused follows
 * a countdown that ran out for THAT message — no conversation opened in
 * between — and one countdown approves at most one send.
 */
function assertEverySendFollowsItsCountdown(timeline) {
  const used = new Set();
  timeline.forEach((event, index) => {
    if (!isRunnerSend(timeline, index)) return;
    let approvedBy = -1;
    for (let back = index - 1; back >= 0; back -= 1) {
      const previous = timeline[back];
      if (previous.type === "driver.openConversation") break;
      if (previous.type === "key" && previous.key === "timeout" && isCountdown(timeline[back - 1])) {
        approvedBy = back;
        break;
      }
    }
    if (approvedBy < 0) throw new Error(`Automatic send without its countdown (timeline index ${index}): ${event.text}`);
    if (used.has(approvedBy)) throw new Error(`Two sends for one countdown (timeline index ${index}): ${event.text}`);
    used.add(approvedBy);
  });
}

describe("automatic session — what leaves, and when", () => {
  it("sends each allowed DM when its countdown ends, with the text shown, and records it as automatic", async () => {
    const items = [queueItem(1), queueItem(2)];
    const { ctx, timeline, page, sdr } = autoHarness({ items, keys: ["timeout", "timeout"] });
    const result = await runSendSession(ctx, { items, max: 10 });

    expect(page.sent).toEqual([items[0].body, items[1].body]);
    assertEverySendFollowsItsCountdown(timeline);
    // The countdown offers S and Q only — never Enter — and lasts the configured delay.
    for (const prompt of prompts(timeline)) expect(prompt).toMatchObject({ choices: ["s", "q"], timeoutMs: 10_000 });
    expect(sdr.callsTo("recordSocialDmSent")).toEqual([
      expect.objectContaining({ outreachId: "out_1", finalBody: items[0].body, edited: false, verified: true, auto: true, sessionId: "sess_1" }),
      expect.objectContaining({ outreachId: "out_2", finalBody: items[1].body, edited: false, verified: true, auto: true })
    ]);
    // Each text was typed once (three lines), never a second time.
    expect(typedLines(timeline)).toHaveLength(6);
    expect(result).toMatchObject({ sent: 2, unverified: 0, skipped: 0, held: 0 });
    expect(result.stoppedReason).toBeUndefined();
  });

  it("between the countdown and the send: SDR switch, gate, daily slot, blocker, conversation still new, journal — then record", async () => {
    const items = [queueItem(1)];
    const { ctx, timeline, sdr } = autoHarness({ items, keys: ["timeout"] });
    await runSendSession(ctx, { items, max: 1 });

    const order = timeline.map((event) => event.type);
    const send = order.indexOf("send");
    const countdownEnd = timeline.findIndex((event) => event.type === "key" && event.key === "timeout");
    const between = order.slice(countdownEnd, send);
    for (const step of ["sdr.checkAutoSend", "sdr.checkBeforeSend", "sdr.reserveSendSlot", "driver.checkBlocker", "driver.threadState", "journal.begin"]) {
      expect(between, step).toContain(step);
    }
    expect(order.indexOf("sdr.recordSocialDmSent")).toBeGreaterThan(send);
    expect(order.indexOf("journal.settle")).toBeGreaterThan(order.indexOf("sdr.recordSocialDmSent"));
    // The journal note carries the automatic mark too: a replayed send says how it left.
    expect(timeline.find((event) => event.type === "journal.begin").entry.record.auto).toBe(true);
    // The SDR is asked for the automatic verdict with the gate, every time.
    for (const input of sdr.callsTo("checkBeforeSend")) expect(input).toMatchObject({ outreachId: "out_1", forAutoSend: true });
    // New before typing, still new with the text in the composer, and no longer new once it left.
    expect(timeline.filter((event) => event.type === "driver.threadState").map((event) => event.typed)).toEqual([false, true, false]);
  });

  it("S during the countdown skips that prospect; Q stops the session; nothing leaves", async () => {
    const items = [queueItem(1), queueItem(2)];
    const skip = autoHarness({ items, keys: ["s", "timeout"] });
    const skipped = await runSendSession(skip.ctx, { items, max: 10 });
    expect(skip.page.sent).toEqual([items[1].body]);
    expect(skip.sdr.callsTo("recordSocialDmSkipped")).toEqual([{ outreachId: "out_1", network: "instagram", reason: "operator_skip", sessionId: "sess_1" }]);
    expect(skip.page.composers[0].text).toBe("");
    expect(skipped).toMatchObject({ sent: 1, skipped: 1 });

    const quit = autoHarness({ items, keys: ["q"] });
    const stopped = await runSendSession(quit.ctx, { items, max: 10 });
    expect(quit.page.sent).toEqual([]);
    expect(quit.page.composers[0].text).toBe("");
    expect(opened(quit.driver)).toHaveLength(1);
    expect(stopped).toMatchObject({ sent: 0, stoppedReason: STOP.OPERATOR });
  });

  it("a countdown is never shorter than the minimum, whatever the session was given", async () => {
    const items = [queueItem(1)];
    for (const broken of [{}, { vetoSeconds: 0 }, { vetoSeconds: "abc" }, { vetoSeconds: 1 }]) {
      const h = autoHarness({ items, keys: ["s"] });
      h.ctx.auto = broken;
      await runSendSession(h.ctx, { items, max: 1 });
      expect(prompts(h.timeline)[0].timeoutMs).toBe(AUTO_VETO_MIN_SECONDS * 1000);
    }
  });
});

describe("automatic session — a stop request is honoured up to the send", () => {
  const items = [queueItem(1), queueItem(2)];

  it("Ctrl+C during the countdown stops before anything leaves", async () => {
    const h = autoHarness({ items, keys: [] });
    h.keys.remaining.push({ key: "q", before: () => h.keys.interrupt() });
    const result = await runSendSession(h.ctx, { items, max: 10 });
    expect(h.page.sent).toEqual([]);
    expect(result.stoppedReason).toBe(STOP.OPERATOR);
  });

  it("Ctrl+C AFTER the countdown ended, while the gate is being asked: the message does not leave", async () => {
    let asked = 0;
    const h = autoHarness({
      items,
      keys: ["timeout"],
      sdr: {
        checkAutoSend: () => {
          asked += 1;
          // 1 = before the prospect, 2 = at the gate, after the countdown: no prompt is open to answer.
          if (asked === 2) h.keys.interrupt();
          return { allowed: true };
        }
      }
    });
    const result = await runSendSession(h.ctx, { items, max: 10 });
    expect(h.page.sent).toEqual([]);
    expect(h.page.composers[0].text).toBe("");
    expect(h.sdr.callsTo("recordSocialDmSent")).toEqual([]);
    expect(opened(h.driver)).toHaveLength(1);
    expect(result).toMatchObject({ sent: 0, stoppedReason: STOP.OPERATOR });
  });

  it("Ctrl+C while the daily slot is being reserved: the message does not leave", async () => {
    const h = autoHarness({
      items,
      keys: ["timeout"],
      sdr: {
        reserveSendSlot: () => {
          h.keys.interrupt();
          return { ok: true, used: 1, cap: 30 };
        }
      }
    });
    const result = await runSendSession(h.ctx, { items, max: 10 });
    expect(h.page.sent).toEqual([]);
    expect(h.page.composers[0].text).toBe("");
    expect(result).toMatchObject({ sent: 0, stoppedReason: STOP.OPERATOR });
  });
});

describe("automatic session — what it refuses to send", () => {
  it("autoSendable: the SDR's verdict, plus a passed check and no warning; no verdict means no", () => {
    const ok = { pricingGuardrailPassed: true, warnings: [], autoSend: { allowed: true } };
    expect(autoSendable(ok)).toBe(true);
    expect(autoSendable({ ...ok, warnings: undefined })).toBe(true);
    expect(autoSendable({ ...ok, autoSend: { allowed: false, reason: "terms_not_written_by_code" } })).toBe(false);
    expect(autoSendable({ ...ok, autoSend: undefined })).toBe(false);
    expect(autoSendable({ ...ok, pricingGuardrailPassed: false })).toBe(false);
    expect(autoSendable({ ...ok, pricingGuardrailPassed: undefined })).toBe(false);
    expect(autoSendable({ ...ok, warnings: ["x"] })).toBe(false);
    expect(autoSendable({})).toBe(false);
    expect(autoSendable(undefined)).toBe(false);
  });

  it("a draft the SDR does not allow (failed check, warning, never checked) is left in the queue: not opened, not typed, not parked", async () => {
    const items = [
      queueItem(1, { pricingGuardrailPassed: false }),
      queueItem(2, { riskWarnings: ["Le message ne pose pas de question."] }),
      queueItem(3, { pricingGuardrailPassed: undefined }),
      queueItem(4)
    ];
    const { ctx, timeline, page, driver, sdr } = autoHarness({ items, keys: ["timeout"] });
    const result = await runSendSession(ctx, { items, max: 10 });

    expect(opened(driver)).toEqual([items[3].profile.url]);
    expect(page.sent).toEqual([items[3].body]);
    expect(typedLines(timeline).map((event) => event.text).join("\n")).not.toContain("Boutique 1");
    // "Skipped" would keep it out of tomorrow's queue; held drafts stay available for a session with keys.
    expect(sdr.callsTo("recordSocialDmSkipped")).toEqual([]);
    expect(result).toMatchObject({ sent: 1, held: 3, skipped: 0 });
  });

  it("the queue's own flags are not a verdict: without the SDR's answer for THIS session, nothing leaves", async () => {
    // The gate answers "allowed" with no review at all (what a session with keys gets).
    const items = [queueItem(1)];
    const { ctx, page, driver } = harness({ keys: [] });
    ctx.auto = AUTO;
    const result = await runSendSession(ctx, { items, max: 10 });
    expect(opened(driver)).toEqual([]);
    expect(page.sent).toEqual([]);
    expect(result).toMatchObject({ sent: 0, held: 1 });
  });

  it("a verdict that turns bad, or goes missing, during the countdown: the message does not leave and is held", async () => {
    for (const second of [{ allowed: true, review: reviewOf(queueItem(1, { pricingGuardrailPassed: false })) }, { allowed: true }]) {
      let gateCalls = 0;
      const items = [queueItem(1)];
      const { ctx, page, sdr } = autoHarness({
        items,
        keys: ["timeout"],
        sdr: { checkBeforeSend: () => ((gateCalls += 1) === 1 ? { allowed: true, review: reviewOf(items[0]) } : second) }
      });
      const result = await runSendSession(ctx, { items, max: 10 });
      expect(page.sent).toEqual([]);
      expect(page.composers[0].text).toBe("");
      expect(sdr.callsTo("recordSocialDmSent")).toEqual([]);
      expect(result).toMatchObject({ sent: 0, held: 1, refused: 0 });
    }
  });

  it("a composer that does not hold the text exactly: no countdown, nothing sent, the session stops", async () => {
    const items = [queueItem(1), queueItem(2)];
    const { ctx, timeline, page, driver } = autoHarness({ items, keys: [], driver: { composerOptions: { mangle: (text) => text.replace(/é/g, "e") } } });
    const result = await runSendSession(ctx, { items, max: 10 });

    expect(page.sent).toEqual([]);
    expect(prompts(timeline)).toEqual([]);
    // typeAndVerify's own two attempts, three lines each — and no more.
    expect(typedLines(timeline)).toHaveLength(2 * 3);
    expect(page.composers[0].text).toBe("");
    expect(opened(driver)).toHaveLength(1);
    expect(result).toMatchObject({ sent: 0, stoppedReason: STOP.AUTO_TYPING });
  });

  it("a send that does not show up in the thread is recorded 'to check' and stops the session", async () => {
    const items = [queueItem(1), queueItem(2)];
    const { ctx, page, driver, sdr } = autoHarness({ items, keys: ["timeout"], driver: { confirm: false } });
    const result = await runSendSession(ctx, { items, max: 10 });

    expect(page.sent).toEqual([items[0].body]);
    expect(sdr.callsTo("recordSocialDmSent")).toEqual([expect.objectContaining({ outreachId: "out_1", verified: false, auto: true })]);
    expect(opened(driver)).toHaveLength(1);
    expect(result).toMatchObject({ sent: 1, unverified: 1, stoppedReason: STOP.AUTO_UNVERIFIED });
  });

  it("a blocker page right before the send stops the session with nothing sent and is reported", async () => {
    const items = [queueItem(1), queueItem(2)];
    const blocker = { kind: "checkpoint", detail: "challenge" };
    const { ctx, page, sdr } = autoHarness({ items, keys: ["timeout"], driver: { blockers: [blocker] } });
    const result = await runSendSession(ctx, { items, max: 10 });
    expect(page.sent).toEqual([]);
    expect(sdr.callsTo("reportSessionBlocked")).toHaveLength(1);
    expect(result).toMatchObject({ sent: 0, stoppedReason: "blocked:checkpoint" });
  });

  it("the daily cap stops it like any session", async () => {
    const items = [queueItem(1), queueItem(2)];
    const { ctx, page } = autoHarness({ items, keys: ["timeout"], sdr: { reserveSendSlot: () => ({ ok: false, reason: "daily_cap", used: 30, cap: 30 }) } });
    const result = await runSendSession(ctx, { items, max: 10 });
    expect(page.sent).toEqual([]);
    expect(result.stoppedReason).toBe(STOP.DAILY_CAP);
  });

  it("the contact gate still decides per prospect: a refused one is passed over, the next is sent", async () => {
    const items = [queueItem(1), queueItem(2)];
    const { ctx, page, driver } = autoHarness({
      items,
      keys: ["timeout"],
      sdr: {
        checkBeforeSend: ({ outreachId }) =>
          outreachId === "out_1" ? { allowed: false, reason: "suppressed: opt-out" } : { allowed: true, review: reviewOf(items[1]) }
      }
    });
    const result = await runSendSession(ctx, { items, max: 10 });
    expect(opened(driver)).toEqual([items[1].profile.url]);
    expect(page.sent).toEqual([items[1].body]);
    expect(result).toMatchObject({ sent: 1, refused: 1 });
  });
});

describe("automatic session — never a second copy of a first message", () => {
  const items = [queueItem(1), queueItem(2)];

  it("Enter typed in the browser during the countdown, bubble not drawn yet: nothing is typed again, it is recorded 'to check', the session stops", async () => {
    const h = autoHarness({ items, keys: [], driver: { confirm: false } });
    h.keys.remaining.push({ key: "timeout", before: () => h.page.browserKey("Enter") });
    const result = await runSendSession(h.ctx, { items, max: 10 });

    // One copy left — the one from the browser — and the runner sent nothing on top of it.
    expect(h.page.sent).toEqual([items[0].body]);
    expect(runnerSends(h.timeline)).toEqual([]);
    expect(typedLines(h.timeline)).toHaveLength(3);
    expect(prompts(h.timeline)).toHaveLength(1);
    // Recorded as possibly sent: the SDR's one-first-message lock now covers this prospect.
    expect(h.sdr.callsTo("recordSocialDmSent")).toEqual([expect.objectContaining({ outreachId: "out_1", verified: false })]);
    // A person's key sent it, not the session.
    expect(h.sdr.callsTo("recordSocialDmSent")[0]).not.toHaveProperty("auto");
    expect(h.journal.pending()).toEqual([]);
    expect(opened(h.driver)).toHaveLength(1);
    expect(result).toMatchObject({ sent: 1, unverified: 1, stoppedReason: STOP.AUTO_UNVERIFIED });
  });

  it("Enter typed in the browser, bubble visible: recorded once as sent by a person, nothing sent again, the session goes on", async () => {
    const h = autoHarness({ items, keys: [] });
    h.keys.remaining.push({ key: "timeout", before: () => h.page.browserKey("Enter") }, "timeout");
    const result = await runSendSession(h.ctx, { items, max: 10 });

    expect(h.page.sent).toEqual([items[0].body, items[1].body]);
    expect(runnerSends(h.timeline).map((event) => event.text)).toEqual([items[1].body]);
    const records = h.sdr.callsTo("recordSocialDmSent");
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ outreachId: "out_1", verified: true });
    expect(records[0]).not.toHaveProperty("auto");
    expect(records[1]).toMatchObject({ outreachId: "out_2", verified: true, auto: true });
    expect(result).toMatchObject({ sent: 2, unverified: 0 });
  });

  it("Enter typed in the browser, then S (or Q) in the terminal: the message that left is still recorded — skipping must not put it back in the queue", async () => {
    for (const key of ["s", "q"]) {
      const h = autoHarness({ items, keys: [], driver: { confirm: false } });
      h.keys.remaining.push({ key, before: () => h.page.browserKey("Enter") });
      const result = await runSendSession(h.ctx, { items, max: 10 });

      expect(h.page.sent).toEqual([items[0].body]);
      expect(h.sdr.callsTo("recordSocialDmSent")).toEqual([expect.objectContaining({ outreachId: "out_1", verified: false })]);
      expect(h.sdr.callsTo("recordSocialDmSkipped")).toEqual([]);
      expect(opened(h.driver)).toHaveLength(1);
      expect(result).toMatchObject({ sent: 1, unverified: 1, stoppedReason: STOP.AUTO_UNVERIFIED });
    }
  });

  it("the chat window closes during the countdown and nothing shows the text: recorded 'to check' — no later session can send it again", async () => {
    const h = autoHarness({ items, keys: [], driver: { confirm: false } });
    h.keys.remaining.push({
      key: "timeout",
      before: () => {
        h.page.composers.at(-1).isAttached = false;
      }
    });
    const result = await runSendSession(h.ctx, { items, max: 10 });

    expect(runnerSends(h.timeline)).toEqual([]);
    expect(h.sdr.callsTo("recordSocialDmSent")).toEqual([expect.objectContaining({ outreachId: "out_1", verified: false })]);
    expect(opened(h.driver)).toHaveLength(1);
    expect(result).toMatchObject({ sent: 1, unverified: 1, stoppedReason: STOP.AUTO_UNVERIFIED });
  });

  it("the chat window closes at the very last look before the send: still recorded 'to check', never left as a plain draft", async () => {
    const h = autoHarness({ items, keys: ["timeout"], driver: { confirm: false } });
    const checkBlocker = h.driver.checkBlocker.bind(h.driver);
    // The page check is the last thing before the composer is read one more time.
    h.driver.checkBlocker = async (page) => {
      h.page.composers.at(-1).isAttached = false;
      return checkBlocker(page);
    };
    const result = await runSendSession(h.ctx, { items, max: 10 });
    expect(runnerSends(h.timeline)).toEqual([]);
    expect(h.sdr.callsTo("recordSocialDmSent")).toEqual([expect.objectContaining({ outreachId: "out_1", verified: false })]);
    expect(result).toMatchObject({ sent: 1, unverified: 1, stoppedReason: STOP.AUTO_UNVERIFIED });
  });

  it("a checkpoint replaces the page during the countdown: nothing left, so nothing is recorded as sent — the session stops as blocked and says so to the SDR", async () => {
    for (const key of ["timeout", "q"]) {
      const blocker = { kind: "checkpoint", detail: "challenge" };
      const h = autoHarness({ items, keys: [], driver: { confirm: false, blockers: [blocker] } });
      h.keys.remaining.push({
        key,
        before: () => {
          h.page.composers.at(-1).isAttached = false;
        }
      });
      const result = await runSendSession(h.ctx, { items, max: 10 });

      expect(h.page.sent).toEqual([]);
      expect(h.sdr.callsTo("recordSocialDmSent"), key).toEqual([]);
      expect(h.sdr.callsTo("reserveSendSlot")).toEqual([]);
      // Reported: this is what arms the 48 h rule.
      expect(h.sdr.callsTo("reportSessionBlocked")).toEqual([expect.objectContaining({ reason: "checkpoint", network: "instagram" })]);
      expect(result).toMatchObject({ sent: 0, stoppedReason: "blocked:checkpoint" });
    }
  });

  it("the page rebuilds the composer and the new one still holds the text: nothing left — not recorded, emptied, the session stops", async () => {
    const h = autoHarness({ items, keys: [], driver: { confirm: false } });
    let rebuilt;
    h.keys.remaining.push({
      key: "timeout",
      before: () => {
        const old = h.page.composers.at(-1);
        old.isAttached = false;
        // What the page did: a fresh element, same text, same conversation.
        rebuilt = { ...old, isAttached: true, text: old.text };
        rebuilt.innerText = async () => rebuilt.text;
        rebuilt.attached = async () => true;
        rebuilt.click = async () => {
          h.page.focused = rebuilt;
        };
        rebuilt.blur = async () => undefined;
        rebuilt.receiveKey = (pressed) => {
          if (pressed === "ControlOrMeta+A") rebuilt.selectedAll = true;
          else if (pressed === "Backspace") rebuilt.text = rebuilt.selectedAll ? "" : rebuilt.text.slice(0, -1);
        };
        h.page.composers.push(rebuilt);
      }
    });
    const result = await runSendSession(h.ctx, { items, max: 10 });

    expect(h.page.sent).toEqual([]);
    expect(h.sdr.callsTo("recordSocialDmSent")).toEqual([]);
    expect(rebuilt.text).toBe("");
    expect(opened(h.driver)).toHaveLength(1);
    expect(result).toMatchObject({ sent: 0, unverified: 0, stoppedReason: STOP.AUTO_TYPING });
  });

  it("other text appears in the composer during the countdown: nothing is sent, nothing is typed again, the session stops", async () => {
    const h = autoHarness({ items, keys: [] });
    h.keys.remaining.push({
      key: "timeout",
      before: () => {
        h.page.composers.at(-1).text += " — ajout";
      }
    });
    const result = await runSendSession(h.ctx, { items, max: 10 });

    expect(h.page.sent).toEqual([]);
    expect(h.page.composers[0].text).toBe("");
    expect(typedLines(h.timeline)).toHaveLength(3);
    expect(prompts(h.timeline)).toHaveLength(1);
    expect(h.sdr.callsTo("recordSocialDmSent")).toEqual([]);
    expect(opened(h.driver)).toHaveLength(1);
    expect(result).toMatchObject({ sent: 0, stoppedReason: STOP.AUTO_TYPING });
  });
});

describe("automatic session — the wait between two DMs does not make the checks stale", () => {
  const items = [queueItem(1), queueItem(2)];
  /** First answer "too soon", then a slot: every message after the first lives this in a real session. */
  const spacingThenOk = () => {
    let calls = 0;
    return () => ((calls += 1) === 1 ? { ok: false, reason: "spacing", retryInSeconds: 40, used: 1, cap: 30 } : { ok: true, used: 2, cap: 30 });
  };

  it("the SDR is paused during the wait: the message does not leave", async () => {
    let asked = 0;
    const h = autoHarness({
      items,
      // Countdown, then the spacing wait runs out.
      keys: ["timeout", "timeout"],
      sdr: {
        reserveSendSlot: spacingThenOk(),
        // 1 before the prospect, 2 at the gate, 3 after the wait.
        checkAutoSend: () => ((asked += 1) < 3 ? { allowed: true } : { allowed: false, reason: "automation_paused" })
      }
    });
    const result = await runSendSession(h.ctx, { items, max: 10 });
    expect(h.page.sent).toEqual([]);
    expect(h.page.composers[0].text).toBe("");
    expect(opened(h.driver)).toHaveLength(1);
    expect(result).toMatchObject({ sent: 0, stoppedReason: `${STOP.AUTO_REFUSED}:automation_paused` });
  });

  it("the prospect opts out during the wait: the message does not leave", async () => {
    let gate = 0;
    const h = autoHarness({
      items,
      keys: ["timeout", "timeout", "s"],
      sdr: {
        reserveSendSlot: spacingThenOk(),
        // For out_1: 1 before opening, 2 at the gate, 3 after the wait.
        checkBeforeSend: ({ outreachId }) =>
          outreachId === "out_1" && (gate += 1) >= 3 ? { allowed: false, reason: "suppressed: opt-out" } : { allowed: true, review: reviewOf(queueItem(1)) }
      }
    });
    const result = await runSendSession(h.ctx, { items, max: 10 });
    expect(h.page.sent).toEqual([]);
    expect(h.page.composers[0].text).toBe("");
    expect(result).toMatchObject({ sent: 0, refused: 1 });
  });

  it("nothing changed during the wait: the message leaves, after the gate was asked again", async () => {
    const h = autoHarness({ items: [items[0]], keys: ["timeout", "timeout"], sdr: { reserveSendSlot: spacingThenOk() } });
    const result = await runSendSession(h.ctx, { items: [items[0]], max: 10 });
    expect(h.page.sent).toEqual([items[0].body]);
    assertEverySendFollowsItsCountdown(h.timeline);
    const order = h.timeline.map((event) => event.type);
    const waitEnd = h.timeline.map((event) => event.type === "key" && event.key === "timeout").lastIndexOf(true);
    const afterWait = order.slice(waitEnd, order.indexOf("send"));
    expect(afterWait).toContain("sdr.checkAutoSend");
    expect(afterWait).toContain("sdr.checkBeforeSend");
    expect(result).toMatchObject({ sent: 1 });
  });
});

describe("automatic session — a first message only goes into a conversation that holds nothing", () => {
  const items = [queueItem(1), queueItem(2)];
  const leftForPerson = (sdr) => sdr.callsTo("recordSocialDmAutoHeld");

  it("a conversation already started is not written into: nothing typed, the draft is left to a person (not parked), the next prospect is handled", async () => {
    const h = autoHarness({ items, keys: ["timeout"], driver: { threadStates: { [items[0].profile.url]: "has_content" } } });
    const result = await runSendSession(h.ctx, { items, max: 10 });

    expect(h.page.sent).toEqual([items[1].body]);
    expect(typedLines(h.timeline).map((event) => event.text).join("\n")).not.toContain("Boutique 1");
    expect(leftForPerson(h.sdr)).toEqual([{ outreachId: "out_1", network: "instagram", reason: "thread_not_empty:scripted", sessionId: "sess_1" }]);
    // Not "skipped": it must stay in the queue of a session with keys, where the person sees the thread.
    expect(h.sdr.callsTo("recordSocialDmSkipped")).toEqual([]);
    expect(result).toMatchObject({ sent: 1, held: 1, skipped: 0 });
  });

  it("a conversation that cannot be checked is treated the same — and a network without the check sends nothing at all", async () => {
    const unknown = autoHarness({ items, keys: ["timeout"], driver: { threadStates: { [items[0].profile.url]: "unknown" } } });
    await runSendSession(unknown.ctx, { items, max: 10 });
    expect(unknown.page.sent).toEqual([items[1].body]);
    expect(leftForPerson(unknown.sdr)).toHaveLength(1);

    const without = autoHarness({ items, keys: [], driver: { threadCheck: false } });
    const result = await runSendSession(without.ctx, { items, max: 10 });
    expect(without.page.sent).toEqual([]);
    expect(typedLines(without.timeline)).toEqual([]);
    expect(result).toMatchObject({ sent: 0, held: 2 });
  });

  it("three in a row that are 'not new or not checkable' is the check not recognising the window: the session stops, the third draft is left as it was", async () => {
    const many = [queueItem(1), queueItem(2), queueItem(3), queueItem(4), queueItem(5)];
    const h = autoHarness({ items: many, keys: [], driver: { threadStates: Object.fromEntries(many.map((item) => [item.profile.url, "unknown"])) } });
    const result = await runSendSession(h.ctx, { items: many, max: 10 });

    expect(h.page.sent).toEqual([]);
    expect(typedLines(h.timeline)).toEqual([]);
    expect(opened(h.driver)).toHaveLength(3);
    expect(leftForPerson(h.sdr).map((call) => call.outreachId)).toEqual(["out_1", "out_2"]);
    // Two left to a person; the third stops the session and is counted nowhere: it stays as it was.
    expect(result).toMatchObject({ sent: 0, held: 2, stoppedReason: STOP.AUTO_THREAD_CHECK });
  });

  it("a new conversation in between resets that count: scattered started conversations do not stop the session", async () => {
    const many = [queueItem(1), queueItem(2), queueItem(3), queueItem(4), queueItem(5)];
    const started = (n) => [many[n].profile.url, "has_content"];
    const h = autoHarness({ items: many, keys: ["timeout"], driver: { threadStates: Object.fromEntries([started(0), started(1), started(3), started(4)]) } });
    const result = await runSendSession(h.ctx, { items: many, max: 10 });
    expect(h.page.sent).toEqual([many[2].body]);
    expect(leftForPerson(h.sdr)).toHaveLength(4);
    expect(result.stoppedReason).toBeUndefined();
  });

  it("its history shows up during the countdown: nothing is sent, the draft is left to a person, the session stops", async () => {
    const h = autoHarness({
      items,
      keys: ["timeout"],
      // New when opened; not any more when looked at again right before the send.
      driver: { threadStates: { [items[0].profile.url]: ({ calls }) => (calls === 1 ? "empty" : "has_content") } }
    });
    const result = await runSendSession(h.ctx, { items, max: 10 });

    expect(h.page.sent).toEqual([]);
    expect(h.page.composers[0].text).toBe("");
    expect(h.sdr.callsTo("recordSocialDmSent")).toEqual([]);
    expect(leftForPerson(h.sdr)).toEqual([expect.objectContaining({ outreachId: "out_1", reason: "thread_not_empty:scripted" })]);
    expect(h.sdr.callsTo("recordSocialDmSkipped")).toEqual([]);
    expect(opened(h.driver)).toHaveLength(1);
    expect(result).toMatchObject({ sent: 0, stoppedReason: STOP.AUTO_THREAD_CHECK });
  });

  it("a check that cannot see the message that just left proved nothing: the session stops after that one send", async () => {
    const h = autoHarness({ items, keys: ["timeout"], driver: { threadCheck: "blind" } });
    const result = await runSendSession(h.ctx, { items, max: 10 });

    expect(h.page.sent).toEqual([items[0].body]);
    expect(h.sdr.callsTo("recordSocialDmSent")).toEqual([expect.objectContaining({ outreachId: "out_1", verified: true, auto: true })]);
    expect(opened(h.driver)).toHaveLength(1);
    expect(result).toMatchObject({ sent: 1, unverified: 0, stoppedReason: STOP.AUTO_THREAD_CHECK });
  });
});

describe("automatic session — held drafts do not hide a changed interface", () => {
  it("three prospects without a 'Message' button stop the session even when held drafts sit between them", async () => {
    const items = [];
    const profiles = {};
    for (let n = 1; n <= 8; n += 1) {
      const held = n % 2 === 0;
      const item = queueItem(n, held ? { pricingGuardrailPassed: false } : {});
      items.push(item);
      if (!held) profiles[item.profile.url] = "no_message_button";
    }
    const { ctx, page, driver, sdr } = autoHarness({ items, keys: [], driver: { profiles } });
    const result = await runSendSession(ctx, { items, max: 10 });

    expect(page.sent).toEqual([]);
    expect(opened(driver)).toHaveLength(3);
    // The third one stops the session and stays in the queue.
    expect(sdr.callsTo("recordSocialDmSkipped")).toHaveLength(2);
    expect(result).toMatchObject({ sent: 0, held: 2, stoppedReason: STOP.SELECTOR_DRIFT });
  });
});

describe("automatic session — the SDR's switch", () => {
  const items = [queueItem(1), queueItem(2)];

  it("refused before a prospect (paused, safe mode, recent block, unreviewed doubt): the session stops, no page is opened", async () => {
    const { ctx, page, driver } = autoHarness({ items, keys: [], sdr: { checkAutoSend: () => ({ allowed: false, reason: "automation_paused" }) } });
    const result = await runSendSession(ctx, { items, max: 10 });
    expect(opened(driver)).toEqual([]);
    expect(page.sent).toEqual([]);
    expect(result).toMatchObject({ sent: 0, stoppedReason: `${STOP.AUTO_REFUSED}:automation_paused` });
  });

  it("paused DURING the countdown: that message does not leave, the composer is emptied, the session stops", async () => {
    let calls = 0;
    const { ctx, page, driver, sdr } = autoHarness({
      items,
      keys: ["timeout"],
      sdr: { checkAutoSend: () => ((calls += 1) === 1 ? { allowed: true } : { allowed: false, reason: "automation_paused" }) }
    });
    const result = await runSendSession(ctx, { items, max: 10 });
    expect(page.sent).toEqual([]);
    expect(page.composers[0].text).toBe("");
    expect(sdr.callsTo("reserveSendSlot")).toEqual([]);
    expect(opened(driver)).toHaveLength(1);
    expect(result).toMatchObject({ sent: 0, refused: 0, stoppedReason: `${STOP.AUTO_REFUSED}:automation_paused` });
  });
});

describe("automatic session — whatever happens around it (sweep)", () => {
  /**
   * Keys chosen at random among those offered, plus "the timer ran out" — and,
   * now and then, what a person or the world does meanwhile: Enter typed in
   * the browser window, the chat window closing, a Ctrl+C that arrives between
   * two prompts or in the middle of a call to the SDR.
   */
  function chaos(h, seed) {
    let state = seed >>> 0 || 1;
    const random = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 4294967296;
    };
    let interrupted = false;
    const events = { browserEnters: 0, interrupts: 0, detaches: 0 };
    const interrupt = () => {
      if (interrupted) return;
      events.interrupts += 1;
      interrupted = true;
      h.timeline.push({ type: "interrupt" });
    };
    h.ctx.keys = {
      isInterrupted: () => interrupted,
      async prompt(choices, options = {}) {
        h.timeline.push({ type: "prompt", choices: [...choices], timeoutMs: options.timeoutMs });
        if (interrupted) {
          h.timeline.push({ type: "key", key: "q" });
          return "q";
        }
        const roll = random();
        if (roll < 0.1 && h.page.composers.length) {
          events.browserEnters += 1;
          h.page.browserKey("Enter");
        } else if (roll < 0.16 && h.page.composers.length) {
          events.detaches += 1;
          h.page.composers.at(-1).isAttached = false;
        }
        const pool = options.timeoutMs ? [...choices, "timeout", "timeout", "timeout"] : choices;
        const key = pool[Math.floor(random() * pool.length)];
        h.timeline.push({ type: "key", key });
        // A Ctrl+C that lands right after the prompt answered: no prompt is open to take it.
        if (roll > 0.92) interrupt();
        return key;
      },
      async readLine() {
        return null;
      }
    };
    return { events, interrupt, random };
  }

  it("no text leaves twice, no runner send without its countdown, none after a stop request, none for a held draft, none into a started conversation", async () => {
    const totals = { runnerSends: 0, browserEnters: 0, interrupts: 0, detaches: 0, spacingSends: 0, blockers: 0, midCallInterrupts: 0 };
    for (let seed = 1; seed <= 400; seed += 1) {
      const items = [
        queueItem(1),
        queueItem(2, { pricingGuardrailPassed: false }),
        queueItem(3),
        queueItem(4, { riskWarnings: ["question absente"] }),
        queueItem(5),
        queueItem(6)
      ];
      let reserves = 0;
      const spacingSeed = seed % 4 === 0;
      const blockerSeed = seed % 11 === 0;
      let world;
      const h = autoHarness({
        items,
        driver: {
          // Sometimes the bubble is not drawn in time; sometimes Meta puts up a page; one prospect was already written to.
          ...(seed % 9 === 0 ? { confirm: false } : {}),
          ...(blockerSeed ? { blockers: [null, null, null, { kind: "rate_limited", detail: "try_later" }] } : {}),
          threadStates: seed % 7 === 0 ? { [items[4].profile.url]: "has_content" } : {}
        },
        sdr: {
          // In a real session every message after the first waits for the spacing, then gets its slot.
          reserveSendSlot: () => {
            // A Ctrl+C in the middle of a call to the SDR, after the countdown ended.
            if (seed % 13 === 0 && reserves === 0) {
              totals.midCallInterrupts += 1;
              world.interrupt();
            }
            return (reserves += 1) % 2 === 1 && spacingSeed ? { ok: false, reason: "spacing", retryInSeconds: 2, used: 3, cap: 30 } : { ok: true, used: 3, cap: 30 };
          }
        }
      });
      world = chaos(h, seed);
      const result = await runSendSession(h.ctx, { items, max: 10 });

      assertEverySendFollowsItsCountdown(h.timeline);
      // Never two copies of one text, whoever sent them.
      expect(new Set(h.page.sent).size, `seed ${seed}`).toBe(h.page.sent.length);
      const sentByRunner = runnerSends(h.timeline).map((event) => event.text);
      // A draft a person must read never leaves by the runner; nor does a first message into a started conversation.
      expect(sentByRunner).not.toContain(items[1].body);
      expect(sentByRunner).not.toContain(items[3].body);
      if (seed % 7 === 0) expect(sentByRunner, `seed ${seed}`).not.toContain(items[4].body);
      // Nothing the runner sends comes after a stop request.
      const stopAt = h.timeline.findIndex((event) => event.type === "interrupt");
      if (stopAt >= 0) expect(h.timeline.slice(stopAt).some((event, offset) => isRunnerSend(h.timeline, stopAt + offset)), `seed ${seed}`).toBe(false);
      // Every text that left is recorded, exactly once; "seen in the thread" and "automatic" are only said of what is true.
      const records = h.sdr.callsTo("recordSocialDmSent");
      const recorded = records.map((call) => call.finalBody);
      expect(new Set(recorded).size, `seed ${seed}`).toBe(recorded.length);
      for (const text of h.page.sent) expect(recorded, `seed ${seed}`).toContain(text);
      for (const record of records.filter((call) => call.verified)) expect(h.page.sent, `seed ${seed}`).toContain(record.finalBody);
      for (const record of records.filter((call) => call.auto)) expect(sentByRunner, `seed ${seed}`).toContain(record.finalBody);
      expect(result.sent, `seed ${seed}`).toBe(recorded.length);
      // A blocker that showed up ended the session and was reported.
      if (String(result.stoppedReason).startsWith("blocked:")) {
        totals.blockers += 1;
        expect(h.sdr.callsTo("reportSessionBlocked")).toHaveLength(1);
      }

      totals.runnerSends += sentByRunner.length;
      totals.browserEnters += world.events.browserEnters;
      totals.interrupts += world.events.interrupts;
      totals.detaches += world.events.detaches;
      if (spacingSeed) totals.spacingSends += sentByRunner.length;
    }
    // The sweep is not vacuous: it sent, through the spacing wait too, and it was disturbed in every way.
    expect(totals.runnerSends).toBeGreaterThan(200);
    expect(totals.spacingSends).toBeGreaterThan(20);
    expect(totals.browserEnters).toBeGreaterThan(40);
    expect(totals.detaches).toBeGreaterThan(20);
    expect(totals.interrupts).toBeGreaterThan(40);
    expect(totals.midCallInterrupts).toBeGreaterThan(10);
    expect(totals.blockers).toBeGreaterThan(5);
  });
});

describe("contract with the SDR's doubt rule", () => {
  it("every stop that means 'a person must look' is one the server recognises (same names on both sides)", () => {
    const server = readFileSync(new URL("../../functions/src/services/social/social-session-service.ts", import.meta.url), "utf8");
    const literal = server.match(/export const AUTO_DOUBT_STOP = \/(.+)\/;/);
    expect(literal, "AUTO_DOUBT_STOP not found in the session service").not.toBeNull();
    const doubt = new RegExp(literal[1]);
    for (const reason of [STOP.AUTO_UNVERIFIED, STOP.AUTO_TYPING, STOP.AUTO_THREAD_CHECK, STOP.ERROR, STOP.RECORD_FAILED, STOP.COMPOSER_LOST]) {
      expect(doubt.test(reason), reason).toBe(true);
    }
    // Ordinary endings are not doubts.
    for (const reason of [STOP.OPERATOR, STOP.DAILY_CAP, STOP.SPACING, STOP.SELECTOR_DRIFT, `${STOP.AUTO_REFUSED}:automation_paused`, "blocked:checkpoint"]) {
      expect(doubt.test(reason), reason).toBe(false);
    }
  });

  it("the session names itself when it asks the SDR, so it is not taken for one that never ended", async () => {
    const items = [queueItem(1)];
    const { ctx, sdr } = autoHarness({ items, keys: ["timeout"] });
    await runSendSession(ctx, { items, max: 1 });
    for (const input of sdr.callsTo("checkAutoSend")) expect(input).toEqual({ workspaceId: "ws_default", businessId: "biz_test", network: "instagram", sessionId: "sess_1" });
  });
});

describe("automatic mode is opt-in, and only for first DMs", () => {
  it("a session without --auto never asks about automatic sending, never times out into a send, records no automatic mark", async () => {
    const { ctx, timeline, page, sdr } = harness({ keys: ["enter", "s"] });
    await runSendSession(ctx, { items: [queueItem(1), queueItem(2)], max: 10 });
    expect(sdr.callsTo("checkAutoSend")).toEqual([]);
    for (const input of sdr.callsTo("checkBeforeSend")) expect(input).not.toHaveProperty("forAutoSend");
    expect(page.sent).toHaveLength(1);
    expect(sdr.callsTo("recordSocialDmSent")[0]).not.toHaveProperty("auto");
    expect(sdr.callsTo("recordSocialDmAutoHeld")).toEqual([]);
    for (const prompt of prompts(timeline)) expect(prompt.timeoutMs).toBeUndefined();
  });

  it("with keys, the 'is this conversation new?' look is shown as information only: it never sends, skips, holds or stops", async () => {
    const items = [queueItem(1), queueItem(2), queueItem(3)];
    const { ctx, timeline, page, sdr, ui, driver } = harness({
      keys: ["enter", "enter", "s"],
      driver: {
        threadStates: {
          // Looks started from the opening; looks started only once the text is typed; cannot be read at all.
          [items[0].profile.url]: "has_content",
          [items[1].profile.url]: ({ typed }) => (typed ? "has_content" : "empty"),
          [items[2].profile.url]: "unknown"
        }
      }
    });
    const result = await runSendSession(ctx, { items, max: 10 });

    // The person pressed Enter twice and S once: exactly that happened.
    expect(page.sent).toEqual([items[0].body, items[1].body]);
    expect(result).toMatchObject({ sent: 2, skipped: 1, held: 0 });
    expect(result.stoppedReason).toBeUndefined();
    expect(sdr.callsTo("recordSocialDmAutoHeld")).toEqual([]);
    // Looked at before typing and once the text is typed, for each conversation.
    expect(timeline.filter((event) => event.type === "driver.threadState").map((event) => event.typed)).toEqual([false, true, false, true, false, true]);
    const said = ui.shown.filter((entry) => ["info", "warn"].includes(entry.call)).map((entry) => String(entry.args[0]));
    expect(said.filter((line) => line.startsWith("Vérification (information)"))).toHaveLength(6);
    expect(said.some((line) => /n'est pas reconnue comme vierge/.test(line))).toBe(true);

    // A check that throws changes nothing either.
    const broken = harness({ keys: ["enter"] });
    broken.driver.threadState = async () => {
      throw new Error("page gone");
    };
    await runSendSession(broken.ctx, { items: [queueItem(1)], max: 10 });
    expect(broken.page.sent).toHaveLength(1);
    expect(driver.calls.length).toBeGreaterThan(0);
  });

  it("composeAndSend ignores an automatic session unless the caller asked for it: a reply always waits for Enter", async () => {
    const { ctx, timeline, page } = autoHarness({ keys: ["s"] });
    const conversation = await ctx.driver.openConversation(page, queueItem(1).profile);
    // The spec the inbox flow builds has no `auto`: ctx.auto alone changes nothing.
    const result = await composeAndSend(ctx, {
      composer: conversation.composer,
      text: "Bonjour, merci pour votre réponse.",
      review: { pricingGuardrailPassed: true, warnings: [], autoSend: { allowed: true } },
      checkGate: async () => ({ allowed: true }),
      record: async () => undefined
    });
    expect(result).toEqual({ outcome: "skipped", reason: "operator_skip" });
    expect(prompts(timeline)[0]).toMatchObject({ choices: expect.arrayContaining(["enter"]) });
    expect(prompts(timeline)[0].timeoutMs).toBeUndefined();
    expect(page.sent).toEqual([]);
  });

  it("source guards: the inbox never builds an automatic spec; the CLI gives `auto` to send sessions only and refuses a network without the thread check", () => {
    const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
    expect(read("../src/inbox-flow.mjs")).not.toMatch(/\bauto\b/);
    const cli = read("../bin/run.mjs");
    expect(cli).toContain('args.command === "send" && args.auto ? { auto: args.auto } : {}');
    expect(cli).toContain('if (typeof driver.threadState !== "function") {');
    // The session machine never imitates a person: no randomness anywhere in the runner's sources.
    for (const file of ["../src/session-machine.mjs", "../src/rehearsal.mjs", "../src/composer.mjs", "../src/drivers/web-dm-driver.mjs", "../src/drivers/common.mjs"]) {
      expect(read(file), file).not.toMatch(/Math\.random|randomInt|crypto\.random/);
    }
  });
});

describe("command line", () => {
  const base = ["--business", "biz_x", "--network", "instagram"];

  it("--auto is a send option with a 10 s countdown by default; --veto sets it", () => {
    expect(parseArgs(["send", ...base, "--auto"]).auto).toEqual({ vetoSeconds: 10 });
    expect(parseArgs(["send", ...base, "--auto", "--veto", "30", "--max", "5"])).toMatchObject({ auto: { vetoSeconds: 30 }, max: 5 });
    expect(parseArgs(["send", ...base])).not.toHaveProperty("auto");
  });

  it("refuses --auto outside send, --veto without --auto, and a countdown too short to read", () => {
    expect(() => parseArgs(["inbox", ...base, "--auto"])).toThrow(/--auto ne s'utilise qu'avec send/);
    expect(() => parseArgs(["rehearse", ...base, "--auto"])).toThrow(/--auto/);
    expect(() => parseArgs(["send", ...base, "--veto", "20"])).toThrow(/--veto ne s'utilise qu'avec send --auto/);
    for (const bad of ["0", "4", "301", "2.5", "abc"]) expect(() => parseArgs(["send", ...base, "--auto", "--veto", bad])).toThrow(/--veto/);
    expect(() => parseArgs(["send", ...base, "--auto=yes"])).toThrow(/ne prend pas de valeur/);
  });
});
