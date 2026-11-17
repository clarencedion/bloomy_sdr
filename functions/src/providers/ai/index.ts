import type { GlobalSettings } from "../../utils/settings.js";
import type { AiSecrets } from "../../utils/settings.js";
import type { AIProvider } from "./ai-provider.js";
import { AnthropicProvider } from "./anthropic-provider.js";
import { MockAIProvider } from "./mock-ai-provider.js";
import { OpenAIProvider } from "./openai-provider.js";
import { QwenProvider } from "./qwen-provider.js";

/**
 * A key from the environment, or `undefined` when the variable is unset or
 * blank. With `??`, an exported-but-empty `QWEN_API_KEY=` beat the key stored
 * in Firestore, left the provider unconfigured and silently fell back to the
 * mock. `getAiSecrets` already treats a blank variable as absent, and this
 * matches it.
 */
function envKey(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

export function getResearchProvider(settings: GlobalSettings, secrets: AiSecrets = {}): AIProvider {
  const build: Record<string, () => AIProvider> = {
    openai: () =>
      new OpenAIProvider({
        apiKey: envKey("OPENAI_API_KEY") ?? secrets.openAiApiKey,
        model: settings.openAiModel ?? process.env.OPENAI_MODEL
      }),
    anthropic: () =>
      new AnthropicProvider({
        apiKey: envKey("ANTHROPIC_API_KEY") ?? secrets.anthropicApiKey,
        model: settings.anthropicModel ?? process.env.ANTHROPIC_MODEL
      }),
    qwen: () =>
      new QwenProvider({
        apiKey: envKey("QWEN_API_KEY") ?? secrets.qwenApiKey,
        model: settings.qwenModel ?? process.env.QWEN_MODEL,
        baseUrl: settings.qwenBaseUrl ?? process.env.QWEN_BASE_URL
      })
  };

  // The chosen provider first, then the others as fallbacks, then mock. A
  // configured key is what makes a provider usable, so an unconfigured choice
  // degrades to one that works rather than failing every company.
  const order = [settings.aiProvider, "anthropic", "openai", "qwen"].filter(
    (name, index, all) => name && all.indexOf(name) === index
  ) as string[];

  for (const name of order) {
    const provider = build[name]?.();
    if (provider?.isConfigured()) return provider;
  }

  return new MockAIProvider();
}

export const getAiProvider = getResearchProvider;

