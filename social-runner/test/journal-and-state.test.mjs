/**
 * The pending-send journal on disk and its replay (finding #4), the pending
 * conversation state and AI capability check (findings #5/#8/#10, minor), the
 * key hub's interrupt flag and confirmation drain, and the UI's sanitising.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { CONFIRM_DRAIN_MS, DRAIN_MS, createKeyHub } from "../src/keys.mjs";
import { aiProviderProblem, escalationOf, lacksPendingState, pendingDraftOf, pendingStateFromConversation } from "../src/pending-state.mjs";
import { createSendJournal, replayPendingSends, textHash } from "../src/send-journal.mjs";
import { createUi } from "../src/ui.mjs";
import { memoryJournal, mockSdr, silentUi } from "./helpers.mjs";

const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "social-journal-"));
  dirs.push(dir);
  return path.join(dir, "pending-sends");
};

const firstDm = {
  kind: "first_dm",
  network: "instagram",
  workspaceId: "ws_default",
  businessId: "biz_test",
  companyName: "Boutique 1",
  outreachId: "out_1",
  text: "Bonjour Boutique 1",
  record: { outreachId: "out_1", network: "instagram", profile: { url: "https://www.instagram.com/b1/", handle: "b1" }, finalBody: "Bonjour Boutique 1", edited: false }
};

describe("pending-send journal on disk (finding #4)", () => {
  it("begin writes the entry before returning, owner-only; settle removes it", () => {
    const journal = createSendJournal({ dir: tempDir(), now: () => Date.UTC(2026, 10, 10) });
    const id = journal.begin(firstDm);
    const file = path.join(journal.dir, `pending-${id}.json`);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    const [entry] = journal.pending();
    expect(entry).toMatchObject({ id, outreachId: "out_1", textHash: textHash(firstDm.text), at: "2026-11-10T00:00:00.000Z", record: firstDm.record });
    journal.settle(id);
    expect(fs.existsSync(file)).toBe(false);
    expect(journal.pending()).toEqual([]);
  });

  it("an absent folder means nothing pending; stray files are ignored", () => {
    const journal = createSendJournal({ dir: tempDir() });
    expect(journal.pending()).toEqual([]);
    fs.mkdirSync(journal.dir, { recursive: true });
    fs.writeFileSync(path.join(journal.dir, "notes.txt"), "x");
    fs.writeFileSync(path.join(journal.dir, "pending-broken.json"), "{");
    expect(journal.pending()).toEqual([]);
  });

  it("replay records every leftover send as unverified, never sends, and clears what the SDR accepted", async () => {
    const journal = createSendJournal({ dir: tempDir() });
    journal.begin(firstDm);
    journal.begin({ kind: "reply", network: "instagram", conversationId: "conv_1", companyName: "Lise", text: "Merci", record: { conversationId: "conv_1", bodyText: "Merci", edited: false } });
    const sdr = mockSdr([]);
    const result = await replayPendingSends({ journal, sdr, ui: silentUi() });

    expect(sdr.callsTo("recordSocialDmSent")).toEqual([{ ...firstDm.record, verified: false }]);
    expect(sdr.callsTo("recordSocialReplySent")).toEqual([{ conversationId: "conv_1", bodyText: "Merci", edited: false, verified: false }]);
    expect(result.replayed).toHaveLength(2);
    expect([...result.outreachIds]).toEqual(["out_1"]);
    expect([...result.conversationIds]).toEqual(["conv_1"]);
    expect(journal.pending()).toEqual([]);
  });

  it("a replay the SDR refuses stays journaled and its draft is still kept out", async () => {
    const journal = memoryJournal([]);
    journal.begin(firstDm);
    const sdr = mockSdr([], {
      recordSocialDmSent: () => {
        throw new Error("UNAVAILABLE");
      }
    });
    const ui = silentUi();
    const result = await replayPendingSends({ journal, sdr, ui });
    expect(result.failed).toHaveLength(1);
    expect(result.outreachIds.has("out_1")).toBe(true);
    expect(journal.pending()).toHaveLength(1);
    expect(ui.shown.some((entry) => entry.call === "error" && /NON enregistré/.test(entry.args[0]))).toBe(true);
  });
});

describe("what a conversation still waits for (findings #5, #8, #10)", () => {
  const draft = { bodyText: "Merci !", status: "queued_for_approval", pricingGuardrailPassed: false, mentionsCommercialTerms: true };

  it("a pending session draft", () => {
    expect(pendingStateFromConversation({ pendingSessionSend: true, draftResponse: draft, status: "in_dialogue" })).toEqual({
      pendingDraft: { bodyText: "Merci !", pricingGuardrailPassed: false, mentionsCommercialTerms: true, warnings: [] },
      escalated: null
    });
  });

  it("no pending draft once sent, rejected, or not waiting for a session", () => {
    for (const doc of [
      { pendingSessionSend: false, draftResponse: draft },
      { pendingSessionSend: true, draftResponse: { ...draft, status: "approved_and_sent" } },
      { pendingSessionSend: true, draftResponse: { ...draft, status: "rejected" } },
      { pendingSessionSend: true, draftResponse: { ...draft, bodyText: "  " } }
    ]) {
      expect(pendingStateFromConversation(doc).pendingDraft).toBeNull();
    }
  });

  it("an escalation still needing a person", () => {
    expect(pendingStateFromConversation({ status: "human_escalated", humanAttentionRequired: true, escalationReason: "ANGRY" })).toEqual({
      pendingDraft: null,
      escalated: { reason: "ANGRY" }
    });
    expect(pendingStateFromConversation({ status: "human_escalated", humanAttentionRequired: false }).escalated).toBeNull();
  });

  it("reads the backend's fields on a conversation ref", () => {
    expect(pendingDraftOf({ pendingDraft: { bodyText: "Oui", warnings: ["x"] } })).toEqual({ bodyText: "Oui", warnings: ["x"] });
    expect(pendingDraftOf({ pendingDraft: null })).toBeNull();
    expect(escalationOf({ escalated: true, escalationReason: "LEGAL_RISK" })).toEqual({ reason: "LEGAL_RISK" });
    expect(escalationOf({ escalated: { reason: "ANGRY" } })).toEqual({ reason: "ANGRY" });
    expect(escalationOf({ escalated: null })).toBeNull();
    expect(lacksPendingState({ conversationId: "c" })).toBe(true);
    expect(lacksPendingState({ conversationId: "c", pendingDraft: null, escalated: null })).toBe(false);
  });
});

describe("the AI provider must run structured calls (minor)", () => {
  it.each([
    [{ name: "mock", isMock: true }, /Aucun modèle IA réel/],
    [{ name: "openai", model: "gpt", isMock: false }, /openai.*appels structurés/],
    [{ name: "qwen", model: "q", isMock: false, supportsStructured: false }, /qwen/]
  ])("refuses %j", (provider, message) => {
    expect(aiProviderProblem(provider)).toMatch(message);
  });

  it.each([
    { name: "anthropic", model: "claude", isMock: false },
    { name: "qwen", model: "q", isMock: false },
    { name: "openai", model: "gpt", isMock: false, supportsStructured: true }
  ])("accepts %j", (provider) => {
    expect(aiProviderProblem(provider)).toBeNull();
  });
});

describe("key hub: interrupt flag and confirmation drain (minors)", () => {
  function setup(options = {}) {
    const input = new PassThrough();
    input.isTTY = true;
    input.setRawMode = () => input;
    const clock = { now: 1_000 };
    const hub = createKeyHub({ input, output: new PassThrough(), now: () => clock.now, ...options });
    return { input, clock, hub };
  }

  it("isInterrupted turns true on Ctrl+C and on close", async () => {
    const first = setup();
    expect(first.hub.isInterrupted()).toBe(false);
    first.input.write(String.fromCharCode(3));
    await new Promise((resolve) => setImmediate(resolve));
    expect(first.hub.isInterrupted()).toBe(true);
    first.hub.close();

    const second = setup();
    second.hub.close();
    expect(second.hub.isInterrupted()).toBe(true);
  });

  it("a confirmation prompt ignores a key arriving within its longer drain (held or double-tapped key)", async () => {
    const { input, clock, hub } = setup();
    const answer = hub.prompt(["o", "n"], { drainMs: CONFIRM_DRAIN_MS });
    clock.now += DRAIN_MS + 50;
    input.write("o");
    await new Promise((resolve) => setImmediate(resolve));
    clock.now += CONFIRM_DRAIN_MS;
    input.write("n");
    await expect(answer).resolves.toBe("n");
    hub.close();
  });
});

describe("terminal UI sanitises every helper (minor)", () => {
  it("info, ok, warn, error, title and summary strip control characters", () => {
    const out = new PassThrough();
    let written = "";
    out.on("data", (chunk) => (written += chunk));
    const ui = createUi({ out, color: false });
    const esc = String.fromCharCode(27);
    const bell = String.fromCharCode(7);
    ui.info(`a${esc}[2J`);
    ui.ok(`Envoyé à Fleurs${esc}]0;x${bell}.`);
    ui.warn(`À traiter par toi : ${esc}[31mrouge`);
    ui.error(`Erreur ${esc}[1A`);
    ui.title(`Titre${esc}[K`);
    ui.summary([`ligne${esc}[2K`]);
    ui.keysHint(["o"], { o: `O = ${esc}[31mok` });
    expect(written).not.toContain(esc);
    expect(written).not.toContain(bell);
    expect(written).toContain("À traiter par toi : [31mrouge");
  });
});
