"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Building2, Upload } from "lucide-react";
import type { Company } from "@/types/firestore";
import { listCompanies, listContacts, listOutreachDrafts } from "@/lib/firebase/firestore";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/page-header";
import { LoadingSkeleton } from "@/components/common/loading-skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { CompanyCreateDialog } from "@/features/companies/company-create-dialog";
import { CompanyTable } from "@/features/companies/company-table";

export function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [outreachCounts, setOutreachCounts] = useState<Record<string, number>>({});
  const [contactCounts, setContactCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    void Promise.all([listCompanies(), listOutreachDrafts(), listContacts()])
      .then(([companyResults, outreachResults, contactResults]) => {
        setCompanies(companyResults);
        setOutreachCounts(
          outreachResults.reduce<Record<string, number>>((acc, item) => {
            acc[item.companyId] = (acc[item.companyId] ?? 0) + 1;
            return acc;
          }, {})
        );
        setContactCounts(
          contactResults.reduce<Record<string, number>>((acc, item) => {
            acc[item.companyId] = (acc[item.companyId] ?? 0) + 1;
            return acc;
          }, {})
        );
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => refresh(), [refresh]);

  if (loading) return <LoadingSkeleton />;

  return (
    <>
      <PageHeader
        title="Companies"
        description="A clean, deduplicated company database prepared for future discovery, research, and outreach phases."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/app/import">
                <Upload className="size-4" />
                Import CSV
              </Link>
            </Button>
            <CompanyCreateDialog onCreated={refresh} />
          </>
        }
      />
      {companies.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No companies imported"
          description="Start with a manual company or import a CSV. Phase 1 validates names, domains, source metadata, and duplicates."
          action={{ label: "Import CSV", href: "/app/import" }}
        />
      ) : (
        <CompanyTable companies={companies} outreachCounts={outreachCounts} contactCounts={contactCounts} onDeleted={refresh} />
      )}
    </>
  );
}
