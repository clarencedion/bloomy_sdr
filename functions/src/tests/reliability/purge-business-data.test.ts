import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PURGE_PROTECTED_COLLECTIONS } from "../../services/purge-business-data.js";

// The suite runs from the repo root and from functions/, so resolve both.
const cwd = process.cwd();
const base = cwd.endsWith("/functions") ? cwd : join(cwd, "functions");
const source = readFileSync(join(base, "src/services/purge-business-data.ts"), "utf8");

/**
 * A purge is irreversible and runs against live data, so what it must NOT do
 * matters more than what it does. These tests pin the exclusions.
 */
describe("Purging a business's data", () => {
  it("never deletes the do-not-contact list", () => {
    // Someone who asked never to be contacted must stay suppressed. Forgetting
    // them would let the SDR mail them again on the next run.
    expect(PURGE_PROTECTED_COLLECTIONS).toContain("suppressionList");

    const scopedList = source.slice(source.indexOf("const SCOPED_COLLECTIONS"), source.indexOf("] as const;"));
    expect(scopedList).not.toContain("suppressionList");
  });

  it("keeps spend history and settings", () => {
    expect(PURGE_PROTECTED_COLLECTIONS).toContain("apiSpendDaily");
    expect(PURGE_PROTECTED_COLLECTIONS).toContain("settings");

    const scopedList = source.slice(source.indexOf("const SCOPED_COLLECTIONS"), source.indexOf("] as const;"));
    expect(scopedList).not.toContain("apiSpendDaily");
  });

  it("leaves the business's own configuration untouched", () => {
    // Offers, knowledge base and sender identities live under the business
    // document. Nothing here may reach into that path.
    expect(source).not.toContain("/offers");
    expect(source).not.toContain("/knowledgeBase");
    expect(source).not.toContain("/senderIdentities");
  });

  it("requires the business name to be retyped", () => {
    expect(source).toContain("confirmName");
    expect(source).toContain("Type the business name exactly to confirm");
  });

  it("sweeps unassigned documents only while this is the only business", () => {
    // An unstamped document shows under every business, so with a second one
    // this purge has no mandate over it.
    expect(source).toContain("businessCount <= 1");
  });

  it("removes conversation threads recursively so no messages are orphaned", () => {
    expect(source).toContain("recursiveDelete");
    expect(source).toContain('collectionName === "conversations"');
  });

  it("deletes in batches under the Firestore write limit", () => {
    const batchSize = Number(source.match(/const BATCH_SIZE = (\d+);/)?.[1]);
    expect(batchSize).toBeGreaterThan(0);
    expect(batchSize).toBeLessThanOrEqual(500);
  });
});
