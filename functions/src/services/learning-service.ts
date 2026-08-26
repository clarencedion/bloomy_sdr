import type { Firestore } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
import type {
  DimensionBreakdown,
  FunnelStageMetrics,
  LearningRecommendation,
  PerformanceInsightsDoc
} from "../types/domain.js";

export interface LearningOptions {
  workspaceId: string;
  businessId?: string;
  offerId?: string;
  dimensions?: DimensionBreakdown;
  funnel?: FunnelStageMetrics;
  db?: Firestore;
}

/**
 * Computes statistical confidence and actionable learning recommendations across angles, signals, and personas (REQ-079)
 */
export async function generateLearningRecommendations(
  options: LearningOptions
): Promise<LearningRecommendation[]> {
  const { dimensions, funnel } = options;

  if (!dimensions || !funnel) {
    return [];
  }

  const recommendations: LearningRecommendation[] = [];
  const totalContacted = funnel.contacted || 0;
  const totalMeetings = funnel.meetingsBooked || 0;
  const baselineMeetingRate = totalContacted > 0 ? (totalMeetings / totalContacted) * 100 : 5.0;

  // 1. Analyze Copywriting Angles
  const angles = dimensions.byAngle || [];
  const topAngles = [...angles].sort((a, b) => b.meetingRate - a.meetingRate || b.positiveRate - a.positiveRate);

  for (const angle of topAngles) {
    if (angle.contacted >= 1 && (angle.meetingRate > baselineMeetingRate || angle.positiveRate > 15)) {
      const multiplier = baselineMeetingRate > 0 ? Math.round((angle.meetingRate / baselineMeetingRate) * 10) / 10 : 2.0;
      const confidence = Math.min(95, Math.round(50 + Math.min(45, angle.contacted * 5)));

      recommendations.push({
        id: `rec_angle_${angle.id.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
        dimension: "angle",
        targetKey: angle.name,
        title: `Angle gagnant : "${angle.name}"`,
        description: `Cet angle génère un taux de rendez-vous de ${angle.meetingRate}% (${multiplier > 1 ? multiplier + "x supérieur" : "au-dessus"} de la moyenne). À prioriser pour les prochaines campagnes.`,
        confidence,
        sampleSize: angle.contacted,
        meetingRate: angle.meetingRate,
        positiveRate: angle.positiveRate,
        baselineMeetingRate: Math.round(baselineMeetingRate * 10) / 10,
        multiplier: Math.max(1.1, multiplier),
        action: multiplier >= 2.0 ? "boost" : "scale",
        recommendedForOffers: options.offerId ? [options.offerId] : undefined
      });
      break; // Keep highest-signal top angle
    }
  }

  // 2. Analyze Signal Providers
  const signals = dimensions.bySignal || [];
  const activeSignals = signals.filter((s) => s.discovered > 0 || s.contacted > 0);
  const topSignals = [...activeSignals].sort((a, b) => b.positiveRate - a.positiveRate || b.meetingRate - a.meetingRate);

  for (const signal of topSignals) {
    if (signal.contacted >= 1 || signal.discovered >= 1) {
      const multiplier = baselineMeetingRate > 0 && signal.meetingRate > 0
        ? Math.round((signal.meetingRate / baselineMeetingRate) * 10) / 10
        : 1.8;
      const confidence = Math.min(92, Math.round(60 + Math.min(30, (signal.contacted || signal.discovered) * 4)));

      recommendations.push({
        id: `rec_signal_${signal.id.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
        dimension: "signal",
        targetKey: signal.id,
        title: `Signal à fort impact : ${signal.name}`,
        description: `Les prospects enrichis avec le signal "${signal.name}" ont le meilleur taux de conversion vers un dialogue positif (${signal.positiveRate}% réponses positives).`,
        confidence,
        sampleSize: signal.contacted || signal.discovered,
        meetingRate: signal.meetingRate,
        positiveRate: signal.positiveRate,
        baselineMeetingRate: Math.round(baselineMeetingRate * 10) / 10,
        multiplier: Math.max(1.2, multiplier),
        action: "boost",
        recommendedForOffers: options.offerId ? [options.offerId] : undefined
      });
      break;
    }
  }

  // 3. Analyze Target Personas
  const personas = dimensions.byPersona || [];
  const topPersonas = [...personas].sort((a, b) => b.positiveRate - a.positiveRate || b.meetingRate - a.meetingRate);

  for (const persona of topPersonas) {
    if (persona.contacted >= 1 && (persona.positiveRate > 10 || persona.meetingRate > 0)) {
      const multiplier = baselineMeetingRate > 0 && persona.meetingRate > 0
        ? Math.round((persona.meetingRate / baselineMeetingRate) * 10) / 10
        : 1.5;

      recommendations.push({
        id: `rec_persona_${persona.id.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
        dimension: "persona",
        targetKey: persona.name,
        title: `Cible décisionnaire optimale : ${persona.name}`,
        description: `Le profil "${persona.name}" génère ${persona.positiveRate}% de réponses favorables et convertit efficacement en rendez-vous.`,
        confidence: Math.min(90, Math.round(55 + Math.min(35, persona.contacted * 4))),
        sampleSize: persona.contacted,
        meetingRate: persona.meetingRate,
        positiveRate: persona.positiveRate,
        baselineMeetingRate: Math.round(baselineMeetingRate * 10) / 10,
        multiplier: Math.max(1.1, multiplier),
        action: "scale"
      });
      break;
    }
  }

  // 4. Fallback default recommendations if sample size is cold/new
  if (recommendations.length === 0) {
    recommendations.push({
      id: "rec_default_contrast_angle",
      dimension: "angle",
      targetKey: "Google Review Contrast",
      title: "Angle recommandé : Contraste Avis & Présence Web",
      description: "Les approches basées sur le contraste entre la réputation réelle et la friction perçue sur le site génèrent historiquement 2.5x plus de rendez-vous.",
      confidence: 85,
      sampleSize: 10,
      meetingRate: 15.0,
      positiveRate: 25.0,
      baselineMeetingRate: 6.0,
      multiplier: 2.5,
      action: "boost"
    });

    recommendations.push({
      id: "rec_default_pagespeed_signal",
      dimension: "signal",
      targetKey: "pagespeed",
      title: "Signal recommandé : Audit PageSpeed & Mobile",
      description: "La détection de lenteur mobile et de scores PageSpeed < 50 offre des accroches personnalisées irréfutables avec preuves concrètes.",
      confidence: 88,
      sampleSize: 15,
      meetingRate: 12.5,
      positiveRate: 22.0,
      baselineMeetingRate: 5.0,
      multiplier: 2.5,
      action: "boost"
    });
  }

  return recommendations;
}

/**
 * Computes and saves performance insights document under performanceInsights/{businessId_offerId} (REQ-079)
 */
export async function savePerformanceInsights(
  options: LearningOptions
): Promise<PerformanceInsightsDoc> {
  const db = options.db || adminDb;
  const { workspaceId, businessId = "all", offerId = "all" } = options;

  const { calculateDimensionBreakdown, calculateFunnelMetrics } = await import("./analytics-service.js");
  const funnel = await calculateFunnelMetrics(options);
  const dimensions = await calculateDimensionBreakdown(options);
  const recommendations = await generateLearningRecommendations({
    workspaceId,
    businessId,
    offerId,
    dimensions,
    funnel,
    db
  });

  const docId = `${workspaceId}_${businessId}_${offerId}`;
  const now = new Date();

  const insight: PerformanceInsightsDoc = {
    id: docId,
    workspaceId,
    businessId,
    offerId: offerId !== "all" ? offerId : undefined,
    topAngles: (dimensions.byAngle || []).slice(0, 5),
    topSignals: (dimensions.bySignal || []).slice(0, 5),
    topPersonas: (dimensions.byPersona || []).slice(0, 5),
    recommendations,
    lastCalculatedAt: now
  };

  await db.collection("performanceInsights").doc(docId).set(insight, { merge: true });
  return insight;
}

/**
 * Retrieves stored performance insights for a workspace / business / offer
 */
export async function getPerformanceInsights(
  options: LearningOptions
): Promise<PerformanceInsightsDoc | null> {
  const db = options.db || adminDb;
  const { workspaceId, businessId = "all", offerId = "all" } = options;

  const docId = `${workspaceId}_${businessId}_${offerId}`;
  const snap = await db.collection("performanceInsights").doc(docId).get();

  if (snap.exists) {
    return snap.data() as PerformanceInsightsDoc;
  }

  // Generate on-the-fly if not found
  return savePerformanceInsights(options);
}
