# Firestore Schema

## companies

```ts
type Company = {
  id: string;
  name: string;
  website?: string;
  domain?: string;
  linkedinUrl?: string;
  city?: string;
  country?: string;
  industry?: string;
  employeeCount?: number;
  revenueEstimate?: string;
  description?: string;
  source?: string;
  sourceUrl?: string;
  importedAt: Timestamp;
  updatedAt: Timestamp;
  status:
    | "imported"
    | "research_pending"
    | "researching"
    | "researched"
    | "qualified"
    | "approved"
    | "contacted"
    | "replied"
    | "meeting_booked"
    | "won"
    | "lost"
    | "rejected";
  fitScore?: number;
  priority?: "low" | "medium" | "high";
  tags?: string[];
  assignedTo?: string;
  notes?: string;
  bestOffer?: string;
  lastActivityAt?: Timestamp;
};
```

## contacts

```ts
type Contact = {
  id: string;
  companyId: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  role?: string;
  seniority?: string;
  department?: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  source?: string;
  status:
    | "new"
    | "verified"
    | "invalid"
    | "do_not_contact"
    | "contacted"
    | "replied"
    | "meeting_booked";
  emailVerified?: boolean;
  doNotContact?: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};
```

## leadResearch

```ts
type LeadResearch = {
  id: string;
  companyId: string;
  status: "pending" | "running" | "completed" | "failed";
  researchSummary?: string;
  detectedNeeds?: string[];
  painPoints?: string[];
  buyingTriggers?: string[];
  bestOffer?: string;
  decisionMakersToTarget?: string[];
  risks?: string[];
  confidence?: number;
  fitScore?: number;
  aiProvider?: "openai" | "anthropic";
  model?: string;
  promptVersion?: string;
  rawInput?: unknown;
  rawOutput?: unknown;
  sourceUrls?: string[];
  createdAt: Timestamp;
  completedAt?: Timestamp;
  error?: string;
};
```

## campaigns

```ts
type Campaign = {
  id: string;
  name: string;
  segment: string;
  targetPersona: string;
  offer: string;
  language: "fr" | "en";
  status: "draft" | "active" | "paused" | "archived";
  createdAt: Timestamp;
  updatedAt: Timestamp;
  sequenceSteps: CampaignStep[];
  settings?: Record<string, unknown>;
};
```

## outreach

```ts
type Outreach = {
  id: string;
  companyId: string;
  contactId?: string;
  campaignId?: string;
  status:
    | "draft"
    | "approved"
    | "exported"
    | "sent"
    | "opened"
    | "clicked"
    | "replied"
    | "bounced"
    | "unsubscribed"
    | "meeting_booked"
    | "lost"
    | "won";
  generatedSubject?: string;
  generatedBody?: string;
  followUp1?: string;
  followUp2?: string;
  linkedinNote?: string;
  personalizedPageUrl?: string;
  approvedBy?: string;
  approvedAt?: Timestamp;
  sentAt?: Timestamp;
  lastInteractionAt?: Timestamp;
  replySummary?: string;
  nextAction?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};
```

## meetings

```ts
type Meeting = {
  id: string;
  companyId?: string;
  contactId?: string;
  campaignId?: string;
  outreachId?: string;
  outlookEventId?: string;
  bookingSystemId?: string;
  title: string;
  startTime: Timestamp;
  endTime: Timestamp;
  timezone: string;
  attendees?: string[];
  status: "scheduled" | "completed" | "cancelled" | "no_show";
  source: "outlook" | "website_booking" | "manual";
  notes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};
```

## generatedDocuments

```ts
type GeneratedDocument = {
  id: string;
  companyId: string;
  contactId?: string;
  type: "landing_page" | "pdf" | "email" | "linkedin_message";
  title: string;
  slug: string;
  content: string;
  publicUrl?: string;
  status: "draft" | "approved" | "published" | "archived";
  aiProvider?: "openai" | "anthropic";
  model?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};
```

## settings

Single document:

```txt
settings/global
```

```ts
type GlobalSettings = {
  automationPaused: boolean;
  aiProvider: "openai" | "anthropic";
  dailyAiResearchLimit: number;
  dailyEmailGenerationLimit: number;
  requireApprovalBeforeExport: boolean;
  defaultLanguage: "fr" | "en";
  companyContext: string;
  outlookCalendarId?: string;
};
```

## logs

```ts
type Log = {
  id: string;
  type: string;
  level: "debug" | "info" | "warning" | "error";
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: Timestamp;
};
```

## suppressionList

```ts
type SuppressionEntry = {
  id: string;
  email: string;
  reason: "unsubscribe" | "bounce" | "manual" | "complaint";
  createdAt: Timestamp;
  source?: string;
};
```
