import { describe, it, expect, beforeEach } from "vitest";
import {
  createBusiness,
  createOffer,
  listOffers,
  saveKnowledgeBase,
  getKnowledgeBase,
  saveSenderIdentity,
  listSenderIdentities
} from "../../services/business-service.js";
import { getInboxSummary } from "../../services/inbox-service.js";
import { getQueueHealth } from "../../services/task-queue-service.js";
import { getCostSummary } from "../../services/cost-guardrail-service.js";
import { adminDb } from "../../config/firebase.js";

describe("Adversarial Security Audit: Cross-Tenant Multi-Business Isolation (Invariant 1 & 8)", () => {
  const ws1 = "ws_tenant_alpha";
  const ws2 = "ws_tenant_beta";
  const biz1 = "biz_alpha_studio";
  const biz2 = "biz_beta_consulting";

  beforeEach(async () => {
    // 1. Create Business Alpha & Data
    await createBusiness(ws1, {
      id: biz1,
      name: "Tenant Alpha Studio",
      defaultLanguage: "fr",
      branding: { primaryColor: "#000", tagline: "Alpha Studio" },
      automationPolicy: {
        mode: "manual",
        dailyOutreachLimit: 10,
        dailyDiscoveryLimit: 20,
        requireApprovalBeforeSend: true,
        autoReplySafeThreshold: 0.8
      },
      calendarConfig: {
        provider: "microsoft_graph",
        workingDays: [1, 2, 3, 4, 5],
        workingHours: { start: "09:00", end: "18:00" },
        timezone: "Europe/Paris"
      }
    });

    await createOffer(ws1, biz1, {
      id: "offer_alpha_web",
      name: "Alpha Web Design",
      description: "Fast web design",
      targetPersonas: [],
      valuePropositions: ["Ultra-fast Shopify stores"],
      proofPoints: ["+40% e-commerce revenue"],
      prohibitedPromises: ["100% money back"]
    });

    await saveKnowledgeBase(ws1, biz1, {
      faqs: [{ question: "What is Alpha SLA?", answer: "Delivery in 10 business days." }],
      services: [{ name: "Shopify Speed", description: "Optimization service" }]
    });

    await saveSenderIdentity(ws1, biz1, {
      id: "sender_alpha",
      name: "Alice Alpha",
      email: "alice@alpha-studio.fr",
      isDefault: true
    });

    // 2. Create Business Beta & Data
    await createBusiness(ws2, {
      id: biz2,
      name: "Tenant Beta Consulting",
      defaultLanguage: "fr",
      branding: { primaryColor: "#111", tagline: "Beta Consulting" },
      automationPolicy: {
        mode: "manual",
        dailyOutreachLimit: 10,
        dailyDiscoveryLimit: 20,
        requireApprovalBeforeSend: true,
        autoReplySafeThreshold: 0.8
      },
      calendarConfig: {
        provider: "microsoft_graph",
        workingDays: [1, 2, 3, 4, 5],
        workingHours: { start: "09:00", end: "18:00" },
        timezone: "Europe/Paris"
      }
    });

    await createOffer(ws2, biz2, {
      id: "offer_beta_audit",
      name: "Beta Industrial Audit",
      description: "Industrial consulting",
      targetPersonas: [],
      valuePropositions: ["Optimized sales cycles for manufacturing"],
      proofPoints: ["Qualiopi accredited"],
      prohibitedPromises: ["Instant 10x ROI"]
    });

    await saveKnowledgeBase(ws2, biz2, {
      faqs: [{ question: "Are Beta audits certified?", answer: "Yes, certified Qualiopi." }],
      services: [{ name: "B2B Sales Audit", description: "Deep commercial analysis" }]
    });

    await saveSenderIdentity(ws2, biz2, {
      id: "sender_beta",
      name: "Bob Beta",
      email: "bob@beta-consulting.fr",
      isDefault: true
    });
  });

  it("should never leak Offers across workspaces or businesses", async () => {
    const alphaOffers = await listOffers(ws1, biz1);
    const betaOffers = await listOffers(ws2, biz2);

    expect(alphaOffers.length).toBeGreaterThanOrEqual(1);
    expect(alphaOffers.some((o) => o.id === "offer_alpha_web")).toBe(true);
    expect(alphaOffers.some((o) => o.id === "offer_beta_audit")).toBe(false);

    expect(betaOffers.length).toBeGreaterThanOrEqual(1);
    expect(betaOffers.some((o) => o.id === "offer_beta_audit")).toBe(true);
    expect(betaOffers.some((o) => o.id === "offer_alpha_web")).toBe(false);

    // Cross-query attempt: querying ws1 with biz2 should return empty
    const crossOffers = await listOffers(ws1, biz2);
    expect(crossOffers).toEqual([]);
  });

  it("should strictly isolate Knowledge Base entries between businesses", async () => {
    const kbAlpha = await getKnowledgeBase(ws1, biz1);
    const kbBeta = await getKnowledgeBase(ws2, biz2);

    expect(kbAlpha?.faqs?.[0]?.question).toBe("What is Alpha SLA?");
    expect(kbAlpha?.faqs?.[0]?.answer).toContain("10 business days");
    expect(JSON.stringify(kbAlpha)).not.toContain("Qualiopi");

    expect(kbBeta?.faqs?.[0]?.question).toBe("Are Beta audits certified?");
    expect(kbBeta?.faqs?.[0]?.answer).toContain("Qualiopi");
    expect(JSON.stringify(kbBeta)).not.toContain("Shopify");
  });

  it("should isolate sender identities between workspaces", async () => {
    const sendersAlpha = await listSenderIdentities(ws1, biz1);
    const sendersBeta = await listSenderIdentities(ws2, biz2);

    expect(sendersAlpha.map((s) => s.email)).toContain("alice@alpha-studio.fr");
    expect(sendersAlpha.map((s) => s.email)).not.toContain("bob@beta-consulting.fr");

    expect(sendersBeta.map((s) => s.email)).toContain("bob@beta-consulting.fr");
    expect(sendersBeta.map((s) => s.email)).not.toContain("alice@alpha-studio.fr");
  });

  it("should isolate inbox summaries, queue health, and cost tracking per workspace/business", async () => {
    // Seed an active conversation in Tenant Alpha only
    await adminDb.collection("conversations").doc("conv_alpha_secret").set({
      id: "conv_alpha_secret",
      workspaceId: ws1,
      businessId: biz1,
      status: "in_dialogue",
      unreadHumanAttention: true,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const summaryAlpha = await getInboxSummary({ workspaceId: ws1, businessId: biz1 });
    const summaryBeta = await getInboxSummary({ workspaceId: ws2, businessId: biz2 });

    expect(summaryAlpha.total).toBeGreaterThanOrEqual(1);
    // Tenant Beta should not see Tenant Alpha's active count
    expect(summaryBeta.total).toBe(0);

    // Queue health isolation
    const queueHealthAlpha = await getQueueHealth(ws1, biz1);
    const queueHealthBeta = await getQueueHealth(ws2, biz2);
    expect(queueHealthAlpha.workspaceId).toBe(ws1);
    expect(queueHealthBeta.workspaceId).toBe(ws2);

    // Cost summary isolation
    const costAlpha = await getCostSummary(ws1, biz1);
    const costBeta = await getCostSummary(ws2, biz2);
    expect(typeof costAlpha.todaySpendUsd).toBe("number");
    expect(typeof costBeta.todaySpendUsd).toBe("number");
  });
});
