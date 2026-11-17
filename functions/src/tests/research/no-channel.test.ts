import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Offline: Firestore is the in-memory fake; the three channel writers are
// stubbed (each has its own suite). The code under test — which channel is
// tried, in what order, and what is recorded when none exists — is real.
vi.mock("../../config/firebase.js", async () => {
  const { fakeDb } = await import("../social/fixtures/outbound-fake-firestore.js");
  return { adminDb: fakeDb };
});
vi.mock("../../services/cost-guardrail-service.js", () => ({
  checkBudgetGuardrail: async () => ({ allowed: true }),
  getCostSummary: async () => ({}),
  recordApiSpend: async () => 0,
  UNATTRIBUTED_SPEND_BUCKET: "unattributed"
}));

const world = vi.hoisted(() => ({
  calls: [] as string[],
  /** The profile the resolver trusts; the search may set it. */
  profileUrl: undefined as string | undefined,
  searchFinds: undefined as string | undefined,
  dmThrows: false,
  formPrepared: false
}));
vi.mock("../../services/social/profile-search.js", () => ({
  findInstagramBySearch: async (companyId: string) => {
    world.calls.push(`search:${companyId}`);
    if (world.searchFinds) world.profileUrl = world.searchFinds;
    return undefined;
  }
}));
vi.mock("../../services/social-dm-generation.js", () => ({
  findSocialProfileUrl: async (companyId: string) => {
    world.calls.push(`profile:${companyId}`);
    return world.profileUrl;
  },
  generateSocialDm: async (input: { companyId: string; campaignId?: string }) => {
    world.calls.push(`dm:${input.companyId}:${input.campaignId ?? "-"}`);
    if (world.dmThrows) throw new Error("model unavailable");
    return { outreachId: "out_1" };
  }
}));
vi.mock("../../services/contact-form-generation.js", () => ({
  prepareContactFormOutreach: async (input: { companyId: string }) => {
    world.calls.push(`form:${input.companyId}`);
    return world.formPrepared ? { outreachId: "out_form" } : null;
  }
}));

import { fakeDb } from "../social/fixtures/outbound-fake-firestore.js";
import { draftWithoutEmail } from "../../services/task-queue-service.js";

const WS = "ws_test";
const BIZ = "biz_test";

function seed(channels: string[] | undefined) {
  fakeDb.seed("discoveryCampaigns/camp_1", { workspaceId: WS, businessId: BIZ, ...(channels ? { channels } : {}) });
  fakeDb.seed("companies/co_1", { workspaceId: WS, businessId: BIZ, name: "Atelier Encre", city: "Lille", discoveryCampaignId: "camp_1", status: "qualified" });
}
const noChannelLogs = () => fakeDb.list("logs").filter((log) => log.type === "outreach.no_channel");

beforeEach(() => {
  fakeDb.reset();
  Object.assign(world, { calls: [], profileUrl: undefined, searchFinds: undefined, dmThrows: false, formPrepared: false });
});

describe("a draft for a prospect with no email (ADR-023)", () => {
  it("writes a DM when the campaign allows DMs and a trusted profile exists", async () => {
    seed(["email", "social_dm"]);
    world.profileUrl = "https://www.instagram.com/atelierencre/";

    expect(await draftWithoutEmail("co_1")).toBe("social_dm");
    expect(world.calls).toEqual(["search:co_1", "profile:co_1", "dm:co_1:camp_1"]);
    expect(fakeDb.read("companies/co_1")?.noChannelAt).toBeUndefined();
    expect(noChannelLogs()).toHaveLength(0);
  });

  it("searches for the Instagram account BEFORE deciding there is no profile", async () => {
    seed(["email", "social_dm"]);
    world.searchFinds = "https://www.instagram.com/atelierencre/";

    expect(await draftWithoutEmail("co_1")).toBe("social_dm");
    expect(world.calls.indexOf("search:co_1")).toBeLessThan(world.calls.indexOf("profile:co_1"));
  });

  it("falls back to the contact form when the DM cannot be written", async () => {
    seed(["email", "social_dm", "contact_form"]);
    world.profileUrl = "https://www.instagram.com/atelierencre/";
    world.dmThrows = true;
    world.formPrepared = true;

    expect(await draftWithoutEmail("co_1")).toBe("contact_form");
    expect(noChannelLogs()).toHaveLength(0);
  });

  it("with nobody to write to: no error, one information log, and the company is stamped", async () => {
    seed(["email", "social_dm", "contact_form"]);

    await expect(draftWithoutEmail("co_1")).resolves.toBe("none");
    const company = fakeDb.read("companies/co_1");
    expect(company?.noChannelAt).toBeDefined();
    expect(company?.status).toBe("qualified");

    const logs = noChannelLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ level: "info", workspaceId: WS, businessId: BIZ });
    expect(String(logs[0].message)).toContain("Atelier Encre");
    expect(fakeDb.list("outreach")).toHaveLength(0);
  });

  it("never uses a channel the campaign did not enable (email-only campaign: no search, no DM, no form)", async () => {
    seed(undefined);
    world.profileUrl = "https://www.instagram.com/atelierencre/";
    world.formPrepared = true;

    expect(await draftWithoutEmail("co_1")).toBe("none");
    expect(world.calls).toEqual([]);
    expect(noChannelLogs()).toHaveLength(1);
  });
});

describe("the draft task and the hourly runner use it", () => {
  const root = fs.existsSync(path.resolve(process.cwd(), "src/services")) ? process.cwd() : path.resolve(process.cwd(), "functions");
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

  it("TASK_GENERATE_OUTREACH goes through it before the email generator when the company has no email", () => {
    const queue = read("src/services/task-queue-service.ts");
    const task = queue.slice(queue.indexOf('case "TASK_GENERATE_OUTREACH": {'));
    const guard = task.indexOf("const channel = await draftWithoutEmail(companyId);");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(task.indexOf("await generateOutreach({"));
    expect(task.slice(0, guard)).toContain("if (!hasEmail) {");
  });

  it("the hourly runner leaves a no-channel company alone for a week", () => {
    const runner = read("src/jobs/daily-research-runner.ts");
    expect(runner).toContain("const NO_CHANNEL_RETRY_MS = 7 * 24 * 60 * 60 * 1000;");
    const skip = runner.indexOf("if (now - toMillis(companyData.noChannelAt) < NO_CHANNEL_RETRY_MS) continue;");
    expect(skip).toBeGreaterThan(-1);
    expect(skip).toBeLessThan(runner.indexOf('await enqueueTask("TASK_GENERATE_OUTREACH"'));
  });
});
