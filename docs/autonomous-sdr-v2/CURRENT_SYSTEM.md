# Current System Audit & Component Classification

This document records the exact state of the existing codebase (`devcomm_os`) as audited against actual source code files. Every major module is classified to enforce the **Golden Rule: Preserve Working Code**.

---

## 🧭 Component Classification Definitions

* **`KEEP`**: Working, robust, production-ready code. Do not rewrite.
* **`EXTEND`**: Solid foundation that requires new capabilities or multi-business parameters.
* **`REFACTOR`**: Logic is sound but requires architectural cleanup (e.g. separating business logic from generic engine).
* **`DEPRECATE`**: Legacy code to be phased out safely without breaking existing data.
* **`REPLACE`**: Fundamentally flawed or insecure component that must be superseded by a new implementation.

---

## 📊 Comprehensive Module Inventory

### 1. Company Discovery & Resolution

| Module / File Path | Current Capabilities | Classification | Justification & Evolution Plan |
| :--- | :--- | :---: | :--- |
| [functions/src/providers/discovery/recherche-entreprises-provider.ts](file:///Users/clarencedion/CODING/devcomm_os/functions/src/providers/discovery/recherche-entreprises-provider.ts) | Queries French Gov API (`recherche-entreprises.api.gouv.fr`), handles NAF 25-code chunking, exponential backoff on 429, pagination cursors. | **`KEEP`** | Extremely reliable, handles edge cases, 100% free French company registry. |
| [functions/src/providers/discovery/google-places-discovery-provider.ts](file:///Users/clarencedion/CODING/devcomm_os/functions/src/providers/discovery/google-places-discovery-provider.ts) | Searches Google Places via Serper.dev, retrieves title, address, phone, website, rating, reviews. | **`KEEP`** | High quality source for local merchants and businesses. |
| [functions/src/services/website-resolver.ts](file:///Users/clarencedion/CODING/devcomm_os/functions/src/services/website-resolver.ts) | Resolves missing company websites using Pappers SIREN lookup and Serper Google search with 60+ directory blacklist. | **`KEEP`** | Robust anti-annuaire filtering prevents saving fake directory domains. |
| [functions/src/providers/discovery/pappers-discovery-provider.ts](file:///Users/clarencedion/CODING/devcomm_os/functions/src/providers/discovery/pappers-discovery-provider.ts) | Pappers API client. Disabled by default to save API credits. | **`EXTEND`** | Keep as optional fallback discovery source for enriched legal data. |
| [functions/src/providers/discovery/sirene-discovery-provider.ts](file:///Users/clarencedion/CODING/devcomm_os/functions/src/providers/discovery/sirene-discovery-provider.ts) | Stubbed provider returning empty array `[]`. | **`DEPRECATE`** | Replaced by Recherche d'Entreprises provider. |
| [functions/src/providers/discovery/sirene-stock-provider.ts](file:///Users/clarencedion/CODING/devcomm_os/functions/src/providers/discovery/sirene-stock-provider.ts) | Stubbed provider returning empty array `[]`. | **`DEPRECATE`** | Unused stub. |
| [functions/src/services/run-discovery-campaign.ts](file:///Users/clarencedion/CODING/devcomm_os/functions/src/services/run-discovery-campaign.ts) | Orchestrates discovery runs, checks duplicate SIREN/domain, filters keywords/NAF. | **`EXTEND`** | Add multi-business workspace scoping and dynamic signal provider initialization. |

---

### 2. Data Cleaning, Normalization & Deduplication

| Module / File Path | Current Capabilities | Classification | Justification & Evolution Plan |
| :--- | :--- | :---: | :--- |
| [src/lib/data/company.ts](file:///Users/clarencedion/CODING/devcomm_os/src/lib/data/company.ts) | Normalizes company names, domains, SIREN/SIRET, addresses, and phone numbers. | **`KEEP`** | Core data integrity logic. Preserves clean database standards. |
| [src/lib/data/quality.ts](file:///Users/clarencedion/CODING/devcomm_os/src/lib/data/quality.ts) | Implements non-downgrading merges (`mergeWithoutDowngrade`) and quality score calculation. | **`KEEP`** | Prevents existing enriched records from being overwritten by poorer scraped data. |
| [src/features/import/csv-import-page.tsx](file:///Users/clarencedion/CODING/devcomm_os/src/features/import/csv-import-page.tsx) | CSV import with PapaParse, column mapping, warning flags, and deduplication preview. | **`EXTEND`** | Add workspace/business assignment dropdown. |

---

### 3. Contact & Decision Maker Discovery

| Module / File Path | Current Capabilities | Classification | Justification & Evolution Plan |
| :--- | :--- | :---: | :--- |
| [functions/src/providers/enrichment/dropcontact-provider.ts](file:///Users/clarencedion/CODING/devcomm_os/functions/src/providers/enrichment/dropcontact-provider.ts) | Dropcontact API client. Batch submits SIREN/domain, polls every 5s, extracts verified emails. | **`KEEP`** | Solid B2B decision maker contact enrichment integration. |
| [functions/src/services/company-enrichment.ts](file:///Users/clarencedion/CODING/devcomm_os/functions/src/services/company-enrichment.ts) | Scrapes homepage + up to 4 internal links for mailto/regex emails and phones. | **`EXTEND`** | Clean up scraping logic; integrate into generic Signal Provider architecture. |
| [functions/src/services/contact-discovery.ts](file:///Users/clarencedion/CODING/devcomm_os/functions/src/services/contact-discovery.ts) | Filters out accounting/legal roles, calls Dropcontact, saves contacts with `emailVerified`. | **`EXTEND`** | Add persona ranking engine and waterfall support (Dropcontact → secondary provider). |

---

### 4. Company Research & Website Audit

| Module / File Path | Current Capabilities | Classification | Justification & Evolution Plan |
| :--- | :--- | :---: | :--- |
| [functions/src/services/website-fetcher.ts](file:///Users/clarencedion/CODING/devcomm_os/functions/src/services/website-fetcher.ts) | Basic HTTP GET, strips script/style tags, max 12k chars text extraction. | **`REPLACE`** | Replace with a dedicated **Website Opportunity Signal Provider** capable of auditing PageSpeed, CMS, mobile UX, SSL, and e-commerce. |
| [functions/src/services/research-company.ts](file:///Users/clarencedion/CODING/devcomm_os/functions/src/services/research-company.ts) | Coordinates AI research, fit scoring (0-100), and status transitions. | **`REFACTOR`** | Decouple hardcoded "Devcomm" prompts and replace with evidence-based Opportunity Scoring engine. |
| [functions/src/services/research-prompts.ts](file:///Users/clarencedion/CODING/devcomm_os/functions/src/services/research-prompts.ts) | System and user prompts for B2B company research. | **`REFACTOR`** | Move prompt templates into Offer configuration; enforce prompt injection safety delimiters. |
| [functions/src/services/research-schema.ts](file:///Users/clarencedion/CODING/devcomm_os/functions/src/services/research-schema.ts) | Zod schema validating research JSON output (contains `bestDevcommOffer`). | **`REFACTOR`** | Generalize field names to `recommendedOffering` and decouple from specific company brands. |

---

### 5. Outreach Copywriting & Document Generation

| Module / File Path | Current Capabilities | Classification | Justification & Evolution Plan |
| :--- | :--- | :---: | :--- |
| [functions/src/services/outreach-generation.ts](file:///Users/clarencedion/CODING/devcomm_os/functions/src/services/outreach-generation.ts) | Generates French cold email copy, 2 follow-ups, LinkedIn notes, and sales briefs. | **`EXTEND`** | Add explicit `personalizationFacts[]` validation to ensure every claim is grounded in evidence. |
| [functions/src/services/pdf-generator.ts](file:///Users/clarencedion/CODING/devcomm_os/functions/src/services/pdf-generator.ts) | Renders multi-page branded PDF proposal using PDFKit and uploads to Firebase Storage. | **`EXTEND`** | Parameterize branding, colors, logos, and audit findings based on active Offer. |
| [functions/src/services/csv-exporter.ts](file:///Users/clarencedion/CODING/devcomm_os/functions/src/services/csv-exporter.ts) | Exports approved outreach batches to CSV on Firebase Storage. | **`KEEP`** | Useful manual export fallback. |

---

### 6. Email Dispatch, Follow-ups & Reply Sync

| Module / File Path | Current Capabilities | Classification | Justification & Evolution Plan |
| :--- | :--- | :---: | :--- |
| [functions/src/providers/email/instantly-provider.ts](file:///Users/clarencedion/CODING/devcomm_os/functions/src/providers/email/instantly-provider.ts) | Instantly.ai client (`/campaign/create`, `/lead/add`, `/lead/get`). | **`EXTEND`** | Upgrade to Instantly V2 webhook model to ingest incoming reply text and events. |
| [functions/src/services/send-outreach.ts](file:///Users/clarencedion/CODING/devcomm_os/functions/src/services/send-outreach.ts) | Checks daily limit, pushes approved outreach to Instantly campaign. | **`EXTEND`** | Enforce mandatory `canContact(...)` suppression and contactability checks before sending. |
| [functions/src/jobs/hourly-outreach-sync.ts](file:///Users/clarencedion/CODING/devcomm_os/functions/src/jobs/hourly-outreach-sync.ts) | Hourly cron polling Instantly API for boolean `replied` or `Bounced`. | **`REFACTOR`** | Replace primary dependency on polling with real-time inbound webhooks; keep polling only as reconciliation. |

---

### 7. Calendar & Meeting Tracking

| Module / File Path | Current Capabilities | Classification | Justification & Evolution Plan |
| :--- | :--- | :---: | :--- |
| [functions/src/jobs/calendar-sync-job.ts](file:///Users/clarencedion/CODING/devcomm_os/functions/src/jobs/calendar-sync-job.ts) | Refreshes Microsoft Graph OAuth token, pulls Outlook calendar events, links attendees to contacts. | **`KEEP`** | Working Microsoft Graph calendar sync. |
| [src/app/api/booking-webhook/route.ts](file:///Users/clarencedion/CODING/devcomm_os/src/app/api/booking-webhook/route.ts) | Microsoft Graph notification webhook endpoint. | **`REFACTOR`** | Add HMAC signature validation and idempotent event processing. |

---

### 8. Frontend & User Interface

| Module / File Path | Current Capabilities | Classification | Justification & Evolution Plan |
| :--- | :--- | :---: | :--- |
| [src/features/dashboard/dashboard-shell.tsx](file:///Users/clarencedion/CODING/devcomm_os/src/features/dashboard/dashboard-shell.tsx) | Pipeline funnel, KPI summary cards, next action items. | **`EXTEND`** | Add multi-business filter switcher and conversation activity stats. |
| [src/features/companies/companies-page.tsx](file:///Users/clarencedion/CODING/devcomm_os/src/features/companies/companies-page.tsx) & [company-detail.tsx](file:///Users/clarencedion/CODING/devcomm_os/src/features/companies/company-detail.tsx) | Company list table, tabs (Overview, Research, Contacts, Outreach, PDF, Logs). | **`EXTEND`** | Add evidence inspector tab and opportunity score breakdown. |
| [src/features/discovery/discovery-page.tsx](file:///Users/clarencedion/CODING/devcomm_os/src/features/discovery/discovery-page.tsx) | Campaign management, provider priority drag-and-drop, live E2E test runner. | **`EXTEND`** | Add Natural-Language Campaign Builder modal. |
| [src/features/outreach/outreach-page.tsx](file:///Users/clarencedion/CODING/devcomm_os/src/features/outreach/outreach-page.tsx) & [outreach-editor.tsx](file:///Users/clarencedion/CODING/devcomm_os/src/features/outreach/outreach-editor.tsx) | Cold email draft review, bulk approve, edit fields, risk warning badges. | **`EXTEND`** | Transform into complete SDR Inbox with full conversation thread view. |
| [src/features/settings/settings-page.tsx](file:///Users/clarencedion/CODING/devcomm_os/src/features/settings/settings-page.tsx) | Settings tabs for AI keys, daily limits, prompt overrides, integration keys. | **`REFACTOR`** | Remove insecure client-side secret reads; isolate business-specific vs workspace-level settings. |

---

### 9. Infrastructure, Security & AI Providers

| Module / File Path | Current Capabilities | Classification | Justification & Evolution Plan |
| :--- | :--- | :---: | :--- |
| [firestore.rules](file:///Users/clarencedion/CODING/devcomm_os/firestore.rules) | Security rules for 14 Firestore collections. | **`REFACTOR`** | **CRITICAL SECURITY FIX:** Block client reads to `settings/aiSecrets` and `settings/integrationSecrets`. Enforce workspace isolation. |
| [functions/src/providers/ai/index.ts](file:///Users/clarencedion/CODING/devcomm_os/functions/src/providers/ai/index.ts) | OpenAI, Anthropic, and Mock AI provider abstractions. | **`KEEP`** | Clean AI provider abstraction. |
| [functions/src/services/test-automation.ts](file:///Users/clarencedion/CODING/devcomm_os/functions/src/services/test-automation.ts) | Multi-step E2E simulation runner logging live to `automationTests/{testId}`. | **`KEEP`** | Vital live test harness. |
