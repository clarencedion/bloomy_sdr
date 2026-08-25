# Autonomy Policy & Human Escalation Framework

This document defines the operational autonomy tiers, decision boundaries, human escalation conditions, and safety guardrails governing Autonomous SDR V2.

---

## 🚦 Three Autonomy Tiers

Every Business entity operates under one of three configurable autonomy tiers:

```text
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│     MANUAL      │  ──►  │    ASSISTED     │  ──►  │ AUTONOMOUS_SAFE │
│ (Human in Loop) │       │  (Auto Outbound)│       │ (Auto Out & In) │
└─────────────────┘       └─────────────────┘       └─────────────────┘
```

### Tier 1: `MANUAL` (Strict Human-in-the-Loop)
* **Outreach Drafts:** AI generates personalized drafts; human rep must click "Approve" before any email is dispatched.
* **Inbound Replies:** Inbound messages are ingested and classified; AI drafts proposed responses; human rep must review, edit, and send.
* **Booking:** AI proposes time slots; human rep confirms meeting invites.
* **Use Case:** Initial onboarding of a new business or high-ticket corporate enterprise deals.

### Tier 2: `ASSISTED` (Autonomous Outbound + Supervised Inbound)
* **Outreach Drafts:** Qualified leads meeting `overallScore >= 80` and `confidence >= 75` are auto-approved and dispatched within daily limits.
* **Inbound Replies:** Inbound messages are parsed and classified. High-confidence unsubscribe/OOO are handled automatically. Substantive prospect inquiries generate drafts and queue in the SDR Inbox for one-click human approval.
* **Booking:** AI proposes slots; automatically books upon prospect acceptance.

### Tier 3: `AUTONOMOUS_SAFE` (Full Autonomous Operation with Guardrails)
* **Outreach Drafts:** Fully autonomous qualification, generation, and dispatch.
* **Inbound Replies:** Safe categories (`SAFE_QUESTION`, `OBJECTION_SAFE`, `BOOKING_REQUEST`) are answered automatically within 15 minutes using verified KnowledgeBase grounding.
* **Human Escalation:** High-risk, ambiguous, or low-confidence interactions pause the sequence and immediately notify the human rep.

---

## 🚨 Mandatory Human Escalation Rules

Regardless of the configured autonomy tier, the system **MUST immediately escalate to human review** if any of the following conditions occur:

| Escalation Trigger | Trigger Description | System Action |
| :--- | :--- | :--- |
| **Legal Threat / GDPR** | Prospect mentions lawyers, CNIL, GDPR violations, damages, or lawsuits. | Immediately suppress prospect; pause all active threads; flag high-priority alert. |
| **Angry / Hostile Sentiment** | Negative sentiment detector flags abusive, aggressive, or hostile language. | Terminate sequence; suppress contact; notify human rep. |
| **Custom Pricing Request** | Prospect requests custom quote or discount not explicitly defined in `pricingGuardrails`. | Draft acknowledgment stating the team will follow up; create human task. |
| **Low Classifier Confidence** | Intent classification confidence is `< 0.80` or contains conflicting intents. | Hold draft; place in SDR Inbox with badge `Confidence: Low`. |
| **Competitor Infiltration** | Prospect is identified as a direct competitor or industry peer. | Tag as competitor; suppress from outreach. |
| **High-Value Enterprise Lead** | Prospect company has `employeeCount > 250` or revenue matching enterprise tier. | Switch conversation to `MANUAL` mode to allow tailored human handling. |
| **Unmapped Technical Inquiry** | Prospect asks a specific architectural/security question absent from `KnowledgeBase`. | Draft safe holding reply; escalate to human subject matter expert. |
