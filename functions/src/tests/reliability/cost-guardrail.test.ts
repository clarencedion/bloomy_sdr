import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../../config/firebase.js";
import {
  checkBudgetGuardrail,
  getCostSummary,
  recordApiSpend
} from "../../services/cost-guardrail-service.js";
import { enqueueTask, processTaskJob } from "../../services/task-queue-service.js";

describe("Signal Cost Tracking & Budget Guardrails (REQ-024)", () => {
  it("should record API spend and update daily aggregate counters by provider and operation", async () => {
    const workspaceId = `ws_cost_test_${Date.now()}`;
    const businessId = `biz_cost_test_${Date.now()}`;
    const todayStr = new Date().toISOString().slice(0, 10);

    // Record OpenAI spend
    await recordApiSpend({
      workspaceId,
      businessId,
      provider: "openai",
      costUsd: 0.015,
      tokensOrCredits: 750,
      operation: "research_company",
      companyId: "comp_1"
    });

    // Record Serper spend
    await recordApiSpend({
      workspaceId,
      businessId,
      provider: "serper",
      costUsd: 0.001,
      operation: "website_resolution",
      companyId: "comp_1"
    });

    // Record second OpenAI spend
    await recordApiSpend({
      workspaceId,
      businessId,
      provider: "openai",
      costUsd: 0.020,
      tokensOrCredits: 1000,
      operation: "outreach_generation",
      companyId: "comp_1"
    });

    const docId = `${workspaceId}_${businessId}_${todayStr}`;
    const snap = await adminDb.collection("apiSpendDaily").doc(docId).get();
    expect(snap.exists).toBe(true);

    const data = snap.data();
    expect(data?.totalSpendUsd).toBe(0.036);
    expect(data?.spendByProvider.openai).toBe(0.035);
    expect(data?.spendByProvider.serper).toBe(0.001);
    expect(data?.spendByOperation.research_company).toBe(0.015);
    expect(data?.spendByOperation.outreach_generation).toBe(0.020);
    expect(data?.callCount).toBe(3);
  });

  it("should enforce budget guardrails and halt task dispatch when daily spend cap is reached", async () => {
    const workspaceId = `ws_guardrail_${Date.now()}`;
    const businessId = `biz_guardrail_${Date.now()}`;
    const todayStr = new Date().toISOString().slice(0, 10);

    // 1. When spend is $0 -> allowed
    const initialStatus = await checkBudgetGuardrail(workspaceId, businessId, 0.05);
    expect(initialStatus.allowed).toBe(true);
    expect(initialStatus.isDailyCapReached).toBe(false);

    // 2. Set spend exceeding daily limit ($30 spent on $25 limit)
    const docId = `${workspaceId}_${businessId}_${todayStr}`;
    await adminDb.collection("apiSpendDaily").doc(docId).set({
      id: docId,
      workspaceId,
      businessId,
      date: todayStr,
      totalSpendUsd: 30.50,
      spendByProvider: { openai: 30.50 },
      spendByOperation: { research_company: 30.50 },
      callCount: 150,
      budgetCapUsd: 25,
      budgetExceeded: true,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });

    // 3. Check guardrail -> should be blocked
    const exceededStatus = await checkBudgetGuardrail(workspaceId, businessId, 0.01);
    expect(exceededStatus.allowed).toBe(false);
    expect(exceededStatus.isDailyCapReached).toBe(true);
    expect(exceededStatus.reason).toContain("Daily budget cap");

    // 4. Verify processTaskJob halts immediately with budget exceeded error
    const jobId = await enqueueTask(
      "TASK_COLLECT_SIGNALS",
      { companyId: "comp_blocked_by_budget" },
      { workspaceId, businessId }
    );

    const taskResult = await processTaskJob(jobId);
    expect(taskResult.success).toBe(false);
    expect(taskResult.budgetExceeded).toBe(true);
    expect(taskResult.error).toContain("Daily budget cap");

    const jobSnap = await adminDb.collection("jobQueue").doc(jobId).get();
    expect(jobSnap.data()?.status).toBe("failed");
    expect(jobSnap.data()?.errorCategory).toBe("budget_exceeded");
  });

  it("should aggregate full cost summary with provider breakdowns", async () => {
    const workspaceId = `ws_summary_${Date.now()}`;
    const businessId = `biz_summary_${Date.now()}`;

    await recordApiSpend({
      workspaceId,
      businessId,
      provider: "anthropic",
      costUsd: 0.05,
      operation: "reply_intelligence"
    });

    await recordApiSpend({
      workspaceId,
      businessId,
      provider: "dropcontact",
      costUsd: 0.02,
      operation: "contact_enrichment"
    });

    const summary = await getCostSummary(workspaceId, businessId);

    expect(summary.todaySpendUsd).toBe(0.07);
    expect(summary.spendByProvider.anthropic).toBe(0.05);
    expect(summary.spendByProvider.dropcontact).toBe(0.02);
    expect(summary.dailyBudgetCapUsd).toBeDefined();
    expect(summary.monthlyBudgetCapUsd).toBeDefined();
  });
});
