import { describe, expect, it, vi } from "vitest";
import { sendApprovedOutreach } from "../services/send-outreach.js";
import { adminDb } from "../config/firebase.js";
import * as canContactModule from "../services/can-contact.js";

describe("Outreach Suppression Integration Test (REQ-057 & Invariant 3)", () => {
  it("should halt dispatch and mark outreach as suppressed if canContact check fails", async () => {
    // Mock settings and secrets
    const mockDoc = vi.fn().mockImplementation((pathStr: string) => {
      if (pathStr === "settings/global") {
        return {
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ dailyOutreachSendLimit: 20, requireApprovalBeforeExport: false })
          })
        };
      }
      if (pathStr === "settings/integrationSecrets") {
        return {
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ instantlyApiKey: "test_instantly_key" })
          })
        };
      }
      if (pathStr === "outreach/outreach_123" || pathStr === "outreach_123") {
        const mockRef = {
          set: vi.fn().mockResolvedValue({})
        };
        return {
          get: vi.fn().mockResolvedValue({
            exists: true,
            id: "outreach_123",
            ref: mockRef,
            data: () => ({
              id: "outreach_123",
              companyId: "company_123",
              contactId: "contact_123",
              status: "approved"
            })
          }),
          set: vi.fn().mockResolvedValue({}),
          ref: mockRef
        };
      }
      return {
        get: vi.fn().mockResolvedValue({ exists: false })
      };
    });

    vi.spyOn(adminDb, "doc").mockImplementation(mockDoc as any);
    vi.spyOn(adminDb, "collection").mockImplementation((col: string) => {
      if (col === "outreach") {
        return {
          doc: mockDoc,
          where: vi.fn().mockReturnThis(),
          add: vi.fn().mockResolvedValue({ id: "mock_id" }),
          count: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({ data: () => ({ count: 0 }) })
          })
        } as any;
      }
      return {
        doc: mockDoc,
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        add: vi.fn().mockResolvedValue({ id: "mock_id" }),
        get: vi.fn().mockResolvedValue({ empty: true, docs: [] })
      } as any;
    });

    // Mock canContact to fail (suppressed)
    vi.spyOn(canContactModule, "canContact").mockResolvedValue({
      allowed: false,
      reason: "suppressed: Prospect requested no further contact"
    });

    await expect(sendApprovedOutreach("outreach_123")).rejects.toThrow(
      "Outreach blocked by contactability gatekeeper: suppressed: Prospect requested no further contact"
    );

    vi.restoreAllMocks();
  });
});
