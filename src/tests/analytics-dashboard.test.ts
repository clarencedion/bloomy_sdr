import { describe, expect, it } from "vitest";
import type {
  AnalyticsSummary,
  DimensionBreakdown,
  DimensionMetric,
  FunnelStageMetrics,
  LearningRecommendation
} from "@/types/domain";

describe("Analytics & Closed-Loop Learning Dashboard (REQ-077, REQ-078, REQ-079)", () => {
  it("should validate complete FunnelStageMetrics and step conversion rates (REQ-077)", () => {
    const funnel: FunnelStageMetrics = {
      discovered: 250,
      qualified: 150,
      contacted: 100,
      replied: 30,
      positiveReplies: 15,
      meetingsBooked: 10,
      won: 3,
      discoveredToQualifiedRate: 60.0,
      qualifiedToContactedRate: 66.7,
      contactedToRepliedRate: 30.0,
      repliedToPositiveRate: 50.0,
      positiveToMeetingRate: 66.7,
      meetingToWonRate: 30.0,
      overallDiscoveryToMeetingRate: 4.0
    };

    expect(funnel.discovered).toBe(250);
    expect(funnel.qualified).toBe(150);
    expect(funnel.contacted).toBe(100);
    expect(funnel.replied).toBe(30);
    expect(funnel.positiveReplies).toBe(15);
    expect(funnel.meetingsBooked).toBe(10);
    expect(funnel.won).toBe(3);

    // Verify mathematical consistency of step rates
    expect(funnel.discoveredToQualifiedRate).toBe((150 / 250) * 100);
    expect(funnel.overallDiscoveryToMeetingRate).toBe((10 / 250) * 100);
  });

  it("should validate DimensionBreakdown sliced across signals, angles, and personas (REQ-078)", () => {
    const angleMetric: DimensionMetric = {
      id: "Google Review Contrast",
      name: "Google Review Contrast",
      dimension: "angle",
      discovered: 50,
      contacted: 40,
      replied: 16,
      positiveReplies: 10,
      meetingsBooked: 8,
      won: 2,
      replyRate: 40.0,
      positiveRate: 25.0,
      meetingRate: 20.0,
      conversionIndex: 2.5
    };

    const signalMetric: DimensionMetric = {
      id: "pagespeed",
      name: "Google PageSpeed Insights",
      dimension: "signal",
      discovered: 60,
      contacted: 45,
      replied: 18,
      positiveReplies: 12,
      meetingsBooked: 9,
      won: 3,
      replyRate: 40.0,
      positiveRate: 26.7,
      meetingRate: 20.0,
      conversionIndex: 2.5
    };

    const personaMetric: DimensionMetric = {
      id: "Fondateur / Dirigeant",
      name: "Fondateur / Dirigeant",
      dimension: "persona",
      discovered: 100,
      contacted: 70,
      replied: 25,
      positiveReplies: 15,
      meetingsBooked: 10,
      won: 3,
      replyRate: 35.7,
      positiveRate: 21.4,
      meetingRate: 14.3,
      conversionIndex: 1.8
    };

    const breakdown: DimensionBreakdown = {
      bySignal: [signalMetric],
      byAngle: [angleMetric],
      byPersona: [personaMetric],
      byCampaign: [],
      byNaf: []
    };

    expect(breakdown.byAngle[0].meetingRate).toBe(20.0);
    expect(breakdown.byAngle[0].conversionIndex).toBe(2.5);
    expect(breakdown.bySignal[0].id).toBe("pagespeed");
    expect(breakdown.byPersona[0].meetingsBooked).toBe(10);
  });

  it("should validate LearningRecommendation properties and actions (REQ-079)", () => {
    const recommendation: LearningRecommendation = {
      id: "rec_angle_contrast",
      dimension: "angle",
      targetKey: "Google Review Contrast",
      title: 'Angle gagnant : "Google Review Contrast"',
      description: "Cet angle génère 22% de taux de rendez-vous (2.8x supérieur à la moyenne).",
      confidence: 90,
      sampleSize: 40,
      meetingRate: 22.0,
      positiveRate: 30.0,
      baselineMeetingRate: 7.8,
      multiplier: 2.8,
      action: "boost",
      recommendedForOffers: ["offer_website_dev"]
    };

    expect(recommendation.action).toBe("boost");
    expect(recommendation.multiplier).toBeGreaterThan(1.0);
    expect(recommendation.confidence).toBeGreaterThanOrEqual(80);
    expect(recommendation.meetingRate).toBeGreaterThan(recommendation.baselineMeetingRate);
  });

  it("should assemble a complete valid AnalyticsSummary structure", () => {
    const summary: AnalyticsSummary = {
      workspaceId: "ws_default",
      businessId: "biz_bloomy",
      funnel: {
        discovered: 100,
        qualified: 60,
        contacted: 40,
        replied: 12,
        positiveReplies: 6,
        meetingsBooked: 4,
        won: 1,
        discoveredToQualifiedRate: 60,
        qualifiedToContactedRate: 66.7,
        contactedToRepliedRate: 30,
        repliedToPositiveRate: 50,
        positiveToMeetingRate: 66.7,
        meetingToWonRate: 25,
        overallDiscoveryToMeetingRate: 4
      },
      dimensions: {
        bySignal: [],
        byAngle: [],
        byPersona: [],
        byCampaign: [],
        byNaf: []
      },
      recommendations: [
        {
          id: "rec_test",
          dimension: "signal",
          targetKey: "pagespeed",
          title: "Signal clé : PageSpeed",
          description: "Génère un fort taux d'engagement",
          confidence: 85,
          sampleSize: 20,
          meetingRate: 15,
          positiveRate: 25,
          baselineMeetingRate: 5,
          multiplier: 3.0,
          action: "boost"
        }
      ],
      dailySnapshots: [
        {
          date: "2026-08-25",
          discovered: 100,
          contacted: 40,
          replied: 12,
          positiveReplies: 6,
          meetingsBooked: 4
        }
      ],
      calculatedAt: new Date().toISOString()
    };

    expect(summary.workspaceId).toBe("ws_default");
    expect(summary.businessId).toBe("biz_bloomy");
    expect(summary.recommendations.length).toBe(1);
    expect(summary.dailySnapshots.length).toBe(1);
  });
});
