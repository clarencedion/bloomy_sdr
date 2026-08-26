import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../../config/firebase.js";
import { enqueueTask, processPendingTasksBatch, processTaskJob } from "../../services/task-queue-service.js";
import type { JobQueueDoc } from "../../types/domain.js";

describe("Cloud Task Queue Decoupling (REQ-080)", () => {
  it("should enqueue discrete tasks with pending status and correct multi-tenant context", async () => {
    const workspaceId = `ws_queue_test_${Date.now()}`;
    const businessId = `biz_queue_test_${Date.now()}`;

    const jobId = await enqueueTask(
      "TASK_COLLECT_SIGNALS",
      { companyId: "comp_123", requestedProviders: ["company_registry"] },
      { workspaceId, businessId, maxRetries: 3 }
    );

    expect(typeof jobId).toBe("string");
    expect(jobId.length).toBeGreaterThan(5);

    const docSnap = await adminDb.collection("jobQueue").doc(jobId).get();
    expect(docSnap.exists).toBe(true);

    const job = docSnap.data() as JobQueueDoc;
    expect(job.workspaceId).toBe(workspaceId);
    expect(job.businessId).toBe(businessId);
    expect(job.taskType).toBe("TASK_COLLECT_SIGNALS");
    expect(job.status).toBe("pending");
    expect(job.attemptCount).toBe(0);
    expect(job.maxRetries).toBe(3);
    expect(job.payload.companyId).toBe("comp_123");
  });

  it("should atomically lock and execute a discrete company task to completion", async () => {
    const workspaceId = `ws_exec_test_${Date.now()}`;
    const businessId = `biz_exec_test_${Date.now()}`;
    const companyId = `comp_task_${Date.now()}`;

    // Seed test company
    await adminDb.collection("companies").doc(companyId).set({
      id: companyId,
      workspaceId,
      businessId,
      name: "Acme Logistics SARL",
      siren: "123456789",
      city: "Nantes",
      status: "imported",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });

    const jobId = await enqueueTask(
      "TASK_SCORE_OPPORTUNITY",
      { companyId },
      { workspaceId, businessId }
    );

    const result = await processTaskJob(jobId);

    expect(result.success).toBe(true);
    expect(result.taskType).toBe("TASK_SCORE_OPPORTUNITY");

    const updatedSnap = await adminDb.collection("jobQueue").doc(jobId).get();
    const updatedJob = updatedSnap.data() as JobQueueDoc;

    expect(updatedJob.status).toBe("completed");
    expect(updatedJob.attemptCount).toBe(1);
    expect(updatedJob.completedAt).toBeDefined();
    expect(updatedJob.result).toBeDefined();
  });

  it("should process a batch of pending tasks concurrently up to limit", async () => {
    const workspaceId = `ws_batch_test_${Date.now()}`;
    const businessId = `biz_batch_test_${Date.now()}`;

    const jobIds: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const companyId = `comp_batch_${workspaceId}_${i}`;
      await adminDb.collection("companies").doc(companyId).set({
        id: companyId,
        workspaceId,
        businessId,
        name: `Batch Target ${i}`,
        status: "discovered",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      });

      const id = await enqueueTask(
        "TASK_SCORE_OPPORTUNITY",
        { companyId },
        { workspaceId, businessId }
      );
      jobIds.push(id);
    }

    const batchRes = await processPendingTasksBatch(5, workspaceId, businessId);

    expect(batchRes.processed).toBe(3);
    expect(batchRes.succeeded).toBe(3);
    expect(batchRes.failed).toBe(0);

    for (const id of jobIds) {
      const snap = await adminDb.collection("jobQueue").doc(id).get();
      expect(snap.data()?.status).toBe("completed");
    }
  });
});
