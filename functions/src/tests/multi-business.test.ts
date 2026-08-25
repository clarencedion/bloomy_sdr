import { describe, it, expect, beforeEach } from "vitest";
import {
  createWorkspace,
  createBusiness,
  listBusinesses,
  createOffer,
  listOffers,
  getOffer,
  saveKnowledgeBase,
  getKnowledgeBase,
  saveSenderIdentity,
  listSenderIdentities,
} from "../services/business-service";

describe("Phase 02 — Multi-Business Architecture & Isolation (REQ-001, REQ-005, REQ-006, REQ-007)", () => {
  const workspaceId = "ws_test_" + Date.now();

  beforeEach(async () => {
    await createWorkspace(workspaceId, "Test Agency Workspace");
  });

  it("should create and isolate distinct businesses within a workspace (REQ-001)", async () => {
    const bloomy = await createBusiness(workspaceId, {
      id: "biz_bloomy_test",
      name: "Bloomy Digital Studio",
      legalName: "Bloomy Studio",
      website: "https://bloomydigital.com",
      defaultLanguage: "fr",
      branding: {
        primaryColor: "#059669",
        tagline: "High-Performance Websites",
      },
      automationPolicy: {
        mode: "assisted",
        dailyOutreachLimit: 40,
        dailyDiscoveryLimit: 80,
        requireApprovalBeforeSend: true,
        autoReplySafeThreshold: 0.85,
      },
      calendarConfig: {
        provider: "google_calendar",
        workingDays: [1, 2, 3, 4, 5],
        workingHours: { start: "09:00", end: "18:00" },
        timezone: "Europe/Paris",
      },
    });

    const devcomm = await createBusiness(workspaceId, {
      id: "biz_devcomm_test",
      name: "Devcomm Consulting",
      legalName: "Devcomm SAS",
      website: "https://devcomm.fr",
      defaultLanguage: "fr",
      branding: {
        primaryColor: "#2563eb",
        tagline: "Commercial Performance & B2B Consulting",
      },
      automationPolicy: {
        mode: "assisted",
        dailyOutreachLimit: 50,
        dailyDiscoveryLimit: 100,
        requireApprovalBeforeSend: true,
        autoReplySafeThreshold: 0.85,
      },
      calendarConfig: {
        provider: "microsoft_graph",
        workingDays: [1, 2, 3, 4, 5],
        workingHours: { start: "09:00", end: "18:00" },
        timezone: "Europe/Paris",
      },
    });

    expect(bloomy.id).toBe("biz_bloomy_test");
    expect(devcomm.id).toBe("biz_devcomm_test");

    const businesses = await listBusinesses(workspaceId);
    expect(businesses.length).toBe(2);
    expect(businesses.map((b) => b.id)).toContain("biz_bloomy_test");
    expect(businesses.map((b) => b.id)).toContain("biz_devcomm_test");
  });

  it("should isolate offers between different businesses (REQ-002)", async () => {
    // Create offer for Bloomy
    await createOffer(workspaceId, "biz_bloomy_test", {
      id: "off_bloomy_showcase",
      name: "Showcase Website Redesign",
      description: "Fast modern showcase website for French artisans",
      targetPersonas: [
        { title: "Gérant / Artisan", priority: 1, keywords: ["artisan", "gérant"] },
      ],
      valuePropositions: ["Under 1.5s load time", "Local SEO optimization"],
      proofPoints: ["30+ redesigns delivered"],
      pricingGuardrails: {
        startingPrice: 1490,
        currency: "EUR",
        pricingModel: "fixed",
        canDiscloseInColdReply: true,
      },
      prohibitedPromises: ["guaranteed #1 rank in 24h"],
    });

    // Create offer for Devcomm
    await createOffer(workspaceId, "biz_devcomm_test", {
      id: "off_devcomm_coaching",
      name: "B2B Sales Team Coaching",
      description: "Sales methodology and outbound pipeline coaching",
      targetPersonas: [
        { title: "Directeur Commercial", priority: 1, keywords: ["sales director", "directeur commercial"] },
      ],
      valuePropositions: ["35% shorter sales cycle"],
      proofPoints: ["60+ clients coached"],
      pricingGuardrails: {
        startingPrice: 3500,
        currency: "EUR",
        pricingModel: "custom_quote",
        canDiscloseInColdReply: false,
      },
      prohibitedPromises: ["guaranteed revenue doubling"],
    });

    // Verify isolation: Bloomy offers must not return Devcomm offers
    const bloomyOffers = await listOffers(workspaceId, "biz_bloomy_test");
    expect(bloomyOffers.length).toBe(1);
    expect(bloomyOffers[0].id).toBe("off_bloomy_showcase");
    expect(bloomyOffers[0].name).toBe("Showcase Website Redesign");

    const devcommOffers = await listOffers(workspaceId, "biz_devcomm_test");
    expect(devcommOffers.length).toBe(1);
    expect(devcommOffers[0].id).toBe("off_devcomm_coaching");
    expect(devcommOffers[0].name).toBe("B2B Sales Team Coaching");

    // Cross-query must return null
    const crossCheck = await getOffer(workspaceId, "biz_bloomy_test", "off_devcomm_coaching");
    expect(crossCheck).toBeNull();
  });

  it("should isolate knowledge bases between businesses (REQ-007)", async () => {
    await saveKnowledgeBase(workspaceId, "biz_bloomy_test", {
      services: [{ name: "Website Redesign", description: "Modern Web", idealFor: "Florists" }],
      pricingRules: ["Showcase starts at €1,490 HT"],
      prohibitedPromises: ["No guaranteed rank #1"],
    });

    await saveKnowledgeBase(workspaceId, "biz_devcomm_test", {
      services: [{ name: "Sales Audit", description: "B2B Audit", idealFor: "SMEs" }],
      pricingRules: ["Coaching starts at €3,500 HT"],
      prohibitedPromises: ["No free unlimited sessions"],
    });

    const bloomyKb = await getKnowledgeBase(workspaceId, "biz_bloomy_test");
    const devcommKb = await getKnowledgeBase(workspaceId, "biz_devcomm_test");

    expect(bloomyKb?.pricingRules[0]).toContain("€1,490");
    expect(devcommKb?.pricingRules[0]).toContain("€3,500");
    expect(bloomyKb?.services[0].name).toBe("Website Redesign");
    expect(devcommKb?.services[0].name).toBe("Sales Audit");
  });

  it("should isolate sender identities between businesses (REQ-005)", async () => {
    await saveSenderIdentity(workspaceId, "biz_bloomy_test", {
      id: "snd_bloomy",
      name: "Clarence from Bloomy",
      email: "clarence@bloomydigital.com",
      isDefault: true,
    });

    await saveSenderIdentity(workspaceId, "biz_devcomm_test", {
      id: "snd_devcomm",
      name: "Clarence from Devcomm",
      email: "clarence@devcomm.fr",
      isDefault: true,
    });

    const bloomySenders = await listSenderIdentities(workspaceId, "biz_bloomy_test");
    const devcommSenders = await listSenderIdentities(workspaceId, "biz_devcomm_test");

    expect(bloomySenders.length).toBe(1);
    expect(bloomySenders[0].email).toBe("clarence@bloomydigital.com");

    expect(devcommSenders.length).toBe(1);
    expect(devcommSenders[0].email).toBe("clarence@devcomm.fr");
  });
});
