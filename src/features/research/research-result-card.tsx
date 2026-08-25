"use client";

import { format } from "date-fns";
import { ExternalLink } from "lucide-react";
import type { LeadResearch } from "@/types/firestore";
import { ConfidenceBadge } from "@/components/common/confidence-badge";
import { FitScoreBadge } from "@/components/common/fit-score-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function timestampLabel(value?: LeadResearch["createdAt"]) {
  if (!value || !("toDate" in value)) return "Pending timestamp";
  return format(value.toDate(), "PPpp");
}

function ListBlock({ title, items }: { title: string; items?: string[] }) {
  return (
    <div className="rounded-lg border bg-slate-50/60 p-4">
      <h4 className="text-sm font-semibold">{title}</h4>
      {items?.length ? (
        <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-muted-foreground">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">No data.</p>
      )}
    </div>
  );
}

export function ResearchResultCard({ research }: { research: LeadResearch }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>Latest AI research</CardTitle>
            <CardDescription>
              {research.aiProvider ?? "provider unknown"} • {research.model ?? "model unknown"} • {research.promptVersion ?? "prompt unknown"}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{research.status}</Badge>
            {research.segment ? <Badge variant="secondary">{research.segment.replaceAll("_", " ")}</Badge> : null}
            {research.recommendedNextAction ? <Badge variant="outline">{research.recommendedNextAction.replaceAll("_", " ")}</Badge> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {research.error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{research.error}</p> : null}
        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-lg border bg-background p-4">
            <p className="text-xs text-muted-foreground">Fit score</p>
            <div className="mt-2"><FitScoreBadge score={research.fitScore} /></div>
          </div>
          <div className="rounded-lg border bg-background p-4">
            <p className="text-xs text-muted-foreground">Confidence</p>
            <div className="mt-2"><ConfidenceBadge confidence={research.confidence} /></div>
          </div>
          <div className="rounded-lg border bg-background p-4">
            <p className="text-xs text-muted-foreground">Created</p>
            <p className="mt-2 text-sm font-medium">{timestampLabel(research.createdAt)}</p>
          </div>
          <div className="rounded-lg border bg-background p-4">
            <p className="text-xs text-muted-foreground">Completed</p>
            <p className="mt-2 text-sm font-medium">{timestampLabel(research.completedAt ?? research.createdAt)}</p>
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle>Research summary</CardTitle>
              <CardDescription>{research.bestOffer ?? "No offer selected"}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              <p>{research.researchSummary ?? "No summary yet."}</p>
              <div>
                <h4 className="font-semibold text-foreground">Personalized angle</h4>
                <p className="mt-1">{research.personalizedAngle ?? "No angle yet."}</p>
              </div>
              <div>
                <h4 className="font-semibold text-foreground">Reasoning summary</h4>
                <p className="mt-1">{research.reasoningSummary ?? "No reasoning summary."}</p>
              </div>
            </CardContent>
          </Card>
          <div className="grid gap-4">
            <ListBlock title="Detected needs" items={research.detectedNeeds} />
            <ListBlock title="Target personas" items={research.decisionMakersToTarget} />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <ListBlock title="Pain points" items={research.painPoints} />
          <ListBlock title="Buying triggers" items={research.buyingTriggers} />
          <ListBlock title="Risks" items={research.risks} />
        </div>
        <div className="rounded-lg border bg-slate-50/60 p-4">
          <h4 className="text-sm font-semibold">Source URLs</h4>
          <div className="mt-2 flex flex-wrap gap-2">
            {research.sourceUrls?.length ? (
              research.sourceUrls.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-1 text-xs hover:underline">
                  {url}
                  <ExternalLink className="size-3" />
                </a>
              ))
            ) : (
              <span className="text-sm text-muted-foreground">No source URLs.</span>
            )}
          </div>
        </div>
        <details className="rounded-lg border bg-slate-950 p-4 text-slate-100">
          <summary className="cursor-pointer text-sm font-medium">Advanced debug: raw output</summary>
          <pre className="mt-3 max-h-80 overflow-auto text-xs">{JSON.stringify(research.rawOutput ?? {}, null, 2)}</pre>
        </details>
      </CardContent>
    </Card>
  );
}
