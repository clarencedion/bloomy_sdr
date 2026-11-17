# Active Engineering Progress

This file tracks the active implementation state of Autonomous SDR V2. It is updated after every completed phase.

---

## 📍 Current Phase
* **Last Completed Phases:** **Phase 19 — Go-Live Readiness** (ADR-019) and **Phase 23 — Social DM Sessions** (ADR-020), both 2026-11-10. Phase 23 was pulled forward at the owner's request (DM prospecting the same day) and run in the same session as Phase 19, against the one-phase-per-session rule, at the owner's explicit instruction.
* **Status:** both `COMPLETED` (Verified ✅ — adversarial review PASS: Phase 19 on its 4th review, Phase 23 after a 49-agent review + 2 fix rounds).
* **Next Phase:** **Phase 20 — Sending Path** (Instantly API v2 + reply delivery for email). Not started.

---

## 🔎 Day 2 of the live run (2026-11-11) — prospects with "no channel" (ADR-023)
* **State found in the morning:** the SDR ran overnight on its own: 60 companies researched, 21 DM drafts — and 22 qualified prospects with nobody to write to (no email, no profile linked from their site), 12 of them shown as failed jobs.
* **Hourly runner queued drafts that could only fail.** `dailyResearchQueueRunner` offered every qualified company without outreach to `TASK_GENERATE_OUTREACH`, which threw "Lead is not ready for outreach" when the company had no email. The task now tries the other channels the campaign allows (`draftWithoutEmail`: DM → contact form), and a prospect nobody can write to is noted once (`outreach.no_channel`, info) and stamped `noChannelAt`; the runner offers it again only after 7 days. Since the deploy: no dead-letter job (the 12 old failed jobs stay in `jobQueue` as history).
* **Instagram found by name search** `functions/src/services/social/profile-search.ts`: when a prospect has no trusted Instagram profile, one Serper search `site:instagram.com "<name>" <city>` (8 s timeout, one 429 retry, not repeated for 30 days). A result is used only if its handle matches the company's name AND the result confirms the place (phone, postcode or city in its title/snippet); with the city alone, the handle must be the business's whole name plus only trade words, the city or digits (`carriesWholeName`). The resolver applies the same rule when it reads the stored profile back. Wired before every "no channel" decision (pipeline and draft task).
* **Live result (biz_bloomy):** 12 no-channel prospects searched → 10 profiles found, 2 not confirmed. One was a namesake ("Kustom Tattoo" → a Paris sneaker customiser, one shared word + the city): rule tightened, its draft set aside by `repair-social-dm-recipients.mjs`. Now **30 DM drafts** (A 12, B 4, C 6, D 8), 28 in the Instagram queue and 8 in the Facebook one, all gate-allowed, 0 warnings. 17 pipeline jobs deferred: `dailyAiResearchLimit` (50/day) reached.
* **Verification:** full offline suite 1 815 passed / 102 failed = the known Firestore-dependent baseline (same 38 files); social suites 356/356 (`profile-search.test.ts`, resolver cases in `outbound.test.ts`); new `tests/research/no-channel.test.ts` 7/7; typecheck ×2, lint, functions build. Web build not re-run (no web change; the dev server was serving the Brain page). Deployed to devcomm-os (12 functions, 3 batches, all successful).
* **First real DM sent 2026-11-11 22:37** (session with keys, one message, confirmed in the thread and recorded; the check read the conversation as new before, and as started after). Automatic sending is allowed again since that session.
* **First automatic send: 2026-11-11 22:43** (Dolores Paris; countdown, send, post-send self-check, no doubt stop; the owner quit during the spacing wait before the second).
* **Still never exercised for real:** the inbox sweep on a real reply. The rehearsal (`social:rehearse`) opens the conversations but types nothing.

## 💬 First DMs that open a conversation (2026-11-11/12, owner request — ADR-025)
* **Why:** after the first two real DMs (22:37 with a key; 22:43 by the first automatic session that sent — Dolores Paris, no doubt stop, post-send self-check passed), the owner found the messages "trop démarchage" and asked for the best reply rate, researched, written as the studio's co-founder from a personal account. They also asked for the session to behave "naturally" (search, typing): refused again, as in ADR-020/024 — nothing is built to make an automated session pass for a person.
* **What changed:** `business.socialDmOpening = { style: "conversation", introLine, observations }` → opening by the model (one good, true thing about the prospect), at most one observation about their online presence **written by code from the evidence**, the business's own introduction inserted by code, one question; no price, no terms line, no link. The terms come in the reply (variant still assigned at drafting). New: `social-dm-conversation.ts`, `social/dm-observations.ts`, the conversation prompts in `outreach-prompts.ts`, `set-social-dm-opening.mjs`. Changed: `generateSocialDm`, `updateOutreachDraft`, `autoSendHoldReason` / `autoSendVerdict` (every code-written sentence recomputed from its source — the terms line too), `extractPersonalizationFacts` (labels for the keys providers really write), `pricing-guardrail.ts` (`commercialWordIn`), `dm-figures.ts` (rounding boundary).
* **Live drafts read one by one drove the first design:** openings quoted the street address (the model's twelve facts were SIREN, address, phone); "vous n'avez pas de site propre" written to businesses with no website fact on record, about one draft in seven; a namesake's "quatre établissements"; petty hooks (a 75/100 score, a copyright year).
* **Four adversarial reviews — FAIL, FAIL, FAIL, PASS — drove the final design:** (1) the verdict trusted the draft's own intro line; a phrase check let 49 of 59 rewordings of a site claim through; an edit erased the warning; the terms path had become stricter in silence. (2) After a rebuild by topic and polarity: 57 of 66 rewordings still passed, a third of harmless sentences were held, the terms path still trusted the draft's own terms line. Conclusion as for commercial terms: code states what must be true, the model is kept off the subject by a closed vocabulary, the verdict recomputes every code-written sentence. (3) On that design — "sound", no way found around the verdict — three of the five code-written sentences were false on ordinary pages (heuristic detectors), an unlisted platform was "votre site", and the model still received the address and research's needs: two kinds leave unread, the address needs a positive sign, the model gets name and town only. (4) PASS, no blocker; its two majors (a platform sharing one word of the name counted as "theirs"; the speed figure not tied to the address it was measured on) fixed afterwards, pinned by tests and mutations, not reviewed again. See ADR-025 "How it got there".
* **Live (biz_bloomy, 2026-11-12):** intro line "Je suis Clarence, cofondateur de Bloomy : à deux, on crée des sites web pour les indépendants."; observations `no_site, slow_site`; 29 unreviewed drafts rewritten (`backfill-social-dm-drafts.mjs --redraft --write`), 34–60 words; `autoSendVerdict`: 29 allowed, 8 with a code-written observation (7 slow site with its figure, 1 no site), none where the model speaks of their site. Two prospects whose recorded "website" is a directory page (wanderboat.ai, ivof.com) would have been told "votre site met 30,1 secondes" under the previous rule.
* **Deployed 2026-11-12** (devcomm-os, 12 functions, 3 batches, all "Successful update"): `taskQueueProcessorJob`, `taskQueueWorkerHttp`, `processTaskQueueCallable`, `dailyResearchQueueRunner`, `runResearchQueueNow`, `generateSocialDmCallable`, `markSocialDmSentCallable`, `generateOutreachNow`, `updateOutreachDraft`, `enqueueTaskCallable`, `researchCompanyNow`, `retryTaskJobCallable`. New prospects of a business with `socialDmOpening` are drafted in the conversation style by the pipeline. No conversation-style DM had been sent when this was written; nothing is committed in git.
* **Tried and not shipped:** a model proofreader for the French (Qwen flash, temperature 0) — 0 of 4 known errors found, so no such check exists; see ADR-025, known limits.
* **Verification:** `dm-conversation.test.ts`, `dm-observations.test.ts` (new); full offline suite 2 101 passed / 102 failed = the known baseline (same 38 files); typecheck ×2 and eslint on the changed files clean; functions build. 57 mutations of the rules, each failing a test. Web build not re-run (no web source changed; the dev server holds `.next`).

## 🤖 Automatic send sessions for first DMs (2026-11-11, owner request — ADR-024, amends ADR-020)
* `social:send --auto [--veto S]`, Instagram only: the operator starts the session; each first DM leaves at the end of a countdown (S skips, Q / Ctrl+C stops). Sent only when the SDR's `autoSendVerdict` allows the text (checks passed, terms line written by code and intact, claim validation), the SDR's switch `checkAutoSend` allows sending (pause, safe mode, 48 h after a block, an unreviewed doubt stop), and the conversation is provably new (`threadState`). Nothing is typed twice; any doubt stops the session; replies stay manual; each automatic send is recorded (`sentAuto`).
* **Adversarial review, three passes:** first FAIL (2 blockers, 5 majors) — all fixed: a stop request after the countdown is honoured up to the send; a text that leaves the composer unseen is recorded "to check" instead of being retyped (was a duplicate); the gate is asked again after the spacing wait; drafts whose terms the model wrote are never automatic; held drafts no longer hide selector drift nor starve the queue; a first DM is only typed into a new conversation. Second PASS, no blocker, three majors erring toward not sending — all fixed: a vanished text is first explained by a blocker page or a rebuilt composer before being recorded; a conversation that is not new is left to a person (not parked) and three in a row stop the session; ratings are compared in the live phrasings and every model-written figure must be verified. Third PASS, no blocker; its one residual fixed: only numeric FACT evidence vouches for a figure (not the digits of a phone number, a registration number or an address), exactly (no rounding outside review counts), and "noté N" is read as a rating without taking "hôtel 4 étoiles" or "2 sur 5 de vos pages" for one.
* **Found on the way:** the claim validator read evidence keys the providers do not write — every true review count was "unsupported" (13 of 30 live drafts). Fixed for emails and DMs. Contacts created by website/social enrichment had no `workspaceId` / `businessId` — fixed (`tenantOf`), 10 live contacts stamped (`backfill-contact-tenancy.mjs`). Two directory sites recorded as prospects' own websites added to the third-party lists.
* **Other channels, measured the same day (biz_bloomy, 60 companies):** email — 10 prospects have an address found on their own site, but nothing can be sent (Phase 20) and the campaign prefers DMs, so no email draft exists; contact form — built, not enabled on this campaign; Facebook DM — 8 drafts, account never connected in the runner, no automatic mode; replies — inbox sweep never run on a real reply; follow-ups — none exist on any channel.
* **First live automatic session (owner, 2026-11-11 18:01–18:10): stopped by itself, nothing sent.** First prospect typed; at the look right before the send, the chat window showed a "Send" button (the French interface's send button reads "Send") the check did not know → nothing sent, composer emptied, session stopped `auto_thread_check`. Fixed: `typingLabels` of the French interface = `["Send", "Envoyer"]`; the check now lists every unexpected line (on this Mac only — the SDR gets a category, never a line that could be somebody's message); a session with keys shows the same look as information, so the typed window is seen before the next automatic session; every session writes its display to `social-runner/.state/logs/`; `functions/scripts/release-auto-held-dms.mjs` released the one draft wrongly left to a person. Automatic sending is refused (`doubt_stop_unreviewed`) until the owner finishes a session with keys with one message sent or skipped — as designed.
* **Live checks (read-only):** 30 of 31 drafts allowed by `autoSendVerdict` (1 held: a review count spelled in words); rehearsal on 3 prospects: conversations opened, all three "new". The owner started one session with keys at 13:55 and quit without sending. No real DM has been sent yet.
* **Verification:** full offline suite 1 913 passed / 102 failed = the known baseline (same 38 files, listed in `offline-test-baseline.txt`); runner suite 389/389 after the first live session's fixes (`auto-send.test.mjs` incl. a 400-seed sweep with browser keys, closed windows, blockers and mid-call stop requests; `thread-state.test.mjs` on live samples); `outbound.test.ts` + `dm-figures.test.ts` 191/191; every automatic-session rule removed in turn makes a test fail (53 mutants, all killed); typecheck ×2, lint, functions build. Deployed to devcomm-os on 2026-11-11: 16 functions in 4 batches, all successful (the runner itself runs from the local build).

## 📊 Phase 23 — Social DM Sessions (2026-11-10)
* **Local runner** `social-runner/` (Node + playwright-core 1.61.1, cached Chromium or `--chrome`): `npm run social:login | social:send | social:inbox -- --business <id> --network instagram|facebook`. Visible browser, dedicated profile in `~/Library/Application Support/devcomm-sdr/profiles/<business>`; types each DM (lines + Shift+Enter, never a raw newline), verifies the composer, and **sends only on Enter for that message** (S skip, E edit, Q quit; O to confirm a draft whose offer check failed). Stops on login wall / checkpoint / CAPTCHA / "action blocked" and after 3 selector failures in a row. Pending-send journal (fsynced before Enter) replays unrecorded sends as unverified. Identity of the logged-in account checked at session start.
* **Backend** `functions/src/services/social/**`: profile parsing (IG/FB), gate `canContactSocial` (company do-not-contact/disqualified, handle suppression, domain/SIREN, one first DM per company AND per social account `socialDmLocks`, safe mode), atomic cap + spacing per network (`dailyUsage`), session records (`socialSessions`), `recordSocialDmSent` (contact without email + conversation + message, idempotent), inbound sweep `ingestSocialInbound` (dedupe, per-message auto-reply filtering, deterministic DM opt-outs, escalation without draft on failure, grounded DM reply with offer detector + commercial flag + calendar-truth check), `recordSocialReplySent`. Email paths byte-identical.
* **AI**: `generateStructured` on the Anthropic/Qwen provider (timeouts, 429/5xx retries, schema parse), `runStructuredAiCall` (refuses the mock provider, records spend).
* **Web**: network badges and handles in the Inbox; social threads never offer the email send/regenerate actions; "send from the session" state only for work the runner will offer; unconfirmed sends need attention; Approvals DM card with one "I sent it on <network>" button per profile and persisted edits; Inbox "Désinscrire" suppresses the handle and the company.
* **Operator scripts**: `functions/scripts/backfill-social-dm-drafts.mjs` (plan / `--write`): prepares DM drafts for never-contacted prospects with a social profile and sets their unsent email drafts aside. Plan on 2026-11-10 for biz_bloomy: 139 DM drafts (127 IG, 95 FB), 96 old email drafts set aside, 42 companies without a profile.
* **Verification**: typecheck ×2, lint, both builds; full offline suite 1 486 tests — failures = the 100 Firestore-dependent baseline + 2 known `auto-reply-mode` ones; Phase 23 suites 902/902; mutation checks 23/23 killed.

## 🧪 Offer A/B test + go-live operations (2026-11-10, owner request — ADR-021)
* **Experiment engine** `functions/src/services/offer-experiment.ts`: `business.offerExperiment`, deterministic assignment per never-contacted company (`company.offerAssignment`, transactional), contacted prospects never re-assigned, offer-neutral knowledge base while an experiment exists, `summarizeExperiment`. Wired into `generateSocialDm`, `generateOutreach` and research. Scripts: `seed-offer-experiment.mjs` (plan / `--write`, self-consistency checks), `offer-experiment-report.mjs` (read-only).
* **Terms stated by code in first DMs** `functions/src/services/social-dm-terms.ts`: an offer's `pricingGuardrails.termsLine` is inserted word for word between the model's opening and closing question; the model never sees a priced line and its text is checked for money talk (one redraft, then visible warnings). Editable in Settings → Offer.
* **Deployed 2026-11-10 to devcomm-os (approved):** 54 functions updated, `firestore.rules` released, `firestore.indexes.json` deployed (one extra index found in the project, not in the file, left in place — nothing deleted). Web app (hosting) not deployed.
* **Live on devcomm-os (approved by the owner):** control offer A updated (0 € de création, 49 € HT/mois, 24 mois) with an offer-neutral knowledge base; variants B (0 € + 29 € HT/mois, 36 mois), C (490 € HT + 29 € HT/mois, 12 mois), D (1 490 € HT + 15 € HT/mois sans engagement); experiment `exp_offers_2026_11` active; 139 DM drafts (A 39, B 31, C 31, D 38) and 96 old email drafts set aside. Drafts rewritten with the terms lines: see HANDOFF.
* **Verification:** four adversarial reviews (each FAIL → fixed, see ADR-021 amendments); final design = closed vocabulary shared with the prompt + model judge, on generation and on edits. Full offline suite 1 714 passed / 102 failed = exactly the known Firestore-dependent baseline (same files); typecheck ×2, lint. Judge probed live on Qwen (5/5 correct, incl. an injection attempt). Live result: 139 DM drafts (A 39, B 31, C 31, D 38), each with its variant's terms line exactly once, 0 warnings under the final check, 113 distinct closing questions.

## 🔄 Fresh start + live autonomous run (2026-11-10, ~20:45)
* Owner asked to wipe prospects/campaigns/messages and run the SDR for real. Backup + reset done (`reset-prospecting-data.mjs`); campaign "tatoueurs et barbiers indépendants, 10 grandes villes" launched with `launch-campaign.mjs --prefer-dm --max 15`: Google Places found 35, 15 saved and queued; research/drafting runs in the cloud task queue.
* Rehearsal on the owner's Instagram (`social:rehearse`) found and fixed: "Contacter" button (2026 UI), chat close, recipient check, identity from the sidebar picture link.

## 🧪 What the first live autonomous run found (2026-11-10, 21:00–22:45) — all fixed, tested, deployed
1. **Scorer never received the campaign** in `research-company.ts`: every company got the same 30/100 fit, prospects the research recommended at 85 were disqualified. Campaign now passed (keywords, cities, NAF, weights).
2. **Website search returned a map/directory page** (fr.mappy.com/poi…) as the prospect's site, then its listed emails (other businesses') became contacts and an email draft was written to them. `resolveCompanyWebsite` now applies `isUsableCompanyWebsite`; ~40 directories added to `THIRD_PARTY_PRESENCE_DOMAINS`. Affected drafts set aside.
3. **No site of their own scored as "good site"**: signals measured on the directory page stayed on the company. Scorer: listing-only → "Pas de site propre" (+ no own booking/e-commerce), no site at all → "Absence de site internet"; page signals ignored for them.
4. **Pipeline queued an email job with nobody to write to** (no email, no trusted profile) → failed job shown as an error. Now an `outreach.no_channel` info log (brain: writing agent).
5. **60 s task timeout < research time**: the timed-out research kept running while a retry redid and re-paid it. Heavy tasks 240 s; HTTP worker 300 s.
6. **Company registry matched 0 of 37** Google Places companies (display names like "… - Tatouage Paris"). Registered-name candidate + département + active only, accepted only at the same postcode AND carrying the name (legal/trade name or sign); 429 retried; 10 s timeout. 14/30 matched, no false match in review.
7. Campaign setting **"Prefer direct messages"** added (DM whenever a trusted profile exists).
* Verification: full offline suite 1 796 passed / 102 baseline failures (same files); new suites `tests/research/live-run-fixes.test.ts`, `registry-matching.test.ts`.

## 🎯 DM recipients (2026-11-10 evening — ADR-022)
* Live queue check before the first session found DMs addressed to platform/directory accounts (Fresha ×15, Kipik, Mappy, Flickr, a theatre, a blog…). `profile-trust.ts` + gate refusal + `repair-social-dm-recipients.mjs`: 110 DM drafts remain (A 34, B 21, C 25, D 30), all to trusted accounts; 29 set aside. Instagram queue 100+ / Facebook 57, all gate-allowed.
* `npm run social:rehearse` (no typing, no send, no record) added for the first live check on the owner's account. Live audit (read-only): no errors since deploy; campaigns paused since September (pipeline idle); 49 test workspaces in the live DB throttle the research share; `outreach(status, sentAt)` index added.
* Verification: full offline suite 1 759 passed / 102 baseline failures (same files); runner 321; typecheck ×2; lint.

## 🧠 Brain page (2026-11-10, owner request)
* `/app/brain` — live view of the 8 agents, KPIs, health and activity; now a **primary navigation item** (owner's request; UX Contract #1 updated). Data layer reviewed PASS (one log listener, equality counts every 60 s, callables every 120 s, paused when hidden, tenant-scoped). Visual layer being redesigned to match the app's light design system.
* **Current Branch:** `feat/autonomous-sdr-v2`

---

## 📊 Summary of What Changed in Phase 19 — Go-Live Readiness (2026-11-10)
Measured live on 2026-11-09: the SDR had never sent an email (Bloomy: 181 companies, 101 drafts, 0 sent). This phase removes what would have made the first real sends wrong or unsafe. No new channel, no new provider.

1. **Commercial terms are offer data.** `pricingGuardrails` gains `setupFee`, `monthlyPrice`, `commitmentMonths`, `taxLabel`, `approvedTerms`. `pricing-guardrail.ts` states them to the model and checks every draft (replies incl. subject, cold email incl. manual edits, DMs, contact forms). The old rule escalated every draft containing "gratuitement" — every honest statement of a free-setup offer.
2. **The check is advisory; autonomy is gated.** Four adversarial reviews showed no French pattern list is complete (21/46, then 52/60, then 19/20, then 17/30 misses on the detector or gate). So: the detector flags known misstatements for the reviewer; a broad vocabulary gate blocks autonomous reply dispatch and auto-approval for anything commercial. Lasting fix (Phase 21): unattended commercial text written by code.
3. **Replies are never marked sent unless delivered.** Pre-existing defect found in review: on all three reply paths replies were recorded as sent and cleared from the Inbox, but nothing delivered them. All paths now go through `deliverReply` (suppression first, then a `ReplyTransport`). None exists yet → autonomous replies go to a person; manual ones are "recorded, not sent — send from Unibox".
4. **No fallback business.** 37 `|| "biz_devcomm"` fallbacks removed (the id does not exist in the live workspace). Unattributed → no reply, no meeting, no outreach, no discovery, no research; suppression still applies; unattributed replies listed in every business's Inbox (`needsAttribution`). No "Devcomm" name, sender, Calendly or company text left as a default (static scan).
5. **Daily volume follows Settings and is enforced.** The daily limits never applied in production (query counters needing undeployed indexes; reused research docs dated from discovery day; unstamped docs). Replaced by an atomic per-business per-Paris-day counter (`dailyUsage`). Runner hourly 08–19, per-business backlog, ≤ 50 per pass, outreach budget, 6 h re-enqueue cooldown; limit hits are `deferred` back to the backlog instead of stranding companies.
6. **Cold outreach finds its offer.** It looked the campaign up in the wrong collection and validated every draft against no offer. Now discovery campaign → `company.offerId` → first offer.
7. **Real Bloomy offer seed** (0 € création, 49 € HT/mois, 24 mois, 1er mois à la commande — owner-confirmed 2026-11-10), proofs only from studio.bloomy.one and live client sites; invented case studies removed; `--dry-run` / `--plan` / `--offer`, never deletes.
8. **Settings no longer rewrites or invents offer data** (forced `fixed` + disclosure, 0 → 1 490 €, fused prohibited promises, "+40%" on every case study, fake prefilled proofs).

### Verified State (Phase 19)
* `npm run typecheck` ✅ · `npm run --prefix functions typecheck` ✅ · `npm run lint` ✅ (0 warnings) · `npm run build` ✅ · `npm run --prefix functions build` ✅
* **Tests were run OFFLINE** (`GOOGLE_CLOUD_PROJECT=demo-sdr-offline FIRESTORE_EMULATOR_HOST=127.0.0.1:9`) because on this machine the default ADC project is the production CRM (`bloomy-crm`) and the suite writes to Firestore; no Java, so no emulator. Offline baseline before the phase: 560 tests, 103 failing (all Firestore-dependent). After: 740 tests; failures = 100 baseline + 2 new tests in the Firestore-dependent `auto-reply-mode.test.ts` (same timeout signature as its 3 existing tests; the same logic is covered offline by `autonomous-gate.test.ts`). 0 other new failures; 3 previously failing calendar tests now pass.
* New tests: `functions/src/tests/reliability/go-live-readiness.test.ts` (165), `functions/src/tests/replies/autonomous-gate.test.ts` (4), `src/tests/offer-form.test.ts` (9).
* Adversarial review: FAIL, FAIL, FAIL, **PASS** (sdr-reviewer). Remaining findings are recorded as Phase 20 preconditions in HANDOFF.md.

---

## 📜 Previous Phase — Phase 18 — UX Simplification

---

### Summary of What Changed in Phase 18 — UX Simplification
Backend logic was **not** rewritten. This phase changed only how the user experiences the system.
Full audit: `docs/autonomous-sdr-v2/UX_SIMPLIFICATION.md`.

1. **New information architecture (4 primary surfaces):** `Home`, `Campaigns`, `Inbox`, `Meetings`, plus `Settings`. The previous 13-item / 5-group "STEP 1 → STEP 2 → STEP 3" pipeline navigation is gone.
2. **Home / Agent screen (`/app/home`, now the landing page):** one natural-language field ("What do you want meetings for?"), business + offer pickers, quick starts, and a live outcome roll-up. Replaces the metrics dashboard as the front door.
3. **Two-interaction campaign launch:** describe → confirm plain-language plan → `Start prospecting`. The campaign is written `status: "active"` with `autoQueueHighScoreCompanies: true` and its first run is triggered immediately, removing the manual Create → Run → Queue research → Run queue → Find contacts → Generate → Approve → Send → Sync chain from the normal flow.
4. **Campaign overview (`/app/campaigns/[campaignId]`):** headline counts, journey bars, best opportunities, and a human-readable SDR activity feed. `/app/campaigns` was previously a dead placeholder.
5. **Plain-language translation layer (`src/lib/sdr/`):** `activity-humanizer.ts` maps real backend log types to sentences and suppresses plumbing events; `opportunity-language.ts` maps `OpportunityScore` to "why this is an opportunity"; `inbox-filters.ts` maps conversation statuses/intents to Needs attention / Interested / AI handling / Booking.
6. **Aggregation layer (`src/lib/sdr/aggregations.ts`):** `getCampaignOverview`, `getCampaignFunnel`, `getHomeSummary`, `getAgentActivity`, `getAttentionRequired`, `getUpcomingMeetings`, `computeFunnel`. No business logic left in React components.
7. **Advanced section (`/app/advanced`):** Companies, Contacts, Research, Emails, Campaign builder, Imports, Analytics and System logs are **preserved and moved**, not deleted. The automation pause toggle and "Run research now" moved from the top bar into `Advanced → SDR engine`.
8. **Autonomy control:** new Settings tab exposing `Draft only / Assisted / Autonomous`, written to `business.automationPolicy.mode` — the value the reply dispatcher already reads.
9. **Settings grouped** into My business / SDR / Advanced (all 1507 lines of existing panels preserved).
10. **Responsive:** sidebar collapses below `md`, new bottom `MobileNav` keeps the four primary surfaces reachable on a phone.
11. **Adversarial review — FAIL then remediated.** A fresh reviewer found two blockers, both real: the SDR activity feed fell back to an **unscoped, unordered read of the whole `logs` collection** (no `workspaceId` was ever written by `writeLog`, and the required composite index was undeclared), and `TestModeBanner` rendered French developer jargon on every primary surface while falsely claiming the send-safety lock was active. Both are fixed, along with a non-monotonic funnel, a globally-windowed campaign query, unbounded navigation polling, a silently-swallowed launch failure, and the loss of meeting history. Re-review verdict after remediation: **PASS**. Full table in `UX_SIMPLIFICATION.md` §5.
12. **Bug fixed (blocking real data):** `conversations` had **no Firestore rule**, so the catch-all `allow read, write: if false` denied every client read and the SDR Inbox could not load against real rules. Added `match /conversations/{id}` with `allow read: if signedIn(); allow write: if false;` (writes remain server-only via callables — stricter than the existing `outreach` rule).

---

## 💸 AI Cost Work (2026-08-31, ADR-017 / 018)

**Measured spend to date: $0.75** — 309,779 input + 88,722 output tokens at Haiku 4.5 list. Not yet a cost problem, but the per-unit rate caps volume: the same pipeline at 500 companies/day is ~$200/month.

**Where the waste actually was** (not the model's price):
* **75% of the research block in every outreach prompt was the previous AI call echoed back.** `rawInput` (2,206 tok) + `rawOutput` (1,123 tok) of 4,454. The company document was 1,109 tokens where the writer uses ~108. Both pretty-printed, paying for indentation per company. Now stripped and compacted: **3,842 tokens saved per draft, ~32%**, no quality tradeoff.
* **49% of research runs failed on schema validation after being billed** (fixed the same day, ADR-016).
* **Prompt caching measured and rejected:** Haiku 4.5 needs a 4,096-token stable prefix; these system prompts are 524 and 317. No cache entry would ever be created. It only pays off on Sonnet 5, at 2x the token price.
* **`DEFAULT_ANTHROPIC_MODEL` was `claude-3-5-haiku-20241022`** — a 2024 model used silently by any deployment without an explicit setting. Now `claude-haiku-4-5`, with dated ids mapped forward.

**Qwen added as a selectable provider** (ADR-017). Model Studio serves an Anthropic-compatible Messages API, so `QwenProvider` is `AnthropicProvider` pointed at a different base URL — three parameters change, every prompt/parser/counter is shared. Qwen3.8-Flash lists at $0.16/$0.47 per M against Haiku 4.5's $1.00/$5.00. **It is not the default**, and Settings says so: the pricing and endpoint are verified against Alibaba's documentation, the French copy quality is not — only running both over the same prospects answers that.

---

## 🔬 Live-Run Remediation (2026-08-31, ADR-016)

The SDR ran unattended 28→31 August on a real campaign and produced nothing after day one: 116 companies then 0, 0, 0; 62 drafts then 0; $0.35 spend then $0 — while failing the same 21 jobs every day. Five defects, each independently able to stall the pipeline, all now fixed and pinned by `functions/src/tests/reliability/live-run-defects.test.ts` (21 tests):

1. **Discovery invented a search, then went silent.** Hardcoded `["fleuriste"]` / `["Nantes"]` fallbacks turned a nationwide brief into a one-city search that dried up in a day and reported "Created 0 leads" twelve runs running while still showing `active`. Now: the provider throws rather than substituting, areas rotate across runs, and four empty runs mark the campaign `areaExhausted` and say so.
2. **`company.website` was never validated.** Four of 78 held a Waze map, a `acceslibre.beta.gouv.fr` government listing, a 2015 blog post and a `google.com/search?q=mailto:` URL — auditing the wrong domain, and a live probe found two "submittable" contact forms on third-party domains, one a government service. Now gated by `isUsableCompanyWebsite()` at discovery and again in the form detector; a rejected URL is kept as `directoryUrl` because having no site of their own is the need being sold against.
3. **The contact-form channel was unreachable.** The running campaign carried `channels: undefined`, so 39 companies with a website and no email dead-lettered daily. Channels are now editable on a running campaign.
4. **Dead work was re-enqueued for ever.** The verdict now lives on the company (`outreachBlockedAt`), the daily runner skips it, and finding a contact clears it. The hardcoded `"biz_devcomm"` fallback is gone.
5. **Schema validation discarded paid-for work** — 49% of research runs lost to `too_big`. Model text is now bounded by truncation (`functions/src/utils/ai-schema.ts`); a missing score or empty email body is still refused, and an unrecognised recommendation falls back to `enrich_more`, never to "contact them".

**Not retro-fixed:** the four bad `website` values and the campaign's empty `cities` predate the gate and need a one-off correction on live data.

---

## 🧾 Correctness & Cost Remediation (2026-08-28, ADR-013 / 014 / 015)

**Autonomy appeared to reset after a deploy.** It had not: Firestore held `mode: "manual"` throughout. Three separate defects let the interface assert an autonomy level it had never read — `listBusinessesClient` turned any read error into `[]` (which the caller seeds hardcoded defaults over), the provider substituted two fabricated businesses on failure, and the Approvals page turned "business not loaded yet" into the sentence "your SDR sends without asking". All three are closed; an unreadable workspace now shows a banner saying so.

**Approvals is no longer gated on autonomy.** Autonomy governs email. The DM and contact-form channels always need a person, so gating hid drafts that were written and never seen.

**Firestore reads were the quota being blown, not Functions compute.** Measured on the live project: 101 reads/day (22–25 Aug) → 8,834 → 19,535 → **73,922** against a 50,000/day free allowance, while Functions ran at ~20% of its free tier. Cost was tracking browsing, not prospecting: the sidebar's draft badge re-read all 62 outreach documents on every navigation. Added a 30s read cache with in-flight de-duplication, moved the badge to a count aggregation, and narrowed the approvals list to `status == "draft"`.

**Added "Start over"** (Settings → Advanced): deletes a business's companies, contacts, drafts, conversations, meetings, campaigns and history, keeping offers, knowledge, sender, API keys and autonomy. The suppression list and spend history are never deleted. Requires retyping the business name. Also sweeps documents carrying no `businessId` — 5,747 of them exist — but only while the workspace has a single business.

---

## 📮 Channel Expansion — Contact Form (2026-08-28, ADR-012)
A prospect with no findable email used to reach the end of the pipeline as "no contact found" and be dropped, even when they published a contact form whose entire purpose is to invite contact. `contact_form` is now a third channel beside `email` and `social_dm`, off by default and switched on per campaign from the plan-review screen.

What it does: when no email is found, the pipeline detects the form (contact pages first — `/contact`, `/contactez-nous`, `/nous-contacter`, `/contact-us`, `/devis`), reuses the DM writer for the copy, and queues a normal draft for approval. Approving submits it; a CAPTCHA'd or JS-rendered form instead hands the reviewer a direct link and a ready-to-paste message.

What it refuses to do, in code rather than in configuration: a CAPTCHA is never solved or worked around, honeypot fields stay empty, one message per company ever, no send without a resolvable reply address, safe mode blocks submission outright, and the suppression list is checked by domain and SIREN first. `functions/src/tests/outreach/contact-form.test.ts` (11 tests) pins each refusal.

Also changed: `extractLinks` in `company-enrichment.ts` now prioritises `mentions-legales` before `contact` and `equipe` — French law (LCEN) requires contact details there, and footer links were being cut by the page cap. `markSocialDmSent` is channel-aware, so confirming a hand-sent form logs `outreach.contact_form.sent` and sets `contactFormSentAt` rather than claiming a DM was sent.

---

## 🔍 Verified State
* **Root Next.js Typecheck (`npm run typecheck`):** ✅ **PASS (0 errors)**
* **Backend Functions Typecheck (`npm run --prefix functions typecheck`):** ✅ **PASS (0 errors)**
* **Root Production Build (`npm run build`):** ✅ **PASS (24 routes compiled)**
* **Backend Functions Build (`npm run --prefix functions build`):** ✅ **PASS**
* **ESLint (`npm run lint`):** ✅ **PASS (0 errors, 0 warnings)**
* **Root Test Suite (`npm test`):** ✅ **PASS (110 test files, 396 passed tests)**
* **Functions Test Suite (`npm run --prefix functions test`):** ✅ **PASS (75 test files, 266 passed tests)**
* **Total Combined Automated Tests:** ✅ **662 tests passing across 185 test files (100% PASS RATE)**
* **New UX tests:** `src/tests/ux-simplification.test.ts` — 49 tests covering the humanizer (including a completeness check that all 70 emitted log types are either translated or deliberately hidden), opportunity language, funnel monotonicity, meeting grouping, inbox filters, campaign launch genericity, IA guarantees, the conversations rule, and 13 regressions pinning the adversarial review findings across both review passes.
* **Master Acceptance Matrix:** **All 80 Requirements (REQ-001 through REQ-080) remain PASS.**

### Re-verified 2026-08-31 (AI cost & Qwen — ADR-017/018)
* `npm run typecheck` ✅ · `npm run --prefix functions typecheck` ✅ · `npm run lint` ✅ · both builds ✅
* Full suite: **483 / 484 passed (119 files)**; the one failure is the known `migration.test.ts` live-Firestore contention flake, which passes alone in 4.45s.
* New: `functions/src/tests/reliability/qwen-provider.test.ts` (10 tests) pinning endpoint construction including the documented `/v1/v1/` 404 trap, that a Qwen model id is never rewritten by Claude's alias table, and that Qwen spend is priced at Qwen rates rather than Claude's. `functions/src/tests/reliability/prompt-payload.test.ts` (6 tests) pinning that raw payloads never re-enter a prompt while grounding facts still do.

### Re-verified 2026-08-31 (live-run remediation — ADR-016)
* `npm run typecheck` ✅ · `npm run --prefix functions typecheck` ✅ · `npm run lint` ✅ (0 warnings) · `npm run build` ✅ · `npm run --prefix functions build` ✅
* Full suite: **468 / 468 passed (117 files)** — a completely clean run, no flakes.
* New: `functions/src/tests/reliability/live-run-defects.test.ts` (21 tests) using the exact URLs and payload shapes the live run produced.

### Re-verified 2026-08-28 (correctness, cost & purge — ADR-013/014/015)
* `npm run typecheck` ✅ · `npm run --prefix functions typecheck` ✅ · `npm run lint` ✅ (0 warnings) · `npm run build` ✅ (24 routes) · `npm run --prefix functions build` ✅
* Full suite: **446 / 447 passed (116 files)**. The one failure is the known `migration.test.ts` live-Firestore contention flake (passes alone in 3.85s). A first run of the same suite showed 5 failures, all the same 5s-timeout class against live Firestore, all passing on re-run — these suites share one live project, so parallel load, not the code, decides them.
* New: `src/tests/read-cost.test.ts` (13 tests) pins read de-duplication, failure eviction, prefix invalidation, the narrowed draft queries, the declared composite index, and the three "never infer autonomy from missing data" guarantees. `functions/src/tests/reliability/purge-business-data.test.ts` (7 tests) pins the purge exclusions.

### Re-verified 2026-08-28 (contact-form channel, ADR-012)
* `npm run typecheck` ✅ · `npm run --prefix functions typecheck` ✅ · `npm run lint` ✅ (0 warnings) · `npm run build` ✅ (24 routes) · `npm run --prefix functions build` ✅
* Root suite: **426 / 427 passed (114 files)**. Functions suite: **296 / 297 passed (79 files)**.
* The one failure in each run is `functions/src/tests/migration.test.ts`, which exercises live Firestore and times out at 5s under parallel load; it passes in isolation in 3.85s. Known contention flake, unrelated to this change — see the same note in earlier phases.
* New: `functions/src/tests/outreach/contact-form.test.ts` — 11 tests pinning the channel's refusals (CAPTCHA never worked around, honeypot never filled, framework token echoed, unrecognised field never invented, unusable form never guessed at, email always retained in `resolveChannels`).
* `src/tests/ux-simplification.test.ts` still passes at 54 tests, including the guard that every log type the backend emits is either translated or deliberately hidden — which is what forced `outreach.contact_form.drafted` and `outreach.contact_form.sent` into `activity-humanizer.ts`.

---

## 🚧 Blockers (go-live)
* **Cold sending uses Instantly API v1**, deprecated by Instantly on 2026-01-19 (`providers/email/instantly-provider.ts` → `api.instantly.ai/api/v1`). Verify against current docs; migrate in Phase 20.
* **No reply can be delivered** from the SDR (no `ReplyTransport`). Replies must be sent from Instantly Unibox until Phase 20.
* ~~Live data still carries the old offer~~ — done 2026-11-10 (offer A reseeded, A/B variants live, old drafts set aside).

---

## 🎯 Next Exact Action
* **Owner, DMs (ready now):** `npm run social:send -- --business biz_bloomy --network instagram --max 1` for the first real send (one Enter per message), then without `--max`. Optional first: `npm run social:rehearse -- --business biz_bloomy --network instagram --type-to <a safe account>` (types, reads back, clears; never presses Enter).
* **Owner, email (not ready):** set Bloomy's own booking link and sender, warm sending domains; email sending itself is Phase 20.
* **Owner decision:** `dailyAiResearchLimit` is 50/day and was reached on day 2 (17 companies deferred to the next day).
* **Engineering:** Phase 20 — Sending Path (one phase, fresh session).

### Earlier next actions (Phase 18, superseded)
* **Deploy `submitContactFormCallable`** — the channel is complete and verified locally, but the callable is not yet on Firebase, so the approvals card's send button will fail until `firebase deploy --only functions:submitContactFormCallable` runs.
* Then: run the channel once against a real prospect with a plain HTML form and confirm the submission actually arrives, since a 2xx from an unknown form handler is evidence of acceptance, not of delivery.
* After that: Operational Readiness & Deployment, or a first-run onboarding flow (create business → connect calendar → connect sender) which is currently reachable only through Settings.

