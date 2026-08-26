import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import crypto from "node:crypto";
import { GET, POST } from "@/app/api/webhooks/instantly/route";

describe("Next.js Instantly Webhook Route (REQ-059 & REQ-060)", () => {
  it("should respond to GET request with health check status", async () => {
    const response = await GET();
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.service).toBe("instantly-webhook-receiver");
  });

  it("should accept valid POST reply_received webhook payload", async () => {
    const payload = {
      event_type: "reply_received",
      lead_email: "contact@prospect.fr",
      reply_subject: "Re: Diagnostic Commercial",
      reply_text: "Je suis intéressé par votre proposition."
    };

    const req = new NextRequest("http://localhost:3000/api/webhooks/instantly", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const response = await POST(req);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.received).toBe(true);
    expect(json.eventType).toBe("reply_received");
    expect(json.leadEmail).toBe("contact@prospect.fr");
  });

  it("should reject empty request body with 400", async () => {
    const req = new NextRequest("http://localhost:3000/api/webhooks/instantly", {
      method: "POST",
      body: ""
    });

    const response = await POST(req);
    expect(response.status).toBe(400);
  });

  it("should reject payload without lead_email with 400", async () => {
    const req = new NextRequest("http://localhost:3000/api/webhooks/instantly", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event_type: "reply_received" })
    });

    const response = await POST(req);
    expect(response.status).toBe(400);
  });

  it("should verify HMAC signature when secret is configured in environment", async () => {
    const secret = "test_env_webhook_secret_key_123";
    process.env.INSTANTLY_WEBHOOK_SECRET = secret;

    const payload = JSON.stringify({
      event_type: "reply_received",
      lead_email: "test@prospect.fr"
    });

    const validSignature = crypto.createHmac("sha256", secret).update(payload).digest("hex");

    // 1. Valid signature
    const validReq = new NextRequest("http://localhost:3000/api/webhooks/instantly", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-instantly-signature": validSignature
      },
      body: payload
    });
    const validRes = await POST(validReq);
    expect(validRes.status).toBe(200);

    // 2. Invalid signature -> 401
    const invalidReq = new NextRequest("http://localhost:3000/api/webhooks/instantly", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-instantly-signature": "forged_signature_123456"
      },
      body: payload
    });
    const invalidRes = await POST(invalidReq);
    expect(invalidRes.status).toBe(401);

    delete process.env.INSTANTLY_WEBHOOK_SECRET;
  });
});
