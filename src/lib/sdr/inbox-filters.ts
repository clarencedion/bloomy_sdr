/**
 * Plain-language Inbox filters.
 *
 * The backend models conversations with technical statuses and intents
 * (`sequence_active`, `human_escalated`, `BOOKING_REQUEST`). The user should
 * only ever see what those mean for them, so the mapping lives here.
 */

import type { ConversationDoc } from "@/types/firestore";

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
      conversation.status === "human_review_required"
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
  if (needsAttention(conversation)) return "Your input needed";
  if (conversation.manualTakeover) return "You are handling this";
  if (conversation.status === "in_dialogue") return "SDR handling conversation";
  if (conversation.status === "sequence_active") return "Waiting for a reply";
  if (conversation.status === "suppressed") return "Unsubscribed";
  if (conversation.status === "lost") return "Closed";
  return "In progress";
}

/** Plain-language next step the SDR suggests for a conversation. */
export function recommendedAction(conversation: ConversationDoc): string | null {
  if (conversation.status === "meeting_booked") return null;
  if (conversation.latestIntent === "BOOKING_REQUEST") return "Propose available meeting slots.";
  if (conversation.latestIntent === "POSITIVE") return "Keep the conversation going and offer a call.";
  if (conversation.latestIntent === "OBJECTION") return "Answer their concern before proposing a call.";
  if (conversation.latestIntent === "QUESTION") return "Answer their question.";
  if (conversation.latestIntent === "WRONG_PERSON") return "Ask who the right person is.";
  if (conversation.draftResponse) return "A reply is ready for your review.";
  return null;
}
