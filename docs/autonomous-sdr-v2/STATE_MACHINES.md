# Lifecycle State Machines

This document specifies the formal lifecycle state machines governing entities in Autonomous SDR V2. No service or function may perform an arbitrary or undocumented state transition.

---

## 🏢 1. Opportunity Lifecycle State Machine

An **Opportunity** represents a specific Company evaluated against a specific Campaign.

```text
                  [DISCOVERED]
                       │
                       ▼
             [COLLECTING_SIGNALS]
                       │
                       ▼
                    [SCORED]
                   /        \
    overallScore < min    overallScore >= min
                 /            \
                ▼              ▼
        [DISQUALIFIED]   [QUALIFIED]
                               │
                               ▼
                      [CONTACT_DISCOVERY]
                               │
                               ▼
                       [OUTREACH_READY]
                               │
                               ▼
                       [SEQUENCE_ACTIVE]
                        /       |       \
               Replied /  Bounced|       \ No response
                      ▼         ▼         ▼
                  [REPLIED]  [BOUNCED] [COMPLETED]
                     │
                     ▼
              [MEETING_BOOKED]
```

### Valid Opportunity Transitions

| Current State | Next State | Trigger / Guard Condition |
| :--- | :--- | :--- |
| `DISCOVERED` | `COLLECTING_SIGNALS` | Campaign runner begins signal provider queries. |
| `COLLECTING_SIGNALS`| `SCORED` | All required `SignalProvider` modules return `EvidenceItem[]`. |
| `SCORED` | `DISQUALIFIED` | `OpportunityScore.overallScore < Campaign.minScoreForQualification`. |
| `SCORED` | `QUALIFIED` | `OpportunityScore.overallScore >= Campaign.minScoreForQualification`. |
| `QUALIFIED` | `CONTACT_DISCOVERY` | Contact enrichment engine executes (Dropcontact / waterfall). |
| `CONTACT_DISCOVERY` | `OUTREACH_READY` | Verified decision-maker contact identified (`emailVerified: true`). |
| `OUTREACH_READY` | `SEQUENCE_ACTIVE` | Outreach approved and dispatched to Instantly.ai. |
| `SEQUENCE_ACTIVE` | `REPLIED` | Prospect sends an inbound email reply. |
| `SEQUENCE_ACTIVE` | `BOUNCED` | Mailbox bounce webhook received from provider. |
| `SEQUENCE_ACTIVE` | `COMPLETED` | All sequence steps sent without response. |
| `REPLIED` | `MEETING_BOOKED` | Calendar sync detects confirmed meeting event. |
| *ANY STATE* | `SUPPRESSED` | Contact / Domain added to suppression list. |

---

## 💬 2. Conversation & Inbound Reply State Machine

A **Conversation** represents the communication thread with a prospect.

```text
                  [OUTREACH_DRAFT]
                         │
                         ├─ (Human Rejects) ────────► [REJECTED]
                         │
                         ▼ (Approved)
                  [SEQUENCE_ACTIVE]
                         │
                         ▼ (Inbound Reply)
                 [REPLY_RECEIVED]
                         │
                         ▼ (LLM Classification)
                 [REPLY_CLASSIFIED]
                   /     |      \
     Auto-Safe    /      |       \ High Risk / Low Confidence
                 ▼       |        ▼
         [AUTO_RESPONDED]│  [HUMAN_ESCALATED]
                 │       │        │
                 └───────┼────────┘
                         │
                  (Booking Intent)
                         │
                         ▼
                  [MEETING_BOOKED]
```

### Inbound Reply Intent Routing

| Classification Intent | Autonomy Action | Resulting State |
| :--- | :--- | :--- |
| `UNSUBSCRIBE` | Immediate suppression write + terminate sequence | `SUPPRESSED` |
| `OUT_OF_OFFICE` | Pause sequence until return date | `SEQUENCE_PAUSED` |
| `WRONG_PERSON` | Query referral contact if provided, suppress current | `CONTACT_REFERRED` |
| `BOOKING_REQUEST` | Query real calendar free/busy → send slot proposal | `BOOKING_IN_PROGRESS` |
| `SAFE_QUESTION` | Draft response using KnowledgeBase → Auto-send if tier = `AUTONOMOUS_SAFE` | `AUTO_RESPONDED` |
| `OBJECTION_SAFE` | Draft objection response → Auto-send if tier = `AUTONOMOUS_SAFE` | `AUTO_RESPONDED` |
| `LEGAL_RISK` / `ANGRY` | Terminate autonomous actions immediately → Alert human rep | `HUMAN_ESCALATED` |
| `UNCLEAR` / Low Conf | Flag for human SDR Inbox review | `HUMAN_ESCALATED` |

---

## ⚡ 3. Background Job State Machine

Every asynchronous background job (Discovery, Signal Collection, Outreach Generation, Reply Processing) implements strict idempotency and retry states:

```text
[PENDING] ──► [RUNNING] ──┬──► [COMPLETED]
                           │
                           └──► [FAILED] ──► (retry < 3) ──► [PENDING]
                                         ──► (retry >= 3) ─► [DEAD_LETTER]
```

* **Idempotency Rule:** A job ID is derived deterministically from `entityId + action + timestampHour` to prevent duplicate processing if a queue task is redelivered.
