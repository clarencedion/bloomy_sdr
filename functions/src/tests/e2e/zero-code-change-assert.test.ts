import { describe, it, expect } from "vitest";
import { runDualFixtureValidation, BLOOMY_FIXTURE_CONFIG, DEVCOMM_FIXTURE_CONFIG } from "../fixtures/e2e-fixture-runner.js";
import { getKnowledgeBase, listOffers } from "../../services/business-service.js";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Phase 16 — Multi-Business Dual-Fixture & Zero Code Change Verification (REQ-001 through REQ-080)", () => {
  const workspaceId = "ws_dual_verify_" + Date.now();

  it("should run dual-fixture validation and prove complete multi-tenant genericity and isolation", async () => {
    const dualResult = await runDualFixtureValidation({
      workspaceId,
      testId: "test_dual_assert_" + Date.now(),
      mode: "both"
    });

    expect(dualResult.success).toBe(true);
    expect(dualResult.bloomyResult?.success).toBe(true);
    expect(dualResult.devcommResult?.success).toBe(true);

    // 1. Assert Signal Divergence (Web Audits present for Bloomy, omitted for Devcomm)
    expect(dualResult.comparison.signalsDivergenceVerified).toBe(true);
    expect(dualResult.bloomyResult?.icpTranslation.enabledSignalProviders).toContain("website_technical");
    expect(dualResult.devcommResult?.icpTranslation.enabledSignalProviders).not.toContain("website_technical");
    expect(dualResult.devcommResult?.icpTranslation.enabledSignalProviders).toContain("company_scale");
    expect(dualResult.devcommResult?.icpTranslation.enabledSignalProviders).toContain("company_hiring");

    // 2. Assert Persona Divergence
    expect(dualResult.comparison.personaDivergenceVerified).toBe(true);
    expect(dualResult.bloomyResult?.personaMatched.role).toContain("Gérante");
    expect(dualResult.devcommResult?.personaMatched.role).toContain("Directeur Commercial");

    // 3. Assert Strict Cross-Tenant Knowledge Base & Offer Isolation (REQ-007, Invariant 8)
    expect(dualResult.comparison.knowledgeIsolationVerified).toBe(true);

    const bloomyOffers = await listOffers(workspaceId, "biz_bloomy");
    const devcommOffers = await listOffers(workspaceId, "biz_devcomm");
    expect(bloomyOffers.length).toBe(1);
    expect(devcommOffers.length).toBe(1);
    expect(bloomyOffers[0].id).toBe(BLOOMY_FIXTURE_CONFIG.offer.id);
    expect(devcommOffers[0].id).toBe(DEVCOMM_FIXTURE_CONFIG.offer.id);

    const bloomyKb = await getKnowledgeBase(workspaceId, "biz_bloomy");
    const devcommKb = await getKnowledgeBase(workspaceId, "biz_devcomm");
    expect(JSON.stringify(bloomyKb)).not.toContain("Qualiopi");
    expect(JSON.stringify(bloomyKb)).not.toContain("OPCO");
    expect(JSON.stringify(devcommKb)).not.toContain("bouquets");
    expect(JSON.stringify(devcommKb)).not.toContain("PageSpeed");
  }, 25000);

  it("should verify static code invariance: ZERO business-specific branching in generic services (Invariant 1)", () => {
    // Search services in functions/src/services or src/services
    const possibleDirs = [
      path.resolve(process.cwd(), "functions/src/services"),
      path.resolve(process.cwd(), "src/services")
    ];

    const servicesDir = possibleDirs.find(d => fs.existsSync(d));
    expect(servicesDir).toBeDefined();

    const serviceFiles = fs.readdirSync(servicesDir!).filter(f => f.endsWith(".ts"));
    expect(serviceFiles.length).toBeGreaterThanOrEqual(25);

    const forbiddenPatterns = [
      /if\s*\(\s*(?:business|businessName|businessId|company\.businessId)\s*===\s*["']Bloomy["']/i,
      /if\s*\(\s*(?:business|businessName|businessId|company\.businessId)\s*===\s*["']Devcomm["']/i,
      /if\s*\(\s*businessId\s*===\s*["']biz_bloomy["']\s*\)/i,
      /if\s*\(\s*offer\.category\s*===\s*["']website["']\s*\)\s*runPageSpeed/i
    ];

    const violations: string[] = [];

    for (const file of serviceFiles) {
      const filePath = path.join(servicesDir!, file);
      const content = fs.readFileSync(filePath, "utf-8");

      for (const pattern of forbiddenPatterns) {
        if (pattern.test(content)) {
          violations.push(`Violation of Invariant 1 in ${file}: matches forbidden pattern ${pattern.toString()}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
