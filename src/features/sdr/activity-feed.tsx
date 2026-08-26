"use client";

import { Building2, CalendarCheck, Mail, MessageSquare, Search, TriangleAlert, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActivityTone, HumanActivityEvent } from "@/lib/sdr/activity-humanizer";

const TONES: Record<ActivityTone, { icon: React.ElementType; className: string }> = {
  found: { icon: Building2, className: "bg-slate-100 text-slate-600" },
  research: { icon: Search, className: "bg-violet-50 text-violet-600" },
  person: { icon: UserRound, className: "bg-sky-50 text-sky-600" },
  email: { icon: Mail, className: "bg-blue-50 text-blue-600" },
  reply: { icon: MessageSquare, className: "bg-indigo-50 text-indigo-600" },
  meeting: { icon: CalendarCheck, className: "bg-emerald-50 text-emerald-600" },
  issue: { icon: TriangleAlert, className: "bg-amber-50 text-amber-600" }
};

function timeLabel(date: Date | null): string {
  if (!date) return "";
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function dayHeading(date: Date | null, now: Date): string {
  if (!date) return "Earlier";
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const diff = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "long" });
}

/**
 * Human-readable record of what the SDR did. Technical events are filtered out
 * upstream by `humanizeActivityFeed`.
 */
export function ActivityFeed({
  events,
  emptyMessage = "Nothing has happened yet.",
  now = new Date()
}: {
  events: HumanActivityEvent[];
  emptyMessage?: string;
  now?: Date;
}) {
  if (events.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-400">{emptyMessage}</p>;
  }

  const groups: Array<{ heading: string; events: HumanActivityEvent[] }> = [];
  for (const event of events) {
    const heading = dayHeading(event.at, now);
    const last = groups[groups.length - 1];
    if (last && last.heading === heading) last.events.push(event);
    else groups.push({ heading, events: [event] });
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div key={group.heading}>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {group.heading}
          </p>
          <ol className="space-y-3">
            {group.events.map((event) => {
              const tone = TONES[event.tone];
              const Icon = tone.icon;
              return (
                <li key={event.id} className="flex gap-3">
                  <div className="w-11 shrink-0 pt-0.5 text-[11px] tabular-nums text-slate-400">
                    {timeLabel(event.at)}
                  </div>
                  <div className={cn("flex size-7 shrink-0 items-center justify-center rounded-full", tone.className)}>
                    <Icon className="size-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-800">{event.title}</p>
                    {event.detail && <p className="mt-0.5 text-[13px] text-slate-500">{event.detail}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}
