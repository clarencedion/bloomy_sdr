# Active Engineering Progress

This file tracks the active implementation state of Autonomous SDR V2. It is updated after every completed phase.

---

## 📍 Current Phase
* **Active Phase:** **Phase 05 — Website Opportunity Module**
* **Status:** `READY_TO_START`
* **Last Completed Phase:** **Phase 04 — Generic Signal & Evidence Engine** (Verified ✅)
* **Current Branch:** `feat/autonomous-sdr-v2`

---

## 📊 Summary of What Changed in Phase 04
1. **Generic Signal Provider Interface (`REQ-019`):**
   - Standardized `SignalProvider` TypeScript interface (`supports`, `collect`, `costEstimateUsd`) in `functions/src/providers/signals/signal-provider.ts` and `src/types/domain.ts`.
   - Defines standard `SignalContext` (`workspaceId`, `businessId`, `company`) and `SignalResult` without business-specific branching (enforcing Invariant 1).
2. **Pluggable Central Signal Registry (`REQ-020`):**
   - Implemented `SignalRegistry` class in `functions/src/providers/signals/signal-registry.ts` supporting dynamic provider registration, lookup, capability querying, and context-based provider filtering.
3. **Evidence Provenance & Fact vs. Inference Barrier (`REQ-021`, `REQ-022`):**
   - Defined immutable `EvidenceItem` schema (`key`, `value`, `sourceType`, `sourceUrl`, `confidence`, `nature`, `collectedAt`, `expiresAt`, `costUsd`).
   - Implemented `EvidenceService` in `functions/src/services/evidence-service.ts` writing immutable items into subcollection `companies/{companyId}/evidence/{evidenceId}`.
   - Enforced strict validation of `nature` discriminator (`"fact"` vs `"derived_metric"` vs `"ai_interpretation"`), rejecting unverified or ambiguous items (enforcing Invariant 5).
4. **Signal Caching & Freshness (`REQ-023`):**
   - Implemented `SignalCache` in `functions/src/services/signal-cache.ts` managing 30-day signal expiration windows.
   - Second queries for the same company/domain reuse valid cached evidence with 0 USD API cost; `forceRefresh` bypasses cache on demand.
5. **Signal Cost Tracking & Failure-Resilient Pipeline (`REQ-024`, `REQ-025`):**
   - Implemented `SignalCoordinator` in `functions/src/services/signal-coordinator.ts` executing requested providers in parallel with per-provider `try/catch` and timeout bounds (10s).
   - A single provider failure (e.g. 500 or timeout) does not crash overall execution; surviving evidence is persisted and errors are logged gracefully.
   - Per-provider and total execution costs are tracked in USD and logged to activity logs.
6. **Built-in Universal Registry & Google Places Providers (`REQ-026`, `REQ-027`):**
   - `RegistrySignalProvider` (`functions/src/providers/signals/registry-signal-provider.ts`): extracts official legal name, SIREN, SIRET, NAF, employee bracket, derived employee count, headquarters address, and establishment count.
   - `PlacesSignalProvider` (`functions/src/providers/signals/places-signal-provider.ts`): extracts Google star rating, review count, business category, operational status, phone, CID via Serper Places API.
7. **Evidence Inspector UI (`REQ-028`):**
   - Implemented `src/features/companies/company-evidence-tab.tsx` featuring summary counters, nature pills (Facts, Metrics, Inferences), confidence progress bars, provider filtering, search, and collapsible JSON payload inspector.
   - Integrated "Signals & Evidence" tab into `src/features/companies/company-detail.tsx`.
   - Exposed `collectCompanySignalsCallable` & `listCompanyEvidenceCallable` in `functions/src/index.ts` and client helpers in `src/lib/firebase/functions.ts` & `src/lib/firebase/firestore.ts`.
   - Updated Firestore Security Rules for `companies/{companyId}/evidence/{evidenceId}` subcollection.
8. **Automated Verification Test Suite:**
   - `functions/src/tests/signals/signal-registry.test.ts` (4 tests)
   - `functions/src/tests/signals/evidence-provenance.test.ts` (4 tests)
   - `functions/src/tests/signals/signal-cache.test.ts` (2 tests)
   - `functions/src/tests/signals/signal-resilience.test.ts` (2 tests)
   - `functions/src/tests/signals/registry-signal-provider.test.ts` (1 test)
   - `functions/src/tests/signals/places-signal-provider.test.ts` (1 test)
   - `src/tests/signals.test.ts` (2 tests)
   - Total test suite: 70 root tests passing, 52 functions tests passing (100% pass rate).

---

## 🔍 Verified State
* **Root Next.js Typecheck (`npm run typecheck`):** ✅ **PASS (0 errors)**
* **Backend Functions Typecheck (`npm run --prefix functions typecheck`):** ✅ **PASS (0 errors)**
* **Root Production Build (`npm run build`):** ✅ **PASS (19 static/dynamic routes compiled successfully)**
* **Backend Functions Build (`npm run --prefix functions build`):** ✅ **PASS (tsc compiled successfully to lib/)**
* **ESLint (`npm run lint`):** ✅ **PASS (0 errors, 0 warnings)**
* **Root Test Suite (`npm test`):** ✅ **PASS (22 test files, 70 passed tests in 3.61s)**
* **Functions Test Suite (`npm run --prefix functions test`):** ✅ **PASS (15 test files, 52 passed tests in 3.52s)**

---

## 🚧 Blockers
* **None.** Phase 04 Signal Engine & Evidence Infrastructure is complete, fully verified, and ready for Phase 05.

---

## 🎯 Next Exact Action
Proceed to **Phase 05 (Website Opportunity Module)** according to `docs/autonomous-sdr-v2/phases/05-website-opportunity-module.md` to implement the Anti-Annuaire website resolver, Google PageSpeed REST auditor, CMS/ecommerce detector, and outdated technical signals provider.


