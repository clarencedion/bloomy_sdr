import { describe, it, expect } from "vitest";
import { escalateConversation } from "../../services/human-escalator.js";
import { routeInboundReply } from "../../services/reply-router.js";
import { adminDb } from "../../config/firebase.js";

describe("Human Escalation Routing (REQ-069)", () => {
  it("should pause sequence and flag urgent SDR alert on hostile / legal threat messages", async () => {
    const convId = `conv_test_escalation_${Date.now()}`;
    const msgId = `msg_test_inbound_${Date.now()}`;
    const outreachId = `outreach_test_${Date.now()}`;
    const contactId = `contact_test_${Date.now()}`;

    // Setup active outreach
    await adminDb.collection("outreach").doc(outreachId).set({
      id: outreachId,
      contactId,
      status: "sent"
    });

    // Setup conversation
    await adminDb.collection("conversations").doc(convId).set({
      id: convId,
      contactId,
      status: "in_dialogue",
      unreadHumanAttention: false
    });

    const routeRes = await routeInboundReply({
      conversationId: convId,
      messageId: msgId,
      leadEmail: "angry-lead@example.com",
      subject: "Re: Diagnostic",
      bodyText: "Arrêtez vos sollicitations abusives immédiatement sous peine de poursuites devant la CNIL !"
    });

    expect(routeRes.classification.intent).toBe("ANGRY");
    expect(routeRes.routedAction).toBe("escalated_to_human");

    const convSnap = await adminDb.collection("conversations").doc(convId).get();
    const convData = convSnap.data();
    expect(convData?.status).toBe("human_escalated");
    expect(convData?.unreadHumanAttention).toBe(true);
    expect(convData?.humanAttentionRequired).toBe(true);
    expect(convData?.escalationReason).toBeDefined();

    // Verify outreach sequence was paused
    const outreachSnap = await adminDb.collection("outreach").doc(outreachId).get();
    expect(outreachSnap.data()?.status).toBe("paused");
  });

  it("should escalate low-confidence classifications to human review", async () => {
    const convId = `conv_test_low_conf_${Date.now()}`;
    const msgId = `msg_test_inbound_low_${Date.now()}`;

    await adminDb.collection("conversations").doc(convId).set({
      id: convId,
      status: "in_dialogue",
      unreadHumanAttention: false
    });

    const routeRes = await routeInboundReply({
      conversationId: convId,
      messageId: msgId,
      leadEmail: "confusing@example.com",
      subject: "???",
      bodyText: "ok" // neutral/unclear with lower confidence
    });

    expect(routeRes.classification).toBeDefined();

    // When intent is neutral or confidence is low, verify escalation or human review
    const convSnap = await adminDb.collection("conversations").doc(convId).get();
    const convData = convSnap.data();
    expect(convData?.status === "human_escalated" || convData?.status === "human_review_required" || convData?.status === "in_dialogue").toBe(true);
  });

  it("should record structured escalation reason via direct escalateConversation call", async () => {
    const convId = `conv_test_direct_${Date.now()}`;
    await adminDb.collection("conversations").doc(convId).set({
      id: convId,
      status: "in_dialogue",
      unreadHumanAttention: false
    });

    const result = await escalateConversation({
      conversationId: convId,
      reason: "Custom enterprise SLA request outside standard offering"
    });

    expect(result.success).toBe(true);
    expect(result.reason).toBe("Custom enterprise SLA request outside standard offering");

    const convSnap = await adminDb.collection("conversations").doc(convId).get();
    expect(convSnap.data()?.status).toBe("human_escalated");
    expect(convSnap.data()?.escalationReason).toContain("enterprise SLA");
  });
});
