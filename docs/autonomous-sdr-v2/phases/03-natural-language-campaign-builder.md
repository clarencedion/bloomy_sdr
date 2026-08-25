# Phase 03 — Natural-Language Campaign Builder

## Objective
Build a natural-language campaign builder allowing operators to launch campaigns by typing natural language descriptions (e.g. *"Find French florists with weak digital presence to sell e-commerce websites"*). An LLM translates the prompt into structured targeting criteria (NAF codes, keywords, negative filters, geography, scale, and dynamic signal modules).

## Why this phase exists
To remove the friction of manually researching French NAF codes and keywords, transforming the SDR onboarding flow into a conversational, zero-setup experience.

## Requirements covered
* **REQ-011**: Natural Language Campaign Builder
* **REQ-012**: Structured ICP Translation
* **REQ-013**: Dynamic Signal Strategy Selection
* **REQ-014**: Pre-Launch Campaign Review
* **REQ-015**: Manual Advanced Targeting Override
* **REQ-016**: Discovery Provider Prioritization
* **REQ-017**: State-Tracked Pagination Cursors
* **REQ-018**: Campaign Lifecycle Controls

## Existing code to inspect
* `src/features/discovery/discovery-create-form.tsx`
* `src/features/discovery/discovery-page.tsx`
* `functions/src/services/run-discovery-campaign.ts`
* `functions/src/providers/discovery/recherche-entreprises-provider.ts`

## Existing code to preserve
* Existing manual campaign creation form and provider drag-and-drop prioritization.

## Architecture
* Implement `translateIcpPrompt(prompt, offerId)` Callable Cloud Function using structured LLM JSON outputs (Zod validated).
* Ingest the active `OfferDoc` context to ground the translation in the business's actual value proposition.
* Automatically determine the appropriate `ResearchStrategy` (e.g. including `website_technical` for web offers, or `company_hiring` for consulting offers).
* Present a pre-launch review modal in the UI allowing operators to adjust targeting parameters before activation.

## Data/schema changes
* Extend `campaigns` collection schema with `naturalLanguagePrompt`, `offerId`, and `researchStrategy`.

## Backend changes
* Implement `functions/src/services/icp-translator.ts`.
* Implement `functions/src/services/signal-selector.ts`.
* Update `functions/src/services/run-discovery-campaign.ts` to execute based on the translated `researchStrategy`.

## Frontend changes
* Create `src/features/discovery/nl-campaign-modal.tsx` (a conversational modal with an interactive pre-launch review step).
* Add live preview of targeted NAF codes, suggested keywords, and selected signal modules.

## External APIs
* OpenAI / Anthropic API (for structured prompt translation).

## Security considerations
* Validate and sanitize user prompt input; enforce maximum prompt length (1,000 characters).

## Migration/backfill
* Existing campaigns default to manual targeting mode with `researchStrategy.enabledSignalProviders = ["company_registry", "google_places"]`.

## Tests to write FIRST or alongside implementation
* `tests/campaign/icp-translator.test.ts`: Test that prompt *"Florists in Nantes for web design"* generates NAF `47.76Z`, city `Nantes`, keywords `["fleuriste", "artisan fleuriste"]`, and selects `website_technical` signal module.
* `tests/campaign/consulting-translator.test.ts`: Test that prompt *"Sales consulting for French manufacturing SMEs"* generates industrial NAF codes, employee count `>= 20`, and selects `company_scale` / `company_hiring` signal modules without website auditing.
* `tests/campaign/pagination.test.ts`: Verify that sequential discovery runs advance pagination cursors and retrieve new pages without duplicate ingestion.

## E2E scenarios
* User enters *"Boulangeries artisanales à Lyon pour site vitrine et commande en ligne"*; modal generates structured plan; user approves; campaign saves and triggers discovery run yielding relevant bakeries in Lyon.

## Definition of done
* [ ] Natural-language campaign creation modal operational in UI.
* [ ] Structured ICP translation and dynamic signal selection verified with tests.
* [ ] Manual targeting overrides remain functional.
* [ ] Pagination cursors properly tracked on campaign docs.
* [ ] Tests pass; Reviewer verdict PASS.
* [ ] `ACCEPTANCE_MATRIX.md` updated for REQ-011 through REQ-018.

## Reviewer checklist
* [ ] Does the translator choose different signal modules for different offers?
* [ ] Can the operator edit the AI-generated targeting before launch?
* [ ] Are pagination cursors preserved across discovery runs?

## Explicitly out of scope
* Signal execution engine (deferred to Phase 04).
