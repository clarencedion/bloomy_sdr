import type { ResearchOutput } from "../../services/research-schema.js";
import type { OutreachOutput } from "../../services/outreach-schema.js";
import type { ReplyClassificationOutput } from "../../services/reply-classifier-schema.js";
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
  personalizationFacts?: import("../../types/domain.js").PersonalizationFact[];
  offer?: import("../../types/domain.js").OfferDoc | null;
  business?: import("../../types/domain.js").BusinessDoc | null;
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

export type ReplyClassificationInput = {
  subject?: string;
  bodyText: string;
  senderEmail?: string;
  settings: GlobalSettings;
};

export type ReplyClassificationProviderResult = {
  provider: AiProviderName;
  model: string;
  output: ReplyClassificationOutput;
  rawOutput: unknown;
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
  estimatedCost?: number;
};

import type { ReplyDraftOutput } from "../../services/reply-generator-schema.js";
import type { ReplyGenerationPromptInput } from "../../services/reply-generator-prompts.js";

export type ReplyGenerationInput = ReplyGenerationPromptInput & {
  settings: GlobalSettings;
};

export type ReplyGenerationProviderResult = {
  provider: AiProviderName;
  model: string;
  output: ReplyDraftOutput;
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
  classifyReply?(input: ReplyClassificationInput): Promise<ReplyClassificationProviderResult>;
  generateReply?(input: ReplyGenerationInput): Promise<ReplyGenerationProviderResult>;
}

