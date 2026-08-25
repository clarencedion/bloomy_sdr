"use client";

import Link from "next/link";
import { Bot, ExternalLink, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { Company, CompanyStatus } from "@/types/firestore";
import { deleteCompany, queueCompanyForResearchClient } from "@/lib/firebase/firestore";
import { StatusPill } from "@/components/common/status-pill";
import { FitScoreBadge } from "@/components/common/fit-score-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const statuses: CompanyStatus[] = [
  "imported",
  "discovered",
  "enrichment_pending",
  "enriching",
  "enriched",
  "research_pending",
  "researching",
  "researched",
  "outreach_ready",
  "qualified",
  "approved",
  "contacted",
  "replied",
  "meeting_booked",
  "won",
  "lost",
  "rejected"
];

export function CompanyTable({
  companies,
  outreachCounts = {},
  contactCounts = {},
  onDeleted
}: {
  companies: Company[];
  outreachCounts?: Record<string, number>;
  contactCounts?: Record<string, number>;
  onDeleted?: () => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [researchFilter, setResearchFilter] = useState("all");
  const [outreachFilter, setOutreachFilter] = useState("all");
  const [readinessFilter, setReadinessFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim();
    return companies.filter((company) => {
      const matchesSearch =
        !term ||
        [company.name, company.domain, company.city, company.industry].filter(Boolean).join(" ").toLowerCase().includes(term);
      const matchesStatus = status === "all" || company.status === status;
      const matchesResearch =
        researchFilter === "all" ||
        (researchFilter === "needs_research" && (company.needsResearch || company.status === "research_pending")) ||
        (researchFilter === "researched" && ["researched", "qualified", "rejected"].includes(company.status)) ||
        (researchFilter === "qualified" && company.status === "qualified") ||
        (researchFilter === "low_fit" && (company.fitScore ?? 100) < 40);
      const hasOutreach = Boolean(outreachCounts[company.id]);
      const matchesOutreach =
        outreachFilter === "all" ||
        (outreachFilter === "has_outreach" && hasOutreach) ||
        (outreachFilter === "no_outreach" && !hasOutreach);
      const matchesReadiness =
        readinessFilter === "all" ||
        (readinessFilter === "ready" && company.leadReadyForOutreach) ||
        (readinessFilter === "not_ready" && !company.leadReadyForOutreach) ||
        (readinessFilter === "needs_enrichment" && ["pending", "failed", "missing_website", undefined].includes(company.websiteEnrichmentStatus));
      return matchesSearch && matchesStatus && matchesResearch && matchesOutreach && matchesReadiness;
    });
  }, [companies, outreachCounts, outreachFilter, readinessFilter, researchFilter, search, status]);

  async function queueSelected() {
    await Promise.all([...selected].map((companyId) => queueCompanyForResearchClient(companyId)));
    setSelected(new Set());
    onDeleted?.();
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b p-4 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Search name, domain, city..." />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full md:w-56">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {statuses.map((item) => (
              <SelectItem key={item} value={item}>
                {item.replaceAll("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={researchFilter} onValueChange={setResearchFilter}>
          <SelectTrigger className="w-full md:w-56">
            <SelectValue placeholder="Research" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All research states</SelectItem>
            <SelectItem value="needs_research">Needs research</SelectItem>
            <SelectItem value="researched">Researched</SelectItem>
            <SelectItem value="qualified">Qualified</SelectItem>
            <SelectItem value="low_fit">Low fit</SelectItem>
          </SelectContent>
        </Select>
        <Select value={outreachFilter} onValueChange={setOutreachFilter}>
          <SelectTrigger className="w-full md:w-48">
            <SelectValue placeholder="Outreach" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All outreach</SelectItem>
            <SelectItem value="has_outreach">Has outreach</SelectItem>
            <SelectItem value="no_outreach">No outreach</SelectItem>
          </SelectContent>
        </Select>
        <Select value={readinessFilter} onValueChange={setReadinessFilter}>
          <SelectTrigger className="w-full md:w-52">
            <SelectValue placeholder="Readiness" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All readiness</SelectItem>
            <SelectItem value="ready">Outreach ready</SelectItem>
            <SelectItem value="not_ready">Not ready</SelectItem>
            <SelectItem value="needs_enrichment">Needs enrichment</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" disabled={selected.size === 0} onClick={() => void queueSelected()} className="mr-2">
          <Bot className="size-4 mr-2" />
          Queue selected
        </Button>
        <Button
          variant="destructive"
          disabled={selected.size === 0}
          onClick={async () => {
            if (!window.confirm(`Delete ${selected.size} selected companies? This also removes linked contacts and pending research records.`)) return;
            const ids = [...selected];
            setSelected(new Set());
            await Promise.all(ids.map((companyId) => deleteCompany(companyId)));
            onDeleted?.();
          }}
        >
          <Trash2 className="size-4 mr-2" />
          Delete selected
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1120px] text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-left text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  onChange={(event) => setSelected(event.target.checked ? new Set(filtered.map((company) => company.id)) : new Set())}
                  aria-label="Select all companies"
                />
              </th>
              <th className="px-4 py-3 font-medium">Company</th>
              <th className="px-4 py-3 font-medium">City</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Fit</th>
              <th className="px-4 py-3 font-medium">Outreach</th>
              <th className="px-4 py-3 font-medium">Contacts</th>
              <th className="px-4 py-3 font-medium">Ready</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map((company) => (
              <tr key={company.id} className="border-b border-slate-100 last:border-0 transition-colors hover:bg-blue-50/40">
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(company.id)}
                    onChange={(event) => {
                      const next = new Set(selected);
                      if (event.target.checked) next.add(company.id);
                      else next.delete(company.id);
                      setSelected(next);
                    }}
                    aria-label={`Select ${company.name}`}
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-900 truncate max-w-[180px]">{company.name}</div>
                  <div className="text-[11px] text-slate-400 truncate max-w-[180px]">{company.domain ?? company.website ?? ""}</div>
                </td>
                <td className="px-4 py-3 text-[12px] text-slate-500 max-w-[120px]">
                  <div className="truncate">{company.city ?? "—"}</div>
                </td>
                <td className="px-4 py-3">
                  <StatusPill status={company.status} />
                </td>
                <td className="px-4 py-3">
                  <FitScoreBadge score={company.fitScore} />
                </td>
                <td className="px-4 py-3 text-[12px] text-slate-500">{outreachCounts[company.id] ? `${outreachCounts[company.id]} draft(s)` : "—"}</td>
                <td className="px-4 py-3 text-[12px] text-slate-500">{contactCounts[company.id] ?? 0}</td>
                <td className="px-4 py-3 text-[12px]">
                  <span className={company.leadReadyForOutreach ? "text-emerald-600 font-semibold" : "text-amber-600"}>
                    {company.leadReadyForOutreach ? "✓ Ready" : company.websiteEnrichmentStatus?.replaceAll("_", " ") ?? "Needs enrichment"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                  <Link className="inline-flex items-center gap-1 text-[12px] font-semibold text-blue-600 hover:text-blue-800 hover:underline" href={`/app/companies/${company.id}`}>
                    Detail <ExternalLink className="size-3" />
                  </Link>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={deletingId === company.id}
                      onClick={async () => {
                        if (!window.confirm(`Delete ${company.name}? This also removes linked contacts and pending research queue records.`)) return;
                        setDeletingId(company.id);
                        try {
                          await deleteCompany(company.id);
                          onDeleted?.();
                        } finally {
                          setDeletingId(null);
                        }
                      }}
                      aria-label={`Delete ${company.name}`}
                    >
                      <Trash2 className="size-4 text-red-600" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
