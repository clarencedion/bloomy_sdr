import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EMPTY_PRICING_FORM,
  caseStudiesFromText,
  caseStudiesToText,
  pricingFormErrors,
  pricingFormFromOffer,
  pricingGuardrailsFromForm,
  servicesFromText,
  servicesToText
} from "@/lib/offers/offer-form";
import type { OfferDoc } from "@/types/firestore";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("Phase 19 — Settings never rewrites or invents offer data", () => {
  const subscription: OfferDoc["pricingGuardrails"] = {
    startingPrice: 49,
    currency: "EUR",
    pricingModel: "subscription",
    canDiscloseInColdReply: true,
    setupFee: 0,
    monthlyPrice: 49,
    commitmentMonths: 24,
    taxLabel: "HT",
    approvedTerms: ["Premier mois réglé à la commande"]
  };

  it("round-trips commercial terms exactly, including a 0 € setup fee", () => {
    const form = pricingFormFromOffer({ pricingGuardrails: subscription });
    expect(form.setupFee).toBe("0");
    expect(pricingGuardrailsFromForm(form)).toEqual(subscription);
  });

  it("keeps the owner's pricing model and disclosure choice (they used to be forced to fixed/on)", () => {
    const quoteOnly = { currency: "EUR" as const, pricingModel: "custom_quote" as const, canDiscloseInColdReply: false };
    const saved = pricingGuardrailsFromForm(pricingFormFromOffer({ pricingGuardrails: quoteOnly }));
    expect(saved.pricingModel).toBe("custom_quote");
    expect(saved.canDiscloseInColdReply).toBe(false);
    expect(saved.startingPrice).toBeUndefined();
  });

  it("omits blank fields instead of defaulting them", () => {
    const saved = pricingGuardrailsFromForm({ ...EMPTY_PRICING_FORM, taxLabel: "" });
    expect(Object.keys(saved).sort()).toEqual(["canDiscloseInColdReply", "currency", "pricingModel"]);
    expect(saved.canDiscloseInColdReply).toBe(false);
  });

  it("never attaches a metric or industry to a case study that has none", () => {
    const studies = caseStudiesFromText("Salon de coiffure — Dol-de-Bretagne | Coiffure |  | Site livré et en ligne\nRéférence libre");
    expect(studies[0]).toEqual({
      title: "Salon de coiffure — Dol-de-Bretagne",
      clientIndustry: "Coiffure",
      metric: "",
      description: "Site livré et en ligne"
    });
    expect(studies[1]).toEqual({ title: "Référence libre", clientIndustry: "", metric: "", description: "" });
    expect(JSON.stringify(studies)).not.toContain("+40%");
  });

  it("round-trips case studies and services without drift", () => {
    const studies = [
      { title: "Fleuristes — 15 sites en ligne (Marboz, Paris)", clientIndustry: "Fleuristes", metric: "", description: "Visibles en ligne" }
    ];
    expect(caseStudiesFromText(caseStudiesToText(studies))).toEqual(studies);

    const services = [{ name: "Site vitrine", description: "Rapide sur mobile", idealFor: "Artisans" }, { name: "Option", description: "Sur devis" }];
    const once = servicesFromText(servicesToText(services));
    expect(once).toEqual(services);
    expect(servicesFromText(servicesToText(once))).toEqual(services);
  });

  it("edits prohibited promises in a multi-line field and prefills no claims", () => {
    const page = fs.readFileSync(path.join(repoRoot, "src/features/settings/settings-page.tsx"), "utf8");
    expect(page).not.toMatch(/metric: "\+40%"/);
    expect(page).not.toMatch(/pricingModel: "fixed",\s*canDiscloseInColdReply: true/);
    expect(page).not.toMatch(/95\+ PageSpeed|\+40% sales velocity/);
    const prohibitedField = page.slice(page.indexOf("Prohibited Promises (One per line)"));
    expect(prohibitedField.slice(0, 300)).toContain("<Textarea");
  });

  it("replaces offer fields whole on save so a cleared term stays cleared", () => {
    const source = fs.readFileSync(path.join(repoRoot, "src/lib/firebase/firestore.ts"), "utf8");
    const fn = source.slice(source.indexOf("export async function saveOfferClient"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toContain("mergeFields: Object.keys(defined)");
    // Undefined values are dropped before the mask, or the SDK rejects it.
    expect(body).toContain("value !== undefined");
  });

  it("reads figures typed with units, and reports — never drops — what it cannot read", () => {
    const saved = pricingGuardrailsFromForm({
      ...EMPTY_PRICING_FORM,
      canDisclose: true,
      commitmentMonths: "24 mois",
      monthlyPrice: "49 €",
      startingPrice: "1 490"
    });
    expect(saved.commitmentMonths).toBe(24);
    expect(saved.monthlyPrice).toBe(49);
    expect(saved.startingPrice).toBe(1490);
    expect(pricingGuardrailsFromForm({ ...EMPTY_PRICING_FORM, startingPrice: "1.490" }).startingPrice).toBe(1490);
    expect(pricingFormErrors({ ...EMPTY_PRICING_FORM, commitmentMonths: "deux ans" })).toEqual([
      "Commitment: enter a number (e.g. 24 or 49)."
    ]);
    expect(pricingFormErrors(EMPTY_PRICING_FORM)).toEqual([]);
  });

  it("does not default the tax basis", () => {
    expect(EMPTY_PRICING_FORM.taxLabel).toBe("");
  });

  it("round-trips the terms sentence, keeping its no-break spaces, and joins its lines", () => {
    const line = "Notre formule : 1\u00a0490 € HT, site livré, puis 15 € HT par mois, sans engagement.";
    const withLine = { ...subscription, termsLine: line };
    expect(pricingGuardrailsFromForm(pricingFormFromOffer({ pricingGuardrails: withLine }))).toEqual(withLine);
    const typed = { ...pricingFormFromOffer({ pricingGuardrails: subscription }), termsLine: "  Notre formule :\n0 € de création,   puis 49 € HT par mois. " };
    expect(pricingGuardrailsFromForm(typed).termsLine).toBe("Notre formule : 0 € de création, puis 49 € HT par mois.");
    expect(pricingGuardrailsFromForm({ ...typed, termsLine: "  " })).not.toHaveProperty("termsLine");
  });

  it("refuses a terms sentence while the AI may not state prices", () => {
    expect(pricingFormErrors({ ...EMPTY_PRICING_FORM, termsLine: "Notre formule : 49 € HT par mois." })).toEqual([
      "Terms sentence: it is only used when the AI may state these prices (tick the box above)."
    ]);
    expect(pricingFormErrors({ ...EMPTY_PRICING_FORM, canDisclose: true, termsLine: "Notre formule : 49 € HT par mois." })).toEqual([]);
  });
});
