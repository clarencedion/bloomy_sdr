# Phase 19 — Go-Live Readiness

## Objective
Make the SDR safe and able to send real prospecting for its first business, without adding a feature: the offer it pitches must be the owner's real one, the guardrail must accept honest statements of that offer and still refuse invented ones, no record may be silently attributed to a business it does not belong to, and the daily volume must follow Settings.

## Why this phase exists
Measured on the live project on 2026-11-09, the SDR had **never sent an email**: 181 companies and 101 drafts for Bloomy, 0 sent, 0 campaigns, send limit 0. Reading the send and reply paths for a 0 € + 49 €/mois offer found four blockers:
1. **The offer was not the owner's.** The seed pitched 1 490 € + 29 €/mois, forbade any price in a first email, and cited four case studies that exist in no CRM record or portfolio entry ("tattoo studio Nantes, PageSpeed 28 → 94"…).
2. **The guardrail could not accept the real offer.** `validateReplyGroundedness` escalated every draft containing "gratuitement" — i.e. every honest description of a free setup — while letting "49 €" through an offer with disclosure off (its regex only matched 3–6 digit amounts).
3. **37 hardcoded `"biz_devcomm"` fallbacks remained** despite ADR-016 #6. `biz_devcomm` does not exist in the live workspace (the consultancy is `biz_devcomm_mtrblciz`). An unattributed reply would have been answered with no offer and a prompt defaulting to "Devcomm Consulting".
4. **Volume was capped at 50/day whatever Settings said** (once-daily runner, `Math.min(limit, 50)`), and the daily limits themselves were never enforced in production: their counters need composite indexes that were neither declared nor deployed, and an unreadable counter allows the work.

## Requirements covered
* REQ-067 (pricing guardrail) — strengthened, now offer-aware and applied to cold outreach as well as replies.
* REQ-050 (claim validation) — commercial terms added as a claim class.
* ADR-016 #6 (no hardcoded business fallback) — completed.
* Invariant 1 (genericity), Invariant 5 (evidence provenance), Invariant 7 (bounded execution).

## Existing code to preserve
Reply classifier, dispatcher policy logic, booking/calendar truth checks, suppression (`canContact`), task queue retry/backoff, discovery, the Phase 18 UX contract.

## Architecture
* **`functions/src/services/pricing-guardrail.ts` (new, pure).** `checkPricingStatements(text, terms)` returns typed violations: `UNAPPROVED_FREE_OFFER`, `UNAPPROVED_FREE_PERIOD`, `UNAPPROVED_DISCOUNT`, `PRICE_NOT_DISCLOSABLE`, `UNAPPROVED_PRICE`, `COMMITMENT_CONTRADICTION`, `COMMITMENT_UNDECLARED`, `TAX_BASIS_CONTRADICTION`, `TAX_BASIS_UNDECLARED`. Free wording is judged per clause by what it sits next to (setup vs period words), with priced/commitment expressions masked, negation handled, and approved terms covering only their own nouns. `describePricingTerms(terms)` states the same terms for prompts. Used by reply validation (subject + body), cold-outreach claim validation (generation and manual edits), DM / contact-form drafts, `buildBusinessContext` and the reply prompt. A first version matched fixed phrasings; the adversarial review got 21 of 46 misstatements past it — all 46 are now pinned as tests. A second review wrote 60 new ones and 52 passed: **no pattern list covers French**, so this check is an advisory *detector* for the person reviewing, never clearance.
* **Fail-closed gate (`mentionsCommercialTerms`).** Deliberately broad vocabulary (price, free, offer, cost, pay, invoice, discount, commitment, cancellation, contract, duration, months/years, €, HT/TTC…). Autonomous reply dispatch and automatic cold-email approval refuse any draft that trips it; the approval card says "compare it with your offer" rather than presenting a pass as checked. 80 held-out misstatements from the second and third reviews trip it (pinned). It is a word list and a fourth review still found misses ("vous ne réglez rien avant la mise en ligne") — hence the rule that unattended commercial text must be written by code (Phase 21).
* **Reply delivery (`reply-transport.ts`, `reply-delivery.ts`).** Found by the review, pre-existing: on all three reply paths (autonomous dispatch, "approve and send", rep-written reply) the reply was recorded as sent and cleared from the Inbox, but nothing delivered it. All three now go through `deliverReply`, which re-checks suppression immediately before delivery (Invariant 3) and reports whether a transport actually delivered. No transport exists yet (`getReplyTransport` returns null), so: autonomous replies are handed to a person; an approved or rep-written reply is stored as `deliveryStatus: "recorded_not_sent"`, the conversation keeps its attention flags with `pendingExternalSend: true`, and the Inbox says "Validé — à envoyer depuis Unibox" instead of "envoyé". The commercial-vocabulary gate is accent-aware (third review: `\w` is ASCII-only).
* **Offer schema (`pricingGuardrails`)** gains `setupFee`, `monthlyPrice`, `commitmentMonths`, `taxLabel`, `approvedTerms`. All optional; absent means "not declared", never a default.
* **Attribution.** Every fallback replaced by resolution from related records (contact → company → existing conversation) or by refusal: no reply drafted, no meeting booked, no outreach generated, no discovery run, no signal collection. Unsubscribes and bounces still suppress (suppression is checked across businesses) with `businessId: null`. Spend without a business is recorded under a ledger bucket instead of being dropped.
* **Volume.** Daily limits are counted by `functions/src/services/daily-quota.ts`: one counter document per business per Paris day, reserved in a transaction right before the AI call (research and outreach generation). This replaces query-based counters that never worked (indexes never deployed, reused research documents dated from discovery day, unstamped backend documents). `dailyResearchQueueRunner` runs hourly 08:00–19:00 Paris; each pass reads each business's backlog with equality-only queries, shares `RUN_BATCH_CAP` (50) across businesses, and spends only that business's remaining research and generation allowance (`createDailyBudget`, which reports unreadable counters). Outreach is not re-enqueued within 6 h of a previous enqueue. A job that hits a daily limit ends as `deferred` and its company returns to the backlog (`needsResearch` / `needsOutreachRetry`).
* **Inbox.** An unattributed inbound conversation carries `needsAttribution: true` and is listed under every business; a confirmed slot that cannot be booked for a non-conflict reason is escalated rather than dropped.

## Data/schema changes
* `OfferDoc.pricingGuardrails`: 5 optional fields (both type files).
* `JobQueueDoc.businessId`, `ConversationDoc.businessId` (functions): optional.
* `companies.needsOutreachRetry`, `companies.outreachEnqueuedAt`; `conversations.needsAttribution`; `outreach.pricingGuardrailPassed`.
* New server-only collection `dailyUsage` (catch-all rule denies clients). `TaskStatus` gains `deferred`.
* No new composite index: every new query is equality-only.

## Frontend changes
* Settings offer editor: commercial terms fieldset (`offer-pricing-fields.tsx`), value propositions and proof points editable, prohibited promises multi-line, no prefilled claims. Form ↔ document conversion in `src/lib/offers/offer-form.ts`.
* Knowledge base: pipe-separated services and case studies; no default metric or industry.
* `saveOfferClient` uses `mergeFields` so a cleared term is cleared.
* Campaign creation refuses without a selected business.

## External APIs
None.

## Migration/backfill
* Re-seed the Bloomy offer: `node functions/scripts/seed-bloomy-web-offer.mjs --business biz_bloomy --plan` (read-only: shows which offer document would be updated), then without `--plan`. Requires a functions build and credentials explicitly pointed at `devcomm-os` (`GOOGLE_CLOUD_PROJECT=devcomm-os`) — the machine's default ADC project is the CRM.
* Deploy functions. The daily limits start applying from the deploy; the day's counters start at 0.

## Tests
* `functions/src/tests/reliability/go-live-readiness.test.ts` (80 tests, including every phrasing from the adversarial review).
* `src/tests/offer-form.test.ts` (9 tests).
* Updated: `booking/meeting-creator.test.ts` (explicit business), `instantly/instantly-dispatch.test.ts` (sender no longer hardcoded), `instantly/instantly-webhook.test.ts` (fixture contact attributed).

## Definition of done
* [x] Honest free-setup drafts pass the detector; every known misstatement shape is flagged on every drafting path (advisory).
* [x] No draft flagged by the broad commercial-vocabulary gate is sent or approved without a person (80 held-out misstatements pinned). The gate is a heuristic: unattended commercial text must come from code (Phase 21); until then nothing is sent unattended (no reply transport; auto-approval off by default).
* [x] No reply, on any of the three paths, is marked sent unless a transport delivered it; the Inbox says so (offline dispatcher test + static checks on the two manual paths).
* [x] No `|| "biz_devcomm"`-style fallback in generic code (static scan).
* [x] Daily volume follows Settings, bounded per pass; limit hits are deferred, not lost.
* [x] Seed carries the owner's confirmed terms and only verifiable proofs, and passes its own guardrail.
* [x] Typecheck ×2, lint, build ×2; full suite shows no regression against the offline baseline.
* [x] Independent adversarial reviewer verdict **PASS** on the fourth review (FAIL ×3 before it; every finding fixed or recorded as a precondition in HANDOFF.md).
