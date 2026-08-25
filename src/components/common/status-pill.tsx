import type { CompanyStatus } from "@/types/firestore";
import { cn } from "@/lib/utils";

const styles: Record<CompanyStatus, string> = {
  imported: "bg-slate-100 text-slate-700 border-slate-200",
  discovered: "bg-teal-50 text-teal-700 border-teal-200",
  enrichment_pending: "bg-amber-50 text-amber-700 border-amber-200",
  enriching: "bg-blue-50 text-blue-700 border-blue-200",
  enriched: "bg-cyan-50 text-cyan-700 border-cyan-200",
  research_pending: "bg-amber-50 text-amber-700 border-amber-200",
  researching: "bg-blue-50 text-blue-700 border-blue-200",
  researched: "bg-indigo-50 text-indigo-700 border-indigo-200",
  outreach_ready: "bg-emerald-50 text-emerald-700 border-emerald-200",
  qualified: "bg-emerald-50 text-emerald-700 border-emerald-200",
  approved: "bg-green-50 text-green-700 border-green-200",
  contacted: "bg-sky-50 text-sky-700 border-sky-200",
  replied: "bg-purple-50 text-purple-700 border-purple-200",
  meeting_booked: "bg-violet-50 text-violet-700 border-violet-200",
  won: "bg-green-100 text-green-800 border-green-200",
  lost: "bg-red-50 text-red-700 border-red-200",
  rejected: "bg-rose-50 text-rose-700 border-rose-200"
};

export function StatusPill({ status, className }: { status: CompanyStatus; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", styles[status], className)}>
      {status.replaceAll("_", " ")}
    </span>
  );
}
