/**
 * Plain-language Inbox filters.
 *
 * The backend models conversations with technical statuses and intents
 * (`sequence_active`, `human_escalated`, `BOOKING_REQUEST`). The user should
 * only ever see what those mean for them, so the mapping lives here.
 */

import type { ConversationDoc } from "@/types/firestore";
import {
  awaitsSessionSend,
  channelOf,
  isDraftPending,
  isSocialChannel,
  networkLabel,
  sessionThreadAction,
  socialNetworkOf,
  socialSendUnconfirmed,
  unconfirmedSendLabel
} from "./channel";

export type InboxFilterId = "needs_attention" | "interested" | "ai_handling" | "booking" | "all";

export interface InboxFilter {
  id: InboxFilterId;
  label: string;
  emoji: string;
}

export const INBOX_FILTERS: InboxFilter[] = [
  { id: "needs_attention", label: "Needs attention", emoji: "🔥" },
  { id: "interested", label: "Interested", emoji: "💬" },
  { id: "ai_handling", label: "AI handling", emoji: "🤖" },
  { id: "booking", label: "Booking", emoji: "📅" },
  { id: "all", label: "All", emoji: "✓" }
];

export function needsAttention(conversation: ConversationDoc): boolean {
  // Someone who unsubscribed must never be surfaced as work for the user, even
  // if an attention flag was set before they opted out.
  if (conversation.status === "suppressed") return false;

  return Boolean(
    conversation.unreadHumanAttention ||
      conversation.humanAttentionRequired ||
      conversation.status === "human_escalated" ||
      conversation.status === "human_review_required" ||
      // The session pressed Enter but never saw the DM appear: a person has
      // to check it went out, even though the backend cleared the flags.
      socialSendUnconfirmed(conversation)
  );
}

export function isInterested(conversation: ConversationDoc): boolean {
  return conversation.latestIntent === "POSITIVE" || conversation.latestIntent === "BOOKING_REQUEST";
}

export function isBooking(conversation: ConversationDoc): boolean {
  return conversation.status === "meeting_booked" || conversation.latestIntent === "BOOKING_REQUEST";
}

/** The SDR is safely handling it and the user does not need to do anything. */
export function isAiHandling(conversation: ConversationDoc): boolean {
  if (needsAttention(conversation)) return false;
  if (conversation.manualTakeover) return false;
  return conversation.status === "in_dialogue" || conversation.status === "sequence_active";
}

export function matchesFilter(conversation: ConversationDoc, filter: InboxFilterId): boolean {
  switch (filter) {
    case "needs_attention":
      return needsAttention(conversation);
    case "interested":
      return isInterested(conversation);
    case "ai_handling":
      return isAiHandling(conversation);
    case "booking":
      return isBooking(conversation);
    case "all":
      return conversation.status !== "suppressed";
    default:
      return true;
  }
}

export function countByFilter(conversations: ConversationDoc[]): Record<InboxFilterId, number> {
  return INBOX_FILTERS.reduce(
    (acc, filter) => {
      acc[filter.id] = conversations.filter((conversation) => matchesFilter(conversation, filter.id)).length;
      return acc;
    },
    {} as Record<InboxFilterId, number>
  );
}

/** What the SDR is doing, or waiting for, in the user's words. */
export function conversationStateLabel(conversation: ConversationDoc): string {
  if (conversation.status === "meeting_booked") return "Meeting booked";
  // More precise than "Your input needed": the reply is written, and the only
  // place it can be sent from is the owner's local session.
  if (awaitsSessionSend(conversation)) return `Reply ready in your ${networkLabel(channelOf(conversation))} session`;
  // Never "Waiting for a reply" for a DM nobody saw go out.
  const network = socialNetworkOf(conversation);
  if (network && socialSendUnconfirmed(conversation)) return unconfirmedSendLabel(network);
  if (needsAttention(conversation)) return "Your input needed";
  if (conversation.manualTakeover) return "You are handling this";
  // A DM thread only moves when the owner runs the inbox session, so the SDR
  // is not "handling" it in the background the way it handles email.
  if (isSocialChannel(conversation) && (conversation.status === "in_dialogue" || conversation.status === "sequence_active")) {
    return `Waiting for a reply on ${networkLabel(channelOf(conversation))}`;
  }
  if (conversation.status === "in_dialogue") return "SDR handling conversation";
  if (conversation.status === "sequence_active") return "Waiting for a reply";
  if (conversation.status === "suppressed") return "Unsubscribed";
  if (conversation.status === "lost") return "Closed";
  return "In progress";
}

/**
 * Why an unconfirmed DM thread is in "Needs attention", or null when it is
 * not the reason (a reply waiting for the session explains itself first).
 * Shown in place of the generic attention reason, which would otherwise read
 * the already-sent draft as "a reply is ready for your review".
 */
export function unconfirmedSendDetail(conversation: ConversationDoc): string | null {
  const network = socialNetworkOf(conversation);
  if (!network || awaitsSessionSend(conversation) || !socialSendUnconfirmed(conversation)) return null;
  return `Your session pressed Enter but did not see the message appear. Open the conversation on ${networkLabel(network)} and check it went out.`;
}

/** Plain-language next step the SDR suggests for a conversation. */
export function recommendedAction(conversation: ConversationDoc): string | null {
  if (conversation.status === "meeting_booked") return null;
  if (conversation.latestIntent === "BOOKING_REQUEST") return "Propose available meeting slots.";
  if (conversation.latestIntent === "POSITIVE") return "Keep the conversation going and offer a call.";
  if (conversation.latestIntent === "OBJECTION") return "Answer their concern before proposing a call.";
  if (conversation.latestIntent === "QUESTION") return "Answer their question.";
  if (conversation.latestIntent === "WRONG_PERSON") return "Ask who the right person is.";
  // A DM draft is "ready" only when the session will actually offer it (same
  // rule as the draft card): never a stale one, nor one for an opted-out prospect.
  if (isSocialChannel(conversation)) {
    return sessionThreadAction(conversation) === "send_draft"
      ? `A reply is ready to send from your ${networkLabel(channelOf(conversation))} session.`
      : null;
  }
  // A draft that already went out (or was dropped) is not waiting for anyone.
  if (isDraftPending(conversation.draftResponse)) return "A reply is ready for your review.";
  return null;
}
