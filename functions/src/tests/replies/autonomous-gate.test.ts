import { describe, it, expect, vi, beforeEach } from "vitest";

// Offline: Firestore, the business read, escalation and the transport are
// stubbed, so the dispatcher's autonomy decision itself is what runs.
const state = vi.hoisted(() => ({
  transport: null as null | { name: string; sendReply: ReturnType<typeof vi.fn> },
  contactAllowed: true,
  escalations: [] as Array<{ reason: string }>,
  messages: [] as unknown[]
}));

vi.mock("../../config/firebase.js", () => {
  const conversation = {
    set: async () => undefined,
    get: async () => ({ exists: true, data: () => ({ messageCount: 1 }) }),
    collection: () => ({ doc: () => ({ set: async (data: unknown) => void state.messages.push(data) }) })
  };
  return { adminDb: { collection: () => ({ doc: () => conversation }) } };
});
vi.mock("../../utils/logger.js", () => ({ writeLog: async () => undefined }));
vi.mock("../../services/business-service.js", () => ({
  getBusiness: async () => ({ automationPolicy: { mode: "autonomous_safe", autoReplySafeThreshold: 0.85 } })
}));
vi.mock("../../services/sender-resolver.js", () => ({ resolveSenderEmail: async () => "hello@business.test" }));
vi.mock("../../services/human-escalator.js", () => ({
  escalateConversation: async (input: { reason: string }) => void state.escalations.push(input)
}));
vi.mock("../../services/reply-transport.js", () => ({ getReplyTransport: async () => state.transport }));
vi.mock("../../services/can-contact.js", () => ({
  canContact: async () => (state.contactAllowed ? { allowed: true } : { allowed: false, reason: "email_suppressed" }),
  canContactDetails: async () => (state.contactAllowed ? { allowed: true } : { allowed: false, reason: "email_suppressed" })
}));

import { dispatchReplyAccordingToPolicy } from "../../services/reply-dispatcher.js";
import type { ReplyDraft } from "../../types/domain.js";

const draft = (bodyText: string): ReplyDraft => ({
  subject: "Re: Votre site",
  bodyText,
  citedKnowledgePoints: [],
  pricingGuardrailPassed: true,
  pricingDisclosed: false,
  prohibitedPromisesChecked: true,
  confidence: 0.95,
  draftedAt: new Date().toISOString(),
  status: "draft"
});

const dispatch = (bodyText: string) =>
  dispatchReplyAccordingToPolicy({
    conversationId: "conv_gate",
    draft: draft(bodyText),
    workspaceId: "ws_test",
    businessId: "biz_test",
    leadEmail: "prospect@example.fr",
    classification: { intent: "QUESTION", confidence: 0.95 },
    bypassDelay: true
  });

describe("Phase 19 — autonomous dispatch is fail-closed (offline)", () => {
  beforeEach(() => {
    state.transport = null;
    state.contactAllowed = true;
    state.escalations = [];
    state.messages = [];
  });

  it("sends a safe, non-commercial reply through the transport before recording it", async () => {
    const sendReply = vi.fn(async () => ({ providerMessageId: "prov_1" }));
    state.transport = { name: "mock", sendReply };
    const result = await dispatch("Bonjour, seriez-vous disponible jeudi à 14h pour en parler ?");
    expect(result.action).toBe("auto_dispatched");
    expect(sendReply).toHaveBeenCalledTimes(1);
    expect(state.messages).toHaveLength(1);
  });

  it("never marks a reply sent when nothing can deliver it", async () => {
    const result = await dispatch("Bonjour, seriez-vous disponible jeudi à 14h pour en parler ?");
    expect(result.action).toBe("escalated_to_human");
    expect(state.messages).toHaveLength(0);
    expect(state.escalations[0].reason).toMatch(/not sent by the SDR yet/);
  });

  it("hands any commercial wording to a person even with a transport and a passing detector", async () => {
    const sendReply = vi.fn(async () => ({ providerMessageId: "prov_2" }));
    state.transport = { name: "mock", sendReply };
    for (const text of ["Nous vous offrons le premier mois.", "Résiliation possible à tout moment.", "Seulement 39 HT par mois."]) {
      const result = await dispatch(text);
      expect(result.action).toBe("escalated_to_human");
    }
    expect(sendReply).not.toHaveBeenCalled();
    expect(state.escalations.every((e) => /price, free items, discounts or commitment/.test(e.reason))).toBe(true);
  });

  it("re-checks suppression right before delivery and sends nothing to a suppressed prospect", async () => {
    const sendReply = vi.fn(async () => ({ providerMessageId: "prov_3" }));
    state.transport = { name: "mock", sendReply };
    state.contactAllowed = false;
    const result = await dispatch("Bonjour, seriez-vous disponible jeudi à 14h pour en parler ?");
    expect(result.action).toBe("escalated_to_human");
    expect(sendReply).not.toHaveBeenCalled();
    expect(state.messages).toHaveLength(0);
    expect(state.escalations[0].reason).toMatch(/cannot be contacted/);
  });
});
