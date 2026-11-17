/**
 * The SDR "brain": a live picture of every agent working at once.
 *
 * This module is the pure half of the Brain page. It turns scoped `logs` rows,
 * Firestore count results and callable summaries into the shapes the view
 * renders. It performs no I/O; `src/features/brain/use-brain.ts` does the reads
 * and calls in here, so every rule below is unit-tested offline.
 *
 * Rules it holds (HANDOFF "UX Contract" and "State & Cost Contract"):
 * - Every number comes from a real read. A count that failed is `null` and is
 *   rendered "—"; nothing is defaulted to zero.
 * - The raw technical log message is never surfaced. Titles come from the activity
 *   humanizer; hidden error/warning logs get a neutral label derived from the
 *   log type family, never their technical text.
 * - Logs are scoped the way `getAgentActivity()` scopes them: a log about a
 *   company is shown only when that company belongs to the scope; any other log
 *   only when it is stamped with the workspace and a matching (or no) business.
 * - Business-agnostic (Invariant 1): nothing here knows any business or offer.
 */

import { humanizeActivityFeed, toDate, type HumanActivityEvent, type RawActivityLog } from "./activity-humanizer";

// ── Shared contract (imported by the Brain view) ────────────────────────────

export type BrainAgentId =
  | "discovery"
  | "research"
  | "writing"
  | "sending"
  | "replies"
  | "meetings"
  | "social"
  | "guardrails";

export type BrainAgentStatus = "active" | "idle" | "warning" | "error";

export interface BrainAgentState {
  id: BrainAgentId;
  label: string;
  role: string;
  status: BrainAgentStatus;
  lastEventAt?: Date;
  lastEventLabel?: string;
  eventsLastHour: number;
  errorsLastHour: number;
}

/** `value: null` = could not be read. Render "—", never invent a number. */
export interface BrainKpi {
  id: string;
  label: string;
  value: number | null;
  hint?: string;
}

/**
 * Health panel data.
 *
 * - `queue` / `spend`: `undefined` while the first read is in flight, `null`
 *   when it could not be read.
 * - `socialSession`: `null` when the read succeeded and no session is running,
 *   `undefined` while loading or when it could not be read.
 * Queue counts are workspace-wide (that is how the backend reports them;
 * `queueAllBusinesses` flags it); spend is scoped to the business when one is
 * selected.
 */
export interface BrainHealth {
  queue?: { pending: number; running: number; failed: number; deadLetter: number } | null;
  spend?: { todayUsd: number; dailyCapUsd: number } | null;
  socialSession?: {
    network: "instagram" | "facebook";
    startedAt: Date;
    sent: number;
    /** `true` when `sent` is only what the activity window shows: render "N+". */
    sentIsFloor?: boolean;
  } | null;
  /**
   * `true` when a business is selected: the backend reports queue counts for
   * the whole workspace, so the view must say they cover every business.
   */
  queueAllBusinesses?: boolean;
}

export interface BrainPulse {
  id: string;
  agentId: BrainAgentId;
  tone: "ok" | "warn" | "error";
  label: string;
  /** When the log was written (server time). */
  at: Date;
  /**
   * When this client received it (client time). Freshness is measured from
   * here, so a client clock that disagrees with the server cannot hide pulses.
   */
  receivedAt?: Date;
}

export interface BrainEvent {
  id: string;
  agentId: BrainAgentId | null;
  title: string;
  detail?: string;
  tone: "ok" | "warn" | "error";
  at: Date;
}

export interface BrainSnapshot {
  agents: BrainAgentState[];
  kpis: BrainKpi[];
  health: BrainHealth;
  events: BrainEvent[];
  updatedAt: Date;
  liveConnected: boolean;
  /**
   * Set only when the activity window is full: the time of the oldest log it
   * holds. Nothing older is visible, so hourly figures are a floor while this
   * is less than an hour ago, and "idle" cannot be proven while it is more
   * recent than the status windows. `undefined` = the window holds every log.
   */
  activitySince?: Date;
}

// ── Inputs ──────────────────────────────────────────────────────────────────

export interface BrainScope {
  workspaceId: string;
  businessId?: string;
}

/** A `logs` row as the brain reads it: the humanizer's view plus tenant stamps. */
export interface BrainLog extends RawActivityLog {
  workspaceId?: string;
  businessId?: string;
}

/** Turns a companyId into a display name (only for companies in scope). */
export type CompanyNameResolver = (companyId: string) => string | undefined;

/**
 * Whether a company belongs to the scope: `true`/`false` once its document has
 * been read, `undefined` while that is not known yet.
 */
export type CompanyOwnership = (companyId: string) => boolean | undefined;

// ── Agents ──────────────────────────────────────────────────────────────────

/** The eight agents, in the order the pipeline runs them. */
export const BRAIN_AGENTS: ReadonlyArray<{ id: BrainAgentId; label: string; role: string }> = [
  { id: "discovery", label: "Discovery", role: "Finds companies" },
  { id: "research", label: "Research", role: "Studies each company" },
  { id: "writing", label: "Writing", role: "Prepares messages" },
  { id: "sending", label: "Sending", role: "Delivers emails" },
  { id: "replies", label: "Replies", role: "Answers prospects" },
  { id: "meetings", label: "Meetings", role: "Books meetings" },
  { id: "social", label: "Social", role: "Direct messages" },
  { id: "guardrails", label: "Guardrails", role: "Limits and safety" }
];

const AGENT_LABEL = new Map(BRAIN_AGENTS.map((agent) => [agent.id, agent.label]));

/** An agent shows an error/warning for this long after the last one. */
export const BRAIN_ALERT_WINDOW_MS = 15 * 60_000;
/** An agent is "active" when it logged anything this recently. */
export const BRAIN_ACTIVE_WINDOW_MS = 10 * 60_000;
export const BRAIN_HOUR_MS = 60 * 60_000;
export const BRAIN_MAX_EVENTS = 30;
export const BRAIN_MAX_PULSES_PER_BATCH = 12;
/** Company documents read per resolution pass (names + ownership). */
export const BRAIN_MAX_COMPANY_LOOKUPS = 30;
/** A "running" social session older than this is a runner that never closed it. */
export const BRAIN_STALE_SESSION_MS = 12 * 60 * 60_000;
/** Label of an agent's last event when it was plain background work. */
export const BACKGROUND_WORK_LABEL = "Background work";

const startsWithAny = (type: string, prefixes: readonly string[]) => prefixes.some((prefix) => type.startsWith(prefix));

/**
 * Agent families, evaluated in order: the first match wins.
 *
 * Derived from the log types the backend really emits (`grep -rhoE 'type:
 * "[a-zA-Z_.]+"' functions/src`, plus the `outreach.${status}` template and the
 * client-written types). Order matters where families overlap:
 * - social first, so `outreach.social_dm.*` and `reply.social_*` never fall into
 *   writing, sending or replies;
 * - guardrails before the generic outreach rules, so `outreach.suppressed` is a
 *   guardrail and not a send;
 * - replies before writing/sending, so `outreach.reply_received` is a reply.
 */
const AGENT_RULES: ReadonlyArray<{ agent: BrainAgentId; matches: (type: string) => boolean }> = [
  {
    agent: "social",
    matches: (type) => startsWithAny(type, ["social_session.", "outreach.social_dm.", "reply.social_"])
  },
  {
    agent: "guardrails",
    matches: (type) =>
      type === "outreach.suppressed" ||
      type === "api.spend" ||
      startsWithAny(type, ["suppression.", "escalation.", "queue.", "automation.", "api.spend.", "settings."])
  },
  { agent: "discovery", matches: (type) => type.startsWith("discovery.") },
  {
    agent: "research",
    matches: (type) =>
      type === "enrichment" || startsWithAny(type, ["research.", "signals.", "contact_waterfall.", "enrichment."])
  },
  {
    agent: "replies",
    matches: (type) =>
      type === "outreach.reply_received" ||
      type === "reply_received" ||
      startsWithAny(type, ["reply.", "reply_generator.", "conversation.", "dispatcher."])
  },
  { agent: "meetings", matches: (type) => startsWithAny(type, ["meeting.", "calendar."]) },
  {
    agent: "writing",
    matches: (type) =>
      type.startsWith("outreach.generation") ||
      startsWithAny(type, ["pdf.", "outreach.pdf."]) ||
      (type.startsWith("outreach.") && type.endsWith(".drafted")) ||
      // `outreach.${status}` from a draft being reviewed or edited.
      [
        "outreach.updated",
        "outreach.draft",
        "outreach.approved",
        "outreach.rejected",
        "outreach.needs_more_research",
        // Qualified, but no email, verified profile or form to write to.
        "outreach.no_channel"
      ].includes(
        type
      )
  },
  {
    agent: "sending",
    matches: (type) =>
      type === "lead_bounced" ||
      type === "contact.email_undeliverable" ||
      type.startsWith("webhook.instantly.") ||
      (type.startsWith("outreach.") &&
        (type.endsWith(".sent") ||
          type === "outreach.bounced" ||
          type.startsWith("outreach.auto_send.") ||
          type.includes("dispatch") ||
          type.includes("instantly")))
  }
];

/** Which agent a log type belongs to, or `null` when it is not an agent's work. */
export function agentForLogType(type: string | undefined | null): BrainAgentId | null {
  if (!type) return null;
  for (const rule of AGENT_RULES) {
    if (rule.matches(type)) return rule.agent;
  }
  return null;
}

export function agentLabel(id: BrainAgentId): string {
  return AGENT_LABEL.get(id) ?? id;
}

type AlertLevel = "error" | "warning";

function alertLevel(log: BrainLog): AlertLevel | null {
  const level = typeof log.level === "string" ? log.level.toLowerCase() : "";
  if (level === "error") return "error";
  if (level === "warning" || level === "warn") return "warning";
  return null;
}

/**
 * A short label for an error or warning whose technical text must stay hidden,
 * e.g. "Replies agent error". It names the family, never the message.
 */
export function neutralAlertLabel(agentId: BrainAgentId | null, level: AlertLevel): string {
  const owner = agentId ? `${agentLabel(agentId)} agent` : "System";
  return level === "error" ? `${owner} error` : `${owner} warning`;
}

function toneOf(log: BrainLog, human?: HumanActivityEvent): "ok" | "warn" | "error" {
  const level = alertLevel(log);
  if (level === "error") return "error";
  if (level === "warning" || human?.tone === "issue") return "warn";
  return "ok";
}

function humanIndex(logs: BrainLog[], resolveCompany?: CompanyNameResolver): Map<string, HumanActivityEvent> {
  return new Map(humanizeActivityFeed(logs, { resolveCompany }).map((event) => [event.id, event]));
}

/**
 * The user-facing label of a log: its humanized title, a neutral alert label,
 * or "Background work" for plumbing the humanizer hides (`queue.*`,
 * `settings.*`, …) — never nothing, so a timestamp never stands alone.
 */
function labelOf(log: BrainLog, human: HumanActivityEvent | undefined): string {
  if (human) return human.title;
  const level = alertLevel(log);
  return level ? neutralAlertLabel(agentForLogType(log.type), level) : BACKGROUND_WORK_LABEL;
}

function dated(logs: BrainLog[]): Array<{ log: BrainLog; at: Date }> {
  return logs
    .map((log) => ({ log, at: toDate(log.createdAt) }))
    .filter((entry): entry is { log: BrainLog; at: Date } => entry.at !== null)
    .sort((a, b) => b.at.getTime() - a.at.getTime());
}

/**
 * Status of each agent from its recent logs:
 * error (an error in the last 15 min) > warning (a warning in the last 15 min)
 * > active (anything in the last 10 min) > idle.
 *
 * `logs` must already be scoped (`scopeBrainLogs`).
 */
export function computeAgentStates(
  logs: BrainLog[],
  now: Date,
  options: { resolveCompany?: CompanyNameResolver } = {}
): BrainAgentState[] {
  const nowMs = now.getTime();
  const human = humanIndex(logs, options.resolveCompany);
  const byAgent = new Map<BrainAgentId, Array<{ log: BrainLog; at: Date }>>();
  for (const entry of dated(logs)) {
    const agent = agentForLogType(entry.log.type);
    if (!agent) continue;
    const list = byAgent.get(agent) ?? [];
    list.push(entry);
    byAgent.set(agent, list);
  }

  return BRAIN_AGENTS.map((agent) => {
    const entries = byAgent.get(agent.id) ?? [];
    const within = (at: Date, windowMs: number) => nowMs - at.getTime() <= windowMs;

    let status: BrainAgentStatus = "idle";
    if (entries.some(({ log, at }) => alertLevel(log) === "error" && within(at, BRAIN_ALERT_WINDOW_MS))) {
      status = "error";
    } else if (entries.some(({ log, at }) => alertLevel(log) === "warning" && within(at, BRAIN_ALERT_WINDOW_MS))) {
      status = "warning";
    } else if (entries.some(({ at }) => within(at, BRAIN_ACTIVE_WINDOW_MS))) {
      status = "active";
    }

    const lastHour = entries.filter(({ at }) => within(at, BRAIN_HOUR_MS));
    const newest = entries[0];

    return {
      id: agent.id,
      label: agent.label,
      role: agent.role,
      status,
      lastEventAt: newest?.at,
      lastEventLabel: newest ? labelOf(newest.log, human.get(newest.log.id)) : undefined,
      eventsLastHour: lastHour.length,
      errorsLastHour: lastHour.filter(({ log }) => alertLevel(log) === "error").length
    };
  });
}

/**
 * The activity stream: humanized events, plus a neutral line for errors and
 * warnings that are technical by design. Newest first, at most 30.
 *
 * `logs` must already be scoped (`scopeBrainLogs`).
 */
export function toBrainEvents(
  logs: BrainLog[],
  resolveCompany?: CompanyNameResolver,
  max = BRAIN_MAX_EVENTS
): BrainEvent[] {
  const human = humanIndex(logs, resolveCompany);
  const events: BrainEvent[] = [];

  for (const { log, at } of dated(logs)) {
    const translated = human.get(log.id);
    const agentId = agentForLogType(log.type);
    if (translated) {
      events.push({
        id: log.id,
        agentId,
        title: translated.title,
        detail: translated.detail,
        tone: toneOf(log, translated),
        at
      });
    } else {
      const level = alertLevel(log);
      if (!level) continue;
      events.push({ id: log.id, agentId, title: neutralAlertLabel(agentId, level), tone: toneOf(log), at });
    }
    if (events.length >= max) break;
  }

  return events;
}

/**
 * One pulse per log not seen before, newest first, at most 12.
 *
 * `previousLogIds === null` means this is the first load: it produces no
 * pulses, so opening the page does not fire sixty animations at once. Logs that
 * belong to no agent produce no pulse.
 */
export function diffPulses(
  previousLogIds: ReadonlySet<string> | null,
  logs: BrainLog[],
  resolveCompany?: CompanyNameResolver
): BrainPulse[] {
  if (previousLogIds === null) return [];

  const fresh = dated(logs.filter((log) => !previousLogIds.has(log.id)))
    .filter(({ log }) => agentForLogType(log.type) !== null)
    .slice(0, BRAIN_MAX_PULSES_PER_BATCH);
  if (!fresh.length) return [];

  const human = humanIndex(
    fresh.map(({ log }) => log),
    resolveCompany
  );

  return fresh.map(({ log, at }) => {
    const translated = human.get(log.id);
    return {
      id: log.id,
      agentId: agentForLogType(log.type) as BrainAgentId,
      tone: toneOf(log, translated),
      label: labelOf(log, translated),
      at
    };
  });
}

/**
 * How far back the activity window reaches: the oldest log's time when the
 * listener returned a full window, else `undefined` because every log is in
 * it. `logs` are the listener rows before scoping: the window is cut on the
 * whole workspace, so a busy business can push another one's logs out.
 */
export function activityHorizon(logs: BrainLog[], windowFull: boolean): Date | undefined {
  if (!windowFull) return undefined;
  let oldest: Date | undefined;
  for (const log of logs) {
    const at = toDate(log.createdAt);
    if (at && (!oldest || at.getTime() < oldest.getTime())) oldest = at;
  }
  return oldest;
}

// ── Raw rows ────────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A `logs` document as the brain may use it, or `null` when it is malformed.
 *
 * Signed-in clients can write logs, so a row is untrusted: a non-string `type`
 * would crash the agent rules, and a tenant stamp that is not a string cannot
 * be compared. The raw message is never carried (it is never shown).
 */
export function toBrainLog(id: string, data: unknown): BrainLog | null {
  if (!id || !isPlainObject(data)) return null;
  if (typeof data.type !== "string" || !data.type) return null;
  const stamp = (value: unknown): string | undefined | null =>
    value === undefined || value === null ? undefined : typeof value === "string" ? value : null;
  const workspaceId = stamp(data.workspaceId);
  const businessId = stamp(data.businessId);
  // A stamp of the wrong kind proves nothing either way: drop the row.
  if (workspaceId === null || businessId === null) return null;
  return {
    id,
    type: data.type,
    level: typeof data.level === "string" ? data.level : undefined,
    createdAt: data.createdAt,
    metadata: isPlainObject(data.metadata) ? data.metadata : undefined,
    workspaceId,
    businessId
  };
}

// ── Scope ───────────────────────────────────────────────────────────────────

export function logCompanyId(log: BrainLog): string | undefined {
  const value = log.metadata?.companyId;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Stamps that already prove a log is someone else's, without any read. */
function stampedElsewhere(log: BrainLog, scope: BrainScope): boolean {
  if (log.workspaceId && log.workspaceId !== scope.workspaceId) return true;
  return Boolean(scope.businessId && log.businessId && log.businessId !== scope.businessId);
}

/**
 * Whether a log belongs to the scope — `getAgentActivity()`'s `belongsToScope`
 * rule, made stricter where a stamp already disagrees:
 * - stamped with another workspace, or another business → no;
 * - about a company → only when that company belongs to the scope
 *   (`undefined` while the company has not been read yet);
 * - otherwise → only when stamped with this workspace (and this business or none).
 */
export function logInScope(log: BrainLog, scope: BrainScope, ownership: CompanyOwnership): boolean | undefined {
  if (stampedElsewhere(log, scope)) return false;
  const companyId = logCompanyId(log);
  if (companyId) return ownership(companyId);
  return log.workspaceId === scope.workspaceId;
}

/** The logs that provably belong to the scope, newest first. Unknown = dropped. */
export function scopeBrainLogs(logs: BrainLog[], scope: BrainScope, ownership: CompanyOwnership): BrainLog[] {
  return dated(logs.filter((log) => logInScope(log, scope, ownership) === true)).map(({ log }) => log);
}

/**
 * Company ids worth reading to settle ownership and names: newest logs first,
 * skipping logs already proven foreign and ids already known, at most `max`.
 */
export function companyIdsToResolve(
  logs: BrainLog[],
  scope: BrainScope,
  isKnown: (companyId: string) => boolean,
  max = BRAIN_MAX_COMPANY_LOOKUPS
): string[] {
  const ids: string[] = [];
  for (const { log } of dated(logs)) {
    if (ids.length >= max) break;
    if (stampedElsewhere(log, scope)) continue;
    const companyId = logCompanyId(log);
    if (!companyId || isKnown(companyId) || ids.includes(companyId)) continue;
    ids.push(companyId);
  }
  return ids;
}

/**
 * Every company id of the window still to read, in batches of at most
 * `batchSize`, newest first. All batches are read in one resolution, so a
 * window naming more companies than one batch never leaves logs hidden until
 * the next log arrives. Each id is read once (then cached), so the total reads
 * are the same as one uncapped pass; the batches only bound concurrency.
 */
export function planCompanyLookups(
  logs: BrainLog[],
  scope: BrainScope,
  isKnown: (companyId: string) => boolean,
  batchSize = BRAIN_MAX_COMPANY_LOOKUPS
): string[][] {
  const ids = companyIdsToResolve(logs, scope, isKnown, Number.POSITIVE_INFINITY);
  const size = Math.max(1, Math.floor(batchSize));
  const batches: string[][] = [];
  for (let index = 0; index < ids.length; index += size) batches.push(ids.slice(index, index + size));
  return batches;
}

/**
 * Same rule as `getAgentActivity()`: the company must be in the workspace, and
 * carry this business or none. A missing document belongs to nobody.
 */
export function companyBelongsToScope(
  company: { workspaceId?: unknown; businessId?: unknown } | null | undefined,
  scope: BrainScope
): boolean {
  if (!company) return false;
  if (company.workspaceId !== scope.workspaceId) return false;
  if (!scope.businessId) return true;
  return !company.businessId || company.businessId === scope.businessId;
}

// ── KPIs ────────────────────────────────────────────────────────────────────

export type BrainCountKey =
  | "companies"
  | "researched"
  | "drafts"
  | "outreachSent"
  | "outreachReplied"
  | "conversationsInDialogue"
  | "conversationsEscalated"
  | "conversationsInReview"
  | "conversationsMeetingBooked"
  | "meetings"
  | "meetingsCancelled"
  | "attention"
  | "attentionSuppressed"
  | "attentionUnattributed"
  | "attentionUnattributedSuppressed";

/** One `getCountFromServer` query: equality filters only, always workspace-scoped. */
export interface BrainCountQuery {
  key: BrainCountKey;
  collection: string;
  equals: Array<[field: string, value: string | boolean]>;
}

export type BrainCounts = Partial<Record<BrainCountKey, number | null>>;

/** The statuses a conversation only reaches once the prospect has answered. */
export const REPLIED_CONVERSATION_STATUSES = ["in_dialogue", "human_escalated", "human_review_required", "meeting_booked"] as const;

/**
 * The count queries behind the KPIs.
 *
 * Equality filters only (Firestore merges single-field indexes for those, so
 * no composite index is required), never a document fetch. With a business
 * selected every query is also filtered on `businessId`: documents with no
 * business stamp are not counted, so the figures are a floor for legacy data.
 * The one exception mirrors the Inbox badge: conversations that could not be
 * attributed to any business (`needsAttribution`) are listed under every
 * business, so they are counted in "Needs you".
 */
export function brainCountQueries(scope: BrainScope): BrainCountQuery[] {
  const base: Array<[string, string | boolean]> = [["workspaceId", scope.workspaceId]];
  if (scope.businessId) base.push(["businessId", scope.businessId]);
  const q = (key: BrainCountKey, collection: string, ...extra: Array<[string, string | boolean]>): BrainCountQuery => ({
    key,
    collection,
    equals: [...base, ...extra]
  });

  const queries: BrainCountQuery[] = [
    q("companies", "companies"),
    q("researched", "leadResearch", ["status", "completed"]),
    q("drafts", "outreach", ["status", "draft"]),
    q("outreachSent", "outreach", ["status", "sent"]),
    q("outreachReplied", "outreach", ["status", "replied"]),
    q("conversationsInDialogue", "conversations", ["status", "in_dialogue"]),
    q("conversationsEscalated", "conversations", ["status", "human_escalated"]),
    q("conversationsInReview", "conversations", ["status", "human_review_required"]),
    q("conversationsMeetingBooked", "conversations", ["status", "meeting_booked"]),
    q("meetings", "meetings"),
    q("meetingsCancelled", "meetings", ["status", "cancelled"]),
    q("attention", "conversations", ["unreadHumanAttention", true]),
    q("attentionSuppressed", "conversations", ["unreadHumanAttention", true], ["status", "suppressed"])
  ];

  if (scope.businessId) {
    const unattributed: Array<[string, string | boolean]> = [
      ["workspaceId", scope.workspaceId],
      ["needsAttribution", true],
      ["unreadHumanAttention", true]
    ];
    queries.push(
      { key: "attentionUnattributed", collection: "conversations", equals: unattributed },
      { key: "attentionUnattributedSuppressed", collection: "conversations", equals: [...unattributed, ["status", "suppressed"]] }
    );
  }

  return queries;
}

/** Sum of the parts, or `null` when any part could not be read. */
function combine(counts: BrainCounts, add: BrainCountKey[], subtract: BrainCountKey[] = []): number | null {
  let total = 0;
  for (const key of [...add, ...subtract]) {
    const value = counts[key];
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
  }
  for (const key of add) total += counts[key] as number;
  for (const key of subtract) total -= counts[key] as number;
  // The counts are read a few milliseconds apart; a difference must not go negative.
  return Math.max(0, total);
}

/**
 * The KPI row, from count results (see `brainCountQueries`).
 *
 * - Sent = outreach `sent` + `replied`: a reply moves an email from "sent" to
 *   "replied", and it was still sent. Outreach later closed as
 *   `meeting_booked` is not counted, because that status is also applied to
 *   drafts that never went out.
 * - Replies = conversations in a status only reached after the prospect
 *   answered (one per thread, the backend analytics definition). Outreach
 *   `replied` was not used: a single reply marks every sent email to that
 *   contact as replied, and the count drops once a meeting is booked.
 * - Meetings = all meetings minus cancelled ones.
 * - Needs you = the Inbox badge rule: unread human attention, suppressed
 *   conversations excluded, unattributed conversations included.
 */
export function buildBrainKpis(counts: BrainCounts, scope: BrainScope): BrainKpi[] {
  const attention = scope.businessId
    ? combine(counts, ["attention", "attentionUnattributed"], ["attentionSuppressed", "attentionUnattributedSuppressed"])
    : combine(counts, ["attention"], ["attentionSuppressed"]);

  return [
    { id: "companies", label: "Companies found", value: combine(counts, ["companies"]), hint: "Every company your SDR has found" },
    // Completed research documents: one per company, plus one per forced re-run.
    { id: "researched", label: "Researched", value: combine(counts, ["researched"]), hint: "Completed research runs" },
    { id: "ready", label: "Messages ready", value: combine(counts, ["drafts"]), hint: "Prepared and waiting to go out" },
    { id: "sent", label: "Sent", value: combine(counts, ["outreachSent", "outreachReplied"]), hint: "Messages delivered" },
    {
      id: "replies",
      label: "Replies",
      value: combine(counts, [
        "conversationsInDialogue",
        "conversationsEscalated",
        "conversationsInReview",
        "conversationsMeetingBooked"
      ]),
      hint: "Prospects who answered"
    },
    { id: "meetings", label: "Meetings", value: combine(counts, ["meetings"], ["meetingsCancelled"]), hint: "Booked, not cancelled" },
    { id: "needsYou", label: "Needs you", value: attention, hint: "Conversations waiting for you" }
  ];
}

// ── Health ──────────────────────────────────────────────────────────────────

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Queue counts from `callGetQueueHealth`, or `null` when unusable. */
export function toBrainQueue(summary: unknown): NonNullable<BrainHealth["queue"]> | null {
  if (!summary || typeof summary !== "object") return null;
  const record = summary as Record<string, unknown>;
  const pending = finite(record.pending);
  const running = finite(record.running);
  const failed = finite(record.failed);
  const deadLetter = finite(record.deadLetter);
  if (pending === null || running === null || failed === null || deadLetter === null) return null;
  return { pending, running, failed, deadLetter };
}

/** Today's spend and cap from either health callable, or `null` when unusable. */
export function toBrainSpend(summary: unknown): NonNullable<BrainHealth["spend"]> | null {
  if (!summary || typeof summary !== "object") return null;
  const record = summary as Record<string, unknown>;
  const todayUsd = finite(record.todaySpendUsd);
  const dailyCapUsd = finite(record.dailyBudgetCapUsd);
  if (todayUsd === null || dailyCapUsd === null) return null;
  return { todayUsd, dailyCapUsd };
}

export interface RawSocialSession {
  id: string;
  workspaceId?: unknown;
  businessId?: unknown;
  network?: unknown;
  status?: unknown;
  startedAt?: unknown;
  sent?: unknown;
}

export interface LiveSocialSession {
  id: string;
  network: "instagram" | "facebook";
  startedAt: Date;
  /** Final total written when the session ends; 0 while it is running. */
  recordedSent: number;
}

/**
 * The session running now for this scope, newest first. A session still
 * marked "running" after 12 hours is a runner that never closed it, not a
 * session in progress.
 */
export function pickLiveSocialSession(
  sessions: RawSocialSession[],
  scope: BrainScope,
  now: Date
): LiveSocialSession | null {
  const live = sessions
    .filter((session) => session.status === "running")
    .filter((session) => session.workspaceId === scope.workspaceId)
    .filter((session) => !scope.businessId || session.businessId === scope.businessId)
    .map((session) => ({ session, startedAt: toDate(session.startedAt) }))
    .filter(
      (entry): entry is { session: RawSocialSession; startedAt: Date } =>
        entry.startedAt !== null && now.getTime() - entry.startedAt.getTime() <= BRAIN_STALE_SESSION_MS
    )
    .filter(({ session }) => session.network === "instagram" || session.network === "facebook")
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

  const first = live[0];
  if (!first) return null;
  return {
    id: first.session.id,
    network: first.session.network as "instagram" | "facebook",
    startedAt: first.startedAt,
    recordedSent: Math.max(0, Math.floor(finite(first.session.sent) ?? 0))
  };
}

/** Session sends visible in the (scoped) log window: a floor, never a total. */
export function countSessionSendsInLogs(logs: BrainLog[], sessionId: string): number {
  return logs.filter((log) => log.type === "outreach.social_dm.sent" && log.metadata?.sessionId === sessionId).length;
}

/**
 * The session's sent total. The session document only receives its total when
 * the session ends, so while it runs the count of outreach stamped with its id
 * is the truthful figure. When that count could not be read, the sends visible
 * in the activity window are used instead, flagged `sentIsFloor` so the view
 * shows "N+" rather than an exact figure. The largest figure wins.
 */
export function socialSessionHealth(
  session: LiveSocialSession,
  stampedOutreachCount: number | null,
  scopedLogs: BrainLog[] = []
): NonNullable<BrainHealth["socialSession"]> {
  const observed = stampedOutreachCount ?? countSessionSendsInLogs(scopedLogs, session.id);
  return {
    network: session.network,
    startedAt: session.startedAt,
    sent: Math.max(session.recordedSent, observed),
    sentIsFloor: stampedOutreachCount === null
  };
}
