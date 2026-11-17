/**
 * Phase 23 review #19 — the "I sent it on …" action tells the backend which
 * network the DM went out on, so the conversation is opened there and that
 * network's inbox session picks up the reply.
 *
 * Offline only: the Firebase client and callable layer are mocked; nothing
 * reaches a project.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: Array<{ name: string; data: unknown }> = [];

vi.mock("@/lib/firebase/client", () => ({ app: {}, db: {}, auth: {}, storage: {} }));
vi.mock("firebase/functions", () => ({
  getFunctions: () => ({}),
  httpsCallable: (_functions: unknown, name: string) => async (data: unknown) => {
    calls.push({ name, data });
    return { data: { success: true } };
  }
}));

import { callMarkSocialDmSent } from "@/lib/firebase/functions";

describe("callMarkSocialDmSent", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("sends the network the operator chose", async () => {
    await callMarkSocialDmSent("out_1", "facebook");
    expect(calls).toEqual([{ name: "markSocialDmSentCallable", data: { outreachId: "out_1", network: "facebook" } }]);

    await callMarkSocialDmSent("out_2", "instagram");
    expect(calls[1]).toEqual({ name: "markSocialDmSentCallable", data: { outreachId: "out_2", network: "instagram" } });
  });

  it("sends no network key for a contact form or a link with no known network", async () => {
    await callMarkSocialDmSent("out_form");
    await callMarkSocialDmSent("out_legacy", undefined);
    expect(calls.map((call) => call.data)).toEqual([{ outreachId: "out_form" }, { outreachId: "out_legacy" }]);
  });
});
