import type { Contact, DataQualityWarning, SourceMetadata } from "@/types/firestore";

const PLACEHOLDERS = new Set(["", "n/a", "na", "unknown", "null", "undefined", "-", "--", "none", "sans", "inconnu"]);

export function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const cleaned = String(value).trim().replace(/\s+/g, " ");
  if (PLACEHOLDERS.has(cleaned.toLowerCase())) return undefined;
  return cleaned || undefined;
}

export function normalizeCompanyName(value: unknown): string | undefined {
  const cleaned = cleanString(value);
  if (!cleaned) return undefined;
  return cleaned
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(sas|sasu|sarl|sa|eurl|scop|gmbh|ltd|inc)\b/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeEmail(value: unknown): string | undefined {
  const cleaned = cleanString(value)?.toLowerCase();
  if (!cleaned || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) return undefined;
  return cleaned;
}

export function normalizePhone(value: unknown): string | undefined {
  const cleaned = cleanString(value);
  if (!cleaned) return undefined;
  const plus = cleaned.trim().startsWith("+") ? "+" : "";
  const digits = cleaned.replace(/[^\d]/g, "");
  if (digits.length < 6) return undefined;
  return `${plus}${digits}`;
}

export function normalizeFrenchIdentifier(value: unknown, length: 9 | 14): string | undefined {
  const digits = cleanString(value)?.replace(/[^\d]/g, "");
  return digits?.length === length ? digits : undefined;
}

export function extractDomain(input: unknown): string | undefined {
  const value = cleanString(input)?.toLowerCase();
  if (!value) return undefined;

  const fromEmail = value.includes("@") ? value.split("@").pop() : undefined;
  const candidate = fromEmail ?? value;

  try {
    const url = candidate.startsWith("http") ? new URL(candidate) : new URL(`https://${candidate}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    const match = candidate.match(/(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i);
    return match?.[1]?.replace(/^www\./, "");
  }
}

export function scoreQuality(input: {
  name?: string;
  domain?: string;
  siren?: string;
  siret?: string;
  sourceUrl?: string;
  sourceId?: string;
  address?: string;
  city?: string;
  sourceConfidence?: number;
}) {
  let score = 0;
  if (input.name) score += 30;
  if (input.domain) score += 20;
  if (input.siren || input.siret) score += 25;
  else if (input.sourceId) score += 15;
  if (input.sourceUrl) score += 10;
  if (input.address && input.city) score += 10;
  if (input.city) score += 10;
  score += Math.round(Math.min(1, Math.max(0, input.sourceConfidence ?? 0)) * 5);
  return Math.min(100, score);
}

export function qualityWarnings(input: {
  name?: string;
  domain?: string;
  siren?: string;
  siret?: string;
  sourceUrl?: string;
  sourceId?: string;
  address?: string;
  city?: string;
  source?: string;
  sourceConfidence?: number;
}): DataQualityWarning[] {
  const warnings = new Set<DataQualityWarning>();
  if (!input.domain) warnings.add("missing_domain");
  if (!input.city) warnings.add("missing_city");
  if (!input.source && !input.sourceUrl) warnings.add("missing_source");
  if ((input.sourceConfidence ?? 0) < 0.5) warnings.add("low_source_confidence");
  if (!input.domain && !input.siren && !input.siret && !input.sourceId && !(input.address && input.city)) warnings.add("missing_identity_anchor");
  return [...warnings];
}

export function defaultSource(sourceType: SourceMetadata["sourceType"], source?: string, sourceUrl?: string): SourceMetadata {
  return {
    sourceType,
    source: cleanString(source),
    sourceUrl: cleanString(sourceUrl),
    sourceConfidence: sourceType === "manual" ? 0.7 : sourceType === "csv" ? 0.6 : 0.4
  };
}

export function mergeWithoutDowngrade<T extends Record<string, unknown>>(existing: T, incoming: Partial<T>): T {
  const next = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined || value === null || value === "") continue;
    next[key as keyof T] = value as T[keyof T];
  }
  return next;
}

export function buildContactName(contact: Partial<Contact>) {
  return cleanString([contact.firstName, contact.lastName].filter(Boolean).join(" ")) ?? cleanString(contact.fullName);
}
