# External Provider Strategy & API Research Protocol

This document establishes the mandatory protocol for integrating third-party APIs, verifying current official documentation, managing credentials, and handling provider failures.

---

## 📖 Mandatory API Research Protocol

> **NEVER implement or modify an external provider integration based purely on remembered API knowledge or legacy code.**

Third-party API endpoints, payload formats, authentication headers, and webhook signatures change frequently.

### The 5-Step Integration Protocol:
1. **Identify Integration Target:** Determine the exact provider and required capability.
2. **Consult Official Documentation:** Fetch and read the **CURRENT** official API reference documentation.
3. **Verify Technical Details:**
   * Authentication mechanism (Bearer token, API key header, OAuth2 flow).
   * Exact endpoint URLs and version tags (e.g. `v1` vs `v2`).
   * Request JSON structure and required headers.
   * Response schema, error codes, and rate limits.
   * Webhook schemas and cryptographic signature verification headers.
4. **Record Findings in Phase Spec:** Document endpoint URLs and payload examples in the corresponding phase file or ADR.
5. **Implement Bounded Adapter with Mock Fallback:** Build a clean adapter class implementing the domain interface, with unit test fixtures and mock fallback for zero-credential testing.

---

## 🔌 Provider Inventory & Strategy

### 1. Company Discovery & Legal Data
* **API Recherche d'Entreprises (DINUM / data.gouv.fr):**
  * *Status:* Primary French Gov Registry (100% Free & Open).
  * *Endpoint:* `https://recherche-entreprises.api.gouv.fr/search`
  * *Strategy:* Retain existing working provider. Paginates with NAF 25-code chunking and exponential backoff.
* **Serper.dev (Google Places & Search):**
  * *Status:* Primary Local Business & Website Resolver.
  * *Endpoint:* `https://google.serper.dev/places`, `https://google.serper.dev/search`
  * *Strategy:* Retain working client. Used to discover local merchants and resolve official company websites.
* **Pappers API (Optional Legal Fallback):**
  * *Status:* Optional paid legal fallback.
  * *Strategy:* Kept disabled by default (`ENABLE_PAPPERS_ENRICHMENT=false`) to protect user credits.

---

### 2. Contact Discovery & Verification
* **Dropcontact API:**
  * *Status:* Primary French B2B decision-maker enrichment.
  * *Endpoint:* `https://api.dropcontact.com/v1/enrich/all`
  * *Strategy:* Retain working batch submission and async polling client. Filters out accounting/legal roles.
* **Secondary Provider Waterfall (Optional / Future):**
  * *Strategy:* Design the `ContactEnrichmentProvider` interface so secondary providers (e.g. Prospeo or Hunter) can be plugged in as fallbacks if Dropcontact returns 0 contacts.

---

### 3. Web & Performance Auditing
* **Google PageSpeed Insights API:**
  * *Status:* Primary Website Technical Audit Engine.
  * *Endpoint:* `https://www.googleapis.com/pagespeedonline/v5/runPagespeed`
  * *Strategy:* Free tier provides 25,000 queries/day. Returns objective performance scores (0–100), Core Web Vitals (LCP, FCP), and mobile usability flags.

---

### 4. Cold Email Dispatch & Sequencing
* **Instantly.ai (V2 Model):**
  * *Status:* Primary Cold Outreach Dispatcher.
  * *Endpoints:* `https://api.instantly.ai/api/v1/lead/add`, `https://api.instantly.ai/api/v1/campaign/create`
  * *Webhooks:* Inbound webhook receiver for `reply_received`, `bounced`, and `unsubscribed` events.
  * *Strategy:* Upgrade from hourly polling to real-time webhook ingestion for incoming reply text.

---

### 5. Calendar & Meeting Tracking
* **Microsoft Graph API (Outlook):**
  * *Status:* Primary Calendar Integration.
  * *Endpoints:* `https://login.microsoftonline.com`, `https://graph.microsoft.com/v1.0/me/calendarView`
  * *Strategy:* Retain working OAuth2 refresh token job; extend with conversational free/busy slot queries.
* **Google Calendar / Cal.com (Optional Future):**
  * *Strategy:* Implement generic `CalendarProvider` interface to allow plugging in Google Calendar or Cal.com without changing scheduling logic.

---

## 🛑 Zero-Credential & Mock Testing Strategy

To ensure that developers and CI/CD pipelines can test the entire SDR pipeline without requiring live third-party API keys:
1. **Deterministic Mock Providers:** Every provider interface must have a companion Mock class (e.g. `MockAIProvider`, `MockDiscoveryProvider`, `MockEnrichmentProvider`, `MockEmailProvider`).
2. **Fixture-Driven Integration Tests:** Tests assert against saved JSON response fixtures matching real API payloads.
3. **Graceful Degradation:** If an optional API key is not configured, the system logs a descriptive warning and disables only that specific provider without failing the entire campaign.
