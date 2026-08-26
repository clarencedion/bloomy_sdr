import { adminDb } from "../config/firebase.js";

export type GlobalSettings = {
  automationPaused: boolean;
  aiProvider: "openai" | "anthropic";
  openAiModel?: string;
  anthropicModel?: string;
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
};

export const defaultSettings: GlobalSettings = {
  automationPaused: true,
  aiProvider: "openai",
  openAiModel: "gpt-4o-mini",
  anthropicModel: "claude-3-5-haiku-20241022",
  openAiApiKeyConfigured: false,
  anthropicApiKeyConfigured: false,
  dailyAiResearchLimit: 25,
  dailyEmailGenerationLimit: 50,
  dailyOutreachSendLimit: 20,
  requireApprovalBeforeExport: true,
  defaultLanguage: "fr",
  companyContext: "Devcomm is a French B2B training and consulting company.",
  bookingLink: "https://calendly.com/devcomm/diagnostic",
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
};

export async function getAiSecrets(): Promise<AiSecrets> {
  const snapshot = await adminDb.doc("settings/aiSecrets").get();
  const data = (snapshot.exists ? snapshot.data() : {}) as AiSecrets;
  return {
    openAiApiKey: process.env.OPENAI_API_KEY?.trim() || data.openAiApiKey,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() || data.anthropicApiKey
  };
}

export type IntegrationSecrets = {
  instantlyApiKey?: string;
  dropcontactApiKey?: string;
  pappersApiKey?: string;
  serperApiKey?: string;
  googleApiKey?: string;
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
    microsoftTenantId: process.env.MICROSOFT_TENANT_ID?.trim() || data.microsoftTenantId,
    microsoftClientId: process.env.MICROSOFT_CLIENT_ID?.trim() || data.microsoftClientId,
    microsoftClientSecret: process.env.MICROSOFT_CLIENT_SECRET?.trim() || data.microsoftClientSecret,
    microsoftRefreshToken: process.env.MICROSOFT_REFRESH_TOKEN?.trim() || data.microsoftRefreshToken,
    instantlyWebhookSecret: process.env.INSTANTLY_WEBHOOK_SECRET?.trim() || data.instantlyWebhookSecret,
    bookingWebhookSecret: process.env.BOOKING_WEBHOOK_SECRET?.trim() || data.bookingWebhookSecret
  };
}

export type IntegrationSecretsStatus = {
  openAiConfigured: boolean;
  anthropicConfigured: boolean;
  dropcontactConfigured: boolean;
  instantlyConfigured: boolean;
  pappersConfigured: boolean;
  serperConfigured: boolean;
  googleConfigured: boolean;
  outlookConfigured: boolean;
};

export async function getIntegrationSecretsStatus(): Promise<IntegrationSecretsStatus> {
  const [ai, integrations] = await Promise.all([getAiSecrets(), getIntegrationSecrets()]);
  return {
    openAiConfigured: Boolean(ai.openAiApiKey),
    anthropicConfigured: Boolean(ai.anthropicApiKey),
    dropcontactConfigured: Boolean(integrations.dropcontactApiKey),
    instantlyConfigured: Boolean(integrations.instantlyApiKey),
    pappersConfigured: Boolean(integrations.pappersApiKey),
    serperConfigured: Boolean(integrations.serperApiKey),
    googleConfigured: Boolean(integrations.googleApiKey),
    outlookConfigured: Boolean(integrations.microsoftRefreshToken && integrations.microsoftClientId)
  };
}

