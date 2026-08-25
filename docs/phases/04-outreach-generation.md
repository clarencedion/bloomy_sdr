# Phase 3 — Outreach Generation

## Goal

Generate personalized outreach content from company research.

## Backend Function

Create:

```ts
generateOutreach(companyId: string, contactId?: string, campaignId?: string)
```

It should generate:
- email subject
- email body
- follow-up 1
- follow-up 2
- LinkedIn connection note
- LinkedIn follow-up
- internal sales notes
- personalized landing page draft content

## Style Rules

Language:
- French by default

Tone:
- professional
- human
- short
- non-spammy
- diagnostic-oriented

Email:
- no fake claims
- no exaggerated personalization
- no aggressive sales language
- clear CTA for a 20-minute diagnostic call
- opt-out sentence

## Frontend

In company detail / Outreach tab:
- Generate outreach button
- Email editor
- Follow-up editor
- LinkedIn note editor
- AI regenerate button
- Approve button
- Reject button
- Needs more research button

## Approval Flow

Status:
draft → approved → exported/sent

Do not send automatically.

## Acceptance Criteria

- Outreach can be generated for researched company
- User can edit generated text
- User can approve/reject
- Approved outreach appears in Outreach page
