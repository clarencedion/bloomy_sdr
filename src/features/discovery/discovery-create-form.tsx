import { useRef, useState } from "react";
import { addDoc, collection, serverTimestamp, doc, updateDoc } from "firebase/firestore";
import { Loader2, Plus, ArrowUp, ArrowDown, Layers } from "lucide-react";
import type { DiscoveryProviderName, DiscoverySegment, DiscoveryCampaign, SignalProviderId } from "@/types/firestore";

import { db } from "@/lib/firebase/client";
import { collections, createLog } from "@/lib/firebase/firestore";
import { useBusiness } from "@/lib/context/business-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

function splitList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const ALL_PROVIDERS = [
  { id: "recherche_entreprises" as const, label: "Recherche d'Entreprises (Free)", desc: "Government Registry. Free lookup of French companies." },
  { id: "sirene" as const, label: "SIRENE (Official DB - Free)", desc: "Validate and search against official government database." },
  { id: "google_places" as const, label: "Google Places / Maps (via Serper)", desc: "Requires Serper.dev key. Excellent for finding local shops like florists, bakeries, etc." },
  { id: "pappers" as const, label: "Pappers B2B (Premium)", desc: "Requires Pappers API key. Custom B2B database lookups." }
];

const ALL_SIGNALS: Array<{ id: SignalProviderId; label: string; desc: string }> = [
  { id: "company_registry", label: "Registry (Universal)", desc: "SIREN, NAF, employee tranche" },
  { id: "google_places", label: "Google Places", desc: "Rating, review count, opening hours" },
  { id: "website_presence", label: "Website Presence", desc: "Domain resolution, HTTPS validity" },
  { id: "website_technical", label: "Technical & PageSpeed", desc: "PageSpeed 0-100, Core Web Vitals, CMS" },
  { id: "website_ecommerce", label: "E-Commerce & Booking", desc: "Online ordering, checkout cart, widgets" },
  { id: "company_scale", label: "Company Scale", desc: "Multi-site branches, headquarters" },
  { id: "company_hiring", label: "Hiring & Jobs", desc: "Active sales/tech job postings" },
  { id: "technology_stack", label: "Tech Stack", desc: "CRM, analytics, scripts" }
];

export function DiscoveryCreateForm({
  onCreated,
  campaign,
  onCancel
}: {
  onCreated: () => void;
  campaign?: DiscoveryCampaign;
  onCancel?: () => void;
}) {
  const { workspaceId, currentBusinessId, offers } = useBusiness();
  const formRef = useRef<HTMLFormElement>(null);
  const [saving, setSaving] = useState(false);
  const [selectedOfferId, setSelectedOfferId] = useState<string>(
    campaign?.offerId ?? (offers.length ? offers[0].id : "")
  );
  const [segment, setSegment] = useState<DiscoverySegment>(campaign?.segment ?? "custom");
  const [requireWebsite, setRequireWebsite] = useState(campaign ? (campaign.requireWebsite ? "yes" : "no") : "no");
  const [autoQueue, setAutoQueue] = useState(campaign ? (campaign.autoQueueHighScoreCompanies ? "yes" : "no") : "yes");
  const [providerPriority, setProviderPriority] = useState<DiscoveryProviderName[]>(
    campaign?.providerPriority ?? ["recherche_entreprises", "sirene", "google_places"]
  );
  const [enabledSignals, setEnabledSignals] = useState<SignalProviderId[]>(
    campaign?.researchStrategy?.enabledSignalProviders ?? ["company_registry", "google_places", "website_presence"]
  );

  const toggleProvider = (id: DiscoveryProviderName) => {
    setProviderPriority((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    );
  };

  const toggleSignal = (id: SignalProviderId) => {
    if (id === "company_registry") return; // Registry is universal
    setEnabledSignals((current) =>
      current.includes(id) ? current.filter((s) => s !== id) : [...current, id]
    );
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    setProviderPriority((current) => {
      const copy = [...current];
      const temp = copy[index - 1];
      copy[index - 1] = copy[index];
      copy[index] = temp;
      return copy;
    });
  };

  const moveDown = (index: number) => {
    setProviderPriority((current) => {
      if (index === current.length - 1) return current;
      const copy = [...current];
      const temp = copy[index + 1];
      copy[index + 1] = copy[index];
      copy[index] = temp;
      return copy;
    });
  };

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setSaving(true);
    try {
      const name = String(form.get("name") ?? "").trim();
      const finalProviders = providerPriority.length ? providerPriority : ["recherche_entreprises" as const];
      
      const campaignData = {
        workspaceId: workspaceId || "ws_default",
        businessId: currentBusinessId || "biz_devcomm",
        offerId: selectedOfferId || undefined,
        name,
        segment: segment,
        cities: splitList(String(form.get("cities") ?? "")),
        departments: splitList(String(form.get("departments") ?? "")),
        regions: splitList(String(form.get("regions") ?? "")),
        keywords: splitList(String(form.get("keywords") ?? "")),
        excludeKeywords: splitList(String(form.get("excludeKeywords") ?? "")),
        nafCodes: splitList(String(form.get("nafCodes") ?? "")),
        maxCompaniesPerRun: Number(form.get("maxCompaniesPerRun") ?? 15),
        minEmployeeCount: Number(form.get("minEmployeeCount") ?? 0) || undefined,
        requireWebsite: requireWebsite === "yes",
        providerPriority: finalProviders,
        researchStrategy: {
          enabledSignalProviders: enabledSignals,
          relevanceExplanation: `Configured with ${enabledSignals.length} signal modules.`
        },
        autoQueueHighScoreCompanies: autoQueue === "yes",
        minDiscoveryScoreForSave: 100,
        minDiscoveryScoreForAutoResearch: 100,
        minQualityScoreForAutoResearch: 100,
        rechercheEntreprisesPageCursor: campaign?.rechercheEntreprisesPageCursor ?? 1,
        rechercheEntreprisesExhausted: campaign?.rechercheEntreprisesExhausted ?? false,
        googlePlacesPageCursor: campaign?.googlePlacesPageCursor ?? 1,
        googlePlacesExhausted: campaign?.googlePlacesExhausted ?? false,
        updatedAt: serverTimestamp()
      };

      if (campaign) {
        await updateDoc(doc(db, collections.discoveryCampaigns, campaign.id), campaignData);
        await createLog({
          type: "discovery.campaign.updated",
          level: "info",
          message: `Discovery campaign updated: ${name}.`,
          metadata: { campaignId: campaign.id }
        });
      } else {
        const docRef = await addDoc(collection(db, collections.discoveryCampaigns), {
          ...campaignData,
          status: "active",
          createdAt: serverTimestamp()
        });
        await createLog({
          type: "discovery.campaign.created",
          level: "info",
          message: `Discovery campaign created: ${name}.`,
          metadata: { campaignId: docRef.id }
        });
      }

      formElement.reset();
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  const formContent = (
    <form ref={formRef} className="grid gap-6" onSubmit={onSubmit}>
      {/* Offer Selection */}
      {offers.length > 0 && (
        <div className="space-y-2">
          <Label>Target Offer</Label>
          <Select value={selectedOfferId} onValueChange={setSelectedOfferId}>
            <SelectTrigger><SelectValue placeholder="Select offer..." /></SelectTrigger>
            <SelectContent>
              {offers.map((off) => (
                <SelectItem key={off.id} value={off.id}>
                  {off.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">Campaign name</Label>
          <Input id="name" name="name" required placeholder="e.g., Paris Florists Search" defaultValue={campaign?.name} />
        </div>
        <div className="space-y-2">
          <Label>Segment</Label>
          <Select value={segment} onValueChange={(value) => setSegment(value as DiscoverySegment)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="commercial_performance">Commercial performance</SelectItem>
              <SelectItem value="training_hr">HR / Training</SelectItem>
              <SelectItem value="road_safety">Road safety / Fleet</SelectItem>
              <SelectItem value="custom">Custom / Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="cities">Cities</Label>
          <Input id="cities" name="cities" placeholder="e.g., Paris, Nantes, Rennes" defaultValue={campaign?.cities?.join(", ")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="keywords">Keywords</Label>
          <Input id="keywords" name="keywords" placeholder="e.g., fleuriste, fleurs, artisan fleuriste" defaultValue={campaign?.keywords?.join(", ")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="excludeKeywords">Excluded Keywords</Label>
          <Input id="excludeKeywords" name="excludeKeywords" placeholder="e.g., chien, chat, animal, zoo" defaultValue={campaign?.excludeKeywords?.join(", ")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="departments">Departments</Label>
          <Input id="departments" name="departments" placeholder="e.g., 75, 44, 35" defaultValue={campaign?.departments?.join(", ")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="regions">Regions</Label>
          <Input id="regions" name="regions" placeholder="e.g., Île-de-France, Pays de la Loire" defaultValue={campaign?.regions?.join(", ")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="nafCodes">NAF codes</Label>
          <Input id="nafCodes" name="nafCodes" placeholder="e.g., 4776Z (florists NAF)" defaultValue={campaign?.nafCodes?.join(", ")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="maxCompaniesPerRun">Max companies per run</Label>
          <Input id="maxCompaniesPerRun" name="maxCompaniesPerRun" type="number" defaultValue={campaign?.maxCompaniesPerRun ?? 15} min={1} max={50} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="minEmployeeCount">Min employee count</Label>
          <Input id="minEmployeeCount" name="minEmployeeCount" type="number" defaultValue={campaign?.minEmployeeCount ?? 0} />
        </div>
        <div className="space-y-2">
          <Label>Require website</Label>
          <Select value={requireWebsite} onValueChange={setRequireWebsite}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="no">No</SelectItem>
              <SelectItem value="yes">Yes</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Auto-queue matching companies</Label>
          <Select value={autoQueue} onValueChange={setAutoQueue}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="yes">Yes — queue for research immediately</SelectItem>
              <SelectItem value="no">No — save to discovered list only</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Signal Modules Selection */}
      <div className="space-y-3 rounded-lg border bg-slate-50/50 p-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Layers className="size-4 text-indigo-600" />
            <Label className="text-sm font-semibold">Signal & Evidence Modules</Label>
          </div>
          <CardDescription>Select which audit and signal extraction providers to run on discovered leads.</CardDescription>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2 mt-2">
          {ALL_SIGNALS.map((sig) => {
            const isEnabled = enabledSignals.includes(sig.id);
            const isUniversal = sig.id === "company_registry";
            return (
              <div
                key={sig.id}
                onClick={() => !isUniversal && toggleSignal(sig.id)}
                className={`flex items-start gap-2.5 p-2.5 rounded-lg border text-xs transition-all ${
                  isEnabled
                    ? "bg-indigo-50/50 border-indigo-300 font-medium"
                    : "bg-white border-slate-200 opacity-60"
                } ${isUniversal ? "cursor-default" : "cursor-pointer"}`}
              >
                <div className="mt-0.5">
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    disabled={isUniversal}
                    readOnly
                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                  />
                </div>
                <div className="flex-1 space-y-0.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-800">{sig.label}</span>
                    {isUniversal && <Badge variant="outline" className="text-[9px] py-0 px-1">Universal</Badge>}
                  </div>
                  <p className="text-[11px] text-slate-500">{sig.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>


      <div className="space-y-3 rounded-lg border bg-slate-50/50 p-4">
        <div className="space-y-1">
          <Label className="text-sm font-semibold">Discovery Providers & Priority Order</Label>
          <CardDescription>Select which providers to execute. Toggle them to enable or disable, then adjust execution priority with up/down arrows.</CardDescription>
        </div>
        
        <div className="grid gap-3 sm:grid-cols-2 mt-2">
          {ALL_PROVIDERS.map((prov) => {
            const isEnabled = providerPriority.includes(prov.id);
            const priorityIndex = providerPriority.indexOf(prov.id);
            return (
              <div
                key={prov.id}
                onClick={() => toggleProvider(prov.id)}
                className={`cursor-pointer rounded-lg border p-3.5 transition-all flex items-start gap-3 select-none ${
                  isEnabled
                    ? "border-indigo-600 bg-indigo-50/40 hover:bg-indigo-50/60 shadow-xs"
                    : "border-muted bg-card hover:bg-slate-100/50"
                }`}
              >
                <div className="mt-0.5">
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    readOnly
                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                  />
                </div>
                <div className="space-y-1 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{prov.label}</span>
                    {isEnabled && (
                      <Badge variant="secondary" className="text-[10px] px-2 py-0 bg-indigo-100 text-indigo-800 border-none font-medium">
                        Priority {priorityIndex + 1}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-normal">{prov.desc}</p>
                </div>
              </div>
            );
          })}
        </div>

        {providerPriority.length > 1 && (
          <div className="mt-4 rounded-lg border bg-card p-3 space-y-2 shadow-xs">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Priority Execution Queue Order:</p>
            <div className="space-y-1.5">
              {providerPriority.map((provId, index) => {
                const prov = ALL_PROVIDERS.find((p) => p.id === provId);
                if (!prov) return null;
                return (
                  <div key={provId} className="flex items-center justify-between bg-slate-50/50 border rounded-md px-3 py-1.5 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-muted-foreground text-xs w-4">{index + 1}.</span>
                      <span className="font-medium text-slate-800">{prov.label}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 text-slate-600 hover:text-indigo-600"
                        disabled={index === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          moveUp(index);
                        }}
                      >
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 text-slate-600 hover:text-indigo-600"
                        disabled={index === providerPriority.length - 1}
                        onClick={(e) => {
                          e.stopPropagation();
                          moveDown(index);
                        }}
                      >
                        <ArrowDown className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {campaign ? (
        <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={saving} className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold">
            {saving && <Loader2 className="size-4 animate-spin mr-2" />}
            Save changes
          </Button>
        </div>
      ) : (
        <Button type="submit" disabled={saving} className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white font-semibold">
          {saving ? <Loader2 className="size-4 animate-spin mr-2" /> : <Plus className="size-4 mr-2" />}
          Create campaign
        </Button>
      )}
    </form>
  );

  if (campaign) {
    return formContent;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create discovery campaign</CardTitle>
        <CardDescription>Configure target keywords, geography, and search provider rules before queuing leads for research.</CardDescription>
      </CardHeader>
      <CardContent>
        {formContent}
      </CardContent>
    </Card>
  );
}
