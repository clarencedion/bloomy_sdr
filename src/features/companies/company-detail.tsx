"use client";

import { useEffect, useState } from "react";
import { notFound, useParams } from "next/navigation";
import { Activity, Bot, Contact, FileText, Loader2, MailCheck, NotebookText, Users } from "lucide-react";
import type { Company, Contact as ContactType } from "@/types/firestore";
import { callFindContactsForCompany, callGenerateProposalPdf } from "@/lib/firebase/functions";
import { clearCompanyWebsite, getCompany, listContactsForCompany, listGeneratedDocumentsForCompany, listLogsForCompany, listOutreachForCompany, updateCompanyWebsite } from "@/lib/firebase/firestore";
import { PageHeader } from "@/components/common/page-header";
import { StatusPill } from "@/components/common/status-pill";
import { FitScoreBadge } from "@/components/common/fit-score-badge";
import { LoadingSkeleton } from "@/components/common/loading-skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CompanyResearchTab } from "@/features/research/company-research-tab";
import { CompanyOutreachTab } from "@/features/outreach/company-outreach-tab";
import { CompanyEvidenceTab } from "@/features/companies/company-evidence-tab";
import { QualificationBadge } from "@/features/companies/opportunity-score-card";


function PlaceholderTab({ icon: Icon, title, description }: { icon: typeof Bot; title: string; description: string }) {
  return (
    <Card>
      <CardContent className="flex min-h-52 flex-col items-center justify-center p-8 text-center">
        <div className="mb-4 flex size-11 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-5" />
        </div>
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

export function CompanyDetail() {
  const params = useParams<{ companyId: string }>();
  type GeneratedDoc = { id: string; type: string; title: string; publicUrl?: string; status: string; createdAt: unknown; outreachId?: string };
  type OutreachDoc = { id: string; status: string; generatedSubject?: string; landingPageDraft?: Record<string, unknown> };

  const [company, setCompany] = useState<Company | null>(null);
  const [contacts, setContacts] = useState<ContactType[]>([]);
  const [generatedDocs, setGeneratedDocs] = useState<GeneratedDoc[]>([]);
  const [outreachList, setOutreachList] = useState<OutreachDoc[]>([]);
  const [activityLogs, setActivityLogs] = useState<{ id: string; type: string; level: string; message: string; createdAt: unknown; metadata?: Record<string, unknown> }[]>([]);
  const [loading, setLoading] = useState(true);
  const [websiteInput, setWebsiteInput] = useState("");
  const [savingWebsite, setSavingWebsite] = useState(false);
  const [clearingWebsite, setClearingWebsite] = useState(false);
  const [findingContacts, setFindingContacts] = useState(false);
  const [contactDiscoveryResult, setContactDiscoveryResult] = useState<{ created: number; error?: string } | null>(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [pdfResult, setPdfResult] = useState<{ downloadUrl: string } | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  async function refreshCompany() {
    const [companyResult, contactsResult, docsResult, outreachResult, logsResult] = await Promise.all([
      getCompany(params.companyId),
      listContactsForCompany(params.companyId),
      listGeneratedDocumentsForCompany(params.companyId),
      listOutreachForCompany(params.companyId),
      listLogsForCompany(params.companyId)
    ]);
    setCompany(companyResult);
    setContacts(contactsResult);
    setGeneratedDocs(docsResult);
    setOutreachList(outreachResult as OutreachDoc[]);
    setActivityLogs(logsResult as typeof activityLogs);
  }

  useEffect(() => {
    void Promise.all([
      getCompany(params.companyId),
      listContactsForCompany(params.companyId),
      listGeneratedDocumentsForCompany(params.companyId),
      listOutreachForCompany(params.companyId),
      listLogsForCompany(params.companyId)
    ])
      .then(([companyResult, contactsResult, docsResult, outreachResult, logsResult]) => {
        setCompany(companyResult);
        setContacts(contactsResult);
        setGeneratedDocs(docsResult);
        setOutreachList(outreachResult as OutreachDoc[]);
        setActivityLogs(logsResult as typeof activityLogs);
      })
      .finally(() => setLoading(false));
  }, [params.companyId]);

  async function saveWebsite() {
    if (!websiteInput.trim()) return;
    setSavingWebsite(true);
    try {
      await updateCompanyWebsite(params.companyId, websiteInput);
      setWebsiteInput("");
      await refreshCompany();
    } finally {
      setSavingWebsite(false);
    }
  }

  async function clearWebsite() {
    setClearingWebsite(true);
    try {
      await clearCompanyWebsite(params.companyId);
      await refreshCompany();
    } finally {
      setClearingWebsite(false);
    }
  }

  async function findContacts() {
    setFindingContacts(true);
    setContactDiscoveryResult(null);
    try {
      const result = await callFindContactsForCompany(params.companyId);
      setContactDiscoveryResult({ created: result.created, error: result.error });
      await refreshCompany();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Contact discovery failed.";
      setContactDiscoveryResult({ created: 0, error: message });
    } finally {
      setFindingContacts(false);
    }
  }

  async function generatePdf() {
    const approvedOutreach = outreachList.find((o) => o.status === "approved" && o.landingPageDraft);
    if (!approvedOutreach) return;
    setGeneratingPdf(true);
    setPdfResult(null);
    setPdfError(null);
    try {
      const result = await callGenerateProposalPdf(approvedOutreach.id);
      setPdfResult({ downloadUrl: result.downloadUrl });
      await refreshCompany();
    } catch (error) {
      const message = error instanceof Error ? error.message : "PDF generation failed.";
      setPdfResult({ downloadUrl: "" });
      setPdfError(message);
      console.error(message);
    } finally {
      setGeneratingPdf(false);
    }
  }

  if (loading) return <LoadingSkeleton />;
  if (!company) notFound();

  return (
    <>
      <PageHeader
        title={company.name}
        description={[company.domain, company.city, company.industry].filter(Boolean).join(" • ") || "Company detail"}
        actions={
          <>
            <QualificationBadge state={company.qualificationState ?? company.opportunityScore?.qualificationState} />
            <StatusPill status={company.status} />
            <FitScoreBadge score={company.fitScore} />
          </>
        }
      />
      {(() => {
        const needsResearch = !company.fitScore && company.status !== "rejected";
        const noContacts = contacts.length === 0 && Boolean(company.fitScore);
        const hasApprovedOutreach = outreachList.some((o) => o.status === "approved");
        const hasSentOutreach = outreachList.some((o) => ["sent", "exported"].includes(o.status));
        const step = needsResearch ? { label: "Go to Research tab → Run AI Research (auto-finds website + contacts)", color: "bg-blue-50 border-blue-200 text-blue-700" }
          : noContacts ? { label: "Contacts tab → Find via Dropcontact (or run AI Research again)", color: "bg-blue-50 border-blue-200 text-blue-700" }
          : !hasApprovedOutreach && !hasSentOutreach ? { label: "Outreach tab → Review and approve the draft", color: "bg-purple-50 border-purple-200 text-purple-800" }
          : hasApprovedOutreach && !hasSentOutreach ? { label: "Outreach tab → Send via Instantly", color: "bg-emerald-50 border-emerald-200 text-emerald-800" }
          : null;
        if (!step) return null;
        return (
          <div className={`mb-3 flex items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium ${step.color}`}>
            <span className="shrink-0">Next step:</span>
            <span>{step.label}</span>
          </div>
        );
      })()}
      <Tabs defaultValue="overview">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="evidence">Signals & Evidence</TabsTrigger>
          <TabsTrigger value="research">AI Research</TabsTrigger>
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
          <TabsTrigger value="outreach">Outreach</TabsTrigger>
          <TabsTrigger value="page">Generated Page</TabsTrigger>
          <TabsTrigger value="meetings">Meetings</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
            <Card>
              <CardHeader>
                <CardTitle>Company profile</CardTitle>
                <CardDescription>Normalized fields and quality signals prepared for future automation.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                {[
                  ["Name", company.name],
                  ["Normalized name", company.normalizedName],
                  ["Domain", company.domain],
                  ["Website", company.website],
                  ["City", company.city],
                  ["Industry", company.industry],
                  ["SIREN", company.siren],
                  ["SIRET", company.siret],
                  ["Source", company.source ?? company.sourceType],
                  ["Source confidence", `${Math.round((company.sourceConfidence ?? 0) * 100)}%`]
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md border bg-slate-50/60 p-3">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-1 text-sm font-medium">{value || "Not set"}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Pipeline status</CardTitle>
                <CardDescription>Run AI Research in the Research tab — it auto-resolves the website, scores the lead, and finds contacts via Dropcontact.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">Website</span>
                  <div className="flex items-center gap-2">
                    <span className={`font-medium truncate max-w-[180px] ${company.website ?? company.domain ? "text-emerald-600" : "text-amber-600"}`}>
                      {company.website ?? company.domain ?? "Not found"}
                    </span>
                    {(company.website ?? company.domain) ? (
                      <button onClick={() => void clearWebsite()} disabled={clearingWebsite} className="text-xs text-muted-foreground underline hover:text-destructive">
                        {clearingWebsite ? "…" : "clear"}
                      </button>
                    ) : null}
                  </div>
                </div>
                {[
                  { label: "AI research", value: company.fitScore ? `Score ${company.fitScore}/100` : "Not run", ok: Boolean(company.fitScore) },
                  { label: "Contacts", value: `${contacts.length} contact${contacts.length !== 1 ? "s" : ""}`, ok: contacts.length > 0 },
                  { label: "Outreach draft", value: outreachList.some((o) => ["draft", "approved"].includes(o.status)) ? "Ready to review" : "Not generated", ok: outreachList.some((o) => ["draft", "approved"].includes(o.status)) },
                  { label: "Sent", value: outreachList.some((o) => ["sent", "exported"].includes(o.status)) ? "Sent via Instantly" : "Not sent", ok: outreachList.some((o) => ["sent", "exported"].includes(o.status)) }
                ].map(({ label, value, ok }) => (
                  <div key={label} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-muted-foreground">{label}</span>
                    <span className={`font-medium ${ok ? "text-emerald-600" : "text-amber-600"}`}>{value}</span>
                  </div>
                ))}
                {!company.website && !company.domain ? (
                  <div className="space-y-2 pt-1">
                    <p className="text-xs text-muted-foreground">No website auto-detected. Enter it manually to help the AI research.</p>
                    <div className="flex gap-2">
                      <Input value={websiteInput} onChange={(e) => setWebsiteInput(e.target.value)} placeholder="https://example.fr" className="text-sm" onKeyDown={(e) => e.key === "Enter" && void saveWebsite()} />
                      <Button size="sm" onClick={() => void saveWebsite()} disabled={savingWebsite || !websiteInput.trim()}>
                        {savingWebsite ? <Loader2 className="size-3 animate-spin" /> : "Save"}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Data quality</CardTitle>
                <CardDescription>No lead should advance with weak core data.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-4xl font-semibold">{company.qualityScore ?? 0}/100</div>
                <div className="mt-4 space-y-2">
                  {(company.dataQualityWarnings ?? []).length ? (
                    company.dataQualityWarnings.map((warning) => (
                      <div key={warning} className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                        {warning.replaceAll("_", " ")}
                      </div>
                    ))
                  ) : (
                    <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">No quality warnings.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="evidence">
          <CompanyEvidenceTab company={company} onCompanyUpdated={setCompany} />
        </TabsContent>
        <TabsContent value="research">

          <CompanyResearchTab company={company} onCompanyUpdated={setCompany} />
        </TabsContent>
        <TabsContent value="contacts">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>Contacts & Decision Makers</CardTitle>
                <CardDescription>Multi-provider waterfall (Dropcontact, Website, Secondary) with Offer Persona priority ranking and strict email verification.</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => void findContacts()} disabled={findingContacts}>
                {findingContacts ? <Loader2 className="size-4 animate-spin" /> : <Users className="size-4" />}
                {findingContacts ? "Discovering…" : "Discover Decision Makers"}
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {contactDiscoveryResult ? (
                <div className={contactDiscoveryResult.error ? "rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" : "rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700"}>
                  {contactDiscoveryResult.error ?? `${contactDiscoveryResult.created} new contact${contactDiscoveryResult.created !== 1 ? "s" : ""} discovered.`}
                </div>
              ) : null}
              {contacts.length ? (
                <div className="divide-y rounded-md border">
                  {contacts.map((contact) => (
                    <div key={contact.id} className="flex flex-col gap-2 p-3 text-sm md:flex-row md:items-center md:justify-between">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-900">{contact.fullName ?? "Unnamed contact"}</span>
                        {contact.isPrimaryDecisionMaker && (
                          <span className="inline-flex items-center gap-0.5 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.2 text-[10px] font-bold text-amber-700">
                            ★ Primary
                          </span>
                        )}
                        {contact.personaMatched && (
                          <span className="rounded-md border border-indigo-100 bg-indigo-50/70 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                            {contact.personaPriority ? `P${contact.personaPriority} · ` : ""}{contact.personaMatched}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">({contact.role ?? "Role unknown"})</span>
                      </div>
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-slate-600">{contact.email ?? "No email"}</span>
                        {contact.emailVerified || contact.emailQualification === "verified" ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                            Verified
                          </span>
                        ) : contact.emailQualification === "guessed" ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                            Guessed
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                            Unverified
                          </span>
                        )}
                        {contact.phone && <span className="text-xs text-slate-500">{contact.phone}</span>}
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground uppercase">
                          <MailCheck className="size-3" />
                          {contact.sourceType ?? contact.source ?? "enrichment"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-md border border-dashed p-6 text-center">
                  <Contact className="size-7 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No contacts yet. Click &quot;Discover Decision Makers&quot; or run AI Research.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="outreach">
          <CompanyOutreachTab company={company} contacts={contacts} />
        </TabsContent>
        <TabsContent value="page">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>Proposition PDF</CardTitle>
                <CardDescription>Generate a branded PDF from the approved outreach draft to send to the prospect.</CardDescription>
              </div>
              {outreachList.some((o) => o.status === "approved" && o.landingPageDraft) ? (
                <Button variant="outline" size="sm" onClick={() => void generatePdf()} disabled={generatingPdf}>
                  {generatingPdf ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
                  {generatingPdf ? "Generating…" : "Generate PDF"}
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-3">
              {pdfError ? (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  {pdfError}
                </div>
              ) : null}
              {pdfResult?.downloadUrl ? (
                <a href={`${pdfResult.downloadUrl}${pdfResult.downloadUrl.includes('?') ? '&' : '?'}t=${Date.now()}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-md bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100">
                  <FileText className="size-4" />
                  Download generated PDF
                </a>
              ) : null}
              {generatedDocs.filter((d) => d.type === "pdf").length ? (
                <div className="divide-y rounded-md border">
                  {generatedDocs.filter((d) => d.type === "pdf").map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                      <div>
                        <p className="font-medium">{doc.title}</p>
                        <p className="text-xs text-muted-foreground capitalize">{doc.status}</p>
                      </div>
                      {doc.publicUrl ? (
                        <a href={`${doc.publicUrl}${doc.publicUrl.includes('?') ? '&' : '?'}t=${Date.now()}`} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                          Download
                        </a>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : !pdfResult ? (
                <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-md border border-dashed p-6 text-center">
                  <FileText className="size-7 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {outreachList.some((o) => o.status === "approved") ? "Click “Generate PDF” to create the proposal." : "Approve an outreach draft first to generate a PDF."}
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="meetings">
          <PlaceholderTab icon={Users} title="Meetings are future work" description="Calendar and booking integrations arrive in a later phase." />
        </TabsContent>
        <TabsContent value="activity">
          <Card>
            <CardHeader>
              <CardTitle>Activity log</CardTitle>
              <CardDescription>All function calls, research steps, enrichment results, and errors for this company.</CardDescription>
            </CardHeader>
            <CardContent>
              {!activityLogs.length ? (
                <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-md border border-dashed p-6 text-center">
                  <Activity className="size-7 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No activity yet. Run AI research or enrichment to see logs here.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {activityLogs.map((log) => {
                    const ts = log.createdAt && typeof (log.createdAt as { toDate?: () => Date }).toDate === "function"
                      ? (log.createdAt as { toDate: () => Date }).toDate().toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })
                      : "";
                    const levelColor = log.level === "error" ? "border-red-200 bg-red-50" : log.level === "warning" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50";
                    const levelText = log.level === "error" ? "text-red-700" : log.level === "warning" ? "text-amber-700" : "text-slate-600";
                    return (
                      <div key={log.id} className={`rounded-md border px-3 py-2 text-xs ${levelColor}`}>
                        <div className="flex items-start justify-between gap-4">
                          <div className="space-y-0.5">
                            <span className={`font-mono font-semibold ${levelText}`}>{log.type}</span>
                            <p className="text-slate-700">{log.message}</p>
                            {log.metadata && Object.keys(log.metadata).filter((k) => k !== "companyId").length > 0 ? (
                              <pre className="mt-1 whitespace-pre-wrap font-mono text-[10px] text-muted-foreground">
                                {JSON.stringify(Object.fromEntries(Object.entries(log.metadata).filter(([k]) => k !== "companyId")), null, 2)}
                              </pre>
                            ) : null}
                          </div>
                          <span className="shrink-0 text-muted-foreground">{ts}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="notes">
          <PlaceholderTab icon={NotebookText} title="Notes placeholder" description="Manual sales notes can be added after the core foundation is stable." />
        </TabsContent>
      </Tabs>
    </>
  );
}
