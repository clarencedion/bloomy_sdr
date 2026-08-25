"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, Download, Loader2, Search, Send, X } from "lucide-react";
import type { Company, Outreach } from "@/types/firestore";
import { callApproveOutreach, callExportOutreachCsv, callRejectOutreach, callSendApprovedOutreach } from "@/lib/firebase/functions";
import { listCompanies, listOutreachDrafts } from "@/lib/firebase/firestore";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const statuses = ["all", "draft", "approved", "rejected", "needs_more_research"] as const;

export function OutreachPage() {
  const [outreach, setOutreach] = useState<Outreach[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportUrl, setExportUrl] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [outreachResults, companyResults] = await Promise.all([listOutreachDrafts(), listCompanies()]);
    setOutreach(outreachResults);
    setCompanies(companyResults);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const companyMap = useMemo(() => new Map(companies.map((company) => [company.id, company])), [companies]);
  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim();
    return outreach.filter((item) => {
      const company = companyMap.get(item.companyId);
      const matchesSearch =
        !term ||
        [company?.name, company?.domain, item.generatedSubject, item.suggestedPersona, item.generatedBody]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(term);
      const matchesStatus = status === "all" || item.status === status;
      const matchesRisk = riskFilter === "all" || (riskFilter === "has_risk" ? Boolean(item.riskWarnings?.length) : !item.riskWarnings?.length);
      return matchesSearch && matchesStatus && matchesRisk;
    });
  }, [companyMap, outreach, riskFilter, search, status]);

  async function bulkApprove() {
    await Promise.all([...selected].map((id) => callApproveOutreach(id)));
    setSelected(new Set());
    await refresh();
  }

  async function bulkReject() {
    await Promise.all([...selected].map((id) => callRejectOutreach(id, "Bulk rejected manually.")));
    setSelected(new Set());
    await refresh();
  }

  async function sendOutreach(outreachId: string) {
    setSending(outreachId);
    try {
      await callSendApprovedOutreach(outreachId);
      await refresh();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to send outreach.");
    } finally {
      setSending(null);
    }
  }

  async function exportCsv() {
    const approvedIds = [...selected].filter((id) => outreach.find((o) => o.id === id)?.status === "approved");
    if (!approvedIds.length) {
      alert("Select approved outreach records to export.");
      return;
    }
    setExporting(true);
    setExportUrl(null);
    try {
      const result = await callExportOutreachCsv(approvedIds);
      setExportUrl(result.downloadUrl);
    } catch (error) {
      alert(error instanceof Error ? error.message : "CSV export failed.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Outreach"
        description="Draft and approval workspace only. Sending and CSV export are intentionally reserved for later phases."
        actions={
          <>
            {exportUrl ? (
              <a href={exportUrl} download className="inline-flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100">
                <Download className="size-4" />
                Download CSV
              </a>
            ) : (
              <Button variant="outline" disabled={selected.size === 0 || exporting} onClick={() => void exportCsv()}>
                {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                Export CSV
              </Button>
            )}
            <Button variant="outline" disabled={selected.size === 0} onClick={() => void bulkApprove()}>
              <Check className="size-4" />
              Approve selected
            </Button>
            <Button variant="destructive" disabled={selected.size === 0} onClick={() => void bulkReject()}>
              <X className="size-4" />
              Reject selected
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Search company, subject, persona..." />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-full md:w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              {statuses.map((item) => (
                <SelectItem key={item} value={item}>{item === "all" ? "All statuses" : item.replaceAll("_", " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={riskFilter} onValueChange={setRiskFilter}>
            <SelectTrigger className="w-full md:w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All risk states</SelectItem>
              <SelectItem value="has_risk">Has warnings</SelectItem>
              <SelectItem value="no_risk">No warnings</SelectItem>
            </SelectContent>
          </Select>
      </div>
      {!filtered.length ? (
        <EmptyState icon={Search} title="No outreach drafts" description="Generate outreach from a researched company detail page." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-left text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && selected.size === filtered.length}
                    onChange={(event) => setSelected(event.target.checked ? new Set(filtered.map((item) => item.id)) : new Set())}
                    aria-label="Select all outreach"
                  />
                </th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Subject line</th>
                <th className="px-4 py-3">Target</th>
                <th className="px-4 py-3">Risks</th>
                <th className="px-4 py-3">Actions</th>
                <th className="px-4 py-3">Open</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((item) => {
                const company = companyMap.get(item.companyId);
                const personaShort = (item.suggestedPersona ?? "").split(/\s*[(-]/)[0].trim();
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
                        aria-label={`Select ${item.generatedSubject}`}
                      />
                    </td>
                    <td className="px-4 py-3 max-w-[140px]">
                      <div className="truncate font-medium text-slate-900">{company?.name ?? "Unknown"}</div>
                      <div className="truncate text-[11px] text-slate-400">{company?.domain ?? ""}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        item.status === "approved" ? "bg-emerald-50 text-emerald-700" :
                        item.status === "rejected" ? "bg-red-50 text-red-600" :
                        item.status === "draft" ? "bg-amber-50 text-amber-700" :
                        "bg-blue-50 text-blue-700"
                      }`}>{item.status.replace(/_/g, " ")}</span>
                    </td>
                    <td className="px-4 py-3 max-w-[220px]">
                      <div className="truncate text-[13px] text-slate-800" title={item.generatedSubject ?? ""}>
                        {item.generatedSubject ?? "No subject"}
                      </div>
                    </td>
                    <td className="px-4 py-3 max-w-[150px]">
                      <div className="truncate text-[12px] text-slate-500" title={item.suggestedPersona ?? ""}>
                        {personaShort || "—"}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {(item.riskWarnings?.length ?? 0) > 0 ? (
                        <span className="inline-flex size-5 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-700">
                          {item.riskWarnings!.length}
                        </span>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5">
                        {item.status === "approved" ? (
                          <Button size="sm" disabled={sending === item.id} onClick={() => void sendOutreach(item.id)} className="bg-blue-600 hover:bg-blue-700 text-white h-7 text-[11px]">
                            {sending === item.id ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
                            Send
                          </Button>
                        ) : item.status === "draft" ? (
                          <>
                            <button onClick={() => void callApproveOutreach(item.id).then(refresh)} className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors">
                              ✓ Approve
                            </button>
                            <button onClick={() => void callRejectOutreach(item.id, "Manually rejected").then(refresh)} className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-100 transition-colors">
                              ✗ Reject
                            </button>
                          </>
                        ) : (
                          <span className="text-[11px] text-slate-400 capitalize">{item.status.replace(/_/g, " ")}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Link className="text-[12px] font-semibold text-blue-600 hover:underline" href={`/app/companies/${item.companyId}`}>
                        Open →
                      </Link>
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
