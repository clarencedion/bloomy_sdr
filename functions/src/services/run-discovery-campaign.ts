import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
import { RechercheEntreprisesProvider } from "../providers/discovery/recherche-entreprises-provider.js";
import { PappersDiscoveryProvider } from "../providers/discovery/pappers-discovery-provider.js";
import { SireneDiscoveryProvider } from "../providers/discovery/sirene-discovery-provider.js";
import { SireneStockProvider } from "../providers/discovery/sirene-stock-provider.js";
import { GooglePlacesDiscoveryProvider } from "../providers/discovery/google-places-discovery-provider.js";
import { ManualDiscoveryProvider } from "../providers/discovery/manual-discovery-provider.js";
import type { DiscoveredCompany, DiscoverySearchInput, LeadDiscoveryProvider } from "../providers/discovery/lead-discovery-provider.js";
import { writeLog } from "../utils/logger.js";
import { getIntegrationSecrets } from "../utils/settings.js";
import { resolveCompanyWebsite } from "./website-resolver.js";
import { scoreDiscoveryFit } from "./discovery-scoring.js";

const providers: Record<string, LeadDiscoveryProvider> = {
  recherche_entreprises: new RechercheEntreprisesProvider(),
  sirene: new SireneDiscoveryProvider(),
  sirene_stock: new SireneStockProvider(),
  google_places: new GooglePlacesDiscoveryProvider(),
  pappers: new PappersDiscoveryProvider(),
  manual: new ManualDiscoveryProvider()
};

const defaultProviderPriority = ["recherche_entreprises", "sirene", "google_places"];

function cleanString(val: unknown): string | undefined {
  if (typeof val !== "string" && typeof val !== "number") return undefined;
  const cleaned = String(val).trim().replace(/\s+/g, " ");
  const placeholders = new Set(["", "n/a", "na", "unknown", "null", "undefined", "-", "--", "none", "sans", "inconnu"]);
  if (placeholders.has(cleaned.toLowerCase())) return undefined;
  return cleaned || undefined;
}

function normalizeCompanyName(val: unknown): string | undefined {
  const cleaned = cleanString(val);
  if (!cleaned) return undefined;
  return cleaned
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(sas|sasu|sarl|sa|eurl|scop|gmbh|ltd|inc)\b/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export async function runDiscoveryCampaign(campaignId: string) {
  const campaignSnapshot = await adminDb.collection("discoveryCampaigns").doc(campaignId).get();
  if (!campaignSnapshot.exists) throw new Error(`Discovery campaign not found: ${campaignId}`);
  const campaign = campaignSnapshot.data() as {
    workspaceId?: string;
    businessId?: string;
    offerId?: string;
    name: string;
    status: string;
    segment: string;
    keywords?: string[];
    excludeKeywords?: string[];
    cities?: string[];
    departments?: string[];
    regions?: string[];
    nafCodes?: string[];
    maxCompaniesPerRun?: number;
    providerPriority?: string[];
    researchStrategy?: unknown;
    rechercheEntreprisesPageCursor?: number;
    googlePlacesPageCursor?: number;
    autoQueueHighScoreCompanies?: boolean;
    minDiscoveryScoreForSave?: number;
    minDiscoveryScoreForAutoResearch?: number;
    minQualityScoreForAutoResearch?: number;
    requireWebsite?: boolean;
    minEmployeeCount?: number;
  };
  if (campaign.status === "paused") throw new Error("Discovery campaign is paused.");
  if (campaign.status === "archived") throw new Error("Discovery campaign is archived.");

  const providerPriority = campaign.providerPriority?.length ? campaign.providerPriority : defaultProviderPriority;
  const initialProviderName = providerPriority.find((name) => providers[name]) ?? "recherche_entreprises";
  
  const runRef = await adminDb.collection("discoveryRuns").add({
    workspaceId: campaign.workspaceId || "ws_default",
    businessId: campaign.businessId || "biz_devcomm",
    campaignId,
    campaignName: campaign.name,
    status: "running",
    provider: initialProviderName,
    startedAt: Timestamp.now(),
    companiesFound: 0,
    companiesCreated: 0,
    companiesQueuedForResearch: 0,
    companiesSkippedDuplicate: 0,
    companiesRejected: 0,
    logs: [],
    errors: []
  });

  const input: DiscoverySearchInput = {
    keywords: campaign.keywords,
    cities: campaign.cities,
    departments: campaign.departments,
    regions: campaign.regions,
    nafCodes: campaign.nafCodes,
    maxResults: campaign.maxCompaniesPerRun,
    candidateLimit: campaign.maxCompaniesPerRun ?? 15,
    startPage: campaign.rechercheEntreprisesPageCursor ?? 1,
    minEmployeeCount: campaign.minEmployeeCount
  };
  const errors: string[] = [];
  let providerName = initialProviderName;
  let companies: DiscoveredCompany[] = [];
  
  for (const candidate of providerPriority) {
    const provider = providers[candidate];
    if (!provider) continue;
    if (candidate === "pappers" && process.env.ENABLE_PAPPERS_ENRICHMENT !== "true") {
      errors.push("Pappers skipped because ENABLE_PAPPERS_ENRICHMENT is not true.");
      continue;
    }
    try {
      // Dynamic page cursor depending on current provider candidate
      const cursor = candidate === "google_places"
        ? (campaign.googlePlacesPageCursor ?? 1)
        : (campaign.rechercheEntreprisesPageCursor ?? 1);
      input.startPage = cursor;

      companies = await provider.searchCompanies(input);
      providerName = candidate;
      if (companies.length) break;
    } catch (error) {
      errors.push(`${candidate}: ${error instanceof Error ? error.message : "provider failed"}`);
    }
  }

  const integrationSecrets = await getIntegrationSecrets();
  const logs: string[] = [`${providerName} returned ${companies.length} companies.`];
  const duplicateCompanies: string[] = [];
  let statsCreated = 0;
  let statsQueued = 0;
  let statsSkippedDuplicate = 0;
  let statsRejected = 0;
  let totalScore = 0;

  for (const company of companies) {
    if (statsCreated >= (campaign.maxCompaniesPerRun ?? 15)) {
      logs.push(`Stopped after creating max limits of ${campaign.maxCompaniesPerRun} companies.`);
      break;
    }

    // 1. Resolve Website/Domain using Pappers/Serper if missing
    if (!company.website) {
      try {
        const resolved = await resolveCompanyWebsite(
          { name: company.name, city: company.city, siren: company.siren },
          { pappersApiKey: integrationSecrets.pappersApiKey, serperApiKey: integrationSecrets.serperApiKey }
        );
        if (resolved.website) {
          company.website = resolved.website;
          company.domain = resolved.domain;
        }
      } catch {
        // Silently catch website resolution error to not crash the run
      }
    }

    // Normalize domain if missing but website is present
    if (company.website && !company.domain) {
      try {
        const normalized = company.website.startsWith("http") ? company.website : `https://${company.website}`;
        company.domain = new URL(normalized).hostname.replace(/^www\./, "");
      } catch {
        // Keep as is
      }
    }

    // 2. Score company discovery fit
    const scoring = scoreDiscoveryFit(company, input);
    totalScore += 100;

    // 3. Normalization quality checks & thresholds
    const name = cleanString(company.name);
    const normalizedName = normalizeCompanyName(name);
    const skipReasons: string[] = [];

    if (!name || !normalizedName) skipReasons.push("Company name is required.");
    
    if (campaign.requireWebsite && !company.website && !company.domain) {
      skipReasons.push("Campaign requires a website/domain.");
    }

    if (campaign.minEmployeeCount && company.employeeCount && company.employeeCount < campaign.minEmployeeCount) {
      skipReasons.push(`Employee count ${company.employeeCount} is below campaign minimum ${campaign.minEmployeeCount}.`);
    }

    const companyText = [
      name,
      company.industry,
      company.nafLabel,
      company.description
    ].filter(Boolean).join(" ").toLowerCase();

    // Check excluded keywords (negative filtering)
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

    // 4. Check for duplicates in firestore database
    let isDuplicate = false;
    let existingCompanyId = "";
    if (normalizedName) {
      // Deduplicate by Siren, Siret or Domain (only if they are non-empty strings)
      let dupQuery = null;
      if (company.siren && company.siren.trim() !== "") {
        dupQuery = await adminDb.collection("companies").where("siren", "==", company.siren).limit(1).get();
      } else if (company.siret && company.siret.trim() !== "") {
        dupQuery = await adminDb.collection("companies").where("siret", "==", company.siret).limit(1).get();
      } else if (company.domain && company.domain.trim() !== "") {
        dupQuery = await adminDb.collection("companies").where("domain", "==", company.domain).limit(1).get();
      }

      if (dupQuery && !dupQuery.empty) {
        isDuplicate = true;
        existingCompanyId = dupQuery.docs[0].id;
      }
    }

    if (isDuplicate) {
      statsSkippedDuplicate += 1;
      duplicateCompanies.push(company.name ?? existingCompanyId);
      logs.push(`Duplicate skipped: ${company.name ?? existingCompanyId}`);
      continue;
    }

    // 5. Reject or Create
    if (skipReasons.length) {
      statsRejected += 1;
      await adminDb.collection("discoveryRejected").add({
        workspaceId: campaign.workspaceId || "ws_default",
        businessId: campaign.businessId || "biz_devcomm",
        campaignId,
        runId: runRef.id,
        provider: providerName,
        sourceId: company.sourceId ?? "",
        name: company.name ?? "Unnamed",
        normalizedName: normalizedName ?? "",
        domain: company.domain ?? "",
        siren: company.siren ?? "",
        siret: company.siret ?? "",
        city: company.city ?? "",
        qualityScore: 100, // Fallback quality score
        discoveryScore: 100,
        dataQualityWarnings: [],
        skippedReason: skipReasons.join(" "),
        rawProviderData: company.rawProviderData ?? {},
        createdAt: Timestamp.now()
      });
      continue;
    }

    const shouldQueue = campaign.autoQueueHighScoreCompanies;

    const docData = {
      workspaceId: campaign.workspaceId || "ws_default",
      businessId: campaign.businessId || "biz_devcomm",
      offerId: campaign.offerId,
      sourceType: providerName,
      sourceProvider: company.sourceProvider ?? providerName,
      sourceId: company.sourceId ?? "",
      sourceUrl: company.sourceUrl ?? "",
      sourceConfidence: company.sourceConfidence ?? 0.8,
      rawProviderData: company.rawProviderData ?? {},
      name,
      normalizedName,
      website: company.website ?? "",
      domain: company.domain ?? "",
      siren: company.siren ?? "",
      siret: company.siret ?? "",
      address: company.address ?? "",
      postalCode: company.postalCode ?? "",
      city: company.city ?? "",
      country: company.country ?? "France",
      industry: company.industry ?? "",
      nafCode: company.nafCode ?? "",
      nafLabel: company.nafLabel ?? "",
      employeeCount: company.employeeCount ?? null,
      establishmentCount: company.establishmentCount ?? null,
      administrativeStatus: company.administrativeStatus ?? "",
      description: company.description ?? "",
      importedAt: Timestamp.now(),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      status: shouldQueue ? "research_pending" : "discovered",
      discoveryCampaignId: campaignId,
      discoveryRunId: runRef.id,
      discoveryScore: 100,
      discoveryReasons: scoring.discoveryReasons,
      qualityScore: 100,
      dataQualityWarnings: [],
      needsResearch: shouldQueue
    };

    const newCompanyRef = await adminDb.collection("companies").add(docData);
    statsCreated += 1;

    if (shouldQueue) {
      await adminDb.collection("leadResearch").add({
        workspaceId: campaign.workspaceId || "ws_default",
        businessId: campaign.businessId || "biz_devcomm",
        offerId: campaign.offerId,
        companyId: newCompanyRef.id,
        status: "pending",
        rawInput: { queuedBy: "discovery", campaignId, runId: runRef.id },
        sourceUrls: [company.sourceUrl, company.website].filter(Boolean),
        createdAt: Timestamp.now()
      });
      statsQueued += 1;
    }
  }

  await runRef.update({
    status: "completed",
    completedAt: Timestamp.now(),
    provider: providerName,
    companiesFound: companies.length,
    companiesCreated: statsCreated,
    companiesQueuedForResearch: statsQueued,
    companiesSkippedDuplicate: statsSkippedDuplicate,
    companiesRejected: statsRejected,
    averageDiscoveryScore: companies.length ? Math.round(totalScore / companies.length) : 0,
    logs,
    duplicateCompanies,
    errors
  });

  if (providerName === "recherche_entreprises" || providerName === "google_places") {
    const isGoogle = providerName === "google_places";
    const cursorField = isGoogle ? "googlePlacesPageCursor" : "rechercheEntreprisesPageCursor";
    const exhaustedField = isGoogle ? "googlePlacesExhausted" : "rechercheEntreprisesExhausted";
    const pageSize = isGoogle ? 10 : 25;

    await campaignSnapshot.ref.update({
      [cursorField]: companies.length ? (input.startPage ?? 1) + Math.ceil(companies.length / pageSize) : input.startPage ?? 1,
      [exhaustedField]: !companies.length,
      updatedAt: Timestamp.now()
    });
  }

  await writeLog({
    type: "discovery.functions.run",
    level: "info",
    message: `Discovery provider ${providerName} completed. Created ${statsCreated} leads.`,
    metadata: { campaignId, runId: runRef.id }
  });

  return { runId: runRef.id, provider: providerName, companiesFound: companies.length };
}

