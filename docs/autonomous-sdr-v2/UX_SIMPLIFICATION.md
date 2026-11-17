# UX Simplification — Audit & Implementation

**Goal:** Make the product feel like *hiring an SDR*, not operating a CRM.
The backend (17 phases, 80 requirements) stays untouched. Only the *experience* is simplified.

> Target journey: **Tell the SDR what you want to sell → Click Start → Receive meetings.**

---

## 1. CURRENT FLOW (audited)

### 1.1 Routes found (`src/app/(app)/app/`)

| Route | Feature module | User-facing concept exposed |
|---|---|---|
| `/app/dashboard` | `dashboard-shell.tsx` | 8 raw metrics + pipeline + "next actions" |
| `/app/discovery` | `discovery-page.tsx` (794 L) | Campaigns, runs, rejected discoveries, providers, E2E test runner |
| `/app/companies` + `/[companyId]` | `companies/` | Raw company table, evidence tab, score card |
| `/app/contacts` | `contacts-page.tsx` | Raw contact table |
| `/app/research` | `research-queue-page.tsx` | AI research queue (job-level concept) |
| `/app/outreach` | `outreach-page.tsx`, `outreach-editor.tsx` | Draft → approve → send workflow |
| `/app/inbox` | `sdr-inbox-page.tsx` | Conversations, 6 technical tabs |
| `/app/meetings` | `meetings-page.tsx` | Flat meeting table w/ filters |
| `/app/analytics` | `analytics-dashboard.tsx` (634 L) | Funnel + dimensions + recommendations |
| `/app/campaigns` | `PlaceholderPage` | **Dead route** — a placeholder |
| `/app/calendar` | `PlaceholderPage` | **Dead route** — a placeholder |
| `/app/import` | `csv-import-page.tsx` | CSV import |
| `/app/logs` | `logs-page.tsx` | Raw technical logs |
| `/app/settings` | `settings-page.tsx` (**1507 L**) | One giant page: business, offers, knowledge, providers, prompts, secrets, budget, test mode |

### 1.2 Navigation found

Two competing definitions of navigation existed:

* `src/lib/constants/navigation.ts` — a flat list of **13** items.
* `src/components/layout/app-sidebar.tsx` — a **different** 5-group "STEP 1 / STEP 2 / STEP 3" workflow list.

The sidebar exposed the *internal pipeline* as the mental model:
`STEP 1 — FIND` → `STEP 2 — RESEARCH` → `STEP 3 — ENGAGE & DIALOGUE` → `RESULTS`.
This teaches the user the machine's stages instead of hiding them.

### 1.3 Manual steps required today

To get from intent to a sent email, a user had to perform, by hand:

1. Discovery → **Create campaign** (or NL modal) → review ~20 config fields
2. **Run campaign** (explicit button per campaign)
3. Companies → inspect → **Queue for research**
4. Research queue → **Run research queue** (button in the topbar)
5. Companies → **Find contacts** (per company)
6. **Generate outreach** (per company)
7. Outreach → **Approve**
8. Outreach → **Send**
9. Topbar → **Sync**

That is **9 manual verbs** exposed for a job the user described in one sentence.

---

## 2. PROBLEM

| # | Problem | Evidence |
|---|---|---|
| P1 | **Machine stages are the navigation.** The IA is a pipeline diagram, so the user must learn discovery/research/outreach/queue vocabulary. | `app-sidebar.tsx` STEP 1/2/3 groups |
| P2 | **No "front door."** Landing page is a metrics dashboard (`companies crawled`, `estimated AI cost`), not an action. | `dashboard-shell.tsx`, `dashboardMetrics` |
| P3 | **Campaign creation exposes the implementation.** NL prompt exists but immediately dumps NAF codes, provider priority, 8 signal providers, min employee counts, score thresholds. | `nl-campaign-modal.tsx` (793 L), `discovery-create-form.tsx` |
| P4 | **No campaign result surface.** `/app/campaigns` was a placeholder; progress was only inferable by cross-referencing 4 different tables. | `campaigns/page.tsx` |
| P5 | **Activity feed is raw logs.** `getRecentAgentActivity` returns `logs` rows verbatim (`research.website_fetch`, `queue.task.dead_letter`). | `inbox-service.ts:393` |
| P6 | **Technical language everywhere.** "Outreach & Séquences", "AI Research Queue", "Lead readiness", "Enrichment", "Suppressed". | sidebar + page headers |
| P7 | **Settings is one 1507-line page.** Twenty API controls on one surface. | `settings-page.tsx` |
| P8 | **Redundant manual verbs** (see §1.3) for steps the backend already automates on schedule. | `scheduledLeadDiscoveryRunner`, `dailyResearchQueueRunner` |
| P9 | **Dead routes** (`/app/campaigns`, `/app/calendar`) shipped as placeholders in primary navigation. | `PlaceholderPage` |
| P10 | **BUG (blocking real data):** `conversations` has **no Firestore rule**, so the catch-all `allow read, write: if false` denies every client read. The SDR Inbox reads conversations client-side and would fail against real rules. | `firestore.rules` (no `match /conversations/`) vs `firestore.ts:643` `listInboxConversations` |

---

## 3. NEW FLOW

### 3.1 Information architecture

```
PRIMARY                      ADVANCED (collapsed, opt-in)
🏠  Home        ← default    Companies
🎯  Campaigns                Contacts
💬  Inbox                    Research
📅  Meetings                 Outreach
                             Imports
⚙️  Settings                 Analytics
                             System logs
```

Four primary surfaces. Everything operational moves behind `/app/advanced` — **nothing is deleted**.

### 3.2 The three-interaction journey

```
1. Type what you want to sell        (Home, one textarea)
2. Read "Here's what I understood"   (plain-language plan)
3. Click "Start prospecting"         (campaign goes live)
```

**Interactions between describing and launching: 2.** (type → confirm-and-start)

Everything after that is automated by existing backend jobs:
discover → audit → qualify → find contact → research → generate → send → follow up → reply → book,
governed by the business `automationPolicy.mode` (`draft_only` / `assisted` / `autonomous`).

### 3.3 Screen map

| Screen | Route | Data source (all real) |
|---|---|---|
| **Home / Agent** | `/app/home` | `getHomeSummary()` → campaigns, companies, conversations, meetings |
| Campaign plan review | inline on Home | `callTranslateIcpPrompt` (existing AI callable) |
| **Campaign list** | `/app/campaigns` | `discoveryCampaigns` + per-campaign funnel |
| **Campaign overview** | `/app/campaigns/[campaignId]` | `getCampaignOverview()` + `getAgentActivity()` + `getBestProspects()` |
| **Inbox** | `/app/inbox` | `listInboxConversations` (+ rule fix P10) |
| **Meetings** | `/app/meetings` | `listAllMeetings` grouped by day |
| **Advanced hub** | `/app/advanced` | links to preserved operational tooling |

### 3.4 Aggregation layer (no business logic in components)

`src/lib/sdr/`

| Helper | Purpose |
|---|---|
| `getCampaignOverview(campaignId)` | headline counts + funnel for one campaign |
| `getCampaignFunnel(...)` | found → qualified → people → contacted → replies → meetings |
| `getHomeSummary()` | cross-campaign roll-up for the Home screen |
| `getAgentActivity()` | logs → **human-readable** events |
| `getAttentionRequired()` | conversations genuinely needing a human |
| `getUpcomingMeetings()` | meetings grouped Today / Tomorrow / Later |
| `getBestProspects(campaignId)` | top opportunities w/ plain-language reasons |
| `humanizeActivity(log)` | pure mapper: `research.website_fetch` → "Checked their website" |
| `describeOpportunity(score)` | pure mapper: `OpportunityScore` → "Strong local reputation" |

`humanizeActivity` and `describeOpportunity` are pure functions and unit-tested.

### 3.5 Language changes

| Before | After |
|---|---|
| Discovery / Lead discovery | Finding companies |
| Enrichment / Lead research | Research |
| AI Research Queue | *(hidden — Advanced)* |
| Outreach & Séquences | Emails |
| Lead readiness / qualified lead | Good opportunity |
| Provider / data source API | Data source |
| Suppressed | Unsubscribed |
| Conversation `in_dialogue` | AI handling |
| Tenant / workspace | Business |

### 3.6 What was NOT changed

* No SDR backend service was rewritten (Invariant: preserve working code).
* No business-specific branching was introduced — Home, campaign plan review and campaign overview are driven entirely by `Business` + `Offer` + `Campaign` + `OpportunityScore` generic abstractions (Invariant 1). The identical flow serves Bloomy (websites) and Devcomm (sales consulting).
* All operational tooling remains reachable under `/app/advanced`.

### 3.7 Additive backend/infra changes

| Change | Why | Risk |
|---|---|---|
| `firestore.rules`: add `match /conversations/{id}` with `allow read: if signedIn(); allow write: if false;` (+ `messages` subcollection) | Fixes P10 so the Inbox can read real data. Writes stay server-only — **stricter** than the existing `outreach` rule. | None; no secret exposure. |

---

## 4. SUCCESS CRITERIA

* A non-technical owner never sees SIRENE, NAF, Dropcontact, Instantly, PageSpeed, queues or provider APIs on a primary surface.
* 2 interactions between describing the target and a live campaign.
* Primary metric everywhere is **meetings booked**.
* Every number rendered traces to Firestore/backend state — no placeholder dashboards.

---

## 5. ADVERSARIAL REVIEW & FIXES

A fresh reviewer audited the phase and returned **FAIL** on two blockers. Both were real. All blockers and majors are now fixed, each with a regression test in `src/tests/ux-simplification.test.ts`.

### Blockers

| ID | Finding | Fix |
|---|---|---|
| **B1** | The SDR activity feed was neither scoped nor ordered. Three defects stacked: (a) the `logs(workspaceId, createdAt)` composite index was never declared, so the primary query threw `FAILED_PRECONDITION`; (b) `writeLog` never wrote a top-level `workspaceId`, so even with the index the query returned nothing; (c) therefore the `.catch` fallback — an **unscoped, unordered 200-doc read of `logs`** — was the path that actually ran, pulling other workspaces' events into the client. | `writeLog` now stamps top-level `workspaceId`/`businessId`, hoisting them from `metadata` so existing call sites are covered. Client `createLog` stamps `workspaceId`. Three composite indexes declared. The unscoped fallback is gone: the fallback orders by `createdAt` (single-field) and every log passes `belongsToScope()`, which admits a log only if its `metadata.companyId` belongs to the scope, or it is workspace-stamped and business-matched. |
| **B2** | `TestModeBanner` rendered **unconditionally** on every primary surface with French developer jargon ("Mode Test SDR", "Confinement de sécurité actif", "Gérer Allowlist", "Démo SDR 1-Clic"), directly failing the non-technical-owner test. Worse, with `testModeEnabled: false` it still claimed the send-safety lock was active, and offered a two-click path to disabling it from any screen. | Rewritten: early-returns `null` unless safe mode is on, English, no disable toggle and no allowlist editor — a status line linking to Settings, which already hosts the full allowlist card and demo modal. The shell renders it only once settings have loaded, removing the false-claim flash. |

### Majors

| ID | Finding | Fix |
|---|---|---|
| **M1** | **The funnel was non-monotonic.** `CompanyStatus` advances, so a company past qualification no longer has `status === "qualified"`; without a score it dropped out of `qualified` while still counting in `contacted`. The campaign page could show more companies contacted than were ever qualified. | `computeFunnel` rebuilt as cumulative distinct-company sets (meetings → replies → contacted → people → qualified), each seeded from the stage below. Every stage now means "reached *at least* this stage". |
| **M2** | Mixed units: five company counts plus one raw meeting-document count, so two meetings with one company made `meetings > replies`. | `meetings` is now distinct companies; cancelled and out-of-scope meetings excluded. |
| **M3** | `listCampaigns` took the globally most-recent 100 campaigns and filtered *afterwards*, so another workspace could push a campaign out of the window — and `getCampaign` was built on it, meaning a campaign outside the window rendered "This campaign no longer exists" on its own page. | Workspace filter moved into the query; `getCampaign` reads the document by id via `getDoc`. |
| **M4** | Sidebar (15s) and mobile nav (30s) both polled an **unbounded** `conversations` scan, and both are mounted simultaneously (hidden by CSS, not unmounted). `getHomeSummary` re-read companies 3× per load. | `getUnreadHumanAttentionCount` is bounded (`limit(50)` on an indexed predicate, capped fallback). New `useAttentionCount` gives both navs one shared 30s poll. `getHomeSummary` consolidated to a single pass; Home dropped its duplicate campaign fetch. |
| **M5** | `launchCampaign` returned `{started:false, startError}` on a failed first run and the caller **discarded it**, dropping the user on a campaign that would sit at zero with no explanation. | Home checks `result.started` and surfaces the error instead of navigating. |
| **M6** | **Regression:** past/completed meetings became unreachable — `listAllMeetings` lost its only caller and no Advanced entry covered meetings. | Added `getPastMeetings()` and a "Show past meetings" section. |

### Minors fixed
`m1` campaign activity no longer bleeds company-less workspace events across campaign pages · `m3` suppressed conversations can never appear as needing attention (shared `requiresHumanAttention`) · `m5` provider jargon removed from the launch flow · `m6` empty `businessId` guarded · `m7` orphaned `dashboard-shell.tsx` and `updateConversationDoc` removed (the latter a trap now that conversations are write-blocked); the shell re-reads settings on navigation so the topbar status is not stale.

### Confirmed clean by review
Invariant 1 holds — no business/offer/industry branching in any new file. Campaign scoping in `loadScopeData` is correct. The `conversations` rules change is safe (no secrets in those docs; `write: if false` broke nothing). The launch path is **2 interactions**. The `useEffect`/polling patterns have no re-render loop or stale closure.

### Knowingly not addressed
* `logs` and `conversations` rules have no workspace predicate — pre-existing model shared with `companies`/`contacts`/`meetings`, and no longer load-bearing for the activity feed.
* `matchesBusiness` still treats a missing `businessId` as matching any business (legacy-data fallback).
* Inbox free-text search was dropped in the simplification.
* Targeting defaults are France-locked, consistent with the SIRENE/NAF backend.

### Second review pass — verdict **PASS**

The reviewer re-audited the deltas and confirmed both blockers closed at their roots (not suppressed), the funnel monotonic *by construction* under all inputs, no capability orphaned by the banner rewrite, and no lifecycle bug in the shared poll. It raised five non-blocking items, four of which were then fixed rather than deferred:

| ID | Finding | Resolution |
|---|---|---|
| **n1** | `belongsToScope` closed cross-*workspace* reads but not cross-*business* ones: `ownedCompanyIds` was built from a workspace-only query, so viewing one business could render activity about another's companies. | Fixed — the company set is filtered through `matchesBusiness` before the id set is built. |
| **n2** | Forcing monotonicity made `qualified` absorb `peopleFound`, so a `DISQUALIFIED` company with an extracted email counted as a "good opportunity". | Fixed — explicitly disqualified companies are excluded from both stages, unless they were actually contacted (in which case earlier stages must still account for them). Monotonicity preserved. |
| **n3** | The m1 fix made `discovery.functions.run` ("Searched for new companies") unreachable — the one signal a brand-new campaign has. | Fixed — `HumanActivityEvent` now carries `campaignId` (already present in the log's metadata), so campaign-level events are attributed to their own campaign instead of being dropped. |
| **n6** | The attention badge saturates at `ATTENTION_COUNT_CAP`. | Fixed — renders `50+`. |
| **n7** | Both navigations issued an eager fetch on mount and on business switch. | Fixed — an in-flight promise is shared across subscribers. |
| **n4** | `getCampaign` accepts a campaign with no `workspaceId` while `listCampaigns` cannot surface one, so a legacy campaign is openable by URL but invisible in the list. | **Left as-is.** Both alternatives are worse: rejecting it hides data entirely, and Firestore cannot query for an absent field. All writes now stamp `workspaceId`, so this only affects pre-existing documents. |
| **n5** | `writeLog` defaults an unstamped log to `ws_default`. | **Left as-is** — correct for this single-workspace deployment; would need revisiting for genuine multi-workspace operation. |
| **n8** | Settings still carries French test-mode copy. | **Left as-is** — pre-existing (audit item P7), outside this phase, but now more visible since the banner routes users there. |

---

## 6. LIVE-RUN FINDINGS — the pipeline never actually scored on evidence

Launching the first real campaign (French hairdressing salons, Nantes) surfaced a chain of
defects that made the SDR structurally incapable of qualifying anyone. Discovery worked;
everything after it was silently dead. All are fixed, with regression tests.

| # | Defect | Effect | Fix |
|---|---|---|---|
| 1 | **Evidence key mismatch.** The scorer read 8 keys no provider emits (`has_ssl` vs `ssl_active`, `pagespeed_mobile_score` vs `mobile_pagespeed_score`, `outdated_copyright` vs `is_copyright_outdated`, `has_ecommerce`, `has_viewport`, `copyright_year`, `pagespeed_lcp`, `google_places_review_count`). | **The entire need-detection path evaluated to `undefined`.** Every company scored `needStrength: 10` and was disqualified regardless of how bad its website was. Unit fixtures used the scorer's imagined names, so 247 tests passed while production was inert. | `readEvidence(...aliases)` reads provider names first, legacy names as fallback. Pinned by `functions/src/tests/signals/evidence-key-contract.test.ts`, which fails if any scorer signal matches no provider key. |
| 2 | **Signals were never collected.** `researchCompany` called `getValidEvidence()` but nothing in the automated path ever ran the providers — `collectCompanySignals` was reachable only from a manual UI button. | Scoring ran against an empty evidence set: *"aucun signal externe collecté"*, 0 evidence items. | `researchCompany` now runs the campaign's configured providers before scoring, and a forced re-research forces a signal refresh instead of re-scoring cached evidence. |
| 3 | **Offers were read from a non-existent collection.** 5 call sites read top-level `offers/{id}`; offers live at `workspaces/{ws}/businesses/{biz}/offers/{id}`. | Offer scoring weights, personas and guardrails were silently ignored everywhere. | All call sites corrected to the workspace-scoped path. |
| 4 | **Research runner could never see new companies.** It ordered by `lastActivityAt` — a field discovery never set, and Firestore *excludes documents missing the ordering field*. The required composite index was also undeclared, so the query threw `FAILED_PRECONDITION` on every run. | 66 companies stuck in `research_pending` indefinitely. The campaign would not have progressed the next morning either. | Query no longer orders on an optional field (sorted in memory); discovery now stamps `lastActivityAt`. |
| 5 | **Phantom signal providers.** `SignalProviderId` allows 9 ids but only 5 exist. Campaigns requested `website_presence` (no implementation) and never requested `pagespeed`. Unknown ids were dropped in silence. | The website-speed audit — the core of a "your site is slow" offer — never ran. | `website_presence` aliases to `website_technical`; unknown ids now log a warning naming the known providers. |
| 6 | **Third-party listings counted as owning a website.** A salon whose only presence is a Planity/Treatwell page scored as "has a modern mobile-friendly site with booking". | The *ideal* prospect was rejected as having no need. | New `third_party_presence_only` signal; the scorer treats it as a strong need ("Pas de site propre"). |
| 7 | **ICP translator guessed industry codes.** The prompt passed the offer's name, description and personas but not its configured `targetNafCodes`. | Generated NAF `82.11Z` (office admin) for a hairdressing campaign. | Configured NAF codes, keywords, exclusions and size range are now passed as authoritative. |
| 8 | **PageSpeed silently 429s without a key.** | No speed evidence, and the failure was invisible. | Exponential backoff on 429, an actionable error naming the missing key, and signal errors are now logged with reasons rather than a bare count. |

**Result on the live campaign** — scores went from a flat 25/DISQUALIFIED to a real spread:

```
 64  QUALIFIED      KAOLYA — no site of their own, only a Planity listing
 53  DISQUALIFIED   LE PETIT HÔTEL — no online booking
 48  DISQUALIFIED   Maison Versailles / Cyril Bazin — no ecommerce
 37–39 DISQUALIFIED  the rest — modern sites, genuinely not a fit
```

1 of 7 qualified is a plausible rate for prominent Nantes salons, and the qualified one is
exactly the right prospect.

**Still open:** PageSpeed needs a Google API key (free) before slow-site detection works —
the strongest angle for this offer. `SignalProviderId` still advertises three ids with no
implementation (`company_scale`, `company_hiring`, `technology_stack`); they alias to
nothing and are now warned about rather than silently ignored.

---

## 7. SECOND LIVE RUN — the SDR was pitching the wrong business

The Paris hairdresser campaign produced 13 companies, 8 qualified, and then stopped dead.
Every draft it did write *rejected the prospect* on behalf of a different business. Root causes,
all fixed:

| # | Defect | Effect | Fix |
|---|---|---|---|
| 1 | **Workspace-global prompt overrides.** `settings/global` held `researchSystemPrompt`, `outreachSystemPrompt`, `researchUserPrompt`, `outreachUserPrompt` and `companyContext`, all written for one business ("Tu es un copywriter B2B pour Devcomm"). They override the generic built-ins and apply to **every** business. | Bloomy Studio researched and wrote as if it sold sales training, so it correctly concluded that hair salons have no sales force — and rejected all of them. The clearest possible Invariant 1 violation, living in data rather than code. | Overrides archived to `settings/legacyPromptOverrides` and cleared (`functions/scripts/clear-legacy-prompt-overrides.mjs`). New `business-context.ts` builds "our company" from the business + offer + knowledge base, used by both research and outreach; the global string is only a fallback for records with no business. |
| 2 | **Business names inside generic prompt scaffolding.** The JSON schemas asked for `bestDevcommOffer` and `whyDevcomm`. | Even with correct context, the field name told the model who it worked for. It replied "Aucune offre Devcomm pertinente". | Renamed to `bestOffer` / `whyUs`; legacy names still accepted when reading so stored drafts validate. |
| 3 | **AI opinion overrode the evidence score.** Company status came from the model's `recommendedNextAction`, which is written from page text *before* signals are collected. | 8 companies scored QUALIFIED (55–79) on hard evidence were stored as `rejected`, which then tripped the contact-discovery cost gate. Nothing downstream ran. | `statusFromQualification()` derives status from the deterministic `OpportunityScore`; the model's suggestion is kept as a tag. |
| 4 | **Knowledge base unreachable.** Backend reads `knowledgeBase/default`; the seed wrote `knowledgeBase/kb_default`. | Every prompt ran without services, case studies or pricing rules. | Seed corrected and the stale document removed. |
| 5 | **Pipeline stopped after research.** `TASK_PIPELINE_COMPANY` only researched; website enrichment, contact discovery and drafting were reachable only from the daily 08:00 job. | Qualified companies sat with no contact and no draft. | The task now chains enrich → find contacts → enqueue draft. |
| 6 | **Emails harvested from booking platforms.** A salon whose only presence is Planity/Booksy/Fresha had that page scraped, yielding the platform's own addresses. | Drafts addressed to `help.fr@booksy.com` and `jobs@fresha.com` — cold-pitching a booking platform's support desk. | New `third-party-domains.ts`, shared by the signal provider, email extraction and recipient selection. |
| 7 | **HTML escapes leaked into addresses.** `>` glued to a scraped address produced `u003edessange.rdv@gmail.com`. | An invalid recipient that looked valid. | Entities decoded and escape residue rejected before an address is stored. |
| 8 | **One malformed URL failed an entire research run.** `sourceUrls` used `z.string().url()`. | A single bad URL from a discovery provider aborted the company. | Invalid entries are filtered instead of rejecting the payload. |

**Result** — the same salons now produce grounded French drafts in Bloomy's voice:

> *"Votre site : 82/100 en mobile, mais l'expérience peut s'améliorer"* — cites PageSpeed 82, LCP 3,6s, 4,9★/536 avis
> *"Votre site mérite mieux que ça, DESSANGE"* — cites 4,8★ and the knowledge base's Rennes case study; claim validation **VALID**

### New surface: Approvals
`/app/approvals` lists drafts awaiting a human, shown **only** while autonomy is `Draft only`
(`approvalsEnabled()`), because in assisted/autonomous mode it would always be empty. Each card
shows the company, the recipient, the opportunity score and the evidence reasons, with the email
inline and editable. Approve is deliberately separate from send.

### Known limitation (not a defect)
Small French salons often have **no reachable email**: 4 of 7 qualified prospects exist only on a
booking platform. Dropcontact returned `only_organization_data` for every one — B2B enrichment
databases have no record of a two-chair salon. Website scraping found addresses for the 3 with
their own domain. For this segment the phone number from Google Places is frequently the only
real channel.
