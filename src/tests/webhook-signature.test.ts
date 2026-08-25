import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { verifyHmacSignature, verifyMicrosoftGraphWebhook } from "@/lib/security/webhook";

describe("Frontend / Next.js Webhook Security (REQ-060)", () => {
  const secret = "super_secret_webhook_signing_key_456";
  const payload = JSON.stringify({
    source: "instantly",
    timestamp: 1724600000,
    event: "reply_received"
  });

  it("should successfully verify valid HMAC payload signature", () => {
    const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    expect(verifyHmacSignature(payload, signature, secret)).toBe(true);
  });

  it("should reject tampered or modified payload", () => {
    const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    const tampered = payload.replace("reply_received", "email_bounced");
    expect(verifyHmacSignature(tampered, signature, secret)).toBe(false);
  });

  it("should reject forged signature", () => {
    expect(verifyHmacSignature(payload, "invalid_forged_hex_signature_abcdef123456", secret)).toBe(false);
  });

  it("should handle Microsoft Graph validationToken handshake correctly", () => {
    const result = verifyMicrosoftGraphWebhook("subscription_test_token_789");
    expect(result.isValid).toBe(true);
    expect(result.responseToken).toBe("subscription_test_token_789");
  });
});
