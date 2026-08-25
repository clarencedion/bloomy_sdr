"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Loader2, RotateCcw } from "lucide-react";
import type { Company, LeadResearch } from "@/types/firestore";
import { callResearchCompany, getCallableErrorMessage } from "@/lib/firebase/functions";
import { getCompany, listResearchForCompany } from "@/lib/firebase/firestore";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { ResearchResultCard } from "@/features/research/research-result-card";

export function CompanyResearchTab({ company, onCompanyUpdated }: { company: Company; onCompanyUpdated: (company: Company) => void }) {
  const [research, setResearch] = useState<LeadResearch[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const results = await listResearchForCompany(company.id);
    setResearch(results);
    setLoading(false);
  }, [company.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const latest = useMemo(() => research[0], [research]);

  async function runResearch(force = false) {
    setRunning(true);
    setError(null);
    try {
      const result = await callResearchCompany(company.id, force);
      if (result.status === "failed") setError(result.error ?? "Research failed.");
      await refresh();
      const updated = await getCompany(company.id);
      if (updated) onCompanyUpdated(updated);
    } catch (caught) {
      setError(getCallableErrorMessage(caught, "Research failed."));
    } finally {
      setRunning(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">Loading research...</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border bg-background p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="font-semibold">AI Research Engine</h3>
          <p className="text-sm text-muted-foreground">Runs structured research only. No outreach, email, or page generation.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => void runResearch(false)} disabled={running}>
            {running ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4" />}
            Run AI research
          </Button>
          {latest ? (
            <Button variant="outline" onClick={() => void runResearch(true)} disabled={running}>
              <RotateCcw className="size-4" />
              Regenerate
            </Button>
          ) : null}
        </div>
      </div>
      {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {latest ? (
        <ResearchResultCard research={latest} />
      ) : (
        <EmptyState icon={Bot} title="No research yet" description="Run AI research to create a structured leadResearch result and update company fit fields." />
      )}
    </div>
  );
}
