/**
 * The channel that actually delivers a reply to a prospect.
 *
 * Found during the Phase 19 review: the autonomous path marked replies
 * "auto_dispatched", stored them as sent and cleared the Inbox flag — but no
 * code sent them anywhere. A prospect who answered was marked handled and
 * never heard back. Cold outreach is the only path that reaches a provider.
 *
 * Until a provider implements this interface (planned: Instantly API v2,
 * Phase 20 — the current Instantly client targets v1, deprecated on
 * 2026-01-19, and has no reply call), `getReplyTransport` returns null and the
 * dispatcher hands every reply to a person instead of pretending to send it.
 * A provider must also come with a Mock companion (provider rules).
 */
export interface ReplyTransport {
  name: string;
  sendReply(input: {
    workspaceId: string;
    businessId?: string;
    conversationId: string;
    to: string;
    from: string;
    subject: string;
    bodyText: string;
  }): Promise<{ providerMessageId?: string }>;
}

export async function getReplyTransport(_scope: { workspaceId: string; businessId?: string }): Promise<ReplyTransport | null> {
  return null;
}
