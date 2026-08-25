import { describe, it, expect } from "vitest";
import { adminDb } from "../config/firebase";
import { backfillV2Migration } from "../migrations/backfill-v2";
import { getBusiness, getOffer, getKnowledgeBase } from "../services/business-service";

describe("Phase 02 — Data Migration & Backfill (REQ-008)", () => {
  const testWorkspaceId = "ws_test_mig_" + Date.now();
  const testDevcommId = "biz_devcomm_mig";

  it("should seed default businesses, offers, and KBs without data loss (REQ-008)", async () => {
    // 1. Create a legacy unassigned company and contact
    const legacyCompRef = await adminDb.collection("companies").add({
      name: "Atelier Floral Test",
      normalizedName: "atelier floral test",
      city: "Nantes",
      status: "imported",
      qualityScore: 85,
      dataQualityWarnings: [],
      sourceConfidence: 90,
      sourceType: "recherche_entreprises",
      // Notice: no workspaceId or businessId
    });

    const legacyContactRef = await adminDb.collection("contacts").add({
      companyId: legacyCompRef.id,
      email: "contact@atelierfloral.fr",
      normalizedEmail: "contact@atelierfloral.fr",
      fullName: "Marie Dupont",
      status: "verified",
      qualityScore: 90,
      dataQualityWarnings: [],
      sourceConfidence: 90,
      sourceType: "recherche_entreprises",
      // Notice: no workspaceId or businessId
    });

    // 2. Run the migration
    const result = await backfillV2Migration({
      defaultWorkspaceId: testWorkspaceId,
      defaultBusinessId: testDevcommId,
      dryRun: false,
    });

    expect(result.workspaceId).toBe(testWorkspaceId);
    expect(result.businessesCreated).toContain(testDevcommId);
    expect(result.businessesCreated).toContain("biz_bloomy");

    // 3. Verify Devcomm and Bloomy business entities exist
    const devcomm = await getBusiness(testWorkspaceId, testDevcommId);
    const bloomy = await getBusiness(testWorkspaceId, "biz_bloomy");

    expect(devcomm).not.toBeNull();
    expect(devcomm?.name).toBe("Devcomm Consulting");

    expect(bloomy).not.toBeNull();
    expect(bloomy?.name).toBe("Bloomy Digital Studio");

    // 4. Verify offers were created
    const devcommOffer = await getOffer(testWorkspaceId, testDevcommId, "off_devcomm_commercial");
    const bloomyOffer = await getOffer(testWorkspaceId, "biz_bloomy", "off_bloomy_website_redesign");

    expect(devcommOffer).not.toBeNull();
    expect(devcommOffer?.targetPersonas.length).toBeGreaterThan(0);

    expect(bloomyOffer).not.toBeNull();
    expect(bloomyOffer?.pricingGuardrails?.startingPrice).toBe(1490);

    // 5. Verify knowledge bases were created
    const devcommKb = await getKnowledgeBase(testWorkspaceId, testDevcommId);
    const bloomyKb = await getKnowledgeBase(testWorkspaceId, "biz_bloomy");

    expect(devcommKb?.pricingRules.length).toBeGreaterThan(0);
    expect(bloomyKb?.pricingRules.length).toBeGreaterThan(0);

    // 6. Verify legacy documents were backfilled with tenant IDs while preserving existing fields
    const migratedCompSnap = await legacyCompRef.get();
    const compData = migratedCompSnap.data();
    expect(compData?.workspaceId).toBe(testWorkspaceId);
    expect(compData?.businessId).toBe(testDevcommId);
    expect(compData?.name).toBe("Atelier Floral Test");
    expect(compData?.city).toBe("Nantes");

    const migratedContactSnap = await legacyContactRef.get();
    const contactData = migratedContactSnap.data();
    expect(contactData?.workspaceId).toBe(testWorkspaceId);
    expect(contactData?.businessId).toBe(testDevcommId);
    expect(contactData?.fullName).toBe("Marie Dupont");

    // Clean up test documents
    await legacyCompRef.delete();
    await legacyContactRef.delete();
  });
});
