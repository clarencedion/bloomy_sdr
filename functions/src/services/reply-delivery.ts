import { canContact, canContactDetails } from "./can-contact.js";
import { getReplyTransport } from "./reply-transport.js";

/**
 * The one way a reply leaves the SDR, for every path (autonomous, approved
 * draft, rep-written). It says whether the reply was actually delivered so no
 * caller can record "sent" for something that was only stored.
 *
 * Suppression is checked immediately before delivery (Invariant 3): an
 * unsubscribe can land between the inbound reply and the answer. The
 * conversation itself is not a reason to refuse (we are answering it), and the
 * daily cold-outreach cap does not apply to replies.
 */
export type ReplyDeliveryResult =
  | { delivered: true; providerMessageId?: string }
  | { delivered: false; reason: "no_transport" | "suppressed"; detail?: string };

export async function deliverReply(input: {
  workspaceId: string;
  businessId?: string;
  conversationId: string;
  contactId?: string;
  to: string;
  from: string;
  subject: string;
  bodyText: string;
}): Promise<ReplyDeliveryResult> {
  // Suppression first, even when nothing could send it: the operator told to
  // "send it from Unibox" must be told "do not send" for an unsubscribed
  // prospect. The test allowlist applies only in test mode (canContact's own
  // rule), never as a standing block on every reply.
  const options = { checkActiveConversation: false, checkDailyLimit: false };
  const check =
    input.contactId && !input.contactId.startsWith("unknown")
      ? await canContact(input.contactId, input.businessId, options)
      : await canContactDetails({ email: input.to, businessId: input.businessId, workspaceId: input.workspaceId }, options);
  if (!check.allowed) return { delivered: false, reason: "suppressed", detail: check.reason };

  const transport = await getReplyTransport({ workspaceId: input.workspaceId, businessId: input.businessId });
  if (!transport) return { delivered: false, reason: "no_transport" };

  const sent = await transport.sendReply({
    workspaceId: input.workspaceId,
    businessId: input.businessId,
    conversationId: input.conversationId,
    to: input.to,
    from: input.from,
    subject: input.subject,
    bodyText: input.bodyText
  });
  return { delivered: true, providerMessageId: sent.providerMessageId };
}

/** What the operator is told when a reply could not leave the SDR. */
export function undeliveredReplyNotice(result: Extract<ReplyDeliveryResult, { delivered: false }>): string {
  return result.reason === "no_transport"
    ? "Recorded, not sent: replies cannot be sent from the SDR yet. Send it from Instantly Unibox."
    : `Do not send: this prospect cannot be contacted (${result.detail ?? "suppressed"}).`;
}
