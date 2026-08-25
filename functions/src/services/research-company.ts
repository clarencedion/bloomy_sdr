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
};

const MIN_COMPANY_QUALITY_FOR_RESEARCH = 35;
const REUSABLE_RESEARCH_STATUSES = new Set(["pending", "running", "failed"]);

function todayStart() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return Timestamp.fromDate(date);
}

async function assertResearchLimit(limit: number) {
  const snapshot = await adminDb
    .collection("leadResearch")
    .where("createdAt", ">=", todayStart())
    .limit(Math.max(limit * 3, 50))
    .get();
  const count = snapshot.docs.filter((item) => ["running", "completed"].includes(String(item.data().status))).length;
  if (count >= limit) throw new HttpsError("resource-exhausted", `Daily AI research limit reached (${count}/${limit}).`);
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
  const ref = await adminDb.collection("leadResearch").add({
    companyId,
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

export async function researchCompany(companyId: string, options?: { force?: boolean }) {
  const startedAt = Date.now();
  const settings = await getGlobalSettings();
  if (settings.automationPaused) throw new HttpsError("failed-precondition", "Automation is paused in global settings. Open Settings and set Automation to Active.");
  await assertResearchLimit(settings.dailyAiResearchLimit);

  const companyRef = adminDb.collection("companies").doc(companyId);
  const companySnapshot = await companyRef.get();
  if (!companySnapshot.exists) throw new HttpsError("not-found", `Company not found: ${companyId}`);
  const company = { id: companySnapshot.id, ...companySnapshot.data() } as CompanyRecord;

  if (!company.name) throw new HttpsError("failed-precondition", "Company must have a name before AI research.");
  if ((company.qualityScore ?? 0) < MIN_COMPANY_QUALITY_FOR_RESEARCH && !options?.force) {
    throw new HttpsError("failed-precondition", `Company quality score is too low for research (${company.qualityScore ?? 0}). Regenerate with force to override.`);
  }

  const provider = getResearchProvider(settings, await getAiSecrets());
  const reusableResearch = await getReusableResearchRef(companyId);
  if (reusableResearch?.data().status === "running") {
    return { researchId: reusableResearch.id, status: "running", provider: reusableResearch.data().aiProvider, model: reusableResearch.data().model };
  }
  const researchRef = reusableResearch?.ref ?? adminDb.collection("leadResearch").doc();
  const researchCreatedAt = reusableResearch?.data().createdAt ?? Timestamp.now();
  await researchRef.set(
    {
      companyId,
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

    const rawInput = {
      company: compactCompany(company),
      websiteText: websiteFetch.text,
      websiteFetch,
      devcommContext: settings.companyContext,
      promptVersion: RESEARCH_PROMPT_VERSION
    };

    const result = await provider.generateStructuredResearch({
      company: compactCompany(company),
      websiteText: websiteFetch.text,
      devcommContext: settings.companyContext,
      promptVersion: RESEARCH_PROMPT_VERSION,
      settings
    });

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
        bestOffer: result.output.bestDevcommOffer,
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

    await companyRef.set(
      {
        status: nextStatus,
        fitScore: result.output.fitScore,
        bestOffer: result.output.bestDevcommOffer,
        tags: [result.output.segment, result.output.recommendedNextAction].filter(Boolean),
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
      message: "AI research completed.",
      metadata: {
        companyId,
        researchId: researchRef.id,
        provider: result.provider,
        model: result.model,
        fitScore: result.output.fitScore,
        confidence: result.output.confidence,
        durationMs: Date.now() - startedAt,
        estimatedCost: result.estimatedCost ?? 0
      }
    });

    // Auto-find contacts via Dropcontact if key is configured (runs silently, doesn't block return)
    if (integrationSecrets.dropcontactApiKey) {
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
