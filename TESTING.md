# Autonomous SDR V2 — Testing & Verification Runbook

This document is the authoritative engineering runbook for testing, verifying, and safely operating the **Autonomous SDR V2** platform across local, staging, and production environments.

---

## ⚡ 1. System Overview & Safety Invariants

Autonomous SDR V2 is a multi-business, offer-agnostic outbound sales intelligence system with strict built-in safety controls:

1. **Offer-Agnostic Core:** Generic services contain **zero hardcoded business branching** (`biz_bloomy` and `biz_devcomm` run on the exact same generic engine).
2. **Guaranteed Safety Containment:** When **Test Mode** is enabled (`testModeEnabled: true`), the contactability gatekeeper (`canContact`) **strictly blocks** any email address not present in the explicit `testEmailAllowlist`.
3. **Zero Secret Leakage:** AI and integration credentials reside in server-isolated documents (`settings/aiSecrets`, `settings/integrationSecrets`) with zero client read access.
4. **Prompt Injection Defense:** External data (scraped web text, inbound prospect emails) is wrapped in strict `<untrusted_prospect_content>` boundaries with negative prompting.
5. **Evidence Grounding (FACT != INFERENCE):** Numerical claims (Google review counts, ratings, PageSpeed scores, headcount) must be backed by verified `EvidenceItem` records with confidence $\ge 70\%$.
6. **Real Calendar Truth:** Meeting slots reflect live Microsoft Graph free/busy availability; double bookings are prevented atomically and outbound sequences terminate immediately upon booking.
7. **Webhook Idempotency:** Inbound deliveries are deduplicated atomically using Firestore transactions.

---

## 🛠️ 2. Local Environment Setup & Exact Commands

### Prerequisites
* **Node.js:** v20+ / v22+
* **npm:** v10+
* **Firebase CLI:** `npm install -g firebase-tools` (or use `npx firebase-tools`)

### Path Setup (macOS Homebrew)
```bash
export PATH=$PATH:/opt/homebrew/bin
```

### Installation
```bash
# Install root Next.js dependencies
npm install

# Install Cloud Functions dependencies
npm run --prefix functions install
```

### Full Verification Commands
Execute these commands to validate type safety, linting, test suites, and production build output:

```bash
# 1. Typecheck frontend & backend
npm run typecheck
npm run --prefix functions typecheck

# 2. Lint check
npm run lint

# 3. Automated Test Suites (548+ tests across 171 test files)
npm test
npm run --prefix functions test

# 4. Production Builds
npm run build
npm run --prefix functions build
```

### Starting the Local Development Server
```bash
# Start Next.js frontend dev server (runs on http://localhost:3000)
npm run dev
```

---

## 🔑 3. Environment Variables Reference

Autonomous SDR V2 operates in two configurations:

### Option A: Zero-Cost Mock Mode (Default / Offline)
* **No external API keys required!**
* When API keys are omitted, the platform automatically engages:
  - `MockAiProvider`: Deterministic, lightning-fast LLM responses for research, copy generation, and reply classification.
  - `MockSignalProvider`: Generates deterministic Google Places, SIRENE, and PageSpeed evidence.
  - `MockCalendarService`: Computes conflict-free business slots and generates synthetic meeting events.

### Option B: Live Production / Staging Mode
To connect live third-party services, configure credentials in Firebase Firestore under `settings/aiSecrets` and `settings/integrationSecrets` (via the **Settings → AI & Integrations** UI or Firebase Admin SDK):

| Service | Setting Key | Description |
|---|---|---|
| **OpenAI** | `openAiApiKey` | GPT-4o / GPT-4o-mini for copy & ICP translation |
| **Anthropic** | `anthropicApiKey` | Claude 3.5 Haiku / Sonnet |
| **Instantly.ai** | `instantlyApiKey` | Cold email dispatch & campaign management |
| **Instantly Webhook** | `instantlyWebhookSecret` | HMAC-SHA256 signature verification key |
| **Dropcontact** | `dropcontactApiKey` | Decision maker email enrichment waterfall |
| **Microsoft Graph** | `microsoftClientId`, `microsoftClientSecret`, `microsoftRefreshToken`, `microsoftTenantId` | Outlook calendar 2-way sync & meeting creation |
| **Google Search (Serper)** | `serperApiKey` | Live website domain resolution |
| **Pappers.fr** | `pappersApiKey` | French corporate financial & legal registry |

---

## 🧪 4. Testing Mode 1: One-Click SDR Demo Mode (Zero Cost & Fast)

Use the built-in **One-Click SDR Demo Mode** to validate all 8 stages of the outbound sales engine in seconds with zero external API costs.

### How to Run the One-Click Demo
1. Open the local application: [`http://localhost:3000/app/dashboard`](http://localhost:3000/app/dashboard).
2. Notice the yellow **🧪 Mode Test SDR** banner at the top of the screen.
3. Click the blue **⚡ Démo SDR 1-Clic** button in the banner (or in Settings).
4. Select your test parameters:
   - **Archetype:** 
     - `Bloomy`: Florists in Nantes (`47.76Z`) $\rightarrow$ Google Places reviews (142, 4.8/5) + PageSpeed (28/100) $\rightarrow$ Website redesign offer.
     - `Devcomm`: Industrial SMEs in Pays de la Loire (`25.62B`) $\rightarrow$ Headcount (45 employees) + Hiring signals $\rightarrow$ Commercial training offer.
   - **Prospect Reply Scenario:**
     - `BOOKING_REQUEST`: Simulates positive reply $\rightarrow$ calculates open slots $\rightarrow$ books calendar meeting.
     - `QUESTION`: Simulates pricing question $\rightarrow$ answers from Knowledge Base.
     - `OBJECTION`: Simulates competitor objection $\rightarrow$ generates objection counter.
     - `UNSUBSCRIBE`: Simulates opt-out $\rightarrow$ adds contact & domain to suppression list.
     - `OUT_OF_OFFICE`: Simulates auto-responder $\rightarrow$ ignores without penalizing sequence.
5. Click **Lancer la Démo SDR Complète**.
6. Watch the live 8-stage visual stepper execute in real time:
   - Stage 1: Campaign & ICP Strategy
   - Stage 2: SIRENE Lead Discovery
   - Stage 3: Pluggable Signal Extraction & Provenance
   - Stage 4: Multi-Factor Opportunity Scoring & Angle Selection
   - Stage 5: Grounded Copywriting & Claim Validation
   - Stage 6: Security Gatekeeper & Contactability Validation
   - Stage 7: Inbound Reply Triage & Intent Classification
   - Stage 8: Calendar Free/Busy Slot Negotiation & Instant Booking
7. Inspect the generated artifacts in the **Inspection des Données** tab:
   - Evidence records with confidence ratings.
   - Factual email draft with zero hallucinations.
   - Reply triage reasoning and suggested action.
   - Confirmed calendar meeting.

---

## ✉️ 5. Testing Mode 2: Real-Email Safe Testing via Email Allowlist

To test live email dispatch, inbound email ingestion, and real Outlook calendar booking **safely without emailing real prospects**:

### Step 1: Configure Your Personal Email in the Allowlist
1. In the Top Banner, click **Gérer Allowlist** (or navigate to **Settings → AI & Integrations → SDR Test Mode & Safety Email Allowlist**).
2. Ensure **Verrou de Sécurité Test Mode** is **Actif (Containment ON)**.
3. Enter your own personal or testing email address (e.g., `your.name@company.com`) and click **Ajouter**.

> [!CAUTION]
> **Safety Containment Guarantee:**
> With Test Mode enabled, any attempt to dispatch outreach to an email address not present in this list will be immediately rejected with:
> `test_mode_allowlist_blocked: Contact email is not authorized in test mode allowlist`.

### Step 2: Create a Test Lead with Your Allowlisted Email
1. Navigate to **Contacts** (`/app/contacts`) or **Discovery** (`/app/discovery`).
2. Add or edit a lead and set their contact email to your allowlisted address.
3. Generate outreach copy in **Outreach Editor** (`/app/outreach`).
4. Click **Approve Draft**.
5. Click **Send Outreach**:
   - The platform verifies that the email is in your allowlist.
   - The email is dispatched to your personal inbox.

### Step 3: Test Inbound Reply Handling
1. Reply to the received email from your personal inbox (e.g. *"Bonjour, je suis disponible jeudi à 14h30 pour en parler."*).
2. Instantly webhook ingests the reply into `/api/webhooks/instantly`.
3. Open **SDR Inbox** (`/app/inbox`):
   - Notice the conversation marked `in_dialogue` with intent `BOOKING_REQUEST`.
   - The proposed meeting slot is generated in French.
   - Click **Book Meeting** to confirm the event in your connected Outlook calendar.

---

## 📋 6. 10-Lead Production Smoke Test Protocol

Before launching high-volume production campaigns, run this 10-lead verification checklist:

| Step | Action | Expected Output | Verification Check |
|---|---|---|---|
| **1. ICP Setup** | Create new campaign via Natural Language ICP Translator: *"PME industrielles en Pays de la Loire avec 20 à 100 salariés"* | Generated campaign with NAF `25.62B`, city `Nantes/Cholet`, persona `Directeur Commercial`. | Check Campaign Doc in `/app/campaigns`. |
| **2. Lead Discovery** | Run Discovery query for 10 companies. | 10 companies retrieved from Recherche d'Entreprises / SIRENE with valid SIREN, city, and resolved domain. | Check Discovery Table in `/app/discovery`. |
| **3. Evidence Enrichment** | Trigger Enrichment for all 10 companies. | Pluggable providers collect evidence (`EvidenceItem[]`) with timestamp and confidence score. | Check Company Detail Evidence Tab. |
| **4. Opportunity Scoring** | Compute Opportunity Scores. | Companies segmented into Tier A ($\ge 80$), Tier B ($60-79$), Tier C ($<60$). | Check Opportunity Score badges in `/app/companies`. |
| **5. Decision Maker Waterfall** | Run contact waterfall enrichment. | Verified email, phone, and prioritized persona (e.g. Gérant or Directeur Commercial). | Check Contacts Table in `/app/contacts`. |
| **6. Grounded Copywriting** | Generate personalized outreach drafts. | French cold email generated with 2-3 specific evidence claims; claim validator passes (`passed: true`). | Check Outreach drafts in `/app/outreach`. |
| **7. Gatekeeper Validation** | Validate `canContact(...)` on all 10 contacts. | Valid contacts marked contactable; blacklisted/suppressed contacts rejected with explicit reason. | Verify suppression log in `/app/logs`. |
| **8. Human Review & Approval** | Review drafts in Outreach Editor and approve 5 drafts. | Outreach status transitions from `draft` to `approved`. | Check Approved filter in `/app/outreach`. |
| **9. Controlled Dispatch** | Trigger dispatch for approved outreach. | Email delivered via Instantly API; contact and company status transition to `contacted`. | Check Instantly campaign dashboard. |
| **10. Inbox Triage & Booking** | Simulate or receive prospect reply; book slot. | Reply classified; meeting created atomically in Firestore & Outlook; sequence steps terminated. | Check `/app/inbox` and `/app/meetings`. |

---

## 🔒 7. Security & Invariant Audit Checklist

Run this quick command-line verification checklist before any production deployment:

```bash
# 1. Verify zero business branching in generic code
! grep -rnE "if.*(business ===|businessName ===|biz_bloomy)" functions/src/services/ src/lib/

# 2. Verify all 548 automated tests pass cleanly
npm test && npm run --prefix functions test

# 3. Verify zero TypeScript errors
npm run typecheck && npm run --prefix functions typecheck

# 4. Verify clean production build output
npm run build && npm run --prefix functions build
```

---

## ❓ 8. Frequently Asked Questions & Troubleshooting

### Q: Why is outreach dispatch blocked with `test_mode_allowlist_blocked`?
**A:** Test Mode is currently enabled (`testModeEnabled: true`) and the target email address is not in your allowlist. To test with this address, add it in **Settings → SDR Test Mode & Safety Email Allowlist** or in the top banner allowlist manager.

### Q: How do I turn off Test Mode for live production campaigns?
**A:** In **Settings → AI & Integrations → SDR Test Mode & Safety Email Allowlist**, toggle **Verrou de Sécurité Test Mode** to **Désactivé (Production)** and click Save.

### Q: What happens if Microsoft Graph is not configured?
**A:** The platform gracefully engages `MockCalendarService`, calculating valid business slots (09:00–18:00 Europe/Paris) and generating synthetic meeting IDs (`evt_offline_...`) so you can test end-to-end booking workflows without requiring Microsoft 365 admin credentials.
