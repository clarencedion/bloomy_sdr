# Phase 2 — AI Research Engine

## Goal

Implement AI-powered company research.

## Features

### Backend Function

Create:

```ts
researchCompany(companyId: string)
```

It must:
1. Fetch company from Firestore
2. Fetch website text if website exists
3. Clean and truncate website text
4. Build AI prompt
5. Call configured AI provider
6. Require structured JSON output
7. Validate output
8. Store result in leadResearch
9. Update company:
   - status
   - fitScore
   - bestOffer
   - tags
   - lastActivityAt
10. Log success/error

### Queue

Add:
- mark company as research_pending
- process pending companies manually
- scheduled queue runner later in Phase 7

### AI Output Schema

```json
{
  "companySummary": "...",
  "segment": "commercial_performance | training_hr | road_safety | low_fit",
  "fitScore": 0,
  "confidence": 0,
  "detectedNeeds": [],
  "painPoints": [],
  "buyingTriggers": [],
  "bestDevcommOffer": "...",
  "targetPersonas": [],
  "personalizedAngle": "...",
  "reasoningSummary": "...",
  "risks": [],
  "recommendedNextAction": "approve_outreach | enrich_more | reject",
  "sourceUrls": []
}
```

### Frontend

Add to company detail:
- Run AI Research button
- Research status
- fit score card
- summary
- detected needs
- target personas
- risks
- best offer
- regenerate button

Add AI Research Queue page:
- pending
- running
- completed
- failed
- retry failed

## Safety

- Never fabricate precise facts.
- If website cannot be fetched, use available company fields only.
- Store concise reasoning summary, not hidden chain-of-thought.
- Respect daily research limit.
- Respect automation pause.

## Acceptance Criteria

- User can run research for one company
- Result appears in UI
- Company score updates
- Errors are logged
- Structured JSON is validated
