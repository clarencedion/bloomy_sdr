"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Company, Contact, LeadResearch, Outreach } from "@/types/firestore";
import { listOutreachForCompany, listResearchForCompany } from "@/lib/firebase/firestore";
import { EmptyState } from "@/components/common/empty-state";
import { Mail } from "lucide-react";
import { OutreachEditor } from "@/features/outreach/outreach-editor";

export function CompanyOutreachTab({ company, contacts }: { company: Company; contacts: Contact[] }) {
  const [outreach, setOutreach] = useState<Outreach[]>([]);
  const [research, setResearch] = useState<LeadResearch[]>([]);

  const refresh = useCallback(async () => {
    const [outreachResults, researchResults] = await Promise.all([listOutreachForCompany(company.id), listResearchForCompany(company.id)]);
    setOutreach(outreachResults);
    setResearch(researchResults);
  }, [company.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const latestResearch = useMemo(() => research.find((item) => item.status === "completed"), [research]);
  const latestOutreach = outreach[0];

  return (
    <div className="space-y-4">
      {!latestResearch ? (
        <EmptyState icon={Mail} title="Research required first" description="Run AI Research before generating outreach. This keeps drafts grounded in validated research." />
      ) : null}
      <OutreachEditor company={company} contacts={contacts} research={latestResearch} outreach={latestOutreach} onRefresh={refresh} />
    </div>
  );
}
