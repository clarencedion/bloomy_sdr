import { cn } from "@/lib/utils";

export function FitScoreBadge({ score }: { score?: number }) {
  const label = typeof score === "number" ? `${score}` : "Not scored";
  return (
    <span
      className={cn(
        "inline-flex min-w-16 items-center justify-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        score === undefined && "border-slate-200 bg-slate-50 text-slate-500",
        typeof score === "number" && score >= 75 && "border-emerald-200 bg-emerald-50 text-emerald-700",
        typeof score === "number" && score >= 45 && score < 75 && "border-amber-200 bg-amber-50 text-amber-700",
        typeof score === "number" && score < 45 && "border-red-200 bg-red-50 text-red-700"
      )}
    >
      {label}
    </span>
  );
}
