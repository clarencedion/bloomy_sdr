/**
 * Figures in a message nobody will read before it leaves (an automatic
 * session, ADR-024): each one must be a figure the verified evidence holds.
 *
 * The claim validator checks the kinds of figure it knows (reviews, rating,
 * staff, a score). This is the net under it: ANY number the model wrote about
 * a prospect — followers, a founding year, "24h/24" — that no verified fact
 * of the prospect's record carries makes the draft wait for a person. So does
 * a quantity spelled in words ("près de mille avis"), which cannot be
 * compared at all.
 *
 * It compares numbers, not what they count: "5 ans d'expérience" passes for a
 * business rated 5. It narrows what an unread message can invent; it does not
 * prove the message true.
 *
 * Pure. Nothing here knows what a business sells (Invariant 1).
 */

/** Integers and decimals as written in French or English: "4,9", "4.9", "1 200", "2015". */
const FIGURE = /\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g;

/** Quantities in words: they claim a size and cannot be checked against a number. */
const SPELLED_QUANTITY = /(?<![\p{L}])(mille|milliers?|millions?|milliards?|centaines?|cents?|dizaines?|douzaines?|thousands?|hundreds?|dozens?|millions?)(?![\p{L}])/iu;

export function figuresIn(text: string): number[] {
  return [...String(text ?? "").matchAll(FIGURE)]
    .map((match) => Number(match[0].replace(/[ \u00a0\u202f]/g, "").replace(",", ".")))
    .filter((value) => Number.isFinite(value));
}

/** Evidence that identifies or locates a business, not a fact a message would quote as a figure. */
const IDENTIFIER_KEY = /phone|tel|fax|siren|siret|naf|ape|vat|tva|postal|postcode|zip|address|adresse|street|url|link|email|handle|_id$|^id$|lat|lng|lon/i;

/**
 * The numbers a prospect's verified record holds: NUMERIC evidence values
 * that are facts (a count, a rating, a score, a year) — never the digits of a
 * phone number, a registration number or an address, which would vouch for
 * any small figure — and the numbers in the company's own name and town
 * ("Tattoo 13", "Paris 10"). Evidence under the confidence the outreach rules
 * require (70) holds nothing.
 */
export function knownFigures(
  evidenceItems: Array<{ key?: unknown; value?: unknown; confidence?: number }>,
  company: Record<string, unknown>
): number[] {
  const known: number[] = [];
  for (const item of evidenceItems) {
    if (typeof item.confidence !== "number" || item.confidence < 70) continue;
    if (typeof item.value !== "number" || !Number.isFinite(item.value)) continue;
    if (IDENTIFIER_KEY.test(String(item.key ?? ""))) continue;
    known.push(item.value);
  }
  for (const key of ["name", "city"]) {
    if (typeof company[key] === "string") known.push(...figuresIn(company[key] as string));
  }
  return known;
}

function matchesKnown(figure: number, known: number[]): boolean {
  return known.some((value) => {
    if (Math.abs(figure - value) < 1e-9) return true;
    // A rating is quoted to one decimal: 4.9 for a verified 4.92. The half
    // is included: 30.15 reads "30,1" or "30,2" depending on who rounds.
    return !Number.isInteger(value) && Math.abs(figure - value) <= 0.05 + 1e-9;
  });
}

/** "plus de 700 avis", "1 200 avis": a review count, compared (with rounding) by the claim validator. */
const REVIEW_COUNT = /(?<![\d.,])(?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+)(\s*avis)/gi;
/** "4,9/5", "4,9 sur 5", "41/100": the scale a score is given on is not a claim; the score is. */
const SCORE_SCALE = /(\d(?:[.,]\d+)?)\s*(?:\/|sur)\s*(?:5|10|20|100)(?!\d|[.,]\d)/gi;

/**
 * What in `text` no verified figure stands behind: the figures themselves, as
 * written, and the first quantity spelled in words. Empty when everything
 * checks out.
 *
 * A figure must BE a verified one: no rounding here, because a number says
 * nothing of what it counts ("120 abonnés" is not a rounded "112 avis").
 * Review counts written as "N avis" are left to the claim validator, which
 * knows what they count and allows the rounding a person would make.
 */
export function unverifiedFigures(text: string, known: number[]): string[] {
  const cleaned = String(text ?? "").replace(REVIEW_COUNT, "$1").replace(SCORE_SCALE, "$1 ");
  const problems = figuresIn(cleaned)
    .filter((figure) => !matchesKnown(figure, known))
    .map((figure) => String(figure));
  const spelled = String(text ?? "").match(SPELLED_QUANTITY);
  if (spelled) problems.push(spelled[0]);
  return [...new Set(problems)];
}
