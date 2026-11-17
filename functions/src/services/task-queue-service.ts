import { Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
import { writeLog } from "../utils/logger.js";
import { checkBudgetGuardrail, getCostSummary, recordApiSpend, UNATTRIBUTED_SPEND_BUCKET } from "./cost-guardrail-service.js";
import type { JobQueueDoc, QueueHealthSummary, TaskStatus, TaskType } from "../types/domain.js";

export interface EnqueueTaskOptions {
  workspaceId?: string;
  businessId?: string;
  maxRetries?: number;
  runImmediately?: boolean;
}

export interface ProcessJobResult {
  success: boolean;
  jobId: string;
  taskType?: TaskType;
  error?: string;
  retrying?: boolean;
  deadLetter?: boolean;
  budgetExceeded?: boolean;
  nextRetryAt?: Date;
  result?: unknown;
}

/**
 * Checks if an error is transient (HTTP 429 rate limits, 503, timeouts, network glitches) (REQ-080)
 */
/** "Daily AI research limit reached" / "Daily email generation limit reached". */
export function isDailyLimitError(message: string): boolean {
  return /daily (?:ai research|email generation) limit reached/i.test(message);
}

export function isTransientError(error: unknown): boolean {
  if (!error) return false;
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();

  // Rate limits / 429
  if (
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("resource_exhausted") ||
    message.includes("quota exceeded")
  ) {
    return true;
  }

  // Server errors / timeouts / 503 / connection drops
  if (
    message.includes("503") ||
    message.includes("502") ||
    message.includes("504") ||
    message.includes("500") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("enotfound") ||
    message.includes("fetch failed") ||
    message.includes("temporarily unavailable")
  ) {
    return true;
  }

  return false;
}

/**
 * Computes exponential backoff delay in milliseconds: delay = baseDelay * 2^(attempt - 1) (REQ-080)
 */
export function calculateExponentialBackoffMs(
  attemptCount: number,
  baseDelayMs = 5000,
  maxDelayMs = 300000
): number {
  const attempt = Math.max(1, attemptCount);
  const factor = Math.pow(2, attempt - 1);
  const delay = baseDelayMs * factor;
  return Math.min(maxDelayMs, delay);
}

/**
 * Enqueues a discrete asynchronous task in Firestore job queue (REQ-080)
 */
export async function enqueueTask(
  taskType: TaskType,
  payload: Record<string, unknown>,
  options?: EnqueueTaskOptions
): Promise<string> {
  const workspaceId = options?.workspaceId || "ws_default";
  // No fallback business (ADR-016 #6): a job for an unattributed record carries
  // no businessId rather than someone else's, so it lands in no one's quota.
  const businessId = options?.businessId;
  const maxRetries = options?.maxRetries ?? 3;

  const docRef = adminDb.collection("jobQueue").doc();
  const now = Timestamp.now();

  const jobDoc: JobQueueDoc = {
    id: docRef.id,
    workspaceId,
    businessId,
    taskType,
    payload,
    status: "pending",
    attemptCount: 0,
    maxRetries,
    createdAt: now,
    updatedAt: now
  };

  await docRef.set(jobDoc);

  await writeLog({
    type: "queue.task.enqueued",
    level: "info",
    message: `Task ${taskType} enqueued (Job ID: ${docRef.id}).`,
    metadata: {
      jobId: docRef.id,
      taskType,
      workspaceId,
      businessId,
      companyId: payload.companyId,
      campaignId: payload.campaignId
    }
  });

  if (options?.runImmediately) {
    void processTaskJob(docRef.id).catch((err) => {
      console.error(`[task-queue] Failed immediate processing of job ${docRef.id}:`, err);
    });
  }

  return docRef.id;
}

/**
 * Runs a bounded async execution with timeout protection
 */
/**
 * A draft for a company with no email: a DM when the campaign allows it and a
 * trusted profile exists, else its contact form, else nothing — said once, as
 * information, and stamped on the company so the hourly runner does not offer
 * it again every hour.
 */
export async function draftWithoutEmail(companyId: string): Promise<"social_dm" | "contact_form" | "none"> {
  const companyRef = adminDb.collection("companies").doc(companyId);
  const company = (await companyRef.get()).data() ?? {};
  const campaign = company.discoveryCampaignId
    ? (await adminDb.collection("discoveryCampaigns").doc(String(company.discoveryCampaignId)).get()).data() ?? {}
    : {};
  const { channelEnabled } = await import("./target-segment.js");

  if (channelEnabled(campaign.channels, "social_dm")) {
    try {
      const { findInstagramBySearch } = await import("./social/profile-search.js");
      await findInstagramBySearch(companyId).catch(() => undefined);
      const { findSocialProfileUrl, generateSocialDm } = await import("./social-dm-generation.js");
      if (await findSocialProfileUrl(companyId)) {
        await generateSocialDm({ companyId, campaignId: company.discoveryCampaignId as string | undefined });
        return "social_dm";
      }
    } catch {
      // Fall through to the next channel.
    }
  }
  if (channelEnabled(campaign.channels, "contact_form")) {
    try {
      const { prepareContactFormOutreach } = await import("./contact-form-generation.js");
      if (await prepareContactFormOutreach({ companyId, campaignId: company.discoveryCampaignId as string | undefined })) {
        return "contact_form";
      }
    } catch {
      // Fall through: nobody to write to.
    }
  }

  await companyRef.set({ noChannelAt: Timestamp.now(), updatedAt: Timestamp.now() }, { merge: true }).catch(() => undefined);
  await writeLog({
    type: "outreach.no_channel",
    level: "info",
    message: `${String(company.name ?? companyId)}: no email, no verified social profile, no contact form — nobody to write to yet.`,
    workspaceId: (company.workspaceId as string) || "ws_default",
    businessId: company.businessId as string | undefined,
    metadata: { companyId }
  }).catch(() => undefined);
  return "none";
}

/** Tasks that research a company end to end; they get a longer execution budget. */
const HEAVY_TASKS = new Set<string>(["TASK_PIPELINE_COMPANY", "TASK_RESEARCH_COMPANY"]);

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * Executes a discrete queued job with atomic locking, budget guardrails, and exponential backoff retry (REQ-080, REQ-024)
 */
export async function processTaskJob(
  jobId: string,
  options?: { force?: boolean; baseDelayMs?: number; executionTimeoutMs?: number }
): Promise<ProcessJobResult> {
  const jobRef = adminDb.collection("jobQueue").doc(jobId);
  const now = Timestamp.now();
  let jobData: JobQueueDoc | null = null;

  // 1. Atomic Lock & State Transition
  try {
    await adminDb.runTransaction(async (t) => {
      const snap = await t.get(jobRef);
      if (!snap.exists) {
        throw new Error(`Job not found: ${jobId}`);
      }
      const existing = snap.data() as JobQueueDoc;

      if (!options?.force) {
        if (existing.status === "completed") {
          jobData = existing;
          return;
        }
        if (existing.status === "running") {
          // Check if lock expired (over 120s old)
          const lockTime = existing.lockedAt instanceof Timestamp ? existing.lockedAt.toMillis() : 0;
          if (Date.now() - lockTime < 120000) {
            jobData = existing;
            return;
          }
        }
        if (existing.status === "dead_letter") {
          jobData = existing;
          return;
        }
        if (existing.nextRetryAt) {
          const retryTime = existing.nextRetryAt instanceof Timestamp ? existing.nextRetryAt.toMillis() : new Date(existing.nextRetryAt).getTime();
          if (Date.now() < retryTime) {
            jobData = existing;
            return;
          }
        }
      }

      const nextAttempt = (existing.attemptCount || 0) + 1;
      jobData = {
        ...existing,
        status: "running",
        attemptCount: nextAttempt,
        lockedAt: now,
        startedAt: now,
        updatedAt: now
      };

      t.update(jobRef, {
        status: "running",
        attemptCount: nextAttempt,
        lockedAt: now,
        startedAt: now,
        updatedAt: now
      });
    });
  } catch (lockError) {
    return {
      success: false,
      jobId,
      error: lockError instanceof Error ? lockError.message : String(lockError)
    };
  }

  const currentJob = jobData as JobQueueDoc | null;
  if (!currentJob || currentJob.status !== "running") {
    return {
      success: currentJob?.status === "completed",
      jobId,
      taskType: currentJob?.taskType,
      error: "Job is not eligible for execution (already running, completed, or awaiting retry backoff)"
    };
  }

  const job: JobQueueDoc = currentJob;

  // 2. Budget Guardrail Check before expensive task execution
  // An unattributed job is still spend: it is checked against the same
  // ledger bucket its cost is recorded in.
  const budgetStatus = await checkBudgetGuardrail(job.workspaceId, job.businessId || UNATTRIBUTED_SPEND_BUCKET);
  if (!budgetStatus.allowed && !options?.force) {
    const errorMsg = budgetStatus.reason || "Budget cap reached";
    await jobRef.update({
      status: "failed",
      errorCategory: "budget_exceeded",
      lastError: errorMsg,
      failedAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });

    await writeLog({
      type: "queue.task.budget_exceeded",
      level: "warning",
      message: `Task ${job.taskType} halted by Cost Guardrail: ${errorMsg}`,
      metadata: { jobId, taskType: job.taskType, workspaceId: job.workspaceId, businessId: job.businessId }
    });

    return {
      success: false,
      jobId,
      taskType: job.taskType,
      error: errorMsg,
      budgetExceeded: true
    };
  }

  // 3. Execute Discrete Task Handler
  // Research (signals with PageSpeed up to 45 s, website fetch, AI call) runs
  // past 60 s; a timeout does not stop it, so the retry redid — and re-paid —
  // the same work (live run, 2026-11-10). The scheduled processor has 540 s.
  const timeoutMs = options?.executionTimeoutMs ?? (HEAVY_TASKS.has(job.taskType) ? 240_000 : 60_000);
  let taskResult: Record<string, unknown> = {};
  let estimatedCostUsd = 0;

  try {
    taskResult = await withTimeout(
      executeDiscreteTask(job),
      timeoutMs,
      `Task ${job.taskType} timed out after ${timeoutMs}ms`
    );

    estimatedCostUsd = Number(taskResult.estimatedCostUsd || taskResult.totalCostUsd || 0);

    // 4. Success State Update
    const completedAt = Timestamp.now();
    await jobRef.update({
      status: "completed",
      result: taskResult,
      costUsd: estimatedCostUsd,
      completedAt,
      lastError: null,
      updatedAt: completedAt
    });

    await writeLog({
      type: "queue.task.completed",
      level: "info",
      message: `Task ${job.taskType} completed successfully (Job ID: ${jobId}).`,
      metadata: {
        jobId,
        taskType: job.taskType,
        attemptCount: job.attemptCount,
        costUsd: estimatedCostUsd
      }
    });

    return {
      success: true,
      jobId,
      taskType: job.taskType,
      result: taskResult
    };
  } catch (error) {
    // 5. Error & Exponential Backoff Retry Logic
    const errorMsg = error instanceof Error ? error.message : String(error);

    // A daily quota is a throttle, not a verdict. The job ends, but the company
    // goes back into the backlog the hourly runner drains within each day's
    // budget. Previously this was a permanent failure on a company already
    // marked needsResearch:false, so every company past the limit was stranded
    // in research_pending for good.
    if (isDailyLimitError(errorMsg)) {
      const deferredAt = Timestamp.now();
      // "deferred", not "failed": the job is finished, nothing went wrong, and
      // "retry failed" / queue health must not count or re-queue it — the
      // company's own flag is what brings the work back.
      await jobRef.update({
        status: "deferred",
        lastError: errorMsg,
        errorCategory: "daily_limit_deferred",
        updatedAt: deferredAt
      });
      const deferredCompanyId = (job.payload as { companyId?: string } | undefined)?.companyId;
      if (deferredCompanyId) {
        const isOutreachLimit = /email generation/i.test(errorMsg);
        // update, not set+merge: a company purged meanwhile stays purged
        // instead of coming back as an untenanted stub.
        await adminDb
          .collection("companies")
          .doc(String(deferredCompanyId))
          .update(
            isOutreachLimit
              ? { needsOutreachRetry: true, outreachEnqueuedAt: null, updatedAt: deferredAt }
              : { needsResearch: true, updatedAt: deferredAt }
          )
          .catch(() => undefined);
      }
      await writeLog({
        type: "queue.task.deferred_daily_limit",
        level: "info",
        message: `Task ${job.taskType} deferred: ${errorMsg}`,
        workspaceId: job.workspaceId,
        businessId: job.businessId,
        metadata: { jobId, taskType: job.taskType, companyId: deferredCompanyId }
      });
      return { success: false, jobId, taskType: job.taskType, error: errorMsg, retrying: false };
    }

    const isTransient = isTransientError(error);
    const attempt = job.attemptCount;
    const maxRetries = job.maxRetries || 3;

    if (isTransient && attempt < maxRetries) {
      const backoffMs = calculateExponentialBackoffMs(attempt, options?.baseDelayMs ?? 5000);
      const nextRetryDate = new Date(Date.now() + backoffMs);
      const nextRetryTimestamp = Timestamp.fromDate(nextRetryDate);

      await jobRef.update({
        status: "pending",
        lastError: errorMsg,
        errorCategory: errorMsg.toLowerCase().includes("429") || errorMsg.toLowerCase().includes("rate limit")
          ? "transient_rate_limit"
          : "transient_server_error",
        nextRetryAt: nextRetryTimestamp,
        updatedAt: Timestamp.now()
      });

      await writeLog({
        type: "queue.task.retry_scheduled",
        level: "warning",
        message: `Task ${job.taskType} failed with transient error (${errorMsg}). Retrying attempt ${attempt + 1}/${maxRetries} in ${(backoffMs / 1000).toFixed(1)}s.`,
        metadata: {
          jobId,
          taskType: job.taskType,
          attempt,
          maxRetries,
          backoffMs,
          nextRetryAt: nextRetryDate.toISOString()
        }
      });

      return {
        success: false,
        jobId,
        taskType: job.taskType,
        error: errorMsg,
        retrying: true,
        nextRetryAt: nextRetryDate
      };
    } else {
      // Terminal Failure / Dead-Letter Escalation
      const failedAt = Timestamp.now();
      const status: TaskStatus = attempt >= maxRetries ? "dead_letter" : "failed";

      await jobRef.update({
        status,
        lastError: errorMsg,
        errorCategory: isTransient ? "exhausted_retries" : "permanent_error",
        failedAt,
        updatedAt: failedAt
      });

      // Record the block on the company itself, not only on the job.
      //
      // The daily runner re-selects companies by status and re-enqueues any
      // that have no outreach document. With the verdict living only on the
      // job, the same 21 companies failed identically every single day and the
      // failed-job pile grew without bound. A company that cannot be written to
      // is a fact about the company; it belongs on the company.
      const blockedCompanyId =
        job.taskType === "TASK_GENERATE_OUTREACH" || job.taskType === "TASK_PIPELINE_COMPANY"
          ? (job.payload as { companyId?: string } | undefined)?.companyId
          : undefined;

      // Only a verdict about the *lead* may block the company. An account-level
      // failure - exhausted credit, a missing key, a provider outage - says
      // nothing about this prospect, and stamping it here would keep the
      // company out of the pipeline long after the account was fixed.
      // "Not attributed to any business" is a verdict about the record too:
      // retrying cannot attribute it, so it must stop being re-enqueued.
      const isLeadVerdict = /not ready for outreach|no contact|not completed yet|not attributed to any business/i.test(errorMsg);

      if (blockedCompanyId && !isTransient && isLeadVerdict) {
        await adminDb
          .collection("companies")
          .doc(String(blockedCompanyId))
          .set(
            {
              outreachBlockedReason: errorMsg.slice(0, 300),
              outreachBlockedAt: failedAt,
              updatedAt: failedAt
            },
            { merge: true }
          )
          .catch(() => {
            // The queue verdict is already recorded; never fail a job on this.
          });
      }

      await writeLog({
        type: "queue.task.dead_letter",
        level: "error",
        message: `Task ${job.taskType} moved to ${status}: ${errorMsg} (Attempts: ${attempt}/${maxRetries}).`,
        metadata: {
          jobId,
          taskType: job.taskType,
          attempt,
          maxRetries,
          error: errorMsg
        }
      });

      return {
        success: false,
        jobId,
        taskType: job.taskType,
        error: errorMsg,
        deadLetter: true
      };
    }
  }
}

/**
 * Internal dispatcher for discrete task types
 */
async function executeDiscreteTask(job: JobQueueDoc): Promise<Record<string, unknown>> {
  const { taskType, payload, workspaceId, businessId } = job;

  switch (taskType) {
    case "TASK_DISCOVER_PAGE": {
      const campaignId = String(payload.campaignId);
      if (!campaignId) throw new Error("campaignId is required for TASK_DISCOVER_PAGE");
      const { runDiscoveryCampaign } = await import("./run-discovery-campaign.js");
      const result = await runDiscoveryCampaign(campaignId);
      return { ...result };
    }

    case "TASK_COLLECT_SIGNALS": {
      const companyId = String(payload.companyId);
      if (!companyId) throw new Error("companyId is required for TASK_COLLECT_SIGNALS");

      const companySnap = await adminDb.collection("companies").doc(companyId).get();
      if (!companySnap.exists) throw new Error(`Company not found: ${companyId}`);
      const companyData = companySnap.data() || {};

      const { runSignalCollection } = await import("./signal-coordinator.js");
      const signalBusinessId = (businessId || companyData.businessId) as string | undefined;
      // Signals are selected from the business's offer and campaign strategy;
      // with no business there is nothing to select them from. Permanent, not
      // transient: retrying cannot attribute the company.
      if (!signalBusinessId) {
        throw new Error(`Company ${companyId} is not attributed to any business; signal collection needs one.`);
      }
      const context = {
        workspaceId: job.workspaceId || companyData.workspaceId || "ws_default",
        businessId: signalBusinessId,
        campaignId: companyData.discoveryCampaignId || payload.campaignId as string,
        offerId: companyData.offerId || payload.offerId as string,
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

      const res = await runSignalCollection(context, {
        requestedProviders: Array.isArray(payload.requestedProviders) ? (payload.requestedProviders as string[]) : undefined,
        forceRefresh: payload.forceRefresh === true
      });

      // Attribute to the provider that actually incurred the cost, rather than
      // charging everything to google_places.
      for (const providerResult of res.results) {
        if (!providerResult.costEstimateUsd || providerResult.costEstimateUsd <= 0) continue;
        await recordApiSpend({
          workspaceId,
          businessId: signalBusinessId,
          provider: providerResult.providerId,
          costUsd: providerResult.costEstimateUsd,
          operation: "signal_collection",
          companyId
        });
      }

      return {
        companyId,
        evidenceCount: res.evidence.length,
        totalCostUsd: res.totalCostUsd,
        errors: res.errors
      };
    }

    case "TASK_SCORE_OPPORTUNITY": {
      const companyId = String(payload.companyId);
      if (!companyId) throw new Error("companyId is required for TASK_SCORE_OPPORTUNITY");

      const { getValidEvidence } = await import("./evidence-service.js");
      const { calculateOpportunityScore } = await import("./opportunity-scorer.js");

      const companySnap = await adminDb.collection("companies").doc(companyId).get();
      if (!companySnap.exists) throw new Error(`Company ${companyId} not found.`);
      const companyData = companySnap.data() || {};

      const evidenceItems = await getValidEvidence(companyId);

      let offerDoc: any = null;
      const targetOfferId = (payload.offerId as string) || companyData.offerId || companyData.bestOffer;
      if (targetOfferId && companyData.businessId) {
        // Offers are workspace-scoped, not a top-level collection.
        const offerSnap = await adminDb
          .doc(`workspaces/${companyData.workspaceId || "ws_default"}/businesses/${companyData.businessId}/offers/${targetOfferId}`)
          .get();
        if (offerSnap.exists) offerDoc = { id: offerSnap.id, ...offerSnap.data() };
      }

      let campaignDoc: any = null;
      const campaignId = (payload.campaignId as string) || companyData.discoveryCampaignId;
      if (campaignId) {
        const campSnap = await adminDb.collection("discoveryCampaigns").doc(campaignId).get();
        if (campSnap.exists) campaignDoc = { id: campSnap.id, ...campSnap.data() };
      }

      const score = calculateOpportunityScore({
        company: {
          directoryUrl: (companyData.directoryUrl as string | undefined) ?? "",
          id: companyId,
          name: companyData.name as string,
          domain: companyData.domain as string,
          website: (companyData.website as string | undefined) ?? "",
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
        updatedAt: Timestamp.now()
      });

      return {
        companyId,
        score: score.overallScore,
        qualificationState: score.qualificationState
      };
    }

    case "TASK_ENRICH_CONTACTS": {
      const companyId = String(payload.companyId);
      if (!companyId) throw new Error("companyId is required for TASK_ENRICH_CONTACTS");

      const { enrichCompanyWebsite } = await import("./company-enrichment.js");
      const { findContactsForCompany } = await import("./contact-discovery.js");

      let websiteEnriched = false;
      try {
        await enrichCompanyWebsite(companyId);
        websiteEnriched = true;
      } catch (err) {
        console.warn(`Website enrichment skipped for ${companyId}:`, err);
      }

      let contactsFound = 0;
      try {
        const res = await findContactsForCompany(companyId);
        contactsFound = res.found || 0;
      } catch (err) {
        console.warn(`Contact discovery error for ${companyId}:`, err);
      }

      return {
        companyId,
        websiteEnriched,
        contactsFound
      };
    }

    case "TASK_GENERATE_OUTREACH": {
      const companyId = String(payload.companyId);
      if (!companyId) throw new Error("companyId is required for TASK_GENERATE_OUTREACH");

      const { generateOutreach } = await import("./outreach-generation.js");
      const { generateProposalPdf } = await import("./pdf-generator.js");

      // An email draft needs an email. Without one (and no contact named by
      // the caller), the other channels the campaign allows are tried, and a
      // prospect nobody can write to is noted once instead of failing here
      // every time the hourly runner offers it again (12 failed jobs shown as
      // errors on 2026-11-11).
      if (!payload.contactId) {
        const withEmail = await adminDb.collection("contacts").where("companyId", "==", companyId).limit(10).get();
        const hasEmail = withEmail.docs.some((c) => typeof c.data().email === "string" && c.data().email.includes("@"));
        if (!hasEmail) {
          const channel = await draftWithoutEmail(companyId);
          return { companyId, channel, skipped: channel === "none" };
        }
      }

      const outreachResult = await generateOutreach({
        companyId,
        contactId: payload.contactId as string | undefined,
        campaignId: payload.campaignId as string | undefined,
        force: payload.force === true
      });

      let pdfUrl: string | undefined;
      try {
        const pdfRes = await generateProposalPdf(outreachResult.outreachId);
        pdfUrl = pdfRes.downloadUrl;
      } catch {
        // Non-blocking PDF failure
      }

      // Cost is recorded inside generateOutreach from the real token counts;
      // charging a second flat estimate here double-counted it.

      return {
        companyId,
        outreachId: outreachResult.outreachId,
        pdfUrl
      };
    }

    case "TASK_DISPATCH_EMAIL": {
      if (payload.outreachId) {
        const { sendApprovedOutreach } = await import("./send-outreach.js");
        const res = await sendApprovedOutreach(String(payload.outreachId));
        return { ...res };
      } else if (payload.conversationId) {
        const { approveAndSendReplyDraft } = await import("./conversation-service.js");
        const res = await approveAndSendReplyDraft({
          conversationId: String(payload.conversationId),
          customSubject: payload.customSubject as string | undefined,
          customBodyText: payload.customBodyText as string | undefined,
          approvedByUserId: payload.approvedByUserId as string | undefined
        });
        return { ...res };
      }
      throw new Error("TASK_DISPATCH_EMAIL requires outreachId or conversationId in payload");
    }

    case "TASK_PIPELINE_COMPANY": {
      const companyId = String(payload.companyId);
      if (!companyId) throw new Error("companyId is required for TASK_PIPELINE_COMPANY");

      const { researchCompany } = await import("./research-company.js");
      const res = await researchCompany(companyId, { force: payload.force === true });

      // `researchCompany` reports failure by returning, not by throwing, so the
      // queue used to mark the job completed and move on. Observed live: 70
      // pipeline jobs recorded as completed while all 50 of their research
      // calls had failed on an exhausted API credit balance - no retry, no
      // dead letter, and a queue that looked healthy while doing nothing.
      // Re-raising hands the failure to the retry and backoff machinery that
      // already exists for it.
      if (res.status === "failed") {
        throw new Error(res.error || "Research failed.");
      }

      // Carry a qualified company straight through to a draft. Without this the
      // company sat at "qualified" until the next daily 08:00 sweep, so a
      // campaign launched in the afternoon produced nothing to review that day.
      const snapshot = await adminDb.collection("companies").doc(companyId).get();
      const company = snapshot.data() ?? {};
      const state = company.opportunityScore?.qualificationState ?? company.qualificationState;
      const isQualified = state === "QUALIFIED" || state === "HIGH_PRIORITY";

      if (isQualified) {
        // Scrape the site for contact addresses before looking for a person.
        // For small local businesses a published contact@/info@ address is very
        // often the ONLY reachable email - B2B enrichment databases have no
        // record of a two-chair salon. This step was only ever run by the daily
        // job, so the queue path reached contact discovery with nothing.
        try {
          const { enrichCompanyWebsite } = await import("./company-enrichment.js");
          await enrichCompanyWebsite(companyId);
        } catch {
          // Enrichment is best-effort; contact discovery still gets a chance.
        }

        // Details published on a public social/link-in-bio page are often the
        // only reachable address for a business with no website.
        try {
          const { createContactsFromSocialEvidence } = await import("./company-enrichment.js");
          await createContactsFromSocialEvidence(companyId);
        } catch {
          // Best-effort; contact discovery still runs.
        }

        try {
          const { findContactsForCompany } = await import("./contact-discovery.js");
          await findContactsForCompany(companyId);
        } catch {
          // Logged inside; a company with no contact simply yields no draft.
        }

        const existing = await adminDb
          .collection("outreach")
          .where("companyId", "==", companyId)
          .limit(1)
          .get();

        // No emailable contact, but a public profile we can DM by hand. For
        // trades with no website this is the only channel that exists, so the
        // alternative is discarding a qualified prospect.
        const contacts = await adminDb
          .collection("contacts")
          .where("companyId", "==", companyId)
          .limit(5)
          .get();
        const hasEmail = contacts.docs.some((c) => typeof c.data().email === "string" && c.data().email.includes("@"));

        const campaignSnap =
          existing.empty && company.discoveryCampaignId
            ? await adminDb.collection("discoveryCampaigns").doc(String(company.discoveryCampaignId)).get()
            : null;
        const campaign = campaignSnap?.data() ?? {};
        const { channelEnabled, prefersDirectMessages } = await import("./target-segment.js");
        // A campaign that prefers DMs writes one whenever the prospect has a
        // trusted profile, email or not (email sending is not live yet, so an
        // email draft would wait; a DM is sent today, one key per message).
        const dmFirst = existing.empty && hasEmail && prefersDirectMessages(campaign);

        // Their site links no profile: look the Instagram account up by name
        // (confirmed by city, postcode or phone) before deciding the channel.
        if (existing.empty && channelEnabled(campaign.channels, "social_dm")) {
          try {
            const { findInstagramBySearch } = await import("./social/profile-search.js");
            await findInstagramBySearch(companyId);
          } catch {
            // Best-effort: without it the prospect keeps the channels it had.
          }
        }

        if (existing.empty && (!hasEmail || dmFirst)) {
          // No email anywhere (or DMs preferred). Fall through the channels the
          // operator enabled, in order of how well the prospect can reply: a DM
          // lands in a real inbox they read; a contact form lands in the one
          // they configured.
          const channels = campaign.channels;

          if (channelEnabled(channels, "social_dm")) {
            try {
              const { findSocialProfileUrl, generateSocialDm } = await import("./social-dm-generation.js");
              if (await findSocialProfileUrl(companyId)) {
                await generateSocialDm({ companyId, campaignId: company.discoveryCampaignId });
                return { ...res, chainedOutreach: true, channel: "social_dm" };
              }
            } catch {
              // Fall through to the next channel.
            }
          }

          // With an email to fall back on, a preferred DM that could not be
          // written goes to email, never to a contact form.
          if (!hasEmail && channelEnabled(channels, "contact_form")) {
            try {
              const { prepareContactFormOutreach } = await import("./contact-form-generation.js");
              const prepared = await prepareContactFormOutreach({
                companyId,
                campaignId: company.discoveryCampaignId as string | undefined
              });
              if (prepared) return { ...res, chainedOutreach: true, channel: "contact_form" };
            } catch {
              // Fall through: a company with no channel simply yields no draft.
            }
          }
        }

        if (existing.empty && !hasEmail) {
          // No email, and no DM or contact form could be prepared: an email
          // draft would have nobody to go to, and the job would only fail
          // (and show as an error). Said once, as information.
          await writeLog({
            type: "outreach.no_channel",
            level: "info",
            message: `${String(company.name ?? companyId)}: no email, no verified social profile, no contact form — nobody to write to yet.`,
            workspaceId: company.workspaceId || "ws_default",
            businessId: company.businessId,
            metadata: { companyId }
          }).catch(() => undefined);
          return { ...res, chainedOutreach: false, channel: "none" };
        }

        if (existing.empty) {
          await enqueueTask(
            "TASK_GENERATE_OUTREACH",
            { companyId, campaignId: company.discoveryCampaignId },
            {
              workspaceId: company.workspaceId || "ws_default",
              businessId: company.businessId
            }
          );
          // The hourly runner skips a company enqueued this recently, so the
          // chain and the sweep cannot race into two drafts.
          await adminDb.collection("companies").doc(companyId).update({ outreachEnqueuedAt: Timestamp.now() }).catch(() => undefined);
        }
      }

      return { ...res, chainedOutreach: isQualified };
    }

    default:
      throw new Error(`Unsupported task type: ${taskType}`);
  }
}

/**
 * Processes a bounded batch of pending tasks (REQ-080)
 */
export async function processPendingTasksBatch(
  limitCount = 10,
  workspaceId?: string,
  businessId?: string
): Promise<{ processed: number; succeeded: number; failed: number; retried: number }> {
  let q = adminDb
    .collection("jobQueue")
    .where("status", "==", "pending")
    .limit(Math.min(limitCount, 25));

  if (workspaceId) {
    q = q.where("workspaceId", "==", workspaceId);
  }
  if (businessId) {
    q = q.where("businessId", "==", businessId);
  }

  const snapshot = await q.get();
  if (snapshot.empty) {
    return { processed: 0, succeeded: 0, failed: 0, retried: 0 };
  }

  const nowTime = Date.now();
  const eligibleDocs = snapshot.docs.filter((docSnap) => {
    const data = docSnap.data() as JobQueueDoc;
    if (!data.nextRetryAt) return true;
    const retryTime = data.nextRetryAt instanceof Timestamp ? data.nextRetryAt.toMillis() : new Date(data.nextRetryAt).getTime();
    return nowTime >= retryTime;
  });

  let succeeded = 0;
  let failed = 0;
  let retried = 0;

  // Process concurrently up to 5 at a time
  const batchPromises = eligibleDocs.map(async (docSnap) => {
    const res = await processTaskJob(docSnap.id);
    if (res.success) {
      succeeded++;
    } else if (res.retrying) {
      retried++;
    } else {
      failed++;
    }
  });

  await Promise.allSettled(batchPromises);

  return {
    processed: eligibleDocs.length,
    succeeded,
    failed,
    retried
  };
}

/**
 * Resets failed and dead-letter tasks back to pending for retry (REQ-080)
 */
export async function retryFailedJobs(
  jobIds?: string[],
  workspaceId?: string,
  businessId?: string
): Promise<{ retriedCount: number }> {
  let targetDocs: DocumentSnapshot[] = [];

  if (jobIds && jobIds.length > 0) {
    const refs = jobIds.map((id) => adminDb.collection("jobQueue").doc(id));
    const snaps = await adminDb.getAll(...refs);
    targetDocs = snaps.filter((s) => s.exists);
  } else {
    let q = adminDb
      .collection("jobQueue")
      .where("status", "in", ["dead_letter", "failed"])
      .limit(50);

    if (workspaceId) q = q.where("workspaceId", "==", workspaceId);
    if (businessId) q = q.where("businessId", "==", businessId);

    const snap = await q.get();
    targetDocs = snap.docs;
  }

  let count = 0;
  const now = Timestamp.now();

  for (const docSnap of targetDocs) {
    await docSnap.ref.update({
      status: "pending",
      attemptCount: 0,
      nextRetryAt: null,
      lastError: null,
      errorCategory: null,
      updatedAt: now
    });
    count++;
  }

  if (count > 0) {
    await writeLog({
      type: "queue.jobs.retried",
      level: "info",
      message: `${count} failed/dead-letter jobs reset to pending queue.`,
      metadata: { count, jobIds }
    });
  }

  return { retriedCount: count };
}

/**
 * Retrieves real-time queue health, dead-letter counts, and cost summaries (REQ-080, REQ-024)
 */
export async function getQueueHealth(
  workspaceId = "ws_default",
  businessId?: string
): Promise<QueueHealthSummary> {
  const [pendingSnap, runningSnap, completedSnap, failedSnap, deadLetterSnap, recentSnap, costSummary] = await Promise.all([
    adminDb.collection("jobQueue").where("workspaceId", "==", workspaceId).where("status", "==", "pending").count().get(),
    adminDb.collection("jobQueue").where("workspaceId", "==", workspaceId).where("status", "==", "running").count().get(),
    adminDb.collection("jobQueue").where("workspaceId", "==", workspaceId).where("status", "==", "completed").count().get(),
    adminDb.collection("jobQueue").where("workspaceId", "==", workspaceId).where("status", "==", "failed").count().get(),
    adminDb.collection("jobQueue").where("workspaceId", "==", workspaceId).where("status", "==", "dead_letter").count().get(),
    adminDb.collection("jobQueue").where("workspaceId", "==", workspaceId).limit(50).get(),
    getCostSummary(workspaceId, businessId)
  ]);

  const recentJobs = recentSnap.docs
    .map((d) => ({ id: d.id, ...d.data() } as JobQueueDoc))
    .sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt as any).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt as any).getTime() : 0;
      return timeB - timeA;
    })
    .slice(0, 20);

  return {
    workspaceId,
    businessId,
    pending: pendingSnap.data().count,
    running: runningSnap.data().count,
    completed: completedSnap.data().count,
    failed: failedSnap.data().count,
    deadLetter: deadLetterSnap.data().count,
    todaySpendUsd: costSummary.todaySpendUsd,
    monthSpendUsd: costSummary.monthSpendUsd,
    dailyBudgetCapUsd: costSummary.dailyBudgetCapUsd,
    monthlyBudgetCapUsd: costSummary.monthlyBudgetCapUsd,
    budgetExceeded: costSummary.budgetExceeded,
    recentJobs,
    calculatedAt: new Date().toISOString()
  };
}
