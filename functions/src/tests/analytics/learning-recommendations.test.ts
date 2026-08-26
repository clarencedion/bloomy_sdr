import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../../config/firebase.js";
import {
  generateLearningRecommendations,
  getPerformanceInsights,
  savePerformanceInsights
} from "../../services/learning-service.js";
import type { DimensionBreakdown, FunnelStageMetrics } from "../../types/domain.js";

describe("Closed-Loop Learning & Recommendations (REQ-079)", () => {
  it("should rank high-converting signals and angles and generate actionable recommendations", async () => {
    const funnel: FunnelStageMetrics = {
      discovered: 100,
      qualified: 50,
      contacted: 40,
      replied: 10,
      positiveReplies: 6,
      meetingsBooked: 4,
      won: 1,
      discoveredToQualifiedRate: 50,
      qualifiedToContactedRate: 80,
      contactedToRepliedRate: 25,
      repliedToPositiveRate: 60,
      positiveToMeetingRate: 66.7,
      meetingToWonRate: 25,
      overallDiscoveryToMeetingRate: 4
    };

    const dimensions: DimensionBreakdown = {
      bySignal: [
        {
          id: "pagespeed",
          name: "Google PageSpeed Insights",
          dimension: "signal",
          discovered: 30,
          contacted: 20,
          replied: 8,
          positiveReplies: 5,
          meetingsBooked: 3,
          won: 1,
          replyRate: 40,
          positiveRate: 25,
          meetingRate: 15,
          conversionIndex: 1.5
        },
        {
          id: "company_scale",
          name: "Taille & Effectifs Sirene",
          dimension: "signal",
          discovered: 40,
          contacted: 20,
          replied: 2,
          positiveReplies: 1,
          meetingsBooked: 1,
          won: 0,
          replyRate: 10,
          positiveRate: 5,
          meetingRate: 5,
          conversionIndex: 0.5
        }
      ],
      byAngle: [
        {
          id: "Google Review Contrast",
          name: "Google Review Contrast",
          dimension: "angle",
          discovered: 20,
          contacted: 15,
          replied: 6,
          positiveReplies: 4,
          meetingsBooked: 3,
          won: 1,
          replyRate: 40,
          positiveRate: 26.7,
          meetingRate: 20.0, // 2x baseline
          conversionIndex: 2.0
        },
        {
          id: "Generic Cold Pitch",
          name: "Generic Cold Pitch",
          dimension: "angle",
          discovered: 20,
          contacted: 25,
          replied: 4,
          positiveReplies: 2,
          meetingsBooked: 1,
          won: 0,
          replyRate: 16,
          positiveRate: 8,
          meetingRate: 4.0,
          conversionIndex: 0.4
        }
      ],
      byPersona: [
        {
          id: "Fondateur / Dirigeant",
          name: "Fondateur / Dirigeant",
          dimension: "persona",
          discovered: 50,
          contacted: 30,
          replied: 8,
          positiveReplies: 5,
          meetingsBooked: 3,
          won: 1,
          replyRate: 26.7,
          positiveRate: 16.7,
          meetingRate: 10.0,
          conversionIndex: 1.0
        }
      ],
      byCampaign: [],
      byNaf: []
    };

    const recs = await generateLearningRecommendations({
      workspaceId: "ws_test_rec",
      businessId: "biz_test_rec",
      dimensions,
      funnel
    });

    expect(recs.length).toBeGreaterThan(0);

    // Angle recommendation
    const angleRec = recs.find((r) => r.dimension === "angle");
    expect(angleRec).toBeDefined();
    expect(angleRec?.targetKey).toBe("Google Review Contrast");
    expect(angleRec?.multiplier).toBeGreaterThanOrEqual(1.5);
    expect(["boost", "scale"]).toContain(angleRec?.action);
    expect(angleRec?.confidence).toBeGreaterThanOrEqual(50);

    // Signal recommendation
    const signalRec = recs.find((r) => r.dimension === "signal");
    expect(signalRec).toBeDefined();
    expect(signalRec?.targetKey).toBe("pagespeed");
    expect(signalRec?.positiveRate).toBe(25);
  });

  it("should persist and retrieve performance insights doc from Firestore", async () => {
    const workspaceId = `ws_insights_${Date.now()}`;
    const businessId = `biz_insights_${Date.now()}`;
    const offerId = `offer_website_${Date.now()}`;
    const now = Timestamp.now();

    // Seed one company and meeting to verify persistence
    await adminDb.collection("companies").doc(`comp_${workspaceId}`).set({
      id: `comp_${workspaceId}`,
      workspaceId,
      businessId,
      name: "Atelier Floral",
      status: "meeting_booked",
      createdAt: now,
      updatedAt: now
    });

    const saved = await savePerformanceInsights({ workspaceId, businessId, offerId });

    expect(saved).toBeDefined();
    expect(saved.workspaceId).toBe(workspaceId);
    expect(saved.businessId).toBe(businessId);
    expect(saved.offerId).toBe(offerId);

    // Retrieve via getPerformanceInsights
    const retrieved = await getPerformanceInsights({ workspaceId, businessId, offerId });
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(`${workspaceId}_${businessId}_${offerId}`);
  });
});
