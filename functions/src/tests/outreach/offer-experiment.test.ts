import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Timestamp } from "firebase-admin/firestore";

// Offline only: Firestore is the in-memory fake used by the social tests; the
// AI provider, evidence, lead readiness, spend recorder and PDF are stubbed.
// The experiment service, business context, pricing guardrail, quota counter,
// DM and email generators are the real code.
vi.mock("../../config/firebase.js", async () => {
  const { fakeDb } = await import("../social/fixtures/outbound-fake-firestore.js");
  return { adminDb: fakeDb };
});

const NEUTRAL_BODY = "Bonjour, votre page montre de très belles réalisations. Seriez-vous ouverts à un court échange ?";
const ai = vi.hoisted(() => ({
  body: "",
  cta: "",
  // Outputs served first, one per call, before falling back to body/cta.
  queue: [] as Array<{ body: string; cta: string }>,
  // Once the queue is empty, calls throw (a network error on a redraft).
  failAfterQueue: false,
  inputs: [] as Array<Record<string, unknown>>
}));
vi.mock("../../providers/ai/index.js", () => ({
  getResearchProvider: () => ({
    name: "qwen",
    model: "qwen-test",
    generateStructuredOutreach: async (input: Record<string, unknown>) => {
      ai.inputs.push(input);
      if (!ai.queue.length && ai.failAfterQueue) throw new Error("network error");
      const next = ai.queue.shift() ?? { body: ai.body, cta: ai.cta };
      return {
        provider: "qwen",
        model: "qwen-test",
        output: {
          body: next.body,
          subject: "Votre site",
          followUp1: "",
          followUp2: "",
          linkedinConnectionNote: "",
          linkedinFollowUp: "",
          internalSalesNotes: "",
          suggestedPersona: "",
          cta: next.cta,
          personalizationNotes: [],
          riskWarnings: []
        },
        rawOutput: {},
        estimatedInputTokens: 1000,
        estimatedOutputTokens: 80
      };
    }
  })
}));
const evidence = vi.hoisted(() => ({ facts: [] as Array<Record<string, unknown>> }));
// The model judge (social-dm-judge.ts): verdicts served in order, then "clean".
const judge = vi.hoisted(() => ({ verdicts: [] as Array<Record<string, unknown>>, calls: [] as string[] }));
vi.mock("../../services/social-dm-judge.js", () => ({
  judgeDmCopy: async ({ text }: { text: string }) => {
    judge.calls.push(text);
    return judge.verdicts.shift() ?? { status: "clean" };
  }
}));
vi.mock("../../services/evidence-service.js", () => ({
  getValidEvidence: async () => [],
  extractPersonalizationFacts: () => evidence.facts
}));
vi.mock("../../services/cost-guardrail-service.js", () => ({ recordAiSpend: async () => 0 }));
vi.mock("../../services/lead-readiness.js", () => ({
  updateCompanyLeadReadiness: async () => ({ leadReadyForOutreach: true, leadReadinessReasons: [] })
}));
vi.mock("../../services/pdf-generator.js", () => ({
  generateProposalPdf: async () => {
    throw new Error("No PDF in offline tests.");
  }
}));

import { fakeDb } from "../social/fixtures/outbound-fake-firestore.js";
import {
  assignOfferForCompany,
  offerNeutralKnowledgeBase,
  pickVariant,
  resolveOfferAssignment,
  summarizeExperiment
} from "../../services/offer-experiment.js";
import { generateSocialDm } from "../../services/social-dm-generation.js";
import { generateOutreach, updateOutreachDraft } from "../../services/outreach-generation.js";
import { buildBusinessContext } from "../../services/business-context.js";
import type { PricingTerms } from "../../services/pricing-guardrail.js";

const WS = "ws_test";
const BIZ = "biz_alpha";
const EXP = "exp_test";
const BIZ_PATH = `workspaces/${WS}/businesses/${BIZ}`;

const TERMS: Record<string, PricingTerms> = {
  off_a: {
    startingPrice: 49, currency: "EUR", pricingModel: "subscription", canDiscloseInColdReply: true,
    setupFee: 0, monthlyPrice: 49, commitmentMonths: 24, taxLabel: "HT",
    approvedTerms: ["0 € de création", "49 € HT par mois", "Engagement de 24 mois"]
  },
  off_b: {
    startingPrice: 29, currency: "EUR", pricingModel: "subscription", canDiscloseInColdReply: true,
    setupFee: 0, monthlyPrice: 29, commitmentMonths: 36, taxLabel: "HT",
    approvedTerms: ["0 € de création", "29 € HT par mois", "Engagement de 36 mois"]
  },
  off_c: {
    startingPrice: 490, currency: "EUR", pricingModel: "subscription", canDiscloseInColdReply: true,
    setupFee: 490, monthlyPrice: 29, commitmentMonths: 12, taxLabel: "HT",
    approvedTerms: ["490 € HT de mise en service", "29 € HT par mois", "Engagement de 12 mois"]
  },
  off_d: {
    startingPrice: 1490, currency: "EUR", pricingModel: "fixed", canDiscloseInColdReply: true,
    setupFee: 1490, monthlyPrice: 15, commitmentMonths: 0, taxLabel: "HT",
    approvedTerms: ["1 490 € HT, site livré", "15 € HT par mois d'hébergement et de maintenance, sans engagement"]
  }
};
const OFFER_IDS = ["off_a", "off_b", "off_c", "off_d"];

function seedOffers() {
  for (const id of OFFER_IDS) {
    fakeDb.seed(`${BIZ_PATH}/offers/${id}`, {
      workspaceId: WS,
      businessId: BIZ,
      name: `Offre ${id}`,
      description: "",
      targetPersonas: [],
      valuePropositions: [],
      proofPoints: [],
      prohibitedPromises: [],
      pricingGuardrails: TERMS[id]
    });
  }
}

function seedBusiness(experiment?: Record<string, unknown> | null) {
  fakeDb.seed(BIZ_PATH, {
    workspaceId: WS,
    name: "Studio Alpha",
    proposalDocument: { enabled: false },
    ...(experiment === null ? {} : { offerExperiment: experiment ?? { id: EXP, offerIds: OFFER_IDS, status: "active" } })
  });
}

function seedCompany(id: string, extra: Record<string, unknown> = {}) {
  fakeDb.seed(`companies/${id}`, {
    workspaceId: WS,
    businessId: BIZ,
    name: `Société ${id}`,
    status: "qualified",
    offerId: "off_a",
    website: `https://www.instagram.com/${id}/`,
    ...extra
  });
}

const scope = (companyId: string) => ({ workspaceId: WS, businessId: BIZ, companyId });

// Runs from the repo root (npm test) or from functions/ (npm --prefix functions test).
const functionsRoot = fs.existsSync(path.resolve(process.cwd(), "src/services"))
  ? process.cwd()
  : path.resolve(process.cwd(), "functions");
const read = (rel: string) => fs.readFileSync(path.join(functionsRoot, rel), "utf8");

beforeEach(() => {
  fakeDb.reset();
  ai.inputs = [];
  ai.queue = [];
  ai.failAfterQueue = false;
  evidence.facts = [];
  judge.verdicts = [];
  judge.calls = [];
  ai.body = NEUTRAL_BODY;
  ai.cta = "";
  fakeDb.seed("settings/global", { automationPaused: false, testModeEnabled: false });
  seedBusiness();
  seedOffers();
});

// ── pickVariant ────────────────────────────────────────────────────────────

describe("pickVariant — deterministic and uniform", () => {
  it("always gives the same company the same variant", () => {
    const first = pickVariant(EXP, "co_42", OFFER_IDS);
    for (let i = 0; i < 20; i++) expect(pickVariant(EXP, "co_42", OFFER_IDS)).toBe(first);
    expect(OFFER_IDS).toContain(first);
  });

  it("splits 4 000 companies roughly evenly over 4 variants (each 20–30 %)", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 4000; i++) {
      const variant = pickVariant(EXP, `co_${String(i).padStart(6, "0")}`, OFFER_IDS);
      counts.set(variant, (counts.get(variant) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual([...OFFER_IDS].sort());
    for (const count of counts.values()) {
      expect(count / 4000).toBeGreaterThanOrEqual(0.2);
      expect(count / 4000).toBeLessThanOrEqual(0.3);
    }
  });

  it("depends on the experiment: a new experiment re-draws the split", () => {
    const moved = Array.from({ length: 200 }, (_, i) => `co_${i}`).filter(
      (id) => pickVariant("exp_one", id, OFFER_IDS) !== pickVariant("exp_two", id, OFFER_IDS)
    );
    expect(moved.length).toBeGreaterThan(100);
  });

  it("refuses an empty list rather than returning nothing", () => {
    expect(() => pickVariant(EXP, "co_1", [])).toThrow(/at least one offer/);
  });
});

// ── assignOfferForCompany ──────────────────────────────────────────────────

describe("assignOfferForCompany — who gets a variant, once", () => {
  it("assigns a never-contacted company its variant, in one transaction", async () => {
    seedCompany("co_1");
    const expected = pickVariant(EXP, "co_1", OFFER_IDS);
    const before = fakeDb.transactions;
    expect(await assignOfferForCompany(scope("co_1"))).toBe(expected);
    expect(fakeDb.transactions - before).toBe(1);
    const company = fakeDb.read("companies/co_1")!;
    expect(company.offerId).toBe(expected);
    expect(company.offerAssignment).toMatchObject({ experimentId: EXP, offerId: expected });
    expect((company.offerAssignment as { assignedAt: unknown }).assignedAt).toBeInstanceOf(Timestamp);
  });

  it("is idempotent: an existing assignment for the same experiment wins, as-is", async () => {
    const assignedAt = Timestamp.fromMillis(Date.parse("2026-11-01T10:00:00Z"));
    // Deliberately not the variant pickVariant would choose: stored data wins.
    const other = OFFER_IDS.find((id) => id !== pickVariant(EXP, "co_1", OFFER_IDS))!;
    seedCompany("co_1", { offerId: other, offerAssignment: { experimentId: EXP, offerId: other, assignedAt } });
    expect(await resolveOfferAssignment(scope("co_1"))).toEqual({ offerId: other, experimentId: EXP, outcome: "existing_assignment" });
    expect(await assignOfferForCompany(scope("co_1"))).toBe(other);
    expect(fakeDb.read("companies/co_1")?.offerAssignment).toEqual({ experimentId: EXP, offerId: other, assignedAt });
  });

  it("assigns the same variant on repeated calls without moving assignedAt", async () => {
    seedCompany("co_1");
    const first = await assignOfferForCompany(scope("co_1"));
    const stamp = (fakeDb.read("companies/co_1")?.offerAssignment as { assignedAt: Timestamp }).assignedAt;
    expect(await assignOfferForCompany(scope("co_1"))).toBe(first);
    expect((fakeDb.read("companies/co_1")?.offerAssignment as { assignedAt: Timestamp }).assignedAt).toBe(stamp);
  });

  it.each([
    ["a first DM was sent", { socialDmSentAt: Timestamp.now() }],
    ["a contact form was sent", { contactFormSentAt: Timestamp.now() }],
    ["its status says it was contacted", { status: "contacted" }],
    ["it already replied", { status: "replied" }]
  ])("never re-assigns a company when %s: it keeps its offer", async (_label, extra) => {
    seedCompany("co_1", extra);
    expect(await resolveOfferAssignment(scope("co_1"))).toEqual({ offerId: "off_a", outcome: "contacted" });
    expect(fakeDb.read("companies/co_1")?.offerId).toBe("off_a");
    expect(fakeDb.read("companies/co_1")).not.toHaveProperty("offerAssignment");
  });

  it.each(["sent", "replied", "exported", "meeting_booked"])("never re-assigns a company with an outreach %s", async (status) => {
    seedCompany("co_1");
    fakeDb.seed("outreach/o_1", { workspaceId: WS, businessId: BIZ, companyId: "co_1", offerId: "off_a", status });
    expect(await assignOfferForCompany(scope("co_1"))).toBe("off_a");
    expect(fakeDb.read("companies/co_1")).not.toHaveProperty("offerAssignment");
  });

  it("does assign a company that only has unsent drafts", async () => {
    seedCompany("co_1");
    fakeDb.seed("outreach/o_1", { workspaceId: WS, businessId: BIZ, companyId: "co_1", offerId: "off_a", status: "draft" });
    fakeDb.seed("outreach/o_2", { workspaceId: WS, businessId: BIZ, companyId: "co_1", offerId: "off_a", status: "rejected" });
    expect(await resolveOfferAssignment(scope("co_1"))).toMatchObject({ experimentId: EXP, outcome: "assigned" });
  });

  it("keeps an earlier experiment's offer for a contacted company, and re-draws only the uncontacted ones", async () => {
    const old = { experimentId: "exp_old", offerId: "off_b", assignedAt: Timestamp.now() };
    seedCompany("co_sent", { offerId: "off_b", offerAssignment: old, socialDmSentAt: Timestamp.now() });
    seedCompany("co_fresh", { offerId: "off_b", offerAssignment: old });
    expect(await resolveOfferAssignment(scope("co_sent"))).toEqual({ offerId: "off_b", experimentId: "exp_old", outcome: "existing_assignment" });
    const fresh = await resolveOfferAssignment(scope("co_fresh"));
    expect(fresh).toEqual({ offerId: pickVariant(EXP, "co_fresh", OFFER_IDS), experimentId: EXP, outcome: "assigned" });
    expect(fakeDb.read("companies/co_fresh")?.offerAssignment).toMatchObject({ experimentId: EXP, offerId: fresh.offerId });
  });

  it("assigns nobody while the experiment is stopped, and keeps existing assignments", async () => {
    seedBusiness({ id: EXP, offerIds: OFFER_IDS, status: "stopped" });
    seedCompany("co_new");
    seedCompany("co_old", { offerId: "off_c", offerAssignment: { experimentId: EXP, offerId: "off_c", assignedAt: Timestamp.now() } });
    expect(await resolveOfferAssignment(scope("co_new"))).toEqual({ offerId: "off_a", outcome: "no_experiment" });
    expect(fakeDb.read("companies/co_new")).not.toHaveProperty("offerAssignment");
    expect(await resolveOfferAssignment(scope("co_old"))).toEqual({ offerId: "off_c", experimentId: EXP, outcome: "existing_assignment" });
  });

  it("assigns nobody when the business runs no experiment", async () => {
    seedBusiness(null);
    seedCompany("co_1");
    expect(await resolveOfferAssignment(scope("co_1"))).toEqual({ offerId: "off_a", outcome: "no_experiment" });
    expect(fakeDb.read("companies/co_1")).not.toHaveProperty("offerAssignment");
  });

  it("ignores offer ids that match no offer", async () => {
    seedBusiness({ id: EXP, offerIds: ["off_a", "off_gone", "off_b", "off_b"], status: "active" });
    const picks = new Set<string>();
    for (let i = 0; i < 40; i++) {
      seedCompany(`co_${i}`);
      picks.add(String(await assignOfferForCompany(scope(`co_${i}`))));
    }
    expect([...picks].sort()).toEqual(["off_a", "off_b"]);
  });

  it("does not run an experiment left with fewer than two real offers", async () => {
    seedBusiness({ id: EXP, offerIds: ["off_a", "off_gone"], status: "active" });
    seedCompany("co_1");
    expect(await resolveOfferAssignment(scope("co_1"))).toEqual({ offerId: "off_a", outcome: "no_experiment" });
  });

  it("never assigns another business's company (tenant isolation)", async () => {
    seedCompany("co_1", { businessId: "biz_other" });
    expect(await resolveOfferAssignment(scope("co_1"))).toEqual({ outcome: "not_assignable" });
    expect(await resolveOfferAssignment(scope("co_missing"))).toEqual({ outcome: "not_assignable" });
    expect(fakeDb.read("companies/co_1")).not.toHaveProperty("offerAssignment");
  });
});

// ── Generators use the variant ─────────────────────────────────────────────

describe("generateSocialDm — pitches the assigned variant", () => {
  it("assigns, drafts with the variant's offer and terms, and stamps the experiment", async () => {
    seedCompany("co_1");
    const variant = pickVariant(EXP, "co_1", OFFER_IDS);
    // Otherwise this test could not tell the variant from the discovery offer.
    expect(variant).not.toBe("off_a");
    const result = await generateSocialDm({ companyId: "co_1" });

    const draft = fakeDb.read(`outreach/${result.outreachId}`)!;
    expect(draft).toMatchObject({ offerId: variant, offerExperimentId: EXP, channel: "social_dm" });
    expect(fakeDb.read("companies/co_1")?.offerAssignment).toMatchObject({ experimentId: EXP, offerId: variant });
    // The model saw the variant, and the variant's terms only.
    const input = ai.inputs[0] as { offer: { id: string }; devcommContext: string };
    expect(input.offer.id).toBe(variant);
    expect(input.devcommContext).toContain(`Offer: Offre ${variant}`);
    expect(input.devcommContext).toContain(`Monthly price: ${TERMS[variant].monthlyPrice} € HT per month`);
    for (const other of OFFER_IDS.filter((id) => id !== variant)) {
      expect(input.devcommContext).not.toContain(`Offer: Offre ${other}`);
    }
  });

  it("an existing assignment beats the company's discovery offer, and the draft is checked against its terms", async () => {
    seedCompany("co_1", { offerId: "off_b", offerAssignment: { experimentId: EXP, offerId: "off_b", assignedAt: Timestamp.now() } });
    ai.body = "Bonjour, votre site est inclus dès 29 € HT par mois, engagement de 36 mois.";
    const result = await generateSocialDm({ companyId: "co_1" });
    const draft = fakeDb.read(`outreach/${result.outreachId}`)!;
    expect(draft).toMatchObject({ offerId: "off_b", offerExperimentId: EXP });
    // Checked against B's terms: nothing contradicts them. (The draft still needs the operator's
    // confirmation: in an experiment without a terms line the model wrote the terms.)
    expect((draft.riskWarnings as string[]).filter((w) => w.startsWith("Conditions commerciales"))).toEqual([]);

    // The same text under the control's terms is flagged: the check followed the variant.
    fakeDb.reset();
    fakeDb.seed("settings/global", { automationPaused: false });
    seedBusiness(null);
    seedOffers();
    seedCompany("co_2");
    const control = await generateSocialDm({ companyId: "co_2" });
    expect(fakeDb.read(`outreach/${control.outreachId}`)).toMatchObject({ offerId: "off_a", pricingGuardrailPassed: false });
    expect(fakeDb.read(`outreach/${control.outreachId}`)).not.toHaveProperty("offerExperimentId");
  });

  it("without an experiment, behaves exactly as before (company offer, no tag, no assignment)", async () => {
    seedBusiness(null);
    seedCompany("co_1", { offerId: "off_c" });
    const result = await generateSocialDm({ companyId: "co_1" });
    expect(fakeDb.read(`outreach/${result.outreachId}`)).toMatchObject({ offerId: "off_c" });
    expect(fakeDb.read(`outreach/${result.outreachId}`)).not.toHaveProperty("offerExperimentId");
    expect(fakeDb.read("companies/co_1")).not.toHaveProperty("offerAssignment");
  });

  it("assigns nothing when it returns an existing draft unchanged", async () => {
    seedCompany("co_1");
    fakeDb.seed("outreach/d_1", { workspaceId: WS, businessId: BIZ, companyId: "co_1", channel: "social_dm", status: "draft", offerId: "off_a", generatedBody: "Ancien." });
    await generateSocialDm({ companyId: "co_1" });
    expect(fakeDb.read("companies/co_1")).not.toHaveProperty("offerAssignment");
    expect(ai.inputs).toHaveLength(0);
  });

  it("drops a stale experiment tag when a forced redraft is no longer in an experiment", async () => {
    seedBusiness(null);
    seedCompany("co_1");
    fakeDb.seed("outreach/d_1", {
      workspaceId: WS, businessId: BIZ, companyId: "co_1", channel: "social_dm", status: "draft",
      offerId: "off_b", offerExperimentId: EXP, generatedBody: "Ancien."
    });
    await generateSocialDm({ companyId: "co_1", force: true });
    expect(fakeDb.read("outreach/d_1")).toMatchObject({ offerId: "off_a" });
    expect(fakeDb.read("outreach/d_1")).not.toHaveProperty("offerExperimentId");
  });
});

describe("generateOutreach — the assignment beats the campaign's offer", () => {
  it("drafts the email for the variant, stamps the experiment, and drops research's offer guess", async () => {
    seedCompany("co_1", { discoveryCampaignId: "disc_1", bestOffer: "Offre off_a — 49 € HT/mois" });
    fakeDb.seed("discoveryCampaigns/disc_1", { workspaceId: WS, businessId: BIZ, offerId: "off_a" });
    fakeDb.seed("leadResearch/r_1", {
      companyId: "co_1",
      status: "completed",
      completedAt: Timestamp.now(),
      companySummary: "Fleuriste à Nantes.",
      bestOffer: "Offre off_a — 0 € de création, 49 € HT/mois",
      personalizedAngle: "Site lent sur mobile."
    });
    fakeDb.seed("contacts/c_1", { companyId: "co_1", email: "contact@societe.fr", workspaceId: WS, businessId: BIZ });
    const variant = pickVariant(EXP, "co_1", OFFER_IDS);
    expect(variant).not.toBe("off_a"); // the campaign's offer

    const result = await generateOutreach({ companyId: "co_1", campaignId: "disc_1" });
    expect(fakeDb.read(`outreach/${result.outreachId}`)).toMatchObject({ offerId: variant, offerExperimentId: EXP, businessId: BIZ });
    const input = ai.inputs[0] as { offer: { id: string }; research: Record<string, unknown>; company: Record<string, unknown> };
    expect(input.offer.id).toBe(variant);
    expect(input.research).not.toHaveProperty("bestOffer");
    expect(input.company).not.toHaveProperty("bestOffer");
    expect(input.research.personalizedAngle).toBe("Site lent sur mobile.");
  });

  it("without an experiment, the campaign's offer applies as before", async () => {
    seedBusiness(null);
    seedCompany("co_1", { offerId: "off_c", discoveryCampaignId: "disc_1", bestOffer: "Offre off_a" });
    fakeDb.seed("discoveryCampaigns/disc_1", { workspaceId: WS, businessId: BIZ, offerId: "off_b" });
    const result = await generateOutreach({ companyId: "co_1", campaignId: "disc_1", force: true });
    const draft = fakeDb.read(`outreach/${result.outreachId}`)!;
    expect(draft.offerId).toBe("off_b");
    expect(draft).not.toHaveProperty("offerExperimentId");
    expect((ai.inputs[0] as { company: Record<string, unknown> }).company.bestOffer).toBe("Offre off_a");
  });
});

describe("replies follow the offer the prospect was sent", () => {
  it("resolves a conversation's offer from its outreach (outreach.offerId), then the company", () => {
    const source = read("src/services/conversation-offer.ts");
    expect(source).toMatch(/collection\("outreach"\)\.doc\(conversation\.outreachId\)[\s\S]*offerId/);
    expect(source).toMatch(/collection\("companies"\)\.doc\(conversation\.companyId\)[\s\S]*offerId/);
  });
});

// ── Offer-neutral knowledge base ───────────────────────────────────────────

describe("the knowledge base is offer-neutral while an experiment exists", () => {
  const kb = {
    pricingRules: [
      "Les conditions sont celles de l'offre présentée à ce prospect.",
      "Abonnement : 49 € HT par mois.",
      "L'engagement est de 24 mois."
    ],
    faqs: [
      { question: "Combien de temps ?", answer: "Environ quatre semaines." },
      { question: "Pourquoi 0 € de création ?", answer: "Le site est inclus dans l'abonnement." },
      { question: "Je peux arrêter quand ?", answer: "L'engagement est de 24 mois." }
    ]
  };
  const withExperiment = { offerExperiment: { id: EXP, offerIds: OFFER_IDS, status: "active" as const } };

  it("is returned untouched without an experiment", () => {
    expect(offerNeutralKnowledgeBase(kb, {}, TERMS.off_b)).toBe(kb);
    expect(offerNeutralKnowledgeBase(kb, null, TERMS.off_b)).toBe(kb);
  });

  it("withholds every figure, and any term contradicting the pitched offer", () => {
    const forB = offerNeutralKnowledgeBase(kb, withExperiment, TERMS.off_b)!;
    expect(forB.pricingRules).toEqual(["Les conditions sont celles de l'offre présentée à ce prospect."]);
    expect(forB.faqs?.map((faq) => faq.question)).toEqual(["Combien de temps ?"]);
    // The control's own commitment is consistent with the control; amounts never pass.
    const forA = offerNeutralKnowledgeBase(kb, withExperiment, TERMS.off_a)!;
    expect(forA.pricingRules).toEqual(["Les conditions sont celles de l'offre présentée à ce prospect.", "L'engagement est de 24 mois."]);
  });

  it("stays neutral after the experiment is stopped (assigned prospects are still answered)", () => {
    const stopped = { offerExperiment: { id: EXP, offerIds: OFFER_IDS, status: "stopped" as const } };
    expect(offerNeutralKnowledgeBase(kb, stopped, TERMS.off_d)!.pricingRules).toHaveLength(1);
  });

  it("reaches the prompt filtered through buildBusinessContext", async () => {
    fakeDb.seed(`${BIZ_PATH}/knowledgeBase/default`, { workspaceId: WS, businessId: BIZ, ...kb, services: [], caseStudies: [] });
    const forC = await buildBusinessContext({ workspaceId: WS, businessId: BIZ, offerId: "off_c" });
    expect(forC).toContain("Pricing rules: Les conditions sont celles de l'offre présentée à ce prospect.");
    expect(forC).not.toContain("49 €");
    expect(forC).not.toContain("24 mois");
    seedBusiness(null);
    const legacy = await buildBusinessContext({ workspaceId: WS, businessId: BIZ, offerId: "off_c" });
    expect(legacy).toContain("Abonnement : 49 € HT par mois.");
  });
});

// ── Report ─────────────────────────────────────────────────────────────────

describe("summarizeExperiment — the funnel per variant", () => {
  const assign = (id: string, offerId: string, experimentId = EXP) => ({ id, offerAssignment: { experimentId, offerId } });

  it("counts companies per stage and rates over sent", () => {
    const rows = summarizeExperiment({
      experimentId: EXP,
      offers: [
        { id: "off_a", name: "A" },
        { id: "off_b", name: "B" }
      ],
      companies: [
        assign("a1", "off_a"), assign("a2", "off_a"), assign("a3", "off_a"), assign("a4", "off_a"),
        assign("b1", "off_b"), assign("b2", "off_b"),
        assign("old", "off_a", "exp_old"),
        { id: "none" }
      ],
      outreach: [
        { companyId: "a1", offerId: "off_a", status: "replied", channel: "social_dm" },
        { companyId: "a1", offerId: "off_a", status: "rejected" },
        { companyId: "a2", offerId: "off_a", status: "sent" },
        { companyId: "a3", offerId: "off_a", status: "meeting_booked", channel: "email" },
        { companyId: "a4", offerId: "off_a", status: "draft" },
        { companyId: "b1", offerId: "off_b", status: "exported", channel: "email" },
        // Contacted with the control after being assigned B: counted in neither funnel.
        { companyId: "b2", offerId: "off_b", status: "draft" },
        { companyId: "b2", offerId: "off_a", status: "sent" },
        { companyId: "old", offerId: "off_a", status: "replied" },
        { companyId: "none", offerId: "off_a", status: "replied" }
      ],
      conversations: [
        { companyId: "a1", latestIntent: "POSITIVE", status: "in_dialogue" },
        { companyId: "a2", latestIntent: "OBJECTION", status: "in_dialogue" },
        { companyId: "a3", status: "meeting_booked" },
        { companyId: "b2", latestIntent: "BOOKING_REQUEST", status: "in_dialogue" }
      ],
      meetings: [
        { companyId: "a3", status: "scheduled" },
        { companyId: "a2", status: "cancelled" },
        { companyId: "b2", status: "scheduled" }
      ]
    });

    expect(rows.map((row) => row.offerId)).toEqual(["off_a", "off_b"]);
    const [a, b] = rows;
    expect(a).toMatchObject({ offerName: "A", assigned: 4, drafted: 4, sent: 3, replied: 3, positive: 2, meetings: 1, mismatched: 0 });
    expect(a.replyRate).toBeCloseTo(1);
    expect(a.positiveRate).toBeCloseTo(2 / 3);
    expect(a.sentByChannel).toEqual({ social_dm: 1, email: 2 });
    expect(b).toMatchObject({ assigned: 2, drafted: 2, sent: 1, replied: 0, positive: 0, meetings: 0, mismatched: 1 });
    expect(b.replyRate).toBe(0);
  });

  it("reports no rate before anything is sent, and keeps rows for unknown or empty variants", () => {
    const rows = summarizeExperiment({
      offers: [{ id: "off_a", name: "A" }],
      companies: [assign("x", "off_deleted")],
      outreach: [{ companyId: "x", offerId: "off_deleted", status: "draft" }],
      conversations: [],
      meetings: []
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ offerId: "off_a", assigned: 0, replyRate: null, positiveRate: null });
    expect(rows[1]).toMatchObject({ offerId: "off_deleted", offerName: "(offre inconnue)", assigned: 1, drafted: 1, sent: 0, replyRate: null });
  });
});

// ── Scripts and invariants ─────────────────────────────────────────────────

describe("operator scripts and Invariant 1", () => {
  it("the engine names no business, trade or offer", () => {
    const source = read("src/services/offer-experiment.ts").toLowerCase();
    for (const word of ["bloomy", "devcomm", "fleur", "site internet", "biz_"]) expect(source).not.toContain(word);
  });

  it("the report is read-only, pinned to devcomm-os and uses equality queries only", () => {
    const report = read("scripts/offer-experiment-report.mjs");
    expect(report).toContain('const PROJECT_ID = "devcomm-os"');
    expect(report).toContain("FIRESTORE_EMULATOR_HOST is set — refusing.");
    expect(report).not.toMatch(/\.(set|update|delete|add|create)\(/);
    const operators = [...report.matchAll(/\.where\("[^"]+",\s*"([^"]+)"/g)].map((match) => match[1]);
    expect(operators.length).toBeGreaterThan(0);
    expect(new Set(operators)).toEqual(new Set(["=="]));
    expect(report).not.toMatch(/orderBy\(/);
  });

  it("the experiment seed plans by default, never deletes, and is pinned to devcomm-os", () => {
    const seed = read("scripts/seed-offer-experiment.mjs");
    expect(seed).toContain('const PROJECT_ID = "devcomm-os"');
    expect(seed).toContain('process.argv.includes("--write")');
    expect(seed).toContain("if (!WRITE) {");
    expect(seed).not.toMatch(/\.delete\(\)/);
    // Refuses to write when any variant or the knowledge base fails its check.
    expect(seed).toMatch(/if \(problems\.length\) \{[\s\S]*process\.exit\(1\)/);
  });
});

// ── Terms lines: code, not the model, states the terms of a first DM ──────

describe("generateSocialDm — the offer's terms line, word for word", () => {
  const LINES: Record<string, string> = {
    off_a: "Notre formule : 0 € de création, puis 49 € HT par mois, engagement 24 mois.",
    off_b: "Notre formule : 0 € de création, puis 29 € HT par mois, engagement 36 mois.",
    off_c: "Notre formule : 490 € HT de mise en service, puis 29 € HT par mois, engagement 12 mois.",
    off_d: "Notre formule : 1\u00a0490 € HT, site livré, puis 15 € HT par mois d'hébergement et de maintenance, sans engagement."
  };
  const OPENING =
    "Bonjour, j'ai vu vos dernières réalisations sur votre page, elles sont superbes. Nous créons des sites clairs pour les artisans de votre secteur.";
  const QUESTION = "Je vous montre quelques exemples ?";

  function seedOffersWithLines(lines: Record<string, string> = LINES) {
    for (const id of OFFER_IDS) {
      fakeDb.seed(`${BIZ_PATH}/offers/${id}`, {
        workspaceId: WS,
        businessId: BIZ,
        name: `Offre ${id} — ${TERMS[id].monthlyPrice} € HT/mois`,
        description: "",
        targetPersonas: [],
        valuePropositions: [`Dès ${TERMS[id].monthlyPrice} € HT par mois`, "Un site pensé pour votre métier"],
        proofPoints: ["20 sites clients en ligne"],
        prohibitedPromises: [],
        pricingGuardrails: { ...TERMS[id], ...(lines[id] ? { termsLine: lines[id] } : {}) }
      });
    }
  }

  beforeEach(() => {
    seedOffersWithLines();
    ai.body = OPENING;
    ai.cta = QUESTION;
  });

  it("places each variant's own line between the model's opening and question; the model reads no other phrasing of the terms", async () => {
    for (const [index, id] of OFFER_IDS.entries()) {
      ai.inputs = [];
      seedCompany(`co_${index}`, { offerAssignment: { experimentId: EXP, offerId: id, assignedAt: Timestamp.now() } });
      const result = await generateSocialDm({ companyId: `co_${index}` });
      const draft = fakeDb.read(`outreach/${result.outreachId}`)!;

      expect(draft.generatedBody).toBe(`${OPENING}\n\n${LINES[id]}\n\n${QUESTION}`);
      expect(draft).toMatchObject({
        offerId: id,
        offerExperimentId: EXP,
        offerTermsLine: LINES[id],
        promptVersion: "social-dm-v2-terms",
        pricingGuardrailPassed: true,
        riskWarnings: []
      });

      expect(ai.inputs).toHaveLength(1);
      const input = ai.inputs[0] as {
        offer: { name: string; valuePropositions: string[]; proofPoints: string[] };
        settings: { outreachSystemPrompt: string; outreachUserPrompt: string };
      };
      expect(input.offer.name).toBe(`Offre ${id}`);
      expect(input.offer.valuePropositions).toEqual(["Un site pensé pour votre métier"]);
      expect(input.offer.proofPoints).toEqual(["20 sites clients en ligne"]);
      expect(input.settings.outreachSystemPrompt).toContain("Money is part 2's job, never yours");
      expect(input.settings.outreachUserPrompt).toContain(LINES[id]);
      expect(input.settings.outreachUserPrompt).not.toMatch(/\{\{(?:termsLine|questionShape)\}\}/);
      expect(input.settings.outreachUserPrompt).toMatch(/Shape of the closing question for this message: an? [a-z]/);
    }
  });

  it("redrafts once when the model talks money, and keeps the clean draft", async () => {
    seedCompany("co_1", { offerAssignment: { experimentId: EXP, offerId: "off_a", assignedAt: Timestamp.now() } });
    ai.queue = [
      { body: "Bonjour, nous créons votre site sans frais initiaux et pour un petit prix.", cta: QUESTION },
      { body: OPENING, cta: QUESTION }
    ];
    const result = await generateSocialDm({ companyId: "co_1" });
    const draft = fakeDb.read(`outreach/${result.outreachId}`)!;
    expect(ai.inputs).toHaveLength(2);
    expect(draft.generatedBody).toBe(`${OPENING}\n\n${LINES.off_a}\n\n${QUESTION}`);
    expect(draft.riskWarnings).toEqual([]);
  });

  it("after two drafts that talk money, keeps the better one and says what is wrong", async () => {
    seedCompany("co_1", { offerAssignment: { experimentId: EXP, offerId: "off_b", assignedAt: Timestamp.now() } });
    ai.queue = [
      { body: "Bonjour, votre site dès 19 € par mois, sans engagement, c'est cadeau.", cta: "" },
      { body: "Bonjour, un site abordable et rapide pour votre atelier de quartier.", cta: QUESTION }
    ];
    const result = await generateSocialDm({ companyId: "co_1" });
    const draft = fakeDb.read(`outreach/${result.outreachId}`)!;
    expect(ai.inputs).toHaveLength(2);
    expect(draft.generatedBody).toBe(`Bonjour, un site abordable et rapide pour votre atelier de quartier.\n\n${LINES.off_b}\n\n${QUESTION}`);
    expect((draft.riskWarnings as string[]).some((w) => w.startsWith("Hors phrase de conditions") && w.includes("abordable"))).toBe(true);
    expect(draft.pricingGuardrailPassed).toBe(false);
  });

  it("moves a question left at the end of the opening after the terms line, without a redraft", async () => {
    seedCompany("co_1", { offerAssignment: { experimentId: EXP, offerId: "off_c", assignedAt: Timestamp.now() } });
    ai.body = `${OPENING} ${QUESTION}`;
    ai.cta = "";
    const result = await generateSocialDm({ companyId: "co_1" });
    expect(ai.inputs).toHaveLength(1);
    expect(fakeDb.read(`outreach/${result.outreachId}`)!.generatedBody).toBe(`${OPENING}\n\n${LINES.off_c}\n\n${QUESTION}`);
  });

  it("does not use a line that contradicts its offer: the old path runs and the draft says why", async () => {
    seedOffersWithLines({ ...LINES, off_a: "Notre formule : 49 € HT par mois, sans engagement." });
    seedBusiness(null);
    seedCompany("co_1", { offerId: "off_a" });
    ai.body = NEUTRAL_BODY;
    const result = await generateSocialDm({ companyId: "co_1" });
    const draft = fakeDb.read(`outreach/${result.outreachId}`)!;
    expect(draft.generatedBody).toBe(NEUTRAL_BODY);
    expect(draft.promptVersion).toBe("social-dm-v1");
    expect(draft).not.toHaveProperty("offerTermsLine");
    expect((draft.riskWarnings as string[])[0]).toContain("phrase de conditions");
    const input = ai.inputs[0] as { settings: { outreachSystemPrompt: string } };
    expect(input.settings.outreachSystemPrompt).not.toContain("Money is part 2's job");
  });

  it("redrafts an opening that already ends with a question (two questions in one DM)", async () => {
    seedCompany("co_1", { offerAssignment: { experimentId: EXP, offerId: "off_a", assignedAt: Timestamp.now() } });
    ai.queue = [
      { body: "Bonjour, belle page ! Vous avez pensé à un site ?", cta: QUESTION },
      { body: OPENING, cta: QUESTION }
    ];
    const result = await generateSocialDm({ companyId: "co_1" });
    expect(ai.inputs).toHaveLength(2);
    expect(fakeDb.read(`outreach/${result.outreachId}`)!.generatedBody).toBe(`${OPENING}\n\n${LINES.off_a}\n\n${QUESTION}`);
  });

  it("keeps a usable first draft when the second call fails", async () => {
    seedCompany("co_1", { offerAssignment: { experimentId: EXP, offerId: "off_a", assignedAt: Timestamp.now() } });
    // A body the schema accepts but that misses its question, then a call that throws.
    ai.queue = [{ body: OPENING, cta: "" }];
    ai.failAfterQueue = true;
    const result = await generateSocialDm({ companyId: "co_1" });
    const draft = fakeDb.read(`outreach/${result.outreachId}`)!;
    expect(ai.inputs).toHaveLength(2);
    expect(draft.generatedBody).toBe(`${OPENING}\n\n${LINES.off_a}`);
    expect(draft.riskWarnings).toEqual(["Pas de question de clôture : le message se termine sur les conditions."]);
  });

  it("a forbidden word about the prospect is redrafted too (the vocabulary is closed, whoever it is about)", async () => {
    seedCompany("co_1", { offerAssignment: { experimentId: EXP, offerId: "off_a", assignedAt: Timestamp.now() } });
    ai.queue = [
      { body: "Bonjour ! Votre engagement pour les fleurs locales depuis 15 ans se voit sur votre page.", cta: QUESTION },
      { body: OPENING, cta: QUESTION }
    ];
    const result = await generateSocialDm({ companyId: "co_1" });
    expect(ai.inputs).toHaveLength(2);
    expect(fakeDb.read(`outreach/${result.outreachId}`)).toMatchObject({ pricingGuardrailPassed: true, riskWarnings: [] });
  });

  it("a paraphrase no word list catches is caught by the judge, and redrafted", async () => {
    seedCompany("co_1", { offerAssignment: { experimentId: EXP, offerId: "off_b", assignedAt: Timestamp.now() } });
    ai.queue = [
      { body: "Bonjour ! Vous ne sortez rien de votre trésorerie au départ, et votre atelier a enfin sa vitrine sur mobile.", cta: QUESTION },
      { body: OPENING, cta: QUESTION }
    ];
    judge.verdicts = [{ status: "states_terms", quote: "vous ne sortez rien de votre trésorerie au départ" }];
    const result = await generateSocialDm({ companyId: "co_1" });
    expect(ai.inputs).toHaveLength(2);
    expect(judge.calls).toHaveLength(2);
    expect(fakeDb.read(`outreach/${result.outreachId}`)).toMatchObject({
      generatedBody: `${OPENING}\n\n${LINES.off_b}\n\n${QUESTION}`,
      pricingGuardrailPassed: true,
      riskWarnings: []
    });
  });

  it("the judge never sees the terms line, and is skipped when the words already failed", async () => {
    seedCompany("co_1", { offerAssignment: { experimentId: EXP, offerId: "off_c", assignedAt: Timestamp.now() } });
    ai.queue = [
      { body: "Bonjour ! Un site abordable pour votre atelier de quartier et vos clients fidèles.", cta: QUESTION },
      { body: OPENING, cta: QUESTION }
    ];
    await generateSocialDm({ companyId: "co_1" });
    expect(judge.calls).toEqual([`${OPENING}\n${QUESTION}`]);
  });

  it("a judge that cannot answer leaves the draft unconfirmed, never checked", async () => {
    seedCompany("co_1", { offerAssignment: { experimentId: EXP, offerId: "off_a", assignedAt: Timestamp.now() } });
    judge.verdicts = [{ status: "unavailable", reason: "timeout" }];
    const result = await generateSocialDm({ companyId: "co_1" });
    const draft = fakeDb.read(`outreach/${result.outreachId}`)!;
    expect(ai.inputs).toHaveLength(1);
    expect(draft.pricingGuardrailPassed).toBe(false);
    expect((draft.riskWarnings as string[]).some((w) => w.startsWith("Relecture par l'IA de contrôle indisponible"))).toBe(true);
  });

  it("flags money talk the model kept after two drafts, and fails the offer check", async () => {
    seedCompany("co_1", { offerAssignment: { experimentId: EXP, offerId: "off_c", assignedAt: Timestamp.now() } });
    ai.body = "Bonjour ! On crée votre site sans aucun frais de création, c'est cadeau.";
    const result = await generateSocialDm({ companyId: "co_1" });
    const draft = fakeDb.read(`outreach/${result.outreachId}`)!;
    expect(ai.inputs).toHaveLength(2);
    expect(draft.pricingGuardrailPassed).toBe(false);
    expect((draft.riskWarnings as string[]).some((w) => w.startsWith("Hors phrase de conditions"))).toBe(true);
  });

  it("a clean draft missing its question beats one that talks money (money talk ranks worst)", async () => {
    seedCompany("co_1", { offerAssignment: { experimentId: EXP, offerId: "off_a", assignedAt: Timestamp.now() } });
    ai.queue = [
      { body: OPENING, cta: "" },
      { body: "Bonjour ! Votre site pour 49 € HT par mois seulement, nous nous occupons de tout.", cta: QUESTION }
    ];
    const result = await generateSocialDm({ companyId: "co_1" });
    const draft = fakeDb.read(`outreach/${result.outreachId}`)!;
    expect(ai.inputs).toHaveLength(2);
    expect(draft.generatedBody).toBe(`${OPENING}\n\n${LINES.off_a}`);
    expect(draft.pricingGuardrailPassed).toBe(true);
  });

  it("the verified facts reach the prompt labelled", async () => {
    seedCompany("co_1", { offerAssignment: { experimentId: EXP, offerId: "off_a", assignedAt: Timestamp.now() } });
    evidence.facts = [{ label: "Services affichés sur le site", value: "Livraison dans tout Lyon", confidence: 90 }];
    const result = await generateSocialDm({ companyId: "co_1" });
    const draft = fakeDb.read(`outreach/${result.outreachId}`)!;
    expect(ai.inputs).toHaveLength(1);
    expect(draft).toMatchObject({ pricingGuardrailPassed: true, riskWarnings: [] });
    expect((ai.inputs[0] as { personalizationFacts: Array<{ label: string }> }).personalizationFacts[0].label).toBe(
      "Services affichés sur le site"
    );
  });

  it("warns when an offer of a running experiment has no usable terms line", async () => {
    seedOffersWithLines({ ...LINES, off_b: "" });
    seedCompany("co_1", { offerAssignment: { experimentId: EXP, offerId: "off_b", assignedAt: Timestamp.now() } });
    ai.body = NEUTRAL_BODY;
    const result = await generateSocialDm({ companyId: "co_1" });
    const draft = fakeDb.read(`outreach/${result.outreachId}`)!;
    expect(draft.promptVersion).toBe("social-dm-v1");
    expect((draft.riskWarnings as string[])[0]).toContain("test A/B sans phrase de conditions");
    // The model wrote this variant's terms: the operator confirms it like a failed check.
    expect(draft.pricingGuardrailPassed).toBe(false);
  });

  it("onlyIfUnreviewed: a redraft script never rewrites a draft a person edited or approved", async () => {
    seedCompany("co_1", { offerAssignment: { experimentId: EXP, offerId: "off_a", assignedAt: Timestamp.now() } });
    const first = await generateSocialDm({ companyId: "co_1" });
    fakeDb.seed(`outreach/${first.outreachId}`, { ...fakeDb.read(`outreach/${first.outreachId}`)!, humanEditedAt: Timestamp.now(), generatedBody: "Texte retouché." });
    await expect(generateSocialDm({ companyId: "co_1", force: true, onlyIfUnreviewed: true })).rejects.toThrow(/reviewed by a person/);
    expect(fakeDb.read(`outreach/${first.outreachId}`)!.generatedBody).toBe("Texte retouché.");

    fakeDb.seed(`outreach/${first.outreachId}`, { ...fakeDb.read(`outreach/${first.outreachId}`)!, humanEditedAt: null, status: "approved" });
    await expect(generateSocialDm({ companyId: "co_1", force: true, onlyIfUnreviewed: true })).rejects.toThrow(/reviewed by a person/);
    // An explicit regeneration (no flag) still may: the person asked for it.
    await expect(generateSocialDm({ companyId: "co_1", force: true })).resolves.toMatchObject({ outreachId: first.outreachId });
  });

  it("a forced redraft after the line is removed drops the stored line", async () => {
    seedCompany("co_1", { offerAssignment: { experimentId: EXP, offerId: "off_d", assignedAt: Timestamp.now() } });
    const first = await generateSocialDm({ companyId: "co_1" });
    expect(fakeDb.read(`outreach/${first.outreachId}`)!.offerTermsLine).toBe(LINES.off_d);

    seedOffersWithLines({});
    ai.body = NEUTRAL_BODY;
    const second = await generateSocialDm({ companyId: "co_1", force: true });
    expect(second.outreachId).toBe(first.outreachId);
    const draft = fakeDb.read(`outreach/${second.outreachId}`)!;
    expect(draft).not.toHaveProperty("offerTermsLine");
    expect(draft.promptVersion).toBe("social-dm-v1");
  });
});

describe("updateOutreachDraft — a person's edit of a DM", () => {
  const LINE_A = "Notre formule : 0 € de création, puis 49 € HT par mois, engagement 24 mois.";
  const OPENING = "Bonjour ! J'ai vu vos dernières réalisations sur votre page, elles sont superbes et très soignées.";

  function seedWithLine() {
    for (const id of OFFER_IDS) {
      fakeDb.seed(`${BIZ_PATH}/offers/${id}`, {
        workspaceId: WS, businessId: BIZ, name: `Offre ${id}`, description: "", targetPersonas: [], valuePropositions: [],
        proofPoints: [], prohibitedPromises: [], pricingGuardrails: { ...TERMS[id], ...(id === "off_a" ? { termsLine: LINE_A } : {}) }
      });
    }
  }

  async function draftFor(opening: string) {
    seedWithLine();
    seedCompany("co_1", { offerAssignment: { experimentId: EXP, offerId: "off_a", assignedAt: Timestamp.now() } });
    ai.body = opening;
    ai.cta = "Je vous montre quelques exemples ?";
    const { outreachId } = await generateSocialDm({ companyId: "co_1" });
    return outreachId;
  }

  it("changing only the question keeps a money warning the generator found (no false clearance)", async () => {
    const id = await draftFor("Bonjour ! On crée votre site sans aucun frais de création, c'est cadeau, pour votre salon.");
    const before = fakeDb.read(`outreach/${id}`)!;
    expect(before.pricingGuardrailPassed).toBe(false);
    await updateOutreachDraft(id, { generatedBody: String(before.generatedBody).replace("Je vous montre quelques exemples ?", "On en parle ?") });
    const after = fakeDb.read(`outreach/${id}`)!;
    expect(after.pricingGuardrailPassed).toBe(false);
    expect((after.riskWarnings as string[]).some((w) => w.startsWith("Hors phrase de conditions"))).toBe(true);
    expect(after.humanEditedAt).toBeTruthy();
    expect(after.offerTermsLineIntact).toBe(true);
  });

  it("a typo fix on a clean draft stays clean", async () => {
    const id = await draftFor("Bonjour ! Votre boutique de fleurs locales existe depuis 15 ans, et cela se voit sur votre page Instagram.");
    const before = fakeDb.read(`outreach/${id}`)!;
    expect(before.pricingGuardrailPassed).toBe(true);
    await updateOutreachDraft(id, { generatedBody: String(before.generatedBody).replace("Instagram", "Instagram !") });
    expect(fakeDb.read(`outreach/${id}`)).toMatchObject({ pricingGuardrailPassed: true, riskWarnings: [] });
  });

  it("a one-word edit keeps what the judge found (the judge reads the edit again)", async () => {
    judge.verdicts = [
      { status: "states_terms", quote: "la première échéance n'arrive qu'une fois votre site en ligne" },
      { status: "states_terms", quote: "la première échéance n'arrive qu'une fois votre site en ligne" }
    ];
    const id = await draftFor("Bonjour ! Votre atelier est superbe, et la première échéance n'arrive qu'une fois votre site en ligne.");
    expect(fakeDb.read(`outreach/${id}`)!.pricingGuardrailPassed).toBe(false);
    judge.verdicts = [{ status: "states_terms", quote: "la première échéance n'arrive qu'une fois votre site en ligne" }];
    const body = String(fakeDb.read(`outreach/${id}`)!.generatedBody);
    await updateOutreachDraft(id, { generatedBody: body.replace("superbe", "vraiment superbe") });
    const after = fakeDb.read(`outreach/${id}`)!;
    expect(after.pricingGuardrailPassed).toBe(false);
    expect((after.riskWarnings as string[]).some((w) => w.includes("AI judge"))).toBe(true);
  });

  it("an edit the judge cannot read is left for the operator's confirmation", async () => {
    const id = await draftFor(OPENING);
    judge.verdicts = [{ status: "unavailable", reason: "timeout" }];
    const body = String(fakeDb.read(`outreach/${id}`)!.generatedBody);
    await updateOutreachDraft(id, { generatedBody: body.replace("superbes", "vraiment superbes") });
    const after = fakeDb.read(`outreach/${id}`)!;
    expect(after.pricingGuardrailPassed).toBe(false);
    expect((after.riskWarnings as string[]).some((w) => w.startsWith("Relecture par l'IA de contrôle indisponible"))).toBe(true);
  });

  it("removing the terms line is recorded, and the whole text is checked against the offer", async () => {
    const id = await draftFor(OPENING);
    await updateOutreachDraft(id, { generatedBody: `${OPENING}\n\nC'est sans engagement !` });
    const after = fakeDb.read(`outreach/${id}`)!;
    expect(after.offerTermsLineIntact).toBe(false);
    expect(after.pricingGuardrailPassed).toBe(false);
    expect((after.riskWarnings as string[])[0]).toContain("a été modifiée ou retirée");
  });

  it("an edit that leaves the text unchanged keeps the stored review, and still protects the draft from redrafts", async () => {
    const id = await draftFor("Bonjour ! On crée votre site sans aucun frais de création, c'est cadeau, pour votre salon.");
    const before = fakeDb.read(`outreach/${id}`)!;
    await updateOutreachDraft(id, { internalSalesNotes: "Relu." });
    const after = fakeDb.read(`outreach/${id}`)!;
    expect(after.riskWarnings).toEqual(before.riskWarnings);
    expect(after.pricingGuardrailPassed).toBe(false);
    expect(after.humanEditedAt).toBeTruthy();
  });

  it("keeps the warning that the experiment offer has no usable line", async () => {
    seedOffers(); // no terms lines
    seedCompany("co_1", { offerAssignment: { experimentId: EXP, offerId: "off_b", assignedAt: Timestamp.now() } });
    ai.body = NEUTRAL_BODY;
    const { outreachId } = await generateSocialDm({ companyId: "co_1" });
    await updateOutreachDraft(outreachId, { generatedBody: `${NEUTRAL_BODY} Merci !` });
    expect((fakeDb.read(`outreach/${outreachId}`)!.riskWarnings as string[])[0]).toContain("test A/B sans phrase de conditions");
  });
});

describe("generateOutreach — a forced email regeneration never takes over a DM draft", () => {
  it("writes the email to its own document and leaves the DM draft untouched", async () => {
    seedBusiness(null);
    seedCompany("co_1", { offerId: "off_a", discoveryCampaignId: "disc_1" });
    fakeDb.seed("discoveryCampaigns/disc_1", { workspaceId: WS, businessId: BIZ, offerId: "off_a" });
    fakeDb.seed("contacts/c_1", { companyId: "co_1", email: "contact@societe.fr", workspaceId: WS, businessId: BIZ });
    fakeDb.seed("outreach/dm_1", {
      workspaceId: WS, businessId: BIZ, companyId: "co_1", channel: "social_dm", status: "draft", generatedBody: "Le DM."
    });
    const result = await generateOutreach({ companyId: "co_1", campaignId: "disc_1", force: true });
    expect(result.outreachId).not.toBe("dm_1");
    expect(fakeDb.read("outreach/dm_1")).toMatchObject({ channel: "social_dm", generatedBody: "Le DM." });
  });
});
