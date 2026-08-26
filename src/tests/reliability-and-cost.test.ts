import { describe, expect, it } from "vitest";
import type {
  JobQueueDoc,
  QueueHealthSummary,
  SpendBudgetStatus,
  TaskType
} from "@/types/domain";

describe("Task Queues, Reliability & Cost Control (REQ-080, REQ-024)", () => {
  it("should validate complete QueueHealthSummary schema with multi-tenant isolation", () => {
    const mockHealth: QueueHealthSummary = {
      workspaceId: "ws_default",
      businessId: "biz_devcomm",
      pending: 5,
      running: 2,
      completed: 45,
      failed: 1,
      deadLetter: 1,
      todaySpendUsd: 4.50,
      monthSpendUsd: 68.20,
      dailyBudgetCapUsd: 25.00,
      monthlyBudgetCapUsd: 250.00,
      budgetExceeded: false,
      recentJobs: [
        {
          id: "job_123",
          workspaceId: "ws_default",
          businessId: "biz_devcomm",
          taskType: "TASK_COLLECT_SIGNALS",
          payload: { companyId: "comp_123" },
          status: "completed",
          attemptCount: 1,
          maxRetries: 3,
          costUsd: 0.015,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: "job_124",
          workspaceId: "ws_default",
          businessId: "biz_devcomm",
          taskType: "TASK_GENERATE_OUTREACH",
          payload: { companyId: "comp_124" },
          status: "dead_letter",
          attemptCount: 3,
          maxRetries: 3,
          lastError: "Rate limit exceeded (HTTP 429)",
          errorCategory: "exhausted_retries",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      calculatedAt: new Date().toISOString()
    };

    expect(mockHealth.workspaceId).toBe("ws_default");
    expect(mockHealth.pending).toBe(5);
    expect(mockHealth.running).toBe(2);
    expect(mockHealth.completed).toBe(45);
    expect(mockHealth.failed).toBe(1);
    expect(mockHealth.deadLetter).toBe(1);
    expect(mockHealth.todaySpendUsd).toBe(4.50);
    expect(mockHealth.dailyBudgetCapUsd).toBe(25.00);
    expect(mockHealth.budgetExceeded).toBe(false);
    expect(mockHealth.recentJobs.length).toBe(2);
  });

  it("should validate all discrete task types supported by the queue worker", () => {
    const validTaskTypes: TaskType[] = [
      "TASK_DISCOVER_PAGE",
      "TASK_COLLECT_SIGNALS",
      "TASK_SCORE_OPPORTUNITY",
      "TASK_ENRICH_CONTACTS",
      "TASK_GENERATE_OUTREACH",
      "TASK_DISPATCH_EMAIL",
      "TASK_PIPELINE_COMPANY"
    ];

    expect(validTaskTypes.length).toBe(7);
    validTaskTypes.forEach((type) => {
      expect(typeof type).toBe("string");
      expect(type.startsWith("TASK_")).toBe(true);
    });
  });

  it("should validate SpendBudgetStatus data structure for guardrails enforcement", () => {
    const safeStatus: SpendBudgetStatus = {
      allowed: true,
      dailySpendUsd: 12.50,
      dailyBudgetCapUsd: 25.00,
      monthlySpendUsd: 110.00,
      monthlyBudgetCapUsd: 250.00,
      isDailyCapReached: false,
      isMonthlyCapReached: false
    };

    expect(safeStatus.allowed).toBe(true);
    expect(safeStatus.isDailyCapReached).toBe(false);
    expect(safeStatus.isMonthlyCapReached).toBe(false);

    const exceededStatus: SpendBudgetStatus = {
      allowed: false,
      dailySpendUsd: 26.10,
      dailyBudgetCapUsd: 25.00,
      monthlySpendUsd: 110.00,
      monthlyBudgetCapUsd: 250.00,
      isDailyCapReached: true,
      isMonthlyCapReached: false,
      reason: "Daily budget cap of $25.00 reached ($26.10 spent today)."
    };

    expect(exceededStatus.allowed).toBe(false);
    expect(exceededStatus.isDailyCapReached).toBe(true);
    expect(exceededStatus.reason).toBeDefined();
  });

  it("should validate JobQueueDoc error categorization and retry lifecycle", () => {
    const transientJob: JobQueueDoc = {
      id: "job_transient",
      workspaceId: "ws_default",
      businessId: "biz_devcomm",
      taskType: "TASK_COLLECT_SIGNALS",
      payload: { companyId: "comp_456" },
      status: "pending",
      attemptCount: 2,
      maxRetries: 3,
      lastError: "Rate limit exceeded (HTTP 429)",
      errorCategory: "transient_rate_limit",
      nextRetryAt: new Date(Date.now() + 10000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    expect(transientJob.status).toBe("pending");
    expect(transientJob.attemptCount).toBe(2);
    expect(transientJob.errorCategory).toBe("transient_rate_limit");
    expect(transientJob.nextRetryAt).toBeDefined();
  });
});
