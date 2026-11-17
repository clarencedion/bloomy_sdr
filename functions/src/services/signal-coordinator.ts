import type { EvidenceItem, SignalContext, SignalResult } from "../types/domain.js";
import { defaultSignalRegistry, SignalRegistry } from "../providers/signals/signal-registry.js";
import { signalCache, SignalCache } from "./signal-cache.js";
import { storeEvidenceItems } from "./evidence-service.js";
import { writeLog } from "../utils/logger.js";

export interface SignalCoordinatorOptions {
  registry?: SignalRegistry;
  cache?: SignalCache;
  requestedProviders?: string[];
  forceRefresh?: boolean;
  timeoutMs?: number;
}

export interface SignalCoordinatorResult {
  evidence: EvidenceItem[];
  results: SignalResult[];
  totalCostUsd: number;
  totalDurationMs: number;
  errors: Array<{ providerId: string; error: string }>;
}

/**
 * Runs a promise with a timeout bound
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
 * Executes a resilient, parallel signal collection pipeline for a company context
 */
export async function runSignalCollection(
  context: SignalContext,
  options?: SignalCoordinatorOptions
): Promise<SignalCoordinatorResult> {
  const overallStartTime = Date.now();
  const registry = options?.registry ?? defaultSignalRegistry;
  const cache = options?.cache ?? signalCache;
  const timeoutMs = options?.timeoutMs ?? 10000;
  const forceRefresh = options?.forceRefresh === true;

  const candidateProviders = registry.getProvidersForContext(context, options?.requestedProviders);

  const results: SignalResult[] = [];
  const errors: Array<{ providerId: string; error: string }> = [];
  const allNewEvidence: Array<Omit<EvidenceItem, "id" | "workspaceId" | "businessId" | "companyId">> = [];
  const finalEvidence: EvidenceItem[] = [];

  // Execute providers in parallel with failure isolation
  const providerPromises = candidateProviders.map(async (provider) => {
    const providerStartTime = Date.now();

    // 1. Check cache if not forcing refresh
    if (!forceRefresh) {
      const cached = await cache.getCachedEvidence(context.company.id, provider.id);
      if (cached && cached.length > 0) {
        finalEvidence.push(...cached);
        const cachedResult: SignalResult = {
          providerId: provider.id,
          evidence: cached.map(({ ...rest }) => rest),
          costEstimateUsd: 0,
          durationMs: Date.now() - providerStartTime
        };
        results.push(cachedResult);
        return;
      }
    }

    // 2. Execute provider with timeout and error boundary
    try {
      // A provider that declares its own bound knows better than the default:
      // PageSpeed renders the page server-side and needs far longer than the
      // fast HTTP providers, and was aborting on every single run.
      const providerTimeoutMs = provider.timeoutMs ?? timeoutMs;
      const result = await withTimeout(
        provider.collect(context),
        providerTimeoutMs,
        `Provider '${provider.id}' timed out after ${providerTimeoutMs}ms`
      );

      results.push(result);

      if (result.error) {
        errors.push({ providerId: provider.id, error: result.error });
      } else if (result.evidence.length > 0) {
        allNewEvidence.push(...result.evidence);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push({ providerId: provider.id, error: errorMsg });
      results.push({
        providerId: provider.id,
        evidence: [],
        costEstimateUsd: provider.costPerExecutionUsd,
        durationMs: Date.now() - providerStartTime,
        error: errorMsg
      });
    }
  });

  await Promise.allSettled(providerPromises);

  // 3. Persist new evidence items to Firestore
  if (allNewEvidence.length > 0) {
    try {
      const stored = await storeEvidenceItems(
        context.workspaceId,
        context.businessId,
        context.company.id,
        allNewEvidence,
        { overwriteKey: true }
      );
      finalEvidence.push(...stored);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push({ providerId: "persistence", error: `Failed to persist evidence: ${errorMsg}` });
    }
  }

  const totalDurationMs = Date.now() - overallStartTime;
  const totalCostUsd = results.reduce((sum, r) => sum + (r.costEstimateUsd || 0), 0);

  // 4. Log signal collection run
  await writeLog({
    type: "signals.collection.run",
    level: errors.length > 0 && finalEvidence.length === 0 ? "error" : errors.length > 0 ? "warning" : "info",
    message: `Signal collection completed for company '${context.company.name}' (${finalEvidence.length} evidence items, cost: $${totalCostUsd.toFixed(4)}, ${errors.length} provider errors).`,
    metadata: {
      workspaceId: context.workspaceId,
      businessId: context.businessId,
      companyId: context.company.id,
      providersExecuted: candidateProviders.map((p) => p.id),
      evidenceCount: finalEvidence.length,
      totalCostUsd,
      durationMs: totalDurationMs,
      errors
    }
  }).catch(() => {
    // Non-blocking log failure
  });

  return {
    evidence: finalEvidence,
    results,
    totalCostUsd,
    totalDurationMs,
    errors
  };
}
