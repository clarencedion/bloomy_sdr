import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Timestamp } from "firebase-admin/firestore";

// Offline only: Firestore is an in-memory fake, the AI provider, business
// context, evidence and spend recorder are stubbed. Everything else — the
// URL parser, the gate, the quota transaction, the session service, the DM
// generator and the logger — is the real code.
vi.mock("../../config/firebase.js", async () => {
  const { fakeDb } = await import("./fixtures/outbound-fake-firestore.js");
  return { adminDb: fakeDb };
});

const ai = vi.hoisted(() => ({
  body: "Bonjour, votre page Instagram montre de très belles compositions. Seriez-vous ouverts à un court échange ?",
  calls: 0,
  /** "mock" = no key configured: the factory's silent fallback. */
  providerName: "qwen"
}));
vi.mock("../../providers/ai/index.js", () => ({
  getResearchProvider: () => ({
    name: ai.providerName,
    model: "qwen-test",
    generateStructuredOutreach: async () => {
      ai.calls += 1;
      return {
        provider: "qwen",
        model: "qwen-test",
        output: { body: ai.body, internalSalesNotes: "", personalizationNotes: [] },
        rawOutput: {},
        estimatedInputTokens: 1200,
        estimatedOutputTokens: 90
      };
    }
  })
}));
vi.mock("../../services/business-context.js", () => ({ buildBusinessContext: async () => "Contexte de l'offre." }));
const evidence = vi.hoisted(() => ({ items: [] as unknown[], fails: false }));
vi.mock("../../services/evidence-service.js", () => ({
  getValidEvidence: async () => {
    if (evidence.fails) throw new Error("evidence unavailable");
    return evidence.items;
  },
  extractPersonalizationFacts: () => []
}));
const spend = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));
vi.mock("../../services/cost-guardrail-service.js", () => ({
  recordAiSpend: async (params: Record<string, unknown>) => {
    spend.calls.push(params);
    return 0;
  }
}));

import { fakeDb } from "./fixtures/outbound-fake-firestore.js";
import { parseSocialProfileUrl, resolveCompanySocialProfiles } from "../../services/social/social-profile.js";
import { canContactSocial, socialDmLockId, suppressSocialHandle } from "../../services/social/social-gate.js";
import { getSocialDmUsage, quotaDay, quotaDocId, reserveSocialDmSlot } from "../../services/daily-quota.js";
import { addToSuppressionList } from "../../services/can-contact.js";
import {
  AUTO_SEND_COOLDOWN_AFTER_BLOCK_MS,
  DEFAULT_SOCIAL_LIMITS,
  autoSendHoldReason,
  autoSendVerdict,
  checkAutoSend,
  checkBeforeSend,
  endSocialSession,
  getSocialLimits,
  listSocialDmQueue,
  recordSocialDmAutoHeld,
  recordSocialDmSent,
  recordSocialDmSkipped,
  reportSessionBlocked,
  reserveSendSlot,
  startSocialSession
} from "../../services/social/social-session-service.js";
import { findSocialProfileUrl, generateSocialDm, markSocialDmSent } from "../../services/social-dm-generation.js";

const WS = "ws_test";
const BIZ = "biz_alpha";
const OTHER_BIZ = "biz_beta";
const T0 = Date.parse("2026-11-10T09:00:00.000Z");

function seedSettings(extra: Record<string, unknown> = {}) {
  fakeDb.seed("settings/global", { automationPaused: false, testModeEnabled: false, ...extra });
}

function seedBusiness(id = BIZ, extra: Record<string, unknown> = {}) {
  fakeDb.seed(`workspaces/${WS}/businesses/${id}`, { workspaceId: WS, name: `Business ${id}`, ...extra });
}

function seedCompany(id: string, extra: Record<string, unknown> = {}) {
  fakeDb.seed(`companies/${id}`, { workspaceId: WS, businessId: BIZ, name: `Studio ${id}`, status: "qualified", ...extra });
}

function igProfile(handle: string) {
  return { url: `https://www.instagram.com/${handle}/`, handle };
}

function seedDraft(id: string, companyId: string, extra: Record<string, unknown> = {}, ageMinutes = 0) {
  fakeDb.seed(`outreach/${id}`, {
    workspaceId: WS,
    businessId: BIZ,
    companyId,
    channel: "social_dm",
    status: "draft",
    generatedBody: `Bonjour ${companyId}, un message court.`,
    socialProfiles: { instagram: igProfile(companyId) },
    socialProfileUrl: igProfile(companyId).url,
    pricingGuardrailPassed: true,
    mentionsCommercialTerms: false,
    riskWarnings: [],
    createdAt: Timestamp.fromMillis(T0 - ageMinutes * 60_000),
    ...extra
  });
}

const logTypes = () => fakeDb.list("logs").map((log) => log.type);

beforeEach(() => {
  fakeDb.reset();
  ai.calls = 0;
  ai.providerName = "qwen";
  spend.calls = [];
  evidence.items = [];
  evidence.fails = false;
  seedSettings();
  seedBusiness();
  seedBusiness(OTHER_BIZ);
});

// ── URL parsing ────────────────────────────────────────────────────────────

describe("parseSocialProfileUrl — only unambiguous profiles", () => {
  it.each([
    ["https://www.instagram.com/Bloomy.Fleurs/?hl=fr", "bloomy.fleurs"],
    ["instagram.com/bloomy_fleurs", "bloomy_fleurs"],
    ["http://instagram.com/bloomy?igshid=abc123&utm_source=ig", "bloomy"],
    ["https://m.instagram.com/bloomy/", "bloomy"],
    ["https://www.instagram.com/@bloomy", "bloomy"],
    ["https://www.instagram.com/%40bloomy/", "bloomy"],
    ["https://www.instagram.com/_u/bloomy", "bloomy"],
    ["https://www.instagram.com/bloomy/reels/", "bloomy"],
    ["https://www.instagram.com/bloomy/).", "bloomy"]
  ])("Instagram %s → %s", (url, handle) => {
    expect(parseSocialProfileUrl(url)).toEqual({ network: "instagram", handle, url: `https://www.instagram.com/${handle}/` });
  });

  it.each([
    ["https://www.facebook.com/BloomyFleurs/", "bloomyfleurs", "https://www.facebook.com/bloomyfleurs"],
    ["https://m.facebook.com/bloomyfleurs?ref=bookmarks", "bloomyfleurs", "https://www.facebook.com/bloomyfleurs"],
    ["https://mbasic.facebook.com/bloomyfleurs", "bloomyfleurs", "https://www.facebook.com/bloomyfleurs"],
    ["https://web.facebook.com/bloomyfleurs/", "bloomyfleurs", "https://www.facebook.com/bloomyfleurs"],
    ["https://fb.com/bloomyfleurs", "bloomyfleurs", "https://www.facebook.com/bloomyfleurs"],
    ["https://fr-fr.facebook.com/bloomyfleurs", "bloomyfleurs", "https://www.facebook.com/bloomyfleurs"],
    ["https://www.facebook.com/bloomyfleurs/posts/123456789", "bloomyfleurs", "https://www.facebook.com/bloomyfleurs"],
    ["https://www.facebook.com/pg/bloomyfleurs/about/", "bloomyfleurs", "https://www.facebook.com/bloomyfleurs"],
    ["https://www.facebook.com/profile.php?id=100089123456789&sk=about", "id:100089123456789", "https://www.facebook.com/profile.php?id=100089123456789"],
    ["https://www.facebook.com/pages/Bloomy-Fleurs/123456789012345", "id:123456789012345", "https://www.facebook.com/profile.php?id=123456789012345"],
    ["https://www.facebook.com/pages/category/Florist/Bloomy-Fleurs-123456789012345/", "id:123456789012345", "https://www.facebook.com/profile.php?id=123456789012345"],
    ["https://www.facebook.com/people/Bloomy-Fleurs/100089123456789/", "id:100089123456789", "https://www.facebook.com/profile.php?id=100089123456789"],
    ["https://www.facebook.com/p/Bloomy-Fleurs-100089123456789/", "id:100089123456789", "https://www.facebook.com/profile.php?id=100089123456789"],
    ["https://www.facebook.com/Bloomy-Fleurs-123456789012345/", "id:123456789012345", "https://www.facebook.com/profile.php?id=123456789012345"],
    ["https://www.facebook.com/123456789012345", "id:123456789012345", "https://www.facebook.com/profile.php?id=123456789012345"]
  ])("Facebook %s → %s", (url, handle, canonical) => {
    expect(parseSocialProfileUrl(url)).toEqual({ network: "facebook", handle, url: canonical });
  });

  it.each([
    // Instagram features and shims
    "https://www.instagram.com/p/CxYz123/",
    "https://www.instagram.com/reel/CxYz123/",
    "https://www.instagram.com/tv/CxYz123/",
    "https://www.instagram.com/stories/bloomy/123456/",
    "https://www.instagram.com/explore/tags/fleurs/",
    "https://www.instagram.com/accounts/login/?next=/bloomy/",
    "https://www.instagram.com/direct/inbox/",
    "https://www.instagram.com/embed.js",
    "https://l.instagram.com/?u=https%3A%2F%2Flinktr.ee%2Fbloomy",
    "https://www.instagram.com/",
    "https://www.instagram.com/bad..handle/",
    "https://help.instagram.com/bloomy",
    // Facebook features, pixel and share endpoints
    "https://www.facebook.com/tr?id=1234567890&ev=PageView&noscript=1",
    "https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fbloomy.fr",
    "https://www.facebook.com/sharer.php?u=https%3A%2F%2Fbloomy.fr",
    "https://www.facebook.com/plugins/page.php?href=bloomy",
    "https://www.facebook.com/dialog/feed?app_id=1",
    "https://www.facebook.com/groups/123456789012/",
    "https://www.facebook.com/events/123456789012/",
    "https://www.facebook.com/watch/?v=123456789",
    "https://www.facebook.com/photo.php?fbid=123456789",
    "https://www.facebook.com/photo/?fbid=123456789",
    "https://www.facebook.com/story.php?story_fbid=1&id=2",
    "https://www.facebook.com/login/",
    "https://www.facebook.com/login.php",
    "http://www.facebook.com/2008/fbml",
    "https://l.facebook.com/l.php?u=https%3A%2F%2Fbloomy.fr",
    "https://business.facebook.com/bloomyfleurs",
    "https://www.facebook.com/profile.php",
    "https://www.facebook.com/pages/Bloomy-Fleurs/",
    "https://www.facebook.com/",
    // Link-in-bio, look-alike hosts and junk
    "https://linktr.ee/bloomy",
    "https://beacons.ai/bloomy",
    "https://instagram.com.evil.example/bloomy",
    "https://notfacebook.com/bloomy",
    "https://www.instagram.com@evil.example/bloomy",
    "ftp://instagram.com/bloomy",
    "javascript:alert(1)",
    "@bloomy",
    "",
    "not a url"
  ])("rejects %s", (url) => {
    expect(parseSocialProfileUrl(url)).toBeNull();
  });
});

describe("resolveCompanySocialProfiles / findSocialProfileUrl", () => {
  it("prefers research evidence, then the directory listing, and never a link-in-bio page", async () => {
    seedCompany("co_a", {
      directoryUrl: "https://www.facebook.com/StudioA/",
      website: "https://linktr.ee/studio_a"
    });
    fakeDb.seed("companies/co_a/evidence/social_profile_instagram_url", { value: "https://www.instagram.com/Studio_A/?hl=fr" });

    expect(await resolveCompanySocialProfiles("co_a")).toEqual({
      instagram: { url: "https://www.instagram.com/studio_a/", handle: "studio_a" },
      facebook: { url: "https://www.facebook.com/studioa", handle: "studioa" }
    });
  });

  it("skips a pixel or share link that research picked up, and uses the website when it is itself a profile", async () => {
    seedCompany("co_b", { website: "https://www.instagram.com/co_b/" });
    fakeDb.seed("companies/co_b/evidence/social_profile_facebook_url", { value: "https://www.facebook.com/tr?id=1234567890" });
    fakeDb.seed("companies/co_b/evidence/social_profile_link_in_bio_url", { value: "https://linktr.ee/co_b" });

    expect(await resolveCompanySocialProfiles("co_b")).toEqual({ instagram: igProfile("co_b") });
  });

  it("a profile found by search and confirmed by the city alone is used only when its handle is the whole name", async () => {
    // Live case 2026-11-11: "Kustom Tattoo" (Paris) matched a Paris sneaker customiser on one shared word.
    seedCompany("co_k", { name: "Kustom Tattoo", city: "Paris", searchedInstagramUrl: "https://www.instagram.com/kustomtashoes/", searchedInstagramConfirmedBy: "city" });
    expect(await resolveCompanySocialProfiles("co_k")).toEqual({});
    // Recorded before the confirmation was stored: treated as the weakest one.
    seedCompany("co_k2", { name: "Kustom Tattoo", city: "Paris", searchedInstagramUrl: "https://www.instagram.com/kustomtashoes/" });
    expect(await resolveCompanySocialProfiles("co_k2")).toEqual({});

    seedCompany("co_am", { name: "Amalgame Tattoo Shop", city: "Lille", searchedInstagramUrl: "https://www.instagram.com/amalgametattooshop/", searchedInstagramConfirmedBy: "city" });
    expect(await resolveCompanySocialProfiles("co_am")).toEqual({ instagram: igProfile("amalgametattooshop") });

    // A phone number or postcode in the result ties the account to the business: the name match is enough.
    seedCompany("co_p", { name: "Barber Avenue", city: "Paris", searchedInstagramUrl: "https://www.instagram.com/barber_avenue_officiel/", searchedInstagramConfirmedBy: "phone" });
    expect(await resolveCompanySocialProfiles("co_p")).toEqual({ instagram: igProfile("barber_avenue_officiel") });
  });

  it("returns no URL for a company whose only link is a link-in-bio page", async () => {
    seedCompany("co_c", { socialProfileUrl: "https://linktr.ee/co_c" });
    expect(await findSocialProfileUrl("co_c")).toBeUndefined();
    expect(await findSocialProfileUrl("missing_company")).toBeUndefined();
  });

  it("returns Instagram before Facebook", async () => {
    seedCompany("co_d", { directoryUrl: "https://www.facebook.com/cod.page", website: "https://instagram.com/co_d" });
    expect(await findSocialProfileUrl("co_d")).toBe("https://www.instagram.com/co_d/");
  });
});

// ── Gate ───────────────────────────────────────────────────────────────────

describe("canContactSocial — the DM gate", () => {
  const gate = (overrides: Partial<Parameters<typeof canContactSocial>[0]> = {}) =>
    canContactSocial({
      workspaceId: WS,
      businessId: BIZ,
      companyId: "co_a",
      network: "instagram",
      handle: "co_a",
      purpose: "first_dm",
      ...overrides
    });

  it("allows a clean prospect", async () => {
    seedCompany("co_a");
    expect(await gate()).toEqual({ allowed: true });
  });

  it.each<[string, () => void | Promise<void>, string]>([
    ["company missing", () => undefined, "company_not_found"],
    ["company of another business", () => seedCompany("co_a", { businessId: OTHER_BIZ }), "company_other_business"],
    ["company attributed to no business", () => seedCompany("co_a", { businessId: undefined }), "company_not_attributed"],
    ["company of another workspace", () => seedCompany("co_a", { workspaceId: "ws_other" }), "company_other_workspace"],
    ["company marked do-not-contact", () => seedCompany("co_a", { doNotContact: true }), "company_marked_do_not_contact"],
    ["company disqualified", () => seedCompany("co_a", { status: "disqualified" }), "company_disqualified"],
    [
      "company domain suppressed",
      () => {
        seedCompany("co_a", { domain: "studio-a.fr" });
        fakeDb.seed("suppressionList/d1", { targetType: "domain", targetValue: "studio-a.fr", reason: "Opt-out" });
      },
      "suppressed: Opt-out"
    ],
    [
      "company SIREN suppressed",
      () => {
        seedCompany("co_a", { siren: "123456789" });
        fakeDb.seed("suppressionList/s1", { targetType: "siren", targetValue: "123456789", reason: "Legal" });
      },
      "suppressed: Legal"
    ],
    [
      "handle suppressed",
      async () => {
        seedCompany("co_a");
        await suppressSocialHandle({ workspaceId: WS, businessId: BIZ, network: "instagram", handle: "@CO_A", reason: "Asked to stop" });
      },
      "suppressed: Asked to stop"
    ]
  ])("refuses when %s", async (_label, setup, reason) => {
    await setup();
    expect(await gate()).toEqual({ allowed: false, reason });
    // These hold for replies too: suppression is never a first-contact rule.
    expect((await gate({ purpose: "reply" })).allowed).toBe(false);
  });

  it("never checks a profile URL as the company's domain", async () => {
    // Instagram-only business: its "website" is its profile.
    seedCompany("co_a", { website: "https://www.instagram.com/co_a/", domain: "instagram.com" });
    fakeDb.seed("suppressionList/d1", { targetType: "domain", targetValue: "instagram.com", reason: "Should never match" });
    expect(await gate()).toEqual({ allowed: true });
  });

  it("keeps a handle suppression on its own network", async () => {
    seedCompany("co_a");
    await suppressSocialHandle({ workspaceId: WS, network: "facebook", handle: "co_a", reason: "stop" });
    expect(await gate({ network: "instagram" })).toEqual({ allowed: true });
    expect((await gate({ network: "facebook" })).allowed).toBe(false);
  });

  it("refuses first messages in safe mode but lets replies through", async () => {
    seedCompany("co_a");
    seedSettings({ testModeEnabled: true });
    expect(await gate()).toEqual({ allowed: false, reason: "test_mode_enabled" });
    expect(await gate({ purpose: "reply" })).toEqual({ allowed: true });
  });

  it.each<[string, () => void]>([
    ["a DM was already sent", () => seedCompany("co_a", { socialDmSentAt: Timestamp.now() })],
    ["a contact form was already sent", () => seedCompany("co_a", { contactFormSentAt: Timestamp.now() })],
    ["the company is already contacted", () => seedCompany("co_a", { status: "contacted" })],
    ["the company already replied", () => seedCompany("co_a", { status: "replied" })],
    ["a meeting is booked", () => seedCompany("co_a", { status: "meeting_booked" })],
    [
      "an email was sent (even one with no tenant stamps)",
      () => {
        seedCompany("co_a");
        fakeDb.seed("outreach/legacy_email", { companyId: "co_a", status: "sent" });
      }
    ],
    [
      "an outreach was exported to the sequencer",
      () => {
        seedCompany("co_a");
        fakeDb.seed("outreach/exp", { workspaceId: WS, businessId: BIZ, companyId: "co_a", status: "exported" });
      }
    ]
  ])("one first message per company: refuses when %s, allows the reply", async (_label, setup) => {
    setup();
    expect(await gate()).toEqual({ allowed: false, reason: "already_contacted" });
    expect(await gate({ purpose: "reply" })).toEqual({ allowed: true });
  });

  it("refuses an empty handle or a missing business", async () => {
    seedCompany("co_a");
    expect(await gate({ handle: "  " })).toEqual({ allowed: false, reason: "invalid_handle" });
    expect(await gate({ businessId: "" })).toEqual({ allowed: false, reason: "not_attributed" });
  });
});

describe("suppressSocialHandle", () => {
  it("writes one deterministic, tenant-stamped entry and is idempotent", async () => {
    await suppressSocialHandle({ workspaceId: WS, businessId: BIZ, network: "instagram", handle: "@Studio.A", reason: "STOP", companyId: "co_a", conversationId: "conv_1" });
    await suppressSocialHandle({ workspaceId: WS, businessId: BIZ, network: "instagram", handle: "studio.a", reason: "second stop" });

    const entries = fakeDb.list("suppressionList");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      __id: "supp_social_instagram_studio.a",
      workspaceId: WS,
      businessId: BIZ,
      targetType: "social_handle",
      targetValue: "instagram:studio.a",
      reason: "STOP",
      companyId: "co_a",
      sourceConversationId: "conv_1"
    });
  });

  it("keeps two handles that differ only by '.' and '_' apart", async () => {
    await suppressSocialHandle({ workspaceId: WS, network: "instagram", handle: "foo.bar", reason: "stop" });
    await suppressSocialHandle({ workspaceId: WS, network: "instagram", handle: "foo_bar", reason: "stop" });
    expect(fakeDb.list("suppressionList").map((e) => e.targetValue).sort()).toEqual(["instagram:foo.bar", "instagram:foo_bar"]);
  });

  it("is honoured when added through the generic suppression list (normalised)", async () => {
    seedCompany("co_a");
    await addToSuppressionList({ targetType: "social_handle", targetValue: " Instagram:@CO_A ", reason: "manual" });
    expect(fakeDb.list("suppressionList")[0].targetValue).toBe("instagram:co_a");
    expect(
      await canContactSocial({ workspaceId: WS, businessId: BIZ, companyId: "co_a", network: "instagram", handle: "co_a", purpose: "first_dm" })
    ).toEqual({ allowed: false, reason: "suppressed: manual" });
  });
});

// ── Quota ──────────────────────────────────────────────────────────────────

describe("reserveSocialDmSlot — daily cap and spacing", () => {
  const scope = { workspaceId: WS, businessId: BIZ };
  const at = (seconds: number) => new Date(T0 + seconds * 1000);

  it("takes slots up to the cap, then refuses without throwing", async () => {
    const limits = { dailyCap: 2, minSpacingSeconds: 0 };
    expect(await reserveSocialDmSlot(scope, "instagram", limits, at(0))).toEqual({ ok: true, used: 1, cap: 2 });
    expect(await reserveSocialDmSlot(scope, "instagram", limits, at(1))).toEqual({ ok: true, used: 2, cap: 2 });
    expect(await reserveSocialDmSlot(scope, "instagram", limits, at(2))).toEqual({ ok: false, reason: "daily_cap", used: 2, cap: 2 });

    const counter = fakeDb.read(`dailyUsage/${quotaDocId(scope, quotaDay(at(0)))}`);
    expect(counter).toMatchObject({ workspaceId: WS, businessId: BIZ, social_dm_instagram: 2 });
  });

  it("holds sends apart by the minimum spacing and says how long to wait", async () => {
    const limits = { dailyCap: 30, minSpacingSeconds: 45 };
    expect((await reserveSocialDmSlot(scope, "instagram", limits, at(0))).ok).toBe(true);
    expect(await reserveSocialDmSlot(scope, "instagram", limits, at(10))).toEqual({
      ok: false,
      reason: "spacing",
      used: 1,
      cap: 30,
      retryInSeconds: 35
    });
    expect(await reserveSocialDmSlot(scope, "instagram", limits, at(45))).toEqual({ ok: true, used: 2, cap: 30 });
  });

  it("counts each network separately and starts again on a new (Paris) day", async () => {
    const limits = { dailyCap: 1, minSpacingSeconds: 45 };
    expect((await reserveSocialDmSlot(scope, "instagram", limits, at(0))).ok).toBe(true);
    expect((await reserveSocialDmSlot(scope, "facebook", limits, at(1))).ok).toBe(true);
    expect((await reserveSocialDmSlot(scope, "instagram", limits, at(100))).ok).toBe(false);
    expect((await reserveSocialDmSlot(scope, "instagram", limits, at(24 * 3600))).ok).toBe(true);
  });

  it("treats a cap of zero as 'network off' and rejects non-numeric limits loudly", async () => {
    expect(await reserveSocialDmSlot(scope, "instagram", { dailyCap: 0, minSpacingSeconds: 0 }, at(0))).toEqual({
      ok: false,
      reason: "daily_cap",
      used: 0,
      cap: 0
    });
    await expect(reserveSocialDmSlot(scope, "instagram", { dailyCap: Number.NaN, minSpacingSeconds: 45 })).rejects.toThrow(/finite/);
    await expect(reserveSocialDmSlot({ workspaceId: WS, businessId: "" }, "instagram", DEFAULT_SOCIAL_LIMITS)).rejects.toThrow(/business/);
  });

  it("reports today's usage per network", async () => {
    expect(await getSocialDmUsage(scope, "facebook")).toBe(0);
    await reserveSocialDmSlot(scope, "facebook", { dailyCap: 5, minSpacingSeconds: 0 });
    expect(await getSocialDmUsage(scope, "facebook")).toBe(1);
    expect(await getSocialDmUsage(scope, "instagram")).toBe(0);
  });
});

describe("getSocialLimits / reserveSendSlot", () => {
  it("uses the defaults (30/day, 45 s) unless the business sets usable numbers", async () => {
    expect(await getSocialLimits(WS, BIZ, "instagram")).toEqual({ dailyCap: 30, minSpacingSeconds: 45 });
    seedBusiness(BIZ, { socialLimits: { instagram: { dailyCap: 12.7, minSpacingSeconds: 90 }, facebook: { dailyCap: -1, minSpacingSeconds: "x" } } });
    expect(await getSocialLimits(WS, BIZ, "instagram")).toEqual({ dailyCap: 12, minSpacingSeconds: 90 });
    expect(await getSocialLimits(WS, BIZ, "facebook")).toEqual({ dailyCap: 30, minSpacingSeconds: 45 });
  });

  it("reserves against the business's own limits", async () => {
    seedBusiness(BIZ, { socialLimits: { instagram: { dailyCap: 1, minSpacingSeconds: 0 } } });
    expect(await reserveSendSlot({ workspaceId: WS, businessId: BIZ, network: "instagram" })).toEqual({ ok: true, used: 1, cap: 1 });
    expect(await reserveSendSlot({ workspaceId: WS, businessId: BIZ, network: "instagram" })).toMatchObject({ ok: false, reason: "daily_cap" });
  });
});

// ── Queue ──────────────────────────────────────────────────────────────────

describe("listSocialDmQueue", () => {
  it("returns sendable drafts of this business and network, oldest first, gate-checked", async () => {
    for (const id of ["co_a", "co_b", "co_c", "co_d", "co_e", "co_f", "co_g", "co_h", "co_i", "co_j"]) seedCompany(id);
    seedCompany("co_x", { businessId: OTHER_BIZ });
    seedCompany("co_dnc", { doNotContact: true });
    seedCompany("co_mailed");
    fakeDb.seed("outreach/email_sent", { workspaceId: WS, businessId: BIZ, companyId: "co_mailed", channel: "email", status: "sent" });

    seedDraft("d_newer", "co_a", {}, 10);
    seedDraft("d_oldest", "co_b", {}, 60);
    seedDraft("d_other_business", "co_x", { businessId: OTHER_BIZ }, 90);
    seedDraft("d_approved", "co_c", { status: "approved" }, 90);
    seedDraft("d_email", "co_d", { channel: "email" }, 90);
    seedDraft("d_skipped_recently", "co_e", { skippedAt: Timestamp.fromMillis(Date.now() - 3600_000) }, 90);
    seedDraft("d_skipped_long_ago", "co_f", { skippedAt: Timestamp.fromMillis(Date.now() - 2 * 86_400_000) }, 30);
    seedDraft("d_dnc", "co_dnc", {}, 90);
    seedDraft("d_mailed", "co_mailed", {}, 90);
    seedDraft("d_facebook_only", "co_g", { socialProfiles: { facebook: { url: "https://www.facebook.com/cog.page", handle: "cog.page" } }, socialProfileUrl: "https://www.facebook.com/cog.page" }, 90);
    seedDraft("d_duplicate", "co_a", {}, 5);
    seedDraft("d_empty", "co_h", { generatedBody: "   " }, 90);
    // Written before Phase 23: no socialProfiles, a link-in-bio as its only
    // link; the company's research evidence still has the profile.
    seedDraft("d_legacy", "co_i", { socialProfiles: undefined, socialProfileUrl: "https://linktr.ee/co_i" }, 1);
    // The handle matches the company's name, so the scraped profile is trusted (profile-trust.ts).
    seedCompany("co_i", { name: "Studio Coi" });
    fakeDb.seed("companies/co_i/evidence/social_profile_instagram_url", { value: "https://instagram.com/co_i" });
    seedDraft("d_no_profile", "co_j", { socialProfiles: undefined, socialProfileUrl: "https://linktr.ee/co_j" }, 90);

    const queue = await listSocialDmQueue({ workspaceId: WS, businessId: BIZ, network: "instagram", limit: 50 });
    expect(queue.map((item) => item.outreachId)).toEqual(["d_oldest", "d_skipped_long_ago", "d_newer", "d_legacy"]);
    expect(queue[0]).toEqual({
      outreachId: "d_oldest",
      companyId: "co_b",
      companyName: "Studio co_b",
      network: "instagram",
      profile: igProfile("co_b"),
      body: "Bonjour co_b, un message court.",
      pricingGuardrailPassed: true,
      mentionsCommercialTerms: false,
      riskWarnings: []
    });
    expect(queue[3].profile).toEqual(igProfile("co_i"));

    const facebook = await listSocialDmQueue({ workspaceId: WS, businessId: BIZ, network: "facebook", limit: 50 });
    expect(facebook.map((item) => item.outreachId)).toEqual(["d_facebook_only"]);
    expect(facebook[0].profile).toEqual({ url: "https://www.facebook.com/cog.page", handle: "cog.page" });
  });

  it("stops at the limit", async () => {
    for (const id of ["co_a", "co_b", "co_c"]) {
      seedCompany(id);
      seedDraft(`d_${id}`, id);
    }
    expect(await listSocialDmQueue({ workspaceId: WS, businessId: BIZ, network: "instagram", limit: 2 })).toHaveLength(2);
    expect(await listSocialDmQueue({ workspaceId: WS, businessId: BIZ, network: "instagram", limit: 0 })).toEqual([]);
  });

  it("leaves out everything in safe mode", async () => {
    seedCompany("co_a");
    seedDraft("d_a", "co_a");
    seedSettings({ testModeEnabled: true });
    expect(await listSocialDmQueue({ workspaceId: WS, businessId: BIZ, network: "instagram", limit: 10 })).toEqual([]);
  });
});

describe("checkBeforeSend", () => {
  it("allows a queued draft and refuses one that left the queue or lost its gate", async () => {
    seedCompany("co_a");
    seedDraft("d_a", "co_a");
    expect(await checkBeforeSend({ outreachId: "d_a", network: "instagram" })).toEqual({ allowed: true });
    expect(await checkBeforeSend({ outreachId: "d_a", network: "facebook" })).toEqual({ allowed: false, reason: "no_profile_for_network" });
    expect(await checkBeforeSend({ outreachId: "missing", network: "instagram" })).toEqual({ allowed: false, reason: "outreach_not_found" });

    seedCompany("co_a", { doNotContact: true });
    expect(await checkBeforeSend({ outreachId: "d_a", network: "instagram" })).toEqual({ allowed: false, reason: "company_marked_do_not_contact" });

    seedDraft("d_rejected", "co_a", { status: "rejected" });
    expect(await checkBeforeSend({ outreachId: "d_rejected", network: "instagram" })).toEqual({ allowed: false, reason: "not_a_draft (rejected)" });
  });
});

// ── Recording ──────────────────────────────────────────────────────────────

describe("recordSocialDmSent", () => {
  const send = (overrides: Partial<Parameters<typeof recordSocialDmSent>[0]> = {}) =>
    recordSocialDmSent({
      outreachId: "d_a",
      network: "instagram",
      profile: igProfile("co_a"),
      finalBody: "Bonjour co_a, un message court.",
      edited: false,
      verified: true,
      threadUrl: "https://www.instagram.com/direct/t/1234567890/?hl=fr",
      sessionId: "sess_1",
      operator: "owner",
      ...overrides
    });

  beforeEach(() => {
    seedCompany("co_a", { name: "Atelier A" });
    seedDraft("d_a", "co_a", { campaignId: "camp_1" });
  });

  it("a draft pointing at a platform's account is never offered (written before the trust rule)", async () => {
    seedDraft("d_platform", "co_a", { socialProfiles: { instagram: igProfile("fresha") }, socialProfileUrl: igProfile("fresha").url });
    expect(await checkBeforeSend({ outreachId: "d_platform", network: "instagram" })).toMatchObject({ allowed: false });
    const queue = await listSocialDmQueue({ workspaceId: WS, businessId: BIZ, network: "instagram", limit: 10 });
    expect(queue.map((item) => item.outreachId)).not.toContain("d_platform");
  });

  it("records the text actually sent when it differs from the stored draft, and whether the terms line survived", async () => {
    const line = "Notre formule : 0 € de création, puis 49 € HT par mois, engagement 24 mois.";
    seedDraft("d_a", "co_a", { generatedBody: `Bonjour co_a.\n\n${line}\n\nOn en parle ?`, offerTermsLine: line, offerTermsLineIntact: true });
    // Typed before the draft changed: the stored text is not what the prospect read.
    await send({ finalBody: "Bonjour co_a, ancienne version sans les conditions.", edited: false });
    expect(fakeDb.read("outreach/d_a")).toMatchObject({
      generatedBody: "Bonjour co_a, ancienne version sans les conditions.",
      offerTermsLineIntact: false
    });
  });

  it("an unedited send of the stored text (whitespace aside) leaves the draft's text and flags alone", async () => {
    const line = "Notre formule : 0 € de création, puis 49 € HT par mois, engagement 24 mois.";
    const body = `Bonjour co_a.\n\n${line}\n\nOn en parle ?`;
    seedDraft("d_a", "co_a", { generatedBody: body, offerTermsLine: line, offerTermsLineIntact: true });
    await send({ finalBody: body.replace(/\n\n/g, "\n"), edited: false });
    expect(fakeDb.read("outreach/d_a")).toMatchObject({ generatedBody: body, offerTermsLineIntact: true });
  });

  it("marks the draft sent, takes the company lock and opens the conversation, in one transaction", async () => {
    const transactionsBefore = fakeDb.transactions;
    const result = await send();
    expect(fakeDb.transactions - transactionsBefore).toBe(1);

    const contactId = "social_instagram_co_a";
    const conversationId = `conv_co_a_${contactId}`;
    expect(result).toEqual({ conversationId, contactId });

    expect(fakeDb.read("outreach/d_a")).toMatchObject({
      status: "sent",
      sentNetwork: "instagram",
      sentVia: "browser_session",
      contactId,
      conversationId,
      socialHandle: "co_a",
      socialSessionId: "sess_1",
      generatedBody: "Bonjour co_a, un message court."
    });
    expect(fakeDb.read("outreach/d_a")?.sentAt).toBeInstanceOf(Timestamp);

    const company = fakeDb.read("companies/co_a");
    expect(company).toMatchObject({ status: "contacted", socialDmOutreachId: "d_a" });
    expect(company?.socialDmSentAt).toBeInstanceOf(Timestamp);

    const contact = fakeDb.read(`contacts/${contactId}`);
    expect(contact).toMatchObject({
      workspaceId: WS,
      businessId: BIZ,
      companyId: "co_a",
      channel: "instagram",
      socialHandle: "co_a",
      socialProfileUrl: "https://www.instagram.com/co_a/",
      status: "contacted",
      qualityScore: 70,
      dataQualityWarnings: []
    });
    expect(contact).not.toHaveProperty("email");
    expect(contact).not.toHaveProperty("firstName");

    expect(fakeDb.read(`conversations/${conversationId}`)).toMatchObject({
      id: conversationId,
      workspaceId: WS,
      businessId: BIZ,
      companyId: "co_a",
      contactId,
      outreachId: "d_a",
      campaignId: "camp_1",
      channel: "instagram",
      socialHandle: "co_a",
      socialProfileUrl: "https://www.instagram.com/co_a/",
      socialThreadUrl: "https://www.instagram.com/direct/t/1234567890/",
      companyName: "Atelier A",
      status: "sequence_active",
      unreadHumanAttention: false,
      messageCount: 1
    });
    expect(fakeDb.read(`conversations/${conversationId}`)).not.toHaveProperty("pendingExternalSend");

    const messages = fakeDb.list(`conversations/${conversationId}/messages`);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      __id: "msg_out_social_d_a",
      conversationId,
      workspaceId: WS,
      businessId: BIZ,
      direction: "outbound",
      channel: "instagram",
      senderEmail: "",
      recipientEmail: "",
      subject: "",
      recipientHandle: "co_a",
      bodyText: "Bonjour co_a, un message court.",
      deliveryStatus: "delivered",
      deliveredVia: "social_session"
    });
    expect(messages[0].sentAt).toBeInstanceOf(Timestamp);

    const logs = fakeDb.list("logs");
    expect(logs.map((log) => log.type)).toEqual(["outreach.social_dm.sent"]);
    expect(logs[0]).toMatchObject({
      workspaceId: WS,
      businessId: BIZ,
      metadata: { companyId: "co_a", outreachId: "d_a", channel: "instagram", viaSession: true, verified: true }
    });
  });

  it("is idempotent: a retried call returns the same ids and writes nothing twice", async () => {
    const first = await send();
    const second = await send();
    expect(second).toEqual(first);
    expect(fakeDb.list(`conversations/${first.conversationId}/messages`)).toHaveLength(1);
    expect(fakeDb.read(`conversations/${first.conversationId}`)?.messageCount).toBe(1);
    expect(logTypes()).toEqual(["outreach.social_dm.sent"]);
  });

  it("records an unverified send as not delivered and flags the conversation", async () => {
    const { conversationId } = await send({ verified: false });
    expect(fakeDb.read(`conversations/${conversationId}`)?.pendingExternalSend).toBe(true);
    // Review #20: the conversation needs a person until someone has checked.
    expect(fakeDb.read(`conversations/${conversationId}`)).toMatchObject({ unreadHumanAttention: true, humanAttentionRequired: true });
    expect(String(fakeDb.read(`conversations/${conversationId}`)?.escalationReason)).toMatch(/^Envoi non confirmé/);
    expect(fakeDb.list(`conversations/${conversationId}/messages`)[0].deliveryStatus).toBe("recorded_not_sent");
    expect(fakeDb.list("logs")[0].metadata).toMatchObject({ verified: false });
  });

  it("stores the person's edit as the draft's text", async () => {
    await send({ edited: true, finalBody: "Bonjour, texte revu à la main." });
    expect(fakeDb.read("outreach/d_a")?.generatedBody).toBe("Bonjour, texte revu à la main.");
  });

  it("refuses a second first DM to the same company and leaves that draft untouched", async () => {
    seedDraft("d_a2", "co_a");
    await send();
    await expect(send({ outreachId: "d_a2" })).rejects.toThrow(/already received its first direct message/);
    expect(fakeDb.read("outreach/d_a2")?.status).toBe("draft");
    expect(fakeDb.read("companies/co_a")?.socialDmOutreachId).toBe("d_a");
    // And the gate no longer offers it.
    expect(await checkBeforeSend({ outreachId: "d_a2", network: "instagram" })).toEqual({ allowed: false, reason: "already_contacted" });
    expect(await checkBeforeSend({ outreachId: "d_a", network: "instagram" })).toEqual({ allowed: false, reason: "not_a_draft (sent)" });
  });

  it("refuses a profile from another network, an empty message or an unattributed draft", async () => {
    await expect(send({ profile: { url: "https://www.facebook.com/coa.page", handle: "coa.page" } })).rejects.toThrow(/network/);
    await expect(send({ profile: { url: "https://linktr.ee/co_a", handle: "co_a" } })).rejects.toThrow(/network/);
    await expect(send({ finalBody: "   " })).rejects.toThrow(/empty/);
    seedDraft("d_unattributed", "co_a", { businessId: "" });
    await expect(send({ outreachId: "d_unattributed" })).rejects.toThrow(/not attributed/);
    expect(fakeDb.read("outreach/d_a")?.status).toBe("draft");
    expect(fakeDb.list("conversations")).toHaveLength(0);
  });
});

describe("recordSocialDmSkipped", () => {
  it("keeps the draft a draft, out of the queue for a day, and logs it", async () => {
    seedCompany("co_a");
    seedDraft("d_a", "co_a");
    await recordSocialDmSkipped({ outreachId: "d_a", network: "instagram", reason: "no_message_button", sessionId: "sess_1" });

    expect(fakeDb.read("outreach/d_a")).toMatchObject({ status: "draft", skipReason: "no_message_button", skippedNetwork: "instagram" });
    expect(fakeDb.read("outreach/d_a")?.skippedAt).toBeInstanceOf(Timestamp);
    expect(await listSocialDmQueue({ workspaceId: WS, businessId: BIZ, network: "instagram", limit: 10 })).toEqual([]);
    expect(logTypes()).toEqual(["outreach.social_dm.skipped"]);
    expect(fakeDb.list("logs")[0]).toMatchObject({ workspaceId: WS, businessId: BIZ, metadata: { companyId: "co_a", channel: "instagram" } });
  });

  it("does not touch a draft that already left the queue", async () => {
    seedCompany("co_a");
    seedDraft("d_sent", "co_a", { status: "sent" });
    await recordSocialDmSkipped({ outreachId: "d_sent", network: "instagram", reason: "skip" });
    expect(fakeDb.read("outreach/d_sent")).not.toHaveProperty("skippedAt");
    expect(logTypes()).toEqual([]);
  });
});

describe("social sessions", () => {
  it("opens a tenant-stamped session and refuses an unknown business", async () => {
    const { sessionId } = await startSocialSession({ workspaceId: WS, businessId: BIZ, network: "facebook", mode: "send", operator: "owner" });
    expect(fakeDb.read(`socialSessions/${sessionId}`)).toMatchObject({
      workspaceId: WS,
      businessId: BIZ,
      network: "facebook",
      mode: "send",
      status: "running",
      sent: 0,
      skipped: 0,
      replies: 0
    });
    expect(logTypes()).toEqual(["social_session.started"]);
    await expect(startSocialSession({ workspaceId: WS, businessId: "biz_typo", network: "facebook", mode: "send" })).rejects.toThrow(/not found/);
    await expect(
      startSocialSession({ workspaceId: WS, businessId: BIZ, network: "tiktok" as never, mode: "send" })
    ).rejects.toThrow(/Unknown social network/);
  });

  it("ends once with its totals, however many times the runner calls it", async () => {
    const { sessionId } = await startSocialSession({ workspaceId: WS, businessId: BIZ, network: "instagram", mode: "send" });
    await endSocialSession({ sessionId, sent: 3, skipped: 1, replies: 0, stoppedReason: "quit" });
    await endSocialSession({ sessionId, sent: 9, skipped: 9, replies: 9 });
    expect(fakeDb.read(`socialSessions/${sessionId}`)).toMatchObject({ status: "ended", sent: 3, skipped: 1, replies: 0, stoppedReason: "quit" });
    expect(logTypes()).toEqual(["social_session.started", "social_session.ended"]);
  });

  it("records a blocker without the URL's tokens and keeps the session marked blocked", async () => {
    const { sessionId } = await startSocialSession({ workspaceId: WS, businessId: BIZ, network: "instagram", mode: "send" });
    await reportSessionBlocked({
      sessionId,
      workspaceId: WS,
      businessId: BIZ,
      network: "instagram",
      reason: "checkpoint: Confirm it's you",
      url: "https://www.instagram.com/challenge/AXHsecretToken123/?next=%2Fdirect%2F&nonce=abc"
    });
    await endSocialSession({ sessionId, sent: 1, skipped: 0, replies: 0 });

    const session = fakeDb.read(`socialSessions/${sessionId}`);
    expect(session).toMatchObject({ status: "blocked", blockedReason: "checkpoint: Confirm it's you", blockedUrl: "https://www.instagram.com/challenge/" });
    const blocked = fakeDb.list("logs").find((log) => log.type === "outreach.social_dm.session_blocked");
    expect(blocked).toMatchObject({
      level: "warning",
      workspaceId: WS,
      businessId: BIZ,
      metadata: { sessionId, channel: "instagram", url: "https://www.instagram.com/challenge/" }
    });
    expect(JSON.stringify(fakeDb.list("logs"))).not.toMatch(/secretToken|nonce/);
  });

  it("never marks another business's session", async () => {
    const { sessionId } = await startSocialSession({ workspaceId: WS, businessId: OTHER_BIZ, network: "instagram", mode: "inbox" });
    await reportSessionBlocked({ sessionId, workspaceId: WS, businessId: BIZ, network: "instagram", reason: "login" });
    expect(fakeDb.read(`socialSessions/${sessionId}`)?.status).toBe("running");
  });
});

describe("automatic send sessions (ADR-024)", () => {
  const scope = { workspaceId: WS, businessId: BIZ, network: "instagram" as const };
  const blockedSession = (id: string, hoursAgo: number, extra: Record<string, unknown> = {}) =>
    fakeDb.seed(`socialSessions/${id}`, {
      workspaceId: WS,
      businessId: BIZ,
      network: "instagram",
      mode: "send",
      status: "blocked",
      blockedAt: Timestamp.fromMillis(Date.now() - hoursAgo * 3_600_000),
      ...extra
    });

  it("is allowed when nothing stands in the way", async () => {
    expect(await checkAutoSend(scope)).toEqual({ allowed: true });
  });

  it("is refused while the SDR is paused or in safe mode: the app's switch stops automatic DMs", async () => {
    seedSettings({ automationPaused: true });
    expect(await checkAutoSend(scope)).toEqual({ allowed: false, reason: "automation_paused" });
    seedSettings({ testModeEnabled: true });
    expect(await checkAutoSend(scope)).toEqual({ allowed: false, reason: "test_mode_enabled" });
  });

  it("is refused for 48 h after the network stopped a session of this business on this network, and says until when", async () => {
    expect(AUTO_SEND_COOLDOWN_AFTER_BLOCK_MS).toBe(48 * 3_600_000);
    blockedSession("s_old", 100);
    expect(await checkAutoSend(scope)).toEqual({ allowed: true });

    blockedSession("s_recent", 5);
    const verdict = await checkAutoSend(scope);
    expect(verdict).toMatchObject({ allowed: false, reason: "blocked_recently" });
    expect(Date.parse(String(verdict.retryAt)) - Date.now()).toBeGreaterThan(42 * 3_600_000);
    expect(Date.parse(String(verdict.retryAt)) - Date.now()).toBeLessThanOrEqual(43 * 3_600_000);
  });

  it("a block of another network, another business, another workspace, or a session that merely ended does not count", async () => {
    blockedSession("s_fb", 1, { network: "facebook" });
    blockedSession("s_other_biz", 1, { businessId: OTHER_BIZ });
    blockedSession("s_other_ws", 1, { workspaceId: "ws_other" });
    blockedSession("s_ended", 1, { status: "ended" });
    expect(await checkAutoSend(scope)).toEqual({ allowed: true });
    expect(await checkAutoSend({ ...scope, network: "facebook" })).toMatchObject({ allowed: false, reason: "blocked_recently" });
  });

  it("a real blocked session (reportSessionBlocked) turns automatic sending off", async () => {
    const { sessionId } = await startSocialSession({ ...scope, mode: "send", auto: true });
    // The running session names itself: it is not "an automatic session that never ended".
    expect(await checkAutoSend({ ...scope, sessionId })).toEqual({ allowed: true });
    await reportSessionBlocked({ sessionId, ...scope, reason: "action_blocked" });
    expect(await checkAutoSend({ ...scope, sessionId })).toMatchObject({ allowed: false, reason: "blocked_recently" });
  });

  it("a blocked session whose date cannot be read counts as blocked now", async () => {
    fakeDb.seed("socialSessions/s_undated", { workspaceId: WS, businessId: BIZ, network: "instagram", mode: "send", status: "blocked" });
    expect(await checkAutoSend(scope)).toMatchObject({ allowed: false, reason: "blocked_recently" });
  });

  describe("after a doubt, a person looks first", () => {
    const session = (id: string, minutesAgo: number, extra: Record<string, unknown>) =>
      fakeDb.seed(`socialSessions/${id}`, {
        workspaceId: WS,
        businessId: BIZ,
        network: "instagram",
        mode: "send",
        status: "ended",
        sent: 0,
        skipped: 0,
        startedAt: Timestamp.fromMillis(Date.now() - minutesAgo * 60_000),
        endedAt: Timestamp.fromMillis(Date.now() - (minutesAgo - 1) * 60_000),
        ...extra
      });
    const fresh = () => {
      fakeDb.reset();
      seedSettings();
      seedBusiness();
    };

    it("an automatic session that stopped on a doubt — or ended in a way nobody planned — turns automatic sending off", async () => {
      for (const stoppedReason of ["auto_unverified_send", "auto_typing_mismatch", "auto_thread_check", "error", "record_failed", "composer_lost"]) {
        fresh();
        session("s_doubt", 60, { auto: true, stoppedReason });
        expect(await checkAutoSend(scope), stoppedReason).toEqual({ allowed: false, reason: "doubt_stop_unreviewed" });
      }
      // The same endings of a session WITH keys are not doubts: a person was there.
      fresh();
      session("s_keys_error", 60, { stoppedReason: "error" });
      expect(await checkAutoSend(scope)).toEqual({ allowed: true });
    });

    it("an automatic session that never recorded its end (crash, closed terminal) counts too — but not the session that is asking", async () => {
      fresh();
      fakeDb.seed("socialSessions/s_crashed", { workspaceId: WS, businessId: BIZ, network: "instagram", mode: "send", auto: true, status: "running", startedAt: Timestamp.fromMillis(Date.now() - 3_600_000) });
      expect(await checkAutoSend(scope)).toEqual({ allowed: false, reason: "doubt_stop_unreviewed" });
      expect(await checkAutoSend({ ...scope, sessionId: "s_other" })).toEqual({ allowed: false, reason: "doubt_stop_unreviewed" });
      expect(await checkAutoSend({ ...scope, sessionId: "s_crashed" })).toEqual({ allowed: true });
    });

    it("only a later, finished session with keys in which a message was sent or skipped clears it", async () => {
      fresh();
      session("s_doubt", 60, { auto: true, stoppedReason: "auto_unverified_send" });
      // None of these is "a person looked":
      session("s_auto_later", 30, { auto: true, sent: 3 });
      session("s_inbox", 20, { mode: "inbox" });
      session("s_fb", 20, { network: "facebook", sent: 1 });
      session("s_other_biz", 20, { businessId: OTHER_BIZ, sent: 1 });
      session("s_before", 90, { sent: 2 });
      session("s_quit_at_prompt", 15, { stoppedReason: "operator_quit" });
      fakeDb.seed("socialSessions/s_running", { workspaceId: WS, businessId: BIZ, network: "instagram", mode: "send", status: "running", sent: 1, startedAt: Timestamp.fromMillis(Date.now() - 600_000) });
      expect(await checkAutoSend(scope)).toEqual({ allowed: false, reason: "doubt_stop_unreviewed" });

      session("s_keys", 10, { skipped: 1 });
      expect(await checkAutoSend(scope)).toEqual({ allowed: true });
    });

    it("an automatic session that ended for an ordinary reason needs no look", async () => {
      fresh();
      for (const [id, stoppedReason] of [["a", "operator_quit"], ["b", "daily_cap"], ["c", "auto_refused:automation_paused"], ["d", "selector_drift"], ["e", undefined]] as const) {
        session(`s_${id}`, 30, { auto: true, ...(stoppedReason ? { stoppedReason } : {}) });
      }
      expect(await checkAutoSend(scope)).toEqual({ allowed: true });
    });
  });

  it("refuses an unattributed call and an unknown network", async () => {
    expect(await checkAutoSend({ ...scope, businessId: "" })).toEqual({ allowed: false, reason: "not_attributed" });
    await expect(checkAutoSend({ ...scope, network: "tiktok" as never })).rejects.toThrow(/Unknown social network/);
  });

  it("the session record says it was automatic — and only a send session can be", async () => {
    const auto = await startSocialSession({ ...scope, mode: "send", operator: "owner", auto: true });
    expect(fakeDb.read(`socialSessions/${auto.sessionId}`)).toMatchObject({ mode: "send", auto: true });
    const started = fakeDb.list("logs").find((log) => log.type === "social_session.started");
    expect(started).toMatchObject({ workspaceId: WS, businessId: BIZ, metadata: { auto: true, mode: "send" } });

    const manual = await startSocialSession({ ...scope, mode: "send" });
    expect(fakeDb.read(`socialSessions/${manual.sessionId}`)).not.toHaveProperty("auto");
    const inbox = await startSocialSession({ ...scope, mode: "inbox", auto: true });
    expect(fakeDb.read(`socialSessions/${inbox.sessionId}`)).not.toHaveProperty("auto");
  });

  it("a DM sent by an automatic session is recorded as such on the draft and in the activity log; others are not", async () => {
    seedCompany("co_a", { name: "Atelier A" });
    seedDraft("d_a", "co_a");
    await recordSocialDmSent({
      outreachId: "d_a",
      network: "instagram",
      profile: igProfile("co_a"),
      finalBody: "Bonjour co_a, un message court.",
      edited: false,
      verified: true,
      sessionId: "sess_auto",
      operator: "owner",
      auto: true
    });
    expect(fakeDb.read("outreach/d_a")).toMatchObject({ status: "sent", sentVia: "browser_session", sentAuto: true });
    const sent = fakeDb.list("logs").find((log) => log.type === "outreach.social_dm.sent");
    expect(sent).toMatchObject({ metadata: { auto: true, viaSession: true } });
    expect(String(sent?.message)).toContain("automatic session");

    seedCompany("co_b", { name: "Atelier B" });
    seedDraft("d_b", "co_b");
    await recordSocialDmSent({ outreachId: "d_b", network: "instagram", profile: igProfile("co_b"), finalBody: "Bonjour co_b.", edited: false, verified: true });
    expect(fakeDb.read("outreach/d_b")).not.toHaveProperty("sentAuto");
    // "Sent by hand" is never automatic, whatever the caller says.
    seedCompany("co_c", { name: "Atelier C" });
    seedDraft("d_c", "co_c");
    await recordSocialDmSent({ outreachId: "d_c", network: "instagram", profile: igProfile("co_c"), finalBody: "Bonjour co_c.", edited: false, verified: true, via: "by_hand", auto: true });
    expect(fakeDb.read("outreach/d_c")).not.toHaveProperty("sentAuto");
  });
});

describe("which drafts an automatic session may send (ADR-024)", () => {
  const LINE = "Notre formule : 0 € de création, puis 49 € HT par mois, engagement 24 mois.";
  const body = (opening: string) => `${opening}\n\n${LINE}\n\nSeriez-vous ouvert à en parler ?`;
  const draft = (extra: Record<string, unknown> = {}) => ({
    workspaceId: WS,
    businessId: BIZ,
    companyId: "co_a",
    offerId: "off_a",
    channel: "social_dm",
    status: "draft",
    generatedBody: body("Bonjour, vos réalisations sur Instagram sont très soignées."),
    pricingGuardrailPassed: true,
    riskWarnings: [],
    offerTermsLine: LINE,
    offerTermsLineIntact: true,
    promptVersion: "social-dm-v2-terms",
    ...extra
  });
  const seedOffer = (extra: Record<string, unknown> = {}) =>
    fakeDb.seed(`workspaces/${WS}/businesses/${BIZ}/offers/off_a`, {
      workspaceId: WS,
      businessId: BIZ,
      name: "Site web",
      pricingGuardrails: {
        canDiscloseInColdReply: true,
        currency: "EUR",
        pricingModel: "subscription",
        setupFee: 0,
        monthlyPrice: 49,
        commitmentMonths: 24,
        taxLabel: "HT",
        termsLine: LINE
      },
      prohibitedPromises: ["premier sur Google"],
      ...extra
    });

  it("autoSendHoldReason: only a checked draft whose terms were written by code and are still in the text exactly once", () => {
    expect(autoSendHoldReason(draft())).toBeUndefined();

    expect(autoSendHoldReason(draft({ pricingGuardrailPassed: false }))).toBe("checks_not_passed");
    expect(autoSendHoldReason(draft({ pricingGuardrailPassed: undefined }))).toBe("checks_not_passed");
    expect(autoSendHoldReason(draft({ riskWarnings: ["Le message ne pose pas de question."] }))).toBe("has_warnings");
    // "No warning" must have been recorded as such: a draft without the list was never reviewed.
    expect(autoSendHoldReason(draft({ riskWarnings: "oops" }))).toBe("checks_not_passed");
    expect(autoSendHoldReason(draft({ riskWarnings: undefined }))).toBe("checks_not_passed");
    // An automatic session already left it to a person (its conversation was not new).
    expect(autoSendHoldReason(draft({ autoHeldAt: Timestamp.now() }))).toBe("left_for_person");
    expect(autoSendHoldReason(draft({ channel: "email" }))).toBe("not_a_social_dm");

    // The model wrote the whole message, terms included (an offer without a terms line): a heuristic is all that checked it.
    expect(autoSendHoldReason(draft({ offerTermsLine: undefined, promptVersion: "social-dm-v1" }))).toBe("terms_not_written_by_code");
    expect(autoSendHoldReason(draft({ offerTermsLine: "   " }))).toBe("terms_not_written_by_code");

    // The line was edited out, altered, or stated twice.
    expect(autoSendHoldReason(draft({ generatedBody: "Bonjour, un site à 49 € par mois, ça vous dit ?" }))).toBe("terms_line_not_intact");
    expect(autoSendHoldReason(draft({ generatedBody: `${body("Bonjour.")}\n${LINE}` }))).toBe("terms_line_not_intact");
    expect(autoSendHoldReason(draft({ offerTermsLineIntact: false }))).toBe("terms_line_not_intact");
    // Still there word for word, but no longer a paragraph of its own: a person's edit wrapped it in a sentence.
    expect(autoSendHoldReason(draft({ generatedBody: `Bonjour. Comme dit plus haut : ${LINE} Et bien plus encore.\n\nOn en parle ?` }))).toBe(
      "terms_line_not_intact"
    );
  });

  it("autoSendVerdict: allowed when the stored state is clean and the text claims nothing the evidence does not hold", async () => {
    seedCompany("co_a", { name: "Atelier A", city: "Lille" });
    seedOffer();
    expect(await autoSendVerdict(draft())).toEqual({ allowed: true });
  });

  it("autoSendVerdict: a figure about the prospect that no verified evidence holds waits for a person; the same figure, verified, passes", async () => {
    seedCompany("co_a", { name: "Atelier A", city: "Lille" });
    seedOffer();
    const claiming = draft({ generatedBody: body("Bonjour, vos 154 avis Google donnent envie de pousser la porte.") });

    const unverified = await autoSendVerdict(claiming);
    expect(unverified).toMatchObject({ allowed: false, reason: "unsupported_claim" });
    expect(String(unverified.detail)).toContain("154");

    // The key the Places provider really writes (`google_review_count`), and the older spelling.
    for (const key of ["google_review_count", "google_places_review_count"]) {
      evidence.items = [{ key, value: 154, confidence: 90 }];
      expect(await autoSendVerdict(claiming), key).toEqual({ allowed: true });
      evidence.items = [{ key, value: 12, confidence: 90 }];
      expect(await autoSendVerdict(claiming), key).toMatchObject({ allowed: false, reason: "unsupported_claim" });
      // Evidence nobody trusts is no evidence.
      evidence.items = [{ key, value: 154, confidence: 40 }];
      expect(await autoSendVerdict(claiming), key).toMatchObject({ allowed: false, reason: "unsupported_claim" });
    }
  });

  it("autoSendVerdict: the live phrasings pass when the figure is the verified one, rounded as a person would", async () => {
    seedCompany("co_a", { name: "Atelier A", city: "Lille" });
    seedOffer();
    // Sentences and counts from live drafts of 2026-11-11.
    for (const [opening, count, rating] of [
      ["Bonjour, avec une note parfaite de 5 sur Google et 87 avis, votre studio a conquis sa clientèle.", 87, 5],
      ["Bonjour, avec une note de 4,9 sur Google et plus de 110 avis, vous êtes une référence à Lille.", 114, 4.9],
      ["Bonjour, avec une note de 4,9 sur plus de 700 avis, votre réputation est solide.", 720, 4.9],
      ["Bonjour, avec 294 avis à 5 étoiles, vous êtes une référence.", 294, 5]
    ] as const) {
      evidence.items = [
        { key: "google_review_count", value: count, confidence: 90 },
        { key: "google_rating", value: rating, confidence: 90 }
      ];
      expect(await autoSendVerdict(draft({ generatedBody: body(opening) })), opening).toEqual({ allowed: true });
    }
    // A count far from the verified one is not "rounded".
    evidence.items = [{ key: "google_review_count", value: 87, confidence: 90 }];
    expect(await autoSendVerdict(draft({ generatedBody: body("Bonjour, avec plus de 700 avis, votre réputation est solide.") }))).toMatchObject({
      allowed: false,
      reason: "unsupported_claim"
    });
  });

  it("autoSendVerdict: another town than the prospect's, a prohibited promise, or a term the offer does not declare are held", async () => {
    seedCompany("co_a", { name: "Atelier A", city: "Lille" });
    seedOffer();
    for (const opening of [
      "Bonjour, j'ai vu votre studio à Marseille en passant.",
      "Bonjour, nous vous garantissons d'être premier sur Google.",
      "Bonjour, le premier mois est offert pour votre studio."
    ]) {
      expect(await autoSendVerdict(draft({ generatedBody: body(opening) })), opening).toMatchObject({ allowed: false, reason: "unsupported_claim" });
    }
  });

  it("autoSendVerdict fails closed: no company, no offer, unreadable evidence, or a draft tied to nothing", async () => {
    seedOffer();
    expect(await autoSendVerdict(draft())).toEqual({ allowed: false, reason: "claims_not_checkable" });

    fakeDb.reset();
    seedSettings();
    seedBusiness();
    seedCompany("co_a", { name: "Atelier A", city: "Lille" });
    expect(await autoSendVerdict(draft())).toEqual({ allowed: false, reason: "claims_not_checkable" });

    seedOffer();
    evidence.fails = true;
    expect(await autoSendVerdict(draft())).toEqual({ allowed: false, reason: "claims_not_checkable" });
    evidence.fails = false;
    expect(await autoSendVerdict(draft({ offerId: undefined }))).toEqual({ allowed: false, reason: "claims_not_checkable" });
    expect(await autoSendVerdict(draft({ companyId: undefined }))).toEqual({ allowed: false, reason: "claims_not_checkable" });
    // The stored state is asked first: nothing is read for a draft it already refuses.
    expect(await autoSendVerdict(draft({ pricingGuardrailPassed: false }))).toEqual({ allowed: false, reason: "checks_not_passed" });
  });

  it("autoSendVerdict: a rating is compared however the message phrases it — a 3.1 business is not told it has 4,9", async () => {
    seedCompany("co_a", { name: "Atelier A", city: "Lille" });
    seedOffer();
    evidence.items = [
      { key: "google_review_count", value: 112, confidence: 90 },
      { key: "google_rating", value: 3.1, confidence: 90 }
    ];
    for (const opening of [
      "Bonjour, avec une note de 4,9 sur Google et plus de 110 avis, vous êtes une référence.",
      "Bonjour, avec une note parfaite de 5 sur Google, votre studio plaît.",
      "Bonjour, avec 112 avis à 5 étoiles, vous êtes une référence.",
      "Bonjour, vous êtes noté 4,9/5 par vos clients.",
      "Bonjour, vos clients vous donnent 4.8 sur 5."
    ]) {
      expect(await autoSendVerdict(draft({ generatedBody: body(opening) })), opening).toMatchObject({ allowed: false, reason: "unsupported_claim" });
    }
    // The verified rating, in the same phrasings, passes.
    for (const opening of ["Bonjour, avec une note de 3,1 sur Google et plus de 110 avis, il y a une marge de progression.", "Bonjour, vous êtes noté 3,1/5."]) {
      expect(await autoSendVerdict(draft({ generatedBody: body(opening) })), opening).toEqual({ allowed: true });
    }
  });

  it("autoSendVerdict: every review count is compared, not only the first", async () => {
    seedCompany("co_a", { name: "Atelier A", city: "Lille" });
    seedOffer();
    evidence.items = [{ key: "google_review_count", value: 112, confidence: 90 }];
    expect(await autoSendVerdict(draft({ generatedBody: body("Bonjour, 112 avis sur Google, et même 900 avis ailleurs.") }))).toMatchObject({
      allowed: false,
      reason: "unsupported_claim"
    });
    evidence.items = [{ key: "google_review_count", value: 1240, confidence: 90 }];
    expect(await autoSendVerdict(draft({ generatedBody: body("Bonjour, avec 1 200 avis, votre réputation est faite.") }))).toEqual({ allowed: true });
  });

  it("autoSendVerdict: any figure the model wrote that no verified evidence holds waits for a person — followers, a year, opening hours, a quantity in words", async () => {
    seedCompany("co_a", { name: "Tattoo 13", city: "Lille", postalCode: "59000" });
    seedOffer();
    evidence.items = [
      { key: "google_review_count", value: 720, confidence: 90 },
      { key: "google_rating", value: 4.9, confidence: 90 },
      { key: "copyright_year", value: 2019, confidence: 80 },
      { key: "instagram_followers", value: 15300, confidence: 40 }
    ];
    for (const [opening, figure] of [
      ["Bonjour, vos 15 000 abonnés Instagram montrent votre succès.", "15000"],
      ["Bonjour, depuis 2008 vous faites référence à Lille.", "2008"],
      ["Bonjour, ouvert 7j/7, votre studio ne désemplit pas.", "7"],
      ["Bonjour, avec près de mille avis, votre réputation est faite.", "mille"],
      ["Bonjour, des centaines de clients vous recommandent.", "centaines"]
    ] as const) {
      const verdict = await autoSendVerdict(draft({ generatedBody: body(opening) }));
      expect(verdict, opening).toMatchObject({ allowed: false, reason: "unverified_figure" });
      expect(String(verdict.detail), opening).toContain(figure);
    }
    // A count of something else is not "a rounded review count".
    expect(await autoSendVerdict(draft({ generatedBody: body("Bonjour, vos 700 abonnés vous suivent de près.") }))).toMatchObject({
      allowed: false,
      reason: "unverified_figure"
    });
    // Figures the record does hold: the name's own number, a review count rounded as a person would, the rating, a year read on the site.
    for (const opening of [
      "Bonjour Tattoo 13, avec une note de 4,9 sur plus de 700 avis, votre réputation est solide.",
      "Bonjour, votre site affiche encore 2019 en pied de page."
    ]) {
      expect(await autoSendVerdict(draft({ generatedBody: body(opening) })), opening).toEqual({ allowed: true });
    }
    // The offer's own figures are in the terms line, written by code: they are not the model's to verify.
    expect(await autoSendVerdict(draft())).toEqual({ allowed: true });
  });

  it("autoSendVerdict: a phone number, a registration number or an address on record vouches for no figure", async () => {
    seedCompany("co_a", { name: "Atelier A", city: "Toulouse", postalCode: "31000", address: "12 rue des Arts" });
    seedOffer();
    evidence.items = [
      { key: "google_phone_number", value: "05 61 22 33 44", confidence: 90 },
      { key: "siren", value: 123456789, confidence: 95 },
      { key: "address", value: "12 rue des Arts, 31000 Toulouse", confidence: 90 },
      { key: "google_rating", value: 4.2, confidence: 90 },
      { key: "google_review_count", value: 112, confidence: 90 },
      { key: "mobile_pagespeed_score", value: 41, confidence: 85 }
    ];
    for (const opening of [
      "Bonjour, votre atelier noté 5 sur Google mérite un site à la hauteur.",
      "Bonjour, vos 12 ans d'expérience se voient.",
      "Bonjour, vos 2 tatoueurs font un travail soigné.",
      "Bonjour, depuis 22 ans vous marquez Toulouse.",
      "Bonjour, vos 40 créations récentes sont superbes.",
      "Bonjour, vos 120 abonnés vous suivent de près."
    ]) {
      expect((await autoSendVerdict(draft({ generatedBody: body(opening) }))).allowed, opening).toBe(false);
    }
    // The verified facts themselves still pass.
    expect(await autoSendVerdict(draft({ generatedBody: body("Bonjour, avec une note de 4,2 sur Google et plus de 110 avis, il y a de quoi faire.") }))).toEqual({ allowed: true });
  });

  it("recordSocialDmAutoHeld: the draft stays a draft in the queue of a session with keys, and no automatic session takes it again", async () => {
    seedCompany("co_a", { name: "Atelier A", city: "Lille" });
    seedOffer();
    fakeDb.seed("outreach/d_held", { ...draft(), socialProfiles: { instagram: igProfile("co_a") }, socialProfileUrl: igProfile("co_a").url, createdAt: Timestamp.fromMillis(T0) });
    expect(await autoSendVerdict(fakeDb.read("outreach/d_held") ?? {})).toEqual({ allowed: true });

    await recordSocialDmAutoHeld({ outreachId: "d_held", network: "instagram", reason: "thread_not_empty:text:Bonjour", sessionId: "sess_auto" });

    const stored = fakeDb.read("outreach/d_held") ?? {};
    expect(stored).toMatchObject({ status: "draft", autoHeldReason: "thread_not_empty:text:Bonjour", autoHeldNetwork: "instagram", autoHeldInSessionId: "sess_auto" });
    expect(stored.autoHeldAt).toBeDefined();
    expect(stored.skippedAt).toBeUndefined();
    expect(await autoSendVerdict(stored)).toEqual({ allowed: false, reason: "left_for_person" });
    // Still offered to a session with keys: not parked.
    const queue = await listSocialDmQueue({ workspaceId: WS, businessId: BIZ, network: "instagram", limit: 10 });
    expect(queue.map((item) => item.outreachId)).toContain("d_held");
    const log = fakeDb.list("logs").find((entry) => entry.type === "outreach.social_dm.left_for_person");
    expect(log).toMatchObject({ level: "info", workspaceId: WS, businessId: BIZ, metadata: { outreachId: "d_held", channel: "instagram", sessionId: "sess_auto" } });

    // A draft already sent or rejected is left alone.
    fakeDb.seed("outreach/d_sent", { ...draft(), status: "sent" });
    await recordSocialDmAutoHeld({ outreachId: "d_sent", network: "instagram", reason: "x" });
    expect(fakeDb.read("outreach/d_sent")).not.toHaveProperty("autoHeldAt");
    await expect(recordSocialDmAutoHeld({ outreachId: "missing", network: "instagram", reason: "x" })).rejects.toThrow(/not found/);
  });

  it("the offer is read in the draft's own business: another tenant's offer with the same id does not vouch for it", async () => {
    seedCompany("co_a", { name: "Atelier A", city: "Lille" });
    fakeDb.seed(`workspaces/${WS}/businesses/${OTHER_BIZ}/offers/off_a`, { workspaceId: WS, businessId: OTHER_BIZ, name: "Autre", pricingGuardrails: {} });
    expect(await autoSendVerdict(draft())).toEqual({ allowed: false, reason: "claims_not_checkable" });
  });
});

// ── Generation and the by-hand path ───────────────────────────────────────

describe("generateSocialDm", () => {
  it("refuses a company attributed to no business, before any AI call", async () => {
    seedCompany("co_a", { businessId: undefined, website: "https://www.instagram.com/co_a/" });
    await expect(generateSocialDm({ companyId: "co_a" })).rejects.toThrow(/not attributed to any business/);
    expect(ai.calls).toBe(0);
  });

  it("respects the automation pause unless forced", async () => {
    seedSettings({ automationPaused: true });
    seedCompany("co_a", { website: "https://www.instagram.com/co_a/" });
    await expect(generateSocialDm({ companyId: "co_a" })).rejects.toThrow(/paused/);
    expect(ai.calls).toBe(0);
    await expect(generateSocialDm({ companyId: "co_a", force: true })).resolves.toMatchObject({ channel: "social_dm" });
  });

  it("stores both profiles, keeps the Instagram link first, and records the AI spend", async () => {
    // Named like its handle, so the scraped Instagram is trusted (profile-trust.ts).
    seedCompany("co_a", { name: "Studio Coa", directoryUrl: "https://www.facebook.com/coa.page", discoveryCampaignId: "disc_1" });
    fakeDb.seed("companies/co_a/evidence/social_profile_instagram_url", { value: "https://www.instagram.com/co_a/?hl=fr" });

    const result = await generateSocialDm({ companyId: "co_a" });
    expect(result).toMatchObject({ channel: "social_dm", profileUrl: "https://www.instagram.com/co_a/", body: ai.body });
    expect(fakeDb.read(`outreach/${result.outreachId}`)).toMatchObject({
      workspaceId: WS,
      businessId: BIZ,
      companyId: "co_a",
      campaignId: "disc_1",
      channel: "social_dm",
      status: "draft",
      socialProfileUrl: "https://www.instagram.com/co_a/",
      socialProfiles: {
        instagram: igProfile("co_a"),
        facebook: { url: "https://www.facebook.com/coa.page", handle: "coa.page" }
      },
      pricingGuardrailPassed: true
    });
    expect(spend.calls).toEqual([
      expect.objectContaining({ operation: "social_dm_generation", workspaceId: WS, businessId: BIZ, companyId: "co_a", provider: "qwen", model: "qwen-test" })
    ]);
  });

  it("finds no DM channel behind a link-in-bio page", async () => {
    seedCompany("co_a", { website: "https://linktr.ee/co_a" });
    await expect(generateSocialDm({ companyId: "co_a" })).rejects.toThrow(/No public social profile/);
  });

  it("never puts a sent DM back in the queue, even when forced", async () => {
    seedCompany("co_a", { website: "https://www.instagram.com/co_a/" });
    seedDraft("d_a", "co_a", { status: "sent" });
    await expect(generateSocialDm({ companyId: "co_a", force: true })).rejects.toThrow(/already sent/);
    expect(fakeDb.read("outreach/d_a")?.status).toBe("sent");
    expect(ai.calls).toBe(0);
    // Without force the existing draft is returned unchanged, as before.
    await expect(generateSocialDm({ companyId: "co_a" })).resolves.toMatchObject({ outreachId: "d_a" });
  });

  it("regenerates a draft in place when forced", async () => {
    seedCompany("co_a", { website: "https://www.instagram.com/co_a/" });
    seedDraft("d_a", "co_a", { generatedBody: "Ancien texte." });
    const result = await generateSocialDm({ companyId: "co_a", force: true });
    expect(result.outreachId).toBe("d_a");
    expect(fakeDb.read("outreach/d_a")).toMatchObject({ status: "draft", generatedBody: ai.body });
  });
});

describe("markSocialDmSent — the by-hand path", () => {
  it("records once, takes the company lock and logs once, however many clicks", async () => {
    seedCompany("co_a");
    seedDraft("d_a", "co_a");
    expect(await markSocialDmSent({ outreachId: "d_a", sentByUserId: "user_1" })).toEqual({ success: true });
    const firstSentAt = fakeDb.read("outreach/d_a")?.sentAt;

    expect(await markSocialDmSent({ outreachId: "d_a", sentByUserId: "user_1" })).toEqual({ success: true, alreadySent: true });
    expect(fakeDb.read("outreach/d_a")).toMatchObject({ status: "sent", sentVia: "by_hand", sentByUserId: "user_1" });
    expect(fakeDb.read("outreach/d_a")?.sentAt).toBe(firstSentAt);
    expect(fakeDb.read("companies/co_a")).toMatchObject({ status: "contacted", socialDmOutreachId: "d_a" });
    expect(fakeDb.read("companies/co_a")?.socialDmSentAt).toBeInstanceOf(Timestamp);
    expect(logTypes()).toEqual(["outreach.social_dm.sent"]);

    // The lock now holds for every network and channel.
    expect(
      await canContactSocial({ workspaceId: WS, businessId: BIZ, companyId: "co_a", network: "facebook", handle: "coa.page", purpose: "first_dm" })
    ).toEqual({ allowed: false, reason: "already_contacted" });
  });

  it("keeps the first DM's lock and the contact-form lock where they were", async () => {
    const firstLock = Timestamp.fromMillis(T0);
    seedCompany("co_a", { socialDmSentAt: firstLock, socialDmOutreachId: "d_first" });
    seedDraft("d_a", "co_a");
    await markSocialDmSent({ outreachId: "d_a" });
    expect(fakeDb.read("companies/co_a")).toMatchObject({ socialDmSentAt: firstLock, socialDmOutreachId: "d_first" });

    seedCompany("co_f");
    seedDraft("f_1", "co_f", { channel: "contact_form" });
    await markSocialDmSent({ outreachId: "f_1" });
    expect(fakeDb.read("companies/co_f")?.contactFormSentAt).toBeInstanceOf(Timestamp);
    expect(fakeDb.read("companies/co_f")).not.toHaveProperty("socialDmSentAt");
    expect(logTypes()).toContain("outreach.contact_form.sent");
  });

  it("refuses an unknown draft", async () => {
    await expect(markSocialDmSent({ outreachId: "missing" })).rejects.toThrow(/Draft not found/);
  });
});

describe("source guards", () => {
  const functionsRoot = fs.existsSync(path.resolve(process.cwd(), "src/services"))
    ? process.cwd()
    : path.resolve(process.cwd(), "functions");
  const sources = ["social/social-profile.ts", "social/social-gate.ts", "social/social-session-service.ts", "social-dm-generation.ts"].map(
    (file) => [file, fs.readFileSync(path.join(functionsRoot, "src/services", file), "utf8")] as const
  );

  it.each(sources)("%s orders nothing in Firestore (no undeclared composite index)", (_file, source) => {
    expect(source).not.toMatch(/\.orderBy\(/);
  });

  it("the session service never sends anything itself: no browser, no HTTP", () => {
    const session = sources.find(([file]) => file.endsWith("social-session-service.ts"))?.[1] ?? "";
    expect(session).not.toMatch(/\bfetch\(|playwright|puppeteer|child_process/);
  });
});

// ── Adversarial review fixes (Phase 23) ───────────────────────────────────

describe("review #6 — one first DM per social account, across duplicate company documents", () => {
  // Discovery dedupes on SIREN / SIRET / domain only, so a social-only
  // business found twice becomes two company documents with one handle.
  const fbProfile = { url: "https://www.facebook.com/fleurs.paris", handle: "fleurs.paris" };
  function seedTwins() {
    seedCompany("co_a", { name: "Fleurs Paris" });
    seedCompany("co_b", { name: "Fleurs Paris (bis)" });
    seedDraft("d_a", "co_a", { socialProfiles: { instagram: igProfile("fleurs_paris") }, socialProfileUrl: igProfile("fleurs_paris").url }, 20);
    seedDraft("d_b", "co_b", { socialProfiles: { instagram: igProfile("fleurs_paris") }, socialProfileUrl: igProfile("fleurs_paris").url }, 10);
  }
  const sendA = () =>
    recordSocialDmSent({ outreachId: "d_a", network: "instagram", profile: igProfile("fleurs_paris"), finalBody: "Bonjour !", edited: false, verified: true });
  const lockPath = (network: "instagram" | "facebook", handle: string, businessId = BIZ) =>
    `socialDmLocks/${socialDmLockId(WS, businessId, network, handle)}`;

  it("never queues both twins in one session", async () => {
    seedTwins();
    const queue = await listSocialDmQueue({ workspaceId: WS, businessId: BIZ, network: "instagram", limit: 10 });
    expect(queue.map((item) => item.outreachId)).toEqual(["d_a"]);
  });

  it("refuses the second company once the account got its first DM, at every step", async () => {
    seedTwins();
    await sendA();

    expect(fakeDb.read(lockPath("instagram", "fleurs_paris"))).toMatchObject({
      workspaceId: WS,
      businessId: BIZ,
      network: "instagram",
      handle: "fleurs_paris",
      companyId: "co_a",
      outreachId: "d_a"
    });
    expect(
      await canContactSocial({ workspaceId: WS, businessId: BIZ, companyId: "co_b", network: "instagram", handle: "@Fleurs_Paris", purpose: "first_dm" })
    ).toEqual({ allowed: false, reason: "already_contacted_handle" });
    // A reply in an existing thread is not a first message.
    expect(
      (await canContactSocial({ workspaceId: WS, businessId: BIZ, companyId: "co_b", network: "instagram", handle: "fleurs_paris", purpose: "reply" })).allowed
    ).toBe(true);
    expect(await listSocialDmQueue({ workspaceId: WS, businessId: BIZ, network: "instagram", limit: 10 })).toEqual([]);
    expect(await checkBeforeSend({ outreachId: "d_b", network: "instagram" })).toEqual({ allowed: false, reason: "already_contacted_handle" });
    await expect(
      recordSocialDmSent({ outreachId: "d_b", network: "instagram", profile: igProfile("fleurs_paris"), finalBody: "Bonjour !", edited: false, verified: true })
    ).rejects.toThrow(/already received its first direct message/);
    expect(fakeDb.list("conversations")).toHaveLength(1);
    expect(fakeDb.read("outreach/d_b")?.status).toBe("draft");
  });

  it("is idempotent for the draft that took the lock", async () => {
    seedTwins();
    const first = await sendA();
    expect(await sendA()).toEqual(first);
  });

  it("counts a thread opened before the lock existed", async () => {
    seedCompany("co_b");
    fakeDb.seed("conversations/conv_legacy", { workspaceId: WS, businessId: BIZ, companyId: "co_old", channel: "instagram", socialHandle: "fleurs_paris" });
    expect(
      await canContactSocial({ workspaceId: WS, businessId: BIZ, companyId: "co_b", network: "instagram", handle: "fleurs_paris", purpose: "first_dm" })
    ).toEqual({ allowed: false, reason: "already_contacted_handle" });
    // Another network, another account.
    expect(
      await canContactSocial({ workspaceId: WS, businessId: BIZ, companyId: "co_b", network: "facebook", handle: "fleurs_paris", purpose: "first_dm" })
    ).toEqual({ allowed: true });
  });

  it("a hand-sent DM to the twin is recorded but opens no second conversation", async () => {
    seedTwins();
    await sendA();
    expect(await markSocialDmSent({ outreachId: "d_b", network: "instagram" })).toEqual({ success: true });
    expect(fakeDb.read("outreach/d_b")).toMatchObject({ status: "sent", sentVia: "by_hand", sentNetwork: "instagram" });
    expect(fakeDb.list("conversations")).toHaveLength(1);
    expect(fakeDb.read(lockPath("instagram", "fleurs_paris"))?.outreachId).toBe("d_a");
  });

  it("a plain by-hand mark locks every account the draft names", async () => {
    seedCompany("co_a");
    seedDraft("d_a", "co_a", { socialProfiles: { instagram: igProfile("fleurs_paris"), facebook: fbProfile } });
    // No network given and two profiles: ambiguous, so no conversation is guessed.
    await markSocialDmSent({ outreachId: "d_a" });
    expect(fakeDb.list("conversations")).toHaveLength(0);
    expect(fakeDb.read(lockPath("instagram", "fleurs_paris"))).toMatchObject({ outreachId: "d_a", companyId: "co_a" });
    expect(fakeDb.read(lockPath("facebook", "fleurs.paris"))).toMatchObject({ outreachId: "d_a", companyId: "co_a" });
    seedCompany("co_b");
    expect(
      await canContactSocial({ workspaceId: WS, businessId: BIZ, companyId: "co_b", network: "facebook", handle: "fleurs.paris", purpose: "first_dm" })
    ).toEqual({ allowed: false, reason: "already_contacted_handle" });
  });

  // Re-review: the lock was scoped to the workspace, so one business having
  // messaged an account stopped every other business from ever doing so.
  it("is one business's lock: another business may still send its own first DM to the account", async () => {
    seedTwins();
    await sendA();
    seedCompany("co_other", { businessId: OTHER_BIZ, name: "Fleurs Paris (other business)" });
    seedDraft("d_other", "co_other", {
      businessId: OTHER_BIZ,
      socialProfiles: { instagram: igProfile("fleurs_paris") },
      socialProfileUrl: igProfile("fleurs_paris").url
    });

    expect(
      await canContactSocial({ workspaceId: WS, businessId: OTHER_BIZ, companyId: "co_other", network: "instagram", handle: "fleurs_paris", purpose: "first_dm" })
    ).toEqual({ allowed: true });
    expect((await listSocialDmQueue({ workspaceId: WS, businessId: OTHER_BIZ, network: "instagram", limit: 10 })).map((item) => item.outreachId)).toEqual([
      "d_other"
    ]);
    await recordSocialDmSent({
      outreachId: "d_other",
      network: "instagram",
      profile: igProfile("fleurs_paris"),
      finalBody: "Bonjour !",
      edited: false,
      verified: true
    });
    expect(fakeDb.read(lockPath("instagram", "fleurs_paris", OTHER_BIZ))).toMatchObject({ businessId: OTHER_BIZ, outreachId: "d_other" });
    // The first business's lock is untouched, and its twin is still refused.
    expect(fakeDb.read(lockPath("instagram", "fleurs_paris"))).toMatchObject({ businessId: BIZ, outreachId: "d_a" });
    expect(await checkBeforeSend({ outreachId: "d_b", network: "instagram" })).toEqual({ allowed: false, reason: "already_contacted_handle" });
  });

  it("counts only this business's older threads, and an opt-out still covers every business", async () => {
    seedCompany("co_b");
    seedCompany("co_other", { businessId: OTHER_BIZ });
    fakeDb.seed("conversations/conv_legacy_other", { workspaceId: WS, businessId: OTHER_BIZ, companyId: "co_x", channel: "instagram", socialHandle: "fleurs_paris" });
    expect(
      await canContactSocial({ workspaceId: WS, businessId: BIZ, companyId: "co_b", network: "instagram", handle: "fleurs_paris", purpose: "first_dm" })
    ).toEqual({ allowed: true });

    await suppressSocialHandle({ workspaceId: WS, businessId: OTHER_BIZ, network: "instagram", handle: "fleurs_paris", reason: "Asked to stop" });
    expect(
      await canContactSocial({ workspaceId: WS, businessId: BIZ, companyId: "co_b", network: "instagram", handle: "fleurs_paris", purpose: "first_dm" })
    ).toEqual({ allowed: false, reason: "suppressed: Asked to stop" });
  });

  it("keeps lock ids apart across scopes and handles", () => {
    const ids = new Set([
      socialDmLockId(WS, BIZ, "instagram", "fleurs_paris"),
      socialDmLockId(WS, OTHER_BIZ, "instagram", "fleurs_paris"),
      socialDmLockId("ws_other", BIZ, "instagram", "fleurs_paris"),
      socialDmLockId(`${WS}_${BIZ}`, "", "instagram", "fleurs_paris"),
      socialDmLockId(WS, BIZ, "facebook", "fleurs_paris"),
      socialDmLockId(WS, BIZ, "instagram", "fleurs.paris")
    ]);
    expect(ids.size).toBe(6);
    expect(socialDmLockId(WS, BIZ, "instagram", "@Fleurs_Paris")).toBe(socialDmLockId(WS, BIZ, "instagram", "fleurs_paris"));
  });
});

describe("review #7 — 'I sent it' records the network the person used", () => {
  const fbProfile = { url: "https://www.facebook.com/coa.page", handle: "coa.page" };
  beforeEach(() => {
    seedCompany("co_a", { name: "Atelier A" });
    seedDraft("d_a", "co_a", { socialProfiles: { instagram: igProfile("co_a"), facebook: fbProfile } });
  });

  it("opens the conversation on Facebook when the DM went out on Facebook", async () => {
    await markSocialDmSent({ outreachId: "d_a", sentByUserId: "user_1", network: "facebook" });
    const conversation = fakeDb.read("conversations/conv_co_a_social_facebook_co_a");
    expect(conversation).toMatchObject({ channel: "facebook", socialHandle: "coa.page", socialProfileUrl: fbProfile.url });
    expect(fakeDb.read("conversations/conv_co_a_social_instagram_co_a")).toBeUndefined();
    expect(fakeDb.read("outreach/d_a")).toMatchObject({ status: "sent", sentNetwork: "facebook", sentVia: "by_hand", sentByUserId: "user_1" });
    expect(fakeDb.list("logs").find((log) => log.type === "outreach.social_dm.sent")?.metadata).toMatchObject({ channel: "facebook", byHand: true });
  });

  it("opens it on Instagram when told so", async () => {
    await markSocialDmSent({ outreachId: "d_a", network: "instagram" });
    expect(fakeDb.read("conversations/conv_co_a_social_instagram_co_a")).toMatchObject({ channel: "instagram", socialHandle: "co_a" });
  });

  it("guesses no network for a two-network draft: marks it sent with the lock, opens nothing", async () => {
    expect(await markSocialDmSent({ outreachId: "d_a" })).toEqual({ success: true });
    expect(fakeDb.list("conversations")).toHaveLength(0);
    expect(fakeDb.read("outreach/d_a")).toMatchObject({ status: "sent", sentVia: "by_hand" });
    expect(fakeDb.read("outreach/d_a")).not.toHaveProperty("sentNetwork");
    expect(fakeDb.read("companies/co_a")).toMatchObject({ status: "contacted", socialDmOutreachId: "d_a" });
  });

  it("uses the only profile of a one-network draft, and refuses an unknown network", async () => {
    seedCompany("co_b");
    seedDraft("d_b", "co_b", { socialProfiles: { facebook: { url: "https://www.facebook.com/cob.page", handle: "cob.page" } }, socialProfileUrl: "https://www.facebook.com/cob.page" });
    await markSocialDmSent({ outreachId: "d_b" });
    expect(fakeDb.read("conversations/conv_co_b_social_facebook_co_b")).toMatchObject({ channel: "facebook" });
    await expect(markSocialDmSent({ outreachId: "d_a", network: "tiktok" as never })).rejects.toThrow(/Unknown social network/);
  });

  it("the callable passes the network through and validates it", () => {
    const source = fs.readFileSync(path.join(functionsRootDir(), "src/index.ts"), "utf8");
    const callable = source.slice(source.indexOf("export const markSocialDmSentCallable"), source.indexOf("export const submitContactFormCallable"));
    expect(callable).toContain("const network = request.data?.network;");
    expect(callable).toContain('network !== "instagram" && network !== "facebook"');
    expect(callable).toContain("markSocialDmSent({ outreachId, sentByUserId: request.auth.uid, ...(network ? { network } : {}) })");
  });
});

describe("review #11 — no DM written by the mock provider is ever offered", () => {
  it("refuses to draft when no real model is configured", async () => {
    ai.providerName = "mock";
    seedCompany("co_a", { website: "https://www.instagram.com/co_a/" });
    await expect(generateSocialDm({ companyId: "co_a" })).rejects.toMatchObject({ name: "AiUnavailableError" });
    expect(ai.calls).toBe(0);
    expect(fakeDb.list("outreach")).toHaveLength(0);
    // Forcing does not change that.
    await expect(generateSocialDm({ companyId: "co_a", force: true })).rejects.toThrow(/No AI provider is configured/);
  });

  it("keeps an existing mock draft out of the queue and out of the pre-send gate", async () => {
    seedCompany("co_a");
    seedCompany("co_b");
    seedDraft("d_mock", "co_a", { aiProvider: "mock" }, 30);
    seedDraft("d_real", "co_b", { aiProvider: "qwen" }, 10);
    const queue = await listSocialDmQueue({ workspaceId: WS, businessId: BIZ, network: "instagram", limit: 10 });
    expect(queue.map((item) => item.outreachId)).toEqual(["d_real"]);
    expect(await checkBeforeSend({ outreachId: "d_mock", network: "instagram" })).toEqual({ allowed: false, reason: "mock_draft" });
  });

  it("regenerating a mock draft with a real model brings it back", async () => {
    seedCompany("co_a", { website: "https://www.instagram.com/co_a/" });
    seedDraft("d_mock", "co_a", { aiProvider: "mock" });
    await generateSocialDm({ companyId: "co_a", force: true });
    expect(fakeDb.read("outreach/d_mock")?.aiProvider).toBe("qwen");
    expect((await listSocialDmQueue({ workspaceId: WS, businessId: BIZ, network: "instagram", limit: 10 })).map((i) => i.outreachId)).toEqual(["d_mock"]);
  });
});

describe("review #22 / minor — a forced regeneration replaces the DM draft's fields", () => {
  it("drops a network research no longer finds (no deep merge of socialProfiles)", async () => {
    seedCompany("co_a", { website: "https://www.instagram.com/co_a/" });
    seedDraft("d_a", "co_a", {
      socialProfiles: { instagram: igProfile("co_a"), facebook: { url: "https://www.facebook.com/someone.else", handle: "someone.else" } }
    });
    await generateSocialDm({ companyId: "co_a", force: true });
    expect(fakeDb.read("outreach/d_a")?.socialProfiles).toEqual({ instagram: igProfile("co_a") });
    expect(await listSocialDmQueue({ workspaceId: WS, businessId: BIZ, network: "facebook", limit: 10 })).toEqual([]);
  });

  it("repairs a DM the email generator overwrote: email-only fields go, channel and profiles stay", async () => {
    seedCompany("co_a", { website: "https://www.instagram.com/co_a/" });
    seedDraft("d_a", "co_a", {
      generatedSubject: "Votre site web",
      generatedBody: "Bonjour Madame,\n\nJe me permets de vous contacter…\n\nBien cordialement,",
      followUp1: "Relance 1",
      followUp2: "Relance 2",
      linkedinNote: "note",
      pdfStorageUrl: "https://storage.example/p.pdf",
      promptVersion: "outreach-v9"
    });
    await generateSocialDm({ companyId: "co_a", force: true });
    const draft = fakeDb.read("outreach/d_a")!;
    expect(draft).toMatchObject({ channel: "social_dm", status: "draft", generatedBody: ai.body, promptVersion: "social-dm-v1" });
    for (const field of ["generatedSubject", "followUp1", "followUp2", "linkedinNote", "pdfStorageUrl"]) {
      expect(draft).not.toHaveProperty(field);
    }
    expect(draft.createdAt).toBeInstanceOf(Timestamp);
  });
});

describe("minor — DM spacing does not reset at Paris midnight", () => {
  const scope = { workspaceId: WS, businessId: BIZ };
  const limits = { dailyCap: 30, minSpacingSeconds: 45 };
  // 23:59:50 and 00:00:05 Paris time (UTC+1 in November).
  const beforeMidnight = new Date("2026-11-10T22:59:50.000Z");
  const afterMidnight = new Date("2026-11-10T23:00:05.000Z");

  it("holds the first send after midnight back by the last one before", async () => {
    expect(quotaDay(beforeMidnight)).not.toBe(quotaDay(afterMidnight));
    expect((await reserveSocialDmSlot(scope, "instagram", limits, beforeMidnight)).ok).toBe(true);
    expect(await reserveSocialDmSlot(scope, "instagram", limits, afterMidnight)).toEqual({
      ok: false,
      reason: "spacing",
      used: 0,
      cap: 30,
      retryInSeconds: 30
    });
    // The cap is still per day: the new day starts at zero.
    expect(await reserveSocialDmSlot(scope, "instagram", limits, new Date(beforeMidnight.getTime() + 45_000))).toEqual({ ok: true, used: 1, cap: 30 });
    expect(fakeDb.read(`dailyUsage/${WS}_${BIZ}_social_last`)).toMatchObject({ workspaceId: WS, businessId: BIZ });
  });

  it("still honours a last send recorded only in today's counter (before the pacing document existed)", async () => {
    fakeDb.seed(`dailyUsage/${quotaDocId(scope, quotaDay(beforeMidnight))}`, {
      social_dm_instagram: 1,
      social_dm_instagramLastAt: Timestamp.fromDate(beforeMidnight)
    });
    expect((await reserveSocialDmSlot(scope, "instagram", limits, new Date(beforeMidnight.getTime() + 5_000))).ok).toBe(false);
  });
});

function functionsRootDir(): string {
  return fs.existsSync(path.resolve(process.cwd(), "src/services")) ? process.cwd() : path.resolve(process.cwd(), "functions");
}
