# Technical Architecture

## High-Level Architecture

```txt
Firebase Hosting
    ↓
React / Next.js frontend
    ↓
Firebase Auth
    ↓
Firestore
    ↓
Cloud Functions v2
    ↓
AI APIs / Resend / Microsoft Graph / CSV Export
    ↓
Outlook Calendar + custom booking system
```

## Frontend

Use:
- React or Next.js
- TypeScript
- Tailwind CSS
- shadcn/ui
- Framer Motion
- Lucide React
- Recharts
- Firebase client SDK

Recommended structure:

```txt
src/
  app/
  components/
  components/ui/
  features/
    dashboard/
    companies/
    contacts/
    campaigns/
    research/
    outreach/
    meetings/
    settings/
    logs/
  lib/
    firebase/
    api/
    utils/
    constants/
  types/
```

## Backend

Use:
- Firebase Cloud Functions v2
- TypeScript
- Firebase Admin SDK
- scheduled functions
- HTTPS callable or REST endpoints
- Google Secret Manager for secrets

Recommended structure:

```txt
functions/
  src/
    index.ts
    config/
    providers/
      ai/
      email/
      calendar/
      outreach/
    jobs/
    services/
      researchCompany.ts
      generateOutreach.ts
      generateLandingPage.ts
      analyzeReply.ts
      calendarSync.ts
    utils/
```

## Data Layer

Firestore is the source of truth.

Collections:
- users
- companies
- contacts
- leadResearch
- campaigns
- outreach
- meetings
- generatedDocuments
- settings
- logs
- suppressionList
- usage

## Background Jobs

Scheduled Functions:
- dailyResearchQueueRunner
- hourlyOutreachStatusSync
- calendarSyncJob
- dailyAnalyticsAggregator
- cleanupOldLogs

## Cloud Run

Only use Cloud Run if needed for:
- long-running website crawling
- headless browser scraping
- heavy enrichment tasks
- jobs over Cloud Functions timeout limits

Do not use Cloud Run at Phase 1 unless necessary.

## Cost Control

Every AI job must check:
- global automation paused flag
- daily AI research limit
- daily generation limit
- provider availability
- company status
- existing duplicate job

## Human Approval

Cold outreach must not be sent automatically in MVP.

The app can:
- generate emails
- generate personalized pages
- export approved contacts to CSV

But the user must approve before export/sending.
