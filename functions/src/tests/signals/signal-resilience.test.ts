import { describe, it, expect } from "vitest";
import { runSignalCollection } from "../../services/signal-coordinator.js";
import { SignalRegistry } from "../../providers/signals/signal-registry.js";
import { SignalCache } from "../../services/signal-cache.js";
import type { SignalContext, SignalProvider } from "../../providers/signals/signal-provider.js";

describe("Failure-Resilient Signal Pipeline & Cost Tracking (REQ-024 & REQ-025)", () => {
  it("isolates provider failures and captures surviving evidence without crashing", async () => {
    const registry = new SignalRegistry(false);
    const cache = new SignalCache();

    // Provider 1: Fails with 500 Internal Server Error
    const failingProvider: SignalProvider = {
      id: "failing_api",
      name: "Unreliable API",
      description: "Throws 500 error",
      capabilities: ["bad_signal"],
      costPerExecutionUsd: 0.002,
      supports: () => true,
      collect: async () => {
        throw new Error("External API HTTP 500 Internal Server Error");
      }
    };

    // Provider 2: Succeeds and returns facts
    const healthyProvider: SignalProvider = {
      id: "healthy_api",
      name: "Reliable Registry",
      description: "Returns legal facts",
      capabilities: ["legal_name", "siren"],
      costPerExecutionUsd: 0.00,
      supports: () => true,
      collect: async () => ({
        providerId: "healthy_api",
        evidence: [
          {
            signalProvider: "healthy_api",
            key: "legal_name",
            value: "Resilience Test Ltd",
            sourceType: "official_registry",
            confidence: 95,
            nature: "fact",
            collectedAt: new Date()
          }
        ],
        costEstimateUsd: 0.00,
        durationMs: 25
      })
    };

    registry.register(failingProvider);
    registry.register(healthyProvider);

    const context: SignalContext = {
      workspaceId: "ws_test",
      businessId: "biz_test",
      company: {
        id: `comp_resilience_${Date.now()}`,
        name: "Resilience Test Ltd"
      }
    };

    const result = await runSignalCollection(context, { registry, cache, forceRefresh: true });

    // The coordinator should NOT throw
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].providerId).toBe("failing_api");
    expect(result.errors[0].error).toContain("HTTP 500");

    // Surviving evidence from healthy provider must be preserved
    expect(result.evidence.length).toBe(1);
    expect(result.evidence[0].key).toBe("legal_name");
    expect(result.evidence[0].value).toBe("Resilience Test Ltd");

    // Cost tracking
    expect(typeof result.totalCostUsd).toBe("number");
    expect(typeof result.totalDurationMs).toBe("number");
    expect(result.totalDurationMs).toBeGreaterThan(0);
  });

  it("handles provider timeouts gracefully", async () => {
    const registry = new SignalRegistry(false);
    const cache = new SignalCache();

    const slowProvider: SignalProvider = {
      id: "slow_provider",
      name: "Slow Crawling Provider",
      description: "Hangs indefinitely",
      capabilities: ["slow_metric"],
      costPerExecutionUsd: 0.01,
      supports: () => true,
      collect: async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return {
          providerId: "slow_provider",
          evidence: [],
          costEstimateUsd: 0.01,
          durationMs: 500
        };
      }
    };

    registry.register(slowProvider);

    const context: SignalContext = {
      workspaceId: "ws_test",
      businessId: "biz_test",
      company: {
        id: `comp_timeout_${Date.now()}`,
        name: "Timeout Test Corp"
      }
    };

    // Set timeout to 50ms (shorter than provider execution of 500ms)
    const result = await runSignalCollection(context, {
      registry,
      cache,
      forceRefresh: true,
      timeoutMs: 50
    });

    expect(result.errors.length).toBe(1);
    expect(result.errors[0].providerId).toBe("slow_provider");
    expect(result.errors[0].error).toContain("timed out after 50ms");
  });
});
