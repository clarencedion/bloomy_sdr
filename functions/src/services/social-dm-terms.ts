import { checkPricingStatements, mentionsCommercialTerms, type PricingTerms } from "./pricing-guardrail.js";

/**
 * Commercial terms in a first direct message come from the offer, not from
 * the model.
 *
 * Why: in the first batch of 139 live DMs the model stated the price in about
 * a third, left it out of the rest, and paraphrased it when it did ("sans
 * frais initiaux", a monthly figure without its tax basis or commitment). In
 * an offer A/B test, that compares the model's moods, not the offers. When an offer declares a `termsLine`, the model writes only
 * the opening and the closing question, is told never to talk money, and code
 * places the business's own sentence between the two. The model's text is then
 * checked for any commercial wording; the full message is still checked
 * against the offer's terms.
 *
 * Pure: no Firestore, no model call. Nothing here knows what is sold
 * (Invariant 1). French only, like every prompt in this engine.
 */

const LETTERS = "a-zàâäçéèêëîïôöùûüÿœæ";
const L = LETTERS;
const STEM = `[${L}]*`;

/**
 * Words the model's part of a first DM must not contain AT ALL — about our
 * offer or about the prospect. Each entry pairs the word the PROMPT forbids
 * with the pattern the check looks for, and the prompt's list is built from
 * this table (SOCIAL_DM_CODE_TERMS_SYSTEM_PROMPT): a match therefore always
 * means the model used a word it was told not to use, and the draft is
 * rewritten. A pattern that catches a word the prompt does not name ("j'essaie"
 * for "essai", "gracieux" for "gracieusement") is a bug in this table.
 *
 * History, so nobody re-adds exceptions: three adversarial reviews broke every
 * version that tried to tell OUR terms from the prospect's facts with the same
 * words ("votre premier mois offert" vs "votre livraison offerte", "votre
 * engagement de 24 mois" vs "votre engagement pour le bio"). A DM addresses
 * the prospect as "vous", so grammar cannot tell whose it is, and each
 * exception was a hole. The vocabulary is closed instead, and paraphrases no
 * list can foresee go to a second reader, the model judge (social-dm-judge.ts).
 * Stems, not inflections: "paierez", "réglerez", "engagez" are all caught.
 */
const FORBIDDEN_TABLE: Array<[word: string, pattern: string]> = [
  ["gratuit", `gratu${STEM}|gratos`],
  ["offert", `offert${STEM}`],
  ["offre, offrir", `offr${STEM}`],
  ["cadeau", `cadeau${STEM}`],
  ["frais", "frais"],
  ["sans risque", "sans risque"],
  ["zéro", "zéro"],
  ["prix", "prix"],
  ["tarif", `tarif${STEM}`],
  ["coût, coûter", `co[uû]t(?:e|es|ent|er|era|erait|ait|ant|s|eux|euse|euses)?|surco[uû]t${STEM}`],
  ["euro, €, HT, TTC", "euros?|ht|ttc|hors taxes?"],
  // "somme" alone, never "sommes": "nous sommes" is not money.
  ["montant, somme", "montants?|somme|sommes? modiques?"],
  ["sou, centime", "sou|centimes?"],
  ["budget", `budget${STEM}`],
  ["investir, investissement", `investir|investissez|investissons|investissement${STEM}`],
  ["économiser, économique", `économis${STEM}|économiques?`],
  ["rentable", `rentab${STEM}`],
  ["s'autofinancer", `autofinanc${STEM}`],
  ["abordable", `abordable${STEM}`],
  ["pas cher, moins cher", "(?:pas|moins|trop|plus) chers?"],
  ["bon marché", "bon marché"],
  ["pour presque rien", "pour (?:presque|trois fois) rien|bouchée de pain"],
  ["remise", "remis(?:e|es)"],
  ["réduction", `réduc${STEM}`],
  ["promo, promotion", `promos?|promotion${STEM}`],
  ["rabais, ristourne", `rabais|ristourne${STEM}`],
  ["soldes", "soldes?"],
  ["lancement", "lancement"],
  ["découverte", "découverte"],
  ["bienvenue", "bienvenue"],
  ["conditions", "conditions?"],
  ["formule", `formule${STEM}`],
  ["forfait", `forfait${STEM}`],
  ["inclus, tout compris", "inclus|incluse|incluses|tout compris"],
  ["supplément", "suppléments?"],
  ["payer, paiement", "pa(?:y|i)(?:e|er|ez|ons|ent|é|ée|és|ées|ai|era|erez|erons|eront|erai|eriez|erait|ement|ements|able|ables|ant|ante|ants|antes)?"],
  [
    "régler, règlement",
    `r[éè]glement${STEM}|r[éè]gl(?:er|ez|ons|erez|erons|era|eront)|réglée?s?\\s+(?:à|en|par|avant|après|lors|dès)|(?:se|à)\\s+r[éè]gl(?:e|er)`
  ],
  ["encaisser", `encaiss${STEM}`],
  ["débourser", `débours${STEM}`],
  ["dépenser", `dépens${STEM}`],
  ["acompte", `acompte${STEM}`],
  ["verser, versement", "vers(?:er|ez|ons|ement|ements)"],
  ["facture", `factur${STEM}`],
  ["rembourser", `rembours${STEM}`],
  ["avancer de l'argent", "avance(?:r|z|ra)?\\s+(?:rien|de l'argent|de trésorerie)|aucune avance|n'avancez"],
  ["à nos frais, à notre charge", "à (?:nos|notre) (?:frais|charge)"],
  ["c'est pour nous", "(?:est|sont|c'est)\\s+(?:pour|sur)\\s+nous(?=\\s*(?:[.!?,;…]|$))"],
  ["de votre poche", "de (?:votre|sa) poche"],
  ["abonnement", `abonnement${STEM}|abonner`],
  ["mensuel", `mensu${STEM}`],
  ["annuel", `annuel${STEM}`],
  ["mois", "mois"],
  ["engagement, engager", `engag${STEM}`],
  ["obligation, obligatoire", `oblig${STEM}`],
  ["contrat", `contrat${STEM}`],
  ["durée", `durée${STEM}`],
  ["résilier", "résili(?:er|ez|ation|ations|able|ables)"],
  ["essai", "essais?"],
  [
    "libre de partir, sans attache, mettre fin",
    "libre de (?:partir|tout|résilier|arrêter|quitter)|sans attache|mettre fin|(?:partir|partez|arrêter|arrêtez|stopper|stoppez)\\s+(?:à tout moment|quand (?:vous|bon vous) (?:le )?(?:voulez|souhaitez|semble))|li[ée]e?s?\\s+(?:par|à)\\s+rien"
  ],
  ["balles", "\\d+\\s*balles"],
  ["gracieusement", "gracieusement|à titre gracieux"],
  ["moins qu'un … par jour", `moins qu'une?\\s+(?:[${L}'-]+\\s+){1,3}?(?:par|chaque)\\s+(?:jour|semaine)`],
  ["sans mauvaise surprise", "mauvaise surprise"],
  ["geste commercial", "geste commercial"],
  ["à … seulement", "(?:à|pour)\\s+\\d+(?:[.,]\\d+)?\\s+seulement"]
];

/** The words the prompt forbids, in the table's order (SOCIAL_DM_CODE_TERMS_SYSTEM_PROMPT). */
export const FORBIDDEN_WORDS: readonly string[] = FORBIDDEN_TABLE.map(([word]) => word);

const FORBIDDEN = new RegExp(`(?<![${L}])(?:${FORBIDDEN_TABLE.map(([, pattern]) => pattern).join("|")})(?![${L}])|€`);

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[\u00a0\u202f]/g, " ");
}

/**
 * The offer's terms line, when it may be used: the offer allows stating its
 * prices in a first message, and the line says nothing its own terms do not
 * declare. Otherwise `problem` says why it was set aside.
 */
export const TERMS_LINE_UNUSED = "La phrase de conditions de l'offre n'est pas utilisée";
export const EXPERIMENT_WITHOUT_LINE = "Offre en test A/B sans phrase de conditions utilisable";

export function approvedTermsLine(terms?: PricingTerms | null): { line?: string; problem?: string } {
  const line = terms?.termsLine?.trim();
  if (!line) return {};
  if (!terms?.canDiscloseInColdReply) {
    return { problem: `${TERMS_LINE_UNUSED} : l'offre interdit d'annoncer ses prix au premier message.` };
  }
  // It goes into a prompt template: a placeholder in it would be expanded.
  if (/\{\{|\}\}/.test(line)) {
    return { problem: `${TERMS_LINE_UNUSED} : elle contient « {{ » ou « }} ».` };
  }
  const check = checkPricingStatements(line, terms);
  if (!check.passed) {
    return {
      problem: `${TERMS_LINE_UNUSED} : elle contredit les conditions déclarées (${check.violations
        .map((violation) => violation.detail)
        .join(" ; ")}).`
    };
  }
  return { line };
}

/** Commercial findings in a text that must state none: the shared detector (no terms), then the closed vocabulary. */
function rawCopyIssues(source: string): string[] {
  const issues = checkPricingStatements(source, { canDiscloseInColdReply: false }).violations.map((violation) => violation.detail);
  const word = source.match(FORBIDDEN);
  if (word) issues.push(`forbidden word ("${word[0].trim()}")`);
  return issues;
}

/**
 * Everything wrong with text the MODEL wrote when code supplies the terms:
 * any amount, free item, discount, commitment, tax basis, or any word of the
 * closed commercial vocabulary — whoever it is about. Empty means the model
 * left commercial terms to the terms line (as far as words can tell: the
 * judge reads for paraphrases).
 */
export function modelCopyIssues(text: string): string[] {
  return rawCopyIssues(normalize(text));
}

/** Shape problems of the model's two parts, each a warning in French. */
export function dmShapeProblems(parts: { opening: string; question: string }): string[] {
  const problems: string[] = [];
  if (!parts.question) problems.push("Pas de question de clôture : le message se termine sur les conditions.");
  if (parts.question && parts.opening.endsWith("?")) problems.push("L'accroche se termine déjà par une question : le message en pose deux.");
  if (parts.opening && parts.opening.split(/\s+/).filter(Boolean).length < 8) {
    problems.push("Accroche trop courte : rien sur le prospect ni sur ce que nous faisons avant les conditions.");
  }
  return problems;
}

/** The model's opening and question around a terms line stated exactly once; undefined otherwise. */
export function modelPartsOf(body: string, termsLine?: string): { opening: string; question: string } | undefined {
  if (!termsLine) return undefined;
  const pieces = body.split(termsLine);
  return pieces.length === 2 ? { opening: pieces[0].trim(), question: pieces[1].trim() } : undefined;
}

export interface SocialDmReview {
  pricingGuardrailPassed: boolean;
  mentionsCommercialTerms: boolean;
  riskWarnings: string[];
  /** Set when the draft carries a terms line: is it still in the text, word for word? */
  offerTermsLineIntact?: boolean;
}

/**
 * The commercial review of a DM text, generated or edited by a person. With
 * its terms line intact, the line is checked against the offer and the rest
 * by the strict money check — the prospect's own commitments ("votre
 * engagement depuis 15 ans") would otherwise read as ours. Without it, the
 * whole text is checked against the offer, as for any other draft.
 */
export function reviewSocialDmText(input: {
  body: string;
  termsLine?: string;
  terms?: PricingTerms | null;
  /** Findings from outside the word check (the model judge), counted as money talk. */
  extraIssues?: string[];
  /** Check the opening/question shape too (a person's edit; generation reports its own). */
  checkShape?: boolean;
}): SocialDmReview {
  const { body, termsLine } = input;
  const occurrences = termsLine ? body.split(termsLine).length - 1 : 0;
  const intact = termsLine ? occurrences === 1 : undefined;
  const warnings: string[] = [];
  let passed: boolean;
  if (termsLine && intact) {
    const pricing = checkPricingStatements(termsLine, input.terms);
    const [before, after] = body.split(termsLine);
    const issues = [...modelCopyIssues(`${before}\n${after}`), ...(input.extraIssues ?? [])];
    passed = pricing.passed && issues.length === 0;
    warnings.push(
      ...pricing.violations.map((violation) => `Conditions commerciales non validées : ${violation.detail}.`),
      ...issues.map((issue) => `Hors phrase de conditions : ${issue} — les conditions doivent venir uniquement de la phrase de l'offre.`)
    );
    if (input.checkShape) warnings.push(...dmShapeProblems({ opening: before.trim(), question: after.trim() }));
  } else {
    const pricing = checkPricingStatements(body, input.terms);
    passed = pricing.passed && occurrences < 2;
    if (termsLine && occurrences > 1) {
      warnings.push("La phrase de conditions de l'offre apparaît plusieurs fois : le message répète ses conditions.");
    } else if (termsLine) {
      warnings.push("La phrase de conditions de l'offre a été modifiée ou retirée : ce DM ne compte plus à l'identique dans le test A/B.");
    }
    warnings.push(...pricing.violations.map((violation) => `Conditions commerciales non validées : ${violation.detail}.`));
  }
  return {
    pricingGuardrailPassed: passed,
    mentionsCommercialTerms: mentionsCommercialTerms(body),
    riskWarnings: warnings,
    ...(termsLine ? { offerTermsLineIntact: Boolean(intact) } : {})
  };
}

/**
 * Whether offer copy states a term (a figure, free wording, a commitment, a
 * subscription). Narrower than the closed vocabulary, which is a rule for
 * what the MODEL writes: an offer named "Offre vitrine" states no term.
 */
const STATES_TERMS = new RegExp(`€|(?<![${L}])(?:euros?|ht|ttc|gratu${STEM}|offert${STEM}|engag${STEM}|abonn${STEM}|mensu${STEM}|mois|frais)(?![${L}])`);
function statesTerms(text: string): boolean {
  const source = normalize(text);
  return STATES_TERMS.test(source) || checkPricingStatements(source, { canDiscloseInColdReply: false }).violations.length > 0;
}

const SEPARATOR = /\s[—–-]\s|\s?:\s|\s\(/;

/**
 * The offer as the model may see it when code supplies the terms: lines that
 * state a term are withheld, and an offer name is cut before its first
 * priced segment ("Pack vitrine — 0 € de mise en place, 49 € HT/mois" →
 * "Pack vitrine"). The model still reads the terms line itself (its opening
 * has to lead into it), but no other phrasing of the terms to paraphrase. A
 * figure written without any money word ("Formule 0+49") is not recognised.
 */
export function offerWithoutTerms<T extends { name?: string; valuePropositions?: string[]; proofPoints?: string[] }>(offer: T): T {
  const kept: string[] = [];
  for (const segment of String(offer.name ?? "").split(SEPARATOR)) {
    if (statesTerms(segment)) break;
    kept.push(segment.trim());
  }
  // "Votre premier mois offert" in the offer's own copy is a term like any other.
  const clean = (lines?: string[]) => (lines ?? []).filter((line) => !rawCopyIssues(normalize(String(line))).length);
  return {
    ...offer,
    name: kept.filter(Boolean).join(" — "),
    valuePropositions: clean(offer.valuePropositions),
    proofPoints: clean(offer.proofPoints)
  };
}

/**
 * The model's two parts. A closing question left at the end of the opening
 * (and no separate one) is moved after the terms line, where it belongs.
 */
export function splitModelDm(output: { body?: unknown; cta?: unknown }): { opening: string; question: string } {
  let opening = String(output.body ?? "").trim();
  let question = String(output.cta ?? "").trim();
  if (!question && opening.endsWith("?")) {
    const sentences = opening.split(/(?<=[.!?…])\s+/);
    if (sentences.length > 1) {
      question = sentences.pop() ?? "";
      opening = sentences.join(" ").trim();
    }
  }
  return { opening, question };
}

/** Opening, the business's own terms line, then the question — one paragraph each. */
export function composeSocialDm(parts: { opening: string; termsLine: string; question: string }): string {
  return [parts.opening, parts.termsLine, parts.question]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
}
