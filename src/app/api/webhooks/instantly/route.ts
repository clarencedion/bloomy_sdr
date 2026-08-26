import { type NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { verifyHmacSignature } from "@/lib/security/webhook";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    ok: true,
    service: "instantly-webhook-receiver",
    version: "2.0",
    supportedEvents: ["reply_received", "lead_bounced", "lead_unsubscribed"]
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const rawBody = await request.text();
    if (!rawBody.trim()) {
      return NextResponse.json({ error: "Empty request body" }, { status: 400 });
    }

    const signature =
      request.headers.get("x-instantly-signature") ||
      request.headers.get("x-signature") ||
      request.headers.get("x-webhook-signature");
    const authHeader = request.headers.get("authorization");
    const apiKeyHeader = request.headers.get("x-api-key");
    const webhookSecret = process.env.INSTANTLY_WEBHOOK_SECRET;

    // Cryptographic HMAC / Secret verification (REQ-060)
    if (webhookSecret) {
      let isAuthorized = false;

      if (signature) {
        isAuthorized = verifyHmacSignature(rawBody, signature, webhookSecret);
      } else if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
        const token = authHeader.slice(7).trim();
        isAuthorized = timingSafeEqual(token, webhookSecret);
      } else if (apiKeyHeader) {
        isAuthorized = timingSafeEqual(apiKeyHeader.trim(), webhookSecret);
      }

      if (!isAuthorized) {
        return NextResponse.json(
          { error: "Unauthorized: Invalid webhook signature or secret" },
          { status: 401 }
        );
      }
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    const eventType = String(
      payload.event_type ?? payload.event ?? payload.type ?? "unknown"
    ).toLowerCase();

    const leadEmail = String(
      payload.lead_email ?? payload.email ?? payload.leadEmail ?? ""
    ).trim();

    if (!leadEmail) {
      return NextResponse.json(
        { error: "Missing required field: lead_email" },
        { status: 400 }
      );
    }

    const deliveryId = String(
      payload.email_id ??
        payload.event_id ??
        payload.id ??
        payload.message_id ??
        `instantly_${eventType}_${leadEmail}_${Date.now()}`
    );

    return NextResponse.json(
      {
        ok: true,
        received: true,
        eventId: deliveryId,
        eventType,
        leadEmail
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Instantly webhook processing failed.";
    console.error("[instantly-webhook]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}
