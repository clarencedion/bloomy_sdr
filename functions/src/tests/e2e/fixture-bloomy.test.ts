import { describe, it, expect } from "vitest";
import { runBloomyE2EFixture, BLOOMY_FIXTURE_CONFIG } from "../fixtures/e2e-fixture-runner.js";
import { getBusiness, getKnowledgeBase, listOffers } from "../../services/business-service.js";

describe("Phase 16 — Fixture A: Bloomy Digital Studio E2E Simulation (REQ-001 through REQ-080)", () => {
  const workspaceId = "ws_test_bloomy_" + Date.now();

  it("should execute complete E2E workflow for Bloomy Digital Studio (Florists & Web/E-Commerce Redesign)", async () => {
    const result = await runBloomyE2EFixture({
      workspaceId,
      testId: "test_bloomy_run_" + Date.now()
    });

    // 1. Assert overall execution success
    expect(result.success).toBe(true);
    expect(result.businessId).toBe("biz_bloomy");
    expect(result.fixtureName).toContain("Bloomy Digital Studio");

    // 2. Assert Natural Language ICP Translation resolved florist NAF and website signals
    expect(result.icpTranslation.nafCodes).toContain("47.76Z");
    expect(result.icpTranslation.cities).toContain("Nantes");
    expect(result.icpTranslation.enabledSignalProviders).toContain("company_registry");
    expect(result.icpTranslation.enabledSignalProviders).toContain("google_places");
    expect(result.icpTranslation.enabledSignalProviders).toContain("website_technical");
    expect(result.icpTranslation.enabledSignalProviders).toContain("website_ecommerce");

    // 3. Assert Discovered Lead & Signals Collected
    expect(result.discoveredLead.companyName).toBe("Fleurs de Nantes");
    expect(result.discoveredLead.siren).toBe("891234567");
    expect(result.discoveredLead.city).toBe("Nantes");
    expect(result.signalsCollected.length).toBeGreaterThanOrEqual(4);

    const placesSignal = result.signalsCollected.find(s => s.signalProvider === "google_places" && s.key === "google_places_review_count");
    expect(placesSignal?.key).toBe("google_places_review_count");

    const techSignal = result.signalsCollected.find(s => s.signalProvider === "website_technical");
    expect(techSignal?.key).toBe("pagespeed_mobile_score");

    // 4. Assert Persona Matching
    expect(result.personaMatched.role).toContain("Gérante");
    expect(result.personaMatched.email).toBe("elodie@fleurs-de-nantes-test.fr");
    expect(result.personaMatched.fitScore).toBeGreaterThanOrEqual(80);

    // 5. Assert Outreach Copy & Factual Claim Validation
    expect(result.generatedOutreach.subject).toContain("140 avis Google");
    expect(result.generatedOutreach.body).toContain("PageSpeed");
    expect(result.generatedOutreach.body).toContain("3 semaines");
    expect(result.generatedOutreach.factualClaimsValidated).toBe(true);
    expect(result.generatedOutreach.pdfProposalGenerated).toBe(true);

    // 6. Assert Simulated Inbound Reply & Knowledge Base Grounding
    expect(result.simulatedReply.prospectMessage).toContain("Combien de temps prend une refonte");
    expect(result.simulatedReply.groundedAnswer).toContain("3 semaines");
    expect(result.simulatedReply.knowledgeSourceCited).toContain("Bloomy KB");

    // 7. Assert Slot Confirmation & Atomic Booking
    expect(result.simulatedBooking.meetingBooked).toBe(true);
    expect(result.simulatedBooking.sequenceHalted).toBe(true);
    expect(result.simulatedBooking.companyFinalStatus).toBe("meeting_booked");

    // 8. Assert Architectural Invariants
    expect(result.invariantChecks.zeroHardcodingVerified).toBe(true);
    expect(result.invariantChecks.tenantDataIsolated).toBe(true);
    expect(result.invariantChecks.evidenceFactGrounded).toBe(true);
    expect(result.invariantChecks.calendarTruthHonored).toBe(true);

    // 9. Assert Firestore state persistence
    const bloomyBiz = await getBusiness(workspaceId, "biz_bloomy");
    expect(bloomyBiz?.name).toBe(BLOOMY_FIXTURE_CONFIG.businessName);

    const bloomyKb = await getKnowledgeBase(workspaceId, "biz_bloomy");
    expect(bloomyKb?.services.length).toBeGreaterThanOrEqual(1);
    expect(bloomyKb?.pricingRules[0]).toContain("1 490 € HT");

    const bloomyOffers = await listOffers(workspaceId, "biz_bloomy");
    expect(bloomyOffers.length).toBe(1);
    expect(bloomyOffers[0].id).toBe(BLOOMY_FIXTURE_CONFIG.offer.id);
  }, 25000);
});
