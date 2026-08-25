import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Firestore Security Rules Verification (REQ-009 & Invariant 2)", () => {
  const rulesPath = fs.existsSync(path.resolve(process.cwd(), "firestore.rules"))
    ? path.resolve(process.cwd(), "firestore.rules")
    : path.resolve(process.cwd(), "../firestore.rules");
  const rulesContent = fs.readFileSync(rulesPath, "utf-8");

  it("should exist and specify rules_version 2", () => {
    expect(rulesContent).toContain("rules_version = '2'");
    expect(rulesContent).toContain("service cloud.firestore");
  });

  it("should strictly disallow client reads/writes on secret settings documents", () => {
    // Check that settings match block allows global for signedIn but rejects all other settingsIds (aiSecrets, integrationSecrets, etc.)
    expect(rulesContent).toMatch(/match\s+\/settings\/\{settingsId\}\s*\{/);
    expect(rulesContent).toContain('allow read, write: if signedIn() && settingsId == "global";');
    expect(rulesContent).toContain("allow read, write: if false;");

    // Ensure legacy vulnerable permissive settings rules are completely removed
    expect(rulesContent).not.toContain('settingsId in ["aiSecrets"');
    expect(rulesContent).not.toContain("allow read: if signedIn() && settingsId in");
  });

  it("should strictly disallow direct client read/write to webhookEvents collection", () => {
    expect(rulesContent).toMatch(/match\s+\/webhookEvents\/\{eventId\}\s*\{[\s\S]*?allow read,\s*write:\s*if false;/);
    expect(rulesContent).not.toContain("allow create: if true;");
  });

  it("should allow signedIn users to manage suppressionList collection", () => {
    expect(rulesContent).toMatch(/match\s+\/suppressionList\/\{entryId\}\s*\{[\s\S]*?allow read,\s*create,\s*update,\s*delete:\s*if signedIn\(\);/);
  });

  it("should have a default catch-all deny rule", () => {
    expect(rulesContent).toMatch(/match\s+\/\{document=\*\*\}\s*\{[\s\S]*?allow read,\s*write:\s*if false;/);
  });
});
