# Core Domain Model & Entity Definitions

This document defines the generic domain model for the Autonomous SDR V2 platform. All TypeScript interfaces and Firestore data models derive directly from these formal entity specifications.

---

## 📐 Entity Relationship Diagram

```text
Workspace
  └── Business
        ├── KnowledgeBase (FAQs, case studies, pricing rules, constraints)
        ├── CalendarIntegration (Outlook / Google / Cal.com credentials)
        ├── SenderIdentity (mailbox domains, sending names)
        └── Offer
              ├── TargetPersonas (prioritized decision-maker roles)
              ├── ValuePropositions & ProofPoints
              └── Campaign
                    ├── IcpDefinition (NAF, cities, scale, keywords, exclusions)
                    ├── ResearchStrategy (required SignalProviders & weights)
                    ├── OutreachStrategy (angles, tone, follow-up schedule, PDF template)
                    └── Opportunity (Company in context of Campaign)
                          ├── EvidenceItem[] (verifiable collected signals)
                          ├── OpportunityScore (fit, need strength, commercial score)
                          ├── Contact[] (decision-makers matched to Personas)
                          └── Conversation
                                ├── OutreachDraft / Sequence
                                ├── Message[] (inbound & outbound emails)
                                ├── ReplyClassification (intent, objection, confidence)
                                └── Meeting (synced / booked calendar event)
```

---

## 🏛️ Domain Entity Specifications

### 1. Workspace & Business
* **`Workspace`**: The top-level multi-tenant account container (e.g. Agency account or Enterprise subscription).
* **`Business`**: A discrete commercial entity operated within a Workspace (e.g. *Bloomy Digital Studio* or *Devcomm Consulting*). Holds its own branding, knowledge base, calendar connections, and sender mailboxes.
* **`KnowledgeBase`**: Structured business knowledge comprising services, pricing guardrails, delivery timelines, case studies, objection-handling guidelines, and strictly prohibited promises.

### 2. Offer & Campaign
* **`Offer`**: A specific service or product package sold by a Business (e.g. *"E-Commerce & Website Redesign"* or *"Sales Team Performance Coaching"*).
* **`Campaign`**: An outbound sales execution cycle associated with an Offer, targeting a specific market segment.
* **`IcpDefinition`**: Machine-readable Ideal Customer Profile specifying geographic boundaries, NAF/APE activity codes, employee thresholds, required keyword signals, and negative filters.
* **`ResearchStrategy`**: Declarative configuration specifying which `SignalProvider` modules must execute for companies in this campaign and how their evidence factors into scoring.

### 3. Signals & Evidence
* **`SignalProvider`**: A pluggable module that queries an external source (e.g. government registry, search engine, web crawler, PageSpeed API) to extract raw domain observations.
* **`EvidenceItem`**: An atomic, immutable, provenance-tracked observation regarding a Company:
  ```ts
  interface EvidenceItem {
    id: string;
    workspaceId: string;
    businessId: string;
    companyId: string;
    signalProvider: string;        // e.g. "website_technical_audit"
    key: string;                   // e.g. "mobile_pagespeed_score"
    value: unknown;                // e.g. 28
    sourceType: "official_registry" | "website" | "google_places" | "pagespeed" | "provider" | "ai_interpretation";
    sourceUrl?: string;            // e.g. "https://atelier-floral.fr"
    confidence: number;            // 0 - 100
    nature: "fact" | "derived_metric" | "ai_interpretation";
    collectedAt: Date;
    expiresAt?: Date;
  }
  ```
* **`OpportunityScore`**: The composite qualification score computed from `EvidenceItem[]`:
  * `companyFitScore` (0–100): Matches ICP demographic criteria.
  * `needStrengthScore` (0–100): Strength of detected problem signals.
  * `commercialValueScore` (0–100): Commercial potential.
  * `overallScore` (0–100): Weighted composite.
  * `qualificationStatus`: `"DISQUALIFIED"` | `"NEEDS_MORE_EVIDENCE"` | `"QUALIFIED"` | `"HIGH_PRIORITY"`.

### 4. Company, Persona & Contact
* **`Company`**: A legal or operating business entity (SIREN, SIRET, Name, Website, Domain, Location).
* **`Persona`**: A prioritized target decision-maker profile configured on an Offer (e.g. Priority 1: "Fondateur / Gérant", Priority 2: "Directeur Marketing").
* **`Contact`**: A verified human decision maker at a Company with direct email, phone, role title, and verification qualification.

### 5. Outreach, Conversation & Booking
* **`OutreachStrategy`**: Defines sequence length, copywriting rules, value angles, CTA format, and proposal PDF attachments.
* **`Conversation`**: The unified thread representing all outbound touches and inbound replies with a Contact.
* **`Message`**: An individual email message (direction: `INBOUND` | `OUTBOUND`), delivery status, timestamp, raw body, and headers.
* **`ReplyClassification`**: Structured classification of an inbound email:
  * `intent`: `"POSITIVE"` | `"BOOKING_REQUEST"` | `"QUESTION"` | `"OBJECTION"` | `"NOT_INTERESTED"` | `"UNSUBSCRIBE"` | `"WRONG_PERSON"` | `"REFERRAL"` | `"OUT_OF_OFFICE"` | `"ANGRY"` | `"UNCLEAR"`.
  * `objectionType`: `"PRICE"` | `"EXISTING_PROVIDER"` | `"NO_BUDGET"` | `"NOT_PRIORITY"` | `"BAD_TIMING"` | `"NO_TIME"` | `"INTERNAL_SOLUTION"` | `"OTHER"`.
  * `confidence`: 0.0 – 1.0.
  * `proposedAction`: `"AUTO_REPLY"` | `"ESCALATE_HUMAN"` | `"AUTO_BOOK"` | `"SUPPRESS"`.
* **`Meeting`**: A booked sales meeting synchronized with Outlook or Google Calendar.

### 6. Governance, Compliance & Analytics
* **`SuppressionEntry`**: Blocklist record (Email, Domain, SIREN, Reason, Expiration).
* **`AutomationPolicy`**: Configures autonomy tier (`MANUAL`, `ASSISTED`, `AUTONOMOUS_SAFE`) and daily rate limits per Business.
* **`PerformanceInsight`**: Aggregated performance metrics linking Signal types, Angle variants, and Persona roles to reply and meeting conversion rates.
