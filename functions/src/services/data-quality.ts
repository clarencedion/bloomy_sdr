const placeholders = new Set(["", "n/a", "na", "unknown", "null", "undefined", "-", "--"]);

export function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const cleaned = String(value).trim().replace(/\s+/g, " ");
  if (placeholders.has(cleaned.toLowerCase())) return undefined;
  return cleaned || undefined;
}

export function extractDomain(input: unknown): string | undefined {
  const value = cleanString(input)?.toLowerCase();
  if (!value) return undefined;
  try {
    const url = value.startsWith("http") ? new URL(value) : new URL(`https://${value}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}
