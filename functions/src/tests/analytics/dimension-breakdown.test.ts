import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../../config/firebase.js";
import { calculateDimensionBreakdown } from "../../services/analytics-service.js";

describe("Dimension Performance Breakdown (REQ-078)", () => {
  const workspaceId = `ws_dimension_test_${Date.now()}`;
  const businessId = `biz_dimension_test_${Date.now()}`;
  const now = Timestamp.now();

  it("should slice performance by copywriting angle, persona, signal, campaign, and NAF", async () => {
    // 1. Seed Companies with different angles and NAF codes
    const comp1 = {
      id: `comp_dim_${Date.now()}_1`,
      workspaceId,
      businessId,
      name: "Fleuriste Nantes",
      nafCode: "47.76Z",
      discoveryCampaignId: "camp_florists_nantes",
      status: "meeting_booked",
      opportunityScore: {
        recommendedAngle: "Google Review Contrast"
      },
      createdAt: now,
      updatedAt: now
    };

    const comp2 = {
      id: `comp_dim_${Date.now()}_2`,
      workspaceId,
      businessId,
      name: "Boulangerie Paris",
      nafCode: "10.71C",
      discoveryCampaignId: "camp_bakeries_paris",
      status: "contacted",
      opportunityScore: {
        recommendedAngle: "Mobile Conversion Friction"
      },
      createdAt: now,
      updatedAt: now
    };

    await adminDb.collection("companies").doc(comp1.id).set(comp1);
    await adminDb.collection("companies").doc(comp2.id).set(comp2);

    // 2. Seed Contacts with different personas
    const contact1 = {
      id: `contact_dim_${Date.now()}_1`,
      workspaceId,
      businessId,
      companyId: comp1.id,
      fullName: "Claire Dupont",
      role: "Fondatrice",
      personaMatched: "Fondateur / Dirigeant",
      createdAt: now,
      updatedAt: now
    };

    const contact2 = {
      id: `contact_dim_${Date.now()}_2`,
      workspaceId,
      businessId,
      companyId: comp2.id,
      fullName: "Marc Martin",
      role: "Responsable Vente",
      personaMatched: "Directeur Commercial",
      createdAt: now,
      updatedAt: now
    };

    await adminDb.collection("contacts").doc(contact1.id).set(contact1);
    await adminDb.collection("contacts").doc(contact2.id).set(contact2);

    // 3. Seed Outreach
    const out1 = {
      id: `out_dim_${Date.now()}_1`,
      workspaceId,
      businessId,
      companyId: comp1.id,
      contactId: contact1.id,
      campaignId: "camp_florists_nantes",
      personalizationNotes: ["Google Review Contrast"],
      suggestedPersona: "Fondateur / Dirigeant",
      status: "replied",
      sentAt: now,
      createdAt: now,
      updatedAt: now
    };

    const out2 = {
      id: `out_dim_${Date.now()}_2`,
      workspaceId,
      businessId,
      companyId: comp2.id,
      contactId: contact2.id,
      campaignId: "camp_bakeries_paris",
      personalizationNotes: ["Mobile Conversion Friction"],
      suggestedPersona: "Directeur Commercial",
      status: "sent",
      sentAt: now,
      createdAt: now,
      updatedAt: now
    };

    await adminDb.collection("outreach").doc(out1.id).set(out1);
    await adminDb.collection("outreach").doc(out2.id).set(out2);

    // 4. Seed Conversation for Comp1 (Booked meeting with positive intent)
    const conv1 = {
      id: `conv_dim_${Date.now()}_1`,
      workspaceId,
      businessId,
      companyId: comp1.id,
      contactId: contact1.id,
      status: "meeting_booked",
      latestIntent: "BOOKING_REQUEST",
      messageCount: 3,
      createdAt: now,
      updatedAt: now
    };
    await adminDb.collection("conversations").doc(conv1.id).set(conv1);

    const breakdown = await calculateDimensionBreakdown({ workspaceId, businessId });

    // Validate Copywriting Angles
    expect(breakdown.byAngle.length).toBeGreaterThan(0);
    const contrastAngle = breakdown.byAngle.find((a) => a.id === "Google Review Contrast");
    expect(contrastAngle).toBeDefined();
    expect(contrastAngle?.contacted).toBe(1);
    expect(contrastAngle?.meetingsBooked).toBe(1);
    expect(contrastAngle?.meetingRate).toBe(100.0);
    expect(contrastAngle?.conversionIndex).toBeGreaterThanOrEqual(1.0);

    // Validate Personas
    const founderPersona = breakdown.byPersona.find((p) => p.name === "Fondateur / Dirigeant");
    expect(founderPersona).toBeDefined();
    expect(founderPersona?.contacted).toBe(1);
    expect(founderPersona?.positiveReplies).toBe(1);
    expect(founderPersona?.meetingRate).toBe(100.0);

    // Validate Campaigns
    const floristsCamp = breakdown.byCampaign.find((c) => c.id === "camp_florists_nantes");
    expect(floristsCamp).toBeDefined();
    expect(floristsCamp?.contacted).toBe(1);
    expect(floristsCamp?.meetingsBooked).toBe(1);

    // Validate NAF
    const floristsNaf = breakdown.byNaf.find((n) => n.id === "47.76Z");
    expect(floristsNaf).toBeDefined();
    expect(floristsNaf?.contacted).toBe(1);
    expect(floristsNaf?.meetingsBooked).toBe(1);

    // Validate Signals list contains built-in providers
    expect(breakdown.bySignal.some((s) => s.id === "pagespeed")).toBe(true);
    expect(breakdown.bySignal.some((s) => s.id === "google_places")).toBe(true);
  });
});
