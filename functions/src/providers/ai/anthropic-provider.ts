import type { AIProvider, OutreachInput, OutreachProviderResult, ReplyClassificationInput, ReplyClassificationProviderResult, ReplyGenerationInput, ReplyGenerationProviderResult, ResearchInput, ResearchProviderResult } from "./ai-provider.js";
import { buildResearchUserPrompt, getResearchSystemPrompt } from "../../services/research-prompts.js";
import { parseResearchJson } from "../../services/research-schema.js";
import { buildOutreachUserPrompt, getOutreachSystemPrompt } from "../../services/outreach-prompts.js";
import { parseOutreachJson } from "../../services/outreach-schema.js";
import { buildReplyClassifierUserPrompt, getReplyClassifierSystemPrompt } from "../../services/reply-classifier-prompts.js";
import { parseReplyClassificationJson } from "../../services/reply-classifier-schema.js";
import { buildReplyGeneratorUserPrompt, getReplyGeneratorSystemPrompt } from "../../services/reply-generator-prompts.js";
import { parseReplyDraftJson } from "../../services/reply-generator-schema.js";

const DEFAULT_ANTHROPIC_MODEL = "claude-3-5-haiku-20241022";
const ANTHROPIC_MODEL_ALIASES: Record<string, string> = {
  "claude-3-haiku-20240307": "claude-3-haiku-20240307",
  "claude-3-5-haiku-20241022": "claude-3-5-haiku-20241022",
  "claude-3-5-haiku-latest": "claude-3-5-haiku-20241022",
  "claude-3-5-sonnet-20240620": "claude-3-5-sonnet-20240620",
  "claude-3-5-sonnet-20241022": "claude-3-5-sonnet-20241022",
  "claude-3-5-sonnet-latest": "claude-3-5-sonnet-20241022",
  "claude-3-7-sonnet-20250219": "claude-3-7-sonnet-20250219",
  "claude-3-7-sonnet-latest": "claude-3-7-sonnet-20250219",
  "claude-sonnet-4-20250514": "claude-3-5-sonnet-20241022"
};

function normalizeAnthropicModel(model?: string) {
  const trimmed = model?.trim();
  if (!trimmed) return DEFAULT_ANTHROPIC_MODEL;
  return ANTHROPIC_MODEL_ALIASES[trimmed] ?? trimmed;
}

export class AnthropicProvider implements AIProvider {
  name = "anthropic" as const;
  model: string;
  private apiKey?: string;

  constructor(options?: { apiKey?: string; model?: string }) {
    this.apiKey = options?.apiKey ?? process.env.ANTHROPIC_API_KEY;
    this.model = normalizeAnthropicModel(options?.model ?? process.env.ANTHROPIC_MODEL);
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  async generateStructuredResearch(input: ResearchInput): Promise<ResearchProviderResult> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": String(this.apiKey),
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1800,
        temperature: 0.2,
        system: getResearchSystemPrompt(input.settings),
        messages: [{ role: "user", content: buildResearchUserPrompt(input) }]
      })
    });

    if (!response.ok) throw new Error(`Anthropic research request failed: ${response.status} ${await response.text()}`);
    const payload = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = payload.content?.find((item) => item.type === "text")?.text;
    if (!text) throw new Error("Anthropic returned no structured content.");
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
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": String(this.apiKey),
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 2200,
        temperature: 0.3,
        system: getOutreachSystemPrompt(input.settings),
        messages: [{ role: "user", content: buildOutreachUserPrompt(input) }]
      })
    });
    if (!response.ok) throw new Error(`Anthropic outreach request failed: ${response.status} ${await response.text()}`);
    const payload = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = payload.content?.find((item) => item.type === "text")?.text;
    if (!text) throw new Error("Anthropic returned no outreach content.");
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
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": String(this.apiKey),
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1000,
        temperature: 0.1,
        system: getReplyClassifierSystemPrompt(),
        messages: [{ role: "user", content: buildReplyClassifierUserPrompt(input) }]
      })
    });

    if (!response.ok) throw new Error(`Anthropic classifyReply request failed: ${response.status} ${await response.text()}`);
    const payload = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = payload.content?.find((item) => item.type === "text")?.text;
    if (!text) throw new Error("Anthropic returned no reply classification content.");
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
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": String(this.apiKey),
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1500,
        temperature: 0.2,
        system: getReplyGeneratorSystemPrompt(),
        messages: [{ role: "user", content: buildReplyGeneratorUserPrompt(input) }]
      })
    });

    if (!response.ok) throw new Error(`Anthropic generateReply request failed: ${response.status} ${await response.text()}`);
    const payload = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = payload.content?.find((item) => item.type === "text")?.text;
    if (!text) throw new Error("Anthropic returned no reply generation content.");
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
}

