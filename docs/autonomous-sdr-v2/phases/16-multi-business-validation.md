# Phase 16 — Multi-Business Dual-Fixture Validation

## Objective
Execute two comprehensive end-to-end campaign simulations for completely unrelated businesses without modifying any generic SDR engine code:
1. **Fixture A — Bloomy Digital Studio (Website & E-Commerce Redesigns for French Florists)**
2. **Fixture B — Devcomm B2B Consulting (Sales Team Training & Coaching for French Industrial SMEs)**

## Why this phase exists
To definitively prove that the platform operates as a true multi-business autonomous SDR platform where onboarding a completely new offer requires zero generic code changes.

## Requirements covered
* End-to-end integration validation for REQ-001 through REQ-080 across both business archetypes.

## Existing code to inspect
* `functions/src/services/test-automation.ts`
* `src/features/discovery/discovery-page.tsx`

## Existing code to preserve
* Existing live test harness and UI streaming logs.

## Architecture
* **Fixture A Execution (Bloomy Digital Studio):**
  * Natural language prompt: *"Find independent French florists in Nantes with weak digital presence for e-commerce website redesigns"*.
  * System translation: NAF `47.76Z`, city `Nantes`, selects `website_technical` and `website_ecommerce` signal modules.
  * Verified reasoning: Finds florist with 140 Google reviews, mobile PageSpeed 28/100, no online ordering.
  * Matched persona: Owner / Gérant.
  * Generated outreach: Cites 140 reviews vs. mobile friction, attaches Bloomy PDF proposal.
  * Simulated reply: Prospect asks *"Combien de temps prend une refonte ?"* → Grounded reply answers 3-week timeline from Bloomy KB.
  * Simulated booking: Prospect says *"Jeudi 14h30 me convient"* → Outlook meeting created, sequence terminated.
* **Fixture B Execution (Devcomm Consulting):**
  * Natural language prompt: *"Find French manufacturing SMEs with sales teams for commercial performance coaching"*.
  * System translation: Industrial NAF codes, employee count `>= 20`, selects `company_scale` and `company_hiring` signal modules (OMITS website audit).
  * Verified reasoning: Finds manufacturing company with 45 employees, 3 regional offices, hiring sales reps.
  * Matched persona: Sales Director / HR Director.
  * Generated outreach: Cites sales force growth, attaches Devcomm Skills2Drive proposal.
  * Simulated reply: Prospect asks about Qualiopi certification → Grounded reply confirms Qualiopi approval from Devcomm KB.
  * Simulated booking: Outlook meeting created, sequence terminated.

## Data/schema changes
* Create test fixture documents in `workspaces/ws_test/businesses/biz_bloomy` and `workspaces/ws_test/businesses/biz_devcomm`.

## Backend changes
* Implement `functions/src/tests/fixtures/e2e-fixture-runner.ts`.

## Frontend changes
* Display dual-fixture test runner tab in `/app/discovery` test suite.

## External APIs
* AI Providers & Mock External Adapters.

## Security considerations
* Verify that Fixture A cannot access Fixture B's contacts, evidence, knowledge base, or settings.

## Migration/backfill
* None.

## Tests to write FIRST or alongside implementation
* `tests/e2e/fixture-bloomy.test.ts`: Complete E2E simulation of Fixture A from prompt to booked meeting.
* `tests/e2e/fixture-consulting.test.ts`: Complete E2E simulation of Fixture B from prompt to booked meeting.
* `tests/e2e/zero-code-change-assert.test.ts`: Automated git check proving that running Fixture B required 0 lines of code change in `functions/src/services/` or `src/lib/`.

## E2E scenarios
* Both Fixture A and Fixture B execute successfully, logging full progress to `automationTests/{testId}`.

## Definition of done
* [ ] Fixture A (Bloomy) completes E2E with website audit signals.
* [ ] Fixture B (Consulting) completes E2E with scale/hiring signals (zero website audit).
* [ ] Zero generic code changes required to onboard Fixture B.
* [ ] Tests pass; Reviewer verdict PASS.
* [ ] `ACCEPTANCE_MATRIX.md` updated.

## Reviewer checklist
* [ ] Did Fixture B execute without running website audits?
* [ ] Were different personas targeted for each offer?
* [ ] Did knowledge base grounding stay completely separated between the two businesses?

## Explicitly out of scope
* Final adversarial security audit (deferred to Phase 17).
