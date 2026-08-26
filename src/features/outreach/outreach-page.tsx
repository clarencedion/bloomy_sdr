"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, Download, Inbox, Loader2, Search, Send, X } from "lucide-react";
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
  const [validationFilter, setValidationFilter] = useState("all");
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
      const matchesRisk =
        riskFilter === "all" ||
        (riskFilter === "has_risk" ? Boolean(item.riskWarnings?.length) : !item.riskWarnings?.length);
      const matchesValidation =
        validationFilter === "all" ||
        (validationFilter === "valid" && item.claimValidationStatus === "VALID") ||
        (validationFilter === "unsupported" && item.claimValidationStatus === "UNSUPPORTED_CLAIMS_DETECTED") ||
        (validationFilter === "warnings" && item.claimValidationStatus === "WARNINGS_ONLY");

      return matchesSearch && matchesStatus && matchesRisk && matchesValidation;
    });
  }, [companyMap, outreach, riskFilter, search, status, validationFilter]);

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
        title="Outreach & Séquences"
        description="Workspace de relecture, validation factuelle et approbation des séquences d'emails à froid."
        actions={
          <>
            <Link href="/app/inbox">
              <Button variant="default" className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5">
                <Inbox className="size-4" />
                SDR Inbox & Réponses
              </Button>
            </Link>
            {exportUrl ? (
              <a href={exportUrl} download className="inline-flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100">
                <Download className="size-4" />
                Télécharger CSV
              </a>
            ) : (
              <Button variant="outline" disabled={selected.size === 0 || exporting} onClick={() => void exportCsv()}>
                {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                Exporter CSV
              </Button>
            )}
            <Button variant="outline" disabled={selected.size === 0} onClick={() => void bulkApprove()}>
              <Check className="size-4" />
              Approuver la sélection
            </Button>
            <Button variant="destructive" disabled={selected.size === 0} onClick={() => void bulkReject()}>
              <X className="size-4" />
              Rejeter la sélection
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Rechercher entreprise, objet, persona..." />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-full md:w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {statuses.map((item) => (
                <SelectItem key={item} value={item}>{item === "all" ? "Tous statuts" : item.replaceAll("_", " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={validationFilter} onValueChange={setValidationFilter}>
            <SelectTrigger className="w-full md:w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes validations</SelectItem>
              <SelectItem value="valid">✓ Preuves validées</SelectItem>
              <SelectItem value="unsupported">⚠ Affirmations non prouvées</SelectItem>
              <SelectItem value="warnings">Garde-fous / Alertes</SelectItem>
            </SelectContent>
          </Select>
          <Select value={riskFilter} onValueChange={setRiskFilter}>
            <SelectTrigger className="w-full md:w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous risques</SelectItem>
              <SelectItem value="has_risk">Avec avertissements</SelectItem>
              <SelectItem value="no_risk">Sans avertissement</SelectItem>
            </SelectContent>
          </Select>
      </div>
      {!filtered.length ? (
        <EmptyState icon={Search} title="Aucun brouillon d'outreach" description="Générez l'outreach depuis la fiche d'une entreprise enrichie." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-left text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && selected.size === filtered.length}
                    onChange={(event) => setSelected(event.target.checked ? new Set(filtered.map((item) => item.id)) : new Set())}
                    aria-label="Sélectionner tous les brouillons"
                  />
                </th>
                <th className="px-4 py-3">Entreprise</th>
                <th className="px-4 py-3">Statut</th>
                <th className="px-4 py-3">Validation Preuves</th>
                <th className="px-4 py-3">Objet</th>
                <th className="px-4 py-3">Cible</th>
                <th className="px-4 py-3">PDF</th>
                <th className="px-4 py-3">Risques</th>
                <th className="px-4 py-3">Actions</th>
                <th className="px-4 py-3">Ouvrir</th>
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
                        aria-label={`Sélectionner ${item.generatedSubject}`}
                      />
                    </td>
                    <td className="px-4 py-3 max-w-[140px]">
                      <div className="truncate font-medium text-slate-900">{company?.name ?? "Inconnue"}</div>
                      <div className="truncate text-[11px] text-slate-400">{company?.domain ?? ""}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        item.status === "approved" ? "bg-emerald-50 text-emerald-700" :
                        item.status === "sent" ? "bg-blue-50 text-blue-700" :
                        item.status === "replied" ? "bg-indigo-100 text-indigo-800 font-bold" :
                        item.status === "suppressed" ? "bg-slate-100 text-slate-600" :
                        item.status === "rejected" ? "bg-red-50 text-red-600" :
                        item.status === "draft" ? "bg-amber-50 text-amber-700" :
                        "bg-slate-50 text-slate-700"
                      }`}>{item.status.replace(/_/g, " ")}</span>
                    </td>

                    <td className="px-4 py-3">
                      {item.claimValidationStatus === "VALID" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                          ✓ Validé
                        </span>
                      ) : item.claimValidationStatus === "UNSUPPORTED_CLAIMS_DETECTED" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700" title={item.riskWarnings?.join(" · ")}>
                          ⚠ Non prouvé
                        </span>
                      ) : item.claimValidationStatus === "WARNINGS_ONLY" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                          Garde-fou
                        </span>
                      ) : (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 max-w-[200px]">
                      <div className="truncate text-[13px] text-slate-800" title={item.generatedSubject ?? ""}>
                        {item.generatedSubject ?? "Sans objet"}
                      </div>
                    </td>
                    <td className="px-4 py-3 max-w-[130px]">
                      <div className="truncate text-[12px] text-slate-500" title={item.suggestedPersona ?? ""}>
                        {personaShort || "—"}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {item.pdfStorageUrl ? (
                        <a
                          href={item.pdfStorageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex size-6 items-center justify-center rounded border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                          title="Visualiser la proposition PDF"
                        >
                          📄
                        </a>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {(item.riskWarnings?.length ?? 0) > 0 ? (
                        <span className="inline-flex size-5 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-700" title={item.riskWarnings?.join(" · ")}>
                          {item.riskWarnings!.length}
                        </span>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5">
                        {item.status === "approved" ? (
                          <Button size="sm" disabled={sending === item.id} onClick={() => void sendOutreach(item.id)} className="bg-blue-600 hover:bg-blue-700 text-white h-7 text-[11px]">
                            {sending === item.id ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
                            Envoyer
                          </Button>
                        ) : item.status === "draft" ? (
                          <>
                            <button onClick={() => void callApproveOutreach(item.id).then(refresh)} className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors">
                              ✓ Approuver
                            </button>
                            <button onClick={() => void callRejectOutreach(item.id, "Rejeté manuellement").then(refresh)} className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-100 transition-colors">
                              ✗ Rejeter
                            </button>
                          </>
                        ) : (
                          <span className="text-[11px] text-slate-400 capitalize">{item.status.replace(/_/g, " ")}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Link className="text-[12px] font-semibold text-blue-600 hover:underline" href={`/app/companies/${item.companyId}`}>
                        Ouvrir →
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
