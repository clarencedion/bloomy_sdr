import type { AIProvider, StructuredCallInput } from "../providers/ai/ai-provider.js";
import { getAiProvider } from "../providers/ai/index.js";
import { getAiSecrets, getGlobalSettings } from "../utils/settings.js";
import { recordAiSpend } from "./cost-guardrail-service.js";

/**
 * Thrown when no real model can serve a structured call.
 *
 * The provider factory never fails: with no key configured it quietly returns
 * `MockAIProvider`. For research that only degrades the output. For a reply to
 * a prospect it would put canned text in front of an operator who can send it
 * with one key. So callers catch this error by type and stop, instead of
 * treating it like a transient failure.
 */
export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

async function resolveProvider(): Promise<AIProvider> {
  const [settings, secrets] = await Promise.all([getGlobalSettings(), getAiSecrets()]);
  return getAiProvider(settings, secrets);
}

/**
 * The provider a structured call would use right now, without any key.
 *
 * Lets a long-running caller, such as the local social runner, refuse at
 * startup when it would be talking to the mock. Otherwise the operator only
 * finds out at the first prospect message.
 */
export async function getActiveAiProvider(): Promise<{ name: string; model: string; isMock: boolean }> {
  const provider = await resolveProvider();
  return { name: provider.name, model: provider.model, isMock: provider.name === "mock" };
}

/**
 * Runs one structured AI call on the active provider and records its spend.
 *
 * The caller owns the prompts and the schema. Any untrusted prospect text must
 * already be inside `<untrusted_prospect_content>` in `input.user`. Provider
 * errors (timeout, exhausted retries, invalid JSON, schema mismatch) are
 * thrown unchanged, so each caller picks its own fail-closed behaviour.
 *
 * `allowMock` exists for offline tests. Production callers leave it unset.
 */
export async function runStructuredAiCall<T>(
  input: StructuredCallInput<T> & { workspaceId?: string; businessId?: string; companyId?: string; allowMock?: boolean }
): Promise<{ output: T; provider: string; model: string }> {
  const provider = await resolveProvider();

  if (provider.name === "mock" && !input.allowMock) {
    throw new AiUnavailableError(
      `No AI provider is configured, so "${input.operation}" cannot run: add a Qwen or Anthropic key in Settings.`
    );
  }
  if (typeof provider.generateStructured !== "function") {
    throw new AiUnavailableError(
      `The ${provider.name} provider cannot run structured calls, so "${input.operation}" cannot run: switch the AI provider to Qwen or Anthropic in Settings.`
    );
  }

  // Only the call itself goes to the provider. The tenant ids are for the
  // spend ledger and have no place in a request to a third party.
  const result = await provider.generateStructured<T>({
    operation: input.operation,
    system: input.system,
    user: input.user,
    schema: input.schema,
    maxTokens: input.maxTokens,
    temperature: input.temperature,
    timeoutMs: input.timeoutMs
  });

  // The model has already answered and been billed. A failed ledger write
  // must not throw that answer away, so it is swallowed here as it is in the
  // reply classifier and generator.
  await recordAiSpend({
    workspaceId: input.workspaceId,
    businessId: input.businessId,
    provider: result.provider,
    model: result.model,
    operation: input.operation,
    companyId: input.companyId,
    usage: { inputTokens: result.estimatedInputTokens, outputTokens: result.estimatedOutputTokens }
  }).catch(() => undefined);

  return { output: result.output, provider: result.provider, model: result.model };
}
