/**
 * Translates raw backend `logs` rows into plain-language SDR activity a
 * non-technical business owner can read.
 *
 * The backend intentionally emits technical event types and technical messages
 * ("Outreach sent to Instantly.ai. Campaign: ...", "Discovery provider X
 * completed"). Those belong in Advanced -> System logs. This module is the
 * single translation boundary: it reads only `type` + `metadata`, never the raw
 * `message`, and stays business-agnostic (no offer/industry branching).
 *
 * Log metadata carries IDs rather than names, so callers pass a `resolveCompany`
 * function to turn `companyId` into a display name.
 */

export type ActivityTone = "found" | "research" | "person" | "email" | "reply" | "meeting" | "issue";

export interface HumanActivityEvent {
  id: string;
  /** Plain-language headline, e.g. "Found Sophie Martin at Atelier Floral". */
  title: string;
  /** Optional supporting line, e.g. "Opportunity score: 91". */
  detail?: string;
  tone: ActivityTone;
  at: Date | null;
  /** Company this event relates to, when the log carries one. */
  companyId?: string;
  /** Campaign this event relates to, for events that are not about a company. */
  campaignId?: string;
}

export interface RawActivityLog {
  id: string;
  type: string;
  level?: string;
  message?: string;
  createdAt?: unknown;
  metadata?: Record<string, unknown>;
}

export interface HumanizeOptions {
  /** Turns a companyId into a display name. Falls back to a neutral noun. */
  resolveCompany?: (companyId: string) => string | undefined;
}

/**
 * Event families that are pure plumbing. They stay available in
 * Advanced -> System logs but must never reach a normal user.
 */
const HIDDEN_PREFIXES = [
  "queue.",
  "settings.",
  "webhook.",
  "export.",
  "pdf.",
  "automation.",
  "analytics.",
  "api.spend",
  "functions.health",
  "dispatcher.",
  "escalation.pause_outreach_warning",
  "calendar.freebusy_error",
  "signals.collection.run",
  "refresh_token"
];

const HIDDEN_TYPES = new Set([
  "reply_generator.context_fetch_warning",
  "reply_generator.ai_error",
  "reply.classification_error",
  "reply.routing_error",
  "research.website_fetch",
  "outreach.updated",
  "outreach.pdf.failed",
  "contact_waterfall.dropcontact_failed",
  "contact_waterfall.secondary_failed",
  "contact_waterfall.pre_enrichment_gate_blocked",
  "required"
]);

function str(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function num(metadata: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = metadata?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

export function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "object" && typeof (value as { toDate?: () => Date }).toDate === "function") {
    try {
      const date = (value as { toDate: () => Date }).toDate();
      return Number.isNaN(date.getTime()) ? null : date;
    } catch {
      return null;
    }
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

/** Formats an ISO timestamp as a short, human meeting time. */
function meetingTime(iso: string | undefined): string | undefined {
  const date = toDate(iso);
  if (!date) return undefined;
  return date.toLocaleString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

interface Translation {
  title: string;
  detail?: string;
  tone: ActivityTone;
}

/**
 * Maps one log type to plain language. Returns `null` for events that carry no
 * user-facing meaning.
 */
function translate(log: RawActivityLog, name: string): Translation | null {
  const meta = log.metadata;

  switch (log.type) {
    // ── Finding companies ─────────────────────────────────
    case "discovery.functions.run":
      return { title: "Searched for new companies", tone: "found" };

    // ── Looking into a company ────────────────────────────
    case "research.queued":
      return { title: `Queued ${name} for a closer look`, tone: "research" };
    case "research.start":
      return { title: `Researching ${name}`, tone: "research" };
    case "research.website_resolved":
      return { title: `Found the website of ${name}`, detail: str(meta, "website"), tone: "research" };
    case "research.website_not_found":
      return { title: `${name} has no website we could find`, tone: "research" };
    case "research.completed": {
      const score = num(meta, "fitScore");
      return {
        title: `Finished researching ${name}`,
        detail: score !== undefined ? `Opportunity score: ${Math.round(score)}` : undefined,
        tone: "research"
      };
    }
    case "research.failed":
      return { title: `Could not finish researching ${name}`, tone: "issue" };
    case "enrichment.website.completed": {
      const emails = num(meta, "emailsCreated");
      return {
        title: `Checked the website of ${name}`,
        detail: emails ? `${emails} contact ${emails === 1 ? "address" : "addresses"} found` : undefined,
        tone: "research"
      };
    }
    case "enrichment.website.missing":
      return { title: `${name} has no website we could find`, tone: "research" };
    case "enrichment.website.failed":
      return { title: `Could not read the website of ${name}`, tone: "issue" };

    // ── Finding the right person ──────────────────────────
    case "contact_waterfall.completed": {
      const primary = str(meta, "primaryContact");
      const found = num(meta, "found") ?? 0;
      if (primary) {
        return { title: `Found ${primary} at ${name}`, detail: "Decision maker", tone: "person" };
      }
      if (found > 0) {
        return { title: `Found ${found} ${found === 1 ? "person" : "people"} at ${name}`, tone: "person" };
      }
      return { title: `No contact found at ${name}`, tone: "person" };
    }

    // ── Emails ────────────────────────────────────────────
    case "outreach.generation.start":
      return { title: `Writing a personalized email for ${name}`, tone: "email" };
    case "outreach.generation.completed":
      return { title: `Personalized email prepared for ${name}`, tone: "email" };
    case "outreach.generation.failed":
      return { title: `Could not prepare an email for ${name}`, tone: "issue" };
    case "outreach.sent":
      return { title: `Email sent to ${name}`, detail: str(meta, "email"), tone: "email" };
    case "outreach.suppressed":
      return { title: `Skipped ${name}`, detail: "They asked not to be contacted", tone: "email" };
    case "outreach.bounced":
    case "lead_bounced":
      return { title: `Email to ${name} could not be delivered`, tone: "issue" };
    case "outreach.auto_send.failed":
      return { title: `Could not send the email to ${name}`, tone: "issue" };
    case "suppression.unsubscribed":
      return { title: `${name} asked to stop receiving emails`, tone: "email" };

    // ── Conversations ─────────────────────────────────────
    case "outreach.reply_received":
    case "reply_received":
      return { title: `${name} replied`, tone: "reply" };
    case "reply.routed":
    case "reply.queued_assisted":
      return { title: `${name} replied`, detail: "Preparing a response", tone: "reply" };
    case "reply.auto_dispatched":
    case "reply.approved_and_sent":
      return { title: `Replied to ${name}`, tone: "reply" };
    case "reply.queued_manual":
      return { title: `${name} replied`, detail: "Waiting for your review", tone: "reply" };
    case "reply.human_escalated":
      return { title: `${name} needs your input`, detail: str(meta, "reason"), tone: "issue" };
    case "conversation.manual_takeover":
      return { title: `You took over the conversation with ${name}`, tone: "reply" };
    case "conversation.rep_manual_reply":
      return { title: `You replied to ${name}`, tone: "reply" };
    case "conversation.takeover_released":
      return { title: `Handed the conversation with ${name} back to your SDR`, tone: "reply" };

    // ── Meetings ──────────────────────────────────────────
    case "meeting.booked":
      return { title: `Meeting booked with ${name}`, detail: meetingTime(str(meta, "startTime")), tone: "meeting" };
    case "meeting.sequence_terminated":
      return { title: `Stopped emailing ${name}`, detail: "A meeting is booked", tone: "meeting" };
    case "meeting.booking_conflict":
      return { title: `That slot was already taken with ${name}`, detail: "Offered other times", tone: "meeting" };
    case "meeting.calendar_event_error":
      return { title: `Could not add the meeting with ${name} to your calendar`, tone: "issue" };

    default:
      return null;
  }
}

/** True when the event is plumbing that should stay in Advanced -> System logs. */
export function isTechnicalLog(type: string): boolean {
  if (HIDDEN_TYPES.has(type)) return true;
  return HIDDEN_PREFIXES.some((prefix) => type.startsWith(prefix));
}

/**
 * Converts one raw log into a human event, or `null` when it has no
 * user-facing meaning.
 */
export function humanizeActivity(log: RawActivityLog, options: HumanizeOptions = {}): HumanActivityEvent | null {
  if (!log?.type || isTechnicalLog(log.type)) return null;

  const companyId = str(log.metadata, "companyId");
  const resolved = companyId ? options.resolveCompany?.(companyId) : undefined;
  const name = resolved || "a company";

  const translated = translate(log, name);
  if (!translated) return null;

  return {
    id: log.id,
    title: translated.title,
    detail: translated.detail,
    tone: translated.tone,
    at: toDate(log.createdAt),
    companyId,
    campaignId: str(log.metadata, "campaignId")
  };
}

/** Humanizes a batch of logs, dropping everything the user should not see. */
export function humanizeActivityFeed(
  logs: RawActivityLog[],
  options: HumanizeOptions = {}
): HumanActivityEvent[] {
  return logs
    .map((log) => humanizeActivity(log, options))
    .filter((event): event is HumanActivityEvent => event !== null);
}
