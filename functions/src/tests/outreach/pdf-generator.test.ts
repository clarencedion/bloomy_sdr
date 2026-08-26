import { describe, expect, it } from "vitest";
import { renderProposalPdf } from "../../services/pdf-generator.js";
import type { BusinessDoc, EvidenceItem, OfferDoc } from "../../types/domain.js";

describe("REQ-054: Dynamic PDF Proposal Generator", () => {
  const mockBusiness: BusinessDoc = {
    id: "biz_bloomy",
    workspaceId: "ws_default",
    name: "Bloomy Digital Studio",
    defaultLanguage: "fr",
    branding: {
      primaryColor: "#0f172a",
      tagline: "Studio de modernisation web & performance"
    },
    automationPolicy: {
      mode: "assisted",
      dailyOutreachLimit: 50,
      dailyDiscoveryLimit: 50,
      requireApprovalBeforeSend: true,
      autoReplySafeThreshold: 0.85
    },
    calendarConfig: {
      provider: "cal_com",
      bookingLink: "https://cal.com/bloomy/diagnostic",
      workingDays: [1, 2, 3, 4, 5],
      workingHours: { start: "09:00", end: "18:00" },
      timezone: "Europe/Paris"
    },
    createdAt: new Date() as any,
    updatedAt: new Date() as any
  };

  const mockOffer: OfferDoc = {
    id: "off_web",
    workspaceId: "ws_default",
    businessId: "biz_bloomy",
    name: "Refonte & Optimisation Mobile",
    description: "Accompagnement refonte et conversion",
    targetPersonas: [],
    valuePropositions: [
      "Vitesse de chargement ultra-rapide (Core Web Vitals)",
      "Design moderne adapté aux smartphones"
    ],
    proofPoints: [
      "+40% de conversion mobile constatée chez nos clients",
      "Gain moyen de 2.5 secondes sur le temps de chargement LCP"
    ],
    prohibitedPromises: [],
    createdAt: new Date() as any,
    updatedAt: new Date() as any
  };

  const mockEvidence: EvidenceItem[] = [
    {
      id: "ev_1",
      workspaceId: "ws_default",
      businessId: "biz_bloomy",
      companyId: "comp_1",
      signalProvider: "pagespeed",
      key: "pagespeed_mobile_score",
      value: 28,
      sourceType: "pagespeed",
      confidence: 95,
      nature: "derived_metric",
      collectedAt: new Date()
    },
    {
      id: "ev_2",
      workspaceId: "ws_default",
      businessId: "biz_bloomy",
      companyId: "comp_1",
      signalProvider: "google_places",
      key: "google_places_review_count",
      value: 120,
      sourceType: "google_places",
      confidence: 90,
      nature: "fact",
      collectedAt: new Date()
    }
  ];

  it("renders a valid PDF buffer parameterized by Business and Offer branding", async () => {
    const buffer = await renderProposalPdf({
      companyName: "Boutique Nantes",
      company: { name: "Boutique Nantes", city: "Nantes", industry: "Commerce", employeeCount: 8 },
      draft: {
        headline: "Audit digital & plan d'action pour Boutique Nantes",
        intro: "Synthèse de nos observations techniques sur votre présence digitale.",
        whyDevcomm: "Moderniser votre canal de vente mobile.",
        likelyChallenges: ["Vitesse de chargement sur smartphone", "Parcours d'achat non optimisé"],
        recommendedSupport: ["Refonte responsive et audit Core Web Vitals"],
        cta: "Prenez rendez-vous pour un échange diagnostic de 20 minutes."
      },
      outreach: { companyId: "comp_1" },
      business: mockBusiness,
      offer: mockOffer,
      evidenceItems: mockEvidence,
      bookingLink: "https://cal.com/bloomy/diagnostic"
    });

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
    // PDF Magic number: %PDF-
    const header = buffer.subarray(0, 5).toString("utf-8");
    expect(header).toContain("%PDF");
  });
});
