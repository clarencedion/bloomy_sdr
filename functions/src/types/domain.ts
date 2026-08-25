import type { Timestamp } from "firebase-admin/firestore";

export interface WorkspaceDoc {
  id: string;
  name: string;
  ownerId?: string;
  defaultBusinessId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

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
    autoReplySafeThreshold: number;
  };
  calendarConfig: {
    provider: "microsoft_graph" | "google_calendar" | "cal_com";
    calendarId?: string;
    bookingLink?: string;
    workingDays: number[];
    workingHours: { start: string; end: string };
    timezone: string;
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

export interface TargetPersona {
  title: string;
  priority: number;
  keywords: string[];
}

export interface OfferDoc {
  id: string;
  workspaceId: string;
  businessId: string;
  name: string;                   // e.g. "E-Commerce & Website Modernization"
  description: string;
  targetPersonas: TargetPersona[];
  valuePropositions: string[];
  proofPoints: string[];
  pricingGuardrails?: {
    startingPrice?: number;
    currency: "EUR";
    pricingModel: "fixed" | "subscription" | "custom_quote";
    canDiscloseInColdReply: boolean;
  };
  prohibitedPromises: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

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

export interface SenderIdentityDoc {
  id: string;
  workspaceId: string;
  businessId: string;
  name: string;
  email: string;
  replyToEmail?: string;
  instantlyApiKeySecretName?: string;
  instantlyCampaignId?: string;
  isDefault: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type SignalProviderId =
  | "company_registry"
  | "google_places"
  | "website_presence"
  | "website_technical"
  | "website_ecommerce"
  | "company_scale"
  | "company_hiring"
  | "technology_stack";

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


