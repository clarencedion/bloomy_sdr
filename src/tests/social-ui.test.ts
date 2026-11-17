/**
 * Phase 23 — Instagram / Facebook conversations in the web app.
 *
 * A DM is never sent by the web app: the owner's local session types it and
 * sends it on a key press. These tests pin that the UI (1) recognises the
 * channel, (2) never routes a DM through the email reply callables, (3) tells
 * the owner how to send it from the session, (4) translates the new log types
 * and (5) persists an edited DM so the session types the edited text.
 *
 * Offline only: every Firebase module is mocked, nothing touches a project.
 *
 * Components are checked at source level: the root tsconfig keeps JSX
 * ("jsx": "preserve" for Next), so Vitest cannot import a .tsx component. The
 * decisions they render come from pure helpers in channel.ts, tested directly.
 */

import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Facebook, Instagram, Mail } from "lucide-react";

// aggregations.ts imports the Firebase client; nothing here may reach a project.
vi.mock("@/lib/firebase/client", () => ({ db: {}, app: {}, auth: {}, storage: {} }));
vi.mock("@/lib/firebase/firestore", () => ({ collections: {} }));

import {
  awaitsSessionSend,
  channelIcon,
  channelOf,
  displayHandle,
  draftDeliveryState,
  isHandSentOutreach,
  isSocialChannel,
  markSentActions,
  messageParty,
  networkFromUrl,
  networkLabel,
  safeExternalUrl,
  sessionCommand,
  sessionThreadAction,
  socialNetworkOf,
  socialProfileLinks,
  socialSendUnconfirmed,
  unconfirmedSendLabel
} from "@/lib/sdr/channel";
import {
  conversationStateLabel,
  countByFilter,
  isAiHandling,
  needsAttention,
  recommendedAction,
  unconfirmedSendDetail
} from "@/lib/sdr/inbox-filters";
import { attentionReason } from "@/lib/sdr/aggregations";
import { humanizeActivity, isTechnicalLog } from "@/lib/sdr/activity-humanizer";
import { draftEditFields } from "@/lib/sdr/approvals";
import type { ConversationDoc, MessageDoc, Outreach, ReplyDraft } from "@/types/firestore";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../..");
const read = (file: string) => fs.readFileSync(path.join(repoRoot, file), "utf8");

function draft(overrides: Partial<ReplyDraft> = {}): ReplyDraft {
  return {
    subject: "",
    bodyText: "Merci pour votre retour ! Souhaitez-vous qu'on en parle 10 minutes cette semaine ?",
    pricingGuardrailPassed: true,
    prohibitedPromisesChecked: true,
    confidence: 0.82,
    draftedAt: new Date("2026-11-10T09:00:00Z"),
    status: "queued_for_approval",
    ...overrides
  };
}

function conversation(overrides: Partial<ConversationDoc> = {}): ConversationDoc {
  return {
    id: "conv_cmp_1_ct_1",
    workspaceId: "ws_default",
    businessId: "biz_a",
    companyId: "cmp_1",
    contactId: "ct_1",
    status: "in_dialogue",
    unreadHumanAttention: false,
    messageCount: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

const instagramPending = conversation({
  channel: "instagram",
  socialHandle: "atelier.fleurs",
  socialProfileUrl: "https://www.instagram.com/atelier.fleurs/",
  companyName: "Atelier Fleurs",
  humanAttentionRequired: true,
  unreadHumanAttention: true,
  pendingSessionSend: true,
  draftResponse: draft()
});

// ── Channel helpers ─────────────────────────────────────────

describe("Phase 23 UI — channel helpers", () => {
  it("treats a missing or unknown channel as email, so pre-Phase-23 threads keep their meaning", () => {
    expect(channelOf(conversation())).toBe("email");
    expect(channelOf({ channel: "linkedin" })).toBe("email");
    expect(channelOf(null)).toBe("email");
    expect(channelOf({ channel: "instagram" })).toBe("instagram");
    expect(channelOf({ channel: "facebook" })).toBe("facebook");
    expect(isSocialChannel(conversation())).toBe(false);
    expect(isSocialChannel(instagramPending)).toBe(true);
    expect(socialNetworkOf(conversation({ channel: "email" }))).toBeNull();
    expect(socialNetworkOf({ channel: "facebook" })).toBe("facebook");
  });

  it("labels and draws each network", () => {
    expect(networkLabel("instagram")).toBe("Instagram");
    expect(networkLabel("facebook")).toBe("Facebook");
    expect(networkLabel("email")).toBe("Email");
    expect(channelIcon("instagram")).toBe(Instagram);
    expect(channelIcon("facebook")).toBe(Facebook);
    expect(channelIcon("email")).toBe(Mail);
    expect(channelIcon(undefined)).toBe(Mail);
  });

  it("shows a readable @handle and hides opaque Facebook ids", () => {
    expect(displayHandle("atelier.fleurs", "instagram")).toBe("@atelier.fleurs");
    expect(displayHandle("@@atelier", "instagram")).toBe("@atelier");
    expect(displayHandle("maisonflora", "facebook")).toBe("@maisonflora");
    expect(displayHandle("id:100064123456789", "facebook")).toBeUndefined();
    expect(displayHandle("100064123456789", "facebook")).toBeUndefined();
    expect(displayHandle("  ", "instagram")).toBeUndefined();
    expect(displayHandle(undefined, "instagram")).toBeUndefined();
  });

  it("never renders a scraped non-http link", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeExternalUrl("data:text/html,<script>1</script>")).toBeUndefined();
    expect(safeExternalUrl("not a url")).toBeUndefined();
    expect(safeExternalUrl("https://www.instagram.com/x/")).toBe("https://www.instagram.com/x/");
    expect(networkFromUrl("https://m.facebook.com/maisonflora")).toBe("facebook");
    expect(networkFromUrl("https://fb.com/maisonflora")).toBe("facebook");
    expect(networkFromUrl("https://instagram.com/x")).toBe("instagram");
    expect(networkFromUrl("https://linktr.ee/x")).toBeNull();
  });

  it("lists both profiles of a DM draft, Instagram first, with the legacy URL as fallback", () => {
    const both = socialProfileLinks({
      socialProfiles: {
        facebook: { url: "https://www.facebook.com/maisonflora", handle: "maisonflora" },
        instagram: { url: "https://www.instagram.com/maisonflora/", handle: "maisonflora" }
      },
      socialProfileUrl: "https://www.instagram.com/maisonflora/"
    });
    expect(both.map((link) => link.network)).toEqual(["instagram", "facebook"]);

    expect(socialProfileLinks({ socialProfileUrl: "https://www.facebook.com/profile.php?id=123" })).toEqual([
      { network: "facebook", url: "https://www.facebook.com/profile.php?id=123" }
    ]);
    // An unsafe stored value is dropped rather than rendered.
    expect(
      socialProfileLinks({ socialProfiles: { instagram: { url: "javascript:alert(1)", handle: "x" } } })
    ).toEqual([]);
    expect(socialProfileLinks({})).toEqual([]);
  });

  it("builds the exact runner command, scoped to the business", () => {
    expect(sessionCommand({ mode: "inbox", network: "instagram", businessId: "biz_a", workspaceId: "ws_default" })).toBe(
      "npm run social:inbox -- --business biz_a --network instagram"
    );
    expect(sessionCommand({ mode: "send", network: "facebook", businessId: "biz_a", workspaceId: "ws_team" })).toBe(
      "npm run social:send -- --workspace ws_team --business biz_a --network facebook"
    );
    // An id with shell characters is quoted, never pasted raw into a terminal.
    expect(sessionCommand({ mode: "send", network: "instagram", businessId: "a b;rm" })).toBe(
      "npm run social:send -- --business 'a b;rm' --network instagram"
    );
  });

  it("names the prospect by handle on social rows and keeps the sender address on email rows", () => {
    const social = conversation({ channel: "instagram", companyName: "Atelier Fleurs" });
    const inbound = {
      direction: "inbound",
      channel: "instagram",
      senderEmail: "",
      senderHandle: "atelier.fleurs"
    } as MessageDoc;
    const outbound = {
      direction: "outbound",
      channel: "instagram",
      senderEmail: "",
      recipientHandle: "atelier.fleurs"
    } as MessageDoc;
    expect(messageParty(inbound, social)).toEqual({ role: "from", value: "@atelier.fleurs" });
    expect(messageParty(outbound, social)).toEqual({ role: "to", value: "@atelier.fleurs" });

    const facebook = conversation({ channel: "facebook", companyName: "Maison Flora" });
    expect(
      messageParty({ direction: "inbound", channel: "facebook", senderEmail: "", senderHandle: "id:1000" } as MessageDoc, facebook)
    ).toEqual({ role: "from", value: "Maison Flora" });

    const email = { direction: "inbound", senderEmail: "sophie@flora.fr" } as MessageDoc;
    expect(messageParty(email, conversation())).toEqual({ role: "from", value: "sophie@flora.fr" });
  });
});

// ── Session state ───────────────────────────────────────────

describe("Phase 23 UI — a DM reply waits for the session, never for an approve button", () => {
  it("recognises a reply waiting for the session, and nothing else", () => {
    expect(awaitsSessionSend(instagramPending)).toBe(true);
    expect(awaitsSessionSend({ ...instagramPending, pendingSessionSend: false })).toBe(false);
    expect(awaitsSessionSend({ ...instagramPending, status: "suppressed" })).toBe(false);
    expect(awaitsSessionSend({ ...instagramPending, status: "human_escalated" })).toBe(false);
    expect(awaitsSessionSend({ ...instagramPending, draftResponse: draft({ status: "approved_and_sent" }) })).toBe(false);
    // An email thread never gets the session state, whatever flag is set.
    expect(awaitsSessionSend({ ...instagramPending, channel: "email" })).toBe(false);
  });

  it("keeps email delivery states and gives social drafts their own", () => {
    const email = conversation();
    expect(draftDeliveryState(email, draft())).toBe("awaiting_approval");
    expect(draftDeliveryState(email, draft({ status: "rejected" }))).toBe("awaiting_approval");
    expect(draftDeliveryState(email, draft({ status: "auto_dispatched" }))).toBe("auto_dispatched");
    expect(draftDeliveryState(email, draft({ status: "approved_and_sent" }))).toBe("approved");
    expect(draftDeliveryState({ ...email, pendingExternalSend: true }, draft({ status: "manual_override_sent" }))).toBe(
      "approved_pending_external"
    );

    expect(draftDeliveryState(instagramPending, draft())).toBe("session_pending");
    expect(draftDeliveryState(instagramPending, draft({ status: "approved_and_sent" }))).toBe("session_sent");
    expect(
      draftDeliveryState({ ...instagramPending, pendingExternalSend: true }, draft({ status: "manual_override_sent" }))
    ).toBe("session_sent_unconfirmed");
  });

  it("says where the reply is sent from in the Inbox list", () => {
    expect(needsAttention(instagramPending)).toBe(true);
    expect(conversationStateLabel(instagramPending)).toBe("Reply ready in your Instagram session");
    expect(attentionReason(instagramPending)).toMatch(/Instagram session/);
    expect(recommendedAction({ ...instagramPending, latestIntent: undefined })).toBe(
      "A reply is ready to send from your Instagram session."
    );

    // Escalated DM threads are a decision for the owner, not a send.
    const escalated = { ...instagramPending, status: "human_escalated" as const, escalationReason: "Prospect hostile" };
    expect(conversationStateLabel(escalated)).toBe("Your input needed");
    expect(attentionReason(escalated)).toBe("Prospect hostile");

    // Answered DM thread: waiting on the prospect, not "SDR handling".
    const answered = conversation({ channel: "facebook", draftResponse: draft({ status: "approved_and_sent" }) });
    expect(conversationStateLabel(answered)).toBe("Waiting for a reply on Facebook");
    expect(recommendedAction(answered)).toBeNull();
  });

  it("leaves the email labels unchanged", () => {
    const emailDraft = conversation({ draftResponse: draft() });
    expect(conversationStateLabel(conversation())).toBe("SDR handling conversation");
    expect(recommendedAction(emailDraft)).toBe("A reply is ready for your review.");
    // A reply that already went out is no longer "ready for review".
    expect(recommendedAction(conversation({ draftResponse: draft({ status: "approved_and_sent" }) }))).toBeNull();
  });
});

// ── Reply draft card / thread view ──────────────────────────

describe("Phase 23 UI — the thread never offers the email send path for a DM", () => {
  const thread = read("src/features/inbox/conversation-thread-view.tsx");
  const card = thread.slice(thread.indexOf("export function ReplyDraftCard"));

  it("guards both email reply callables against social threads", () => {
    // The manual reply handler refuses a social thread before calling anything.
    const manual = thread.slice(thread.indexOf("async function handleSendManualReply"));
    expect(manual.indexOf("if (network)")).toBeGreaterThan(-1);
    expect(manual.indexOf("if (network)")).toBeLessThan(manual.indexOf("callSendManualReply("));

    // The approve callback is not even passed for a social thread.
    expect(thread).toMatch(/onApprove=\{\s*social\s*\?\s*undefined\s*:\s*async/);
    const approve = thread.slice(thread.indexOf("onApprove={"));
    expect(approve.indexOf("social")).toBeLessThan(approve.indexOf("callApproveAndSendReply("));

    // Exactly one call site each: no other path reaches them.
    expect(thread.match(/callApproveAndSendReply\(/g)).toHaveLength(1);
    expect(thread.match(/callSendManualReply\(/g)).toHaveLength(1);

    // The manual composer and its button are email-only.
    expect(thread).toContain("showManualComposer && !social");
    expect(thread).toMatch(/\{!social && \(\s*<Button[^]*?"Répondre manuellement"\}\s*<\/Button>\s*\)\}/);
    expect(thread.match(/Répondre manuellement/g)).toHaveLength(1);
  });

  it("renders the approve toolbar only for an email draft a caller can approve", () => {
    expect(card).toContain('const canApprove = state === "awaiting_approval" && Boolean(onApprove);');
    const toolbar = card.slice(card.indexOf("{canApprove && ("));
    expect(toolbar.indexOf("Valider la réponse")).toBeGreaterThan(-1);
    expect(card.match(/Valider la réponse/g)).toHaveLength(1);
    expect(card.indexOf("{canApprove && (")).toBeLessThan(card.indexOf("Valider la réponse"));
    // Editing feeds the approve call only.
    expect(card).toContain("isEditing && canApprove");
  });

  it("tells the owner to send a DM from the session, with Copy and Escalate", () => {
    const block = card.slice(card.indexOf('{state === "session_pending" && network && ('));
    expect(block).toContain("À envoyer depuis ta session {networkLabel(network)} — lance");
    expect(block).toContain('mode: "inbox"');
    expect(block).toContain("businessId: conversation.businessId");
    expect(block).toContain("Copier");
    expect(block).toContain("Escalader");
    expect(block).not.toContain("onApprove");
    expect(card).toContain("À envoyer depuis la session");
    // A DM has no subject line.
    expect(card).toMatch(/\{!network && \(\s*<div className="text-xs font-semibold text-slate-800 mb-1">\s*Sujet :/);
  });

  it("never presents a DM about price as cleared, nor an unconfirmed send as delivered", () => {
    expect(card).toContain('draft.mentionsCommercialTerms === true');
    expect(card).toContain("Parle de prix — compare avec ton offre");
    expect(card).toContain("Contredit ton offre — à corriger");
    expect(card).toContain('state === "session_sent_unconfirmed"');
    expect(card).toContain("Envoi non confirmé — vérifie sur");
  });

  it("shows the handle linked to the profile instead of an internal id", () => {
    expect(thread).toContain("href={profileUrl}");
    expect(thread).toContain("const profileUrl = safeExternalUrl(conversation.socialProfileUrl);");
    expect(thread).toContain("{handle ?? conversation.companyName ??");
    expect(thread).toContain("conversation.companyName ?? conversation.companyId");
    expect(thread).toContain("messageParty(msg, conversation)");
    expect(thread).toContain("!social && msg.subject");
  });

  it("keeps the go-live strings and names no business", () => {
    expect(thread).toContain("sent.delivered === false");
    expect(thread).toContain("Validé — à envoyer depuis Unibox");
    expect(thread).not.toContain("Message envoyé avec succès au prospect !");
    expect(thread).not.toMatch(/Devcomm/);
  });

  it("shows no approve button on the company page, where nothing would be sent", () => {
    const timeline = read("src/features/conversations/conversation-timeline.tsx");
    expect(timeline).toMatch(/import \{ ReplyDraftCard[^}]*\} from "@\/features\/inbox\/conversation-thread-view";/);
    expect(timeline).not.toContain("export function ReplyDraftCard");
    expect(timeline).not.toMatch(/onApprove=/);
    expect(timeline).not.toContain("Réponse validée et envoyée avec succès !");
    expect(timeline).not.toContain("Approuver et Envoyer");
    expect(timeline).not.toMatch(/Devcomm/);
    expect(timeline).toContain("!social && msg.subject");
    // Without an approve handler, the shared card points to the Inbox.
    expect(card).toContain('state === "awaiting_approval" && !onApprove');
    expect(card).toContain('href="/app/inbox"');
  });
});

// ── Inbox list ──────────────────────────────────────────────

describe("Phase 23 UI — inbox list", () => {
  it("prefers the name stored on the conversation and shows the network and handle", () => {
    const source = read("src/features/inbox/sdr-inbox-page.tsx");
    expect(source).toContain("conversation.companyName ?? companyNames.get(conversation.companyId)");
    expect(source).toContain("displayHandle(conversation.socialHandle, network)");
    expect(source).toContain("networkLabel(network)");
  });
});

// ── Activity feed ───────────────────────────────────────────

describe("Phase 23 UI — social activity reads in plain language", () => {
  const resolveCompany = (id: string) => (id === "cmp_1" ? "Atelier Fleurs" : undefined);
  const humanize = (type: string, metadata: Record<string, unknown> = {}) =>
    humanizeActivity({ id: type, type, metadata: { companyId: "cmp_1", ...metadata } }, { resolveCompany });

  it("translates a stopped session by its reason, without echoing technical text", () => {
    const login = humanize("outreach.social_dm.session_blocked", {
      channel: "instagram",
      reason: "login: https://www.instagram.com/accounts/login/?next=%2Fdirect%2F"
    });
    expect(login?.title).toBe("Instagram session stopped");
    expect(login?.tone).toBe("issue");
    expect(login?.detail).toMatch(/log in again/);
    expect(JSON.stringify(login)).not.toContain("accounts/login");

    expect(humanize("outreach.social_dm.session_blocked", { channel: "facebook", reason: "action_blocked" })?.detail).toMatch(
      /limiting activity/
    );
    expect(humanize("outreach.social_dm.session_blocked", { reason: "captcha" })?.title).toBe("Social session stopped");
    expect(humanize("outreach.social_dm.session_blocked", { reason: "checkpoint" })?.detail).toMatch(/security check/);
    expect(humanize("outreach.social_dm.session_blocked", { reason: "selector_missing" })?.detail).toMatch(
      /did not look as expected/
    );
  });

  it("translates social replies, sends and opt-outs", () => {
    const ready = humanize("reply.social_draft_ready", { channel: "instagram" });
    expect(ready?.title).toBe("Atelier Fleurs replied on Instagram");
    expect(ready?.detail).toBe("A reply is ready in your session");
    expect(ready?.tone).toBe("reply");

    expect(humanize("reply.social_sent", { channel: "facebook" })?.title).toBe("Replied to Atelier Fleurs on Facebook");
    expect(humanize("reply.social_sent", { channel: "facebook" })?.tone).toBe("reply");

    const optOut = humanize("suppression.social_unsubscribed", { channel: "instagram" });
    expect(optOut?.title).toBe("Atelier Fleurs asked not to be contacted");
    expect(optOut?.tone).toBe("person");

    expect(humanize("outreach.social_dm.sent", { channel: "instagram", viaSession: true })?.title).toBe(
      "Message sent to Atelier Fleurs on Instagram"
    );
    // The by-hand path without a channel keeps its wording.
    expect(humanize("outreach.social_dm.sent")?.title).toBe("You sent a message to Atelier Fleurs");
    // An automatic session that found the conversation already started leaves the message to the owner.
    const left = humanize("outreach.social_dm.left_for_person", { channel: "instagram", reason: "thread_not_empty:text" });
    expect(left?.title).toBe("Message to Atelier Fleurs left for you");
    expect(left?.detail).toMatch(/conversation on Instagram is not new/);
    // An automatic session (ADR-024) is named as such; a send with a key is not.
    expect(humanize("outreach.social_dm.sent", { channel: "instagram", viaSession: true, auto: true })?.detail).toBe("Sent by an automatic session");
    expect(humanize("outreach.social_dm.sent", { channel: "instagram", viaSession: true })?.detail).toBeUndefined();

    expect(humanize("outreach.reply_received", { channel: "instagram" })?.title).toBe("Atelier Fleurs replied on Instagram");
    expect(humanize("outreach.reply_received")?.title).toBe("Atelier Fleurs replied");
  });

  it("hides session plumbing and the owner's own skips", () => {
    for (const type of [
      "outreach.social_dm.skipped",
      "social_session.started",
      "social_session.ended",
      "social_session.thread_unmatched"
    ]) {
      expect(isTechnicalLog(type), type).toBe(true);
      expect(humanize(type)).toBeNull();
    }
    // A session problem the owner must act on is never hidden by that prefix.
    expect(isTechnicalLog("outreach.social_dm.session_blocked")).toBe(false);
  });
});

// ── Approvals: the edited DM is the one that gets sent ──────

describe("Phase 23 UI — an edited DM is saved before it is used", () => {
  const dm = { channel: "social_dm", generatedBody: "Bonjour, original", generatedSubject: "" } as Outreach;

  it("persists only the body of an edited DM (a DM has no subject)", () => {
    expect(draftEditFields(dm, { subject: "Ignored", body: "Bonjour, modifié" })).toEqual({ generatedBody: "Bonjour, modifié" });
    expect(draftEditFields(dm, { subject: "Ignored", body: "Bonjour, original" })).toBeNull();
    expect(draftEditFields(dm, undefined)).toBeNull();

    const form = { channel: "contact_form", generatedBody: "a" } as Outreach;
    expect(draftEditFields(form, { subject: "x", body: "b" })).toEqual({ generatedBody: "b" });

    const email = { channel: "email", generatedSubject: "S", generatedBody: "B" } as Outreach;
    expect(draftEditFields(email, { subject: "S2", body: "B" })).toEqual({ generatedSubject: "S2" });
    expect(draftEditFields(email, { subject: "S", body: "B" })).toBeNull();
  });

  it("saves the edit before marking a DM sent, before submitting a form, and when copying", () => {
    const page = read("src/features/approvals/approvals-page.tsx");

    // The old bug: copy and "I sent it" used the stored text, ignoring the edit.
    expect(page).not.toContain('copyMessage(id, item.outreach.generatedBody ?? "")');
    expect(page).toContain("callUpdateOutreachDraft(item.outreach.id, fields)");

    // DM card (one action per network) and hand-sent form: both save the edit first.
    expect(page).toMatch(/await persistEdits\(item\);\s*await callMarkSocialDmSent\(id, action\.network \?\? undefined\);/);
    expect(page).toMatch(/await persistEdits\(item\);\s*await callMarkSocialDmSent\(id\);/);
    expect(page.match(/callMarkSocialDmSent\(/g)).toHaveLength(2);

    const submit = page.slice(page.indexOf("const submitForm"));
    expect(submit.indexOf("await persistEdits(item)")).toBeLessThan(submit.indexOf("callSubmitContactForm(id)"));

    expect(page).toContain("copyAndSave(item, edit.body, unsaved)");
    expect(page).toContain("Save changes");
  });

  it("shows both profiles and the session command on the DM card", () => {
    const page = read("src/features/approvals/approvals-page.tsx");
    expect(page).toContain("socialProfileLinks(item.outreach)");
    expect(page).toContain('sessionCommand({ mode: "send", network');
    // The by-hand path no longer promises replies in the Inbox.
    expect(page).not.toContain("so replies land in your Inbox");
    // Strings the go-live readiness test depends on are kept.
    expect(page).toContain("item.outreach.mentionsCommercialTerms !== false");
    expect(page).toContain("Compare it with your offer before sending");
  });
});

// ── Phase 23 review fixes (#18–#22 + operator unsubscribe) ──────────

describe("Review #21 — a stale, rejected or opted-out DM draft is never 'to send from the session'", () => {
  it("offers only a pending, flagged draft on a thread that is not suppressed", () => {
    expect(draftDeliveryState(instagramPending, draft())).toBe("session_pending");
    expect(draftDeliveryState(instagramPending, draft({ status: "draft" }))).toBe("session_pending");

    // "Désinscrire" in the Inbox: applyOutcome(unsubscribed) rejects the draft and suppresses the thread.
    const unsubscribed = { ...instagramPending, status: "suppressed" as const, pendingSessionSend: false };
    expect(draftDeliveryState(unsubscribed, draft({ status: "rejected" }))).toBe("session_dropped");
    // Even a draft left pending is never handed out for an opted-out prospect.
    expect(draftDeliveryState({ ...instagramPending, status: "suppressed" }, draft())).toBe("session_dropped");

    // A new hostile message makes the draft stale (escalated, draft rejected, flag cleared).
    const stale = { ...instagramPending, status: "human_escalated" as const, pendingSessionSend: false };
    expect(draftDeliveryState(stale, draft({ status: "rejected" }))).toBe("session_dropped");

    // A rejected draft on any thread, and a pending one the backend no longer flags.
    expect(draftDeliveryState(instagramPending, draft({ status: "rejected" }))).toBe("session_dropped");
    expect(draftDeliveryState({ ...instagramPending, pendingSessionSend: false }, draft())).toBe("session_dropped");
    expect(draftDeliveryState({ ...instagramPending, pendingSessionSend: undefined }, draft())).toBe("session_dropped");

    // "Escalader" leaves the draft pending and flagged: the session still offers it.
    expect(draftDeliveryState({ ...instagramPending, status: "human_escalated" }, draft())).toBe("session_pending");

    // Email keeps its meaning.
    expect(draftDeliveryState(conversation(), draft({ status: "rejected" }))).toBe("awaiting_approval");

    // The Inbox list agrees with the card: no "ready to send" for a draft the session will not offer.
    expect(recommendedAction({ ...instagramPending, latestIntent: undefined, pendingSessionSend: false })).toBeNull();
    expect(recommendedAction({ ...instagramPending, latestIntent: undefined, draftResponse: draft({ status: "rejected" }) })).toBeNull();
  });

  it("renders the runner command and Copy only for session_pending, and nothing actionable for a dropped draft", () => {
    const thread = read("src/features/inbox/conversation-thread-view.tsx");
    const card = thread.slice(thread.indexOf("export function ReplyDraftCard"));
    expect(card.match(/sessionCommand\(/g)).toHaveLength(1);
    expect(card.indexOf('{state === "session_pending" && network && (')).toBeLessThan(card.indexOf("sessionCommand("));
    expect(card.match(/handleCopy\(\)/g)).toHaveLength(1);

    const dropped = card.slice(card.indexOf('{state === "session_dropped" && network && ('));
    expect(dropped.length).toBeGreaterThan(0);
    const droppedBlock = dropped.slice(0, dropped.indexOf(")}") + 2);
    expect(droppedBlock).not.toContain("sessionCommand");
    expect(droppedBlock).not.toContain("Copier");
    expect(droppedBlock).toContain("désinscrit");
    expect(card).toContain("Proposition abandonnée — ne pas envoyer");
  });
});

describe("Review #20 — an unconfirmed social send is never shown as done", () => {
  // What recordSocialReplySent / recordSocialDmSent leave when verified is false.
  const unconfirmedReply = conversation({
    channel: "instagram",
    socialHandle: "atelier.fleurs",
    companyName: "Atelier Fleurs",
    status: "in_dialogue",
    unreadHumanAttention: false,
    humanAttentionRequired: false,
    pendingSessionSend: false,
    pendingExternalSend: true,
    draftResponse: draft({ status: "approved_and_sent" })
  });
  const unconfirmedFirstDm = conversation({
    channel: "facebook",
    status: "sequence_active",
    unreadHumanAttention: false,
    pendingExternalSend: true
  });

  it("recognises an unconfirmed DM from the flag or from the last outbound message", () => {
    expect(socialSendUnconfirmed(unconfirmedReply)).toBe(true);
    expect(socialSendUnconfirmed(unconfirmedFirstDm)).toBe(true);
    expect(socialSendUnconfirmed({ ...unconfirmedReply, pendingExternalSend: false })).toBe(false);
    // Opted out: never work. Email keeps its own pending-external meaning.
    expect(socialSendUnconfirmed({ ...unconfirmedReply, status: "suppressed" })).toBe(false);
    expect(socialSendUnconfirmed(conversation({ pendingExternalSend: true }))).toBe(false);

    const thread = conversation({ channel: "instagram" });
    const outbound = (deliveryStatus?: MessageDoc["deliveryStatus"]) =>
      ({ direction: "outbound", deliveryStatus }) as MessageDoc;
    const inbound = { direction: "inbound" } as MessageDoc;
    expect(socialSendUnconfirmed(thread, [outbound("delivered"), inbound, outbound("recorded_not_sent")])).toBe(true);
    expect(socialSendUnconfirmed(thread, [outbound("recorded_not_sent"), inbound, outbound("delivered")])).toBe(false);
    expect(socialSendUnconfirmed(thread, [])).toBe(false);
  });

  it("counts it as needing attention and never labels it 'Waiting for a reply'", () => {
    for (const unconfirmed of [unconfirmedReply, unconfirmedFirstDm]) {
      expect(needsAttention(unconfirmed)).toBe(true);
      expect(isAiHandling(unconfirmed)).toBe(false);
      expect(conversationStateLabel(unconfirmed)).not.toMatch(/Waiting for a reply/);
    }
    expect(conversationStateLabel(unconfirmedReply)).toBe("Envoi non confirmé — vérifie dans Instagram");
    expect(conversationStateLabel(unconfirmedFirstDm)).toBe("Envoi non confirmé — vérifie dans Facebook");
    expect(unconfirmedSendLabel("instagram")).toBe("Envoi non confirmé — vérifie dans Instagram");
    expect(countByFilter([unconfirmedReply, unconfirmedFirstDm]).needs_attention).toBe(2);
    expect(countByFilter([unconfirmedReply, unconfirmedFirstDm]).ai_handling).toBe(0);

    // The list explains it instead of reading the sent draft as "ready for your review".
    expect(unconfirmedSendDetail(unconfirmedReply)).toMatch(/check it went out/);
    expect(unconfirmedSendDetail(unconfirmedReply)).toMatch(/Instagram/);
    // A new reply waiting for the session explains itself first.
    expect(unconfirmedSendDetail({ ...unconfirmedReply, pendingSessionSend: true, draftResponse: draft() })).toBeNull();
    expect(unconfirmedSendDetail({ ...unconfirmedReply, pendingExternalSend: false })).toBeNull();

    // A confirmed send still reads as waiting on the prospect.
    expect(conversationStateLabel({ ...unconfirmedReply, pendingExternalSend: false })).toBe(
      "Waiting for a reply on Instagram"
    );
  });

  it("says 'not confirmed' in the activity feed when verified is false", () => {
    const resolveCompany = (id: string) => (id === "cmp_1" ? "Atelier Fleurs" : undefined);
    const humanize = (type: string, metadata: Record<string, unknown>) =>
      humanizeActivity({ id: type, type, metadata: { companyId: "cmp_1", ...metadata } }, { resolveCompany });

    const dm = humanize("outreach.social_dm.sent", { channel: "instagram", viaSession: true, verified: false });
    expect(dm?.title).toBe("Message to Atelier Fleurs on Instagram not confirmed");
    expect(dm?.tone).toBe("issue");
    expect(dm?.detail).toMatch(/check the conversation on Instagram/);

    const reply = humanize("reply.social_sent", { channel: "facebook", verified: false });
    expect(reply?.title).toBe("Reply to Atelier Fleurs on Facebook not confirmed");
    expect(reply?.tone).toBe("issue");

    for (const event of [dm, reply]) {
      expect(event?.title).not.toMatch(/Message sent|Replied/);
    }

    // Confirmed, or logged before the flag existed: unchanged wording.
    expect(humanize("outreach.social_dm.sent", { channel: "instagram", verified: true })?.title).toBe(
      "Message sent to Atelier Fleurs on Instagram"
    );
    expect(humanize("reply.social_sent", { channel: "facebook" })?.title).toBe("Replied to Atelier Fleurs on Facebook");
  });

  it("shows the notice in the open thread, on the company page and in the Inbox list", () => {
    const thread = read("src/features/inbox/conversation-thread-view.tsx");
    expect(thread).toContain("const unconfirmed = socialSendUnconfirmed(conversation, messages);");
    expect(thread).toContain("{unconfirmed && network && (");
    expect(thread).toContain("<p className=\"font-semibold\">{unconfirmedSendLabel(network)}</p>");

    const timeline = read("src/features/conversations/conversation-timeline.tsx");
    expect(timeline).toContain("socialSendUnconfirmed(conversation, messages)");
    expect(timeline).toContain("<UnconfirmedSendNotice");

    const inbox = read("src/features/inbox/sdr-inbox-page.tsx");
    expect(inbox).toContain("unconfirmedSendDetail(conversation) ?? attentionReason(conversation)");
  });
});

describe("Review #18 — the session copy matches what social:inbox now offers", () => {
  it("knows what the inbox session will do for each thread", () => {
    // A pending reply, including one skipped or interrupted in a previous run.
    expect(sessionThreadAction(instagramPending)).toBe("send_draft");
    // Escalated with nothing to send: the session lets the owner write the reply.
    const escalated = conversation({ channel: "instagram", status: "human_escalated", humanAttentionRequired: true });
    expect(sessionThreadAction(escalated)).toBe("write_reply");
    expect(
      sessionThreadAction({ ...escalated, pendingSessionSend: false, draftResponse: draft({ status: "rejected" }) })
    ).toBe("write_reply");
    // "Escalader" on a pending draft: the draft is still the thing to send.
    expect(sessionThreadAction({ ...instagramPending, status: "human_escalated" })).toBe("send_draft");
    // Nothing to do: opted out, answered, email.
    expect(sessionThreadAction({ ...escalated, status: "suppressed" })).toBeNull();
    expect(sessionThreadAction(conversation({ channel: "instagram", draftResponse: draft({ status: "approved_and_sent" }) }))).toBeNull();
    expect(sessionThreadAction(conversation({ status: "human_escalated" }))).toBeNull();
  });

  it("points an escalated DM thread to the session, and says a skipped draft comes back", () => {
    const thread = read("src/features/inbox/conversation-thread-view.tsx");
    expect(thread).toContain("const sessionAction = sessionThreadAction(conversation);");
    expect(thread).toContain('{sessionAction === "write_reply" && network && <SessionReplyHint');

    const hint = thread.slice(thread.indexOf("export function SessionReplyHint"), thread.indexOf("export function IntentPill"));
    expect(hint).toContain('mode: "inbox"');
    expect(hint).toContain("businessId: conversation.businessId");
    expect(hint).toContain("touche E");
    expect(hint).toContain("Entrée");
    // The web app still never sends a DM itself.
    expect(hint).not.toMatch(/callApproveAndSendReply|callSendManualReply/);

    const card = thread.slice(thread.indexOf("export function ReplyDraftCard"));
    const pending = card.slice(card.indexOf('{state === "session_pending" && network && ('));
    expect(pending).toContain("reproposée au lancement suivant");

    const timeline = read("src/features/conversations/conversation-timeline.tsx");
    expect(timeline).toContain('sessionAction === "write_reply" && network');

    // Go-live strings stay pinned.
    expect(thread).toContain("sent.delivered === false");
    expect(thread).toContain("Validé — à envoyer depuis Unibox");
    expect(thread).not.toContain("Message envoyé avec succès au prospect !");
  });
});

describe("Review #19 — 'I sent it' records the network the DM went out on", () => {
  it("offers one action per network with a profile, and a plain one otherwise", () => {
    const both = {
      socialProfiles: {
        instagram: { url: "https://www.instagram.com/maisonflora/", handle: "maisonflora" },
        facebook: { url: "https://www.facebook.com/maisonflora", handle: "maisonflora" }
      }
    };
    expect(markSentActions(both)).toEqual([
      { network: "instagram", label: "I sent it on Instagram" },
      { network: "facebook", label: "I sent it on Facebook" }
    ]);
    expect(
      markSentActions({ socialProfiles: { facebook: { url: "https://www.facebook.com/maisonflora", handle: "maisonflora" } } })
    ).toEqual([{ network: "facebook", label: "I sent it on Facebook" }]);
    expect(markSentActions({ socialProfileUrl: "https://www.instagram.com/maisonflora/" })).toEqual([
      { network: "instagram", label: "I sent it on Instagram" }
    ]);
    expect(markSentActions({ socialProfileUrl: "https://example.com/flora" })).toEqual([
      { network: null, label: "I sent it" }
    ]);
  });

  it("passes the chosen network to the backend from the DM card, with copy that matches", () => {
    const page = read("src/features/approvals/approvals-page.tsx");
    expect(page).toContain("const sentActions = isDm ? markSentActions(item.outreach) : [];");
    expect(page).toContain("{sentActions.map((action) => (");
    expect(page).toContain("callMarkSocialDmSent(id, action.network ?? undefined)");
    expect(page).toContain("{action.label}");
    // No single network-less "I sent it" button on the DM card any more.
    const dmCard = page.slice(page.indexOf(") : isDm ? ("), page.indexOf("Approve &amp; send now"));
    expect(dmCard).not.toMatch(/>\s*I sent it\s*</);
    // The old footer contradicted the backend, which now sweeps replies to a hand-sent DM.
    expect(page).not.toContain("Replies to a");
    expect(page).toContain("your inbox session on that network picks up their reply");
  });
});

describe("Review #22 — the company page never runs the email generator on a DM", () => {
  it("recognises the channels a person sends by hand", () => {
    expect(isHandSentOutreach({ channel: "social_dm" })).toBe(true);
    expect(isHandSentOutreach({ channel: "contact_form" })).toBe(true);
    expect(isHandSentOutreach({ channel: "email" })).toBe(false);
    expect(isHandSentOutreach({})).toBe(false);
    expect(isHandSentOutreach(undefined)).toBe(false);
  });

  it("routes a DM / form draft to its own panel before any email action is rendered", () => {
    const editor = read("src/features/outreach/outreach-editor.tsx");
    const main = editor.slice(editor.indexOf("export function OutreachEditor"), editor.indexOf("function HandSentOutreachPanel"));
    const guard = main.indexOf("if (outreach && isHandSentOutreach(outreach)) {");
    expect(guard).toBeGreaterThan(-1);
    expect(main.slice(guard)).toMatch(/^if \(outreach && isHandSentOutreach\(outreach\)\) \{\s*return <HandSentOutreachPanel/);
    // Every email-only action sits after the guard.
    for (const action of ["callGenerateOutreach(", "callApproveOutreach(", "callNeedsMoreResearch(", "Régénérer", "Forcer la génération"]) {
      const at = main.indexOf(action, main.indexOf("return (", guard));
      expect(at, action).toBeGreaterThan(guard);
      expect(main.slice(0, guard)).not.toContain(action);
    }
  });

  it("regenerates a DM with the DM writer and offers no email action on it", () => {
    const editor = read("src/features/outreach/outreach-editor.tsx");
    const panel = editor.slice(editor.indexOf("function HandSentOutreachPanel"));
    expect(panel).toContain("callGenerateSocialDm({ companyId: company.id, campaignId: outreach.campaignId, force: true })");
    expect(panel).not.toContain("callGenerateOutreach(");
    expect(panel).not.toContain("callApproveOutreach(");
    expect(panel).not.toContain("callNeedsMoreResearch(");
    // Only the body is saved: a DM has no subject or follow-ups.
    expect(panel).toContain("callUpdateOutreachDraft(outreach.id, { generatedBody: body })");
    expect(panel).toContain('href="/app/approvals"');
    // Regenerating is only offered for a DM (a form message has no writer of its own here).
    expect(panel).toContain("const canRegenerate = isDm && !REGENERATION_LOCKED.has(outreach.status);");
  });
});

describe("Review minor — an operator unsubscribe is not shown as the prospect asking", () => {
  const resolveCompany = (id: string) => (id === "cmp_1" ? "Atelier Fleurs" : undefined);
  const humanize = (metadata: Record<string, unknown>) =>
    humanizeActivity(
      { id: "x", type: "suppression.social_unsubscribed", metadata: { companyId: "cmp_1", ...metadata } },
      { resolveCompany }
    );

  it("names the owner when they unsubscribed the prospect from the Inbox", () => {
    const byOperator = humanize({ channel: "instagram", byOperator: true });
    expect(byOperator?.title).toBe("You unsubscribed Atelier Fleurs");
    expect(byOperator?.detail).toBe("Removed from Instagram outreach — your SDR will not message them again");
    expect(JSON.stringify(byOperator)).not.toMatch(/asked|They said so/);

    // A "stop" received in the DM keeps its wording.
    expect(humanize({ channel: "instagram" })?.title).toBe("Atelier Fleurs asked not to be contacted");
  });
});
