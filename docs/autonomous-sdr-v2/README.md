# Autonomous SDR Platform V2 — Project Documentation Harness

Welcome to the engineering specifications, requirements registry, architectural invariants, and phase-by-phase execution roadmap for **Autonomous SDR V2**.

---

## 🎯 What is Autonomous SDR V2?

Autonomous SDR V2 is a **production-quality, multi-business, offer-agnostic autonomous outbound sales platform**.

It operates as an autonomous sales development representative:
1. Translates natural language offers & campaign objectives into structured ICP targeting.
2. Discovers matching companies across official government registries and search providers.
3. Automatically selects relevant signal providers (e.g. website quality for web agencies, company growth/hiring for B2B consultancies) to gather verifiable, provenance-tracked evidence.
4. Scores opportunities and identifies the best target personas.
5. Discovers verified direct contact details for decision makers.
6. Crafts hyper-personalized, evidence-grounded French cold outreach sequences.
7. Dispatches sequences and synchronizes replies in real-time.
8. Understands prospect responses, categorizes intent, answers questions safely, handles objections, and routes complex inquiries to human reps.
9. Dynamically negotiates meeting times against real calendar availability to book calls.
10. Continuously learns which signals, angles, and message variants convert to booked meetings.

---

## 📚 Document Index

| Document | Purpose |
| :--- | :--- |
| [VISION.md](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/VISION.md) | High-level product vision, multi-business rationale, and end-state behavior |
| [CURRENT_SYSTEM.md](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/CURRENT_SYSTEM.md) | Codebase audit of existing components (`KEEP`, `EXTEND`, `REFACTOR`, `DEPRECATE`, `REPLACE`) |
| [INVARIANTS.md](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/INVARIANTS.md) | Unbreakable architectural, security, and copywriting invariants |
| [TARGET_ARCHITECTURE.md](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/TARGET_ARCHITECTURE.md) | System components, layered architecture, and end-to-end data flow |
| [DOMAIN_MODEL.md](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/DOMAIN_MODEL.md) | Core domain entities, relationships, boundaries, and typing |
| [DATA_MODEL.md](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/DATA_MODEL.md) | Cloud Firestore collection schemas, subcollections, and indexes |
| [STATE_MACHINES.md](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/STATE_MACHINES.md) | Formal lifecycle state machines for Company, Opportunity, Outreach, Conversation, and Jobs |
| [SIGNAL_ARCHITECTURE.md](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/SIGNAL_ARCHITECTURE.md) | Pluggable signal provider contracts, evidence models, and execution waterfalls |
| [AUTONOMY_POLICY.md](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/AUTONOMY_POLICY.md) | Autonomy tier definitions (`MANUAL`, `ASSISTED`, `AUTONOMOUS_SAFE`) and human escalation rules |
| [SECURITY_MODEL.md](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/SECURITY_MODEL.md) | Secret isolation, Firestore security rules, prompt injection defenses, and webhook verification |
| [PROVIDER_STRATEGY.md](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/PROVIDER_STRATEGY.md) | External API research protocol, integration constraints, and provider abstractions |
| [REQUIREMENTS.md](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/REQUIREMENTS.md) | Master registry of all functional, non-functional, security, and product requirements (REQ-001 to REQ-080) |
| [ACCEPTANCE_MATRIX.md](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/ACCEPTANCE_MATRIX.md) | Complete acceptance checklist mapping every requirement to tests, evidence, and status |
| [ROADMAP.md](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/ROADMAP.md) | 18-phase implementation roadmap from baseline to final adversarial audit |
| [DECISIONS.md](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/DECISIONS.md) | Architectural Decision Records (ADRs) |
| [RISKS.md](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/RISKS.md) | Risk register with mitigation strategies and test links |
| [PROGRESS.md](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/PROGRESS.md) | Active execution state, current phase, blockers, and next immediate action |
| [HANDOFF.md](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/HANDOFF.md) | Concise session-to-session handoff briefing for clean AI context windows |

---

## 🗺️ Phase Specifications (`docs/autonomous-sdr-v2/phases/`)

* [00 — Baseline and Safety](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/phases/00-baseline-and-safety.md)
* [01 — Security and Compliance](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/phases/01-security-and-compliance.md)
* [02 — Multi-Business Foundation](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/phases/02-multi-business-foundation.md)
* [03 — Natural-Language Campaign Builder](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/phases/03-natural-language-campaign-builder.md)
* [04 — Generic Signal & Evidence Engine](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/phases/04-generic-signal-and-evidence-engine.md)
* [05 — Website Opportunity Module](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/phases/05-website-opportunity-module.md)
* [06 — Opportunity Scoring](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/phases/06-opportunity-scoring.md)
* [07 — Contact Discovery & Persona Ranking](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/phases/07-contact-discovery-and-persona-ranking.md)
* [08 — Evidence-Grounded Outreach](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/phases/08-evidence-grounded-outreach.md)
* [09 — Instantly V2 & Conversation Model](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/phases/09-instantly-v2-and-conversations.md)
* [10 — Reply Intelligence](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/phases/10-reply-intelligence.md)
* [11 — Autonomous Reply Engine](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/phases/11-autonomous-reply-engine.md)
* [12 — Conversational Booking](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/phases/12-conversational-booking.md)
* [13 — SDR Inbox & Agent Activity](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/phases/13-sdr-inbox-and-agent-activity.md)
* [14 — Analytics & Experiments](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/phases/14-analytics-and-experiments.md)
* [15 — Queues, Reliability & Cost Control](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/phases/15-queues-reliability-and-cost-control.md)
* [16 — Multi-Business Validation](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/phases/16-multi-business-validation.md)
* [17 — Final Adversarial Audit](file:///Users/clarencedion/CODING/devcomm_os/docs/autonomous-sdr-v2/phases/17-final-adversarial-audit.md)
