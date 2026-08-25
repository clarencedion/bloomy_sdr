# Risk Register & Mitigation Strategies

This register identifies known technical, operational, security, and deliverability risks, their severity, and their mitigation plans in Autonomous SDR V2.

---

| Risk ID | Title | Description | Severity | Mitigation Strategy | Phase Addressed |
| :--- | :--- | :--- | :---: | :--- | :---: |
| **RISK-001** | Client-Readable API Secrets | Insecure Firestore rules allow authenticated clients to read secret API keys. | **CRITICAL** | Update Firestore rules to `allow read: if false;` on secret collections; migrate secrets to GCP Secret Manager. | Phase 01 |
| **RISK-002** | Prompt Injection via Web Content | Target website contains hidden instructions intended to hijack LLM behavior. | **HIGH** | Enclose external web text in strict XML boundary tags with explicit negative prompt rules; deny tool execution authority. | Phase 01 |
| **RISK-003** | Unsupported Factual Outreach Claims | LLM hallucinates facts about prospect company size, revenue, or clients. | **HIGH** | Enforce `validateOutreachClaims()` pass to verify all claims against `EvidenceItem[]` with `confidence >= 70`. | Phase 08 |
| **RISK-004** | Accidental Sending to Suppressed Contacts | Prospect requests unsubscribe or previously bounced, but receives subsequent email. | **HIGH** | Enforce mandatory `canContact(...)` gatekeeper on all outbound dispatch pathways before calling email API. | Phase 01 |
| **RISK-005** | Hallucinated Calendar Availability | AI proposes or confirms meeting slots when the operator is already booked. | **HIGH** | Enforce Calendar Truth Invariant: query live free/busy windows before proposing slots; execute atomic check before booking. | Phase 12 |
| **RISK-006** | Cross-Tenant / Cross-Business Data Leak | Business A user reads or sends outreach using Business B's sender identity or data. | **HIGH** | Enforce multi-tenant Firestore security rules and mandatory `workspaceId`/`businessId` scoping in all backend queries. | Phase 01, 02 |
| **RISK-007** | Inbound Webhook Replay / Spoofing | Attacker spams webhook endpoints with fake reply events. | **MEDIUM** | Enforce HMAC signature verification on inbound webhooks and maintain a 7-day idempotent delivery ID cache. | Phase 01, 09 |
| **RISK-008** | API Credit / Token Explosion | Runaway discovery loop or un-cached website auditing burns third-party API credits. | **MEDIUM** | Implement daily spending caps, 30-day domain signal caching, and pre-enrichment scoring gates. | Phase 04, 06 |
| **RISK-009** | Mailbox Deliverability Degradation | Sending too rapidly or hitting spam traps degrades sender domain reputation. | **MEDIUM** | Delegate inbox rotation and warmup to Instantly.ai; enforce daily send caps (default 20/day) in SDR engine. | Phase 09 |
| **RISK-010** | Synchronous Cloud Function Timeouts | Batch cron jobs processing >50 companies sequentially exceed the 540s execution limit. | **MEDIUM** | Decouple heavy workflows into asynchronous Cloud Task queues with exponential backoff retries. | Phase 15 |
| **RISK-011** | Stale Third-Party API Schemas | Modifying integrations based on outdated memory breaks production pipelines. | **MEDIUM** | Mandatory Provider Research Protocol: verify official documentation before implementing any integration. | All Phases |
| **RISK-012** | False Positive Auto-Replies | AI misclassifies hostile reply as positive and sends cheerful follow-up. | **MEDIUM** | Implement strict `AUTONOMY_POLICY.md` escalation: any sentiment score `< 0.80` or hostility indicator routes to human SDR Inbox. | Phase 10, 11 |
