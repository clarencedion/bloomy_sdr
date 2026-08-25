# Product Vision: Multi-Business Autonomous SDR Platform

## 🌟 The Core Vision

The platform operates as an **autonomous sales development representative (SDR) employee**.

A business user or agency founder can provide a natural language description of what they want meetings for:

> *"I want meetings with independent florists in France whose digital presence could be improved so I can sell them website and ecommerce services."*

Or:

> *"I want meetings with French industrial companies with over 20 employees and sales teams so I can sell them commercial sales consulting and corporate training."*

Or:

> *"I want meetings with accounting firms in Paris to sell them cybersecurity audits."*

The **SAME generic autonomous sales engine** understands each offer and autonomously executes the complete outbound sales lifecycle:

```text
Natural Language Input (Offer & Target)
                 │
                 ▼
1. ICP Understanding & Campaign Generation
                 │
                 ▼
2. Provider-Neutral Company Discovery
                 │
                 ▼
3. Dynamic Signal Provider Selection & Evidence Collection
                 │
                 ▼
4. Multi-Factor Opportunity Scoring & Persona Prioritization
                 │
                 ▼
5. Verified Contact & Decision Maker Discovery
                 │
                 ▼
6. Evidence-Grounded Hyper-Personalized Copywriting
                 │
                 ▼
7. Multi-Touch Sequence Dispatch & Real-Time Tracking
                 │
                 ▼
8. Inbound Reply Ingestion, Intent & Objection Classification
                 │
                 ▼
9. Autonomous Safe Responses & Human Escalation Routing
                 │
                 ▼
10. Dynamic Conversational Calendar Booking
                 │
                 ▼
11. Closed-Loop Performance Learning & Angle Optimization
```

---

## 🏛️ Fundamental Architectural Principle: Offer-Agnostic Engine

### This is NOT a website-sales application.
**Bloomy Digital Studio** (selling websites, e-commerce, and digital makeovers) is simply **Use Case #1 (The First Production Business)**.

The platform must seamlessly support completely unrelated businesses (e.g. corporate consultancies, SaaS companies, cybersecurity providers, equipment vendors) **without modifying a single line of generic SDR engine code**.

### The Generic Hierarchy

```text
Workspace / Tenant
        ↓
Business Entity (e.g. Bloomy Digital Studio, Devcomm B2B Consulting)
        ↓
Offer (e.g. E-Commerce Redesign, Sales Team Training)
        ↓
Campaign (Target Market & Strategy)
        ↓
ICP Definition (Filters, NAF, Geography, Scale)
        ↓
Research Strategy (Which Signal Providers to invoke)
        ↓
Signal Providers (Registry, Google Places, Website Audit, Hiring, Growth)
        ↓
Evidence Store (Verified Facts with Source Provenance)
        ↓
Opportunity Score (Fit, Need Strength, Commercial Value)
        ↓
Persona Priority (Target Role Ranking per Offer)
        ↓
Contact Waterfall (Verified Email & Direct Phone)
        ↓
Outreach Strategy (Copywriting Persona, Value Angles, CTAs)
        ↓
Conversation (Full Inbound/Outbound Thread)
        ↓
Booking (Real Calendar Availability & Meeting Creation)
        ↓
Outcome & Learning (Performance Insights by Signal, Angle, and Persona)
```

---

## 🚫 The Golden Invariant: No Hardcoded Business Logic

Generic SDR engine code must **NEVER** contain branches like:

```ts
// ❌ STRICTLY FORBIDDEN IN GENERIC ENGINE
if (business.name === "Bloomy") { ... }
if (campaign.industry === "florist") { ... }
if (offer.type === "website") { runWebsiteAudit(); }
```

Instead:
* Business-specific details live in **Business Configuration** (`knowledgeBase`, `senderIdentities`, `calendarIntegrations`).
* Offer-specific details live in **Offer Configuration** (`valueProposition`, `painPoints`, `targetPersonas`, `prohibitedPromises`).
* Technical audits (such as PageSpeed, CMS detection, mobile responsiveness) live in **Pluggable Signal Providers** (`SignalProvider` interface).
* The campaign's **Research Strategy** selects which signal modules are relevant.

### Example Comparison

| Component | Business A: Bloomy Digital Studio | Business B: Devcomm B2B Consulting |
| :--- | :--- | :--- |
| **Offer** | Website & E-Commerce Development | Commercial Sales & Management Training |
| **Target Market** | French independent florists & artisans | French SMEs & mid-market companies with sales teams |
| **Selected Signals** | `company_registry`, `google_places`, `website_technical`, `website_ecommerce` | `company_registry`, `company_size`, `company_hiring`, `company_news` |
| **Website Audit Ran?**| ✅ **Yes** (Evaluates PageSpeed, mobile UX, missing checkout) | ❌ **No** (Strategy omits website technical audits as irrelevant) |
| **Target Personas** | Founder, Gérant, Artisan, Propriétaire | Sales Director, HR Director, Managing Director, L&D Manager |
| **Primary Value Angle**| "140 5-star Google reviews but no online bouquet ordering" | "Growing sales team without structured sales onboarding" |
| **Knowledge Base** | Web portfolio, e-commerce ROI cases, standard delivery timeline | Skills2Drive methodology, Qualiopi certification, corporate ROI cases |

---

## 🎯 Target End-State Experience

1. **Zero-Setup Campaign Launch:** An operator types one sentence in French or English. The AI formulates the complete campaign, selects signal modules, configures NAF codes, and sets up copy angles.
2. **Evidence-Grounded Invisibility:** Prospects receive cold emails that cite precise, verifiable facts about their business. The outreach reads as if written by a dedicated human researcher.
3. **Autonomous Conversation Management:** When prospects reply asking for pricing, asking about process, or raising common objections, the SDR responds accurately within minutes using approved business knowledge.
4. **Frictionless Booking:** When a prospect says *"Thursday afternoon works for me"*, the AI checks real calendar free/busy slots, suggests 2:30 PM, sends an Outlook invite upon agreement, terminates the cold email sequence, and alerts the sales team.
5. **Self-Improving Flywheel:** The platform tracks which signals (e.g. "PageSpeed < 30" vs "Old Copyright Year") generate the highest meeting booking rates, automatically prioritizing similar prospects in future discovery runs.
