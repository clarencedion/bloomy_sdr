import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { getGlobalSettings } from "./utils/settings.js";
import { writeLog } from "./utils/logger.js";
import { runDiscoveryCampaign } from "./services/run-discovery-campaign.js";
import { queueCompanyForResearch, researchCompany, skipPendingResearch } from "./services/research-company.js";
import { generateOutreach, setOutreachStatus, updateOutreachDraft as updateOutreachDraftService } from "./services/outreach-generation.js";
import { enrichCompanyWebsite } from "./services/company-enrichment.js";
import { runDailyResearchQueue } from "./jobs/daily-research-runner.js";
import { runHourlyOutreachSync } from "./jobs/hourly-outreach-sync.js";
import { runCalendarSync } from "./jobs/calendar-sync-job.js";
import { findContactsForCompany as findContactsService } from "./services/contact-discovery.js";
import { generateProposalPdf as generatePdfService } from "./services/pdf-generator.js";
import { sendApprovedOutreach as sendOutreachService } from "./services/send-outreach.js";
import { exportOutreachToCsv } from "./services/csv-exporter.js";
import { runFullAutomationTest } from "./services/test-automation.js";


const callableOptions = { region: "europe-west1", invoker: "public", cors: true } as const;

export const healthCheck = onCall(callableOptions, async () => {
  const settings = await getGlobalSettings();
  await writeLog({
    type: "functions.health_check",
    level: "info",
    message: "Cloud Functions health check called.",
    metadata: { automationPaused: settings.automationPaused }
  });
  logger.info("Health check completed", { automationPaused: settings.automationPaused });
  return {
    ok: true,
    phase: "foundation",
    automationPaused: settings.automationPaused
  };
});

export const runDiscoveryCampaignNow = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const campaignId = request.data?.campaignId;
  if (typeof campaignId !== "string" || !campaignId) throw new HttpsError("invalid-argument", "campaignId is required.");
  return runDiscoveryCampaign(campaignId);
});

export const queueResearch = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const companyId = request.data?.companyId;
  if (typeof companyId !== "string" || !companyId) throw new HttpsError("invalid-argument", "companyId is required.");
  return queueCompanyForResearch(companyId);
});

export const researchCompanyNow = onCall({ ...callableOptions, timeoutSeconds: 120, memory: "512MiB" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const companyId = request.data?.companyId;
  if (typeof companyId !== "string" || !companyId) throw new HttpsError("invalid-argument", "companyId is required.");
  return researchCompany(companyId, { force: request.data?.force === true });
});

export const enrichCompanyNow = onCall({ ...callableOptions, timeoutSeconds: 120, memory: "512MiB" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const companyId = request.data?.companyId;
  if (typeof companyId !== "string" || !companyId) throw new HttpsError("invalid-argument", "companyId is required.");
  return enrichCompanyWebsite(companyId);
});

export const skipResearch = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const researchId = request.data?.researchId;
  if (typeof researchId !== "string" || !researchId) throw new HttpsError("invalid-argument", "researchId is required.");
  return skipPendingResearch(researchId);
});

export const generateOutreachNow = onCall({ ...callableOptions, timeoutSeconds: 120, memory: "512MiB" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const companyId = request.data?.companyId;
  if (typeof companyId !== "string" || !companyId) throw new HttpsError("invalid-argument", "companyId is required.");
  return generateOutreach({
    companyId,
    contactId: typeof request.data?.contactId === "string" ? request.data.contactId : undefined,
    campaignId: typeof request.data?.campaignId === "string" ? request.data.campaignId : undefined,
    force: request.data?.force === true,
  });
});

export const runFullAutomationTestNow = onCall({ ...callableOptions, timeoutSeconds: 240, memory: "512MiB" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const campaignId = request.data?.campaignId;
  const testId = request.data?.testId;
  if (typeof campaignId !== "string" || !campaignId) throw new HttpsError("invalid-argument", "campaignId is required.");
  if (typeof testId !== "string" || !testId) throw new HttpsError("invalid-argument", "testId is required.");
  return runFullAutomationTest(campaignId, testId);
});



export const updateOutreachDraft = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  if (typeof request.data?.outreachId !== "string") throw new HttpsError("invalid-argument", "outreachId is required.");
  return updateOutreachDraftService(request.data.outreachId, request.data.fields ?? {});
});

export const approveOutreach = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  if (typeof request.data?.outreachId !== "string") throw new HttpsError("invalid-argument", "outreachId is required.");
  return setOutreachStatus(request.data.outreachId, "approved", request.auth.uid);
});

export const rejectOutreach = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  if (typeof request.data?.outreachId !== "string") throw new HttpsError("invalid-argument", "outreachId is required.");
  return setOutreachStatus(request.data.outreachId, "rejected", request.auth.uid, typeof request.data?.reason === "string" ? request.data.reason : undefined);
});

export const markOutreachNeedsResearch = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  if (typeof request.data?.outreachId !== "string") throw new HttpsError("invalid-argument", "outreachId is required.");
  return setOutreachStatus(request.data.outreachId, "needs_more_research", request.auth.uid);
});

export const scheduledLeadDiscoveryRunner = onSchedule(
  {
    region: "europe-west1",
    schedule: "every day 07:00",
    timeZone: "Europe/Paris"
  },
  async () => {
    const settings = await getGlobalSettings();
    if (settings.automationPaused) {
      logger.info("Scheduled discovery skipped because automation is paused.");
      return;
    }

    const campaigns = await (await import("./config/firebase.js")).adminDb
      .collection("discoveryCampaigns")
      .where("status", "==", "active")
      .limit(Math.max(1, Math.min(settings.dailyDiscoveryLimit ?? 10, 10)))
      .get();

    for (const campaign of campaigns.docs) {
      await runDiscoveryCampaign(campaign.id);
    }
  }
);

export const dailyResearchQueueRunner = onSchedule(
  {
    region: "europe-west1",
    schedule: "every day 08:00",
    timeZone: "Europe/Paris",
    timeoutSeconds: 540,
    memory: "512MiB"
  },
  async () => {
    await runDailyResearchQueue();
  }
);

export const hourlyOutreachStatusSync = onSchedule(
  {
    region: "europe-west1",
    schedule: "every 1 hours",
    timeZone: "Europe/Paris",
    timeoutSeconds: 120
  },
  async () => {
    await runHourlyOutreachSync();
  }
);

export const calendarSyncJob = onSchedule(
  {
    region: "europe-west1",
    schedule: "every 1 hours",
    timeZone: "Europe/Paris",
    timeoutSeconds: 120
  },
  async () => {
    await runCalendarSync();
  }
);

export const runResearchQueueNow = onCall({ ...callableOptions, timeoutSeconds: 540, memory: "512MiB" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  await runDailyResearchQueue();
  return { ok: true };
});

export const syncOutlookCalendarNow = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  await runCalendarSync();
  return { ok: true };
});

export const findContactsForCompany = onCall({ ...callableOptions, timeoutSeconds: 120, memory: "256MiB" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const companyId = request.data?.companyId;
  if (typeof companyId !== "string" || !companyId) throw new HttpsError("invalid-argument", "companyId is required.");
  return findContactsService(companyId);
});

export const generateProposalPdf = onCall({ ...callableOptions, timeoutSeconds: 120, memory: "512MiB" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const outreachId = request.data?.outreachId;
  if (typeof outreachId !== "string" || !outreachId) throw new HttpsError("invalid-argument", "outreachId is required.");
  try {
    return await generatePdfService(outreachId);
  } catch (error: any) {
    const errorStr = typeof error === "object" && error ? (error.message || JSON.stringify(error)) : String(error);
    const isBucketMissing = errorStr.includes("bucket does not exist") || error?.code === 404;
    const msg = isBucketMissing
      ? "Firebase Storage bucket 'devcomm-os.firebasestorage.app' does not exist. Please go to the Firebase Console -> Storage and click 'Get Started' to enable Storage."
      : `PDF generation failed: ${errorStr}`;
    throw new HttpsError("failed-precondition", msg);
  }
});

export const sendApprovedOutreach = onCall({ ...callableOptions, timeoutSeconds: 60 }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const outreachId = request.data?.outreachId;
  if (typeof outreachId !== "string" || !outreachId) throw new HttpsError("invalid-argument", "outreachId is required.");
  return sendOutreachService(outreachId);
});

export const exportOutreachCsv = onCall({ ...callableOptions, timeoutSeconds: 60, memory: "256MiB" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const outreachIds = request.data?.outreachIds;
  if (!Array.isArray(outreachIds) || !outreachIds.length) throw new HttpsError("invalid-argument", "outreachIds array is required.");
  return exportOutreachToCsv(outreachIds as string[]);
});

export const getIntegrationSecretsStatus = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const { getIntegrationSecretsStatus: getStatus } = await import("./utils/settings.js");
  return getStatus();
});

export const saveIntegrationSecrets = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const input = request.data ?? {};
  const allowedKeys = [
    "dropcontactApiKey",
    "instantlyApiKey",
    "pappersApiKey",
    "serperApiKey",
    "microsoftTenantId",
    "microsoftClientId",
    "microsoftClientSecret",
    "microsoftRefreshToken",
    "instantlyWebhookSecret",
    "bookingWebhookSecret"
  ] as const;

  const updates: Record<string, string> = {};
  for (const key of allowedKeys) {
    if (typeof input[key] === "string" && input[key].trim()) {
      updates[key] = input[key].trim();
    }
  }

  if (Object.keys(updates).length > 0) {
    const { adminDb } = await import("./config/firebase.js");
    const { Timestamp } = await import("firebase-admin/firestore");
    await adminDb.doc("settings/integrationSecrets").set({ ...updates, updatedAt: Timestamp.now() }, { merge: true });
    await writeLog({
      type: "settings.integrations.saved",
      level: "info",
      message: `Integration secrets updated (${Object.keys(updates).join(", ")}).`,
      metadata: { updatedKeys: Object.keys(updates), userId: request.auth.uid }
    });
  }

  const { getIntegrationSecretsStatus: getStatus } = await import("./utils/settings.js");
  return getStatus();
});

export const saveAiSecrets = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const input = request.data ?? {};
  const updates: Record<string, string> = {};
  const globalUpdates: Record<string, unknown> = {};

  if (typeof input.openAiApiKey === "string" && input.openAiApiKey.trim()) {
    updates.openAiApiKey = input.openAiApiKey.trim();
    globalUpdates.openAiApiKeyConfigured = true;
  }
  if (typeof input.anthropicApiKey === "string" && input.anthropicApiKey.trim()) {
    updates.anthropicApiKey = input.anthropicApiKey.trim();
    globalUpdates.anthropicApiKeyConfigured = true;
  }

  const { adminDb } = await import("./config/firebase.js");
  const { Timestamp } = await import("firebase-admin/firestore");
  const now = Timestamp.now();

  if (Object.keys(updates).length > 0) {
    await adminDb.doc("settings/aiSecrets").set({ ...updates, updatedAt: now }, { merge: true });
  }
  if (Object.keys(globalUpdates).length > 0) {
    await adminDb.doc("settings/global").set({ ...globalUpdates, updatedAt: now }, { merge: true });
  }

  await writeLog({
    type: "settings.ai_secrets.saved",
    level: "info",
    message: "AI provider secrets updated.",
    metadata: { updatedKeys: Object.keys(updates), userId: request.auth.uid }
  });

  const { getIntegrationSecretsStatus: getStatus } = await import("./utils/settings.js");
  return getStatus();
});

export const clearAiSecret = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const provider = request.data?.provider;
  if (provider !== "openai" && provider !== "anthropic") {
    throw new HttpsError("invalid-argument", "Provider must be 'openai' or 'anthropic'.");
  }

  const { adminDb } = await import("./config/firebase.js");
  const { FieldValue, Timestamp } = await import("firebase-admin/firestore");
  const now = Timestamp.now();

  await Promise.all([
    adminDb.doc("settings/aiSecrets").set(
      {
        [provider === "openai" ? "openAiApiKey" : "anthropicApiKey"]: FieldValue.delete(),
        updatedAt: now
      },
      { merge: true }
    ),
    adminDb.doc("settings/global").set(
      {
        [provider === "openai" ? "openAiApiKeyConfigured" : "anthropicApiKeyConfigured"]: false,
        updatedAt: now
      },
      { merge: true }
    )
  ]);

  await writeLog({
    type: "settings.ai_secret.cleared",
    level: "warning",
    message: `${provider} API key cleared.`,
    metadata: { provider, userId: request.auth.uid }
  });

  const { getIntegrationSecretsStatus: getStatus } = await import("./utils/settings.js");
  return getStatus();
});

export const checkContactability = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const contactId = request.data?.contactId;
  if (typeof contactId !== "string" || !contactId) throw new HttpsError("invalid-argument", "contactId is required.");
  const { canContact } = await import("./services/can-contact.js");
  return canContact(contactId, request.data?.businessId, {
    checkDailyLimit: request.data?.checkDailyLimit === true
  });
});

export const listBusinessesCallable = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const workspaceId = request.data?.workspaceId || "ws_default";
  const { listBusinesses } = await import("./services/business-service.js");
  return listBusinesses(workspaceId);
});

export const createBusinessCallable = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const workspaceId = request.data?.workspaceId || "ws_default";
  const business = request.data?.business;
  if (!business || !business.name) throw new HttpsError("invalid-argument", "business.name is required.");
  const { createBusiness } = await import("./services/business-service.js");
  return createBusiness(workspaceId, business);
});

export const updateBusinessCallable = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const workspaceId = request.data?.workspaceId || "ws_default";
  const businessId = request.data?.businessId;
  const patch = request.data?.patch;
  if (!businessId || !patch) throw new HttpsError("invalid-argument", "businessId and patch are required.");
  const { updateBusiness } = await import("./services/business-service.js");
  return updateBusiness(workspaceId, businessId, patch);
});

export const listOffersCallable = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const workspaceId = request.data?.workspaceId || "ws_default";
  const businessId = request.data?.businessId;
  if (!businessId) throw new HttpsError("invalid-argument", "businessId is required.");
  const { listOffers } = await import("./services/business-service.js");
  return listOffers(workspaceId, businessId);
});

export const createOfferCallable = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const workspaceId = request.data?.workspaceId || "ws_default";
  const businessId = request.data?.businessId;
  const offer = request.data?.offer;
  if (!businessId || !offer || !offer.name) throw new HttpsError("invalid-argument", "businessId and offer.name are required.");
  const { createOffer } = await import("./services/business-service.js");
  return createOffer(workspaceId, businessId, offer);
});

export const updateOfferCallable = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const workspaceId = request.data?.workspaceId || "ws_default";
  const businessId = request.data?.businessId;
  const offerId = request.data?.offerId;
  const patch = request.data?.patch;
  if (!businessId || !offerId || !patch) throw new HttpsError("invalid-argument", "businessId, offerId, and patch are required.");
  const { updateOffer } = await import("./services/business-service.js");
  return updateOffer(workspaceId, businessId, offerId, patch);
});

export const deleteOfferCallable = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const workspaceId = request.data?.workspaceId || "ws_default";
  const businessId = request.data?.businessId;
  const offerId = request.data?.offerId;
  if (!businessId || !offerId) throw new HttpsError("invalid-argument", "businessId and offerId are required.");
  const { deleteOffer } = await import("./services/business-service.js");
  return deleteOffer(workspaceId, businessId, offerId);
});

export const getKnowledgeBaseCallable = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const workspaceId = request.data?.workspaceId || "ws_default";
  const businessId = request.data?.businessId;
  if (!businessId) throw new HttpsError("invalid-argument", "businessId is required.");
  const { getKnowledgeBase } = await import("./services/business-service.js");
  return getKnowledgeBase(workspaceId, businessId);
});

export const saveKnowledgeBaseCallable = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const workspaceId = request.data?.workspaceId || "ws_default";
  const businessId = request.data?.businessId;
  const kb = request.data?.kb;
  if (!businessId || !kb) throw new HttpsError("invalid-argument", "businessId and kb are required.");
  const { saveKnowledgeBase } = await import("./services/business-service.js");
  return saveKnowledgeBase(workspaceId, businessId, kb);
});

export const runBackfillMigrationCallable = onCall({ ...callableOptions, timeoutSeconds: 300 }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const { backfillV2Migration } = await import("./migrations/backfill-v2.js");
  return backfillV2Migration({
    defaultWorkspaceId: request.data?.workspaceId || "ws_default",
    defaultBusinessId: request.data?.businessId || "biz_devcomm",
    dryRun: request.data?.dryRun === true
  });
});

export const translateIcpPromptCallable = onCall({ ...callableOptions, timeoutSeconds: 60 }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const prompt = request.data?.prompt;
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new HttpsError("invalid-argument", "prompt is required.");
  }
  const { translateIcpPrompt } = await import("./services/icp-translator.js");
  return translateIcpPrompt({
    prompt: prompt.trim(),
    offerId: request.data?.offerId,
    workspaceId: request.data?.workspaceId || "ws_default",
    businessId: request.data?.businessId
  });
});

export const collectCompanySignalsCallable = onCall({ ...callableOptions, timeoutSeconds: 120, memory: "512MiB" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const companyId = request.data?.companyId;
  if (typeof companyId !== "string" || !companyId) {
    throw new HttpsError("invalid-argument", "companyId is required.");
  }

  const { adminDb } = await import("./config/firebase.js");
  const companySnapshot = await adminDb.collection("companies").doc(companyId).get();
  if (!companySnapshot.exists) {
    throw new HttpsError("not-found", `Company not found: ${companyId}`);
  }

  const companyData = companySnapshot.data() || {};
  const { runSignalCollection } = await import("./services/signal-coordinator.js");

  const context = {
    workspaceId: request.data?.workspaceId || companyData.workspaceId || "ws_default",
    businessId: request.data?.businessId || companyData.businessId || "biz_devcomm",
    campaignId: request.data?.campaignId || companyData.discoveryCampaignId,
    offerId: request.data?.offerId || companyData.offerId,
    company: {
      id: companyId,
      name: companyData.name || "",
      domain: companyData.domain,
      website: companyData.website,
      siren: companyData.siren,
      siret: companyData.siret,
      city: companyData.city,
      postalCode: companyData.postalCode,
      address: companyData.address,
      rawProviderData: companyData.rawProviderData
    }
  };

  return runSignalCollection(context, {
    requestedProviders: Array.isArray(request.data?.requestedProviders) ? request.data.requestedProviders : undefined,
    forceRefresh: request.data?.forceRefresh === true
  });
});

export const listCompanyEvidenceCallable = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const companyId = request.data?.companyId;
  if (typeof companyId !== "string" || !companyId) {
    throw new HttpsError("invalid-argument", "companyId is required.");
  }

  const { getEvidenceForCompany } = await import("./services/evidence-service.js");
  return getEvidenceForCompany(companyId, {
    unexpiredOnly: request.data?.unexpiredOnly !== false,
    signalProviders: Array.isArray(request.data?.signalProviders) ? request.data.signalProviders : undefined
  });
});


