/**
 * The runner's only door into the SDR backend (compiled functions/lib).
 *
 * Every Firestore read and write, every gate, quota, log and AI call happens
 * in those services, exactly as it would in Cloud Functions; the runner only
 * drives the browser and the keyboard. Keeping all calls in this one file
 * makes the boundary auditable: the session machines receive this module as
 * `ctx.sdr` and tests replace it with a plain object.
 *
 * Importing it binds firebase-admin to devcomm-os (bootstrap.mjs), so the
 * CLI imports it only after its arguments are checked, and tests never do.
 */
import { lib } from "./bootstrap.mjs";
import { aiProviderProblem, lacksPendingState, pendingStateFromConversation } from "./pending-state.mjs";

function load(rel) {
  try {
    return lib(rel);
  } catch (error) {
    throw new Error(
      `Module SDR introuvable ou invalide (${rel}) : lance « npm run --prefix functions build » puis réessaie. (${String(error.message).split("\n")[0]})`
    );
  }
}

const sessions = () => load("services/social/social-session-service.js");
const inbound = () => load("services/social/social-inbound.js");
const gate = () => load("services/social/social-gate.js");
const quota = () => load("services/daily-quota.js");
const ai = () => load("services/ai-structured-call.js");
const businesses = () => load("services/business-service.js");
const firestore = () => load("config/firebase.js").adminDb;

// ── Session setup ────────────────────────────────────────────────────────────

/**
 * The business's display name and its own social accounts (checked against
 * the account the browser window acts as), or null when it does not exist in
 * this workspace.
 */
export async function describeBusiness(workspaceId, businessId) {
  const business = await businesses().getBusiness(workspaceId, businessId);
  return business ? { id: business.id, name: business.name, socialAccounts: business.socialAccounts ?? {} } : null;
}

/**
 * Refuses to run the inbox on a model that cannot serve it: the mock (with no
 * key configured the provider factory silently returns canned text, which an
 * operator could then send to a prospect with one key), or a provider without
 * structured calls (every thread would fail).
 */
export async function assertRealAi() {
  const provider = await ai().getActiveAiProvider();
  const problem = aiProviderProblem(provider);
  if (problem) throw new Error(problem);
  return provider;
}

export const getSocialLimits = (workspaceId, businessId, network) => sessions().getSocialLimits(workspaceId, businessId, network);
export const getSocialDmUsage = (workspaceId, businessId, network) => quota().getSocialDmUsage({ workspaceId, businessId }, network);
export const startSocialSession = (input) => sessions().startSocialSession(input);
export const endSocialSession = (input) => sessions().endSocialSession(input);
export const reportSessionBlocked = (input) => sessions().reportSessionBlocked(input);
/** Whether a session may send without a key per message right now (pause, safe mode, recent block). */
export const checkAutoSend = (input) => sessions().checkAutoSend(input);

// ── First DMs ────────────────────────────────────────────────────────────────

export const listSocialDmQueue = (input) => sessions().listSocialDmQueue(input);

/**
 * The gate right before a first DM, plus the draft's text as stored NOW
 * (`body`), so an edit saved on the web during the session is what gets
 * typed. Read here when the backend verdict does not carry it.
 */
export async function checkBeforeSend(input) {
  const verdict = await sessions().checkBeforeSend(input);
  if (!verdict?.allowed) return verdict;
  // The text and its review are read together: a draft rewritten or edited
  // since the session listed it is shown with ITS warnings, not the old ones.
  const data = (await firestore().collection("outreach").doc(input.outreachId).get()).data() ?? {};
  const stored = typeof data.generatedBody === "string" && data.generatedBody.trim() ? data.generatedBody : undefined;
  const body = typeof verdict.body === "string" ? verdict.body : typeof verdict.generatedBody === "string" ? verdict.generatedBody : stored;
  const review = {
    pricingGuardrailPassed: data.pricingGuardrailPassed,
    mentionsCommercialTerms: data.mentionsCommercialTerms,
    warnings: Array.isArray(data.riskWarnings) ? data.riskWarnings : [],
    // Whether this text may leave without a person reading it (an automatic
    // session): decided by the SDR on the same snapshot as the text above.
    // Asked only by a session that needs it; an error is a refusal.
    ...(input.forAutoSend
      ? { autoSend: await sessions().autoSendVerdict(data).catch(() => ({ allowed: false, reason: "claims_not_checkable" })) }
      : {})
  };
  return { ...verdict, ...(body ? { body } : {}), review };
}
export const reserveSendSlot = (input) => sessions().reserveSendSlot(input);
export const recordSocialDmSent = (input) => sessions().recordSocialDmSent(input);
export const recordSocialDmSkipped = (input) => sessions().recordSocialDmSkipped(input);
/** An automatic session leaves this draft to a person (its conversation is not new): it stays in the queue of a session with keys. */
export const recordSocialDmAutoHeld = (input) => sessions().recordSocialDmAutoHeld(input);

// ── Replies ──────────────────────────────────────────────────────────────────

/**
 * The tracked conversations, each with what it still waits for from the
 * operator (`pendingDraft`, `escalated`). Read from the conversation when the
 * backend list does not carry it.
 */
export async function listSocialConversations(input) {
  const refs = await inbound().listSocialConversations(input);
  return Promise.all(
    refs.map(async (ref) => {
      if (!lacksPendingState(ref)) return ref;
      const snap = await firestore().collection("conversations").doc(ref.conversationId).get();
      const data = snap.data() ?? {};
      // Only this business's own conversation is read into the session.
      if (data.workspaceId !== input.workspaceId || data.businessId !== input.businessId) return { ...ref, pendingDraft: null, escalated: null };
      return { ...ref, ...pendingStateFromConversation(data) };
    })
  );
}
export const extractThreadMessages = (input) => inbound().extractThreadMessages(input);
export const newProspectMessages = (input) => inbound().newProspectMessages(input);
export const ingestSocialInbound = (input) => inbound().ingestSocialInbound(input);
export const regenerateSocialDraft = (conversationId) => inbound().regenerateSocialDraft(conversationId);
export const recordSocialReplySent = (input) => inbound().recordSocialReplySent(input);
export const checkBeforeSocialReply = (input) => inbound().checkBeforeSocialReply(input);
export const reportUnmatchedSocialThreads = (input) => inbound().reportUnmatchedSocialThreads(input);
export const canContactSocial = (input) => gate().canContactSocial(input);
