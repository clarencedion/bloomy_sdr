"use client";

/**
 * The key numbers, as one hairline-divided strip in the app's figure style:
 * value first, label below (as on Home and Campaigns). Meetings is the outcome
 * and reads emerald; "Needs you" turns amber and links to the Inbox when a
 * conversation waits. A figure that could not be read is "—", never 0.
 */

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { BrainKpi } from "@/lib/sdr/brain-model";
import { cn } from "@/lib/utils";
import { EMPTY_VALUE, formatCount } from "./brain-format";
import { DeltaChip, RollingNumber } from "./brain-number";

const SKELETON_CELLS = 7;

/*
 * A phone gets three compact columns (Needs you takes a full row), so the
 * figures stay one glance tall and the agents show above the fold. Cells there
 * read like Health's queue cells (11px label, text-lg value); a label too long
 * for a narrow phone wraps rather than being cut, and values stay top-aligned.
 */
const GRID =
  "grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-100 sm:grid-cols-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7";
const NEEDS_YOU_SPAN = "col-span-3 sm:col-span-2 md:col-span-3 lg:col-span-2 xl:col-span-1";
const CELL = "relative flex flex-col-reverse justify-end bg-white px-2.5 py-3 sm:px-4 sm:py-4";
const VALUE =
  "flex items-baseline gap-1.5 text-lg font-semibold leading-6 tracking-tight tabular-nums text-slate-900 sm:text-2xl sm:leading-8";
const LABEL = "mt-0.5 line-clamp-2 text-[11px] leading-4 sm:line-clamp-1 sm:text-[13px] sm:leading-normal";
const LINK =
  "absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

function KpiValue({ kpi, tone }: { kpi: BrainKpi; tone: "plain" | "outcome" | "attention" }) {
  if (kpi.value === null) {
    return (
      <>
        <span className="text-slate-300" aria-hidden>
          {EMPTY_VALUE}
        </span>
        <span className="sr-only">Not available</span>
      </>
    );
  }
  return (
    <>
      <RollingNumber value={kpi.value} text={formatCount(kpi.value)} />
      <DeltaChip value={kpi.value} tone={tone === "attention" ? "attention" : "ok"} />
    </>
  );
}

export function BrainKpis({ kpis, stalled = false }: { kpis: BrainKpi[] | null; stalled?: boolean }) {
  if (!kpis) {
    return (
      <section aria-label="Key numbers" aria-busy={!stalled || undefined}>
        <div aria-hidden className={GRID}>
          {Array.from({ length: SKELETON_CELLS }, (_, index) => (
            <div key={index} className={cn(CELL, index === SKELETON_CELLS - 1 && NEEDS_YOU_SPAN)}>
              {/* The real label's line box, so nothing moves when the numbers land. */}
              <span className={cn(LABEL, "relative block")}>
                {"\u00a0"}
                <span
                  className={cn(
                    "absolute left-0 top-1/2 h-3 w-16 -translate-y-1/2 rounded bg-slate-100 sm:w-20",
                    !stalled && "motion-safe:animate-pulse"
                  )}
                />
              </span>
              <span className={VALUE}>
                {stalled ? (
                  <span className="text-slate-300">{EMPTY_VALUE}</span>
                ) : (
                  <span className="h-6 w-10 rounded-md bg-slate-100 motion-safe:animate-pulse sm:h-8 sm:w-12" />
                )}
              </span>
            </div>
          ))}
        </div>
        {stalled && <p className="sr-only">Key numbers not available.</p>}
      </section>
    );
  }

  if (kpis.length === 0) return null;

  return (
    <section aria-label="Key numbers">
      <dl className={GRID}>
        {kpis.map((kpi) => {
          const meetings = kpi.id === "meetings";
          const needsYou = kpi.id === "needsYou";
          const attention = needsYou && typeof kpi.value === "number" && kpi.value > 0;
          const href = meetings ? "/app/meetings" : attention ? "/app/inbox" : null;
          const tone = attention ? "attention" : meetings ? "outcome" : "plain";
          return (
            <div
              key={kpi.id}
              className={cn(
                CELL,
                needsYou && NEEDS_YOU_SPAN,
                href && "transition-colors",
                meetings && "hover:bg-slate-50",
                attention && "bg-amber-50 hover:bg-amber-100/60"
              )}
            >
              <dt
                className={cn(LABEL, attention ? "text-amber-800" : "text-slate-500")}
                title={kpi.hint}
              >
                {kpi.label}
              </dt>
              <dd
                className={cn(
                  VALUE,
                  meetings && kpi.value !== null && "text-emerald-600",
                  attention && "text-amber-700"
                )}
              >
                <KpiValue kpi={kpi} tone={tone} />
                {href && (
                  <>
                    <ArrowUpRight
                      className={cn(
                        "absolute right-2.5 top-2.5 size-3.5 sm:right-3 sm:top-3",
                        attention ? "text-amber-500" : "text-slate-300"
                      )}
                      aria-hidden
                    />
                    <Link href={href} className={LINK}>
                      <span className="sr-only">{meetings ? "Open meetings" : "Open the inbox"}</span>
                    </Link>
                  </>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
