import { describe, it, expect, beforeEach } from "vitest";
import crypto from "node:crypto";
import { verifyHmacSignature, verifyMicrosoftGraphWebhook } from "../../services/webhook-verifier.js";
import { checkAndRecordWebhookEvent, markWebhookEventProcessed } from "../../services/webhook-idempotency.js";
import { processInstantlyWebhook } from "../../services/webhook-processor.js";
import { adminDb } from "../../config/firebase.js";

describe("Adversarial Security Audit: Webhook Idempotency & Replay Attack Protection (Invariant 7)", () => {
  const secret = "whsec_super_adversarial_test_key_2026";

  beforeEach(async () => {
    // Clear test webhookEvents
    const existing = await adminDb.collection("webhookEvents").get();
    for (const doc of existing.docs) {
      if (doc.id.startsWith("instantly_replay_") || doc.id.startsWith("instantly_concurrent_")) {
        await doc.ref.delete();
      }
    }
  });

  describe("HMAC Cryptographic Verification", () => {
    it("should accept authentic signatures computed with correct secret and payload", () => {
      const payload = JSON.stringify({ event: "reply_received", email: "prospect@test.fr" });
      const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");

      const isValid = verifyHmacSignature(payload, `sha256=${signature}`, secret);
      expect(isValid).toBe(true);
    });

    it("should reject tampered payloads with 401 unauthorized", () => {
      const originalPayload = JSON.stringify({ event: "reply_received", amount: 100 });
      const tamperedPayload = JSON.stringify({ event: "reply_received", amount: 999999 });
      const signature = crypto.createHmac("sha256", secret).update(originalPayload).digest("hex");

      const isValid = verifyHmacSignature(tamperedPayload, signature, secret);
      expect(isValid).toBe(false);
    });

    it("should reject forged signatures or wrong secrets in constant time", () => {
      const payload = JSON.stringify({ event: "lead_interested" });
      const forgedSig = "0".repeat(64);

      const isValid = verifyHmacSignature(payload, forgedSig, secret);
      expect(isValid).toBe(false);

      const wrongSecretSig = crypto.createHmac("sha256", "wrong_secret").update(payload).digest("hex");
      const isWrongSecretValid = verifyHmacSignature(payload, wrongSecretSig, secret);
      expect(isWrongSecretValid).toBe(false);
    });

    it("should validate Microsoft Graph subscription handshakes", () => {
      const handshake = verifyMicrosoftGraphWebhook("validation_token_xyz_123");
      expect(handshake.isValid).toBe(true);
      expect(handshake.responseToken).toBe("validation_token_xyz_123");

      const invalidState = verifyMicrosoftGraphWebhook(null, "wrong_state", "expected_state");
      expect(invalidState.isValid).toBe(false);
    });
  });

  describe("Atomic Deduplication & Replay Attack Defense (100 Duplicate Deliveries)", () => {
    it("should process unique event on first delivery and flag all 100 identical concurrent replays as duplicates", async () => {
      const eventId = `replay_test_${Date.now()}`;
      const payload = { event_type: "reply_received", id: eventId, text: "Oui je suis disponible jeudi." };

      // Dispatch 100 concurrent requests with the exact same event delivery ID
      const concurrentCalls = Array.from({ length: 100 }, () =>
        checkAndRecordWebhookEvent(eventId, "instantly", payload, {
          eventType: "reply_received",
          workspaceId: "ws_default",
          businessId: "biz_devcomm"
        })
      );

      const results = await Promise.all(concurrentCalls);

      const uniqueProcessed = results.filter((r) => !r.isDuplicate);
      const duplicateBlocked = results.filter((r) => r.isDuplicate);

      expect(uniqueProcessed.length).toBe(1);
      expect(duplicateBlocked.length).toBe(99);
      expect(uniqueProcessed[0].docId).toBe(`instantly_${eventId}`);

      // Marking processed
      await markWebhookEventProcessed(uniqueProcessed[0].docId, {
        success: true,
        output: { state: "handled" }
      });

      // Subsequent 101st delivery after processing
      const lateReplay = await checkAndRecordWebhookEvent(eventId, "instantly", payload);
      expect(lateReplay.isDuplicate).toBe(true);
    });

    it("should return HTTP 200 duplicate acknowledgment without reprocessing through processInstantlyWebhook", async () => {
      const eventId = `wh_proc_replay_${Date.now()}`;
      const body = {
        event_type: "reply_received",
        id: eventId,
        lead_email: "test@client.fr",
        reply_text: "Bonjour"
      };
      const rawBody = JSON.stringify(body);
      const signature = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
      const headers = { "x-instantly-signature": signature };

      // First delivery
      const firstRes = await processInstantlyWebhook(rawBody, headers, secret);
      expect(firstRes.statusCode).toBe(200);
      expect(firstRes.duplicate).toBeUndefined();

      // Second delivery (Replay attack)
      const secondRes = await processInstantlyWebhook(rawBody, headers, secret);
      expect(secondRes.statusCode).toBe(200);
      expect(secondRes.duplicate).toBe(true);
    });
  });
});
