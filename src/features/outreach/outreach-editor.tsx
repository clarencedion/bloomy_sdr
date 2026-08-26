"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, FileText, Loader2, RefreshCw, Save, SearchCheck, ShieldAlert, ShieldCheck, X } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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

function countWords(str: string): number {
  if (!str) return 0;
  return str.trim().split(/\s+/).filter(Boolean).length;
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

  const initialBodyWordCount = useMemo(() => countWords(fields.generatedBody), [fields.generatedBody]);
  const linkedinCharCount = useMemo(() => fields.linkedinNote.length, [fields.linkedinNote]);

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
      {/* ── Generation Card ─────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>Génération de l'Outreach & Séquence</CardTitle>
            <CardDescription>Séquence 4-touch ancrée dans les preuves vérifiées. Validation humaine obligatoire.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {outreach ? <Badge variant="outline">{outreach.status.replaceAll("_", " ")}</Badge> : null}
            {outreach?.claimValidationStatus === "VALID" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                <ShieldCheck className="size-3.5" /> Preuves validées
              </span>
            ) : outreach?.claimValidationStatus === "UNSUPPORTED_CLAIMS_DETECTED" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700 border border-red-200">
                <ShieldAlert className="size-3.5" /> Affirmations non prouvées
              </span>
            ) : outreach?.claimValidationStatus === "WARNINGS_ONLY" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 border border-amber-200">
                Avertissements garde-fous
              </span>
            ) : null}
            {outreach?.aiProvider ? <Badge variant="secondary">{outreach.aiProvider} • {outreach.model}</Badge> : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {research ? (
            <div className="rounded-md border bg-slate-50/70 p-3 text-sm text-muted-foreground">
              Recherche terminée : {research.segment?.replaceAll("_", " ") ?? "segment standard"} • fit {research.fitScore ?? "?"}/100 • confiance {research.confidence ?? "?"}%
              <p className="mt-1">{research.researchSummary ?? "Pas de synthèse."}</p>
            </div>
          ) : (
            <div className="rounded-md border bg-amber-50 p-3 text-sm text-amber-800">
              Générez la recherche IA avant de créer la séquence d'outreach.
            </div>
          )}

          {!company.leadReadyForOutreach ? (
            <div className="rounded-md border bg-amber-50 p-3 text-sm text-amber-800">
              Lead non éligible à l'outreach : {(company.leadReadinessReasons ?? ["Enrichir les contacts et finaliser la recherche."]).join(" ")}
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <div className="space-y-2">
              <Label>Contact destinataire</Label>
              <Select value={contactId} onValueChange={setContactId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Outreach générique entreprise</SelectItem>
                  {contacts.map((contact) => (
                    <SelectItem key={contact.id} value={contact.id}>
                      {contact.fullName ?? contact.email ?? "Contact"} {contact.role ? `• ${contact.role}` : ""}
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
                Générer la séquence
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
                  Forcer la génération
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
                  Régénérer
                </Button>
              ) : null}
            </div>
          </div>
          {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        </CardContent>
      </Card>

      {/* ── Sequence Editor & Review Workspace ─────────────────── */}
      {outreach ? (
        <Card>
          <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle>Workspace de relecture & validation</CardTitle>
              <CardDescription>
                Version du prompt : {outreach.promptVersion ?? "devcomm-outreach-v2"} • 4 touches multicanales
              </CardDescription>
            </div>
            {outreach.pdfStorageUrl ? (
              <a
                href={outreach.pdfStorageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors"
              >
                <FileText className="size-4" />
                Visualiser la proposition PDF
              </a>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Verified Evidence Facts Pills (REQ-049) */}
            {outreach.personalizationFacts && outreach.personalizationFacts.length > 0 ? (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Preuves & Faits vérifiés injectés ({outreach.personalizationFacts.length})
                </div>
                <div className="flex flex-wrap gap-2">
                  {outreach.personalizationFacts.map((fact, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-white px-2.5 py-1 text-xs font-medium text-blue-900 shadow-sm"
                      title={fact.provenance ? `Source : ${fact.provenance}` : undefined}
                    >
                      <span className="text-blue-500">✓</span> {fact.label}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Risk Warnings & Validation Alerts (REQ-056) */}
            {fields.riskWarnings ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-900 space-y-1">
                <div className="font-semibold flex items-center gap-1.5">
                  <ShieldAlert className="size-4 text-amber-700" />
                  Points d'attention & alertes détectées :
                </div>
                <ul className="list-disc pl-5 space-y-0.5">
                  {fields.riskWarnings.split("\n").filter(Boolean).map((w, idx) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* 4-Touch Sequence Tabs (REQ-051) */}
            <Tabs defaultValue="initial" className="w-full">
              <TabsList className="grid w-full grid-cols-2 md:grid-cols-5 h-auto p-1 gap-1">
                <TabsTrigger value="initial" className="text-xs py-1.5">
                  1. Email Initial
                </TabsTrigger>
                <TabsTrigger value="followup1" className="text-xs py-1.5">
                  2. Relance 1 (+3j)
                </TabsTrigger>
                <TabsTrigger value="followup2" className="text-xs py-1.5">
                  3. Relance 2 (+7j)
                </TabsTrigger>
                <TabsTrigger value="linkedin" className="text-xs py-1.5">
                  4. Note LinkedIn
                </TabsTrigger>
                <TabsTrigger value="strategy" className="text-xs py-1.5">
                  5. Stratégie & Landing
                </TabsTrigger>
              </TabsList>

              {/* Tab 1: Initial Email */}
              <TabsContent value="initial" className="space-y-4">
                <div className="space-y-2">
                  <Label>Objet du message</Label>
                  <Input value={fields.generatedSubject} onChange={(event) => update("generatedSubject", event.target.value)} />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Corps de l'email (80 à 140 mots recommandés)</Label>
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        initialBodyWordCount >= 80 && initialBodyWordCount <= 140
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : "bg-amber-50 text-amber-700 border border-amber-200"
                      }`}
                    >
                      {initialBodyWordCount} mots
                    </span>
                  </div>
                  <Textarea className="min-h-56 font-sans text-sm leading-relaxed" value={fields.generatedBody} onChange={(event) => update("generatedBody", event.target.value)} />
                </div>
              </TabsContent>

              {/* Tab 2: Follow-up 1 */}
              <TabsContent value="followup1" className="space-y-4">
                <div className="space-y-2">
                  <Label>Relance 1 (J+3 — Variation d'angle sans répétition)</Label>
                  <Textarea className="min-h-40 font-sans text-sm leading-relaxed" value={fields.followUp1} onChange={(event) => update("followUp1", event.target.value)} />
                </div>
              </TabsContent>

              {/* Tab 3: Follow-up 2 */}
              <TabsContent value="followup2" className="space-y-4">
                <div className="space-y-2">
                  <Label>Relance 2 (J+7 — Clôture polie / Breakup)</Label>
                  <Textarea className="min-h-40 font-sans text-sm leading-relaxed" value={fields.followUp2} onChange={(event) => update("followUp2", event.target.value)} />
                </div>
              </TabsContent>

              {/* Tab 4: LinkedIn Notes */}
              <TabsContent value="linkedin" className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Demande de connexion LinkedIn (&le; 300 caractères)</Label>
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        linkedinCharCount <= 300
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : "bg-red-50 text-red-700 border border-red-200"
                      }`}
                    >
                      {linkedinCharCount} / 300 caractères
                    </span>
                  </div>
                  <Textarea className="min-h-24 font-sans text-sm" value={fields.linkedinNote} onChange={(event) => update("linkedinNote", event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Message LinkedIn après acceptation</Label>
                  <Textarea className="min-h-24 font-sans text-sm" value={fields.linkedinFollowUp} onChange={(event) => update("linkedinFollowUp", event.target.value)} />
                </div>
              </TabsContent>

              {/* Tab 5: Strategy & Landing Page */}
              <TabsContent value="strategy" className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Persona ciblé</Label>
                    <Input value={fields.suggestedPersona} onChange={(event) => update("suggestedPersona", event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Call to Action (CTA)</Label>
                    <Input value={fields.cta} onChange={(event) => update("cta", event.target.value)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Notes stratégiques internes SDR</Label>
                  <Textarea value={fields.internalSalesNotes} onChange={(event) => update("internalSalesNotes", event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Notes de personnalisation</Label>
                  <Textarea value={fields.personalizationNotes} onChange={(event) => update("personalizationNotes", event.target.value)} />
                </div>
              </TabsContent>
            </Tabs>

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-200">
              <Button disabled={Boolean(busy)} onClick={() => void runAction("save", saveEdits)}>
                <Save className="size-4" />
                Sauvegarder les modifications
              </Button>
              <Button variant="outline" disabled={Boolean(busy)} onClick={() => void runAction("approve", () => callApproveOutreach(outreach.id).then(() => undefined))}>
                <Check className="size-4" />
                Approuver pour envoi
              </Button>
              <Button variant="outline" disabled={Boolean(busy)} onClick={() => void runAction("needs", () => callNeedsMoreResearch(outreach.id).then(() => undefined))}>
                <SearchCheck className="size-4" />
                Recherche complémentaire
              </Button>
              <Button variant="destructive" disabled={Boolean(busy)} onClick={() => void runAction("reject", () => callRejectOutreach(outreach.id, "Rejeté manuellement.").then(() => undefined))}>
                <X className="size-4" />
                Rejeter
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
