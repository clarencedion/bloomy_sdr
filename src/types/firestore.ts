import type { Timestamp } from "firebase/firestore";
import type { ResearchStrategy } from "./domain";
export * from "./domain";

export type UserRole = "owner" | "admin" | "sales" | "viewer";

export type CompanyStatus =
  | "imported"
  | "discovered"
  | "enrichment_pending"
  | "enriching"
  | "enriched"
  | "research_pending"
  | "researching"
  | "researched"
  | "outreach_ready"
  | "qualified"
  | "approved"
  | "contacted"
  | "replied"
  | "meeting_booked"
  | "won"
  | "lost"
  | "rejected";

export type ContactStatus =
  | "new"
  | "verified"
  | "invalid"
  | "do_not_contact"
  | "contacted"
  | "replied"
  | "meeting_booked";

export type SourceType =
  | "recherche_entreprises"
  | "sirene"
  | "sirene_stock"
  | "google_places"
  | "pappers"
  | "manual"
  | "csv"
  | "website"
  | "unknown";

export type DataQualityWarning =
  | "missing_identity_anchor"
  | "missing_domain"
  | "missing_city"
  | "missing_source"
  | "placeholder_removed"
  | "low_source_confidence"
  | "contact_missing_email"
  | "duplicate_domain"
  | "duplicate_siren"
  | "duplicate_contact_email"
  | "unverified_email";

export type SourceMetadata = {
  sourceType: SourceType;
  sourceProvider?: SourceType;
  sourceId?: string;
  source?: string;
  sourceUrl?: string;
  sourceConfidence: number;
  rawProviderData?: unknown;
};

export type Company = SourceMetadata & {
  id: string;
  workspaceId?: string;
  businessId?: string;
  name: string;
  normalizedName: string;
  website?: string;
  domain?: string;
  linkedinUrl?: string;
  siren?: string;
  siret?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  industry?: string;
  nafCode?: string;
  nafLabel?: string;
  employeeCount?: number;
  establishmentCount?: number;
  administrativeStatus?: string;
  revenueEstimate?: string;
  description?: string;
  importedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  status: CompanyStatus;
  fitScore?: number;
  priority?: "low" | "medium" | "high";
  tags?: string[];
  assignedTo?: string;
  notes?: string;
  bestOffer?: string;
  /** The offer this prospect is pitched: stamped at discovery, or by an offer experiment. */
  offerId?: string;
  /**
   * Set when a business's offer experiment picked this prospect's offer
   * (functions/src/services/offer-experiment.ts). `offerId` holds the same
   * offer. It takes precedence over the campaign's offer and is never
   * re-assigned once the prospect has been contacted.
   */
  offerAssignment?: import("./domain").OfferAssignment;
  lastActivityAt?: Timestamp;
  qualityScore: number;
  dataQualityWarnings: DataQualityWarning[];
  discoveryCampaignId?: string;
  discoveryRunId?: string;
  discoveryScore?: number;
  discoveryReasons?: string[];
  needsResearch?: boolean;
  websiteEnrichmentStatus?: "pending" | "running" | "completed" | "failed" | "missing_website";
  websiteTitle?: string;
  websiteDescription?: string;
  contactPageUrl?: string;
  careersPageUrl?: string;
  lastWebsiteEnrichedAt?: Timestamp;
  websiteKeywords?: string[];
  opportunityScore?: import("./domain").OpportunityScore;
  qualificationState?: import("./domain").QualificationState;
  extractedEmailCount?: number;
  extractedPhoneCount?: number;
  leadReadyForOutreach?: boolean;
  leadReadinessReasons?: string[];
  rejectionReason?: string;
  skippedReason?: string;
};

export type Contact = SourceMetadata & {
  id: string;
  workspaceId?: string;
  businessId?: string;
  companyId: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  role?: string;
  seniority?: string;
  department?: string;
  email?: string;
  normalizedEmail?: string;
  phone?: string;
  normalizedPhone?: string;
  linkedinUrl?: string;
  status: ContactStatus;
  emailVerified?: boolean;
  emailQualification?: "verified" | "guessed" | "uncertain";
  personaMatched?: string;
  personaPriority?: number;
  personaMatchScore?: number;
  isPrimaryDecisionMaker?: boolean;
  requiresVerification?: boolean;
  doNotContact?: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  qualityScore: number;
  dataQualityWarnings: DataQualityWarning[];
  rejectionReason?: string;
  skippedReason?: string;
};

export type GlobalSettings = {
  automationPaused: boolean;
  aiProvider: "openai" | "anthropic" | "qwen";
  openAiModel?: string;
  anthropicModel?: string;
  qwenModel?: string;
  /** QwenCloud region endpoint; blank uses the international one. */
  qwenBaseUrl?: string;
  qwenApiKeyConfigured?: boolean;
  openAiApiKeyConfigured?: boolean;
  anthropicApiKeyConfigured?: boolean;
  dailyAiResearchLimit: number;
  dailyEmailGenerationLimit: number;
  dailyOutreachSendLimit?: number;
  requireApprovalBeforeExport: boolean;
  defaultLanguage: "fr" | "en";
  companyContext: string;
  researchSystemPrompt?: string;
  researchUserPrompt?: string;
  outreachSystemPrompt?: string;
  outreachUserPrompt?: string;
  outlookCalendarId?: string;
  bookingLink?: string;
  dailyDiscoveryLimit?: number;
  autoQueueDiscoveredCompanies?: boolean;
  minDiscoveryScoreForAutoResearch?: number;
  minQualityScoreForAutoResearch?: number;
  enabledDiscoveryProviders?: DiscoveryProviderName[];
  defaultDiscoveryCities?: string[];
  defaultDiscoverySegments?: DiscoverySegment[];
  autoFindContactsAfterResearch?: boolean;
  autoSendAfterApproval?: boolean;
  autoApproveOutreach?: boolean;
  minFitScoreForAutoSend?: number;
  dailySpendBudgetUsd?: number;
  monthlySpendBudgetUsd?: number;
  enableTaskQueues?: boolean;
  maxConcurrentTasks?: number;
  testModeEnabled?: boolean;
  testEmailAllowlist?: string[];
  demoModeActive?: boolean;
  updatedAt?: Timestamp;
};

export type Log = {
  id: string;
  workspaceId?: string;
  businessId?: string;
  type: string;
  level: "debug" | "info" | "warning" | "error";
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: Timestamp;
};

export type ImportRowStatus = "ready" | "warning" | "skipped" | "imported";

export type ImportPreviewRow = {
  rowNumber: number;
  status: ImportRowStatus;
  company?: Partial<Company>;
  contact?: Partial<Contact>;
  warnings: DataQualityWarning[];
  skippedReason?: string;
  raw: Record<string, string>;
};

export type DiscoveryProviderName =
  | "recherche_entreprises"
  | "sirene"
  | "sirene_stock"
  | "google_places"
  | "pappers"
  | "manual"
  | "csv";

export type DiscoverySegment = "commercial_performance" | "training_hr" | "road_safety" | "custom";

export type DiscoveryCampaignStatus = "draft" | "active" | "paused" | "archived" | "completed";

export type DiscoveryRunStatus = "pending" | "running" | "completed" | "failed";

export type DiscoverySource = {
  id: string;
  name: string;
  provider: DiscoveryProviderName;
  enabled: boolean;
  apiKeySecretName?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type DiscoveryCampaign = {
  id: string;
  workspaceId?: string;
  businessId?: string;
  offerId?: string;
  name: string;
  naturalLanguagePrompt?: string;
  /** Who this campaign targets; decides contact rules and paid-enrichment spend. */
  targetSegment?: "small_business" | "large_company";
  /** Channels the SDR may use. Email is always included. */
  channels?: Array<"email" | "social_dm" | "contact_form">;
  /** "social_dm": write a DM whenever the prospect has a trusted profile, email or not. */
  preferredChannel?: "email" | "social_dm";
  status: DiscoveryCampaignStatus;
  segment: DiscoverySegment;
  cities: string[];
  departments?: string[];
  regions?: string[];
  keywords: string[];
  excludeKeywords?: string[];
  nafCodes?: string[];
  maxCompaniesPerRun: number;
  maxCompaniesTotal?: number;
  minEmployeeCount?: number;
  requireWebsite?: boolean;
  providerPriority: DiscoveryProviderName[];
  researchStrategy?: ResearchStrategy;
  autoQueueHighScoreCompanies: boolean;
  minScoreForQualification?: number;
  minDiscoveryScoreForSave?: number;
  minDiscoveryScoreForAutoResearch: number;
  minQualityScoreForAutoResearch: number;
  rechercheEntreprisesPageCursor?: number;
  rechercheEntreprisesExhausted?: boolean;
  googlePlacesPageCursor?: number;
  googlePlacesExhausted?: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastRunAt?: Timestamp;
  archivedAt?: Timestamp;
};

export type DiscoveryRun = {
  id: string;
  workspaceId?: string;
  businessId?: string;
  campaignId: string;
  campaignName?: string;
  status: DiscoveryRunStatus;
  provider: DiscoveryProviderName;
  startedAt: Timestamp;
  completedAt?: Timestamp;
  companiesFound: number;
  companiesCreated: number;
  companiesQueuedForResearch: number;
  companiesSkippedDuplicate: number;
  companiesRejected: number;
  averageDiscoveryScore?: number;
  errors?: string[];
  logs?: string[];
  duplicateCompanies?: string[];
};

export type DiscoveredCompany = {
  name?: string;
  website?: string;
  domain?: string;
  linkedinUrl?: string;
  siren?: string;
  siret?: string;
  nafCode?: string;
  nafLabel?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  industry?: string;
  employeeCount?: number;
  establishmentCount?: number;
  administrativeStatus?: string;
  description?: string;
  source: string;
  sourceUrl?: string;
  sourceProvider: DiscoveryProviderName;
  sourceId: string;
  sourceType: DiscoveryProviderName;
  sourceConfidence: number;
  rawProviderData?: unknown;
};

export type RejectedDiscovery = {
  id: string;
  workspaceId?: string;
  businessId?: string;
  campaignId: string;
  runId: string;
  provider: DiscoveryProviderName;
  sourceId?: string;
  name?: string;
  normalizedName?: string;
  domain?: string;
  siren?: string;
  siret?: string;
  city?: string;
  qualityScore: number;
  discoveryScore: number;
  dataQualityWarnings: DataQualityWarning[];
  skippedReason: string;
  rawProviderData?: unknown;
  createdAt: Timestamp;
};

export type ResearchSegment = "commercial_performance" | "training_hr" | "road_safety" | "low_fit" | string;

export type RecommendedNextAction = "approve_outreach" | "enrich_more" | "reject";

export type LeadResearchStatus = "pending" | "running" | "completed" | "failed";

export type LeadResearch = {
  id: string;
  workspaceId?: string;
  businessId?: string;
  offerId?: string;
  companyId: string;
  status: LeadResearchStatus;
  researchSummary?: string;
  detectedNeeds?: string[];
  painPoints?: string[];
  buyingTriggers?: string[];
  bestOffer?: string;
  decisionMakersToTarget?: string[];
  risks?: string[];
  confidence?: number;
  fitScore?: number;
  aiProvider?: "openai" | "anthropic" | "qwen" | "mock";
  model?: string;
  promptVersion?: string;
  rawInput?: unknown;
  rawOutput?: unknown;
  sourceUrls?: string[];
  createdAt: Timestamp;
  completedAt?: Timestamp;
  error?: string;
  segment?: ResearchSegment;
  personalizedAngle?: string;
  reasoningSummary?: string;
  recommendedNextAction?: RecommendedNextAction;
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
  estimatedCost?: number;
};

export type OutreachStatus =
  | "draft"
  | "approved"
  | "rejected"
  | "needs_more_research"
  | "sent"
  | "replied"
  | "bounced"
  | "suppressed";


export type LandingPageDraft = {
  headline?: string;
  intro?: string;
  whyUs?: string;
  /** Legacy field name from earlier drafts. */
  whyDevcomm?: string;
  likelyChallenges?: string[];
  recommendedSupport?: string[];
  cta?: string;
};

export type Outreach = {
  id: string;
  workspaceId?: string;
  businessId?: string;
  offerId?: string;
  /** Set when `offerId` was picked by the business's offer experiment (A/B test). */
  offerExperimentId?: string;
  companyId: string;
  contactId?: string;
  campaignId?: string;
  researchId?: string;
  conversationId?: string;
  instantlyLeadId?: string;
  status: OutreachStatus;
  /** How this message reaches the prospect. A DM is sent by a human. */
  channel?: "email" | "social_dm" | "contact_form";
  /** Contact page a message would be posted to. */
  contactFormUrl?: string;
  /** False when a CAPTCHA or third-party widget means a person must send it. */
  contactFormSubmittable?: boolean;
  contactFormReason?: string;
  /** Public profile a human opens to send the DM. Kept for drafts written before `socialProfiles`. */
  socialProfileUrl?: string;
  /** Phase 23: the prospect's normalised profile on each network it was found on. */
  socialProfiles?: { instagram?: import("./domain").SocialProfileRef; facebook?: import("./domain").SocialProfileRef };
  /** Network the DM actually went out on (set when it is recorded as sent). */
  sentNetwork?: import("./domain").SocialNetwork;
  /** "browser_session": typed by the local runner, sent on a key press. "by_hand": marked sent from the app. */
  sentVia?: "browser_session" | "by_hand";
  /** Sent by an automatic session: no key was pressed for this message. */
  sentAuto?: boolean;
  /** An automatic session left this draft to a person (its conversation was not new). */
  autoHeldAt?: Timestamp;
  autoHeldReason?: string;
  /** Who recorded the send (the by-hand path stamps the signed-in user). */
  sentByUserId?: string;
  /** Set when the person skipped this DM in a session; the session queue hides it for 24 hours. */
  skippedAt?: Timestamp;
  skipReason?: string;
  generatedSubject?: string;
  generatedBody?: string;
  followUp1?: string;
  followUp2?: string;
  linkedinNote?: string;
  linkedinFollowUp?: string;
  internalSalesNotes?: string;
  suggestedPersona?: string;
  cta?: string;
  personalizationNotes?: string[];
  personalizationFacts?: import("./domain").PersonalizationFact[];
  claimValidationStatus?: import("./domain").ClaimValidationStatus;
  claimValidationDetails?: import("./domain").ClaimValidationResult;
  pdfStorageUrl?: string;
  pdfDocumentId?: string;
  /** False when the draft matches a known misstatement of its offer's terms (advisory detector). */
  pricingGuardrailPassed?: boolean;
  /** True when a broad commercial-vocabulary heuristic flags the draft (price, free items, discounts, commitment…). */
  mentionsCommercialTerms?: boolean;
  riskWarnings?: string[];
  landingPageDraft?: LandingPageDraft;
  approvedBy?: string;
  approvedAt?: Timestamp;
  sentAt?: Timestamp;
  lastInteractionAt?: Timestamp;
  rejectionReason?: string;
  aiProvider?: "openai" | "anthropic" | "qwen" | "mock";
  model?: string;
  promptVersion?: string;
  rawInput?: unknown;
  rawOutput?: unknown;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
  estimatedCost?: number;
};

