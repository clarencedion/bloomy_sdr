import crypto from "node:crypto";
import { verifyHmacSignature } from "./webhook-verifier.js";
import { checkAndRecordWebhookEvent, markWebhookEventProcessed } from "./webhook-idempotency.js";
import {
  recordInboundReply,
  recordLeadBounced,
  recordLeadUnsubscribed
} from "./conversation-service.js";
import { writeLog } from "../utils/logger.js";

export type WebhookProcessResult = {
  success: boolean;
  statusCode: number;
  duplicate?: boolean;
  eventId?: string;
  eventType?: string;
  conversationId?: string;
  messageId?: string;
  error?: string;
};

/**
 * Processes incoming Instantly.ai webhook payloads with HMAC verification,
 * deduplication, and multi-message conversation ingestion (REQ-059, REQ-060, REQ-061, REQ-062).
 */
export async function processInstantlyWebhook(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
  configuredSecret?: string | null
): Promise<WebhookProcessResult> {
  // 1. Signature Verification (REQ-060)
  if (configuredSecret) {
    const signatureHeader = getHeader(headers, "x-instantly-signature") ||
      getHeader(headers, "x-signature") ||
      getHeader(headers, "x-webhook-signature");

    const authHeader = getHeader(headers, "authorization");
    const apiKeyHeader = getHeader(headers, "x-api-key");

    let isAuthorized = false;

    if (signatureHeader) {
      isAuthorized = verifyHmacSignature(rawBody, signatureHeader, configuredSecret);
    } else if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
      const token = authHeader.slice(7).trim();
      isAuthorized = timingSafeEqualStr(token, configuredSecret);
    } else if (apiKeyHeader) {
      isAuthorized = timingSafeEqualStr(apiKeyHeader.trim(), configuredSecret);
    }

    if (!isAuthorized) {
      await writeLog({
        type: "webhook.instantly.unauthorized",
        level: "warning",
        message: "Rejected unauthorized Instantly webhook payload (signature mismatch).",
        metadata: { headers }
      });
      return {
        success: false,
        statusCode: 401,
        error: "Unauthorized: Invalid or missing webhook signature/secret."
      };
    }
  }

  // 2. Parse JSON payload
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return {
      success: false,
      statusCode: 400,
      error: "Bad Request: Payload must be valid JSON."
    };
  }

  const eventType = String(
    payload.event_type ?? payload.event ?? payload.type ?? "unknown"
  ).toLowerCase();

  const leadEmail = String(
    payload.lead_email ?? payload.email ?? payload.leadEmail ?? ""
  ).trim();

  if (!leadEmail) {
    return {
      success: false,
      statusCode: 400,
      error: "Bad Request: Missing lead email in webhook payload."
    };
  }

  // 3. Compute deterministic Delivery / Event ID (REQ-061)
  const deliveryId = String(
    payload.email_id ??
      payload.event_id ??
      payload.id ??
      payload.message_id ??
      `${eventType}_${leadEmail}_${payload.timestamp ?? Date.now()}`
  );

  // 4. Idempotency Deduplication Check
  const idempotencyRecord = await checkAndRecordWebhookEvent(deliveryId, "instantly", payload, {
    eventType,
    workspaceId: typeof payload.workspace === "string" ? payload.workspace : undefined
  });

  if (idempotencyRecord.isDuplicate) {
    return {
      success: true,
      statusCode: 200,
      duplicate: true,
      eventId: deliveryId,
      eventType
    };
  }

  try {
    let conversationId: string | undefined;
    let messageId: string | undefined;

    // 5. Dispatch by Event Type
    switch (eventType) {
      case "reply_received":
      case "reply":
      case "email_reply": {
        const result = await recordInboundReply({
          leadEmail,
          subject: (payload.reply_subject ?? payload.subject) as string | undefined,
          bodyText: (payload.reply_text ?? payload.body ?? payload.reply_text_snippet) as string | undefined,
          bodyHtml: (payload.reply_html ?? payload.html) as string | undefined,
          providerMessageId: (payload.email_id ?? payload.id) as string | undefined,
          campaignId: (payload.campaign_id ?? payload.campaignId) as string | undefined,
          uniboxUrl: payload.unibox_url as string | undefined
        });
        conversationId = result.conversationId;
        messageId = result.messageId;
        break;
      }

      case "lead_bounced":
      case "email_bounced":
      case "bounced": {
        await recordLeadBounced({
          leadEmail,
          reason: (payload.bounce_reason ?? payload.reason ?? "Email bounced") as string,
          campaignId: (payload.campaign_id ?? payload.campaignId) as string | undefined
        });
        break;
      }

      case "lead_unsubscribed":
      case "unsubscribed":
      case "unsubscribe": {
        await recordLeadUnsubscribed({
          leadEmail,
          reason: (payload.reason ?? "Lead unsubscribed") as string,
          campaignId: (payload.campaign_id ?? payload.campaignId) as string | undefined
        });
        break;
      }

      default: {
        await writeLog({
          type: "webhook.instantly.unhandled_event",
          level: "info",
          message: `Received unhandled Instantly event type: ${eventType}`,
          metadata: { eventType, leadEmail }
        });
      }
    }

    // 6. Mark Event Processed (REQ-061)
    await markWebhookEventProcessed(idempotencyRecord.docId, {
      success: true,
      output: { conversationId, messageId, eventType }
    });

    return {
      success: true,
      statusCode: 200,
      eventId: deliveryId,
      eventType,
      conversationId,
      messageId
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    await markWebhookEventProcessed(idempotencyRecord.docId, {
      success: false,
      error: errorMsg
    });
    return {
      success: false,
      statusCode: 500,
      error: errorMsg
    };
  }
}

function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}
