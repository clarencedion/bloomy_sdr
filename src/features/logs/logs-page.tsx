"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle2, Info, ScrollText, XCircle } from "lucide-react";
import type { Log } from "@/types/firestore";
import { listLogs } from "@/lib/firebase/firestore";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { LoadingSkeleton } from "@/components/common/loading-skeleton";

function dateLabel(log: Log) {
  const value = log.createdAt && "toDate" in log.createdAt ? log.createdAt.toDate() : null;
  return value ? format(value, "dd/MM/yy HH:mm") : "—";
}

const LEVEL_STYLE: Record<string, { icon: React.ElementType; dot: string; label: string }> = {
  info:    { icon: Info,          dot: "bg-blue-500",    label: "info" },
  warning: { icon: AlertTriangle, dot: "bg-amber-500",   label: "warning" },
  error:   { icon: XCircle,       dot: "bg-red-500",     label: "error" },
  success: { icon: CheckCircle2,  dot: "bg-emerald-500", label: "success" },
};

export function LogsPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    void listLogs()
      .then(setLogs)
      .finally(() => setLoading(false));
  }, []);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) return <LoadingSkeleton />;

  return (
    <>
      <PageHeader
        title="Activity log"
        description="Operational events from automation runs, imports, research, and settings changes."
      />

      {logs.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No activity yet"
          description="Events will appear here as discovery runs, AI research, outreach generation, and imports are executed."
        />
      ) : (
        <div className="space-y-1.5">
          {logs.map((log) => {
            const style = LEVEL_STYLE[log.level] ?? LEVEL_STYLE.info;
            const Icon = style.icon;
            const hasMetadata = log.metadata && Object.keys(log.metadata).length > 0;
            const isExpanded = expanded.has(log.id);

            return (
              <div
                key={log.id}
                className="rounded-xl border border-slate-200 bg-white transition-shadow hover:shadow-sm"
              >
                <div
                  className="flex items-start gap-3 px-4 py-3"
                  role={hasMetadata ? "button" : undefined}
                  onClick={() => hasMetadata && toggleExpand(log.id)}
                  style={{ cursor: hasMetadata ? "pointer" : "default" }}
                >
                  {/* Level dot */}
                  <div className={`mt-1 size-2 shrink-0 rounded-full ${style.dot}`} />

                  {/* Date */}
                  <span className="shrink-0 text-[11px] text-slate-400 w-28 pt-0.5">{dateLabel(log)}</span>

                  {/* Type badge */}
                  <span className="hidden shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 sm:inline">
                    {log.type}
                  </span>

                  {/* Message */}
                  <span className="flex-1 text-[13px] text-slate-700">{log.message}</span>

                  {/* Level icon */}
                  <Icon className={`size-3.5 shrink-0 mt-0.5 ${
                    log.level === "error" ? "text-red-500" :
                    log.level === "warning" ? "text-amber-500" :
                    "text-blue-400"
                  }`} />

                  {/* Expand hint */}
                  {hasMetadata && (
                    <span className="shrink-0 text-[10px] text-slate-400">{isExpanded ? "▲" : "▼"}</span>
                  )}
                </div>

                {/* Metadata panel */}
                {isExpanded && hasMetadata && (
                  <div className="border-t border-slate-100 px-4 py-3">
                    <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-[11px] text-slate-100 leading-relaxed">
                      {JSON.stringify(log.metadata, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
