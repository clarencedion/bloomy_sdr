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
