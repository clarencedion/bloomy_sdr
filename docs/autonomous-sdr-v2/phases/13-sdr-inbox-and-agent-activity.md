# Phase 13 — Human SDR Inbox & Agent Activity UI

## Objective
Build the **Human SDR Inbox & Conversation Thread UI** providing human sales reps with complete visibility and operational control over autonomous SDR activities, active dialogues, draft responses, intent badges, and one-click intervention actions.

## Why this phase exists
To provide a mission-control dashboard where operators can monitor conversations, review AI drafts, take over threads manually, and understand why the autonomous agent took specific actions.

## Requirements covered
* **REQ-070**: SDR Inbox & Conversation Thread UI

## Existing code to inspect
* `src/features/outreach/outreach-page.tsx`
* `src/features/outreach/outreach-editor.tsx`
* `src/features/dashboard/dashboard-shell.tsx`

## Existing code to preserve
* Draft editor component styling and Radix UI components.

## Architecture
* Transform the Outreach section into a full **SDR Inbox** (`/app/inbox` or `/app/outreach`):
  * Left pane: Filterable conversation list (All, Needs Attention, In Dialogue, Meeting Booked, Suppressed).
  * Center pane: Chronological message thread (inbound and outbound emails with sender headers, timestamps, and body text).
  * Right pane: Prospect dossier (Company profile, verified evidence items, opportunity score breakdown, matched persona, assigned rep).
  * Action bar: One-click "Approve & Send", "Edit Draft", "Take Over Manually", "Suppress Contact", and "Book Meeting Manually".
* Live activity indicator showing recent autonomous agent actions (e.g. *"Auto-replied to Thomas at 14:15"*, *"Meeting booked with Atelier Floral"*).

## Data/schema changes
* Extend `conversations` collection with `unreadHumanAttention: boolean`, `assignedRepUserId`.

## Backend changes
* Implement `functions/src/services/inbox-service.ts` (listing conversations with real-time filters and status aggregations).
* Implement `callTakeOverConversation`, `callManualReply`, and `callUpdateConversationStatus` callables.

## Frontend changes
* Implement `src/features/inbox/sdr-inbox-page.tsx`.
* Implement `src/features/inbox/conversation-thread-view.tsx`.
* Implement `src/features/inbox/prospect-dossier-panel.tsx`.
* Add notification badge in top navigation showing pending human-attention count.

## External APIs
* None.

## Security considerations
* Verify that reps can only access conversations belonging to their authenticated workspace and business context.

## Migration/backfill
* Map existing `outreach` drafts and replied records into the SDR Inbox view.

## Tests to write FIRST or alongside implementation
* `tests/inbox/inbox-filters.test.ts`: Test querying conversations by `needs_attention`, `in_dialogue`, and `meeting_booked`.
* `tests/inbox/human-takeover.test.ts`: Test that clicking "Take Over Manually" pauses autonomous agent replies for that thread.

## E2E scenarios
* An inbound email requiring human review appears in the SDR Inbox with a yellow "Needs Attention" badge; rep edits the draft response and clicks "Approve & Send"; message dispatches and badge clears.

## Definition of done
* [ ] Multi-pane SDR Inbox operational in UI.
* [ ] Full conversation thread history rendered cleanly.
* [ ] Human takeover and draft approval actions functional.
* [ ] Tests pass; Reviewer verdict PASS.
* [ ] `ACCEPTANCE_MATRIX.md` updated for REQ-070.

## Reviewer checklist
* [ ] Does the inbox make AI actions explainable?
* [ ] Can a rep take over a thread and prevent auto-replies?
* [ ] Is prospect evidence easily accessible alongside the chat?

## Explicitly out of scope
* Funnel analytics and learning loops (deferred to Phase 14).
