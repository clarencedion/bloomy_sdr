import { describe, expect, it, vi } from "vitest";
import { canContactDetails, isSuppressed } from "../services/can-contact.js";
import { adminDb } from "../config/firebase.js";

describe("Canonical canContact Gatekeeper (REQ-057 & Invariant 3)", () => {
  it("should reject missing or invalid email formats", async () => {
    const res1 = await canContactDetails({ email: "" });
    expect(res1.allowed).toBe(false);
    expect(res1.reason).toBe("invalid_or_missing_email");

    const res2 = await canContactDetails({ email: "invalid-email" });
    expect(res2.allowed).toBe(false);
    expect(res2.reason).toBe("invalid_or_missing_email");
  });

  it("should reject contact explicitly flagged with doNotContact: true", async () => {
    const res = await canContactDetails({
      email: "jean.dupont@entreprise.fr",
      doNotContact: true
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe("contact_marked_do_not_contact");
  });

  it("should reject contact marked as unsubscribed: true", async () => {
    const res = await canContactDetails({
      email: "claire.martin@entreprise.fr",
      unsubscribed: true
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe("contact_unsubscribed");
  });

  it("should reject contact marked as bounced: true", async () => {
    const res = await canContactDetails({
      email: "failed.delivery@entreprise.fr",
      bounced: true
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe("contact_bounced");
  });

  it("should reject blacklisted government and public administration domains", async () => {
    const testCases = [
      "maire@nantes.gouv.fr",
      "contact@prefecture.interieur.gouv.fr",
      "direction@service-public.fr",
      "support@justice.fr"
    ];

    for (const email of testCases) {
      const res = await canContactDetails({ email });
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("domain_blacklisted");
    }
  });

  it("should reject blacklisted disposable and test email domains", async () => {
    const testCases = [
      "test@mailinator.com",
      "user@tempmail.com",
      "tester@example.com"
    ];

    for (const email of testCases) {
      const res = await canContactDetails({ email });
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("domain_blacklisted");
    }
  });

  it("should reject contacts present in suppression list", async () => {
    vi.spyOn(adminDb, "collection").mockImplementation((collectionName: string) => {
      if (collectionName === "suppressionList") {
        return {
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValue({
            empty: false,
            docs: [
              {
                data: () => ({
                  targetType: "email",
                  targetValue: "suppressed.user@entreprise.fr",
                  reason: "Direct prospect opt-out request"
                })
              }
            ]
          })
        } as any;
      }
      return {
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue({ empty: true, docs: [] })
      } as any;
    });

    const res = await canContactDetails({ email: "suppressed.user@entreprise.fr" });
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain("suppressed: Direct prospect opt-out request");

    vi.restoreAllMocks();
  });

  it("should allow clean, eligible contacts", async () => {
    vi.spyOn(adminDb, "collection").mockImplementation(() => {
      return {
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue({ empty: true, docs: [] })
      } as any;
    });

    const res = await canContactDetails({
      email: "contact@bloomy-digital.fr",
      domain: "bloomy-digital.fr",
      siren: "908765432"
    });

    expect(res.allowed).toBe(true);
    expect(res.details?.email).toBe("contact@bloomy-digital.fr");
    expect(res.details?.domain).toBe("bloomy-digital.fr");

    vi.restoreAllMocks();
  });

  it("should evaluate isSuppressed for individual identifiers", async () => {
    vi.spyOn(adminDb, "collection").mockImplementation(() => {
      return {
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue({ empty: true, docs: [] })
      } as any;
    });

    const check = await isSuppressed({ email: "hello@world.com" });
    expect(check.suppressed).toBe(false);

    vi.restoreAllMocks();
  });
});

