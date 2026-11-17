import { describe, it, expect } from "vitest";
import { QwenProvider, QWEN_DEFAULT_BASE_URL, QWEN_DEFAULT_MODEL } from "../../providers/ai/qwen-provider.js";
import { AnthropicProvider } from "../../providers/ai/anthropic-provider.js";
import { estimateCostUsd, isKnownModel } from "../../services/ai-pricing.js";

/** Reaches the protected `endpoint` getter without loosening it for callers. */
const endpointOf = (provider: AnthropicProvider) =>
  (provider as unknown as { endpoint: string }).endpoint;

describe("Qwen through the Anthropic-compatible endpoint", () => {
  it("builds the documented messages URL", () => {
    const provider = new QwenProvider({ apiKey: "k" });
    expect(endpointOf(provider)).toBe("https://dashscope-intl.aliyuncs.com/apps/anthropic/v1/messages");
  });

  it("does not double the version segment when a base URL already carries /v1", () => {
    // Alibaba documents that `/apps/anthropic/v1/` yields `/v1/v1/models` and a 404.
    const provider = new QwenProvider({ apiKey: "k", baseUrl: "https://dashscope-intl.aliyuncs.com/apps/anthropic/v1" });
    expect(endpointOf(provider)).toBe("https://dashscope-intl.aliyuncs.com/apps/anthropic/v1/messages");

    const trailing = new QwenProvider({ apiKey: "k", baseUrl: `${QWEN_DEFAULT_BASE_URL}/` });
    expect(endpointOf(trailing)).toBe("https://dashscope-intl.aliyuncs.com/apps/anthropic/v1/messages");
  });

  it("supports a workspace-scoped regional endpoint", () => {
    const provider = new QwenProvider({
      apiKey: "k",
      baseUrl: "https://ws-123.ap-southeast-1.maas.aliyuncs.com/apps/anthropic"
    });
    expect(endpointOf(provider)).toBe("https://ws-123.ap-southeast-1.maas.aliyuncs.com/apps/anthropic/v1/messages");
  });

  it("never rewrites a Qwen model id through Claude's alias table", () => {
    // The parent normalises ids like `claude-3-5-haiku-*`; a Qwen name must
    // pass through untouched or requests would name a model that is not there.
    expect(new QwenProvider({ apiKey: "k" }).model).toBe(QWEN_DEFAULT_MODEL);
    expect(new QwenProvider({ apiKey: "k", model: "qwen3.8-max" }).model).toBe("qwen3.8-max");
  });

  it("leaves the real Anthropic endpoint untouched", () => {
    expect(endpointOf(new AnthropicProvider({ apiKey: "k" }))).toBe("https://api.anthropic.com/v1/messages");
    expect(new AnthropicProvider({ apiKey: "k" }).name).toBe("anthropic");
  });

  it("reports itself as qwen so spend is attributed and priced correctly", () => {
    expect(new QwenProvider({ apiKey: "k" }).name).toBe("qwen");
  });

  it("is not configured without a key, so it degrades instead of failing every company", () => {
    expect(new QwenProvider({ apiKey: undefined }).isConfigured()).toBe(false);
    expect(new QwenProvider({ apiKey: "k" }).isConfigured()).toBe(true);
  });
});

describe("Qwen request shape", () => {
  /** Reads the protected hook without exposing it to callers. */
  const bodyOf = (p: AnthropicProvider) =>
    (p as unknown as { extraBody: () => Record<string, unknown> }).extraBody();

  it("turns off reasoning this pipeline pays for and discards", () => {
    // Every call reads the `text` block and drops the rest, so thinking tokens
    // are billed on the expensive side and thrown away. A probe at
    // max_tokens 64 spent the whole budget thinking and returned no text block
    // at all - which the provider treats as a failed call.
    expect(bodyOf(new QwenProvider({ apiKey: "k" }))).toEqual({ thinking: { type: "disabled" } });
  });

  it("adds nothing to a real Anthropic request", () => {
    expect(bodyOf(new AnthropicProvider({ apiKey: "k" }))).toEqual({});
  });
});

describe("Qwen pricing", () => {
  it("prices Qwen at its own rates, not Claude's", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };

    const qwen = estimateCostUsd({ provider: "qwen", model: "qwen3.8-flash", usage });
    const claude = estimateCostUsd({ provider: "anthropic", model: "claude-haiku-4-5", usage });

    expect(qwen).toBeCloseTo(0.16 + 0.47, 4);
    expect(claude).toBeCloseTo(1 + 5, 4);
    // The reason for the switch: about 9.5x cheaper on this mix.
    expect(claude / qwen).toBeGreaterThan(9);
  });

  it("recognises the Qwen models it can price", () => {
    expect(isKnownModel("qwen", "qwen3.8-flash")).toBe(true);
    expect(isKnownModel("qwen", "qwen3.8-max")).toBe(true);
  });

  it("still charges for an unknown Qwen model rather than recording it as free", () => {
    const cost = estimateCostUsd({
      provider: "qwen",
      model: "qwen-something-unreleased",
      usage: { inputTokens: 1_000_000, outputTokens: 0 }
    });
    expect(cost).toBeGreaterThan(0);
  });
});
