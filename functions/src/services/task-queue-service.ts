import { Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
import { writeLog } from "../utils/logger.js";
import { checkBudgetGuardrail, getCostSummary, recordApiSpend } from "./cost-guardrail-service.js";
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
  const businessId = options?.businessId || "biz_devcomm";
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
  const budgetStatus = await checkBudgetGuardrail(job.workspaceId, job.businessId);
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
  const timeoutMs = options?.executionTimeoutMs ?? 60000;
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
      const context = {
        workspaceId: job.workspaceId || companyData.workspaceId || "ws_default",
        businessId: job.businessId || companyData.businessId || "biz_devcomm",
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

      if (res.totalCostUsd > 0) {
        await recordApiSpend({
          workspaceId,
          businessId,
          provider: "google_places",
          costUsd: res.totalCostUsd,
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

      const estimatedCost = 0.015;
      await recordApiSpend({
        workspaceId,
        businessId,
        provider: "openai",
        costUsd: estimatedCost,
        operation: "outreach_generation",
        companyId
      });

      return {
        companyId,
        outreachId: outreachResult.outreachId,
        pdfUrl,
        estimatedCostUsd: estimatedCost
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
      return { ...res };
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
