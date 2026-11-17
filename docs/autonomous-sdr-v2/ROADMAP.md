# Autonomous SDR V2 — Implementation Roadmap (Phases 00 to 17)

This roadmap outlines the 18 sequential engineering phases to transform `devcomm_os` into a production-grade multi-business autonomous SDR platform.

---

## 🗺️ Phase Overview

```text
Foundation & Safety
  ├── Phase 00 — Baseline and Safety
  ├── Phase 01 — Security and Compliance
  └── Phase 02 — Multi-Business Foundation

Campaign & Signal Engine
  ├── Phase 03 — Natural-Language Campaign Builder
  ├── Phase 04 — Generic Signal & Evidence Engine
  ├── Phase 05 — Website Opportunity Module (Bloomy Focus)
  ├── Phase 06 — Opportunity Scoring & Qualification
  └── Phase 07 — Contact Discovery & Persona Ranking

Outreach & Delivery
  ├── Phase 08 — Evidence-Grounded Outreach & PDF Proposals
  └── Phase 09 — Instantly V2, Webhooks & Conversation Model

Intelligence & Booking
  ├── Phase 10 — Inbound Reply Intelligence & Objection Classifier
  ├── Phase 11 — Autonomous Reply Engine & Knowledge Grounding
  ├── Phase 12 — Conversational Booking & Real Calendar Sync
  └── Phase 13 — Human SDR Inbox & Agent Activity UI

Scale, Learning & Validation
  ├── Phase 14 — Full-Funnel Analytics & Closed-Loop Learning
  ├── Phase 15 — Cloud Task Queues, Reliability & Cost Control
  ├── Phase 16 — Multi-Business Dual-Fixture Validation
  └── Phase 17 — Final Adversarial Security & Invariant Audit
```

---

## 📋 Phase Breakdown & Objectives

### Phase 00 — Baseline and Safety
* **Goal:** Document baseline git state, test suites, typechecks, linter warnings, and build traces before making any code modifications.
* **Key Artifact:** `docs/autonomous-sdr-v2/phases/00-baseline-and-safety.md`

### Phase 01 — Security and Compliance
* **Goal:** Lock down Firestore security rules (block client read access to secret documents), establish `canContact(...)` gatekeeper, and add HMAC webhook verification.
* **Key Artifact:** `docs/autonomous-sdr-v2/phases/01-security-and-compliance.md`

### Phase 02 — Multi-Business Foundation
* **Goal:** Implement generic `Workspace`, `Business`, and `Offer` data entities, isolating knowledge, sender identities, and calendars. Backfill existing records.
* **Key Artifact:** `docs/autonomous-sdr-v2/phases/02-multi-business-foundation.md`

### Phase 03 — Natural-Language Campaign Builder
* **Goal:** Build natural language campaign formulation modal, LLM ICP translator, dynamic signal selection, and persistent pagination cursors.
* **Key Artifact:** `docs/autonomous-sdr-v2/phases/03-natural-language-campaign-builder.md`

### Phase 04 — Generic Signal & Evidence Engine
* **Goal:** Build the pluggable `SignalProvider` registry, `EvidenceItem` store with provenance tracking (`fact` vs `inference`), caching, and cost metadata.
* **Key Artifact:** `docs/autonomous-sdr-v2/phases/04-generic-signal-and-evidence-engine.md`

### Phase 05 — Website Opportunity Module
* **Goal:** Build the website technical signal provider: Google PageSpeed API, CMS detection, mobile responsiveness, SSL check, and e-commerce/booking audits.
* **Key Artifact:** `docs/autonomous-sdr-v2/phases/05-website-opportunity-module.md`

### Phase 06 — Opportunity Scoring & Qualification
* **Goal:** Implement the multi-factor scoring engine (Company Fit, Need Strength, Scale, Confidence), offer-driven weights, and pre-enrichment cost-saving gates.
* **Key Artifact:** `docs/autonomous-sdr-v2/phases/06-opportunity-scoring.md`

### Phase 07 — Contact Discovery & Persona Ranking
* **Goal:** Implement persona ranking engine (prioritizing roles per Offer), Dropcontact client, website crawler, and strict email verification gates.
* **Key Artifact:** `docs/autonomous-sdr-v2/phases/07-contact-discovery-and-persona-ranking.md`

### Phase 08 — Evidence-Grounded Outreach & PDF Proposals
* **Goal:** Ingest `EvidenceItem[]` into French cold copywriter, implement `validateOutreachClaims` pass, generate follow-ups, and render branded PDF proposals.
* **Key Artifact:** `docs/autonomous-sdr-v2/phases/08-evidence-grounded-outreach.md`

### Phase 09 — Instantly V2, Webhooks & Conversation Model
* **Goal:** Dispatch approved leads to Instantly.ai, build inbound reply webhook receiver with HMAC signature check, and store multi-message `conversations`.
* **Key Artifact:** `docs/autonomous-sdr-v2/phases/09-instantly-v2-and-conversations.md`

### Phase 10 — Inbound Reply Intelligence & Objection Classifier
* **Goal:** Ingest incoming reply email text, classify intent (`POSITIVE`, `QUESTION`, `OBJECTION`, `UNSUBSCRIBE`, `OOO`), and execute deterministic unsubscribes.
* **Key Artifact:** `docs/autonomous-sdr-v2/phases/10-reply-intelligence.md`

### Phase 11 — Autonomous Reply Engine & Knowledge Grounding
* **Goal:** Build grounded response generator citing `KnowledgeBase` facts, enforce pricing guardrails, and implement autonomous safe auto-reply + human escalation.
* **Key Artifact:** `docs/autonomous-sdr-v2/phases/11-autonomous-reply-engine.md`

### Phase 12 — Conversational Booking & Real Calendar Sync
* **Goal:** Query Microsoft Graph / Google Calendar for real free/busy slots, parse conversational scheduling intent, propose slots, and atomically book meetings.
* **Key Artifact:** `docs/autonomous-sdr-v2/phases/12-conversational-booking.md`

### Phase 13 — Human SDR Inbox & Agent Activity UI
* **Goal:** Build dedicated human SDR Inbox view with conversation threads, intent badges, draft responses, and one-click manual actions.
* **Key Artifact:** `docs/autonomous-sdr-v2/phases/13-sdr-inbox-and-agent-activity.md`

### Phase 14 — Full-Funnel Analytics & Closed-Loop Learning
* **Goal:** Build conversion funnel analytics and closed-loop learning engine that recommends top-performing signals and angles for future campaigns.
* **Key Artifact:** `docs/autonomous-sdr-v2/phases/14-analytics-and-experiments.md`

### Phase 15 — Cloud Task Queues, Reliability & Cost Control
* **Goal:** Decouple heavy synchronous cron loops into asynchronous Cloud Task queues with automatic exponential backoff retries and cost tracking.
* **Key Artifact:** `docs/autonomous-sdr-v2/phases/15-queues-reliability-and-cost-control.md`

### Phase 16 — Multi-Business Dual-Fixture Validation
* **Goal:** Execute two complete E2E campaign simulations: Fixture A (Bloomy Website Agency selling to Florists) and Fixture B (Devcomm B2B Consulting selling to Corporate SMEs) without changing generic SDR code.
* **Key Artifact:** `docs/autonomous-sdr-v2/phases/16-multi-business-validation.md`

### Phase 17 — Final Adversarial Security & Invariant Audit
* **Goal:** Run comprehensive adversarial test suite: prompt injection attacks, secret leakage attempts, cross-tenant isolation tests, suppression bypass checks, and hallucinated slot checks.
* **Key Artifact:** `docs/autonomous-sdr-v2/phases/17-final-adversarial-audit.md`

---

## 🚀 Post-Launch Phases (19 → 24) — from "built" to "selling"

Added 2026-11-10. Phases 00–18 built the engine; it had never sent an email. These phases close the loop from first email to paid subscription, one bounded phase per session. Phases 22 and 24 live in companion repositories, not in this one.

### Phase 19 — Go-Live Readiness ✅
* **Goal:** Offer-aware pricing guardrail on replies and cold outreach; no hardcoded business fallback; daily volume driven by Settings and actually enforced; the first business's real offer seeded with verifiable proofs only.
* **Key Artifact:** `docs/autonomous-sdr-v2/phases/19-go-live-readiness.md`

### Phase 20 — Sending Path (next — go-live blocker)
* **Goal:** Make sending real. (1) Migrate `InstantlyProvider` from API v1 (deprecated by Instantly on 2026-01-19; the client still calls `api.instantly.ai/api/v1` with the key in the query string) to API v2 (Bearer key, new paths), with its Mock companion. (2) Implement a `ReplyTransport` (Instantly v2 reply endpoint) so `deliverReply` can actually deliver; today it returns `no_transport` and every reply is "recorded, not sent". (3) A dry run on an allowlisted address end to end: cold email out, reply in via webhook, reply out.
* **Provider docs to verify first:** Instantly API v2 (leads, campaigns, reply/email send, webhooks and their signature).

### Phase 21 — Closing Actions
* **Goal:** Offer-level action links (checkout, booking, intake brief) and the offer summary inserted by code — never written by the model — into replies according to the classified intent. This is what lets commercial terms reach a prospect unattended (ADR-019: the model's own commercial wording always goes to a person). A payment provider adapter (`PaymentProvider` + `MockPaymentProvider`) creates a per-prospect checkout link carrying a reference to the conversation; an HMAC-verified, idempotent webhook marks the opportunity won and stops sequences. Generic: an offer without a checkout simply never offers one.
* **Provider docs to verify first:** Stripe Payment Links / Checkout Sessions (`client_reference_id`, `consent_collection.terms_of_service`, SEPA Direct Debit), webhook signature verification.

### Phase 22 — Client Handoff (companion repo `bloomy-crm`)
* **Goal:** On payment, create the client, project and intake portal automatically; send the welcome email; trade-adapted portal (today florist-only); hash the client's requested admin password; reminders when the portal is not completed.

### Phase 23 — Social DM Sessions (Instagram + Facebook, browser agent, one-key send) ✅ (2026-11-10)
* **Goal:** A local Playwright runner drives the business's own logged-in Instagram and Facebook in a visible browser: opens each prospect, opens the conversation, types the Qwen-written message; the person presses one key to send and the agent moves on. Stops on any checkpoint, CAPTCHA or "action blocked". Daily cap and spacing per network; sends recorded in the funnel. Requested by the owner on 2026-11-10 to replace a ChatGPT-in-Chrome routine.
* **Key Artifact:** `docs/autonomous-sdr-v2/phases/23-social-dm-sessions.md`
* **Never built:** unattended sending, stealth/fingerprint plugins, proxies, CAPTCHA or checkpoint solving, multiple accounts to multiply volume.

### Phase 24 — Prospect Previews (companion platform repo)
* **Goal:** A private, noindex preview site per prospect, built from public facts and the trade template, linked from the first email. Requires a multi-tenant site platform (one app, many domains) — Firebase Hosting caps multisite at 36 sites per project.
