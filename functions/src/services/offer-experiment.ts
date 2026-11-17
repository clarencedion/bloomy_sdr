import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
import { getBusiness, listOffers } from "./business-service.js";
import { checkPricingStatements, extractPrices, type PricingTerms } from "./pricing-guardrail.js";
import type { BusinessDoc, KnowledgeBaseDoc, OfferAssignment, OfferExperiment } from "../types/domain.js";

/**
 * Offer experiments: a business pitches several of its offers to comparable
 * prospects and learns which one sells best.
 *
 * The experiment is data on the business (`business.offerExperiment`); the
 * engine never knows what the offers sell (Invariant 1). Three rules make the
 * comparison honest:
 *
 *   1. A prospect is assigned a variant once, deterministically, the first
 *      time a message is drafted for it — and keeps it for the whole
 *      conversation, replies included (they resolve the offer from the
 *      outreach the prospect was sent).
 *   2. A prospect already contacted is never re-assigned: it keeps the offer it
 *      heard. Changing it mid-conversation would contradict what we wrote.
 *   3. Commercial terms live only on each offer. The business's knowledge base
 *      reaches every prompt whatever the offer, so while an experiment exists
 *      any knowledge-base pricing rule or FAQ that states a figure, or
 *      contradicts the offer being pitched, is withheld from that prompt.
 */

/** Outreach states that mean the prospect received a message (or a meeting followed one). */
const CONTACTED_OUTREACH_STATUSES = new Set(["sent", "replied", "exported", "meeting_booked", "bounced"]);

/** Company states that are only reached by contacting the prospect. */
const CONTACTED_COMPANY_STATUSES = new Set(["contacted", "replied", "meeting_booked", "won", "lost"]);

// ── Pure helpers ───────────────────────────────────────────────────────────

/**
 * The variant a company gets in an experiment. Pure and deterministic:
 * sha256(experimentId|companyId) taken modulo the number of variants, so the
 * same company always lands on the same offer (a retried or concurrent draft
 * cannot pick another one) and the split is uniform over companies.
 */
export function pickVariant(experimentId: string, companyId: string, offerIds: string[]): string {
  if (!offerIds.length) throw new Error("An offer experiment needs at least one offer to pick from.");
  const digest = createHash("sha256").update(`${experimentId}|${companyId}`).digest();
  // 48 bits: the modulo bias over a handful of variants is ~1e-14.
  return offerIds[digest.readUIntBE(0, 6) % offerIds.length];
}

/** The experiment's variants that are real offers, de-duplicated, in the experiment's order. */
export function experimentVariants(experiment: OfferExperiment | undefined | null, existingOfferIds: Iterable<string>): string[] {
  if (!experiment || !Array.isArray(experiment.offerIds)) return [];
  const existing = new Set(existingOfferIds);
  const seen = new Set<string>();
  return experiment.offerIds.filter((id) => {
    if (typeof id !== "string" || !existing.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** An experiment assigns new prospects only while active with at least two real offers. */
export function isExperimentAssigning(experiment: OfferExperiment | undefined | null, existingOfferIds: Iterable<string>): boolean {
  return (
    Boolean(experiment) &&
    experiment?.status === "active" &&
    typeof experiment.id === "string" &&
    experiment.id.length > 0 &&
    experimentVariants(experiment, existingOfferIds).length >= 2
  );
}

/**
 * True while the business has an experiment, running or stopped: prospects
 * assigned to it are still being answered with their own offer, so the
 * knowledge base must stay offer-neutral for as long as it exists.
 */
export function hasOfferExperiment(business?: Pick<BusinessDoc, "offerExperiment"> | null): boolean {
  const experiment = business?.offerExperiment;
  return Boolean(experiment?.id) && Array.isArray(experiment?.offerIds) && (experiment?.offerIds.length ?? 0) >= 2;
}

function readAssignment(value: unknown): OfferAssignment | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.experimentId !== "string" || !record.experimentId) return undefined;
  if (typeof record.offerId !== "string" || !record.offerId) return undefined;
  return record as unknown as OfferAssignment;
}

/**
 * A knowledge-base line may reach the prompt of an experiment offer only if it
 * states no amount and contradicts none of the offer's terms. A pass of the
 * pricing detector is not clearance to send anything (Go-Live Contract #2):
 * here it only decides what to WITHHOLD from a prompt, and the draft is still
 * checked against its own offer afterwards.
 */
function neutralFor(text: string, termsList: Array<PricingTerms | null | undefined>): boolean {
  if (extractPrices(text).length > 0) return false;
  return termsList.every((terms) => checkPricingStatements(text, terms).violations.length === 0);
}

/**
 * The knowledge base as the prompt for one offer (or a set of offers) may see
 * it. Without an experiment it is returned unchanged — existing behaviour.
 * With one, pricing rules and FAQs that state a figure or contradict any of
 * the given offers' terms are withheld: the offer itself states its terms
 * (describePricingTerms), and the knowledge base is shared by every variant.
 */
export function offerNeutralKnowledgeBase<T extends Partial<Pick<KnowledgeBaseDoc, "pricingRules" | "faqs">>>(
  knowledgeBase: T | null | undefined,
  business: Pick<BusinessDoc, "offerExperiment"> | null | undefined,
  terms: PricingTerms | null | undefined | Array<PricingTerms | null | undefined>
): T | null | undefined {
  if (!knowledgeBase || !hasOfferExperiment(business)) return knowledgeBase;
  const termsList = Array.isArray(terms) ? terms : [terms];
  return {
    ...knowledgeBase,
    ...(Array.isArray(knowledgeBase.pricingRules)
      ? { pricingRules: knowledgeBase.pricingRules.filter((rule) => neutralFor(String(rule ?? ""), termsList)) }
      : {}),
    ...(Array.isArray(knowledgeBase.faqs)
      ? {
          faqs: knowledgeBase.faqs.filter((faq) =>
            neutralFor(`${String(faq?.question ?? "")}\n${String(faq?.answer ?? "")}`, termsList)
          )
        }
      : {})
  };
}

// ── Assignment ─────────────────────────────────────────────────────────────

export type OfferAssignmentOutcome =
  /** A variant was assigned by this call. */
  | "assigned"
  /** The company already carries an assignment, which wins (this experiment, or an earlier one it was contacted under). */
  | "existing_assignment"
  /** Already contacted with no assignment: it keeps the offer it was contacted with. */
  | "contacted"
  /** The business runs no experiment that assigns (none, stopped, or fewer than two real offers). */
  | "no_experiment"
  /** Unknown company, or one that belongs to another business or workspace. */
  | "not_assignable";

export interface OfferAssignmentResolution {
  /** The offer to use, or undefined when the caller's usual resolution applies. */
  offerId?: string;
  /**
   * Set only when `offerId` comes from an experiment assignment. Callers give
   * such an offer precedence over the campaign's.
   */
  experimentId?: string;
  outcome: OfferAssignmentOutcome;
}

/**
 * Resolves — and, the first time, records — the experiment offer of a company.
 *
 * In ONE transaction: reads the company and its outreach; if the business's
 * experiment is assigning and the company has never been contacted and has no
 * assignment for it, sets `company.offerId` and `company.offerAssignment` to
 * the variant `pickVariant` gives. Idempotent: an existing assignment for the
 * same experiment is returned as-is. A contacted company is never
 * re-assigned.
 */
export async function resolveOfferAssignment(input: {
  workspaceId: string;
  businessId: string;
  companyId: string;
  /** The business and its offers when the caller has just read them (saves the reads). */
  preloaded?: { business: Pick<BusinessDoc, "offerExperiment"> | null; offers: Array<{ id: string }> };
}): Promise<OfferAssignmentResolution> {
  const [business, offers] = input.preloaded
    ? [input.preloaded.business, input.preloaded.offers]
    : await Promise.all([getBusiness(input.workspaceId, input.businessId), listOffers(input.workspaceId, input.businessId)]);
  const experiment = business?.offerExperiment;
  const offerIds = offers.map((offer) => offer.id);
  const assigning = isExperimentAssigning(experiment, offerIds);
  const experimentId = assigning ? String(experiment?.id) : undefined;
  const variants = assigning ? experimentVariants(experiment, offerIds) : [];

  const companyRef = adminDb.collection("companies").doc(input.companyId);
  const outreachQuery = adminDb
    .collection("outreach")
    .where("workspaceId", "==", input.workspaceId)
    .where("companyId", "==", input.companyId);

  return adminDb.runTransaction(async (transaction): Promise<OfferAssignmentResolution> => {
    const companySnap = await transaction.get(companyRef);
    if (!companySnap.exists) return { outcome: "not_assignable" };
    const company = (companySnap.data() ?? {}) as Record<string, unknown>;
    // An experiment is one business's data; it never decides another tenant's offer.
    if (company.businessId !== input.businessId) return { outcome: "not_assignable" };
    if (company.workspaceId && company.workspaceId !== input.workspaceId) return { outcome: "not_assignable" };

    const currentOfferId = typeof company.offerId === "string" && company.offerId ? company.offerId : undefined;
    const existing = readAssignment(company.offerAssignment);
    const keepExisting = (): OfferAssignmentResolution => ({
      offerId: existing?.offerId,
      experimentId: existing?.experimentId,
      outcome: "existing_assignment"
    });

    if (existing && experimentId && existing.experimentId === experimentId) return keepExisting();
    if (!experimentId) return existing ? keepExisting() : { offerId: currentOfferId, outcome: "no_experiment" };

    // Contacted: keep the offer the prospect heard about. Reads stay before
    // any write, as transactions require.
    let contacted =
      Boolean(company.socialDmSentAt) ||
      Boolean(company.contactFormSentAt) ||
      CONTACTED_COMPANY_STATUSES.has(String(company.status ?? ""));
    if (!contacted) {
      const outreach = await transaction.get(outreachQuery);
      contacted = outreach.docs.some((doc) => {
        const data = doc.data() ?? {};
        return CONTACTED_OUTREACH_STATUSES.has(String(data.status ?? "")) || Boolean(data.sentAt);
      });
    }
    if (contacted) return existing ? keepExisting() : { offerId: currentOfferId, outcome: "contacted" };

    const offerId = pickVariant(experimentId, input.companyId, variants);
    const now = Timestamp.now();
    const assignment: OfferAssignment = { experimentId, offerId, assignedAt: now };
    // `update` replaces the map whole: nothing of an earlier assignment survives.
    transaction.update(companyRef, { offerId, offerAssignment: assignment, updatedAt: now });
    return { offerId, experimentId, outcome: "assigned" };
  });
}

/**
 * The offer to use for a company: its experiment variant (assigned now if
 * needed) or its existing `company.offerId`; undefined when it has neither.
 * See `resolveOfferAssignment` for the rules.
 */
export async function assignOfferForCompany(input: {
  workspaceId: string;
  businessId: string;
  companyId: string;
}): Promise<string | undefined> {
  return (await resolveOfferAssignment(input)).offerId;
}

// ── Report ─────────────────────────────────────────────────────────────────

/** Outreach that reached the prospect. meeting_booked: the booking path rewrites every outreach of the contact to it. */
const SENT_STATUSES = new Set(["sent", "replied", "exported", "meeting_booked"]);
const REPLIED_CONVERSATION_STATUSES = new Set(["in_dialogue", "human_escalated", "human_review_required", "meeting_booked"]);
const POSITIVE_INTENTS = new Set(["POSITIVE", "BOOKING_REQUEST"]);

export interface ExperimentSummaryInput {
  /** Only companies assigned under this experiment are counted; all assignments when omitted. */
  experimentId?: string;
  offers: Array<{ id: string; name?: string }>;
  companies: Array<{ id: string; offerAssignment?: { experimentId?: string; offerId?: string } | null }>;
  outreach: Array<{ companyId?: string; offerId?: string | null; status?: string; channel?: string | null }>;
  conversations: Array<{ companyId?: string; latestIntent?: string | null; status?: string }>;
  meetings: Array<{ companyId?: string; status?: string }>;
}

export interface ExperimentVariantSummary {
  offerId: string;
  offerName: string;
  /** Companies assigned this variant. */
  assigned: number;
  /** Assigned companies with at least one message written for this variant. */
  drafted: number;
  /** Assigned companies with a message for this variant that reached them (sent, replied, exported). */
  sent: number;
  /** Sent companies that answered. */
  replied: number;
  /** Sent companies whose conversation is positive, a booking request, or booked. */
  positive: number;
  /** Sent companies with at least one meeting that is not cancelled. */
  meetings: number;
  /** replied / sent; null while nothing was sent. */
  replyRate: number | null;
  /** positive / sent; null while nothing was sent. */
  positiveRate: number | null;
  /** Sent companies by channel of the message that reached them. */
  sentByChannel: Record<string, number>;
  /**
   * Assigned companies contacted with ANOTHER offer (an older draft sent after
   * the assignment). They heard neither variant cleanly, so they are left out
   * of sent and everything after it.
   */
  mismatched: number;
}

/**
 * Per-variant funnel of an offer experiment. Pure: the caller reads the
 * documents (offer-experiment-report.mjs), this only counts. Every stage
 * counts companies, not messages, so the rates compare like with like.
 */
export function summarizeExperiment(input: ExperimentSummaryInput): ExperimentVariantSummary[] {
  const byCompany = <T extends { companyId?: string }>(items: T[]) => {
    const map = new Map<string, T[]>();
    for (const item of items) {
      if (!item.companyId) continue;
      const list = map.get(item.companyId) ?? [];
      list.push(item);
      map.set(item.companyId, list);
    }
    return map;
  };
  const outreachByCompany = byCompany(input.outreach);
  const conversationsByCompany = byCompany(input.conversations);
  const meetingsByCompany = byCompany(input.meetings);

  const rows = new Map<string, ExperimentVariantSummary>();
  const row = (offerId: string): ExperimentVariantSummary => {
    let current = rows.get(offerId);
    if (!current) {
      const name = input.offers.find((offer) => offer.id === offerId)?.name;
      current = {
        offerId,
        offerName: name || "(offre inconnue)",
        assigned: 0,
        drafted: 0,
        sent: 0,
        replied: 0,
        positive: 0,
        meetings: 0,
        replyRate: null,
        positiveRate: null,
        sentByChannel: {},
        mismatched: 0
      };
      rows.set(offerId, current);
    }
    return current;
  };
  // Variants appear in the offers' order, even with nobody assigned yet.
  for (const offer of input.offers) row(offer.id);

  for (const company of input.companies) {
    const assignment = company.offerAssignment;
    if (!assignment?.offerId) continue;
    if (input.experimentId && assignment.experimentId !== input.experimentId) continue;
    const variant = row(assignment.offerId);
    variant.assigned += 1;

    const outreach = outreachByCompany.get(company.id) ?? [];
    // A message with no offer recorded predates offer stamping; it is the variant's by assignment.
    const own = outreach.filter((item) => !item.offerId || item.offerId === assignment.offerId);
    const foreignSent = outreach.some(
      (item) => item.offerId && item.offerId !== assignment.offerId && SENT_STATUSES.has(String(item.status ?? ""))
    );
    if (own.length) variant.drafted += 1;
    if (foreignSent) {
      variant.mismatched += 1;
      continue;
    }

    const delivered = own.filter((item) => SENT_STATUSES.has(String(item.status ?? "")));
    if (!delivered.length) continue;
    variant.sent += 1;
    const channel = String(delivered[0].channel || "email");
    variant.sentByChannel[channel] = (variant.sentByChannel[channel] ?? 0) + 1;

    const conversations = conversationsByCompany.get(company.id) ?? [];
    const replied =
      own.some((item) => item.status === "replied") ||
      conversations.some((conversation) => Boolean(conversation.latestIntent) || REPLIED_CONVERSATION_STATUSES.has(String(conversation.status ?? "")));
    const positive = conversations.some(
      (conversation) =>
        POSITIVE_INTENTS.has(String(conversation.latestIntent ?? "").toUpperCase()) || conversation.status === "meeting_booked"
    );
    const met = (meetingsByCompany.get(company.id) ?? []).some((meeting) => meeting.status !== "cancelled");
    if (replied || positive) variant.replied += 1;
    if (positive) variant.positive += 1;
    if (met) variant.meetings += 1;
  }

  for (const variant of rows.values()) {
    variant.replyRate = variant.sent ? variant.replied / variant.sent : null;
    variant.positiveRate = variant.sent ? variant.positive / variant.sent : null;
  }
  return [...rows.values()];
}
