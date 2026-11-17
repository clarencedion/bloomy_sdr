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
import { enqueueTask } from "./task-queue-service.js";
import { getGlobalSettings } from "../utils/settings.js";
import { getIntegrationSecrets } from "../utils/settings.js";
import { resolveCompanyWebsite } from "./website-resolver.js";
import { describeUnusableWebsite, isUsableCompanyWebsite } from "./third-party-domains.js";
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

/**
 * The rejection reasons that need no network call.
 *
 * Split out so they can run before website resolution, which is a paid Pappers
 * lookup. Everything here is decided from what the discovery provider already
 * returned.
 */
function describeCheapRejections(
  company: DiscoveredCompany,
  campaign: {
    keywords?: string[];
    excludeKeywords?: string[];
    nafCodes?: string[];
    cities?: string[];
    minEmployeeCount?: number;
  }
): string[] {
  const reasons: string[] = [];
  const name = cleanString(company.name);
  if (!name || !normalizeCompanyName(name)) return ["Company name is required."];

  const companyText = [company.name, company.industry, company.nafLabel, company.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  for (const kw of campaign.excludeKeywords ?? []) {
    if (kw.trim() && companyText.includes(kw.trim().toLowerCase())) {
      reasons.push(`Contains excluded keyword: "${kw.trim()}".`);
    }
  }

  // A trade keyword OR a matching NAF code is enough.
  //
  // Requiring the keyword rejected registry results wholesale: a sole trader is
  // registered under their own name, so "SOPHIE TRESCA" never contains
  // "tatoueur" however precisely her NAF code says tattooing. Measured against
  // a live page of 25 registry results for the campaign's own NAF code, zero
  // passed. The official activity code is the stronger signal of the two.
  const wantsKeywords = (campaign.keywords ?? []).some((kw) => kw.trim());
  const wantsNaf = (campaign.nafCodes ?? []).some((code) => code.trim());

  const keywordMatch =
    wantsKeywords &&
    campaign.keywords!.some((kw) => kw.trim() && companyText.includes(kw.trim().toLowerCase()));

  const nafMatch =
    wantsNaf &&
    Boolean(company.nafCode) &&
    new Set(campaign.nafCodes!.map((c) => c.toUpperCase().replace(".", ""))).has(
      String(company.nafCode).toUpperCase().replace(".", "")
    );

  if ((wantsKeywords || wantsNaf) && !keywordMatch && !nafMatch) {
    reasons.push("Matches neither the campaign's trade keywords nor its activity codes.");
  }

  if (campaign.cities?.length && company.city) {
    const targets = new Set(campaign.cities.map((c) => c.toLowerCase().trim()));
    if (!targets.has(company.city.toLowerCase().trim())) {
      reasons.push(`City ${company.city} is not in target cities.`);
    }
  }

  if (campaign.minEmployeeCount && company.employeeCount && company.employeeCount < campaign.minEmployeeCount) {
    reasons.push(`Employee count ${company.employeeCount} is below campaign minimum ${campaign.minEmployeeCount}.`);
  }

  return reasons;
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
    /** Operator's segment choice; drives contact rules and enrichment spend. */
    targetSegment?: "small_business" | "large_company";
    /** How many pages to pull from each provider per run. */
    pagesPerRun?: number;
    /** Which entry of the resolved area list the next run starts from. */
    areaCursor?: number;
    /** Consecutive runs that created nothing. Drives the exhausted state. */
    emptyRunStreak?: number;
    /** True once the campaign has covered its area and finds nobody new. */
    areaExhausted?: boolean;
    /** Page reached per provider and area set, keyed "provider:area|area". */
    pageCursors?: Record<string, number>;
  };
  if (campaign.status === "paused") throw new Error("Discovery campaign is paused.");
  if (campaign.status === "archived") throw new Error("Discovery campaign is archived.");
  // A campaign belongs to a business or it does not run (ADR-016 #6). Running
  // it "as" a default business wrote its companies, research and spend into
  // that business's screens and quota.
  const campaignBusinessId = campaign.businessId as string | undefined;
  if (!campaignBusinessId) {
    throw new Error("Discovery campaign is not attributed to any business; attach it to a business before running it.");
  }

  const providerPriority = campaign.providerPriority?.length ? campaign.providerPriority : defaultProviderPriority;
  const initialProviderName = providerPriority.find((name) => providers[name]) ?? "recherche_entreprises";
  
  const runRef = await adminDb.collection("discoveryRuns").add({
    workspaceId: campaign.workspaceId || "ws_default",
    businessId: campaignBusinessId,
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

  // Where to search. A campaign with no city used to fall through to a city
  // hardcoded in the provider, so a nationwide brief quietly became a
  // single-city one and went silent the moment that city ran dry.
  const settingsForAreas = await getGlobalSettings();
  const allAreas = (campaign.cities?.length
    ? campaign.cities
    : settingsForAreas.defaultDiscoveryCities ?? []
  ).filter(Boolean);

  if (!allAreas.length) {
    await runRef.update({
      status: "failed",
      completedAt: Timestamp.now(),
      errors: ["No area to search."]
    });
    await writeLog({
      type: "discovery.campaign.no_area",
      level: "warning",
      message: `Campaign "${campaign.name}" has no city or area to search, so nothing can be found.`,
      workspaceId: campaign.workspaceId,
      businessId: campaign.businessId,
      metadata: { campaignId }
    });
    throw new Error("This campaign has no city or area to search. Add one and it will start finding companies.");
  }

  // Rotate through the areas rather than always starting at the first: with
  // several cities and a per-run cap, run one would otherwise re-scrape city
  // one for ever and cities two onward would never be reached.
  const areaCursor = campaign.areaCursor ?? 0;
  const AREAS_PER_RUN = 3;
  const searchAreas = allAreas.length <= AREAS_PER_RUN
    ? allAreas
    : Array.from({ length: AREAS_PER_RUN }, (_, i) => allAreas[(areaCursor + i) % allAreas.length]);

  const input: DiscoverySearchInput = {
    keywords: campaign.keywords,
    cities: searchAreas,
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
  
  // Query EVERY configured provider and several pages each, then merge.
  //
  // Previously this stopped at the first provider that returned anything, so a
  // campaign listing three providers only ever used one: Google Places always
  // returned results, and SIRENE / Recherche d'Entreprises - which between them
  // cover every registered company in France - were never queried. Combined
  // with one page per night that capped a campaign at ~15 companies/day, most
  // of which were duplicates by the third run.
  const pagesPerRun = Math.max(1, Math.min(campaign.pagesPerRun ?? 3, 10));
  const targetCount = campaign.maxCompaniesPerRun ?? 15;
  const seenKeys = new Set<string>();
  const usedProviders: string[] = [];

  /** Cheap in-batch dedupe so one company found by two providers is fetched once. */
  const dedupeKey = (company: DiscoveredCompany) =>
    (company.siren && `siren:${company.siren}`) ||
    (company.website && `web:${String(company.website).toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}`) ||
    `name:${String(company.name ?? "").toLowerCase().trim()}|${String(company.city ?? "").toLowerCase().trim()}`;

  for (const candidate of providerPriority) {
    const provider = providers[candidate];
    if (!provider) continue;
    if (candidate === "pappers" && process.env.ENABLE_PAPPERS_ENRICHMENT !== "true") {
      errors.push("Pappers skipped because ENABLE_PAPPERS_ENRICHMENT is not true.");
      continue;
    }

    // Paging restarts when the areas change.
    //
    // The cursor was global while the areas rotate three at a time, so it only
    // ever climbed: by the time the rotation reached a fresh city the cursor
    // stood at 19, and the provider was asked for page 19 of a city it had
    // never searched. It returned nothing, the campaign was marked exhausted,
    // and discovery went quiet while still reporting "completed".
    //
    // A page number is only meaningful for the area it was counted in, so it is
    // kept per area set rather than per campaign.
    const areaKey = searchAreas.join("|").toLowerCase();
    const cursors = (campaign.pageCursors ?? {}) as Record<string, number>;
    const baseCursor = cursors[`${candidate}:${areaKey}`] ?? 1;

    for (let page = 0; page < pagesPerRun; page += 1) {
      // Stop asking for more once we already have enough candidates: every
      // extra call costs money and the creation loop would discard them.
      if (seenKeys.size >= targetCount * 2) break;

      try {
        input.startPage = baseCursor + page;
        const batch = await provider.searchCompanies(input);
        if (!batch.length) break; // this provider is exhausted for now

        let added = 0;
        for (const company of batch) {
          const key = dedupeKey(company);
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          companies.push(company);
          added += 1;
        }

        if (!usedProviders.includes(candidate)) usedProviders.push(candidate);
        providerName = candidate;
        if (added === 0) break; // pages have started repeating
      } catch (error) {
        errors.push(`${candidate}: ${error instanceof Error ? error.message : "provider failed"}`);
        break;
      }
    }
  }

  if (usedProviders.length > 1) {
    providerName = usedProviders.join("+");
  }

  const integrationSecrets = await getIntegrationSecrets();
  const logs: string[] = [`${providerName} returned ${companies.length} companies.`];
  const duplicateCompanies: string[] = [];
  let statsCreated = 0;
  let statsQueued = 0;
  let statsSkippedDuplicate = 0;
  let statsRejected = 0;
  let totalScore = 0;

  // Queue-backed execution lets the 5-minute worker start research almost
  // immediately; the synchronous fallback relies on the daily sweep instead.
  const queuesEnabled = (await getGlobalSettings().catch(() => null))?.enableTaskQueues !== false;

  for (const company of companies) {
    if (statsCreated >= (campaign.maxCompaniesPerRun ?? 15)) {
      logs.push(`Stopped after creating max limits of ${campaign.maxCompaniesPerRun} companies.`);
      break;
    }

    // 1. Reject on what we already know, BEFORE paying to learn more.
    //
    // Website resolution calls Pappers, a paid API. It used to run here, on
    // every candidate, ahead of every filter — and the filters then rejected
    // essentially all of them: measured on a live page of registry results,
    // 0 of 25 passed. That is a paid lookup per discarded company, several
    // hundred over a few days, and none of it appeared anywhere because the
    // resolver logs nothing and records no spend.
    //
    // The cheap checks below need no network call, so they run first and the
    // candidate is dropped before anything is spent on it.
    const preFilterReasons = describeCheapRejections(company, campaign);
    if (preFilterReasons.length) {
      statsRejected += 1;
      logs.push(`Skipped ${company.name ?? "unnamed"}: ${preFilterReasons.join(" ")}`);
      continue;
    }

    // 2. Resolve Website/Domain if missing.
    //
    // Skipped for small businesses: the same reasoning as the contact
    // waterfall, where a registry lookup on a two-chair salon returns nothing
    // the free sources did not already have. The free Serper path still runs.
    if (!company.website) {
      const paidLookupAllowed = campaign.targetSegment !== "small_business";
      try {
        const resolved = await resolveCompanyWebsite(
          { name: company.name, city: company.city, siren: company.siren },
          {
            pappersApiKey: paidLookupAllowed ? integrationSecrets.pappersApiKey : undefined,
            serperApiKey: integrationSecrets.serperApiKey
          }
        );
        if (resolved.website) {
          company.website = resolved.website;
          company.domain = resolved.domain;
        }
        if (resolved.resolvedBy === "pappers") {
          // A paid call must never be invisible again.
          await writeLog({
            type: "discovery.website.paid_lookup",
            level: "info",
            message: `Pappers resolved a website for ${company.name}.`,
            workspaceId: campaign.workspaceId,
            businessId: campaign.businessId,
            metadata: { companyName: company.name, siren: company.siren, provider: "pappers" }
          });
        }
      } catch {
        // Silently catch website resolution error to not crash the run
      }
    }

    // A listing is not a website. Places returns whatever link the entry
    // carries, so this is where a Waze map, a government directory page or a
    // blog post about the owner would otherwise become "their site" — and then
    // get audited for speed, scraped for an email, and posted a contact form.
    if (company.website && !isUsableCompanyWebsite(company.website)) {
      // Kept, because "their only web presence is a booking platform" is real
      // evidence of the need we sell against. It is just not their site.
      company.directoryUrl = company.website;
      company.websiteRejectedReason = describeUnusableWebsite(company.website) ?? undefined;
      company.website = undefined;
      company.domain = undefined;
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
        businessId: campaignBusinessId,
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
      businessId: campaignBusinessId,
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
      // A listing we found but must not treat as their site. Having only this
      // is itself the need signal a web-studio offer sells against.
      directoryUrl: company.directoryUrl ?? "",
      websiteRejectedReason: company.websiteRejectedReason ?? "",
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
      // The operator's segment choice travels with the company so every later
      // stage (contact rules, paid enrichment) applies the same policy.
      targetSegment: campaign.targetSegment ?? null,
      // Required by downstream jobs that order by activity; without it a
      // company is invisible to any ordered query.
      lastActivityAt: Timestamp.now(),
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
        businessId: campaignBusinessId,
        offerId: campaign.offerId,
        companyId: newCompanyRef.id,
        status: "pending",
        rawInput: { queuedBy: "discovery", campaignId, runId: runRef.id },
        sourceUrls: [company.sourceUrl, company.website].filter(Boolean),
        createdAt: Timestamp.now()
      });

      // Hand the company straight to the task queue, which a worker drains
      // every 5 minutes. Without this, a freshly discovered company waited for
      // the once-daily 08:00 research job - so a campaign started in the
      // afternoon showed no progress until the next morning.
      if (queuesEnabled) {
        try {
          await enqueueTask(
            "TASK_PIPELINE_COMPANY",
            { companyId: newCompanyRef.id },
            {
              workspaceId: campaign.workspaceId || "ws_default",
              businessId: campaignBusinessId
            }
          );
          // Already queued: leave it out of the daily runner's sweep so the
          // same company is not researched twice.
          await newCompanyRef.update({ needsResearch: false });
        } catch (error) {
          // Fall back to the daily sweep rather than losing the company.
          await writeLog({
            type: "discovery.enqueue_failed",
            level: "warning",
            message: `Could not enqueue research for ${company.name}; it will be picked up by the daily job.`,
            workspaceId: campaign.workspaceId || "ws_default",
            businessId: campaign.businessId,
            metadata: { companyId: newCompanyRef.id, error: error instanceof Error ? error.message : "unknown" }
          });
        }
      }

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

  // Advance the cursor of every provider we actually paged through, so the next
  // run continues where this one stopped instead of re-reading the same pages.
  const cursorUpdates: Record<string, unknown> = { updatedAt: Timestamp.now() };

  const areaKeyForRun = searchAreas.join("|").toLowerCase();
  const nextCursors: Record<string, number> = { ...(campaign.pageCursors ?? {}) };
  for (const used of usedProviders) {
    const key = `${used}:${areaKeyForRun}`;
    nextCursors[key] = (nextCursors[key] ?? 1) + pagesPerRun;
    if (used === "google_places") cursorUpdates.googlePlacesExhausted = false;
    if (used === "recherche_entreprises") cursorUpdates.rechercheEntreprisesExhausted = false;
  }
  cursorUpdates.pageCursors = nextCursors;

  // A provider that returned nothing this run is exhausted for these criteria;
  // recording that lets the next run skip straight past it.
  if (!usedProviders.includes("google_places") && providerPriority.includes("google_places")) {
    cursorUpdates.googlePlacesExhausted = true;
  }
  if (!usedProviders.includes("recherche_entreprises") && providerPriority.includes("recherche_entreprises")) {
    cursorUpdates.rechercheEntreprisesExhausted = true;
  }

  cursorUpdates.areaCursor = (areaCursor + AREAS_PER_RUN) % allAreas.length;

  // A campaign that finds nobody, run after run, has covered its area. Saying
  // so is the whole point: this one reported "active" through twelve
  // consecutive runs that created zero companies, which reads as broken rather
  // than finished.
  const emptyRunStreak = statsCreated === 0 ? (campaign.emptyRunStreak ?? 0) + 1 : 0;
  cursorUpdates.emptyRunStreak = emptyRunStreak;

  const EXHAUSTED_AFTER_EMPTY_RUNS = 4;
  const justExhausted = emptyRunStreak >= EXHAUSTED_AFTER_EMPTY_RUNS && !campaign.areaExhausted;
  cursorUpdates.areaExhausted = emptyRunStreak >= EXHAUSTED_AFTER_EMPTY_RUNS;

  await campaignSnapshot.ref.update(cursorUpdates);

  if (justExhausted) {
    await writeLog({
      type: "discovery.campaign.area_exhausted",
      level: "warning",
      message: `Campaign "${campaign.name}" has found everyone matching in ${allAreas.join(", ")}.`,
      workspaceId: campaign.workspaceId,
      businessId: campaign.businessId,
      metadata: { campaignId, areas: allAreas, emptyRuns: emptyRunStreak }
    });
  }

  await writeLog({
    type: "discovery.functions.run",
    level: "info",
    message: `Discovery provider ${providerName} completed. Created ${statsCreated} leads.`,
    metadata: { campaignId, runId: runRef.id, areas: searchAreas, created: statsCreated }
  });

  return { runId: runRef.id, provider: providerName, companiesFound: companies.length };
}

