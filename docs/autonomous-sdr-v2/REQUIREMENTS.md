# Autonomous SDR V2 — Master Requirement Registry

This registry captures all functional, non-functional, security, compliance, and architectural requirements for the Autonomous SDR V2 platform.

---

## 🏢 Category 1: Multi-Business & Tenancy Architecture (REQ-001 to REQ-010)

| Requirement ID | Title | Description | Phase |
| :--- | :--- | :--- | :---: |
| **REQ-001** | Multi-Business Workspaces | The platform must support multiple independent `Business` entities within a `Workspace`, isolating contacts, campaigns, knowledge bases, and calendars. | Phase 02 |
| **REQ-002** | Multiple Offers per Business | A `Business` must be able to define multiple distinct `Offer` records (e.g. Website Redesign vs. E-Commerce Development vs. SEO Audit). | Phase 02 |
| **REQ-003** | Campaigns Inherit Offers | Each `Campaign` must attach to a specific `Offer`, inheriting target personas, value propositions, and proof points. | Phase 02 |
| **REQ-004** | Offer-Agnostic Core Engine | Generic SDR engine code must not contain hardcoded business names, offer types, or industry branching (`if (business === "Bloomy")` is forbidden). | Phase 02 |
| **REQ-005** | Isolated Sender Configuration | Each `Business` must configure and isolate its own sending domains, mailbox identities, and Instantly campaign workspaces. | Phase 02 |
| **REQ-006** | Isolated Calendar Credentials | Each `Business` must maintain its own calendar credentials (Microsoft Graph OAuth, Google Calendar, Cal.com) without cross-business leakage. | Phase 02 |
| **REQ-007** | Isolated Knowledge Bases | Each `Business` must maintain its own knowledge base (services, case studies, pricing guardrails, FAQs, prohibited promises). | Phase 02 |
| **REQ-008** | Legacy Data Migration | Existing database records from the single-tenant model must be backfilled to a default workspace/business without data loss. | Phase 02 |
| **REQ-009** | Workspace Security Scoping | Firestore security rules must enforce that authenticated users can only query data within their authorized workspace. | Phase 01 |
| **REQ-010** | Multi-Business Switcher UI | The user interface must provide a clean workspace and business switcher allowing operators to switch contexts seamlessly. | Phase 02 |

---

## 🎯 Category 2: Campaign Formulation & ICP Intelligence (REQ-011 to REQ-018)

| Requirement ID | Title | Description | Phase |
| :--- | :--- | :--- | :---: |
| **REQ-011** | Natural Language Campaign Builder | An operator can formulate an outbound campaign using natural language (e.g. *"Find French florists with weak digital presence"*). | Phase 03 |
| **REQ-012** | Structured ICP Translation | An LLM translation engine translates the prompt into structured targeting (NAF codes, keywords, negative keywords, geography, scale). | Phase 03 |
| **REQ-013** | Dynamic Signal Strategy Selection | The campaign builder automatically selects which `SignalProvider` modules are relevant based on the offer and prompt. | Phase 03 |
| **REQ-014** | Pre-Launch Campaign Review | Operators can inspect, fine-tune, and edit AI-generated campaign targeting parameters before activation. | Phase 03 |
| **REQ-015** | Manual Advanced Targeting Override | Advanced manual filtering (specific NAF arrays, exact department codes, minimum employee count, required website) remains available. | Phase 03 |
| **REQ-016** | Discovery Provider Prioritization | Campaigns allow configuring discovery provider priority order (e.g. Recherche d'Entreprises → Google Places → Pappers). | Phase 03 |
| **REQ-017** | State-Tracked Pagination Cursors | Discovery runs must maintain persistent pagination cursors to prevent re-querying previously ingested pages. | Phase 03 |
| **REQ-018** | Campaign Lifecycle Controls | Operators can pause, resume, edit, or archive campaigns at any time, instantly halting background workers. | Phase 03 |

---

## 🔎 Category 3: Pluggable Signals & Evidence Engine (REQ-019 to REQ-028)

| Requirement ID | Title | Description | Phase |
| :--- | :--- | :--- | :---: |
| **REQ-019** | Generic Signal Provider Interface | All signal modules must implement a standardized TypeScript `SignalProvider` interface (`supports`, `collect`, `costEstimate`). | Phase 04 |
| **REQ-020** | Pluggable Signal Registry | Signal providers register into a central registry where campaigns can dynamically request signal execution. | Phase 04 |
| **REQ-021** | Evidence Provenance Storage | All collected signals are stored as immutable `EvidenceItem` records with source type, source URL, timestamp, and confidence score. | Phase 04 |
| **REQ-022** | Fact vs. Inference Barrier | Every `EvidenceItem` must be explicitly tagged as `fact`, `derived_metric`, or `ai_interpretation` (`FACT != INFERENCE`). | Phase 04 |
| **REQ-023** | Signal Caching & Freshness | Expensive signals (PageSpeed, full crawls) are cached at domain level with configurable expiration (e.g. 30 days). | Phase 04 |
| **REQ-024** | Signal Cost Tracking | Every signal collection execution records estimated API token/credit costs onto the evidence document. | Phase 04 |
| **REQ-025** | Failure Resilient Signal Pipeline | If an individual signal provider fails (e.g. 429 or timeout), other providers complete and the failure is logged gracefully. | Phase 04 |
| **REQ-026** | Universal Registry Provider | `company_registry` signal provider extracts legal name, SIREN, NAF, employee tranche, and headquarters address from public API. | Phase 04 |
| **REQ-027** | Google Places Signal Provider | `google_places` signal provider extracts rating, review count, business category, and operational status. | Phase 04 |
| **REQ-028** | Evidence Inspector UI | Operators can inspect all collected evidence items and raw source payloads from the Company Detail view. | Phase 04 |

---

## 🌐 Category 4: Website Opportunity Module (REQ-029 to REQ-036)

| Requirement ID | Title | Description | Phase |
| :--- | :--- | :--- | :---: |
| **REQ-029** | Anti-Annuaire Website Resolver | Resolves missing company websites via SIREN/search while filtering out 60+ directory/social domains. | Phase 05 |
| **REQ-030** | Website Presence & SSL Audit | Detects absence of website, domain reachability, HTTPS certificate validity, and redirects to social media. | Phase 05 |
| **REQ-031** | PageSpeed & Core Web Vitals Audit | Audits mobile/desktop PageSpeed score (0-100), LCP, and FCP via Google PageSpeed Insights REST API. | Phase 05 |
| **REQ-032** | Mobile UX & Responsiveness Check | Detects mobile viewport meta tag, responsive container structure, and mobile layout issues. | Phase 05 |
| **REQ-033** | CMS & Technology Detection | Detects underlying CMS/platform (WordPress, Wix, Shopify, PrestaShop, Squarespace, custom/none). | Phase 05 |
| **REQ-034** | E-Commerce & Ordering Audit | Detects presence or absence of online ordering, cart buttons, checkout scripts, and delivery options. | Phase 05 |
| **REQ-035** | Booking Widget Detection | Detects presence or absence of online reservation/booking widgets (Calendly, Doctolib, Planity, Zenfirst). | Phase 05 |
| **REQ-036** | Outdated Technical Signals | Detects legacy HTML tables, old copyright years (e.g. `© 2017`), broken internal links, and missing meta tags. | Phase 05 |

---

## 📊 Category 5: Opportunity Scoring & Lead Qualification (REQ-037 to REQ-042)

| Requirement ID | Title | Description | Phase |
| :--- | :--- | :--- | :---: |
| **REQ-037** | Multi-Factor Scoring Engine | Evaluates Company Fit, Need Strength, Commercial Scale, and Evidence Confidence into an `OpportunityScore` (0-100). | Phase 06 |
| **REQ-038** | Offer-Driven Scoring Weights | Scoring weights are parameterized by the Campaign's Offer strategy, not hardcoded into generic evaluation services. | Phase 06 |
| **REQ-039** | Four-Tier Qualification States | Leads are classified into `DISQUALIFIED`, `NEEDS_MORE_EVIDENCE`, `QUALIFIED`, or `HIGH_PRIORITY`. | Phase 06 |
| **REQ-040** | Cost-Saving Pre-Enrichment Gate | Disqualified leads (`overallScore < threshold`) are skipped before triggering paid contact enrichment (Dropcontact). | Phase 06 |
| **REQ-041** | Automated Need & Angle Synthesis | Synthesizes verified evidence into `detectedNeeds[]`, `buyingTriggers[]`, and `recommendedAngle`. | Phase 06 |
| **REQ-042** | Opportunity Score Explainability | The UI displays an interactive score breakdown explaining exactly why a lead scored high or low. | Phase 06 |

---

## 👥 Category 6: Contact Discovery & Persona Ranking (REQ-043 to REQ-048)

| Requirement ID | Title | Description | Phase |
| :--- | :--- | :--- | :---: |
| **REQ-043** | Offer Persona Priority Ranking | Prioritizes decision makers based on Offer configuration (e.g. Small business: Owner/Founder; Enterprise: Sales Director). | Phase 07 |
| **REQ-044** | Negative Role Filtering | Excludes accounting, legal, intern, auditor, and assistant roles from decision-maker outreach. | Phase 07 |
| **REQ-045** | Dropcontact Enrichment Client | Queries Dropcontact API batch endpoint with SIREN/domain and polls asynchronously for verified contacts. | Phase 07 |
| **REQ-046** | Website Crawler Contact Extraction | Crawls website subpages (/contact, /equipe) to extract published emails, phones, and team names. | Phase 07 |
| **REQ-047** | Multi-Provider Contact Waterfall | Supports cascading contact search (Website → Dropcontact → Secondary Provider → Unresolved). | Phase 07 |
| **REQ-048** | Strict Email Verification Gate | Flags contacts with verification qualification (`verified` vs `guessed` vs `uncertain`), preventing blind sending to unverified emails. | Phase 07 |

---

## ✍️ Category 7: Evidence-Grounded Copywriting & Proposals (REQ-049 to REQ-056)

| Requirement ID | Title | Description | Phase |
| :--- | :--- | :--- | :---: |
| **REQ-049** | Evidence-Grounded Copywriting | Injects verified `EvidenceItem[]` into the copywriting prompt, forbidding unsubstantiated claims. | Phase 08 |
| **REQ-050** | Factual Claim Validator Pass | A second validation pass (`validateOutreachClaims`) verifies that every specific claim maps to a high-confidence evidence item. | Phase 08 |
| **REQ-051** | Multi-Touch Sequence Generation | Generates Initial Email, Follow-Up 1, Follow-Up 2, and LinkedIn connection notes in a single coherent flow. | Phase 08 |
| **REQ-052** | French Copywriting Guardrails | Enforces punchy copy (80–140 words), conversational French tone, single diagnostic CTA, and zero AI fluff. | Phase 08 |
| **REQ-053** | Soft Opt-Out Sentence | Enforces mandatory polite unsubscribe sentence in all generated cold email copy. | Phase 08 |
| **REQ-054** | Dynamic PDF Proposal Generator | Generates branded multi-page diagnostic proposal PDFs using PDFKit, injecting offer branding and specific audit findings. | Phase 08 |
| **REQ-055** | Outreach Draft Review Workspace | Operators can review, edit, approve, regenerate, or reject generated drafts in `/app/outreach`. | Phase 08 |
| **REQ-056** | Risk Warning Indicators | Drafts flag potential risks (e.g. thin website evidence, ambiguous contact role) with visible UI badges. | Phase 08 |

---

## 🚀 Category 8: Outbound Dispatch, Instantly V2 & Webhooks (REQ-057 to REQ-062)

| Requirement ID | Title | Description | Phase |
| :--- | :--- | :--- | :---: |
| **REQ-057** | Mandatory canContact Gatekeeper | Every outbound email dispatch must pass server-side suppression, bounce, unsubscribe, and daily limit checks. | Phase 09 |
| **REQ-058** | Instantly.ai V2 Sequence Dispatch | Pushes approved leads and custom template variables into Instantly.ai campaigns via REST API. | Phase 09 |
| **REQ-059** | Inbound Reply Webhook Receiver | Ingests real-time inbound reply webhooks from Instantly, extracting full email text, headers, and sender data. | Phase 09 |
| **REQ-060** | HMAC Webhook Signature Verification | Verifies cryptographic HMAC signatures on all inbound webhooks before processing payloads. | Phase 09 |
| **REQ-061** | Inbound Event Idempotency | Deduplicates incoming webhook events using provider delivery IDs, preventing double-processing. | Phase 09 |
| **REQ-062** | Persistent Conversation Model | Maintains full multi-message thread history (`conversations` and `messages` collections) in Firestore. | Phase 09 |

---

## 🧠 Category 9: Reply Intelligence & Autonomous Responses (REQ-063 to REQ-070)

| Requirement ID | Title | Description | Phase |
| :--- | :--- | :--- | :---: |
| **REQ-063** | Inbound Reply Intent Classifier | Classifies replies into `POSITIVE`, `BOOKING_REQUEST`, `QUESTION`, `OBJECTION`, `UNSUBSCRIBE`, `OOO`, `WRONG_PERSON`, `ANGRY`. | Phase 10 |
| **REQ-064** | Fine-Grained Objection Classifier | Identifies specific objection types (`PRICE`, `EXISTING_PROVIDER`, `NO_BUDGET`, `NOT_PRIORITY`, `BAD_TIMING`, `NO_TIME`). | Phase 10 |
| **REQ-065** | Deterministic Unsubscribe Action | If a reply is classified as `UNSUBSCRIBE`, the prospect is immediately added to `suppressionList` without LLM delay. | Phase 10 |
| **REQ-066** | KnowledgeBase Grounded Response Engine | Drafts replies to questions and objections grounded strictly in Business `KnowledgeBase` facts and proof points. | Phase 11 |
| **REQ-067** | Zero-Hallucination Pricing Guardrail | The AI must never invent pricing or discounts outside explicit `pricingGuardrails`. | Phase 11 |
| **REQ-068** | Autonomous Safe Auto-Reply | Under `AUTONOMOUS_SAFE` mode, verified safe answers to questions/objections auto-send within 15 minutes. | Phase 11 |
| **REQ-069** | Human Escalation Routing | Low confidence (< 0.80), legal risks, hostility, or unmapped inquiries immediately pause sequences and alert human reps. | Phase 11 |
| **REQ-070** | SDR Inbox & Conversation Thread UI | Dedicated inbox view allowing operators to view threads, inspect AI classification, edit drafts, and take manual action. | Phase 13 |

---

## 📅 Category 10: Conversational Booking & Calendar Sync (REQ-071 to REQ-076)

| Requirement ID | Title | Description | Phase |
| :--- | :--- | :--- | :---: |
| **REQ-071** | Real-Time Calendar Free/Busy Query | Queries Microsoft Graph / Google Calendar for real-time busy windows within configured working hours. | Phase 12 |
| **REQ-072** | Conversational Slot Parser | Understands natural language scheduling preferences (e.g. *"Thursday afternoon"*, *"Friday at 10am"*, *"Next Tuesday"*). | Phase 12 |
| **REQ-073** | Conflict-Free Slot Proposer | Proposes 2–3 concrete open time slots matching prospect preferences based on verified calendar truth. | Phase 12 |
| **REQ-074** | Atomic Meeting Creation & Invite | Creates calendar event, dispatches calendar invite to prospect, and stores `meetings` document atomically. | Phase 12 |
| **REQ-075** | Automatic Sequence Termination | When a meeting is booked, all ongoing outbound sequence steps for that prospect in Instantly are terminated instantly. | Phase 12 |
| **REQ-076** | Microsoft Graph Hourly Sync Fallback | Retains hourly background sync to catch meetings booked directly outside conversational chat. | Phase 12 |

---

## 📈 Category 11: Analytics, Performance Learning & Reliability (REQ-077 to REQ-080)

| Requirement ID | Title | Description | Phase |
| :--- | :--- | :--- | :---: |
| **REQ-077** | Full-Funnel Conversion Analytics | Tracks metrics from Discovered → Qualified → Contacted → Replied → Positive Reply → Booked Meeting. | Phase 14 |
| **REQ-078** | Dimension Performance Breakdown | Analyzes conversion rates across Businesses, Offers, Campaigns, NAF codes, Personas, Signal types, and Angle variants. | Phase 14 |
| **REQ-079** | Closed-Loop Learning Recommendations | Recommends high-converting signals and angles to prioritize in future campaign discovery runs. | Phase 14 |
| **REQ-080** | Cloud Task Queue Decoupling | Long-running multi-step operations (Discovery batches, Signal collection) are executed via asynchronous retry-safe queues. | Phase 15 |
