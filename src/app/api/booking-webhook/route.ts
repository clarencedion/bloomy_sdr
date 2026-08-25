import { type NextRequest, NextResponse } from "next/server";
import { verifyMicrosoftGraphWebhook, verifyHmacSignature } from "@/lib/security/webhook";

// Microsoft Graph sends a GET with validationToken when the subscription is first created
export async function GET(request: NextRequest): Promise<NextResponse> {
  const validationToken = request.nextUrl.searchParams.get("validationToken");
  const check = verifyMicrosoftGraphWebhook(validationToken);
  if (check.responseToken) {
    return new NextResponse(check.responseToken, {
      status: 200,
      headers: { "Content-Type": "text/plain" }
    });
  }
  return NextResponse.json({ ok: true });
}

// Microsoft Graph / Cal / Calendly sends POST notifications when calendar events change
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-hub-signature") || request.headers.get("x-signature") || request.headers.get("x-cal-signature-256");
    const webhookSecret = process.env.BOOKING_WEBHOOK_SECRET;

    // If a webhook secret is configured and signature header is present, verify HMAC
    if (webhookSecret && signature) {
      const isValid = verifyHmacSignature(rawBody, signature, webhookSecret);
      if (!isValid) {
        return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
      }
    }

    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    // Microsoft Graph clientState verification if configured
    const clientState = (body?.value as Array<Record<string, unknown>>)?.[0]?.clientState as string | undefined;
    const expectedClientState = process.env.MICROSOFT_CLIENT_STATE;
    if (expectedClientState && !verifyMicrosoftGraphWebhook(null, clientState, expectedClientState).isValid) {
      return NextResponse.json({ error: "Invalid client state" }, { status: 401 });
    }

    return NextResponse.json({ ok: true, received: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook processing failed.";
    console.error("[booking-webhook]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

