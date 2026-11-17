import { adminDb } from "../config/firebase.js";

/**
 * The offer a conversation is about: the one the first email was written for,
 * else the one the company was discovered for.
 *
 * The reply path used to pass the conversation's *campaign* id as the offer id.
 * It never matched an offer, so every reply was grounded in — and its pricing
 * checked against — the business's first offer, whichever offer the prospect
 * had actually been sent.
 */
export async function resolveConversationOfferId(conversation?: {
  outreachId?: string;
  companyId?: string;
}): Promise<string | undefined> {
  if (!conversation) return undefined;
  if (conversation.outreachId) {
    const outreach = await adminDb.collection("outreach").doc(conversation.outreachId).get().catch(() => null);
    const offerId = outreach?.exists ? (outreach.data()?.offerId as string | undefined) : undefined;
    if (offerId) return offerId;
  }
  if (conversation.companyId) {
    const company = await adminDb.collection("companies").doc(conversation.companyId).get().catch(() => null);
    const offerId = company?.exists ? (company.data()?.offerId as string | undefined) : undefined;
    if (offerId) return offerId;
  }
  return undefined;
}
