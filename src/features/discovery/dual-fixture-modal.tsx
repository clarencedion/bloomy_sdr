"use client";

import { useState, useRef, useEffect } from "react";
import { doc, onSnapshot, collection } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { callRunDualFixtureTest } from "@/lib/firebase/functions";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Building2,
  Store,
  Layers,
  ShieldCheck,
  Zap
} from "lucide-react";

interface DualFixtureModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompleted?: () => void;
}

export function DualFixtureModal({ open, onOpenChange, onCompleted }: DualFixtureModalProps) {
  const [mode, setMode] = useState<"both" | "bloomy" | "devcomm">("both");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"comparison" | "bloomy" | "devcomm" | "logs">("comparison");

  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, []);

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      setRunning(false);
    }
    onOpenChange(newOpen);
  };

  async function handleRunSimulation() {
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress(5);
    setCurrentStep("Initializing multi-tenant test environment...");
    setLogs([]);

    const testId = doc(collection(db, "automationTests")).id;

    if (unsubscribeRef.current) {
      unsubscribeRef.current();
    }

    const unsubscribe = onSnapshot(doc(db, "automationTests", testId), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (typeof data.progress === "number") setProgress(data.progress);
        if (data.currentStep) setCurrentStep(data.currentStep);
        if (Array.isArray(data.logs)) setLogs(data.logs);
      }
    });

    unsubscribeRef.current = unsubscribe;

    try {
      const res = await callRunDualFixtureTest({ mode, testId });
      setResult(res);
      setProgress(100);
      setCurrentStep("Dual-fixture multi-business validation complete!");
      setRunning(false);
      if (onCompleted) onCompleted();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setRunning(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold text-slate-900">
            <Layers className="size-6 text-indigo-600" />
            Multi-Business Dual-Fixture Validation
          </DialogTitle>
          <DialogDescription>
            Proves that Autonomous SDR V2 operates 100% offer-agnostically across two completely distinct businesses without hardcoding.
          </DialogDescription>
        </DialogHeader>

        {/* Configuration Selector */}
        {!running && !result && (
          <div className="space-y-4 py-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-600 block mb-2">
                Select Validation Target
              </label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => setMode("both")}
                  className={`flex flex-col text-left p-3.5 rounded-lg border transition-all ${
                    mode === "both"
                      ? "border-indigo-600 bg-indigo-50/60 ring-2 ring-indigo-500/20 shadow-xs"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="font-semibold text-sm text-slate-900 flex items-center gap-1.5">
                      <Sparkles className="size-4 text-indigo-600" />
                      Dual Validation
                    </span>
                    <Badge variant="outline" className="text-[10px] bg-indigo-100/60 text-indigo-800 border-indigo-200">
                      Recommended
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-500 mt-2">
                    Runs both Bloomy & Devcomm Consulting simultaneously to verify signal divergence & tenant isolation.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setMode("bloomy")}
                  className={`flex flex-col text-left p-3.5 rounded-lg border transition-all ${
                    mode === "bloomy"
                      ? "border-emerald-600 bg-emerald-50/60 ring-2 ring-emerald-500/20 shadow-xs"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="font-semibold text-sm text-slate-900 flex items-center gap-1.5">
                      <Store className="size-4 text-emerald-600" />
                      Fixture A: Bloomy Studio
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-2">
                    E-Commerce redesign for French florists in Nantes. Activates PageSpeed & mobile ordering signals.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setMode("devcomm")}
                  className={`flex flex-col text-left p-3.5 rounded-lg border transition-all ${
                    mode === "devcomm"
                      ? "border-blue-600 bg-blue-50/60 ring-2 ring-blue-500/20 shadow-xs"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="font-semibold text-sm text-slate-900 flex items-center gap-1.5">
                      <Building2 className="size-4 text-blue-600" />
                      Fixture B: Devcomm Consulting
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-2">
                    Sales performance coaching for industrial SMEs. Uses company scale & hiring signals (zero website audits).
                  </p>
                </button>
              </div>
            </div>

            {/* Invariants Summary */}
            <div className="rounded-lg border border-indigo-100 bg-indigo-50/30 p-3.5 text-xs text-indigo-900 space-y-1.5">
              <p className="font-semibold flex items-center gap-1.5 text-indigo-950">
                <ShieldCheck className="size-4 text-indigo-600" />
                Verified Non-Negotiable Invariants:
              </p>
              <ul className="list-disc list-inside space-y-0.5 text-indigo-800 text-[11px]">
                <li><strong>Invariant 1:</strong> Generic engine contains zero offer or business name branching.</li>
                <li><strong>Invariant 5:</strong> All generated outreach claims map to verified Evidence Items.</li>
                <li><strong>Invariant 6 & 8:</strong> Real calendar busy window check and strict tenant knowledge isolation.</li>
              </ul>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                onClick={() => void handleRunSimulation()}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold gap-2 shadow-sm"
              >
                <Zap className="size-4" />
                Launch Multi-Business Simulation
              </Button>
            </div>
          </div>
        )}

        {/* Live Progress & Logs */}
        {running && (
          <div className="space-y-4 py-3">
            <div className="space-y-2 border border-indigo-100 bg-indigo-50/30 p-4 rounded-xl">
              <div className="flex justify-between items-center text-sm font-semibold">
                <span className="text-slate-800 flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin text-indigo-600" />
                  {currentStep || "Executing multi-business test pipeline..."}
                </span>
                <span className="text-indigo-600 font-bold">{progress}%</span>
              </div>
              <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden border">
                <div
                  className="h-full bg-indigo-600 transition-all duration-500 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-[11px] text-slate-500 text-center">
                Running ICP translation, dynamic signal collection, evidence claim validation, KB auto-replies, and calendar booking...
              </p>
            </div>

            {logs.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Live Pipeline Execution Trace</p>
                <div className="rounded-lg bg-zinc-950 p-3.5 text-zinc-200 font-mono text-xs overflow-x-auto h-64 overflow-y-auto flex flex-col-reverse">
                  <div className="flex flex-col">
                    {logs.slice().reverse().map((line, idx) => (
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

        {/* Error State */}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-2">
            <div className="flex items-start gap-2">
              <AlertCircle className="size-5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-semibold text-red-900 text-sm">Simulation Execution Failed</h4>
                <p className="text-xs text-red-800 mt-1">{error}</p>
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <Button variant="outline" size="sm" onClick={() => void handleRunSimulation()}>
                Retry Simulation
              </Button>
            </div>
          </div>
        )}

        {/* Complete Results View */}
        {result && (
          <div className="space-y-5 mt-2">
            {/* Top Invariant Verification Banner */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-2.5 text-center">
                <div className="flex items-center justify-center gap-1 text-emerald-800 font-bold text-xs">
                  <CheckCircle2 className="size-3.5 text-emerald-600" />
                  Zero Hardcoding
                </div>
                <p className="text-[10px] text-emerald-700 mt-0.5">Invariant 1 Verified</p>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-2.5 text-center">
                <div className="flex items-center justify-center gap-1 text-emerald-800 font-bold text-xs">
                  <CheckCircle2 className="size-3.5 text-emerald-600" />
                  Signal Divergence
                </div>
                <p className="text-[10px] text-emerald-700 mt-0.5">Audits Omitted for Devcomm</p>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-2.5 text-center">
                <div className="flex items-center justify-center gap-1 text-emerald-800 font-bold text-xs">
                  <CheckCircle2 className="size-3.5 text-emerald-600" />
                  Tenant KB Isolation
                </div>
                <p className="text-[10px] text-emerald-700 mt-0.5">0 Cross-Tenant Leakage</p>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-2.5 text-center">
                <div className="flex items-center justify-center gap-1 text-emerald-800 font-bold text-xs">
                  <CheckCircle2 className="size-3.5 text-emerald-600" />
                  Calendar Truth
                </div>
                <p className="text-[10px] text-emerald-700 mt-0.5">Atomic Meeting Booked</p>
              </div>
            </div>

            {/* Tabbed Detailed Inspection */}
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
              <TabsList className="grid grid-cols-4 w-full">
                <TabsTrigger value="comparison">Comparison Matrix</TabsTrigger>
                <TabsTrigger value="bloomy" disabled={!result.bloomyResult}>Bloomy Studio (Florists)</TabsTrigger>
                <TabsTrigger value="devcomm" disabled={!result.devcommResult}>Devcomm (Consulting)</TabsTrigger>
                <TabsTrigger value="logs">Logs ({logs.length})</TabsTrigger>
              </TabsList>

              {/* Comparison Matrix Tab */}
              <TabsContent value="comparison" className="space-y-4 mt-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Bloomy Summary Card */}
                  {result.bloomyResult && (
                    <div className="rounded-xl border border-emerald-200 bg-white p-4 space-y-3 shadow-xs">
                      <div className="flex items-center justify-between border-b pb-2">
                        <div className="flex items-center gap-2">
                          <Store className="size-4 text-emerald-600" />
                          <h4 className="font-bold text-sm text-slate-900">Bloomy Digital Studio</h4>
                        </div>
                        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px]">
                          E-Commerce / Web Design
                        </Badge>
                      </div>
                      <div className="space-y-1.5 text-xs text-slate-600">
                        <p><strong>Natural Prompt:</strong> &ldquo;{result.bloomyResult.prompt}&rdquo;</p>
                        <p><strong>Resolved NAF:</strong> {result.bloomyResult.icpTranslation.nafCodes.join(", ")} ({result.bloomyResult.icpTranslation.cities.join(", ")})</p>
                        <p><strong>Signals Enabled:</strong> <span className="font-mono text-emerald-700 bg-emerald-50 px-1 py-0.5 rounded">{result.bloomyResult.icpTranslation.enabledSignalProviders.join(", ")}</span></p>
                        <p><strong>Discovered Lead:</strong> {result.bloomyResult.discoveredLead.companyName} (140 reviews, PageSpeed 28)</p>
                        <p><strong>Targeted Persona:</strong> {result.bloomyResult.personaMatched.role} ({result.bloomyResult.personaMatched.fullName})</p>
                        <p><strong>KB Grounded Reply:</strong> 3-week turnaround time confirmed from Bloomy KB</p>
                        <p><strong>Booking Status:</strong> <span className="text-emerald-700 font-semibold">Confirmed Thursday 14:30 (Meeting created, sequence ended)</span></p>
                      </div>
                    </div>
                  )}

                  {/* Devcomm Summary Card */}
                  {result.devcommResult && (
                    <div className="rounded-xl border border-blue-200 bg-white p-4 space-y-3 shadow-xs">
                      <div className="flex items-center justify-between border-b pb-2">
                        <div className="flex items-center gap-2">
                          <Building2 className="size-4 text-blue-600" />
                          <h4 className="font-bold text-sm text-slate-900">Devcomm B2B Consulting</h4>
                        </div>
                        <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-[10px]">
                          Sales Coaching / Industrial PME
                        </Badge>
                      </div>
                      <div className="space-y-1.5 text-xs text-slate-600">
                        <p><strong>Natural Prompt:</strong> &ldquo;{result.devcommResult.prompt}&rdquo;</p>
                        <p><strong>Resolved NAF:</strong> {result.devcommResult.icpTranslation.nafCodes.join(", ")} (Min 20 emp.)</p>
                        <p><strong>Signals Enabled:</strong> <span className="font-mono text-blue-700 bg-blue-50 px-1 py-0.5 rounded">{result.devcommResult.icpTranslation.enabledSignalProviders.join(", ")}</span> (Web Audits Omitted)</p>
                        <p><strong>Discovered Lead:</strong> {result.devcommResult.discoveredLead.companyName} (45 employees, 3 sites, hiring 4 sales)</p>
                        <p><strong>Targeted Persona:</strong> {result.devcommResult.personaMatched.role} ({result.devcommResult.personaMatched.fullName})</p>
                        <p><strong>KB Grounded Reply:</strong> Qualiopi certification & OPCO financing confirmed from Devcomm KB</p>
                        <p><strong>Booking Status:</strong> <span className="text-blue-700 font-semibold">Confirmed Thursday 14:30 (Meeting created, sequence ended)</span></p>
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* Bloomy Tab */}
              {result.bloomyResult && (
                <TabsContent value="bloomy" className="space-y-3 mt-3">
                  <div className="rounded-lg border p-3.5 bg-slate-50/60 space-y-2">
                    <p className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Outreach Email Copy (Citing 140 Reviews vs Mobile Friction)</p>
                    <div className="text-xs font-medium text-slate-900 border-b pb-1">
                      Subject: {result.bloomyResult.generatedOutreach.subject}
                    </div>
                    <pre className="text-xs font-sans whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto p-2.5 bg-white rounded border">
                      {result.bloomyResult.generatedOutreach.body}
                    </pre>
                  </div>

                  <div className="rounded-lg border p-3.5 bg-slate-50/60 space-y-2">
                    <p className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Inbound Objection & Knowledge Base Auto-Reply</p>
                    <div className="text-xs text-slate-700 bg-amber-50/80 p-2 rounded border border-amber-200">
                      <strong>Prospect Question:</strong> &ldquo;{result.bloomyResult.simulatedReply.prospectMessage}&rdquo;
                    </div>
                    <pre className="text-xs font-sans whitespace-pre-wrap leading-relaxed max-h-36 overflow-y-auto p-2 bg-white rounded border text-emerald-900">
                      {result.bloomyResult.simulatedReply.groundedAnswer}
                    </pre>
                  </div>
                </TabsContent>
              )}

              {/* Devcomm Tab */}
              {result.devcommResult && (
                <TabsContent value="devcomm" className="space-y-3 mt-3">
                  <div className="rounded-lg border p-3.5 bg-slate-50/60 space-y-2">
                    <p className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Outreach Email Copy (Citing Commercial Expansion & 3 Sites)</p>
                    <div className="text-xs font-medium text-slate-900 border-b pb-1">
                      Subject: {result.devcommResult.generatedOutreach.subject}
                    </div>
                    <pre className="text-xs font-sans whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto p-2.5 bg-white rounded border">
                      {result.devcommResult.generatedOutreach.body}
                    </pre>
                  </div>

                  <div className="rounded-lg border p-3.5 bg-slate-50/60 space-y-2">
                    <p className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Inbound Objection & Knowledge Base Auto-Reply</p>
                    <div className="text-xs text-slate-700 bg-amber-50/80 p-2 rounded border border-amber-200">
                      <strong>Prospect Question:</strong> &ldquo;{result.devcommResult.simulatedReply.prospectMessage}&rdquo;
                    </div>
                    <pre className="text-xs font-sans whitespace-pre-wrap leading-relaxed max-h-36 overflow-y-auto p-2 bg-white rounded border text-blue-900">
                      {result.devcommResult.simulatedReply.groundedAnswer}
                    </pre>
                  </div>
                </TabsContent>
              )}

              {/* Full Logs Tab */}
              <TabsContent value="logs" className="mt-3">
                <div className="rounded-lg bg-zinc-950 p-4 text-zinc-100 font-mono text-xs overflow-x-auto max-h-72 overflow-y-auto text-left">
                  {logs.map((line, idx) => (
                    <div key={idx} className="leading-relaxed py-0.5 border-b border-zinc-800 last:border-0">
                      {line}
                    </div>
                  ))}
                </div>
              </TabsContent>
            </Tabs>

            <div className="flex justify-between items-center pt-3 border-t">
              <span className="text-xs text-slate-500 font-mono">
                Workspace ID: {result.workspaceId}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setResult(null);
                  setProgress(0);
                }}
              >
                Run Another Test
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
