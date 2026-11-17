import type { KnowledgeBaseDoc, OfferDoc } from "@/types/firestore";

/**
 * Converts offers and knowledge-base entries to and from the Settings forms.
 *
 * Kept out of the component (UX contract #4) and pure so the round trip can be
 * tested. Each converter replaces one that silently changed data on save:
 *   - saving an offer forced `pricingModel: "fixed"` and price disclosure on,
 *     and turned a 0 € price into 1 490 €;
 *   - prohibited promises lived in a single-line input, which strips line
 *     breaks, so several promises fused into one string that never matched;
 *   - every saved case study got the metric "+40%" and the industry "B2B";
 *   - every service gained another "(Ideal for: …)" suffix per save.
 * The SDR treats all of this as approved fact (Invariant 5), so a form that
 * invents or merges it is a fabrication path, not a cosmetic bug.
 */

export type PricingGuardrails = NonNullable<OfferDoc["pricingGuardrails"]>;

export interface PricingFormState {
  pricingModel: PricingGuardrails["pricingModel"];
  canDisclose: boolean;
  startingPrice: string;
  setupFee: string;
  monthlyPrice: string;
  commitmentMonths: string;
  taxLabel: "" | "HT" | "TTC";
  approvedTerms: string;
  termsLine: string;
}

export const EMPTY_PRICING_FORM: PricingFormState = {
  pricingModel: "custom_quote",
  canDisclose: false,
  startingPrice: "",
  setupFee: "",
  monthlyPrice: "",
  commitmentMonths: "",
  // Not defaulted: an undeclared tax basis makes the AI state none.
  taxLabel: "",
  approvedTerms: "",
  termsLine: ""
};

export function splitLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

const toText = (value: number | undefined | null): string =>
  typeof value === "number" && Number.isFinite(value) ? String(value) : "";

/**
 * Blank stays "not declared"; 0 stays 0 (a free setup is a real term).
 * Units and grouping are tolerated ("24 mois", "1 490 €", "49,90"); anything
 * else is reported by pricingFormErrors rather than silently dropped — a
 * dropped commitment turns the commitment check off.
 */
function toNumber(text: string): number | undefined {
  const compact = text.trim().replace(/[\s\u00a0\u202f]/g, "");
  if (!compact) return undefined;
  const match = compact.match(/^(\d+(?:[.,]\d+)?)(?:€|eur|euros?|mois|months?)?$/i);
  if (!match) return undefined;
  // "1.490" is a French thousands separator, not 1.49.
  const raw = /^\d{1,3}(?:\.\d{3})+$/.test(match[1]) ? match[1].replace(/\./g, "") : match[1].replace(",", ".");
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

const NUMBER_FIELDS: Array<[keyof PricingFormState, string]> = [
  ["setupFee", "Setup fee"],
  ["monthlyPrice", "Monthly price"],
  ["startingPrice", "Starting price"],
  ["commitmentMonths", "Commitment"]
];

/** Fields that were filled in but cannot be read as a number, or cannot be used. */
export function pricingFormErrors(form: PricingFormState): string[] {
  const errors = NUMBER_FIELDS.filter(([key]) => String(form[key]).trim() !== "" && toNumber(String(form[key])) === undefined).map(
    ([, label]) => `${label}: enter a number (e.g. 24 or 49).`
  );
  // The server checks the sentence against these terms on every draft; this
  // is the one case it can be told here.
  if (form.termsLine.trim() && !form.canDisclose) {
    errors.push("Terms sentence: it is only used when the AI may state these prices (tick the box above).");
  }
  return errors;
}

export function pricingFormFromOffer(offer?: Pick<OfferDoc, "pricingGuardrails"> | null): PricingFormState {
  const guard = offer?.pricingGuardrails;
  if (!guard) return { ...EMPTY_PRICING_FORM };
  return {
    pricingModel: guard.pricingModel ?? "custom_quote",
    canDisclose: guard.canDiscloseInColdReply === true,
    startingPrice: toText(guard.startingPrice),
    setupFee: toText(guard.setupFee),
    monthlyPrice: toText(guard.monthlyPrice),
    commitmentMonths: toText(guard.commitmentMonths),
    taxLabel: guard.taxLabel ?? "",
    approvedTerms: (guard.approvedTerms ?? []).join("\n"),
    termsLine: guard.termsLine ?? ""
  };
}

/**
 * The full guardrail object. Undeclared fields are omitted, never defaulted,
 * and the object is meant to replace the stored one whole (saveOfferClient
 * uses mergeFields), so clearing a field in the form clears it in Firestore.
 */
export function pricingGuardrailsFromForm(form: PricingFormState): PricingGuardrails {
  const guard: PricingGuardrails = {
    currency: "EUR",
    pricingModel: form.pricingModel,
    canDiscloseInColdReply: form.canDisclose
  };
  const startingPrice = toNumber(form.startingPrice);
  const setupFee = toNumber(form.setupFee);
  const monthlyPrice = toNumber(form.monthlyPrice);
  const commitmentMonths = toNumber(form.commitmentMonths);
  if (startingPrice !== undefined) guard.startingPrice = startingPrice;
  if (setupFee !== undefined) guard.setupFee = setupFee;
  if (monthlyPrice !== undefined) guard.monthlyPrice = monthlyPrice;
  if (commitmentMonths !== undefined) guard.commitmentMonths = Math.round(commitmentMonths);
  if (form.taxLabel) guard.taxLabel = form.taxLabel;
  const approvedTerms = splitLines(form.approvedTerms);
  if (approvedTerms.length) guard.approvedTerms = approvedTerms;
  // One sentence: line breaks would split it across DM paragraphs. Only
  // ordinary whitespace is collapsed — a no-break space ("1 490 €") is kept.
  const termsLine = form.termsLine.replace(/[ \t\r\n]+/g, " ").trim();
  if (termsLine) guard.termsLine = termsLine;
  return guard;
}

type Service = KnowledgeBaseDoc["services"][number];
type CaseStudy = KnowledgeBaseDoc["caseStudies"][number];

/** "Name | Description | Ideal for" — one per line. */
export function servicesToText(services: Service[] | undefined): string {
  return (services ?? [])
    .map((service) => [service.name, service.description, service.idealFor].filter((part) => part !== undefined && part !== "").join(" | "))
    .join("\n");
}

export function servicesFromText(text: string): Service[] {
  return splitLines(text).map((line) => {
    const [name, description, idealFor] = line.split("|").map((part) => part.trim());
    const service: Service = { name: name || line, description: description ?? "" };
    if (idealFor) service.idealFor = idealFor;
    return service;
  });
}

/** "Title | Industry | Metric | Description" — one per line; empty parts stay empty. */
export function caseStudiesToText(caseStudies: CaseStudy[] | undefined): string {
  return (caseStudies ?? [])
    .map((study) => [study.title, study.clientIndustry ?? "", study.metric ?? "", study.description ?? ""].join(" | "))
    .join("\n");
}

export function caseStudiesFromText(text: string): CaseStudy[] {
  return splitLines(text).map((line) => {
    const parts = line.split("|").map((part) => part.trim());
    if (parts.length === 1) {
      // Free text with no separators: keep it as written, invent nothing.
      return { title: line, clientIndustry: "", metric: "", description: "" };
    }
    const [title, clientIndustry = "", metric = "", ...rest] = parts;
    return { title, clientIndustry, metric, description: rest.join(" | ") };
  });
}
