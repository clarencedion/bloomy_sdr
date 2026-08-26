import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  humanizeActivity,
  humanizeActivityFeed,
  isTechnicalLog,
  toDate
} from "@/lib/sdr/activity-humanizer";
import { describeOpportunity, scoreBand } from "@/lib/sdr/opportunity-language";
import { computeFunnel, groupMeetingsByDay, statusLabel, attentionReason } from "@/lib/sdr/aggregations";
import {
  INBOX_FILTERS,
  conversationStateLabel,
  countByFilter,
  isAiHandling,
  matchesFilter,
  needsAttention,
  recommendedAction
} from "@/lib/sdr/inbox-filters";
import { requiresHumanAttention } from "@/lib/sdr/aggregations";
import { buildCampaignDocument } from "@/lib/sdr/launch-campaign";
import { primaryNavItems, advancedNavItems } from "@/lib/constants/navigation";
import type { Company, ConversationDoc, Outreach } from "@/types/firestore";
import type { IcpTranslationResult, OpportunityScore } from "@/types/domain";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../..");

// ── Activity humanizer ────────────────────────────────────────

describe("UX — SDR activity is readable by a non-technical owner", () => {
  it("hides plumbing events entirely", () => {
    const technical = [
      "queue.task.dead_letter",
      "queue.worker.batch_completed",
      "webhook.instantly.unauthorized",
      "settings.ai_secrets.saved",
      "api.spend.recorded",
      "signals.collection.run",
      "research.website_fetch",
      "contact_waterfall.dropcontact_failed"
    ];

    for (const type of technical) {
      expect(isTechnicalLog(type), `${type} should be hidden`).toBe(true);
      expect(humanizeActivity({ id: "l1", type })).toBeNull();
    }
  });

  it("names the company instead of showing an id", () => {
    const event = humanizeActivity(
      {
        id: "log_1",
        type: "contact_waterfall.completed",
        metadata: { companyId: "cmp_1", primaryContact: "Sophie Martin", found: 3 }
      },
      { resolveCompany: (id) => (id === "cmp_1" ? "Atelier Floral" : undefined) }
    );

    expect(event?.title).toBe("Found Sophie Martin at Atelier Floral");
    expect(event?.tone).toBe("person");
    expect(event?.companyId).toBe("cmp_1");
  });

  it("never leaks the raw technical log message into the feed", () => {
    const event = humanizeActivity(
      {
        id: "log_2",
        type: "outreach.sent",
        message: "Outreach sent to Instantly.ai. Campaign: DEVCOMM_MAIN",
        metadata: { companyId: "cmp_2" }
      },
      { resolveCompany: () => "Maison Flora" }
    );

    expect(event?.title).toBe("Email sent to Maison Flora");
    expect(JSON.stringify(event)).not.toContain("Instantly");
  });

  it("keeps only user-meaningful events, newest handling intact", () => {
    const events = humanizeActivityFeed(
      [
        { id: "a", type: "queue.task.enqueued" },
        { id: "b", type: "meeting.booked", metadata: { companyId: "c1", startTime: "2026-09-01T12:30:00.000Z" } },
        { id: "c", type: "reply_generator.ai_error" },
        { id: "d", type: "research.completed", metadata: { companyId: "c1", fitScore: 91.4 } }
      ],
      { resolveCompany: () => "Atelier Floral" }
    );

    expect(events.map((event) => event.id)).toEqual(["b", "d"]);
    expect(events[1].detail).toBe("Opportunity score: 91");
  });

  it("falls back to a neutral noun when the company is unknown", () => {
    const event = humanizeActivity({ id: "x", type: "outreach.sent", metadata: { companyId: "ghost" } });
    expect(event?.title).toBe("Email sent to a company");
  });

  it("parses Firestore timestamps, Dates and ISO strings", () => {
    expect(toDate({ toDate: () => new Date("2026-01-02T03:04:00Z") })?.getUTCFullYear()).toBe(2026);
    expect(toDate("2026-01-02T03:04:00Z")?.getUTCMonth()).toBe(0);
    expect(toDate(undefined)).toBeNull();
    expect(toDate("not-a-date")).toBeNull();
  });
});

// ── Opportunity language ──────────────────────────────────────

describe("UX — opportunity reasons are grounded in real scoring output", () => {
  const score = {
    companyFitScore: 80,
    needStrengthScore: 90,
    commercialValueScore: 70,
    evidenceConfidence: 85,
    overallScore: 91,
    qualificationState: "HIGH_PRIORITY",
    weights: {
      companyFitWeight: 0.3,
      needStrengthWeight: 0.4,
      commercialScaleWeight: 0.2,
      evidenceConfidenceWeight: 0.1
    },
    breakdown: {
      companyFitScore: 80,
      companyFitReasons: ["strong local reputation"],
      needStrengthScore: 90,
      needStrengthReasons: ["no online ordering detected"],
      commercialValueScore: 70,
      commercialValueReasons: ["strong local reputation"],
      evidenceConfidence: 85,
      confidenceReasons: [],
      penalties: ["website could not be fully checked"]
    },
    detectedNeeds: ["mobile performance 38/100"],
    buyingTriggers: [],
    recommendedAngle: "Lead with mobile performance",
    calculatedAt: new Date()
  } as unknown as OpportunityScore;

  it("summarises the score in plain language", () => {
    const summary = describeOpportunity(score);
    expect(summary?.score).toBe(91);
    expect(summary?.verdict).toBe("Top opportunity");
    expect(summary?.band).toBe("high");
    expect(summary?.angle).toBe("Lead with mobile performance");
  });

  it("de-duplicates repeated reasons and always surfaces one honest concern", () => {
    const summary = describeOpportunity(score);
    const labels = summary!.reasons.map((reason) => reason.label);

    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toContain("Mobile performance 38/100");
    expect(summary!.reasons.filter((reason) => reason.kind === "concern")).toHaveLength(1);
  });

  it("returns null rather than inventing reasons when there is no score", () => {
    expect(describeOpportunity(undefined)).toBeNull();
  });

  it("bands scores consistently", () => {
    expect(scoreBand(90)).toBe("high");
    expect(scoreBand(60)).toBe("medium");
    expect(scoreBand(10)).toBe("low");
  });
});

// ── Funnel ────────────────────────────────────────────────────

describe("UX — campaign funnel counts real pipeline state", () => {
  const companies = [
    { id: "c1", status: "contacted", opportunityScore: { qualificationState: "QUALIFIED" }, extractedEmailCount: 2 },
    { id: "c2", status: "researched", qualificationState: "HIGH_PRIORITY", leadReadyForOutreach: true },
    { id: "c3", status: "discovered" },
    // Advanced past qualification with no score recorded - the case that used
    // to make the funnel non-monotonic.
    { id: "c4", status: "meeting_booked" }
  ] as unknown as Company[];

  const outreach = [
    { id: "o1", companyId: "c2", status: "sent" },
    { id: "o2", companyId: "c1", status: "replied" }
  ] as unknown as Outreach[];

  const conversations = [
    { id: "cv1", companyId: "c4", status: "in_dialogue", messageCount: 3 }
  ] as unknown as ConversationDoc[];

  const meetings = [{ companyId: "c4", status: "scheduled" }];

  it("counts each company once per stage even across several records", () => {
    const funnel = computeFunnel({ companies, outreach, conversations, meetings });

    expect(funnel.found).toBe(4);
    // c1 (status) + c4 (status) + c2 (sent outreach)
    expect(funnel.contacted).toBe(3);
    // c1 (replied outreach) + c4 (meeting + conversation)
    expect(funnel.replies).toBe(2);
    expect(funnel.meetings).toBe(1);
  });

  it("is monotonic — no stage can exceed the stage before it", () => {
    const funnel = computeFunnel({ companies, outreach, conversations, meetings });
    const stages = [
      funnel.found,
      funnel.qualified,
      funnel.peopleFound,
      funnel.contacted,
      funnel.replies,
      funnel.meetings
    ];

    for (let i = 1; i < stages.length; i += 1) {
      expect(stages[i], `stage ${i} (${stages[i]}) must not exceed stage ${i - 1} (${stages[i - 1]})`).toBeLessThanOrEqual(
        stages[i - 1]
      );
    }
  });

  it("still counts a company as qualified after it has advanced past that status", () => {
    const funnel = computeFunnel({ companies, outreach, conversations, meetings });
    // c4 booked a meeting and carries no qualification state; it must not
    // vanish from the earlier stages.
    expect(funnel.qualified).toBeGreaterThanOrEqual(funnel.contacted);
    // c1, c2 and c4 all reached qualification; c3 is still only discovered.
    expect(funnel.qualified).toBe(3);
  });

  it("counts meetings as distinct companies, not meeting documents", () => {
    const funnel = computeFunnel({
      companies,
      outreach,
      conversations,
      meetings: [
        { companyId: "c4", status: "scheduled" },
        { companyId: "c4", status: "scheduled" },
        { companyId: "c4", status: "scheduled" }
      ]
    });

    expect(funnel.meetings).toBe(1);
    expect(funnel.meetings).toBeLessThanOrEqual(funnel.replies);
  });

  it("ignores cancelled meetings and meetings for companies outside the scope", () => {
    const funnel = computeFunnel({
      companies,
      outreach,
      conversations,
      meetings: [
        { companyId: "c4", status: "cancelled" },
        { companyId: "not_in_scope", status: "scheduled" }
      ]
    });

    // c4 still counts through its own `meeting_booked` status, but the
    // out-of-scope company must never appear.
    expect(funnel.meetings).toBe(1);
  });

  it("handles an empty campaign without dividing by zero", () => {
    const funnel = computeFunnel({ companies: [], outreach: [], conversations: [], meetings: [] });
    expect(funnel).toEqual({ found: 0, qualified: 0, peopleFound: 0, contacted: 0, replies: 0, meetings: 0 });
  });

  it("translates pipeline statuses into plain words", () => {
    expect(statusLabel("enrichment_pending")).toBe("Being checked");
    expect(statusLabel("meeting_booked")).toBe("Meeting booked");
    expect(statusLabel(undefined)).toBe("New");
  });
});

// ── Meetings ──────────────────────────────────────────────────

describe("UX — meetings read like an agenda", () => {
  it("groups by Today / Tomorrow / weekday", () => {
    const now = new Date("2026-08-26T09:00:00Z");
    const meetings = [
      { id: "m1", title: "Call", companyName: "A", startTime: new Date("2026-08-26T14:30:00Z"), status: "scheduled", bookedBySdr: true },
      { id: "m2", title: "Call", companyName: "B", startTime: new Date("2026-08-27T10:00:00Z"), status: "scheduled", bookedBySdr: true },
      { id: "m3", title: "Call", companyName: "C", startTime: new Date("2026-08-28T10:00:00Z"), status: "scheduled", bookedBySdr: false }
    ];

    const groups = groupMeetingsByDay(meetings, now);
    expect(groups[0].label).toBe("Today");
    expect(groups[1].label).toBe("Tomorrow");
    expect(groups[2].label).not.toBe("Tomorrow");
    expect(groups).toHaveLength(3);
  });
});

// ── Inbox ─────────────────────────────────────────────────────

describe("UX — inbox only interrupts the user when a human is needed", () => {
  const escalated = { id: "1", status: "human_escalated", companyId: "c" } as unknown as ConversationDoc;
  const handling = { id: "2", status: "in_dialogue", companyId: "c", messageCount: 2 } as unknown as ConversationDoc;
  const booked = { id: "3", status: "meeting_booked", companyId: "c" } as unknown as ConversationDoc;
  const interested = {
    id: "4",
    status: "in_dialogue",
    latestIntent: "POSITIVE",
    companyId: "c"
  } as unknown as ConversationDoc;

  it("treats escalated and flagged conversations as needing attention", () => {
    expect(needsAttention(escalated)).toBe(true);
    expect(needsAttention(handling)).toBe(false);
    expect(
      needsAttention({ id: "5", status: "in_dialogue", unreadHumanAttention: true } as unknown as ConversationDoc)
    ).toBe(true);
  });

  it("does not claim the AI is handling something that needs a human", () => {
    expect(isAiHandling(escalated)).toBe(false);
    expect(isAiHandling(handling)).toBe(true);
    expect(
      isAiHandling({ ...handling, manualTakeover: true } as unknown as ConversationDoc)
    ).toBe(false);
  });

  it("counts every filter without double-billing attention items", () => {
    const counts = countByFilter([escalated, handling, booked, interested]);
    expect(counts.needs_attention).toBe(1);
    expect(counts.ai_handling).toBe(2);
    expect(counts.booking).toBe(1);
    expect(counts.interested).toBe(1);
    expect(counts.all).toBe(4);
  });

  it("defaults the filter list to Needs attention first", () => {
    expect(INBOX_FILTERS[0].id).toBe("needs_attention");
  });

  it("explains state and next step in plain language", () => {
    expect(conversationStateLabel(escalated)).toBe("Your input needed");
    expect(conversationStateLabel(handling)).toBe("SDR handling conversation");
    expect(conversationStateLabel(booked)).toBe("Meeting booked");
    expect(recommendedAction({ ...interested, latestIntent: "BOOKING_REQUEST" } as ConversationDoc)).toBe(
      "Propose available meeting slots."
    );
    expect(recommendedAction(booked)).toBeNull();
    expect(attentionReason(escalated)).toBe("Your SDR was not confident enough to answer");
  });

  it("keeps unsubscribed prospects out of the default list", () => {
    const suppressed = { id: "6", status: "suppressed", companyId: "c" } as unknown as ConversationDoc;
    expect(matchesFilter(suppressed, "all")).toBe(false);
    expect(matchesFilter(suppressed, "needs_attention")).toBe(false);
  });
});

// ── Campaign launch ───────────────────────────────────────────

describe("UX — starting a campaign removes the manual steps", () => {
  const plan = {
    campaignName: "Florists — website redesign",
    segment: "custom",
    cities: ["Nantes"],
    departments: [],
    regions: [],
    nafCodes: ["4776Z"],
    keywords: ["fleuriste"],
    excludeKeywords: [],
    requireWebsite: false,
    targetPersonas: ["Owner"],
    providerPriority: ["recherche_entreprises"],
    researchStrategy: { enabledSignalProviders: ["website_technical"] },
    reasoningSummary: "Independent florists with weak websites."
  } as unknown as IcpTranslationResult;

  it("starts active and self-driving, so the user never presses Run or Research", () => {
    const doc = buildCampaignDocument({
      plan,
      prompt: "florists with weak websites",
      workspaceId: "ws_default",
      businessId: "biz_bloomy"
    });

    expect(doc.status).toBe("active");
    expect(doc.autoQueueHighScoreCompanies).toBe(true);
    expect(doc.workspaceId).toBe("ws_default");
    expect(doc.businessId).toBe("biz_bloomy");
    expect(doc.naturalLanguagePrompt).toBe("florists with weak websites");
  });

  it("carries the AI targeting through without dropping it", () => {
    const doc = buildCampaignDocument({
      plan,
      prompt: "p",
      workspaceId: "ws_default",
      businessId: "biz_bloomy"
    });

    expect(doc.nafCodes).toEqual(["4776Z"]);
    expect(doc.cities).toEqual(["Nantes"]);
    expect(doc.researchStrategy?.enabledSignalProviders).toEqual(["website_technical"]);
  });

  it("applies advanced overrides when the user opens them", () => {
    const doc = buildCampaignDocument({
      plan,
      prompt: "p",
      workspaceId: "ws_default",
      businessId: "biz_bloomy",
      overrides: { name: "My campaign", maxCompaniesPerRun: 40 }
    });

    expect(doc.name).toBe("My campaign");
    expect(doc.maxCompaniesPerRun).toBe(40);
  });

  it("stays generic — the same builder serves a consulting business", () => {
    const consultingPlan = {
      ...plan,
      campaignName: "French SMEs — sales training",
      keywords: ["PME industrielle"],
      researchStrategy: { enabledSignalProviders: ["company_scale", "company_hiring"] }
    } as unknown as IcpTranslationResult;

    const doc = buildCampaignDocument({
      plan: consultingPlan,
      prompt: "SMEs that could need sales training",
      workspaceId: "ws_default",
      businessId: "biz_devcomm"
    });

    expect(doc.status).toBe("active");
    expect(doc.researchStrategy?.enabledSignalProviders).toEqual(["company_scale", "company_hiring"]);
  });
});

// ── Information architecture ──────────────────────────────────

describe("UX — navigation exposes four surfaces, not a pipeline", () => {
  it("keeps the primary navigation to Home, Campaigns, Inbox and Meetings", () => {
    expect(primaryNavItems.map((item) => item.label)).toEqual(["Home", "Campaigns", "Inbox", "Meetings"]);
  });

  it("preserves every operational tool under Advanced rather than deleting it", () => {
    const hrefs = advancedNavItems.map((item) => item.href);
    for (const href of [
      "/app/companies",
      "/app/contacts",
      "/app/research",
      "/app/outreach",
      "/app/discovery",
      "/app/import",
      "/app/logs",
      "/app/analytics"
    ]) {
      expect(hrefs, `${href} must remain reachable`).toContain(href);
    }
  });

  it("still ships the pages Advanced links to", () => {
    for (const item of advancedNavItems) {
      const route = path.join(repoRoot, "src/app/(app)", item.href, "page.tsx");
      expect(fs.existsSync(route), `${item.href} page must exist`).toBe(true);
    }
  });

  it("does not name providers or internal jargon in the primary navigation", () => {
    const labels = primaryNavItems.map((item) => item.label.toLowerCase()).join(" ");
    for (const jargon of ["sirene", "naf", "instantly", "dropcontact", "enrichment", "queue", "outreach"]) {
      expect(labels).not.toContain(jargon);
    }
  });
});

describe("UX — the simplified surfaces read real data", () => {
  const files = [
    "src/features/home/agent-home.tsx",
    "src/features/campaigns/campaign-overview.tsx",
    "src/features/campaigns/campaigns-page.tsx",
    "src/features/meetings/meetings-page.tsx",
    "src/features/inbox/sdr-inbox-page.tsx"
  ];

  it("has no hardcoded placeholder metrics in the new screens", () => {
    for (const file of files) {
      const content = fs.readFileSync(path.join(repoRoot, file), "utf8");
      // Every screen must pull from the aggregation layer or Firestore helpers.
      expect(
        /@\/lib\/sdr\/aggregations|@\/lib\/firebase\/firestore|@\/lib\/firebase\/functions/.test(content),
        `${file} must read real backend data`
      ).toBe(true);
    }
  });

  it("keeps business branching out of the simplified UI (Invariant 1)", () => {
    const forbidden = [/["']Bloomy["']\s*[)=]/, /businessId\s*===\s*["']biz_/, /business\.name\s*===/];
    for (const file of [...files, "src/lib/sdr/aggregations.ts", "src/lib/sdr/activity-humanizer.ts"]) {
      const content = fs.readFileSync(path.join(repoRoot, file), "utf8");
      for (const pattern of forbidden) {
        expect(pattern.test(content), `${file} must stay business-agnostic`).toBe(false);
      }
    }
  });
});

describe("UX — conversations are readable by the client (regression)", () => {
  it("declares a conversations rule so the Inbox is not permission-denied", () => {
    const rules = fs.readFileSync(path.join(repoRoot, "firestore.rules"), "utf8");
    expect(rules).toMatch(/match \/conversations\/\{[A-Za-z]+\} \{/);
    // Reads allowed, writes server-only.
    const block = rules.split("match /conversations/")[1].split("match /suppressionList")[0];
    expect(block).toMatch(/allow read: if signedIn\(\);/);
    expect(block).toMatch(/allow write: if false;/);
  });
});

describe("UX — every backend log type has a deliberate user-facing decision", () => {
  it("either translates or explicitly hides all emitted log types (no silent drops)", () => {
    const functionsDir = path.join(repoRoot, "functions/src");

    // Collect every log type the backend actually emits.
    const emitted = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts")) {
          const content = fs.readFileSync(full, "utf8");
          for (const match of content.matchAll(/type: "([a-zA-Z_.]+)"/g)) emitted.add(match[1]);
        }
      }
    };
    walk(functionsDir);

    // Values that are not log types (AI response formats, fixture archetypes).
    const noise = new Set([
      "bloomy",
      "devcomm",
      "json_object",
      "required",
      "pdf",
      "refresh_token",
      "lead_bounced",
      "reply_received"
    ]);

    const source = fs.readFileSync(path.join(repoRoot, "src/lib/sdr/activity-humanizer.ts"), "utf8");
    const handled = new Set(Array.from(source.matchAll(/case "([^"]+)"/g), (m) => m[1]));

    const unmapped = [...emitted]
      .filter((type) => !noise.has(type))
      .filter((type) => !handled.has(type))
      .filter((type) => !isTechnicalLog(type));

    expect(emitted.size).toBeGreaterThan(50);
    expect(unmapped, `these log types would be silently dropped: ${unmapped.join(", ")}`).toEqual([]);
  });
});


// ── Review regressions (Phase 18 adversarial review) ──────────

describe("UX — review regressions must not come back", () => {
  it("never shows an unsubscribed prospect as needing attention", () => {
    // A prospect can unsubscribe after an attention flag was already set.
    const optedOut = {
      id: "s1",
      companyId: "c",
      status: "suppressed",
      unreadHumanAttention: true,
      humanAttentionRequired: true
    } as unknown as ConversationDoc;

    expect(needsAttention(optedOut)).toBe(false);
    expect(requiresHumanAttention(optedOut)).toBe(false);
    expect(matchesFilter(optedOut, "needs_attention")).toBe(false);
    expect(countByFilter([optedOut]).needs_attention).toBe(0);
  });

  it("stamps every log with a workspace so the activity feed can be scoped", () => {
    const logger = fs.readFileSync(path.join(repoRoot, "functions/src/utils/logger.ts"), "utf8");
    expect(logger).toMatch(/workspaceId/);

    const clientLog = fs.readFileSync(path.join(repoRoot, "src/lib/firebase/firestore.ts"), "utf8");
    const createLog = clientLog.slice(clientLog.indexOf("export async function createLog"));
    expect(createLog.slice(0, 400)).toMatch(/workspaceId/);
  });

  it("declares the composite indexes the new scoped queries need", () => {
    const indexes = JSON.parse(fs.readFileSync(path.join(repoRoot, "firestore.indexes.json"), "utf8")) as {
      indexes: Array<{ collectionGroup: string; fields: Array<{ fieldPath: string }> }>;
    };

    const has = (collection: string, fields: string[]) =>
      indexes.indexes.some(
        (index) =>
          index.collectionGroup === collection &&
          fields.every((field) => index.fields.some((f) => f.fieldPath === field))
      );

    expect(has("logs", ["workspaceId", "createdAt"]), "logs(workspaceId, createdAt)").toBe(true);
    expect(
      has("discoveryCampaigns", ["workspaceId", "updatedAt"]),
      "discoveryCampaigns(workspaceId, updatedAt)"
    ).toBe(true);
  });

  it("never falls back to an unscoped read of the whole logs collection", () => {
    const source = fs.readFileSync(path.join(repoRoot, "src/lib/sdr/aggregations.ts"), "utf8");
    const activity = source.slice(source.indexOf("export async function getAgentActivity"));
    const body = activity.slice(0, activity.indexOf("\n}"));

    // Any fallback must still be ordered and ownership-filtered.
    expect(body).toMatch(/belongsToScope/);
    expect(body).not.toMatch(/fetchAll<Log>\(query\(collection\(db, collections\.logs\), fbLimit/);
  });

  it("keeps the safe-mode banner off screen unless sending is actually locked", () => {
    const banner = fs.readFileSync(path.join(repoRoot, "src/components/layout/test-mode-banner.tsx"), "utf8");
    expect(banner).toMatch(/if \(!testModeEnabled\) return null;/);
    // No disable control on a primary surface, and no untranslated strings.
    expect(banner).not.toMatch(/Désactivé|Confinement|Allowlist|Démo/);
  });

  it("bounds the navigation attention badge query", () => {
    const source = fs.readFileSync(path.join(repoRoot, "src/lib/firebase/firestore.ts"), "utf8");
    const fn = source.slice(source.indexOf("export async function getUnreadHumanAttentionCount"));
    expect(fn.slice(0, 1200)).toMatch(/limit\(/);
  });

  it("surfaces a failed first run instead of silently landing on an idle campaign", () => {
    const home = fs.readFileSync(path.join(repoRoot, "src/features/home/agent-home.tsx"), "utf8");
    expect(home).toMatch(/result\.started/);
    expect(home).toMatch(/startError/);
  });

  it("keeps past meetings reachable", () => {
    const source = fs.readFileSync(path.join(repoRoot, "src/lib/sdr/aggregations.ts"), "utf8");
    expect(source).toMatch(/export async function getPastMeetings/);

    const page = fs.readFileSync(path.join(repoRoot, "src/features/meetings/meetings-page.tsx"), "utf8");
    expect(page).toMatch(/getPastMeetings/);
  });
});


// ── Second-pass review items ──────────────────────────────────

describe("UX — second-pass review items", () => {
  it("does not count a disqualified company as a good opportunity", () => {
    const companies = [
      // Enriched (has an email) but the engine ruled it out.
      { id: "d1", status: "enriched", extractedEmailCount: 3, opportunityScore: { qualificationState: "DISQUALIFIED" } },
      { id: "d2", status: "researched", extractedEmailCount: 1, opportunityScore: { qualificationState: "QUALIFIED" } }
    ] as unknown as Company[];

    const funnel = computeFunnel({ companies, outreach: [], conversations: [], meetings: [] });

    expect(funnel.found).toBe(2);
    expect(funnel.qualified).toBe(1);
    expect(funnel.peopleFound).toBe(1);
  });

  it("still counts a disqualified company that was actually contacted", () => {
    const companies = [
      { id: "d1", status: "contacted", extractedEmailCount: 1, opportunityScore: { qualificationState: "DISQUALIFIED" } }
    ] as unknown as Company[];

    const funnel = computeFunnel({ companies, outreach: [], conversations: [], meetings: [] });

    // Earlier stages must still account for anything that reached contact.
    expect(funnel.contacted).toBe(1);
    expect(funnel.peopleFound).toBe(1);
    expect(funnel.qualified).toBe(1);
  });

  it("scopes the activity company set by business, not just workspace", () => {
    const source = fs.readFileSync(path.join(repoRoot, "src/lib/sdr/aggregations.ts"), "utf8");
    const activity = source.slice(source.indexOf("export async function getAgentActivity"));
    const body = activity.slice(0, activity.indexOf("\n}"));

    expect(body).toMatch(/scopedCompanies/);
    expect(body).toMatch(/matchesBusiness\(company, scope\.businessId\)/);
  });

  it("keeps campaign-level events attributable so a new campaign is not silent", () => {
    const event = humanizeActivity({
      id: "run1",
      type: "discovery.functions.run",
      metadata: { campaignId: "camp_1", runId: "r1" }
    });

    expect(event?.title).toBe("Searched for new companies");
    expect(event?.campaignId).toBe("camp_1");
    expect(event?.companyId).toBeUndefined();
  });

  it("shares one in-flight attention request across both navigations", () => {
    const source = fs.readFileSync(path.join(repoRoot, "src/lib/sdr/use-attention-count.ts"), "utf8");
    expect(source).toMatch(/inFlight/);
    expect(source).toMatch(/if \(state\.inFlight\) return state\.inFlight;/);
  });
});


// ── Business lifecycle ────────────────────────────────────────

describe("UX — businesses can be created and removed safely", () => {
  it("deletes scoped subcollections before the business document", () => {
    const source = fs.readFileSync(path.join(repoRoot, "src/lib/firebase/firestore.ts"), "utf8");
    const fn = source.slice(source.indexOf("export async function deleteBusinessClient"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));

    // Firestore does not cascade; orphans would be inherited by a future
    // business reusing the id.
    for (const sub of ["offers", "knowledgeBase", "senderIdentities"]) {
      expect(body, `${sub} must be cleaned up`).toContain(sub);
    }
    expect(body.indexOf("offers")).toBeLessThan(body.lastIndexOf("deleteDoc"));
  });

  it("confirms before removing a business and never strands the selection", () => {
    const switcher = fs.readFileSync(path.join(repoRoot, "src/components/layout/business-switcher.tsx"), "utf8");
    expect(switcher).toMatch(/Remove business/);
    expect(switcher).toMatch(/cannot be undone/i);

    const context = fs.readFileSync(path.join(repoRoot, "src/lib/context/business-context.tsx"), "utf8");
    const fn = context.slice(context.indexOf("const deleteBusiness = useCallback"));
    // Deleting the active business must move the app to a remaining one.
    expect(fn.slice(0, 900)).toMatch(/currentBusinessId === businessId/);
  });

  it("persists a new business in a single write rather than create-then-patch", () => {
    const wizard = fs.readFileSync(
      path.join(repoRoot, "src/features/onboarding/create-business-wizard.tsx"),
      "utf8"
    );
    // create-then-patch read a stale currentBusinessId and patched the
    // previously selected business.
    expect(wizard).not.toMatch(/updateCurrentBusiness/);
    expect(wizard).toMatch(/calendarConfig:/);
  });

  it("never reports a saved business that was silently rejected", () => {
    const source = fs.readFileSync(path.join(repoRoot, "src/lib/firebase/firestore.ts"), "utf8");
    for (const fnName of ["saveBusinessClient", "saveOfferClient"]) {
      const fn = source.slice(source.indexOf(`export async function ${fnName}`));
      const body = fn.slice(0, fn.indexOf("\n}\n"));
      expect(body, `${fnName} must not swallow write errors`).not.toMatch(/setDoc\([^)]*\)[\s\S]{0,40}\.catch\(\(\) => \{\}\)/);
    }
  });

  it("ships rules for every workspace-scoped path the app writes", () => {
    const rules = fs.readFileSync(path.join(repoRoot, "firestore.rules"), "utf8");
    for (const block of [
      "match /workspaces/{workspaceId}",
      "match /businesses/{businessId}",
      "match /offers/{offerId}",
      "match /knowledgeBase/{kbId}",
      "match /senderIdentities/{senderId}"
    ]) {
      expect(rules, `${block} must exist or the client is permission-denied`).toContain(block);
    }
  });
});
