"use client";

import { useState } from "react";
import {
  Award,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Flame,
  HelpCircle,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Zap
} from "lucide-react";
import type { Company, OpportunityScore, QualificationState } from "@/types/firestore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { callScoreOpportunity } from "@/lib/firebase/functions";

interface OpportunityScoreCardProps {
  company: Company;
  score?: OpportunityScore | null;
  onScoreUpdated?: (newScore: OpportunityScore) => void;
}

export function QualificationBadge({ state }: { state?: QualificationState | string }) {
  switch (state) {
    case "HIGH_PRIORITY":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
          <Flame className="size-3.5 text-emerald-600 dark:text-emerald-400" />
          Haute Priorité
        </span>
      );
    case "QUALIFIED":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-3 py-1 text-xs font-semibold text-blue-700 dark:text-blue-400 border border-blue-500/20">
          <CheckCircle2 className="size-3.5 text-blue-600 dark:text-blue-400" />
          Qualifié
        </span>
      );
    case "NEEDS_MORE_EVIDENCE":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-700 dark:text-amber-400 border border-amber-500/20">
          <HelpCircle className="size-3.5 text-amber-600 dark:text-amber-400" />
          Signaux Insuffisants
        </span>
      );
    case "DISQUALIFIED":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-700 dark:text-rose-400 border border-rose-500/20">
          <ShieldAlert className="size-3.5 text-rose-600 dark:text-rose-400" />
          Disqualifié
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-500/10 px-3 py-1 text-xs font-medium text-slate-600 dark:text-slate-400 border border-slate-500/20">
          Non Noté
        </span>
      );
  }
}

function getScoreColor(score: number): { text: string; bg: string; border: string; bar: string } {
  if (score >= 80) {
    return {
      text: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-50 dark:bg-emerald-950/40",
      border: "border-emerald-200 dark:border-emerald-800/40",
      bar: "bg-emerald-500"
    };
  }
  if (score >= 50) {
    return {
      text: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-50 dark:bg-blue-950/40",
      border: "border-blue-200 dark:border-blue-800/40",
      bar: "bg-blue-500"
    };
  }
  if (score >= 35) {
    return {
      text: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-50 dark:bg-amber-950/40",
      border: "border-amber-200 dark:border-amber-800/40",
      bar: "bg-amber-500"
    };
  }
  return {
    text: "text-rose-600 dark:text-rose-400",
    bg: "bg-rose-50 dark:bg-rose-950/40",
    border: "border-rose-200 dark:border-rose-800/40",
    bar: "bg-rose-500"
  };
}

export function OpportunityScoreCard({ company, score: propScore, onScoreUpdated }: OpportunityScoreCardProps) {
  const [scoring, setScoring] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [copiedAngle, setCopiedAngle] = useState(false);

  const activeScore = propScore || company.opportunityScore;

  async function handleRecalculate() {
    if (!company.id) return;
    setScoring(true);
    try {
      const result = await callScoreOpportunity({
        companyId: company.id,
        offerId: company.bestOffer,
        campaignId: company.discoveryCampaignId
      });
      if (onScoreUpdated) {
        onScoreUpdated(result);
      }
    } catch (err) {
      console.error("Failed to score opportunity:", err);
    } finally {
      setScoring(false);
    }
  }

  function copyAngleToClipboard(text: string) {
    void navigator.clipboard.writeText(text);
    setCopiedAngle(true);
    setTimeout(() => setCopiedAngle(false), 2000);
  }

  if (!activeScore) {
    return (
      <Card className="border-dashed bg-slate-50/50 dark:bg-slate-900/30">
        <CardContent className="flex flex-col items-center justify-center p-6 text-center">
          <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-600">
            <Zap className="size-5" />
          </div>
          <h3 className="text-base font-semibold">Opportunity Scoring & Qualification</h3>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">
            Évaluez automatiquement l&apos;adéquation ICP, la criticité des besoins, et la valeur commerciale à partir des signaux collectés.
          </p>
          <Button
            size="sm"
            onClick={() => void handleRecalculate()}
            disabled={scoring}
            className="mt-4 gap-2"
          >
            {scoring ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {scoring ? "Calcul en cours..." : "Calculer le score d'opportunité"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const colors = getScoreColor(activeScore.overallScore);
  const weights = activeScore.weights;
  const breakdown = activeScore.breakdown;

  const dimensions = [
    {
      title: "Company Fit (ICP)",
      score: activeScore.companyFitScore,
      weightPct: Math.round(weights.companyFitWeight * 100),
      reasons: breakdown.companyFitReasons,
      icon: Award
    },
    {
      title: "Need Strength (Douleur)",
      score: activeScore.needStrengthScore,
      weightPct: Math.round(weights.needStrengthWeight * 100),
      reasons: breakdown.needStrengthReasons,
      icon: Zap
    },
    {
      title: "Commercial Scale (Capacité)",
      score: activeScore.commercialValueScore,
      weightPct: Math.round(weights.commercialScaleWeight * 100),
      reasons: breakdown.commercialValueReasons,
      icon: TrendingUp
    },
    {
      title: "Evidence Confidence (Preuves)",
      score: activeScore.evidenceConfidence,
      weightPct: Math.round(weights.evidenceConfidenceWeight * 100),
      reasons: breakdown.confidenceReasons,
      icon: CheckCircle2
    }
  ];

  return (
    <Card className={`border shadow-sm transition-all ${colors.border}`}>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <div className="flex items-center gap-2.5">
            <CardTitle className="text-base font-semibold">Opportunité & Qualification</CardTitle>
            <QualificationBadge state={activeScore.qualificationState} />
          </div>
          <CardDescription className="text-xs">
            Score multi-facteurs pondéré calculé selon l&apos;offre active.
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleRecalculate()}
          disabled={scoring}
          className="gap-1.5 text-xs h-8"
        >
          <RefreshCw className={`size-3.5 ${scoring ? "animate-spin" : ""}`} />
          {scoring ? "Calcul..." : "Re-calculer"}
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Main Score Hero Header */}
        <div className={`flex items-center justify-between rounded-xl border p-4 ${colors.bg} ${colors.border}`}>
          <div className="flex items-center gap-4">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-background shadow-sm border">
              <span className={`text-2xl font-black ${colors.text}`}>
                {activeScore.overallScore}
              </span>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Score Global d&apos;Opportunité
              </p>
              <p className="text-sm font-medium">
                {activeScore.qualificationState === "HIGH_PRIORITY" && "Prospect idéal hautement qualifié avec opportunités immédiates."}
                {activeScore.qualificationState === "QUALIFIED" && "Prospect en cible répondant aux critères de qualification."}
                {activeScore.qualificationState === "NEEDS_MORE_EVIDENCE" && "Signaux prometteurs mais des preuves supplémentaires sont requises."}
                {activeScore.qualificationState === "DISQUALIFIED" && "Prospect disqualifié (hors cible ou entreprise inactive)."}
              </p>
            </div>
          </div>
        </div>

        {/* Recommended Angle Callout */}
        {activeScore.recommendedAngle && (
          <div className="rounded-lg border bg-gradient-to-r from-blue-50/50 to-indigo-50/50 dark:from-blue-950/20 dark:to-indigo-950/20 p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
                <Sparkles className="size-3.5" />
                Angle d&apos;accroche recommandé
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => copyAngleToClipboard(activeScore.recommendedAngle)}
              >
                <Copy className="size-3 mr-1" />
                {copiedAngle ? "Copié" : "Copier"}
              </Button>
            </div>
            <p className="mt-1 text-xs font-medium text-slate-800 dark:text-slate-200">
              &laquo;&nbsp;{activeScore.recommendedAngle}&nbsp;&raquo;
            </p>
          </div>
        )}

        {/* Detected Needs & Buying Triggers */}
        {(activeScore.detectedNeeds?.length > 0 || activeScore.buyingTriggers?.length > 0) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {activeScore.detectedNeeds?.length > 0 && (
              <div className="rounded-lg border bg-slate-50/60 dark:bg-slate-900/40 p-3">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-1.5">
                  <Zap className="size-3.5 text-amber-500" />
                  Besoins Détectés ({activeScore.detectedNeeds.length})
                </p>
                <ul className="space-y-1">
                  {activeScore.detectedNeeds.map((need, idx) => (
                    <li key={idx} className="text-xs text-muted-foreground flex items-start gap-1.5">
                      <span className="text-amber-500 mt-0.5">•</span>
                      <span>{need}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {activeScore.buyingTriggers?.length > 0 && (
              <div className="rounded-lg border bg-slate-50/60 dark:bg-slate-900/40 p-3">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-1.5">
                  <TrendingUp className="size-3.5 text-emerald-500" />
                  Facteurs Déclencheurs ({activeScore.buyingTriggers.length})
                </p>
                <ul className="space-y-1">
                  {activeScore.buyingTriggers.map((trig, idx) => (
                    <li key={idx} className="text-xs text-muted-foreground flex items-start gap-1.5">
                      <span className="text-emerald-500 mt-0.5">•</span>
                      <span>{trig}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Dimension Breakdown Bars */}
        <div className="space-y-3 pt-1">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Décomposition par dimension
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs text-muted-foreground"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? (
                <>
                  Masquer détails <ChevronUp className="size-3.5 ml-1" />
                </>
              ) : (
                <>
                  Voir explications <ChevronDown className="size-3.5 ml-1" />
                </>
              )}
            </Button>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2">
            {dimensions.map((dim) => {
              const dimColors = getScoreColor(dim.score);
              const DimIcon = dim.icon;
              return (
                <div key={dim.title} className="rounded-lg border bg-card p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium flex items-center gap-1.5">
                      <DimIcon className="size-3.5 text-muted-foreground" />
                      {dim.title}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground font-mono text-[10px]">
                        ({dim.weightPct}% poids)
                      </span>
                      <span className={`font-bold ${dimColors.text}`}>
                        {dim.score}/100
                      </span>
                    </div>
                  </div>

                  {/* Visual Progress Bar */}
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className={`h-full transition-all duration-500 ${dimColors.bar}`}
                      style={{ width: `${dim.score}%` }}
                    />
                  </div>

                  {/* Expanded Breakdown Reasons */}
                  {expanded && (
                    <div className="pt-1 text-[11px] text-muted-foreground space-y-1">
                      {dim.reasons && dim.reasons.length > 0 ? (
                        dim.reasons.map((r, i) => (
                          <div key={i} className="flex items-start gap-1">
                            <span className="text-slate-400">✓</span>
                            <span>{r}</span>
                          </div>
                        ))
                      ) : (
                        <div className="italic text-slate-400">Aucun signal spécifique</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Penalties if any */}
        {breakdown.penalties && breakdown.penalties.length > 0 && (
          <div className="rounded-lg border border-rose-200 bg-rose-50/60 dark:border-rose-900/40 dark:bg-rose-950/20 p-3">
            <p className="text-xs font-semibold text-rose-800 dark:text-rose-400 flex items-center gap-1.5 mb-1">
              <AlertTriangle className="size-3.5" />
              Pénalités appliquées ({breakdown.penalties.length})
            </p>
            <ul className="space-y-0.5">
              {breakdown.penalties.map((pen, i) => (
                <li key={i} className="text-xs text-rose-700 dark:text-rose-300">
                  • {pen}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
