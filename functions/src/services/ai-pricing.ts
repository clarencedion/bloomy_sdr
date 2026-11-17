/**
 * Converts real token counts into dollars.
 *
 * The AI providers return accurate `usage.input_tokens` / `usage.output_tokens`
 * from the API response, but nothing ever turned those into a cost - every call
 * site read `result.estimatedCost ?? 0`, which no real provider set. The daily
 * spend record therefore captured a fraction of the true bill, and the budget
 * guardrail was guarding a number that bore no relation to reality.
 *
 * Prices are USD per million tokens, list price, as published for the Anthropic
 * first-party API. Partner platforms (Bedrock, Vertex) bill differently.
 */

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  /** Tokens served from the prompt cache, billed at a fraction of input. */
  cacheReadTokens?: number;
  /** Tokens written to the cache, billed at a premium over input. */
  cacheWriteTokens?: number;
}

interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

/** Anthropic list prices, USD per 1M tokens. */
const ANTHROPIC_PRICES: Record<string, ModelPrice> = {
  "claude-haiku-4-5": { inputPerMillion: 1, outputPerMillion: 5 },
  "claude-sonnet-5": { inputPerMillion: 2, outputPerMillion: 10 },
  "claude-sonnet-4-6": { inputPerMillion: 3, outputPerMillion: 15 },
  "claude-opus-5": { inputPerMillion: 5, outputPerMillion: 25 },
  "claude-opus-4-8": { inputPerMillion: 5, outputPerMillion: 25 },
  "claude-opus-4-7": { inputPerMillion: 5, outputPerMillion: 25 },
  "claude-opus-4-6": { inputPerMillion: 5, outputPerMillion: 25 },
  "claude-fable-5": { inputPerMillion: 10, outputPerMillion: 50 }
};

/**
 * Approximate OpenAI prices. Kept deliberately conservative: over-estimating
 * spend makes the budget guardrail cautious, which is the safe direction.
 */
const OPENAI_PRICES: Record<string, ModelPrice> = {
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  "gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10 }
};

/**
 * Alibaba Model Studio list prices for Qwen, USD per 1M tokens.
 *
 * Qwen is reached through an Anthropic-compatible endpoint, so the provider
 * name is what distinguishes it here - the model id alone would fall through to
 * the Claude table and be priced 6x too high.
 */
const QWEN_PRICES: Record<string, ModelPrice> = {
  "qwen3.8-flash": { inputPerMillion: 0.16, outputPerMillion: 0.47 },
  "qwen3.8-max": { inputPerMillion: 2, outputPerMillion: 6 }
};

/** Cache reads cost ~10% of a normal input token; writes ~125%. */
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

/** Used when a model is unrecognised, so an unknown model is never free. */
const FALLBACK_PRICE: ModelPrice = { inputPerMillion: 3, outputPerMillion: 15 };

function resolvePrice(provider: string, model: string | undefined): ModelPrice {
  const key = String(model ?? "").toLowerCase();
  const table =
    provider === "openai" ? OPENAI_PRICES : provider === "qwen" ? QWEN_PRICES : ANTHROPIC_PRICES;

  if (table[key]) return table[key];

  // Model ids sometimes carry a date suffix (claude-haiku-4-5-20251001).
  const prefixMatch = Object.keys(table).find((id) => key.startsWith(id));
  if (prefixMatch) return table[prefixMatch];

  return FALLBACK_PRICE;
}

/** Cost in USD for one AI call, from its real token counts. */
export function estimateCostUsd(input: {
  provider: string;
  model?: string;
  usage: TokenUsage;
}): number {
  if (input.provider === "mock") return 0;

  const price = resolvePrice(input.provider, input.model);
  const { inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0 } = input.usage;

  const cost =
    (inputTokens / 1_000_000) * price.inputPerMillion +
    (outputTokens / 1_000_000) * price.outputPerMillion +
    (cacheReadTokens / 1_000_000) * price.inputPerMillion * CACHE_READ_MULTIPLIER +
    (cacheWriteTokens / 1_000_000) * price.inputPerMillion * CACHE_WRITE_MULTIPLIER;

  // Round to a tenth of a cent: enough precision to aggregate honestly.
  return Math.round(cost * 100000) / 100000;
}

/** True when we priced this call with a real entry rather than the fallback. */
export function isKnownModel(provider: string, model?: string): boolean {
  if (provider === "mock") return true;
  const table =
    provider === "openai" ? OPENAI_PRICES : provider === "qwen" ? QWEN_PRICES : ANTHROPIC_PRICES;
  const key = String(model ?? "").toLowerCase();
  return Boolean(table[key]) || Object.keys(table).some((id) => key.startsWith(id));
}
