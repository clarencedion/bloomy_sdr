# Engineering Handoff Briefing

This file provides a concise, high-signal briefing for any AI session working on Autonomous SDR V2. Read this file first upon starting any implementation session.

---

## ⚡ Quick Context & Core Invariants

1. **Multi-Business SDR Platform:** This is NOT a website-sales application. Bloomy Digital Studio (website sales) is merely Use Case #1. Corporate sales consulting (Devcomm) is Use Case #2. The core SDR engine must remain 100% offer-agnostic.
2. **Golden Rule:** Preserve working code. Do NOT rewrite Recherche d'Entreprises discovery, website resolution, deduplication, Dropcontact integration, PDF generator, or Outlook calendar sync unless explicitly specified in the phase spec.
3. **Strict Invariants:**
   * Generic code must NEVER contain business/offer branching (`if (business === "Bloomy")` is forbidden).
   * All API keys must be isolated server-side (zero client read access in Firestore).
   * No outbound email may be sent without passing `canContact(...)` suppression checks.
   * Scraped web text and inbound emails are UNTRUSTED DATA, never system instructions.
   * AI-generated claims must map to verified `EvidenceItem[]` (`FACT != INFERENCE`).
   * Meeting time slots must query REAL calendar availability (no hallucinated slots).

---

## 🛠️ Verification & Build Commands

```bash
# Ensure Node and npm are on PATH (macOS default Homebrew path)
export PATH=$PATH:/opt/homebrew/bin

# 1. Typecheck frontend & backend
npm run typecheck
npm run --prefix functions typecheck

# 2. Build frontend & backend
npm run build
npm run --prefix functions build

# 3. Lint check
npm run lint

# 4. Unit test suite
npm test
npm run --prefix functions test
```

---

## 📂 Key Architecture Files
* `docs/autonomous-sdr-v2/REQUIREMENTS.md`: All 80 system requirements.
* `docs/autonomous-sdr-v2/ACCEPTANCE_MATRIX.md`: Authoritative verification checklist.
* `docs/autonomous-sdr-v2/ROADMAP.md`: 18-phase implementation roadmap.
* `docs/autonomous-sdr-v2/INVARIANTS.md`: Unbreakable architectural & security invariants.
* `docs/autonomous-sdr-v2/SIGNAL_ARCHITECTURE.md`: Pluggable Signal Provider architecture.
* `docs/autonomous-sdr-v2/SECURITY_MODEL.md`: Secrets isolation & prompt injection defenses.

---

## 🚀 Current Status: Phase 19 (Go-Live Readiness) complete — engine safe to send, sending path not yet real

**Read this first.** As of 2026-11-10 the SDR has never sent an email. Phase 19 made a first send *correct* (real offer, honest guardrails, no fallback business, enforced limits, honest reply status). It did not make sending *work*: the Instantly client targets API v1 (deprecated 2026-01-19) and no reply can be delivered from the SDR. **Phase 20 — Sending Path** is next. See ROADMAP.md (phases 19 → 24).

### ⚠️ Running tests on this machine
The suite writes to Firestore through `initializeApp()` with no project, and this machine's ADC/gcloud project is the **production CRM (`bloomy-crm`)** — very likely the source of the ~27 000 SDR test documents in the CRM database. Until tests pin a project or the emulator is installed (needs Java), run them offline and compare against the Firestore-dependent baseline (102 failures in 38 files, listed in `docs/autonomous-sdr-v2/offline-test-baseline.txt`):
```bash
GOOGLE_CLOUD_PROJECT=demo-sdr-offline GCLOUD_PROJECT=demo-sdr-offline FIRESTORE_EMULATOR_HOST=127.0.0.1:9 npm test
```
Scripts that must reach the live SDR project need `GOOGLE_CLOUD_PROJECT=devcomm-os` explicitly.

### Go-live data steps (owner — they write live data)
1. `npm run --prefix functions build`, then `GOOGLE_CLOUD_PROJECT=devcomm-os node functions/scripts/seed-bloomy-web-offer.mjs --business biz_bloomy --offer 50IEOY95GUvNjtzNJpJF --plan`, then the same without `--plan`. That offer ("Refonte & Modernisation Web", 1 500 € fixed, "+40% de conversion moyenne") is the one all 181 Bloomy companies and both campaigns point at; updating it in place keeps every reference valid. The knowledge base is replaced (its "Atelier Floral Nantes" case study and 1 500 € rule go).
2. Reject or regenerate the 101 existing Bloomy drafts — written against the old offer, they carry no commercial flags (the approval card treats a missing flag as commercial).
3. Deploy functions, `firestore.rules`, `firestore.indexes.json` together.
4. Set Bloomy's own booking link (`calendarConfig.bookingLink`) and sender identity: the proposal PDF no longer falls back to another business's Calendly, and replies/emails record the business's own sender.
5. Optional: backfill `needsAttribution: true` on conversations that have no `businessId` (created before this phase), so they appear in the Inbox.

Status 2026-11-10: steps 1 and 2 done for the DM channel (offer A reseeded in place, A/B variants seeded, 139 DM drafts written, 96 old email drafts set aside as `superseded_by_dm`). Step 4 (booking link, sender) still open.

### Offer A/B test (ADR-021 — do not regress)
* `business.offerExperiment` drives assignment; `company.offerAssignment` is written once per never-contacted company and never moved for a contacted one. Replies resolve the offer from the outreach the prospect was sent.
* While an experiment exists the knowledge base must state no amount (`offerNeutralKnowledgeBase` filters prompts; `seed-offer-experiment.mjs` refuses to write otherwise).
* Every offer in an experiment carries `pricingGuardrails.termsLine`; first DMs are opening (model) + terms line (code, verbatim) + question (model), `promptVersion: "social-dm-v2-terms"`, `offerTermsLine` stored on the draft. Never let the model state terms in a first DM of an experiment.
* Change terms: edit the variant in `seed-offer-experiment.mjs` (or Settings → Offer), run the seed plan then `--write`, then `node functions/scripts/backfill-social-dm-drafts.mjs --business <id> --redraft` (plan) and `--write` — it rewrites only unreviewed (`draft`) DM drafts.
* Results: `node functions/scripts/offer-experiment-report.mjs --business <id>`.
* One review for DM text (`reviewSocialDmText`), used by generation AND by `updateOutreachDraft` (which re-runs the judge). The model's part is checked against a CLOSED vocabulary (`FORBIDDEN_TABLE` in social-dm-terms.ts — the prompt's list is generated from it; change both by editing the table only) with NO masking or exceptions (reviews broke every exception), then by the model judge (`social-dm-judge.ts`, fail-closed). Do not add "prospect fact" exemptions back; tell the model to say the fact in other words instead.
* Redrafts: `generateSocialDm({ force, onlyIfUnreviewed })` + `lastUpdateTime` precondition; edits set `humanEditedAt`.
* Open: email first messages do not use the terms line yet; the report counts any classified reply as a reply and does not yet exclude sent DMs whose `offerTermsLineIntact` is false.

### Fresh start + live autonomous run (2026-11-10, owner request)
* `node functions/scripts/reset-prospecting-data.mjs` (plan) / `--write`: full JSON backup to `functions/scripts/backups/reset-<ts>/`, then deletes every prospecting collection and every workspace but ws_default. Keeps businesses, offers, experiment, KB, settings/keys, suppressionList, apiSpendDaily. Run on 2026-11-10 (backup 54 MB; 53 test workspaces removed).
* `node functions/scripts/launch-campaign.mjs --business <id> --prompt "…" [--max N] [--prefer-dm] [--plan]`: the app's "Start prospecting" from the CLI (ICP translation → active campaign → first discovery run); the cloud task queue does the rest.
* Campaign setting `preferredChannel: "social_dm"` ("Prefer direct messages" switch on the campaign page): a DM is written whenever the prospect has a trusted profile, email or not (`prefersDirectMessages`, task-queue routing). Default off.

### Prospects with no channel + Instagram name search (2026-11-11 — ADR-023, do not regress)
* `TASK_GENERATE_OUTREACH` for a company with no email goes through `draftWithoutEmail` (DM → contact form → `outreach.no_channel` info log + `noChannelAt` on the company). Never queue or throw an email draft with no recipient; the hourly runner skips a company for 7 days after `noChannelAt` (`NO_CHANNEL_RETRY_MS`).
* `findInstagramBySearch(companyId)` (`services/social/profile-search.ts`) runs before every "no channel" decision. A search result is used only when the handle matches the name (`profile-trust.ts`) AND the result confirms the place; a city-only confirmation also needs `carriesWholeName`. `resolveCompanySocialProfiles` re-applies that rule to `searchedInstagramUrl` (`searchedInstagramConfirmedBy` absent = city). Search results are untrusted text: matched against the company's own facts, never given to a model.
* Cost: one Serper call per company per 30 days (`instagramSearchedAt`); needs `serperApiKey` in `settings/integrationSecrets` (absent = no search, nothing fails).
* Live state on 2026-11-11 (biz_bloomy, campaign tattoo/barber): 60 companies, 30 DM drafts (28 Instagram queue, 8 Facebook), 2 with no channel, 17 pipeline jobs deferred by `dailyAiResearchLimit` = 50. Two DMs sent on 2026-11-11 (22:37 with a key, 22:43 by an automatic session — see "Automatic send sessions" below); no reply yet. 90 companies and 29 DM drafts that evening, all in the conversation style (ADR-025).

### DM recipients (ADR-022 — do not regress)
* A DM goes only to an account `profile-trust.ts` trusts. Never use a scraped profile without it: the "website" is often a booking page or directory whose links are the platform's. Uncertain = not used.
* After new research or a change to the rule: `node functions/scripts/repair-social-dm-recipients.mjs --business <id>` (plan) then `--write`.
* Before a first session on a new account or after a Meta UI change: `npm run social:rehearse -- --business <id> --network instagram` (types and sends nothing).
* Open (owner decisions): both biz_bloomy discovery campaigns are paused since September (nothing new is researched); 49 `ws_test_*`/`ws_dual_verify_*` workspaces in the live DB cut the per-business research share to 1 per hourly pass.

### Social DM sessions (Phase 23 — ADR-020)
* Runner: `npm run social:install` once, `npm run social:login -- --business <id> --network instagram|facebook` once per network, then `npm run social:send -- --business <id> --network <n> [--max N]` and `npm run social:inbox -- …`. README: `social-runner/README.md`. The runner talks to `devcomm-os` with the owner's Google credentials and refuses any other project.
* Before the first session: reseed the offer (step 1 above), then `node functions/scripts/backfill-social-dm-drafts.mjs --business <id>` (plan) and `--write`.
* Do not regress: nothing is sent without Enter for that message, except in an automatic send session (below); blockers stop the session; the email router/dispatcher/booking are never used for social conversations; `socialDmLocks` + `socialDmSentAt` are the one-first-DM locks.

### Automatic send sessions (ADR-024 — do not regress)
* `npm run social:send -- --business <id> --network instagram --auto [--veto S] [--max N]` — Instagram only. The operator starts it and confirms the account; each first DM then leaves at the end of its countdown unless S or Q / Ctrl+C.
* **Which text:** only a draft `autoSendVerdict` allows (`social-session-service.ts`: checks passed, no warning, the offer's terms line written by code and intact as its own paragraph, claim validation against verified evidence, every model-written figure verified — `social/dm-figures.ts`; fails closed). The runner gets it as `review.autoSend` from the same read as the text (`sdr.mjs`, `forAutoSend`). Other drafts are `held`: not opened, not typed, not marked skipped.
* **Whether at all:** `checkAutoSend` — pause, safe mode, 48 h after a blocked session, and `doubt_stop_unreviewed` (after an automatic session stopped on `AUTO_DOUBT_STOP` or never recorded its end, a session with keys with at least one message sent or skipped must have ended since). The runner's `STOP` names and the server's `AUTO_DOUBT_STOP` are pinned to each other by a test on the runner side. Asked at start, before each prospect, before each send and again after the spacing wait.
* **Where:** only into a conversation `threadState` proves new (`drivers/common.mjs` `classifyThread`, rules in `instagram-driver.mjs` `emptyThread`), checked before typing and before sending; self-checked after each send. If Instagram changes its chat window, update `emptyThread` from a rehearsal (`social:rehearse` prints the verdict per conversation) — never loosen `classifyThread` to "empty unless proven otherwise".
* **Never:** type a text twice, retry after a doubt, add randomised delays, stealth or a scheduler, give `auto` to the inbox flow (replies always wait for Enter), or send after a stop request (`interrupted(ctx)` is the last check before the send).
* **A text that left the composer without its bubble** is recorded `verified:false` (lock taken) and the session stops — after ruling out a blocker page and a composer the page rebuilt (`autoTextVanished`): do not turn this back into "retype" or "skip".
* **A conversation that is not provably new** is never parked: `recordSocialDmAutoHeld` marks the draft (`autoHeldAt`), it stays in the queue of sessions with keys, and `autoSendHoldReason` keeps automatic sessions away from it. Three in a row stop the session (`MAX_CONSECUTIVE_THREAD_REFUSALS`).
* Audit trail: `outreach.sentAuto`, `socialSessions.auto`, `auto` in `outreach.social_dm.sent` log metadata.
* `dm-figures.ts`: only numeric FACT evidence vouches for a figure (`IDENTIFIER_KEY` excludes phone, SIREN, postcode, address…), exactly; review counts written "N avis" are left to `validateOutreachClaims`, which allows a person's rounding. Do not add rounding there: a number says nothing of what it counts.
* A browser that never opened ends the session `browser_not_started`, which is not a doubt stop.
* Open, minor (third review): a real started-conversation and the typed chat window have no live fixture yet (the first watched automatic session provides both — the post-send self-check validates the first); `autoHeldAt` is never cleared; `send()` in `bin/run.mjs` is covered by source guards only.
* First live automatic session (2026-11-11 18:01): stopped itself before its first send on an unknown "Send" label in the typed chat window — fixed (`emptyThread.interfaces[fr].typingLabels`). A session with keys prints the check's verdict with the text typed ("Vérification (information)…"); it read "new" on both sessions of that evening (logs in `social-runner/.state/logs/`). `classifyThread` returns `unexpected` lines for the terminal and log only; `why` (a category) is all the SDR stores.
* A draft wrongly left to a person: `node functions/scripts/release-auto-held-dms.mjs --business <id> --reason "<exact reason>"` (plan) / `--write`.
* Live on 2026-11-11: 31 drafts, 30 allowed by `autoSendVerdict` (1 held: "près de mille avis", a quantity in words); rehearsal on 3 prospects: 3 conversations "new".
* **First real DM: 2026-11-11 22:37, session with keys, Le Gamin à Dix Doigts** (the draft an automatic session would have held; the owner read and sent it). Log `social-runner/.state/logs/2026-11-11T21-37-17-481Z-send-instagram.log`: conversation "new" before typing and with the text typed (seen twice that evening, 22:27 and 22:37), Enter, "Envoyé", recorded `sent` / `browser_session`, conversation created with nothing to check. Read back afterwards (no typing): `threadState` on that conversation = `has_content` (`why: text`), no blocker — so the check does see a started conversation, which had never been observed. The 22:27 session (owner quit, 0 sent) left nothing behind: the 22:37 session found the conversation new.
* `checkAutoSend` = allowed since that session (it ended with one message sent). **First automatic send: 2026-11-11 22:43** (Dolores Paris, session `--auto`, log `social-runner/.state/logs/2026-11-11T21-42-13-456Z-send-instagram-auto.log`): countdown, send, record, post-send self-check, no doubt stop; the owner quit during the spacing wait. 29 drafts left, rewritten in the conversation style the same evening (below).
* Not bounded yet: `checkAutoSend` reads every session of the business on the network (equality filters only). Fine at a few sessions a day; bound it by date (composite index) before that grows.
* The claim validator reads both spellings of the provider keys (`google_review_count` / `google_places_review_count`, …). `evidence-service.ts` labels, `angle-generator.ts` and `pdf-generator.ts` still read only the old spellings — to align in the email phase.

### Conversation-style first DMs (ADR-025 — do not regress)
* Opt-in per business: `node functions/scripts/set-social-dm-opening.mjs --business <id> --intro "<sentence>" [--observe no_site,slow_site,not_mobile_site,outdated_site,no_online_booking]` (plan) / `--write`; `--off --write` goes back to the offer's terms line. Then `backfill-social-dm-drafts.mjs --business <id> --redraft` (plan) / `--write` rewrites the unreviewed drafts. biz_bloomy runs this style since 2026-11-11, with `no_site, slow_site`.
* The message: model opening (one good, true thing: reputation, trade) + at most one **observation written by code** + the business's `introLine` (verbatim), one paragraph; then the model's question. **No commercial term anywhere**; the terms are for the reply. The model sees neither code sentence.
* **The model never speaks of the prospect's online presence.** Two attempts to let it and check its text were broken by review within minutes (49/59, then 57/66 rewordings passed). `social/dm-observations.ts`: `pickObservation` writes the sentence from evidence; `presenceWordIn` + `PRESENCE_TABLE` is the closed vocabulary the model's parts may not contain (also listed in the prompt — the two are one table); `isOnlinePresenceFact` keeps web evidence out of the model's facts. Do not hand the model a site fact "just for context", and do not replace the vocabulary by a smarter reading of the text.
* A new observation kind = one entry in `OBSERVATION_KINDS` + one case in `lineFor` (evidence predicate with its contrary signs, one fixed sentence that passes both commercial word checks — a test asserts it) + tests. Selection stays business data. **It joins `UNREAD_KINDS` only after its detector was run on real pages and found right:** `not_mobile_site`, `outdated_site` and `no_online_booking` are not in it — the page reader that feeds them (`website-technical-provider.ts`) takes the first copyright-like year in the HTML, misses a viewport tag without quotes, and knows a short list of booking platforms. Improve the detector (footer year outside comments and scripts, PageSpeed's viewport audit, a wider booking list), prove it, then add the kind.
* "Their site" needs a positive sign (`ownAddress`): the record's `website` is the root of a registered domain (two labels, tracking parameters only) or a page of a host registered under two words of the business's name (or its only word exactly); the crawl stayed on that site (`sameSite`); the LCP's `sourceUrl` is on it. Discovery records directory pages as a company's website (wanderboat.ai, ivof.com on 2026-11-12, both added to `third-party-domains.ts` earlier and still recorded on older companies): never loosen this to "not on a platform list".
* The model gets `{ name, city }` and empty research in this style — not the address, not `opportunityScore.detectedNeeds` / `recommendedAngle` (built by `angle-generator.ts` with no confidence filter, and with an `isWebOffer` branch at `angle-generator.ts:128` — it reads the offer's name for "web" / "site" / "refonte": offer-specific logic in generic code, against Invariant 1. Pre-existing, found by the ADR-025 review, not fixed: the terms-line DM and the emails still get that angle).
* An automatic session may send such a draft only through `conversationAutoHoldReason` (code sentences once and in place; no closed-list word, no broad-list word; no presence word in the model's parts — re-read from the text, not from stored flags), then `autoSendVerdict`, which **recomputes every code-written sentence from its source**: `intro_line_not_current`, `observation_not_current`, and on the terms path `terms_line_not_current`. Consequence to remember: after changing a business's intro line or observations, an offer's terms line, or after evidence is collected again for a prospect, the drafts concerned are held until `--redraft`.
* A draft an automatic session would hold must say why on the draft (`riskWarnings`): `reviewConversationDm` names the word, `describeAutoHold` words the verdict. A clean-looking draft that never leaves is a bug.
* Do not add example sentences to the prompts (they get copied into every message), nor a word that says what is sold (the Invariant 1 scan covers the conversation prompts and `social-dm-conversation.ts`).
* **No check proofreads the French** (a model proofreader was tried live and caught nothing). The countdown is the only reading an automatic message gets.
* Not done: the terms line is not inserted by code in replies (the reply states the variant's terms in the model's words, read by a person), so `offer-experiment-report.mjs` compares variants after the reply, not on the first message; no reply-rate comparison between the two styles yet (`promptVersion` is on every draft: `social-dm-v2-terms` vs `social-dm-v3-conversation`); no Settings field for `socialDmOpening` (script only).
* **Review status:** adversarial review PASS on the fourth pass (2026-11-12). The two majors it left (N9: one shared word / a subdomain root counted as "theirs"; N10: the speed figure not tied to its `sourceUrl`) were fixed after that verdict and are pinned by tests and mutations, **not reviewed again**. Its open minors: `has_website:false` only means "no address on record at signal time" (nothing records that a site was looked for); a business whose kinds list a guessed one before a measured one gets the guessed one, so the draft waits; text a person types right before a kept observation is not read with it.
* The two live companies whose recorded website is a directory page (Nouvel Hair → wanderboat.ai, Le Cercle d'Or → ivof.com) should have their `website` corrected and their signals collected again.
* Evidence quality found on the way: the company register is matched by name and attached a restaurant group ("ACTUEL CONCEPT", 4 establishments, NAF 56.10A) to a tattoo studio with confidence ≥ 70. Conversation DMs no longer use register-size facts; emails and scoring still do. Several prospects whose only address is their Instagram page carry no `third_party_presence_only` / `is_redirected_to_social` flag, so "no site of your own" is said to few of them (1 of 29 on 2026-11-12; 8 more have a measured page that is not positively their own site, or an ordinary loading time): the observation is right to stay silent, the signal provider is what to improve.

### Contacts found by enrichment carry their tenant (2026-11-11)
* `company-enrichment.ts` `upsertContact` stamps `workspaceId` / `businessId` from the company (`tenantOf`). Before, website/social contacts were written without them and were invisible to workspace-scoped reads. Repair script: `node functions/scripts/backfill-contact-tenancy.mjs` (plan) / `--write` — run on 2026-11-11 (10 contacts stamped).

### Phase 20 preconditions recorded by the Phase 19 review
* Commercial text sent unattended must be written by code, not the model — the vocabulary gate is a heuristic with known misses.
* `pendingExternalSend` has no "I sent it from Unibox" action; `draftResponse.status` still reads `approved_and_sent` for recorded-only replies, and `conversation-timeline.tsx` / the thread bubble ignore `deliveryStatus`. Fix these as part of making delivery real.
* Social-DM and contact-form drafts are not counted against a daily quota (they are sent by a person).
* Minor: the research backlog query limits before the workspace filter (two workspaces sharing a business id); the unattributed sweep reads the same first 25 documents.

---

## 📜 Status before Phase 19: 18 Phases Complete — Backend Fortified, Experience Simplified
* All 80 System Requirements (`REQ-001` through `REQ-080`) are fully implemented and verified across both business archetypes in `docs/autonomous-sdr-v2/ACCEPTANCE_MATRIX.md`.
* Dual-Fixture validation proved that onboarding and executing distinct business models (Bloomy Digital Studio vs. Devcomm Consulting) executes with **0 lines of business branching** in generic services.
* Adversarial security audit comprehensively tested and fortified 7 hostile attack vectors (prompt injection, secret leakage, cross-tenant leaks, suppression bypass, webhook replay attacks, calendar hallucination, and evidence provenance).
* **One-Click SDR Demo Mode & Safety Email Allowlist:** Built-in interactive 8-stage simulation runner and strict email allowlist safety containment (`testEmailAllowlist`).
* **`TESTING.md` Runbook:** local commands, mock vs live env vars, staging setup, zero-cost mock tests, real-email safe testing, and the 10-lead production smoke test protocol.
* **Phase 18 — UX Simplification (see `UX_SIMPLIFICATION.md`, ADR-009, ADR-010):** the product now presents four primary surfaces (Home / Campaigns / Inbox / Meetings). A campaign goes live in two meaningful interactions. All prior operational tooling is preserved under `/app/advanced`.
* Automated test suite comprises **396 root tests (110 files)** and **266 functions tests (75 files)** totaling **662 tests** passing with 100% success rate.
* Production builds (`next build` — 24 routes — & `tsc`) and lint checks pass cleanly with 0 errors and 0 warnings.

---

## 🧭 UX Contract (Phase 18 — do not regress)
Anyone touching the frontend must preserve these:
1. **Primary navigation is exactly five items** (`Home`, `Brain`, `Campaigns`, `Inbox`, `Meetings`), plus `Approvals`, `Settings` and a collapsed `Advanced`. `Brain` (the live view of every agent) was promoted at the owner's request on 2026-11-10. Adding any other operational page to primary navigation is a regression.
2. **No provider or internal jargon on a primary surface.** SIRENE, NAF, Dropcontact, Instantly, PageSpeed, "enrichment", "queue", "lead research" belong in Advanced. Raw `log.message` values are technical by design and must never be rendered — use `humanizeActivity()`.
3. **Every rendered number must come from `src/lib/sdr/aggregations.ts`** or an existing Firestore/callable helper. No placeholder dashboards.
4. **Business logic stays out of components.** Add to the aggregation/translation layer, not to JSX.
5. **The simplified UI stays business-agnostic** (Invariant 1). The same flow must serve a web studio and a sales-training consultancy; `src/tests/ux-simplification.test.ts` enforces this statically.
6. **Logs must be tenant-stamped.** `writeLog` and `createLog` write a top-level `workspaceId`; the activity feed's `belongsToScope()` drops anything it cannot prove belongs to the scope. Never widen a log read into an unscoped fallback — an empty feed is correct, a foreign one is not.
7. **The funnel is cumulative.** Each stage counts distinct companies that reached *at least* that stage. Do not reintroduce single-`status` equality checks; they make the funnel non-monotonic.
8. **Two-interaction launch.** Describe → confirm plan → `Start prospecting`. Do not reintroduce manual Run / Research / Generate / Approve / Send steps into the normal flow; they remain available under Advanced.

---

## 📮 Channel Contract (contact_form — do not regress)
The contact-form channel is defensible only because of what it refuses to do. Anyone touching `functions/src/services/contact-form-*.ts` must preserve these; `functions/src/tests/outreach/contact-form.test.ts` pins them:
1. **A CAPTCHA is a refusal, not an obstacle.** reCAPTCHA, hCaptcha, Turnstile, Friendly Captcha and embedded third-party widgets mark the form `assisted`. Never solve, outsource, or headless-browser around one — that is precisely the behaviour the CAPTCHA exists to stop, and it puts the sending domain in bad company.
2. **Honeypots stay empty.** A hidden input *with* a value is a framework token and must be echoed; a hidden input *without* one — including a field hidden only by inline `display:none` — is a trap. Filling it identifies us as a bot.
3. **One message per company, ever** (`company.contactFormSentAt`, set by both the automatic send and the hand-sent confirmation). A second submission is spam whatever it says.
4. **No send without a resolvable reply address.** A prospect who cannot answer or object is being spammed, not contacted.
5. **Safe mode blocks submission outright.** A form has no address to check against `testEmailAllowlist`, so refusal is the only honest containment. Do not "improve" this into a simulated send.
6. **Suppression is checked by domain and SIREN before posting**, since there is no email to check.
7. **The channel is off unless the campaign asked for it.** `resolveChannels` defaults to `["email"]`, always retains email, and discards unrecognised names.
8. **A new outreach channel must be translated in `activity-humanizer.ts`.** The guard test in `src/tests/ux-simplification.test.ts` scans the backend for emitted log types and fails on any that is neither translated nor deliberately hidden.

---

## 🧾 State & Cost Contract (do not regress)
1. **Never infer state from data that failed to load.** A read error and an empty result must stay distinguishable. `listBusinessesClient` throws; the provider records `loadError` and substitutes nothing. Do not reintroduce hardcoded default businesses as a fallback — they carry an `automationPolicy`, so rendering them states an autonomy level the owner never saved. Seeding may only follow a successful read that returned zero.
2. **Approvals is not gated on autonomy.** DM and contact-form drafts can only ever be sent by a person. Any new channel that cannot send unattended must appear here too.
3. **Firestore reads are the dominant cost, and they scale with browsing.** Route repeated whole-collection reads through `cachedRead()` in `src/lib/sdr/query-cache.ts`, and call `invalidateReadCache()` after anything that writes. Never count documents by fetching them — use `getCountFromServer` and declare the index. Measured baseline: 123 companies ≈ 250 reads per fresh screen.
4. **A purge never forgets a suppression.** `suppressionList` is excluded from `purgeBusinessData` and that is not configurable. Spend history and settings are likewise kept.
5. **Unstamped documents are swept only in a single-business workspace.** An absent `businessId` renders under every business, so with two businesses a purge has no mandate over it.

---

## 🔬 Live-Run Contract (do not regress — ADR-016)
1. **A provider never substitutes its own search terms.** No hardcoded city, trade or keyword fallback. A search that cannot be formed is an error the caller sees, not a different search performed quietly.
2. **A campaign that finds nobody must say so.** Four consecutive empty runs set `areaExhausted` and log `discovery.campaign.area_exhausted`. "Active with zero results for ever" is the failure mode this replaces.
3. **`company.website` is gated by `isUsableCompanyWebsite()`.** A directory, booking platform, blog post or search URL is kept as `directoryUrl` and never as `website` — it feeds the speed audit, the email scrape and the contact-form send. The form detector re-checks independently so legacy bad data cannot reach a send.
4. **A permanent failure is recorded on the company, not only the job.** `outreachBlockedAt` stops the daily runner re-enqueueing it; finding a contact clears it. Never re-enqueue a verdict already known.
5. **Model text is bounded by truncation, never rejection** (`functions/src/utils/ai-schema.ts`). A cap protects storage and display, which truncation satisfies. But fields that carry meaning stay strict: no defaulted `fitScore`, no empty email body, and an unrecognised recommendation falls back to the cautious option.
6. **No hardcoded business id as a fallback** in generic jobs. An unstamped document belongs to nobody; attributing it to a named business writes into someone else's quota and screens.

---

## 💸 AI Cost Contract (do not regress — ADR-017/018)
1. **A prompt carries facts about the prospect, never bookkeeping about how they were produced.** `rawInput`, `rawOutput` and `rawProviderData` must never re-enter a prompt — they were 75% of the research block and said nothing the parsed fields did not. Serialise per-company payloads compactly; only the fixed output-schema example stays indented.
2. **Prompt caching does not work on Haiku 4.5 here.** It needs a 4,096-token stable prefix; the system prompts are 524 and 317. Do not add `cache_control` expecting a saving — verify `cache_read_input_tokens` is non-zero before claiming one.
3. **Price by provider, not by model id.** Qwen reaches an Anthropic-compatible endpoint, so keying the price table on model alone bills it at Claude rates.
4. **A Qwen model id must never pass through Claude's alias table** — `QwenProvider` sets `model` after `super()` for exactly this reason.
5. **Qwen is the default, and its output quality on French B2B copy is still unmeasured.** Pricing and endpoint are verified against Alibaba's documentation; quality is not, and the owner accepted that tradeoff knowingly. The first real comparison — the same prospects through both providers, drafts read side by side — has not been run. Treat a complaint about draft quality as this hypothesis until it is tested; switching back is one Settings change.

---

## 🧷 Go-Live Contract (do not regress — ADR-019, Phase 19)
1. **Commercial terms are offer data.** Never put a price, free item, discount or commitment rule in code or a prompt literal; extend `pricingGuardrails` instead.
2. **`checkPricingStatements` is a detector, not a gate.** Never use a pass as permission to send. The gate is `mentionsCommercialTerms`, and it is a heuristic: unattended commercial text must be written by code.
3. **Nothing is recorded as sent unless delivered.** Every reply leaves through `deliverReply` (suppression first). Do not write `sentAt`/clear attention flags on any other path.
4. **No fallback business, name, sender, booking link or company text.** Unattributed means refused (or listed for a person), never attributed. The static scan in `go-live-readiness.test.ts` enforces it.
5. **Daily limits live in `dailyUsage`,** reserved atomically right before the AI call. Do not reintroduce query-based counters; a limit hit is `deferred`, never a permanent failure.
6. **The seed never deletes,** and writes live data only with `--offer`/`--plan` run by the owner.

