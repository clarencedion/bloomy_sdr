import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { canContact, canContactDetails } from "../../services/can-contact.js";
import * as settingsModule from "../../utils/settings.js";
import { adminDb } from "../../config/firebase.js";

describe("Adversarial Security Audit: Test Mode Email Allowlist Containment (Invariant 2 & Safety)", () => {
  beforeEach(async () => {
    // Seed test contact in adminDb
    await adminDb.collection("contacts").doc("cont_test_victim").set({
      id: "cont_test_victim",
      companyId: "comp_test_victim",
      email: "real.prospect@unauthorized-target.fr",
      normalizedEmail: "real.prospect@unauthorized-target.fr",
      status: "new",
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await adminDb.collection("contacts").doc("cont_test_authorized").set({
      id: "cont_test_authorized",
      companyId: "comp_test_authorized",
      email: "clarence@devcomm.fr",
      normalizedEmail: "clarence@devcomm.fr",
      status: "new",
      createdAt: new Date(),
      updatedAt: new Date()
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should STRICTLY BLOCK any email not in testEmailAllowlist when testModeEnabled is true", async () => {
    vi.spyOn(settingsModule, "getGlobalSettings").mockResolvedValue({
      ...settingsModule.defaultSettings,
      testModeEnabled: true,
      testEmailAllowlist: ["clarence@devcomm.fr", "tester@bloomy.fr"]
    });

    const checkUnauthorized = await canContact("cont_test_victim", "biz_bloomy");
    expect(checkUnauthorized.allowed).toBe(false);

    const details = await canContactDetails({ contactId: "cont_test_victim", email: "real.prospect@unauthorized-target.fr", businessId: "biz_bloomy" });
    expect(details.allowed).toBe(false);
    expect(details.reason).toContain("test_mode_allowlist_blocked");
  });

  it("should ALLOW contacts whose email is present in testEmailAllowlist", async () => {
    vi.spyOn(settingsModule, "getGlobalSettings").mockResolvedValue({
      ...settingsModule.defaultSettings,
      testModeEnabled: true,
      testEmailAllowlist: ["clarence@devcomm.fr", "tester@bloomy.fr"]
    });

    const checkAuthorized = await canContact("cont_test_authorized", "biz_bloomy");
    expect(checkAuthorized.allowed).toBe(true);

    const details = await canContactDetails({ contactId: "cont_test_authorized", email: "clarence@devcomm.fr", businessId: "biz_bloomy" });
    expect(details.allowed).toBe(true);
  });

  it("should support wildcard domain allowlisting (e.g. @devcomm.fr)", async () => {
    vi.spyOn(settingsModule, "getGlobalSettings").mockResolvedValue({
      ...settingsModule.defaultSettings,
      testModeEnabled: true,
      testEmailAllowlist: ["@devcomm.fr"]
    });

    const checkAuthorized = await canContact("cont_test_authorized", "biz_devcomm");
    expect(checkAuthorized.allowed).toBe(true);

    const checkUnauthorized = await canContact("cont_test_victim", "biz_devcomm");
    expect(checkUnauthorized.allowed).toBe(false);
  });

  it("should permit standard contactability evaluation when testModeEnabled is false", async () => {
    vi.spyOn(settingsModule, "getGlobalSettings").mockResolvedValue({
      ...settingsModule.defaultSettings,
      testModeEnabled: false,
      testEmailAllowlist: []
    });

    const check = await canContact("cont_test_victim", "biz_bloomy");
    expect(check.allowed).toBe(true);
  });
});
