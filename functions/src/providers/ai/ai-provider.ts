import type { ResearchOutput } from "../../services/research-schema.js";
import type { OutreachOutput } from "../../services/outreach-schema.js";
import type { ReplyClassificationOutput } from "../../services/reply-classifier-schema.js";
import type { GlobalSettings } from "../../utils/settings.js";

export type AiProviderName = "openai" | "anthropic" | "qwen" | "mock";

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

/**
 * A generic call: a system and a user prompt in, schema-checked JSON out.
 *
 * The four methods below hard-wire their own prompt builders and parsers, so a
 * new AI task had to squeeze through one of them (social DMs went through the
 * outreach parser and its required `body`) or copy the raw HTTP code. Here the
 * caller owns both prompts and the schema. The caller must already have wrapped
 * any untrusted prospect text in `<untrusted_prospect_content>`: the provider
 * sends `user` exactly as given.
 */
export type StructuredCallInput<T> = {
  /** Names the task in spend records, errors and mock fixtures, e.g. "social_thread_extract". */
  operation: string;
  system: string;
  user: string;
  /** Any zod schema satisfies this. Model text reaches the caller only after this parse. */
  schema: { parse(data: unknown): T };
  maxTokens?: number;
  temperature?: number;
  /** Bound on each HTTP attempt, not on the whole call with its retries. */
  timeoutMs?: number;
};

export type StructuredCallResult<T> = {
  provider: AiProviderName | string;
  model: string;
  output: T;
  rawOutput: unknown;
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
};

export interface AIProvider {
  name: AiProviderName;
  model: string;
  isConfigured(): boolean;
  generateStructuredResearch(input: ResearchInput): Promise<ResearchProviderResult>;
  generateStructuredOutreach(input: OutreachInput): Promise<OutreachProviderResult>;
  classifyReply?(input: ReplyClassificationInput): Promise<ReplyClassificationProviderResult>;
  generateReply?(input: ReplyGenerationInput): Promise<ReplyGenerationProviderResult>;
  /**
   * Optional, like the reply methods, so `OpenAIProvider` compiles without it.
   * Callers go through `runStructuredAiCall`, which reports a provider without
   * it as `AiUnavailableError` rather than falling back to something weaker.
   */
  generateStructured?<T>(input: StructuredCallInput<T>): Promise<StructuredCallResult<T>>;
}

