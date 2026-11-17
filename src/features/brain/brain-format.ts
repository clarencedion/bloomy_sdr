/**
 * Pure presentation helpers for the SDR brain. They only format what the data
 * layer already measured: nothing here invents, estimates or defaults a number.
 * A value that could not be read renders as "—".
 */

import {
  BACKGROUND_WORK_LABEL,
  BRAIN_ALERT_WINDOW_MS,
  BRAIN_HOUR_MS,
  type BrainAgentId,
  type BrainAgentState,
  type BrainAgentStatus,
  type BrainEvent,
  type BrainHealth,
  type BrainPulse,
  type BrainSnapshot
} from "@/lib/sdr/brain-model";

export const EMPTY_VALUE = "—";

/** Upper bound on particles in flight at once. */
export const MAX_PARTICLES = 16;

/** A pulse older than this when first seen is history, not something happening now. */
export const PULSE_MAX_AGE_MS = 20_000;

const countFormat = new Intl.NumberFormat("en-US");

export function formatCount(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return EMPTY_VALUE;
  return countFormat.format(Math.round(value));
}

export function formatUsd(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return EMPTY_VALUE;
  const digits = Math.abs(value) >= 100 ? 0 : 2;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** "just now", "42s ago", "5 min ago", "3 h ago", "2 d ago". */
export function formatRelativeTime(at: Date | null | undefined, now: Date): string {
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) return EMPTY_VALUE;
  const seconds = Math.round((now.getTime() - at.getTime()) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * How much of the recent past the activity window shows. It holds the newest
 * 60 logs of the workspace; on a busy day those can all be minutes old.
 * - `complete`: the window holds every log, so "nothing yet" is provable.
 * - `hour`: it reaches back a full hour, so hourly counts are exact.
 * - `recent`: it reaches back over every status window (15 min), so an idle
 *   agent is provably idle.
 */
export interface ActivityCoverage {
  complete: boolean;
  hour: boolean;
  recent: boolean;
}

export const FULL_COVERAGE: ActivityCoverage = { complete: true, hour: true, recent: true };

export function activityCoverage(activitySince: Date | null | undefined, now: Date): ActivityCoverage {
  if (!(activitySince instanceof Date) || Number.isNaN(activitySince.getTime())) return FULL_COVERAGE;
  const reach = now.getTime() - activitySince.getTime();
  return { complete: false, hour: reach >= BRAIN_HOUR_MS, recent: reach >= BRAIN_ALERT_WINDOW_MS };
}

/** No activity could be read at all (agents are always all eight once logs are read). */
export function isActivityUnavailable(snapshot: Pick<BrainSnapshot, "agents"> | null | undefined): boolean {
  return snapshot ? snapshot.agents.length === 0 : false;
}

/** "12" when exact, "12+" when only a floor is known, "—" when unknown. */
export function formatAtLeast(value: number | null | undefined, exact: boolean): string {
  const text = formatCount(value);
  // "At least 0" says nothing: an unknown floor of zero reads as unknown.
  if (!exact && value === 0) return EMPTY_VALUE;
  return text === EMPTY_VALUE || exact ? text : `${text}+`;
}

/** "12/h", "12+/h" (a floor), or "—/h" (unknown). */
export function formatRate(value: number | null | undefined, exact: boolean): string {
  return `${formatAtLeast(value, exact)}/h`;
}

/** The core's total, e.g. "34/h": "…" while loading, "—/h" when activity is unavailable. */
export function coreRateLabel(agents: BrainAgentState[] | null, coverage: ActivityCoverage = FULL_COVERAGE): string {
  if (agents === null) return "…";
  if (agents.length === 0) return formatRate(null, true);
  const total = agents.reduce((sum, agent) => sum + (Number.isFinite(agent.eventsLastHour) ? agent.eventsLastHour : 0), 0);
  return formatRate(total, coverage.hour);
}

/** An idle agent is provably idle only when the window covers every status window. */
export function agentStatusKnown(
  agent: Pick<BrainAgentState, "status"> | undefined,
  coverage: ActivityCoverage = FULL_COVERAGE
): boolean {
  if (!agent) return false;
  return agent.status !== "idle" || coverage.recent;
}

export const NO_RECENT_DATA = "No recent data";

/** The last-event line of an agent's detail; never "Nothing yet" beside a time. */
export function lastEventText(
  agent: Pick<BrainAgentState, "lastEventAt" | "lastEventLabel"> | undefined,
  coverage: ActivityCoverage = FULL_COVERAGE
): string {
  if (!agent) return EMPTY_VALUE;
  if (agent.lastEventLabel) return agent.lastEventLabel;
  if (agent.lastEventAt) return BACKGROUND_WORK_LABEL;
  return coverage.complete ? "Nothing yet" : "Nothing recent";
}

export function statusLabel(status: BrainAgentStatus): string {
  switch (status) {
    case "active":
      return "Active";
    case "warning":
      return "Warning";
    case "error":
      return "Error";
    default:
      return "Idle";
  }
}

/**
 * The short line under an agent's name, e.g. "Active · 12/h", "Active · 9+/h"
 * when the window does not reach back an hour, or "No recent data" for an
 * agent that cannot be proven idle.
 */
export function agentMetric(
  agent: Pick<BrainAgentState, "status" | "eventsLastHour"> | undefined,
  coverage: ActivityCoverage = FULL_COVERAGE
): string {
  if (!agent) return "No data";
  if (!agentStatusKnown(agent, coverage)) return NO_RECENT_DATA;
  return `${statusLabel(agent.status)} · ${formatRate(agent.eventsLastHour, coverage.hour)}`;
}

export interface AgentSummary {
  active: number;
  idle: number;
  warning: number;
  error: number;
  total: number;
  eventsLastHour: number;
  errorsLastHour: number;
  tone: "ok" | "warn" | "error" | "idle";
  headline: string;
}

/** Above this many agents in one state, the headline counts them instead of naming them. */
const NAMED_IN_HEADLINE = 2;

/**
 * The page's one-line state, most severe first and specific: it names the
 * agents in trouble ("Guardrails: 2 errors · Replies needs a look · 4 working")
 * rather than counting them, so the red dot beside it is never contradicted by
 * the word that opens the line.
 */
export function summarizeAgents(agents: BrainAgentState[], coverage: ActivityCoverage = FULL_COVERAGE): AgentSummary {
  const counts = { active: 0, idle: 0, warning: 0, error: 0 };
  let eventsLastHour = 0;
  let errorsLastHour = 0;
  for (const agent of agents) {
    counts[agent.status] += 1;
    if (Number.isFinite(agent.eventsLastHour)) eventsLastHour += agent.eventsLastHour;
    if (Number.isFinite(agent.errorsLastHour)) errorsLastHour += agent.errorsLastHour;
  }

  const parts: string[] = [];
  const failing = agents.filter((agent) => agent.status === "error");
  if (failing.length > NAMED_IN_HEADLINE) parts.push(`${failing.length} agents in error`);
  else {
    for (const agent of failing) {
      const errors = Number.isFinite(agent.errorsLastHour) ? agent.errorsLastHour : 0;
      parts.push(
        errors > 0
          ? `${agent.label}: ${formatAtLeast(errors, coverage.hour)} ${errors === 1 && coverage.hour ? "error" : "errors"}`
          : `${agent.label} in error`
      );
    }
  }
  const warned = agents.filter((agent) => agent.status === "warning");
  if (warned.length > NAMED_IN_HEADLINE) parts.push(`${warned.length} agents need a look`);
  else for (const agent of warned) parts.push(`${agent.label} needs a look`);
  if (counts.active > 0) {
    parts.push(
      parts.length > 0 ? `${counts.active} working` : `${counts.active} ${counts.active === 1 ? "agent" : "agents"} working`
    );
  }

  let headline: string;
  // Once logs are read every agent is listed, so none means none could be read.
  if (agents.length === 0) headline = "Activity unavailable";
  else if (parts.length > 0) headline = parts.join(" · ");
  else headline = coverage.recent ? "All agents idle" : "Nothing in the latest activity";

  const tone = counts.error > 0 ? "error" : counts.warning > 0 ? "warn" : counts.active > 0 ? "ok" : "idle";

  return { ...counts, total: agents.length, eventsLastHour, errorsLastHour, tone, headline };
}

/**
 * The Agents card's activity line, in plain words: "58 actions in the last
 * hour", "58+ …" when the window is shorter than an hour, "— …" when activity
 * could not be read, "…" while loading.
 */
export function coreActivityText(agents: BrainAgentState[] | null, coverage: ActivityCoverage = FULL_COVERAGE): string {
  if (agents === null) return "…";
  if (agents.length === 0) return `${EMPTY_VALUE} actions in the last hour`;
  const total = agents.reduce((sum, agent) => sum + (Number.isFinite(agent.eventsLastHour) ? agent.eventsLastHour : 0), 0);
  if (total === 0 && coverage.hour) return "No actions in the last hour";
  return `${formatAtLeast(total, coverage.hour)} ${total === 1 && coverage.hour ? "action" : "actions"} in the last hour`;
}

/**
 * How worn a connector looks at rest, from the real hourly count of the agent
 * whose work travels on it: quiet routes recede, busy ones darken and thicken.
 * `rest` (the neutral style) whenever that agent's status cannot be proven.
 */
export type RouteTraffic = "rest" | "quiet" | "steady" | "busy" | "busiest";

export function routeTraffic(
  agent: Pick<BrainAgentState, "status" | "eventsLastHour"> | undefined,
  coverage: ActivityCoverage = FULL_COVERAGE
): RouteTraffic {
  if (!agent || !agentStatusKnown(agent, coverage) || !Number.isFinite(agent.eventsLastHour)) return "rest";
  const perHour = agent.eventsLastHour;
  if (perHour <= 0) return "quiet";
  if (perHour < 10) return "steady";
  if (perHour < 30) return "busy";
  return "busiest";
}

/** How a connector is highlighted: at rest, under the pointer (or keyboard focus), or selected. */
export type ConnectorHighlight = "rest" | "hover" | "selected";

/** The slate steps a connector moves through, lightest to darkest. */
export const CONNECTOR_STROKE = {
  faint: "#E2E8F0",
  rest: "#CBD5E1",
  worn: "#94A3B8",
  strong: "#64748B"
} as const;

const TRAFFIC_LOOK: Record<RouteTraffic, { stroke: string; width: number; chevron: string }> = {
  rest: { stroke: CONNECTOR_STROKE.rest, width: 1.5, chevron: CONNECTOR_STROKE.worn },
  quiet: { stroke: CONNECTOR_STROKE.faint, width: 1.5, chevron: CONNECTOR_STROKE.rest },
  steady: { stroke: CONNECTOR_STROKE.rest, width: 1.5, chevron: CONNECTOR_STROKE.worn },
  busy: { stroke: CONNECTOR_STROKE.worn, width: 2, chevron: CONNECTOR_STROKE.strong },
  busiest: { stroke: CONNECTOR_STROKE.worn, width: 2.5, chevron: CONNECTOR_STROKE.strong }
};

export interface ConnectorLook {
  stroke: string;
  /** Screen pixels (the map converts them to viewBox units). */
  width: number;
  /** The direction chevron: always one step darker than its line at rest. */
  chevron: string;
  opacity: number;
}

/**
 * What a connector looks like: worn by its real traffic at rest, one step
 * darker under the pointer (the darkest step when it is already worn), the
 * darkest when its agent is selected, and receded when another agent is.
 */
export function connectorLook(traffic: RouteTraffic, highlight: ConnectorHighlight, dimmed: boolean): ConnectorLook {
  const worn = TRAFFIC_LOOK[traffic];
  const darkAtRest = worn.stroke === CONNECTOR_STROKE.worn;
  const stroke =
    highlight === "selected"
      ? CONNECTOR_STROKE.strong
      : highlight === "hover"
        ? darkAtRest
          ? CONNECTOR_STROKE.strong
          : CONNECTOR_STROKE.worn
        : worn.stroke;
  return {
    stroke,
    width: worn.width,
    chevron: highlight === "rest" ? worn.chevron : CONNECTOR_STROKE.strong,
    opacity: dimmed ? 0.45 : 1
  };
}

/**
 * Where to act on an agent's work, chosen by what the agent does (never by
 * business). Every href is an existing app route.
 */
export const AGENT_ACTIONS: Readonly<Record<BrainAgentId, { href: string; label: string }>> = {
  discovery: { href: "/app/campaigns", label: "Open campaigns" },
  research: { href: "/app/campaigns", label: "Open campaigns" },
  writing: { href: "/app/approvals", label: "Review approvals" },
  sending: { href: "/app/outreach", label: "Open emails" },
  replies: { href: "/app/inbox", label: "Open inbox" },
  meetings: { href: "/app/meetings", label: "Open meetings" },
  social: { href: "/app/approvals", label: "Review approvals" },
  guardrails: { href: "/app/advanced", label: "Open controls" }
};

/**
 * "2 errors in the last hour", "2+ errors…" when the window is shorter than an
 * hour, or `null` when there is nothing to say (none, or unknown).
 */
export function agentErrorsText(errors: number | null | undefined, exact: boolean): string | null {
  if (typeof errors !== "number" || !Number.isFinite(errors) || errors <= 0) return null;
  const noun = errors === 1 && exact ? "error" : "errors";
  return `${formatAtLeast(errors, exact)} ${noun} in the last hour`;
}

/** The count on an agent's error badge: "3", "3+" (a floor), "99+", or "!" when none was counted. */
export function errorBadgeText(errors: number | null | undefined, exact: boolean): string {
  if (typeof errors !== "number" || !Number.isFinite(errors) || errors <= 0) return "!";
  if (errors > 99) return "99+";
  return formatAtLeast(errors, exact);
}

export interface SpendGauge {
  /** 0..1, or null when no cap is configured. */
  ratio: number | null;
  tone: "ok" | "warn" | "error";
  /** Whole percent of the cap used, or null when unknown. */
  percent: number | null;
}

export function spendGauge(spend: BrainHealth["spend"]): SpendGauge | null {
  if (!spend || !Number.isFinite(spend.todayUsd)) return null;
  if (!Number.isFinite(spend.dailyCapUsd) || spend.dailyCapUsd <= 0) {
    return { ratio: null, tone: "ok", percent: null };
  }
  const raw = spend.todayUsd / spend.dailyCapUsd;
  const ratio = Math.min(1, Math.max(0, raw));
  const tone = raw >= 1 ? "error" : raw >= 0.7 ? "warn" : "ok";
  return { ratio, tone, percent: Math.round(raw * 100) };
}

export function sortEventsNewestFirst(events: BrainEvent[]): BrainEvent[] {
  return events.slice().sort((a, b) => b.at.getTime() - a.at.getTime());
}

export function filterEventsByAgent(events: BrainEvent[], agentId: BrainAgentId | null): BrainEvent[] {
  if (!agentId) return events;
  return events.filter((event) => event.agentId === agentId);
}

/**
 * Pulses to animate now: never seen before and recent. Errors and warnings go
 * first so a burst never hides them behind routine traffic.
 *
 * Age is measured from `receivedAt` (this client's clock, like `nowMs`) when
 * the data layer stamped it, so a client clock ahead of the server cannot
 * silently disable every pulse. `at` (server time) is the fallback.
 */
export function selectFreshPulses(
  pulses: BrainPulse[],
  seen: ReadonlySet<string>,
  nowMs: number,
  maxAgeMs = PULSE_MAX_AGE_MS
): BrainPulse[] {
  const rank = { error: 0, warn: 1, ok: 2 } as const;
  const unique = new Map<string, BrainPulse>();
  for (const pulse of pulses) {
    if (seen.has(pulse.id) || unique.has(pulse.id)) continue;
    const stamp = pulse.receivedAt ?? pulse.at;
    const at = stamp instanceof Date ? stamp.getTime() : Number.NaN;
    if (!Number.isFinite(at) || nowMs - at > maxAgeMs) continue;
    unique.set(pulse.id, pulse);
  }
  return [...unique.values()].sort((a, b) => rank[a.tone] - rank[b.tone] || a.at.getTime() - b.at.getTime());
}

/**
 * Adds particles up to the cap. Particles already in flight are never cut
 * short (that reads as a glitch); surplus newcomers are simply not shown.
 */
export function admitParticles<T extends { id: string }>(current: T[], incoming: T[], max = MAX_PARTICLES): T[] {
  const ids = new Set(current.map((item) => item.id));
  const next = current.slice();
  for (const item of incoming) {
    if (next.length >= max) break;
    if (ids.has(item.id)) continue;
    ids.add(item.id);
    next.push(item);
  }
  return next;
}

/** The running session's sent figure: "3 sent", "3+ sent" (a floor) or "— sent". */
export function socialSentLabel(session: Pick<NonNullable<BrainHealth["socialSession"]>, "sent" | "sentIsFloor">): string {
  const floor = session.sentIsFloor === true;
  // A floor of zero says nothing: show it as unknown.
  if (floor && !(session.sent > 0)) return `${EMPTY_VALUE} sent`;
  return `${formatAtLeast(session.sent, !floor)} sent`;
}

/** Share of the busiest agent's activity, 0..1, for the activity arc. */
export function activityShare(agent: BrainAgentState | undefined, agents: BrainAgentState[]): number {
  if (!agent) return 0;
  const busiest = agents.reduce((max, item) => Math.max(max, item.eventsLastHour || 0), 0);
  if (busiest <= 0) return 0;
  return Math.min(1, Math.max(0, (agent.eventsLastHour || 0) / busiest));
}

/** A compact age for tight lines: "now", "42s", "5 min", "3 h", "2 d", or "—". */
export function shortRelative(at: Date | null | undefined, now: Date): string {
  const text = formatRelativeTime(at, now);
  if (text === "just now") return "now";
  return text.endsWith(" ago") ? text.slice(0, -4) : text;
}

/**
 * How far back a busy activity window reaches, for the note under the map:
 * "the last 12 min". `null` when the window holds everything or reaches back
 * an hour (hourly figures are then exact).
 */
export function liveWindowNote(activitySince: Date | null | undefined, now: Date): string | null {
  if (!(activitySince instanceof Date) || Number.isNaN(activitySince.getTime())) return null;
  const reach = now.getTime() - activitySince.getTime();
  if (reach >= BRAIN_HOUR_MS) return null;
  const minutes = Math.max(1, Math.floor(reach / 60_000));
  return `the last ${minutes} min`;
}

export interface StatusAnnouncement {
  agentId: BrainAgentId;
  message: string;
}

/**
 * What a screen reader should hear when agents change: only an agent entering
 * error or warning. Going active or idle is routine and stays silent, and so
 * does a first reading or an unreadable (empty) list, which have no baseline.
 */
export function statusAnnouncements(
  prev: readonly BrainAgentState[] | null | undefined,
  next: readonly BrainAgentState[] | null | undefined
): StatusAnnouncement[] {
  if (!prev || !next || prev.length === 0 || next.length === 0) return [];
  const before = new Map(prev.map((agent) => [agent.id, agent.status]));
  const out: StatusAnnouncement[] = [];
  for (const agent of next) {
    const was = before.get(agent.id);
    if (was === undefined || was === agent.status) continue;
    if (agent.status === "error") out.push({ agentId: agent.id, message: `${agent.label} is now in error.` });
    else if (agent.status === "warning") out.push({ agentId: agent.id, message: `${agent.label} has a warning.` });
  }
  return out;
}
