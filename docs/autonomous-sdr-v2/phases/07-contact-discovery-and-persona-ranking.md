# Phase 07 — Contact Discovery & Persona Ranking

## Objective
Implement an Offer-parameterized **Persona Ranking Engine**, multi-provider contact waterfall (Website Crawler → Dropcontact → Secondary Provider), negative role filtering, and strict email verification gates.

## Why this phase exists
To ensure that cold outreach targets the exact right decision maker per offer (e.g. business owner/founder for local florists vs. Sales/HR Director for corporate enterprises) and strictly filters out unqualified or unverified emails.

## Requirements covered
* **REQ-043**: Offer Persona Priority Ranking
* **REQ-044**: Negative Role Filtering
* **REQ-045**: Dropcontact Enrichment Client
* **REQ-046**: Website Crawler Contact Extraction
* **REQ-047**: Multi-Provider Contact Waterfall
* **REQ-048**: Strict Email Verification Gate

## Existing code to inspect
* `functions/src/services/contact-discovery.ts`
* `functions/src/providers/enrichment/dropcontact-provider.ts`
* `functions/src/services/company-enrichment.ts`
* `src/features/contacts/contacts-page.tsx`

## Existing code to preserve
* Working Dropcontact batch submission & polling logic.
* Negative role filtering list (`IRRELEVANT_ROLE_KEYWORDS`).

## Architecture
* Implement `PersonaRanker` taking available contacts and matching them against `OfferDoc.targetPersonas` (ordered by priority 1, 2, 3).
* Implement `ContactWaterfall` orchestrating:
  1. Website Crawler (extracts generic/team emails from `/contact`, `/equipe`).
  2. Dropcontact API (submits SIREN + domain, polls for named decision makers).
  3. Secondary Provider Adapter (pluggable interface for future Apollo/Prospeo).
* Enforce `ContactVerifier`: Only contacts with `emailVerified === true` (Dropcontact `qualification === "verified"`) are marked `status: "verified"` and eligible for outreach. Contacts with `guessed` or `uncertain` emails require human review.

## Data/schema changes
* Add `personaMatched`, `personaPriority`, `emailQualification` fields to `contacts` collection.

## Backend changes
* Implement `functions/src/services/persona-ranker.ts`.
* Implement `functions/src/services/contact-waterfall.ts`.
* Implement `functions/src/services/contact-verifier.ts`.
* Update `functions/src/services/contact-discovery.ts` to execute persona ranking upon receiving enrichment results.

## Frontend changes
* Display matched persona badge, priority ranking, and verification status pill on contact cards.

## External APIs
* Dropcontact API (`https://api.dropcontact.com/v1/enrich/all`).

## Security considerations
* Validate email format and normalize casing before storing in Firestore.

## Migration/backfill
* Backfill existing contacts with `emailQualification: "verified"` where `emailVerified === true`.

## Tests to write FIRST or alongside implementation
* `tests/contacts/persona-ranking.test.ts`: Test that for a small business Offer, a contact with role "Gérant" is ranked Priority 1 over "Responsable Marketing". For an Enterprise Offer, "Directeur Commercial" is ranked Priority 1 over "Gérant".
* `tests/contacts/role-filter.test.ts`: Test that contacts with roles containing "commissaire aux comptes", "avocat", "expert-comptable", or "stagiaire" are excluded.
* `tests/contacts/email-verification.test.ts`: Test that contacts with `guessed` qualification are not flagged as `leadReadyForOutreach`.

## E2E scenarios
* Run contact enrichment on a qualified lead; verify that Dropcontact returns verified contacts, the owner is selected as primary contact, and the opportunity transitions to `OUTREACH_READY`.

## Definition of done
* [ ] Persona ranking engine operational and offer-driven.
* [ ] Dropcontact enrichment and website crawler integrated in waterfall.
* [ ] Email verification gate enforced.
* [ ] Tests pass; Reviewer verdict PASS.
* [ ] `ACCEPTANCE_MATRIX.md` updated for REQ-043 through REQ-048.

## Reviewer checklist
* [ ] Does the ranker choose different decision makers for different offers?
* [ ] Are unverified/guessed emails blocked from automatic outreach?
* [ ] Are accountants and lawyers filtered out?

## Explicitly out of scope
* Outreach copywriting generation (deferred to Phase 08).
