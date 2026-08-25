import { cn } from "@/lib/utils";

export function ConfidenceBadge({ confidence }: { confidence?: number }) {
  const label = typeof confidence === "number" ? `${confidence}%` : "No confidence";
  return (
    <span
      className={cn(
        "inline-flex min-w-20 items-center justify-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        confidence === undefined && "border-slate-200 bg-slate-50 text-slate-500",
        typeof confidence === "number" && confidence >= 70 && "border-emerald-200 bg-emerald-50 text-emerald-700",
        typeof confidence === "number" && confidence >= 45 && confidence < 70 && "border-amber-200 bg-amber-50 text-amber-700",
        typeof confidence === "number" && confidence < 45 && "border-red-200 bg-red-50 text-red-700"
      )}
    >
      {label}
    </span>
  );
}
