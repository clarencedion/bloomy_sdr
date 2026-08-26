import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../config/firebase.js";
import { getGlobalSettings } from "../utils/settings.js";
import { writeLog } from "../utils/logger.js";
import type { ApiSpendDailyDoc, SpendBudgetStatus } from "../types/domain.js";

function getTodayString(): string {
  return new Date().toISOString().slice(0, 10);
}

function getStartOfMonthString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export interface RecordApiSpendParams {
  workspaceId: string;
  businessId: string;
  provider: "openai" | "anthropic" | "serper" | "dropcontact" | "google_places" | "pagespeed" | "pappers" | string;
  costUsd: number;
  tokensOrCredits?: number;
  operation: string;
  companyId?: string;
}

/**
 * Records API spend and updates daily aggregated spend counters (REQ-024)
 */
export async function recordApiSpend(params: RecordApiSpendParams): Promise<void> {
  const { workspaceId, businessId, provider, costUsd, tokensOrCredits, operation, companyId } = params;
  if (!workspaceId || !businessId || costUsd < 0) return;

  const dateStr = getTodayString();
  const docId = `${workspaceId}_${businessId}_${dateStr}`;
  const docRef = adminDb.collection("apiSpendDaily").doc(docId);

  const settings = await getGlobalSettings();
  const dailyBudgetCap = settings.dailySpendBudgetUsd ?? 25;

  const now = Timestamp.now();

  try {
    await adminDb.runTransaction(async (transaction) => {
      const snap = await transaction.get(docRef);
      if (snap.exists) {
        const data = snap.data() as ApiSpendDailyDoc;
        const currentTotal = Number(data.totalSpendUsd || 0);
        const newTotal = Math.round((currentTotal + costUsd) * 10000) / 10000;

        const spendByProvider = { ...(data.spendByProvider || {}) };
        spendByProvider[provider] = Math.round(((spendByProvider[provider] || 0) + costUsd) * 10000) / 10000;

        const spendByOperation = { ...(data.spendByOperation || {}) };
        spendByOperation[operation] = Math.round(((spendByOperation[operation] || 0) + costUsd) * 10000) / 10000;

        const newCallCount = (data.callCount || 0) + 1;
        const budgetExceeded = newTotal >= dailyBudgetCap;

        transaction.update(docRef, {
          totalSpendUsd: newTotal,
          spendByProvider,
          spendByOperation,
          callCount: newCallCount,
          budgetCapUsd: dailyBudgetCap,
          budgetExceeded,
          updatedAt: now
        });
      } else {
        const initialDoc: ApiSpendDailyDoc = {
          id: docId,
          workspaceId,
          businessId,
          date: dateStr,
          totalSpendUsd: Math.round(costUsd * 10000) / 10000,
          spendByProvider: { [provider]: Math.round(costUsd * 10000) / 10000 },
          spendByOperation: { [operation]: Math.round(costUsd * 10000) / 10000 },
          callCount: 1,
          budgetCapUsd: dailyBudgetCap,
          budgetExceeded: costUsd >= dailyBudgetCap,
          createdAt: now,
          updatedAt: now
        };
        transaction.set(docRef, initialDoc);
      }
    });

    // Optional atomic spend log for high-value operations
    if (costUsd >= 0.05) {
      await writeLog({
        type: "api.spend.recorded",
        level: "info",
        message: `API spend recorded for ${provider} (${operation}): $${costUsd.toFixed(4)}.`,
        metadata: {
          workspaceId,
          businessId,
          provider,
          operation,
          costUsd,
          tokensOrCredits,
          companyId
        }
      });
    }
  } catch (err) {
    // Non-blocking log
    console.error("[cost-guardrail-service] Failed to record API spend:", err);
  }
}

/**
 * Checks whether current daily or monthly spend exceeds configured budget caps (REQ-024, REQ-080)
 */
export async function checkBudgetGuardrail(
  workspaceId: string,
  businessId: string,
  estimatedCostUsd = 0
): Promise<SpendBudgetStatus> {
  const settings = await getGlobalSettings();
  const dailyBudgetCapUsd = settings.dailySpendBudgetUsd ?? 25;
  const monthlyBudgetCapUsd = settings.monthlySpendBudgetUsd ?? 250;

  const dateStr = getTodayString();
  const todayDocId = `${workspaceId}_${businessId}_${dateStr}`;
  const todaySnap = await adminDb.collection("apiSpendDaily").doc(todayDocId).get();

  let dailySpendUsd = 0;
  if (todaySnap.exists) {
    dailySpendUsd = Number(todaySnap.data()?.totalSpendUsd || 0);
  }

  // Calculate Month-to-Date Spend
  let monthlySpendUsd = dailySpendUsd;
  const startOfMonth = getStartOfMonthString();

  try {
    const monthSnap = await adminDb
      .collection("apiSpendDaily")
      .where("workspaceId", "==", workspaceId)
      .where("businessId", "==", businessId)
      .where("date", ">=", startOfMonth)
      .get();

    if (!monthSnap.empty) {
      monthlySpendUsd = monthSnap.docs.reduce((sum, doc) => {
        return sum + Number(doc.data().totalSpendUsd || 0);
      }, 0);
    }
  } catch {
    // Fallback if composite index is pending
    monthlySpendUsd = dailySpendUsd;
  }

  const isDailyCapReached = dailySpendUsd + estimatedCostUsd >= dailyBudgetCapUsd;
  const isMonthlyCapReached = monthlySpendUsd + estimatedCostUsd >= monthlyBudgetCapUsd;

  let reason: string | undefined;
  if (isDailyCapReached) {
    reason = `Daily budget cap of $${dailyBudgetCapUsd.toFixed(2)} reached ($${dailySpendUsd.toFixed(2)} spent today).`;
  } else if (isMonthlyCapReached) {
    reason = `Monthly budget cap of $${monthlyBudgetCapUsd.toFixed(2)} reached ($${monthlySpendUsd.toFixed(2)} spent this month).`;
  }

  const allowed = !isDailyCapReached && !isMonthlyCapReached;

  return {
    allowed,
    dailySpendUsd: Math.round(dailySpendUsd * 100) / 100,
    dailyBudgetCapUsd,
    monthlySpendUsd: Math.round(monthlySpendUsd * 100) / 100,
    monthlyBudgetCapUsd,
    isDailyCapReached,
    isMonthlyCapReached,
    reason
  };
}

/**
 * Returns centralized cost summary and provider breakdown for reporting (REQ-024)
 */
export async function getCostSummary(
  workspaceId: string,
  businessId?: string
): Promise<{
  todaySpendUsd: number;
  monthSpendUsd: number;
  spendByProvider: Record<string, number>;
  spendByOperation: Record<string, number>;
  dailyBudgetCapUsd: number;
  monthlyBudgetCapUsd: number;
  budgetExceeded: boolean;
  isDailyCapReached: boolean;
  isMonthlyCapReached: boolean;
}> {
  const settings = await getGlobalSettings();
  const dailyBudgetCapUsd = settings.dailySpendBudgetUsd ?? 25;
  const monthlyBudgetCapUsd = settings.monthlySpendBudgetUsd ?? 250;

  const dateStr = getTodayString();
  const targetBusinessId = businessId || "biz_devcomm";
  const todayDocId = `${workspaceId}_${targetBusinessId}_${dateStr}`;
  const todaySnap = await adminDb.collection("apiSpendDaily").doc(todayDocId).get();

  let todaySpendUsd = 0;
  let spendByProvider: Record<string, number> = {};
  let spendByOperation: Record<string, number> = {};

  if (todaySnap.exists) {
    const data = todaySnap.data() as ApiSpendDailyDoc;
    todaySpendUsd = Number(data.totalSpendUsd || 0);
    spendByProvider = data.spendByProvider || {};
    spendByOperation = data.spendByOperation || {};
  }

  let monthSpendUsd = todaySpendUsd;
  const startOfMonth = getStartOfMonthString();

  try {
    let q = adminDb
      .collection("apiSpendDaily")
      .where("workspaceId", "==", workspaceId)
      .where("date", ">=", startOfMonth);

    if (businessId) {
      q = q.where("businessId", "==", businessId);
    }

    const monthSnap = await q.get();
    if (!monthSnap.empty) {
      monthSpendUsd = 0;
      const combinedProviders: Record<string, number> = {};
      const combinedOps: Record<string, number> = {};

      for (const d of monthSnap.docs) {
        const item = d.data() as ApiSpendDailyDoc;
        monthSpendUsd += Number(item.totalSpendUsd || 0);

        if (item.spendByProvider) {
          for (const [p, amt] of Object.entries(item.spendByProvider)) {
            combinedProviders[p] = Math.round(((combinedProviders[p] || 0) + amt) * 10000) / 10000;
          }
        }
        if (item.spendByOperation) {
          for (const [op, amt] of Object.entries(item.spendByOperation)) {
            combinedOps[op] = Math.round(((combinedOps[op] || 0) + amt) * 10000) / 10000;
          }
        }
      }
      spendByProvider = combinedProviders;
      spendByOperation = combinedOps;
    }
  } catch {
    monthSpendUsd = todaySpendUsd;
  }

  const isDailyCapReached = todaySpendUsd >= dailyBudgetCapUsd;
  const isMonthlyCapReached = monthSpendUsd >= monthlyBudgetCapUsd;

  return {
    todaySpendUsd: Math.round(todaySpendUsd * 100) / 100,
    monthSpendUsd: Math.round(monthSpendUsd * 100) / 100,
    spendByProvider,
    spendByOperation,
    dailyBudgetCapUsd,
    monthlyBudgetCapUsd,
    budgetExceeded: isDailyCapReached || isMonthlyCapReached,
    isDailyCapReached,
    isMonthlyCapReached
  };
}
