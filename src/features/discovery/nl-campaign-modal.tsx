"use client";

import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import {
  Sparkles,
  Loader2,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Plus,
  X,
  Layers,
  ArrowUp,
  ArrowDown,
  Info
} from "lucide-react";
import { useBusiness } from "@/lib/context/business-context";
import { callTranslateIcpPrompt } from "@/lib/firebase/functions";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { collections, createLog } from "@/lib/firebase/firestore";
import type {
  DiscoveryCampaign,
  DiscoveryProviderName,
  DiscoverySegment,
  IcpTranslationResult,
  SignalProviderId
} from "@/types/firestore";

const EXAMPLE_PROMPTS = [
  "Trouver des fleuristes à Nantes sans site web ou avec un site ancien pour vendre des sites vitrines modernes",
  "Boulangeries artisanales à Lyon avec commande en ligne et click & collect",
  "PME industrielles en France (usinage, mécanique) de plus de 20 salariés pour formation et coaching commercial",
  "Entreprises de transport et logistique avec flotte de véhicules pour prévention du risque routier"
];

const ALL_DISCOVERY_PROVIDERS: Array<{ id: DiscoveryProviderName; label: string; desc: string }> = [
  { id: "recherche_entreprises", label: "Recherche d'Entreprises (Free)", desc: "Annuaire officiel des entreprises françaises (INSEE / data.gouv)" },
  { id: "google_places", label: "Google Places / Maps (Serper)", desc: "Commerces locaux, artisans, restaurants, avis et coordonnées Google" },
  { id: "sirene", label: "SIRENE (Base INSEE)", desc: "Validation légale, code NAF et établissements" },
  { id: "pappers", label: "Pappers B2B", desc: "Données financières et bilans enrichis" }
];

const ALL_SIGNAL_PROVIDERS: Array<{ id: SignalProviderId; label: string; desc: string; icon: string }> = [
  { id: "company_registry", label: "Universal Registry", desc: "SIREN, NAF, forme juridique, tranche effectif", icon: "🏛️" },
  { id: "google_places", label: "Google Places & Rating", desc: "Note, nombre d'avis, horaires, catégorie", icon: "📍" },
  { id: "website_presence", label: "Website & SSL Audit", desc: "Présence de site, résolution de domaine, SSL", icon: "🌐" },
  { id: "website_technical", label: "PageSpeed & CMS Audit", desc: "Score mobile, LCP, WordPress/Wix, copyright ancien", icon: "⚡" },
  { id: "website_ecommerce", label: "E-Commerce & Booking", desc: "Panier d'achat, commande en ligne, Calendly/Doctolib", icon: "🛍️" },
  { id: "company_scale", label: "Company Scale & Multi-Site", desc: "Nombre d'établissements, filiales, siège", icon: "🏢" },
  { id: "company_hiring", label: "Hiring & Job Postings", desc: "Offres d'emploi actives, recrutement commercial/tech", icon: "👥" },
  { id: "technology_stack", label: "Tech Stack & CRM", desc: "CRM détecté, outils marketing, scripts", icon: "💻" }
];

interface NlCampaignModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function NlCampaignModal({ open, onOpenChange, onCreated }: NlCampaignModalProps) {
  const { workspaceId, currentBusinessId, offers } = useBusiness();

  // Wizard state
  const [step, setStep] = useState<"prompt" | "review">("prompt");
  const [prompt, setPrompt] = useState("");
  const [selectedOfferId, setSelectedOfferId] = useState<string>("");
  const [translating, setTranslating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Review & Editable targeting state
  const [campaignName, setCampaignName] = useState("");
  const [segment, setSegment] = useState<DiscoverySegment>("custom");
  const [cities, setCities] = useState<string[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [nafCodes, setNafCodes] = useState<string[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [excludeKeywords, setExcludeKeywords] = useState<string[]>([]);
  const [minEmployeeCount, setMinEmployeeCount] = useState<number | undefined>(undefined);
  const [requireWebsite, setRequireWebsite] = useState(false);
  const [targetPersonas, setTargetPersonas] = useState<string[]>([]);
  const [providerPriority, setProviderPriority] = useState<DiscoveryProviderName[]>([
    "recherche_entreprises",
    "sirene",
    "google_places"
  ]);
  const [enabledSignals, setEnabledSignals] = useState<SignalProviderId[]>(["company_registry"]);
  const [reasoningSummary, setReasoningSummary] = useState("");

  // Input helpers for review tags
  const [cityInput, setCityInput] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [excludeKeywordInput, setExcludeKeywordInput] = useState("");
  const [nafInput, setNafInput] = useState("");

  // Set default offer on first open
  React.useEffect(() => {
    if (offers.length && !selectedOfferId) {
      setSelectedOfferId(offers[0].id);
    }
  }, [offers, selectedOfferId]);

  const handleTranslate = async () => {
    if (!prompt.trim() || prompt.trim().length < 3) {
      setError("Veuillez saisir une description d'au moins 3 caractères.");
      return;
    }
    setError(null);
    setTranslating(true);

    try {
      const result: IcpTranslationResult = await callTranslateIcpPrompt({
        prompt: prompt.trim(),
        offerId: selectedOfferId || undefined,
        workspaceId,
        businessId: currentBusinessId
      });

      // Populate review state with AI translation
      setCampaignName(result.campaignName || "Nouvelle Campagne Ciblée");
      setSegment(result.segment || "custom");
      setCities(result.cities || []);
      setDepartments(result.departments || []);
      setRegions(result.regions || []);
      setNafCodes(result.nafCodes || []);
      setKeywords(result.keywords || []);
      setExcludeKeywords(result.excludeKeywords || []);
      setMinEmployeeCount(result.minEmployeeCount);
      setRequireWebsite(Boolean(result.requireWebsite));
      setTargetPersonas(result.targetPersonas || []);
      setProviderPriority(
        result.providerPriority?.length
          ? result.providerPriority
          : ["recherche_entreprises", "sirene", "google_places"]
      );
      setEnabledSignals(
        result.researchStrategy?.enabledSignalProviders?.length
          ? result.researchStrategy.enabledSignalProviders
          : ["company_registry"]
      );
      setReasoningSummary(result.reasoningSummary || "");

      setStep("review");
    } catch (err: any) {
      setError(err?.message || "Échec de la traduction IA du ciblage.");
    } finally {
      setTranslating(false);
    }
  };

  const handleLaunchCampaign = async () => {
    if (!campaignName.trim()) {
      setError("Le nom de la campagne est requis.");
      return;
    }
    setSaving(true);
    setError(null);

    try {
      const campaignData: Omit<DiscoveryCampaign, "id"> = {
        workspaceId: workspaceId || "ws_default",
        businessId: currentBusinessId || "biz_devcomm",
        offerId: selectedOfferId || undefined,
        name: campaignName.trim(),
        naturalLanguagePrompt: prompt.trim(),
        status: "active",
        segment,
        cities,
        departments,
        regions,
        keywords,
        excludeKeywords,
        nafCodes,
        maxCompaniesPerRun: 15,
        minEmployeeCount: minEmployeeCount || undefined,
        requireWebsite,
        providerPriority,
        researchStrategy: {
          enabledSignalProviders: enabledSignals,
          relevanceExplanation: reasoningSummary,
          scoringWeights: {
            companyFitWeight: 0.3,
            needStrengthWeight: 0.4,
            commercialScaleWeight: 0.2,
            evidenceConfidenceWeight: 0.1
          }
        },
        autoQueueHighScoreCompanies: true,
        minDiscoveryScoreForSave: 100,
        minDiscoveryScoreForAutoResearch: 100,
        minQualityScoreForAutoResearch: 100,
        rechercheEntreprisesPageCursor: 1,
        rechercheEntreprisesExhausted: false,
        googlePlacesPageCursor: 1,
        googlePlacesExhausted: false,
        createdAt: serverTimestamp() as any,
        updatedAt: serverTimestamp() as any
      };

      const docRef = await addDoc(collection(db, collections.discoveryCampaigns), campaignData);

      await createLog({
        type: "discovery.campaign.created_from_nl",
        level: "info",
        message: `Campagne créée via IA : ${campaignName.trim()}`,
        metadata: {
          campaignId: docRef.id,
          prompt: prompt.trim(),
          offerId: selectedOfferId
        }
      });

      onCreated();
      onOpenChange(false);
      // Reset
      setStep("prompt");
      setPrompt("");
    } catch (err: any) {
      setError(err?.message || "Erreur lors de la création de la campagne.");
    } finally {
      setSaving(false);
    }
  };

  // Reordering helpers for Discovery providers
  const moveProviderUp = (index: number) => {
    if (index === 0) return;
    setProviderPriority((prev) => {
      const next = [...prev];
      const temp = next[index - 1];
      next[index - 1] = next[index];
      next[index] = temp;
      return next;
    });
  };

  const moveProviderDown = (index: number) => {
    if (index === providerPriority.length - 1) return;
    setProviderPriority((prev) => {
      const next = [...prev];
      const temp = next[index + 1];
      next[index + 1] = next[index];
      next[index] = temp;
      return next;
    });
  };

  const toggleSignal = (signalId: SignalProviderId) => {
    if (signalId === "company_registry") return; // Registry is universal & immutable
    setEnabledSignals((prev) =>
      prev.includes(signalId) ? prev.filter((s) => s !== signalId) : [...prev, signalId]
    );
  };

  const addTag = (
    list: string[],
    setList: React.Dispatch<React.SetStateAction<string[]>>,
    input: string,
    setInput: React.Dispatch<React.SetStateAction<string>>
  ) => {
    const val = input.trim();
    if (val && !list.includes(val)) {
      setList([...list, val]);
      setInput("");
    }
  };

  const removeTag = (
    list: string[],
    setList: React.Dispatch<React.SetStateAction<string[]>>,
    indexToRemove: number
  ) => {
    setList(list.filter((_, idx) => idx !== indexToRemove));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold text-slate-900">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
              <Sparkles className="size-5" />
            </span>
            AI Campaign Builder
          </DialogTitle>
          <DialogDescription className="text-slate-500">
            {step === "prompt"
              ? "Décrivez simplement ce que vous cherchez. L'IA traduit votre intention en critères NAF, filtres géographiques et stratégie de signaux."
              : "Vérifiez et affinez les paramètres générés par l'IA avant de lancer la prospection."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* STEP 1: PROMPT FORMULATION */}
        {step === "prompt" && (
          <div className="space-y-5 py-2">
            {/* Offer Selector */}
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold text-slate-700">Offre commerciale cible</Label>
              {offers.length > 0 ? (
                <Select value={selectedOfferId} onValueChange={setSelectedOfferId}>
                  <SelectTrigger className="w-full bg-white">
                    <SelectValue placeholder="Sélectionnez une offre..." />
                  </SelectTrigger>
                  <SelectContent>
                    {offers.map((off) => (
                      <SelectItem key={off.id} value={off.id}>
                        {off.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-xs text-amber-600">
                  Aucune offre enregistrée pour cette entité. L'IA utilisera un cadrage générique.
                </p>
              )}
            </div>

            {/* Prompt Textarea */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="nl-prompt" className="text-sm font-semibold text-slate-700">
                  Pour quoi voulez-vous obtenir des rendez-vous ?
                </Label>
                <span
                  className={`text-xs ${
                    prompt.length > 900 ? "text-amber-600 font-semibold" : "text-slate-400"
                  }`}
                >
                  {prompt.length} / 1000
                </span>
              </div>
              <Textarea
                id="nl-prompt"
                placeholder="Ex: Trouver des fleuristes ou boulangeries à Nantes et Rennes avec un site internet lent ou sans e-commerce..."
                className="min-h-[120px] text-sm leading-relaxed"
                value={prompt}
                maxLength={1000}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>

            {/* Inspiration Examples */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <Info className="size-3.5 text-indigo-500" />
                Exemples d&apos;intentions
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {EXAMPLE_PROMPTS.map((ex, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setPrompt(ex)}
                    className="text-left text-xs p-2.5 rounded-lg border border-slate-200 bg-slate-50/70 hover:bg-indigo-50/50 hover:border-indigo-200 text-slate-700 transition-colors leading-normal"
                  >
                    &ldquo;{ex}&rdquo;
                  </button>
                ))}
              </div>
            </div>

            {/* Action button */}
            <div className="flex justify-end pt-3 border-t">
              <Button
                type="button"
                onClick={handleTranslate}
                disabled={translating || !prompt.trim()}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium gap-2 px-5"
              >
                {translating ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Analyse de l&apos;intention et des signaux...
                  </>
                ) : (
                  <>
                    Générer la stratégie de prospection
                    <ArrowRight className="size-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* STEP 2: PRE-LAUNCH CAMPAIGN REVIEW & OVERRIDES */}
        {step === "review" && (
          <div className="space-y-6 py-2">
            {/* AI Reasoning Summary Banner */}
            {reasoningSummary && (
              <div className="flex items-start gap-3 rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50/80 to-blue-50/50 p-4">
                <Sparkles className="size-5 text-indigo-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-950">
                    Raisonnement & Stratégie IA
                  </h4>
                  <p className="text-xs text-indigo-900 leading-relaxed">{reasoningSummary}</p>
                </div>
              </div>
            )}

            {/* Campaign Name & Segment */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="camp-name" className="text-xs font-semibold text-slate-700">
                  Nom de la campagne
                </Label>
                <Input
                  id="camp-name"
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  className="bg-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Segment</Label>
                <Select value={segment} onValueChange={(val) => setSegment(val as DiscoverySegment)}>
                  <SelectTrigger className="bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="commercial_performance">Performance commerciale</SelectItem>
                    <SelectItem value="training_hr">Formation & RH</SelectItem>
                    <SelectItem value="road_safety">Flottes & Risque routier</SelectItem>
                    <SelectItem value="custom">Autre / Sur mesure</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Geography & NAF Codes */}
            <div className="grid gap-4 sm:grid-cols-2">
              {/* Cities */}
              <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                <Label className="text-xs font-semibold text-slate-700">Villes ciblées</Label>
                <div className="flex flex-wrap gap-1.5 min-h-[32px]">
                  {cities.map((city, idx) => (
                    <Badge
                      key={idx}
                      variant="secondary"
                      className="gap-1 bg-slate-100 text-slate-700 hover:bg-slate-200 text-xs py-0.5"
                    >
                      {city}
                      <X
                        className="size-3 cursor-pointer text-slate-400 hover:text-red-500"
                        onClick={() => removeTag(cities, setCities, idx)}
                      />
                    </Badge>
                  ))}
                  {cities.length === 0 && (
                    <span className="text-xs text-slate-400 italic">France entière</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="Ajouter une ville (ex: Nantes)"
                    value={cityInput}
                    onChange={(e) => setCityInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addTag(cities, setCities, cityInput, setCityInput);
                      }
                    }}
                    className="h-8 text-xs"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => addTag(cities, setCities, cityInput, setCityInput)}
                  >
                    <Plus className="size-3.5" />
                  </Button>
                </div>
              </div>

              {/* NAF Codes */}
              <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                <Label className="text-xs font-semibold text-slate-700">Codes NAF / APE</Label>
                <div className="flex flex-wrap gap-1.5 min-h-[32px]">
                  {nafCodes.map((naf, idx) => (
                    <Badge
                      key={idx}
                      variant="secondary"
                      className="gap-1 bg-indigo-50 text-indigo-700 border-indigo-200 text-xs py-0.5"
                    >
                      {naf}
                      <X
                        className="size-3 cursor-pointer text-indigo-400 hover:text-red-500"
                        onClick={() => removeTag(nafCodes, setNafCodes, idx)}
                      />
                    </Badge>
                  ))}
                  {nafCodes.length === 0 && (
                    <span className="text-xs text-slate-400 italic">Tous codes NAF</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="Code NAF (ex: 47.76Z)"
                    value={nafInput}
                    onChange={(e) => setNafInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addTag(nafCodes, setNafCodes, nafInput, setNafInput);
                      }
                    }}
                    className="h-8 text-xs"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => addTag(nafCodes, setNafCodes, nafInput, setNafInput)}
                  >
                    <Plus className="size-3.5" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Keywords & Negative Keywords */}
            <div className="grid gap-4 sm:grid-cols-2">
              {/* Keywords */}
              <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                <Label className="text-xs font-semibold text-slate-700">Mots-clés obligatoires</Label>
                <div className="flex flex-wrap gap-1.5 min-h-[32px]">
                  {keywords.map((kw, idx) => (
                    <Badge
                      key={idx}
                      variant="secondary"
                      className="gap-1 bg-emerald-50 text-emerald-700 border-emerald-200 text-xs py-0.5"
                    >
                      {kw}
                      <X
                        className="size-3 cursor-pointer text-emerald-400 hover:text-red-500"
                        onClick={() => removeTag(keywords, setKeywords, idx)}
                      />
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="Ajouter mot-clé (ex: fleuriste)"
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addTag(keywords, setKeywords, keywordInput, setKeywordInput);
                      }
                    }}
                    className="h-8 text-xs"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => addTag(keywords, setKeywords, keywordInput, setKeywordInput)}
                  >
                    <Plus className="size-3.5" />
                  </Button>
                </div>
              </div>

              {/* Negative Keywords */}
              <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                <Label className="text-xs font-semibold text-slate-700">Mots-clés exclus (Filtre négatif)</Label>
                <div className="flex flex-wrap gap-1.5 min-h-[32px]">
                  {excludeKeywords.map((kw, idx) => (
                    <Badge
                      key={idx}
                      variant="secondary"
                      className="gap-1 bg-red-50 text-red-700 border-red-200 text-xs py-0.5"
                    >
                      {kw}
                      <X
                        className="size-3 cursor-pointer text-red-400 hover:text-red-600"
                        onClick={() => removeTag(excludeKeywords, setExcludeKeywords, idx)}
                      />
                    </Badge>
                  ))}
                  {excludeKeywords.length === 0 && (
                    <span className="text-xs text-slate-400 italic">Aucune exclusion</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="Exclure mot-clé (ex: grossiste)"
                    value={excludeKeywordInput}
                    onChange={(e) => setExcludeKeywordInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addTag(excludeKeywords, setExcludeKeywords, excludeKeywordInput, setExcludeKeywordInput);
                      }
                    }}
                    className="h-8 text-xs"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => addTag(excludeKeywords, setExcludeKeywords, excludeKeywordInput, setExcludeKeywordInput)}
                  >
                    <Plus className="size-3.5" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Target Personas */}
            {targetPersonas.length > 0 && (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                <Label className="text-xs font-semibold text-slate-700">Personas décisionnaires ciblés</Label>
                <div className="flex flex-wrap gap-1.5">
                  {targetPersonas.map((persona, idx) => (
                    <Badge
                      key={idx}
                      variant="outline"
                      className="gap-1 bg-slate-50 text-slate-700 border-slate-300 text-xs py-0.5"
                    >
                      {persona}
                      <X
                        className="size-3 cursor-pointer text-slate-400 hover:text-red-500"
                        onClick={() => removeTag(targetPersonas, setTargetPersonas, idx)}
                      />
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Dynamic Signal Providers Selection */}
            <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers className="size-4 text-indigo-600" />
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    Modules de Signaux & Audits Activés
                  </Label>
                </div>
                <span className="text-xs text-slate-500">
                  {enabledSignals.length} module{enabledSignals.length > 1 ? "s" : ""} sélectionné{enabledSignals.length > 1 ? "s" : ""}
                </span>
              </div>
              <p className="text-xs text-slate-500 leading-normal">
                Les modules activés collectent des preuves vérifiables lors de la qualification de chaque prospect.
              </p>
              <div className="grid gap-2 sm:grid-cols-2 mt-2">
                {ALL_SIGNAL_PROVIDERS.map((sig) => {
                  const isEnabled = enabledSignals.includes(sig.id);
                  const isUniversal = sig.id === "company_registry";
                  return (
                    <div
                      key={sig.id}
                      onClick={() => !isUniversal && toggleSignal(sig.id)}
                      className={`flex items-start gap-2.5 p-2.5 rounded-lg border text-xs transition-all ${
                        isEnabled
                          ? "bg-white border-indigo-500 shadow-xs ring-1 ring-indigo-500/20"
                          : "bg-white/60 border-slate-200 opacity-65 hover:opacity-100"
                      } ${isUniversal ? "cursor-default" : "cursor-pointer"}`}
                    >
                      <span className="text-base leading-none">{sig.icon}</span>
                      <div className="space-y-0.5 flex-1">
                        <div className="flex items-center justify-between font-semibold text-slate-800">
                          <span>{sig.label}</span>
                          {isEnabled && (
                            <CheckCircle2 className="size-3.5 text-indigo-600" />
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 leading-tight">{sig.desc}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Discovery Providers Priority */}
            <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Ordre de priorité des sources de découverte
              </Label>
              <div className="space-y-1.5 mt-2">
                {providerPriority.map((provId, index) => {
                  const provMeta = ALL_DISCOVERY_PROVIDERS.find((p) => p.id === provId);
                  if (!provMeta) return null;
                  return (
                    <div
                      key={provId}
                      className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-400 w-4">{index + 1}.</span>
                        <span className="font-semibold text-slate-800">{provMeta.label}</span>
                        <span className="text-[11px] text-slate-400 hidden sm:inline">— {provMeta.desc}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-6 text-slate-500 hover:text-indigo-600"
                          disabled={index === 0}
                          onClick={() => moveProviderUp(index)}
                        >
                          <ArrowUp className="size-3" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-6 text-slate-500 hover:text-indigo-600"
                          disabled={index === providerPriority.length - 1}
                          onClick={() => moveProviderDown(index)}
                        >
                          <ArrowDown className="size-3" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Navigation & Launch */}
            <div className="flex items-center justify-between pt-4 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep("prompt")}
                className="text-xs gap-1.5"
              >
                <ArrowLeft className="size-3.5" />
                Modifier l&apos;intention
              </Button>
              <Button
                type="button"
                onClick={handleLaunchCampaign}
                disabled={saving || !campaignName.trim()}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs gap-2 px-5"
              >
                {saving ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Création en cours...
                  </>
                ) : (
                  <>
                    <Sparkles className="size-3.5" />
                    Créer & Activer la Campagne
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
