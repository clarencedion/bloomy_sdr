"use client";

import { useState } from "react";
import Papa from "papaparse";
import { AlertCircle, CheckCircle2, Loader2, Upload } from "lucide-react";
import type { DataQualityWarning, ImportPreviewRow } from "@/types/firestore";
import { normalizeCompanyInput, normalizeContactInput } from "@/lib/data/company";
import { createContactIfNotDuplicate, createLog, createOrMergeCompany } from "@/lib/firebase/firestore";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";

function value(row: Record<string, string>, keys: string[]) {
  const normalized = Object.fromEntries(Object.entries(row).map(([key, item]) => [key.trim().toLowerCase(), item]));
  return keys.map((key) => normalized[key]).find(Boolean);
}

function previewRows(rows: Record<string, string>[]): ImportPreviewRow[] {
  const seenDomains = new Set<string>();
  const seenEmails = new Set<string>();
  return rows.map((row, index) => {
    const companyInput = {
      name: value(row, ["company name", "name", "company", "entreprise"]),
      website: value(row, ["website", "site", "site web"]),
      city: value(row, ["city", "ville"]),
      industry: value(row, ["industry", "secteur"]),
      source: value(row, ["source"]),
      sourceUrl: value(row, ["source url", "sourceurl", "url source"]),
      sourceType: "csv" as const,
      rawProviderData: row,
    };
    const contactInput = {
      firstName: value(row, ["contact first name", "first name", "prenom", "prénom"]),
      lastName: value(row, ["contact last name", "last name", "nom"]),
      role: value(row, ["contact role", "role", "poste", "title"]),
      email: value(row, ["contact email", "email", "e-mail"]),
      phone: value(row, ["phone", "telephone", "téléphone"]),
      linkedinUrl: value(row, ["linkedin url", "linkedin"]),
      source: companyInput.source,
      sourceUrl: companyInput.sourceUrl,
      sourceType: "csv" as const,
      rawProviderData: row,
    };
    const company = normalizeCompanyInput(companyInput);
    if (!company.data) {
      return { rowNumber: index + 1, status: "skipped", warnings: [], skippedReason: company.skippedReason, raw: row };
    }
    const contact = normalizeContactInput(contactInput, "__preview__");
    const warnings = new Set<DataQualityWarning>(company.data.dataQualityWarnings as DataQualityWarning[]);
    if (company.data.domain && seenDomains.has(company.data.domain)) warnings.add("duplicate_domain");
    if (contact.data?.normalizedEmail && seenEmails.has(contact.data.normalizedEmail)) warnings.add("duplicate_contact_email");
    if (company.data.domain) seenDomains.add(company.data.domain);
    if (contact.data?.normalizedEmail) seenEmails.add(contact.data.normalizedEmail);
    return { rowNumber: index + 1, status: warnings.size ? "warning" : "ready", company: company.data, contact: contact.data, warnings: [...warnings], raw: row };
  });
}

const STATUS_STYLE: Record<string, { bg: string; text: string }> = {
  ready:   { bg: "bg-emerald-50", text: "text-emerald-700" },
  warning: { bg: "bg-amber-50",   text: "text-amber-700" },
  skipped: { bg: "bg-slate-100",  text: "text-slate-500" },
};

export function CsvImportPage() {
  const [rows, setRows] = useState<ImportPreviewRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [dragging, setDragging] = useState(false);

  function handleFile(file?: File) {
    setMessage(null);
    if (!file) return;
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => setRows(previewRows(results.data)),
    });
  }

  async function importReadyRows() {
    setImporting(true);
    let created = 0;
    let skipped = 0;
    try {
      for (const row of rows) {
        if (row.status === "skipped" || !row.company?.name) { skipped += 1; continue; }
        const companyResult = await createOrMergeCompany({ ...row.company, sourceType: "csv", rawProviderData: row.raw });
        if (!("id" in companyResult) || !companyResult.id) { skipped += 1; continue; }
        created += companyResult.status === "created" ? 1 : 0;
        if (row.contact) await createContactIfNotDuplicate(companyResult.id, { ...row.contact, sourceType: "csv", rawProviderData: row.raw });
      }
      await createLog({ type: "csv.import", level: "info", message: `CSV import finished: ${created} companies created, ${skipped} rows skipped.`, metadata: { created, skipped, totalRows: rows.length } });
      setMessage({ type: "success", text: `✓ Import complete — ${created} companies created, ${skipped} rows skipped.` });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Import failed." });
    } finally {
      setImporting(false);
    }
  }

  const ready = rows.filter((r) => r.status !== "skipped").length;
  const skipped = rows.filter((r) => r.status === "skipped").length;
  const warnings = rows.filter((r) => r.status === "warning").length;

  return (
    <>
      <PageHeader
        title="CSV Import"
        description="Upload a spreadsheet of companies and contacts. We'll preview, deduplicate, and normalize before saving."
      />

      {/* Upload area */}
      <div
        className={`relative mb-6 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-8 py-14 text-center transition-colors ${
          dragging ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-slate-50 hover:border-blue-300 hover:bg-blue-50/40"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
        onClick={() => document.getElementById("csv-file-input")?.click()}
      >
        <Upload className={`size-8 mb-3 ${dragging ? "text-blue-500" : "text-slate-400"}`} />
        <p className="text-[14px] font-semibold text-slate-700">Drop your CSV here or click to browse</p>
        <p className="mt-1 text-[12px] text-slate-400">Supported columns: company name, website, city, industry, contact name, email, phone, LinkedIn</p>
        <input
          id="csv-file-input"
          type="file"
          accept=".csv,text/csv"
          className="absolute inset-0 opacity-0"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>

      {/* Result message */}
      {message && (
        <div className={`mb-4 flex items-center gap-2 rounded-xl px-4 py-3 text-[13px] font-medium ${
          message.type === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"
        }`}>
          {message.type === "success" ? <CheckCircle2 className="size-4 shrink-0" /> : <AlertCircle className="size-4 shrink-0" />}
          {message.text}
        </div>
      )}

      {/* Preview */}
      {rows.length > 0 && (
        <>
          {/* Stats + import button */}
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex-1 flex flex-wrap gap-3 text-[12px]">
              <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">
                <span className="size-1.5 rounded-full bg-emerald-500" />{ready} ready
              </span>
              {warnings > 0 && (
                <span className="flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 font-semibold text-amber-700">
                  <span className="size-1.5 rounded-full bg-amber-500" />{warnings} with warnings
                </span>
              )}
              {skipped > 0 && (
                <span className="flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-500">
                  <span className="size-1.5 rounded-full bg-slate-400" />{skipped} skipped
                </span>
              )}
            </div>
            <Button
              onClick={() => void importReadyRows()}
              disabled={importing || ready === 0}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {importing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              Import {ready} rows
            </Button>
          </div>

          {/* Preview table */}
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-left text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3 w-12">#</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Domain</th>
                  <th className="px-4 py-3">Contact email</th>
                  <th className="px-4 py-3">Issues</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const style = STATUS_STYLE[row.status] ?? STATUS_STYLE.skipped;
                  return (
                    <tr key={row.rowNumber} className="border-b border-slate-100 last:border-0 hover:bg-blue-50/30 transition-colors">
                      <td className="px-4 py-2.5 text-[11px] text-slate-400">{row.rowNumber}</td>
                      <td className="px-4 py-2.5">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style.bg} ${style.text}`}>
                          {row.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-medium text-slate-800 max-w-[180px] truncate">{row.company?.name ?? "Not saved"}</td>
                      <td className="px-4 py-2.5 text-[12px] text-slate-500 max-w-[140px] truncate">{row.company?.domain ?? "—"}</td>
                      <td className="px-4 py-2.5 text-[12px] text-slate-500 max-w-[180px] truncate">{row.contact?.normalizedEmail ?? "—"}</td>
                      <td className="px-4 py-2.5 text-[11px] text-slate-500 max-w-[200px] truncate">
                        {row.skippedReason ?? (row.warnings.map((w) => w.replaceAll("_", " ")).join(", ") || "—")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
