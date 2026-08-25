import type { GlobalSettings } from "../../utils/settings.js";
import type { AiSecrets } from "../../utils/settings.js";
import type { AIProvider } from "./ai-provider.js";
import { AnthropicProvider } from "./anthropic-provider.js";
import { MockAIProvider } from "./mock-ai-provider.js";
import { OpenAIProvider } from "./openai-provider.js";

export function getResearchProvider(settings: GlobalSettings, secrets: AiSecrets = {}): AIProvider {
  const openAiOptions = {
    apiKey: process.env.OPENAI_API_KEY ?? secrets.openAiApiKey,
    model: settings.openAiModel ?? process.env.OPENAI_MODEL
  };
  const anthropicOptions = {
    apiKey: process.env.ANTHROPIC_API_KEY ?? secrets.anthropicApiKey,
    model: settings.anthropicModel ?? process.env.ANTHROPIC_MODEL
  };
  const preferred = settings.aiProvider === "anthropic" ? new AnthropicProvider(anthropicOptions) : new OpenAIProvider(openAiOptions);
  if (preferred.isConfigured()) return preferred;
  const fallback = settings.aiProvider === "anthropic" ? new OpenAIProvider(openAiOptions) : new AnthropicProvider(anthropicOptions);
  if (fallback.isConfigured()) return fallback;
  return new MockAIProvider();
}
