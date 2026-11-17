import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * The opportunity scorer reads evidence by string key. Nothing type-checks that
 * those keys are ones a signal provider actually writes, so the two drifted:
 * eight of twelve keys the scorer read were never emitted by any provider
 * (`has_ssl` vs `ssl_active`, `pagespeed_mobile_score` vs
 * `mobile_pagespeed_score`, ...). Every affected need silently evaluated to
 * `undefined`, so real prospects scored as if they had no problems - while unit
 * fixtures using the scorer's imagined names kept passing.
 *
 * This test pins the contract between the two sides.
 */
describe("Evidence key contract — scorer reads what providers emit", () => {
  // Resolved from cwd so the suite runs from either the repo root or functions/
  // (matching firestore-rules.test.ts), and without `import.meta`, which the
  // CommonJS build target rejects.
  const functionsRoot = fs.existsSync(path.resolve(process.cwd(), "src/providers/signals"))
    ? process.cwd()
    : path.resolve(process.cwd(), "functions");
  const providersDir = path.resolve(functionsRoot, "src/providers/signals");
  const scorerPath = path.resolve(functionsRoot, "src/services/opportunity-scorer.ts");

  const emittedKeys = new Set<string>();
  for (const file of fs.readdirSync(providersDir).filter((f) => f.endsWith("-provider.ts"))) {
    const content = fs.readFileSync(path.join(providersDir, file), "utf8");

    // Evidence written inline as `key: "..."`.
    for (const match of content.matchAll(/key:\s*"([a-z0-9_]+)"/g)) emittedKeys.add(match[1]);

    // Providers that build evidence through a helper declare what they produce
    // in `capabilities`, which is the contract they publish.
    const capabilities = content.match(/readonly capabilities = \[([\s\S]*?)\];/);
    if (capabilities) {
      for (const match of capabilities[1].matchAll(/"([a-z0-9_]+)"/g)) emittedKeys.add(match[1]);
    }
  }

  const scorerSource = fs.readFileSync(scorerPath, "utf8");

  it("collects a meaningful number of provider keys", () => {
    expect(emittedKeys.size).toBeGreaterThan(20);
  });

  it("every key the scorer reads is emitted by at least one provider", () => {
    // Keys are read through readEvidence("primary", "legacy_alias", ...).
    const readCalls = [...scorerSource.matchAll(/readEvidence\(([^)]*)\)/g)];
    expect(readCalls.length).toBeGreaterThan(5);

    const unsatisfied: string[] = [];
    for (const call of readCalls) {
      const keys = [...call[1].matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
      if (keys.length === 0) continue;
      // At least one name in each group must be a real provider key, otherwise
      // that whole signal is dead in production.
      if (!keys.some((key) => emittedKeys.has(key))) unsatisfied.push(keys.join(" | "));
    }

    expect(
      unsatisfied,
      `these scorer signals match no provider key and are dead: ${unsatisfied.join(", ")}`
    ).toEqual([]);
  });

  it("still reads any legacy evidenceMap keys from a real provider", () => {
    const direct = [...scorerSource.matchAll(/evidenceMap\.get\("([a-z0-9_]+)"\)/g)].map((m) => m[1]);
    const dead = direct.filter((key) => !emittedKeys.has(key));
    expect(dead, `dead direct evidence reads: ${dead.join(", ")}`).toEqual([]);
  });

  it("emits the third-party-presence signal the scorer depends on", () => {
    // A prospect whose only web presence is a booking platform has no site of
    // their own - the strongest need signal for website offers.
    expect(emittedKeys.has("third_party_presence_only")).toBe(true);
    expect(scorerSource).toContain("third_party_presence_only");
  });
});
