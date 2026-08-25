import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

describe("Phase 02 — Architectural Invariant 1: Generic SDR Engine (REQ-004)", () => {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const genericServicesDir = path.resolve(currentDir, "../../functions/src/services");

  it("should have zero business-specific or offer-specific hardcoded branching in generic services (REQ-004 & Invariant 1)", () => {
    const files = fs.readdirSync(genericServicesDir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(5);

    const forbiddenPatterns = [
      /if\s*\(\s*.*business(?:Name|Id)?\s*===?\s*["'](?:Bloomy|Devcomm)["']/i,
      /if\s*\(\s*.*offer(?:Name|Category|Type)?\s*===?\s*["'](?:website|commercial)["']/i,
      /switch\s*\(\s*.*business(?:Name|Id)?\s*\)/i,
    ];

    const violations: Array<{ file: string; match: string }> = [];

    for (const file of files) {
      const content = fs.readFileSync(path.join(genericServicesDir, file), "utf8");

      for (const pattern of forbiddenPatterns) {
        const match = content.match(pattern);
        if (match) {
          violations.push({ file, match: match[0] });
        }
      }
    }

    if (violations.length > 0) {
      console.error("Found architectural invariant violations:", violations);
    }

    expect(violations).toEqual([]);
  });
});
