import { describe, it, expect } from "vitest";
import type { BusinessDoc, KnowledgeBaseDoc, SenderIdentityDoc } from "@/types/firestore";

describe("Phase 02 — Sender, Calendar, and Knowledge Base Isolation (REQ-005, REQ-006, REQ-007)", () => {
  it("should isolate sender configurations per business (REQ-005)", () => {
    const bloomySender: SenderIdentityDoc = {
      id: "snd_bloomy_1",
      workspaceId: "ws_default",
      businessId: "biz_bloomy",
      name: "Clarence - Bloomy Digital",
      email: "clarence@bloomydigital.com",
      replyToEmail: "hello@bloomydigital.com",
      instantlyCampaignId: "inst_camp_bloomy_123",
      isDefault: true,
      createdAt: { seconds: 1700000000, nanoseconds: 0 } as any,
      updatedAt: { seconds: 1700000000, nanoseconds: 0 } as any,
    };

    const devcommSender: SenderIdentityDoc = {
      id: "snd_devcomm_1",
      workspaceId: "ws_default",
      businessId: "biz_devcomm",
      name: "Clarence - Devcomm Consulting",
      email: "clarence@devcomm.fr",
      instantlyCampaignId: "inst_camp_devcomm_456",
      isDefault: true,
      createdAt: { seconds: 1700000000, nanoseconds: 0 } as any,
      updatedAt: { seconds: 1700000000, nanoseconds: 0 } as any,
    };

    expect(bloomySender.businessId).not.toBe(devcommSender.businessId);
    expect(bloomySender.email).toBe("clarence@bloomydigital.com");
    expect(devcommSender.email).toBe("clarence@devcomm.fr");
    expect(bloomySender.instantlyCampaignId).toBe("inst_camp_bloomy_123");
    expect(devcommSender.instantlyCampaignId).toBe("inst_camp_devcomm_456");
  });

  it("should isolate calendar configurations per business without cross-leakage (REQ-006)", () => {
    const bloomyBiz: BusinessDoc = {
      id: "biz_bloomy",
      workspaceId: "ws_default",
      name: "Bloomy Digital Studio",
      defaultLanguage: "fr",
      branding: {
        primaryColor: "#059669",
        tagline: "Websites",
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
        calendarId: "clarence@bloomydigital.com",
        bookingLink: "https://cal.com/bloomy/diagnostic",
        workingDays: [1, 2, 3, 4, 5],
        workingHours: { start: "09:00", end: "18:00" },
        timezone: "Europe/Paris",
      },
      createdAt: { seconds: 1700000000, nanoseconds: 0 } as any,
      updatedAt: { seconds: 1700000000, nanoseconds: 0 } as any,
    };

    const devcommBiz: BusinessDoc = {
      id: "biz_devcomm",
      workspaceId: "ws_default",
      name: "Devcomm Consulting",
      defaultLanguage: "fr",
      branding: {
        primaryColor: "#2563eb",
        tagline: "Consulting",
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
        calendarId: "outlook_calendar_devcomm_primary",
        bookingLink: "https://calendly.com/devcomm/echange",
        workingDays: [1, 2, 3, 4, 5],
        workingHours: { start: "08:30", end: "18:30" },
        timezone: "Europe/Paris",
      },
      createdAt: { seconds: 1700000000, nanoseconds: 0 } as any,
      updatedAt: { seconds: 1700000000, nanoseconds: 0 } as any,
    };

    expect(bloomyBiz.calendarConfig.provider).toBe("google_calendar");
    expect(devcommBiz.calendarConfig.provider).toBe("microsoft_graph");
    expect(bloomyBiz.calendarConfig.bookingLink).toContain("cal.com/bloomy");
    expect(devcommBiz.calendarConfig.bookingLink).toContain("calendly.com/devcomm");
  });

  it("should isolate knowledge bases with specific pricing guardrails per business (REQ-007)", () => {
    const bloomyKb: KnowledgeBaseDoc = {
      id: "default",
      workspaceId: "ws_default",
      businessId: "biz_bloomy",
      services: [
        {
          name: "Showcase Website Redesign",
          description: "5 to 10 page modern responsive website",
          idealFor: "Artisans and French local businesses",
        },
      ],
      caseStudies: [
        {
          title: "Atelier Floral Nantes Redesign",
          clientIndustry: "Florist",
          metric: "PageSpeed increased from 24 to 98",
          description: "Modernized digital ordering platform",
        },
      ],
      pricingRules: ["Websites start at €1,490 HT"],
      faqs: [{ question: "Delivery timeframe?", answer: "2 to 3 weeks" }],
      prohibitedPromises: ["Do not guarantee rank #1 in 48h"],
      updatedAt: { seconds: 1700000000, nanoseconds: 0 } as any,
    };

    const devcommKb: KnowledgeBaseDoc = {
      id: "default",
      workspaceId: "ws_default",
      businessId: "biz_devcomm",
      services: [
        {
          name: "Commercial Performance Coaching",
          description: "Outbound sales restructuring and team coaching",
          idealFor: "SMEs with 5 to 50 employees",
        },
      ],
      caseStudies: [
        {
          title: "Logistics SaaS Overhaul",
          clientIndustry: "Transport",
          metric: "+65% qualified discovery meetings",
          description: "ICP restructuring and sales playbooks",
        },
      ],
      pricingRules: ["Coaching packages start at €3,500 HT"],
      faqs: [{ question: "Engagement duration?", answer: "3 to 6 months" }],
      prohibitedPromises: ["Do not promise revenue doubling"],
      updatedAt: { seconds: 1700000000, nanoseconds: 0 } as any,
    };

    expect(bloomyKb.businessId).toBe("biz_bloomy");
    expect(devcommKb.businessId).toBe("biz_devcomm");
    expect(bloomyKb.pricingRules[0]).toContain("€1,490");
    expect(devcommKb.pricingRules[0]).toContain("€3,500");
    expect(bloomyKb.services[0].name).toContain("Website");
    expect(devcommKb.services[0].name).toContain("Commercial Performance");
  });
});
