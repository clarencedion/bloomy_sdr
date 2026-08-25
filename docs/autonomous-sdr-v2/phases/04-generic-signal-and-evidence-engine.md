# Phase 04 — Generic Signal & Evidence Engine

## Objective
Build the core pluggable **Signal Provider Architecture**, signal registry, and immutable `EvidenceItem` store with strict provenance tracking (`fact` vs `derived_metric` vs `ai_interpretation`), caching, failure resilience, and API cost tracking.

## Why this phase exists
To provide the generic data foundation required for evidence-based prospect evaluation before implementing specific technical audits (such as PageSpeed or CMS detection).

## Requirements covered
* **REQ-019**: Generic Signal Provider Interface
* **REQ-020**: Pluggable Signal Registry
* **REQ-021**: Evidence Provenance Storage
* **REQ-022**: Fact vs. Inference Barrier
* **REQ-023**: Signal Caching & Freshness
* **REQ-024**: Signal Cost Tracking
* **REQ-025**: Failure Resilient Signal Pipeline
* **REQ-026**: Universal Registry Provider
* **REQ-027**: Google Places Signal Provider
* **REQ-028**: Evidence Inspector UI

## Existing code to inspect
* `functions/src/providers/discovery/recherche-entreprises-provider.ts`
* `functions/src/providers/discovery/google-places-discovery-provider.ts`
* `functions/src/services/lead-readiness.ts`
* `src/features/companies/company-detail.tsx`

## Existing code to preserve
* Existing API clients for Recherche d'Entreprises and Serper Google Places.

## Architecture
* Define `SignalProvider` interface (`supports`, `collect`, `costEstimate`).
* Create `SignalRegistry` singleton to register and look up signal providers dynamically.
* Implement `EvidenceService` to write immutable `EvidenceItem` records into `companies/{companyId}/evidence/{evidenceId}`.
* Implement `SignalCache` to cache domain-level signals with a 30-day expiration window.
* Implement failure-isolated `SignalCoordinator` that executes requested signal modules in parallel with per-provider `try/catch` and timeout bounds.

## Data/schema changes
* Create subcollection `companies/{companyId}/evidence/{evidenceId}`.

## Backend changes
* Implement `functions/src/providers/signals/signal-provider.ts`.
* Implement `functions/src/providers/signals/signal-registry.ts`.
* Implement `functions/src/providers/signals/registry-signal-provider.ts` (wraps Recherche d'Entreprises).
* Implement `functions/src/providers/signals/places-signal-provider.ts` (wraps Serper Places).
* Implement `functions/src/services/signal-coordinator.ts`.
* Implement `functions/src/services/evidence-service.ts`.

## Frontend changes
* Implement `src/features/companies/company-evidence-tab.tsx` in Company Detail view to inspect collected evidence items, source URLs, confidence scores, and collection timestamps.

## External APIs
* API Recherche d'Entreprises & Serper Google Places.

## Security considerations
* Ensure scraped or third-party values in evidence items are stored as raw data and sanitized before rendering in the UI.

## Migration/backfill
* Existing `leadResearch` documents can be queried in fallback mode; new discovery runs populate the `evidence` subcollection.

## Tests to write FIRST or alongside implementation
* `tests/signals/signal-registry.test.ts`: Test dynamic provider registration, lookup, and capability querying.
* `tests/signals/evidence-provenance.test.ts`: Test that evidence items are created with valid `nature` tags (`fact`, `derived_metric`, `ai_interpretation`).
* `tests/signals/signal-cache.test.ts`: Test that calling signal collection twice for the same domain returns cached evidence on the second call without invoking external APIs.
* `tests/signals/signal-resilience.test.ts`: Test that if one signal provider throws a 500 error or times out, the coordinator captures other signals and records the failure cleanly.

## E2E scenarios
* Run discovery for a company; verify that `companies/{companyId}/evidence` contains structured evidence items for legal registry data and Google Places reviews.

## Definition of done
* [ ] `SignalProvider` interface and registry implemented.
* [ ] Universal registry and Google Places signal providers operational.
* [ ] Evidence persistence and caching functional.
* [ ] Evidence Inspector tab operational in UI.
* [ ] Tests pass; Reviewer verdict PASS.
* [ ] `ACCEPTANCE_MATRIX.md` updated for REQ-019 through REQ-028.

## Reviewer checklist
* [ ] Are evidence items tagged with explicit `nature` discriminators?
* [ ] Does a single provider failure bring down the entire signal run?
* [ ] Are API token/credit costs logged?

## Explicitly out of scope
* Website PageSpeed and CMS auditing (deferred to Phase 05).
