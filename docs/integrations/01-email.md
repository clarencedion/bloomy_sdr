# Email Integration

## Principle

Do not use Resend as the main cold email engine.

Use Resend for:
- transactional emails
- internal notifications
- warm/opted-in messages
- system alerts

Use CSV export first for cold email.

Later integrate:
- Smartlead
- Instantly

## Why

Cold outreach requires:
- inbox warmup
- bounce handling
- reply detection
- unsubscribe management
- sending limits
- deliverability protection
- domain reputation monitoring

This should not be rebuilt in MVP.

## Email Provider Abstraction

Create an abstraction so providers can be swapped later.

```ts
interface EmailProvider {
  sendTransactionalEmail(input: TransactionalEmailInput): Promise<EmailResult>;
  sendCampaignEmail?(input: CampaignEmailInput): Promise<EmailResult>;
  getMessageStatus?(messageId: string): Promise<EmailStatus>;
}
```

## CSV Export MVP

Approved outreach should export:
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
