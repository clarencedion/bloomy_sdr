import { describe, it, expect } from "vitest";
import { runSignalCollection } from "../../services/signal-coordinator.js";
import { SignalRegistry } from "../../providers/signals/signal-registry.js";
import { SignalCache } from "../../services/signal-cache.js";
import type { SignalContext, SignalProvider } from "../../providers/signals/signal-provider.js";

describe("Signal Caching & Freshness (REQ-023)", () => {
  it("reuses cached evidence on subsequent calls without invoking the external provider", async () => {
    const companyId = `comp_cache_test_${Date.now()}`;
    const registry = new SignalRegistry(false);
    const cache = new SignalCache();

    let providerExecutionCount = 0;

    const mockProvider: SignalProvider = {
      id: "expensive_audit",
      name: "Expensive Signal Provider",
      description: "Performs expensive crawling",
      capabilities: ["deep_tech_score"],
      costPerExecutionUsd: 0.05,
      supports: () => true,
      collect: async () => {
        providerExecutionCount += 1;
        return {
          providerId: "expensive_audit",
          evidence: [
            {
              signalProvider: "expensive_audit",
              key: "deep_tech_score",
              value: 88,
              sourceType: "provider",
              confidence: 90,
              nature: "derived_metric",
              collectedAt: new Date(),
              expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            }
          ],
          costEstimateUsd: 0.05,
          durationMs: 50
        };
      }
    };

    registry.register(mockProvider);

    const context: SignalContext = {
      workspaceId: "ws_test",
      businessId: "biz_test",
      company: {
        id: companyId,
        name: "Cache Test Corp"
      }
    };

    // First execution: should invoke provider
    const run1 = await runSignalCollection(context, { registry, cache });
    expect(providerExecutionCount).toBe(1);
    expect(run1.evidence.length).toBe(1);
    expect(run1.totalCostUsd).toBe(0.05);

    // Second execution: should use cache (0 USD cost, provider NOT invoked again)
    const run2 = await runSignalCollection(context, { registry, cache });
    expect(providerExecutionCount).toBe(1); // Still 1!
    expect(run2.evidence.length).toBe(1);
    expect(run2.evidence[0].key).toBe("deep_tech_score");
    expect(run2.totalCostUsd).toBe(0); // Cached calls have 0 additional API cost
  });

  it("bypasses cache when forceRefresh is true", async () => {
    const companyId = `comp_cache_force_${Date.now()}`;
    const registry = new SignalRegistry(false);
    const cache = new SignalCache();

    let executionCount = 0;
    const mockProvider: SignalProvider = {
      id: "refreshable_provider",
      name: "Refreshable Provider",
      description: "Supports force refresh",
      capabilities: ["metric_val"],
      costPerExecutionUsd: 0.01,
      supports: () => true,
      collect: async () => {
        executionCount += 1;
        return {
          providerId: "refreshable_provider",
          evidence: [
            {
              signalProvider: "refreshable_provider",
              key: "metric_val",
              value: executionCount,
              sourceType: "provider",
              confidence: 90,
              nature: "derived_metric",
              collectedAt: new Date(),
              expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            }
          ],
          costEstimateUsd: 0.01,
          durationMs: 15
        };
      }
    };

    registry.register(mockProvider);

    const context: SignalContext = {
      workspaceId: "ws_test",
      businessId: "biz_test",
      company: { id: companyId, name: "Force Refresh Corp" }
    };

    await runSignalCollection(context, { registry, cache });
    expect(executionCount).toBe(1);

    // Force refresh = true
    await runSignalCollection(context, { registry, cache, forceRefresh: true });
    expect(executionCount).toBe(2);
  });
});
