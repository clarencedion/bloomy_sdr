"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Bot,
  Building2,
  CalendarCheck,
  ChevronRight,
  Clock,
  Inbox,
  Target,
  Zap,
} from "lucide-react";
import {
  getCompanyCountsByStatus,
  getMeetingCount,
  getOutreachCountsByStatus,
  getWeeklyDiscoveredCount,
} from "@/lib/firebase/firestore";

type DashboardData = {
  companyCounts: Record<string, number>;
  outreachCounts: Record<string, number>;
  meetingCount: number;
  weeklyDiscovered: number;
};

// Simple spinner
function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="size-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
    </div>
  );
}

// Stat card
function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  href,
  color,
}: {
  label: string;
  value: number | string;
  sub?: string;
  icon: React.ElementType;
  href: string;
  color: string;
}) {
  return (
    <Link href={href} className="block card-lift">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <div
            className="flex size-8 items-center justify-center rounded-lg"
            style={{ background: color + "15" }}
          >
            <Icon className="size-4" style={{ color }} />
          </div>
          <ChevronRight className="size-4 text-slate-300" />
        </div>
        <div className="text-2xl font-bold text-slate-900">{value}</div>
        <div className="text-[13px] font-medium text-slate-600 mt-0.5">{label}</div>
        {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
      </div>
    </Link>
  );
}

// Pipeline step
function PipelineStep({
  step: _step,
  label,
  count,
  color,
  href,
  isLast,
}: {
  step: number;
  label: string;
  count: number;
  color: string;
  href: string;
  isLast?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Link href={href} className="flex-1 block card-lift">
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-center">
          <div className="text-xl font-bold text-slate-900">{count}</div>
          <div className="text-[11px] font-medium text-slate-500 mt-0.5">{label}</div>
          <div
            className="mx-auto mt-2 h-1 w-8 rounded-full"
            style={{ background: color }}
          />
        </div>
      </Link>
      {!isLast && <ChevronRight className="size-4 shrink-0 text-slate-300" />}
    </div>
  );
}

// Next action card
function NextActionCard({
  step,
  title,
  desc,
  cta,
  href,
  count,
  color,
  icon: _Icon,
}: {
  step: number;
  title: string;
  desc: string;
  cta: string;
  href: string;
  count?: number;
  color: string;
  icon: React.ElementType;
}) {
  const hasAction = count != null && count > 0;
  return (
    <div
      className="rounded-xl border bg-white p-5"
      style={{ borderColor: hasAction ? color + "40" : "#E2E8F0" }}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="step-dot" style={{ background: color }}>
            {step}
          </div>
          <span className="text-[13px] font-semibold text-slate-800">{title}</span>
        </div>
        {hasAction && (
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-bold text-white"
            style={{ background: color }}
          >
            {count} pending
          </span>
        )}
      </div>
      <p className="text-[12px] text-slate-500 mb-4 leading-relaxed">{desc}</p>
      <Link
        href={href}
        className="flex items-center gap-1.5 text-[12px] font-semibold transition-colors"
        style={{ color }}
      >
        {cta}
        <ArrowRight className="size-3.5" />
      </Link>
    </div>
  );
}

export function DashboardShell() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void Promise.all([
      getCompanyCountsByStatus(),
      getOutreachCountsByStatus(),
      getMeetingCount(),
      getWeeklyDiscoveredCount(),
    ])
      .then(([companyCounts, outreachCounts, meetingCount, weeklyDiscovered]) => {
        setData({ companyCounts, outreachCounts, meetingCount, weeklyDiscovered });
      })
      .finally(() => setLoading(false));
  }, []);

  const m = useMemo(() => {
    if (!data) return null;
    const { companyCounts, outreachCounts, meetingCount, weeklyDiscovered } = data;
    const total = Object.values(companyCounts).reduce((s, n) => s + n, 0);
    const researched =
      (companyCounts.researched ?? 0) +
      (companyCounts.qualified ?? 0) +
      (companyCounts.approved ?? 0) +
      (companyCounts.contacted ?? 0) +
      (companyCounts.replied ?? 0) +
      (companyCounts.meeting_booked ?? 0) +
      (companyCounts.won ?? 0);
    return {
      total,
      weeklyDiscovered,
      researched,
      qualified: companyCounts.qualified ?? 0,
      researchPending: companyCounts.research_pending ?? 0,
      contacted: (companyCounts.contacted ?? 0) + (outreachCounts.sent ?? 0),
      replied: companyCounts.replied ?? 0,
      meetingBooked: meetingCount,
      outreachDrafts: outreachCounts.draft ?? 0,
      outreachApproved: outreachCounts.approved ?? 0,
    };
  }, [data]);

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-start justify-between"
      >
        <div>
          <h1 className="text-lg font-bold text-slate-900">Dashboard</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">
            Your pipeline at a glance — here&apos;s what needs your attention.
          </p>
        </div>
        <Link
          href="/app/discovery"
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 transition-colors"
        >
          <Zap className="size-3.5" />
          New campaign
        </Link>
      </motion.div>

      {/* ── Workflow pipeline funnel ── */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
      >
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-[13px] font-semibold text-slate-800">
              Sales pipeline
            </span>
            <span className="text-[11px] text-slate-400">
              {m?.total ?? 0} companies total
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {[
              { label: "Discovered", count: data?.companyCounts.imported ?? 0, color: "#94A3B8", href: "/app/companies" },
              { label: "Researched", count: m?.researched ?? 0, color: "#6366F1", href: "/app/research" },
              { label: "Qualified", count: m?.qualified ?? 0, color: "#3B82F6", href: "/app/companies" },
              { label: "Outreach sent", count: m?.contacted ?? 0, color: "#0EA5E9", href: "/app/outreach" },
              { label: "Replied", count: m?.replied ?? 0, color: "#10B981", href: "/app/outreach" },
              { label: "Meetings", count: m?.meetingBooked ?? 0, color: "#F59E0B", href: "/app/meetings" },
            ].map((step, i, arr) => (
              <PipelineStep
                key={step.label}
                step={i + 1}
                label={step.label}
                count={step.count}
                color={step.color}
                href={step.href}
                isLast={i === arr.length - 1}
              />
            ))}
          </div>
        </div>
      </motion.div>

      {/* ── Stats grid ── */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <StatCard
          label="Companies found"
          value={m?.total ?? 0}
          sub={`+${m?.weeklyDiscovered ?? 0} this week`}
          icon={Building2}
          href="/app/companies"
          color="#6366F1"
        />
        <StatCard
          label="AI researched"
          value={m?.researched ?? 0}
          sub={`${m?.researchPending ?? 0} pending`}
          icon={Bot}
          href="/app/research"
          color="#3B82F6"
        />
        <StatCard
          label="Outreach drafts"
          value={m?.outreachDrafts ?? 0}
          sub={`${m?.outreachApproved ?? 0} approved`}
          icon={Inbox}
          href="/app/outreach"
          color="#0EA5E9"
        />
        <StatCard
          label="Meetings booked"
          value={m?.meetingBooked ?? 0}
          sub="from outreach"
          icon={CalendarCheck}
          href="/app/meetings"
          color="#10B981"
        />
      </motion.div>

      {/* ── What to do next ── */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
      >
        <div className="mb-3 flex items-center gap-2">
          <Clock className="size-4 text-slate-400" />
          <span className="text-[13px] font-semibold text-slate-700">
            What to do next
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <NextActionCard
            step={1}
            title="Create a campaign"
            desc="Define your target: industry, region, company size. The AI finds companies automatically."
            cta="Go to Campaigns"
            href="/app/discovery"
            color="#6366F1"
            icon={Target}
          />
          <NextActionCard
            step={2}
            title="Review outreach drafts"
            desc="The AI wrote personalised emails for your best leads. Approve them or edit before sending."
            cta="Review drafts"
            href="/app/outreach"
            count={m?.outreachDrafts}
            color="#3B82F6"
            icon={Inbox}
          />
          <NextActionCard
            step={3}
            title="Track meetings"
            desc="Contacts who replied and booked a meeting show up here. See your conversion rate."
            cta="See meetings"
            href="/app/meetings"
            count={m?.meetingBooked}
            color="#10B981"
            icon={CalendarCheck}
          />
        </div>
      </motion.div>
    </div>
  );
}
