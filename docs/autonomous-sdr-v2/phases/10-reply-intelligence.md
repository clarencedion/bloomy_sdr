# Phase 10 — Inbound Reply Intelligence & Objection Classifier

## Objective
Build the **Reply Intelligence Subsystem** to parse inbound prospect email text, classify intent (`POSITIVE`, `BOOKING_REQUEST`, `QUESTION`, `OBJECTION`, `UNSUBSCRIBE`, `OUT_OF_OFFICE`, `WRONG_PERSON`, `ANGRY`, `NEUTRAL`, `UNCLEAR`), extract fine-grained objection types (`PRICE`, `EXISTING_PROVIDER`, `NO_BUDGET`, `NOT_PRIORITY`, `BAD_TIMING`), and execute deterministic unsubscribes immediately.

## Why this phase exists
To give the autonomous SDR the ability to understand what the prospect actually wrote, recognize buying signals vs. objections, and immediately honor unsubscribe requests without human delay.

## Requirements covered
* **REQ-063**: Inbound Reply Intent Classifier
* **REQ-064**: Fine-Grained Objection Classifier
* **REQ-065**: Deterministic Unsubscribe Action

## Existing code to inspect
* `functions/src/services/webhook-processor.ts` (from Phase 09)
* `functions/src/providers/ai/index.ts`
* `src/types/firestore.ts`

## Existing code to preserve
* AI provider interface and Zod schema validation utilities.

## Architecture
* Implement `ReplyClassifier` service invoked automatically when a new inbound message is stored.
* **Deterministic Rules (First Pass):**
  * If provider event is `unsubscribed` or text contains `"unsubscribe"`, `"désabonner"`, `"stop"` → Deterministically set `intent = "UNSUBSCRIBE"`.
  * If subject contains `"Automatic reply"`, `"Out of office"`, `"Absence du bureau"` → Deterministically set `intent = "OUT_OF_OFFICE"`.
* **LLM Intent & Objection Classification (Second Pass):**
  * Prompts OpenAI/Anthropic with prospect email text wrapped in `<untrusted_prospect_input>` tags.
  * Outputs structured JSON validated by Zod: `intent`, `objectionType`, `confidence` (0.0–1.0), `detectedQuestions[]`, `suggestedAction`.
* **Deterministic Unsubscribe Action:**
  * If `intent === "UNSUBSCRIBE"`, immediately writes to `suppressionList` collection, updates `contact.doNotContact = true`, and terminates the Instantly sequence.

## Data/schema changes
* Extend `messages` collection with `replyClassification` map (`intent`, `objectionType`, `confidence`, `classifiedAt`).
* Extend `conversations` collection with `latestIntent` and `latestObjection`.

## Backend changes
* Implement `functions/src/services/reply-classifier.ts`.
* Implement `functions/src/services/reply-router.ts`.
* Implement `functions/src/services/unsubscribe-handler.ts`.

## Frontend changes
* Display intent badges (e.g. `Interested`, `Objection: Price`, `Unsubscribe`, `Out of Office`) on conversation cards in the SDR Inbox.

## External APIs
* OpenAI / Anthropic API (with structured Zod JSON outputs).

## Security considerations
* Treat prospect email text as untrusted data; enclose in XML boundary tags to prevent prompt injection attacks.

## Migration/backfill
* None required.

## Tests to write FIRST or alongside implementation
* `tests/replies/deterministic-unsub.test.ts`: Test that receiving an email with "Merci de me retirer de votre liste" triggers immediate suppression write without LLM latency.
* `tests/replies/intent-classification.test.ts`: Test classification of:
  * "Pouvez-vous m'appeler jeudi à 14h ?" → `BOOKING_REQUEST` (confidence >= 0.90)
  * "Combien coûte votre prestation de refonte ?" → `QUESTION` / `PRICE`
  * "Nous travaillons déjà avec une agence web à Nantes" → `OBJECTION` / `EXISTING_PROVIDER`
  * "Je ne suis pas le bon interlocuteur, voyez avec M. Dupont" → `WRONG_PERSON`
* `tests/replies/ooo-classification.test.ts`: Test that auto-responder OOO emails are classified as `OUT_OF_OFFICE` and do not trigger replies.

## E2E scenarios
* Simulate incoming emails for "Interested", "Too expensive", and "Unsubscribe"; verify that the classifier outputs accurate intent records and unsubscribes are suppressed instantly.

## Definition of done
* [ ] Deterministic rules pass for unsubscribes and OOO.
* [ ] LLM intent and objection classifier operational with Zod validation.
* [ ] Unsubscribe handler writes to suppression list automatically.
* [ ] Tests pass; Reviewer verdict PASS.
* [ ] `ACCEPTANCE_MATRIX.md` updated for REQ-063 through REQ-065.

## Reviewer checklist
* [ ] Does an unsubscribe request immediately suppress the contact without requiring LLM approval?
* [ ] Are classification confidences calculated and stored?
* [ ] Is prompt injection prevented during classification?

## Explicitly out of scope
* Autonomous response generation (deferred to Phase 11).
