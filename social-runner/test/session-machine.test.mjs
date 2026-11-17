import { describe, expect, it } from "vitest";
import { fromEditLine, runSendSession, STOP, toEditLine } from "../src/session-machine.mjs";
import { assertEverySendFollowsItsEnter, harness, isRunnerSend, queueItem, randomKeys } from "./helpers.mjs";

const sends = (timeline) => timeline.filter((event) => event.type === "send");
const runnerSends = (timeline) => timeline.filter((event, index) => isRunnerSend(timeline, index));

describe("send session — the Enter invariant", () => {
  it("sends nothing when the operator never presses Enter", async () => {
    const { ctx, timeline, page, sdr } = harness({ keys: ["s", "s", "q"] });
    const items = [queueItem(1), queueItem(2), queueItem(3)];
    const result = await runSendSession(ctx, { items, max: 10 });

    expect(sends(timeline)).toEqual([]);
    expect(page.sent).toEqual([]);
    expect(sdr.callsTo("reserveSendSlot")).toEqual([]);
    expect(sdr.callsTo("recordSocialDmSent")).toEqual([]);
    expect(result).toMatchObject({ sent: 0, skipped: 2, stoppedReason: STOP.OPERATOR });
  });

  it("sends exactly the item whose prompt got Enter, with the text shown", async () => {
    const { ctx, timeline, page, sdr } = harness({ keys: ["s", "enter", "s"] });
    const items = [queueItem(1), queueItem(2), queueItem(3)];
    const result = await runSendSession(ctx, { items, max: 10 });

    expect(page.sent).toEqual([items[1].body]);
    assertEverySendFollowsItsEnter(timeline);
    expect(sdr.callsTo("recordSocialDmSent")).toEqual([
      expect.objectContaining({
        outreachId: "out_2",
        network: "instagram",
        profile: items[1].profile,
        finalBody: items[1].body,
        edited: false,
        verified: true,
        threadUrl: "https://www.instagram.com/direct/t/boutique2/",
        sessionId: "sess_1",
        operator: "tester"
      })
    ]);
    expect(result).toMatchObject({ sent: 1, skipped: 2, unverified: 0 });
  });

  it("the invariant check itself catches a send without Enter", async () => {
    const { ctx, timeline, page } = harness({ keys: [] });
    const opened = await ctx.driver.openConversation(page, queueItem(1).profile);
    await opened.composer.click();
    await page.keyboard.insertText("Bonjour");
    await opened.composer.press("Enter");
    expect(() => assertEverySendFollowsItsEnter(timeline)).toThrow(/Send without an Enter/);
  });

  it("holds over random key sequences: every runner send follows an Enter for that message", async () => {
    let totalSends = 0;
    let totalPrompts = 0;
    for (let seed = 1; seed <= 150; seed += 1) {
      const { ctx, timeline, sdr } = harness({
        keySource: (tl) => randomKeys(tl, seed, ["Texte modifié\\npar l'opérateur", "Autre version"]),
        sdr: {
          // Some refusals so the sweep also walks those paths.
          reserveSendSlot: () => (seed % 7 === 0 ? { ok: false, reason: "spacing", retryInSeconds: 2, used: 3, cap: 30 } : { ok: true, used: 3, cap: 30 })
        }
      });
      const items = [queueItem(1), queueItem(2), queueItem(3, { pricingGuardrailPassed: false })];
      await runSendSession(ctx, { items, max: 10 });
      assertEverySendFollowsItsEnter(timeline);
      expect(sdr.callsTo("recordSocialDmSent").length).toBe(runnerSends(timeline).length);
      // The text recorded is the text that left.
      const sentTexts = runnerSends(timeline).map((event) => event.text);
      expect(sdr.callsTo("recordSocialDmSent").map((call) => call.finalBody)).toEqual(sentTexts);
      totalSends += sentTexts.length;
      totalPrompts += timeline.filter((event) => event.type === "prompt").length;
    }
    // The sweep is not vacuous: it sent, and it declined, many times.
    expect(totalSends).toBeGreaterThan(30);
    expect(totalPrompts).toBeGreaterThan(totalSends * 2);
  });

  it("never types a line break as a key: the composer receives Shift+Enter between lines", async () => {
    const { ctx, timeline } = harness({ keys: ["s"] });
    await runSendSession(ctx, { items: [queueItem(1)], max: 1 });
    const inserted = timeline.filter((event) => event.type === "keyboard.insertText");
    expect(inserted.length).toBe(3);
    for (const event of inserted) expect(event.text).not.toMatch(/[\r\n]/);
    expect(timeline.filter((event) => event.type === "keyboard.press").map((event) => event.key)).toEqual([
      "Shift+Enter",
      "Shift+Enter",
      // S: the composer is emptied before moving on.
      "ControlOrMeta+A",
      "Backspace"
    ]);
  });
});

describe("send session — operator choices", () => {
  it("S skips: recorded as skipped, composer emptied, nothing sent", async () => {
    const { ctx, page, sdr } = harness({ keys: ["s"] });
    const result = await runSendSession(ctx, { items: [queueItem(1)], max: 5 });
    expect(page.sent).toEqual([]);
    expect(page.focused.text).toBe("");
    expect(sdr.callsTo("recordSocialDmSkipped")).toEqual([
      { outreachId: "out_1", network: "instagram", reason: "operator_skip", sessionId: "sess_1" }
    ]);
    expect(result.skipped).toBe(1);
  });

  it("E edits: the edited text is retyped, re-verified, sent after a new Enter and recorded as edited", async () => {
    const item = queueItem(1);
    const edited = "Bonjour !\\nVersion revue par moi.";
    const { ctx, timeline, page, sdr } = harness({ keys: ["e", { line: edited }, "enter"] });
    await runSendSession(ctx, { items: [item], max: 5 });

    const readLine = timeline.find((event) => event.type === "readLine");
    expect(readLine.initial).toBe(toEditLine(item.body));
    expect(readLine.initial).not.toMatch(/\n/);
    expect(page.sent).toEqual(["Bonjour !\nVersion revue par moi."]);
    assertEverySendFollowsItsEnter(timeline);
    expect(sdr.callsTo("recordSocialDmSent")[0]).toMatchObject({ finalBody: "Bonjour !\nVersion revue par moi.", edited: true });
  });

  it("an empty or cancelled edit keeps the original text", async () => {
    const item = queueItem(1);
    const { ctx, page, sdr } = harness({ keys: ["e", { line: null }, "e", { line: "   " }, "enter"] });
    await runSendSession(ctx, { items: [item], max: 5 });
    expect(page.sent).toEqual([item.body]);
    expect(sdr.callsTo("recordSocialDmSent")[0].edited).toBe(false);
  });

  it("Q stops the session: composer emptied, later items never opened", async () => {
    const { ctx, page, driver } = harness({ keys: ["q"] });
    const result = await runSendSession(ctx, { items: [queueItem(1), queueItem(2)], max: 5 });
    expect(result.stoppedReason).toBe(STOP.OPERATOR);
    expect(page.focused.text).toBe("");
    expect(driver.calls.filter((call) => call.op === "openConversation")).toHaveLength(1);
  });

  it("a failed pricing check needs a second, explicit O; N goes back without sending", async () => {
    const item = queueItem(1, { pricingGuardrailPassed: false });
    const { ctx, timeline, page } = harness({ keys: ["enter", "n", "enter", "o"] });
    await runSendSession(ctx, { items: [item], max: 5 });
    expect(page.sent).toEqual([item.body]);
    const keys = timeline.filter((event) => event.type === "key").map((event) => event.key);
    expect(keys).toEqual(["enter", "n", "enter", "o"]);
    const sendIndex = timeline.findIndex((event) => event.type === "send");
    const lastKeyIndex = timeline.map((event) => event.type).lastIndexOf("key");
    expect(sendIndex).toBeGreaterThan(lastKeyIndex);
  });

  it("does not offer Enter while the composer does not match the message", async () => {
    const { ctx, timeline, page } = harness({ keys: ["s"], driver: { composerOptions: { mangle: (text) => text.slice(1) } } });
    await runSendSession(ctx, { items: [queueItem(1)], max: 5 });
    const prompt = timeline.find((event) => event.type === "prompt");
    expect(prompt.choices).not.toContain("enter");
    expect(page.sent).toEqual([]);
  });

  it("stops at --max sends", async () => {
    const { ctx, driver } = harness({ keys: ["enter", "enter"] });
    const result = await runSendSession(ctx, { items: [queueItem(1), queueItem(2), queueItem(3)], max: 2 });
    expect(result.sent).toBe(2);
    expect(result.stoppedReason).toBeUndefined();
    expect(driver.calls.filter((call) => call.op === "openConversation")).toHaveLength(2);
  });
});

describe("send session — limits and gates", () => {
  it("daily cap stops the session without sending", async () => {
    const { ctx, page, sdr, driver } = harness({
      keys: ["enter"],
      sdr: { reserveSendSlot: () => ({ ok: false, reason: "daily_cap", used: 30, cap: 30 }) }
    });
    const result = await runSendSession(ctx, { items: [queueItem(1), queueItem(2)], max: 5 });
    expect(result.stoppedReason).toBe(STOP.DAILY_CAP);
    expect(page.sent).toEqual([]);
    expect(page.focused.text).toBe("");
    expect(sdr.callsTo("recordSocialDmSent")).toEqual([]);
    expect(driver.calls.filter((call) => call.op === "openConversation")).toHaveLength(1);
  });

  it("spacing: waits the countdown, retries once, then sends", async () => {
    let calls = 0;
    const { ctx, timeline, page } = harness({
      keys: ["enter", "timeout"],
      sdr: {
        reserveSendSlot: () => (++calls === 1 ? { ok: false, reason: "spacing", retryInSeconds: 12, used: 4, cap: 30 } : { ok: true, used: 5, cap: 30 })
      }
    });
    await runSendSession(ctx, { items: [queueItem(1)], max: 5 });
    const countdown = timeline.find((event) => event.type === "prompt" && event.timeoutMs);
    expect(countdown).toMatchObject({ choices: ["s", "q"], timeoutMs: 12000 });
    expect(calls).toBe(2);
    expect(page.sent).toHaveLength(1);
    assertEverySendFollowsItsEnter(timeline);
  });

  it("spacing: S during the countdown skips without sending", async () => {
    const { ctx, page, sdr } = harness({
      keys: ["enter", "s"],
      sdr: { reserveSendSlot: () => ({ ok: false, reason: "spacing", retryInSeconds: 30, used: 4, cap: 30 }) }
    });
    const result = await runSendSession(ctx, { items: [queueItem(1)], max: 5 });
    expect(page.sent).toEqual([]);
    expect(result.skipped).toBe(1);
    expect(sdr.callsTo("recordSocialDmSkipped")[0].reason).toBe("operator_skip");
  });

  it("spacing still refused after the wait stops the session", async () => {
    const { ctx, page } = harness({
      keys: ["enter", "timeout"],
      sdr: { reserveSendSlot: () => ({ ok: false, reason: "spacing", retryInSeconds: 5, used: 4, cap: 30 }) }
    });
    const result = await runSendSession(ctx, { items: [queueItem(1)], max: 5 });
    expect(result.stoppedReason).toBe(STOP.SPACING);
    expect(page.sent).toEqual([]);
  });

  it("checks the gate before opening and again right before sending", async () => {
    let calls = 0;
    const { ctx, page, timeline } = harness({
      keys: ["enter"],
      sdr: { checkBeforeSend: () => (++calls === 1 ? { allowed: true } : { allowed: false, reason: "already_contacted" }) }
    });
    const result = await runSendSession(ctx, { items: [queueItem(1)], max: 5 });
    expect(calls).toBe(2);
    expect(page.sent).toEqual([]);
    expect(page.focused.text).toBe("");
    expect(result.refused).toBe(1);
    // The second gate check came after the Enter.
    const enterIndex = timeline.findIndex((event) => event.type === "key" && event.key === "enter");
    const gateIndexes = timeline.flatMap((event, index) => (event.type === "sdr.checkBeforeSend" ? [index] : []));
    expect(gateIndexes[1]).toBeGreaterThan(enterIndex);
  });

  it("a company refused by the gate is not even opened", async () => {
    const { ctx, driver } = harness({ keys: [], sdr: { checkBeforeSend: () => ({ allowed: false, reason: "suppressed" }) } });
    const result = await runSendSession(ctx, { items: [queueItem(1)], max: 5 });
    expect(driver.calls.filter((call) => call.op === "openConversation")).toEqual([]);
    expect(result.refused).toBe(1);
  });

  it("reserves the slot after the Enter and before the send", async () => {
    const { ctx, timeline } = harness({ keys: ["enter"] });
    await runSendSession(ctx, { items: [queueItem(1)], max: 5 });
    const order = timeline
      .map((event) => event.type)
      .filter((type) => ["key", "sdr.reserveSendSlot", "send", "sdr.recordSocialDmSent"].includes(type));
    expect(order).toEqual(["key", "sdr.reserveSendSlot", "send", "sdr.recordSocialDmSent"]);
  });
});

describe("send session — blockers, confirmation, failures", () => {
  const checkpoint = { kind: "checkpoint", detail: "challenge" };

  it("a blocker when opening a profile stops and reports, without typing", async () => {
    const items = [queueItem(1), queueItem(2)];
    const { ctx, timeline, sdr, driver } = harness({ driver: { profiles: { [items[0].profile.url]: checkpoint } } });
    const result = await runSendSession(ctx, { items, max: 5 });
    expect(result.stoppedReason).toBe("blocked:checkpoint");
    expect(sdr.callsTo("reportSessionBlocked")).toEqual([
      expect.objectContaining({ sessionId: "sess_1", workspaceId: "ws_default", businessId: "biz_test", network: "instagram", reason: "checkpoint" })
    ]);
    expect(timeline.some((event) => event.type === "keyboard.insertText")).toBe(false);
    expect(driver.calls.filter((call) => call.op === "openConversation")).toHaveLength(1);
  });

  it("a blocker appearing before the send stops without sending", async () => {
    const { ctx, page, sdr } = harness({ keys: ["enter"], driver: { blockers: [{ kind: "rate_limited", detail: "try again later" }] } });
    const result = await runSendSession(ctx, { items: [queueItem(1), queueItem(2)], max: 5 });
    expect(result.stoppedReason).toBe("blocked:rate_limited");
    expect(page.sent).toEqual([]);
    expect(sdr.callsTo("recordSocialDmSent")).toEqual([]);
    expect(sdr.callsTo("reportSessionBlocked")[0].reason).toBe("rate_limited");
  });

  it("an 'action blocked' on a profile also parks that draft for the day", async () => {
    const item = queueItem(1);
    const { ctx, sdr } = harness({ driver: { profiles: { [item.profile.url]: { kind: "action_blocked", detail: "you can't message this account" } } } });
    await runSendSession(ctx, { items: [item], max: 5 });
    expect(sdr.callsTo("recordSocialDmSkipped")).toEqual([
      { outreachId: "out_1", network: "instagram", reason: "blocked_on_open", sessionId: "sess_1" }
    ]);
    expect(sdr.callsTo("reportSessionBlocked")).toHaveLength(1);
  });

  it("a profile without a message button is set aside and the session continues", async () => {
    const items = [queueItem(1), queueItem(2)];
    const { ctx, page, sdr } = harness({ keys: ["enter"], driver: { profiles: { [items[0].profile.url]: "no_message_button" } } });
    const result = await runSendSession(ctx, { items, max: 5 });
    expect(sdr.callsTo("recordSocialDmSkipped")[0]).toMatchObject({ outreachId: "out_1", reason: "no_message_button" });
    expect(page.sent).toEqual([items[1].body]);
    expect(result).toMatchObject({ sent: 1, unavailable: 1 });
  });

  it("confirmSent false records the send as unverified", async () => {
    const { ctx, sdr } = harness({ keys: ["enter"], driver: { confirm: false } });
    const result = await runSendSession(ctx, { items: [queueItem(1)], max: 5 });
    expect(sdr.callsTo("recordSocialDmSent")[0]).toMatchObject({ verified: false });
    expect(result).toMatchObject({ sent: 1, unverified: 1 });
  });

  it("an Enter that reached the browser is recorded once, never sent a second time", async () => {
    const item = queueItem(1);
    const { ctx, timeline, page, sdr } = harness({
      keys: [{ key: "enter", before: () => page.browserKey("Enter") }]
    });
    await runSendSession(ctx, { items: [item], max: 5 });
    expect(page.sent).toEqual([item.body]);
    expect(runnerSends(timeline)).toEqual([]);
    expect(timeline.some((event) => event.type === "composer.press" && event.key === "Enter")).toBe(false);
    expect(sdr.callsTo("recordSocialDmSent")).toEqual([expect.objectContaining({ verified: true, finalBody: item.body })]);
  });

  it("a record failure after sending stops the session loudly", async () => {
    const { ctx, page, ui } = harness({
      keys: ["enter"],
      sdr: {
        recordSocialDmSent: () => {
          throw new Error("company already has a social DM");
        }
      }
    });
    const result = await runSendSession(ctx, { items: [queueItem(1), queueItem(2)], max: 5 });
    expect(page.sent).toHaveLength(1);
    expect(result).toMatchObject({ sent: 1, stoppedReason: STOP.RECORD_FAILED });
    expect(ui.shown.some((entry) => entry.call === "error" && /NON enregistré/.test(entry.args[0]))).toBe(true);
  });

  it("an exception from the driver stops the session, as an error and not as a Meta block", async () => {
    const { ctx, sdr, ui } = harness({});
    ctx.driver.openConversation = async () => {
      throw new Error("locator.click: Timeout 15000ms exceeded.\nCall log: ...");
    };
    const result = await runSendSession(ctx, { items: [queueItem(1)], max: 5 });
    expect(result.stoppedReason).toBe(STOP.ERROR);
    expect(sdr.callsTo("reportSessionBlocked")).toEqual([]);
    expect(ui.shown.some((entry) => entry.call === "blocker")).toBe(false);
  });

  it("an exception on a page that turned into a checkpoint is reported as that blocker", async () => {
    const { ctx, sdr } = harness({ driver: { blockers: [{ kind: "checkpoint", detail: "challenge" }] } });
    ctx.driver.openConversation = async () => {
      throw new Error("locator.click: Timeout 15000ms exceeded.");
    };
    const result = await runSendSession(ctx, { items: [queueItem(1)], max: 5 });
    expect(result.stoppedReason).toBe("blocked:checkpoint");
    expect(sdr.callsTo("reportSessionBlocked")[0]).toMatchObject({ reason: "checkpoint" });
  });
});

describe("edit line helpers", () => {
  it("round-trips line breaks through the one-line editor", () => {
    expect(toEditLine("a\r\nb\nc")).toBe("a\\nb\\nc");
    expect(fromEditLine("a\\nb")).toBe("a\nb");
  });
});
