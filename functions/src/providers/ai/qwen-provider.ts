import type { AiProviderName } from "./ai-provider.js";
import { AnthropicProvider } from "./anthropic-provider.js";

/**
 * Alibaba's Qwen models, served through Model Studio / QwenCloud.
 *
 * Model Studio publishes an **Anthropic-compatible Messages API** — the same
 * `POST /v1/messages` shape, the same `x-api-key` header, the same `system` +
 * `messages` body. So this is the existing Anthropic provider pointed at a
 * different base URL, not a reimplementation: three parameters change (key,
 * base URL, model) and every prompt, parser and token counter stays put.
 *
 * **Why it is worth having:** list pricing is $0.16 per million input tokens
 * and $0.47 per million output, against $1.00 / $5.00 for Claude Haiku 4.5 —
 * about 6x cheaper on input and 10x on output. This workload is structured
 * extraction plus short French B2B copy, not hard reasoning, so it is a
 * plausible fit.
 *
 * **What is not established:** whether it writes French commercial copy as well
 * as Haiku. That is the product, and no published benchmark answers it — only
 * running both across the same prospects and reading the drafts does. This
 * exists so that comparison is one setting away, not so the switch can be made
 * blind.
 *
 * Endpoint and model id verified against Alibaba Cloud Model Studio's
 * Anthropic-compatible Messages API documentation.
 */

/**
 * International endpoint. Deliberately has no `/v1` suffix — Alibaba documents
 * that `/apps/anthropic/v1/` yields a duplicated `/v1/v1/` path and a 404.
 * Region-scoped deployments use
 * `https://{WorkspaceId}.{region}.maas.aliyuncs.com/apps/anthropic`.
 */
export const QWEN_DEFAULT_BASE_URL = "https://dashscope-intl.aliyuncs.com/apps/anthropic";

/** Listed verbatim in Model Studio's Anthropic-compatible API documentation. */
export const QWEN_DEFAULT_MODEL = "qwen3.8-flash";

export class QwenProvider extends AnthropicProvider {
  override name: AiProviderName = "qwen";

  constructor(options?: { apiKey?: string; model?: string; baseUrl?: string }) {
    super({
      // DASHSCOPE_API_KEY is the variable name Alibaba's own docs use.
      apiKey: options?.apiKey ?? process.env.QWEN_API_KEY ?? process.env.DASHSCOPE_API_KEY,
      baseUrl: options?.baseUrl ?? process.env.QWEN_BASE_URL ?? QWEN_DEFAULT_BASE_URL
    });
    // Set after super(): the parent normalises ids against Claude's alias table,
    // which must not rewrite a Qwen model name.
    this.model = options?.model ?? process.env.QWEN_MODEL ?? QWEN_DEFAULT_MODEL;
    this.label = "Qwen";
  }

  /**
   * Qwen reasons before answering, and this pipeline never reads that reasoning
   * - every call takes the `text` block and discards the rest. So the thinking
   * tokens are billed on the expensive side ($0.47/M output) and thrown away,
   * and they compete with the answer for the `max_tokens` budget: a probe with
   * `max_tokens: 64` spent the entire allowance thinking and returned no text
   * block at all, which this provider treats as a failed call.
   *
   * Measured on the same prompt: 89 output tokens with thinking, 14 without,
   * for byte-identical JSON. Turning it off is both cheaper and safer here.
   *
   * `enable_thinking: false` - the parameter Qwen's OpenAI-compatible surface
   * uses - is ignored on this endpoint; the Anthropic-style form is the one
   * that takes effect.
   */
  protected override extraBody(): Record<string, unknown> {
    return { thinking: { type: "disabled" } };
  }
}
