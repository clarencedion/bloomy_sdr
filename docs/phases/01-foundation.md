# Phase 1 — Foundation

## Goal

Create the foundation of the app:
- Firebase project structure
- Auth
- polished SaaS layout
- routing
- Firestore types
- dashboard shell
- companies page
- company detail page
- CSV import skeleton
- settings page
- logs page
- Cloud Functions skeleton

Do not implement AI yet.

## Required Features

### 1. App Shell

Create:
- sidebar navigation
- top bar
- user menu
- global search placeholder
- responsive layout
- loading states

Navigation:
- Dashboard
- Companies
- Contacts
- Campaigns
- AI Research Queue
- Outreach
- Meetings
- Calendar
- Analytics
- Settings
- Logs

### 2. Auth

Use Firebase Auth.

Required:
- login page
- logout
- protected routes
- current user context
- role field prepared for future

For MVP, allow only authenticated users.

### 3. Dashboard Shell

Show cards:
- total companies
- researched companies
- qualified leads
- approved leads
- contacted leads
- replies
- meetings booked
- estimated AI cost

Use placeholder data if Firestore empty, but wire queries where possible.

### 4. Companies Page

Features:
- table with filters
- search by name/domain/city
- status pills
- fit score column
- import button
- create company button
- open company detail

### 5. Company Detail Page

Tabs:
- Overview
- AI Research
- Contacts
- Outreach
- Generated Page
- Meetings
- Activity
- Notes

Phase 1 can show placeholders for tabs not implemented yet.

### 6. CSV Import Skeleton

Allow CSV upload with fields:
- company name
- website
- city
- industry
- contact first name
- contact last name
- contact role
- contact email
- phone
- LinkedIn URL
- source

Implement:
- parse CSV
- preview rows
- import companies and contacts
- basic deduplication by domain/email

### 7. Settings Page

Create editable settings:
- automationPaused
- aiProvider
- dailyAiResearchLimit
- dailyEmailGenerationLimit
- requireApprovalBeforeExport
- defaultLanguage
- companyContext
- outlookCalendarId

### 8. Logs Page

Create logs table:
- date
- level
- type
- message
- metadata viewer

### 9. Cloud Functions Skeleton

Create:
- functions/src/index.ts
- providers folder
- services folder
- jobs folder
- utils folder
- log helper
- settings helper

No real AI calls yet.

## Acceptance Criteria

- App runs locally
- User can log in/out
- Sidebar works
- Companies can be manually created
- CSV import works at basic level
- Settings are saved to Firestore
- Logs page can display logs
- Functions folder compiles
- README explains setup

## Stop After Phase 1

After this phase, stop and provide:
- files created/modified
- local test steps
- Firebase deployment notes
- next phase checklist
