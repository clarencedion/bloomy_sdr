"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import {
  collection,
  deleteDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  doc,
  onSnapshot
} from "firebase/firestore";
import { Loader2, Play, Radar, ShieldCheck, Trash2, Sparkles, AlertCircle, Pencil, Archive, RotateCcw, Layers } from "lucide-react";
import type { Company, DiscoveryCampaign, DiscoveryRun, RejectedDiscovery } from "@/types/firestore";
import { db } from "@/lib/firebase/client";
import { collections, deleteCompany, listCompanies } from "@/lib/firebase/firestore";
import { callRunDiscoveryCampaign, callRunFullAutomationTest } from "@/lib/firebase/functions";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DiscoveryCreateForm } from "@/features/discovery/discovery-create-form";
import { NlCampaignModal } from "@/features/discovery/nl-campaign-modal";
import { DualFixtureModal } from "@/features/discovery/dual-fixture-modal";

async function listDiscoveryCampaigns() {
  const snapshot = await getDocs(query(collection(db, collections.discoveryCampaigns), orderBy("updatedAt", "desc"), limit(50)));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as DiscoveryCampaign[];
}

async function listDiscoveryRuns() {
  const snapshot = await getDocs(query(collection(db, collections.discoveryRuns), orderBy("startedAt", "desc"), limit(50)));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as DiscoveryRun[];
}

async function listRejectedDiscoveries() {
  const snapshot = await getDocs(query(collection(db, collections.discoveryRejected), orderBy("createdAt", "desc"), limit(50)));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as RejectedDiscovery[];
}

export function DiscoveryPage() {
  const [campaigns, setCampaigns] = useState<DiscoveryCampaign[]>([]);
  const [runs, setRuns] = useState<DiscoveryRun[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [rejected, setRejected] = useState<RejectedDiscovery[]>([]);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [editingCampaign, setEditingCampaign] = useState<DiscoveryCampaign | null>(null);
  const [nlModalOpen, setNlModalOpen] = useState(false);
  const [dualFixtureModalOpen, setDualFixtureModalOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "paused" | "archived">("all");
  
  const [e2eRunning, setE2eRunning] = useState(false);
  const [e2eResult, setE2eResult] = useState<any>(null);
  const [e2eError, setE2eError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [e2eProgress, setE2eProgress] = useState(0);
  const [e2eCurrentStep, setE2eCurrentStep] = useState("");
  const [e2eLogs, setE2eLogs] = useState<string[]>([]);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, []);

  const handleOpenChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      setE2eRunning(false);
    }
  };

  const refresh = useCallback(async () => {
    const [campaignResults, runResults, companyResults, rejectedResults] = await Promise.all([
      listDiscoveryCampaigns(),
      listDiscoveryRuns(),
      listCompanies(),
      listRejectedDiscoveries()
    ]);
    setCampaigns(campaignResults);
    setRuns(runResults);
    setCompanies(companyResults.filter((company) => company.discoveryCampaignId || company.discoveryScore !== undefined));
    setRejected(rejectedResults);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const metrics = useMemo(
    () => ({
      activeCampaigns: campaigns.filter((campaign) => campaign.status === "active").length,
      runs: runs.length,
      created: runs.reduce((total, run) => total + (run.companiesCreated ?? 0), 0),
      queued: runs.reduce((total, run) => total + (run.companiesQueuedForResearch ?? 0), 0),
      rejected: runs.reduce((total, run) => total + (run.companiesRejected ?? 0), 0)
    }),
    [campaigns, runs]
  );

  const displayedCampaigns = useMemo(() => {
    if (statusFilter === "all") return campaigns.filter(c => c.status !== "archived");
    return campaigns.filter(c => c.status === statusFilter);
  }, [campaigns, statusFilter]);

  async function runCampaign(campaign: DiscoveryCampaign) {
    if (campaign.status === "paused" || campaign.status === "archived") return;
    setRunningId(campaign.id);
    try {
      await callRunDiscoveryCampaign(campaign.id);
      await refresh();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Discovery run failed");
    } finally {
      setRunningId(null);
    }
  }

  async function runE2ETest(campaign: DiscoveryCampaign) {
    if (campaign.status === "paused" || campaign.status === "archived") return;
    setE2eRunning(true);
    setE2eError(null);
    setE2eResult(null);
    setE2eProgress(0);
    setE2eCurrentStep("Initializing test run...");
    setE2eLogs([]);
    setDialogOpen(true);

    const testId = doc(collection(db, "automationTests")).id;

    if (unsubscribeRef.current) {
      unsubscribeRef.current();
    }

    const unsubscribe = onSnapshot(doc(db, "automationTests", testId), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.progress !== undefined) setE2eProgress(data.progress);
        if (data.currentStep !== undefined) setE2eCurrentStep(data.currentStep);
        if (data.logs !== undefined) setE2eLogs(data.logs);
        if (data.status === "completed" && data.result) {
          setE2eResult(data.result);
        }
        if (data.status === "failed" && data.error) {
          setE2eError(data.error);
        }
      }
    });

    unsubscribeRef.current = unsubscribe;

    try {
      await callRunFullAutomationTest(campaign.id, testId);
      await refresh();
    } catch (error) {
      setTimeout(() => {
        setE2eError((currentErr) => currentErr || (error instanceof Error ? error.message : "E2E pipeline test failed"));
        setE2eRunning(false);
      }, 500);
    }
  }

  async function setCampaignStatus(campaign: DiscoveryCampaign, status: DiscoveryCampaign["status"]) {
    await updateDoc(doc(db, collections.discoveryCampaigns, campaign.id), {
      status,
      ...(status === "archived" ? { archivedAt: serverTimestamp() } : {}),
      updatedAt: serverTimestamp()
    });
    await refresh();
  }

  async function deleteCampaign(campaign: DiscoveryCampaign) {
    if (!window.confirm(`Delete campaign "${campaign.name}"? Existing companies and runs will remain.`)) return;
    await deleteDoc(doc(db, collections.discoveryCampaigns, campaign.id));
    await refresh();
  }

  async function deleteRun(runId: string) {
    if (!window.confirm("Delete this discovery run record? Companies created by the run will remain.")) return;
    await deleteDoc(doc(db, collections.discoveryRuns, runId));
    await refresh();
  }

  async function deleteRejected(rejectedId: string) {
    if (!window.confirm("Delete this rejected discovery record?")) return;
    await deleteDoc(doc(db, collections.discoveryRejected, rejectedId));
    await refresh();
  }

  async function deleteDiscoveredCompany(company: Company) {
    if (!window.confirm(`Delete ${company.name}? This also removes linked contacts and pending research queue records.`)) return;
    await deleteCompany(company.id);
    await refresh();
  }

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <PageHeader
          title="Campaigns"
          description="Create and run discovery campaigns. The AI finds matching companies automatically."
        />
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setDualFixtureModalOpen(true)}
            className="border-indigo-200 bg-indigo-50/50 hover:bg-indigo-100 text-indigo-900 font-semibold gap-1.5 shadow-xs"
          >
            <Layers className="size-4 text-indigo-600" />
            Multi-Business E2E
          </Button>
          <Button
            onClick={() => setNlModalOpen(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold gap-2 shadow-xs"
          >
            <Sparkles className="size-4 text-indigo-200" />
            AI Campaign Builder
          </Button>
        </div>
      </div>
      <div className="mb-6 grid gap-3 md:grid-cols-5">
        {[
          ["Active campaigns", metrics.activeCampaigns, "#6366F1"],
          ["Total runs", metrics.runs, "#3B82F6"],
          ["Companies created", metrics.created, "#10B981"],
          ["Queued for research", metrics.queued, "#F59E0B"],
          ["Rejected / skipped", metrics.rejected, "#EF4444"]
        ].map(([label, value, color]) => (
          <div key={label as string} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">{label}</div>
            <div className="mt-2 text-2xl font-bold" style={{ color: color as string }}>{value}</div>
          </div>
        ))}
      </div>
      <Tabs defaultValue="campaigns">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="create">Manual create</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="companies">Discovered companies</TabsTrigger>
          <TabsTrigger value="rejected">Rejected/skipped</TabsTrigger>
          <TabsTrigger value="providers">Providers</TabsTrigger>
        </TabsList>
        <TabsContent value="campaigns">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-1.5 text-xs text-slate-600">
              <span className="font-semibold text-slate-700">Filter:</span>
              <Button
                variant={statusFilter === "all" ? "default" : "ghost"}
                size="sm"
                className="h-7 text-xs px-2.5"
                onClick={() => setStatusFilter("all")}
              >
                Active & Paused
              </Button>
              <Button
                variant={statusFilter === "active" ? "default" : "ghost"}
                size="sm"
                className="h-7 text-xs px-2.5"
                onClick={() => setStatusFilter("active")}
              >
                Active
              </Button>
              <Button
                variant={statusFilter === "paused" ? "default" : "ghost"}
                size="sm"
                className="h-7 text-xs px-2.5"
                onClick={() => setStatusFilter("paused")}
              >
                Paused
              </Button>
              <Button
                variant={statusFilter === "archived" ? "default" : "ghost"}
                size="sm"
                className="h-7 text-xs px-2.5"
                onClick={() => setStatusFilter("archived")}
              >
                Archived ({campaigns.filter(c => c.status === "archived").length})
              </Button>
            </div>
          </div>

          {displayedCampaigns.length ? (
            <div className="space-y-3">
              {displayedCampaigns.map((campaign) => {
                const isPaused = campaign.status === "paused";
                const isArchived = campaign.status === "archived";
                const signals = campaign.researchStrategy?.enabledSignalProviders || [];

                return (
                  <div key={campaign.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900">{campaign.name}</span>
                          <Badge
                            variant="outline"
                            className={`text-[11px] font-medium ${
                              isArchived
                                ? "border-amber-200 bg-amber-50 text-amber-800"
                                : isPaused
                                ? "border-slate-300 bg-slate-100 text-slate-700"
                                : "border-emerald-200 bg-emerald-50 text-emerald-800"
                            }`}
                          >
                            {campaign.status}
                          </Badge>
                        </div>
                        {campaign.naturalLanguagePrompt && (
                          <p className="text-xs text-indigo-700 italic bg-indigo-50/60 px-2 py-1 rounded border border-indigo-100/80 line-clamp-1 max-w-2xl">
                            &ldquo;{campaign.naturalLanguagePrompt}&rdquo;
                          </p>
                        )}
                        <div className="text-[12px] text-slate-500">
                          {campaign.segment.replaceAll("_", " ")} • {campaign.cities.join(", ") || "France entière"} • {campaign.providerPriority.join(", ")}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5 items-center">
                        {!isArchived && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void setCampaignStatus(campaign, isPaused ? "active" : "paused")}
                          >
                            {isPaused ? "Resume" : "Pause"}
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingCampaign(campaign)}
                        >
                          <Pencil className="size-3.5 mr-1 text-slate-500" />
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          className="bg-blue-600 hover:bg-blue-700 text-white"
                          onClick={() => void runCampaign(campaign)}
                          disabled={runningId === campaign.id || isPaused || isArchived}
                        >
                          {runningId === campaign.id ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <Play className="size-3.5 mr-1" />}
                          Run now
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void runE2ETest(campaign)}
                          disabled={runningId === campaign.id || e2eRunning || isPaused || isArchived}
                        >
                          <Sparkles className="size-3.5 mr-1 text-indigo-500" />
                          Test E2E
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void setCampaignStatus(campaign, isArchived ? "active" : "archived")}
                          title={isArchived ? "Unarchive campaign" : "Archive campaign"}
                          className="text-slate-600 hover:text-amber-700"
                        >
                          {isArchived ? (
                            <>
                              <RotateCcw className="size-3.5 mr-1" />
                              Unarchive
                            </>
                          ) : (
                            <>
                              <Archive className="size-3.5 mr-1" />
                              Archive
                            </>
                          )}
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => void deleteCampaign(campaign)} aria-label={`Delete ${campaign.name}`}>
                          <Trash2 className="size-4 text-red-500" />
                        </Button>
                      </div>
                    </div>
                    
                    {/* Signal Providers & Keywords Footer */}
                    <div className="mt-3 flex flex-wrap items-start gap-x-4 gap-y-2 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
                      {signals.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-slate-700 flex items-center gap-1">
                            <Layers className="size-3 text-indigo-600" />
                            Signals:
                          </span>
                          {signals.map((sig: string) => (
                            <span key={sig} className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-700 font-medium border border-indigo-100">
                              {sig}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium text-slate-600">Keywords:</span>
                        {campaign.keywords.length ? (
                          campaign.keywords.slice(0, 4).map((kw) => (
                            <span key={kw} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{kw}</span>
                          ))
                        ) : <span>None</span>}
                        {campaign.keywords.length > 4 && <span className="text-slate-400">+{campaign.keywords.length - 4}</span>}
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium text-slate-600">Excluded:</span>
                        {campaign.excludeKeywords?.length ? (
                          campaign.excludeKeywords.slice(0, 3).map((kw) => (
                            <span key={kw} className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-600">{kw}</span>
                          ))
                        ) : <span>None</span>}
                        {(campaign.excludeKeywords?.length ?? 0) > 3 && (
                          <span className="text-slate-400">+{(campaign.excludeKeywords?.length ?? 0) - 3} more</span>
                        )}
                      </div>
                      <span><span className="font-medium text-slate-600">NAF:</span> {campaign.nafCodes?.join(", ") || "Any"}</span>
                      <span><span className="font-medium text-slate-600">Max/run:</span> {campaign.maxCompaniesPerRun}</span>
                      <span><span className="font-medium text-slate-600">Auto-queue:</span> {campaign.autoQueueHighScoreCompanies ? "Yes" : "No"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={Radar}
              title={statusFilter === "archived" ? "No archived campaigns" : "No discovery campaigns yet"}
              description={statusFilter === "archived" ? "Archived campaigns will appear here." : "Create a campaign using the AI Campaign Builder or manual form to start lead discovery."}
            />
          )}
        </TabsContent>
        <TabsContent value="create">

          <DiscoveryCreateForm onCreated={() => void refresh()} />
        </TabsContent>
        <TabsContent value="runs">
          <DiscoveryRunsTable runs={runs} onDelete={(runId) => void deleteRun(runId)} />
        </TabsContent>
        <TabsContent value="companies">
          <DiscoveredCompaniesTable companies={companies} onDelete={(company) => void deleteDiscoveredCompany(company)} />
        </TabsContent>
        <TabsContent value="rejected">
          <RejectedTable rejected={rejected} onDelete={(rejectedId) => void deleteRejected(rejectedId)} />
        </TabsContent>
        <TabsContent value="providers">
          <Card>
            <CardHeader>
              <CardTitle>Provider readiness</CardTitle>
              <CardDescription>Free public-data discovery is the default. Pappers is optional premium enrichment, not default discovery.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {[
                ["Recherche d'Entreprises", "Default free discovery source for text, city, activity, sector, and open French company records."],
                ["Sirene / INSEE", "Official validation source for SIREN/SIRET, active status, NAF/APE, legal name, address, and establishment data."],
                ["Sirene Stock", "Prepared for future low-cost bulk discovery from monthly official data.gouv.fr stock files."],
                ["Google Places", "Optional enrichment for website and local presence when an API key is configured."],
                ["Pappers", "Optional premium enrichment only. It is never included in default discovery and should respect strict monthly limits."],
                ["Manual/Test", "Deterministic development runs without external API calls."]
              ].map(([title, description]) => (
                <div key={title} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-2 font-medium">
                    <ShieldCheck className="size-4 text-emerald-600" />
                    {title}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{description}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl font-bold">
              <Sparkles className="size-5 text-indigo-600" />
              End-to-End Pipeline Automation Test
            </DialogTitle>
            <DialogDescription>
              Test discovery, AI research, contact lookup (Dropcontact), and outreach draft generation with simulated sending in a single click.
            </DialogDescription>
          </DialogHeader>

          {(e2eRunning || (e2eProgress > 0 && e2eProgress < 100 && !e2eError)) && (
            <div className="space-y-4 py-2 mt-2">
              <div className="space-y-2 border bg-indigo-50/20 p-4 rounded-lg">
                <div className="flex justify-between items-center text-sm font-semibold">
                  <span className="text-slate-800 animate-pulse flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin text-indigo-600" />
                    {e2eCurrentStep || "Running pipeline E2E test..."}
                  </span>
                  <span className="text-indigo-600">{e2eProgress}%</span>
                </div>
                <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden border">
                  <div 
                    className="h-full bg-indigo-600 transition-all duration-500 ease-out" 
                    style={{ width: `${e2eProgress}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1 text-center">Please do not close this window. Executing AI analysis and contact enrichment APIs...</p>
              </div>

              {e2eLogs.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Live Execution Logs</p>
                  <div className="rounded-lg bg-zinc-950 p-4 text-zinc-200 font-mono text-xs overflow-x-auto h-72 overflow-y-auto flex flex-col-reverse">
                    <div className="flex flex-col">
                      {e2eLogs.slice().reverse().map((line: string, idx: number) => (
                        <div key={idx} className="leading-relaxed py-0.5 border-b border-zinc-900 last:border-0 text-left text-zinc-300">
                          {line}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {e2eError && (
            <div className="space-y-4 mt-2">
              <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                <div className="flex items-start gap-2">
                  <AlertCircle className="size-5 text-red-600 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-red-900">Pipeline Execution Error</h4>
                    <p className="text-sm text-red-800 mt-1">{e2eError}</p>
                  </div>
                </div>
              </div>

              {e2eLogs.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Execution Logs prior to failure</p>
                  <div className="rounded-lg bg-zinc-950 p-4 text-zinc-200 font-mono text-xs overflow-x-auto h-60 overflow-y-auto text-left">
                    {e2eLogs.map((line: string, idx: number) => (
                      <div key={idx} className="leading-relaxed py-0.5 border-b border-zinc-900 last:border-0 text-zinc-400">
                        {line}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {e2eResult && (
            <div className="space-y-6 mt-4">
              {/* Summary Badges */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-lg border bg-slate-50 p-3 text-center">
                  <p className="text-xs text-muted-foreground">Discovered Lead</p>
                  <p className="font-semibold text-sm mt-1 truncate">{e2eResult.company?.name || "None"}</p>
                </div>
                <div className="rounded-lg border bg-slate-50 p-3 text-center">
                  <p className="text-xs text-muted-foreground">AI Recommendation</p>
                  <p className="font-semibold text-sm mt-1 text-indigo-600 truncate">{e2eResult.research?.recommendedNextAction || "None"}</p>
                </div>
                <div className="rounded-lg border bg-slate-50 p-3 text-center">
                  <p className="text-xs text-muted-foreground">Contact Targeted</p>
                  <p className="font-semibold text-sm mt-1 truncate" title={e2eResult.contact?.email}>
                    {e2eResult.contact?.fullName || "General Team"}
                  </p>
                </div>
                <div className="rounded-lg border bg-slate-50 p-3 text-center">
                  <p className="text-xs text-muted-foreground">Status</p>
                  <p className="font-semibold text-sm mt-1 text-indigo-600">Simulated Sent</p>
                </div>
              </div>

              {/* Execution Details tabs */}
              <Tabs defaultValue="outreach">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="outreach">Outreach Email</TabsTrigger>
                  <TabsTrigger value="research">AI Research</TabsTrigger>
                  <TabsTrigger value="logs">Execution Logs</TabsTrigger>
                </TabsList>

                {/* Outreach Tab */}
                <TabsContent value="outreach" className="space-y-3 mt-3">
                  <div className="rounded-lg border p-4 bg-slate-50/50 space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground">Recipient Email</p>
                    <p className="text-sm font-medium">{e2eResult.contact?.email || e2eResult.company?.website || "General inbox"}</p>
                  </div>
                  <div className="rounded-lg border p-4 bg-slate-50/50 space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground">Subject Line</p>
                    <p className="text-sm font-medium">{e2eResult.outreach?.subject || "(No subject generated)"}</p>
                  </div>
                  <div className="rounded-lg border p-4 bg-slate-50/50 space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground">Email Body</p>
                    <pre className="text-sm font-sans whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto p-2 bg-white rounded border">
                      {e2eResult.outreach?.body || "(No body generated)"}
                    </pre>
                  </div>
                </TabsContent>

                {/* AI Research Tab */}
                <TabsContent value="research" className="space-y-3 mt-3">
                  <div className="rounded-lg border p-4 bg-slate-50/50 space-y-2">
                    <div className="flex justify-between items-center">
                      <p className="text-xs font-semibold text-muted-foreground">Research Summary</p>
                      <Badge className="capitalize">{e2eResult.research?.recommendedNextAction?.replace("_", " ") || "No recommendation"}</Badge>
                    </div>
                    <pre className="text-sm font-sans whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto p-2 bg-white rounded border">
                      {e2eResult.research?.summary || "No research data."}
                    </pre>
                  </div>
                </TabsContent>

                {/* Logs Tab */}
                <TabsContent value="logs" className="mt-3">
                  <div className="rounded-lg bg-zinc-950 p-4 text-zinc-100 font-mono text-xs overflow-x-auto max-h-80 overflow-y-auto text-left">
                    {e2eLogs.map((line: string, idx: number) => (
                      <div key={idx} className="leading-relaxed py-0.5 border-b border-zinc-800 last:border-0">
                        {line}
                      </div>
                    ))}
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={editingCampaign !== null} onOpenChange={(open) => { if (!open) setEditingCampaign(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl font-bold">
              <Pencil className="size-5 text-indigo-600" />
              Edit campaign: {editingCampaign?.name}
            </DialogTitle>
            <DialogDescription>
              Modify campaign parameters, keywords, locations, NAF codes, and search providers.
            </DialogDescription>
          </DialogHeader>
          {editingCampaign && (
            <DiscoveryCreateForm
              campaign={editingCampaign}
              onCreated={() => {
                setEditingCampaign(null);
                void refresh();
              }}
              onCancel={() => setEditingCampaign(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <NlCampaignModal
        open={nlModalOpen}
        onOpenChange={setNlModalOpen}
        onCreated={() => void refresh()}
      />

      <DualFixtureModal
        open={dualFixtureModalOpen}
        onOpenChange={setDualFixtureModalOpen}
        onCompleted={() => void refresh()}
      />
    </>
  );
}

function DiscoveryRunsTable({ runs, onDelete }: { runs: DiscoveryRun[]; onDelete: (runId: string) => void }) {
  if (!runs.length) return <EmptyState icon={Radar} title="No runs yet" description="Run a campaign to see provider results, duplicates, rejected rows, and queue stats." />;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-[900px] text-sm">
        <thead className="bg-slate-50 border-b border-slate-200 text-left text-[11px] uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-4 py-3">Campaign</th>
            <th className="px-4 py-3">Provider</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Found</th>
            <th className="px-4 py-3">Created</th>
            <th className="px-4 py-3">Queued</th>
            <th className="px-4 py-3">Duplicates</th>
            <th className="px-4 py-3">Rejected</th>
            <th className="px-4 py-3">Errors</th>
            <th className="px-4 py-3">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {runs.map((run) => (
            <tr key={run.id} className="border-b border-slate-100 last:border-0 transition-colors hover:bg-blue-50/40">
              <td className="px-4 py-3 font-medium">{run.campaignName ?? run.campaignId}</td>
              <td className="px-4 py-3">{run.provider}</td>
              <td className="px-4 py-3"><Badge variant="outline">{run.status}</Badge></td>
              <td className="px-4 py-3">{run.companiesFound}</td>
              <td className="px-4 py-3">{run.companiesCreated}</td>
              <td className="px-4 py-3">{run.companiesQueuedForResearch}</td>
              <td className="px-4 py-3">
                <div>{run.companiesSkippedDuplicate}</div>
                {run.duplicateCompanies?.length ? (
                  <div className="mt-1 max-w-56 truncate text-xs text-muted-foreground" title={run.duplicateCompanies.join(", ")}>
                    {run.duplicateCompanies.join(", ")}
                  </div>
                ) : null}
              </td>
              <td className="px-4 py-3">{run.companiesRejected}</td>
              <td className="px-4 py-3 text-xs text-red-700">{run.errors?.join(", ") || "None"}</td>
              <td className="px-4 py-3">
                <Button variant="ghost" size="icon" onClick={() => onDelete(run.id)} aria-label="Delete run">
                  <Trash2 className="size-4 text-red-600" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DiscoveredCompaniesTable({ companies, onDelete }: { companies: Company[]; onDelete: (company: Company) => void }) {
  if (!companies.length) return <EmptyState icon={Radar} title="No discovered companies saved" description="High enough quality discovery results will appear here." />;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-[900px] text-sm">
        <thead className="bg-slate-50 border-b border-slate-200 text-left text-[11px] uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-4 py-3">Company</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Match Details</th>
            <th className="px-4 py-3">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {companies.map((company) => (
            <tr key={company.id} className="border-b border-slate-100 last:border-0 transition-colors hover:bg-blue-50/40">
              <td className="px-4 py-3">
                <div className="font-medium">{company.name}</div>
                <div className="text-xs text-muted-foreground">{company.domain ?? company.city ?? "No anchor"}</div>
              </td>
              <td className="px-4 py-3"><StatusPill status={company.status} /></td>
              <td className="px-4 py-3 text-xs text-muted-foreground">{company.discoveryReasons?.join(", ") ?? "None"}</td>
              <td className="px-4 py-3">
                <Button variant="ghost" size="icon" onClick={() => onDelete(company)} aria-label={`Delete ${company.name}`}>
                  <Trash2 className="size-4 text-red-600" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RejectedTable({ rejected, onDelete }: { rejected: RejectedDiscovery[]; onDelete: (rejectedId: string) => void }) {
  if (!rejected.length) return <EmptyState icon={ShieldCheck} title="No rejected discoveries" description="Weak or duplicate records will be recorded here instead of polluting companies." />;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-[900px] text-sm">
        <thead className="bg-slate-50 border-b border-slate-200 text-left text-[11px] uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3">Provider</th>
            <th className="px-4 py-3">Reason</th>
            <th className="px-4 py-3">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rejected.map((item) => (
            <tr key={item.id} className="border-b border-slate-100 last:border-0 transition-colors hover:bg-blue-50/40">
              <td className="px-4 py-3 font-medium">{item.name ?? "Unnamed"}</td>
              <td className="px-4 py-3">{item.provider}</td>
              <td className="px-4 py-3 text-muted-foreground">{item.skippedReason}</td>
              <td className="px-4 py-3">
                <Button variant="ghost" size="icon" onClick={() => onDelete(item.id)} aria-label="Delete rejected discovery">
                  <Trash2 className="size-4 text-red-600" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
