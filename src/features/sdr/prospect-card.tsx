"use client";

import Link from "next/link";
import { Check, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BestProspect } from "@/lib/sdr/aggregations";

const BANDS = {
  high: "bg-emerald-50 text-emerald-700 border-emerald-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  low: "bg-slate-100 text-slate-600 border-slate-200"
} as const;

/**
 * A prospect presented as an opportunity rather than a database row: the score,
 * why it scored that way, and what the SDR has done about it.
 */
export function ProspectCard({ prospect }: { prospect: BestProspect }) {
  const { company, opportunity, status } = prospect;
  const score = opportunity?.score ?? company.discoveryScore ?? 0;
  const band = opportunity?.band ?? "low";

  return (
    <Link
      href={`/app/companies/${company.id}`}
      className="block rounded-xl border border-slate-200 bg-white p-5 transition-colors hover:border-slate-300"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-slate-900">{company.name}</h3>
          {company.city && <p className="mt-0.5 text-[13px] text-slate-500">{company.city}</p>}
        </div>
        <span className={cn("shrink-0 rounded-full border px-2.5 py-1 text-[12px] font-semibold", BANDS[band])}>
          {Math.round(score)} / 100
        </span>
      </div>

      {opportunity && opportunity.reasons.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {opportunity.reasons.map((reason) => (
            <li key={reason.label} className="flex gap-2 text-[13px] text-slate-600">
              {reason.kind === "strength" ? (
                <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
              ) : (
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
              )}
              <span className="min-w-0">{reason.label}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3">
        <span className="text-[12px] text-slate-400">Status</span>
        <span className="text-[13px] font-medium text-slate-700">{status}</span>
      </div>
    </Link>
  );
}
