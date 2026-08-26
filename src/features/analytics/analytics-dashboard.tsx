"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  AlertCircle,
  BarChart3,
  Building2,
  CalendarCheck,
  ChevronRight,
  Mail,
  MessageSquare,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp,
  Zap
} from "lucide-react";
import { useBusiness } from "@/lib/context/business-context";
import {
  callGetAnalyticsSummary,
  callRunDailyAnalyticsAggregator,
  getCallableErrorMessage
} from "@/lib/firebase/functions";
import type {
  AnalyticsSummary,
  DimensionMetric,
  LearningRecommendation
} from "@/types/domain";

// ── Funnel Step Visualization Component ────────────────────────
function FunnelStepCard({
  stage,
  count,
  rate,
  prevLabel,
  color,
  isFirst,
  isLast,
  icon: Icon
}: {
  stage: string;
  count: number;
  rate?: number;
  prevLabel?: string;
  color: string;
  isFirst?: boolean;
  isLast?: boolean;
  icon: React.ElementType;
}) {
  return (
    <div className="flex items-center gap-2 flex-1 min-w-[140px]">
      <div className="flex-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm relative overflow-hidden">
        <div
          className="absolute top-0 left-0 right-0 h-1"
          style={{ background: color }}
        />
        <div className="flex items-center justify-between mb-2">
          <div
            className="flex size-7 items-center justify-center rounded-lg"
            style={{ background: color + "15" }}
          >
            <Icon className="size-3.5" style={{ color }} />
          </div>
          {!isFirst && rate !== undefined && (
            <span
              className="text-[11px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: color + "15", color }}
            >
              {rate}%
            </span>
          )}
        </div>
        <div className="text-xl font-extrabold text-slate-900">{count}</div>
        <div className="text-[12px] font-semibold text-slate-700 mt-0.5">{stage}</div>
        {!isFirst && prevLabel && (
          <div className="text-[10px] text-slate-400 mt-0.5">
            de {prevLabel}
          </div>
        )}
      </div>
      {!isLast && (
        <ChevronRight className="size-4 shrink-0 text-slate-300 hidden md:block" />
      )}
    </div>
  );
}

// ── Metric Card ────────────────────────────────────────────────
function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  color,
  badge
}: {
  label: string;
  value: number | string;
  sub?: string;
  icon: React.ElementType;
  color: string;
  badge?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm relative overflow-hidden card-lift">
      <div className="flex items-center justify-between mb-2">
        <div
          className="flex size-8 items-center justify-center rounded-lg"
          style={{ background: color + "15" }}
        >
          <Icon className="size-4" style={{ color }} />
        </div>
        {badge && (
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">
            {badge}
          </span>
        )}
      </div>
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      <div className="text-[12px] font-medium text-slate-600 mt-0.5">{label}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

// ── Recommendation Card ────────────────────────────────────────
function RecommendationCard({ rec }: { rec: LearningRecommendation }) {
  const isBoost = rec.action === "boost";
  const actionColor = isBoost ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-blue-700 bg-blue-50 border-blue-200";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300 transition-all flex flex-col justify-between">
      <div>
        <div className="flex items-start justify-between gap-2 mb-2">
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${actionColor}`}>
            {rec.action === "boost" ? "🚀 À Prioriser" : "📈 À Déployer"}
          </span>
          <span className="text-[11px] font-semibold text-slate-400">
            Confiance : {rec.confidence}%
          </span>
        </div>
        <h4 className="text-[13px] font-bold text-slate-900 mb-1">{rec.title}</h4>
        <p className="text-[12px] text-slate-600 leading-relaxed mb-3">{rec.description}</p>
      </div>

      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
        <span className="font-semibold text-slate-700">
          Taux RDV : <strong className="text-emerald-600 font-bold">{rec.meetingRate}%</strong>
        </span>
        <span className="text-slate-400">
          Échantillon : {rec.sampleSize} leads
        </span>
      </div>
    </div>
  );
}

export function AnalyticsDashboard() {
  const { currentBusiness, workspaceId } = useBusiness();
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"angles" | "signals" | "personas" | "campaigns" | "nafs">("angles");

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const summary = await callGetAnalyticsSummary({
        workspaceId: workspaceId || "ws_default",
        businessId: currentBusiness?.id
      });
      setData(summary);
    } catch (err) {
      console.error("Failed to load analytics summary:", err);
      setError(getCallableErrorMessage(err, "Impossible de charger les données d'analyse."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentBusiness?.id, workspaceId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleTriggerAggregator() {
    setRefreshing(true);
    try {
      await callRunDailyAnalyticsAggregator();
      await loadData(true);
    } catch (err) {
      console.error("Aggregator error:", err);
    } finally {
      setRefreshing(false);
    }
  }

  const funnel = data?.funnel;
  const dimensions = data?.dimensions;
  const recommendations = data?.recommendations || [];
  const dailySnapshots = data?.dailySnapshots || [];

  const chartFunnelData = useMemo(() => {
    if (!funnel) return [];
    return [
      { name: "Découverts", count: funnel.discovered, fill: "#94A3B8" },
      { name: "Qualifiés", count: funnel.qualified, fill: "#6366F1" },
      { name: "Contactés", count: funnel.contacted, fill: "#3B82F6" },
      { name: "Réponses", count: funnel.replied, fill: "#0EA5E9" },
      { name: "Positifs", count: funnel.positiveReplies, fill: "#10B981" },
      { name: "RDV Fixés", count: funnel.meetingsBooked, fill: "#F59E0B" }
    ];
  }, [funnel]);

  const activeDimensionList: DimensionMetric[] = useMemo(() => {
    if (!dimensions) return [];
    switch (activeTab) {
      case "angles":
        return dimensions.byAngle || [];
      case "signals":
        return dimensions.bySignal || [];
      case "personas":
        return dimensions.byPersona || [];
      case "campaigns":
        return dimensions.byCampaign || [];
      case "nafs":
        return dimensions.byNaf || [];
      default:
        return [];
    }
  }, [dimensions, activeTab]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-3">
        <div className="size-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
        <p className="text-[13px] text-slate-500 font-medium">Calcul des métriques de conversion en cours...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* ── Header ── */}
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-4"
      >
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900">Analytics & Closed-Loop Learning</h1>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 border border-emerald-200">
              Live V2
            </span>
          </div>
          <p className="text-[13px] text-slate-500 mt-0.5">
            Suivi du tunnel complet de prospection, analyse multidimensionnelle et recommandations intelligentes.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleTriggerAggregator()}
            disabled={refreshing}
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin text-blue-600" : "text-slate-500"}`} />
            {refreshing ? "Actualisation..." : "Recalculer l'agrégation"}
          </button>
        </div>
      </motion.div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800 text-[13px] flex items-center gap-2">
          <AlertCircle className="size-4 shrink-0 text-rose-600" />
          {error}
        </div>
      )}

      {/* ── KPI Overview Cards ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <StatCard
          label="Entreprises Découvertes"
          value={funnel?.discovered ?? 0}
          icon={Building2}
          color="#64748B"
        />
        <StatCard
          label="Leads Qualifiés"
          value={funnel?.qualified ?? 0}
          sub={`${funnel?.discoveredToQualifiedRate ?? 0}% du total`}
          icon={Zap}
          color="#6366F1"
        />
        <StatCard
          label="Outreach Envoyés"
          value={funnel?.contacted ?? 0}
          sub={`${funnel?.qualifiedToContactedRate ?? 0}% des qualifiés`}
          icon={Mail}
          color="#3B82F6"
        />
        <StatCard
          label="En Dialogue"
          value={funnel?.replied ?? 0}
          sub={`${funnel?.contactedToRepliedRate ?? 0}% taux de réponse`}
          icon={MessageSquare}
          color="#0EA5E9"
        />
        <StatCard
          label="Réponses Positives"
          value={funnel?.positiveReplies ?? 0}
          sub={`${funnel?.repliedToPositiveRate ?? 0}% des réponses`}
          icon={TrendingUp}
          color="#10B981"
        />
        <StatCard
          label="Rendez-vous Fixés"
          value={funnel?.meetingsBooked ?? 0}
          sub={`Win rate : ${funnel?.overallDiscoveryToMeetingRate ?? 0}%`}
          icon={CalendarCheck}
          color="#F59E0B"
          badge="North Star"
        />
      </div>

      {/* ── Pipeline Funnel Progression (REQ-077) ── */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Target className="size-4 text-blue-600" />
            <h2 className="text-[14px] font-bold text-slate-900">Tunnel de Conversion Complet (Full-Funnel)</h2>
          </div>
          <span className="text-[11px] text-slate-400 font-medium">
            Taux de conversion global : <strong className="text-slate-800 font-bold">{funnel?.overallDiscoveryToMeetingRate ?? 0}%</strong>
          </span>
        </div>

        <div className="flex flex-col md:flex-row items-stretch gap-2">
          <FunnelStepCard
            stage="1. Découverts"
            count={funnel?.discovered ?? 0}
            color="#94A3B8"
            icon={Building2}
            isFirst
          />
          <FunnelStepCard
            stage="2. Qualifiés"
            count={funnel?.qualified ?? 0}
            rate={funnel?.discoveredToQualifiedRate}
            prevLabel="découverts"
            color="#6366F1"
            icon={Zap}
          />
          <FunnelStepCard
            stage="3. Contactés"
            count={funnel?.contacted ?? 0}
            rate={funnel?.qualifiedToContactedRate}
            prevLabel="qualifiés"
            color="#3B82F6"
            icon={Mail}
          />
          <FunnelStepCard
            stage="4. Réponses"
            count={funnel?.replied ?? 0}
            rate={funnel?.contactedToRepliedRate}
            prevLabel="contactés"
            color="#0EA5E9"
            icon={MessageSquare}
          />
          <FunnelStepCard
            stage="5. Positifs"
            count={funnel?.positiveReplies ?? 0}
            rate={funnel?.repliedToPositiveRate}
            prevLabel="réponses"
            color="#10B981"
            icon={TrendingUp}
          />
          <FunnelStepCard
            stage="6. RDV Fixés"
            count={funnel?.meetingsBooked ?? 0}
            rate={funnel?.positiveToMeetingRate}
            prevLabel="positifs"
            color="#F59E0B"
            icon={CalendarCheck}
            isLast
          />
        </div>
      </motion.div>

      {/* ── Closed-Loop Learning Recommendations (REQ-079) ── */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50/50 via-white to-indigo-50/30 p-5 shadow-sm"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-blue-600 text-white">
              <Sparkles className="size-4" />
            </div>
            <div>
              <h2 className="text-[14px] font-bold text-slate-900">Recommandations Closed-Loop Learning</h2>
              <p className="text-[11px] text-slate-500">
                L'IA analyse les signaux et angles qui génèrent des rendez-vous pour guider vos prochaines campagnes.
              </p>
            </div>
          </div>
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
            {recommendations.length} insights actifs
          </span>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {recommendations.map((rec) => (
            <RecommendationCard key={rec.id} rec={rec} />
          ))}
        </div>
      </motion.div>

      {/* ── Dimension Breakdown & Charts (REQ-078) ── */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left 2 Cols: Tabbed Dimension Tables */}
        <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BarChart3 className="size-4 text-slate-700" />
              <h3 className="text-[14px] font-bold text-slate-900">Performance par Dimension</h3>
            </div>

            {/* Tab buttons */}
            <div className="flex items-center bg-slate-100 p-1 rounded-lg text-[12px] font-semibold text-slate-600 overflow-x-auto">
              {[
                { id: "angles", label: "Angles Rédactionnels" },
                { id: "signals", label: "Signaux & Preuves" },
                { id: "personas", label: "Personas" },
                { id: "campaigns", label: "Campagnes" },
                { id: "nafs", label: "Secteurs NAF" }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`px-2.5 py-1 rounded-md transition-all whitespace-nowrap ${
                    activeTab === tab.id
                      ? "bg-white text-blue-600 shadow-sm font-bold"
                      : "hover:text-slate-900 text-slate-500"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Dimension Table */}
          <div className="overflow-x-auto border border-slate-100 rounded-lg">
            <table className="w-full text-left text-[12px]">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100">
                <tr>
                  <th className="p-3">Nom / Variante</th>
                  <th className="p-3 text-right">Contactés</th>
                  <th className="p-3 text-right">Réponses</th>
                  <th className="p-3 text-right">Taux Rép. %</th>
                  <th className="p-3 text-right">RDV Fixés</th>
                  <th className="p-3 text-right">Taux RDV %</th>
                  <th className="p-3 text-center">Indice</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {activeDimensionList.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-slate-400 italic">
                      Aucune donnée enregistrée pour cette dimension.
                    </td>
                  </tr>
                ) : (
                  activeDimensionList.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3 font-semibold text-slate-800 max-w-[200px] truncate">
                        {item.name}
                      </td>
                      <td className="p-3 text-right text-slate-600">{item.contacted}</td>
                      <td className="p-3 text-right text-slate-600">{item.replied}</td>
                      <td className="p-3 text-right font-medium text-slate-700">
                        {item.replyRate}%
                      </td>
                      <td className="p-3 text-right font-bold text-amber-600">
                        {item.meetingsBooked}
                      </td>
                      <td className="p-3 text-right font-bold text-emerald-600">
                        {item.meetingRate}%
                      </td>
                      <td className="p-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            item.conversionIndex >= 1.5
                              ? "bg-emerald-100 text-emerald-800"
                              : item.conversionIndex >= 1.0
                              ? "bg-blue-100 text-blue-800"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {item.conversionIndex}x
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Col: Funnel Distribution Bar Chart */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="size-4 text-emerald-600" />
            <h3 className="text-[14px] font-bold text-slate-900">Volume par Étape</h3>
          </div>

          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartFunnelData} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
                <XAxis type="number" stroke="#94A3B8" fontSize={11} />
                <YAxis dataKey="name" type="category" stroke="#64748B" fontSize={11} width={80} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1E293B",
                    color: "#FFF",
                    borderRadius: "8px",
                    fontSize: "12px"
                  }}
                />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {chartFunnelData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── Historical Daily Activity Trend ── */}
      {dailySnapshots.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="size-4 text-blue-600" />
              <h3 className="text-[14px] font-bold text-slate-900">Activité & Progression Historique</h3>
            </div>
            <span className="text-[11px] text-slate-400 font-medium">14 derniers jours</span>
          </div>

          <div className="h-[240px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailySnapshots} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorContacted" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorMeetings" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.6} />
                    <stop offset="95%" stopColor="#F59E0B" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis dataKey="date" stroke="#94A3B8" fontSize={11} />
                <YAxis stroke="#94A3B8" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1E293B",
                    color: "#FFF",
                    borderRadius: "8px",
                    fontSize: "12px"
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
                <Area
                  type="monotone"
                  dataKey="contacted"
                  name="Contactés"
                  stroke="#3B82F6"
                  fillOpacity={1}
                  fill="url(#colorContacted)"
                />
                <Area
                  type="monotone"
                  dataKey="meetingsBooked"
                  name="RDV Fixés"
                  stroke="#F59E0B"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorMeetings)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      )}
    </div>
  );
}
