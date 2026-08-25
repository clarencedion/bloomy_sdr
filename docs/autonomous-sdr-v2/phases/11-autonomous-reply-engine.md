# Phase 11 — Autonomous Reply Engine & Knowledge Grounding

## Objective
Build the **Autonomous Reply Engine** to draft high-converting, professional French responses to prospect questions and objections, grounded strictly in the Business `KnowledgeBase` and Offer proof points, while enforcing zero-hallucination pricing guardrails, autonomous safe sending under `AUTONOMOUS_SAFE` mode, and instant human escalation for risky inquiries.

## Why this phase exists
To allow the SDR to handle multi-turn email dialogues autonomously, resolving common prospect doubts and answering safe questions without human intervention, while escalating edge cases to human reps.

## Requirements covered
* **REQ-066**: KnowledgeBase Grounded Response Engine
* **REQ-067**: Zero-Hallucination Pricing Guardrail
* **REQ-068**: Autonomous Safe Auto-Reply
* **REQ-069**: Human Escalation Routing

## Existing code to inspect
* `functions/src/services/reply-classifier.ts` (from Phase 10)
* `functions/src/services/business-service.ts` (from Phase 02)
* `functions/src/providers/ai/index.ts`

## Existing code to preserve
* AI provider cascade and prompt template utilities.

## Architecture
* **Grounded Reply Generator:** Prompts LLM with Conversation History + Offer Value Propositions + Verified Evidence + Relevant `KnowledgeBase` FAQs/Case Studies.
* **Pricing Guardrails:** The system prompt forbids inventing custom quotes or discounts unless explicitly present in `OfferDoc.pricingGuardrails`. If a prospect requests unlisted pricing, the AI drafts an acknowledgment stating the team will prepare a custom proposal.
* **Autonomy Policy Dispatcher:**
  * Under `MANUAL` mode: All reply drafts are saved to `conversations` with `status: "human_review_required"`.
  * Under `ASSISTED` mode: High-confidence safe drafts queue in SDR Inbox for 1-click approval.
  * Under `AUTONOMOUS_SAFE` mode: If `intentConfidence >= 0.85` and intent is `SAFE_QUESTION` or `OBJECTION_SAFE`, the response is auto-dispatched via Instantly/SMTP after a natural 10–15 minute delay.
* **Human Escalation:** Inquiries flagged as `LEGAL_RISK`, `ANGRY`, `UNSUPPORTED_PRICING`, or `confidence < 0.80` pause automated sequences and create an urgent alert for human reps.

## Data/schema changes
* Extend `conversations` collection with `draftResponse`, `humanAttentionRequired: boolean`, `escalationReason`.

## Backend changes
* Implement `functions/src/services/reply-generator.ts`.
* Implement `functions/src/services/reply-dispatcher.ts`.
* Implement `functions/src/services/human-escalator.ts`.

## Frontend changes
* Display AI draft response with one-click "Approve & Send", "Edit Draft", and "Escalate to Human" buttons in the conversation view.

## External APIs
* OpenAI / Anthropic API & Instantly API.

## Security considerations
* Verify that the AI reply generator never exposes internal knowledge base secrets, competitor disparagement, or legally binding contractual promises.

## Migration/backfill
* None required.

## Tests to write FIRST or alongside implementation
* `tests/replies/knowledge-grounding.test.ts`: Test that when asked *"Combien de temps prend une refonte de site ?"*, the response accurately cites the 3-week delivery timeline from the KnowledgeBase.
* `tests/replies/pricing-guardrail.test.ts`: Test that when asked for a 50% discount, the AI does NOT agree to the discount and routes the request to human review.
* `tests/replies/escalation.test.ts`: Test that receiving a legal threat or angry email pauses the sequence and sets `humanAttentionRequired = true`.
* `tests/replies/auto-reply-mode.test.ts`: Test that under `AUTONOMOUS_SAFE` mode, a standard FAQ question triggers auto-send, whereas under `MANUAL` mode it requires human approval.

## E2E scenarios
* Simulate a prospect asking *"Avez-vous des exemples de sites de fleuristes déjà réalisés ?"*; verify that the engine generates a grounded response citing floral case studies and queues it according to active autonomy policy.

## Definition of done
* [ ] Knowledge-grounded reply generation operational.
* [ ] Pricing guardrails and prohibited promises enforced.
* [ ] Autonomous safe dispatch and human escalation routing validated.
* [ ] Tests pass; Reviewer verdict PASS.
* [ ] `ACCEPTANCE_MATRIX.md` updated for REQ-066 through REQ-069.

## Reviewer checklist
* [ ] Are unlisted prices hallucinated by the AI?
* [ ] Do angry or legal threat emails escalate immediately?
* [ ] Is the response tone consultative, concise, and professional French?

## Explicitly out of scope
* Conversational calendar slot booking (deferred to Phase 12).
