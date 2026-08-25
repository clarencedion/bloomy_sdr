import type { AIProvider, OutreachInput, OutreachProviderResult, ResearchInput, ResearchProviderResult } from "./ai-provider.js";
import { buildResearchUserPrompt, getResearchSystemPrompt } from "../../services/research-prompts.js";
import { parseResearchJson } from "../../services/research-schema.js";
import { buildOutreachUserPrompt, getOutreachSystemPrompt } from "../../services/outreach-prompts.js";
import { parseOutreachJson } from "../../services/outreach-schema.js";

export class OpenAIProvider implements AIProvider {
  name = "openai" as const;
  model: string;
  private apiKey?: string;

  constructor(options?: { apiKey?: string; model?: string }) {
    this.apiKey = options?.apiKey ?? process.env.OPENAI_API_KEY;
    this.model = options?.model ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  async generateStructuredResearch(input: ResearchInput): Promise<ResearchProviderResult> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: getResearchSystemPrompt(input.settings) },
          { role: "user", content: buildResearchUserPrompt(input) }
        ]
      })
    });

    if (!response.ok) throw new Error(`OpenAI research request failed: ${response.status} ${await response.text()}`);
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenAI returned no structured content.");
    const output = parseResearchJson(content);
    return {
      provider: this.name,
      model: this.model,
      output,
      rawOutput: payload,
      estimatedInputTokens: payload.usage?.prompt_tokens,
      estimatedOutputTokens: payload.usage?.completion_tokens
    };
  }

  async generateStructuredOutreach(input: OutreachInput): Promise<OutreachProviderResult> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: getOutreachSystemPrompt(input.settings) },
          { role: "user", content: buildOutreachUserPrompt(input) }
        ]
      })
    });

    if (!response.ok) throw new Error(`OpenAI outreach request failed: ${response.status} ${await response.text()}`);
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenAI returned no outreach content.");
    const output = parseOutreachJson(content);
    return {
      provider: this.name,
      model: this.model,
      output,
      rawOutput: payload,
      estimatedInputTokens: payload.usage?.prompt_tokens,
      estimatedOutputTokens: payload.usage?.completion_tokens
    };
  }
}
