import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Offline: Firestore is the in-memory fake. The code under test — what a
// contact created by enrichment carries — is real.
vi.mock("../../config/firebase.js", async () => {
  const { fakeDb } = await import("../social/fixtures/outbound-fake-firestore.js");
  return { adminDb: fakeDb };
});

import { fakeDb } from "../social/fixtures/outbound-fake-firestore.js";
import { createContactsFromSocialEvidence, tenantOf } from "../../services/company-enrichment.js";

beforeEach(() => fakeDb.reset());

describe("a contact found for a prospect belongs to the prospect's workspace and business (Invariant 8)", () => {
  it("tenantOf: the company's own stamps; no business is invented", () => {
    expect(tenantOf({ workspaceId: "ws_a", businessId: "biz_a" })).toEqual({ workspaceId: "ws_a", businessId: "biz_a" });
    expect(tenantOf({ workspaceId: "ws_a" })).toEqual({ workspaceId: "ws_a" });
    expect(tenantOf({})).toEqual({ workspaceId: "ws_default" });
  });

  it("an address published on the prospect's social page is stored with both stamps", async () => {
    fakeDb.seed("companies/co_1", { workspaceId: "ws_a", businessId: "biz_a", name: "Atelier Encre" });
    fakeDb.seed("companies/co_1/evidence/e1", { signalProvider: "social_profile", key: "social_email", value: ["Contact@Atelier-Encre.fr"] });
    fakeDb.seed("companies/co_1/evidence/e2", { signalProvider: "social_profile", key: "instagram_url", value: "https://www.instagram.com/atelierencre/" });

    // The counter update uses a Firestore transform the fake does not model; the contact is written before it.
    await createContactsFromSocialEvidence("co_1").catch(() => undefined);

    const contacts = fakeDb.list("contacts");
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({ companyId: "co_1", workspaceId: "ws_a", businessId: "biz_a", email: "contact@atelier-encre.fr" });
  });

  it("a second business's prospect never receives the first one's stamps", async () => {
    fakeDb.seed("companies/co_2", { workspaceId: "ws_a", businessId: "biz_b", name: "Barbier B" });
    fakeDb.seed("companies/co_2/evidence/e1", { signalProvider: "social_profile", key: "social_email", value: ["hello@barbier-b.fr"] });
    await createContactsFromSocialEvidence("co_2").catch(() => undefined);
    expect(fakeDb.list("contacts")[0]).toMatchObject({ companyId: "co_2", businessId: "biz_b" });
  });

  it("website enrichment passes the company's tenant too, and no contact is written without it", () => {
    const root = fs.existsSync(path.resolve(process.cwd(), "src/services")) ? process.cwd() : path.resolve(process.cwd(), "functions");
    const source = fs.readFileSync(path.join(root, "src/services/company-enrichment.ts"), "utf8");
    expect(source).toContain("await upsertContact(companyId, tenantOf(company), email, url, phones);");
    expect(source.split("upsertContact(").length - 1).toBe(3); // the definition and its two callers
    expect(source).toMatch(/collection\("contacts"\)\.add\(\{\s*companyId,\s*\.\.\.tenant,/);
  });
});
