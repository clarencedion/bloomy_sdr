# Phase 2 — Autonomous Lead Discovery

## Goal

The app must not depend only on manual CSV imports.

Build an autonomous lead discovery engine that can find relevant companies for Devcomm, enrich them, deduplicate them, and prepare them for AI research.

This phase comes before AI Research.

## Important Principle

The app should be able to run 24/7 and discover companies automatically, but it must stay cost-controlled, compliant, and configurable.

Do not create an uncontrolled scraper.

Use structured sources first:
- API Recherche d'Entreprises / Annuaire des Entreprises from data.gouv.fr
- Sirene / INSEE for official validation
- Sirene Stock files for future low-cost bulk discovery
- Google Places API only if configured
- Pappers API only as optional premium enrichment
- user-provided target search rules
- optional Apollo/Kaspr/LinkedIn CSV import later

## Target Segments for Devcomm

The discovery engine should find companies matching one or more of these segments:

### Segment 1 — Commercial Performance

Companies likely to have sales teams.

Examples:
- B2B SaaS companies
- IT services companies
- telecom companies
- business services
- insurance brokers
- real estate networks
- industrial suppliers
- consulting firms
- companies recruiting salespeople
- companies with agencies or multi-site sales teams

Target personas:
- Directeur Commercial
- Responsable Commercial
- Business Developer Manager
- CEO / Dirigeant
- Responsable Formation

### Segment 2 — HR / Training

Companies likely to need training services.

Examples:
- SMEs and mid-sized companies
- companies with many employees
- companies with frequent hiring
- companies with training pages or HR pages
- companies with multi-location operations

Target personas:
- DRH
- Responsable Formation
- Responsable RH
- Dirigeant

### Segment 3 — Skills2Drive / Road Safety / Fleet

Companies likely to have field teams, drivers, fleets, or road-risk training needs.

Examples:
- logistics companies
- delivery companies
- transport companies
- construction companies
- maintenance companies
- cleaning companies
- security companies
- utility companies
- field service companies
- companies with technicians
- companies with commercial field teams
- local authorities or public operators if relevant

Target personas:
- Responsable QHSE
- Responsable Flotte
- Responsable Prévention
- Directeur d’exploitation
- Responsable Formation
- Dirigeant

## Discovery Sources

### 1. Recherche d'Entreprises / Annuaire des Entreprises

Default free discovery source.

Use it to discover French companies by:
- text query
- city or geography
- activity/sector keywords
- NAF/APE-oriented searches when available
- local target rules

Store:
- SIREN/SIRET when available
- company name
- address
- city
- postal code
- activity code
- activity label
- source provider
- source ID
- source URL
- raw source data

### 2. Sirene / INSEE

Use Sirene as the official validation source.

Validate:
- SIREN/SIRET
- active/closed status
- NAF/APE code
- legal name
- address
- commune/postal code
- creation date
- establishment/headquarters data

### 3. Sirene Stock Files

Prepare a provider abstraction for monthly Stock Sirene files from data.gouv.fr.

Use later for low-cost bulk discovery:
- download/process official datasets
- filter locally by city, NAF code, activity, and active status
- avoid expensive API calls for large-scale discovery

Do not implement full bulk import until that phase is explicitly requested.

### 4. Google Places API

Use Google Places only as optional enrichment if a key is configured.

It can help find:
- website/local presence
- local business profiles
- address hints

Do not depend on Google Places for core discovery.

### 5. Pappers API

Pappers is optional premium enrichment only, not default discovery.

If Pappers API key is configured, implement a provider that can search French companies by:
- NAF/APE code
- city
- department
- region
- company size if available
- keywords
- legal form
- activity

Store:
- SIREN/SIRET
- company name
- address
- city
- postal code
- activity code
- activity label
- website if available
- directors if available and legally usable
- source URL
- raw source data

Call it only for high-score companies when explicitly enabled and monthly limits allow it.

### 6. Website Discovery

For discovered companies with websites:
- fetch homepage
- extract title, meta description, visible text
- detect contact page URL
- detect careers/recruitment page URL if available
- detect keywords:
  - formation
  - recrutement
  - commerciaux
  - équipe terrain
  - flotte
  - sécurité
  - QHSE
  - prévention
  - maintenance
  - livraison
  - techniciens

This prepares the company for AI research.

## Firestore Collections

Add:

```ts
type DiscoverySource = {
  id: string;
  name: string;
  provider: "recherche_entreprises" | "sirene" | "sirene_stock" | "google_places" | "pappers" | "manual" | "csv";
  enabled: boolean;
  apiKeySecretName?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};
```

```ts
type DiscoveryCampaign = {
  id: string;
  name: string;
  status: "draft" | "active" | "paused" | "completed";
  segment: "commercial_performance" | "training_hr" | "road_safety" | "custom";
  cities: string[];
  departments?: string[];
  regions?: string[];
  keywords: string[];
  nafCodes?: string[];
  maxCompaniesPerRun: number;
  maxCompaniesTotal?: number;
  minEmployeeCount?: number;
  requireWebsite?: boolean;
  providerPriority: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastRunAt?: Timestamp;
};
```

```ts
type DiscoveryRun = {
  id: string;
  campaignId: string;
  status: "pending" | "running" | "completed" | "failed";
  provider: string;
  startedAt: Timestamp;
  completedAt?: Timestamp;
  companiesFound: number;
  companiesCreated: number;
  companiesSkippedDuplicate: number;
  errors?: string[];
  logs?: string[];
};
```

Add fields to companies:
- siren?: string
- siret?: string
- nafCode?: string
- nafLabel?: string
- address?: string
- postalCode?: string
- discoveryCampaignId?: string
- discoveryRunId?: string
- discoveryScore?: number
- discoveryReasons?: string[]
- needsResearch?: boolean

## Backend Services

Create provider abstraction:

```ts
interface LeadDiscoveryProvider {
  searchCompanies(input: DiscoverySearchInput): Promise<DiscoveredCompany[]>;
}
```

Create providers:
- RechercheEntreprisesProvider as the default free source
- SireneDiscoveryProvider for official validation
- SireneStockProvider placeholder for future bulk discovery
- GooglePlacesDiscoveryProvider placeholder or implementation if API key is provided
- PappersDiscoveryProvider as optional premium enrichment only
- ManualDiscoveryProvider for testing

Create services:
- runDiscoveryCampaign(campaignId)
- normalizeDiscoveredCompany(raw)
- deduplicateCompany(discoveredCompany)
- scoreDiscoveryFit(discoveredCompany)
- createCompanyFromDiscovery(discoveredCompany)
- queueCompanyForResearch(companyId)

## Discovery Fit Score

Before expensive AI research, calculate a cheap deterministic discovery score.

Score factors:
- target industry match
- city/region match
- company has website
- company has enough employees if known
- keywords match segment
- NAF code relevance
- presence of fleet/field/sales/training signals
- not already contacted
- not already rejected

Example:
- 80+ = queue for AI research automatically
- 50-79 = save as discovered, needs review
- <50 = save only if settings allow, otherwise skip

## Frontend Pages

Add page:

```txt
/discovery
```

Sections:
1. Discovery dashboard
2. Discovery campaigns
3. Create discovery campaign
4. Discovery runs
5. Discovered companies
6. Provider settings
7. Logs

### Create Discovery Campaign Form

Fields:
- campaign name
- segment
- cities
- departments/regions
- keywords
- NAF codes
- max companies per run
- require website
- min employee count
- provider priority
- auto-queue high-score companies for AI research yes/no

Default provider priority:
1. recherche_entreprises
2. sirene
3. google_places if configured
4. pappers only if explicitly enabled

The UI must clearly label: "Pappers is optional premium enrichment, not default discovery."

Add a built-in Devcomm template:
- name: "Force de vente B2B - secteurs references Devcomm"
- segment: commercial_performance
- objective: find companies likely to have a structured commercial team or around 10 salespeople
- default first-test limits: maxCompaniesPerRun 20, minEmployeeCount 20, minDiscoveryScoreForQueue 65, minQualityScoreForQueue 70
- full recommended limits: maxCompaniesPerRun 50, minEmployeeCount 30, minDiscoveryScoreForQueue 75, minQualityScoreForQueue 70

The template must rely on proxy signals because public company databases do not directly provide sales-team headcount:
- employee count
- multiple establishments/agencies
- distributor/wholesaler/supplier activity
- B2B/professional customer signals
- NAF code alignment
- sales-role and quote/contact keywords

Discovery reasons should remain labeled:
- matchedSectorSignals
- matchedSalesForceSignals
- matchedNafCodes
- matchedKeywords
- locationMatches
- employeeCountSignals
- negativeSignals
- qualitySignals

### Discovery Campaign Detail

Show:
- status
- settings
- runs
- companies found
- companies created
- duplicates skipped
- average discovery score
- errors
- button: Run Now
- button: Pause
- button: Queue selected for AI Research

## Scheduled Function

Create:

```ts
scheduledLeadDiscoveryRunner
```

Runs daily or several times per week depending on settings.

It should:
1. Check automationPaused
2. Fetch active discovery campaigns
3. Respect global daily discovery limit
4. Run discovery providers
5. Deduplicate
6. Score
7. Create companies
8. Queue high-score companies for AI research
9. Log everything

## Settings

Add global settings:
- dailyDiscoveryLimit
- autoQueueDiscoveredCompanies
- minDiscoveryScoreForAutoResearch
- enabledDiscoveryProviders
- defaultDiscoveryCities
- defaultDiscoverySegments

## Acceptance Criteria

- User can create a discovery campaign.
- User can run the campaign manually.
- System can find or simulate companies through provider abstraction.
- Companies are deduplicated.
- Discovered companies appear in Companies page.
- High-score companies can be automatically queued for AI research.
- Discovery runs are logged.
- Scheduled discovery runner exists.
- Costs and limits are respected.
