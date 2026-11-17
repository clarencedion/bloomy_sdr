import { adminDb } from "../config/firebase.js";

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
  /**
   * Areas a campaign searches when it names none of its own. The field already
   * existed in Firestore but was not typed, so discovery could not read it and
   * fell through to a city hardcoded in the Places provider instead.
   */
  defaultDiscoveryCities?: string[];
  defaultDiscoverySegments?: string[];
  enabledDiscoveryProviders?: string[];
};

export const defaultSettings: GlobalSettings = {
  automationPaused: true,
  // Qwen3.8-Flash: $0.16 / $0.47 per million against Haiku 4.5's $1 / $5.
  // The factory falls through to any configured provider, so a deployment
  // without a Qwen key keeps working on whichever key it does have.
  aiProvider: "qwen",
  openAiModel: "gpt-4o-mini",
  anthropicModel: "claude-haiku-4-5",
  qwenModel: "qwen3.8-flash",
  openAiApiKeyConfigured: false,
  anthropicApiKeyConfigured: false,
  qwenApiKeyConfigured: false,
  dailyAiResearchLimit: 25,
  dailyEmailGenerationLimit: 50,
  dailyOutreachSendLimit: 20,
  requireApprovalBeforeExport: true,
  defaultLanguage: "fr",
  // No business-specific defaults (Invariant 1): "our company" and the booking
  // link come from each business's own profile.
  companyContext: "",
  bookingLink: "",
  dailyDiscoveryLimit: 100,
  autoQueueDiscoveredCompanies: true,
  minDiscoveryScoreForAutoResearch: 80,
  minQualityScoreForAutoResearch: 70,
  autoFindContactsAfterResearch: false,
  autoSendAfterApproval: false,
  autoApproveOutreach: false,
  minFitScoreForAutoSend: 70,
  dailySpendBudgetUsd: 25,
  monthlySpendBudgetUsd: 250,
  enableTaskQueues: true,
  maxConcurrentTasks: 5,
  testModeEnabled: false,
  testEmailAllowlist: [],
  demoModeActive: false
};

export async function getGlobalSettings(): Promise<GlobalSettings> {
  const snapshot = await adminDb.doc("settings/global").get();
  return { ...defaultSettings, ...(snapshot.exists ? snapshot.data() : {}) } as GlobalSettings;
}

export type AiSecrets = {
  openAiApiKey?: string;
  anthropicApiKey?: string;
  qwenApiKey?: string;
};

export async function getAiSecrets(): Promise<AiSecrets> {
  const snapshot = await adminDb.doc("settings/aiSecrets").get();
  const data = (snapshot.exists ? snapshot.data() : {}) as AiSecrets;
  return {
    openAiApiKey: process.env.OPENAI_API_KEY?.trim() || data.openAiApiKey,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() || data.anthropicApiKey,
    // DASHSCOPE_API_KEY is the name QwenCloud's own documentation uses.
    qwenApiKey:
      process.env.QWEN_API_KEY?.trim() || process.env.DASHSCOPE_API_KEY?.trim() || data.qwenApiKey
  };
}

export type IntegrationSecrets = {
  instantlyApiKey?: string;
  dropcontactApiKey?: string;
  pappersApiKey?: string;
  serperApiKey?: string;
  googleApiKey?: string;
  emailVerifierApiKey?: string;
  microsoftTenantId?: string;
  microsoftClientId?: string;
  microsoftClientSecret?: string;
  microsoftRefreshToken?: string;
  instantlyWebhookSecret?: string;
  bookingWebhookSecret?: string;
};

export async function getIntegrationSecrets(): Promise<IntegrationSecrets> {
  const snapshot = await adminDb.doc("settings/integrationSecrets").get();
  const data = (snapshot.exists ? snapshot.data() : {}) as IntegrationSecrets;
  return {
    instantlyApiKey: process.env.INSTANTLY_API_KEY?.trim() || data.instantlyApiKey,
    dropcontactApiKey: process.env.DROPCONTACT_API_KEY?.trim() || data.dropcontactApiKey,
    pappersApiKey: process.env.PAPPERS_API_KEY?.trim() || data.pappersApiKey,
    serperApiKey: process.env.SERPER_API_KEY?.trim() || data.serperApiKey,
    googleApiKey: process.env.GOOGLE_API_KEY?.trim() || data.googleApiKey,
    emailVerifierApiKey: process.env.EMAIL_VERIFIER_API_KEY?.trim() || data.emailVerifierApiKey,
    microsoftTenantId: process.env.MICROSOFT_TENANT_ID?.trim() || data.microsoftTenantId,
    microsoftClientId: process.env.MICROSOFT_CLIENT_ID?.trim() || data.microsoftClientId,
    microsoftClientSecret: process.env.MICROSOFT_CLIENT_SECRET?.trim() || data.microsoftClientSecret,
    microsoftRefreshToken: process.env.MICROSOFT_REFRESH_TOKEN?.trim() || data.microsoftRefreshToken,
    instantlyWebhookSecret: process.env.INSTANTLY_WEBHOOK_SECRET?.trim() || data.instantlyWebhookSecret,
    bookingWebhookSecret: process.env.BOOKING_WEBHOOK_SECRET?.trim() || data.bookingWebhookSecret
  };
}

export type IntegrationSecretsStatus = {
  qwenConfigured: boolean;
  openAiConfigured: boolean;
  anthropicConfigured: boolean;
  dropcontactConfigured: boolean;
  instantlyConfigured: boolean;
  pappersConfigured: boolean;
  serperConfigured: boolean;
  googleConfigured: boolean;
  emailVerifierConfigured: boolean;
  outlookConfigured: boolean;
};

export async function getIntegrationSecretsStatus(): Promise<IntegrationSecretsStatus> {
  const [ai, integrations] = await Promise.all([getAiSecrets(), getIntegrationSecrets()]);
  return {
    openAiConfigured: Boolean(ai.openAiApiKey),
    anthropicConfigured: Boolean(ai.anthropicApiKey),
    qwenConfigured: Boolean(ai.qwenApiKey),
    dropcontactConfigured: Boolean(integrations.dropcontactApiKey),
    instantlyConfigured: Boolean(integrations.instantlyApiKey),
    pappersConfigured: Boolean(integrations.pappersApiKey),
    serperConfigured: Boolean(integrations.serperApiKey),
    googleConfigured: Boolean(integrations.googleApiKey),
    emailVerifierConfigured: Boolean(integrations.emailVerifierApiKey),
    outlookConfigured: Boolean(integrations.microsoftRefreshToken && integrations.microsoftClientId)
  };
}

