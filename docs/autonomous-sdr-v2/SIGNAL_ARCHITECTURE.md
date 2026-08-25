# Generic Signal Provider & Evidence Architecture

This document defines the pluggable **Signal Provider Architecture** that enables Autonomous SDR V2 to support completely unrelated businesses and offers without polluting generic engine code.

---

## 🧩 The Signal Provider Interface

Every signal module implements the standard TypeScript interface:

```typescript
export interface SignalContext {
  workspaceId: string;
  businessId: string;
  campaignId: string;
  offerId: string;
  company: {
    id: string;
    name: string;
    domain?: string;
    website?: string;
    siren?: string;
    siret?: string;
    city?: string;
  };
}

export interface SignalResult {
  providerId: string;
  evidence: Array<Omit<EvidenceItem, "id" | "workspaceId" | "businessId" | "companyId">>;
  costEstimateUsd: number;
  durationMs: number;
  error?: string;
}

export interface SignalProvider {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  costPerExecutionUsd: number;

  /**
   * Determines whether this provider can run on the target company.
   */
  supports(context: SignalContext): boolean;

  /**
   * Collects verifiable signals and returns standardized EvidenceItem array.
   */
  collect(context: SignalContext): Promise<SignalResult>;
}
```

---

## 🗃️ Built-in Signal Provider Modules

| Provider ID | External API / Mechanism | Typical Evidence Keys Collected | Used in Which Campaign Archetype? |
| :--- | :--- | :--- | :--- |
| `company_registry` | Recherche d'Entreprises API | `legal_name`, `siren`, `naf_code`, `employee_bracket`, `establishment_count` | **All Campaigns** (Universal) |
| `google_places` | Serper.dev Places API | `google_rating`, `google_review_count`, `place_category`, `opening_hours` | Local B2B, Retail, Artisans, Clinics |
| `website_presence` | Website Resolver (Pappers/Serper) | `has_website`, `canonical_domain`, `ssl_active`, `redirects_to_social` | Web Agencies, Digital Transformation |
| `website_technical`| PageSpeed API / Crawler | `mobile_pagespeed_score`, `lcp_seconds`, `mobile_friendly`, `cms_detected`, `outdated_copyright_year` | Web/SEO Agencies, UX Modernization |
| `website_ecommerce`| HTML Cart/Checkout Inspector | `has_online_ordering`, `has_checkout`, `ecommerce_platform`, `has_booking_widget` | Web Agencies, E-Commerce Development |
| `company_scale` | Legal & Registry Multi-Site Lookup| `multi_establishment_count`, `headquarters_city`, `corporate_subsidiaries` | B2B Consultancies, Fleet, Road Safety |
| `company_hiring` | Public Job Boards / Serper Jobs | `active_job_openings`, `hiring_sales_roles`, `hiring_tech_roles` | HR Training, Staffing, Executive Search |
| `technology_stack` | BuiltWith / Wappalyzer signatures | `detected_crm`, `detected_analytics`, `marketing_automation` | SaaS, Tech Solutions, Cybersecurity |

---

## 🧠 Evidence Provenance & Provenance Invariants

### 1. The Fact vs. Inference Barrier
Every `EvidenceItem` carries a mandatory `nature` discriminator:
* `"fact"`: Directly extracted from an authoritative source (e.g. `siren: "123456789"` from official registry, `google_reviews: 140` from Google Maps).
* `"derived_metric"`: Deterministically calculated from facts (e.g. `mobile_pagespeed_score: 28` from Google PageSpeed, `copyright_year_delta: 7` years old).
* `"ai_interpretation"`: Qualitative deduction made by an LLM (e.g. `likely_pain_point: "No direct online booking despite heavy weekend demand"`).

### 2. Evidence Storage Schema
Evidence is stored in the subcollection `companies/{companyId}/evidence/{evidenceId}`.

```typescript
export interface EvidenceItem {
  id: string;
  workspaceId: string;
  businessId: string;
  companyId: string;
  signalProvider: string;
  key: string;
  value: unknown;
  sourceType: "official_registry" | "website" | "google_places" | "pagespeed" | "provider" | "ai_interpretation";
  sourceUrl?: string;
  confidence: number;            // 0 - 100
  nature: "fact" | "derived_metric" | "ai_interpretation";
  collectedAt: Date;
  expiresAt?: Date;             // Cached signals expire after e.g. 30 days
}
```

### 3. Caching & Freshness
* Expensive audits (such as Google PageSpeed or full website crawls) are cached at the `domain` level with a 30-day expiration window.
* Subsequent campaigns targeting the same company reuse existing cached evidence unless explicitly forced to refresh.
