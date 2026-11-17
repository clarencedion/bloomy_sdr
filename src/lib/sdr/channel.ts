/**
 * Which channel a conversation or draft runs on, and what that means for the UI.
 *
 * Phase 23 added Instagram and Facebook direct messages next to email. A DM is
 * never sent by the web app: the owner's local session runner types it and
 * sends it only when they press Enter. Every screen that could otherwise offer
 * an email-only action (approve & send, manual reply) asks this module first.
 *
 * Branching here is on the channel, never on a business (Invariant 1).
 */

import { Facebook, Instagram, Mail, type LucideIcon } from "lucide-react";
import type {
  ConversationChannel,
  ConversationDoc,
  MessageDoc,
  Outreach,
  ReplyDraft,
  SocialNetwork
} from "@/types/firestore";

/** Anything that may carry a `channel` field (conversation, message). */
type Channeled = { channel?: ConversationChannel | string | null } | null | undefined;

/**
 * The conversation's channel. Documents written before Phase 23 have no
 * `channel` and are email; an unrecognised value is treated as email too, so
 * only the two networks the session runner knows ever get the session UI.
 */
export function channelOf(item: Channeled): ConversationChannel {
  const channel = item?.channel;
  return channel === "instagram" || channel === "facebook" ? channel : "email";
}

/** True for Instagram / Facebook conversations, which only the local session can answer. */
export function isSocialChannel(item: Channeled): boolean {
  return channelOf(item) !== "email";
}

/** The social network of a conversation, or null for email. */
export function socialNetworkOf(item: Channeled): SocialNetwork | null {
  const channel = channelOf(item);
  return channel === "email" ? null : channel;
}

export function networkLabel(channel: ConversationChannel | SocialNetwork): string {
  switch (channel) {
    case "instagram":
      return "Instagram";
    case "facebook":
      return "Facebook";
    default:
      return "Email";
  }
}

export function channelIcon(channel: ConversationChannel | SocialNetwork | null | undefined): LucideIcon {
  switch (channel) {
    case "instagram":
      return Instagram;
    case "facebook":
      return Facebook;
    default:
      return Mail;
  }
}

/**
 * "@handle" as a person would recognise it, or undefined when there is nothing
 * readable to show. Facebook profiles without a vanity slug are identified by
 * a numeric id ("id:1000…"), which means nothing to the owner.
 */
export function displayHandle(handle: string | null | undefined, network?: SocialNetwork | null): string | undefined {
  const clean = (handle ?? "").trim().replace(/^@+/, "");
  if (!clean) return undefined;
  if (network === "facebook" && (/^id:/i.test(clean) || /^\d+$/.test(clean))) return undefined;
  return `@${clean}`;
}

/**
 * Only http(s) links are rendered. Profile URLs come from scraped pages
 * (untrusted), so a `javascript:` or `data:` value must never reach an href.
 */
export function safeExternalUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Recognises the network of a legacy single `socialProfileUrl`. Deliberately
 * shallow: the backend owns full normalisation (social-profile.ts); this only
 * decides which icon to draw.
 */
export function networkFromUrl(url: string | null | undefined): SocialNetwork | null {
  const safe = safeExternalUrl(url);
  if (!safe) return null;
  const host = new URL(safe).hostname.toLowerCase().replace(/^www\./, "");
  if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram";
  if (host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.com" || host.endsWith(".fb.com")) {
    return "facebook";
  }
  return null;
}

export interface SocialProfileLink {
  /** Null for a legacy link on another site (shown as a plain "Open profile"). */
  network: SocialNetwork | null;
  url: string;
  handle?: string;
}

const NETWORK_ORDER: SocialNetwork[] = ["instagram", "facebook"];

/**
 * Every profile a DM draft can be sent to, Instagram first. Falls back to the
 * single `socialProfileUrl` that drafts carried before `socialProfiles`.
 */
export function socialProfileLinks(
  outreach: Pick<Outreach, "socialProfiles" | "socialProfileUrl">
): SocialProfileLink[] {
  const links: SocialProfileLink[] = [];
  for (const network of NETWORK_ORDER) {
    const ref = outreach.socialProfiles?.[network];
    const url = safeExternalUrl(ref?.url);
    if (url) links.push({ network, url, handle: ref?.handle });
  }
  if (links.length > 0) return links;

  const legacy = safeExternalUrl(outreach.socialProfileUrl);
  return legacy ? [{ network: networkFromUrl(legacy), url: legacy }] : [];
}

/** True while a reply draft can still be sent (it has not gone out or been dropped). */
export function isDraftPending(draft: Pick<ReplyDraft, "status"> | null | undefined): boolean {
  return draft?.status === "draft" || draft?.status === "queued_for_approval";
}

/**
 * A drafted DM reply is waiting for the owner's local session to send it.
 * Escalated, unsubscribed or closed threads are not "ready to send", whatever
 * flag was left behind.
 */
export function awaitsSessionSend(
  conversation: Pick<ConversationDoc, "channel" | "pendingSessionSend" | "draftResponse" | "status">
): boolean {
  if (!isSocialChannel(conversation)) return false;
  if (conversation.pendingSessionSend !== true) return false;
  if (!isDraftPending(conversation.draftResponse)) return false;
  return conversation.status !== "suppressed" && conversation.status !== "human_escalated" && conversation.status !== "lost";
}

/**
 * What the reply draft card should say about delivery.
 *
 * Email keeps its existing meaning. A social draft is never "approved" in the
 * app: it is either waiting for the session, was sent from it, or no longer
 * goes anywhere. When the session pressed Enter but could not see the message
 * appear, the backend sets `pendingExternalSend` and the UI must not claim
 * delivery.
 *
 * "session_dropped": a stale or rejected draft, one the backend no longer
 * flags for the session, or a draft on a thread whose prospect opted out. The
 * card must not hand it out to be sent (no command, no Copy).
 */
export type DraftDeliveryState =
  | "auto_dispatched"
  | "awaiting_approval"
  | "approved"
  | "approved_pending_external"
  | "session_pending"
  | "session_sent"
  | "session_sent_unconfirmed"
  | "session_dropped";

export function draftDeliveryState(
  conversation: Pick<ConversationDoc, "channel" | "pendingExternalSend" | "pendingSessionSend" | "status">,
  draft: Pick<ReplyDraft, "status">
): DraftDeliveryState {
  const sent = draft.status === "approved_and_sent" || draft.status === "manual_override_sent";

  if (isSocialChannel(conversation)) {
    if (sent) return conversation.pendingExternalSend ? "session_sent_unconfirmed" : "session_sent";
    // Only a draft the session will actually offer is "to send from the session".
    const sendable =
      isDraftPending(draft) && conversation.pendingSessionSend === true && conversation.status !== "suppressed";
    return sendable ? "session_pending" : "session_dropped";
  }

  if (draft.status === "auto_dispatched") return "auto_dispatched";
  if (sent) return conversation.pendingExternalSend ? "approved_pending_external" : "approved";
  return "awaiting_approval";
}

/**
 * The last DM we recorded on this thread was typed and sent by the session,
 * which then could not see it appear: nobody knows whether it went out.
 *
 * `messages`, when the thread is loaded, is authoritative: the latest outbound
 * message carries the delivery status. The conversation's `pendingExternalSend`
 * (rewritten on every recorded reply) covers the lists, which load no messages.
 * A prospect who opted out is never work, whatever was left unconfirmed.
 */
export function socialSendUnconfirmed(
  conversation: Pick<ConversationDoc, "channel" | "pendingExternalSend" | "status">,
  messages?: ReadonlyArray<Pick<MessageDoc, "direction" | "deliveryStatus">>
): boolean {
  if (!isSocialChannel(conversation) || conversation.status === "suppressed") return false;
  if (conversation.pendingExternalSend === true) return true;
  const lastOutbound = messages ? [...messages].reverse().find((message) => message.direction === "outbound") : undefined;
  return lastOutbound?.deliveryStatus === "recorded_not_sent";
}

/** "Envoi non confirmé — vérifie dans Instagram": the one wording every surface uses. */
export function unconfirmedSendLabel(network: SocialNetwork): string {
  return `Envoi non confirmé — vérifie dans ${networkLabel(network)}`;
}

/**
 * What the owner's inbox session (`npm run social:inbox`) will do for this
 * thread, so the web app only points there when there is something to do:
 * - "send_draft": a pending reply draft it types and sends on Enter (a draft
 *   that was skipped or interrupted is offered again on the next run);
 * - "write_reply": an escalated thread with no draft, where the session lets
 *   the owner write the reply themselves;
 * - null: nothing to send (email, opted out, or nothing pending).
 */
export type SessionThreadAction = "send_draft" | "write_reply" | null;

export function sessionThreadAction(
  conversation: Pick<ConversationDoc, "channel" | "pendingExternalSend" | "pendingSessionSend" | "status" | "draftResponse">
): SessionThreadAction {
  if (!isSocialChannel(conversation) || conversation.status === "suppressed") return null;
  if (conversation.draftResponse && draftDeliveryState(conversation, conversation.draftResponse) === "session_pending") {
    return "send_draft";
  }
  return conversation.status === "human_escalated" ? "write_reply" : null;
}

/**
 * One "I sent it" action per network the DM card offers a profile for, so the
 * send is recorded on the network it actually went out on (its replies are
 * then swept by that network's inbox session). A legacy link on another site
 * has no network: a single plain action, and the backend decides.
 */
export function markSentActions(
  outreach: Pick<Outreach, "socialProfiles" | "socialProfileUrl">
): Array<{ network: SocialNetwork | null; label: string }> {
  const networks = socialProfileLinks(outreach)
    .map((link) => link.network)
    .filter((network): network is SocialNetwork => network !== null);
  if (networks.length === 0) return [{ network: null, label: "I sent it" }];
  return networks.map((network) => ({ network, label: `I sent it on ${networkLabel(network)}` }));
}

/**
 * Messages a person sends from their own account (a DM, a contact-form post)
 * are written by their own generator and sent outside email. The email
 * sequence editor must never regenerate, approve or send them as email.
 */
export function isHandSentOutreach(outreach: Pick<Outreach, "channel"> | null | undefined): boolean {
  return outreach?.channel === "social_dm" || outreach?.channel === "contact_form";
}

/** Quotes a CLI argument only when it needs it, so the common case stays readable. */
function shellArg(value: string): string {
  return /^[\w.:-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * The exact terminal command that starts the local session runner, ready to
 * copy. `--business` is required by the runner; the workspace flag is only
 * needed outside the default workspace.
 */
export function sessionCommand(input: {
  mode: "send" | "inbox";
  network: SocialNetwork;
  businessId?: string | null;
  workspaceId?: string | null;
}): string {
  const args: string[] = [];
  if (input.workspaceId && input.workspaceId !== "ws_default") args.push(`--workspace ${shellArg(input.workspaceId)}`);
  if (input.businessId) args.push(`--business ${shellArg(input.businessId)}`);
  args.push(`--network ${input.network}`);
  return `npm run social:${input.mode} -- ${args.join(" ")}`;
}

/**
 * Who a message row names. Email rows keep showing the sender address. Social
 * rows store "" in the email fields, so they name the prospect's handle: the
 * sender of an inbound message, the recipient of one we sent.
 */
export function messageParty(
  message: Pick<MessageDoc, "direction" | "channel" | "senderEmail" | "senderHandle" | "recipientHandle">,
  conversation: Pick<ConversationDoc, "channel"> & { companyName?: string }
): { role: "from" | "to"; value: string } | null {
  const network = socialNetworkOf(message.channel ? message : conversation);
  if (!network) {
    return message.senderEmail ? { role: "from", value: message.senderEmail } : null;
  }

  if (message.direction === "inbound") {
    const value = displayHandle(message.senderHandle, network) ?? (message.senderEmail || conversation.companyName);
    return value ? { role: "from", value } : null;
  }
  const value = displayHandle(message.recipientHandle, network) ?? conversation.companyName;
  return value ? { role: "to", value } : null;
}
