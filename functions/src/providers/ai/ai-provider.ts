import type { ResearchOutput } from "../../services/research-schema.js";
import type { OutreachOutput } from "../../services/outreach-schema.js";
import type { GlobalSettings } from "../../utils/settings.js";

export type AiProviderName = "openai" | "anthropic" | "mock";

export type ResearchInput = {
  company: Record<string, unknown>;
  websiteText?: string;
  devcommContext: string;
  promptVersion: string;
  settings: GlobalSettings;
};

export type ResearchProviderResult = {
  provider: AiProviderName;
  model: string;
  output: ResearchOutput;
  rawOutput: unknown;
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
  estimatedCost?: number;
};

export type OutreachInput = {
  company: Record<string, unknown>;
  contact?: Record<string, unknown>;
  research: Record<string, unknown>;
  campaign?: Record<string, unknown>;
  devcommContext: string;
  promptVersion: string;
  settings: GlobalSettings;
};

export type OutreachProviderResult = {
  provider: AiProviderName;
  model: string;
  output: OutreachOutput;
  rawOutput: unknown;
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
  estimatedCost?: number;
};

export interface AIProvider {
  name: AiProviderName;
  model: string;
  isConfigured(): boolean;
  generateStructuredResearch(input: ResearchInput): Promise<ResearchProviderResult>;
  generateStructuredOutreach(input: OutreachInput): Promise<OutreachProviderResult>;
}
