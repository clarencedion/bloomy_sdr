"use client";

/**
 * Health: the work queue, today's AI spend against its cap, and the running
 * social session. A section that could not be read says so ("Unavailable",
 * "—"); nothing defaults to zero. The queue is shared by every business of the
 * workspace, and says so when a single business is selected.
 */

import { AtSign, Coins, Layers } from "lucide-react";
import type { BrainHealth as BrainHealthData } from "@/lib/sdr/brain-model";
import { cn } from "@/lib/utils";
import { EMPTY_VALUE, formatCount, formatRelativeTime, formatUsd, socialSentLabel, spendGauge } from "./brain-format";
import { NETWORK_LABEL, Ping } from "./brain-meta";
import { RollingNumber } from "./brain-number";

function SectionTitle({
  icon: Icon,
  children,
  status
}: {
  icon: typeof Layers;
  children: React.ReactNode;
  status?: React.ReactNode;
}) {
  return (
    // One row at every width: the status never drops above or below its figure.
    // A narrow column truncates the eyebrow instead.
    <div className="flex flex-nowrap items-center justify-between gap-2">
      <h3 className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        <Icon className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{children}</span>
      </h3>
      {status}
    </div>
  );
}

function StateNote({ tone = "muted", children }: { tone?: "muted" | "quiet" | "ok" | "warn" | "error"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "shrink-0 text-[12px] font-medium tabular-nums",
        tone === "ok" && "text-emerald-600",
        tone === "warn" && "text-amber-600",
        tone === "error" && "text-rose-600",
        tone === "muted" && "text-slate-500",
        tone === "quiet" && "text-slate-400"
      )}
    >
      {children}
    </span>
  );
}

const ALL_BUSINESSES_NOTE = {
  text: "All businesses",
  title: "The work queue is shared: these counts cover every business in the workspace, not only this one."
};

function QueueSection({ queue, allBusinesses }: { queue: BrainHealthData["queue"]; allBusinesses: boolean }) {
  const cells = [
    { key: "pending", label: "Pending", value: queue?.pending, alert: false, title: "Tasks waiting to run" },
    { key: "running", label: "Running", value: queue?.running, alert: false, title: "Tasks running now" },
    { key: "failed", label: "Failed", value: queue?.failed, alert: (queue?.failed ?? 0) > 0, title: "Tasks that failed" },
    {
      key: "deadLetter",
      label: "Gave up",
      value: queue?.deadLetter,
      alert: (queue?.deadLetter ?? 0) > 0,
      title: "Dead letter: stopped after every retry"
    }
  ];
  const troubled = queue ? queue.failed + queue.deadLetter > 0 : false;

  return (
    <section className="px-5 py-4">
      <SectionTitle
        icon={Layers}
        status={
          queue === undefined ? (
            <StateNote tone="quiet">Loading…</StateNote>
          ) : queue === null ? (
            <StateNote tone="warn">Unavailable</StateNote>
          ) : troubled ? (
            <StateNote tone="error">Needs a look</StateNote>
          ) : (
            <StateNote tone="ok">Healthy</StateNote>
          )
        }
      >
        Work queue
      </SectionTitle>
      <dl className="mt-3 grid grid-cols-4 gap-1.5 lg:grid-cols-2">
        {cells.map((cell) => (
          <div
            key={cell.key}
            title={cell.title}
            className={cn("min-w-0 rounded-lg px-2.5 py-2 transition-colors duration-200", cell.alert ? "bg-rose-50" : "bg-slate-50")}
          >
            <dt className={cn("truncate text-[11px]", cell.alert ? "text-rose-600" : "text-slate-500")}>{cell.label}</dt>
            <dd
              className={cn(
                "mt-0.5 text-lg font-semibold leading-6 tabular-nums",
                queue ? (cell.alert ? "text-rose-700" : "text-slate-900") : "text-slate-300"
              )}
            >
              {queue ? (
                <RollingNumber value={cell.value} text={formatCount(cell.value)} />
              ) : (
                <>
                  <span aria-hidden>{EMPTY_VALUE}</span>
                  <span className="sr-only">Not available</span>
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {allBusinesses && (
        <p className="mt-2 text-[12px] text-slate-400" title={ALL_BUSINESSES_NOTE.title}>
          {ALL_BUSINESSES_NOTE.text} · one shared queue
        </p>
      )}
    </section>
  );
}

const TRACK = { ok: "bg-slate-100", warn: "bg-amber-100", error: "bg-rose-100" } as const;
const FILL = { ok: "bg-slate-900", warn: "bg-amber-500", error: "bg-rose-500" } as const;

function SpendSection({ spend }: { spend: BrainHealthData["spend"] }) {
  const gauge = spendGauge(spend);
  const tone = gauge?.tone ?? "ok";
  const ratio = gauge?.ratio ?? null;

  return (
    <section className="px-5 py-4">
      <SectionTitle
        icon={Coins}
        status={
          spend === undefined ? (
            <StateNote tone="quiet">Loading…</StateNote>
          ) : spend === null ? (
            <StateNote tone="warn">Unavailable</StateNote>
          ) : gauge?.percent !== null && gauge?.percent !== undefined ? (
            gauge.tone === "error" ? (
              <StateNote tone="error">Cap reached</StateNote>
            ) : (
              <StateNote tone={gauge.tone === "warn" ? "warn" : "muted"}>{gauge.percent}% of cap</StateNote>
            )
          ) : (
            <StateNote tone="quiet">No daily cap</StateNote>
          )
        }
      >
        AI spend today
      </SectionTitle>
      <p className="mt-3 flex items-baseline gap-1.5">
        <span
          className={cn(
            "text-2xl font-semibold leading-none tracking-tight tabular-nums",
            spend ? "text-slate-900" : "text-slate-300"
          )}
        >
          {spend ? formatUsd(spend.todayUsd) : EMPTY_VALUE}
        </span>
        {spend && ratio !== null && (
          <span className="text-[13px] tabular-nums text-slate-500">of {formatUsd(spend.dailyCapUsd)}</span>
        )}
      </p>
      <div
        className={cn("mt-3 h-1.5 overflow-hidden rounded-full", TRACK[tone])}
        role="meter"
        aria-label="AI spend today against the daily cap"
        aria-valuemin={0}
        aria-valuemax={spend && ratio !== null ? spend.dailyCapUsd : undefined}
        aria-valuenow={spend ? spend.todayUsd : undefined}
        aria-valuetext={
          spend
            ? ratio !== null
              ? `${formatUsd(spend.todayUsd)} of ${formatUsd(spend.dailyCapUsd)}`
              : `${formatUsd(spend.todayUsd)}, no daily cap`
            : "Not available"
        }
      >
        {ratio !== null && (
          // Moves by transform (compositor only, keeps the rounded cap); no entrance animation.
          <div
            className={cn(
              "h-full w-full rounded-full transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
              FILL[tone]
            )}
            style={{ transform: `translateX(${(Math.max(ratio, ratio > 0 ? 0.02 : 0) - 1) * 100}%)` }}
          />
        )}
      </div>
    </section>
  );
}

function SocialSection({ session, now, live }: { session: BrainHealthData["socialSession"]; now: Date; live: boolean }) {
  return (
    <section className="px-5 py-4">
      <SectionTitle icon={AtSign}>Social session</SectionTitle>
      {session === undefined ? (
        <p className="mt-3 text-[13px] text-slate-400">
          <span aria-hidden>{EMPTY_VALUE}</span>
          <span className="sr-only">Not available</span>
        </p>
      ) : session === null ? (
        <p className="mt-3 text-[13px] text-slate-500">None running</p>
      ) : (
        <div className="mt-3 flex items-start gap-2.5">
          <span className="relative mt-[5px] flex size-2 shrink-0" aria-hidden>
            {live && <Ping className="bg-emerald-500" />}
            <span className="relative size-2 rounded-full bg-emerald-500" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-slate-800">{NETWORK_LABEL[session.network]} session running</p>
            <p className="mt-0.5 truncate text-[12px] tabular-nums text-slate-500">
              {socialSentLabel(session)} · started {formatRelativeTime(session.startedAt, now)}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function HealthSkeleton({ stalled }: { stalled: boolean }) {
  const pulse = !stalled && "motion-safe:animate-pulse";
  return (
    <div
      aria-hidden
      className="divide-y divide-slate-100 lg:grid lg:grid-cols-3 lg:divide-x lg:divide-y-0 xl:block xl:divide-x-0 xl:divide-y"
    >
      {[0, 1, 2].map((section) => (
        <div key={section} className="px-5 py-4">
          <span className={cn("block h-3 w-24 rounded bg-slate-100", pulse)} />
          {section === 0 ? (
            <span className="mt-3 grid grid-cols-4 gap-1.5 lg:grid-cols-2">
              {[0, 1, 2, 3].map((cell) => (
                <span key={cell} className={cn("flex h-[60px] items-end rounded-lg bg-slate-50 px-2.5 py-2", pulse)}>
                  {stalled && <span className="text-lg font-semibold leading-6 text-slate-300">{EMPTY_VALUE}</span>}
                </span>
              ))}
            </span>
          ) : (
            <span className={cn("mt-3 block h-6 w-20 rounded", stalled ? "" : "bg-slate-100", pulse)}>
              {stalled && <span className="text-2xl font-semibold leading-6 text-slate-300">{EMPTY_VALUE}</span>}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Stacked sections on a phone, three columns beside each other from lg, and a
 * narrow stacked column again at xl where it sits beside the live activity.
 */
export function BrainHealth({
  health,
  now,
  stalled = false,
  live = true
}: {
  health: BrainHealthData | null;
  now: Date;
  stalled?: boolean;
  /** The live feed is connected: only then does the running session's dot ping. */
  live?: boolean;
}) {
  return (
    <section aria-label="Health" className="rounded-xl border border-slate-200 bg-white">
      <h2 className="border-b border-slate-100 px-5 py-3 text-sm font-semibold text-slate-900">Health</h2>
      {health ? (
        // Equal thirds: at the narrowest lg width (1024) every column still holds
        // its header on one row ("AI spend today · 37% of cap" needs ~197px).
        <div className="divide-y divide-slate-100 lg:grid lg:grid-cols-3 lg:divide-x lg:divide-y-0 xl:block xl:divide-x-0 xl:divide-y">
          <QueueSection queue={health.queue} allBusinesses={health.queueAllBusinesses === true} />
          <SpendSection spend={health.spend} />
          <SocialSection session={health.socialSession} now={now} live={live} />
        </div>
      ) : (
        <HealthSkeleton stalled={stalled} />
      )}
    </section>
  );
}
