"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { journeyStages } from "@/lib/constants/navigation";
import type { CampaignFunnel } from "@/lib/sdr/aggregations";

/**
 * The SDR journey, rendered as proportional bars so a business owner can see
 * at a glance where prospects are and where they drop off.
 */
export function JourneyBars({ funnel }: { funnel: CampaignFunnel }) {
  const max = Math.max(funnel.found, 1);

  return (
    <div className="space-y-3">
      {journeyStages.map((stage) => {
        const value = funnel[stage.key];
        const pct = Math.min(100, Math.round((value / max) * 100));

        return (
          <div key={stage.key} className="flex items-center gap-4">
            <div className="w-28 shrink-0 text-[13px] font-medium text-slate-500 sm:w-36">{stage.label}</div>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  stage.key === "meetings" ? "bg-emerald-500" : "bg-slate-900"
                )}
                style={{ width: `${value === 0 ? 0 : Math.max(pct, 2)}%` }}
              />
            </div>
            <div className="w-10 shrink-0 text-right text-sm font-semibold tabular-nums text-slate-900">
              {value}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Headline counts. Meetings booked is the outcome metric and is always
 * emphasised over operational counts.
 */
export function JourneyStats({ funnel, className }: { funnel: CampaignFunnel; className?: string }) {
  const stats = [
    { label: "companies found", value: funnel.found },
    { label: "good opportunities", value: funnel.qualified },
    { label: "people found", value: funnel.peopleFound },
    { label: "contacted", value: funnel.contacted },
    { label: "replies", value: funnel.replies },
    { label: "meetings", value: funnel.meetings, highlight: true }
  ];

  return (
    <div className={cn("grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6", className)}>
      {stats.map((stat) => (
        <div key={stat.label}>
          <div
            className={cn(
              "text-3xl font-semibold tabular-nums tracking-tight",
              stat.highlight ? "text-emerald-600" : "text-slate-900"
            )}
          >
            {stat.value}
          </div>
          <div className="mt-0.5 text-[13px] text-slate-500">{stat.label}</div>
        </div>
      ))}
    </div>
  );
}

/** Compact roll-up used on Home, where meetings is the only number that matters. */
export function OutcomeSummary({
  funnel,
  needsAttention,
  upcomingMeetings
}: {
  funnel: CampaignFunnel;
  needsAttention: number;
  upcomingMeetings: number;
}) {
  const items = [
    { label: "meetings booked", value: funnel.meetings, href: "/app/meetings", tone: "emerald" as const },
    { label: "conversations", value: funnel.replies, href: "/app/inbox", tone: "slate" as const },
    { label: "being contacted", value: funnel.contacted, href: "/app/campaigns", tone: "slate" as const },
    { label: "upcoming meetings", value: upcomingMeetings, href: "/app/meetings", tone: "slate" as const }
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          className="rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300"
        >
          <div
            className={cn(
              "text-2xl font-semibold tabular-nums",
              item.tone === "emerald" ? "text-emerald-600" : "text-slate-900"
            )}
          >
            {item.value}
          </div>
          <div className="mt-0.5 text-[13px] text-slate-500">{item.label}</div>
        </Link>
      ))}
      {needsAttention > 0 && (
        <Link
          href="/app/inbox"
          className="col-span-2 rounded-xl border border-amber-200 bg-amber-50 p-4 transition-colors hover:border-amber-300 lg:col-span-4"
        >
          <span className="text-sm font-medium text-amber-900">
            {needsAttention} {needsAttention === 1 ? "conversation needs" : "conversations need"} your attention
          </span>
        </Link>
      )}
    </div>
  );
}
