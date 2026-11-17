"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Building2,
  Calendar,
  KeyRound,
  Loader2,
  Lock,
  Plus,
  Save,
  Sliders,
  Tag,
  Trash2,
  BookOpen,
  Bot,
  FileText,
  Activity,
  Cpu,
  RotateCcw,
  Play,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Coins,
  RefreshCw,
  ShieldCheck,
  Zap
} from "lucide-react";
import { SdrDemoModal } from "@/features/demo/sdr-demo-modal";
import type { GlobalSettings, OfferDoc } from "@/types/firestore";
import type { QueueHealthSummary } from "@/types/domain";
import { useBusiness } from "@/lib/context/business-context";
import {
  clearAiProviderSecret,
  getGlobalSettings,
  getIntegrationSecretsStatus,
  saveAiProviderSecrets,
  saveGlobalSettings,
  saveIntegrationSecrets,
  saveOfferClient,
  deleteOfferClient,
  saveKnowledgeBaseClient,
  getQueueHealthClient,
  triggerTaskQueueProcessor,
  retryFailedTaskJobs,
  saveBudgetSettingsClient,
} from "@/lib/firebase/firestore";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AutonomySettings } from "@/features/settings/autonomy-settings";
import { ResetDataPanel } from "@/features/settings/reset-data-panel";
import { LogoField } from "@/features/settings/logo-field";
import { ProposalDocumentPanel } from "@/features/settings/proposal-document-panel";
import { OfferPricingFields } from "@/features/settings/offer-pricing-fields";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  EMPTY_PRICING_FORM,
  caseStudiesFromText,
  caseStudiesToText,
  pricingFormFromOffer,
  pricingFormErrors,
  pricingGuardrailsFromForm,
  servicesFromText,
  servicesToText,
  splitLines,
  type PricingFormState
} from "@/lib/offers/offer-form";

const defaults: GlobalSettings = {
  automationPaused: true,
  aiProvider: "qwen",
  openAiModel: "gpt-4o-mini",
  anthropicModel: "claude-3-5-haiku-20241022",
  openAiApiKeyConfigured: false,
  anthropicApiKeyConfigured: false,
  dailyAiResearchLimit: 25,
  dailyEmailGenerationLimit: 50,
  dailyOutreachSendLimit: 20,
  requireApprovalBeforeExport: true,
  defaultLanguage: "fr",
  companyContext: "",
  dailyDiscoveryLimit: 100,
  autoQueueDiscoveredCompanies: true,
  minDiscoveryScoreForAutoResearch: 80,
  minQualityScoreForAutoResearch: 70,
  enabledDiscoveryProviders: ["recherche_entreprises", "sirene", "google_places"],
  defaultDiscoveryCities: ["Nantes"],
  defaultDiscoverySegments: ["road_safety"],
};

function SectionCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ElementType;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-blue-50">
          <Icon className="size-4 text-blue-600" />
        </div>
        <div>
          <div className="text-[14px] font-semibold text-slate-900">{title}</div>
          {description && <div className="text-[12px] text-slate-500">{description}</div>}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function FieldRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-[12px] font-semibold text-slate-700">{label}</Label>
      {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
      {children}
    </div>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        ok ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
      }`}
    >
      <span className={`size-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-slate-400"}`} />
      {ok ? "Configured" : "Not set"}
    </span>
  );
}

function ApiKeyField({
  id,
  label,
  hint,
  value,
  onChange,
  placeholder,
  configured,
  onClear,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  configured: boolean;
  onClear?: () => void;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-[12px] font-semibold text-slate-700">
          {label}
        </Label>
        <StatusDot ok={configured} />
      </div>
      {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
      <div className="flex gap-2">
        <Input
          id={id}
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={configured ? "Leave blank to keep current key" : placeholder}
          autoComplete="off"
          className="flex-1 text-[13px]"
        />
        {onClear && configured && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClear}
            className="shrink-0 text-red-500 hover:text-red-700"
            title="Remove key"
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}


/**
 * Settings grouped into areas a business owner recognises. The underlying tab
 * panels are unchanged - only their presentation is grouped.
 */
const SETTINGS_GROUPS: Array<{
  label: string;
  tabs: Array<{ value: string; label: string; icon: React.ElementType }>;
}> = [
  {
    label: "My business",
    tabs: [
      { value: "business", label: "Business", icon: Building2 },
      { value: "offers", label: "Offers", icon: Tag },
      { value: "kb", label: "Knowledge", icon: BookOpen }
    ]
  },
  {
    label: "SDR",
    tabs: [
      { value: "autonomy", label: "Autonomy", icon: Bot },
      { value: "document", label: "Attached document", icon: FileText }
    ]
  },
  {
    label: "Advanced",
    tabs: [
      { value: "ai", label: "Connections & AI", icon: Sliders },
      { value: "reliability", label: "Reliability & costs", icon: Activity },
      { value: "reset", label: "Start over", icon: Trash2 }
    ]
  }
];

export function SettingsPage() {
  const {
    workspaceId,
    currentBusiness,
    currentBusinessId,
    offers,
    knowledgeBase,
    updateCurrentBusiness,
    reloadOffers,
    reloadKnowledgeBase,
  } = useBusiness();

  const [activeTab, setActiveTab] = useState("business");
  const [settings, setSettings] = useState<GlobalSettings>(defaults);
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [qwenApiKey, setQwenApiKey] = useState("");
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [globalSaved, setGlobalSaved] = useState(false);

  // Business Profile Form
  const [bizName, setBizName] = useState("");
  const [bizTagline, setBizTagline] = useState("");
  const [bizWebsite, setBizWebsite] = useState("");
  const [bizColor, setBizColor] = useState("#2563eb");
  const [bizLogo, setBizLogo] = useState("");
  const [bizLanguage, setBizLanguage] = useState<"fr" | "en">("fr");
  const [bizSenderEmail, setBizSenderEmail] = useState("");
  const [bizSenderName, setBizSenderName] = useState("");
  const [savingBiz, setSavingBiz] = useState(false);
  const [bizSaved, setBizSaved] = useState(false);

  // Offer Modal Form
  const [offerModalOpen, setOfferModalOpen] = useState(false);
  const [editingOfferId, setEditingOfferId] = useState<string | null>(null);
  const [offerName, setOfferName] = useState("");
  const [offerDesc, setOfferDesc] = useState("");
  const [offerPersonas, setOfferPersonas] = useState("Dirigeant / Gérant (gérant, fondateur, patron)\nResponsable Commercial (directeur commercial)");
  // No prefilled claims: the SDR treats value propositions and proof points as
  // approved fact, so a placeholder saved unedited became an invented proof.
  const [offerValueProps, setOfferValueProps] = useState("");
  const [offerProofPoints, setOfferProofPoints] = useState("");
  const [offerPricing, setOfferPricing] = useState<PricingFormState>(EMPTY_PRICING_FORM);
  const [offerProhibited, setOfferProhibited] = useState("");
  const [savingOffer, setSavingOffer] = useState(false);

  // Knowledge Base Form
  const [kbServices, setKbServices] = useState("");
  const [kbCaseStudies, setKbCaseStudies] = useState("");
  const [kbPricingRules, setKbPricingRules] = useState("");
  const [kbFaqs, setKbFaqs] = useState("");
  const [kbProhibited, setKbProhibited] = useState("");
  const [savingKb, setSavingKb] = useState(false);
  const [kbSaved, setKbSaved] = useState(false);

  // Integrations Form
  const [dropcontactKey, setDropcontactKey] = useState("");
  const [instantlyKey, setInstantlyKey] = useState("");
  const [pappersKey, setPappersKey] = useState("");
  const [serperKey, setSerperKey] = useState("");
  const [googleKey, setGoogleKey] = useState("");
  const [verifierKey, setVerifierKey] = useState("");
  const [msTenantId, setMsTenantId] = useState("");
  const [msClientId, setMsClientId] = useState("");
  const [msClientSecret, setMsClientSecret] = useState("");
  const [msRefreshToken, setMsRefreshToken] = useState("");
  const [integrationStatus, setIntegrationStatus] = useState({
    dropcontactConfigured: false,
    instantlyConfigured: false,
    pappersConfigured: false,
    serperConfigured: false,
    googleConfigured: false,
    emailVerifierConfigured: false,
    outlookConfigured: false,
  });
  const [savingIntegrations, setSavingIntegrations] = useState(false);
  const [integrationsSaved, setIntegrationsSaved] = useState(false);

  // Test Mode & Allowlist State
  const [demoModalOpen, setDemoModalOpen] = useState(false);
  const [newAllowlistEmail, setNewAllowlistEmail] = useState("");
  const [savingAllowlist, setSavingAllowlist] = useState(false);

  const handleAddAllowlistEmail = async () => {
    if (!newAllowlistEmail.trim()) return;
    const clean = newAllowlistEmail.trim().toLowerCase();
    const currentList = settings.testEmailAllowlist || [];
    if (currentList.includes(clean)) {
      setNewAllowlistEmail("");
      return;
    }
    setSavingAllowlist(true);
    try {
      const updatedList = [...currentList, clean];
      const updated = { ...settings, testEmailAllowlist: updatedList };
      setSettings(updated);
      await saveGlobalSettings(updated);
      setNewAllowlistEmail("");
    } finally {
      setSavingAllowlist(false);
    }
  };

  const handleRemoveAllowlistEmail = async (emailToRemove: string) => {
    setSavingAllowlist(true);
    try {
      const currentList = settings.testEmailAllowlist || [];
      const updatedList = currentList.filter((e) => e !== emailToRemove);
      const updated = { ...settings, testEmailAllowlist: updatedList };
      setSettings(updated);
      await saveGlobalSettings(updated);
    } finally {
      setSavingAllowlist(false);
    }
  };

  const handleToggleTestMode = async () => {
    setSavingAllowlist(true);
    try {
      const next = !settings.testModeEnabled;
      const updated = { ...settings, testModeEnabled: next };
      setSettings(updated);
      await saveGlobalSettings(updated);
    } finally {
      setSavingAllowlist(false);
    }
  };

  // Reliability & Cost Control State
  const [queueHealth, setQueueHealth] = useState<QueueHealthSummary | null>(null);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [processingQueue, setProcessingQueue] = useState(false);
  const [retryingJobs, setRetryingJobs] = useState(false);
  const [dailyBudgetInput, setDailyBudgetInput] = useState<number>(25);
  const [monthlyBudgetInput, setMonthlyBudgetInput] = useState<number>(250);
  const [savingBudget, setSavingBudget] = useState(false);
  const [budgetSaved, setBudgetSaved] = useState(false);

  const fetchQueueHealth = useCallback(async () => {
    setLoadingQueue(true);
    try {
      const health = await getQueueHealthClient(workspaceId, currentBusinessId);
      setQueueHealth(health);
      if (health.dailyBudgetCapUsd) setDailyBudgetInput(health.dailyBudgetCapUsd);
      if (health.monthlyBudgetCapUsd) setMonthlyBudgetInput(health.monthlyBudgetCapUsd);
    } catch (err) {
      console.error("Failed to load queue health", err);
    } finally {
      setLoadingQueue(false);
    }
  }, [workspaceId, currentBusinessId]);

  const handleTriggerQueue = async () => {
    setProcessingQueue(true);
    try {
      await triggerTaskQueueProcessor(10, workspaceId, currentBusinessId);
      await fetchQueueHealth();
    } catch (err) {
      console.error("Failed to trigger task queue processor", err);
    } finally {
      setProcessingQueue(false);
    }
  };

  const handleRetryJobs = async (jobIds?: string[]) => {
    setRetryingJobs(true);
    try {
      await retryFailedTaskJobs(jobIds, workspaceId, currentBusinessId);
      await fetchQueueHealth();
    } catch (err) {
      console.error("Failed to retry jobs", err);
    } finally {
      setRetryingJobs(false);
    }
  };

  const handleSaveBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingBudget(true);
    try {
      await saveBudgetSettingsClient({
        dailySpendBudgetUsd: Number(dailyBudgetInput),
        monthlySpendBudgetUsd: Number(monthlyBudgetInput),
      });
      setBudgetSaved(true);
      setTimeout(() => setBudgetSaved(false), 3000);
      await fetchQueueHealth();
    } catch (err) {
      console.error("Failed to save budget settings", err);
    } finally {
      setSavingBudget(false);
    }
  };

  useEffect(() => {
    if (activeTab === "reliability") {
      void fetchQueueHealth();
    }
  }, [activeTab, fetchQueueHealth]);

  useEffect(() => {
    if (currentBusiness) {
      setBizName(currentBusiness.name || "");
      setBizTagline(currentBusiness.branding?.tagline || "");
      setBizWebsite(currentBusiness.website || "");
      setBizSenderEmail(currentBusiness.senderConfig?.defaultSenderEmail || "");
      setBizSenderName(currentBusiness.senderConfig?.defaultSenderName || "");
      setBizColor(currentBusiness.branding?.primaryColor || "#2563eb");
      setBizLogo(currentBusiness.branding?.logoUrl || "");
      setBizLanguage(currentBusiness.defaultLanguage || "fr");
    }
  }, [currentBusiness]);

  useEffect(() => {
    if (knowledgeBase) {
      setKbServices(servicesToText(knowledgeBase.services));
      setKbCaseStudies(caseStudiesToText(knowledgeBase.caseStudies));
      setKbPricingRules(knowledgeBase.pricingRules?.join("\n") || "");
      setKbFaqs(knowledgeBase.faqs?.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join("\n\n") || "");
      setKbProhibited(knowledgeBase.prohibitedPromises?.join("\n") || "");
    }
  }, [knowledgeBase]);

  useEffect(() => {
    // Settled, not all-or-nothing: a connection status lookup must never be
    // able to take down the whole Settings page.
    void Promise.allSettled([getGlobalSettings(), getIntegrationSecretsStatus()]).then(
      ([settingsResult, statusResult]) => {
        if (settingsResult.status === "fulfilled" && settingsResult.value) {
          const result = settingsResult.value;
          setSettings({ ...defaults, ...result });
          if (result.dailySpendBudgetUsd) setDailyBudgetInput(result.dailySpendBudgetUsd);
          if (result.monthlySpendBudgetUsd) setMonthlyBudgetInput(result.monthlySpendBudgetUsd);
        } else if (settingsResult.status === "rejected") {
          console.error("Failed to load settings", settingsResult.reason);
        }

        if (statusResult.status === "fulfilled") {
          setIntegrationStatus({
            ...statusResult.value,
            googleConfigured: statusResult.value.googleConfigured ?? false,
            emailVerifierConfigured: statusResult.value.emailVerifierConfigured ?? false
          });
        } else {
          console.error("Failed to load connection status", statusResult.reason);
        }
      }
    );
  }, []);

  const handleSaveBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentBusiness) return;
    setSavingBiz(true);
    try {
      await updateCurrentBusiness({
        name: bizName,
        website: bizWebsite,
        defaultLanguage: bizLanguage,
        branding: {
          primaryColor: bizColor,
          tagline: bizTagline,
          logoUrl: bizLogo || undefined,
        },
        senderConfig: {
          ...(currentBusiness.senderConfig ?? {}),
          defaultSenderEmail: bizSenderEmail.trim() || undefined,
          defaultSenderName: bizSenderName.trim() || undefined,
        },
      });
      setBizSaved(true);
      setTimeout(() => setBizSaved(false), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setSavingBiz(false);
    }
  };

  const handleOpenOfferModal = (offer?: OfferDoc) => {
    if (offer) {
      setEditingOfferId(offer.id);
      setOfferName(offer.name);
      setOfferDesc(offer.description);
      setOfferPersonas(offer.targetPersonas?.map((p) => `${p.title} (${p.keywords.join(", ")})`).join("\n") || "");
      setOfferValueProps(offer.valuePropositions?.join("\n") || "");
      setOfferProofPoints(offer.proofPoints?.join("\n") || "");
      setOfferPricing(pricingFormFromOffer(offer));
      setOfferProhibited(offer.prohibitedPromises?.join("\n") || "");
    } else {
      setEditingOfferId(null);
      setOfferName("");
      setOfferDesc("");
      setOfferPersonas("Dirigeant / Gérant (gérant, fondateur, patron)");
      setOfferValueProps("");
      setOfferProofPoints("");
      setOfferPricing({ ...EMPTY_PRICING_FORM });
      setOfferProhibited("");
    }
    setOfferModalOpen(true);
  };

  const handleSaveOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!offerName.trim() || !currentBusinessId) return;
    // An unreadable figure would be dropped and silently switch a check off.
    if (pricingFormErrors(offerPricing).length) return;
    setSavingOffer(true);
    try {
      const personas = offerPersonas
        .split("\n")
        .map((line, idx) => {
          const match = line.match(/^([^()]+)(?:\((.*)\))?$/);
          const title = (match ? match[1] : line).trim();
          const kws = match && match[2] ? match[2].split(",").map((s) => s.trim()) : [title.toLowerCase()];
          return { title, priority: idx + 1, keywords: kws };
        })
        .filter((p) => Boolean(p.title));

      await saveOfferClient(workspaceId, currentBusinessId, {
        id: editingOfferId || undefined,
        name: offerName.trim(),
        description: offerDesc.trim(),
        targetPersonas: personas,
        valuePropositions: splitLines(offerValueProps),
        proofPoints: splitLines(offerProofPoints),
        pricingGuardrails: pricingGuardrailsFromForm(offerPricing),
        prohibitedPromises: splitLines(offerProhibited),
      });

      await reloadOffers();
      setOfferModalOpen(false);
    } catch (err) {
      console.error("Failed to save offer", err);
    } finally {
      setSavingOffer(false);
    }
  };

  const handleDeleteOffer = async (offerId: string) => {
    if (typeof window !== "undefined" && !window.confirm("Are you sure you want to delete this offer?")) return;
    try {
      await deleteOfferClient(workspaceId, currentBusinessId, offerId);
      await reloadOffers();
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveKb = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentBusinessId) return;
    setSavingKb(true);
    try {
      const services = servicesFromText(kbServices);
      // Parsed as written: no default industry, never a default metric.
      const caseStudies = caseStudiesFromText(kbCaseStudies);

      const faqs = kbFaqs
        .split("\n\n")
        .filter(Boolean)
        .map((chunk) => {
          const lines = chunk.split("\n");
          return {
            question: lines[0]?.replace(/^Q:\s*/, "").trim() || "Question",
            answer: lines[1]?.replace(/^A:\s*/, "").trim() || "Answer",
          };
        });

      const pricingRules = kbPricingRules.split("\n").map((s) => s.trim()).filter(Boolean);
      const prohibitedPromises = kbProhibited.split("\n").map((s) => s.trim()).filter(Boolean);

      await saveKnowledgeBaseClient(workspaceId, currentBusinessId, {
        services,
        caseStudies,
        faqs,
        pricingRules,
        prohibitedPromises,
      });

      await reloadKnowledgeBase();
      setKbSaved(true);
      setTimeout(() => setKbSaved(false), 3000);
    } catch (err) {
      console.error("Failed to save KB", err);
    } finally {
      setSavingKb(false);
    }
  };

  const handleSaveGlobal = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingGlobal(true);
    try {
      if (anthropicApiKey.trim() || qwenApiKey.trim()) {
        const status = await saveAiProviderSecrets({
          anthropicApiKey: anthropicApiKey.trim() || undefined,
          qwenApiKey: qwenApiKey.trim() || undefined,
        });
        setSettings((s) => ({
          ...s,
          anthropicApiKeyConfigured: status.anthropicConfigured,
          qwenApiKeyConfigured: status.qwenConfigured,
        }));
        setAnthropicApiKey("");
        setQwenApiKey("");
      }

      await saveGlobalSettings(settings);
      setGlobalSaved(true);
      setTimeout(() => setGlobalSaved(false), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setSavingGlobal(false);
    }
  };

  const handleSaveIntegrations = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingIntegrations(true);
    try {
      const updated = await saveIntegrationSecrets({
        dropcontactApiKey: dropcontactKey.trim() || undefined,
        instantlyApiKey: instantlyKey.trim() || undefined,
        pappersApiKey: pappersKey.trim() || undefined,
        serperApiKey: serperKey.trim() || undefined,
        googleApiKey: googleKey.trim() || undefined,
        emailVerifierApiKey: verifierKey.trim() || undefined,
        microsoftTenantId: msTenantId.trim() || undefined,
        microsoftClientId: msClientId.trim() || undefined,
        microsoftClientSecret: msClientSecret.trim() || undefined,
        microsoftRefreshToken: msRefreshToken.trim() || undefined,
      });
      setIntegrationStatus({ ...updated, googleConfigured: updated.googleConfigured ?? false, emailVerifierConfigured: updated.emailVerifierConfigured ?? false });
      setDropcontactKey("");
      setInstantlyKey("");
      setPappersKey("");
      setSerperKey("");
      setGoogleKey("");
      setVerifierKey("");
      setMsTenantId("");
      setMsClientId("");
      setMsClientSecret("");
      setMsRefreshToken("");
      setIntegrationsSaved(true);
      setTimeout(() => setIntegrationsSaved(false), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setSavingIntegrations(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Settings"
        description="Your business, what you sell, and how independently your SDR works."
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4 space-y-6">
        {/* Grouped so a normal user reads three familiar areas instead of one
            undifferentiated row of technical tabs. */}
        <div className="space-y-3">
          {SETTINGS_GROUPS.map((group) => (
            <div key={group.label} className="flex flex-wrap items-center gap-2">
              <span className="w-24 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {group.label}
              </span>
              <TabsList className="flex flex-wrap gap-1 bg-slate-100 p-1 rounded-xl">
                {group.tabs.map((tab) => (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className="flex items-center gap-1.5 text-xs font-semibold"
                  >
                    <tab.icon className="size-3.5" />
                    <span>{tab.value === "offers" ? `${tab.label} (${offers.length})` : tab.label}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          ))}
        </div>

        <TabsContent value="autonomy">
          <AutonomySettings />
        </TabsContent>

        <TabsContent value="document">
          <ProposalDocumentPanel />
        </TabsContent>

        <TabsContent value="reset">
          <ResetDataPanel />
        </TabsContent>

        {/* ── TAB 1: Business Profile ── */}
        <TabsContent value="business">
          <form onSubmit={handleSaveBusiness} className="space-y-6">
            <SectionCard
              icon={Building2}
              title={`Business Profile: ${currentBusiness?.name || "Active Business"}`}
              description="Configure commercial identity, branding, and automation policy for this business."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <FieldRow label="Business Name" hint="Display name for this business entity.">
                  <Input value={bizName} onChange={(e) => setBizName(e.target.value)} required className="text-xs" />
                </FieldRow>
                <FieldRow
                  label="Logo"
                  hint="Your business as it appears in the app and in the browser tab."
                >
                  <LogoField
                    workspaceId={workspaceId || "ws_default"}
                    businessId={currentBusinessId || ""}
                    value={bizLogo}
                    onChange={setBizLogo}
                  />
                </FieldRow>

                <FieldRow label="Tagline / Mission" hint="Short summary used in AI context grounding.">
                  <Input value={bizTagline} onChange={(e) => setBizTagline(e.target.value)} className="text-xs" />
                </FieldRow>
                <FieldRow label="Website URL" hint="Official website of this business.">
                  <Input value={bizWebsite} onChange={(e) => setBizWebsite(e.target.value)} className="text-xs" />
                </FieldRow>
                <FieldRow
                  label="Sending address"
                  hint="Every email this business sends comes from here. Each business sends from its own address."
                >
                  <Input
                    type="email"
                    value={bizSenderEmail}
                    onChange={(e) => setBizSenderEmail(e.target.value)}
                    placeholder="bonjour@votre-entreprise.fr"
                    className="text-xs"
                  />
                </FieldRow>
                <FieldRow label="Sender name" hint="Name shown to the recipient.">
                  <Input
                    value={bizSenderName}
                    onChange={(e) => setBizSenderName(e.target.value)}
                    placeholder={bizName || "Your name"}
                    className="text-xs"
                  />
                </FieldRow>
                <FieldRow label="Default Language">
                  <Select value={bizLanguage} onValueChange={(v: "fr" | "en") => setBizLanguage(v)}>
                    <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fr">French (Français)</SelectItem>
                      <SelectItem value="en">English</SelectItem>
                    </SelectContent>
                  </Select>
                </FieldRow>
              </div>

              <div className="mt-4">
                <FieldRow label="Brand Color" hint="Accent color for business avatars and proposal PDF exports.">
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={bizColor}
                      onChange={(e) => setBizColor(e.target.value)}
                      className="size-8 cursor-pointer rounded border border-slate-200 p-0.5"
                    />
                    <Input value={bizColor} onChange={(e) => setBizColor(e.target.value)} className="w-28 text-xs font-mono" />
                  </div>
                </FieldRow>
              </div>

              <div className="mt-5 flex items-center gap-3">
                <Button type="submit" disabled={savingBiz} className="bg-blue-600 hover:bg-blue-700 text-white text-xs">
                  {savingBiz ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                  Save Business Profile
                </Button>
                {bizSaved && <span className="text-xs font-semibold text-emerald-600">✓ Profile Saved</span>}
              </div>
            </SectionCard>
          </form>
        </TabsContent>

        {/* ── TAB 2: Offers & Personas ── */}
        <TabsContent value="offers">
          <SectionCard
            icon={Tag}
            title={`Offers for ${currentBusiness?.name || "Active Business"}`}
            description="Campaigns attach to a specific Offer, inheriting target personas, value props, and pricing guardrails."
          >
            <div className="mb-4 flex justify-between items-center">
              <span className="text-xs text-slate-500 font-medium">{offers.length} active offer(s) defined</span>
              <Button
                onClick={() => handleOpenOfferModal()}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs"
              >
                <Plus className="size-3.5" />
                <span>Create New Offer</span>
              </Button>
            </div>

            <div className="grid gap-3">
              {offers.map((offer) => (
                <div
                  key={offer.id}
                  className="flex items-start justify-between rounded-lg border border-slate-200 bg-slate-50/50 p-4 transition-all hover:bg-white hover:shadow-xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">{offer.name}</span>
                      {offer.pricingGuardrails?.startingPrice && (
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                          Starting at €{offer.pricingGuardrails.startingPrice}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-600">{offer.description}</p>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {offer.targetPersonas?.map((p, idx) => (
                        <span key={idx} className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                          🎯 {p.title}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleOpenOfferModal(offer)} className="text-xs">
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void handleDeleteOffer(offer.id)}
                      className="text-red-500 hover:text-red-700"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </TabsContent>

        {/* ── TAB 3: Knowledge Base ── */}
        <TabsContent value="kb">
          <form onSubmit={handleSaveKb} className="space-y-6">
            <SectionCard
              icon={BookOpen}
              title={`Knowledge Base: ${currentBusiness?.name || "Active Business"}`}
              description="Authoritative facts used by the AI reply engine to respond to prospect inquiries without hallucinations."
            >
              <div className="grid gap-4">
                <FieldRow label="Services & Capabilities" hint="One per line: 'Name | Description | Ideal for'">
                  <Textarea
                    value={kbServices}
                    onChange={(e) => setKbServices(e.target.value)}
                    className="min-h-24 font-mono text-xs"
                    placeholder="Site vitrine | 4 à 6 pages, rapide sur mobile | Artisans sans site"
                  />
                </FieldRow>

                <FieldRow label="Case Studies & Proof Points" hint="One per line: 'Title | Industry | Measured metric (leave empty if none) | Summary'. The AI cites these as fact.">
                  <Textarea
                    value={kbCaseStudies}
                    onChange={(e) => setKbCaseStudies(e.target.value)}
                    className="min-h-20 font-mono text-xs"
                    placeholder="Salon de coiffure — Dol-de-Bretagne | Coiffure |  | Site livré et en ligne"
                  />
                </FieldRow>

                <FieldRow label="Frequently Asked Questions (FAQs)" hint="Questions and answers separated by blank lines">
                  <Textarea
                    value={kbFaqs}
                    onChange={(e) => setKbFaqs(e.target.value)}
                    className="min-h-24 font-mono text-xs"
                    placeholder="Q: Delivery timeframe?\nA: 2 to 3 weeks."
                  />
                </FieldRow>

                <FieldRow label="Pricing Rules & Guardrails" hint="Explicit pricing boundaries the AI can cite.">
                  <Textarea
                    value={kbPricingRules}
                    onChange={(e) => setKbPricingRules(e.target.value)}
                    className="min-h-20 font-mono text-xs"
                    placeholder="Showcase websites start at €1,490 HT."
                  />
                </FieldRow>

                <FieldRow label="Prohibited Promises" hint="Strict invariant: claims or guarantees the AI must never make.">
                  <Textarea
                    value={kbProhibited}
                    onChange={(e) => setKbProhibited(e.target.value)}
                    className="min-h-20 font-mono text-xs text-red-700"
                    placeholder="Do not promise guaranteed #1 Google rank."
                  />
                </FieldRow>
              </div>

              <div className="mt-5 flex items-center gap-3">
                <Button type="submit" disabled={savingKb} className="bg-blue-600 hover:bg-blue-700 text-white text-xs">
                  {savingKb ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                  Save Knowledge Base
                </Button>
                {kbSaved && <span className="text-xs font-semibold text-emerald-600">✓ Knowledge Base Saved</span>}
              </div>
            </SectionCard>
          </form>
        </TabsContent>

        {/* ── TAB 4: AI & Integrations ── */}
        <TabsContent value="ai" className="space-y-6">
          {/* AI Providers */}
          <form onSubmit={handleSaveGlobal}>
            <SectionCard
              icon={Bot}
              title="AI Providers & Daily Safety Limits"
              description="Choose which model writes, hold the keys server-side, and bound daily execution. OpenAI remains supported as a server-side fallback but is no longer configured here."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <FieldRow label="Active AI Provider">
                  <Select
                    value={settings.aiProvider}
                    onValueChange={(v: "anthropic" | "qwen") =>
                      setSettings((s) => ({ ...s, aiProvider: v }))
                    }
                  >
                    <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="qwen">Qwen — Qwen3.8-Flash ($0.16 / $0.47 per M)</SelectItem>
                      <SelectItem value="anthropic">Anthropic — Claude Haiku 4.5 ($1 / $5 per M)</SelectItem>
                    </SelectContent>
                  </Select>
                </FieldRow>
                <FieldRow label="Daily AI Research Limit">
                  <Input
                    type="number"
                    value={settings.dailyAiResearchLimit}
                    onChange={(e) => setSettings((s) => ({ ...s, dailyAiResearchLimit: Number(e.target.value) }))}
                    className="text-xs"
                  />
                </FieldRow>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <ApiKeyField
                  id="anthropicApiKey"
                  label="Anthropic API key"
                  value={anthropicApiKey}
                  onChange={setAnthropicApiKey}
                  placeholder="sk-ant-..."
                  configured={Boolean(settings.anthropicApiKeyConfigured)}
                  onClear={() => void clearAiProviderSecret("anthropic")}
                />
                <ApiKeyField
                  id="qwenApiKey"
                  label="Qwen (Alibaba Model Studio) API key"
                  value={qwenApiKey}
                  onChange={setQwenApiKey}
                  placeholder="sk-..."
                  configured={Boolean(settings.qwenApiKeyConfigured)}
                  onClear={() => void clearAiProviderSecret("qwen")}
                />
                <FieldRow label="Qwen model">
                  <Input
                    value={settings.qwenModel ?? ""}
                    onChange={(e) => setSettings((s) => ({ ...s, qwenModel: e.target.value }))}
                    placeholder="qwen3.8-flash"
                    className="text-xs"
                  />
                </FieldRow>
              </div>

              {settings.aiProvider === "qwen" && (
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
                  Qwen costs roughly a sixth of Claude on input and a tenth on output. Whether it writes
                  your French as well has not been measured — run a few companies and read the drafts
                  before switching a live campaign to it.
                </p>
              )}

              <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
                <KeyRound className="size-3.5 shrink-0 text-emerald-600" />
                API keys and integration secrets are isolated server-side. Browser clients cannot read plaintext credentials.
              </div>

              <div className="mt-5 flex items-center gap-3">
                <Button type="submit" disabled={savingGlobal} className="bg-blue-600 hover:bg-blue-700 text-white text-xs">
                  {savingGlobal ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                  Save AI Settings
                </Button>
                {globalSaved && <span className="text-xs font-semibold text-emerald-600">✓ AI Settings Saved</span>}
              </div>
            </SectionCard>
          </form>

          {/* Third-party Integrations */}
          <form onSubmit={handleSaveIntegrations}>
            <SectionCard
              icon={Lock}
              title="Integrations & Enrichment Providers"
              description="Dropcontact, Instantly.ai, Google Search (Serper), PageSpeed Insights, and Outlook Calendar credentials."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <ApiKeyField
                  id="serperKey"
                  label="Serper.dev (Google Search)"
                  value={serperKey}
                  onChange={setSerperKey}
                  placeholder="your-serper-key"
                  configured={integrationStatus.serperConfigured}
                />
                <ApiKeyField
                  id="googleKey"
                  label="Google PageSpeed Insights"
                  value={googleKey}
                  onChange={setGoogleKey}
                  placeholder="AIza..."
                  configured={integrationStatus.googleConfigured}
                />
                <ApiKeyField
                  id="verifierKey"
                  label="Email verification (Bouncer)"
                  value={verifierKey}
                  onChange={setVerifierKey}
                  placeholder="optional — a free DNS check runs without it"
                  configured={integrationStatus.emailVerifierConfigured}
                />
                <ApiKeyField
                  id="pappersKey"
                  label="Pappers API"
                  value={pappersKey}
                  onChange={setPappersKey}
                  placeholder="pappers_..."
                  configured={integrationStatus.pappersConfigured}
                />
                <ApiKeyField
                  id="dropcontactKey"
                  label="Dropcontact"
                  value={dropcontactKey}
                  onChange={setDropcontactKey}
                  placeholder="dc_..."
                  configured={integrationStatus.dropcontactConfigured}
                />
                <ApiKeyField
                  id="instantlyKey"
                  label="Instantly.ai"
                  value={instantlyKey}
                  onChange={setInstantlyKey}
                  placeholder="inst_..."
                  configured={integrationStatus.instantlyConfigured}
                />
              </div>

              {/* Outlook / Microsoft Graph Calendar section */}
              <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Calendar className="size-4 text-slate-600" />
                  <span className="text-[13px] font-semibold text-slate-800">Outlook Calendar (Microsoft Graph)</span>
                  <span
                    className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      integrationStatus.outlookConfigured ? "bg-emerald-50 text-emerald-700" : "bg-slate-200 text-slate-500"
                    }`}
                  >
                    {integrationStatus.outlookConfigured ? "Connected" : "Not connected"}
                  </span>
                </div>
                <p className="mb-3 text-[11px] text-slate-500">
                  Configure Azure App Registration credentials for Outlook meeting sync.
                </p>
                <div className="grid gap-3 md:grid-cols-2">
                  <FieldRow label="Tenant ID">
                    <Input
                      value={msTenantId}
                      onChange={(e) => setMsTenantId(e.target.value)}
                      placeholder="xxxxxxxx-xxxx-..."
                      className="text-[13px]"
                    />
                  </FieldRow>
                  <FieldRow label="Client ID">
                    <Input
                      value={msClientId}
                      onChange={(e) => setMsClientId(e.target.value)}
                      placeholder="xxxxxxxx-xxxx-..."
                      className="text-[13px]"
                    />
                  </FieldRow>
                  <FieldRow label="Client Secret">
                    <Input
                      type="password"
                      value={msClientSecret}
                      onChange={(e) => setMsClientSecret(e.target.value)}
                      placeholder="Leave blank to keep current"
                      autoComplete="off"
                      className="text-[13px]"
                    />
                  </FieldRow>
                  <FieldRow label="Refresh Token">
                    <Input
                      type="password"
                      value={msRefreshToken}
                      onChange={(e) => setMsRefreshToken(e.target.value)}
                      placeholder="Leave blank to keep current"
                      autoComplete="off"
                      className="text-[13px]"
                    />
                  </FieldRow>
                </div>
              </div>

              <div className="mt-5 flex items-center gap-3">
                <Button type="submit" disabled={savingIntegrations} className="bg-blue-600 hover:bg-blue-700 text-white text-xs">
                  {savingIntegrations ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                  Save Integrations
                </Button>
                {integrationsSaved && <span className="text-xs font-semibold text-emerald-600">✓ Integrations Saved</span>}
              </div>
            </SectionCard>
          </form>

          {/* Test Mode & Safety Email Allowlist */}
          <SectionCard
            icon={ShieldCheck}
            title="🧪 SDR Test Mode & Safety Email Allowlist"
            description="Strict safety containment: guarantee that test outreach campaigns can NEVER contact people outside this explicit email allowlist."
          >
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3.5 border border-slate-200">
                <div>
                  <div className="text-xs font-bold text-slate-900 flex items-center gap-2">
                    <span>Verrou de Sécurité Test Mode</span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        settings.testModeEnabled
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-slate-200 text-slate-600"
                      )}
                    >
                      {settings.testModeEnabled ? "Actif (Containment ON)" : "Désactivé (Production)"}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Lorsque ce verrou est actif, tout envoi vers une adresse non listée est rejeté à 100%.
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleToggleTestMode()}
                    disabled={savingAllowlist}
                    className="text-xs font-semibold cursor-pointer"
                  >
                    {settings.testModeEnabled ? "Désactiver Test Mode" : "Activer Test Mode"}
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setDemoModalOpen(true)}
                    className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Zap className="size-3.5 fill-current" />
                    Lancer Démo SDR 1-Clic
                  </Button>
                </div>
              </div>

              {/* Add email to allowlist */}
              <div>
                <Label className="text-xs font-semibold text-slate-700 block mb-1.5">
                  Ajouter une adresse email de test autorisée :
                </Label>
                <div className="flex items-center gap-2 max-w-md">
                  <Input
                    type="email"
                    placeholder="ex: votre.adresse@domaine.fr"
                    value={newAllowlistEmail}
                    onChange={(e) => setNewAllowlistEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleAddAllowlistEmail();
                      }
                    }}
                    disabled={savingAllowlist}
                    className="text-xs"
                  />
                  <Button
                    type="button"
                    onClick={() => void handleAddAllowlistEmail()}
                    disabled={savingAllowlist || !newAllowlistEmail.trim()}
                    className="bg-slate-900 text-white text-xs hover:bg-slate-800 shrink-0"
                  >
                    <Plus className="size-3.5" />
                    Ajouter
                  </Button>
                </div>
              </div>

              {/* Current allowlist */}
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                  Adresses autorisées dans le bac à sable ({(settings.testEmailAllowlist || []).length}) :
                </div>
                {(settings.testEmailAllowlist || []).length === 0 ? (
                  <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-400 border border-slate-200 italic">
                    Aucune adresse email configurée. Ajoutez votre propre adresse ci-dessus pour recevoir des emails de test réels.
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {(settings.testEmailAllowlist || []).map((email) => (
                      <div
                        key={email}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 border border-blue-200 px-2.5 py-1 text-xs font-mono text-blue-900"
                      >
                        <span>{email}</span>
                        <button
                          type="button"
                          onClick={() => void handleRemoveAllowlistEmail(email)}
                          disabled={savingAllowlist}
                          className="text-blue-500 hover:text-red-600 transition-colors p-0.5 rounded cursor-pointer"
                          title="Retirer de l'allowlist"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </SectionCard>
        </TabsContent>

        {/* ── TAB 5: Reliability & Costs ── */}
        <TabsContent value="reliability" className="space-y-6">
          {/* Top Section: Real-time Queue Health KPIs & Worker Controls */}
          <SectionCard
            icon={Cpu}
            title="Task Queue Health & Distributed Workers (REQ-080)"
            description="Monitor asynchronous task queue state, concurrency, retry queues, and dead-letter exceptions."
          >
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Live Status:</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                  <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                  Queue Worker Operational
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void fetchQueueHealth()}
                  disabled={loadingQueue}
                  className="text-xs flex items-center gap-1.5"
                >
                  <RefreshCw className={`size-3.5 ${loadingQueue ? "animate-spin" : ""}`} />
                  <span>Refresh Health</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleTriggerQueue()}
                  disabled={processingQueue}
                  className="text-xs flex items-center gap-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-200"
                >
                  {processingQueue ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5 text-blue-600" />}
                  <span>Run Worker Batch</span>
                </Button>
                {((queueHealth?.deadLetter || 0) > 0 || (queueHealth?.failed || 0) > 0) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleRetryJobs()}
                    disabled={retryingJobs}
                    className="text-xs flex items-center gap-1.5 bg-amber-50 text-amber-800 hover:bg-amber-100 border-amber-300"
                  >
                    {retryingJobs ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5 text-amber-600" />}
                    <span>Retry Failed Tasks ({((queueHealth?.deadLetter || 0) + (queueHealth?.failed || 0))})</span>
                  </Button>
                )}
              </div>
            </div>

            {/* Metric Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
                  <span>Pending Tasks</span>
                  <Clock className="size-3.5 text-amber-500" />
                </div>
                <div className="text-xl font-bold text-slate-800 mt-1">
                  {queueHealth?.pending ?? 0}
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5">Awaiting worker pickup</p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
                  <span>Running Tasks</span>
                  <Cpu className="size-3.5 text-blue-500" />
                </div>
                <div className="text-xl font-bold text-blue-700 mt-1">
                  {queueHealth?.running ?? 0}
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5">Actively executing</p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
                  <span>Completed Tasks</span>
                  <CheckCircle2 className="size-3.5 text-emerald-500" />
                </div>
                <div className="text-xl font-bold text-emerald-700 mt-1">
                  {queueHealth?.completed ?? 0}
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5">Succeeded</p>
              </div>

              <div className={`rounded-lg border p-3 ${
                (queueHealth?.deadLetter || 0) > 0 ? "border-red-200 bg-red-50/60" : "border-slate-200 bg-slate-50/70"
              }`}>
                <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                  <span>Dead Letters</span>
                  <AlertTriangle className={`size-3.5 ${(queueHealth?.deadLetter || 0) > 0 ? "text-red-500" : "text-slate-400"}`} />
                </div>
                <div className={`text-xl font-bold mt-1 ${(queueHealth?.deadLetter || 0) > 0 ? "text-red-700" : "text-slate-700"}`}>
                  {queueHealth?.deadLetter ?? 0}
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5">Exhausted retries (max 3)</p>
              </div>
            </div>
          </SectionCard>

          {/* Cost Tracking & Guardrails (REQ-024) */}
          <form onSubmit={handleSaveBudget}>
            <SectionCard
              icon={Coins}
              title="API Spend Tracking & Budget Guardrails (REQ-024)"
              description="Centralized daily and monthly budget caps across AI inference, registry discovery, and enrichment APIs."
            >
              <div className="grid gap-4 md:grid-cols-2">
                {/* Today's Spend Gauge */}
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700">Today's API Spend</span>
                    <span className="text-xs font-bold font-mono text-slate-900">
                      ${(queueHealth?.todaySpendUsd || 0).toFixed(2)} / ${(queueHealth?.dailyBudgetCapUsd || dailyBudgetInput || 25).toFixed(2)}
                    </span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        ((queueHealth?.todaySpendUsd || 0) / (queueHealth?.dailyBudgetCapUsd || 25)) >= 0.9
                          ? "bg-red-500"
                          : ((queueHealth?.todaySpendUsd || 0) / (queueHealth?.dailyBudgetCapUsd || 25)) >= 0.7
                          ? "bg-amber-500"
                          : "bg-emerald-500"
                      }`}
                      style={{
                        width: `${Math.min(100, Math.round(((queueHealth?.todaySpendUsd || 0) / (queueHealth?.dailyBudgetCapUsd || 25)) * 100))}%`
                      }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {queueHealth?.budgetExceeded ? (
                      <span className="text-red-600 font-semibold flex items-center gap-1">
                        <AlertTriangle className="size-3" /> Budget cap reached — discovery tasks paused.
                      </span>
                    ) : (
                      `Remaining today: $${Math.max(0, (queueHealth?.dailyBudgetCapUsd || 25) - (queueHealth?.todaySpendUsd || 0)).toFixed(2)}`
                    )}
                  </p>
                </div>

                {/* Month's Spend Gauge */}
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700">Month-to-Date Spend</span>
                    <span className="text-xs font-bold font-mono text-slate-900">
                      ${(queueHealth?.monthSpendUsd || 0).toFixed(2)} / ${(queueHealth?.monthlyBudgetCapUsd || monthlyBudgetInput || 250).toFixed(2)}
                    </span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        ((queueHealth?.monthSpendUsd || 0) / (queueHealth?.monthlyBudgetCapUsd || 250)) >= 0.9
                          ? "bg-red-500"
                          : ((queueHealth?.monthSpendUsd || 0) / (queueHealth?.monthlyBudgetCapUsd || 250)) >= 0.7
                          ? "bg-amber-500"
                          : "bg-blue-500"
                      }`}
                      style={{
                        width: `${Math.min(100, Math.round(((queueHealth?.monthSpendUsd || 0) / (queueHealth?.monthlyBudgetCapUsd || 250)) * 100))}%`
                      }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Current billing cycle spend tracked across all active campaigns.
                  </p>
                </div>
              </div>

              {/* Budget Caps Form */}
              <div className="grid gap-4 md:grid-cols-2 mt-4">
                <FieldRow label="Daily Spend Budget Cap (USD)" hint="Maximum allowed API expenditure per day before pausing tasks.">
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-xs font-semibold text-slate-400">$</span>
                    <Input
                      type="number"
                      step="1"
                      min="1"
                      value={dailyBudgetInput}
                      onChange={(e) => setDailyBudgetInput(Number(e.target.value))}
                      className="pl-7 text-xs font-mono"
                    />
                  </div>
                </FieldRow>
                <FieldRow label="Monthly Spend Budget Cap (USD)" hint="Maximum cumulative monthly safety limit.">
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-xs font-semibold text-slate-400">$</span>
                    <Input
                      type="number"
                      step="5"
                      min="5"
                      value={monthlyBudgetInput}
                      onChange={(e) => setMonthlyBudgetInput(Number(e.target.value))}
                      className="pl-7 text-xs font-mono"
                    />
                  </div>
                </FieldRow>
              </div>

              <div className="mt-5 flex items-center gap-3">
                <Button type="submit" disabled={savingBudget} className="bg-blue-600 hover:bg-blue-700 text-white text-xs">
                  {savingBudget ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                  Save Budget Caps
                </Button>
                {budgetSaved && <span className="text-xs font-semibold text-emerald-600">✓ Budget Caps Saved</span>}
              </div>
            </SectionCard>
          </form>

          {/* Recent Job Queue Activity */}
          <SectionCard
            icon={Activity}
            title="Recent Task Queue Activity (REQ-080)"
            description="Real-time execution log of background worker jobs, retries, and task payloads."
          >
            {queueHealth?.recentJobs && queueHealth.recentJobs.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      <th className="py-2.5 px-3">Task Type</th>
                      <th className="py-2.5 px-3">Payload / Target</th>
                      <th className="py-2.5 px-3">Attempts</th>
                      <th className="py-2.5 px-3">Cost ($)</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {queueHealth.recentJobs.map((job) => (
                      <tr key={job.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-2.5 px-3 font-mono font-semibold text-slate-800">
                          {job.taskType}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600 font-mono text-[11px]">
                          {String(job.payload?.companyId || job.payload?.campaignId || job.payload?.outreachId || job.id).slice(0, 20)}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`inline-flex items-center gap-1 font-mono text-[11px] ${
                            job.attemptCount > 1 ? "text-amber-600 font-bold" : "text-slate-600"
                          }`}>
                            {job.attemptCount} / {job.maxRetries}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-600">
                          ${(job.costUsd || 0).toFixed(4)}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            job.status === "completed"
                              ? "bg-emerald-50 text-emerald-700"
                              : job.status === "running"
                              ? "bg-blue-50 text-blue-700 animate-pulse"
                              : job.status === "pending"
                              ? "bg-amber-50 text-amber-700"
                              : "bg-red-50 text-red-700"
                          }`}>
                            {job.status === "completed" && <CheckCircle2 className="size-3 text-emerald-600" />}
                            {job.status === "running" && <Loader2 className="size-3 animate-spin text-blue-600" />}
                            {job.status === "pending" && <Clock className="size-3 text-amber-600" />}
                            {(job.status === "dead_letter" || job.status === "failed") && <AlertTriangle className="size-3 text-red-600" />}
                            {job.status.toUpperCase()}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          {(job.status === "dead_letter" || job.status === "failed") && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => void handleRetryJobs([job.id])}
                              className="text-xs text-blue-600 hover:text-blue-800 p-0 h-auto"
                            >
                              Retry
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-slate-400">
                No task queue jobs recorded yet.
              </div>
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>

      {/* Offer Create / Edit Modal */}
      <Dialog open={offerModalOpen} onOpenChange={setOfferModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <form onSubmit={handleSaveOffer}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <Tag className="size-4 text-blue-600" />
                {editingOfferId ? "Edit Offer" : "Create New Offer"}
              </DialogTitle>
              <DialogDescription className="text-xs">
                Define the service package, target decision-maker personas, proof points, and pricing guardrails.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 py-4">
              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold text-slate-700">Offer Name *</Label>
                <Input
                  value={offerName}
                  onChange={(e) => setOfferName(e.target.value)}
                  placeholder="e.g. Website Modernization & E-Commerce"
                  required
                  className="text-xs"
                />
              </div>

              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold text-slate-700">Description</Label>
                <Textarea
                  value={offerDesc}
                  onChange={(e) => setOfferDesc(e.target.value)}
                  placeholder="Comprehensive website overhaul for local artisans..."
                  className="min-h-16 text-xs"
                />
              </div>

              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold text-slate-700">Target Personas (One per line)</Label>
                <Textarea
                  value={offerPersonas}
                  onChange={(e) => setOfferPersonas(e.target.value)}
                  placeholder="Dirigeant / Gérant (gérant, fondateur, patron)"
                  className="min-h-16 font-mono text-xs"
                />
              </div>

              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold text-slate-700">Value Propositions (One per line)</Label>
                <Textarea
                  value={offerValueProps}
                  onChange={(e) => setOfferValueProps(e.target.value)}
                  placeholder="Un site pensé pour votre métier, rapide sur mobile"
                  className="min-h-14 text-xs"
                />
              </div>

              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold text-slate-700">Proof Points (One per line — only what you can prove)</Label>
                <Textarea
                  value={offerProofPoints}
                  onChange={(e) => setOfferProofPoints(e.target.value)}
                  placeholder="20 sites clients en ligne"
                  className="min-h-14 text-xs"
                />
              </div>

              <OfferPricingFields value={offerPricing} onChange={setOfferPricing} />

              <div className="grid gap-1.5">
                <Label className="text-xs font-semibold text-slate-700">Prohibited Promises (One per line)</Label>
                <Textarea
                  value={offerProhibited}
                  onChange={(e) => setOfferProhibited(e.target.value)}
                  placeholder="garantie d'être premier sur Google"
                  className="min-h-14 text-xs"
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOfferModalOpen(false)} className="text-xs">
                Cancel
              </Button>
              <Button type="submit" disabled={savingOffer || !offerName.trim() || pricingFormErrors(offerPricing).length > 0} className="bg-blue-600 text-white hover:bg-blue-700 text-xs">
                {savingOffer ? "Saving..." : editingOfferId ? "Update Offer" : "Create Offer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* One-Click SDR Demo Modal */}
      <SdrDemoModal open={demoModalOpen} onOpenChange={setDemoModalOpen} />
    </>
  );
}
