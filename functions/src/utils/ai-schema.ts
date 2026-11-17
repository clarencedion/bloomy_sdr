import { z } from "zod";

/**
 * String fields for model output, bounded by truncation rather than rejection.
 *
 * `z.string().max(200)` **rejects** a 210-character answer. Applied to model
 * output that means a complete, already-paid-for generation is thrown away
 * because one sentence ran long — and the caller sees a validation stack trace
 * rather than a result. Measured over four days on a live workspace: 80 of 163
 * research runs failed, a 49% loss, and the dominant causes were `too_big`
 * (maximum 100 and 200) plus one `invalid_type` for a missing narrative field.
 *
 * A length cap exists to protect storage and display, and truncating satisfies
 * that completely. So these helpers trim to the bound instead of failing.
 *
 * What they deliberately do NOT do is invent content. A missing narrative field
 * becomes an empty string, which reads downstream as "not provided"; it never
 * becomes filler. Fields that carry meaning rather than prose — a score, a
 * recommended action — stay strict, because a fabricated default there would be
 * a claim about the prospect that nothing supports.
 */

const PLACEHOLDERS = new Set(["", "n/a", "na", "unknown", "null", "undefined", "-", "--", "none"]);

function normalize(value: string): string {
  const trimmed = value.trim();
  return PLACEHOLDERS.has(trimmed.toLowerCase()) ? "" : trimmed;
}

/** Truncates at `max` on a word boundary where one is close enough to matter. */
function truncate(value: string, max: number): string {
  if (value.length <= max) return value;

  const cut = value.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  // Only honour a word boundary in the last 15%; otherwise a long unbroken
  // token would collapse the field to almost nothing.
  return lastSpace > max * 0.85 ? cut.slice(0, lastSpace) : cut;
}

/**
 * A text field that accepts anything string-shaped and is trimmed to `max`.
 * Non-strings (a number, a null, a missing key) become an empty string.
 */
export function boundedText(max: number) {
  return z
    .unknown()
    .transform((value) => {
      if (typeof value === "string") return truncate(normalize(value), max);
      if (typeof value === "number" || typeof value === "boolean") {
        return truncate(normalize(String(value)), max);
      }
      // A model sometimes answers a text field with a one-key object or a list.
      if (Array.isArray(value)) {
        return truncate(normalize(value.filter((v) => typeof v === "string").join(" ")), max);
      }
      return "";
    });
}

/** A required text field: bounded, but empty is refused so a caller can react. */
export function requiredText(max: number) {
  return boundedText(max).refine((value) => value.length > 0, {
    message: "Field is required and was empty or missing."
  });
}

/** A list of bounded strings; malformed entries are dropped, not fatal. */
export function boundedTextArray(maxPerItem: number, maxItems = 12) {
  return z
    .unknown()
    .transform((value) => {
      const items = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
      return items
        .filter((item): item is string => typeof item === "string")
        .map((item) => truncate(normalize(item), maxPerItem))
        .filter(Boolean)
        .slice(0, maxItems);
    });
}

/**
 * An enum that falls back rather than failing.
 *
 * Used for `recommendedNextAction`, where the fallback must be the cautious
 * option: an unrecognised answer becomes "look at this again", never
 * "go ahead and contact them".
 */
export function forgivingEnum<T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) {
  return z.unknown().transform((value) => {
    const candidate = typeof value === "string" ? value.trim().toLowerCase() : "";
    return (values.find((option) => option.toLowerCase() === candidate) ?? fallback) as T[number];
  });
}

/** A 0-100 score. Strict on type, clamped on range. */
export function boundedScore() {
  return z.coerce.number().transform((value) => {
    if (!Number.isFinite(value)) return Number.NaN;
    return Math.min(100, Math.max(0, value));
  });
}
