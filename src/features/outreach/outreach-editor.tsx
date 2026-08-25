"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, RefreshCw, Save, X, SearchCheck } from "lucide-react";
import type { Company, Contact, LeadResearch, Outreach } from "@/types/firestore";
import {
  callApproveOutreach,
  callGenerateOutreach,
  callNeedsMoreResearch,
  callRejectOutreach,
  callUpdateOutreachDraft
} from "@/lib/firebase/functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type DraftFields = {
  generatedSubject: string;
  generatedBody: string;
  followUp1: string;
  followUp2: string;
  linkedinNote: string;
  linkedinFollowUp: string;
  internalSalesNotes: string;
  suggestedPersona: string;
  cta: string;
  personalizationNotes: string;
  riskWarnings: string;
};

function fieldsFromOutreach(outreach?: Outreach): DraftFields {
  return {
    generatedSubject: outreach?.generatedSubject ?? "",
    generatedBody: outreach?.generatedBody ?? "",
    followUp1: outreach?.followUp1 ?? "",
    followUp2: outreach?.followUp2 ?? "",
    linkedinNote: outreach?.linkedinNote ?? "",
    linkedinFollowUp: outreach?.linkedinFollowUp ?? "",
    internalSalesNotes: outreach?.internalSalesNotes ?? "",
    suggestedPersona: outreach?.suggestedPersona ?? "",
    cta: outreach?.cta ?? "",
    personalizationNotes: outreach?.personalizationNotes?.join("\n") ?? "",
    riskWarnings: outreach?.riskWarnings?.join("\n") ?? ""
  };
}

export function OutreachEditor({
  company,
  contacts,
  research,
  outreach,
  onRefresh
}: {
  company: Company;
  contacts: Contact[];
  research?: LeadResearch;
  outreach?: Outreach;
  onRefresh: () => Promise<void>;
}) {
  const [contactId, setContactId] = useState<string>("none");
  const [fields, setFields] = useState<DraftFields>(() => fieldsFromOutreach(outreach));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFields(fieldsFromOutreach(outreach));
  }, [outreach]);

  const canGenerate = Boolean(research?.status === "completed" && company.leadReadyForOutreach);
  const selectedContact = useMemo(() => contacts.find((contact) => contact.id === contactId), [contactId, contacts]);

  function update<K extends keyof DraftFields>(key: K, value: DraftFields[K]) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  async function runAction(name: string, action: () => Promise<void>) {
    setBusy(name);
    setError(null);
    try {
      await action();
      await onRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Outreach action failed.");
    } finally {
      setBusy(null);
    }
  }

  async function saveEdits() {
    if (!outreach) return;
    await callUpdateOutreachDraft(outreach.id, {
      ...fields,
      personalizationNotes: fields.personalizationNotes.split("\n").map((item) => item.trim()).filter(Boolean),
      riskWarnings: fields.riskWarnings.split("\n").map((item) => item.trim()).filter(Boolean)
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>Outreach generation</CardTitle>
            <CardDescription>No sending or export exists in this phase. Drafts require human approval.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {outreach ? <Badge variant="outline">{outreach.status.replaceAll("_", " ")}</Badge> : null}
            {outreach?.aiProvider ? <Badge variant="secondary">{outreach.aiProvider} • {outreach.model}</Badge> : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {research ? (
            <div className="rounded-md border bg-slate-50/70 p-3 text-sm text-muted-foreground">
              Latest research: {research.segment?.replaceAll("_", " ") ?? "segment unknown"} • fit {research.fitScore ?? "?"} • confidence {research.confidence ?? "?"}
              <p className="mt-1">{research.researchSummary ?? "No summary."}</p>
            </div>
          ) : (
            <div className="rounded-md border bg-amber-50 p-3 text-sm text-amber-800">Generate AI research before outreach, or force generation from backend manually later.</div>
          )}
          {!company.leadReadyForOutreach ? (
            <div className="rounded-md border bg-amber-50 p-3 text-sm text-amber-800">
              Lead is not ready for outreach yet: {(company.leadReadinessReasons ?? ["Run website/contact enrichment and complete AI research."]).join(" ")}
            </div>
          ) : null}
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <div className="space-y-2">
              <Label>Contact</Label>
              <Select value={contactId} onValueChange={setContactId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Company-level outreach</SelectItem>
                  {contacts.map((contact) => (
                    <SelectItem key={contact.id} value={contact.id}>
                      {contact.fullName ?? contact.email ?? "Unnamed contact"} {contact.role ? `• ${contact.role}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Button
                disabled={!canGenerate || Boolean(busy)}
                onClick={() =>
                  void runAction("generate", async () => {
                    await callGenerateOutreach({ companyId: company.id, contactId: selectedContact?.id });
                  })
                }
              >
                {busy === "generate" ? <Loader2 className="size-4 animate-spin" /> : null}
                Generate outreach
              </Button>
              {!canGenerate && (
                <Button
                  variant="outline"
                  className="border-amber-200 bg-amber-50 hover:bg-amber-100 hover:text-amber-900 text-amber-800"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void runAction("force-generate", async () => {
                      await callGenerateOutreach({ companyId: company.id, contactId: selectedContact?.id, force: true });
                    })
                  }
                >
                  {busy === "force-generate" ? <Loader2 className="size-4 animate-spin" /> : null}
                  Force generate
                </Button>
              )}
              {outreach ? (
                <Button
                  variant="outline"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void runAction("regenerate", async () => {
                      await callGenerateOutreach({ companyId: company.id, contactId: outreach.contactId, outreachId: outreach.id, force: true });
                    })
                  }
                >
                  <RefreshCw className="size-4" />
                  Regenerate
                </Button>
              ) : null}
            </div>
          </div>
          {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        </CardContent>
      </Card>

      {outreach ? (
        <Card>
          <CardHeader>
            <CardTitle>Draft editor</CardTitle>
            <CardDescription>{outreach.promptVersion ?? "No prompt version"} • created draft only</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="space-y-2">
              <Label>Subject</Label>
              <Input value={fields.generatedSubject} onChange={(event) => update("generatedSubject", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Body</Label>
              <Textarea className="min-h-56" value={fields.generatedBody} onChange={(event) => update("generatedBody", event.target.value)} />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Follow-up 1</Label>
                <Textarea value={fields.followUp1} onChange={(event) => update("followUp1", event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Follow-up 2</Label>
                <Textarea value={fields.followUp2} onChange={(event) => update("followUp2", event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>LinkedIn connection note</Label>
                <Textarea value={fields.linkedinNote} onChange={(event) => update("linkedinNote", event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>LinkedIn follow-up</Label>
                <Textarea value={fields.linkedinFollowUp} onChange={(event) => update("linkedinFollowUp", event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Suggested persona</Label>
                <Input value={fields.suggestedPersona} onChange={(event) => update("suggestedPersona", event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>CTA</Label>
                <Input value={fields.cta} onChange={(event) => update("cta", event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Personalization notes</Label>
                <Textarea value={fields.personalizationNotes} onChange={(event) => update("personalizationNotes", event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Risk warnings</Label>
                <Textarea value={fields.riskWarnings} onChange={(event) => update("riskWarnings", event.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Internal sales notes</Label>
              <Textarea value={fields.internalSalesNotes} onChange={(event) => update("internalSalesNotes", event.target.value)} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={Boolean(busy)} onClick={() => void runAction("save", saveEdits)}>
                <Save className="size-4" />
                Save edits
              </Button>
              <Button variant="outline" disabled={Boolean(busy)} onClick={() => void runAction("approve", () => callApproveOutreach(outreach.id).then(() => undefined))}>
                <Check className="size-4" />
                Approve
              </Button>
              <Button variant="outline" disabled={Boolean(busy)} onClick={() => void runAction("needs", () => callNeedsMoreResearch(outreach.id).then(() => undefined))}>
                <SearchCheck className="size-4" />
                Needs more research
              </Button>
              <Button variant="destructive" disabled={Boolean(busy)} onClick={() => void runAction("reject", () => callRejectOutreach(outreach.id, "Rejected manually.").then(() => undefined))}>
                <X className="size-4" />
                Reject
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
