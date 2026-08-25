# Phase 5 — Export and Email

## Goal

Implement CSV export and email provider abstractions.

## EmailProvider Interface

Create:

```ts
interface EmailProvider {
  sendTransactionalEmail(input: TransactionalEmailInput): Promise<EmailResult>;
  sendCampaignEmail?(input: CampaignEmailInput): Promise<EmailResult>;
  getMessageStatus?(messageId: string): Promise<EmailStatus>;
}
```

## Providers

Implement:
1. ResendProvider for transactional/internal emails
2. CsvExportProvider for cold outreach MVP
3. Placeholder SmartleadProvider
4. Placeholder InstantlyProvider

## CSV Export

Export approved outreach with:
- email
- firstName
- lastName
- companyName
- subject
- body
- followUp1
- followUp2
- personalizedPageUrl
- campaignName
- tags

## Transactional Emails

Use Resend for:
- internal notification when lead approved
- internal notification when meeting booked
- system alerts

Do not force cold email sending through Resend.

## Suppression List

Implement:
- add to suppression list
- check before export
- doNotContact flag
- unsubscribe reason
- bounce reason

## Acceptance Criteria

- Approved outreach can be exported as CSV
- Suppressed contacts are excluded
- Resend provider exists for internal notifications
- Placeholder providers are documented
