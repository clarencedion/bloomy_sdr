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

import { networkLabel, socialNetworkOf } from "./channel";

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
  "refresh_token",
  // Local social session plumbing (session started/ended, a thread the inbox
  // sweep could not match). Problems the owner must act on are logged under
  // `outreach.social_dm.*` instead, so this prefix never hides them.
  "social_session."
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
  // Internal cost optimisation: we used the published contact details rather
  // than a paid lookup. Nothing for the user to decide.
  "contact_waterfall.skipped_small_business",
  // Internal fallback: the company is still picked up by the daily sweep, so
  // there is nothing for the user to do or understand here.
  "discovery.enqueue_failed",
  // The owner pressed S on a DM in their own session: they already know, and
  // the draft simply comes back in the queue later.
  "outreach.social_dm.skipped",
  "required"
]);

function str(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function bool(metadata: Record<string, unknown> | undefined, key: string): boolean {
  return metadata?.[key] === true;
}

/** "Instagram" / "Facebook" when the log is about a social channel. */
function socialNetworkName(metadata: Record<string, unknown> | undefined): string | undefined {
  const network = socialNetworkOf({ channel: str(metadata, "channel") });
  return network ? networkLabel(network) : undefined;
}

/**
 * Why a social session stopped, in the owner's words. The runner stops on the
 * first sign of a login wall, security check or rate limit and never retries,
 * so the detail says what to do next. Unknown reasons stay generic rather than
 * echoing a technical string.
 */
function sessionBlockedDetail(reason: string | undefined, network: string): string {
  // Matched by the runner's blocker kinds (login, checkpoint, captcha,
  // rate_limited, action_blocked, unexpected), wherever they sit in the reason.
  const value = (reason ?? "").toLowerCase();
  if (value.includes("rate_limited") || value.includes("action_blocked")) {
    return `${network} is limiting activity on your account. Nothing more was sent — wait before sending again.`;
  }
  if (value.includes("checkpoint") || value.includes("captcha")) {
    return `${network} showed a security check. Nothing more was sent — confirm it's you in the app, then try again later.`;
  }
  if (value.includes("login")) return `${network} asked you to log in again. Log in from the session, then restart it.`;
  return "The page did not look as expected, so it stopped. Nothing more was sent.";
}

/**
 * The session recorded a social send it could not see appear (`verified:
 * false`). Only an explicit false counts: logs written before the flag
 * existed keep reading as sent.
 */
function unconfirmed(metadata: Record<string, unknown> | undefined): boolean {
  return metadata?.verified === false;
}

function unconfirmedDetail(network: string | undefined): string {
  return `Your session pressed Enter but did not see it appear — check the conversation on ${network ?? "the network"}`;
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
    case "discovery.campaign.orphaned":
      return {
        title: "Stopped a campaign with no business",
        detail: "It was still running after its business was removed",
        tone: "issue"
      };
    case "discovery.campaign.unattributed":
      return {
        title: "Stopped a campaign with no business",
        detail: "It was never attached to one of your businesses, so it had no offer to prospect for",
        tone: "issue"
      };
    case "discovery.campaign.run_failed":
      return { title: "A campaign search failed", detail: "It will be tried again at the next scheduled run", tone: "issue" };

    // ── Looking into a company ────────────────────────────
    case "research.queued":
      return { title: `Queued ${name} for a closer look`, tone: "research" };
    case "research.start":
      return { title: `Researching ${name}`, tone: "research" };
    case "research.website_resolved":
      return { title: `Found the website of ${name}`, detail: str(meta, "website"), tone: "research" };
    case "research.social_profile_found":
      return {
        title: `Found ${name} on Instagram`,
        detail: "Their site links no profile — found by name and confirmed by place",
        tone: "found"
      };
    case "research.social_profile_not_found":
      return { title: `No Instagram profile confirmed for ${name}`, tone: "research" };
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
    case "enrichment.social.contacts_created": {
      const created = num(meta, "created") ?? 0;
      return {
        title: `Found contact details for ${name}`,
        detail: created
          ? `${created} address${created === 1 ? "" : "es"} published on their social profile`
          : undefined,
        tone: "person"
      };
    }

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
    case "outreach.social_dm.drafted":
      return {
        title: `Message prepared for ${name}`,
        // A campaign may prefer DMs even when an email exists.
        detail: "Ready for you to send as a direct message",
        tone: "email"
      };
    case "outreach.no_channel":
      return {
        title: `No way to reach ${name} yet`,
        detail: "No email, no verified Instagram or Facebook profile, no contact form",
        tone: "research"
      };
    case "outreach.social_dm.sent": {
      const network = socialNetworkName(meta);
      // Enter was pressed but the session never saw the message appear.
      if (unconfirmed(meta)) {
        return {
          title: network ? `Message to ${name} on ${network} not confirmed` : `Message to ${name} not confirmed`,
          detail: unconfirmedDetail(network),
          tone: "issue"
        };
      }
      return {
        title: network ? `Message sent to ${name} on ${network}` : `You sent a message to ${name}`,
        // An automatic session sent it: nobody pressed a key for this message.
        ...(meta?.auto === true ? { detail: "Sent by an automatic session" } : {}),
        tone: "email"
      };
    }
    case "outreach.social_dm.left_for_person": {
      const network = socialNetworkName(meta);
      return {
        title: `Message to ${name} left for you`,
        detail: network
          ? `The conversation on ${network} is not new, or could not be checked — send it yourself if it still makes sense`
          : "The conversation is not new, or could not be checked — send it yourself if it still makes sense",
        tone: "email"
      };
    }
    case "outreach.social_dm.session_blocked": {
      const network = socialNetworkName(meta);
      return {
        title: network ? `${network} session stopped` : "Social session stopped",
        detail: sessionBlockedDetail(str(meta, "reason"), network ?? "The network"),
        tone: "issue"
      };
    }
    case "outreach.contact_form.drafted":
      return {
        title: `Message prepared for ${name}`,
        detail: bool(meta, "submittable")
          ? "No email published — ready to send through their contact form"
          : "No email published — their form needs you to send it by hand",
        tone: "email"
      };
    case "outreach.contact_form.sent":
      return {
        title: bool(meta, "byHand")
          ? `You sent a message through the contact form of ${name}`
          : `Message sent through the contact form of ${name}`,
        tone: "email"
      };
    case "outreach.generation.failed":
      return { title: `Could not prepare an email for ${name}`, tone: "issue" };
    case "outreach.sent":
      return { title: `Email sent to ${name}`, detail: str(meta, "email"), tone: "email" };
    case "contact.email_undeliverable":
      return {
        title: `Could not reach ${name}`,
        detail: "Their email address does not exist — nothing was sent",
        tone: "issue"
      };

    case "discovery.website.paid_lookup":
      return {
        title: `Looked up the website of ${name} in the company register`,
        detail: "A paid lookup — only used outside small-business mode",
        tone: "research"
      };
    case "discovery.campaign.area_exhausted":
      return {
        title: "This campaign has found everyone in its area",
        detail: "Add more cities and it will start finding companies again",
        tone: "issue"
      };
    case "discovery.icp.fallback_used":
      return {
        title: "Your campaign brief was read by the built-in parser",
        detail: "The AI could not be reached — check the targeting before letting it run",
        tone: "issue"
      };
    case "discovery.campaign.no_area":
      return {
        title: "This campaign has no area to search",
        detail: "Add a city and it can start finding companies",
        tone: "issue"
      };

    case "workspace.data_purged":
      return {
        title: "You cleared this business's prospecting data",
        detail: `${num(meta, "total") ?? 0} records deleted — your settings were kept`,
        tone: "issue"
      };

    case "outreach.suppressed":
      return { title: `Skipped ${name}`, detail: "They asked not to be contacted", tone: "email" };
    case "outreach.bounced":
    case "lead_bounced":
      return { title: `Email to ${name} could not be delivered`, tone: "issue" };
    case "outreach.auto_send.failed":
      return { title: `Could not send the email to ${name}`, tone: "issue" };
    case "suppression.unsubscribed":
      return { title: `${name} asked to stop receiving emails`, tone: "email" };
    case "suppression.social_unsubscribed": {
      const network = socialNetworkName(meta);
      // "Désinscrire" in the Inbox: the owner decided, the prospect said nothing.
      if (bool(meta, "byOperator")) {
        return {
          title: `You unsubscribed ${name}`,
          detail: network
            ? `Removed from ${network} outreach — your SDR will not message them again`
            : "Your SDR will not message them again",
          tone: "person"
        };
      }
      return {
        title: `${name} asked not to be contacted`,
        detail: network ? `They said so on ${network} — your SDR will not message them again` : undefined,
        tone: "person"
      };
    }

    // ── Conversations ─────────────────────────────────────
    case "outreach.reply_received":
    case "reply_received": {
      const network = socialNetworkName(meta);
      return { title: network ? `${name} replied on ${network}` : `${name} replied`, tone: "reply" };
    }
    case "reply.social_draft_ready": {
      const network = socialNetworkName(meta);
      return {
        title: network ? `${name} replied on ${network}` : `${name} replied`,
        detail: "A reply is ready in your session",
        tone: "reply"
      };
    }
    case "reply.social_sent": {
      const network = socialNetworkName(meta);
      if (unconfirmed(meta)) {
        return {
          title: network ? `Reply to ${name} on ${network} not confirmed` : `Reply to ${name} not confirmed`,
          detail: unconfirmedDetail(network),
          tone: "issue"
        };
      }
      return { title: network ? `Replied to ${name} on ${network}` : `Replied to ${name}`, tone: "reply" };
    }
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
    case "reply.approved_not_sent":
      return {
        title: `Reply to ${name} recorded`,
        detail: "Not sent: send it from your mailbox — replying from the SDR isn't connected yet",
        tone: "issue"
      };
    case "reply_generator.unattributed":
      return {
        title: "A reply needs you",
        detail: "We couldn't tell which of your businesses it is for, so no answer was drafted",
        tone: "issue"
      };
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
