# Target System Architecture

This document describes the high-level target architecture for **Autonomous SDR V2**, including layered component boundaries, service contracts, data pipelines, and sequence flows.

---

## 🏗️ Layered Architecture Diagram

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   PRESENTATION LAYER                                   │
│                        Next.js 15 App Router + React 19 + Tailwind UI                  │
│                                                                                        │
│  • SDR Inbox & Threads View          • Natural-Language Campaign Builder Modal         │
│  • Multi-Business Switcher           • Signal & Evidence Inspector                     │
│  • Outreach Review & Approval        • Calendar & Meeting Manager                      │
│  • Funnel Analytics & Experiments    • Human Escalation Queue                          │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ HTTPS Callable / Realtime Subscriptions
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              APPLICATION / ORCHESTRATION LAYER                         │
│                           Firebase Cloud Functions v2 (Node 22)                        │
│                                                                                        │
│  • Campaign Orchestrator             • Signal Collection Coordinator                   │
│  • Opportunity Qualification Engine  • Outreach Generation & Claim Validator           │
│  • Inbound Reply Webhook Receiver    • Reply Intent Classifier & Router                │
│  • Conversational Booking Engine     • Scheduled Cron & Cloud Task Queue Workers       │
└─────────────────────┬───────────────────────────────────────────────┬──────────────────┘
                      │                                               │
                      ▼                                               ▼
┌──────────────────────────────────────────────┐ ┌────────────────────────────────────────┐
│             DOMAIN SERVICES LAYER            │ │        SIGNAL PROVIDERS SUBSYSTEM      │
│                                              │ │                                        │
│  • Campaign & ICP Service                    │ │  • Registry Signal Provider (SIRENE)   │
│  • Company Deduplication & Merging           │ │  • Google Places Signal Provider       │
│  • Evidence Provenance & Validation          │ │  • Website Technical Provider          │
│  • Persona Ranking & Contact Waterfall       │ │  • Website E-Commerce & Booking        │
│  • CanContact Gatekeeper (Suppression)       │ │  • Company Hiring & Scale Provider     │
│  • Autonomous Conversation State Machine     │ │  • Custom Domain Signal Provider       │
│  • Offer Knowledge Base & Grounding          │ └───────────────────┬────────────────────┘
│  • Calendar Availability & Slot Negotiator   │                     │
└─────────────────────┬────────────────────────┘                     │
                      │                                              │
                      ▼                                              ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              EXTERNAL INTEGRATION ADAPTERS                             │
│                                                                                        │
│  • AI Providers (OpenAI gpt-4o-mini / Anthropic Claude 3.5 Haiku / Mock)               │
│  • Government Registries (API Recherche d'Entreprises / Pappers)                       │
│  • Search & Places APIs (Serper.dev Google Places & Organic Search)                    │
│  • Contact Enrichment (Dropcontact API / Waterfall)                                    │
│  • Cold Email Dispatcher (Instantly.ai V2 REST & Webhooks)                             │
│  • Calendar APIs (Microsoft Graph OAuth2 / Google Calendar / Cal.com)                  │
│  • Web Auditing APIs (Google PageSpeed Insights REST API / Puppeteer Worker)           │
│  • PDF Rendering (PDFKit Server-side Document Generator)                               │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   PERSISTENCE LAYER                                    │
│                                                                                        │
│  • Cloud Firestore (Document Database with multi-tenant subcollections)                │
│  • Google Cloud Secret Manager (Isolated API keys & webhook signing secrets)           │
│  • Firebase Cloud Storage (PDF proposals, website snapshots, exported CSVs)            │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔄 End-to-End Sequence Flows

### 1. Natural Language Campaign Formulation

```text
User                           NL Campaign Builder                  AI Strategy Service              Firestore DB
 │                                      │                                    │                            │
 ├── (1) "Find French florists with     │                                    │                            │
 │        weak digital presence to sell │                                    │                            │
 │        e-commerce redesigns"         │                                    │                            │
 │─────────────────────────────────────►│                                    │                            │
 │                                      ├── (2) Formulate Prompt Template ──►│                            │
 │                                      │       + Inject Business Offer      │                            │
 │                                      │                                    ├── (3) Generate Structured  │
 │                                      │                                    │       Targeting & Signals  │
 │                                      │                                    │       (Zod Validated)      │
 │                                      │◄── (4) Return Campaign Plan ───────┤                            │
 │◄── (5) Display Preview in UI ────────┤                                                                 │
 │        (Keywords, NAF, City, Signals,│                                                                 │
 │         Personas, Value Angles)      │                                                                 │
 │                                      │                                                                 │
 ├── (6) User Approves Plan ───────────►│                                                                 │
 │                                      ├── (7) Save `campaigns` & `researchStrategies` ─────────────────►│
```

---

### 2. Signal Collection & Opportunity Qualification

```text
Discovery Runner           Signal Coordinator             Pluggable Signal Providers         Evidence Store (DB)
       │                           │                                  │                               │
       ├── (1) Discovered Company ─►│                                  │                               │
       │       (SIREN, Name, City) │                                  │                               │
       │                           ├── (2) Query Active Strategy ─────┼──────────────────────────────►│
       │                           │       (e.g. Website Agency)      │                               │
       │                           │◄─────────────────────────────────┼───────────────────────────────┤
       │                           │                                  │                               │
       │                           ├── (3) Invoke Required Providers ─►│                               │
       │                           │       - RechercheEntreprises     │                               │
       │                           │       - GooglePlaces             │                               │
       │                           │       - WebsiteTechnicalAudit    │                               │
       │                           │       - EcommerceAudit           │                               │
       │                           │                                  │                               │
       │                           │◄── (4) Return Raw Signals ───────┤                               │
       │                           │                                  │                               │
       │                           ├── (5) Normalize to `EvidenceItem[]` with Provenance ────────────►│
       │                           │                                                                  │
       │                           ├── (6) Calculate Multi-Factor `OpportunityScore`                  │
       │                           │       - Fit Score (0-100)                                        │
       │                           │       - Need Strength (0-100)                                    │
       │                           │       - Evidence Confidence (0-100)                              │
       │                           │                                                                  │
       │                           └── (7) Update Company Status: `QUALIFIED` or `DISQUALIFIED` ─────►│
```

---

### 3. Inbound Reply Ingestion, Classification & Autonomous Booking

```text
Prospect               Instantly Webhook             Reply Classifier              Booking Engine           Human Inbox
   │                           │                             │                            │                      │
   ├── (1) "Thursday 2:30 PM   │                             │                            │                      │
   │        works for a call"  │                             │                            │                      │
   │──────────────────────────►│                             │                            │                      │
   │                           ├── (2) POST /webhooks/reply ─►│                            │                      │
   │                           │       (Verify Signature)    ├── (3) Classify Intent      │                      │
   │                           │                             │       - Category: BOOKING  │                      │
   │                           │                             │       - Confidence: 0.95   │                      │
   │                           │                             │       - Slot: Thu 14:30    │                      │
   │                           │                             │                            │                      │
   │                           │                             ├── (4) Check Real Calendar ─►│                      │
   │                           │                             │       Availability         ├── (5) Query Outlook  │
   │                           │                             │                            │       Free/Busy      │
   │                           │                             │◄── (6) Slot is Available ──┤                      │
   │                           │                             │                            │                      │
   │                           │                             ├── (7) Auto-Create Meeting ─►│                      │
   │                           │                             │       + Send Outlook Invite│                      │
   │                           │                             │                            ├── (8) Stop Sequence  │
   │                           │                             │                            │   in Instantly       │
   │                           │                             │                            │                      │
   │                           │                             ├── (9) Update Conversation ─┼─────────────────────►│
   │                           │                             │       Status = BOOKED      │   (Notify Rep)       │
   │◄── (10) Receive Outlook ──┼─────────────────────────────┼────────────────────────────┤                      │
   │         Calendar Invite   │                             │                            │                      │
```
