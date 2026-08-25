import type { Timestamp } from "firebase/firestore";

/**
 * Top-level workspace container (e.g. Agency, Group, or Enterprise Account)
 */
export interface WorkspaceDoc {
  id: string;
  name: string;
  ownerId?: string;
  defaultBusinessId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * Discrete commercial entity operated within a Workspace
 * (e.g. "Bloomy Digital Studio" or "Devcomm Consulting")
 */
export interface BusinessDoc {
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
  senderConfig?: {
    defaultSenderEmail?: string;
    defaultSenderName?: string;
    instantlyCampaignId?: string;
    instantlyWorkspaceId?: string;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * Target decision-maker profile configured on an Offer
 */
export interface TargetPersona {
  title: string;                // e.g. "Dirigeant / Propriétaire"
  priority: number;             // 1 = top priority
  keywords: string[];           // ["gérant", "fondateur", "artisan", "patron"]
}

/**
 * A specific service or product package sold by a Business
 */
export interface OfferDoc {
  id: string;
  workspaceId: string;
  businessId: string;
  name: string;                   // e.g. "E-Commerce & Website Modernization"
  description: string;
  targetPersonas: TargetPersona[];
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

/**
 * Structured business knowledge base (singleton document under business)
 */
export interface KnowledgeBaseDoc {
  id: string;
  workspaceId: string;
  businessId: string;
  services: Array<{
    name: string;
    description: string;
    idealFor?: string;
  }>;
  caseStudies: Array<{
    title: string;
    clientIndustry: string;
    metric: string;
    description: string;
  }>;
  pricingRules: string[];
  faqs: Array<{
    question: string;
    answer: string;
  }>;
  prohibitedPromises: string[];
  updatedAt: Timestamp;
}

/**
 * Scoped sender identity configured per business
 */
export interface SenderIdentityDoc {
  id: string;
  workspaceId: string;
  businessId: string;
  name: string;                   // e.g. "Clarence - Bloomy Studio"
  email: string;                  // e.g. "clarence@bloomydigital.com"
  replyToEmail?: string;
  instantlyApiKeySecretName?: string;
  instantlyCampaignId?: string;
  isDefault: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * Built-in and extensible Signal Provider identifiers
 */
export type SignalProviderId =
  | "company_registry"
  | "google_places"
  | "website_presence"
  | "website_technical"
  | "website_ecommerce"
  | "company_scale"
  | "company_hiring"
  | "technology_stack";

/**
 * Dynamic research & signal collection strategy configured per campaign
 */
export interface ResearchStrategy {
  enabledSignalProviders: SignalProviderId[];
  requiredSignals?: string[];
  relevanceExplanation?: string;
  scoringWeights?: {
    companyFitWeight?: number;
    needStrengthWeight?: number;
    commercialScaleWeight?: number;
    evidenceConfidenceWeight?: number;
  };
}

/**
 * Evidence nature classification enforcing FACT != INFERENCE barrier
 */
export type EvidenceNature = "fact" | "derived_metric" | "ai_interpretation";

/**
 * Origin type of collected evidence
 */
export type EvidenceSourceType =
  | "official_registry"
  | "website"
  | "google_places"
  | "pagespeed"
  | "provider"
  | "ai_interpretation"
  | "manual";

/**
 * Immutable atomic evidence item with strict provenance tracking
 */
export interface EvidenceItem {
  id: string;
  workspaceId: string;
  businessId: string;
  companyId: string;
  signalProvider: SignalProviderId | string;
  key: string;
  value: unknown;
  sourceType: EvidenceSourceType;
  sourceUrl?: string;
  confidence: number;            // 0 - 100
  nature: EvidenceNature;        // "fact" | "derived_metric" | "ai_interpretation"
  collectedAt: Timestamp | Date;
  expiresAt?: Timestamp | Date;  // Cached signals expire after TTL
  costUsd?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Execution context provided to signal collectors
 */
export interface SignalContext {
  workspaceId: string;
  businessId: string;
  campaignId?: string;
  offerId?: string;
  company: {
    id: string;
    name: string;
    domain?: string;
    website?: string;
    siren?: string;
    siret?: string;
    city?: string;
    postalCode?: string;
    address?: string;
    rawProviderData?: unknown;
  };
}

/**
 * Standardized result returned by a SignalProvider
 */
export interface SignalResult {
  providerId: SignalProviderId | string;
  evidence: Array<Omit<EvidenceItem, "id" | "workspaceId" | "businessId" | "companyId">>;
  costEstimateUsd: number;
  durationMs: number;
  error?: string;
}

/**
 * Result of translating a natural-language prompt into structured campaign targeting
 */
export interface IcpTranslationResult {
  campaignName: string;
  segment: "commercial_performance" | "training_hr" | "road_safety" | "custom";
  cities: string[];
  departments: string[];
  regions: string[];
  nafCodes: string[];
  keywords: string[];
  excludeKeywords: string[];
  minEmployeeCount?: number;
  requireWebsite: boolean;
  targetPersonas: string[];
  providerPriority: Array<"recherche_entreprises" | "sirene" | "sirene_stock" | "google_places" | "pappers" | "manual" | "csv">;
  researchStrategy: ResearchStrategy;
  reasoningSummary: string;
}


