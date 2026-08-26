import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../../config/firebase.js";
import { calculateFunnelMetrics, calculateRate } from "../../services/analytics-service.js";

describe("Full-Funnel Conversion Analytics (REQ-077)", () => {
  it("should calculate rates safely with division-by-zero protection", () => {
    expect(calculateRate(0, 0)).toBe(0);
    expect(calculateRate(5, 0)).toBe(0);
    expect(calculateRate(0, 10)).toBe(0);
    expect(calculateRate(1, 3)).toBe(33.3);
    expect(calculateRate(10, 20)).toBe(50.0);
    expect(calculateRate(10, 10)).toBe(100.0);
  });

  it("should accurately aggregate funnel stage counts and step conversion rates", async () => {
    const workspaceId = `ws_funnel_test_${Date.now()}`;
    const businessId = `biz_funnel_test_${Date.now()}`;
    const now = Timestamp.now();

    // 1. Seed 10 Companies: 10 discovered, 6 qualified, 2 won
    for (let i = 1; i <= 10; i++) {
      let status = "imported";
      let qualificationState = "DISQUALIFIED";

      if (i <= 6) {
        status = "qualified";
        qualificationState = "QUALIFIED";
      }
      if (i <= 4) {
        status = "contacted";
      }
      if (i <= 2) {
        status = "meeting_booked";
      }
      if (i === 1) {
        status = "won";
      }

      await adminDb.collection("companies").doc(`comp_${workspaceId}_${i}`).set({
        id: `comp_${workspaceId}_${i}`,
        workspaceId,
        businessId,
        name: `Company ${i}`,
        status,
        qualificationState,
        createdAt: now,
        updatedAt: now
      });
    }

    // 2. Seed Outreach: 4 contacted
    for (let i = 1; i <= 4; i++) {
      await adminDb.collection("outreach").doc(`out_${workspaceId}_${i}`).set({
        id: `out_${workspaceId}_${i}`,
        workspaceId,
        businessId,
        companyId: `comp_${workspaceId}_${i}`,
        status: i <= 2 ? "replied" : "sent",
        sentAt: now,
        createdAt: now,
        updatedAt: now
      });
    }

    // 3. Seed Conversations: 2 replied (1 positive, 1 booking request/meeting_booked)
    await adminDb.collection("conversations").doc(`conv_${workspaceId}_1`).set({
      id: `conv_${workspaceId}_1`,
      workspaceId,
      businessId,
      companyId: `comp_${workspaceId}_1`,
      status: "meeting_booked",
      latestIntent: "BOOKING_REQUEST",
      messageCount: 3,
      createdAt: now,
      updatedAt: now
    });

    await adminDb.collection("conversations").doc(`conv_${workspaceId}_2`).set({
      id: `conv_${workspaceId}_2`,
      workspaceId,
      businessId,
      companyId: `comp_${workspaceId}_2`,
      status: "in_dialogue",
      latestIntent: "POSITIVE",
      messageCount: 2,
      createdAt: now,
      updatedAt: now
    });

    // 4. Seed Meetings: 2 booked meetings
    await adminDb.collection("meetings").doc(`meet_${workspaceId}_1`).set({
      id: `meet_${workspaceId}_1`,
      workspaceId,
      businessId,
      companyId: `comp_${workspaceId}_1`,
      title: "Diagnostic E-Commerce",
      startTime: now,
      status: "completed",
      source: "conversational",
      createdAt: now,
      updatedAt: now
    });

    await adminDb.collection("meetings").doc(`meet_${workspaceId}_2`).set({
      id: `meet_${workspaceId}_2`,
      workspaceId,
      businessId,
      companyId: `comp_${workspaceId}_2`,
      title: "Audit & Consultation",
      startTime: now,
      status: "scheduled",
      source: "conversational",
      createdAt: now,
      updatedAt: now
    });

    const metrics = await calculateFunnelMetrics({ workspaceId, businessId });

    expect(metrics.discovered).toBe(10);
    expect(metrics.qualified).toBe(6);
    expect(metrics.contacted).toBe(4);
    expect(metrics.replied).toBe(2);
    expect(metrics.positiveReplies).toBe(2);
    expect(metrics.meetingsBooked).toBe(2);
    expect(metrics.won).toBe(1);

    // Check step conversion rates
    expect(metrics.discoveredToQualifiedRate).toBe(60.0); // 6 / 10 * 100
    expect(metrics.qualifiedToContactedRate).toBe(66.7);  // 4 / 6 * 100
    expect(metrics.contactedToRepliedRate).toBe(50.0);    // 2 / 4 * 100
    expect(metrics.repliedToPositiveRate).toBe(100.0);    // 2 / 2 * 100
    expect(metrics.positiveToMeetingRate).toBe(100.0);    // 2 / 2 * 100
    expect(metrics.meetingToWonRate).toBe(50.0);          // 1 / 2 * 100
    expect(metrics.overallDiscoveryToMeetingRate).toBe(20.0); // 2 / 10 * 100
  });
});
