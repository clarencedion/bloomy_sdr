"use client";

import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where
} from "firebase/firestore";
import type { DiscoveryCampaign, DiscoveryProviderName, DiscoveredCompany } from "@/types/firestore";
import { normalizeCompanyInput } from "@/lib/data/company";
import { db } from "@/lib/firebase/client";
import { collections, createLog, createOrMergeCompany, findCompanyDuplicate } from "@/lib/firebase/firestore";
import { ManualDiscoveryProvider } from "@/lib/discovery/manual-provider";
import { RechercheEntreprisesProvider } from "@/lib/discovery/recherche-entreprises-provider";
import { assessDiscoveryQuality, scoreDiscoveredCompany } from "@/lib/discovery/scoring";

const providers = {
  recherche_entreprises: new RechercheEntreprisesProvider(),
  manual: new ManualDiscoveryProvider()
} as const;

const defaultProviderPriority: DiscoveryProviderName[] = ["recherche_entreprises", "sirene", "google_places"];
const clientSupportedProviders = new Set<DiscoveryProviderName>(["recherche_entreprises", "manual"]);

export async function runDiscoveryCampaign(campaign: DiscoveryCampaign) {
  if (campaign.status === "paused") throw new Error("Discovery campaign is paused.");
  if (campaign.status === "archived") throw new Error("Discovery campaign is archived.");
  // Same rule as the backend runner: no business, no run (ADR-016 #6).
  const campaignBusinessId = campaign.businessId;
  if (!campaignBusinessId) throw new Error("Discovery campaign is not attributed to any business.");

  const providerPriority = campaign.providerPriority.length ? campaign.providerPriority : defaultProviderPriority;
  const providerCandidates: DiscoveryProviderName[] = providerPriority.some((provider) => clientSupportedProviders.has(provider)) ? providerPriority : ["recherche_entreprises"];
  const providerName = providerCandidates.find((provider) => clientSupportedProviders.has(provider)) ?? "recherche_entreprises";
  const runRef = await addDoc(collection(db, collections.discoveryRuns), {
    workspaceId: campaign.workspaceId || "ws_default",
    businessId: campaignBusinessId,
    campaignId: campaign.id,
    campaignName: campaign.name,
    status: "running",
    provider: providerName,
    startedAt: serverTimestamp(),
    companiesFound: 0,
    companiesCreated: 0,
    companiesQueuedForResearch: 0,
    companiesSkippedDuplicate: 0,
    companiesRejected: 0,
    logs: [`Started ${providerName} discovery run.`],
    errors: []
  });

  const stats = {
    companiesFound: 0,
    companiesCreated: 0,
    companiesQueuedForResearch: 0,
    companiesSkippedDuplicate: 0,
    companiesRejected: 0,
    scoreTotal: 0,
    errors: [] as string[],
    logs: [] as string[],
    duplicateCompanies: [] as string[]
  };

  try {
    const discovered: DiscoveredCompany[] = [];
    const providerErrors: string[] = [];
    let activeProviderName = providerName;
    const startPage = providerName === "recherche_entreprises" ? campaign.rechercheEntreprisesPageCursor ?? 1 : 1;
    const candidateLimit = campaign.maxCompaniesPerRun;
    for (const candidate of providerCandidates) {
      if (!(candidate in providers)) continue;
      const provider = providers[candidate as keyof typeof providers];
      try {
        const providerResults = await provider.searchCompanies({ campaign, startPage: candidate === "recherche_entreprises" ? startPage : 1, candidateLimit });
        if (providerResults.length) {
          activeProviderName = candidate;
          discovered.push(...providerResults);
          break;
        }
      } catch (error) {
        providerErrors.push(`${candidate}: ${error instanceof Error ? error.message : "provider failed"}`);
      }
    }
    stats.errors.push(...providerErrors);
    stats.companiesFound = discovered.length;

    for (const company of discovered) {
      if (stats.companiesCreated >= campaign.maxCompaniesPerRun) {
        stats.logs.push(`Stopped after creating ${campaign.maxCompaniesPerRun} companies for this run.`);
        break;
      }
      await handleDiscoveredCompany(company, campaign, runRef.id, activeProviderName, stats);
    }

    await updateDoc(runRef, {
      status: "completed",
      completedAt: serverTimestamp(),
      companiesFound: stats.companiesFound,
      companiesCreated: stats.companiesCreated,
      companiesQueuedForResearch: stats.companiesQueuedForResearch,
      companiesSkippedDuplicate: stats.companiesSkippedDuplicate,
      companiesRejected: stats.companiesRejected,
      averageDiscoveryScore: stats.companiesFound ? Math.round(stats.scoreTotal / stats.companiesFound) : 0,
      logs: stats.logs,
      duplicateCompanies: stats.duplicateCompanies,
      errors: stats.errors
    });
    await updateDoc(doc(db, collections.discoveryCampaigns, campaign.id), {
      lastRunAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...(activeProviderName === "recherche_entreprises"
        ? {
            rechercheEntreprisesPageCursor: discovered.length ? startPage + Math.ceil(discovered.length / 25) : startPage,
            rechercheEntreprisesExhausted: !discovered.length
          }
        : {})
    });
    await createLog({ type: "discovery.run.completed", level: "info", message: `Discovery run completed for ${campaign.name}.`, metadata: stats });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown discovery error";
    await updateDoc(runRef, { status: "failed", completedAt: serverTimestamp(), errors: [message] });
    await createLog({ type: "discovery.run.failed", level: "error", message, metadata: { campaignId: campaign.id } });
  }
}

async function handleDiscoveredCompany(
  company: DiscoveredCompany,
  campaign: DiscoveryCampaign,
  runId: string,
  providerName: DiscoveryProviderName,
  stats: {
    companiesCreated: number;
    companiesQueuedForResearch: number;
    companiesSkippedDuplicate: number;
    companiesRejected: number;
    scoreTotal: number;
    errors: string[];
    logs: string[];
    duplicateCompanies: string[];
  }
) {
  // runDiscoveryCampaign already refused an unattributed campaign.
  const campaignBusinessId = campaign.businessId;
  const scoring = scoreDiscoveredCompany(company, campaign);
  const quality = assessDiscoveryQuality(company);
  stats.scoreTotal += 100; // Simplified score

  const normalized = normalizeCompanyInput({
    ...company,
    sourceType: providerName,
    rawProviderData: company.rawProviderData
  });

  const skipReasons: string[] = [];
  if (!company.sourceProvider || !company.sourceId) skipReasons.push("Missing source provider or source ID.");
  if (!company.sourceUrl && !company.sourceId) skipReasons.push("Missing source URL or source ID.");
  if (!normalized.data) skipReasons.push(normalized.skippedReason ?? "Normalization failed.");
  
  if (campaign.requireWebsite && !company.website && !company.domain) {
    skipReasons.push("Campaign requires a website/domain.");
  }
  
  if (campaign.minEmployeeCount && company.employeeCount && company.employeeCount < campaign.minEmployeeCount) {
    skipReasons.push(`Employee count ${company.employeeCount} is below campaign minimum ${campaign.minEmployeeCount}.`);
  }

  const companyText = [
    company.name,
    company.industry,
    company.nafLabel,
    company.description
  ].filter(Boolean).join(" ").toLowerCase();

  // Check excluded keywords
  if (campaign.excludeKeywords?.length) {
    for (const kw of campaign.excludeKeywords) {
      if (kw.trim() !== "" && companyText.includes(kw.trim().toLowerCase())) {
        skipReasons.push(`Contains excluded keyword: "${kw.trim()}".`);
        break;
      }
    }
  }

  // Check target keywords
  if (campaign.keywords?.length) {
    const hasKeyword = campaign.keywords.some(kw => kw.trim() !== "" && companyText.includes(kw.trim().toLowerCase()));
    if (!hasKeyword) {
      skipReasons.push("Does not match campaign target keywords.");
    }
  }

  // Check NAF codes
  if (campaign.nafCodes?.length && company.nafCode) {
    const companyNaf = company.nafCode.toUpperCase().replace(".", "");
    const targetNafCodes = new Set(campaign.nafCodes.map(code => code.toUpperCase().replace(".", "")));
    if (!targetNafCodes.has(companyNaf)) {
      skipReasons.push(`NAF code ${company.nafCode} does not match campaign targets.`);
    }
  }

  // Check Cities
  if (campaign.cities?.length && company.city) {
    const cityLower = company.city.toLowerCase().trim();
    const targetCities = new Set(campaign.cities.map(c => c.toLowerCase().trim()));
    if (!targetCities.has(cityLower)) {
      skipReasons.push(`City ${company.city} is not in target cities.`);
    }
  }

  if (normalized.data) {
    const duplicate = await findCompanyDuplicate(normalized.data, { allowNameCity: false });
    if (duplicate) {
      stats.companiesSkippedDuplicate += 1;
      stats.logs.push(`Duplicate company: ${company.name ?? duplicate.id}`);
      stats.duplicateCompanies.push(company.name ?? duplicate.id);
      return;
    }
  }

  if (skipReasons.length || !normalized.data) {
    stats.companiesRejected += 1;
    await addDoc(collection(db, collections.discoveryRejected), {
      workspaceId: campaign.workspaceId || "ws_default",
      businessId: campaignBusinessId,
      campaignId: campaign.id,
      runId,
      provider: providerName,
      sourceId: company.sourceId,
      name: company.name,
      normalizedName: normalized.data?.normalizedName,
      domain: normalized.data?.domain,
      siren: normalized.data?.siren,
      siret: normalized.data?.siret,
      city: company.city,
      qualityScore: 100,
      discoveryScore: 100,
      dataQualityWarnings: quality.warnings,
      skippedReason: skipReasons.join(" "),
      rawProviderData: company.rawProviderData,
      createdAt: serverTimestamp()
    });
    return;
  }

  const shouldQueue = campaign.autoQueueHighScoreCompanies;

  const result = await createOrMergeCompany(
    {
      ...company,
      workspaceId: campaign.workspaceId || "ws_default",
      businessId: campaignBusinessId,
      sourceType: providerName,
      rawProviderData: company.rawProviderData
    },
    { allowNameCity: false }
  );

  if ("id" in result && result.id) {
    const updates = {
      workspaceId: campaign.workspaceId || "ws_default",
      businessId: campaignBusinessId,
      offerId: campaign.offerId,
      status: shouldQueue ? "research_pending" : "discovered",
      discoveryCampaignId: campaign.id,
      discoveryRunId: runId,
      discoveryScore: 100,
      discoveryReasons: scoring.discoveryReasons,
      qualityScore: 100,
      dataQualityWarnings: quality.warnings,
      needsResearch: shouldQueue,
      updatedAt: serverTimestamp()
    };
    await updateDoc(doc(db, collections.companies, result.id), updates);
    stats.companiesCreated += result.status === "created" ? 1 : 0;

    if (shouldQueue) {
      const existingQueue = await getDocs(query(collection(db, "leadResearch"), where("companyId", "==", result.id), limit(1)));
      if (existingQueue.empty) {
        await addDoc(collection(db, "leadResearch"), {
          workspaceId: campaign.workspaceId || "ws_default",
          businessId: campaignBusinessId,
          offerId: campaign.offerId,
          companyId: result.id,
          status: "pending",
          rawInput: { queuedBy: "discovery", campaignId: campaign.id, runId },
          sourceUrls: [company.sourceUrl, company.website].filter(Boolean),
          createdAt: serverTimestamp()
        });
      }
      stats.companiesQueuedForResearch += 1;
    }
  }
}
