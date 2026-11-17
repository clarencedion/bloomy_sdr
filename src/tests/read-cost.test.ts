import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cachedRead, invalidateReadCache, readCacheSize } from "@/lib/sdr/query-cache";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

/**
 * Firestore bills per document returned, so the cost of these screens tracks
 * how much the user browses, not how much work the SDR does. Measured on a live
 * workspace of 123 companies: daily reads went from 101 to 73,922 — past the
 * 50,000/day free allowance — while the prospect count barely moved, because
 * four aggregations each re-read the same collections on every navigation.
 *
 * These tests pin the two mechanisms that fixed it.
 */
describe("Read de-duplication", () => {
  beforeEach(() => invalidateReadCache());

  it("collapses concurrent readers of the same data into one fetch", async () => {
    const load = vi.fn().mockResolvedValue(["a", "b"]);

    const [first, second, third] = await Promise.all([
      cachedRead("companies", load),
      cachedRead("companies", load),
      cachedRead("companies", load)
    ]);

    // This is the single-page-load case: funnel, activity and attention all
    // want the company list at once.
    expect(load).toHaveBeenCalledTimes(1);
    expect(first).toEqual(["a", "b"]);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("serves a repeat within the window from memory", async () => {
    const load = vi.fn().mockResolvedValue([1]);

    await cachedRead("companies", load);
    await cachedRead("companies", load);

    // This is the navigation case: Home → Campaigns → Home.
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps different data separate", async () => {
    const companies = vi.fn().mockResolvedValue(["c"]);
    const outreach = vi.fn().mockResolvedValue(["o"]);

    await cachedRead("companies", companies);
    await cachedRead("outreach", outreach);

    expect(companies).toHaveBeenCalledTimes(1);
    expect(outreach).toHaveBeenCalledTimes(1);
  });

  it("never remembers a failure as a result", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("offline"));

    await expect(cachedRead("companies", failing)).rejects.toThrow("offline");
    expect(readCacheSize()).toBe(0);

    const succeeding = vi.fn().mockResolvedValue(["recovered"]);
    await expect(cachedRead("companies", succeeding)).resolves.toEqual(["recovered"]);
    expect(succeeding).toHaveBeenCalledTimes(1);
  });

  it("drops everything when asked, so a write is never hidden by the cache", async () => {
    const load = vi.fn().mockResolvedValue([1]);

    await cachedRead("companies", load);
    invalidateReadCache();
    await cachedRead("companies", load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("evicts by prefix without clearing unrelated data", async () => {
    const a = vi.fn().mockResolvedValue([1]);
    const b = vi.fn().mockResolvedValue([2]);

    await cachedRead("scoped:companies:ws", a);
    await cachedRead("draftCount:ws", b);

    invalidateReadCache("scoped:companies");

    await cachedRead("scoped:companies:ws", a);
    await cachedRead("draftCount:ws", b);

    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe("Queries stay narrow", () => {
  it("counts drafts with an aggregation, not by reading every outreach document", () => {
    const source = read("src/lib/sdr/approvals.ts");
    const countFn = source.slice(source.indexOf("export async function getPendingApprovalCount"));

    // This badge runs on every screen. Reading the collection billed one read
    // per email ever sent, just to display a number.
    expect(countFn).toContain("getCountFromServer");
    expect(countFn).toContain('where("status", "==", "draft")');
  });

  it("reads only drafts when listing what needs approval", () => {
    const source = read("src/lib/sdr/approvals.ts");
    expect(source).toContain('fetchCached<Outreach>(collections.outreach, scope.workspaceId, ["status", "draft"])');
  });

  it("declares the composite index the draft count requires", () => {
    const indexes = JSON.parse(read("firestore.indexes.json")) as {
      indexes: Array<{ collectionGroup: string; fields: Array<{ fieldPath: string }> }>;
    };

    const outreachIndex = indexes.indexes.find(
      (index) =>
        index.collectionGroup === "outreach" &&
        index.fields.map((field) => field.fieldPath).join(",") === "workspaceId,status"
    );

    expect(outreachIndex).toBeDefined();
  });

  it("routes every repeated whole-collection read through the shared cache", () => {
    const source = read("src/lib/sdr/aggregations.ts");

    // A direct scopedQuery on these collections is a read that cannot be
    // shared with the other aggregations on the same screen.
    expect(source).not.toContain("fetchAll<Company>(scopedQuery(");
    expect(source).not.toContain("fetchAll<Outreach>(scopedQuery(");
    expect(source).not.toContain("fetchAll<ConversationDoc>(scopedQuery(");
    expect(source).not.toContain('scopedQuery("meetings", scope)');
  });
});

describe("Autonomy is never inferred from missing data", () => {
  it("does not substitute default businesses when the workspace cannot be read", () => {
    const source = read("src/lib/context/business-context.tsx");
    const catchBlock = source.slice(source.indexOf("} catch (err) {", source.indexOf("reloadBusinesses")));

    // Those defaults carry their own automationPolicy, so rendering them made
    // the app state an autonomy level the owner had never saved.
    expect(catchBlock.slice(0, 600)).not.toContain("DEFAULT_DEVCOMM");
    expect(catchBlock.slice(0, 600)).toContain("setLoadError");
  });

  it("distinguishes an unreadable workspace from an empty one", () => {
    const source = read("src/lib/firebase/firestore.ts");
    const fn = source.slice(
      source.indexOf("export async function listBusinessesClient"),
      source.indexOf("export async function getBusinessClient")
    );

    // Returning [] on failure made the caller seed defaults over real data.
    expect(fn).not.toContain("catch");
  });

  it("shows the approvals queue whatever the autonomy setting", () => {
    const sidebar = read("src/components/layout/app-sidebar.tsx");
    const mobile = read("src/components/layout/mobile-nav.tsx");
    const page = read("src/features/approvals/approvals-page.tsx");

    // DM and contact-form drafts can only ever be sent by a person, so gating
    // this surface on autonomy hid messages that were written and never seen.
    expect(sidebar).not.toContain("approvalsEnabled");
    expect(mobile).not.toContain("approvalsEnabled");
    expect(page).not.toContain("Your SDR sends on its own");
  });
});
