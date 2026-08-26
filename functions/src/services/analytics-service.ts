import type { Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
import type {
  AnalyticsDailyDoc,
  AnalyticsSummary,
  DimensionBreakdown,
  DimensionMetric,
  FunnelStageMetrics
} from "../types/domain.js";
import { generateLearningRecommendations } from "./learning-service.js";

export interface AnalyticsQueryOptions {
  workspaceId: string;
  businessId?: string;
  offerId?: string;
  campaignId?: string;
  db?: Firestore;
}

/**
 * Safely compute percentage with division-by-zero protection and rounding
 */
export function calculateRate(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0 || !numerator || numerator <= 0) return 0;
  const rate = (numerator / denominator) * 100;
  return Math.round(rate * 10) / 10;
}

/**
 * Calculates full pipeline funnel stage counts and conversion rates (REQ-077)
 */
export async function calculateFunnelMetrics(
  options: AnalyticsQueryOptions
): Promise<FunnelStageMetrics> {
  const db = options.db || adminDb;
  const { workspaceId, businessId, offerId, campaignId } = options;

  // 1. Fetch Companies in scope
  let compQuery = db.collection("companies").where("workspaceId", "==", workspaceId);
  if (businessId) compQuery = compQuery.where("businessId", "==", businessId);
  if (campaignId) compQuery = compQuery.where("discoveryCampaignId", "==", campaignId);
  const companiesSnap = await compQuery.get();

  let discovered = 0;
  let qualified = 0;
  let won = 0;

  companiesSnap.forEach((doc: QueryDocumentSnapshot) => {
    const data = doc.data();
    discovered++;
    const status = String(data.status || "");
    const qState = String(data.qualificationState || "");

    if (
      qState === "QUALIFIED" ||
      qState === "HIGH_PRIORITY" ||
      ["qualified", "approved", "contacted", "replied", "meeting_booked", "won"].includes(status)
    ) {
      qualified++;
    }

    if (status === "won") {
      won++;
    }
  });

  // 2. Fetch Outreach in scope
  let outreachQuery = db.collection("outreach").where("workspaceId", "==", workspaceId);
  if (businessId) outreachQuery = outreachQuery.where("businessId", "==", businessId);
  if (offerId) outreachQuery = outreachQuery.where("offerId", "==", offerId);
  if (campaignId) outreachQuery = outreachQuery.where("campaignId", "==", campaignId);
  const outreachSnap = await outreachQuery.get();

  let contacted = 0;
  outreachSnap.forEach((doc: QueryDocumentSnapshot) => {
    const data = doc.data();
    const status = String(data.status || "");
    if (["sent", "replied", "bounced", "suppressed"].includes(status) || data.sentAt) {
      contacted++;
    }
  });

  // Fallback: If companies were marked contacted but no separate outreach docs exist
  if (contacted === 0) {
    companiesSnap.forEach((doc: QueryDocumentSnapshot) => {
      const status = String(doc.data().status || "");
      if (["contacted", "replied", "meeting_booked", "won"].includes(status)) {
        contacted++;
      }
    });
  }

  // 3. Fetch Conversations & Inbound Replies in scope
  let convQuery = db.collection("conversations").where("workspaceId", "==", workspaceId);
  if (businessId) convQuery = convQuery.where("businessId", "==", businessId);
  if (campaignId) convQuery = convQuery.where("campaignId", "==", campaignId);
  const convSnap = await convQuery.get();

  let replied = 0;
  let positiveReplies = 0;

  convSnap.forEach((doc: QueryDocumentSnapshot) => {
    const data = doc.data();
    const status = String(data.status || "");
    const latestIntent = String(data.latestIntent || "").toUpperCase();
    const msgCount = Number(data.messageCount || 0);

    const isReplied =
      ["in_dialogue", "human_escalated", "human_review_required", "meeting_booked"].includes(status) ||
      msgCount > 1 ||
      Boolean(latestIntent);

    if (isReplied) {
      replied++;
    }

    if (latestIntent === "POSITIVE" || latestIntent === "BOOKING_REQUEST" || status === "meeting_booked") {
      positiveReplies++;
    }
  });

  // Fallback for replied from companies
  if (replied === 0) {
    companiesSnap.forEach((doc: QueryDocumentSnapshot) => {
      const status = String(doc.data().status || "");
      if (["replied", "meeting_booked", "won"].includes(status)) {
        replied++;
      }
    });
  }

  // 4. Fetch Meetings in scope
  let meetingsQuery = db.collection("meetings").where("workspaceId", "==", workspaceId);
  if (businessId) meetingsQuery = meetingsQuery.where("businessId", "==", businessId);
  const meetingsSnap = await meetingsQuery.get();

  let meetingsBooked = 0;
  meetingsSnap.forEach((doc: QueryDocumentSnapshot) => {
    const data = doc.data();
    const status = String(data.status || "scheduled");
    if (status !== "cancelled") {
      meetingsBooked++;
    }
  });

  // Calculate step conversion rates
  const discoveredToQualifiedRate = calculateRate(qualified, discovered);
  const qualifiedToContactedRate = calculateRate(contacted, qualified);
  const contactedToRepliedRate = calculateRate(replied, contacted);
  const repliedToPositiveRate = calculateRate(positiveReplies, replied);
  const positiveToMeetingRate = calculateRate(meetingsBooked, positiveReplies);
  const meetingToWonRate = calculateRate(won, meetingsBooked);
  const overallDiscoveryToMeetingRate = calculateRate(meetingsBooked, discovered);

  return {
    discovered,
    qualified,
    contacted,
    replied,
    positiveReplies,
    meetingsBooked,
    won,
    discoveredToQualifiedRate,
    qualifiedToContactedRate,
    contactedToRepliedRate,
    repliedToPositiveRate,
    positiveToMeetingRate,
    meetingToWonRate,
    overallDiscoveryToMeetingRate
  };
}

/**
 * Calculates granular performance sliced across dimensions (REQ-078)
 */
export async function calculateDimensionBreakdown(
  options: AnalyticsQueryOptions
): Promise<DimensionBreakdown> {
  const db = options.db || adminDb;
  const { workspaceId, businessId, campaignId } = options;

  // Pull all relevant datasets
  let compQuery = db.collection("companies").where("workspaceId", "==", workspaceId);
  if (businessId) compQuery = compQuery.where("businessId", "==", businessId);
  if (campaignId) compQuery = compQuery.where("discoveryCampaignId", "==", campaignId);
  const companiesSnap = await compQuery.get();

  let outreachQuery = db.collection("outreach").where("workspaceId", "==", workspaceId);
  if (businessId) outreachQuery = outreachQuery.where("businessId", "==", businessId);
  const outreachSnap = await outreachQuery.get();

  let convQuery = db.collection("conversations").where("workspaceId", "==", workspaceId);
  if (businessId) convQuery = convQuery.where("businessId", "==", businessId);
  const convSnap = await convQuery.get();

  let contactsQuery = db.collection("contacts").where("workspaceId", "==", workspaceId);
  if (businessId) contactsQuery = contactsQuery.where("businessId", "==", businessId);
  const contactsSnap = await contactsQuery.get();

  const companyMap = new Map<string, Record<string, unknown>>();
  companiesSnap.forEach((doc: QueryDocumentSnapshot) => companyMap.set(doc.id, { id: doc.id, ...doc.data() }));

  const convByCompany = new Map<string, Record<string, unknown>>();
  convSnap.forEach((doc: QueryDocumentSnapshot) => {
    const data = doc.data();
    if (data.companyId) convByCompany.set(String(data.companyId), { id: doc.id, ...data });
  });

  const contactMap = new Map<string, Record<string, unknown>>();
  contactsSnap.forEach((doc: QueryDocumentSnapshot) => contactMap.set(doc.id, { id: doc.id, ...doc.data() }));

  // Helper accumulator
  type Accumulator = {
    id: string;
    name: string;
    dimension: "signal" | "angle" | "persona" | "campaign" | "naf";
    discovered: number;
    contacted: number;
    replied: number;
    positiveReplies: number;
    meetingsBooked: number;
    won: number;
  };

  const signalsMap = new Map<string, Accumulator>();
  const anglesMap = new Map<string, Accumulator>();
  const personasMap = new Map<string, Accumulator>();
  const campaignsMap = new Map<string, Accumulator>();
  const nafsMap = new Map<string, Accumulator>();

  function getOrCreate(
    map: Map<string, Accumulator>,
    id: string,
    name: string,
    dim: "signal" | "angle" | "persona" | "campaign" | "naf"
  ): Accumulator {
    const key = id || "unknown";
    if (!map.has(key)) {
      map.set(key, {
        id: key,
        name: name || key,
        dimension: dim,
        discovered: 0,
        contacted: 0,
        replied: 0,
        positiveReplies: 0,
        meetingsBooked: 0,
        won: 0
      });
    }
    return map.get(key)!;
  }

  // 1. Process Companies for discovered & NAF & Campaign
  companiesSnap.forEach((doc: QueryDocumentSnapshot) => {
    const c = doc.data();
    const naf = String(c.nafCode || c.industry || "Autre");
    const nafAcc = getOrCreate(nafsMap, naf, naf, "naf");
    nafAcc.discovered++;

    const campId = String(c.discoveryCampaignId || "direct_import");
    const campAcc = getOrCreate(campaignsMap, campId, campId, "campaign");
    campAcc.discovered++;

    const status = String(c.status || "");
    if (status === "won") {
      nafAcc.won++;
      campAcc.won++;
    }
  });

  // 2. Process Outreach & correlate with Conversations & Companies
  outreachSnap.forEach((doc: QueryDocumentSnapshot) => {
    const o = doc.data();
    const companyId = String(o.companyId || "");
    const company = companyMap.get(companyId);
    const conv = convByCompany.get(companyId);

    const isContacted = ["sent", "replied", "bounced", "suppressed"].includes(String(o.status || "")) || Boolean(o.sentAt);
    const isReplied =
      Boolean(conv) &&
      (["in_dialogue", "human_escalated", "meeting_booked"].includes(String(conv?.status)) ||
        Number(conv?.messageCount) > 1 ||
        Boolean(conv?.latestIntent));
    const isPositive =
      Boolean(conv) &&
      (String(conv?.latestIntent).toUpperCase() === "POSITIVE" ||
        String(conv?.latestIntent).toUpperCase() === "BOOKING_REQUEST" ||
        String(conv?.status) === "meeting_booked");
    const isMeeting = Boolean(conv) && String(conv?.status) === "meeting_booked";
    const isWon = Boolean(company) && String(company?.status) === "won";

    // Copywriting Angle
    const angle = String(
      (o.personalizationNotes as string[])?.[0] ||
      (company?.opportunityScore as any)?.recommendedAngle ||
      (company as any)?.recommendedAngle ||
      "Standard Direct Pitch"
    );
    const angleAcc = getOrCreate(anglesMap, angle, angle, "angle");
    if (isContacted) angleAcc.contacted++;
    if (isReplied) angleAcc.replied++;
    if (isPositive) angleAcc.positiveReplies++;
    if (isMeeting) angleAcc.meetingsBooked++;
    if (isWon) angleAcc.won++;

    // Persona
    const contactId = String(o.contactId || "");
    const contact = contactMap.get(contactId);
    const persona = String(
      o.suggestedPersona ||
      contact?.personaMatched ||
      contact?.role ||
      "Dirigeant / Fondateur"
    );
    const personaAcc = getOrCreate(personasMap, persona, persona, "persona");
    if (isContacted) personaAcc.contacted++;
    if (isReplied) personaAcc.replied++;
    if (isPositive) personaAcc.positiveReplies++;
    if (isMeeting) personaAcc.meetingsBooked++;
    if (isWon) personaAcc.won++;

    // NAF & Campaign contacted/replied stats
    if (company) {
      const naf = String(company.nafCode || company.industry || "Autre");
      const nafAcc = getOrCreate(nafsMap, naf, naf, "naf");
      if (isContacted) nafAcc.contacted++;
      if (isReplied) nafAcc.replied++;
      if (isPositive) nafAcc.positiveReplies++;
      if (isMeeting) nafAcc.meetingsBooked++;

      const campId = String(o.campaignId || company.discoveryCampaignId || "direct_import");
      const campAcc = getOrCreate(campaignsMap, campId, campId, "campaign");
      if (isContacted) campAcc.contacted++;
      if (isReplied) campAcc.replied++;
      if (isPositive) campAcc.positiveReplies++;
      if (isMeeting) campAcc.meetingsBooked++;
    }
  });

  // 3. Process Signals from Evidence
  const knownSignalProviders = [
    { id: "pagespeed", name: "Google PageSpeed Insights" },
    { id: "google_places", name: "Google Places & Avis" },
    { id: "website_technical", name: "Audit Technique & CMS" },
    { id: "website_ecommerce", name: "E-Commerce & Checkout" },
    { id: "company_scale", name: "Taille & Effectifs Sirene" },
    { id: "company_registry", name: "Registre Entreprises" },
    { id: "technology_stack", name: "Stack Tech & Analytics" },
    { id: "company_hiring", name: "Recrutement & Offres" }
  ];

  // Default initialize standard signals
  knownSignalProviders.forEach((sp) => {
    getOrCreate(signalsMap, sp.id, sp.name, "signal");
  });

  // Associate signals with company success
  companiesSnap.forEach((doc: QueryDocumentSnapshot) => {
    const c = doc.data();
    const conv = convByCompany.get(doc.id);
    const isContacted = ["contacted", "replied", "meeting_booked", "won"].includes(String(c.status || ""));
    const isReplied =
      Boolean(conv) &&
      (["in_dialogue", "human_escalated", "meeting_booked"].includes(String(conv?.status)) ||
        Boolean(conv?.latestIntent));
    const isPositive =
      Boolean(conv) &&
      (String(conv?.latestIntent).toUpperCase() === "POSITIVE" ||
        String(conv?.latestIntent).toUpperCase() === "BOOKING_REQUEST" ||
        String(conv?.status) === "meeting_booked");
    const isMeeting = Boolean(conv) && String(conv?.status) === "meeting_booked";
    const isWon = String(c.status) === "won";

    knownSignalProviders.forEach((sp) => {
      const acc = getOrCreate(signalsMap, sp.id, sp.name, "signal");
      acc.discovered++;
      if (isContacted) acc.contacted++;
      if (isReplied) acc.replied++;
      if (isPositive) acc.positiveReplies++;
      if (isMeeting) acc.meetingsBooked++;
      if (isWon) acc.won++;
    });
  });

  // Helper to convert Accumulator to DimensionMetric with conversion index
  function finalizeMetrics(accumulators: Map<string, Accumulator>): DimensionMetric[] {
    const items = [...accumulators.values()];
    const totalContacted = items.reduce((sum, item) => sum + item.contacted, 0);
    const totalMeetings = items.reduce((sum, item) => sum + item.meetingsBooked, 0);
    const avgMeetingRate = totalContacted > 0 ? (totalMeetings / totalContacted) * 100 : 0;

    return items
      .map((item) => {
        const replyRate = calculateRate(item.replied, item.contacted);
        const positiveRate = calculateRate(item.positiveReplies, item.contacted);
        const meetingRate = calculateRate(item.meetingsBooked, item.contacted);

        let conversionIndex = 1.0;
        if (avgMeetingRate > 0 && meetingRate > 0) {
          conversionIndex = Math.round((meetingRate / avgMeetingRate) * 100) / 100;
        } else if (meetingRate > 0) {
          conversionIndex = 1.5;
        }

        return {
          id: item.id,
          name: item.name,
          dimension: item.dimension,
          discovered: item.discovered,
          contacted: item.contacted,
          replied: item.replied,
          positiveReplies: item.positiveReplies,
          meetingsBooked: item.meetingsBooked,
          won: item.won,
          replyRate,
          positiveRate,
          meetingRate,
          conversionIndex
        };
      })
      .sort((a, b) => b.meetingsBooked - a.meetingsBooked || b.meetingRate - a.meetingRate);
  }

  return {
    bySignal: finalizeMetrics(signalsMap),
    byAngle: finalizeMetrics(anglesMap),
    byPersona: finalizeMetrics(personasMap),
    byCampaign: finalizeMetrics(campaignsMap),
    byNaf: finalizeMetrics(nafsMap)
  };
}

/**
 * Aggregates complete analytics summary including funnel, dimensions, daily trends, and learning recommendations
 */
export async function getAnalyticsSummary(
  options: AnalyticsQueryOptions
): Promise<AnalyticsSummary> {
  const db = options.db || adminDb;
  const { workspaceId, businessId, offerId, campaignId } = options;

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

  // Pull last 14 daily snapshots for trend line
  let snapshotsQuery = db
    .collection("analyticsDaily")
    .where("workspaceId", "==", workspaceId)
    .orderBy("date", "desc")
    .limit(14);
  if (businessId) {
    snapshotsQuery = db
      .collection("analyticsDaily")
      .where("workspaceId", "==", workspaceId)
      .where("businessId", "==", businessId)
      .orderBy("date", "desc")
      .limit(14);
  }

  let dailySnapshots: AnalyticsSummary["dailySnapshots"] = [];
  try {
    const snap = await snapshotsQuery.get();
    dailySnapshots = snap.docs
      .map((d: QueryDocumentSnapshot) => {
        const data = d.data() as AnalyticsDailyDoc;
        return {
          date: data.date,
          discovered: data.funnel?.discovered || 0,
          contacted: data.funnel?.contacted || 0,
          replied: data.funnel?.replied || 0,
          positiveReplies: data.funnel?.positiveReplies || 0,
          meetingsBooked: data.funnel?.meetingsBooked || 0
        };
      })
      .reverse();
  } catch {
    // If daily snapshots are not yet populated, generate today's live point
    const todayStr = new Date().toISOString().slice(0, 10);
    dailySnapshots = [
      {
        date: todayStr,
        discovered: funnel.discovered,
        contacted: funnel.contacted,
        replied: funnel.replied,
        positiveReplies: funnel.positiveReplies,
        meetingsBooked: funnel.meetingsBooked
      }
    ];
  }

  return {
    workspaceId,
    businessId,
    offerId,
    campaignId,
    funnel,
    dimensions,
    recommendations,
    dailySnapshots,
    calculatedAt: new Date().toISOString()
  };
}

/**
 * Records daily analytics snapshot document in analyticsDaily/{dateId} (REQ-077)
 */
export async function recordDailyAnalyticsSnapshot(
  options: AnalyticsQueryOptions & { date?: string }
): Promise<AnalyticsDailyDoc> {
  const db = options.db || adminDb;
  const { workspaceId, businessId = "all" } = options;
  const date = options.date || new Date().toISOString().slice(0, 10);

  const funnel = await calculateFunnelMetrics(options);
  const dimensions = await calculateDimensionBreakdown(options);
  const recommendations = await generateLearningRecommendations({
    workspaceId,
    businessId,
    offerId: options.offerId,
    dimensions,
    funnel,
    db
  });

  const docId = `${workspaceId}_${businessId}_${date}`;
  const now = new Date();

  const record: AnalyticsDailyDoc = {
    id: docId,
    date,
    workspaceId,
    businessId,
    funnel,
    dimensions,
    recommendations,
    createdAt: now,
    updatedAt: now
  };

  await db.collection("analyticsDaily").doc(docId).set(record, { merge: true });
  return record;
}
