/**
 * Deterministic check of every commercial statement an AI draft makes, against
 * the terms the business actually approved on its offer (REQ-067).
 *
 * Why this exists instead of a word list: the previous guardrail refused any
 * draft containing "gratuitement". That is the right answer for an offer that
 * has no free component, and exactly the wrong one for an offer whose headline
 * IS "no setup fee" — every honest reply would have been escalated. A word list
 * cannot know which; the offer can. So the rule is no longer "these words are
 * forbidden" but "a draft may only state terms the offer declares":
 *
 *   - free wording only about a component the offer declares free (a 0 setup
 *     fee makes the *setup* free — never a month, the subscription, hosting or
 *     maintenance), unless an approved term says otherwise;
 *   - a discount only if an approved term names one;
 *   - a price only if disclosure is allowed, and then only a declared figure;
 *     spelled-out amounts are refused (they cannot be compared);
 *   - a commitment only if the offer declares one, and only that one ("sans
 *     engagement" on a 24-month offer is a misrepresentation, not a tone choice);
 *   - a tax basis only if the offer declares one, and only that one.
 *
 * How: free wording is judged per clause, by what it sits next to. A first
 * version matched fixed phrasings and an adversarial review got 21 false
 * statements past it out of 46 ("le premier mois est offert", "aucun
 * engagement", "durée d'engagement : 12 mois"…). Clause-level proximity,
 * negation and masking of priced expressions replace it; the review's phrasings
 * are pinned in go-live-readiness.test.ts. The check still errs towards
 * escalation: a false refusal costs a human glance, a false pass is sent.
 *
 * What this check is — and is not. A second adversarial review wrote 60 new
 * misstatements from scratch and 52 got through ("nous vous offrons le premier
 * mois", "résiliation possible à tout moment", "39 balles par mois"…). French
 * has more ways to say "free" or "no commitment" than any pattern list, so
 * `checkPricingStatements` is a DETECTOR of known misstatement shapes for the
 * person reviewing a draft. It is not a gate and must never be read as
 * clearance.
 *
 * The gate is `mentionsCommercialTerms`: a deliberately broad vocabulary
 * heuristic. Autonomous sending refuses any draft it flags (price, free items,
 * discounts, commitment, cancellation, contract, duration, tax…) and hands it
 * to a person (reply-dispatcher). It is still a word list — a fourth review
 * found phrasings it misses ("vous ne réglez rien avant…") — so it is NOT the
 * long-term guarantee: commercial terms must reach a prospect unattended only
 * when code, not the model, writes them (Phase 21). Until then nothing is
 * sent unattended at all (no reply transport, auto-approval off by default).
 *
 * Pure: no Firestore, no model call. Business-agnostic (Invariant 1): nothing
 * here knows what is sold. French only, like every prompt in this engine.
 */

export interface PricingTerms {
  startingPrice?: number;
  currency?: "EUR";
  pricingModel?: "fixed" | "subscription" | "custom_quote";
  canDiscloseInColdReply?: boolean;
  /** One-off setup/creation fee. 0 declares a free setup as an approved term. */
  setupFee?: number;
  /** Recurring price per month, for subscription offers. */
  monthlyPrice?: number;
  /** Minimum commitment in months. 0 = no commitment; undefined = not declared. */
  commitmentMonths?: number;
  /** Tax basis the prices are expressed in. */
  taxLabel?: "HT" | "TTC";
  /**
   * Exact commercial statements the business approved, e.g.
   * "Création du site offerte" or "Premier mois réglé à la commande".
   * Figures, free wording and discounts that appear here become allowed.
   */
  approvedTerms?: string[];
  /**
   * The one sentence that states this offer's terms in a first message, e.g.
   * "Notre formule : 0 € de création, puis 49 € HT par mois, engagement 24 mois."
   * Written by the business, inserted verbatim by code (social-dm-terms.ts):
   * when it is set, the model never writes a term in a first message. It must
   * pass this check against the offer's own terms, or it is not used.
   */
  termsLine?: string;
}

export type PricingViolationCode =
  | "UNAPPROVED_FREE_OFFER"
  | "UNAPPROVED_FREE_PERIOD"
  | "UNAPPROVED_DISCOUNT"
  | "PRICE_NOT_DISCLOSABLE"
  | "UNAPPROVED_PRICE"
  | "COMMITMENT_CONTRADICTION"
  | "COMMITMENT_UNDECLARED"
  | "TAX_BASIS_CONTRADICTION"
  | "TAX_BASIS_UNDECLARED";

export interface PricingViolation {
  code: PricingViolationCode;
  detail: string;
}

export interface PricingCheckResult {
  /** No known misstatement shape found. Advisory — never clearance to send. */
  passed: boolean;
  violations: PricingViolation[];
  /** Fail-closed: the text touches commercial terms in some wording. */
  mentionsCommercialTerms: boolean;
  /** Every amount the text states in figures, parsed as numbers. */
  pricesMentioned: number[];
}

// ── Text helpers ──────────────────────────────────────────────────────────

const LETTERS = "a-zàâäçéèêëîïôöùûüÿœæ";
/** A regex whose alternatives must stand as whole words (accent-aware). */
const words = (body: string, flags = "g") => new RegExp(`(?<![${LETTERS}])(?:${body})(?![${LETTERS}])`, flags);

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[\u00a0\u202f]/g, " ");
}

/** Sentences, then clauses. A comma between digits ("49,90") is not a break. */
function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim());
}

function splitClauses(sentence: string): string[] {
  return sentence
    .split(/[;:!?()\n]|(?<!\d),|,(?!\d)|\s(?:puis|mais|ensuite)\s|\s[-–—]\s/)
    .filter((c) => c.trim());
}

/** Blank out spans (same length) so positions stay comparable. */
function mask(text: string, pattern: RegExp): string {
  return text.replace(pattern, (m) => " ".repeat(m.length));
}

// ── Vocabulary ────────────────────────────────────────────────────────────

const FREE_MARKER = words(
  "gratuit(?:e|s|es|ement)?|offert(?:e|s|es)?|sans frais|zéro euros?|free|(?<![\\d.,])0 ?(?:€|euros?|eur)|€ ?0(?![\\d.,])"
);
const SETUP_WORD = words(
  "création|créations|créer|créons|crée|créé|créée|créés|créées|conception|conçu|conçue|mise en place|mise en ligne|mise en service|installation|démarrage|lancement|frais de (?:création|dossier|mise en (?:place|service)|démarrage|lancement|installation)|setup",
  ""
);
const PERIOD_WORD = words(
  "mois|mensuel(?:le)?s?|mensualités?|an|ans|année|années|annuel(?:le)?s?|abonnement|hébergement|maintenance|à vie|pendant|trimestre|essai|semaines?",
  ""
);
const NEGATION = words("pas|aucun|aucune|jamais|ni|non", "");

/** Non-zero priced or commitment expressions: their "mois" is not a free period. */
const PRICED_EXPRESSION =
  /(?:(?:abonnement|mensualité|forfait)\s+(?:mensuel(?:le)?\s+)?(?:de|à)\s+)?(?<![\d.,])(?:[1-9]\d{0,2}(?:[ .]\d{3})*|[1-9]\d*)(?:,\d{1,2})?\s?(?:€|euros?|eur)(?:\s*(?:ht|ttc))?(?:\s*(?:\/\s*mois|par\s+mois|mensuels?|\/\s*an|par\s+an))?/g;
const COMMITMENT_EXPRESSION =
  /(?:engagement|contrat|durée)[^.!?]{0,25}?(?:\d{1,3}|un|une|deux|trois|six|douze|dix-huit|vingt-quatre|trente-six)\s*(?:mois|ans?|années?)/g;

const NO_COMMITMENT = words(
  "sans (?:aucun |d'|le moindre )?engagement|(?:ni|zéro|libre de tout) engagement|engagement \\? aucun|(?:ne )?(?:vous )?(?:engage|engagez) à rien|sans (?:aucune )?obligation|(?:y )?mettre fin à tout moment|aucun engagement|pas d'engagement|sans (?:aucune )?durée(?: minimale| d'engagement)?|sans obligation de durée|résiliable (?:à tout moment|quand vous (?:le )?(?:voulez|souhaitez)|sans frais|chaque mois|tous les mois|à la fin de chaque mois|mensuellement)|(?:arrêter|arrêtez|résilier|résiliez|stopper|stoppez) (?:à tout moment|quand vous (?:le )?(?:voulez|souhaitez)|quand bon vous semble)",
  ""
);
// Not "durée" or "minimum" alone: "durée de réalisation : 1 mois" is not a
// commitment. "Durée d'engagement" is caught by "engagement".
const COMMITMENT_KEYWORD = words("engagement|engagé|engagée|engagés|engagées|engage|engagez|engageons|engager|engagera|contrat|durée minimale", "g");
// "24 premiers mois" is a duration too.
const DURATION = /(\d{1,3}|une|un|deux|trois|six|douze|dix-huit|vingt-quatre|trente-six)\s*(?:(?:premiers?|premières?|prochains?)\s+)?(mois|ans?|années?)(?![a-zà-ÿ])/;
const DURATION_THEN_KEYWORD =
  /(?<![a-zà-ÿ\d])(\d{1,3}|une|un|deux|trois|six|douze|dix-huit|vingt-quatre|trente-six)\s*(?:(?:premiers?|premières?|prochains?)\s+)?(mois|ans?|années?)\s+(?:d'engagement|minimum|ferme|de contrat|d'abonnement minimum)/g;
const NUMBER_WORDS: Record<string, number> = {
  un: 1, une: 1, deux: 2, trois: 3, six: 6, douze: 12, "dix-huit": 18, "vingt-quatre": 24, "trente-six": 36
};

// "20 % de réduction du temps de chargement" is a claim about the prospect's
// site, not a price cut; "la promotion de vos produits" is marketing, not a
// discount ("promotion de lancement" still is).
const DISCOUNT =
  /(?<![\d\w])-\s?\d{1,3}\s?%(?!\s*(?:de|du|des|d')\s*(?:temps|délai|chargement|consommation|appels|erreurs))|\d{1,3}\s?%\s*(?:de\s+)?(?:remise|réduction|rabais|discount|moins cher|de moins|en moins|offerts?)(?!\s+(?:de|du|des|d')\s*(?:temps|délai|chargement|consommation|appels|erreurs))|(?:remise|rabais|réduction|ristourne)\s+(?:exceptionnelle\s+)?(?:de\s+)?\d{1,4}\s?(?:%|€|euros?)|code promo|prix (?:spécial|préférentiel|d'ami|cassé)|tarif (?:spécial|préférentiel)|geste commercial|offre (?:spéciale|de lancement|promotionnelle)|promotions?(?!\s+(?:de|du|des|d')\s*(?!lancement|bienvenue))/;

const PER_YEAR =
  /(?<![\d.,])\d[\d .,]*\s?(?:€|euros?)\s*(?:ht|ttc)?\s*(?:\/\s*an(?![a-zà-ÿ])|par\s+an(?![a-zà-ÿ])|par\s+année|annuels?)/;

const TAX_STATED = words("ht|hors taxes?|ttc|toutes taxes comprises", "g");

const SPELLED_NUMBER =
  "(?:un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingt|trente|quarante|cinquante|soixante|cent|cents|mille)";
const SPELLED_AMOUNT = new RegExp(
  `(?<![${LETTERS}])${SPELLED_NUMBER}(?:[- ](?:et[- ])?${SPELLED_NUMBER})*\\s+euros?(?![${LETTERS}])`
);

// ── The fail-closed gate ──────────────────────────────────────────────────

// Stems are written with "@" for "any letters, accents included": "\w" is
// ASCII-only in JavaScript, so "rembours\w*" missed "remboursé" and the
// whole-word check then rejected the match (third review).
const STEM = `[${LETTERS}]*`;
const COMMERCIAL_VOCABULARY = words(
  [
    "offr@|offert@|gratuit@|cadeau@|co[uû]t@|pay(?:e|er|ez|ons|ent|é|ée|és|ées)|paie@|paiement@|débours@|centime@|investiss@",
    "factur@|frais|charge|prix|tarif@|remise@|r[ée]duc@|rabais|ristourne@|promo@|soldes?|moiti[ée]|geste|montant@|arrang@",
    "bienvenue|lancement|engag@|r[ée]sili@|annul@|contrat@|dur[ée]e|minimum|minimale|annuel@|abonn@|obligation@|condition@",
    "mensu@|essai|rembours@|devis|balles|euros?|eur|ht|ttc|hors taxes?|toutes taxes|sans attache|libre de partir|risque@",
    "arr[êe]t@|part(?:ir|ez|ent|ons)|quitt@|stop|z[ée]ro|quand vous (?:le )?(?:voulez|souhaitez)|à tout moment",
    "d[ée]sabonn@|r[èée]gl@|versement@|contractuel@|li[ée]e?s?|trimestre@|gratos|caf[ée]",
    "mois|an|ans|année|années|semaine@|€|%"
  ]
    .join("|")
    .replace(/@/g, STEM),
  ""
);

/**
 * True when the text uses any word from a deliberately broad commercial
 * vocabulary. A false positive costs a person a glance; a miss is possible
 * (it is a word list), which is why unattended commercial text must come from
 * code, not from the model.
 */
export function mentionsCommercialTerms(text: string): boolean {
  return commercialWordIn(text) !== undefined;
}

/**
 * The first word of that vocabulary the text uses, as written — so a draft
 * held for it can say which word to look at. Same test as
 * `mentionsCommercialTerms`.
 */
export function commercialWordIn(text: string): string | undefined {
  const source = normalize(text);
  const match = source.match(COMMERCIAL_VOCABULARY) ?? source.match(/\d\s*(?:€|\/\s*(?:mois|an))/);
  return match ? match[0].trim() : undefined;
}

// ── Prices ────────────────────────────────────────────────────────────────

/** Amounts in figures: "49 €", "1 490 €", "49,90 euros", "0€", "€39", "EUR 49". */
export function extractPrices(text: string): number[] {
  const source = normalize(text);
  const number = "(\\d{1,3}(?:[ .]\\d{3})*(?:,\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)";
  const after = new RegExp(`(?<![\\d.,])${number}\\s?(?:€|euros?(?![a-z])|eur(?![a-z]))`, "g");
  // "€39" — but not the "€" that already ended "49 €" ("49 € 24 mois").
  const before = new RegExp(`(?:(?<!\\d ?)€|(?<![a-z])eur)\\s?${number}(?![\\d])`, "g");
  const found: Array<{ index: number; value: number }> = [];
  // "2k€", "2 k€", "1,5 k euros".
  for (const match of source.matchAll(/(?<![\d.,])(\d+(?:[.,]\d+)?)\s?k\s?(?:€|euros?(?![a-z]))/g)) {
    found.push({ index: match.index ?? 0, value: Number(match[1].replace(",", ".")) * 1000 });
  }
  for (const pattern of [after, before]) {
    for (const match of source.matchAll(pattern)) {
      const raw = match[1].replace(/ /g, "");
      // "1.490" is a French thousands separator; "49,90" a decimal comma.
      const normalized = /^\d{1,3}(?:\.\d{3})+$/.test(raw) ? raw.replace(/\./g, "") : raw.replace(",", ".");
      const value = Number(normalized);
      if (Number.isFinite(value)) found.push({ index: match.index ?? 0, value });
    }
  }
  return found.sort((a, b) => a.index - b.index).map((item) => item.value);
}

function approvedAmounts(terms: PricingTerms): Set<number> {
  const amounts = new Set<number>();
  for (const value of [terms.startingPrice, terms.setupFee, terms.monthlyPrice]) {
    if (typeof value === "number" && Number.isFinite(value)) amounts.add(value);
  }
  for (const term of terms.approvedTerms ?? []) {
    for (const value of extractPrices(term)) amounts.add(value);
  }
  return amounts;
}

// ── Approved terms ────────────────────────────────────────────────────────

const STOPWORDS = new Set(["pour", "dans", "avec", "votre", "notre", "vous", "nous", "est", "sont", "leur", "cette", "ces", "des", "les", "une"]);

/**
 * An approved free term covers one occurrence of free wording when everything
 * the term names sits right next to it — and it only licenses a free *period*
 * if the term itself names one. Covering the whole clause let the approved
 * "0 € de création" vouch for "0 € de création et 0 €/mois la première année".
 */
function coveredByApprovedFreeTerm(near: string, nearHasPeriod: boolean, terms: PricingTerms): boolean {
  for (const raw of terms.approvedTerms ?? []) {
    const term = normalize(raw);
    if (!new RegExp(FREE_MARKER.source).test(term)) continue;
    if (nearHasPeriod && !PERIOD_WORD.test(term)) continue;
    const keys = term
      .replace(new RegExp(FREE_MARKER.source, "g"), " ")
      .split(/[^a-zà-ÿœæ\d]+/)
      .filter((word) => word.length >= 4 && !STOPWORDS.has(word));
    if (keys.length && keys.every((key) => near.includes(key))) return true;
  }
  return false;
}

// ── The check ─────────────────────────────────────────────────────────────

export function checkPricingStatements(text: string, terms?: PricingTerms | null): PricingCheckResult {
  const guard: PricingTerms = terms ?? {};
  const violations: PricingViolation[] = [];
  const add = (code: PricingViolationCode, detail: string) => {
    if (!violations.some((v) => v.code === code)) violations.push({ code, detail });
  };

  const source = normalize(text);
  const sentences = splitSentences(source);
  const pricesMentioned = extractPrices(text);

  // 1. Free wording, clause by clause, judged by what it is next to.
  for (const sentence of sentences) {
    for (const rawClause of splitClauses(sentence)) {
      const clause = mask(mask(rawClause, PRICED_EXPRESSION), COMMITMENT_EXPRESSION);
      for (const match of rawClause.matchAll(FREE_MARKER)) {
        const at = match.index ?? 0;
        const end = at + match[0].length;
        // "offert par votre hébergeur" means offered, not free. Only a third
        // party of THEIRS is exempt: "offerte par l'équipe", "par nos soins",
        // "par le studio" are free claims of ours.
        if (/^\s+par\s+(?:votre|vos|leurs?|ton|ta|tes)\s/.test(rawClause.slice(end))) continue;
        // "il n'y a pas de mois offert", "aucun mois offert" — but "non
        // seulement c'est offert" negates nothing.
        if (NEGATION.test(rawClause.slice(Math.max(0, at - 25), at).replace(/non seulement/g, " "))) continue;

        const near = clause.slice(Math.max(0, at - 30), end + 30);
        const nearHasPeriod = PERIOD_WORD.test(near);
        if (coveredByApprovedFreeTerm(near, nearHasPeriod, guard)) continue;
        if (nearHasPeriod) {
          add("UNAPPROVED_FREE_PERIOD", "Free period or free recurring service that the offer does not declare");
        } else if (!(guard.setupFee === 0 && SETUP_WORD.test(near))) {
          add("UNAPPROVED_FREE_OFFER", "Unapproved discount or free offer detected in draft copy");
        }
      }
    }
  }

  // 2. Discounts.
  const approvedDiscount = (guard.approvedTerms ?? []).some((term) => DISCOUNT.test(normalize(term)));
  if (DISCOUNT.test(source) && !approvedDiscount) {
    add("UNAPPROVED_DISCOUNT", "Unapproved discount or free offer detected in draft copy");
  }

  // 3. Figures.
  const nonZero = pricesMentioned.filter((value) => value !== 0);
  const spelled = SPELLED_AMOUNT.test(source);
  if (!guard.canDiscloseInColdReply) {
    if (nonZero.length > 0 || spelled) {
      add("PRICE_NOT_DISCLOSABLE", "Price figure disclosed when canDiscloseInColdReply is false");
    }
  } else {
    const allowed = approvedAmounts(guard);
    const invented = [...new Set(nonZero.filter((value) => !allowed.has(value)))];
    if (invented.length > 0) add("UNAPPROVED_PRICE", `Price figure not declared on the offer: ${invented.join(", ")} €`);
    if (spelled) add("UNAPPROVED_PRICE", "Amount written in words; only declared figures may be stated");
    // A declared monthly figure restated per year ("49 € par an") is a
    // different price. Yearly amounts must come from an approved term.
    const yearly = new Set(
      (guard.approvedTerms ?? []).filter((term) => PER_YEAR.test(normalize(term))).flatMap((term) => extractPrices(term))
    );
    for (const match of source.matchAll(new RegExp(PER_YEAR.source, "g"))) {
      const value = extractPrices(match[0])[0];
      if (value !== undefined && value !== 0 && !yearly.has(value)) {
        add("UNAPPROVED_PRICE", `Yearly amount not declared on the offer: ${value} €`);
        break;
      }
    }
  }

  // 4. Commitment.
  const stated: number[] = [];
  let saysNone = false;
  for (const sentence of sentences) {
    if (NO_COMMITMENT.test(sentence)) saysNone = true;
    for (const keyword of sentence.matchAll(COMMITMENT_KEYWORD)) {
      const window = sentence.slice((keyword.index ?? 0) + keyword[0].length, (keyword.index ?? 0) + keyword[0].length + 40);
      // A verb commits to a DURATION only as "vous engagez sur/pour 24 mois":
      // "nous nous engageons à livrer en 2 mois", "s'engage depuis 10 ans" and
      // "sur un délai de 3 mois" are promises about time, not a commitment.
      if (/^engag(?:e|ez|eons|er|era)$/.test(keyword[0]) && !/^\s+(?:sur|pour)\s+(?!un délai|une durée de livraison)/.test(window)) continue;
      const duration = window.match(DURATION);
      if (duration) stated.push(toMonths(duration[1], duration[2]));
    }
    for (const match of sentence.matchAll(DURATION_THEN_KEYWORD)) stated.push(toMonths(match[1], match[2]));
  }
  const durations = stated.filter((months) => Number.isFinite(months));
  if (typeof guard.commitmentMonths !== "number") {
    if (saysNone || durations.length) {
      add("COMMITMENT_UNDECLARED", "Draft states a commitment (or its absence) that the offer does not declare");
    }
  } else {
    if (saysNone && guard.commitmentMonths > 0) {
      add("COMMITMENT_CONTRADICTION", `Draft says there is no commitment; the offer declares ${guard.commitmentMonths} months`);
    }
    const wrong = durations.filter((months) => months !== guard.commitmentMonths);
    if (wrong.length) {
      add("COMMITMENT_CONTRADICTION", `Draft states a ${wrong[0]}-month commitment; the offer declares ${guard.commitmentMonths}`);
    }
  }

  // 5. Tax basis.
  const bases = [...source.matchAll(TAX_STATED)].map((m) => (/^(ht|hors)/.test(m[0]) ? "HT" : "TTC"));
  if (bases.length) {
    if (!guard.taxLabel) {
      add("TAX_BASIS_UNDECLARED", "Draft states a tax basis (HT/TTC) that the offer does not declare");
    } else if (bases.some((basis) => basis !== guard.taxLabel)) {
      add("TAX_BASIS_CONTRADICTION", `Draft states a price on another tax basis; the offer's prices are ${guard.taxLabel}`);
    }
  }

  return { passed: violations.length === 0, violations, mentionsCommercialTerms: mentionsCommercialTerms(text), pricesMentioned };
}

function toMonths(amount: string, unit: string): number {
  const n = NUMBER_WORDS[amount] ?? Number(amount);
  return unit.startsWith("mois") ? n : n * 12;
}

/**
 * The approved terms, phrased for a prompt. The model is told exactly what it
 * may say; the check above verifies it said nothing else.
 */
export function describePricingTerms(terms?: PricingTerms | null): string {
  const lines: string[] = [];
  const guard: PricingTerms = terms ?? {};
  const tax = guard.taxLabel ? ` ${guard.taxLabel}` : "";

  if (!guard.canDiscloseInColdReply) {
    lines.push("Price disclosure: NOT allowed. Never state any figure; say the quote is tailored to their needs.");
  } else {
    lines.push("Price disclosure: allowed, using ONLY the figures below, written in digits. Never state any other amount.");
    if (typeof guard.setupFee === "number") {
      lines.push(guard.setupFee === 0 ? "Setup / creation fee: 0 € (free)." : `Setup / creation fee: ${guard.setupFee} €${tax}.`);
    }
    if (typeof guard.monthlyPrice === "number") lines.push(`Monthly price: ${guard.monthlyPrice} €${tax} per month.`);
    if (typeof guard.startingPrice === "number" && guard.startingPrice !== guard.monthlyPrice && guard.startingPrice !== guard.setupFee) {
      lines.push(`Starting price: ${guard.startingPrice} €${tax}.`);
    }
  }

  if (typeof guard.commitmentMonths !== "number") {
    lines.push("Commitment: not declared. Never state a duration, \"sans engagement\" or \"résiliable\".");
  } else if (guard.commitmentMonths > 0) {
    lines.push(`Commitment: ${guard.commitmentMonths} months. Never write "sans engagement", "aucun engagement" or "résiliable à tout moment".`);
  } else {
    lines.push("Commitment: none.");
  }
  if (!guard.taxLabel) lines.push("Never write HT or TTC: the tax basis is not declared.");

  if (guard.setupFee === 0) {
    lines.push("Only the setup / creation is free. Never call the subscription, hosting, maintenance or any month or period free.");
  } else if (!(guard.approvedTerms ?? []).some((term) => new RegExp(FREE_MARKER.source).test(normalize(term)))) {
    lines.push("Nothing is free: never write \"gratuit\" or \"offert\".");
  }
  lines.push("No discount, promo code or free month unless listed in the approved terms.");

  if (guard.approvedTerms?.length) {
    lines.push(`Approved terms (you may state these, verbatim or closely): ${guard.approvedTerms.join(" | ")}`);
  }

  return lines.join("\n");
}
