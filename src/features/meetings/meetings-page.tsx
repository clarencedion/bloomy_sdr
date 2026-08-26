"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarCheck, ExternalLink } from "lucide-react";
import { LoadingSkeleton } from "@/components/common/loading-skeleton";
import { useBusiness } from "@/lib/context/business-context";
import {
  getPastMeetings,
  getUpcomingMeetings,
  groupMeetingsByDay,
  type MeetingGroup,
  type UpcomingMeeting
} from "@/lib/sdr/aggregations";

function timeLabel(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/**
 * Meetings are the outcome of the whole product, so this screen reads like a
 * short agenda rather than a CRM table.
 */
export function MeetingsPage() {
  const { workspaceId, currentBusinessId } = useBusiness();
  const [groups, setGroups] = useState<MeetingGroup[]>([]);
  const [past, setPast] = useState<UpcomingMeeting[]>([]);
  const [total, setTotal] = useState(0);
  const [showPast, setShowPast] = useState(false);
  const [loading, setLoading] = useState(true);

  const scope = useMemo(
    () => ({ workspaceId: workspaceId || "ws_default", businessId: currentBusinessId || undefined }),
    [workspaceId, currentBusinessId]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [meetings, previous] = await Promise.all([getUpcomingMeetings(scope), getPastMeetings(scope)]);
      setTotal(meetings.length);
      setGroups(groupMeetingsByDay(meetings));
      setPast(previous);
    } catch (error) {
      console.error("Failed to load meetings", error);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading) return <LoadingSkeleton />;

  if (total === 0 && past.length === 0) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <CalendarCheck className="mx-auto size-8 text-slate-300" />
        <h1 className="mt-4 text-xl font-semibold text-slate-900">No meetings booked yet.</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-slate-500">
          When a prospect agrees to talk, your SDR checks your calendar and books the meeting here.
        </p>
        <Link href="/app/campaigns" className="mt-6 inline-block text-[14px] font-medium text-slate-700 hover:underline">
          See what your SDR is working on
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-10 py-2">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Upcoming meetings</h1>
        <p className="mt-1.5 text-[13px] text-slate-500">
          {total} {total === 1 ? "meeting" : "meetings"} scheduled
        </p>
      </div>

      {total === 0 && (
        <p className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">
          No meetings coming up.
        </p>
      )}

      {groups.map((group) => (
        <section key={group.label}>
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {group.label}
          </h2>
          <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {group.meetings.map((meeting) => (
              <div key={meeting.id} className="flex items-center gap-4 p-4">
                <div className="w-14 shrink-0 text-[15px] font-semibold tabular-nums text-slate-900">
                  {timeLabel(meeting.startTime)}
                </div>
                <div className="min-w-0 flex-1">
                  {meeting.companyId ? (
                    <Link
                      href={`/app/companies/${meeting.companyId}`}
                      className="truncate font-medium text-slate-900 hover:underline"
                    >
                      {meeting.companyName}
                    </Link>
                  ) : (
                    <p className="truncate font-medium text-slate-900">{meeting.companyName}</p>
                  )}
                  <p className="mt-0.5 truncate text-[13px] text-slate-500">{meeting.title}</p>
                </div>
                {meeting.bookedBySdr && (
                  <span className="hidden shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[12px] font-medium text-emerald-700 sm:inline">
                    Booked by SDR
                  </span>
                )}
                {meeting.meetingUrl && (
                  <a
                    href={meeting.meetingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-slate-400 hover:text-slate-700"
                    aria-label={`Join the meeting with ${meeting.companyName}`}
                  >
                    <ExternalLink className="size-4" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}

      {past.length > 0 && (
        <section>
          <button
            type="button"
            onClick={() => setShowPast((open) => !open)}
            aria-expanded={showPast}
            className="text-[13px] font-medium text-slate-500 transition-colors hover:text-slate-800"
          >
            {showPast ? "Hide" : "Show"} past meetings ({past.length})
          </button>

          {showPast && (
            <div className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
              {past.map((meeting) => (
                <div key={meeting.id} className="flex items-center gap-4 p-4">
                  <div className="w-28 shrink-0 text-[13px] tabular-nums text-slate-500">
                    {meeting.startTime?.toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short",
                      year: "numeric"
                    }) ?? "—"}
                  </div>
                  <div className="min-w-0 flex-1">
                    {meeting.companyId ? (
                      <Link
                        href={`/app/companies/${meeting.companyId}`}
                        className="truncate font-medium text-slate-900 hover:underline"
                      >
                        {meeting.companyName}
                      </Link>
                    ) : (
                      <p className="truncate font-medium text-slate-900">{meeting.companyName}</p>
                    )}
                    <p className="mt-0.5 truncate text-[13px] text-slate-500">{meeting.title}</p>
                  </div>
                  {meeting.bookedBySdr && (
                    <span className="hidden shrink-0 text-[12px] text-slate-400 sm:inline">Booked by SDR</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
