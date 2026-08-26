"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Database,
  ExternalLink,
  Filter,
  Flame,
  Gauge,
  Globe,
  Layers,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Unlock,
  Zap
} from "lucide-react";

import type { Company, EvidenceItem, EvidenceNature } from "@/types/firestore";
import { listEvidenceForCompany } from "@/lib/firebase/firestore";
import { callCollectCompanySignals } from "@/lib/firebase/functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { OpportunityScoreCard } from "@/features/companies/opportunity-score-card";

interface CompanyEvidenceTabProps {
  company: Company;
  onCompanyUpdated?: (company: Company) => void;
}

const NATURE_CONFIG: Record<
  EvidenceNature,
  { label: string; bg: string; text: string; border: string; icon: typeof CheckCircle2 }
> = {
  fact: {
    label: "FACT (Verified)",
    bg: "bg-emerald-500/10",
    text: "text-emerald-700 dark:text-emerald-400",
    border: "border-emerald-500/30",
    icon: ShieldCheck
  },
  derived_metric: {
    label: "DERIVED METRIC",
    bg: "bg-blue-500/10",
    text: "text-blue-700 dark:text-blue-400",
    border: "border-blue-500/30",
    icon: Zap
  },
  ai_interpretation: {
    label: "AI INFERENCE",
    bg: "bg-purple-500/10",
    text: "text-purple-700 dark:text-purple-400",
    border: "border-purple-500/30",
    icon: Sparkles
  }
};

const PROVIDER_LABELS: Record<string, string> = {
  company_registry: "Registry (INPI/INSEE)",
  google_places: "Google Places",
  website_presence: "Website Presence",
  website_technical: "Technical & CMS Audit",
  website_ecommerce: "E-Commerce & Ordering",
  pagespeed: "Google PageSpeed & Web Vitals",
  company_scale: "Scale & Multi-site",
  company_hiring: "Hiring & Jobs",
  technology_stack: "Tech Stack"
};

function formatKeyName(key: string): string {
  return key
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "N/A";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

export function CompanyEvidenceTab({ company, onCompanyUpdated }: CompanyEvidenceTabProps) {
  const [evidenceItems, setEvidenceItems] = useState<EvidenceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [collecting, setCollecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [selectedNature, setSelectedNature] = useState<string>("all");
  const [selectedProvider, setSelectedProvider] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let isMounted = true;
    async function loadEvidence() {
      setLoading(true);
      setError(null);
      try {
        const items = await listEvidenceForCompany(company.id);
        if (isMounted) {
          setEvidenceItems(items);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Failed to load evidence items.");
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    void loadEvidence();
    return () => {
      isMounted = false;
    };
  }, [company.id]);

  async function handleCollectSignals(force = false) {
    setCollecting(true);
    setError(null);
    setStatusMessage(null);
    try {
      const result = await callCollectCompanySignals({
        companyId: company.id,
        workspaceId: company.workspaceId,
        businessId: company.businessId,
        forceRefresh: force
      });

      setEvidenceItems(result.evidence);
      const totalCollected = result.evidence.length;
      const errorCount = result.errors.length;
      setStatusMessage(
        `Signal collection complete: ${totalCollected} evidence items loaded (duration: ${result.totalDurationMs}ms, cost: $${result.totalCostUsd.toFixed(4)})${
          errorCount ? ` with ${errorCount} warning(s)` : ""
        }.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signal collection failed.");
    } finally {
      setCollecting(false);
    }
  }

  const toggleExpand = (id: string) => {
    setExpandedItems((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const providersInEvidence = useMemo(() => {
    const set = new Set<string>();
    evidenceItems.forEach((item) => {
      if (item.signalProvider) set.add(item.signalProvider);
    });
    return Array.from(set);
  }, [evidenceItems]);

  const filteredEvidence = useMemo(() => {
    return evidenceItems.filter((item) => {
      if (selectedNature !== "all" && item.nature !== selectedNature) return false;
      if (selectedProvider !== "all" && item.signalProvider !== selectedProvider) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const keyMatch = item.key.toLowerCase().includes(q);
        const valMatch = String(item.value).toLowerCase().includes(q);
        const provMatch = item.signalProvider.toLowerCase().includes(q);
        if (!keyMatch && !valMatch && !provMatch) return false;
      }
      return true;
    });
  }, [evidenceItems, selectedNature, selectedProvider, searchQuery]);

  const factsCount = evidenceItems.filter((i) => i.nature === "fact").length;
  const metricsCount = evidenceItems.filter((i) => i.nature === "derived_metric").length;
  const aiCount = evidenceItems.filter((i) => i.nature === "ai_interpretation").length;

  const evidenceMap = useMemo(() => {
    return new Map<string, EvidenceItem>(evidenceItems.map((e) => [e.key, e]));
  }, [evidenceItems]);

  const pagespeedScore = typeof evidenceMap.get("mobile_pagespeed_score")?.value === "number"
    ? (evidenceMap.get("mobile_pagespeed_score")?.value as number)
    : undefined;
  const lcpSeconds = evidenceMap.get("lcp_seconds")?.value as number | undefined;
  const cmsName = evidenceMap.get("cms_name")?.value as string | undefined;
  const sslActive = evidenceMap.get("ssl_active")?.value as boolean | undefined;
  const mobileFriendly = evidenceMap.get("mobile_friendly")?.value as boolean | undefined;
  const hasOnlineOrdering = evidenceMap.get("has_online_ordering")?.value as boolean | undefined;
  const ecommercePlatform = evidenceMap.get("ecommerce_platform")?.value as string | undefined;
  const hasBookingWidget = evidenceMap.get("has_booking_widget")?.value as boolean | undefined;
  const bookingProvider = evidenceMap.get("booking_provider")?.value as string | undefined;
  const isCopyrightOutdated = evidenceMap.get("is_copyright_outdated")?.value as boolean | undefined;
  const outdatedCopyrightYear = evidenceMap.get("outdated_copyright_year")?.value as number | undefined;
  const hasLegacyTables = evidenceMap.get("has_legacy_layout_tables")?.value as boolean | undefined;
  const hasWebsite = evidenceMap.get("has_website")?.value as boolean | undefined;

  const hasWebsiteSignals = Boolean(
    pagespeedScore !== undefined ||
    cmsName !== undefined ||
    sslActive !== undefined ||
    hasOnlineOrdering !== undefined ||
    hasBookingWidget !== undefined ||
    hasWebsite !== undefined
  );

  return (
    <div className="space-y-4">
      {/* Opportunity Scoring & Qualification Card (REQ-037, REQ-042) */}
      <OpportunityScoreCard
        company={company}
        score={company.opportunityScore}
        onScoreUpdated={(newScore) => {
          if (onCompanyUpdated) {
            onCompanyUpdated({
              ...company,
              opportunityScore: newScore,
              qualificationState: newScore.qualificationState,
              fitScore: newScore.overallScore
            });
          }
        }}
      />

      {/* Top Banner / Controls */}
      <Card className="border-border/60 bg-gradient-to-r from-card via-card to-muted/30">
        <CardHeader className="flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Database className="size-5 text-primary" />
              <CardTitle className="text-lg font-bold tracking-tight">
                Signal & Evidence Inspector
              </CardTitle>
            </div>
            <CardDescription className="mt-1 text-xs">
              Verifiable facts, calculated metrics, and AI inferences collected for{" "}
              <span className="font-semibold text-foreground">{company.name}</span>.
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleCollectSignals(false)}
              disabled={collecting}
              className="gap-1.5"
            >
              {collecting ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              {collecting ? "Collecting…" : "Collect Signals"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleCollectSignals(true)}
              disabled={collecting}
              className="gap-1.5 text-xs"
              title="Force re-execution of all external signal providers bypassing 30-day cache"
            >
              <Zap className="size-3.5 text-amber-500" />
              Force Refresh
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 pt-0">
          {/* Summary Metric Counters */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg border bg-background/80 p-3 shadow-xs">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Total Signals
              </p>
              <p className="mt-0.5 text-2xl font-bold">{evidenceItems.length}</p>
            </div>

            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 shadow-xs">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
                  Facts
                </p>
                <ShieldCheck className="size-3.5 text-emerald-600" />
              </div>
              <p className="mt-0.5 text-2xl font-bold text-emerald-700 dark:text-emerald-300">
                {factsCount}
              </p>
            </div>

            <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 shadow-xs">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-medium text-blue-700 dark:text-blue-400 uppercase tracking-wider">
                  Metrics
                </p>
                <Zap className="size-3.5 text-blue-600" />
              </div>
              <p className="mt-0.5 text-2xl font-bold text-blue-700 dark:text-blue-300">
                {metricsCount}
              </p>
            </div>

            <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 shadow-xs">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-medium text-purple-700 dark:text-purple-400 uppercase tracking-wider">
                  AI Inferences
                </p>
                <Sparkles className="size-3.5 text-purple-600" />
              </div>
              <p className="mt-0.5 text-2xl font-bold text-purple-700 dark:text-purple-300">
                {aiCount}
              </p>
            </div>
          </div>

          {/* Website Opportunity & Technical Audit Summary */}
          {hasWebsiteSignals ? (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Globe className="size-4 text-primary" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-primary">
                    Website Opportunity & Technical Health Audit
                  </h4>
                </div>
                {company.website || company.domain ? (
                  <span className="text-xs text-muted-foreground font-mono">
                    {company.website || company.domain}
                  </span>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
                {/* 1. PageSpeed Score */}
                <div className="rounded-md border bg-background/90 p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold">PageSpeed</span>
                    <Gauge className="size-3 text-muted-foreground" />
                  </div>
                  <div className="mt-1 flex items-baseline gap-1">
                    {pagespeedScore !== undefined ? (
                      <>
                        <span
                          className={`text-lg font-bold ${
                            pagespeedScore >= 80
                              ? "text-emerald-600 dark:text-emerald-400"
                              : pagespeedScore >= 50
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-red-600 dark:text-red-400"
                          }`}
                        >
                          {pagespeedScore}
                        </span>
                        <span className="text-[10px] text-muted-foreground">/100</span>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground font-medium">N/A</span>
                    )}
                  </div>
                  {lcpSeconds !== undefined ? (
                    <p className="text-[10px] text-muted-foreground">LCP: {lcpSeconds}s</p>
                  ) : null}
                </div>

                {/* 2. CMS & Tech Stack */}
                <div className="rounded-md border bg-background/90 p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold">CMS / Platform</span>
                    <Layers className="size-3 text-muted-foreground" />
                  </div>
                  <p className="mt-1 text-xs font-bold truncate">
                    {cmsName && cmsName !== "custom_or_unknown" ? cmsName : "Custom / None"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {cmsName && cmsName !== "custom_or_unknown" ? "Detected Stack" : "Custom Built"}
                  </p>
                </div>

                {/* 3. Mobile UX */}
                <div className="rounded-md border bg-background/90 p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold">Mobile UX</span>
                    <Smartphone className="size-3 text-muted-foreground" />
                  </div>
                  <p className={`mt-1 text-xs font-bold ${mobileFriendly ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                    {mobileFriendly ? "Mobile Friendly" : "Viewport Missing"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {mobileFriendly ? "Responsive" : "Non-optimized"}
                  </p>
                </div>

                {/* 4. E-Commerce */}
                <div className="rounded-md border bg-background/90 p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold">E-Commerce</span>
                    <ShoppingCart className="size-3 text-muted-foreground" />
                  </div>
                  <p className={`mt-1 text-xs font-bold ${hasOnlineOrdering ? "text-emerald-600 dark:text-emerald-400" : "text-slate-600 dark:text-slate-400"}`}>
                    {hasOnlineOrdering ? ecommercePlatform || "Online Ordering" : "No E-Commerce"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {hasOnlineOrdering ? "Cart/Checkout active" : "Lead gen / Showcase"}
                  </p>
                </div>

                {/* 5. Booking Widget */}
                <div className="rounded-md border bg-background/90 p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold">Booking</span>
                    <Calendar className="size-3 text-muted-foreground" />
                  </div>
                  <p className={`mt-1 text-xs font-bold ${hasBookingWidget ? "text-emerald-600 dark:text-emerald-400" : "text-slate-600 dark:text-slate-400"}`}>
                    {hasBookingWidget ? bookingProvider || "Widget Present" : "No Booking Widget"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {hasBookingWidget ? "Online reservation" : "Manual contact"}
                  </p>
                </div>

                {/* 6. SSL & Outdated Signals */}
                <div className="rounded-md border bg-background/90 p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold">Health & SSL</span>
                    {sslActive ? <Lock className="size-3 text-emerald-500" /> : <Unlock className="size-3 text-red-500" />}
                  </div>
                  <p className={`mt-1 text-xs font-bold ${isCopyrightOutdated || hasLegacyTables ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                    {isCopyrightOutdated
                      ? `Legacy (© ${outdatedCopyrightYear})`
                      : hasLegacyTables
                      ? "Legacy HTML"
                      : sslActive
                      ? "HTTPS Secure"
                      : "Insecure HTTP"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {sslActive ? "Valid SSL" : "Missing HTTPS"}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {/* Feedback & status alerts */}
          {error ? (
            <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300">
              <AlertCircle className="size-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {statusMessage ? (
            <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="size-4 shrink-0" />
              <span>{statusMessage}</span>
            </div>
          ) : null}

          {/* Filter Toolbar */}
          <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[200px] max-w-xs">
                <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                <Input
                  placeholder="Filter key, value, provider..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 pl-8 text-xs"
                />
              </div>

              {/* Nature Filter Pills */}
              <div className="flex items-center gap-1 rounded-md border bg-muted/40 p-0.5 text-xs">
                {[
                  { id: "all", label: "All Nature" },
                  { id: "fact", label: "Facts" },
                  { id: "derived_metric", label: "Metrics" },
                  { id: "ai_interpretation", label: "Inferences" }
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setSelectedNature(tab.id)}
                    className={`rounded px-2.5 py-1 font-medium transition-all ${
                      selectedNature === tab.id
                        ? "bg-background text-foreground shadow-xs font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Provider selector */}
            {providersInEvidence.length > 0 ? (
              <div className="flex items-center gap-1.5 text-xs">
                <Filter className="size-3.5 text-muted-foreground" />
                <select
                  value={selectedProvider}
                  onChange={(e) => setSelectedProvider(e.target.value)}
                  aria-label="Filter by Signal Provider"
                  className="rounded-md border bg-background px-2.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="all">All Signal Providers</option>
                  {providersInEvidence.map((providerId) => (
                    <option key={providerId} value={providerId}>
                      {PROVIDER_LABELS[providerId] || providerId}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Evidence Items List / Grid */}
      {loading ? (
        <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed p-8">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-primary" />
            Loading evidence provenance...
          </div>
        </div>
      ) : filteredEvidence.length === 0 ? (
        <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-8 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Database className="size-6" />
          </div>
          <div>
            <h4 className="font-semibold text-foreground">
              {evidenceItems.length === 0 ? "No signals collected yet" : "No matching evidence items"}
            </h4>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">
              {evidenceItems.length === 0
                ? "Execute signal collection to extract verified facts from French registries and Google Places."
                : "Try adjusting your search query or nature filter."}
            </p>
          </div>
          {evidenceItems.length === 0 ? (
            <Button
              size="sm"
              onClick={() => void handleCollectSignals(false)}
              disabled={collecting}
              className="gap-2 mt-2"
            >
              {collecting ? <Loader2 className="size-4 animate-spin" /> : <Flame className="size-4" />}
              {collecting ? "Collecting Signals…" : "Run Signal Collection"}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filteredEvidence.map((item) => {
            const natureConfig = NATURE_CONFIG[item.nature] || NATURE_CONFIG.fact;
            const NatureIcon = natureConfig.icon;
            const isExpanded = Boolean(expandedItems[item.id]);
            const isObject = typeof item.value === "object" && item.value !== null;

            return (
              <Card
                key={item.id}
                className="overflow-hidden border-border/70 transition-all hover:border-border hover:shadow-xs"
              >
                <div className="p-3.5 space-y-2.5">
                  {/* Top line: Nature badge & Provider */}
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${natureConfig.bg} ${natureConfig.text} ${natureConfig.border}`}
                    >
                      <NatureIcon className="size-3" />
                      {natureConfig.label}
                    </span>

                    <span className="inline-flex items-center gap-1 rounded bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      <Layers className="size-3" />
                      {PROVIDER_LABELS[item.signalProvider] || item.signalProvider}
                    </span>
                  </div>

                  {/* Key & Value */}
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      {formatKeyName(item.key)}
                    </p>
                    <div className="mt-1 font-mono text-sm font-semibold break-words text-foreground">
                      {isObject ? (
                        <span className="text-xs text-muted-foreground">
                          {isExpanded ? (
                            <pre className="mt-1 overflow-x-auto rounded bg-muted/40 p-2 text-[11px] text-foreground font-mono">
                              {JSON.stringify(item.value, null, 2)}
                            </pre>
                          ) : (
                            `[Object: ${Object.keys(item.value as object).length} keys]`
                          )}
                        </span>
                      ) : (
                        <span>{formatValue(item.value)}</span>
                      )}
                    </div>
                  </div>

                  {/* Confidence Bar */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">Confidence</span>
                      <span className="font-semibold">{item.confidence ?? 100}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full transition-all ${
                          item.confidence >= 90
                            ? "bg-emerald-500"
                            : item.confidence >= 70
                              ? "bg-blue-500"
                              : "bg-amber-500"
                        }`}
                        style={{ width: `${Math.max(5, item.confidence ?? 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* Provenance Footer */}
                  <div className="flex items-center justify-between border-t pt-2 text-[11px] text-muted-foreground">
                    <div className="flex items-center gap-2 truncate">
                      <span>Source: {item.sourceType}</span>
                      {item.sourceUrl ? (
                        <a
                          href={item.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 text-primary hover:underline"
                        >
                          Link
                          <ExternalLink className="size-2.5" />
                        </a>
                      ) : null}
                    </div>

                    {isObject ? (
                      <button
                        onClick={() => toggleExpand(item.id)}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        {isExpanded ? "Collapse" : "Raw JSON"}
                        {isExpanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                      </button>
                    ) : null}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
