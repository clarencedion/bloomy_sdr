# Devcomm Sales OS

Phase 1 foundation for Devcomm Sales OS: a Firebase-backed, TypeScript SaaS workspace for clean company data, protected access, CSV import, settings, logs, and Cloud Functions v2 scaffolding.

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui-style components
- Firebase Auth
- Firestore
- Firebase Hosting
- Cloud Functions v2, Node 22

## Setup

1. Install dependencies:

```bash
npm install
npm --prefix functions install
```

2. Create a Firebase project and enable:

- Authentication with Email/Password
- Firestore
- Hosting
- Cloud Functions

3. Copy environment files:

```bash
cp .env.example .env.local
cp .firebaserc.example .firebaserc
```

4. Fill `.env.local` with the Firebase web app config. These are public Firebase client identifiers, not secrets.

5. Update `.firebaserc` with your Firebase project ID.

## Run Locally

```bash
npm run dev
```

Open `http://localhost:3000`.

To run Firebase emulators:

```bash
firebase emulators:start
```

## Checks

```bash
npm run lint
npm run typecheck
npm run build
npm --prefix functions run build
```

## Phase 1 Test Flow

1. Create an Email/Password user in Firebase Auth.
2. Visit `/login` and sign in.
3. Confirm `/app/dashboard` loads and protected routes redirect when signed out.
4. Open `/app/companies` and create a company manually.
5. Open the company detail page and verify Overview, Contacts, and placeholder tabs.
6. Open `/app/import` and upload a CSV with fields such as:
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
7. Confirm preview warnings for duplicates, missing domains, missing source, and incomplete rows.
8. Import rows and confirm companies/contacts are created or merged without overwriting good data with empty values.
9. Open `/app/settings`, save global settings, then reload.
10. Open `/app/logs` and confirm events are visible.

## Data Quality Rules

Phase 1 prepares the app for reliable future lead discovery:

- Companies require a real name.
- Placeholder values such as `N/A`, `unknown`, `null`, `-`, and empty strings are ignored.
- Domains, names, emails, phones, SIREN, and SIRET are normalized before save.
- Companies are deduplicated by domain, SIREN, SIRET, or normalized name + city.
- Contacts are deduplicated by normalized email.
- Raw provider/import data is retained separately from normalized fields.
- Existing good values are not overwritten by empty or worse incoming values.
- Data quality warnings and quality scores are stored on company/contact records.
- No company is marked qualified in Phase 1.

## Firebase Deployment Notes

Deploy hosting and Firestore rules:

```bash
firebase deploy --only hosting,firestore
```

Deploy functions:

```bash
npm --prefix functions run build
firebase deploy --only functions
```

No frontend secrets are required or allowed. Future provider API keys should use Google Secret Manager.

## Phase 2 — Autonomous Lead Discovery

Phase 2 adds `/app/discovery` with:

- discovery campaign creation
- a Devcomm B2B sales-force campaign template using public-data proxy signals
- deterministic Manual/Test discovery provider for local development
- run history and provider stats
- discovered company table
- rejected/skipped discovery table
- deduplication before company creation
- quality and discovery scoring
- queueing high-score/high-quality companies as `research_pending`
- `leadResearch` pending queue documents only; no AI research execution yet

Real provider structure is prepared in Cloud Functions:

- `RechercheEntreprisesProvider` is the default free discovery provider for French public company data.
- `SireneDiscoveryProvider` is prepared for official SIREN/SIRET, status, NAF/APE, legal-name, and establishment validation.
- `SireneStockProvider` is prepared for future low-cost bulk discovery from monthly Stock Sirene files.
- `GooglePlacesDiscoveryProvider` is optional enrichment for website/local presence when configured.
- `PappersDiscoveryProvider` is optional premium enrichment only and requires explicit enablement.
- `scheduledLeadDiscoveryRunner` exists but respects `settings/global.automationPaused`.

To test locally:

1. Open `/app/discovery`.
2. Use the default template `Force de vente B2B - secteurs references Devcomm` or click `Use first test mode`.
3. Confirm provider priority is `recherche_entreprises,sirene,google_places`.
4. Run it manually. The app tries Recherche d'Entreprises first; Manual/Test is only used if you explicitly add `manual` to the provider priority.
5. Confirm created companies appear in `/app/companies`.
6. Confirm low-quality/weak records appear in the rejected/skipped section instead of `companies`.
7. Confirm discovery reasons separate sector, sales-force, NAF, keyword, location, employee, negative, and quality signals.
8. Confirm companies above thresholds become `research_pending` and get a pending `leadResearch` document.

Pappers is optional premium enrichment, not default discovery. To enable it in deployed Functions, set a server-side environment/secret named `PAPPERS_API_KEY` and set `ENABLE_PAPPERS_ENRICHMENT=true`. Do not put this key in `.env.local` or frontend code.

## Phase 3 — AI Research Engine

Phase 3 adds structured AI research only. It does not generate outreach, send email, or create personalized pages.

What is included:

- `researchCompanyNow` callable Cloud Function
- `queueResearch` callable Cloud Function
- `skipResearch` callable Cloud Function
- safe homepage text fetcher with timeout, user-agent, HTML cleanup, and text limit
- OpenAI provider if `OPENAI_API_KEY` is configured
- Anthropic provider if `ANTHROPIC_API_KEY` is configured
- Mock provider if no AI key is configured
- Zod validation for structured research JSON
- `leadResearch` result storage with `rawInput`, `rawOutput`, provider/model, prompt version, confidence, source URLs, timestamps, and errors
- company updates for `status`, `fitScore`, `bestOffer`, `tags`, and `lastActivityAt`
- Company Detail AI Research tab
- AI Research Queue page

Server-side environment variables:

```bash
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini

ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-3-5-haiku-latest
```

If no AI key is configured, the Functions backend uses the Mock provider so the full app flow can still be tested without external AI cost.

Before testing research, make sure global settings are not paused:

1. Open `/app/settings`.
2. Set Automation to `Active`.
3. Save settings.

Deploy Functions after changing provider env/secrets:

```bash
npm --prefix functions run build
firebase deploy --only functions
```

Test from the UI:

1. Open `/app/companies`.
2. Open a company detail page.
3. Go to `AI Research`.
4. Click `Run AI research`.
5. Confirm a `leadResearch` document is created.
6. Confirm the company receives `fitScore`, `bestOffer`, and a researched/qualified/rejected status.
7. Open `/app/research` to see queue status, retry failures, run selected, or skip pending items.

## Phase 4 — Outreach Generation

Phase 4 adds draft outreach generation and approval only. It does not send email, export CSV, call Resend, Smartlead, or Instantly, and it does not publish personalized pages.

What is included:

- `generateOutreachNow` callable Cloud Function
- `updateOutreachDraft` callable Cloud Function
- `approveOutreach` callable Cloud Function
- `rejectOutreach` callable Cloud Function
- `markOutreachNeedsResearch` callable Cloud Function
- OpenAI/Anthropic structured outreach generation when provider keys are configured
- Mock French outreach generation when no AI key is configured
- Zod validation for outreach JSON
- Company Detail `Outreach` tab with contact selector, generation, editor, approve/reject/regenerate/needs-more-research actions
- `/app/outreach` draft dashboard with filters, risk warnings, bulk approve/reject, and disabled Phase 5 export placeholder
- Companies page outreach count/filter

Outreach statuses in this phase:

- `draft`
- `approved`
- `rejected`
- `needs_more_research`

No status can become `sent` or `exported` in Phase 4.

Test with mock provider:

1. Run AI research for a company first.
2. Open that company detail page.
3. Go to `Outreach`.
4. Click `Generate outreach`.
5. Edit subject/body/follow-ups/LinkedIn notes.
6. Save edits.
7. Approve, reject, regenerate, or mark needs more research.
8. Open `/app/outreach` and confirm the draft appears.

Test with real AI provider:

1. Configure `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` server-side for Functions.
2. Redeploy Functions:

```bash
npm --prefix functions run build
firebase deploy --only functions
```

3. Generate outreach again and confirm provider/model metadata in the UI.
