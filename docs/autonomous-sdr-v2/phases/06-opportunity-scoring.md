# Phase 06 — Opportunity Scoring & Qualification

## Objective
Implement the generic, multi-factor **Opportunity Scoring Engine** that evaluates collected `EvidenceItem[]` against Offer-driven weights to compute `companyFitScore`, `needStrengthScore`, `commercialValueScore`, and `overallScore`, gating leads into `DISQUALIFIED`, `NEEDS_MORE_EVIDENCE`, `QUALIFIED`, or `HIGH_PRIORITY`.

## Why this phase exists
To replace hardcoded heuristic scoring formulas with a flexible, offer-parameterized scoring framework that prevents spending money on contact enrichment (Dropcontact) for disqualified prospects.

## Requirements covered
* **REQ-037**: Multi-Factor Scoring Engine
* **REQ-038**: Offer-Driven Scoring Weights
* **REQ-039**: Four-Tier Qualification States
* **REQ-040**: Cost-Saving Pre-Enrichment Gate
* **REQ-041**: Automated Need & Angle Synthesis
* **REQ-042**: Opportunity Score Explainability

## Existing code to inspect
* `functions/src/services/discovery-scoring.ts`
* `src/lib/discovery/scoring.ts`
* `functions/src/services/research-company.ts`
* `functions/src/services/research-schema.ts`

## Existing code to preserve
* Scoring proxy rules (NAF matches, multi-establishment bonus) parameterized into offer templates.

## Architecture
* Implement `OpportunityScorer` taking `EvidenceItem[]` and `OfferDoc.scoringRules` to produce an `OpportunityScore` object.
* Distinct scoring dimensions:
  1. `companyFitScore` (0–100): Matches target industry, geographic territory, employee scale.
  2. `needStrengthScore` (0–100): Evidence of acute problem (e.g. low PageSpeed, missing checkout, no sales onboarding).
  3. `commercialValueScore` (0–100): Revenue/scale proxy indicating ability to pay.
  4. `overallScore` (0–100): Weighted composite.
* Implement pre-enrichment gate: Leads with `overallScore < Campaign.minScoreForQualification` are marked `DISQUALIFIED` and skip Dropcontact.
* Implement `AngleGenerator` to synthesize verified evidence items into tailored value angles.

## Data/schema changes
* Create/update `opportunities/{opportunityId}` document schema with multi-factor score breakdown.

## Backend changes
* Implement `functions/src/services/opportunity-scorer.ts`.
* Implement `functions/src/services/angle-generator.ts`.
* Update campaign execution pipeline to execute scoring immediately following signal collection and before contact enrichment.

## Frontend changes
* Implement `src/features/companies/opportunity-score-card.tsx` displaying the multi-factor score breakdown, weighted score bars, and detected need pills.

## External APIs
* None.

## Security considerations
* Ensure scoring formulas are deterministic and cannot be manipulated by unvalidated prompt injection text.

## Migration/backfill
* Legacy `fitScore` fields on `companies` map to `opportunityScore.overallScore`.

## Tests to write FIRST or alongside implementation
* `tests/scoring/multi-factor-scoring.test.ts`: Test that a company with strong Google reviews (140), poor PageSpeed (28), and missing e-commerce receives `needStrengthScore >= 85` and `overallScore >= 80` under the Bloomy offer.
* `tests/scoring/consulting-scoring.test.ts`: Test that a manufacturing company with 45 employees and multiple establishments receives `companyFitScore >= 90` under the Consulting offer.
* `tests/scoring/pre-enrichment-gate.test.ts`: Test that a company scoring below qualification threshold is marked `DISQUALIFIED` and does NOT invoke Dropcontact API.

## E2E scenarios
* Ingest a batch of 10 discovered companies; verify that qualified companies transition to `QUALIFIED` with synthesized angles, while weak companies transition to `DISQUALIFIED` without incurring enrichment costs.

## Definition of done
* [ ] Multi-factor scoring engine implemented and validated.
* [ ] Scoring weights driven by Offer configuration.
* [ ] Pre-enrichment cost-saving gate operational.
* [ ] Score explainability card operational in UI.
* [ ] Tests pass; Reviewer verdict PASS.
* [ ] `ACCEPTANCE_MATRIX.md` updated for REQ-037 through REQ-042.

## Reviewer checklist
* [ ] Does the scoring engine support different weights for different offers?
* [ ] Are disqualified leads prevented from calling Dropcontact?
* [ ] Is the score calculation transparent and explainable in the UI?

## Explicitly out of scope
* Decision maker contact lookup (deferred to Phase 07).
