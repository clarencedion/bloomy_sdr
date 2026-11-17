"use client";

/**
 * The selected agent, in one compact row: who it is, what it does, what is
 * wrong (only when something is), and where to act on its work. Everything
 * else (status, rate, last action) is already on the node, and its history is
 * the filtered Live activity, so it is not repeated here.
 *
 * Shared by the map's inspector (a row under the canvas) and the phone spine's
 * disclosure (under the row that already shows the name and status).
 */

import Link from "next/link";
import { ArrowUpRight, X } from "lucide-react";
import { agentLabel, type BrainAgentId, type BrainAgentState, type BrainHealth } from "@/lib/sdr/brain-model";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AGENT_ACTIONS,
  NO_RECENT_DATA,
  agentErrorsText,
  agentStatusKnown,
  formatCount,
  formatRelativeTime,
  lastEventText,
  socialSentLabel,
  statusLabel,
  type ActivityCoverage
} from "./brain-format";
import { AGENT_ICONS, NETWORK_LABEL } from "./brain-meta";

export type SocialSession = NonNullable<BrainHealth["socialSession"]>;

/** The accessible name of an agent's node: status, hourly figures, last event. */
export function nodeAriaLabel(
  id: BrainAgentId,
  agent: BrainAgentState | undefined,
  now: Date,
  coverage: ActivityCoverage,
  session?: SocialSession | null
): string {
  if (!agent) return `${agentLabel(id)}: no data.`;
  const status = agentStatusKnown(agent, coverage) ? statusLabel(agent.status) : NO_RECENT_DATA;
  const counts = `${formatCount(agent.eventsLastHour)} events and ${formatCount(agent.errorsLastHour)} errors in the last hour.`;
  const parts = [
    `${agent.label}: ${status}.`,
    coverage.hour ? counts : `At least ${counts}`,
    `Last: ${lastEventText(agent, coverage)}${agent.lastEventAt ? `, ${formatRelativeTime(agent.lastEventAt, now)}` : ""}.`
  ];
  if (id === "social" && session) parts.push(`${NETWORK_LABEL[session.network]} session running, ${socialSentLabel(session)}.`);
  return parts.join(" ");
}

/** "Instagram · 3+ sent" beside a small dot, for the social agent while a session runs. */
export function SessionLine({ session, className }: { session: SocialSession; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 tabular-nums", className)}>
      <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
      <span className="truncate">
        {NETWORK_LABEL[session.network]} · {socialSentLabel(session)}
      </span>
    </span>
  );
}

/** The one place to act on this agent's work: a quiet link on the app's ghost button. */
function AgentAction({ id, className }: { id: BrainAgentId; className?: string }) {
  const action = AGENT_ACTIONS[id];
  return (
    <Button
      asChild
      variant="ghost"
      size="sm"
      className={cn("shrink-0 gap-1 text-[13px] text-slate-600 hover:bg-slate-100 hover:text-slate-900", className)}
    >
      <Link href={action.href}>
        {action.label}
        <ArrowUpRight className="!size-3.5 text-slate-400" aria-hidden />
      </Link>
    </Button>
  );
}

export function AgentDetailFields({
  id,
  agent,
  coverage,
  session,
  layout,
  onClose,
  onShowInActivity
}: {
  id: BrainAgentId;
  agent: BrainAgentState | undefined;
  coverage: ActivityCoverage;
  session?: SocialSession | null;
  layout: "row" | "stack";
  onClose?: () => void;
  onShowInActivity?: () => void;
}) {
  const Icon = AGENT_ICONS[id];
  const label = agent?.label ?? agentLabel(id);
  const role = agent?.role ?? "—";
  const errors = agentErrorsText(agent?.errorsLastHour, coverage.hour);
  const runningSession = id === "social" && session ? session : null;

  if (layout === "stack") {
    // The row above already says the name, status, rate and last action.
    return (
      <div className="space-y-1">
        <p className="text-[13px] leading-5 text-slate-500">{role}</p>
        {/* Its own row: a "·" before it would dangle at the end of a wrapped line. */}
        {runningSession && (
          <p className="flex min-w-0 flex-wrap items-center text-[13px] leading-5 text-slate-500">
            <SessionLine session={runningSession} />
          </p>
        )}
        {errors && <p className="text-[13px] font-medium leading-5 text-rose-700">{errors}</p>}
        <div className="-ml-3 flex flex-wrap items-center gap-1 pt-1">
          <AgentAction id={id} />
          {onShowInActivity && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onShowInActivity}
              className="text-[13px] text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              Show activity
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600" aria-hidden>
        <Icon className="size-4" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold leading-5 text-slate-900">{label}</p>
        <p className="flex min-w-0 items-center gap-1.5 text-[12px] leading-4 text-slate-500">
          <span className="truncate">{role}</span>
          {errors && (
            <>
              <span aria-hidden>·</span>
              <span className="shrink-0 font-medium text-rose-700">{errors}</span>
            </>
          )}
          {runningSession && (
            <>
              <span aria-hidden>·</span>
              <SessionLine session={runningSession} />
            </>
          )}
        </p>
      </div>
      <AgentAction id={id} />
      {onClose && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-slate-400 hover:text-slate-700"
          aria-label="Close details"
          onClick={onClose}
        >
          <X className="size-4" aria-hidden />
        </Button>
      )}
    </div>
  );
}
