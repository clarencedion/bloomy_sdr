"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Loader2, Play, Search, SkipForward } from "lucide-react";
import type { Company, LeadResearch, LeadResearchStatus } from "@/types/firestore";
import { callEnrichCompany, callResearchCompany, callSkipResearch } from "@/lib/firebase/functions";
import { listCompanies, listResearchQueue } from "@/lib/firebase/firestore";
import { ConfidenceBadge } from "@/components/common/confidence-badge";
import { EmptyState } from "@/components/common/empty-state";
import { FitScoreBadge } from "@/components/common/fit-score-badge";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const statuses: Array<LeadResearchStatus | "all"> = ["all", "pending", "running", "completed", "failed"];

export function ResearchQueuePage() {
  const [research, setResearch] = useState<LeadResearch[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [status, setStatus] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [runningId, setRunningId] = useState<string | null>(null);
  const [enrichingId, setEnrichingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [researchResults, companyResults] = await Promise.all([listResearchQueue(), listCompanies()]);
    setResearch(researchResults);
    setCompanies(companyResults);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const companyMap = useMemo(() => new Map(companies.map((company) => [company.id, company])), [companies]);
  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim();
    return research.filter((item) => {
      const company = companyMap.get(item.companyId);
      const matchesStatus = status === "all" || item.status === status;
      const matchesSearch = !term || [company?.name, company?.domain, item.error].filter(Boolean).join(" ").toLowerCase().includes(term);
      return matchesStatus && matchesSearch;
    });
  }, [companyMap, research, search, status]);

  async function runItem(item: LeadResearch) {
    setRunningId(item.id);
    try {
      await callResearchCompany(item.companyId, item.status === "failed");
      await refresh();
    } finally {
      setRunningId(null);
    }
  }

  async function runSelected() {
    for (const researchId of selected) {
      const item = research.find((entry) => entry.id === researchId);
      if (item) await runItem(item);
    }
    setSelected(new Set());
  }

  async function skipItem(item: LeadResearch) {
    await callSkipResearch(item.id);
    await refresh();
  }

  async function enrichItem(item: LeadResearch) {
    setEnrichingId(item.id);
    try {
      await callEnrichCompany(item.companyId);
      await refresh();
    } finally {
      setEnrichingId(null);
    }
  }

  return (
    <>
      <PageHeader
        title="AI Research Queue"
        description="Run structured company research, retry failures, and inspect errors without starting outreach."
        actions={
          <Button disabled={selected.size === 0 || Boolean(runningId)} onClick={() => void runSelected()}>
            {runningId ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            Run selected
          </Button>
        }
      />
      <div className="mb-4 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Search company or error..." />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full md:w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            {statuses.map((item) => (
              <SelectItem key={item} value={item}>{item === "all" ? "All statuses" : item}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {!filtered.length ? (
        <EmptyState icon={Bot} title="No research queue items" description="Queue companies from the Companies page or Discovery results." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[1050px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && selected.size === filtered.length}
                    onChange={(event) => setSelected(event.target.checked ? new Set(filtered.map((item) => item.id)) : new Set())}
                    aria-label="Select all research queue items"
                  />
                </th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Fit</th>
                <th className="px-4 py-3">Confidence</th>
                <th className="px-4 py-3">Error</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((item) => {
                const company = companyMap.get(item.companyId);
                return (
                  <tr key={item.id} className="border-b border-slate-100 last:border-0 transition-colors hover:bg-blue-50/40">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(item.id)}
                        onChange={(event) => {
                          const next = new Set(selected);
                          if (event.target.checked) next.add(item.id);
                          else next.delete(item.id);
                          setSelected(next);
                        }}
                        aria-label={`Select ${company?.name ?? item.companyId}`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 truncate max-w-[160px]">{company?.name ?? item.companyId}</div>
                      <div className="text-[11px] text-slate-400 truncate max-w-[160px]">{company?.domain ?? ""}</div>
                    </td>
                    <td className="px-4 py-3"><Badge variant="outline">{item.status}</Badge></td>
                    <td className="px-4 py-3"><FitScoreBadge score={item.fitScore} /></td>
                    <td className="px-4 py-3"><ConfidenceBadge confidence={item.confidence} /></td>
                    <td className="px-4 py-3 max-w-[180px] truncate text-[11px] text-red-600">{item.error ?? <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" disabled={runningId === item.id || item.status === "running"} onClick={() => void runItem(item)}>
                          {runningId === item.id ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                          {item.status === "failed" ? "Retry" : "Run"}
                        </Button>
                        <Button size="sm" variant="outline" disabled={enrichingId === item.id} onClick={() => void enrichItem(item)}>
                          {enrichingId === item.id ? <Loader2 className="size-4 animate-spin" /> : null}
                          Enrich
                        </Button>
                        {item.status === "pending" ? (
                          <Button size="sm" variant="ghost" onClick={() => void skipItem(item)}>
                            <SkipForward className="size-4" />
                            Skip
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
