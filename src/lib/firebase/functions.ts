"use client";

import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "@/lib/firebase/client";

const functions = getFunctions(app, "europe-west1");

export function getCallableErrorMessage(error: unknown, fallback: string) {
  if (typeof error === "object" && error) {
    const record = error as { message?: unknown; code?: unknown; details?: unknown };
    const message = typeof record.message === "string" ? record.message : undefined;
    const details = typeof record.details === "string" ? record.details : undefined;
    const code = typeof record.code === "string" ? record.code : undefined;
    if (details && message && message !== details) return `${message}: ${details}`;
    if (details) return details;
    if (message) return message;
    if (code) return code;
  }
  return fallback;
}

export async function callResearchCompany(companyId: string, force = false) {
  const callable = httpsCallable(functions, "researchCompanyNow");
  const result = await callable({ companyId, force });
  return result.data as { researchId: string; status: string; error?: string };
}

export async function callRunDiscoveryCampaign(campaignId: string) {
  const callable = httpsCallable(functions, "runDiscoveryCampaignNow");
  const result = await callable({ campaignId });
  return result.data as { runId: string; provider: string; companiesFound: number };
}

export async function callRunFullAutomationTest(campaignId: string, testId: string) {
  const callable = httpsCallable(functions, "runFullAutomationTestNow", { timeout: 240000 });
  const result = await callable({ campaignId, testId });
  return result.data as {
    success: boolean;
    result: {
      company: { id: string; name: string; website: string; domain: string };
      research: { fitScore: number; confidence: number; summary: string };
      contact: { fullName: string; email: string; role: string } | null;
      outreach: { id: string; subject: string; body: string };
    };
  };
}


export async function callEnrichCompany(companyId: string) {
  const callable = httpsCallable(functions, "enrichCompanyNow");
  const result = await callable({ companyId });
  return result.data as { status: string; emailsCreated: number; pagesFetched: number; leadReadyForOutreach?: boolean; error?: string };
}

export async function callQueueResearch(companyId: string) {
  const callable = httpsCallable(functions, "queueResearch");
  const result = await callable({ companyId });
  return result.data as { queued: boolean; researchId: string };
}

export async function callSkipResearch(researchId: string) {
  const callable = httpsCallable(functions, "skipResearch");
  const result = await callable({ researchId });
  return result.data as { skipped: boolean };
}

export async function callGenerateOutreach(input: { companyId: string; contactId?: string; campaignId?: string; force?: boolean; outreachId?: string }) {
  const callable = httpsCallable(functions, "generateOutreachNow");
  const result = await callable(input);
  return result.data as { outreachId: string; status: string; error?: string };
}

export async function callUpdateOutreachDraft(outreachId: string, fields: Record<string, unknown>) {
  const callable = httpsCallable(functions, "updateOutreachDraft");
  const result = await callable({ outreachId, fields });
  return result.data as { outreachId: string; status: string };
}

export async function callApproveOutreach(outreachId: string) {
  const callable = httpsCallable(functions, "approveOutreach");
  const result = await callable({ outreachId });
  return result.data as { outreachId: string; status: string };
}

export async function callRejectOutreach(outreachId: string, reason?: string) {
  const callable = httpsCallable(functions, "rejectOutreach");
  const result = await callable({ outreachId, reason });
  return result.data as { outreachId: string; status: string };
}

export async function callNeedsMoreResearch(outreachId: string) {
  const callable = httpsCallable(functions, "markOutreachNeedsResearch");
  const result = await callable({ outreachId });
  return result.data as { outreachId: string; status: string };
}

export async function callFindContactsForCompany(companyId: string) {
  const callable = httpsCallable(functions, "findContactsForCompany", { timeout: 120000 });
  const result = await callable({ companyId });
  return result.data as { found: number; created: number; skipped: number; error?: string };
}

export async function callSyncOutlookCalendar() {
  const callable = httpsCallable(functions, "syncOutlookCalendarNow");
  const result = await callable({});
  return result.data as { ok: boolean };
}

export async function callRunResearchQueue() {
  const callable = httpsCallable(functions, "runResearchQueueNow", { timeout: 540000 });
  const result = await callable({});
  return result.data as { ok: boolean };
}

export async function callGenerateProposalPdf(outreachId: string) {
  const callable = httpsCallable(functions, "generateProposalPdf", { timeout: 120000 });
  const result = await callable({ outreachId });
  return result.data as { documentId: string; downloadUrl: string };
}

export async function callSendApprovedOutreach(outreachId: string) {
  const callable = httpsCallable(functions, "sendApprovedOutreach", { timeout: 60000 });
  const result = await callable({ outreachId });
  return result.data as { outreachId: string; status: string; leadId?: string };
}

export async function callExportOutreachCsv(outreachIds: string[]) {
  const callable = httpsCallable(functions, "exportOutreachCsv", { timeout: 60000 });
  const result = await callable({ outreachIds });
  return result.data as { downloadUrl: string; count: number };
}

export type IntegrationSecretsStatus = {
  openAiConfigured: boolean;
  anthropicConfigured: boolean;
  dropcontactConfigured: boolean;
  instantlyConfigured: boolean;
  pappersConfigured: boolean;
  serperConfigured: boolean;
  outlookConfigured: boolean;
};

export async function callGetIntegrationSecretsStatus(): Promise<IntegrationSecretsStatus> {
  const callable = httpsCallable(functions, "getIntegrationSecretsStatus");
  const result = await callable({});
  return result.data as IntegrationSecretsStatus;
}

export async function callSaveIntegrationSecrets(input: {
  dropcontactApiKey?: string;
  instantlyApiKey?: string;
  pappersApiKey?: string;
  serperApiKey?: string;
  microsoftTenantId?: string;
  microsoftClientId?: string;
  microsoftClientSecret?: string;
  microsoftRefreshToken?: string;
  instantlyWebhookSecret?: string;
  bookingWebhookSecret?: string;
}): Promise<IntegrationSecretsStatus> {
  const callable = httpsCallable(functions, "saveIntegrationSecrets");
  const result = await callable(input);
  return result.data as IntegrationSecretsStatus;
}

export async function callSaveAiSecrets(input: {
  openAiApiKey?: string;
  anthropicApiKey?: string;
}): Promise<IntegrationSecretsStatus> {
  const callable = httpsCallable(functions, "saveAiSecrets");
  const result = await callable(input);
  return result.data as IntegrationSecretsStatus;
}

export async function callClearAiSecret(provider: "openai" | "anthropic"): Promise<IntegrationSecretsStatus> {
  const callable = httpsCallable(functions, "clearAiSecret");
  const result = await callable({ provider });
  return result.data as IntegrationSecretsStatus;
}

export async function callCheckContactability(
  contactId: string,
  businessId?: string,
  checkDailyLimit = false
): Promise<{ allowed: boolean; reason?: string; details?: Record<string, unknown> }> {
  const callable = httpsCallable(functions, "checkContactability");
  const result = await callable({ contactId, businessId, checkDailyLimit });
  return result.data as { allowed: boolean; reason?: string; details?: Record<string, unknown> };
}

export async function callTranslateIcpPrompt(input: {
  prompt: string;
  offerId?: string;
  workspaceId?: string;
  businessId?: string;
}) {
  const callable = httpsCallable(functions, "translateIcpPromptCallable", { timeout: 60000 });
  const result = await callable(input);
  return result.data as import("@/types/domain").IcpTranslationResult;
}

export async function callCollectCompanySignals(input: {
  companyId: string;
  workspaceId?: string;
  businessId?: string;
  requestedProviders?: string[];
  forceRefresh?: boolean;
}) {
  const callable = httpsCallable(functions, "collectCompanySignalsCallable", { timeout: 120000 });
  const result = await callable(input);
  return result.data as {
    evidence: import("@/types/domain").EvidenceItem[];
    results: import("@/types/domain").SignalResult[];
    totalCostUsd: number;
    totalDurationMs: number;
    errors: Array<{ providerId: string; error: string }>;
  };
}

export async function callListCompanyEvidence(companyId: string, options?: { signalProviders?: string[]; unexpiredOnly?: boolean }) {
  const callable = httpsCallable(functions, "listCompanyEvidenceCallable");
  const result = await callable({ companyId, ...options });
  return result.data as import("@/types/domain").EvidenceItem[];
}



