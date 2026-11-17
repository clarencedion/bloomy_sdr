/**
 * Phase 23 review fixes on the first-DM session: a key typed in the browser
 * window, the pinned composer, Meta's verdict after a send, the pending-send
 * journal, selector drift, Ctrl+C between prospects, the pricing override key
 * and the draft re-read.
 */
import { describe, expect, it } from "vitest";
import { createMockComposer } from "../src/drivers/mock-social-channel-driver.mjs";
import { CONFIRM_DRAIN_MS } from "../src/keys.mjs";
import { MAX_CONSECUTIVE_UNAVAILABLE, STOP, runSendSession } from "../src/session-machine.mjs";
import { assertEverySendFollowsItsEnter, harness, isRunnerSend, queueItem } from "./helpers.mjs";

const runnerSends = (timeline) => timeline.filter((event, index) => isRunnerSend(timeline, index));
const opened = (driver) => driver.calls.filter((call) => call.op === "openConversation").map((call) => call.url);

describe("a key typed in the browser window (findings #1, #15)", () => {
  it("the composer is blurred once typed: a stray browser Enter lands on nothing", async () => {
    let focusedAtPrompt = "unset";
    const { ctx, timeline, page } = harness({
      keys: [
        {
          key: "s",
          before: () => {
            focusedAtPrompt = page.focused;
            // What a browser Enter does when no element has the focus: nothing.
            page.focused?.receiveKey("Enter");
          }
        }
      ]
    });
    await runSendSession(ctx, { items: [queueItem(1)], max: 5 });
    expect(focusedAtPrompt).toBeNull();
    expect(page.sent).toEqual([]);
    const types = timeline.map((event) => event.type);
    expect(types.lastIndexOf("keyboard.insertText")).toBeLessThan(types.indexOf("composer.blur"));
    expect(types.indexOf("composer.blur")).toBeLessThan(types.indexOf("prompt"));
  });

  it("browser Enter then S: the DM is recorded as sent, not skipped, and the draft is not re-queued", async () => {
    const item = queueItem(1);
    const { ctx, timeline, page, sdr } = harness({ keys: [{ key: "s", before: () => page.browserKey("Enter") }, "s"] });
    const result = await runSendSession(ctx, { items: [item, queueItem(2)], max: 5 });

    expect(page.sent).toEqual([item.body, ]);
    expect(runnerSends(timeline)).toEqual([]);
    expect(sdr.callsTo("recordSocialDmSent")).toEqual([expect.objectContaining({ outreachId: "out_1", finalBody: item.body, verified: true })]);
    expect(sdr.callsTo("reserveSendSlot")).toHaveLength(1);
    // Item 1 is not skipped; item 2 (a real S) is.
    expect(sdr.callsTo("recordSocialDmSkipped").map((call) => call.outreachId)).toEqual(["out_2"]);
    expect(result).toMatchObject({ sent: 1, skipped: 1 });
  });

  it("browser Enter then Q: the DM is recorded, then the session stops as asked", async () => {
    const item = queueItem(1);
    const { ctx, page, sdr, driver } = harness({ keys: [{ key: "q", before: () => page.browserKey("Enter") }] });
    const result = await runSendSession(ctx, { items: [item, queueItem(2)], max: 5 });

    expect(page.sent).toEqual([item.body]);
    expect(sdr.callsTo("recordSocialDmSent")).toEqual([expect.objectContaining({ outreachId: "out_1", verified: true })]);
    expect(result).toMatchObject({ sent: 1, stoppedReason: STOP.OPERATOR });
    expect(opened(driver)).toHaveLength(1);
  });

  it("browser Enter then E: nothing is retyped or sent a second time; the text that left is recorded", async () => {
    const item = queueItem(1);
    const { ctx, timeline, page, sdr } = harness({ keys: [{ key: "e", before: () => page.browserKey("Enter") }] });
    const result = await runSendSession(ctx, { items: [item], max: 5 });

    expect(page.sent).toEqual([item.body]);
    expect(timeline.some((event) => event.type === "readLine")).toBe(false);
    expect(sdr.callsTo("recordSocialDmSent")).toEqual([expect.objectContaining({ finalBody: item.body, edited: false, verified: true })]);
    expect(result.sent).toBe(1);
  });

  it("browser Enter while the operator edits: the new text is never typed or sent", async () => {
    const item = queueItem(1);
    const { ctx, timeline, page, sdr } = harness({
      keys: ["e", { line: "Un tout autre texte", before: () => page.browserKey("Enter") }]
    });
    await runSendSession(ctx, { items: [item], max: 5 });

    expect(page.sent).toEqual([item.body]);
    expect(timeline.filter((event) => event.type === "keyboard.insertText").map((event) => event.text)).not.toContain("Un tout autre texte");
    expect(sdr.callsTo("recordSocialDmSent")).toEqual([expect.objectContaining({ finalBody: item.body })]);
  });

  it("browser Enter during the spacing countdown, then S: recorded once, one slot only", async () => {
    let reservations = 0;
    const item = queueItem(1);
    const { ctx, page, sdr } = harness({
      keys: ["enter", { key: "s", before: () => page.browserKey("Enter") }],
      sdr: { reserveSendSlot: () => (++reservations === 1 ? { ok: false, reason: "spacing", retryInSeconds: 30, used: 3, cap: 30 } : { ok: true, used: 4, cap: 30 }) }
    });
    const result = await runSendSession(ctx, { items: [item], max: 5 });

    expect(page.sent).toEqual([item.body]);
    expect(sdr.callsTo("recordSocialDmSent")).toHaveLength(1);
    expect(sdr.callsTo("recordSocialDmSkipped")).toEqual([]);
    expect(result).toMatchObject({ sent: 1, skipped: 0 });
  });

  it("browser Enter while the pricing confirmation waits, then N: recorded, not retyped", async () => {
    const item = queueItem(1, { pricingGuardrailPassed: false });
    const { ctx, page, sdr, timeline } = harness({ keys: ["enter", { key: "n", before: () => page.browserKey("Enter") }] });
    await runSendSession(ctx, { items: [item], max: 5 });
    expect(page.sent).toEqual([item.body]);
    expect(sdr.callsTo("recordSocialDmSent")).toHaveLength(1);
    expect(timeline.filter((event) => event.type === "prompt")).toHaveLength(2);
  });
});

describe("the pricing override needs a different key (minor)", () => {
  it("a second Enter cannot confirm: the confirmation offers O (not Enter) with a long drain", async () => {
    const item = queueItem(1, { pricingGuardrailPassed: false });
    const { ctx, timeline, page } = harness({ keys: ["enter", "q"] });
    await runSendSession(ctx, { items: [item], max: 5 });
    const confirmation = timeline.filter((event) => event.type === "prompt")[1];
    expect(confirmation.choices).toEqual(["o", "n", "q"]);
    expect(confirmation.choices).not.toContain("enter");
    expect(confirmation.drainMs).toBe(CONFIRM_DRAIN_MS);
    expect(CONFIRM_DRAIN_MS).toBeGreaterThanOrEqual(500);
    expect(page.sent).toEqual([]);
  });
});

describe("the conversation's own composer (finding #2)", () => {
  it("a chat window popping up during the prompt neither receives the text nor the send", async () => {
    const item = queueItem(1);
    let other;
    const { ctx, timeline, page } = harness({
      keys: [
        {
          key: "enter",
          before: () => {
            other = createMockComposer(page);
            page.composers.unshift(other);
            page.focused = other;
          }
        }
      ]
    });
    await runSendSession(ctx, { items: [item], max: 5 });
    expect(page.sent).toEqual([item.body]);
    expect(other.text).toBe("");
    const send = timeline.find((event) => event.type === "send");
    expect(page.composers[send.composer]).not.toBe(other);
    assertEverySendFollowsItsEnter(timeline);
  });

  it("a composer that left the page before the Enter: nothing is sent or recorded, the session stops", async () => {
    const { ctx, page, sdr } = harness({ keys: [{ key: "enter", before: () => (page.composers[0].isAttached = false) }] });
    const result = await runSendSession(ctx, { items: [queueItem(1), queueItem(2)], max: 5 });
    expect(page.sent).toEqual([]);
    expect(sdr.callsTo("recordSocialDmSent")).toEqual([]);
    expect(result.stoppedReason).toBe(STOP.COMPOSER_LOST);
    expect(sdr.callsTo("reportSessionBlocked")).toEqual([]);
  });
});

describe("Meta's verdict after the send (finding #3)", () => {
  it("a bubble marked as failed is recorded unverified and the session stops as blocked", async () => {
    const items = [queueItem(1), queueItem(2)];
    const { ctx, page, sdr, driver } = harness({ keys: ["enter", "enter"], driver: { confirm: "failed" } });
    const result = await runSendSession(ctx, { items, max: 5 });

    expect(page.sent).toEqual([items[0].body]);
    expect(sdr.callsTo("recordSocialDmSent")).toEqual([expect.objectContaining({ outreachId: "out_1", verified: false })]);
    expect(result).toMatchObject({ sent: 1, unverified: 1, stoppedReason: "blocked:action_blocked" });
    expect(sdr.callsTo("reportSessionBlocked")).toEqual([expect.objectContaining({ reason: "action_blocked" })]);
    expect(opened(driver)).toEqual([items[0].profile.url]);
  });

  it("a blocker right after the send is checked: recorded unverified, the next prospect is never opened", async () => {
    const items = [queueItem(1), queueItem(2)];
    const { ctx, sdr, driver, timeline } = harness({
      keys: ["enter", "enter"],
      driver: { blockers: [null, { kind: "rate_limited", detail: "try again later" }] }
    });
    const result = await runSendSession(ctx, { items, max: 5 });

    expect(sdr.callsTo("recordSocialDmSent")).toEqual([expect.objectContaining({ verified: false })]);
    expect(result.stoppedReason).toBe("blocked:rate_limited");
    expect(sdr.callsTo("reportSessionBlocked")).toEqual([expect.objectContaining({ reason: "rate_limited" })]);
    expect(opened(driver)).toHaveLength(1);
    const types = timeline.map((event) => event.type);
    expect(types.lastIndexOf("driver.checkBlocker")).toBeGreaterThan(types.indexOf("send"));
  });
});

describe("the pending-send journal (finding #4)", () => {
  it("is written before the key and removed only after the record", async () => {
    const item = queueItem(1);
    const { ctx, timeline, journal } = harness({ keys: ["enter"] });
    await runSendSession(ctx, { items: [item], max: 5 });
    const order = timeline
      .map((event) => event.type)
      .filter((type) => ["journal.begin", "send", "sdr.recordSocialDmSent", "journal.settle"].includes(type));
    expect(order).toEqual(["journal.begin", "send", "sdr.recordSocialDmSent", "journal.settle"]);
    const begin = timeline.find((event) => event.type === "journal.begin");
    expect(begin.entry).toMatchObject({
      kind: "first_dm",
      outreachId: "out_1",
      network: "instagram",
      text: item.body,
      record: { outreachId: "out_1", network: "instagram", profile: item.profile, finalBody: item.body, edited: false, sessionId: "sess_1", operator: "tester" }
    });
    expect(begin.entry.record).not.toHaveProperty("verified");
    expect(journal.pending()).toEqual([]);
  });

  it("a record that keeps failing is retried, then left in the journal for the next session", async () => {
    const { ctx, sdr, journal } = harness({
      keys: ["enter"],
      sdr: {
        recordSocialDmSent: () => {
          throw new Error("UNAVAILABLE: network");
        }
      }
    });
    const result = await runSendSession(ctx, { items: [queueItem(1)], max: 5 });
    expect(sdr.callsTo("recordSocialDmSent")).toHaveLength(3);
    expect(result.stoppedReason).toBe(STOP.RECORD_FAILED);
    expect(journal.pending()).toEqual([expect.objectContaining({ kind: "first_dm", outreachId: "out_1" })]);
  });

  it("a transient record failure is retried and the journal entry cleared", async () => {
    let attempts = 0;
    const { ctx, journal } = harness({
      keys: ["enter"],
      sdr: {
        recordSocialDmSent: () => {
          if (++attempts === 1) throw new Error("DEADLINE_EXCEEDED");
          return { conversationId: "c" };
        }
      }
    });
    const result = await runSendSession(ctx, { items: [queueItem(1)], max: 5 });
    expect(attempts).toBe(2);
    expect(result).toMatchObject({ sent: 1 });
    expect(result.stoppedReason).toBeUndefined();
    expect(journal.pending()).toEqual([]);
  });

  it("a browser send is journaled too before being recorded", async () => {
    const { ctx, timeline, page } = harness({ keys: [{ key: "s", before: () => page.browserKey("Enter") }] });
    await runSendSession(ctx, { items: [queueItem(1)], max: 5 });
    const types = timeline.map((event) => event.type);
    expect(types.indexOf("journal.begin")).toBeGreaterThan(-1);
    expect(types.indexOf("journal.begin")).toBeLessThan(types.indexOf("sdr.recordSocialDmSent"));
    expect(types).toContain("journal.settle");
  });

  it("drafts journaled by a previous session are never offered", async () => {
    const items = [queueItem(1), queueItem(2)];
    const { ctx, driver, page } = harness({ keys: ["enter"] });
    const result = await runSendSession(ctx, { items, max: 5, excludeOutreachIds: new Set(["out_1"]) });
    expect(opened(driver)).toEqual([items[1].profile.url]);
    expect(page.sent).toEqual([items[1].body]);
    expect(result.sent).toBe(1);
  });
});

describe("selector drift (finding #16)", () => {
  it(`stops after ${MAX_CONSECUTIVE_UNAVAILABLE} prospects in a row without a message button or composer; the last one is not parked`, async () => {
    const items = [1, 2, 3, 4, 5].map((n) => queueItem(n));
    const profiles = {
      [items[0].profile.url]: "no_message_button",
      [items[1].profile.url]: "no_composer",
      [items[2].profile.url]: "no_message_button"
    };
    const { ctx, sdr, driver, ui } = harness({ driver: { profiles } });
    const result = await runSendSession(ctx, { items, max: 5 });

    expect(result.stoppedReason).toBe(STOP.SELECTOR_DRIFT);
    expect(opened(driver)).toHaveLength(3);
    expect(sdr.callsTo("recordSocialDmSkipped").map((call) => call.outreachId)).toEqual(["out_1", "out_2"]);
    expect(sdr.callsTo("reportSessionBlocked")).toEqual([]);
    expect(ui.shown.some((entry) => entry.call === "error" && /changé son interface/.test(entry.args[0]))).toBe(true);
  });

  it("a private or missing profile does not count, and a conversation that opens resets the count", async () => {
    const items = [1, 2, 3, 4, 5, 6].map((n) => queueItem(n));
    const profiles = {
      [items[0].profile.url]: "no_message_button",
      [items[1].profile.url]: "private",
      [items[2].profile.url]: "no_message_button",
      [items[4].profile.url]: "no_composer",
      [items[5].profile.url]: "no_message_button"
    };
    const { ctx } = harness({ keys: ["s"], driver: { profiles } });
    const result = await runSendSession(ctx, { items, max: 5 });
    expect(result.stoppedReason).toBeUndefined();
    expect(result).toMatchObject({ unavailable: 5, skipped: 1 });
  });
});

describe("Ctrl+C between prospects (minor)", () => {
  it("an interrupt while a send is being confirmed/recorded stops before the next prospect is opened", async () => {
    const items = [queueItem(1), queueItem(2)];
    const box = {};
    box.h = harness({
      keys: ["enter"],
      sdr: {
        recordSocialDmSent: () => {
          box.h.keys.interrupt();
          return { conversationId: "c" };
        }
      }
    });
    const { ctx, driver, timeline } = box.h;
    const result = await runSendSession(ctx, { items, max: 5 });
    expect(result).toMatchObject({ sent: 1, stoppedReason: STOP.OPERATOR });
    expect(opened(driver)).toEqual([items[0].profile.url]);
    // Nothing typed after the interrupt.
    const interruptAt = timeline.findIndex((event) => event.type === "interrupt");
    expect(timeline.slice(interruptAt).some((event) => event.type === "keyboard.insertText")).toBe(false);
  });

  it("an interrupt during the gate check does not open the prospect", async () => {
    const box = {};
    box.h = harness({
      sdr: {
        checkBeforeSend: () => {
          box.h.keys.interrupt();
          return { allowed: true };
        }
      }
    });
    const result = await runSendSession(box.h.ctx, { items: [queueItem(1)], max: 5 });
    expect(result.stoppedReason).toBe(STOP.OPERATOR);
    expect(opened(box.h.driver)).toEqual([]);
  });
});

describe("the draft as stored now (minor)", () => {
  it("an edit saved on the web after the queue was listed is what gets typed and sent", async () => {
    const item = queueItem(1);
    const webEdit = "Bonjour Boutique 1,\nversion corrigée dans le SDR pendant la session.";
    const { ctx, page, sdr } = harness({ keys: ["enter"], sdr: { checkBeforeSend: () => ({ allowed: true, body: webEdit }) } });
    await runSendSession(ctx, { items: [item], max: 5 });
    expect(page.sent).toEqual([webEdit]);
    expect(sdr.callsTo("recordSocialDmSent")[0]).toMatchObject({ finalBody: webEdit, edited: false });
  });

  it("a draft changed AFTER its text was shown is not sent on Enter: the person approved the old text", async () => {
    const item = queueItem(1);
    let calls = 0;
    const { ctx, page, sdr } = harness({
      keys: ["enter"],
      sdr: {
        // First gate: the listed text. Second gate (right before sending): a new version.
        checkBeforeSend: () => (++calls === 1 ? { allowed: true } : { allowed: true, body: "Bonjour Boutique 1, nouvelle version." })
      }
    });
    await runSendSession(ctx, { items: [item], max: 5 });
    expect(page.sent).toEqual([]);
    expect(sdr.callsTo("recordSocialDmSent")).toHaveLength(0);
  });

  it("a draft rewritten during the session is reviewed with ITS flags: a failed offer check still needs O", async () => {
    // Listed clean; rewritten since with model money talk (pricingGuardrailPassed false).
    const item = queueItem(1, { pricingGuardrailPassed: true });
    const rewritten = "Bonjour Boutique 1, votre premier mois offert.";
    const { ctx, page, timeline } = harness({
      keys: ["enter", "q"],
      sdr: {
        checkBeforeSend: () => ({
          allowed: true,
          body: rewritten,
          review: { pricingGuardrailPassed: false, mentionsCommercialTerms: true, warnings: ["Hors phrase de conditions : …"] }
        })
      }
    });
    await runSendSession(ctx, { items: [item], max: 5 });
    const confirmation = timeline.filter((event) => event.type === "prompt")[1];
    expect(confirmation?.choices).toEqual(["o", "n", "q"]);
    expect(page.sent).toEqual([]);
  });
});
