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

export async function callRunDualFixtureTest(params?: { mode?: "bloomy" | "devcomm" | "both"; testId?: string; workspaceId?: string }) {
  const callable = httpsCallable(functions, "runDualFixtureTestNow", { timeout: 300000 });
  const result = await callable(params || {});
  return result.data as {
    workspaceId: string;
    testId: string;
    mode: string;
    success: boolean;
    bloomyResult?: any;
    devcommResult?: any;
    comparison: {
      signalsDivergenceVerified: boolean;
      personaDivergenceVerified: boolean;
      knowledgeIsolationVerified: boolean;
      zeroGenericCodeChangesVerified: boolean;
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
  qwenConfigured: boolean;
  openAiConfigured: boolean;
  anthropicConfigured: boolean;
  dropcontactConfigured: boolean;
  instantlyConfigured: boolean;
  pappersConfigured: boolean;
  serperConfigured: boolean;
  googleConfigured?: boolean;
  emailVerifierConfigured?: boolean;
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
  googleApiKey?: string;
  emailVerifierApiKey?: string;
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
  qwenApiKey?: string;
}): Promise<IntegrationSecretsStatus> {
  const callable = httpsCallable(functions, "saveAiSecrets");
  const result = await callable(input);
  return result.data as IntegrationSecretsStatus;
}

export async function callClearAiSecret(provider: "openai" | "anthropic" | "qwen"): Promise<IntegrationSecretsStatus> {
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

export async function callScoreOpportunity(input: {
  companyId: string;
  offerId?: string;
  campaignId?: string;
}) {
  const callable = httpsCallable(functions, "scoreOpportunityNow", { timeout: 60000 });
  const result = await callable(input);
  return result.data as import("@/types/domain").OpportunityScore;
}

export async function callGetInboxSummary(input?: { workspaceId?: string; businessId?: string }) {
  const callable = httpsCallable(functions, "getInboxSummaryCallable");
  const result = await callable(input || {});
  return result.data as {
    needsAttention: number;
    inDialogue: number;
    meetingBooked: number;
    humanEscalated: number;
    suppressed: number;
    total: number;
  };
}

export async function callTakeOverConversation(input: {
  conversationId: string;
  workspaceId?: string;
  businessId?: string;
}) {
  const callable = httpsCallable(functions, "takeOverConversationCallable");
  const result = await callable(input);
  return result.data as { success: boolean; conversation: import("@/types/domain").ConversationDoc };
}

export async function callReleaseTakeover(input: { conversationId: string }) {
  const callable = httpsCallable(functions, "releaseTakeoverCallable");
  const result = await callable(input);
  return result.data as { success: boolean; conversation: import("@/types/domain").ConversationDoc };
}

export async function callSendManualReply(input: {
  conversationId: string;
  subject?: string;
  bodyText: string;
  recipientEmail?: string;
  senderEmail?: string;
}) {
  const callable = httpsCallable(functions, "sendManualReplyCallable");
  const result = await callable(input);
  // delivered: false means stored only — the operator must send it elsewhere.
  return result.data as { success: boolean; messageId: string; delivered?: boolean; notice?: string };
}

export async function callUpdateConversationStatus(input: {
  conversationId: string;
  status?: import("@/types/domain").ConversationStatus;
  assignedRepUserId?: string;
  pinned?: boolean;
}) {
  const callable = httpsCallable(functions, "updateConversationStatusCallable");
  const result = await callable(input);
  return result.data as { success: boolean };
}

export async function callGetRecentAgentActivity(input?: {
  workspaceId?: string;
  businessId?: string;
  limit?: number;
}) {
  const callable = httpsCallable(functions, "getRecentAgentActivityCallable");
  const result = await callable(input || {});
  return result.data as Array<{
    id: string;
    type: string;
    level: "debug" | "info" | "warning" | "error";
    message: string;
    createdAt: string;
    metadata?: Record<string, unknown>;
  }>;
}

export async function callApproveAndSendReply(input: {
  conversationId: string;
  customSubject?: string;
  customBodyText?: string;
}) {
  const callable = httpsCallable(functions, "approveAndSendReplyCallable");
  const result = await callable(input);
  return result.data as { success: boolean; messageId: string; delivered?: boolean; notice?: string };
}

export async function callEscalateConversation(input: {
  conversationId: string;
  reason?: string;
  workspaceId?: string;
  businessId?: string;
}) {
  const callable = httpsCallable(functions, "escalateConversationCallable");
  const result = await callable(input);
  return result.data as { success: boolean; conversationId: string; reason: string; escalatedAt: string };
}

export async function callGetAnalyticsSummary(input?: {
  workspaceId?: string;
  businessId?: string;
  offerId?: string;
  campaignId?: string;
}) {
  const callable = httpsCallable(functions, "getAnalyticsSummaryCallable", { timeout: 60000 });
  const result = await callable(input || {});
  return result.data as import("@/types/domain").AnalyticsSummary;
}

export async function callRunDailyAnalyticsAggregator() {
  const callable = httpsCallable(functions, "runDailyAnalyticsAggregatorCallable", { timeout: 120000 });
  const result = await callable({});
  return result.data as {
    workspacesProcessed: number;
    businessesProcessed: number;
    snapshotsCreated: number;
  };
}

export async function callGetPerformanceInsights(input?: {
  workspaceId?: string;
  businessId?: string;
  offerId?: string;
}) {
  const callable = httpsCallable(functions, "getPerformanceInsightsCallable");
  const result = await callable(input || {});
  return result.data as import("@/types/domain").PerformanceInsightsDoc;
}

export async function callGetQueueHealth(input?: {
  workspaceId?: string;
  businessId?: string;
}) {
  const callable = httpsCallable(functions, "getQueueHealthCallable");
  const result = await callable(input || {});
  return result.data as import("@/types/domain").QueueHealthSummary;
}

export async function callGetCostSummary(input?: {
  workspaceId?: string;
  businessId?: string;
}) {
  const callable = httpsCallable(functions, "getCostSummaryCallable");
  const result = await callable(input || {});
  return result.data as {
    todaySpendUsd: number;
    monthSpendUsd: number;
    spendByProvider: Record<string, number>;
    spendByOperation: Record<string, number>;
    dailyBudgetCapUsd: number;
    monthlyBudgetCapUsd: number;
    budgetExceeded: boolean;
    isDailyCapReached: boolean;
    isMonthlyCapReached: boolean;
  };
}

export async function callProcessTaskQueue(input?: {
  limit?: number;
  workspaceId?: string;
  businessId?: string;
}) {
  const callable = httpsCallable(functions, "processTaskQueueCallable");
  const result = await callable(input || {});
  return result.data as { processed: number; succeeded: number; failed: number; retried: number };
}

export async function callRetryTaskJob(input?: {
  jobIds?: string[];
  workspaceId?: string;
  businessId?: string;
}) {
  const callable = httpsCallable(functions, "retryTaskJobCallable");
  const result = await callable(input || {});
  return result.data as { retriedCount: number };
}

export async function callEnqueueTask(input: {
  taskType: string;
  payload: Record<string, unknown>;
  workspaceId?: string;
  businessId?: string;
  maxRetries?: number;
  runImmediately?: boolean;
}) {
  const callable = httpsCallable(functions, "enqueueTaskCallable");
  const result = await callable(input);
  return result.data as { ok: boolean; jobId: string };
}

export async function callSaveBudgetSettings(input: {
  dailySpendBudgetUsd?: number;
  monthlySpendBudgetUsd?: number;
}) {
  const callable = httpsCallable(functions, "saveBudgetSettingsCallable");
  const result = await callable(input);
  return result.data as { ok: boolean; dailySpendBudgetUsd?: number; monthlySpendBudgetUsd?: number };
}

export async function callRunSdrDemoSimulation(input?: {
  archetype?: "bloomy" | "devcomm";
  replyScenario?: "BOOKING_REQUEST" | "OBJECTION" | "QUESTION" | "UNSUBSCRIBE" | "OUT_OF_OFFICE";
  targetEmail?: string;
  dryRun?: boolean;
}) {
  try {
    const callable = httpsCallable(functions, "runSdrDemoSimulationNow", { timeout: 60000 });
    const result = await callable(input || {});
    return result.data as Record<string, unknown>;
  } catch (cloudFnErr) {
    console.warn("Cloud Function simulation unavailable, using Next.js local API route fallback:", cloudFnErr);
    const res = await fetch("/api/demo/simulation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input || {}),
    });
    if (!res.ok) {
      throw new Error(`Demo simulation failed: ${res.statusText}`);
    }
    return (await res.json()) as Record<string, unknown>;
  }
}



export async function callGenerateSocialDm(input: { companyId: string; campaignId?: string; force?: boolean }) {
  const callable = httpsCallable(functions, "generateSocialDmCallable", { timeout: 120000 });
  const result = await callable(input);
  return result.data as { outreachId: string; channel: "social_dm"; profileUrl: string; body: string };
}

/**
 * Records a DM (or a hand-sent contact-form message) as sent by the person.
 * `network` is the network the DM actually went out on, so the conversation
 * is opened there and that network's inbox session picks up the reply. It is
 * omitted for a contact form or a legacy link with no recognised network.
 */
export async function callMarkSocialDmSent(outreachId: string, network?: "instagram" | "facebook") {
  const callable = httpsCallable(functions, "markSocialDmSentCallable");
  const result = await callable(network ? { outreachId, network } : { outreachId });
  return result.data as { success: boolean; alreadySent?: boolean };
}


export async function callSubmitContactForm(outreachId: string) {
  const callable = httpsCallable(functions, "submitContactFormCallable", { timeout: 120000 });
  const result = await callable({ outreachId });
  return result.data as {
    status: "sent" | "assisted" | "skipped";
    channel: string;
    pageUrl?: string;
    reason?: string;
  };
}


/**
 * Deletes a business's prospecting data, keeping its configuration.
 *
 * Long client timeout: the purge walks several collections in batches and
 * recursively deletes conversation threads, which takes real time on a
 * workspace that has been running for a while.
 */
export async function callPurgeBusinessData(input: {
  workspaceId: string;
  businessId: string;
  confirmName: string;
}) {
  const callable = httpsCallable(functions, "purgeBusinessDataCallable", { timeout: 540000 });
  const result = await callable(input);
  return result.data as {
    deleted: Record<string, number>;
    total: number;
    unassignedDeleted: number;
    kept: string[];
  };
}
