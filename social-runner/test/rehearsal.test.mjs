import { describe, it, expect } from "vitest";
import { harness, queueItem } from "./helpers.mjs";
import { REHEARSAL_MAX, rehearseStart, runRehearsal } from "../src/rehearsal.mjs";
import { parseArgs } from "../src/args.mjs";

const noWait = async () => undefined;

/** Nothing a rehearsal may ever do: type, press, send, or write to the SDR. */
function assertNothingLeft({ timeline, page, sdr }) {
  expect(page.sent).toEqual([]);
  expect(timeline.some((event) => /^(keyboard|composer)\.(insertText|press|type|fill)$/.test(event.type))).toBe(false);
  for (const write of ["reserveSendSlot", "recordSocialDmSent", "recordSocialDmSkipped", "recordSocialReplySent", "reportSessionBlocked"]) {
    expect(sdr.callsTo(write), write).toEqual([]);
  }
}

describe("rehearsal — the real path, nothing typed, sent or recorded", () => {
  it("opens each prospect's conversation and checks the composer, for the first N only", async () => {
    const h = harness();
    const items = [1, 2, 3, 4, 5].map((n) => queueItem(n));
    const { results, stoppedReason } = await runRehearsal(h.ctx, { items, max: 3, wait: noWait });
    expect(stoppedReason).toBeUndefined();
    expect(results.map((r) => [r.outreachId, r.outcome, r.composerEmpty])).toEqual([
      ["out_1", "ready", true],
      ["out_2", "ready", true],
      ["out_3", "ready", true]
    ]);
    expect(h.driver.calls.filter((c) => c.op === "openConversation")).toHaveLength(3);
    expect(h.sdr.callsTo("checkBeforeSend")).toHaveLength(3);
    assertNothingLeft(h);
  });

  it("skips a prospect the contact gate refuses, without opening it", async () => {
    const h = harness({ sdr: { checkBeforeSend: (input) => (input.outreachId === "out_1" ? { allowed: false, reason: "suppressed" } : { allowed: true }) } });
    const { results } = await runRehearsal(h.ctx, { items: [queueItem(1), queueItem(2)], wait: noWait });
    expect(results.map((r) => r.outcome)).toEqual(["refused", "ready"]);
    expect(h.driver.calls.filter((c) => c.op === "openConversation").map((c) => c.url)).toEqual([queueItem(2).profile.url]);
    assertNothingLeft(h);
  });

  it("reports a prospect with no message button and moves on", async () => {
    const h = harness({ driver: { profiles: { [queueItem(1).profile.url]: "no_message_button" } } });
    const { results } = await runRehearsal(h.ctx, { items: [queueItem(1), queueItem(2)], wait: noWait });
    expect(results.map((r) => [r.outcome, r.reason])).toEqual([["unavailable", "no_message_button"], ["ready", undefined]]);
    assertNothingLeft(h);
  });

  it("stops at the first Meta blocker, like a real session, and visits nobody after it", async () => {
    const h = harness({ driver: { profiles: { [queueItem(1).profile.url]: { kind: "action_blocked" } } } });
    const { results, stoppedReason } = await runRehearsal(h.ctx, { items: [queueItem(1), queueItem(2)], wait: noWait });
    expect(stoppedReason).toBe("blocked:action_blocked");
    expect(results).toHaveLength(1);
    expect(h.driver.calls.filter((c) => c.op === "openConversation")).toHaveLength(1);
    assertNothingLeft(h);
  });

  it("stops when a blocker appears after a visit", async () => {
    const h = harness({ driver: { blockers: [{ kind: "checkpoint" }] } });
    const { stoppedReason, results } = await runRehearsal(h.ctx, { items: [queueItem(1), queueItem(2)], wait: noWait });
    expect(stoppedReason).toBe("blocked:checkpoint");
    expect(results).toHaveLength(1);
  });

  it("reports, for each conversation, what an automatic session would check: is it new?", async () => {
    const items = [queueItem(1), queueItem(2)];
    const h = harness({ driver: { threadStates: { [items[1].profile.url]: "has_content" } } });
    const { results } = await runRehearsal(h.ctx, { items, max: 2, wait: async () => undefined });
    expect(results.map((result) => result.thread)).toEqual(["empty", "has_content"]);
    assertNothingLeft(h);
  });

  it("never visits more than the ceiling, and pauses between prospects", async () => {
    const h = harness();
    const pauses = [];
    const items = Array.from({ length: 15 }, (_, n) => queueItem(n + 1));
    const { results } = await runRehearsal(h.ctx, { items, max: 50, wait: async (ms) => pauses.push(ms) });
    expect(results).toHaveLength(REHEARSAL_MAX);
    expect(pauses).toHaveLength(REHEARSAL_MAX - 1);
    expect(Math.min(...pauses)).toBeGreaterThanOrEqual(4000);
    assertNothingLeft(h);
  });

  it("start: reports the account without asking for a key, refuses a logged-out window", async () => {
    const ok = harness({ driver: { identity: "clarence.dion" } });
    expect(await rehearseStart(ok.ctx, { network: "instagram" })).toEqual({ ok: true, identity: "clarence.dion" });
    expect(ok.timeline.some((event) => event.type === "prompt")).toBe(false);
    const out = harness({ driver: { loggedIn: false } });
    expect(await rehearseStart(out.ctx, { network: "instagram" })).toMatchObject({ ok: false, reason: "not_logged_in" });
  });
});

describe("rehearse command line", () => {
  it("parses, with --max capped at the rehearsal ceiling", () => {
    expect(parseArgs(["rehearse", "--business", "biz_bloomy", "--network", "instagram"])).toMatchObject({ command: "rehearse", max: undefined });
    expect(parseArgs(["rehearse", "--business", "biz_bloomy", "--network", "instagram", "--max", "5"])).toMatchObject({ max: 5 });
    expect(() => parseArgs(["rehearse", "--business", "biz_bloomy", "--network", "instagram", "--max", "11"])).toThrow(/entre 1 et 10/);
    expect(() => parseArgs(["inbox", "--business", "biz_bloomy", "--network", "instagram", "--max", "3"])).toThrow(/send ou rehearse/);
  });
});

describe("typing check on a safe account (--type-to)", () => {
  it("types the DM line by line with Shift+Enter, reads it back, clears it, and never presses Enter", async () => {
    const { rehearseTyping } = await import("../src/rehearsal.mjs");
    const h = harness();
    const text = "Bonjour !\n\nNotre formule : 0 € de création.\n\nOn en parle ?";
    const result = await rehearseTyping(h.ctx, { handle: "@bloomy.studio", text });
    expect(result.outcome).toBe("typed");
    expect(result.cleared).toBe(true);
    expect(h.driver.calls.find((c) => c.op === "openConversation").url).toBe("https://www.instagram.com/bloomy.studio/");
    expect(h.timeline.some((event) => event.type === "keyboard.press" && event.key === "Enter")).toBe(false);
    expect(h.timeline.some((event) => event.type === "keyboard.press" && event.key === "Shift+Enter")).toBe(true);
    expect(h.page.sent).toEqual([]);
    for (const write of ["reserveSendSlot", "recordSocialDmSent", "recordSocialDmSkipped"]) expect(h.sdr.callsTo(write)).toEqual([]);
  });

  it("--type-to only with rehearse, and only a plain account name", () => {
    expect(parseArgs(["rehearse", "--business", "b", "--network", "instagram", "--type-to", "@bloomy.studio"])).toMatchObject({ typeTo: "bloomy.studio" });
    expect(() => parseArgs(["send", "--business", "b", "--network", "instagram", "--type-to", "x"])).toThrow(/rehearse/);
    expect(() => parseArgs(["rehearse", "--business", "b", "--network", "instagram", "--type-to", "a b"])).toThrow(/nom de compte/);
  });
});
