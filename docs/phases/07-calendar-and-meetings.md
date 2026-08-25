# Phase 6 — Calendar and Meetings

## Goal

Integrate meeting tracking and prepare Outlook Calendar sync.

## CalendarProvider Interface

Create:

```ts
interface CalendarProvider {
  listEvents(start: Date, end: Date): Promise<CalendarEvent[]>;
  createEvent(input: CreateCalendarEventInput): Promise<CalendarEvent>;
  updateEvent(eventId: string, input: UpdateCalendarEventInput): Promise<CalendarEvent>;
  deleteEvent(eventId: string): Promise<void>;
  handleWebhook(payload: unknown): Promise<void>;
}
```

## Providers

Implement:
1. OutlookCalendarProvider using Microsoft Graph
2. CustomBookingAdapter placeholder

## Meeting Features

Pages:
- Meetings list
- Meeting detail
- Calendar settings
- Manual sync button

When meeting is created/booked:
- create meeting document
- link company/contact if possible
- update outreach status to meeting_booked
- update company status to meeting_booked
- create log
- send internal notification if Resend configured

## Custom Booking Webhook

Create endpoint:

```txt
POST /api/booking-webhook
```

Expected payload:

```json
{
  "eventId": "...",
  "companyName": "...",
  "contactEmail": "...",
  "startTime": "...",
  "endTime": "...",
  "attendees": [],
  "source": "website_booking"
}
```

## Acceptance Criteria

- Meetings can be manually created/viewed
- Webhook endpoint can create meeting
- CalendarProvider abstraction exists
- Outlook provider has clear setup docs
