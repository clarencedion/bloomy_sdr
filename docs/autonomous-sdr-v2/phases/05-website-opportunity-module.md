# Phase 05 — Website Opportunity Module

## Objective
Build the **Website Opportunity Signal Provider** family to empower Bloomy Digital Studio (and future web/SEO agencies) with deep technical auditing: Google PageSpeed Insights, CMS/tech stack detection (WordPress, Wix, Shopify), mobile responsiveness, SSL validity, e-commerce/ordering presence, and legacy technical signals (copyright years, broken links).

## Why this phase exists
Audit Finding #3 revealed that the existing system performed only bare HTTP text scraping (max 12k chars). Selling website makeovers and e-commerce solutions requires objective, verifiable technical observations (e.g. *"Your mobile speed is 28/100"*, *"You have 140 Google reviews but no online ordering"*).

## Requirements covered
* **REQ-029**: Anti-Annuaire Website Resolver
* **REQ-030**: Website Presence & SSL Audit
* **REQ-031**: PageSpeed & Core Web Vitals Audit
* **REQ-032**: Mobile UX & Responsiveness Check
* **REQ-033**: CMS & Technology Detection
* **REQ-034**: E-Commerce & Ordering Audit
* **REQ-035**: Booking Widget Detection
* **REQ-036**: Outdated Technical Signals

## Existing code to inspect
* `functions/src/services/website-resolver.ts`
* `functions/src/services/website-fetcher.ts`
* `functions/src/services/company-enrichment.ts`

## Existing code to preserve
* Anti-annuaire domain blacklist in `website-resolver.ts` (60+ directory domains).

## Architecture
* Implement `WebsiteTechnicalProvider` implementing the `SignalProvider` interface.
* Integrate Google PageSpeed Insights REST API (`https://www.googleapis.com/pagespeedonline/v5/runPagespeed`) for performance, LCP, and mobile friendliness.
* Implement HTML AST / regex analyzer to extract:
  * CMS signatures (`wp-content` for WordPress, `wixstatic` for Wix, `cdn.shopify.com` for Shopify, PrestaShop).
  * E-Commerce signals (presence of cart buttons, checkout scripts, Stripe/PayPal SDKs).
  * Booking widget signals (Calendly, Doctolib, Planity, Zenfirst).
  * Outdated signals (copyright year in footer > 3 years old, fixed HTML tables, missing viewport).
  * SSL status (HTTPS handshake vs plain HTTP).

## Data/schema changes
* Writes standardized `EvidenceItem` records with keys:
  * `has_website`, `ssl_active`, `mobile_pagespeed_score`, `lcp_seconds`, `mobile_friendly`, `cms_detected`, `has_online_ordering`, `has_booking_widget`, `outdated_copyright_year`.

## Backend changes
* Implement `functions/src/providers/signals/pagespeed-provider.ts`.
* Implement `functions/src/providers/signals/website-technical-provider.ts`.
* Implement `functions/src/providers/signals/website-ecommerce-provider.ts`.
* Update `functions/src/services/website-resolver.ts` to attach resolved domain evidence.

## Frontend changes
* Display website technical audit badges (PageSpeed score, CMS pill, Mobile friendly icon, E-Commerce status) in Company Detail and Research views.

## External APIs
* Google PageSpeed Insights REST API (Free: 25,000 queries/day).

## Security considerations
* Enforce 8-second HTTP request timeouts to prevent slowloris/DoS when crawling prospect websites.
* Do not follow recursive redirect loops.

## Migration/backfill
* None required.

## Tests to write FIRST or alongside implementation
* `tests/signals/pagespeed.test.ts`: Test parsing of Google PageSpeed API fixture; assert extraction of mobile score, LCP, and FCP.
* `tests/signals/cms-detection.test.ts`: Test detection of WordPress, Wix, Shopify, PrestaShop from HTML snippets.
* `tests/signals/ecommerce-detection.test.ts`: Test detection of cart buttons, checkout scripts, and online ordering presence/absence.
* `tests/signals/outdated-signals.test.ts`: Test extraction of copyright year (e.g. `© 2017` flagged as outdated) and missing mobile viewport.

## E2E scenarios
* Run website technical audit against a sample artisan florist website; verify evidence items created for PageSpeed, WordPress CMS, missing e-commerce, and valid SSL.

## Definition of done
* [ ] PageSpeed Insights API integration operational with mock fallback.
* [ ] CMS, e-commerce, booking, and outdated signal detectors implemented.
* [ ] Evidence items stored in Firestore with provenance.
* [ ] Tests pass; Reviewer verdict PASS.
* [ ] `ACCEPTANCE_MATRIX.md` updated for REQ-029 through REQ-036.

## Reviewer checklist
* [ ] Is the PageSpeed API key optional with clean mock fallback?
* [ ] Are timeouts enforced on all external HTTP fetches?
* [ ] Does the website audit provider execute ONLY when requested by the campaign strategy?

## Explicitly out of scope
* Opportunity score calculation (deferred to Phase 06).
