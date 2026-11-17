import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BACKGROUND_WORK_LABEL,
  BRAIN_AGENTS,
  BRAIN_MAX_COMPANY_LOOKUPS,
  activityHorizon,
  agentForLogType,
  brainCountQueries,
  buildBrainKpis,
  companyBelongsToScope,
  companyIdsToResolve,
  computeAgentStates,
  countSessionSendsInLogs,
  diffPulses,
  logInScope,
  neutralAlertLabel,
  pickLiveSocialSession,
  planCompanyLookups,
  scopeBrainLogs,
  socialSessionHealth,
  toBrainEvents,
  toBrainLog,
  toBrainQueue,
  toBrainSpend,
  type BrainAgentId,
  type BrainCounts,
  type BrainLog
} from "@/lib/sdr/brain-model";
import { advancedNavItems, primaryNavItems } from "@/lib/constants/navigation";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../..");
const read = (file: string) => fs.readFileSync(path.join(repoRoot, file), "utf8");

const NOW = new Date("2026-11-10T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

const SCOPE = { workspaceId: "ws_a", businessId: "biz_1" };

let seq = 0;
function log(type: string, overrides: Partial<BrainLog> & { minutes?: number } = {}): BrainLog {
  const { minutes = 1, ...rest } = overrides;
  seq += 1;
  return {
    id: `log_${seq}`,
    type,
    level: "info",
    message: `RAW TECHNICAL MESSAGE ${seq} sk-live-secret`,
    workspaceId: "ws_a",
    businessId: "biz_1",
    createdAt: minutesAgo(minutes),
    ...rest
  };
}

// ── Log type → agent ────────────────────────────────────────────────────────

describe("Brain — every log type family maps to the right agent", () => {
  const table: Record<BrainAgentId, string[]> = {
    discovery: [
      "discovery.functions.run",
      "discovery.campaign.area_exhausted",
      "discovery.campaign.no_area",
      "discovery.campaign.orphaned",
      "discovery.campaign.run_failed",
      "discovery.campaign.unattributed",
      "discovery.enqueue_failed",
      "discovery.icp.fallback_used",
      "discovery.website.paid_lookup",
      "discovery.campaign.created",
      "discovery.run.completed"
    ],
    research: [
      "research.queued",
      "research.start",
      "research.completed",
      "research.failed",
      "research.website_fetch",
      "research.website_resolved",
      "research.website_not_found",
      "signals.collection.run",
      "contact_waterfall.completed",
      "contact_waterfall.dropcontact_failed",
      "contact_waterfall.skipped_small_business",
      "enrichment.website.completed",
      "enrichment.website.failed",
      "enrichment.website.missing",
      "enrichment.social.contacts_created"
    ],
    writing: [
      "outreach.generation.start",
      "outreach.generation.completed",
      "outreach.generation.failed",
      "outreach.contact_form.drafted",
      "outreach.pdf.failed",
      "pdf.generation.start",
      "pdf.generation.completed",
      "outreach.updated",
      // `outreach.${status}` from setOutreachStatus().
      "outreach.approved",
      "outreach.rejected",
      "outreach.needs_more_research"
    ],
    sending: [
      "outreach.sent",
      "outreach.contact_form.sent",
      "outreach.auto_send.failed",
      "outreach.bounced",
      "lead_bounced",
      "contact.email_undeliverable",
      "webhook.instantly.unauthorized",
      "webhook.instantly.unhandled_event"
    ],
    replies: [
      "outreach.reply_received",
      "reply_received",
      "reply.routed",
      "reply.auto_dispatched",
      "reply.human_escalated",
      "reply.queued_manual",
      "reply.queued_assisted",
      "reply.classification_error",
      "reply.routing_error",
      "reply_generator.ai_error",
      "reply_generator.context_fetch_warning",
      "reply_generator.unattributed",
      "conversation.manual_takeover",
      "conversation.takeover_released",
      "dispatcher.policy_fetch_warning"
    ],
    meetings: [
      "meeting.booked",
      "meeting.booking_conflict",
      "meeting.calendar_event_error",
      "meeting.sequence_terminated",
      "calendar.freebusy_error"
    ],
    social: [
      "social_session.started",
      "social_session.ended",
      "social_session.thread_unmatched",
      "outreach.social_dm.drafted",
      "outreach.social_dm.sent",
      "outreach.social_dm.session_blocked",
      "outreach.social_dm.skipped",
      "reply.social_draft_ready",
      "reply.social_sent"
    ],
    guardrails: [
      "suppression.unsubscribed",
      "suppression.social_unsubscribed",
      "outreach.suppressed",
      "escalation.pause_outreach_warning",
      "queue.task.completed",
      "queue.task.dead_letter",
      "queue.task.budget_exceeded",
      "queue.task.deferred_daily_limit",
      "queue.jobs.retried",
      "queue.worker.batch_completed",
      "automation.daily_research_runner",
      "automation.daily_counter_unreadable",
      "automation.calendar_sync",
      "api.spend.recorded",
      "settings.budget.updated",
      "settings.ai_secrets.saved"
    ]
  };

  for (const [agent, types] of Object.entries(table) as Array<[BrainAgentId, string[]]>) {
    it(`maps the ${agent} family`, () => {
      for (const type of types) expect(agentForLogType(type), type).toBe(agent);
    });
  }

  it("lets social win over writing, sending and replies for social types", () => {
    expect(agentForLogType("outreach.social_dm.drafted")).toBe("social");
    expect(agentForLogType("outreach.social_dm.sent")).toBe("social");
    expect(agentForLogType("reply.social_sent")).toBe("social");
    expect(agentForLogType("reply.social_draft_ready")).toBe("social");
    // A suppression stays a guardrail even when it came from a DM.
    expect(agentForLogType("suppression.social_unsubscribed")).toBe("guardrails");
    // A suppressed send is a guardrail, not a send.
    expect(agentForLogType("outreach.suppressed")).toBe("guardrails");
  });

  it("returns null for plumbing that is no agent's work, and for nothing", () => {
    for (const type of ["functions.health_check", "analytics.daily_aggregator", "export.csv", "workspace.data_purged", "", "outreach"]) {
      expect(agentForLogType(type), type).toBeNull();
    }
    expect(agentForLogType(undefined)).toBeNull();
  });

  it("makes a deliberate decision for every log type the backend emits", () => {
    const emitted = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts")) {
          for (const match of fs.readFileSync(full, "utf8").matchAll(/type: "([a-zA-Z_.]+)"/g)) emitted.add(match[1]);
        }
      }
    };
    walk(path.join(repoRoot, "functions/src"));

    // Not log types (AI request vocabulary, fixture archetypes, OAuth grant).
    const noise = new Set([
      "bloomy",
      "devcomm",
      "json_object",
      "text",
      "ephemeral",
      "disabled",
      "adaptive",
      "required",
      "pdf",
      "error",
      "rate_limit_error",
      "refresh_token"
    ]);
    // Real log types that are deliberately nobody's: platform plumbing.
    const noAgent = new Set(["functions.health_check", "analytics.daily_aggregator", "export.csv", "workspace.data_purged"]);

    const undecided = [...emitted]
      .filter((type) => type.includes(".") || type.includes("_"))
      .filter((type) => !noise.has(type) && !noAgent.has(type))
      .filter((type) => agentForLogType(type) === null);

    expect(undecided, `log types with no brain agent: ${undecided.join(", ")}`).toEqual([]);
  });
});

// ── Agent states ────────────────────────────────────────────────────────────

describe("Brain — agent states", () => {
  const byId = (logs: BrainLog[]) => new Map(computeAgentStates(logs, NOW).map((agent) => [agent.id, agent]));

  it("returns all eight agents in pipeline order, idle when nothing happened", () => {
    const agents = computeAgentStates([], NOW);
    expect(agents.map((agent) => agent.id)).toEqual(BRAIN_AGENTS.map((agent) => agent.id));
    for (const agent of agents) {
      expect(agent.status).toBe("idle");
      expect(agent.eventsLastHour).toBe(0);
      expect(agent.errorsLastHour).toBe(0);
      expect(agent.lastEventAt).toBeUndefined();
    }
  });

  it("is active when it logged in the last 10 minutes, idle after", () => {
    expect(byId([log("research.start", { minutes: 9 })]).get("research")?.status).toBe("active");
    expect(byId([log("research.start", { minutes: 11 })]).get("research")?.status).toBe("idle");
  });

  it("shows an error for 15 minutes, then goes back to normal", () => {
    expect(byId([log("reply.routing_error", { level: "error", minutes: 14 })]).get("replies")?.status).toBe("error");
    expect(byId([log("reply.routing_error", { level: "error", minutes: 16 })]).get("replies")?.status).toBe("idle");
  });

  it("ranks error above warning above active", () => {
    const states = byId([
      log("research.completed", { minutes: 1 }),
      log("research.website_fetch", { level: "warning", minutes: 5 }),
      log("discovery.functions.run", { minutes: 1 }),
      log("discovery.campaign.run_failed", { level: "warning", minutes: 3 }),
      log("discovery.enqueue_failed", { level: "error", minutes: 12 })
    ]);
    expect(states.get("research")?.status).toBe("warning");
    expect(states.get("discovery")?.status).toBe("error");
  });

  it("counts events and errors of the last hour only", () => {
    const states = byId([
      log("outreach.generation.start", { minutes: 5 }),
      log("outreach.generation.failed", { level: "error", minutes: 30 }),
      log("outreach.generation.completed", { minutes: 59 }),
      log("outreach.generation.failed", { level: "error", minutes: 61 })
    ]);
    expect(states.get("writing")?.eventsLastHour).toBe(3);
    expect(states.get("writing")?.errorsLastHour).toBe(1);
  });

  it("labels the last event with the humanized title and the company name", () => {
    const states = computeAgentStates(
      [log("research.completed", { minutes: 2, metadata: { companyId: "c1", fitScore: 88 } })],
      NOW,
      { resolveCompany: (id) => (id === "c1" ? "Atelier Nord" : undefined) }
    );
    const research = states.find((agent) => agent.id === "research");
    expect(research?.lastEventLabel).toBe("Finished researching Atelier Nord");
    expect(research?.lastEventAt?.getTime()).toBe(minutesAgo(2).getTime());
  });

  it("never exposes the raw message: hidden errors get a neutral family label", () => {
    const states = computeAgentStates([log("reply_generator.ai_error", { level: "error", minutes: 1 })], NOW);
    const replies = states.find((agent) => agent.id === "replies");
    expect(replies?.lastEventLabel).toBe("Replies agent error");
    expect(JSON.stringify(states)).not.toContain("RAW TECHNICAL");
  });

  it("labels plain background work neutrally, so a time never stands alone", () => {
    // Info logs the humanizer hides: their agent still has a last event.
    const hidden: Array<[string, BrainAgentId]> = [
      ["queue.task.completed", "guardrails"],
      ["settings.budget.updated", "guardrails"],
      ["automation.calendar_sync", "guardrails"],
      ["api.spend.recorded", "guardrails"],
      ["webhook.instantly.unhandled_event", "sending"],
      ["dispatcher.policy_fetch_warning", "replies"]
    ];
    for (const [type, agentId] of hidden) {
      const states = computeAgentStates([log(type, { minutes: 1 })], NOW);
      const agent = states.find((entry) => entry.id === agentId);
      expect(agent?.status, type).toBe("active");
      expect(agent?.lastEventAt, type).toBeInstanceOf(Date);
      expect(agent?.lastEventLabel, type).toBe(BACKGROUND_WORK_LABEL);
    }
    expect(BACKGROUND_WORK_LABEL).toBe("Background work");
    // No event at all: no label and no time.
    const idle = computeAgentStates([], NOW).find((agent) => agent.id === "guardrails");
    expect(idle?.lastEventLabel).toBeUndefined();
    expect(idle?.lastEventAt).toBeUndefined();
  });

  it("ignores logs with no usable timestamp", () => {
    const states = byId([log("research.start", { createdAt: undefined })]);
    expect(states.get("research")?.eventsLastHour).toBe(0);
  });
});

// ── Events ──────────────────────────────────────────────────────────────────

describe("Brain — event stream", () => {
  it("humanizes user-facing logs, newest first, with agent and tone", () => {
    const events = toBrainEvents(
      [
        log("outreach.sent", { minutes: 5, metadata: { companyId: "c1" } }),
        log("meeting.booked", { minutes: 1, metadata: { companyId: "c2" } }),
        log("research.failed", { minutes: 3, metadata: { companyId: "c1" } })
      ],
      (id) => ({ c1: "Atelier Nord", c2: "Maison Sud" })[id]
    );
    expect(events.map((event) => event.title)).toEqual([
      "Meeting booked with Maison Sud",
      "Could not finish researching Atelier Nord",
      "Email sent to Atelier Nord"
    ]);
    expect(events.map((event) => event.agentId)).toEqual(["meetings", "research", "sending"]);
    // A humanized "issue" is a warning even at info level.
    expect(events.map((event) => event.tone)).toEqual(["ok", "warn", "ok"]);
  });

  it("shows hidden errors and warnings with a neutral label, and drops hidden info", () => {
    const events = toBrainEvents([
      log("queue.task.dead_letter", { level: "error", minutes: 1 }),
      log("calendar.freebusy_error", { level: "warning", minutes: 2 }),
      log("queue.task.completed", { minutes: 3 }),
      log("functions.health_check", { level: "error", minutes: 4 })
    ]);
    expect(events.map((event) => [event.title, event.tone, event.agentId])).toEqual([
      ["Guardrails agent error", "error", "guardrails"],
      ["Meetings agent warning", "warn", "meetings"],
      ["System error", "error", null]
    ]);
    expect(JSON.stringify(events)).not.toContain("RAW TECHNICAL");
    expect(JSON.stringify(events)).not.toContain("sk-live");
  });

  it("keeps at most 30 events", () => {
    const logs = Array.from({ length: 45 }, (_, index) => log("research.start", { minutes: index }));
    const events = toBrainEvents(logs);
    expect(events).toHaveLength(30);
    expect(events[0].at.getTime()).toBeGreaterThan(events[29].at.getTime());
  });

  it("names the agent family in neutral labels", () => {
    expect(neutralAlertLabel("social", "warning")).toBe("Social agent warning");
    expect(neutralAlertLabel(null, "error")).toBe("System error");
  });
});

// ── Pulses ──────────────────────────────────────────────────────────────────

describe("Brain — pulses", () => {
  it("fires nothing on first load", () => {
    const logs = Array.from({ length: 60 }, (_, index) => log("research.start", { minutes: index }));
    expect(diffPulses(null, logs)).toEqual([]);
  });

  it("fires one pulse per log not seen before", () => {
    const old = [log("research.start", { minutes: 5 }), log("discovery.functions.run", { minutes: 6 })];
    const fresh = log("outreach.sent", { minutes: 0, metadata: { companyId: "c1" } });
    const pulses = diffPulses(new Set(old.map((entry) => entry.id)), [fresh, ...old], () => "Atelier Nord");
    expect(pulses).toHaveLength(1);
    expect(pulses[0]).toMatchObject({ id: fresh.id, agentId: "sending", tone: "ok", label: "Email sent to Atelier Nord" });
  });

  it("caps a batch at 12, newest first, and skips logs of no agent", () => {
    const burst = Array.from({ length: 20 }, (_, index) => log("queue.task.completed", { minutes: index }));
    const orphan = log("functions.health_check", { minutes: 0 });
    const pulses = diffPulses(new Set(), [orphan, ...burst]);
    expect(pulses).toHaveLength(12);
    expect(pulses.every((pulse) => pulse.agentId === "guardrails")).toBe(true);
    expect(pulses.some((pulse) => pulse.id === orphan.id)).toBe(false);
    expect(pulses[0].at.getTime()).toBeGreaterThanOrEqual(pulses[11].at.getTime());
    expect(pulses[0].label).toBe(BACKGROUND_WORK_LABEL);
  });

  it("carries the error tone and a neutral label", () => {
    const failure = log("reply.routing_error", { level: "error", minutes: 0 });
    const [pulse] = diffPulses(new Set(), [failure]);
    expect(pulse).toMatchObject({ agentId: "replies", tone: "error", label: "Replies agent error" });
  });
});

// ── Scope ───────────────────────────────────────────────────────────────────

describe("Brain — tenant scope (never another tenant's events)", () => {
  const owned = (map: Record<string, boolean>) => (id: string) => map[id];

  it("drops logs stamped with another workspace or another business", () => {
    expect(logInScope(log("research.start", { workspaceId: "ws_b" }), SCOPE, owned({}))).toBe(false);
    expect(logInScope(log("research.start", { businessId: "biz_2" }), SCOPE, owned({}))).toBe(false);
  });

  it("keeps workspace logs with this business or no business", () => {
    expect(logInScope(log("discovery.functions.run"), SCOPE, owned({}))).toBe(true);
    expect(logInScope(log("discovery.functions.run", { businessId: undefined }), SCOPE, owned({}))).toBe(true);
  });

  it("drops a log with no workspace stamp and no company (unprovable)", () => {
    expect(logInScope(log("discovery.functions.run", { workspaceId: undefined, businessId: undefined }), SCOPE, owned({}))).toBe(
      false
    );
  });

  it("decides a company log by the company, and waits while it is unknown", () => {
    const about = (companyId: string) => log("research.start", { businessId: undefined, metadata: { companyId } });
    const ownership = owned({ mine: true, theirs: false });
    expect(logInScope(about("mine"), SCOPE, ownership)).toBe(true);
    expect(logInScope(about("theirs"), SCOPE, ownership)).toBe(false);
    expect(logInScope(about("unknown"), SCOPE, ownership)).toBeUndefined();

    const scoped = scopeBrainLogs([about("mine"), about("theirs"), about("unknown")], SCOPE, ownership);
    expect(scoped).toHaveLength(1);
  });

  it("decides company ownership like getAgentActivity", () => {
    expect(companyBelongsToScope({ workspaceId: "ws_a", businessId: "biz_1" }, SCOPE)).toBe(true);
    expect(companyBelongsToScope({ workspaceId: "ws_a" }, SCOPE)).toBe(true);
    expect(companyBelongsToScope({ workspaceId: "ws_a", businessId: "biz_2" }, SCOPE)).toBe(false);
    expect(companyBelongsToScope({ workspaceId: "ws_b", businessId: "biz_1" }, SCOPE)).toBe(false);
    expect(companyBelongsToScope({ businessId: "biz_1" }, SCOPE)).toBe(false);
    expect(companyBelongsToScope(null, SCOPE)).toBe(false);
    expect(companyBelongsToScope({ workspaceId: "ws_a", businessId: "biz_2" }, { workspaceId: "ws_a" })).toBe(true);
  });

  it("reads at most 30 unknown companies, newest first, skipping known and foreign ones", () => {
    const logs = Array.from({ length: 50 }, (_, index) =>
      log("research.start", { minutes: index, metadata: { companyId: `c${index}` } })
    );
    logs.push(log("research.start", { minutes: 0, businessId: "biz_2", metadata: { companyId: "foreign" } }));
    logs.push(log("research.start", { minutes: 0, metadata: { companyId: "c0" } }));

    const ids = companyIdsToResolve(logs, SCOPE, (id) => id === "c1");
    expect(ids).toHaveLength(BRAIN_MAX_COMPANY_LOOKUPS);
    expect(ids[0]).toBe("c0");
    expect(ids).not.toContain("c1");
    expect(ids).not.toContain("foreign");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("plans every unknown company of a full window, so none stays hidden until the next log", () => {
    // 60 logs about 60 distinct companies: more than one lookup batch.
    const logs = Array.from({ length: 60 }, (_, index) =>
      log("research.start", { minutes: index, businessId: undefined, metadata: { companyId: `c${index}` } })
    );
    logs.push(log("research.start", { minutes: 0, businessId: "biz_2", metadata: { companyId: "foreign" } }));

    const batches = planCompanyLookups(logs, SCOPE, (id) => id === "c5");
    expect(batches.map((batch) => batch.length)).toEqual([BRAIN_MAX_COMPANY_LOOKUPS, 59 - BRAIN_MAX_COMPANY_LOOKUPS]);
    const planned = batches.flat();
    expect(planned[0]).toBe("c0");
    expect(new Set(planned).size).toBe(59);
    expect(planned).not.toContain("c5");
    expect(planned).not.toContain("foreign");

    // Once every batch is read (c5 was already known), every log is in scope:
    // nothing waits for another log to trigger a second pass.
    const ownership = (id: string) => (id === "c5" || planned.includes(id) ? true : undefined);
    expect(scopeBrainLogs(logs, SCOPE, ownership)).toHaveLength(60);
    // Nothing left to read afterwards.
    expect(planCompanyLookups(logs, SCOPE, () => true)).toEqual([]);
  });

  it("bounds each lookup batch, never reading a company twice", () => {
    const logs = Array.from({ length: 7 }, (_, index) => log("research.start", { minutes: index, metadata: { companyId: `c${index % 3}` } }));
    expect(planCompanyLookups(logs, SCOPE, () => false, 2)).toEqual([["c0", "c1"], ["c2"]]);
  });
});

// ── Untrusted rows ──────────────────────────────────────────────────────────

describe("Brain — malformed log documents never crash the page", () => {
  it("keeps a well-formed row, without its raw message", () => {
    const createdAt = minutesAgo(1);
    const row = toBrainLog("l1", {
      type: "research.start",
      level: "info",
      message: "RAW TECHNICAL sk-live-secret",
      workspaceId: "ws_a",
      businessId: "biz_1",
      createdAt,
      metadata: { companyId: "c1" }
    });
    expect(row).toEqual({
      id: "l1",
      type: "research.start",
      level: "info",
      createdAt,
      metadata: { companyId: "c1" },
      workspaceId: "ws_a",
      businessId: "biz_1"
    });
    expect(JSON.stringify(row)).not.toContain("RAW TECHNICAL");
  });

  it("drops rows whose type is not a string, or whose tenant stamp is of the wrong kind", () => {
    for (const type of [42, null, undefined, { startsWith: 1 }, ["research.start"], ""]) {
      expect(toBrainLog("l1", { type, workspaceId: "ws_a" }), String(type)).toBeNull();
    }
    expect(toBrainLog("l1", null)).toBeNull();
    expect(toBrainLog("l1", "research.start")).toBeNull();
    expect(toBrainLog("", { type: "research.start" })).toBeNull();
    expect(toBrainLog("l1", { type: "research.start", workspaceId: 7 })).toBeNull();
    expect(toBrainLog("l1", { type: "research.start", workspaceId: "ws_a", businessId: { id: "biz_1" } })).toBeNull();
  });

  it("normalises optional fields instead of trusting them", () => {
    const row = toBrainLog("l1", { type: "research.start", workspaceId: "ws_a", businessId: null, level: 3, metadata: "c1" });
    expect(row).toMatchObject({ businessId: undefined, level: undefined, metadata: undefined });
  });

  it("lets the brain run on whatever survives (a raw bad type would throw)", () => {
    const raw = [
      { id: "bad", data: { type: 123, workspaceId: "ws_a", createdAt: minutesAgo(1) } },
      { id: "good", data: { type: "research.start", workspaceId: "ws_a", businessId: "biz_1", createdAt: minutesAgo(1) } }
    ];
    expect(() => agentForLogType(123 as unknown as string)).toThrow();
    const logs = raw.map((entry) => toBrainLog(entry.id, entry.data)).filter((entry): entry is BrainLog => entry !== null);
    expect(logs.map((entry) => entry.id)).toEqual(["good"]);
    expect(() => computeAgentStates(scopeBrainLogs(logs, SCOPE, () => undefined), NOW)).not.toThrow();
  });
});

// ── Window horizon ──────────────────────────────────────────────────────────

describe("Brain — the 60-log window is never presented as a full hour", () => {
  it("has no horizon while the window holds every log", () => {
    const logs = Array.from({ length: 10 }, (_, index) => log("research.start", { minutes: index }));
    expect(activityHorizon(logs, false)).toBeUndefined();
  });

  it("reports the oldest log of a full window", () => {
    const logs = Array.from({ length: 60 }, (_, index) => log("discovery.functions.run", { minutes: index / 10 }));
    logs.push(log("discovery.functions.run", { createdAt: undefined }));
    expect(activityHorizon(logs, true)?.getTime()).toBe(minutesAgo(5.9).getTime());
    expect(activityHorizon([], true)).toBeUndefined();
  });
});

// ── KPIs ────────────────────────────────────────────────────────────────────

describe("Brain — KPIs come from equality counts only", () => {
  it("scopes every count by workspace and business, with equality filters", () => {
    const queries = brainCountQueries(SCOPE);
    for (const spec of queries) {
      expect(spec.equals[0]).toEqual(["workspaceId", "ws_a"]);
      if (!spec.key.startsWith("attentionUnattributed")) {
        expect(spec.equals).toContainEqual(["businessId", "biz_1"]);
      }
    }
    const byKey = new Map(queries.map((spec) => [spec.key, spec]));
    expect(byKey.get("drafts")).toMatchObject({ collection: "outreach", equals: expect.arrayContaining([["status", "draft"]]) });
    expect(byKey.get("researched")).toMatchObject({ collection: "leadResearch" });
    expect(byKey.get("attentionUnattributed")?.equals).toEqual([
      ["workspaceId", "ws_a"],
      ["needsAttribution", true],
      ["unreadHumanAttention", true]
    ]);
  });

  it("does not add business filters or unattributed counts without a business", () => {
    const queries = brainCountQueries({ workspaceId: "ws_a" });
    expect(queries.some((spec) => spec.equals.some(([field]) => field === "businessId"))).toBe(false);
    expect(queries.some((spec) => spec.key.startsWith("attentionUnattributed"))).toBe(false);
  });

  const full: BrainCounts = {
    companies: 120,
    researched: 80,
    drafts: 12,
    outreachSent: 30,
    outreachReplied: 4,
    conversationsInDialogue: 3,
    conversationsEscalated: 1,
    conversationsInReview: 0,
    conversationsMeetingBooked: 2,
    meetings: 5,
    meetingsCancelled: 1,
    attention: 4,
    attentionSuppressed: 1,
    attentionUnattributed: 2,
    attentionUnattributedSuppressed: 0
  };

  it("builds the seven KPIs from the counts", () => {
    const kpis = new Map(buildBrainKpis(full, SCOPE).map((kpi) => [kpi.id, kpi]));
    expect([...kpis.keys()]).toEqual(["companies", "researched", "ready", "sent", "replies", "meetings", "needsYou"]);
    expect(kpis.get("companies")?.value).toBe(120);
    expect(kpis.get("researched")?.value).toBe(80);
    expect(kpis.get("ready")?.value).toBe(12);
    expect(kpis.get("sent")?.value).toBe(34);
    expect(kpis.get("replies")?.value).toBe(6);
    expect(kpis.get("meetings")?.value).toBe(4);
    expect(kpis.get("needsYou")?.value).toBe(5);
    expect(kpis.get("needsYou")?.label).toBe("Needs you");
  });

  it("ignores unattributed counts when no business is selected", () => {
    const kpis = new Map(buildBrainKpis(full, { workspaceId: "ws_a" }).map((kpi) => [kpi.id, kpi]));
    expect(kpis.get("needsYou")?.value).toBe(3);
  });

  it("renders null (—), never zero, when a count failed", () => {
    const kpis = new Map(buildBrainKpis({ ...full, outreachReplied: null, meetingsCancelled: undefined }, SCOPE).map((k) => [k.id, k]));
    expect(kpis.get("sent")?.value).toBeNull();
    expect(kpis.get("meetings")?.value).toBeNull();
    expect(kpis.get("companies")?.value).toBe(120);
    expect(buildBrainKpis({}, SCOPE).every((kpi) => kpi.value === null)).toBe(true);
  });

  it("never goes below zero when counts are read a moment apart", () => {
    const kpis = new Map(buildBrainKpis({ ...full, meetings: 1, meetingsCancelled: 2 }, SCOPE).map((k) => [k.id, k]));
    expect(kpis.get("meetings")?.value).toBe(0);
  });
});

// ── Health ──────────────────────────────────────────────────────────────────

describe("Brain — health", () => {
  it("reads queue and spend from the callable summaries, or null", () => {
    const summary = { pending: 3, running: 1, completed: 9, failed: 2, deadLetter: 0, todaySpendUsd: 0.42, dailyBudgetCapUsd: 5 };
    expect(toBrainQueue(summary)).toEqual({ pending: 3, running: 1, failed: 2, deadLetter: 0 });
    expect(toBrainSpend(summary)).toEqual({ todayUsd: 0.42, dailyCapUsd: 5 });
    expect(toBrainQueue({ pending: 3 })).toBeNull();
    expect(toBrainSpend(null)).toBeNull();
    expect(toBrainSpend({ todaySpendUsd: Number.NaN, dailyBudgetCapUsd: 5 })).toBeNull();
  });

  const session = (overrides: Record<string, unknown>) => ({
    id: "s1",
    workspaceId: "ws_a",
    businessId: "biz_1",
    network: "instagram",
    status: "running",
    startedAt: minutesAgo(10),
    sent: 0,
    ...overrides
  });

  it("picks the newest running session of this scope", () => {
    const live = pickLiveSocialSession(
      [session({ id: "old", startedAt: minutesAgo(40) }), session({ id: "new", network: "facebook" })],
      SCOPE,
      NOW
    );
    expect(live).toMatchObject({ id: "new", network: "facebook" });
  });

  it("ignores ended, foreign, stale or unknown-network sessions", () => {
    expect(pickLiveSocialSession([session({ status: "ended" })], SCOPE, NOW)).toBeNull();
    expect(pickLiveSocialSession([session({ businessId: "biz_2" })], SCOPE, NOW)).toBeNull();
    expect(pickLiveSocialSession([session({ workspaceId: "ws_b" })], SCOPE, NOW)).toBeNull();
    expect(pickLiveSocialSession([session({ startedAt: minutesAgo(13 * 60) })], SCOPE, NOW)).toBeNull();
    expect(pickLiveSocialSession([session({ network: "tiktok" })], SCOPE, NOW)).toBeNull();
    expect(pickLiveSocialSession([], SCOPE, NOW)).toBeNull();
  });

  it("counts a running session's sends from stamped outreach, with the log window as a floor", () => {
    const live = pickLiveSocialSession([session({})], SCOPE, NOW);
    expect(live).not.toBeNull();
    if (!live) return;
    expect(socialSessionHealth(live, 7).sent).toBe(7);

    const logs = [
      log("outreach.social_dm.sent", { metadata: { sessionId: "s1" } }),
      log("outreach.social_dm.sent", { metadata: { sessionId: "s1" } }),
      log("outreach.social_dm.sent", { metadata: { sessionId: "other" } })
    ];
    expect(countSessionSendsInLogs(logs, "s1")).toBe(2);
    expect(socialSessionHealth(live, null, logs).sent).toBe(2);
    expect(socialSessionHealth({ ...live, recordedSent: 9 }, 7).sent).toBe(9);
  });

  it("flags the log-window fallback as a floor, never as an exact total", () => {
    const live = pickLiveSocialSession([session({})], SCOPE, NOW);
    if (!live) throw new Error("expected a live session");
    const logs = [log("outreach.social_dm.sent", { metadata: { sessionId: "s1" } })];
    expect(socialSessionHealth(live, null, logs)).toMatchObject({ sent: 1, sentIsFloor: true });
    expect(socialSessionHealth(live, null, [])).toMatchObject({ sent: 0, sentIsFloor: true });
    expect(socialSessionHealth(live, 4, logs)).toMatchObject({ sent: 4, sentIsFloor: false });
    expect(socialSessionHealth(live, 0, logs)).toMatchObject({ sent: 0, sentIsFloor: false });
  });
});

// ── Wiring and contracts ───────────────────────────────────────────────────

describe("Brain — cost and UX contracts", () => {
  const hook = read("src/features/brain/use-brain.ts");
  const model = read("src/lib/sdr/brain-model.ts");

  it("is a primary surface (owner's request, 2026-11-10), not duplicated under Advanced", () => {
    expect(primaryNavItems.map((item) => item.href)).toContain("/app/brain");
    expect(advancedNavItems.map((item) => item.href)).not.toContain("/app/brain");
    expect(fs.existsSync(path.join(repoRoot, "src/app/(app)/app/brain/page.tsx"))).toBe(true);
  });

  it("holds exactly one live listener, on the newest 60 workspace logs", () => {
    expect(hook.match(/onSnapshot\(/g)).toHaveLength(1);
    expect(hook).toContain("const LOG_WINDOW = 60;");
    expect(hook).toMatch(/where\("workspaceId", "==", workspaceId\),\s*orderBy\("createdAt", "desc"\),\s*limit\(LOG_WINDOW\)/);
  });

  it("counts with aggregations and reads companies one document at a time", () => {
    expect(hook).toContain("getCountFromServer");
    expect(hook).toContain("getDoc(doc(db, collections.companies, id))");
    // The only getDocs is the running-session query, capped at 5.
    expect(hook.match(/getDocs\(/g)).toHaveLength(1);
    expect(hook).toMatch(/where\("status", "==", "running"\), limit\(5\)/);
    expect(model).not.toMatch(/where\([^)]*"(<|<=|>|>=|!=|in|not-in|array-contains)"/);
  });

  it("refreshes counts at most every minute and callables every two, and stops when hidden", () => {
    expect(hook).toContain("const COUNTS_EVERY_MS = 60_000;");
    expect(hook).toContain("const HEALTH_EVERY_MS = 120_000;");
    expect(hook).toContain("visibilitychange");
    expect(hook).toContain("if (!key || !visible) return;");
    expect(hook).toContain("unsubscribe?.();");
    expect(hook).toContain("clearInterval(clockTimer);");
  });

  it("resolves every company of the window in one pass, batch by batch", () => {
    expect(hook).toContain("planCompanyLookups(logs, scope, isKnown, BRAIN_MAX_COMPANY_LOOKUPS)");
    expect(hook).toMatch(/for \(const ids of batches\)/);
    expect(hook).not.toContain("companyIdsToResolve(");
  });

  it("sanitises every log row and never casts a raw document", () => {
    expect(hook).toMatch(/toBrainLog\(entry\.id, entry\.data\(\{ serverTimestamps: "estimate" \}\)\)/);
    expect(hook).not.toMatch(/as BrainLog\b/);
  });

  it("exposes the window horizon from the raw listener size", () => {
    expect(hook).toContain("snapshot.size >= LOG_WINDOW");
    expect(hook).toContain("activitySince: data.logs ? activityHorizon(data.logs, data.windowFull) : undefined");
  });

  it("flags workspace-wide queue counts when a business is selected", () => {
    expect(hook).toContain("queueAllBusinesses: Boolean(brainScope.businessId)");
  });

  it("stamps pulses on receipt and arms them only after a server delivery", () => {
    expect(hook).toMatch(/const receivedAt = new Date\(\);/);
    expect(hook).toMatch(/\.map\(\(pulse\) => \(\{ \.\.\.pulse, receivedAt \}\)\)/);
    expect(hook).toMatch(/let armed = false;/);
    expect(hook).toMatch(/const previous = armed \? known : null;/);
    expect(hook).toMatch(/if \(fromServer\) armed = true;/);
  });

  it("never renders a raw log message and stays business-agnostic", () => {
    for (const source of [hook, model]) {
      expect(source).not.toMatch(/\.message\b/);
      expect(source).not.toMatch(/bloomy|devcomm|florist/i);
      expect(source).not.toMatch(/businessId\s*===\s*["']biz_/);
    }
  });
});
