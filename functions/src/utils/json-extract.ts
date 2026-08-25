export function extractFirstJsonObject(raw: string) {
  const withoutFence = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const firstBrace = withoutFence.indexOf("{");
  if (firstBrace === -1) return withoutFence;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = firstBrace; index < withoutFence.length; index += 1) {
    const char = withoutFence[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = inString;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return withoutFence.slice(firstBrace, index + 1);
    }
  }

  return withoutFence.slice(firstBrace);
}
