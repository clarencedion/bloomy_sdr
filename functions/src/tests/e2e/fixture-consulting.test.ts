import { describe, it, expect } from "vitest";
import { runDevcommConsultingE2EFixture, DEVCOMM_FIXTURE_CONFIG } from "../fixtures/e2e-fixture-runner.js";
import { getBusiness, getKnowledgeBase, listOffers } from "../../services/business-service.js";

describe("Phase 16 — Fixture B: Devcomm B2B Consulting E2E Simulation (REQ-001 through REQ-080)", () => {
  const workspaceId = "ws_test_devcomm_" + Date.now();

  it("should execute complete E2E workflow for Devcomm Consulting (Industrial SMEs & Sales Performance)", async () => {
    const result = await runDevcommConsultingE2EFixture({
      workspaceId,
      testId: "test_devcomm_run_" + Date.now()
    });

    // 1. Assert overall execution success
    expect(result.success).toBe(true);
    expect(result.businessId).toBe("biz_devcomm");
    expect(result.fixtureName).toContain("Devcomm B2B Consulting");

    // 2. Assert Natural Language ICP Translation resolved industrial NAF and Scale/Hiring signals
    expect(result.icpTranslation.nafCodes).toContain("25.62B");
    expect(result.icpTranslation.enabledSignalProviders).toContain("company_registry");
    expect(result.icpTranslation.enabledSignalProviders).toContain("company_scale");
    expect(result.icpTranslation.enabledSignalProviders).toContain("company_hiring");

    // CRITICAL ARCHITECTURAL CHECK: Invariant 1 - Website technical audits MUST BE OMITTED for consulting
    expect(result.icpTranslation.enabledSignalProviders).not.toContain("website_technical");
    expect(result.icpTranslation.enabledSignalProviders).not.toContain("website_ecommerce");
    expect(result.icpTranslation.omittedSignalProviders).toContain("website_technical");

    // 3. Assert Discovered Lead & Signals Collected (Scale & Hiring)
    expect(result.discoveredLead.companyName).toBe("Mécainox Industrie");
    expect(result.discoveredLead.siren).toBe("489765432");
    expect(result.discoveredLead.employeeCount).toBe(45);
    expect(result.signalsCollected.length).toBe(3);

    const scaleSignal = result.signalsCollected.find(s => s.signalProvider === "company_scale");
    expect(scaleSignal?.key).toBe("multi_site_scale");

    const hiringSignal = result.signalsCollected.find(s => s.signalProvider === "company_hiring");
    expect(hiringSignal?.key).toBe("active_sales_recruitment");

    // 4. Assert Persona Matching (Directeur Commercial)
    expect(result.personaMatched.role).toContain("Directeur Commercial");
    expect(result.personaMatched.email).toBe("m.dubois@mecainox-industrie-test.fr");
    expect(result.personaMatched.fitScore).toBeGreaterThanOrEqual(85);

    // 5. Assert Outreach Copy & Factual Claim Validation
    expect(result.generatedOutreach.subject).toContain("expansion commerciale");
    expect(result.generatedOutreach.body).toContain("45 collaborateurs");
    expect(result.generatedOutreach.body).toContain("Skills2Drive");
    expect(result.generatedOutreach.factualClaimsValidated).toBe(true);
    expect(result.generatedOutreach.pdfProposalGenerated).toBe(true);

    // 6. Assert Simulated Inbound Reply & Knowledge Base Grounding (Qualiopi & OPCO)
    expect(result.simulatedReply.prospectMessage).toContain("Qualiopi");
    expect(result.simulatedReply.groundedAnswer).toContain("Qualiopi");
    expect(result.simulatedReply.groundedAnswer).toContain("OPCO");
    expect(result.simulatedReply.knowledgeSourceCited).toContain("Devcomm KB");

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
    const devcommBiz = await getBusiness(workspaceId, "biz_devcomm");
    expect(devcommBiz?.name).toBe(DEVCOMM_FIXTURE_CONFIG.businessName);

    const devcommKb = await getKnowledgeBase(workspaceId, "biz_devcomm");
    expect(devcommKb?.services.length).toBeGreaterThanOrEqual(1);
    expect(devcommKb?.faqs?.[0]?.answer).toContain("Qualiopi");

    const devcommOffers = await listOffers(workspaceId, "biz_devcomm");
    expect(devcommOffers.length).toBe(1);
    expect(devcommOffers[0].id).toBe(DEVCOMM_FIXTURE_CONFIG.offer.id);
  }, 25000);
});
