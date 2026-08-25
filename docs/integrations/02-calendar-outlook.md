# Outlook Calendar Integration

## Goal

Connect Devcomm Sales OS to the existing website booking system linked to Outlook Calendar.

## Provider

Use Microsoft Graph API for Outlook Calendar.

## CalendarProvider

```ts
interface CalendarProvider {
  listEvents(start: Date, end: Date): Promise<CalendarEvent[]>;
  createEvent(input: CreateCalendarEventInput): Promise<CalendarEvent>;
  updateEvent(eventId: string, input: UpdateCalendarEventInput): Promise<CalendarEvent>;
  deleteEvent(eventId: string): Promise<void>;
  handleWebhook(payload: unknown): Promise<void>;
}
```

## MVP

If direct integration details are not known:
- create CustomBookingAdapter placeholder
- create webhook endpoint
- allow manual sync
- allow manual event linking

## Webhook Endpoint

```txt
POST /api/booking-webhook
```

Payload:

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

## Meeting Sync Rules

When meeting is detected:
- create meeting in Firestore
- link contact by email if possible
- link company by company name/domain if possible
- update outreach status to meeting_booked
- update company status to meeting_booked
- log event
- notify admin if Resend configured
