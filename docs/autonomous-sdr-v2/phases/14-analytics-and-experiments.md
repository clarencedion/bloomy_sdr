# Phase 14 — Full-Funnel Analytics & Closed-Loop Learning

## Objective
Build **Full-Funnel Conversion Analytics** and the **Closed-Loop Performance Learning Engine** to track metrics across all outbound stages, evaluate conversion rates by dimension (Business, Offer, Campaign, NAF, Persona, Signal, Angle), and recommend top-performing signals and angles for future campaigns.

## Why this phase exists
To close the loop on SDR performance, transforming the system from a static sender into an autonomous learning engine that doubles down on what generates booked meetings.

## Requirements covered
* **REQ-077**: Full-Funnel Conversion Analytics
* **REQ-078**: Dimension Performance Breakdown
* **REQ-079**: Closed-Loop Learning Recommendations

## Existing code to inspect
* `src/app/(app)/app/analytics/page.tsx`
* `src/features/dashboard/dashboard-shell.tsx`
* `src/lib/firebase/firestore.ts`

## Existing code to preserve
* Dashboard KPI cards and Recharts library integration.

## Architecture
* **Analytics Aggregator:** Cloud Function scheduled daily or on-demand calculating:
  * Stage counts: Discovered → Qualified → Contacted → Replied → Positive Reply → Meeting Booked → Won.
  * Conversion funnels: Discovered-to-Qualified %, Contacted-to-Reply %, Reply-to-Meeting %, Overall Discovery-to-Meeting %.
* **Dimension Breakdown Engine:** Slices performance by:
  * Signal Module (e.g. "Low PageSpeed" vs "Missing E-Commerce" vs "Hiring Sales Reps").
  * Copywriting Angle Variant (e.g. "Google Review Contrast" vs "Mobile Conversion Friction").
  * Persona Role (e.g. "Fondateur" vs "Directeur Marketing").
* **Closed-Loop Learning Engine:** Computes a statistical conversion index per signal and angle; surfaces actionable recommendations on the Campaign Builder modal (e.g. *"In French Florist campaigns, the 'Google Review Contrast' angle generates 3.2x higher meeting rates"*).

## Data/schema changes
* Create `analyticsDaily/{dateId}` collection.
* Create `performanceInsights/{businessId_offerId}` document.

## Backend changes
* Implement `functions/src/services/analytics-service.ts`.
* Implement `functions/src/services/learning-service.ts`.
* Implement `functions/src/jobs/daily-analytics-aggregator.ts`.

## Frontend changes
* Upgrade `src/app/(app)/app/analytics/page.tsx` from placeholder to full Recharts analytics dashboard:
  * Funnel drop-off visualization.
  * Signal effectiveness comparison chart.
  * Angle conversion breakdown table.
  * Learning recommendations card.

## External APIs
* None.

## Security considerations
* Ensure analytics aggregation queries are strictly isolated by `workspaceId` and `businessId`.

## Migration/backfill
* Generate initial analytics snapshot from existing historical database records.

## Tests to write FIRST or alongside implementation
* `tests/analytics/funnel-calculation.test.ts`: Test calculation of stage counts and conversion percentages.
* `tests/analytics/dimension-breakdown.test.ts`: Test grouping conversion metrics by signal provider and persona.
* `tests/analytics/learning-recommendations.test.ts`: Test that signals yielding meetings receive higher ranking scores.

## E2E scenarios
* Open `/app/analytics`; verify that real funnel charts, dimension breakdown tables, and learning recommendations render based on stored database activity.

## Definition of done
* [ ] Full-funnel conversion charts operational in UI.
* [ ] Dimension breakdown by Signal, Persona, and Angle functional.
* [ ] Closed-loop learning recommendations generated.
* [ ] Tests pass; Reviewer verdict PASS.
* [ ] `ACCEPTANCE_MATRIX.md` updated for REQ-077 through REQ-079.

## Reviewer checklist
* [ ] Are meetings booked the primary conversion metric?
* [ ] Does the analytics dashboard render real aggregated data?
* [ ] Are metrics properly scoped per Business?

## Explicitly out of scope
* Distributed queue worker migration (deferred to Phase 15).
