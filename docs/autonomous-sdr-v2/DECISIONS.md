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
