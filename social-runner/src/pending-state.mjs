/**
 * What a tracked conversation is still waiting for from the operator, and
 * whether the active AI model can serve the inbox.
 *
 * PURE, so tests reach it (sdr.mjs, which uses it, binds the real backend and
 * is never imported by tests).
 *
 * A reply drafted in an earlier sweep (skipped with S, Q, Ctrl+C, a crash) or
 * a thread escalated to the operator has no NEW prospect message: its
 * messages are already routed. Without this state the next sweep said
 * "Rien de nouveau" and the reply could never be sent from a session, while
 * the Inbox told the owner to send it from there.
 */

/** Reply drafts nobody has sent yet (functions: PENDING_DRAFT_STATUSES). */
const PENDING_DRAFT_STATUSES = new Set(["draft", "queued_for_approval"]);

function reviewFields(draft) {
  return {
    bodyText: String(draft.bodyText).trim(),
    ...(typeof draft.pricingGuardrailPassed === "boolean" ? { pricingGuardrailPassed: draft.pricingGuardrailPassed } : {}),
    ...(typeof draft.mentionsCommercialTerms === "boolean" ? { mentionsCommercialTerms: draft.mentionsCommercialTerms } : {}),
    warnings: Array.isArray(draft.warnings) ? draft.warnings.map(String) : Array.isArray(draft.riskWarnings) ? draft.riskWarnings.map(String) : []
  };
}

/**
 * From a stored conversation document: the reply waiting to be sent from a
 * session, and the escalation waiting for a hand-written answer.
 *
 * @returns {{ pendingDraft: null | { bodyText: string, pricingGuardrailPassed?: boolean, mentionsCommercialTerms?: boolean, warnings: string[] },
 *   escalated: null | { reason?: string } }}
 */
export function pendingStateFromConversation(doc) {
  const conversation = doc ?? {};
  const draft = conversation.draftResponse;
  const pendingDraft =
    conversation.pendingSessionSend === true &&
    draft &&
    PENDING_DRAFT_STATUSES.has(draft.status) &&
    typeof draft.bodyText === "string" &&
    draft.bodyText.trim()
      ? reviewFields(draft)
      : null;
  const escalated =
    !pendingDraft && conversation.status === "human_escalated" && conversation.humanAttentionRequired === true
      ? { ...(typeof conversation.escalationReason === "string" && conversation.escalationReason ? { reason: conversation.escalationReason } : {}) }
      : null;
  return { pendingDraft, escalated };
}

/** The pending draft carried on a conversation ref (backend field, or the fallback above). */
export function pendingDraftOf(conversation) {
  const draft = conversation?.pendingDraft;
  return draft && typeof draft.bodyText === "string" && draft.bodyText.trim() ? reviewFields(draft) : null;
}

/** The pending escalation carried on a conversation ref, with its reason when known. */
export function escalationOf(conversation) {
  const value = conversation?.escalated;
  if (!value) return null;
  const reason = typeof value === "object" && typeof value.reason === "string" ? value.reason : conversation.escalationReason;
  return { ...(typeof reason === "string" && reason ? { reason } : {}) };
}

/** True when the ref says nothing about pending work (an older backend): the caller reads the conversation. */
export function lacksPendingState(conversation) {
  return !conversation || (!("pendingDraft" in conversation) && !("escalated" in conversation));
}

/** Providers known to run no structured call (functions: runStructuredAiCall refuses them). */
const NO_STRUCTURED_CALLS = new Set(["openai"]);

/**
 * Why the inbox cannot run on this provider, in French, or null when it can.
 * Uses the backend's own capability flag when it reports one
 * (`supportsStructured`); otherwise refuses the providers known to lack it.
 */
export function aiProviderProblem(provider) {
  if (!provider || provider.isMock) {
    return "Aucun modèle IA réel n'est configuré (clé Qwen ou Anthropic absente) : les réponses seraient des textes factices. Configure la clé dans Réglages, puis relance.";
  }
  const structured = typeof provider.supportsStructured === "boolean" ? provider.supportsStructured : !NO_STRUCTURED_CALLS.has(String(provider.name));
  if (!structured) {
    return `Le fournisseur IA actif (${String(provider.name)}) ne sait pas lire les fils de discussion ni rédiger ces réponses (appels structurés) : choisis Qwen ou Anthropic dans Réglages, puis relance.`;
  }
  return null;
}
