import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../../config/firebase.js";
import {
  calculateExponentialBackoffMs,
  enqueueTask,
  isTransientError,
  processTaskJob,
  retryFailedJobs
} from "../../services/task-queue-service.js";
import type { JobQueueDoc } from "../../types/domain.js";

describe("Exponential Backoff & Dead-Letter Queue (REQ-080)", () => {
  it("should accurately identify transient vs non-transient errors", () => {
    // Transient errors
    expect(isTransientError(new Error("HTTP 429: Too Many Requests"))).toBe(true);
    expect(isTransientError(new Error("Rate limit exceeded for OpenAI API"))).toBe(true);
    expect(isTransientError(new Error("503 Service Unavailable"))).toBe(true);
    expect(isTransientError(new Error("Request timed out after 10000ms"))).toBe(true);
    expect(isTransientError(new Error("fetch failed: ECONNRESET"))).toBe(true);
    expect(isTransientError(new Error("RESOURCE_EXHAUSTED: quota exceeded"))).toBe(true);

    // Non-transient errors
    expect(isTransientError(new Error("Company not found: comp_999"))).toBe(false);
    expect(isTransientError(new Error("Company name is required"))).toBe(false);
    expect(isTransientError(new Error("Authentication required"))).toBe(false);
    expect(isTransientError(new Error("Invalid argument: campaignId missing"))).toBe(false);
  });

  it("should calculate exponential backoff delay correctly with cap", () => {
    const baseDelay = 1000;
    const maxDelay = 30000;

    expect(calculateExponentialBackoffMs(1, baseDelay, maxDelay)).toBe(1000);  // 1000 * 2^0
    expect(calculateExponentialBackoffMs(2, baseDelay, maxDelay)).toBe(2000);  // 1000 * 2^1
    expect(calculateExponentialBackoffMs(3, baseDelay, maxDelay)).toBe(4000);  // 1000 * 2^2
    expect(calculateExponentialBackoffMs(4, baseDelay, maxDelay)).toBe(8000);  // 1000 * 2^3
    expect(calculateExponentialBackoffMs(5, baseDelay, maxDelay)).toBe(16000); // 1000 * 2^4
    expect(calculateExponentialBackoffMs(6, baseDelay, maxDelay)).toBe(30000); // capped at maxDelay
  });

  it("should handle error classification, retry scheduling, and dead-letter queue", async () => {
    const workspaceId = `ws_retry_test_${Date.now()}`;
    const businessId = `biz_retry_test_${Date.now()}`;

    // 1. Enqueue task with non-transient failure (missing company)
    const jobId = await enqueueTask(
      "TASK_SCORE_OPPORTUNITY",
      { companyId: "non_existent_company_999" },
      { workspaceId, businessId, maxRetries: 3 }
    );

    const failRes = await processTaskJob(jobId);
    expect(failRes.success).toBe(false);

    const failedSnap = await adminDb.collection("jobQueue").doc(jobId).get();
    expect(failedSnap.data()?.status).toBe("failed");
    expect(failedSnap.data()?.attemptCount).toBe(1);

    // 2. Enqueue task with single retry allowed to verify dead_letter escalation
    const deadLetterJobId = await enqueueTask(
      "TASK_SCORE_OPPORTUNITY",
      { companyId: "non_existent_company_dead" },
      { workspaceId, businessId, maxRetries: 1 }
    );

    const deadLetterRes = await processTaskJob(deadLetterJobId);
    expect(deadLetterRes.success).toBe(false);
    expect(deadLetterRes.deadLetter).toBe(true);

    const deadLetterSnap = await adminDb.collection("jobQueue").doc(deadLetterJobId).get();
    expect(deadLetterSnap.data()?.status).toBe("dead_letter");
  });

  it("should transition jobs to dead_letter once max retries are exhausted", async () => {
    const workspaceId = `ws_deadletter_${Date.now()}`;
    const businessId = `biz_deadletter_${Date.now()}`;

    const jobId = await enqueueTask(
      "TASK_SCORE_OPPORTUNITY",
      { companyId: "non_existent_company_for_deadletter" },
      { workspaceId, businessId, maxRetries: 1 }
    );

    const result = await processTaskJob(jobId);

    expect(result.success).toBe(false);
    expect(result.deadLetter).toBe(true);

    const jobDoc = (await adminDb.collection("jobQueue").doc(jobId).get()).data() as JobQueueDoc;
    expect(["dead_letter", "failed"]).toContain(jobDoc.status);
    expect(jobDoc.failedAt).toBeDefined();
    expect(jobDoc.lastError).toBeDefined();
  });

  it("should reset dead-letter and failed jobs back to pending queue on retry command", async () => {
    const workspaceId = `ws_reset_test_${Date.now()}`;
    const businessId = `biz_reset_test_${Date.now()}`;

    const jobId = await enqueueTask(
      "TASK_SCORE_OPPORTUNITY",
      { companyId: "temp_company" },
      { workspaceId, businessId, maxRetries: 1 }
    );

    // Mark job as dead_letter
    await adminDb.collection("jobQueue").doc(jobId).update({
      status: "dead_letter",
      attemptCount: 3,
      lastError: "Rate limit exceeded 429",
      failedAt: Timestamp.now()
    });

    const resetRes = await retryFailedJobs([jobId], workspaceId, businessId);
    expect(resetRes.retriedCount).toBe(1);

    const resetSnap = await adminDb.collection("jobQueue").doc(jobId).get();
    const resetJob = resetSnap.data() as JobQueueDoc;

    expect(resetJob.status).toBe("pending");
    expect(resetJob.attemptCount).toBe(0);
    expect(resetJob.lastError).toBeNull();
    expect(resetJob.nextRetryAt).toBeNull();
  });
});
