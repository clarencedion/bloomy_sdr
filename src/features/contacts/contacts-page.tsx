"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Contact as ContactIcon, Mail, Phone, Search, XCircle } from "lucide-react";
import type { Company, Contact } from "@/types/firestore";
import { listCompanies, listContacts } from "@/lib/firebase/firestore";
import { EmptyState } from "@/components/common/empty-state";
import { LoadingSkeleton } from "@/components/common/loading-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

// Avatar with initials
function Avatar({ name }: { name?: string }) {
  const initials = (name ?? "?")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[12px] font-bold text-blue-700">
      {initials}
    </div>
  );
}

// Source badge
const sourceColors: Record<string, string> = {
  dropcontact: "bg-purple-50 text-purple-700 border-purple-200",
  website: "bg-blue-50 text-blue-700 border-blue-200",
  csv: "bg-slate-100 text-slate-600 border-slate-200",
  manual: "bg-amber-50 text-amber-700 border-amber-200",
  enrichment: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

function SourceBadge({ source }: { source?: string }) {
  const key = (source ?? "").toLowerCase();
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        sourceColors[key] ?? "bg-slate-100 text-slate-600 border-slate-200"
      )}
    >
      {source ?? "unknown"}
    </span>
  );
}

export function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    void Promise.all([listContacts(), listCompanies()])
      .then(([contactResults, companyResults]) => {
        setContacts(contactResults);
        setCompanies(companyResults);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => refresh(), [refresh]);

  const companyMap = useMemo(
    () => new Map(companies.map((c) => [c.id, c])),
    [companies]
  );

  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim();
    return contacts.filter((contact) => {
      const company = companyMap.get(contact.companyId);
      const matchesSearch =
        !term ||
        [contact.fullName, contact.role, contact.email, contact.phone, company?.name]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(term);
      const matchesSource =
        sourceFilter === "all" || contact.sourceType === sourceFilter;
      return matchesSearch && matchesSource;
    });
  }, [companyMap, contacts, search, sourceFilter]);

  if (loading) return <LoadingSkeleton />;

  return (
    <>
      <PageHeader
        title="Contacts"
        description={`${contacts.length} contact${contacts.length !== 1 ? "s" : ""} — people you can email at your target companies.`}
      />

      {/* Filter bar */}
      <div className="mb-4 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 border-slate-200 bg-slate-50 text-[13px] placeholder:text-slate-400 focus:bg-white"
            placeholder="Search name, company, email…"
          />
        </div>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="w-full border-slate-200 text-[13px] md:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            <SelectItem value="website">Website</SelectItem>
            <SelectItem value="csv">CSV import</SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
            <SelectItem value="dropcontact">Dropcontact</SelectItem>
            <SelectItem value="enrichment">Enrichment</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!filtered.length ? (
        <EmptyState
          icon={ContactIcon}
          title="No contacts yet"
          description="Run contact enrichment from a company detail page, or import contacts by CSV."
        />
      ) : (
        /* Card grid — one card per contact */
        <div className="space-y-2">
          {filtered.map((contact) => {
            const company = companyMap.get(contact.companyId);
            const companyName = company?.name ?? null;
            const hasEmail = Boolean(contact.email);

            return (
              <div
                key={contact.id}
                className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3 transition-shadow hover:shadow-sm"
              >
                {/* Avatar */}
                <Avatar name={contact.fullName} />

                {/* Name + role + company */}
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-slate-900 truncate">
                      {contact.fullName ?? "Unnamed"}
                    </span>
                    {contact.emailVerified ? (
                      <span title="Email verified"><CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" /></span>
                    ) : contact.email ? (
                      <span title="Not verified"><XCircle className="size-3.5 shrink-0 text-amber-400" /></span>
                    ) : null}
                  </div>
                  <div className="text-[12px] text-slate-500 truncate">
                    {contact.role ? `${contact.role}` : "Role unknown"}
                    {companyName ? ` · ${companyName}` : ""}
                  </div>
                </div>

                {/* Email */}
                <div className="hidden min-w-0 flex-1 md:block">
                  {hasEmail ? (
                    <a
                      href={`mailto:${contact.email}`}
                      className="flex items-center gap-1.5 text-[12px] text-blue-600 hover:underline truncate"
                    >
                      <Mail className="size-3.5 shrink-0" />
                      <span className="truncate">{contact.email}</span>
                    </a>
                  ) : (
                    <span className="text-[12px] text-slate-400">No email</span>
                  )}
                </div>

                {/* Phone */}
                <div className="hidden min-w-0 w-40 xl:block">
                  {contact.phone ? (
                    <a
                      href={`tel:${contact.phone}`}
                      className="flex items-center gap-1.5 text-[12px] text-slate-600 hover:text-slate-900 truncate"
                    >
                      <Phone className="size-3.5 shrink-0" />
                      <span className="truncate">{contact.phone}</span>
                    </a>
                  ) : (
                    <span className="text-[12px] text-slate-400">—</span>
                  )}
                </div>

                {/* Source badge */}
                <div className="hidden sm:block">
                  <SourceBadge source={contact.source ?? contact.sourceType} />
                </div>

                {/* Company link */}
                <Link
                  href={`/app/companies/${contact.companyId}`}
                  className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors"
                >
                  View company →
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
