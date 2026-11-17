"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { pricingFormErrors, type PricingFormState } from "@/lib/offers/offer-form";

/**
 * The commercial terms of an offer, exactly as the AI is allowed to state them.
 * Every draft is checked against these afterwards (pricing-guardrail.ts): any
 * other amount, a free month, a discount, a different commitment or tax basis
 * sends it to a person. Blank means "not declared" — never a default value.
 */
export function OfferPricingFields({
  value,
  onChange
}: {
  value: PricingFormState;
  onChange: (next: PricingFormState) => void;
}) {
  const set = <K extends keyof PricingFormState>(key: K, next: PricingFormState[K]) =>
    onChange({ ...value, [key]: next });

  const numberField = (key: "setupFee" | "monthlyPrice" | "startingPrice" | "commitmentMonths", label: string, placeholder: string) => (
    <div className="grid gap-1.5">
      <Label className="text-xs font-semibold text-slate-700">{label}</Label>
      <Input
        inputMode="decimal"
        value={value[key]}
        onChange={(e) => set(key, e.target.value)}
        placeholder={placeholder}
        className="text-xs"
      />
    </div>
  );

  return (
    <fieldset className="grid gap-3 rounded-lg border border-slate-200 p-3">
      <legend className="px-1 text-xs font-semibold text-slate-700">Commercial terms</legend>
      <p className="text-[11px] leading-snug text-slate-500">
        The AI may only state what is declared here. Any other amount, a free month, a discount or a
        different commitment sends the draft to a person instead of the prospect.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label className="text-xs font-semibold text-slate-700">Pricing model</Label>
          <Select
            value={value.pricingModel}
            onValueChange={(v: PricingFormState["pricingModel"]) => set("pricingModel", v)}
          >
            <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="custom_quote">Custom quote</SelectItem>
              <SelectItem value="fixed">Fixed price</SelectItem>
              <SelectItem value="subscription">Subscription</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs font-semibold text-slate-700">Tax basis</Label>
          <Select
            value={value.taxLabel || "none"}
            onValueChange={(v: string) => set("taxLabel", v === "none" ? "" : (v as "HT" | "TTC"))}
          >
            <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="HT">HT</SelectItem>
              <SelectItem value="TTC">TTC</SelectItem>
              <SelectItem value="none">Not stated</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs text-slate-700">
        <input
          type="checkbox"
          checked={value.canDisclose}
          onChange={(e) => set("canDisclose", e.target.checked)}
          className="size-3.5"
        />
        The AI may state these prices in emails and replies
      </label>

      <div className="grid grid-cols-2 gap-3">
        {numberField("setupFee", "Setup fee (€) — 0 = free", "0")}
        {numberField("monthlyPrice", "Monthly price (€)", "49")}
        {numberField("startingPrice", "Starting price (€)", "")}
        {numberField("commitmentMonths", "Commitment (months) — 0 = none", "24")}
      </div>

      {pricingFormErrors(value).map((error) => (
        <p key={error} className="text-[11px] text-red-600">{error}</p>
      ))}

      <div className="grid gap-1.5">
        <Label className="text-xs font-semibold text-slate-700">Approved terms (one per line)</Label>
        <Textarea
          value={value.approvedTerms}
          onChange={(e) => set("approvedTerms", e.target.value)}
          placeholder={"Premier mois réglé à la commande\nLe domaine reste à votre nom"}
          className="min-h-14 text-xs"
        />
      </div>

      <div className="grid gap-1.5">
        <Label className="text-xs font-semibold text-slate-700">Terms sentence for first messages</Label>
        <Input
          value={value.termsLine}
          onChange={(e) => set("termsLine", e.target.value)}
          placeholder="Notre formule : 0 € de création, puis 49 € HT par mois, engagement 24 mois."
          className="text-xs"
        />
        <p className="text-[11px] leading-snug text-slate-500">
          Inserted word for word in every first direct message for this offer; the AI then never states a price
          itself. It must match the terms above, or it is not used.
        </p>
      </div>
    </fieldset>
  );
}
