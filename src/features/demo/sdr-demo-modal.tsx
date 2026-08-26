"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CheckCircle2,
  Play,
  Sparkles,
  Bot,
  Building2,
  Mail,
  Calendar,
  ShieldCheck,
  Zap,
  RefreshCw,
  Clock,
  Terminal
} from "lucide-react";
import { callRunSdrDemoSimulation } from "@/lib/firebase/functions";
import { cn } from "@/lib/utils";

interface SdrDemoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultArchetype?: "bloomy" | "devcomm";
}

export function SdrDemoModal({
  open,
  onOpenChange,
  defaultArchetype = "bloomy",
}: SdrDemoModalProps) {
  const [archetype, setArchetype] = useState<"bloomy" | "devcomm">(defaultArchetype);
  const [replyScenario, setReplyScenario] = useState<
    "BOOKING_REQUEST" | "OBJECTION" | "QUESTION" | "UNSUBSCRIBE" | "OUT_OF_OFFICE"
  >("BOOKING_REQUEST");
  const [customEmail, setCustomEmail] = useState("");
  const [useCustomEmail, setUseCustomEmail] = useState(false);
  const [running, setRunning] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [simulationResult, setSimulationResult] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"stepper" | "inspection" | "logs">("stepper");
  const [error, setError] = useState<string | null>(null);

  const handleRunSimulation = async () => {
    setRunning(true);
    setError(null);
    setCurrentStepIndex(1);
    setSimulationResult(null);

    const targetEmail = useCustomEmail && customEmail.trim() ? customEmail.trim() : undefined;

    try {
      // Animated step simulation for realistic telemetry feedback
      const timer = setInterval(() => {
        setCurrentStepIndex((prev) => (prev < 7 ? prev + 1 : prev));
      }, 500);

      const res = await callRunSdrDemoSimulation({
        archetype,
        replyScenario,
        targetEmail,
      });

      clearInterval(timer);
      setCurrentStepIndex(8);
      setSimulationResult(res);
      setActiveTab("inspection");
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Erreur lors de l'exécution de la simulation démo.");
    } finally {
      setRunning(false);
    }
  };

  const STAGES = [
    { index: 1, name: "Campagne & ICP", icon: Building2 },
    { index: 2, name: "Découverte SIRENE", icon: Bot },
    { index: 3, name: "Signaux & Preuves", icon: Zap },
    { index: 4, name: "Scoring & Angle", icon: Sparkles },
    { index: 5, name: "Copywriting Factuel", icon: Mail },
    { index: 6, name: "Porte de Sécurité", icon: ShieldCheck },
    { index: 7, name: "Triage de Réponse", icon: Bot },
    { index: 8, name: "Réservation Calendrier", icon: Calendar },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-slate-900 text-slate-100 border-slate-800 p-6">
        <DialogHeader className="border-b border-slate-800 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30">
                <Zap className="size-4" />
              </span>
              <div>
                <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
                  One-Click SDR Demo Mode
                  <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] font-semibold text-blue-300 border border-blue-500/40">
                    Safe Test Sandbox
                  </span>
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-400">
                  Simulez et validez le cycle SDR complet de bout en bout (Découverte → Preuves → Copywriting → Réponse → Calendrier).
                </DialogDescription>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setArchetype("bloomy")}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer border",
                  archetype === "bloomy"
                    ? "bg-purple-600 text-white border-purple-500 shadow-sm"
                    : "bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700"
                )}
              >
                Bloomy (Web/Fleuristes)
              </button>
              <button
                onClick={() => setArchetype("devcomm")}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer border",
                  archetype === "devcomm"
                    ? "bg-blue-600 text-white border-blue-500 shadow-sm"
                    : "bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700"
                )}
              >
                Devcomm (Conseil B2B)
              </button>
            </div>
          </div>
        </DialogHeader>

        {/* Configuration Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-xl bg-slate-800/60 p-3.5 border border-slate-800 text-xs">
          <div>
            <label className="text-[11px] font-medium text-slate-400 mb-1 block">
              Scénario de Réponse Prospect :
            </label>
            <select
              value={replyScenario}
              onChange={(e) => setReplyScenario(e.target.value as any)}
              disabled={running}
              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
            >
              <option value="BOOKING_REQUEST">✅ Intéressé & Demande Créneau (Booking)</option>
              <option value="QUESTION">❓ Question sur l&apos;Offre & Tarifs</option>
              <option value="OBJECTION">🛑 Objection (Déjà un prestataire)</option>
              <option value="UNSUBSCRIBE">🚫 Demande de Désinscription (Unsub)</option>
              <option value="OUT_OF_OFFICE">🏖️ Répondeur automatique (Out of Office)</option>
            </select>
          </div>

          <div>
            <label className="text-[11px] font-medium text-slate-400 mb-1 block">
              Mode d&apos;Adresse Email Cible :
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setUseCustomEmail(false)}
                className={cn(
                  "flex-1 rounded-lg py-1.5 text-[11px] font-medium border text-center transition-all cursor-pointer",
                  !useCustomEmail
                    ? "bg-blue-600/30 text-blue-300 border-blue-500/50"
                    : "bg-slate-900 text-slate-400 border-slate-700"
                )}
              >
                Email Synthétique
              </button>
              <button
                onClick={() => setUseCustomEmail(true)}
                className={cn(
                  "flex-1 rounded-lg py-1.5 text-[11px] font-medium border text-center transition-all cursor-pointer",
                  useCustomEmail
                    ? "bg-blue-600/30 text-blue-300 border-blue-500/50"
                    : "bg-slate-900 text-slate-400 border-slate-700"
                )}
              >
                Email Personnalisé
              </button>
            </div>
          </div>

          <div>
            <label className="text-[11px] font-medium text-slate-400 mb-1 block">
              {useCustomEmail ? "Votre adresse email de test :" : "Destinataire fictif :"}
            </label>
            {useCustomEmail ? (
              <input
                type="email"
                placeholder="votre.email@domaine.com"
                value={customEmail}
                onChange={(e) => setCustomEmail(e.target.value)}
                disabled={running}
                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
              />
            ) : (
              <div className="rounded-lg bg-slate-900/60 border border-slate-800 px-2.5 py-1.5 text-xs text-slate-400 truncate">
                {archetype === "bloomy" ? "sophie.martin@fleurs-de-loire.fr" : "marc.durand@usinage-precis.fr"}
              </div>
            )}
          </div>
        </div>

        {/* Action Button */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <ShieldCheck className="size-4 text-emerald-400" />
            <span>Confinement de sécurité actif : aucune prospection hors simulateur.</span>
          </div>

          <button
            onClick={() => void handleRunSimulation()}
            disabled={running}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-lg hover:bg-blue-500 transition-all cursor-pointer disabled:opacity-50"
          >
            {running ? (
              <>
                <RefreshCw className="size-3.5 animate-spin" />
                Simulation en cours ({currentStepIndex}/8)...
              </>
            ) : (
              <>
                <Play className="size-3.5 fill-current" />
                Lancer la Démo SDR Complète
              </>
            )}
          </button>
        </div>

        {error && (
          <div className="rounded-xl bg-red-950/50 border border-red-800 p-3 text-xs text-red-300">
            {error}
          </div>
        )}

        {/* Stepper Progress Visualizer */}
        <div className="rounded-xl bg-slate-950/80 p-4 border border-slate-800/80">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            {STAGES.map((st) => {
              const isCompleted = simulationResult || currentStepIndex >= st.index;
              const isCurrent = running && currentStepIndex === st.index;

              return (
                <div
                  key={st.index}
                  className={cn(
                    "flex flex-col items-center justify-center p-2.5 rounded-lg border text-center transition-all",
                    isCurrent
                      ? "bg-blue-950/60 border-blue-500 text-blue-300 ring-2 ring-blue-500/20"
                      : isCompleted
                      ? "bg-slate-900 border-emerald-500/40 text-emerald-300"
                      : "bg-slate-900/40 border-slate-800 text-slate-500"
                  )}
                >
                  <span
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full text-[11px] mb-1.5 font-bold",
                      isCurrent
                        ? "bg-blue-600 text-white animate-pulse"
                        : isCompleted
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "bg-slate-800 text-slate-500"
                    )}
                  >
                    {isCompleted && !isCurrent ? (
                      <CheckCircle2 className="size-3.5" />
                    ) : (
                      st.index
                    )}
                  </span>
                  <span className="text-[10px] font-semibold leading-tight">{st.name}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Results & Inspection Section */}
        {simulationResult && (
          <div className="space-y-4 pt-2">
            {/* View switcher */}
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
              <button
                onClick={() => setActiveTab("inspection")}
                className={cn(
                  "px-3 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer",
                  activeTab === "inspection"
                    ? "bg-blue-600 text-white"
                    : "text-slate-400 hover:text-slate-200"
                )}
              >
                🔍 Inspection des Données (8 Étapes)
              </button>
              <button
                onClick={() => setActiveTab("logs")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer",
                  activeTab === "logs"
                    ? "bg-blue-600 text-white"
                    : "text-slate-400 hover:text-slate-200"
                )}
              >
                <Terminal className="size-3.5" />
                Journal d&apos;Exécution Live
              </button>
            </div>

            {activeTab === "inspection" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Card 1: Lead & Signals */}
                <div className="rounded-xl bg-slate-950 p-4 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                    <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                      <Building2 className="size-3.5 text-blue-400" />
                      Lead & Preuves Vérifiées
                    </span>
                    <span className="rounded-full bg-emerald-500/20 text-emerald-400 px-2 py-0.5 text-[10px] font-semibold">
                      Score : {simulationResult.summary.leadScore}/100 (Tier A)
                    </span>
                  </div>
                  <div className="text-xs space-y-1.5 text-slate-300">
                    <div>
                      <span className="text-slate-500 font-medium">Entreprise :</span>{" "}
                      <span className="font-semibold text-white">{simulationResult.summary.companyName}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 font-medium">Contact :</span>{" "}
                      {simulationResult.summary.contactName} ({simulationResult.summary.contactEmail})
                    </div>
                    <div className="pt-2 border-t border-slate-900">
                      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                        Preuves Extraites :
                      </span>
                      <div className="space-y-1">
                        {simulationResult.steps[2]?.data?.evidence?.map((ev: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between text-[11px] bg-slate-900/80 px-2 py-1 rounded">
                            <span className="text-slate-400">{ev.key}</span>
                            <span className="font-mono text-emerald-300">{JSON.stringify(ev.value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Card 2: Generated Outreach Copy */}
                <div className="rounded-xl bg-slate-950 p-4 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                    <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                      <Mail className="size-3.5 text-purple-400" />
                      Email Rédigé & Validé (Factuel)
                    </span>
                    <span className="rounded-full bg-blue-500/20 text-blue-300 px-2 py-0.5 text-[10px] font-semibold">
                      Invariant 5 Vérifié ✅
                    </span>
                  </div>
                  <div className="text-xs text-slate-300 space-y-2">
                    <div className="bg-slate-900 px-2 py-1 rounded text-slate-200 font-medium truncate">
                      Objet : {simulationResult.steps[4]?.data?.outreach?.subject}
                    </div>
                    <div className="bg-slate-900/60 p-2.5 rounded border border-slate-800/60 text-[11px] font-mono whitespace-pre-line text-slate-300 max-h-36 overflow-y-auto">
                      {simulationResult.steps[4]?.data?.outreach?.body}
                    </div>
                  </div>
                </div>

                {/* Card 3: Inbound Reply & Intent */}
                <div className="rounded-xl bg-slate-950 p-4 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                    <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                      <Bot className="size-3.5 text-amber-400" />
                      Réponse Prospect & Classification
                    </span>
                    <span className="rounded-full bg-amber-500/20 text-amber-300 px-2 py-0.5 text-[10px] font-semibold">
                      {simulationResult.summary.intentClassified}
                    </span>
                  </div>
                  <div className="text-xs space-y-2">
                    <div className="bg-slate-900 p-2.5 rounded text-[11px] italic text-slate-300 border border-slate-800/80">
                      &quot;{simulationResult.steps[6]?.data?.rawInbound}&quot;
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>Action Suggérée :</span>
                      <span className="font-semibold text-white bg-slate-900 px-2 py-0.5 rounded">
                        {simulationResult.steps[6]?.data?.suggestedAction}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Card 4: Meeting & Calendar Booking */}
                <div className="rounded-xl bg-slate-950 p-4 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                    <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                      <Calendar className="size-3.5 text-emerald-400" />
                      Réservation Calendrier
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        simulationResult.summary.meetingBooked
                          ? "bg-emerald-500/20 text-emerald-400"
                          : "bg-slate-800 text-slate-400"
                      )}
                    >
                      {simulationResult.summary.meetingBooked ? "Rendez-vous Confirmé ✅" : "Non applicable"}
                    </span>
                  </div>
                  <div className="text-xs space-y-2 text-slate-300">
                    {simulationResult.summary.meetingBooked ? (
                      <div className="bg-emerald-950/40 border border-emerald-800/60 p-3 rounded-lg space-y-1">
                        <div className="font-semibold text-emerald-300 flex items-center gap-1.5">
                          <Clock className="size-3.5" />
                          Créneau : {simulationResult.summary.scheduledSlot}
                        </div>
                        <div className="text-[11px] text-emerald-400/80">
                          ID Événement : {simulationResult.steps[7]?.data?.meetingId}
                        </div>
                        <div className="text-[10px] text-slate-400 pt-1">
                          Séquence de relance automatique clôturée avec succès (REQ-075).
                        </div>
                      </div>
                    ) : (
                      <div className="text-slate-400 italic py-4 text-center">
                        Aucun créneau réservé pour ce scénario ({simulationResult.summary.intentClassified}).
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "logs" && (
              <div className="rounded-xl bg-slate-950 p-4 border border-slate-800 font-mono text-[11px] space-y-2 text-slate-300 max-h-72 overflow-y-auto">
                {simulationResult.steps.map((st: any) => (
                  <div key={st.stepIndex} className="border-b border-slate-900 pb-2">
                    <div className="text-blue-400 font-bold mb-1">
                      {st.title} ({st.durationMs}ms)
                    </div>
                    {st.logs.map((log: string, lIdx: number) => (
                      <div key={lIdx} className="text-slate-400 pl-3">
                        {log}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
