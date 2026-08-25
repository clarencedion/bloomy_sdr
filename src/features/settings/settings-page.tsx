"use client";

import React, { useEffect, useState } from "react";
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
} from "lucide-react";
import type { GlobalSettings, OfferDoc } from "@/types/firestore";
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
} from "@/lib/firebase/firestore";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const defaults: GlobalSettings = {
  automationPaused: true,
  aiProvider: "openai",
  openAiModel: "gpt-4o-mini",
  anthropicModel: "claude-3-5-haiku-20241022",
  openAiApiKeyConfigured: false,
  anthropicApiKeyConfigured: false,
  dailyAiResearchLimit: 25,
  dailyEmailGenerationLimit: 50,
  dailyOutreachSendLimit: 20,
  requireApprovalBeforeExport: true,
  defaultLanguage: "fr",
  companyContext: "Devcomm is a French B2B training and consulting company helping clients improve commercial performance.",
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
  const [openAiApiKey, setOpenAiApiKey] = useState("");
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [globalSaved, setGlobalSaved] = useState(false);

  // Business Profile Form
  const [bizName, setBizName] = useState("");
  const [bizTagline, setBizTagline] = useState("");
  const [bizWebsite, setBizWebsite] = useState("");
  const [bizColor, setBizColor] = useState("#2563eb");
  const [bizLanguage, setBizLanguage] = useState<"fr" | "en">("fr");
  const [savingBiz, setSavingBiz] = useState(false);
  const [bizSaved, setBizSaved] = useState(false);

  // Offer Modal Form
  const [offerModalOpen, setOfferModalOpen] = useState(false);
  const [editingOfferId, setEditingOfferId] = useState<string | null>(null);
  const [offerName, setOfferName] = useState("");
  const [offerDesc, setOfferDesc] = useState("");
  const [offerPersonas, setOfferPersonas] = useState("Dirigeant / Gérant (gérant, fondateur, patron)\nResponsable Commercial (directeur commercial)");
  const [offerValueProps, setOfferValueProps] = useState("Fast turnaround\nMeasurable ROI\nHigh conversion");
  const [offerProofPoints, setOfferProofPoints] = useState("+40% sales velocity\nOver 30 clients delivered");
  const [offerStartingPrice, setOfferStartingPrice] = useState<number>(1490);
  const [offerProhibited, setOfferProhibited] = useState("guaranteed revenue doubling\nfree unlimited service");
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
  const [msTenantId, setMsTenantId] = useState("");
  const [msClientId, setMsClientId] = useState("");
  const [msClientSecret, setMsClientSecret] = useState("");
  const [msRefreshToken, setMsRefreshToken] = useState("");
  const [integrationStatus, setIntegrationStatus] = useState({
    dropcontactConfigured: false,
    instantlyConfigured: false,
    pappersConfigured: false,
    serperConfigured: false,
    outlookConfigured: false,
  });
  const [savingIntegrations, setSavingIntegrations] = useState(false);
  const [integrationsSaved, setIntegrationsSaved] = useState(false);

  useEffect(() => {
    if (currentBusiness) {
      setBizName(currentBusiness.name || "");
      setBizTagline(currentBusiness.branding?.tagline || "");
      setBizWebsite(currentBusiness.website || "");
      setBizColor(currentBusiness.branding?.primaryColor || "#2563eb");
      setBizLanguage(currentBusiness.defaultLanguage || "fr");
    }
  }, [currentBusiness]);

  useEffect(() => {
    if (knowledgeBase) {
      setKbServices(knowledgeBase.services?.map((s) => `${s.name}: ${s.description} (Ideal for: ${s.idealFor || "SMEs"})`).join("\n") || "");
      setKbCaseStudies(knowledgeBase.caseStudies?.map((c) => `${c.title} (${c.clientIndustry}) -> ${c.metric}: ${c.description}`).join("\n") || "");
      setKbPricingRules(knowledgeBase.pricingRules?.join("\n") || "");
      setKbFaqs(knowledgeBase.faqs?.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join("\n\n") || "");
      setKbProhibited(knowledgeBase.prohibitedPromises?.join("\n") || "");
    }
  }, [knowledgeBase]);

  useEffect(() => {
    void Promise.all([getGlobalSettings(), getIntegrationSecretsStatus()]).then(([result, intStatus]) => {
      if (result) setSettings({ ...defaults, ...result });
      setIntegrationStatus(intStatus);
    });
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
      setOfferStartingPrice(offer.pricingGuardrails?.startingPrice || 1490);
      setOfferProhibited(offer.prohibitedPromises?.join("\n") || "");
    } else {
      setEditingOfferId(null);
      setOfferName("");
      setOfferDesc("");
      setOfferPersonas("Dirigeant / Gérant (gérant, fondateur, patron)");
      setOfferValueProps("High conversion\nModern architecture");
      setOfferProofPoints("95+ PageSpeed\nProven results");
      setOfferStartingPrice(1490);
      setOfferProhibited("guaranteed 10x ROI");
    }
    setOfferModalOpen(true);
  };

  const handleSaveOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!offerName.trim() || !currentBusinessId) return;
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
        valuePropositions: offerValueProps.split("\n").map((s) => s.trim()).filter(Boolean),
        proofPoints: offerProofPoints.split("\n").map((s) => s.trim()).filter(Boolean),
        pricingGuardrails: {
          startingPrice: offerStartingPrice,
          currency: "EUR",
          pricingModel: "fixed",
          canDiscloseInColdReply: true,
        },
        prohibitedPromises: offerProhibited.split("\n").map((s) => s.trim()).filter(Boolean),
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
      const services = kbServices
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const parts = line.split(":");
          return {
            name: parts[0]?.trim() || "Service",
            description: parts[1]?.trim() || line,
          };
        });

      const caseStudies = kbCaseStudies
        .split("\n")
        .filter(Boolean)
        .map((line) => ({
          title: line.split("->")[0]?.trim() || "Case Study",
          clientIndustry: "B2B",
          metric: "+40%",
          description: line,
        }));

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
      if (openAiApiKey.trim() || anthropicApiKey.trim()) {
        const status = await saveAiProviderSecrets({
          openAiApiKey: openAiApiKey.trim() || undefined,
          anthropicApiKey: anthropicApiKey.trim() || undefined,
        });
        setSettings((s) => ({
          ...s,
          openAiApiKeyConfigured: status.openAiConfigured,
          anthropicApiKeyConfigured: status.anthropicConfigured,
        }));
        setOpenAiApiKey("");
        setAnthropicApiKey("");
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
        microsoftTenantId: msTenantId.trim() || undefined,
        microsoftClientId: msClientId.trim() || undefined,
        microsoftClientSecret: msClientSecret.trim() || undefined,
        microsoftRefreshToken: msRefreshToken.trim() || undefined,
      });
      setIntegrationStatus(updated);
      setDropcontactKey("");
      setInstantlyKey("");
      setPappersKey("");
      setSerperKey("");
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
        title="Settings & Multi-Business Control"
        description="Manage business profiles, offers, knowledge bases, isolated senders, and AI provider configurations."
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4 space-y-6">
        <TabsList className="grid grid-cols-4 bg-slate-100 p-1 rounded-xl">
          <TabsTrigger value="business" className="flex items-center gap-1.5 text-xs font-semibold">
            <Building2 className="size-3.5" />
            <span>Business Profile</span>
          </TabsTrigger>
          <TabsTrigger value="offers" className="flex items-center gap-1.5 text-xs font-semibold">
            <Tag className="size-3.5" />
            <span>Offers ({offers.length})</span>
          </TabsTrigger>
          <TabsTrigger value="kb" className="flex items-center gap-1.5 text-xs font-semibold">
            <BookOpen className="size-3.5" />
            <span>Knowledge Base</span>
          </TabsTrigger>
          <TabsTrigger value="ai" className="flex items-center gap-1.5 text-xs font-semibold">
            <Sliders className="size-3.5" />
            <span>AI & Integrations</span>
          </TabsTrigger>
        </TabsList>

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
                <FieldRow label="Tagline / Mission" hint="Short summary used in AI context grounding.">
                  <Input value={bizTagline} onChange={(e) => setBizTagline(e.target.value)} className="text-xs" />
                </FieldRow>
                <FieldRow label="Website URL" hint="Official website of this business.">
                  <Input value={bizWebsite} onChange={(e) => setBizWebsite(e.target.value)} className="text-xs" />
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
                <FieldRow label="Services & Capabilities" hint="One per line in format: 'Service Name: Description (Ideal for)'">
                  <Textarea
                    value={kbServices}
                    onChange={(e) => setKbServices(e.target.value)}
                    className="min-h-24 font-mono text-xs"
                    placeholder="Showcase Website: Modern 5-10 page responsive site (Artisans)"
                  />
                </FieldRow>

                <FieldRow label="Case Studies & Proof Points" hint="One per line in format: 'Title (Industry) -> Metric: Summary'">
                  <Textarea
                    value={kbCaseStudies}
                    onChange={(e) => setKbCaseStudies(e.target.value)}
                    className="min-h-20 font-mono text-xs"
                    placeholder="Atelier Floral (Florist) -> PageSpeed 24 to 98: Modern responsive ordering"
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
              description="Configure OpenAI/Anthropic API keys and bounded daily execution limits."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <FieldRow label="Active AI Provider">
                  <Select value={settings.aiProvider} onValueChange={(v: "openai" | "anthropic") => setSettings((s) => ({ ...s, aiProvider: v }))}>
                    <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openai">OpenAI</SelectItem>
                      <SelectItem value="anthropic">Anthropic</SelectItem>
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
                  id="openAiApiKey"
                  label="OpenAI API key"
                  value={openAiApiKey}
                  onChange={setOpenAiApiKey}
                  placeholder="sk-..."
                  configured={Boolean(settings.openAiApiKeyConfigured)}
                  onClear={() => void clearAiProviderSecret("openai")}
                />
                <ApiKeyField
                  id="anthropicApiKey"
                  label="Anthropic API key"
                  value={anthropicApiKey}
                  onChange={setAnthropicApiKey}
                  placeholder="sk-ant-..."
                  configured={Boolean(settings.anthropicApiKeyConfigured)}
                  onClear={() => void clearAiProviderSecret("anthropic")}
                />
              </div>

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
              description="Dropcontact, Instantly.ai, Google Search (Serper), and Outlook Calendar credentials."
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

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Starting Price (€)</Label>
                  <Input
                    type="number"
                    value={offerStartingPrice}
                    onChange={(e) => setOfferStartingPrice(Number(e.target.value))}
                    className="text-xs"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Prohibited Promises</Label>
                  <Input
                    value={offerProhibited}
                    onChange={(e) => setOfferProhibited(e.target.value)}
                    placeholder="guaranteed 10x ROI"
                    className="text-xs"
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOfferModalOpen(false)} className="text-xs">
                Cancel
              </Button>
              <Button type="submit" disabled={savingOffer || !offerName.trim()} className="bg-blue-600 text-white hover:bg-blue-700 text-xs">
                {savingOffer ? "Saving..." : editingOfferId ? "Update Offer" : "Create Offer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
