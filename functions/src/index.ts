import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
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

export const runDualFixtureTestNow = onCall({ ...callableOptions, timeoutSeconds: 300, memory: "512MiB" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const mode = request.data?.mode as "bloomy" | "devcomm" | "both" | undefined;
  const testId = request.data?.testId as string | undefined;
  const workspaceId = request.data?.workspaceId as string | undefined;
  const { runDualFixtureValidation } = await import("./tests/fixtures/e2e-fixture-runner.js");
  return runDualFixtureValidation({ mode: mode || "both", testId, workspaceId });
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

export const scoreOpportunityNow = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const companyId = request.data?.companyId;
  if (typeof companyId !== "string" || !companyId) {
    throw new HttpsError("invalid-argument", "companyId is required.");
  }

  const { adminDb } = await import("./config/firebase.js");
  const { getValidEvidence } = await import("./services/evidence-service.js");
  const { calculateOpportunityScore } = await import("./services/opportunity-scorer.js");

  const companySnap = await adminDb.collection("companies").doc(companyId).get();
  if (!companySnap.exists) throw new HttpsError("not-found", `Company ${companyId} not found.`);
  const companyData = companySnap.data() as Record<string, unknown>;

  const evidenceItems = await getValidEvidence(companyId);

  let offerDoc: any = null;
  const targetOfferId = (request.data?.offerId as string) || (companyData.offerId as string) || (companyData.bestOffer as string);
  const offerBusinessId = (companyData.businessId as string) || undefined;
  if (targetOfferId && offerBusinessId) {
    // Offers are workspace-scoped, not a top-level collection.
    const offerSnap = await adminDb
      .doc(`workspaces/${(companyData.workspaceId as string) || "ws_default"}/businesses/${offerBusinessId}/offers/${targetOfferId}`)
      .get();
    if (offerSnap.exists) {
      offerDoc = { id: offerSnap.id, ...offerSnap.data() };
    }
  }

  let campaignDoc: any = null;
  const campaignId = (request.data?.campaignId as string) || (companyData.discoveryCampaignId as string);
  if (campaignId) {
    const campSnap = await adminDb.collection("discoveryCampaigns").doc(campaignId).get();
    if (campSnap.exists) {
      campaignDoc = { id: campSnap.id, ...campSnap.data() };
    }
  }

  const score = calculateOpportunityScore({
    company: {
      id: companyId,
      name: companyData.name as string,
      domain: companyData.domain as string,
      website: companyData.website as string,
      siren: companyData.siren as string,
      siret: companyData.siret as string,
      city: companyData.city as string,
      postalCode: companyData.postalCode as string,
      industry: companyData.industry as string,
      nafCode: companyData.nafCode as string,
      nafLabel: companyData.nafLabel as string,
      employeeCount: companyData.employeeCount as number | undefined,
      establishmentCount: companyData.establishmentCount as number | undefined,
      administrativeStatus: companyData.administrativeStatus as string,
      description: companyData.description as string
    },
    evidenceItems,
    offer: offerDoc,
    campaign: campaignDoc
  });

  await companySnap.ref.update({
    opportunityScore: score,
    qualificationState: score.qualificationState,
    fitScore: score.overallScore,
    status: score.qualificationState === "DISQUALIFIED" ? "rejected" : (companyData.status as string || "qualified"),
    updatedAt: new Date()
  });

  return score;
});

export const instantlyWebhook = onRequest(
  { region: "europe-west1", cors: true },
  async (req, res) => {
    if (req.method === "GET") {
      res.status(200).json({ ok: true, service: "instantly-webhook-receiver", version: "2.0" });
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const { getIntegrationSecrets } = await import("./utils/settings.js");
    const { processInstantlyWebhook } = await import("./services/webhook-processor.js");

    const secrets = await getIntegrationSecrets();
    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);

    const result = await processInstantlyWebhook(
      rawBody,
      req.headers as Record<string, string | string[] | undefined>,
      secrets.instantlyWebhookSecret
    );

    res.status(result.statusCode).json(result);
  }
);

export const listConversationsCallable = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const workspaceId = request.data?.workspaceId || "ws_default";
  const businessId = request.data?.businessId;
  const limitCount = typeof request.data?.limit === "number" ? request.data.limit : 50;
  const { listConversations } = await import("./services/conversation-service.js");
  return listConversations(workspaceId, businessId, limitCount);
});

export const getConversationCallable = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const conversationId = request.data?.conversationId;
  if (typeof conversationId !== "string" || !conversationId) {
    throw new HttpsError("invalid-argument", "conversationId is required.");
  }
  const { getConversationWithMessages } = await import("./services/conversation-service.js");
  return getConversationWithMessages(conversationId);
});

export const generateReplyDraftCallable = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const conversationId = request.data?.conversationId;
  if (typeof conversationId !== "string" || !conversationId) {
    throw new HttpsError("invalid-argument", "conversationId is required.");
  }
  const { generateReplyDraftForConversation } = await import("./services/conversation-service.js");
  return generateReplyDraftForConversation(conversationId);
});

export const approveAndSendReplyCallable = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const conversationId = request.data?.conversationId;
  if (typeof conversationId !== "string" || !conversationId) {
    throw new HttpsError("invalid-argument", "conversationId is required.");
  }
  const { approveAndSendReplyDraft } = await import("./services/conversation-service.js");
  return approveAndSendReplyDraft({
    conversationId,
    customSubject: request.data?.customSubject,
    customBodyText: request.data?.customBodyText,
    approvedByUserId: request.auth.uid
  });
});

export const escalateConversationCallable = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const conversationId = request.data?.conversationId;
  const reason = request.data?.reason || "Manually escalated by SDR operator";
  if (typeof conversationId !== "string" || !conversationId) {
    throw new HttpsError("invalid-argument", "conversationId is required.");
  }
  const { escalateConversation } = await import("./services/human-escalator.js");
  return escalateConversation({
    conversationId,
    reason,
    workspaceId: request.data?.workspaceId,
    businessId: request.data?.businessId
  });
});

export const getAvailableSlotsCallable = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const { getAvailableSlots } = await import("./services/calendar-service.js");
  return getAvailableSlots({
    workspaceId: request.data?.workspaceId,
    businessId: request.data?.businessId,
    limit: typeof request.data?.limit === "number" ? request.data.limit : 5,
    preferredDay: typeof request.data?.preferredDay === "number" ? request.data.preferredDay : undefined,
    preferredTimeOfDay: request.data?.preferredTimeOfDay,
    timezone: request.data?.timezone
  });
});

export const proposeSlotsCallable = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const { proposeOpenSlots } = await import("./services/booking-negotiator.js");
  return proposeOpenSlots({
    workspaceId: request.data?.workspaceId,
    businessId: request.data?.businessId,
    schedulingIntent: request.data?.schedulingIntent,
    limit: typeof request.data?.limit === "number" ? request.data.limit : 3,
    timezone: request.data?.timezone
  });
});

export const bookMeetingCallable = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const data = request.data;
  if (!data?.startTime || !data?.prospectEmail) {
    throw new HttpsError("invalid-argument", "startTime and prospectEmail are required.");
  }
  const { bookMeetingAtomically } = await import("./services/meeting-creator.js");
  return bookMeetingAtomically({
    workspaceId: data.workspaceId,
    businessId: data.businessId,
    conversationId: data.conversationId,
    contactId: data.contactId,
    companyId: data.companyId,
    title: data.title,
    startTime: data.startTime,
    endTime: data.endTime,
    timezone: data.timezone,
    prospectEmail: data.prospectEmail,
    prospectName: data.prospectName,
    notes: data.notes,
    source: data.source || "conversational"
  });
});

export const getInboxSummaryCallable = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const { getInboxSummary } = await import("./services/inbox-service.js");
  return getInboxSummary({
    workspaceId: request.data?.workspaceId,
    businessId: request.data?.businessId
  });
});

export const takeOverConversationCallable = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const conversationId = request.data?.conversationId;
  if (typeof conversationId !== "string" || !conversationId) {
    throw new HttpsError("invalid-argument", "conversationId is required.");
  }
  const { takeOverConversation } = await import("./services/inbox-service.js");
  return takeOverConversation({
    conversationId,
    userId: request.auth.uid,
    workspaceId: request.data?.workspaceId,
    businessId: request.data?.businessId
  });
});

export const releaseTakeoverCallable = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const conversationId = request.data?.conversationId;
  if (typeof conversationId !== "string" || !conversationId) {
    throw new HttpsError("invalid-argument", "conversationId is required.");
  }
  const { releaseTakeover } = await import("./services/inbox-service.js");
  return releaseTakeover({
    conversationId,
    userId: request.auth.uid
  });
});

export const sendManualReplyCallable = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const { conversationId, subject, bodyText, recipientEmail, senderEmail } = request.data ?? {};
  if (typeof conversationId !== "string" || !conversationId || !bodyText) {
    throw new HttpsError("invalid-argument", "conversationId and bodyText are required.");
  }
  const { sendManualReply } = await import("./services/inbox-service.js");
  return sendManualReply({
    conversationId,
    subject: subject || "Re:",
    bodyText,
    recipientEmail,
    senderEmail,
    sentByUserId: request.auth.uid
  });
});

export const updateConversationStatusCallable = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const { conversationId, status, assignedRepUserId, pinned } = request.data ?? {};
  if (typeof conversationId !== "string" || !conversationId) {
    throw new HttpsError("invalid-argument", "conversationId is required.");
  }
  const { updateConversationStatus } = await import("./services/inbox-service.js");
  return updateConversationStatus({
    conversationId,
    status,
    assignedRepUserId,
    pinned
  });
});

export const getRecentAgentActivityCallable = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const { getRecentAgentActivity } = await import("./services/inbox-service.js");
  return getRecentAgentActivity({
    workspaceId: request.data?.workspaceId,
    businessId: request.data?.businessId,
    limit: typeof request.data?.limit === "number" ? request.data.limit : 20
  });
});

export const getAnalyticsSummaryCallable = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const { getAnalyticsSummary } = await import("./services/analytics-service.js");
  const workspaceId = request.data?.workspaceId || "ws_default";
  return getAnalyticsSummary({
    workspaceId,
    businessId: request.data?.businessId,
    offerId: request.data?.offerId,
    campaignId: request.data?.campaignId
  });
});

export const runDailyAnalyticsAggregatorCallable = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const { runDailyAnalyticsAggregator } = await import("./jobs/daily-analytics-aggregator.js");
  return runDailyAnalyticsAggregator();
});

export const getPerformanceInsightsCallable = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const { getPerformanceInsights } = await import("./services/learning-service.js");
  const workspaceId = request.data?.workspaceId || "ws_default";
  return getPerformanceInsights({
    workspaceId,
    businessId: request.data?.businessId,
    offerId: request.data?.offerId
  });
});

export const dailyAnalyticsAggregatorJob = onSchedule(
  {
    schedule: "0 3 * * *", // Daily at 03:00 UTC
    timeZone: "Europe/Paris",
    region: "europe-west1",
    memory: "512MiB",
    timeoutSeconds: 300
  },
  async () => {
    const { runDailyAnalyticsAggregator } = await import("./jobs/daily-analytics-aggregator.js");
    await runDailyAnalyticsAggregator();
  }
);

export const getQueueHealthCallable = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const { getQueueHealth } = await import("./services/task-queue-service.js");
  const workspaceId = request.data?.workspaceId || "ws_default";
  return getQueueHealth(workspaceId, request.data?.businessId);
});

export const getCostSummaryCallable = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const { getCostSummary } = await import("./services/cost-guardrail-service.js");
  const workspaceId = request.data?.workspaceId || "ws_default";
  return getCostSummary(workspaceId, request.data?.businessId);
});

export const processTaskQueueCallable = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const { processPendingTasksBatch } = await import("./services/task-queue-service.js");
  const limitCount = typeof request.data?.limit === "number" ? request.data.limit : 10;
  return processPendingTasksBatch(limitCount, request.data?.workspaceId, request.data?.businessId);
});

export const retryTaskJobCallable = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const { retryFailedJobs } = await import("./services/task-queue-service.js");
  const jobIds = Array.isArray(request.data?.jobIds) ? request.data.jobIds : undefined;
  return retryFailedJobs(jobIds, request.data?.workspaceId, request.data?.businessId);
});

export const enqueueTaskCallable = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const { taskType, payload, workspaceId, businessId, maxRetries, runImmediately } = request.data ?? {};
  if (!taskType) throw new HttpsError("invalid-argument", "taskType is required.");
  const { enqueueTask } = await import("./services/task-queue-service.js");
  const jobId = await enqueueTask(taskType, payload || {}, {
    workspaceId: workspaceId || "ws_default",
    businessId: businessId || "biz_devcomm",
    maxRetries: typeof maxRetries === "number" ? maxRetries : undefined,
    runImmediately: runImmediately === true
  });
  return { ok: true, jobId };
});

export const saveBudgetSettingsCallable = onCall(callableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const { dailySpendBudgetUsd, monthlySpendBudgetUsd } = request.data ?? {};
  const { adminDb } = await import("./config/firebase.js");
  const { Timestamp } = await import("firebase-admin/firestore");

  const updates: Record<string, unknown> = { updatedAt: Timestamp.now() };
  if (typeof dailySpendBudgetUsd === "number") updates.dailySpendBudgetUsd = dailySpendBudgetUsd;
  if (typeof monthlySpendBudgetUsd === "number") updates.monthlySpendBudgetUsd = monthlySpendBudgetUsd;

  await adminDb.doc("settings/global").set(updates, { merge: true });
  await writeLog({
    type: "settings.budget.updated",
    level: "info",
    message: `API spend budget guardrails updated (Daily: $${dailySpendBudgetUsd ?? "unchanged"}, Monthly: $${monthlySpendBudgetUsd ?? "unchanged"}).`,
    metadata: { dailySpendBudgetUsd, monthlySpendBudgetUsd, userId: request.auth.uid }
  });

  return { ok: true, ...updates };
});

export const taskQueueProcessorJob = onSchedule(
  {
    region: "europe-west1",
    schedule: "every 5 minutes",
    timeZone: "Europe/Paris",
    memory: "512MiB",
    timeoutSeconds: 120
  },
  async () => {
    const { runTaskQueueWorker } = await import("./jobs/task-queue-worker.js");
    await runTaskQueueWorker();
  }
);

export const taskQueueWorkerHttp = onRequest(
  { region: "europe-west1", cors: true, timeoutSeconds: 120, memory: "512MiB" },
  async (req, res) => {
    if (req.method === "GET") {
      res.status(200).json({ ok: true, service: "task-queue-worker-http", version: "2.0" });
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    try {
      const { processTaskJob, processPendingTasksBatch } = await import("./services/task-queue-service.js");
      const jobId = req.body?.jobId || req.query?.jobId;

      if (typeof jobId === "string" && jobId.trim()) {
        const result = await processTaskJob(jobId.trim(), { force: req.body?.force === true });
        res.status(result.success ? 200 : 500).json(result);
        return;
      }

      const limitCount = typeof req.body?.limit === "number" ? req.body.limit : 10;
      const batchResult = await processPendingTasksBatch(limitCount, req.body?.workspaceId, req.body?.businessId);
      res.status(200).json({ ok: true, batchResult });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  }
);

/**
 * Executes a full 8-stage Autonomous SDR Demo simulation on demand.
 */
export const runSdrDemoSimulationNow = onCall(
  { region: "europe-west1", timeoutSeconds: 60, memory: "512MiB" },
  async (request) => {
    const { runSdrDemoSimulation } = await import("./services/sdr-demo-service.js");
    const result = await runSdrDemoSimulation(request.data || {});
    return result;
  }
);


