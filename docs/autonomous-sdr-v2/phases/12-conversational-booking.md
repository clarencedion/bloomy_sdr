# Phase 12 — Conversational Booking & Real Calendar Sync

## Objective
Build the **Conversational Booking Subsystem** allowing the SDR to negotiate meeting times naturally in email threads, query REAL calendar availability (Microsoft Graph / Google Calendar / Cal.com), propose conflict-free slots, atomically create meetings, dispatch calendar invites, and terminate cold email sequences instantly.

## Why this phase exists
To remove the friction of forcing prospects to click external booking links. Conversational scheduling in email threads (*"Thursday 2:30 PM works for me"*) dramatically increases meeting conversion rates.

## Requirements covered
* **REQ-071**: Real-Time Calendar Free/Busy Query
* **REQ-072**: Conversational Slot Parser
* **REQ-073**: Conflict-Free Slot Proposer
* **REQ-074**: Atomic Meeting Creation & Invite
* **REQ-075**: Automatic Sequence Termination
* **REQ-076**: Microsoft Graph Hourly Sync Fallback

## Existing code to inspect
* `functions/src/jobs/calendar-sync-job.ts`
* `src/features/meetings/meetings-page.tsx`
* `src/app/api/booking-webhook/route.ts`

## Existing code to preserve
* Microsoft Graph OAuth2 token refresh logic in `calendar-sync-job.ts`.

## Architecture
* Implement `CalendarProvider` abstraction (`getFreeBusyWindows`, `createMeetingEvent`, `cancelMeetingEvent`).
* **Slot Parser:** LLM parses prospect scheduling intent (e.g. *"Thursday afternoon"*, *"Friday at 10am"*, *"Next Tuesday"*).
* **Slot Proposer:** Queries calendar provider for busy blocks within configured working hours (e.g. Mon–Fri 9am–6pm Paris time) and returns 2–3 concrete open slots matching the prospect's preference.
* **Atomic Meeting Creator:** When the prospect confirms a slot, re-verifies availability to prevent race conditions, creates the event via Microsoft Graph, dispatches an Outlook invite, writes to `meetings` collection, and immediately terminates the Instantly outbound sequence.
* **Reconciliation Sync:** Retains hourly background sync to capture meetings booked directly outside the email thread.

## Data/schema changes
* Extend `meetings` collection with `conversationId`, `bookingSource: "conversational" | "direct"`, `outlookEventId`, `status: "scheduled" | "completed" | "cancelled"`.

## Backend changes
* Implement `functions/src/services/calendar-service.ts`.
* Implement `functions/src/services/slot-parser.ts`.
* Implement `functions/src/services/booking-negotiator.ts`.
* Implement `functions/src/services/meeting-creator.ts`.

## Frontend changes
* Display booked meeting details, attendee links, and calendar sync status in `src/features/meetings/meetings-page.tsx` and conversation threads.

## External APIs
* Microsoft Graph API (`https://graph.microsoft.com/v1.0/me/calendarView`, `/events`).

## Security considerations
* Verify that calendar tokens are isolated per Business and never exposed to the client.
* Timezone calculations must strictly respect the operator's configured timezone (default `Europe/Paris`).

## Migration/backfill
* None required.

## Tests to write FIRST or alongside implementation
* `tests/booking/calendar-freebusy.test.ts`: Test querying free/busy windows; assert that existing calendar events block proposed slots.
* `tests/booking/slot-parser.test.ts`: Test parsing French expressions:
  * "Je suis disponible jeudi après-midi" → Thursday 14:00 - 18:00
  * "Vendredi à 10h" → Friday 10:00 - 10:30
* `tests/booking/slot-proposer.test.ts`: Test that proposed slots only fall within verified open windows and working hours.
* `tests/booking/sequence-termination.test.ts`: Test that booking a meeting immediately halts the Instantly sequence for that contact.

## E2E scenarios
* Simulate a prospect replying *"Jeudi 14h30 me convient"*; verify that the system checks Outlook availability, creates the meeting event, stops sequence emails, and marks the conversation as `MEETING_BOOKED`.

## Definition of done
* [ ] Calendar free/busy query operational via Microsoft Graph.
* [ ] Conversational slot parser and negotiator validated.
* [ ] Atomic meeting creation and sequence termination operational.
* [ ] Tests pass; Reviewer verdict PASS.
* [ ] `ACCEPTANCE_MATRIX.md` updated for REQ-071 through REQ-076.

## Reviewer checklist
* [ ] Does the system propose only REAL available slots from the calendar?
* [ ] Does meeting creation terminate the active cold sequence in Instantly?
* [ ] Are timezones handled accurately?

## Explicitly out of scope
* Human SDR Inbox UI polish (deferred to Phase 13).
