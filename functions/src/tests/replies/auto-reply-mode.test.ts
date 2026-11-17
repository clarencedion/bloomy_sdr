import { describe, it, expect, vi } from "vitest";

// Phase 19: nothing is marked sent unless a transport delivered it. No real
// provider exists yet, so these tests inject one (and remove it) explicitly.
const transport = vi.hoisted(() => ({
  current: null as null | { name: string; sendReply: ReturnType<typeof vi.fn> }
}));
vi.mock("../../services/reply-transport.js", () => ({
  getReplyTransport: async () => transport.current
}));

import { dispatchReplyAccordingToPolicy } from "../../services/reply-dispatcher.js";
import { adminDb } from "../../config/firebase.js";
import type { ReplyDraft } from "../../types/domain.js";

describe("Autonomous Safe Auto-Reply Dispatcher (REQ-068)", () => {
  const sampleDraft: ReplyDraft = {
    subject: "Re: Diagnostic",
    // Non-commercial on purpose: commercial wording (prices, durations…) is
    // never auto-sent (ADR-019), which is tested separately.
    bodyText: "Bonjour,\n\nMerci pour votre message. Seriez-vous disponible jeudi à 14h pour un court échange ?\n\nBien cordialement,",
    citedKnowledgePoints: [],
    pricingGuardrailPassed: true,
    pricingDisclosed: false,
    prohibitedPromisesChecked: true,
    confidence: 0.92,
    draftedAt: new Date().toISOString(),
    status: "draft"
  };

  it("should queue draft for human review under MANUAL policy mode", async () => {
    const convId = `conv_test_manual_${Date.now()}`;
    await adminDb.collection("workspaces").doc("ws_test").collection("businesses").doc("biz_manual").set({
      id: "biz_manual",
      workspaceId: "ws_test",
      automationPolicy: {
        mode: "manual",
        dailyOutreachLimit: 50,
        dailyDiscoveryLimit: 50,
        requireApprovalBeforeSend: true,
        autoReplySafeThreshold: 0.85
      }
    });

    const result = await dispatchReplyAccordingToPolicy({
      conversationId: convId,
      draft: sampleDraft,
      workspaceId: "ws_test",
      businessId: "biz_manual",
      leadEmail: "prospect@manual.fr",
      classification: {
        intent: "QUESTION",
        confidence: 0.9
      }
    });

    expect(result.action).toBe("queued_for_human_review");
    expect(result.policyMode).toBe("manual");
    expect(result.draft.status).toBe("queued_for_approval");

    const convSnap = await adminDb.collection("conversations").doc(convId).get();
    const convData = convSnap.data();
    expect(convData?.status).toBe("in_dialogue");
    expect(convData?.humanAttentionRequired).toBe(true);
  });

  it("should queue draft for 1-click approval under ASSISTED policy mode", async () => {
    const convId = `conv_test_assisted_${Date.now()}`;
    await adminDb.collection("workspaces").doc("ws_test").collection("businesses").doc("biz_assisted").set({
      id: "biz_assisted",
      workspaceId: "ws_test",
      automationPolicy: {
        mode: "assisted",
        dailyOutreachLimit: 50,
        dailyDiscoveryLimit: 50,
        requireApprovalBeforeSend: false,
        autoReplySafeThreshold: 0.85
      }
    });

    const result = await dispatchReplyAccordingToPolicy({
      conversationId: convId,
      draft: sampleDraft,
      workspaceId: "ws_test",
      businessId: "biz_assisted",
      leadEmail: "prospect@assisted.fr",
      classification: {
        intent: "QUESTION",
        confidence: 0.92
      }
    });

    expect(result.action).toBe("queued_for_one_click_approval");
    expect(result.policyMode).toBe("assisted");
    expect(result.draft.status).toBe("queued_for_approval");

    const convSnap = await adminDb.collection("conversations").doc(convId).get();
    const convData = convSnap.data();
    expect(convData?.unreadHumanAttention).toBe(true);
  });

  it("should auto-dispatch verified safe replies under AUTONOMOUS_SAFE policy mode", async () => {
    const sendReply = vi.fn(async () => ({ providerMessageId: "prov_1" }));
    transport.current = { name: "mock", sendReply };
    const convId = `conv_test_auto_${Date.now()}`;
    await adminDb.collection("workspaces").doc("ws_test").collection("businesses").doc("biz_auto").set({
      id: "biz_auto",
      workspaceId: "ws_test",
      automationPolicy: {
        mode: "autonomous_safe",
        dailyOutreachLimit: 50,
        dailyDiscoveryLimit: 50,
        requireApprovalBeforeSend: false,
        autoReplySafeThreshold: 0.85
      }
    });

    const result = await dispatchReplyAccordingToPolicy({
      conversationId: convId,
      draft: sampleDraft,
      workspaceId: "ws_test",
      businessId: "biz_auto",
      leadEmail: "prospect@auto.fr",
      classification: {
        intent: "QUESTION",
        confidence: 0.92
      },
      bypassDelay: true
    });

    expect(result.action).toBe("auto_dispatched");
    expect(result.policyMode).toBe("autonomous_safe");
    expect(result.draft.status).toBe("auto_dispatched");
    expect(result.outboundMessageId).toBeDefined();
    // Delivered through the transport, not merely recorded.
    expect(sendReply).toHaveBeenCalledTimes(1);
    transport.current = null;

    // Verify outbound message was created
    const msgsSnap = await adminDb
      .collection("conversations")
      .doc(convId)
      .collection("messages")
      .get();
    expect(msgsSnap.docs.length).toBeGreaterThan(0);
  });

  it("hands the reply to a person when nothing can actually send it", async () => {
    transport.current = null;
    const result = await dispatchReplyAccordingToPolicy({
      conversationId: `conv_test_notransport_${Date.now()}`,
      draft: sampleDraft,
      workspaceId: "ws_test",
      businessId: "biz_auto",
      leadEmail: "prospect@auto.fr",
      classification: { intent: "QUESTION", confidence: 0.92 },
      bypassDelay: true
    });
    expect(result.action).toBe("escalated_to_human");
  });

  it("hands a reply the commercial-vocabulary gate flags to a person", async () => {
    const sendReply = vi.fn(async () => ({ providerMessageId: "prov_2" }));
    transport.current = { name: "mock", sendReply };
    const result = await dispatchReplyAccordingToPolicy({
      conversationId: `conv_test_commercial_${Date.now()}`,
      draft: { ...sampleDraft, bodyText: "Bonjour,\n\nNous vous offrons le premier mois.\n\nBien cordialement," },
      workspaceId: "ws_test",
      businessId: "biz_auto",
      leadEmail: "prospect@auto.fr",
      classification: { intent: "QUESTION", confidence: 0.92 },
      bypassDelay: true
    });
    expect(result.action).toBe("escalated_to_human");
    expect(sendReply).not.toHaveBeenCalled();
    transport.current = null;
  });
});
