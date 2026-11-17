import { describe, it, expect } from "vitest";
import { estimateCostUsd, isKnownModel } from "../../services/ai-pricing.js";

/**
 * The providers return accurate token counts from the API, but nothing turned
 * them into dollars: every call site read `result.estimatedCost ?? 0`, which no
 * real provider ever set. Tracked spend was ~$0.14 against a real bill of
 * ~$1.52, so the daily budget cap was guarding a number that meant nothing.
 */
describe("AI cost estimation", () => {
  it("prices Haiku 4.5 at its published rate", () => {
    // 1M input @ $1 + 1M output @ $5
    const cost = estimateCostUsd({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 }
    });
    expect(cost).toBeCloseTo(6, 2);
  });

  it("handles the dated model ids the API actually returns", () => {
    const dated = estimateCostUsd({
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      usage: { inputTokens: 1_000_000, outputTokens: 0 }
    });
    expect(dated).toBeCloseTo(1, 3);
    expect(isKnownModel("anthropic", "claude-haiku-4-5-20251001")).toBe(true);
  });

  it("prices a realistic research call in fractions of a cent", () => {
    // Measured average: ~2096 in / ~807 out on Haiku 4.5.
    const cost = estimateCostUsd({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      usage: { inputTokens: 2096, outputTokens: 807 }
    });
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(0.01);
  });

  it("charges cache reads at a fraction of input and writes at a premium", () => {
    const read = estimateCostUsd({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      usage: { cacheReadTokens: 1_000_000 }
    });
    const write = estimateCostUsd({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      usage: { cacheWriteTokens: 1_000_000 }
    });
    expect(read).toBeCloseTo(0.1, 3);
    expect(write).toBeCloseTo(1.25, 3);
    expect(read).toBeLessThan(write);
  });

  it("never prices an unknown model at zero", () => {
    // Silent zero-cost is what let real spend go untracked.
    const cost = estimateCostUsd({
      provider: "anthropic",
      model: "some-future-model",
      usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 }
    });
    expect(cost).toBeGreaterThan(0);
    expect(isKnownModel("anthropic", "some-future-model")).toBe(false);
  });

  it("costs nothing when the mock provider runs", () => {
    expect(
      estimateCostUsd({ provider: "mock", usage: { inputTokens: 999_999, outputTokens: 999_999 } })
    ).toBe(0);
  });
});
