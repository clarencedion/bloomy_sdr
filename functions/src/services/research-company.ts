import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { adminDb } from "../config/firebase.js";
import { getResearchProvider } from "../providers/ai/index.js";
import { getAiSecrets, getGlobalSettings, getIntegrationSecrets } from "../utils/settings.js";
import { writeLog } from "../utils/logger.js";
import { RESEARCH_PROMPT_VERSION } from "./research-prompts.js";
import { fetchHomepageText } from "./website-fetcher.js";
import { resolveCompanyWebsite } from "./website-resolver.js";
import { updateCompanyLeadReadiness } from "./lead-readiness.js";
import { findContactsForCompany } from "./contact-discovery.js";
import { calculateOpportunityScore } from "./opportunity-scorer.js";
import { getValidEvidence } from "./evidence-service.js";
import { buildBusinessContext } from "./business-context.js";
import { assignOfferForCompany } from "./offer-experiment.js";
import { DailyQuotaExceededError, getDailyUsage, reserveDailyQuota } from "./daily-quota.js";
import { recordAiSpend } from "./cost-guardrail-service.js";
import type { OfferDoc } from "../types/domain.js";

type CompanyRecord = {
  id: string;
  name?: string;
  website?: string;
  domain?: string;
  siren?: string;
  city?: string;
  country?: string;
  industry?: string;
  nafCode?: string;
  nafLabel?: string;
  employeeCount?: number;
  description?: string;
  source?: string;
  sourceUrl?: string;
  sourceType?: string;
  sourceConfidence?: number;
  qualityScore?: number;
  dataQualityWarnings?: string[];
  discoveryScore?: number;
  discoveryReasons?: string[];
  websiteEnrichmentStatus?: string;
  websiteTitle?: string;
  websiteDescription?: string;
  contactPageUrl?: string;
  careersPageUrl?: string;
  websiteKeywords?: string[];
  extractedEmailCount?: number;
  bestOffer?: string;
  offerId?: string;
};

const MIN_COMPANY_QUALITY_FOR_RESEARCH = 35;
const REUSABLE_RESEARCH_STATUSES = new Set(["pending", "running", "failed"]);


/**
 * Daily research quota, counted per business.
 *
 * Counting every research document in the database meant another business's
 * work - and test fixtures - consumed this business's quota.
 */
/**
 * Today's research count for a business (the atomic counter in daily-quota.ts),
 * or `null` when it cannot be read.
 */
export async function countResearchToday(scope: { workspaceId?: string; businessId?: string }): Promise<number | null> {
  return getDailyUsage("research", scope);
}

function compactCompany(company: CompanyRecord) {
  return stripUndefined({
    id: company.id,
    name: company.name,
    website: company.website,
    domain: company.domain,
    city: company.city,
    country: company.country,
    industry: company.industry,
    nafCode: company.nafCode,
    nafLabel: company.nafLabel,
    employeeCount: company.employeeCount,
    description: company.description,
    source: company.source,
    sourceUrl: company.sourceUrl,
    sourceType: company.sourceType,
    sourceConfidence: company.sourceConfidence,
    qualityScore: company.qualityScore,
    dataQualityWarnings: company.dataQualityWarnings,
    discoveryScore: company.discoveryScore,
    discoveryReasons: company.discoveryReasons,
    websiteEnrichmentStatus: company.websiteEnrichmentStatus,
    websiteTitle: company.websiteTitle,
    websiteDescription: company.websiteDescription,
    contactPageUrl: company.contactPageUrl,
    careersPageUrl: company.careersPageUrl,
    websiteKeywords: company.websiteKeywords,
    extractedEmailCount: company.extractedEmailCount
  });
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)).filter((item) => item !== undefined) as T;
  }
  if (value && typeof value === "object" && !(value instanceof Timestamp) && !(value instanceof FieldValue)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, stripUndefined(item)])
    ) as T;
  }
  return value;
}

function statusFromRecommendation(recommendedNextAction: string) {
  if (recommendedNextAction === "approve_outreach") return "qualified";
  if (recommendedNextAction === "reject") return "rejected";
  return "researched";
}

/**
 * Pipeline status derived from the evidence-based qualification state.
 *
 * The deterministic `OpportunityScore` is the authority, not the model's
 * free-form `recommendedNextAction`. The AI writes its recommendation from the
 * page text alone, BEFORE external signals are collected, so it was rejecting
 * companies the scorer had qualified on hard evidence (PageSpeed 26/100,
 * no site of their own). Those companies were marked `rejected` and dropped out
 * of the pipeline, so no contact was ever found and no draft written.
 *
 * The model's suggestion is kept as a tag for review, but it no longer gates.
 */
function statusFromQualification(
  qualificationState: string,
  aiSuggestedStatus: string
): "rejected" | "qualified" | "researched" {
  if (qualificationState === "DISQUALIFIED") return "rejected";
  if (qualificationState === "QUALIFIED" || qualificationState === "HIGH_PRIORITY") return "qualified";
  // NEEDS_MORE_EVIDENCE: keep it in the pipeline unless the model actively
  // recommended approval, which evidence does not yet support.
  return aiSuggestedStatus === "qualified" ? "researched" : "researched";
}


async function getReusableResearchRef(companyId: string) {
  const snapshot = await adminDb
    .collection("leadResearch")
    .where("companyId", "==", companyId)
    .limit(20)
    .get();
  return snapshot.docs
    .sort((a, b) => {
      const left = a.data().createdAt instanceof Timestamp ? a.data().createdAt.toMillis() : 0;
      const right = b.data().createdAt instanceof Timestamp ? b.data().createdAt.toMillis() : 0;
      return right - left;
    })
    .find((item) => REUSABLE_RESEARCH_STATUSES.has(String(item.data().status)));
}

export async function queueCompanyForResearch(companyId: string) {
  const existing = await getReusableResearchRef(companyId);
  if (existing) {
    if (existing.data().status === "failed") {
      await existing.ref.set({ status: "pending", error: FieldValue.delete(), completedAt: FieldValue.delete(), updatedAt: Timestamp.now() }, { merge: true });
      await adminDb.collection("companies").doc(companyId).set({ status: "research_pending", needsResearch: true, updatedAt: Timestamp.now() }, { merge: true });
      return { queued: true, researchId: existing.id };
    }
    return { queued: false, researchId: existing.id };
  }
  const companyData = (await adminDb.collection("companies").doc(companyId).get()).data() ?? {};
  const ref = await adminDb.collection("leadResearch").add({
    companyId,
    // Tenant-stamped like the company it belongs to (Invariant 8).
    workspaceId: (companyData.workspaceId as string) || "ws_default",
    ...(companyData.businessId ? { businessId: companyData.businessId as string } : {}),
    status: "pending",
    createdAt: Timestamp.now(),
    rawInput: { queuedBy: "manual" }
  });
  await adminDb.collection("companies").doc(companyId).set({ status: "research_pending", needsResearch: true, updatedAt: Timestamp.now() }, { merge: true });
  await writeLog({ type: "research.queued", level: "info", message: "Company queued for AI research.", metadata: { companyId, researchId: ref.id } });
  return { queued: true, researchId: ref.id };
}

export async function skipPendingResearch(researchId: string) {
  await adminDb.collection("leadResearch").doc(researchId).set({ status: "failed", error: "Skipped manually.", completedAt: Timestamp.now() }, { merge: true });
  return { skipped: true };
}


/**
 * Runs the campaign's configured signal providers for a company so the
 * opportunity scorer has verified evidence to work from. Failures are logged
 * and swallowed: research must still complete on partial evidence.
 */
async function collectSignalsForScoring(
  companyId: string,
  company: CompanyRecord,
  forceRefresh = false
): Promise<void> {
  try {
    const companyAny = company as unknown as Record<string, unknown>;
    const workspaceId = (companyAny.workspaceId as string) || "ws_default";
    const businessId = (companyAny.businessId as string) || undefined;
    const campaignId = (companyAny.discoveryCampaignId as string) || undefined;

    // The campaign decides which signals are relevant to this offer.
    let requestedProviders: string[] | undefined;
    if (campaignId) {
      const campaignSnap = await adminDb.collection("discoveryCampaigns").doc(campaignId).get();
      const enabled = campaignSnap.data()?.researchStrategy?.enabledSignalProviders;
      if (Array.isArray(enabled) && enabled.length) requestedProviders = enabled;
    }

    const { runSignalCollection } = await import("./signal-coordinator.js");
    const result = await runSignalCollection(
      {
        workspaceId,
        businessId: businessId ?? "",
        campaignId,
        offerId: (companyAny.offerId as string) || undefined,
        company: {
          id: companyId,
          name: company.name || "",
          domain: company.domain,
          website: company.website,
          siren: company.siren,
          siret: (companyAny.siret as string) || undefined,
          city: company.city,
          postalCode: (companyAny.postalCode as string) || undefined,
          address: (companyAny.address as string) || undefined,
          rawProviderData: companyAny.rawProviderData
        }
      },
      { requestedProviders, forceRefresh }
    );

    await writeLog({
      type: "signals.collection.run",
      level: "info",
      message: `Collected ${result.evidence.length} evidence items for ${company.name ?? companyId}.`,
      workspaceId,
      businessId,
      metadata: {
        companyId,
        evidenceCount: result.evidence.length,
        providers: result.results.map((r) => r.providerId),
        errorCount: result.errors.length,
        // Keep the actual reasons: a silently failing audit looks identical to
        // a prospect that simply has no problems.
        errors: result.errors.map((e) => `${e.providerId}: ${e.error}`)
      }
    });
  } catch (error) {
    await writeLog({
      type: "signals.collection.run",
      level: "warning",
      message: `Signal collection failed for ${companyId}: ${error instanceof Error ? error.message : "unknown"}`,
      metadata: { companyId }
    });
  }
}

/** Loads the company's offer from its workspace-scoped location. */
async function resolveOfferForCompany(company: CompanyRecord): Promise<OfferDoc | null> {
  const companyAny = company as unknown as Record<string, unknown>;
  const targetOfferId = (companyAny.offerId as string) || company.bestOffer;
  const workspaceId = (companyAny.workspaceId as string) || "ws_default";
  const businessId = companyAny.businessId as string | undefined;
  if (!targetOfferId || !businessId) return null;

  const { getOffer } = await import("./business-service.js");
  return getOffer(workspaceId, businessId, targetOfferId);
}


export async function researchCompany(companyId: string, options?: { force?: boolean }) {
  const startedAt = Date.now();
  const settings = await getGlobalSettings();
  if (settings.automationPaused) throw new HttpsError("failed-precondition", "Automation is paused in global settings. Open Settings and set Automation to Active.");
  const companyRef = adminDb.collection("companies").doc(companyId);
  const companySnapshot = await companyRef.get();
  if (!companySnapshot.exists) throw new HttpsError("not-found", `Company not found: ${companyId}`);
  const company = { id: companySnapshot.id, ...companySnapshot.data() } as CompanyRecord;

  const quotaScope = {
    workspaceId: ((company as unknown as Record<string, unknown>).workspaceId as string | undefined) || "ws_default",
    businessId: (company as unknown as Record<string, unknown>).businessId as string | undefined
  };

  if (!company.name) throw new HttpsError("failed-precondition", "Company must have a name before AI research.");
  if ((company.qualityScore ?? 0) < MIN_COMPANY_QUALITY_FOR_RESEARCH && !options?.force) {
    throw new HttpsError("failed-precondition", `Company quality score is too low for research (${company.qualityScore ?? 0}). Regenerate with force to override.`);
  }

  const provider = getResearchProvider(settings, await getAiSecrets());
  const reusableResearch = await getReusableResearchRef(companyId);
  if (reusableResearch?.data().status === "running") {
    return { researchId: reusableResearch.id, status: "running", provider: reusableResearch.data().aiProvider, model: reusableResearch.data().model };
  }
  // One unit of today's quota, taken atomically right before the work that
  // costs money — after every check that could still refuse the company.
  await reserveDailyQuota("research", quotaScope, settings.dailyAiResearchLimit, (used, limit) =>
    `Daily AI research limit reached (${used}/${limit}).`
  ).catch((error: unknown) => {
    if (error instanceof DailyQuotaExceededError) throw new HttpsError("resource-exhausted", error.message);
    throw error;
  });

  const researchRef = reusableResearch?.ref ?? adminDb.collection("leadResearch").doc();
  const researchCreatedAt = reusableResearch?.data().createdAt ?? Timestamp.now();
  await researchRef.set(
    {
      companyId,
      // Tenant-stamped (Invariant 8): backend research documents carried no
      // scope, so no scoped query could ever see them.
      workspaceId: quotaScope.workspaceId,
      ...(quotaScope.businessId ? { businessId: quotaScope.businessId } : {}),
      status: "running",
      aiProvider: provider.name,
      model: provider.model,
      promptVersion: RESEARCH_PROMPT_VERSION,
      createdAt: researchCreatedAt,
      startedAt: Timestamp.now(),
      rawInput: stripUndefined({ company: compactCompany(company) }),
      error: FieldValue.delete(),
      completedAt: FieldValue.delete()
    },
    { merge: true }
  );

  await companyRef.set({ status: "researching", updatedAt: Timestamp.now() }, { merge: true });
  await writeLog({ type: "research.start", level: "info", message: "AI research started.", metadata: { companyId, researchId: researchRef.id, provider: provider.name, model: provider.model } });

  try {
    const integrationSecrets = await getIntegrationSecrets();
    // Resolve website via Pappers (authoritative French company registry) if not already set.
    // If a website is already set, we preserve it.
    if (!company.website) {
      const resolved = await resolveCompanyWebsite(
        { name: company.name, city: company.city, siren: company.siren },
        { pappersApiKey: integrationSecrets.pappersApiKey, serperApiKey: integrationSecrets.serperApiKey }
      );
      if (resolved.website) {
        await companyRef.set({ website: resolved.website, domain: resolved.domain, updatedAt: Timestamp.now() }, { merge: true });
        company.website = resolved.website;
        company.domain = resolved.domain;
        await writeLog({
          type: "research.website_resolved",
          level: "info",
          message: `Website resolved via ${resolved.resolvedBy}: ${resolved.website}`,
          metadata: { companyId, resolvedBy: resolved.resolvedBy, website: resolved.website }
        });
      } else {
        await writeLog({ type: "research.website_not_found", level: "info", message: "Could not find company website. Research runs on structured data only.", metadata: { companyId } });
      }
    } else {
      // Normalize domain if missing but website is set
      if (!company.domain) {
        try {
          const normalized = company.website.startsWith("http") ? company.website : `https://${company.website}`;
          const domain = new URL(normalized).hostname.replace(/^www\./, "");
          await companyRef.set({ website: normalized, domain, updatedAt: Timestamp.now() }, { merge: true });
          company.website = normalized;
          company.domain = domain;
        } catch {
          // Keep as is if URL parsing fails
        }
      }
    }

    const websiteFetch = await fetchHomepageText(company.website ?? company.domain);
    await writeLog({
      type: "research.website_fetch",
      level: websiteFetch.success ? "info" : "warning",
      message: websiteFetch.success ? "Website text fetched." : `Website fetch skipped/failed: ${websiteFetch.error}`,
      metadata: { companyId, sourceUrl: websiteFetch.sourceUrl, textLength: websiteFetch.text?.length ?? 0 }
    });

    const companyAny = company as unknown as Record<string, unknown>;
    // With an offer experiment, research must speak about the variant this
    // prospect will be offered — not the discovery offer — or an angle written
    // here carries another variant's terms into the draft. Assignment is the
    // same idempotent call the generators make; it never moves a contacted
    // company.
    const researchOfferId =
      companyAny.businessId
        ? (await assignOfferForCompany({
            workspaceId: (companyAny.workspaceId as string) || "ws_default",
            businessId: companyAny.businessId as string,
            companyId
          }).catch(() => undefined)) ?? ((companyAny.offerId as string) || undefined)
        : (companyAny.offerId as string) || undefined;
    const companyContext = await buildBusinessContext({
      workspaceId: companyAny.workspaceId as string | undefined,
      businessId: companyAny.businessId as string | undefined,
      offerId: researchOfferId
    });

    const rawInput = {
      company: compactCompany(company),
      websiteText: websiteFetch.text,
      websiteFetch,
      devcommContext: companyContext,
      promptVersion: RESEARCH_PROMPT_VERSION
    };

    const result = await provider.generateStructuredResearch({
      company: compactCompany(company),
      websiteText: websiteFetch.text,
      devcommContext: companyContext,
      promptVersion: RESEARCH_PROMPT_VERSION,
      settings
    });

    // Real tokens from the API response, priced by model. Research is the
    // single biggest AI cost in the pipeline and was previously untracked.
    const companyScope = company as unknown as Record<string, unknown>;
    await recordAiSpend({
      workspaceId: companyScope.workspaceId as string | undefined,
      businessId: companyScope.businessId as string | undefined,
      provider: result.provider,
      model: result.model,
      operation: "ai_research",
      companyId,
      usage: {
        inputTokens: result.estimatedInputTokens,
        outputTokens: result.estimatedOutputTokens
      }
    }).catch(() => undefined);

    const completedAt = Timestamp.now();
    const nextStatus = statusFromRecommendation(result.output.recommendedNextAction);
    const sourceUrls = [...new Set([...result.output.sourceUrls, websiteFetch.sourceUrl, company.sourceUrl, company.website].filter((value): value is string => Boolean(value)))];

    await researchRef.set(
      {
        status: "completed",
        researchSummary: result.output.companySummary,
        detectedNeeds: result.output.detectedNeeds,
        painPoints: result.output.painPoints,
        buyingTriggers: result.output.buyingTriggers,
        bestOffer: result.output.bestOffer ?? result.output.bestDevcommOffer,
        decisionMakersToTarget: result.output.targetPersonas,
        risks: result.output.risks,
        confidence: result.output.confidence,
        fitScore: result.output.fitScore,
        aiProvider: result.provider,
        model: result.model,
        promptVersion: RESEARCH_PROMPT_VERSION,
        rawInput: stripUndefined(rawInput),
        rawOutput: stripUndefined(result.rawOutput),
        sourceUrls,
        completedAt,
        error: FieldValue.delete(),
        segment: result.output.segment,
        personalizedAngle: result.output.personalizedAngle,
        reasoningSummary: result.output.reasoningSummary,
        recommendedNextAction: result.output.recommendedNextAction,
        estimatedInputTokens: result.estimatedInputTokens,
        estimatedOutputTokens: result.estimatedOutputTokens,
        estimatedCost: result.estimatedCost ?? 0
      },
      { merge: true }
    );

    // Collect external signals BEFORE scoring. Without this the scorer sees an
    // empty evidence set, every company lands around 25/100 and is disqualified
    // - which defeats the entire premise of scoring on verified evidence.
    // A forced re-research must re-collect signals, otherwise it re-scores
    // stale cached evidence.
    await collectSignalsForScoring(companyId, company, options?.force === true);

    const evidenceItems = await getValidEvidence(companyId);

    // Offers are workspace-scoped (workspaces/{ws}/businesses/{biz}/offers).
    // Reading a top-level "offers" collection always returned nothing, so the
    // offer's scoring weights, personas and guardrails were silently ignored.
    const offerDoc = await resolveOfferForCompany(company);

    // The campaign's targeting (keywords, cities, NAF codes, scoring weights)
    // is what "company fit" is measured against. Without it every company got
    // the same 30/100 fit (base + "national coverage"), and prospects the
    // research had recommended at 85/100 were disqualified on that alone
    // (live run, 2026-11-10: 5 of 15).
    const scoringCampaignId = (company as unknown as Record<string, unknown>).discoveryCampaignId;
    const scoringCampaignSnap =
      typeof scoringCampaignId === "string" && scoringCampaignId
        ? await adminDb.collection("discoveryCampaigns").doc(scoringCampaignId).get()
        : null;
    const campaignDoc = scoringCampaignSnap?.exists ? { id: scoringCampaignSnap.id, ...scoringCampaignSnap.data() } : undefined;

    const opportunityScore = calculateOpportunityScore({
      // Website and listing always present, empty when absent: "no site at
      // all" is a need the scorer must be able to tell from "not given".
      company: {
        ...company,
        website: company.website ?? "",
        directoryUrl: ((company as unknown as Record<string, unknown>).directoryUrl as string | undefined) ?? ""
      },
      evidenceItems,
      offer: offerDoc,
      campaign: campaignDoc as never
    });

    await companyRef.set(
      {
        status: statusFromQualification(opportunityScore.qualificationState, nextStatus),
        fitScore: opportunityScore.overallScore || result.output.fitScore,
        opportunityScore,
        qualificationState: opportunityScore.qualificationState,
        bestOffer: result.output.bestOffer ?? result.output.bestDevcommOffer,
        tags: [result.output.segment, result.output.recommendedNextAction, opportunityScore.qualificationState].filter(Boolean),
        lastActivityAt: completedAt,
        needsResearch: false,
        updatedAt: completedAt
      },
      { merge: true }
    );
    await updateCompanyLeadReadiness(companyId);

    await writeLog({
      type: "research.completed",
      level: "info",
      message: `AI research & opportunity scoring completed (State: ${opportunityScore.qualificationState}, Score: ${opportunityScore.overallScore}).`,
      metadata: {
        companyId,
        researchId: researchRef.id,
        provider: result.provider,
        model: result.model,
        fitScore: opportunityScore.overallScore,
        qualificationState: opportunityScore.qualificationState,
        confidence: result.output.confidence,
        durationMs: Date.now() - startedAt,
        estimatedCost: result.estimatedCost ?? 0
      }
    });

    // Auto-find contacts via Dropcontact if key is configured (runs silently, gated by pre-enrichment gate)
    if (integrationSecrets.dropcontactApiKey && opportunityScore.qualificationState !== "DISQUALIFIED") {
      findContactsForCompany(companyId).catch(() => { /* logged inside */ });
    }

    return { researchId: researchRef.id, status: "completed", fitScore: result.output.fitScore, confidence: result.output.confidence, provider: result.provider, model: result.model };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown research error";
    await researchRef.set({ status: "failed", completedAt: Timestamp.now(), error: message }, { merge: true });
    await companyRef.set({ status: "research_pending", needsResearch: true, updatedAt: Timestamp.now() }, { merge: true });
    await writeLog({ type: "research.failed", level: "error", message, metadata: { companyId, researchId: researchRef.id, durationMs: Date.now() - startedAt } });
    return { researchId: researchRef.id, status: "failed", error: message };
  }
}
