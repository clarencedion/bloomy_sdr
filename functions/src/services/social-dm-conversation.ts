import { checkPricingStatements, commercialWordIn, mentionsCommercialTerms, type PricingTerms } from "./pricing-guardrail.js";
import { modelCopyIssues, type SocialDmReview } from "./social-dm-terms.js";
import { isOnlinePresenceFact, presenceWordIn } from "./social/dm-observations.js";

/**
 * A first direct message that opens a conversation instead of stating an
 * offer.
 *
 * Why: the first real DMs (2026-11-11) read as canvassing — a compliment,
 * what we sell, then a price line and a question. A stranger's first
 * message that pitches and prices is the kind that gets ignored: what the
 * practitioners' guides agree on is a short message, one specific true detail
 * about the recipient, no pitch, no price, no link, and one easy question.
 * The offer's terms then come in the reply to someone who answered, which the
 * owner reads and sends (social-inbound.ts, with the prospect's own variant).
 *
 * A business opts in with `socialDmOpening` (data, Invariant 1). The message
 * then has up to four parts, two written by the model and two by code:
 *   1. the opening — the model: a greeting and one good thing true about THEM;
 *   2. the observation — code, optional: one sentence about a gap the
 *      evidence states plainly (social/dm-observations.ts). What must be true
 *      is not left to the model;
 *   3. the intro line — the business's own sentence, inserted word for word
 *      by code: who is writing and what the business does. It is the sender's
 *      identity, so it is never left to the model (a stranger must be able to
 *      tell who writes and why), and the model never sees it (it holds a
 *      person's name);
 *   4. the question — the model: one short, easy question.
 * No commercial term anywhere, and the model's parts say nothing of the
 * prospect's online presence: they are held to two closed vocabularies (and
 * the model judge for commercial paraphrases), like the parts around a terms
 * line.
 *
 * Pure: no Firestore, no model call. Nothing here knows what is sold.
 */

export interface SocialDmOpening {
  /** "conversation": no commercial term in the first message. Anything else: the offer's terms line, as before. */
  style?: string;
  /** Who writes and what the business does, in the sender's own words. One sentence or two, no line break. */
  introLine?: string;
  /** Which observations code may state about the prospect, in order of preference (dm-observations.ts `OBSERVATION_KINDS`). */
  observations?: string[];
}

export const INTRO_LINE_UNUSED = "La phrase de présentation n'est pas utilisée";

/**
 * Evidence that identifies, locates or registers a business: true, and
 * nothing a person would open a message with. On the first live drafts these
 * filled the model's twelve facts ahead of the reviews, and the openings read
 * "vous êtes situé au 55 boulevard…".
 */
const NOT_A_CONVERSATION_FACT =
  /(?:^|_)(?:cid|phone|fax|siren|siret|naf|ape|vat|tva|postal|postcode|zip|address|adresse|street|url|link|email|handle|id|lat|lng|lon)(?:_|$)|^(?:legal_name|administrative_status|employee_bracket|operational_status|city)$/i;
/**
 * Headcount and number of establishments come from the company register,
 * matched by name: on the live drafts a tattoo studio was told it had "quatre
 * établissements" — those of a namesake. Too uncertain to open a message on.
 */
const REGISTER_FACT = /^(?:employee|establishment)(?:_|[A-Z]|$)/;
/** A year or a date: the message states none (a duration is a term in waiting), so the model is not handed one. */
const DATED_FACT = /(?:^|_)(?:year|date|since|founded)(?:_|$)/i;
/**
 * The verified facts a conversation opening may be built on: none that
 * identifies or registers the business, none about its online presence
 * (that subject is the code's: dm-observations.ts), those the engine knows
 * how to say in words first (a bare "key : value" is
 * harder to use well), at most `limit`. Offer-neutral.
 */
export function conversationFacts<T extends { key: string; label: string; value: unknown }>(facts: T[], limit = 12): T[] {
  const usable = facts.filter(
    (fact) =>
      !NOT_A_CONVERSATION_FACT.test(fact.key) && !DATED_FACT.test(fact.key) && !REGISTER_FACT.test(fact.key) && !isOnlinePresenceFact(fact.key)
  );
  const worded = (fact: T) => fact.label !== `${fact.key.replace(/_/g, " ")} : ${String(fact.value)}`;
  return [...usable.filter(worded), ...usable.filter((fact) => !worded(fact))].slice(0, limit);
}

const INTRO_MAX_CHARS = 220;
const INTRO_MIN_CHARS = 20;
const INTRO_MIN_WORDS = 4;
/** The model's parts, in words: past these a first DM reads as a pitch again. */
export const OPENING_MAX_WORDS = 30;
export const QUESTION_MAX_WORDS = 22;

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/**
 * The business's intro line, when it may be used: the business chose the
 * conversation style, and the line is one short paragraph that states no
 * commercial term. Nothing at all when the business did not opt in; `problem`
 * when it did and the line cannot be used.
 */
export function approvedIntroLine(opening?: SocialDmOpening | null): { line?: string; problem?: string } {
  if (!opening || opening.style !== "conversation") return {};
  const line = typeof opening.introLine === "string" ? opening.introLine.trim() : "";
  if (!line) return { problem: `${INTRO_LINE_UNUSED} : elle est vide.` };
  // Any line break or control character, the Unicode line separators included.
  if (/[\p{Cc}\u2028\u2029]/u.test(line)) return { problem: `${INTRO_LINE_UNUSED} : elle doit tenir sur une seule ligne.` };
  if (line.length > INTRO_MAX_CHARS) return { problem: `${INTRO_LINE_UNUSED} : elle dépasse ${INTRO_MAX_CHARS} caractères.` };
  if (/\{\{|\}\}|[<>]/.test(line)) return { problem: `${INTRO_LINE_UNUSED} : elle contient « {{ », « }} », « < » ou « > ».` };
  // It says who writes and what the business does: a sentence, not a word or a full stop.
  if (line.length < INTRO_MIN_CHARS || wordCount(line) < INTRO_MIN_WORDS || !/[a-zà-ÿ]{3}/i.test(line)) {
    return { problem: `${INTRO_LINE_UNUSED} : elle est trop courte pour dire qui écrit et ce que fait l'entreprise.` };
  }
  // No link and no number to call in a stranger's first message.
  if (/https?:\/\/|www\.|(?<![a-z0-9])[a-z0-9-]+\.(?:fr|com|net|org|io|one|co)(?![a-z])|(?:\d[ .-]?){8,}/i.test(line)) {
    return { problem: `${INTRO_LINE_UNUSED} : elle contient une adresse web ou un numéro.` };
  }
  const issues = modelCopyIssues(line);
  if (issues.length || mentionsCommercialTerms(line)) {
    return {
      problem: `${INTRO_LINE_UNUSED} : elle parle de conditions commerciales${issues.length ? ` (${issues.join(" ; ")})` : ""}, ce qu'un premier message de ce style ne fait pas.`
    };
  }
  return { line };
}

/** Opening, the observation if there is one, and the intro line in one paragraph; then the question on its own. */
export function composeConversationDm(parts: { opening: string; observationLine?: string; introLine: string; question: string }): string {
  const first = [parts.opening, parts.observationLine ?? "", parts.introLine]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
  return [first, parts.question.trim()].filter(Boolean).join("\n\n");
}

/**
 * The model's opening and question, around an intro line stated exactly once
 * and — when the draft carries one — an observation stated exactly once
 * before it; undefined otherwise.
 */
export function conversationPartsOf(body: string, introLine?: string, observationLine?: string): { opening: string; question: string } | undefined {
  if (!introLine) return undefined;
  const pieces = body.split(introLine);
  if (pieces.length !== 2) return undefined;
  let opening = pieces[0];
  if (observationLine) {
    // Code put it right before the intro line: anywhere else, a person moved it or the text is not ours.
    if (body.split(observationLine).length !== 2 || !opening.trimEnd().endsWith(observationLine)) return undefined;
    opening = opening.trimEnd().slice(0, -observationLine.length);
  }
  return { opening: opening.trim(), question: pieces[1].trim() };
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Words a business name is built with and that name nobody: articles, and what any small business is. */
const COMMON_NAME_WORD =
  /^(?:les?|la|des?|du|aux?|une?|and|the|et|chez|studio|studios|atelier|ateliers|agence|agences|cabinet|maison|groupe|compagnie|société|societe|salon|boutique|shop|store|lab|labo|digital|web|design|conseil|consulting|services?|solutions?|france|paris|pro)$/i;

/**
 * Shape problems of the model's two parts, each a warning in French. The
 * intro line says who writes: a second introduction by the model, or the
 * business named again, makes the message a pitch.
 */
export function conversationShapeProblems(
  parts: { opening: string; question: string },
  context: { businessName?: string } = {}
): string[] {
  const problems: string[] = [];
  const { opening, question } = parts;
  if (!question) problems.push("Pas de question de clôture : le message ne demande rien au prospect.");
  if (question && opening.endsWith("?")) problems.push("L'accroche se termine déjà par une question : le message en pose deux.");
  if (question && (question.match(/\?/g) ?? []).length > 1) problems.push("La clôture pose plusieurs questions : une seule, facile à répondre.");
  if (opening && wordCount(opening) < 5) problems.push("Accroche trop courte : rien de précis sur le prospect.");
  if (wordCount(opening) > OPENING_MAX_WORDS) problems.push(`Accroche trop longue (plus de ${OPENING_MAX_WORDS} mots) : un premier message se lit en quelques secondes.`);
  if (wordCount(question) > QUESTION_MAX_WORDS) problems.push(`Question trop longue (plus de ${QUESTION_MAX_WORDS} mots).`);
  const modelText = `${opening}\n${question}`;
  if (/https?:\/\/|www\.|(?<![a-z0-9])[a-z0-9-]+\.(?:fr|com|net|org|io|one|co)(?![a-z])/i.test(modelText)) {
    problems.push("Le message contient une adresse web : pas de lien dans un premier message.");
  }
  // The business named again by the model: its whole name, or one of its
  // name's own words. The common nouns a name is built with ("Studio",
  // "Atelier", "Agence") are also what the prospect is: "votre studio"
  // introduces nobody. A name made only of such words is looked for whole.
  const name = (context.businessName ?? "").trim();
  const ownWords = name.split(/[^\p{L}\p{N}]+/u).filter((part) => part.length >= 3 && !COMMON_NAME_WORD.test(part));
  const lookedFor = ownWords.length ? ownWords : name.length >= 3 ? [name] : [];
  const namedAgain = lookedFor.some((part) =>
    new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(part).replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`, "iu").test(modelText)
  );
  if (/(?<![a-zà-ÿ])je m'appelle(?![a-zà-ÿ])/i.test(modelText.replace(/[’`]/g, "'")) || namedAgain) {
    problems.push("Le texte se présente une seconde fois : la phrase de présentation le fait déjà.");
  }
  return problems;
}

/** The warning for a word of the closed subject vocabulary in the model's text. */
export function presenceWarning(word: string): string {
  return `Parle de leur présence en ligne (« ${word} ») : c'est au code de l'écrire, à partir des faits vérifiés. Ce message ne part pas en automatique.`;
}

/** The warning for a word of the broad commercial vocabulary the prompt does not name. */
export function broadWordWarning(word: string): string {
  return `Mot du vocabulaire commercial (« ${word} ») : ce message ne part pas en automatique, relisez-le ou reformulez.`;
}

export interface ConversationDmReview extends SocialDmReview {
  /** Are the code's own sentences (the intro line, and the observation if the draft has one) still in the text, word for word, in place? */
  dmIntroLineIntact: boolean;
}

/**
 * The review of a conversation-style DM text, generated or edited by a
 * person. With the code's sentences intact, everything around them must state
 * no commercial term (closed vocabulary; the judge's findings come in
 * `extraIssues`) and say nothing of the prospect's online presence. Without
 * them — a person rewrote the message — the whole text is checked against the
 * offer like any other draft, and the draft says the introduction is gone.
 */
export function reviewConversationDm(input: {
  body: string;
  introLine: string;
  observationLine?: string;
  terms?: PricingTerms | null;
  extraIssues?: string[];
  /** Check the shape too (a person's edit; generation reports its own). */
  checkShape?: boolean;
  businessName?: string;
}): ConversationDmReview {
  const { body, introLine } = input;
  const parts = conversationPartsOf(body, introLine, input.observationLine);
  const warnings: string[] = [];
  let passed: boolean;
  if (parts) {
    const modelText = `${parts.opening}\n${parts.question}`;
    const issues = [...modelCopyIssues(modelText), ...(input.extraIssues ?? [])];
    passed = issues.length === 0;
    warnings.push(...issues.map((issue) => `Condition commerciale dans un premier message qui n'en annonce aucune : ${issue}.`));
    const presence = presenceWordIn(modelText);
    if (presence) warnings.push(presenceWarning(presence));
    // Named, or the draft would look clean and never leave (conversationAutoHoldReason).
    const broad = issues.length ? undefined : commercialWordIn(modelText);
    if (broad) warnings.push(broadWordWarning(broad));
    if (input.checkShape) warnings.push(...conversationShapeProblems(parts, { businessName: input.businessName }));
  } else {
    const pricing = checkPricingStatements(body, input.terms);
    passed = pricing.passed;
    const introCount = body.split(introLine).length - 1;
    warnings.push(
      introCount > 1
        ? "La phrase de présentation apparaît plusieurs fois."
        : introCount === 1
          ? "La phrase d'observation écrite par le code a été modifiée, déplacée ou retirée : ce message ne part pas en automatique."
          : "La phrase de présentation a été modifiée ou retirée : le prospect ne sait plus qui lui écrit.",
      ...pricing.violations.map((violation) => `Conditions commerciales non validées : ${violation.detail}.`)
    );
  }
  return {
    pricingGuardrailPassed: passed,
    mentionsCommercialTerms: mentionsCommercialTerms(body),
    riskWarnings: warnings,
    dmIntroLineIntact: Boolean(parts)
  };
}

/**
 * Why a conversation-style draft may not leave unread, from its text alone,
 * or undefined. Nobody reads it before it goes, so nothing is taken from the
 * stored review: the code's sentences are in the text, in place, exactly
 * once; the whole text touches no commercial vocabulary — the closed list
 * the model was given AND the broad one (pricing-guardrail.ts), which also
 * catches durations and percentages; and what the model wrote says nothing
 * of the prospect's online presence. A harmless "depuis 10 ans" is held too;
 * it costs the owner one key in a session with keys.
 */
export function conversationAutoHoldReason(body: string, introLine: string, observationLine?: string): string | undefined {
  if (body.split(introLine).length !== 2) return "intro_line_not_intact";
  const parts = conversationPartsOf(body, introLine, observationLine);
  if (!parts) return "observation_line_not_intact";
  // A text made only of the code's sentences was composed by nobody.
  if (!parts.opening || !parts.question) return "model_part_missing";
  if (modelCopyIssues(body).length || mentionsCommercialTerms(body)) return "states_commercial_terms";
  if (presenceWordIn(`${parts.opening}\n${parts.question}`)) return "speaks_of_online_presence";
  return undefined;
}
