import { Timestamp } from "firebase-admin/firestore";
import { socialProfileTrust } from "./profile-trust.js";
import { adminDb } from "../../config/firebase.js";
import { writeLog } from "../../utils/logger.js";
import type { SocialNetwork, SocialProfileRef } from "../../types/domain.js";
import { getGlobalSettings } from "../../utils/settings.js";
import { getBusiness, getOffer } from "../business-service.js";
import { validateOutreachClaims } from "../claim-validator.js";
import { getValidEvidence } from "../evidence-service.js";
import { reserveSocialDmSlot } from "../daily-quota.js";
import { SOCIAL_DM_LOCKS, canContactSocial, socialDmLockId, type SocialGateVerdict } from "./social-gate.js";
import { knownFigures, unverifiedFigures } from "./dm-figures.js";
import { observationMayLeaveUnread, pickObservation } from "./dm-observations.js";
import { approvedTermsLine } from "../social-dm-terms.js";
import { approvedIntroLine, conversationAutoHoldReason, type SocialDmOpening } from "../social-dm-conversation.js";
import { normaliseSocialHandle, parseSocialProfileUrl, resolveCompanySocialProfiles } from "./social-profile.js";

/**
 * Server side of a local social session (Phase 23).
 *
 * The runner on the owner's Mac drives a visible browser logged into the
 * business's own Instagram or Facebook account. A person presses a key for
 * every message, or starts an automatic session (ADR-024) in which each first
 * DM leaves after a countdown unless they stop it. Everything that decides
 * *whether* a message may go out — the queue, the contactability gate, the
 * daily cap and spacing, whether an automatic session is allowed at all — and
 * everything that records what happened lives here, so the runner holds no
 * policy of its own and the funnel sees every send like any other channel.
 */

export const DEFAULT_SOCIAL_LIMITS: Readonly<{ dailyCap: number; minSpacingSeconds: number }> = Object.freeze({
  dailyCap: 30,
  minSpacingSeconds: 45
});

const SESSIONS = "socialSessions";
/** A draft skipped in a session stays out of the queue for a day, not forever. */
const SKIP_COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** Bounds one queue read; a business never has this many DM drafts waiting. */
const MAX_QUEUE_SCAN = 500;
const MAX_QUEUE_ITEMS = 200;

/**
 * After the network stopped a session (login wall, checkpoint, CAPTCHA,
 * "action blocked"), automatic sending stays off this long on that network:
 * the block is the network's decision, and a program that carries on is how
 * an account is lost. A person can still run a session and look.
 */
export const AUTO_SEND_COOLDOWN_AFTER_BLOCK_MS = 48 * 60 * 60 * 1000;

const NETWORK_LABEL: Record<SocialNetwork, string> = { instagram: "Instagram", facebook: "Facebook" };

/** Prefix of the reason left on a conversation whose send the session did not see go out. */
export const UNCONFIRMED_SEND_REASON_PREFIX = "Envoi non confirmé";

/**
 * Why a conversation needs a person after an unconfirmed send: Enter was
 * pressed but the message never showed up in the thread, so nobody knows
 * whether the prospect got it.
 */
export function unconfirmedSendReason(network: SocialNetwork): string {
  return `${UNCONFIRMED_SEND_REASON_PREFIX} : la session n'a pas vu le message apparaître dans la conversation ${NETWORK_LABEL[network]}. Vérifie dans ${NETWORK_LABEL[network]} qu'il est bien parti.`;
}

/**
 * A draft written by the mock provider is canned text, not a message about
 * this prospect. It is never offered for sending; regenerating it with a real
 * model brings it back.
 */
function writtenByMock(outreach: Record<string, unknown>): boolean {
  return outreach.aiProvider === "mock";
}

/** The runner is plain JavaScript, so the network is checked at runtime too. */
function assertNetwork(network: unknown): asserts network is SocialNetwork {
  if (network !== "instagram" && network !== "facebook") {
    throw new Error(`Unknown social network: ${String(network)}.`);
  }
}

function millisOf(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  const millis = (value as { toMillis?: () => unknown } | null)?.toMillis?.();
  return typeof millis === "number" && Number.isFinite(millis) ? millis : null;
}

function truncate(text: unknown, max: number): string {
  const value = String(text ?? "").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function count(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function configuredLimit(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * The cap and spacing for one network of one business: the business's own
 * settings when they are usable numbers, the defaults otherwise.
 */
export async function getSocialLimits(
  workspaceId: string,
  businessId: string,
  network: SocialNetwork
): Promise<{ dailyCap: number; minSpacingSeconds: number }> {
  assertNetwork(network);
  const business = await getBusiness(workspaceId, businessId);
  const configured = business?.socialLimits?.[network];
  return {
    dailyCap: Math.floor(configuredLimit(configured?.dailyCap) ?? DEFAULT_SOCIAL_LIMITS.dailyCap),
    minSpacingSeconds: configuredLimit(configured?.minSpacingSeconds) ?? DEFAULT_SOCIAL_LIMITS.minSpacingSeconds
  };
}

// ── Sessions ───────────────────────────────────────────────────────────────

export async function startSocialSession(input: {
  workspaceId: string;
  businessId: string;
  network: SocialNetwork;
  mode: "send" | "inbox";
  operator?: string;
  /** A send session that sends without a key per message (ADR-024). */
  auto?: boolean;
}): Promise<{ sessionId: string }> {
  assertNetwork(input.network);
  if (input.mode !== "send" && input.mode !== "inbox") throw new Error(`Unknown session mode: ${String(input.mode)}.`);
  // Messages go out in a business's name; a typo in --business must stop here.
  const business = await getBusiness(input.workspaceId, input.businessId);
  if (!business) throw new Error(`Business ${input.businessId} not found in workspace ${input.workspaceId}.`);

  const ref = adminDb.collection(SESSIONS).doc();
  const now = Timestamp.now();
  const operator = input.operator ? truncate(input.operator, 120) : undefined;
  // Only a send session can be automatic: replies always wait for a person.
  const auto = input.auto === true && input.mode === "send";
  await ref.set({
    id: ref.id,
    workspaceId: input.workspaceId,
    businessId: input.businessId,
    network: input.network,
    mode: input.mode,
    ...(auto ? { auto: true } : {}),
    ...(operator ? { operator } : {}),
    status: "running",
    sent: 0,
    skipped: 0,
    replies: 0,
    startedAt: now,
    createdAt: now,
    updatedAt: now
  });

  // The session exists once its document does; a lost activity entry must not
  // stop the owner from working.
  await writeLog({
    type: "social_session.started",
    level: "info",
    message: `${NETWORK_LABEL[input.network]} session started (${input.mode}${auto ? ", automatic" : ""}).`,
    workspaceId: input.workspaceId,
    businessId: input.businessId,
    metadata: { sessionId: ref.id, channel: input.network, mode: input.mode, operator, ...(auto ? { auto: true } : {}) }
  }).catch(() => undefined);

  return { sessionId: ref.id };
}

/**
 * Stop reasons of an automatic session after which a person must look before
 * another one runs: a send it could not see, a text that did not land as
 * written, a thread check that failed — and an ending nobody planned (an
 * error, a send that could not be recorded, a chat window that went away).
 * The runner's own names (social-runner/src/session-machine.mjs `STOP`); a
 * test on each side pins that they match.
 */
export const AUTO_DOUBT_STOP = /^(auto_unverified_send|auto_typing_mismatch|auto_thread_check|error|record_failed|composer_lost)/;

/**
 * Whether a send session may send first DMs without a key per message (the
 * runner's --auto, ADR-024). Asked when the session starts, before each
 * prospect and again right before each send, so the app's pause switch stops
 * an automatic session at its next message.
 *
 * Refused:
 *  - while the SDR is paused or in safe mode;
 *  - for 48 hours after the network stopped a session of this business on
 *    this network (a blocked session whose date cannot be read counts as now);
 *  - after an automatic session stopped on a doubt (`AUTO_DOUBT_STOP`) or
 *    never recorded its end (a crash, a closed terminal), until a person has
 *    since run a session with keys in which they sent or skipped at least one
 *    message — they see the conversations there. `sessionId` is the session
 *    asking: it is running, not unfinished.
 *
 * Equality filters only (no composite index): a business has a few sessions a
 * day on a network, and they are sorted in memory.
 */
export async function checkAutoSend(input: {
  workspaceId: string;
  businessId: string;
  network: SocialNetwork;
  sessionId?: string;
}): Promise<{
  allowed: boolean;
  reason?: "not_attributed" | "automation_paused" | "test_mode_enabled" | "blocked_recently" | "doubt_stop_unreviewed";
  retryAt?: string;
}> {
  assertNetwork(input.network);
  if (!input.workspaceId || !input.businessId) return { allowed: false, reason: "not_attributed" };

  const settings = await getGlobalSettings();
  if (settings.automationPaused) return { allowed: false, reason: "automation_paused" };
  if (settings.testModeEnabled) return { allowed: false, reason: "test_mode_enabled" };

  const snapshot = await adminDb
    .collection(SESSIONS)
    .where("workspaceId", "==", input.workspaceId)
    .where("businessId", "==", input.businessId)
    .where("network", "==", input.network)
    .get();
  const now = Date.now();
  const sessions = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }) as Record<string, unknown>);

  const latestBlock = sessions
    .filter((session) => session.status === "blocked")
    .reduce((max, session) => Math.max(max, millisOf(session.blockedAt) ?? millisOf(session.updatedAt) ?? now), 0);
  if (latestBlock && now - latestBlock < AUTO_SEND_COOLDOWN_AFTER_BLOCK_MS) {
    return { allowed: false, reason: "blocked_recently", retryAt: new Date(latestBlock + AUTO_SEND_COOLDOWN_AFTER_BLOCK_MS).toISOString() };
  }

  const startedAt = (session: Record<string, unknown>) => millisOf(session.startedAt) ?? millisOf(session.createdAt) ?? now;
  const sends = sessions.filter((session) => session.mode === "send");
  const inDoubt = (session: Record<string, unknown>) =>
    session.auto === true &&
    session.id !== input.sessionId &&
    (AUTO_DOUBT_STOP.test(String(session.stoppedReason ?? "")) || !session.endedAt);
  const latestDoubt = sends.filter(inDoubt).reduce((max, session) => Math.max(max, startedAt(session)), 0);
  if (latestDoubt) {
    const reviewedSince = sends.some(
      (session) =>
        session.auto !== true &&
        Boolean(session.endedAt) &&
        startedAt(session) > latestDoubt &&
        count(session.sent) + count(session.skipped) > 0
    );
    if (!reviewedSince) return { allowed: false, reason: "doubt_stop_unreviewed" };
  }
  return { allowed: true };
}

/**
 * Why a DM draft may not be sent by an automatic session — nobody reads it
 * before it leaves — or undefined when its stored state allows it. Pure.
 *
 * Beyond "its checks ran, passed and left no warning", the commercial terms
 * must have been written by code — or there must be none:
 *  - the offer's own terms line, placed by `composeSocialDm` as a paragraph
 *    of its own, still in the text exactly once; or
 *  - a conversation-style draft (ADR-025): the sender's introduction still in
 *    the text exactly once, and no commercial vocabulary anywhere in it.
 * A draft whose terms the model wrote (an offer without a terms line: the
 * `social-dm-v1` path, checked by a heuristic only) always waits for a
 * person. So does a draft an automatic session already left to a person
 * (`autoHeldAt`: its conversation was not new).
 */
export function autoSendHoldReason(outreach: Record<string, unknown>): string | undefined {
  if (outreach.channel !== "social_dm") return "not_a_social_dm";
  if (outreach.autoHeldAt) return "left_for_person";
  if (outreach.pricingGuardrailPassed !== true) return "checks_not_passed";
  // "No warning" must have been recorded: a draft without the field was never reviewed.
  if (!Array.isArray(outreach.riskWarnings)) return "checks_not_passed";
  if (outreach.riskWarnings.length > 0) return "has_warnings";
  const body = String(outreach.generatedBody ?? "");
  const line = typeof outreach.offerTermsLine === "string" ? outreach.offerTermsLine.trim() : "";
  const intro = typeof outreach.dmIntroLine === "string" ? outreach.dmIntroLine.trim() : "";
  const observation = typeof outreach.dmObservationLine === "string" ? outreach.dmObservationLine.trim() : "";
  if (!line) {
    // A conversation-style draft states no term at all, so there is no terms
    // line to find: its text is read again here instead, whatever its stored
    // review says (social-dm-conversation.ts). Any other draft without a
    // terms line had its terms written by the model.
    if (!intro) return "terms_not_written_by_code";
    if (outreach.dmIntroLineIntact === false) return "intro_line_not_intact";
    return conversationAutoHoldReason(body, intro, observation || undefined);
  }
  // One style or the other: a draft carrying the sentences of both was made
  // by neither generator, and each path would skip the other's checks.
  if (intro || observation) return "both_code_lines";
  if (outreach.offerTermsLineIntact === false) return "terms_line_not_intact";
  const paragraphs = body.split(/\n\s*\n/).map((paragraph) => paragraph.trim());
  if (body.split(line).length !== 2 || paragraphs.filter((paragraph) => paragraph === line).length !== 1) return "terms_line_not_intact";
  return undefined;
}

const lineOf = (outreach: Record<string, unknown>, key: string): string => {
  const value = outreach[key];
  return typeof value === "string" ? value.trim() : "";
};

/** French, for the draft and the terminal: why an automatic session leaves a text to a person. */
export function describeAutoHold(verdict: { reason?: string; detail?: string }): string {
  const why: Record<string, string> = {
    unsupported_claim: "affirmation que les faits vérifiés ne portent pas",
    unverified_figure: "chiffre qu'aucun fait vérifié ne porte",
    states_commercial_terms: "vocabulaire commercial",
    speaks_of_online_presence: "parle de leur présence en ligne",
    intro_line_not_intact: "phrase de présentation modifiée ou retirée",
    intro_line_not_current: "la phrase de présentation n'est plus celle de l'entreprise (réécrivez le brouillon)",
    observation_line_not_intact: "phrase d'observation modifiée, déplacée ou retirée",
    observation_not_current: "les faits vérifiés ne disent plus ce que la phrase d'observation affirme (réécrivez le brouillon)",
    observation_needs_person: "la phrase d'observation vient d'un indice automatique peu sûr : vérifiez-la sur leur site avant d'envoyer",
    model_part_missing: "il manque l'accroche ou la question",
    left_for_person: "une session automatique l'a laissé à une personne (conversation déjà entamée)",
    has_warnings: "le brouillon porte un avertissement",
    checks_not_passed: "les contrôles du texte n'ont pas tous réussi",
    terms_not_written_by_code: "les conditions commerciales ont été rédigées par l'IA",
    terms_line_not_intact: "phrase de conditions modifiée ou retirée",
    both_code_lines: "le brouillon mêle les phrases de deux styles",
    not_a_social_dm: "ce n'est pas un message direct",
    terms_line_not_current: "la phrase de conditions n'est plus celle de l'offre (réécrivez le brouillon)",
    claims_not_checkable: "vérifications impossibles (entreprise, offre ou faits illisibles)"
  };
  const reason = why[verdict.reason ?? ""] ?? verdict.reason ?? "refusé";
  return `Ne part pas en automatique : ${reason}${verdict.detail ? ` (${verdict.detail})` : ""}.`;
}

/**
 * The verdict an automatic session needs for one draft: its stored state
 * (`autoSendHoldReason`), then two checks of what the text says about the
 * prospect, both against verified evidence only:
 *  - the second-pass claim validation every outreach text gets (Invariant 5):
 *    reviews, rating, staff, a score, a town, prohibited promises, commercial
 *    terms the offer does not declare;
 *  - every figure the model wrote (the terms line is the offer's, not the
 *    model's) must be one the evidence or the prospect's own record holds,
 *    and no quantity may be spelled in words (dm-figures.ts);
 * Before those, the sentences code put in the draft must be what their source
 * says today (the offer's terms line; the business's intro line and the
 * observation the evidence yields), and — read by `autoSendHoldReason` — a
 * conversation draft's model text says nothing of the prospect's online
 * presence (social/dm-observations.ts).
 * Takes the draft as read by the caller, so the text typed, its review and
 * this verdict all describe one snapshot.
 *
 * Fails closed: a company, offer or evidence that cannot be read holds the draft.
 */
export async function autoSendVerdict(outreach: Record<string, unknown>): Promise<{ allowed: boolean; reason?: string; detail?: string }> {
  const hold = autoSendHoldReason(outreach);
  if (hold) return { allowed: false, reason: hold };

  const companyId = typeof outreach.companyId === "string" ? outreach.companyId : "";
  const workspaceId = typeof outreach.workspaceId === "string" && outreach.workspaceId ? outreach.workspaceId : "ws_default";
  const businessId = typeof outreach.businessId === "string" ? outreach.businessId : "";
  const offerId = typeof outreach.offerId === "string" ? outreach.offerId : "";
  if (!companyId || !businessId || !offerId) return { allowed: false, reason: "claims_not_checkable" };
  try {
    const termsLine = lineOf(outreach, "offerTermsLine");
    const introLine = lineOf(outreach, "dmIntroLine");
    const observationLine = lineOf(outreach, "dmObservationLine");
    // A conversation-style draft (ADR-025) carries the business's intro line
    // and sometimes an observation code wrote from the evidence.
    const conversation = !termsLine;
    const [companySnap, offer, evidenceItems, business] = await Promise.all([
      adminDb.collection("companies").doc(companyId).get(),
      getOffer(workspaceId, businessId, offerId),
      getValidEvidence(companyId),
      conversation ? getBusiness(workspaceId, businessId) : Promise.resolve(null)
    ]);
    if (!companySnap.exists || !offer) return { allowed: false, reason: "claims_not_checkable" };
    const company = companySnap.data() ?? {};

    // The sentences code put in a draft are left out of the checks below, as
    // the business's own words or as a fact code read from the evidence. A
    // draft cannot vouch for that itself (its fields are writable from the
    // app): each sentence must be the one the source says TODAY — the offer's
    // approved terms line, the business's approved intro line, the
    // observation the evidence yields now. A business that changed its line,
    // an offer whose terms moved, a site measured again: the draft waits.
    if (!conversation) {
      if (approvedTermsLine(offer.pricingGuardrails).line !== termsLine) return { allowed: false, reason: "terms_line_not_current" };
    } else {
      const opening = (business as { socialDmOpening?: SocialDmOpening } | null)?.socialDmOpening;
      if (!introLine || approvedIntroLine(opening).line !== introLine) return { allowed: false, reason: "intro_line_not_current" };
      if (observationLine) {
        const current = pickObservation(opening?.observations, evidenceItems, company);
        if (current?.line !== observationLine) return { allowed: false, reason: "observation_not_current" };
        // An observation our own page reader guessed is written for a person to check, never sent unread.
        if (!observationMayLeaveUnread(current.kind)) return { allowed: false, reason: "observation_needs_person" };
      }
    }
    const body = String(outreach.generatedBody ?? "");
    // What is checked as a claim about the prospect: the body without the
    // business's own sentence (its introduction, or its terms line). The
    // observation stays in: it is code's, verified above, and a figure in it
    // must pass the same figure check as any other — twice is not too much.
    const modelText = body.split(conversation ? introLine : termsLine).join(" ");
    // The business's introduction speaks of the business, not of the
    // prospect: it is left out of the claim validation. A terms line stays
    // in — the validator checks it against the offer.
    const claimedText = conversation ? modelText : body;
    const text = (key: string) => (typeof company[key] === "string" ? (company[key] as string) : undefined);
    const number = (key: string) => (typeof company[key] === "number" ? (company[key] as number) : undefined);
    const validate = (checked: string) =>
      validateOutreachClaims({
        sequence: { body: checked },
        company: {
          id: companyId,
          name: text("name"),
          city: text("city"),
          employeeCount: number("employeeCount"),
          establishmentCount: number("establishmentCount"),
          industry: text("industry"),
          domain: text("domain"),
          website: text("website")
        },
        evidenceItems,
        offer
      });
    const claims = validate(claimedText);
    // A promise the offer prohibits is held wherever it stands, the business's own sentence included.
    const promise = claims.prohibitedPromisesDetected[0] ?? (conversation ? validate(body).prohibitedPromisesDetected[0] : undefined);
    const problem = promise ?? claims.unsupportedClaims[0];
    if (problem) return { allowed: false, reason: "unsupported_claim", detail: truncate(problem, 200) };

    const unverified = unverifiedFigures(modelText, knownFigures(evidenceItems, company));
    if (unverified.length) return { allowed: false, reason: "unverified_figure", detail: truncate(unverified.join(", "), 120) };
    return { allowed: true };
  } catch {
    return { allowed: false, reason: "claims_not_checkable" };
  }
}

/** Closes a session with its totals. A second call (exit after Ctrl+C) changes nothing. */
export async function endSocialSession(input: {
  sessionId: string;
  sent: number;
  skipped: number;
  replies: number;
  stoppedReason?: string;
}): Promise<void> {
  const ref = adminDb.collection(SESSIONS).doc(input.sessionId);
  const now = Timestamp.now();
  const totals = { sent: count(input.sent), skipped: count(input.skipped), replies: count(input.replies) };
  const stoppedReason = input.stoppedReason ? truncate(input.stoppedReason, 300) : undefined;

  const session = await adminDb.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) throw new Error("Social session not found.");
    const data = snap.data() ?? {};
    if (data.endedAt) return null;
    transaction.set(
      ref,
      {
        // A session stopped by a blocker stays "blocked": that is what the
        // owner needs to see, not that it ended.
        status: data.status === "blocked" ? "blocked" : "ended",
        endedAt: now,
        ...totals,
        ...(stoppedReason ? { stoppedReason } : {}),
        updatedAt: now
      },
      { merge: true }
    );
    return data;
  });
  if (!session) return;

  await writeLog({
    type: "social_session.ended",
    level: "info",
    message: `${NETWORK_LABEL[session.network as SocialNetwork] ?? "Social"} session ended.`,
    workspaceId: session.workspaceId as string | undefined,
    businessId: session.businessId as string | undefined,
    metadata: { sessionId: input.sessionId, channel: session.network, mode: session.mode, ...totals, stoppedReason }
  }).catch(() => undefined);
}

/**
 * Keeps only the host and first path segment of the page that stopped a
 * session. That is enough to tell a login wall from a checkpoint, while
 * challenge and checkpoint URLs carry one-time tokens in their path and query
 * — and logs are readable by every signed-in user.
 */
function redactBlockedUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const first = url.pathname.split("/").filter(Boolean)[0];
    return `${url.origin}/${first ? `${encodeURIComponent(decodeURIComponent(first))}/` : ""}`;
  } catch {
    return undefined;
  }
}

/**
 * Records that the network put up a login wall, checkpoint, CAPTCHA or rate
 * limit. The runner stops on the spot and never retries; this is what tells
 * the owner why.
 */
export async function reportSessionBlocked(input: {
  sessionId?: string;
  workspaceId: string;
  businessId: string;
  network: SocialNetwork;
  reason: string;
  url?: string;
}): Promise<void> {
  assertNetwork(input.network);
  const now = Timestamp.now();
  const reason = truncate(input.reason, 300) || "unknown";
  const url = redactBlockedUrl(input.url);

  if (input.sessionId) {
    const ref = adminDb.collection(SESSIONS).doc(input.sessionId);
    const snap = await ref.get();
    const data = snap.data();
    // Only this business's own session is marked; an id from elsewhere is
    // never written across tenants.
    if (snap.exists && data?.workspaceId === input.workspaceId && data?.businessId === input.businessId) {
      await ref.set(
        { status: "blocked", blockedReason: reason, ...(url ? { blockedUrl: url } : {}), blockedAt: now, updatedAt: now },
        { merge: true }
      );
    }
  }

  await writeLog({
    type: "outreach.social_dm.session_blocked",
    level: "warning",
    message: `${NETWORK_LABEL[input.network]} session stopped: ${reason}`,
    workspaceId: input.workspaceId,
    businessId: input.businessId,
    metadata: { sessionId: input.sessionId, channel: input.network, reason, url }
  });
}

// ── Queue ──────────────────────────────────────────────────────────────────

export interface SocialQueueItem {
  outreachId: string;
  companyId: string;
  companyName: string;
  network: SocialNetwork;
  profile: SocialProfileRef;
  body: string;
  pricingGuardrailPassed?: boolean;
  mentionsCommercialTerms?: boolean;
  riskWarnings: string[];
}

type OutreachData = Record<string, unknown>;

/** A stored profile is re-parsed, so a bad link written by older code never reaches the browser. */
function profileForNetwork(value: unknown, network: SocialNetwork): SocialProfileRef | undefined {
  const url = (value as { url?: unknown } | null | undefined)?.url ?? value;
  if (typeof url !== "string") return undefined;
  const parsed = parseSocialProfileUrl(url);
  return parsed && parsed.network === network ? { url: parsed.url, handle: parsed.handle } : undefined;
}

/**
 * The profile a draft is sent to on one network: the one stored on the
 * draft, then the single legacy link, then whatever the company has now
 * (drafts written before Phase 23 carry no `socialProfiles`).
 */
async function resolveDraftProfile(outreach: OutreachData, network: SocialNetwork): Promise<SocialProfileRef | undefined> {
  const stored = (outreach.socialProfiles as Record<string, unknown> | undefined)?.[network];
  const fromDraft = profileForNetwork(stored, network) ?? profileForNetwork(outreach.socialProfileUrl, network);
  if (fromDraft) {
    // A draft written before profile-trust.ts may point at a platform's or a
    // directory's account (facebook.com/teamfresha): never offered, whatever
    // the draft says.
    const company =
      typeof outreach.companyId === "string" && outreach.companyId
        ? (await adminDb.collection("companies").doc(outreach.companyId).get()).data() ?? {}
        : {};
    // The company's own resolution vouching for this handle settles it (its
    // listing may name the profile directly); otherwise only a definite
    // platform or directory account is refused here — the uncertain ones are
    // kept out of new drafts by resolveCompanySocialProfiles.
    const vouched = typeof outreach.companyId === "string" && outreach.companyId ? (await resolveCompanySocialProfiles(outreach.companyId))[network] : undefined;
    if (vouched && normaliseSocialHandle(vouched.handle) === normaliseSocialHandle(fromDraft.handle)) return fromDraft;
    const verdict = socialProfileTrust(
      fromDraft,
      { name: typeof company.name === "string" ? company.name : "", website: typeof company.website === "string" ? company.website : "" },
      "scraped"
    );
    return verdict.trust === "rejected" ? undefined : fromDraft;
  }
  if (typeof outreach.companyId !== "string" || !outreach.companyId) return undefined;
  return (await resolveCompanySocialProfiles(outreach.companyId))[network];
}

function recentlySkipped(outreach: OutreachData, now: number): boolean {
  const skippedAt = millisOf(outreach.skippedAt);
  return skippedAt !== null && now - skippedAt < SKIP_COOLDOWN_MS;
}

/**
 * The drafts a session may send on one network, oldest first, each one
 * gate-checked. A refused draft is left out rather than shown: the session
 * must never offer a message it is not allowed to send. The gate runs again
 * right before each send, because time passes between listing and sending.
 */
export async function listSocialDmQueue(input: {
  workspaceId: string;
  businessId: string;
  network: SocialNetwork;
  limit: number;
}): Promise<SocialQueueItem[]> {
  assertNetwork(input.network);
  const limit = Math.min(MAX_QUEUE_ITEMS, Math.floor(Number(input.limit) || 0));
  if (limit <= 0 || !input.businessId) return [];

  // Equality filters only (no composite index); ordered in memory below.
  const snapshot = await adminDb
    .collection("outreach")
    .where("workspaceId", "==", input.workspaceId)
    .where("businessId", "==", input.businessId)
    .where("channel", "==", "social_dm")
    .where("status", "==", "draft")
    .limit(MAX_QUEUE_SCAN)
    .get();

  const now = Date.now();
  const drafts = snapshot.docs
    .map((doc) => ({ id: doc.id, data: doc.data() as OutreachData }))
    .filter(({ data }) => typeof data.companyId === "string" && data.companyId && String(data.generatedBody ?? "").trim())
    .filter(({ data }) => !writtenByMock(data))
    .filter(({ data }) => !recentlySkipped(data, now))
    .sort((a, b) => (millisOf(a.data.createdAt) ?? Infinity) - (millisOf(b.data.createdAt) ?? Infinity));

  const items: SocialQueueItem[] = [];
  const queuedCompanies = new Set<string>();
  const queuedHandles = new Set<string>();
  for (const { id, data } of drafts) {
    if (items.length >= limit) break;
    const companyId = data.companyId as string;
    // One first message per company: a duplicate draft is never offered twice.
    if (queuedCompanies.has(companyId)) continue;

    const profile = await resolveDraftProfile(data, input.network);
    if (!profile) continue;
    // ...and per account: two company documents for one social-only business
    // would otherwise both sit in the same session.
    if (queuedHandles.has(profile.handle)) continue;

    const verdict = await canContactSocial({
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      companyId,
      network: input.network,
      handle: profile.handle,
      purpose: "first_dm"
    });
    if (!verdict.allowed) continue;

    const company = await adminDb.collection("companies").doc(companyId).get();
    queuedCompanies.add(companyId);
    queuedHandles.add(profile.handle);
    items.push({
      outreachId: id,
      companyId,
      companyName: String(company.data()?.name ?? ""),
      network: input.network,
      profile,
      body: String(data.generatedBody).trim(),
      ...(typeof data.pricingGuardrailPassed === "boolean" ? { pricingGuardrailPassed: data.pricingGuardrailPassed } : {}),
      ...(typeof data.mentionsCommercialTerms === "boolean" ? { mentionsCommercialTerms: data.mentionsCommercialTerms } : {}),
      riskWarnings: Array.isArray(data.riskWarnings) ? data.riskWarnings.map(String) : []
    });
  }
  return items;
}

/** The gate again, right before the send key does anything. */
export async function checkBeforeSend(input: { outreachId: string; network: SocialNetwork }): Promise<SocialGateVerdict> {
  assertNetwork(input.network);
  const snap = await adminDb.collection("outreach").doc(input.outreachId).get();
  if (!snap.exists) return { allowed: false, reason: "outreach_not_found" };
  const outreach = snap.data() ?? {};

  if (outreach.channel !== "social_dm") return { allowed: false, reason: "not_a_social_dm" };
  // Sent, rejected or suppressed since the queue was read: never send again.
  if (outreach.status !== "draft") return { allowed: false, reason: `not_a_draft (${String(outreach.status)})` };
  if (typeof outreach.companyId !== "string" || !outreach.companyId) return { allowed: false, reason: "company_missing" };
  if (!String(outreach.generatedBody ?? "").trim()) return { allowed: false, reason: "empty_message" };
  if (writtenByMock(outreach)) return { allowed: false, reason: "mock_draft" };

  const profile = await resolveDraftProfile(outreach, input.network);
  if (!profile) return { allowed: false, reason: "no_profile_for_network" };

  return canContactSocial({
    workspaceId: (outreach.workspaceId as string) || "ws_default",
    businessId: (outreach.businessId as string) || "",
    companyId: outreach.companyId,
    network: input.network,
    handle: profile.handle,
    purpose: "first_dm"
  });
}

/** Takes one send from the business's daily allowance on this network. */
export async function reserveSendSlot(input: {
  workspaceId: string;
  businessId: string;
  network: SocialNetwork;
}): ReturnType<typeof reserveSocialDmSlot> {
  assertNetwork(input.network);
  const limits = await getSocialLimits(input.workspaceId, input.businessId, input.network);
  return reserveSocialDmSlot({ workspaceId: input.workspaceId, businessId: input.businessId }, input.network, limits);
}

// ── Recording ──────────────────────────────────────────────────────────────

/** Keeps a thread link only when it points at the network's own inbox, without query or fragment. */
function cleanThreadUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const allowed = ["instagram.com", "facebook.com", "messenger.com"].some((h) => host === h || host.endsWith(`.${h}`));
    return url.protocol === "https:" && allowed ? `${url.origin}${url.pathname}` : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Records a first DM a person just sent from a session, and opens the
 * conversation its reply will land in.
 *
 * One transaction: the draft becomes sent, the company takes its one-message
 * lock, and the contact, conversation and outbound message are created, so a
 * crash can never leave a sent DM without the lock or the lock without the
 * thread. Ids are derived from the company and the draft, so a retried call
 * returns the same conversation and writes nothing twice.
 */
export async function recordSocialDmSent(input: {
  outreachId: string;
  network: SocialNetwork;
  profile: SocialProfileRef;
  finalBody: string;
  edited: boolean;
  verified: boolean;
  threadUrl?: string;
  sessionId?: string;
  operator?: string;
  /** "by_hand": the person sent it themselves and confirmed it in the app. */
  via?: "browser_session" | "by_hand";
  /** Sent by an automatic session: no key was pressed for this message (ADR-024). */
  auto?: boolean;
}): Promise<{ conversationId: string; contactId: string }> {
  assertNetwork(input.network);
  const via = input.via ?? "browser_session";
  const auto = input.auto === true && via === "browser_session";
  const network = input.network;
  // Re-derived from the URL: the handle is the identity suppression and the
  // inbox sweep match on, so it is never taken as given.
  const parsed = parseSocialProfileUrl(input.profile?.url ?? "");
  if (!parsed || parsed.network !== network) {
    throw new Error("The profile does not belong to the network the message was sent on.");
  }
  const finalBody = String(input.finalBody ?? "").trim();
  if (!finalBody) throw new Error("An empty message cannot be recorded as sent.");

  const outreachRef = adminDb.collection("outreach").doc(input.outreachId);
  const threadUrl = cleanThreadUrl(input.threadUrl);
  const now = Timestamp.now();

  const recorded = await adminDb.runTransaction(async (transaction) => {
    const outreachSnap = await transaction.get(outreachRef);
    if (!outreachSnap.exists) throw new Error("Draft not found.");
    const outreach = outreachSnap.data() ?? {};
    if (outreach.channel !== "social_dm") throw new Error("Only a direct message draft can be recorded as sent from a session.");
    const collapse = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
    const sentDiffers = Boolean(input.edited) || collapse(outreach.generatedBody) !== collapse(finalBody);
    const companyId = typeof outreach.companyId === "string" ? outreach.companyId : "";
    if (!companyId) throw new Error("The draft is not linked to a company.");
    const workspaceId = (outreach.workspaceId as string) || "ws_default";
    const businessId = (outreach.businessId as string) || "";
    if (!businessId) throw new Error("The draft is not attributed to any business.");

    // A retried call after a commit: same answer, nothing written again.
    if (outreach.status === "sent" && outreach.conversationId && outreach.contactId) {
      return {
        replay: true,
        conversationId: String(outreach.conversationId),
        contactId: String(outreach.contactId),
        workspaceId,
        businessId,
        companyId
      };
    }

    const companyRef = adminDb.collection("companies").doc(companyId);
    const contactId = `social_${network}_${companyId}`;
    const contactRef = adminDb.collection("contacts").doc(contactId);
    const conversationId = `conv_${companyId}_${contactId}`;
    const conversationRef = adminDb.collection("conversations").doc(conversationId);
    const messageRef = conversationRef.collection("messages").doc(`msg_out_social_${input.outreachId}`);
    const lockRef = adminDb.collection(SOCIAL_DM_LOCKS).doc(socialDmLockId(workspaceId, businessId, network, parsed.handle));

    // Every read before the first write, as transactions require.
    const companySnap = await transaction.get(companyRef);
    const contactSnap = await transaction.get(contactRef);
    const conversationSnap = await transaction.get(conversationRef);
    const messageSnap = await transaction.get(messageRef);
    const lockSnap = await transaction.get(lockRef);

    if (!companySnap.exists) throw new Error("Company not found.");
    const company = companySnap.data() ?? {};
    // One first DM per company. The send already happened by the time this
    // runs, so the error says so: the operator has to look at this company.
    if (company.socialDmSentAt && company.socialDmOutreachId !== input.outreachId) {
      throw new Error(
        `${String(company.name ?? companyId)} had already received its first direct message (draft ${String(company.socialDmOutreachId ?? "unknown")}). This send was not recorded — check the conversation by hand.`
      );
    }
    // ...and one per account, whichever company document it was drafted for.
    const lock = lockSnap.exists ? lockSnap.data() ?? {} : undefined;
    if (lock && lock.outreachId !== input.outreachId) {
      throw new Error(
        `${NETWORK_LABEL[network]} account @${parsed.handle} had already received its first direct message (company ${String(lock.companyId ?? "unknown")}, draft ${String(lock.outreachId ?? "unknown")}). This send was not recorded — check the conversation by hand.`
      );
    }

    const handle = parsed.handle;
    const profileUrl = parsed.url;
    const companyName = typeof company.name === "string" ? company.name : undefined;
    const campaignId = typeof outreach.campaignId === "string" && outreach.campaignId ? outreach.campaignId : undefined;
    const existingConversation = conversationSnap.exists ? conversationSnap.data() ?? {} : undefined;

    transaction.set(
      contactRef,
      contactSnap.exists
        ? { status: "contacted", socialHandle: handle, socialProfileUrl: profileUrl, updatedAt: now }
        : {
            id: contactId,
            workspaceId,
            businessId,
            companyId,
            // A social account, not a person with an email: no name is invented.
            channel: network,
            socialHandle: handle,
            socialProfileUrl: profileUrl,
            status: "contacted",
            qualityScore: 70,
            dataQualityWarnings: [],
            createdAt: now,
            updatedAt: now
          },
      { merge: true }
    );

    transaction.set(
      conversationRef,
      {
        id: conversationId,
        workspaceId,
        businessId,
        companyId,
        contactId,
        outreachId: input.outreachId,
        ...(campaignId ? { campaignId } : {}),
        channel: network,
        socialHandle: handle,
        socialProfileUrl: profileUrl,
        ...(threadUrl ? { socialThreadUrl: threadUrl } : {}),
        ...(companyName ? { companyName } : {}),
        status: "sequence_active",
        messageCount: Number(existingConversation?.messageCount ?? 0) + (messageSnap.exists ? 0 : 1),
        lastMessageAt: now,
        createdAt: existingConversation?.createdAt ?? now,
        updatedAt: now,
        // Typed but not seen in the thread afterwards: nobody knows whether
        // the prospect got it, so the conversation waits for a person to
        // check, like an email whose delivery failed.
        ...(input.verified
          ? { unreadHumanAttention: false }
          : {
              unreadHumanAttention: true,
              humanAttentionRequired: true,
              pendingExternalSend: true,
              escalationReason: unconfirmedSendReason(network)
            })
      },
      { merge: true }
    );

    transaction.set(
      lockRef,
      {
        id: lockRef.id,
        workspaceId,
        businessId,
        network,
        handle,
        companyId,
        outreachId: input.outreachId,
        conversationId,
        lockedAt: lock?.lockedAt ?? now
      },
      { merge: true }
    );

    if (!messageSnap.exists) {
      transaction.set(messageRef, {
        id: messageRef.id,
        conversationId,
        workspaceId,
        businessId,
        direction: "outbound",
        channel: network,
        senderEmail: "",
        recipientEmail: "",
        subject: "",
        recipientHandle: handle,
        bodyText: finalBody,
        deliveryStatus: input.verified ? "delivered" : "recorded_not_sent",
        // Only the session runner types and sends; a hand-sent DM has no
        // delivery channel of ours to name.
        ...(via === "browser_session" ? { deliveredVia: "social_session" } : {}),
        sentAt: now
      });
    }

    transaction.set(
      outreachRef,
      {
        status: "sent",
        sentAt: now,
        sentNetwork: network,
        sentVia: via,
        // Tells a message nobody read before it left from one a person approved.
        ...(auto ? { sentAuto: true } : {}),
        ...(via === "by_hand" && input.operator ? { sentByUserId: input.operator } : {}),
        socialHandle: handle,
        contactId,
        conversationId,
        // What the prospect read is what the draft must say: the person's
        // edit, or a text that differs from the stored one however it came
        // to be (the draft changed after it was typed).
        ...(sentDiffers ? { generatedBody: finalBody } : {}),
        // An offer experiment's report needs to know whether the variant's
        // terms line reached the prospect word for word.
        ...(sentDiffers && typeof outreach.offerTermsLine === "string"
          ? { offerTermsLineIntact: finalBody.split(outreach.offerTermsLine).length === 2 }
          : {}),
        // And whether the sender's introduction did (conversation style).
        ...(sentDiffers && typeof outreach.dmIntroLine === "string" && outreach.dmIntroLine
          ? { dmIntroLineIntact: finalBody.split(outreach.dmIntroLine).length === 2 }
          : {}),
        ...(input.sessionId ? { socialSessionId: input.sessionId } : {}),
        updatedAt: now
      },
      { merge: true }
    );

    transaction.set(
      companyRef,
      {
        status: "contacted",
        socialDmSentAt: company.socialDmSentAt ?? now,
        socialDmOutreachId: input.outreachId,
        lastActivityAt: now,
        updatedAt: now
      },
      { merge: true }
    );

    return { replay: false, conversationId, contactId, workspaceId, businessId, companyId };
  });

  if (!recorded.replay) {
    // The send is committed; a lost activity entry must not report it failed
    // (the runner would retry and the retry logs nothing).
    await writeLog({
      type: "outreach.social_dm.sent",
      level: "info",
      message:
        via === "by_hand"
          ? `Direct message sent by hand on ${NETWORK_LABEL[network]}.`
          : auto
            ? `Direct message sent on ${NETWORK_LABEL[network]} from an automatic session.`
            : `Direct message sent on ${NETWORK_LABEL[network]} from a session.`,
      workspaceId: recorded.workspaceId,
      businessId: recorded.businessId,
      metadata: {
        companyId: recorded.companyId,
        outreachId: input.outreachId,
        conversationId: recorded.conversationId,
        channel: network,
        viaSession: via === "browser_session",
        byHand: via === "by_hand",
        ...(auto ? { auto: true } : {}),
        verified: input.verified,
        edited: input.edited,
        sessionId: input.sessionId,
        operator: input.operator ? truncate(input.operator, 120) : undefined,
        profileUrl: parsed.url
      }
    }).catch(() => undefined);
  }

  return { conversationId: recorded.conversationId, contactId: recorded.contactId };
}

/**
 * Records that the person skipped a draft (S), or that the profile could not
 * be messaged. The draft stays a draft and returns to the queue in a day.
 */
export async function recordSocialDmSkipped(input: {
  outreachId: string;
  network: SocialNetwork;
  reason: string;
  sessionId?: string;
}): Promise<void> {
  assertNetwork(input.network);
  const ref = adminDb.collection("outreach").doc(input.outreachId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Draft not found.");
  const outreach = snap.data() ?? {};
  // A draft that left the queue meanwhile (sent, rejected) keeps its state.
  if (outreach.status !== "draft") return;

  const reason = truncate(input.reason, 200) || "skipped";
  const now = Timestamp.now();
  await ref.set(
    {
      skippedAt: now,
      skipReason: reason,
      skippedNetwork: input.network,
      ...(input.sessionId ? { skippedInSessionId: input.sessionId } : {}),
      updatedAt: now
    },
    { merge: true }
  );

  await writeLog({
    type: "outreach.social_dm.skipped",
    level: "info",
    message: `Direct message skipped on ${NETWORK_LABEL[input.network]}: ${reason}`,
    workspaceId: (outreach.workspaceId as string) || "ws_default",
    businessId: (outreach.businessId as string) || undefined,
    metadata: { companyId: outreach.companyId, outreachId: input.outreachId, channel: input.network, reason, sessionId: input.sessionId }
  }).catch(() => undefined);
}

/**
 * Records that an automatic session left a draft to a person: its
 * conversation was not provably new (the account wrote there before, by hand
 * or with another tool — or the check could not tell). Unlike a skip, the
 * draft stays in the queue of a session with keys, where the person sees the
 * thread; `autoSendHoldReason` keeps every later automatic session from
 * opening that profile again.
 */
export async function recordSocialDmAutoHeld(input: {
  outreachId: string;
  network: SocialNetwork;
  reason: string;
  sessionId?: string;
}): Promise<void> {
  assertNetwork(input.network);
  const ref = adminDb.collection("outreach").doc(input.outreachId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Draft not found.");
  const outreach = snap.data() ?? {};
  // A draft that left the queue meanwhile (sent, rejected) keeps its state.
  if (outreach.status !== "draft" || outreach.channel !== "social_dm") return;

  const reason = truncate(input.reason, 200) || "left_for_person";
  const now = Timestamp.now();
  await ref.set(
    {
      autoHeldAt: now,
      autoHeldReason: reason,
      autoHeldNetwork: input.network,
      ...(input.sessionId ? { autoHeldInSessionId: input.sessionId } : {}),
      updatedAt: now
    },
    { merge: true }
  );

  await writeLog({
    type: "outreach.social_dm.left_for_person",
    level: "info",
    message: `Direct message left for a person on ${NETWORK_LABEL[input.network]}: ${reason}`,
    workspaceId: (outreach.workspaceId as string) || "ws_default",
    businessId: (outreach.businessId as string) || undefined,
    metadata: { companyId: outreach.companyId, outreachId: input.outreachId, channel: input.network, reason, sessionId: input.sessionId }
  }).catch(() => undefined);
}
