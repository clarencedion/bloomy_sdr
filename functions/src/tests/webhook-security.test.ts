import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { verifyHmacSignature, verifyMicrosoftGraphWebhook } from "../services/webhook-verifier.js";
import { checkAndRecordWebhookEvent } from "../services/webhook-idempotency.js";

describe("Webhook Security & Verification (REQ-060, REQ-061 & Invariant 7)", () => {
  const secret = "test_webhook_secret_key_123456789";
  const payload = JSON.stringify({
    event_type: "reply_received",
    lead_email: "contact@prospect.fr",
    body: "Bonjour, je suis intéressé par votre diagnostic."
  });

  it("should pass valid HMAC-SHA256 signature", () => {
    const validSignature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    const result = verifyHmacSignature(payload, validSignature, secret);
    expect(result).toBe(true);
  });

  it("should pass valid HMAC signature with sha256= prefix", () => {
    const validSignature = "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
    const result = verifyHmacSignature(payload, validSignature, secret, { headerPrefix: "sha256=" });
    expect(result).toBe(true);
  });

  it("should reject forged or tampered payloads", () => {
    const validSignature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    const tamperedPayload = payload.replace("intéressé", "pas intéressé");
    const result = verifyHmacSignature(tamperedPayload, validSignature, secret);
    expect(result).toBe(false);
  });

  it("should reject invalid secret", () => {
    const validSignature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    const result = verifyHmacSignature(payload, validSignature, "wrong_secret_9999");
    expect(result).toBe(false);
  });

  it("should safely reject missing or empty parameters without throwing", () => {
    expect(verifyHmacSignature("", "sig", secret)).toBe(false);
    expect(verifyHmacSignature(payload, "", secret)).toBe(false);
    expect(verifyHmacSignature(payload, "sig", "")).toBe(false);
    expect(verifyHmacSignature(payload, null as any, secret)).toBe(false);
  });

  it("should verify Microsoft Graph validationToken handshake", () => {
    const handshake = verifyMicrosoftGraphWebhook("validation_token_xyz_123");
    expect(handshake.isValid).toBe(true);
    expect(handshake.responseToken).toBe("validation_token_xyz_123");
  });

  it("should verify Microsoft Graph clientState if configured", () => {
    expect(verifyMicrosoftGraphWebhook(null, "expected_state_abc", "expected_state_abc").isValid).toBe(true);
    expect(verifyMicrosoftGraphWebhook(null, "wrong_state", "expected_state_abc").isValid).toBe(false);
  });

  it("should sanitize event delivery IDs for Firestore document keys", async () => {
    // Tests that event IDs with special characters are safely handled
    const eventId = "msg/123?v=1#sub";
    const res = await checkAndRecordWebhookEvent(eventId, "instantly", { test: true });
    expect(res.docId).toBe("instantly_msg_123_v=1_sub");
  });
});
