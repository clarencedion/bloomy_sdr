"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, Search } from "lucide-react";
import { listAllMeetings, listCompanies, listContacts } from "@/lib/firebase/firestore";
import type { Company, Contact } from "@/types/firestore";
import { EmptyState } from "@/components/common/empty-state";
import { LoadingSkeleton } from "@/components/common/loading-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type MeetingRecord = {
  id: string;
  companyId?: string;
  contactId?: string;
  title: string;
  startTime: unknown;
  endTime: unknown;
  status: string;
  attendees?: string[];
  source: string;
  outlookEventId?: string;
};

function formatDateTime(ts: unknown): string {
  if (!ts) return "—";
  try {
    const date =
      typeof (ts as { toDate?: () => Date }).toDate === "function"
        ? (ts as { toDate: () => Date }).toDate()
        : new Date(ts as string);
    return date.toLocaleString("fr-FR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Invalid date";
  }
}

function formatDay(ts: unknown): string {
  if (!ts) return "—";
  try {
    const date =
      typeof (ts as { toDate?: () => Date }).toDate === "function"
        ? (ts as { toDate: () => Date }).toDate()
        : new Date(ts as string);
    return date.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
  } catch {
    return "—";
  }
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  scheduled:  { bg: "bg-blue-50",    text: "text-blue-700",   label: "Scheduled" },
  completed:  { bg: "bg-emerald-50", text: "text-emerald-700",label: "Completed" },
  cancelled:  { bg: "bg-red-50",     text: "text-red-600",    label: "Cancelled" },
  no_show:    { bg: "bg-amber-50",   text: "text-amber-700",  label: "No show" },
};

export function MeetingsPage() {
  const [meetings, setMeetings] = useState<MeetingRecord[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [meetingResults, companyResults, contactResults] = await Promise.all([
      listAllMeetings(),
      listCompanies(),
      listContacts(),
    ]);
    setMeetings(meetingResults);
    setCompanies(companyResults);
    setContacts(contactResults);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const companyMap = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);
  const contactMap = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);

  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim();
    return meetings.filter((m) => {
      const company = m.companyId ? companyMap.get(m.companyId) : undefined;
      const contact = m.contactId ? contactMap.get(m.contactId) : undefined;
      const matchesSearch =
        !term ||
        [m.title, company?.name, contact?.fullName, contact?.email, ...(m.attendees ?? [])]
          .filter(Boolean).join(" ").toLowerCase().includes(term);
      const matchesStatus = statusFilter === "all" || m.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [companyMap, contactMap, meetings, search, statusFilter]);

  if (loading) return <LoadingSkeleton />;

  return (
    <>
      <PageHeader
        title="Meetings"
        description={`${meetings.length} meeting${meetings.length !== 1 ? "s" : ""} — auto-synced from Outlook Calendar every hour.`}
      />

      {/* Filter bar */}
      <div className="mb-4 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 border-slate-200 bg-slate-50 text-[13px] placeholder:text-slate-400 focus:bg-white"
            placeholder="Search meeting, company, contact…"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full border-slate-200 text-[13px] md:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="scheduled">Scheduled</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="no_show">No show</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!filtered.length ? (
        <EmptyState
          icon={CalendarDays}
          title="No meetings yet"
          description="Meetings appear here automatically when synced from Outlook Calendar. Connect Outlook in Settings → Integrations."
        />
      ) : (
        /* Meeting cards — each meeting is a horizontal card */
        <div className="space-y-2">
          {filtered.map((meeting) => {
            const company = meeting.companyId ? companyMap.get(meeting.companyId) : undefined;
            const contact = meeting.contactId ? contactMap.get(meeting.contactId) : undefined;
            const style = STATUS_STYLES[meeting.status] ?? { bg: "bg-slate-100", text: "text-slate-600", label: meeting.status };

            return (
              <div
                key={meeting.id}
                className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3 transition-shadow hover:shadow-sm"
              >
                {/* Date block */}
                <div className="hidden w-24 shrink-0 flex-col items-center rounded-lg bg-slate-50 py-2 text-center sm:flex">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                    {formatDay(meeting.startTime).split(" ")[0]}
                  </span>
                  <span className="text-[18px] font-bold text-slate-800 leading-none mt-0.5">
                    {formatDay(meeting.startTime).split(" ")[1]}
                  </span>
                  <span className="text-[10px] text-slate-500 mt-0.5">
                    {formatDay(meeting.startTime).split(" ")[2]}
                  </span>
                </div>

                {/* Title + attendees */}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-slate-900">{meeting.title}</div>
                  <div className="mt-0.5 truncate text-[11px] text-slate-400">
                    {formatDateTime(meeting.startTime)}
                    {meeting.attendees?.length ? ` · ${meeting.attendees.slice(0, 2).join(", ")}` : ""}
                  </div>
                </div>

                {/* Company */}
                {company && (
                  <div className="hidden min-w-0 w-36 md:block">
                    <div className="truncate text-[12px] font-medium text-slate-700">{company.name}</div>
                  </div>
                )}

                {/* Contact */}
                {contact && (
                  <div className="hidden min-w-0 w-36 xl:block">
                    <div className="truncate text-[12px] text-slate-600">{contact.fullName}</div>
                    <div className="truncate text-[10px] text-slate-400">{contact.email}</div>
                  </div>
                )}

                {/* Status pill */}
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${style.bg} ${style.text}`}>
                  {style.label}
                </span>

                {/* Link */}
                {meeting.companyId && (
                  <Link
                    href={`/app/companies/${meeting.companyId}`}
                    className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors"
                  >
                    View →
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
