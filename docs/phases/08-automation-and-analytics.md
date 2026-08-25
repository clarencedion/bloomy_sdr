# Phase 7 — Automation and Analytics

## Goal

Add scheduled 24/7 automation and analytics.

## Scheduled Functions

Implement:

### dailyResearchQueueRunner
Runs daily.
Processes pending research jobs up to daily limit.

### hourlyOutreachStatusSync
Runs hourly.
Syncs status from providers if configured.

### calendarSyncJob
Runs every 15-60 minutes.
Syncs Outlook/calendar events.

### dailyAnalyticsAggregator
Runs daily.
Calculates dashboard metrics.

### cleanupOldLogs
Runs weekly.
Deletes old debug/info logs beyond retention period.

## Automation Controls

Add:
- Pause Automation button
- daily AI research limit
- daily generation limit
- emergency stop
- last job run
- job errors

## Analytics Page

Charts:
- companies imported over time
- research completed over time
- average fit score
- outreach by status
- reply rate
- meeting booking rate
- campaign comparison
- AI cost over time

Use Recharts.

## Acceptance Criteria

- Scheduled functions are implemented
- Limits are respected
- Automation can be paused
- Analytics page shows real aggregated data
