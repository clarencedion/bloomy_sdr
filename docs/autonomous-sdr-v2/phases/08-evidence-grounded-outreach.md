# Phase 08 — Evidence-Grounded Outreach & PDF Proposals

## Objective
Implement evidence-grounded cold outreach generation, two-pass factual claim validation (`validateOutreachClaims`), multi-touch sequencing (Initial + 2 Follow-ups + LinkedIn notes), strict French copywriting guardrails, soft opt-out enforcement, and dynamic proposal PDF generation using PDFKit.

## Why this phase exists
To eliminate AI hallucination from cold email copy by ensuring every specific factual claim is verifiable against an `EvidenceItem`, producing natural, respectful, and high-converting French outreach.

## Requirements covered
* **REQ-049**: Evidence-Grounded Copywriting
* **REQ-050**: Factual Claim Validator Pass
* **REQ-051**: Multi-Touch Sequence Generation
* **REQ-052**: French Copywriting Guardrails
* **REQ-053**: Soft Opt-Out Sentence
* **REQ-054**: Dynamic PDF Proposal Generator
* **REQ-055**: Outreach Draft Review Workspace
* **REQ-056**: Risk Warning Indicators

## Existing code to inspect
* `functions/src/services/outreach-generation.ts`
* `functions/src/services/outreach-prompts.ts`
* `functions/src/services/outreach-schema.ts`
* `functions/src/services/pdf-generator.ts`
* `src/features/outreach/outreach-page.tsx`
* `src/features/outreach/outreach-editor.tsx`

## Existing code to preserve
* High quality French copywriting rules (80-140 words, non-spammy, diagnostic CTA).
* PDFKit document layout and Firebase Storage upload logic.

## Architecture
* **Pass 1 (Copy Generation):** The LLM receives Company metadata, Primary Contact, Offer value proposition, and an explicit array of verified `personalizationFacts[]` extracted from `EvidenceItem[]`.
* **Pass 2 (Claim Validation):** `ClaimValidator` scans the generated subject and body for specific factual claims (numbers, client names, technical assertions). If any claim does not trace to a high-confidence evidence item (`confidence >= 70`), the draft is rejected or rewritten.
* **PDF Rendering:** `PdfGenerator` renders a 2-page branded diagnostic audit report attaching offer logo, primary colors, PageSpeed gauges, and the verified evidence findings.

## Data/schema changes
* Extend `outreach` collection with `personalizationFacts[]`, `claimValidationStatus`, and `pdfStorageUrl`.

## Backend changes
* Implement `functions/src/services/claim-validator.ts`.
* Update `functions/src/services/outreach-generation.ts` to execute two-pass validation.
* Update `functions/src/services/pdf-generator.ts` to parameterize branding and findings by Offer.

## Frontend changes
* Display verified personalization fact pills and claim validation status badges in `src/features/outreach/outreach-editor.tsx`.
* Add one-click PDF proposal preview button.

## External APIs
* OpenAI / Anthropic API (with structured Zod outputs).
* Firebase Cloud Storage.

## Security considerations
* Enclose prospect data in strict XML boundary tags (`<untrusted_prospect_content>`) to prevent prompt injection from manipulating copy instructions.

## Migration/backfill
* Legacy outreach drafts retain existing text; new generations use the two-pass pipeline.

## Tests to write FIRST or alongside implementation
* `tests/outreach/grounded-copy.test.ts`: Test that generated email cites verified evidence facts (e.g. mobile score 28/100, 140 Google reviews).
* `tests/outreach/claim-validator.test.ts`: Test that if an LLM hallucinates an unsupported fact (e.g. "I noticed your 50 employees in Marseille" when no evidence exists), `validateOutreachClaims` flags the draft as `UNSUPPORTED_CLAIMS_DETECTED`.
* `tests/outreach/copy-guardrails.test.ts`: Test that email length is between 80 and 140 words, and includes a soft opt-out sentence.
* `tests/outreach/pdf-generator.test.ts`: Test that PDF generation produces a valid PDF buffer and uploads to storage.

## E2E scenarios
* Generate outreach for a qualified lead; verify that email copy cites exact PageSpeed and Google review evidence, passes claim validation, and renders a matching proposal PDF.

## Definition of done
* [ ] Two-pass outreach generation and claim validation operational.
* [ ] Multi-touch sequence (Initial, Follow-up 1, Follow-up 2, LinkedIn note) generated cleanly.
* [ ] Dynamic PDF proposal generator parameterized by Offer.
* [ ] Draft review workspace updated with evidence pills and PDF preview.
* [ ] Tests pass; Reviewer verdict PASS.
* [ ] `ACCEPTANCE_MATRIX.md` updated for REQ-049 through REQ-056.

## Reviewer checklist
* [ ] Are unsupported factual claims blocked by the validator?
* [ ] Is the soft opt-out sentence present in all generated templates?
* [ ] Does the PDF render cleanly with active business branding?

## Explicitly out of scope
* Email sequence sending via Instantly (deferred to Phase 09).
