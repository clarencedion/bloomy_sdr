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
  /**
   * What the attached proposal document should say, in the owner's words.
   *
   * The document's sections are fixed, but what goes in them is not: a web
   * studio wants a speed audit, a sales-training consultancy wants the gap
   * between the prospect's current commercial setup and what a trained team
   * would produce. Free text, because a brief is a brief - the same reason the
   * campaign itself is described in a sentence rather than a form.
   */
  proposalDocument?: {
    /** Off means no PDF is generated or attached. */
    enabled: boolean;
    /** Rules for what to write, in any language. */
    brief?: string;
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
  /** Phase 23: per-network pacing for local social sessions. */
  socialLimits?: { instagram?: SocialNetworkLimits; facebook?: SocialNetworkLimits };
  /** Phase 23: the business's own accounts (lets the inbox sweep tell our bubbles apart). */
  socialAccounts?: { instagram?: { handle?: string }; facebook?: { name?: string } };
  /**
   * A/B test of several of this business's offers (offer-experiment.ts). Data,
   * not code: any business can run one, and nothing in the engine knows what
   * the offers sell.
   */
  offerExperiment?: OfferExperiment;
  /**
   * How this business's first direct message is built
   * (social-dm-conversation.ts). `style: "conversation"`: one true thing about
   * the prospect, the business's own `introLine` (who writes, what the
   * business does — inserted word for word), one question; no commercial term.
   * `observations`: which facts about the prospect code may state before the
   * intro line, when the evidence says them plainly (social/dm-observations.ts).
   * Absent: the offer's terms line, as before (social-dm-terms.ts).
   */
  socialDmOpening?: { style?: string; introLine?: string; observations?: string[] };
}

/**
 * Several offers of one business pitched to comparable prospects, to learn
 * which one sells best. Each never-contacted prospect is assigned one variant
 * (deterministically, on first draft) and keeps it for the whole conversation.
 */
export interface OfferExperiment {
  id: string;
  /** The variants, control first by convention. Ids that match no offer are ignored. */
  offerIds: string[];
  /** "stopped" assigns no new prospect; those already assigned keep their offer. */
  status: "active" | "stopped";
  startedAt?: Timestamp | Date;
  note?: string;
}

/**
 * Stored on a company document (`companies/{id}.offerAssignment`) once an
 * experiment picked its offer. `company.offerId` is set to the same offer in
 * the same write. Never re-assigned once the company has been contacted.
 */
export interface OfferAssignment {
  experimentId: string;
  offerId: string;
  assignedAt: Timestamp | Date;
}

export interface TargetPersona {
  title: string;
  priority: number;
  keywords: string[];
  seniority?: string[];
  negativeKeywords?: string[];
}

export interface PersonaMatchResult {
  personaMatched?: string;
  personaPriority?: number;
  personaMatchScore: number;
  isPrimaryDecisionMaker?: boolean;
}

export type EmailQualification = "verified" | "guessed" | "uncertain";


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
    /** One-off setup fee. 0 declares a free setup as an approved term. */
    setupFee?: number;
    /** Recurring price per month (subscription offers). */
    monthlyPrice?: number;
    /** Minimum commitment in months. 0 = none; absent = not declared. */
    commitmentMonths?: number;
    /** Tax basis the prices are expressed in. */
    taxLabel?: "HT" | "TTC";
    /** Exact commercial statements the business approved the AI to make. */
    approvedTerms?: string[];
    /** The sentence a first message states the terms with, inserted verbatim by code. */
    termsLine?: string;
  };
  prohibitedPromises: string[];
  scoringWeights?: {
    companyFitWeight?: number;
    needStrengthWeight?: number;
    commercialScaleWeight?: number;
    evidenceConfidenceWeight?: number;
  };
  scoringRules?: ScoringRuleConfig;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ScoringRuleConfig {
  minScoreForQualification?: number; // default 50
  highPriorityThreshold?: number;   // default 80
  minEvidenceConfidence?: number;   // default 60
  targetNafCodes?: string[];
  targetKeywords?: string[];
  negativeKeywords?: string[];
  idealEmployeeMin?: number;
  idealEmployeeMax?: number;
  requiredSignals?: string[];
}

export type QualificationState =
  | "DISQUALIFIED"
  | "NEEDS_MORE_EVIDENCE"
  | "QUALIFIED"
  | "HIGH_PRIORITY";

export interface OpportunityScoreWeights {
  companyFitWeight: number;
  needStrengthWeight: number;
  commercialScaleWeight: number;
  evidenceConfidenceWeight: number;
}

export interface OpportunityScoreBreakdown {
  companyFitScore: number;
  companyFitReasons: string[];
  needStrengthScore: number;
  needStrengthReasons: string[];
  commercialValueScore: number;
  commercialValueReasons: string[];
  evidenceConfidence: number;
  confidenceReasons: string[];
  penalties: string[];
}

export interface OpportunityScore {
  companyFitScore: number;
  needStrengthScore: number;
  commercialValueScore: number;
  evidenceConfidence: number;
  overallScore: number;
  qualificationState: QualificationState;
  weights: OpportunityScoreWeights;
  breakdown: OpportunityScoreBreakdown;
  detectedNeeds: string[];
  buyingTriggers: string[];
  recommendedAngle: string;
  calculatedAt: Timestamp | Date | string;
}

export interface OpportunityDoc {
  id: string;
  workspaceId: string;
  businessId: string;
  campaignId?: string;
  offerId?: string;
  companyId: string;
  companyName: string;
  domain?: string;
  siren?: string;
  qualificationState: QualificationState;
  score: OpportunityScore;
  status: "scored" | "qualified" | "disqualified" | "contact_discovery" | "outreach_ready";
  detectedNeeds: string[];
  buyingTriggers: string[];
  recommendedAngle: string;
  createdAt: Timestamp | Date;
  updatedAt: Timestamp | Date;
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
  | "pagespeed"
  | "company_scale"
  | "company_hiring"
  | "technology_stack"
  | "social_profile";

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

/**
 * Structured verifiable factual observation derived from EvidenceItem[]
 */
export interface PersonalizationFact {
  key: string;
  label: string;
  value: string | number | boolean;
  sourceType: EvidenceSourceType;
  confidence: number;
  nature: EvidenceNature;
  provenance?: string;
}

/**
 * Status of the two-pass factual claim validation gate
 */
export type ClaimValidationStatus =
  | "VALID"
  | "UNSUPPORTED_CLAIMS_DETECTED"
  | "PROHIBITED_PROMISES_DETECTED"
  | "WARNINGS_ONLY";

/**
 * Result of the second-pass factual claim validation (validateOutreachClaims)
 */
export interface ClaimValidationResult {
  passed: boolean;
  status: ClaimValidationStatus;
  verifiedClaims: string[];
  unsupportedClaims: string[];
  prohibitedPromisesDetected: string[];
  warnings: string[];
  wordCount: number;
  hasOptOut: boolean;
  checkedAt: string;
}

/**
 * Standardized 4-touch multi-channel sequence draft
 */
export interface SequenceDraft {
  subject: string;
  body: string;
  followUp1: string;
  followUp2: string;
  linkedinNote: string;
  linkedinFollowUp: string;
  internalSalesNotes?: string;
  suggestedPersona?: string;
  cta?: string;
  personalizationFacts?: PersonalizationFact[];
  riskWarnings?: string[];
}

export type ReplyIntent =
  | "POSITIVE"
  | "BOOKING_REQUEST"
  | "QUESTION"
  | "OBJECTION"
  | "UNSUBSCRIBE"
  | "OUT_OF_OFFICE"
  | "WRONG_PERSON"
  | "ANGRY"
  | "NEUTRAL"
  | "UNCLEAR";

export type ObjectionType =
  | "PRICE"
  | "EXISTING_PROVIDER"
  | "NO_BUDGET"
  | "NOT_PRIORITY"
  | "BAD_TIMING"
  | "NO_TIME"
  | "OTHER";

export interface ReplyClassification {
  intent: ReplyIntent;
  objectionType?: ObjectionType;
  confidence: number;
  detectedQuestions?: string[];
  suggestedAction?: string;
  reasoning?: string;
  requiresHumanAttention?: boolean;
  classifiedAt?: Timestamp | Date | string;
  autoResponded?: boolean;
}

/**
 * Status lifecycle of a multi-message conversation thread
 */
export type ConversationStatus =
  | "outreach_draft"
  | "sequence_active"
  | "in_dialogue"
  | "human_escalated"
  | "human_review_required"
  | "meeting_booked"
  | "lost"
  | "suppressed";

/**
 * AI-generated reply draft stored on a conversation (REQ-066, REQ-067, REQ-068)
 */
export interface ReplyDraft {
  subject: string;
  bodyText: string;
  citedKnowledgePoints?: string[];
  pricingGuardrailPassed: boolean;
  pricingDisclosed?: boolean;
  prohibitedPromisesChecked: boolean;
  confidence: number;
  draftedAt: Timestamp | Date | string;
  status: "draft" | "queued_for_approval" | "auto_dispatched" | "approved_and_sent" | "manual_override_sent" | "rejected";
  autoSendScheduledFor?: Timestamp | Date | string;
  sentAt?: Timestamp | Date | string;
  sentMessageId?: string;
  /** Phase 23 (DM drafts): the commercial-vocabulary detector flagged the text. */
  mentionsCommercialTerms?: boolean;
}


/**
 * Phase 23 — channels a conversation can run on. Absent means "email", so
 * every document written before Phase 23 keeps its meaning.
 */
export type ConversationChannel = "email" | "instagram" | "facebook";
export type SocialNetwork = "instagram" | "facebook";

/** A prospect's public profile on one network, normalised. */
export interface SocialProfileRef {
  url: string;
  /** Instagram username, or Facebook page slug / numeric id. Lowercase, no "@". */
  handle: string;
}

/** Per-network pacing for a business's social sessions (defaults in code: 30/day, 45 s). */
export interface SocialNetworkLimits {
  dailyCap?: number;
  minSpacingSeconds?: number;
}

/**
 * Multi-message conversation container stored under conversations/{conversationId} (REQ-062)
 */
export interface ConversationDoc {
  id: string;
  workspaceId: string;
  /** Absent when nothing ties the thread to a business — never a default one. */
  businessId?: string;
  /** True while no business could be resolved; listed in every business's Inbox. */
  needsAttribution?: boolean;
  /** A reply was approved but could not be sent from the SDR; send it from the mailbox. */
  pendingExternalSend?: boolean;
  /** Phase 23: absent = email. */
  channel?: ConversationChannel;
  /** Prospect's handle on the conversation's network (lowercase, no "@"). */
  socialHandle?: string;
  socialProfileUrl?: string;
  socialThreadUrl?: string;
  /** Denormalised for the Inbox list (the company list it reads is capped). */
  companyName?: string;
  /** A drafted reply waits for the local social session runner to send it. */
  pendingSessionSend?: boolean;
  campaignId?: string;
  opportunityId?: string;
  companyId: string;
  contactId: string;
  outreachId?: string;
  status: ConversationStatus;
  latestIntent?: ReplyIntent | string;
  latestObjection?: ObjectionType | string;
  instantlyLeadId?: string;
  assignedRepUserId?: string;
  manualTakeover?: boolean;
  takeoverByUserId?: string;
  takenOverAt?: Timestamp | Date;
  latestRepReplyAt?: Timestamp | Date;
  pinned?: boolean;
  unreadHumanAttention: boolean;
  humanAttentionRequired?: boolean;
  escalationReason?: string;
  draftResponse?: ReplyDraft;
  messageCount: number;
  lastMessageAt?: Timestamp | Date;
  createdAt: Timestamp | Date;
  updatedAt: Timestamp | Date;
}

/**
 * Direction of an email message within a conversation thread
 */
export type MessageDirection = "outbound" | "inbound";

/**
 * Individual email message stored under conversations/{conversationId}/messages/{messageId} (REQ-062)
 */
export interface MessageDoc {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  senderEmail: string;
  recipientEmail: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  /** "recorded_not_sent": stored by the SDR, delivered by a person elsewhere. */
  deliveryStatus?: "delivered" | "recorded_not_sent";
  /** Phase 23: absent = email. Social messages carry "" in the email fields. */
  channel?: ConversationChannel;
  senderHandle?: string;
  recipientHandle?: string;
  /** "social_session": typed and sent by the local runner after a human key press. */
  deliveredVia?: "provider" | "social_session";
  sentByUserId?: string;
  /** Deterministic key for inbound social messages (idempotent ingestion). */
  dedupeKey?: string;
  providerMessageId?: string;
  replyClassification?: ReplyClassification;
  sentAt: Timestamp | Date;
}

/**
 * Webhook event delivery record stored under webhookEvents/{eventId} (REQ-061)
 */
export interface WebhookEventDoc {
  eventId: string;
  source: string;
  eventType?: string;
  payload: Record<string, unknown>;
  workspaceId?: string;
  businessId?: string;
  processed: boolean;
  receivedAt: Timestamp | Date;
  processedAt?: Timestamp | Date;
  processingSuccess?: boolean;
  processingError?: string;
  processingOutput?: Record<string, unknown>;
  createdAt: Timestamp | Date;
}

/**
 * Suppression entry stored under suppressionList/{suppressionId} (REQ-057)
 */
export interface SuppressionDoc {
  id: string;
  workspaceId: string;
  businessId?: string;
  /** "social_handle": targetValue "instagram:<handle>" / "facebook:<handle>" (Phase 23). */
  targetType: "email" | "domain" | "siren" | "social_handle";
  targetValue: string;
  reason: "unsubscribe" | "bounce" | "manual_request" | "legal_threat" | "competitor" | string;
  sourceConversationId?: string;
  createdAt: Timestamp | Date;
  expiresAt?: Timestamp | Date;
}

/**
 * Meeting document stored under meetings/{meetingId} (REQ-074, REQ-076)
 */
export interface MeetingDoc {
  id: string;
  workspaceId: string;
  businessId: string;
  companyId?: string;
  contactId?: string;
  conversationId?: string;
  title: string;
  description?: string;
  startTime: Timestamp | Date | string;
  endTime: Timestamp | Date | string;
  timezone: string;
  attendees: string[];
  location?: string;
  meetingUrl?: string;
  source: "outlook" | "conversational" | "direct" | "google" | "cal_com" | string;
  bookingSource?: "conversational" | "direct";
  status: "scheduled" | "completed" | "cancelled" | "no_show";
  outlookEventId?: string;
  calendarProvider?: "microsoft_graph" | "google_calendar" | "cal_com" | string;
  cancelledReason?: string;
  notes?: string;
  createdAt: Timestamp | Date | string;
  updatedAt: Timestamp | Date | string;
}

/**
 * A concrete calendar time slot window (REQ-071, REQ-073)
 */
export interface TimeSlot {
  start: Date | string;
  end: Date | string;
  durationMinutes: number;
  formattedFr: string;
}

/**
 * Busy time window retrieved from calendar free/busy queries (REQ-071)
 */
export interface BusyWindow {
  start: Date;
  end: Date;
  subject?: string;
}

/**
 * Extracted scheduling intent from a prospect's email message (REQ-072)
 */
export interface SchedulingIntentResult {
  hasSchedulingIntent: boolean;
  intentType: "PROPOSE_SLOTS" | "CONFIRM_SLOT" | "RESCHEDULE" | "REJECT_SLOTS" | "NONE";
  preferredDateRange?: { start: string; end: string };
  preferredDays?: number[];
  preferredTimeOfDay?: "morning" | "afternoon" | "any";
  specificSlotRequested?: { start: string; end: string };
  nextWeek?: boolean;
  confidence: number;
  rawText: string;
  extractedExpression?: string;
}

/**
 * Result of proposing conflict-free slots (REQ-073)
 */
export interface SlotProposalResult {
  slots: TimeSlot[];
  timezone: string;
  formattedProposalFr: string;
  hasConflicts: boolean;
}

/**
 * Input for atomic meeting creation (REQ-074)
 */
export interface BookMeetingInput {
  workspaceId?: string;
  businessId?: string;
  conversationId?: string;
  contactId?: string;
  companyId?: string;
  title?: string;
  startTime: Date | string;
  endTime?: Date | string;
  durationMinutes?: number;
  timezone?: string;
  prospectEmail: string;
  prospectName?: string;
  location?: string;
  notes?: string;
  source?: "conversational" | "direct";
}

/**
 * Result of atomic meeting creation (REQ-074, REQ-075)
 */
export interface BookMeetingResult {
  success: boolean;
  meetingId?: string;
  outlookEventId?: string;
  meetingUrl?: string;
  conflict?: boolean;
  error?: string;
  sequenceTerminated?: boolean;
  meeting?: Partial<MeetingDoc>;
}

/**
 * Conversion metrics across all sales pipeline funnel stages (REQ-077)
 */
export interface FunnelStageMetrics {
  discovered: number;
  qualified: number;
  contacted: number;
  replied: number;
  positiveReplies: number;
  meetingsBooked: number;
  won: number;
  // Step conversion rates in % (0 - 100)
  discoveredToQualifiedRate: number;
  qualifiedToContactedRate: number;
  contactedToRepliedRate: number;
  repliedToPositiveRate: number;
  positiveToMeetingRate: number;
  meetingToWonRate: number;
  overallDiscoveryToMeetingRate: number;
}

/**
 * Performance metric for a single dimension slice (REQ-078)
 */
export interface DimensionMetric {
  id: string;
  name: string;
  dimension: "signal" | "angle" | "persona" | "campaign" | "naf";
  discovered: number;
  contacted: number;
  replied: number;
  positiveReplies: number;
  meetingsBooked: number;
  won: number;
  replyRate: number;         // (replied / contacted) * 100
  positiveRate: number;      // (positiveReplies / contacted) * 100
  meetingRate: number;       // (meetingsBooked / contacted) * 100
  conversionIndex: number;   // Multiplier vs baseline average (e.g. 1.8 = +80% higher)
}

/**
 * Granular performance sliced across dimensions (REQ-078)
 */
export interface DimensionBreakdown {
  bySignal: DimensionMetric[];
  byAngle: DimensionMetric[];
  byPersona: DimensionMetric[];
  byCampaign: DimensionMetric[];
  byNaf: DimensionMetric[];
}

/**
 * High-signal actionable recommendation generated by Closed-Loop Learning (REQ-079)
 */
export interface LearningRecommendation {
  id: string;
  dimension: "signal" | "angle" | "persona";
  targetKey: string;
  title: string;
  description: string;
  confidence: number;          // 0 - 100
  sampleSize: number;
  meetingRate: number;
  positiveRate: number;
  baselineMeetingRate: number;
  multiplier: number;          // e.g. 3.2x higher than avg
  action: "boost" | "scale" | "deprioritize" | "refine";
  recommendedForOffers?: string[];
}

/**
 * Historical daily aggregated analytics document stored in analyticsDaily/{dateId} (REQ-077)
 */
export interface AnalyticsDailyDoc {
  id: string;
  date: string;                // YYYY-MM-DD
  workspaceId: string;
  businessId?: string;
  funnel: FunnelStageMetrics;
  dimensions: DimensionBreakdown;
  recommendations: LearningRecommendation[];
  createdAt: Timestamp | Date | string;
  updatedAt: Timestamp | Date | string;
}

/**
 * Aggregated performance insights stored under performanceInsights/{businessId_offerId} (REQ-079)
 */
export interface PerformanceInsightsDoc {
  id: string;
  workspaceId: string;
  businessId: string;
  offerId?: string;
  topAngles: DimensionMetric[];
  topSignals: DimensionMetric[];
  topPersonas: DimensionMetric[];
  recommendations: LearningRecommendation[];
  lastCalculatedAt: Timestamp | Date | string;
}

/**
 * Full analytics summary response returned to UI
 */
export interface AnalyticsSummary {
  workspaceId: string;
  businessId?: string;
  offerId?: string;
  campaignId?: string;
  funnel: FunnelStageMetrics;
  dimensions: DimensionBreakdown;
  recommendations: LearningRecommendation[];
  dailySnapshots: Array<{
    date: string;
    discovered: number;
    contacted: number;
    replied: number;
    positiveReplies: number;
    meetingsBooked: number;
  }>;
  calculatedAt: string;
}

/**
 * Discrete asynchronous task types for decoupled execution (REQ-080)
 */
export type TaskType =
  | "TASK_DISCOVER_PAGE"
  | "TASK_COLLECT_SIGNALS"
  | "TASK_SCORE_OPPORTUNITY"
  | "TASK_ENRICH_CONTACTS"
  | "TASK_GENERATE_OUTREACH"
  | "TASK_DISPATCH_EMAIL"
  | "TASK_PIPELINE_COMPANY";

/**
 * Task execution lifecycle status (REQ-080)
 */
/** "deferred": ended by a daily limit; the company's own flag brings the work back. */
export type TaskStatus = "pending" | "running" | "completed" | "failed" | "dead_letter" | "deferred";

/**
 * Distributed job queue record stored under jobQueue/{jobId} (REQ-080)
 */
export interface JobQueueDoc {
  id: string;
  workspaceId: string;
  /** Absent for a job on an unattributed record (never a fallback business). */
  businessId?: string;
  taskType: TaskType;
  payload: Record<string, unknown>;
  status: TaskStatus;
  attemptCount: number;
  maxRetries: number;
  lastError?: string;
  errorCategory?: "transient_rate_limit" | "transient_server_error" | "permanent_error" | "budget_exceeded" | string;
  nextRetryAt?: Timestamp | Date | string;
  lockedAt?: Timestamp | Date | string;
  lockedBy?: string;
  startedAt?: Timestamp | Date | string;
  completedAt?: Timestamp | Date | string;
  failedAt?: Timestamp | Date | string;
  costUsd?: number;
  result?: Record<string, unknown>;
  createdAt: Timestamp | Date | string;
  updatedAt: Timestamp | Date | string;
}

/**
 * Atomic API spend record for budget tracking (REQ-024)
 */
export interface ApiSpendRecord {
  provider: "openai" | "anthropic" | "serper" | "dropcontact" | "google_places" | "pagespeed" | "pappers" | string;
  costUsd: number;
  tokensOrCredits?: number;
  operation: string;
  companyId?: string;
  workspaceId: string;
  businessId: string;
  timestamp: Timestamp | Date | string;
}

/**
 * Daily aggregated API spend document stored under apiSpendDaily/{workspaceId}_{businessId}_{YYYY-MM-DD} (REQ-024)
 */
export interface ApiSpendDailyDoc {
  id: string;
  workspaceId: string;
  businessId: string;
  date: string; // YYYY-MM-DD
  totalSpendUsd: number;
  spendByProvider: Record<string, number>;
  spendByOperation: Record<string, number>;
  callCount: number;
  budgetCapUsd: number;
  budgetExceeded: boolean;
  createdAt: Timestamp | Date | string;
  updatedAt: Timestamp | Date | string;
}

/**
 * Result of checking budget guardrails before task execution (REQ-024)
 */
export interface SpendBudgetStatus {
  allowed: boolean;
  dailySpendUsd: number;
  dailyBudgetCapUsd: number;
  monthlySpendUsd: number;
  monthlyBudgetCapUsd: number;
  isDailyCapReached: boolean;
  isMonthlyCapReached: boolean;
  reason?: string;
}

/**
 * Real-time queue health metrics and dead-letter count summary (REQ-080)
 */
export interface QueueHealthSummary {
  workspaceId: string;
  businessId?: string;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  deadLetter: number;
  todaySpendUsd: number;
  monthSpendUsd: number;
  dailyBudgetCapUsd: number;
  monthlyBudgetCapUsd: number;
  budgetExceeded: boolean;
  recentJobs: JobQueueDoc[];
  calculatedAt: string;
}

