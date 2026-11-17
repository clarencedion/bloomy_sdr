import type { AiProviderName, AIProvider, OutreachInput, OutreachProviderResult, ReplyClassificationInput, ReplyClassificationProviderResult, ReplyGenerationInput, ReplyGenerationProviderResult, ResearchInput, ResearchProviderResult, StructuredCallInput, StructuredCallResult } from "./ai-provider.js";
import { extractFirstJsonObject } from "../../utils/json-extract.js";
import { buildResearchUserPrompt, getResearchSystemPrompt } from "../../services/research-prompts.js";
import { parseResearchJson } from "../../services/research-schema.js";
import { buildOutreachUserPrompt, getOutreachSystemPrompt } from "../../services/outreach-prompts.js";
import { parseOutreachJson } from "../../services/outreach-schema.js";
import { buildReplyClassifierUserPrompt, getReplyClassifierSystemPrompt } from "../../services/reply-classifier-prompts.js";
import { parseReplyClassificationJson } from "../../services/reply-classifier-schema.js";
import { buildReplyGeneratorUserPrompt, getReplyGeneratorSystemPrompt } from "../../services/reply-generator-prompts.js";
import { parseReplyDraftJson } from "../../services/reply-generator-schema.js";

/**
 * Haiku 4.5 is Anthropic's cheapest model ($1 / $5 per million tokens in/out),
 * which is what this workload wants: high-volume structured extraction and
 * short-form copy, not hard reasoning.
 *
 * The fallback here used to be `claude-3-5-haiku-20241022` - a 2024 model that
 * would have been used silently by any deployment whose settings did not
 * override it.
 */
const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5";

/**
 * Current model ids are complete without a date suffix. Older stored settings
 * carry dated or retired ids, so they are mapped forward rather than sent as-is.
 */
const ANTHROPIC_MODEL_ALIASES: Record<string, string> = {
  "claude-haiku-4-5-20251001": "claude-haiku-4-5",
  "claude-haiku-4-5-latest": "claude-haiku-4-5",
  "claude-3-5-haiku-20241022": "claude-haiku-4-5",
  "claude-3-5-haiku-latest": "claude-haiku-4-5",
  "claude-3-haiku-20240307": "claude-haiku-4-5",
  "claude-3-5-sonnet-20240620": "claude-sonnet-5",
  "claude-3-5-sonnet-20241022": "claude-sonnet-5",
  "claude-3-5-sonnet-latest": "claude-sonnet-5",
  "claude-3-7-sonnet-20250219": "claude-sonnet-5",
  "claude-3-7-sonnet-latest": "claude-sonnet-5",
  "claude-sonnet-4-20250514": "claude-sonnet-5"
};

function normalizeAnthropicModel(model?: string) {
  const trimmed = model?.trim();
  if (!trimmed) return DEFAULT_ANTHROPIC_MODEL;
  return ANTHROPIC_MODEL_ALIASES[trimmed] ?? trimmed;
}

/**
 * Bound on one HTTP attempt. Without it, Node's fetch waits about 300 s for
 * headers, so a stalled endpoint would freeze an operator's prompt for minutes.
 * 15 s is the top of the 8-15 s range in the provider-integrations rules.
 */
const DEFAULT_TIMEOUT_MS = 15_000;

/** Retries after the first attempt, for 429 and 5xx only. */
const MAX_RETRIES = 3;

/** Waits used when the server sends no Retry-After: 1 s, then 2 s, then 4 s. */
const BACKOFF_BASE_MS = 1_000;

/**
 * Longest Retry-After this provider waits for. A longer request means the
 * quota is exhausted for a while, and retrying sooner than asked would only
 * earn another 429. The call fails, and the caller decides what to do.
 */
const MAX_RETRY_AFTER_MS = 30_000;

/** Defaults for `generateStructured`, in line with the reply methods: short JSON, little variation. */
const DEFAULT_STRUCTURED_MAX_TOKENS = 1500;
const DEFAULT_STRUCTURED_TEMPERATURE = 0.2;

/** Longest error-body excerpt quoted in an error. A proxy's 5xx can be a whole HTML page. */
const ERROR_BODY_EXCERPT = 300;

type MessagesPayload = {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number };
};

type AttemptOutcome =
  | { ok: true; payload: MessagesPayload }
  | { ok: false; status: number; retryAfter: string | null; errorBody: string };

/**
 * Converts Retry-After to milliseconds. HTTP allows a number of seconds or an
 * HTTP date. Anthropic sends seconds, and the date form is handled so another
 * Anthropic-compatible host cannot break the retry logic.
 */
function parseRetryAfterMs(header: string | null): number | undefined {
  const value = header?.trim();
  if (!value) return undefined;
  if (/^\d+(\.\d+)?$/.test(value)) return Math.ceil(Number(value) * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

/**
 * How long to wait before retry number `retry` (0-based), or `undefined` when
 * the failure should not be retried. Only 429 and 5xx are retried. A 4xx such
 * as a bad key or a malformed request fails the same way every time.
 */
function retryDelayMs(outcome: { status: number; retryAfter: string | null }, retry: number): number | undefined {
  const retryable = outcome.status === 429 || (outcome.status >= 500 && outcome.status <= 599);
  if (!retryable || retry >= MAX_RETRIES) return undefined;
  const asked = parseRetryAfterMs(outcome.retryAfter);
  if (asked === undefined) return BACKOFF_BASE_MS * 2 ** retry;
  return asked <= MAX_RETRY_AFTER_MS ? asked : undefined;
}

/**
 * Names the fields a schema rejected, without their values. The values are
 * model output, which can echo prospect text, so they stay out of error
 * messages that end up in logs.
 */
function describeSchemaFailure(error: unknown): string {
  const issues = (error as { issues?: Array<{ path?: Array<string | number> }> } | null)?.issues;
  if (!Array.isArray(issues) || issues.length === 0) return "";
  const paths = [...new Set(issues.map((issue) => (issue.path?.length ? issue.path.join(".") : "(root)")))];
  return ` (${paths.slice(0, 5).join(", ")})`;
}

/**
 * A provider speaking the Anthropic Messages protocol.
 *
 * The protocol is not exclusive to Anthropic: QwenCloud serves a documented
 * Anthropic-compatible Messages endpoint, accepting the same `x-api-key` header
 * and the same `system` + `messages` body. So the base URL, the display name
 * and the model-id normaliser are constructor options, and `QwenProvider` is
 * this class pointed elsewhere rather than a copy of its four request methods.
 *
 * Defaults are unchanged - existing Anthropic callers behave exactly as before.
 */
export class AnthropicProvider implements AIProvider {
  name: AiProviderName = "anthropic";
  model: string;
  protected apiKey?: string;
  protected baseUrl: string;
  /** Vendor name in error messages, so a failure names the right service. */
  protected label = "Anthropic";

  constructor(options?: { apiKey?: string; model?: string; baseUrl?: string }) {
    this.apiKey = options?.apiKey ?? process.env.ANTHROPIC_API_KEY;
    this.model = normalizeAnthropicModel(options?.model ?? process.env.ANTHROPIC_MODEL);
    this.baseUrl = options?.baseUrl ?? "https://api.anthropic.com";
  }

  /**
   * The base URL must not already carry `/v1`: Alibaba's documentation warns
   * that `/apps/anthropic/v1/` produces a duplicated `/v1/v1/` path and a 404.
   */
  protected get endpoint() {
    return `${this.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "")}/v1/messages`;
  }

  /**
   * Extra body parameters merged into every request.
   *
   * Empty for Anthropic itself; `QwenProvider` uses it to turn off a reasoning
   * mode that this pipeline pays for and then discards.
   */
  protected extraBody(): Record<string, unknown> {
    return {};
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  async generateStructuredResearch(input: ResearchInput): Promise<ResearchProviderResult> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "x-api-key": String(this.apiKey),
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...this.extraBody(),
        model: this.model,
        max_tokens: 1800,
        temperature: 0.2,
        system: getResearchSystemPrompt(input.settings),
        messages: [{ role: "user", content: buildResearchUserPrompt(input) }]
      })
    });

    if (!response.ok) throw new Error(`${this.label} research request failed: ${response.status} ${await response.text()}`);
    const payload = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = payload.content?.find((item) => item.type === "text")?.text;
    if (!text) throw new Error(`${this.label} returned no structured content.`);
    const output = parseResearchJson(text);
    return {
      provider: this.name,
      model: this.model,
      output,
      rawOutput: payload,
      estimatedInputTokens: payload.usage?.input_tokens,
      estimatedOutputTokens: payload.usage?.output_tokens
    };
  }

  async generateStructuredOutreach(input: OutreachInput): Promise<OutreachProviderResult> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "x-api-key": String(this.apiKey),
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...this.extraBody(),
        model: this.model,
        max_tokens: 2200,
        temperature: 0.3,
        system: getOutreachSystemPrompt(input.settings),
        messages: [{ role: "user", content: buildOutreachUserPrompt(input) }]
      })
    });
    if (!response.ok) throw new Error(`${this.label} outreach request failed: ${response.status} ${await response.text()}`);
    const payload = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = payload.content?.find((item) => item.type === "text")?.text;
    if (!text) throw new Error(`${this.label} returned no outreach content.`);
    const output = parseOutreachJson(text);
    return {
      provider: this.name,
      model: this.model,
      output,
      rawOutput: payload,
      estimatedInputTokens: payload.usage?.input_tokens,
      estimatedOutputTokens: payload.usage?.output_tokens
    };
  }

  async classifyReply(input: ReplyClassificationInput): Promise<ReplyClassificationProviderResult> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "x-api-key": String(this.apiKey),
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...this.extraBody(),
        model: this.model,
        max_tokens: 1000,
        temperature: 0.1,
        system: getReplyClassifierSystemPrompt(),
        messages: [{ role: "user", content: buildReplyClassifierUserPrompt(input) }]
      })
    });

    if (!response.ok) throw new Error(`${this.label} classifyReply request failed: ${response.status} ${await response.text()}`);
    const payload = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = payload.content?.find((item) => item.type === "text")?.text;
    if (!text) throw new Error(`${this.label} returned no reply classification content.`);
    const output = parseReplyClassificationJson(text);
    return {
      provider: this.name,
      model: this.model,
      output,
      rawOutput: payload,
      estimatedInputTokens: payload.usage?.input_tokens,
      estimatedOutputTokens: payload.usage?.output_tokens
    };
  }

  async generateReply(input: ReplyGenerationInput): Promise<ReplyGenerationProviderResult> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "x-api-key": String(this.apiKey),
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...this.extraBody(),
        model: this.model,
        max_tokens: 1500,
        temperature: 0.2,
        system: getReplyGeneratorSystemPrompt(),
        messages: [{ role: "user", content: buildReplyGeneratorUserPrompt(input) }]
      })
    });

    if (!response.ok) throw new Error(`${this.label} generateReply request failed: ${response.status} ${await response.text()}`);
    const payload = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = payload.content?.find((item) => item.type === "text")?.text;
    if (!text) throw new Error(`${this.label} returned no reply generation content.`);
    const output = parseReplyDraftJson(text);
    return {
      provider: this.name,
      model: this.model,
      output,
      rawOutput: payload,
      estimatedInputTokens: payload.usage?.input_tokens,
      estimatedOutputTokens: payload.usage?.output_tokens
    };
  }

  /**
   * Sends the caller's prompts and returns their JSON once `input.schema` has
   * accepted it. `QwenProvider` inherits this along with its endpoint and
   * `extraBody`, so it needs no code of its own.
   *
   * Any failure throws: transport, a non-JSON reply, or a schema mismatch.
   * Nothing here invents a fallback output, because a structured call feeds
   * decisions (what the prospect said, what to send back), and a made-up answer
   * there is worse than none.
   */
  async generateStructured<T>(input: StructuredCallInput<T>): Promise<StructuredCallResult<T>> {
    const { text, payload } = await this.postMessages({
      operation: input.operation,
      system: input.system,
      user: input.user,
      maxTokens: input.maxTokens ?? DEFAULT_STRUCTURED_MAX_TOKENS,
      temperature: input.temperature ?? DEFAULT_STRUCTURED_TEMPERATURE,
      timeoutMs: input.timeoutMs
    });

    let data: unknown;
    try {
      data = JSON.parse(extractFirstJsonObject(text));
    } catch (error) {
      // A reply cut off at max_tokens is the usual cause, and it tells the
      // caller which knob to turn.
      const truncated = payload.stop_reason === "max_tokens" ? " (the reply was cut off at max_tokens)" : "";
      throw new Error(`${this.label} ${input.operation} returned invalid JSON${truncated}.`, { cause: error });
    }

    let output: T;
    try {
      output = input.schema.parse(data);
    } catch (error) {
      throw new Error(`${this.label} ${input.operation} output does not match its schema${describeSchemaFailure(error)}.`, {
        cause: error
      });
    }

    return {
      provider: this.name,
      model: this.model,
      output,
      rawOutput: payload,
      estimatedInputTokens: payload.usage?.input_tokens,
      estimatedOutputTokens: payload.usage?.output_tokens
    };
  }

  /**
   * One Messages API call with a timeout and retries. The four methods above
   * predate it and still make their own unbounded calls. Moving them onto this
   * is a separate change, kept out so their behaviour does not shift here.
   *
   * Retries cover 429 and 5xx (including Anthropic's 529 "overloaded"). They
   * honour Retry-After, or else wait 1 s / 2 s / 4 s. A timeout is not retried:
   * a host that stalled for the whole bound is unlikely to answer the next
   * attempt quickly, and four stalls in a row would hold an operator's prompt
   * for a minute.
   */
  protected async postMessages(request: {
    operation: string;
    system: string;
    user: string;
    maxTokens: number;
    temperature: number;
    timeoutMs?: number;
  }): Promise<{ text: string; payload: MessagesPayload }> {
    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const body = JSON.stringify({
      ...this.extraBody(),
      model: this.model,
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      system: request.system,
      messages: [{ role: "user", content: request.user }]
    });

    for (let retry = 0; ; retry += 1) {
      const outcome = await this.attemptMessages(body, request.operation, timeoutMs);
      if (outcome.ok) {
        const text = outcome.payload.content?.find((item) => item.type === "text")?.text;
        if (!text) throw new Error(`${this.label} returned no ${request.operation} content.`);
        return { text, payload: outcome.payload };
      }

      const delayMs = retryDelayMs(outcome, retry);
      if (delayMs === undefined) {
        throw new Error(
          `${this.label} ${request.operation} request failed: ${outcome.status} ${outcome.errorBody.slice(0, ERROR_BODY_EXCERPT)}`
        );
      }
      await this.sleep(delayMs);
    }
  }

  /**
   * Waits between retries. Kept as a method so tests can check the delays
   * without sleeping through them.
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * One HTTP attempt. Each attempt gets its own timeout signal, so a retry
   * after a 429 gets the full time bound again. The signal covers reading the
   * body as well as the headers.
   */
  private async attemptMessages(body: string, operation: string, timeoutMs: number): Promise<AttemptOutcome> {
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "x-api-key": String(this.apiKey),
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json"
        },
        body,
        signal
      });
      if (response.ok) return { ok: true, payload: (await response.json()) as MessagesPayload };
      return {
        ok: false,
        status: response.status,
        retryAfter: response.headers.get("retry-after"),
        errorBody: await response.text()
      };
    } catch (error) {
      // The timeout is reported as a timeout rather than as an AbortError, so
      // the operator does not have to work out what was aborted. Other network
      // failures (DNS, connection reset) are thrown unchanged.
      if (signal.aborted) {
        throw new Error(`${this.label} ${operation} request timed out after ${timeoutMs} ms.`, { cause: error });
      }
      throw error;
    }
  }
}

