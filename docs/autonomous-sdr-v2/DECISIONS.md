# Architectural Decision Records (ADRs)

This log records major architectural and technical decisions made for Autonomous SDR V2. Decisions must not be silently reversed without adding a new ADR explaining why.

---

### ADR-001: Multi-Business Abstraction Layer
* **Status:** `ACCEPTED` | **Date:** 2026-08-25 | **Phase:** Phase 02
* **Context:** The legacy codebase had hardcoded assumptions about "Devcomm" (training/road safety). The new requirement is to support Bloomy Digital Studio (website sales) as well as B2B consulting and other offers using the exact same generic SDR engine.
* **Decision:** Introduce a formal hierarchical structure: `Workspace` → `Business` → `Offer` → `Campaign`. Generic SDR services interact only with these generic abstractions.
* **Alternatives Considered:** Separate codebases/forks per business (rejected due to maintenance overhead) vs. Single business with tag switches (rejected as unscalable).
* **Consequences:** All database queries, sender identities, knowledge bases, and calendars must be scoped to `workspaceId` and `businessId`.

---

### ADR-002: Pluggable Signal Providers vs. Hardcoded Web Crawling
* **Status:** `ACCEPTED` | **Date:** 2026-08-25 | **Phase:** Phase 04
* **Context:** Bloomy Digital Studio requires auditing PageSpeed, CMS, and e-commerce signals. B2B corporate consultancies require auditing employee growth, multi-site scale, and hiring signals.
* **Decision:** Implement a pluggable `SignalProvider` registry interface. Campaigns dynamically declare which signal providers to execute. Website technical auditing is implemented as a pluggable signal module, NOT hardcoded into the generic SDR engine.
* **Alternatives Considered:** Monolithic company research worker running all scrapers for all leads (rejected due to wasted API credits and irrelevant data).
* **Consequences:** Adding new data sources (e.g. LinkedIn job scraper, BuiltWith) requires only implementing a new `SignalProvider` class without modifying core SDR orchestration.

---

### ADR-003: Instantly.ai V2 Webhooks vs. Polling Synchronization
* **Status:** `ACCEPTED` | **Date:** 2026-08-25 | **Phase:** Phase 09
* **Context:** The legacy system polled the Instantly API hourly for boolean `replied: true`, which was slow, missed reply email bodies, and caused rate-limit bottlenecks.
* **Decision:** Implement real-time inbound webhook ingestion for Instantly reply events (`POST /api/webhooks/instantly`) with HMAC signature verification and idempotency caching. Retain hourly polling strictly as a fallback reconciliation mechanism.
* **Alternatives Considered:** Direct IMAP/SMTP mailbox integration (rejected due to complex multi-mailbox warmup and deliverability management).
* **Consequences:** Instant reply classification and rapid conversational responses become possible.

---

### ADR-004: Server-Side Secret Management via GCP Secret Manager
* **Status:** `ACCEPTED` | **Date:** 2026-08-25 | **Phase:** Phase 01
* **Context:** Legacy Firestore rules allowed authenticated clients to read plaintext API keys stored in `settings/aiSecrets` and `settings/integrationSecrets`.
* **Decision:** Move all sensitive third-party API keys to Google Cloud Secret Manager (or secure server environment variables) and configure Firestore rules to forbid all client reads (`allow read: if false;`).
* **Alternatives Considered:** Obfuscating keys in Firestore (rejected as insecure).
* **Consequences:** API keys are never exposed in browser network inspection or client SDK snapshots.

---

### ADR-005: Two-Pass Evidence-Grounded Copywriting
* **Status:** `ACCEPTED` | **Date:** 2026-08-25 | **Phase:** Phase 08
* **Context:** LLMs are prone to hallucinating company details (e.g. inventing client names or employee numbers) if website text is sparse.
* **Decision:** Outreach generation operates in two passes:
  1. Copywriter generates draft from verified `EvidenceItem[]`.
  2. `validateOutreachClaims` verifies that every specific factual claim matches an evidence item with `confidence >= 70`. If unverified claims exist, the draft is rewritten or flagged.
* **Alternatives Considered:** Strict string template substitution (rejected as robotic and unnatural).
* **Consequences:** Outreach copy reads naturally while remaining 100% truthful and grounded in real evidence.

---

### ADR-006: Microsoft Graph Direct OAuth2 vs. Third-Party Scheduling Layers
* **Status:** `ACCEPTED` | **Date:** 2026-08-25 | **Phase:** Phase 12
* **Context:** Outlook Calendar is the primary business calendar used by the operator.
* **Decision:** Retain and extend the existing working Microsoft Graph integration for querying free/busy availability and booking meetings, wrapped in a generic `CalendarProvider` abstraction to allow adding Cal.com or Google Calendar in the future.
* **Alternatives Considered:** Forcing all prospects to use Calendly links only (rejected because conversational booking dramatically increases conversion rates).
* **Consequences:** Real-time conversational slot negotiation is supported directly in email threads.

---

### ADR-007: Deterministic Fast-Path for Unsubscribe & OOO with LLM Reply Intelligence
* **Status:** `ACCEPTED` | **Date:** 2026-08-25 | **Phase:** Phase 10
* **Context:** Legal and compliance mandates (GDPR, CAN-SPAM) require instant suppression when prospects ask to unsubscribe. Relying purely on an LLM for unsubscribe detection introduces unnecessary API latency, cost, and occasional prompt misinterpretation.
* **Decision:** Implement a two-pass architecture:
  1. **Deterministic Fast-Path**: High-precision regex pattern matching for French and English unsubscribe requests and Out-of-Office auto-responders. If matched, triggers immediate suppression / suppressionList insertion with 100% confidence and zero LLM delay.
  2. **Structured LLM Intent & Objection Classification**: Untrusted prospect email text is enclosed in `<untrusted_prospect_input>` XML tags with strict anti-injection prompting, validated against a Zod schema returning structured intent, fine-grained objection categories (`PRICE`, `EXISTING_PROVIDER`, `NO_BUDGET`, `NOT_PRIORITY`, `BAD_TIMING`, `NO_TIME`), confidence scores, and question extraction.
* **Alternatives Considered:** Pure LLM classification for all inbound emails (rejected due to latency and risk of prompt injection bypassing unsubscribe handling) vs. purely keyword-based rule engine (rejected as insufficient for nuanced objections and buying signals).
* **Consequences:** Zero-delay compliance for unsubscriptions alongside rich, resilient classification for complex conversational replies.

---

### ADR-008: Multi-Business Dual-Fixture Automated Simulation & Static Invariance Testing
* **Status:** `ACCEPTED` | **Date:** 2026-08-25 | **Phase:** Phase 16
* **Context:** Autonomous SDR V2 was architected to support completely disparate business models (Bloomy Digital Studio selling web development and Devcomm B2B Consulting selling sales coaching) without custom codebase branching. Automated verification is needed to prove that adding or running any new business model requires zero code changes in generic SDR services.
* **Decision:** Implement a programmatic dual-fixture simulation engine (`functions/src/tests/fixtures/e2e-fixture-runner.ts`) along with a static regex scanner test (`functions/src/tests/e2e/zero-code-change-assert.test.ts`) that asserts:
  1. **Signal Divergence**: Website audits are actively selected for Bloomy and completely omitted for Devcomm consulting.
  2. **Persona Divergence**: Matches Owner for Bloomy and Directeur Commercial for Devcomm.
  3. **Strict Cross-Tenant Isolation**: Knowledge bases, pricing guardrails, and offers are isolated by `workspaceId`/`businessId`.
  4. **Static Invariance**: Zero hardcoded business branching (`if (business === "Bloomy")` or `if (businessId === "biz_bloomy")`) exists across all 25+ generic SDR service files.
* **Alternatives Considered:** Manual testing through UI (rejected as non-repeatable and error-prone) vs. maintaining separate test configurations (rejected as failing to verify cross-tenant genericity).
* **Consequences:** Continuous CI/CD guarantee of true multi-business genericity and zero-regression tenant isolation.

---

### ADR-009: Progressive Disclosure UX — Four Primary Surfaces with a Preserved Advanced Section
* **Status:** `ACCEPTED` | **Date:** 2026-08-26 | **Phase:** Phase 18
* **Context:** The backend is deliberately powerful (100+ services, 10 providers, queues, scoring, state machines), and the frontend had been mirroring that complexity: 13 navigation entries organised as the internal pipeline (`STEP 1 — FIND` → `STEP 2 — RESEARCH` → `STEP 3 — ENGAGE`), a metrics dashboard as the landing page, and nine manual verbs (Create, Run, Research, Find contact, Generate, Approve, Send, Sync, Run queue) between a user's intent and a sent email. The product read as an internal admin/CRM tool rather than an autonomous SDR a small-business owner could hire.
* **Decision:** Restructure the experience into four progressive-disclosure levels without rewriting backend services:
  1. **Level 1 — Home / Campaigns / Inbox / Meetings.** One natural-language field is the primary interaction; the AI-derived targeting is confirmed in plain language ("WHO / WHERE / I'LL PRIORITIZE / I'LL CONTACT / OBJECTIVE") rather than as ~30 configuration fields.
  2. **Level 2 — campaign and prospect detail**, organised around *why we are contacting them* (derived from `OpportunityScore` evidence) rather than raw database fields.
  3. **Level 3 — Settings**, grouped into My business / SDR / Advanced, with a new plain-language autonomy control writing `business.automationPolicy.mode`.
  4. **Level 4 — `/app/advanced`**, where all pre-existing operational tooling (Companies, Contacts, Research, Emails, Campaign builder, Imports, Analytics, System logs, plus the automation toggle and manual research run) is **moved, not deleted**.
  A translation layer (`src/lib/sdr/activity-humanizer.ts`, `opportunity-language.ts`, `inbox-filters.ts`) is the single boundary where technical event types, qualification states and conversation statuses become user language; an aggregation layer (`src/lib/sdr/aggregations.ts`) keeps business logic out of React components.
* **Alternatives Considered:**
  * *Deleting the operational pages* — rejected: they remain necessary for debugging and power-user operations (Golden Rule: preserve working code).
  * *Simplifying the backend to match the simplified UI* — rejected: the intelligence is the product's value; only its presentation was the problem.
  * *Rendering `log.message` directly in the activity feed* — rejected: backend messages are technical by design (`"Outreach sent to Instantly.ai. Campaign: ..."`). The humanizer reads only `type` + `metadata`, so provider names can never leak into a primary surface.
* **Consequences:** A non-technical owner reaches a live campaign in two meaningful interactions (describe → confirm & start) and never encounters SIRENE, NAF, Dropcontact, Instantly, PageSpeed, queues or provider APIs on a primary surface. Campaigns are created `active` with `autoQueueHighScoreCompanies: true` and run immediately, so the existing scheduled jobs carry the pipeline forward under the business autonomy policy. Power-user capability is fully retained one click away under Advanced.

---

### ADR-010: Client Read Access to `conversations` with Server-Only Writes
* **Status:** `ACCEPTED` | **Date:** 2026-08-26 | **Phase:** Phase 18
* **Context:** `firestore.rules` declared no `match /conversations/{id}` block, so the catch-all `match /{document=**} { allow read, write: if false; }` denied all client access. The SDR Inbox reads conversations client-side (`listInboxConversations`, `getUnreadHumanAttentionCount`), meaning the Inbox and its attention badge could not function against real security rules — the simplified Inbox depends on that same data.
* **Decision:** Add an explicit rule granting `allow read: if signedIn();` on `conversations` and its `messages` subcollection, with `allow write: if false;`. All conversation mutations already flow through authenticated server-side callables (`takeOverConversationCallable`, `updateConversationStatusCallable`, `sendManualReplyCallable`, `approveAndSendReplyCallable`).
* **Alternatives Considered:** Routing every Inbox read through a new callable (rejected: a larger backend change for this UX phase, and inconsistent with `companies`/`contacts`/`outreach`, which already grant signed-in read); granting `allow write: if signedIn()` for symmetry with `outreach` (rejected: conversation state must not be forgeable from the client).
* **Consequences:** The Inbox reads real data under production rules. Conversation state is strictly server-authored — a tighter posture than the existing `outreach` rule. No secret material is exposed: API keys and webhook secrets live in `settings/aiSecrets` and `settings/integrationSecrets`, which remain `allow read, write: if false;`.
