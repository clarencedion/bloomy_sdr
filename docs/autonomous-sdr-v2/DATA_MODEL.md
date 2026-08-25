# Firestore Data Model & Schema Specifications

This document defines the Firestore collection hierarchy, document structures, subcollections, composite indexes, and data migration plans for Autonomous SDR V2.

---

## 🗄️ Firestore Collection Structure

```text
workspaces/{workspaceId}
├── businesses/{businessId}
│     ├── knowledgeBase/default (singleton doc)
│     ├── senderIdentities/{senderId}
│     ├── offers/{offerId}
│     └── campaigns/{campaignId}
│           └── discoveryRuns/{runId}
├── companies/{companyId}
│     ├── evidence/{evidenceId}
│     └── contacts/{contactId}
├── opportunities/{opportunityId} (Company + Campaign join)
├── conversations/{conversationId}
│     └── messages/{messageId}
├── outreachDrafts/{outreachId}
├── meetings/{meetingId}
├── suppressionList/{suppressionId}
├── logs/{logId}
└── settings/{settingDocId} (global & workspace settings)
```

---

## 📄 Core Document Schemas

### 1. `workspaces/{workspaceId}/businesses/{businessId}`
```typescript
interface BusinessDoc {
  id: string;
  workspaceId: string;
  name: string;                   // e.g. "Bloomy Digital Studio"
  legalName?: string;
  website?: string;
  defaultLanguage: "fr" | "en";
  branding: {
    primaryColor: string;
    logoUrl?: string;
    tagline: string;
  };
  automationPolicy: {
    mode: "manual" | "assisted" | "autonomous_safe";
    dailyOutreachLimit: number;
    dailyDiscoveryLimit: number;
    requireApprovalBeforeSend: boolean;
    autoReplySafeThreshold: number; // e.g. 0.85
  };
  calendarConfig: {
    provider: "microsoft_graph" | "google_calendar" | "cal_com";
    calendarId?: string;
    bookingLink?: string;          // Calendly / Cal.com link
    workingDays: number[];         // [1, 2, 3, 4, 5] (Mon-Fri)
    workingHours: { start: string; end: string }; // "09:00" - "18:00"
    timezone: string;              // "Europe/Paris"
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### 2. `workspaces/{workspaceId}/businesses/{businessId}/offers/{offerId}`
```typescript
interface OfferDoc {
  id: string;
  workspaceId: string;
  businessId: string;
  name: string;                   // e.g. "E-Commerce & Website Modernization"
  description: string;
  targetPersonas: Array<{
    title: string;                // e.g. "Dirigeant / Propriétaire"
    priority: number;             // 1 = top priority
    keywords: string[];           // ["gérant", "fondateur", "artisan", "patron"]
  }>;
  valuePropositions: string[];
  proofPoints: string[];          // Case studies & metrics
  pricingGuardrails?: {
    startingPrice?: number;
    currency: "EUR";
    pricingModel: "fixed" | "subscription" | "custom_quote";
    canDiscloseInColdReply: boolean;
  };
  prohibitedPromises: string[];   // Words or promises the AI must never make
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### 3. `workspaces/{workspaceId}/businesses/{businessId}/campaigns/{campaignId}`
```typescript
interface CampaignDoc {
  id: string;
  workspaceId: string;
  businessId: string;
  offerId: string;
  name: string;                   // e.g. "Independent Florists - France Web Redesign"
  status: "draft" | "active" | "paused" | "completed";
  naturalLanguagePrompt?: string; // Original prompt input by user
  icpDefinition: {
    cities: string[];
    departments: string[];
    regions: string[];
    nafCodes: string[];           // e.g. ["47.76Z"]
    keywords: string[];           // ["fleuriste", "artisan fleuriste"]
    excludeKeywords: string[];    // ["grossiste", "franchise"]
    minEmployeeCount?: number;
    requireWebsite: boolean;
  };
  researchStrategy: {
    enabledSignalProviders: string[]; // ["recherche_entreprises", "google_places", "website_technical", "website_ecommerce"]
    minScoreForQualification: number; // e.g. 70
    minConfidenceForOutreach: number; // e.g. 65
  };
  outreachStrategy: {
    tone: "professional" | "consultative" | "direct";
    subjectVariants: string[];
    ctaType: "diagnostic_call" | "portfolio_review";
    sequenceSteps: number;        // e.g. 3 (Initial, Follow-up 1, Follow-up 2)
    attachProposalPdf: boolean;
  };
  stats: {
    companiesDiscovered: number;
    companiesQualified: number;
    outreachSent: number;
    repliesReceived: number;
    positiveReplies: number;
    meetingsBooked: number;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastRunAt?: Timestamp;
}
```

### 4. `companies/{companyId}` & `companies/{companyId}/evidence/{evidenceId}`
```typescript
interface CompanyDoc {
  id: string;
  workspaceId: string;
  name: string;
  normalizedName: string;
  domain?: string;
  website?: string;
  siren?: string;
  siret?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  country: string;                // "FR"
  nafCode?: string;
  nafLabel?: string;
  employeeCount?: number;
  qualityScore: number;           // 0-100
  dataQualityWarnings: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface EvidenceItemDoc {
  id: string;
  workspaceId: string;
  companyId: string;
  signalProvider: string;         // e.g. "website_technical"
  key: string;                    // e.g. "mobile_pagespeed_score"
  value: unknown;                 // e.g. 28
  sourceType: "official_registry" | "website" | "google_places" | "pagespeed" | "provider" | "ai_interpretation";
  sourceUrl?: string;
  confidence: number;             // 0-100
  nature: "fact" | "derived_metric" | "ai_interpretation";
  collectedAt: Timestamp;
  expiresAt?: Timestamp;
}
```

### 5. `opportunities/{opportunityId}` (Campaign + Company State)
```typescript
interface OpportunityDoc {
  id: string;
  workspaceId: string;
  businessId: string;
  campaignId: string;
  companyId: string;
  status: "discovered" | "collecting_signals" | "scored" | "disqualified" | "qualified" | "contact_discovery" | "outreach_ready" | "sequence_active" | "replied" | "meeting_booked" | "suppressed";
  scores: {
    companyFitScore: number;      // 0-100
    needStrengthScore: number;    // 0-100
    commercialValueScore: number; // 0-100
    overallScore: number;         // 0-100
  };
  detectedNeeds: string[];
  buyingTriggers: string[];
  recommendedAngle: string;
  primaryContactId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### 6. `conversations/{conversationId}` & `messages/{messageId}`
```typescript
interface ConversationDoc {
  id: string;
  workspaceId: string;
  businessId: string;
  campaignId: string;
  opportunityId: string;
  companyId: string;
  contactId: string;
  status: "outreach_draft" | "sequence_active" | "in_dialogue" | "human_escalated" | "meeting_booked" | "lost" | "suppressed";
  latestIntent?: string;
  latestObjection?: string;
  instantlyLeadId?: string;
  assignedRepUserId?: string;
  unreadHumanAttention: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface MessageDoc {
  id: string;
  conversationId: string;
  direction: "outbound" | "inbound";
  senderEmail: string;
  recipientEmail: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  providerMessageId?: string;
  replyClassification?: {
    intent: string;
    objectionType?: string;
    confidence: number;
    autoResponded: boolean;
  };
  sentAt: Timestamp;
}
```

### 7. `suppressionList/{suppressionId}`
```typescript
interface SuppressionDoc {
  id: string;
  workspaceId: string;
  targetType: "email" | "domain" | "siren";
  targetValue: string;            // e.g. "prospect@example.com" or "example.com"
  reason: "unsubscribe" | "bounce" | "manual_request" | "legal_threat" | "competitor";
  sourceConversationId?: string;
  createdAt: Timestamp;
  expiresAt?: Timestamp;          // Null for permanent suppression
}
```
