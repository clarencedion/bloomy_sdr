import { describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { processInstantlyWebhook } from "../../services/webhook-processor.js";
import { adminDb } from "../../config/firebase.js";

describe("Webhook Cryptographic Verification (REQ-060)", () => {
  const secret = "instantly_webhook_secret_key_abcdef987654";
  const payloadObj = {
    event_type: "reply_received",
    lead_email: "ceo@company.fr",
    reply_subject: "Re: Contact",
    reply_text: "Merci pour votre message.",
    email_id: "sec_test_evt_1"
  };
  const rawBody = JSON.stringify(payloadObj);

  it("should accept valid HMAC-SHA256 signature header", async () => {
    vi.spyOn(adminDb, "doc").mockReturnValue({
      get: vi.fn().mockResolvedValue({ exists: false }),
      set: vi.fn().mockResolvedValue({})
    } as any);
    vi.spyOn(adminDb, "collection").mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ empty: true, docs: [] })
        }),
        get: vi.fn().mockResolvedValue({ empty: true, docs: [] })
      }),
      doc: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({ exists: false }),
        set: vi.fn().mockResolvedValue({}),
        collection: vi.fn().mockReturnValue({
          doc: vi.fn().mockReturnValue({ set: vi.fn().mockResolvedValue({}) })
        })
      }),
      add: vi.fn().mockResolvedValue({ id: "log_id" })
    } as any);

    const signature = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

    const result = await processInstantlyWebhook(
      rawBody,
      { "x-instantly-signature": signature },
      secret
    );

    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);

    vi.restoreAllMocks();
  });

  it("should accept valid Bearer Authorization header", async () => {
    vi.spyOn(adminDb, "doc").mockReturnValue({
      get: vi.fn().mockResolvedValue({ exists: false }),
      set: vi.fn().mockResolvedValue({})
    } as any);
    vi.spyOn(adminDb, "collection").mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ empty: true, docs: [] })
        }),
        get: vi.fn().mockResolvedValue({ empty: true, docs: [] })
      }),
      doc: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({ exists: false }),
        set: vi.fn().mockResolvedValue({}),
        collection: vi.fn().mockReturnValue({
          doc: vi.fn().mockReturnValue({ set: vi.fn().mockResolvedValue({}) })
        })
      }),
      add: vi.fn().mockResolvedValue({ id: "log_id" })
    } as any);

    const result = await processInstantlyWebhook(
      rawBody,
      { authorization: `Bearer ${secret}` },
      secret
    );

    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);

    vi.restoreAllMocks();
  });

  it("should reject invalid/forged signature with HTTP 401", async () => {
    vi.spyOn(adminDb, "collection").mockReturnValue({
      add: vi.fn().mockResolvedValue({ id: "log_id" })
    } as any);

    const forgedSignature = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

    const result = await processInstantlyWebhook(
      rawBody,
      { "x-instantly-signature": forgedSignature },
      secret
    );

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(401);
    expect(result.error).toContain("Unauthorized");

    vi.restoreAllMocks();
  });

  it("should reject missing auth headers when secret is configured", async () => {
    vi.spyOn(adminDb, "collection").mockReturnValue({
      add: vi.fn().mockResolvedValue({ id: "log_id" })
    } as any);

    const result = await processInstantlyWebhook(
      rawBody,
      {},
      secret
    );

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(401);

    vi.restoreAllMocks();
  });
});
