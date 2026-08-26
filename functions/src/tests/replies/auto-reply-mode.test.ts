import { describe, it, expect } from "vitest";
import { dispatchReplyAccordingToPolicy } from "../../services/reply-dispatcher.js";
import { adminDb } from "../../config/firebase.js";
import type { ReplyDraft } from "../../types/domain.js";

describe("Autonomous Safe Auto-Reply Dispatcher (REQ-068)", () => {
  const sampleDraft: ReplyDraft = {
    subject: "Re: Diagnostic",
    bodyText: "Bonjour,\n\nUne refonte complète prend en moyenne 3 semaines. Seriez-vous disponible pour un court échange ?\n\nBien cordialement,",
    citedKnowledgePoints: ["Délai de livraison: 3 semaines"],
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

    // Verify outbound message was created
    const msgsSnap = await adminDb
      .collection("conversations")
      .doc(convId)
      .collection("messages")
      .get();
    expect(msgsSnap.docs.length).toBeGreaterThan(0);
  });
});
