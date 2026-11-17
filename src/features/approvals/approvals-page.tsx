"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Copy, ExternalLink, FileText, Loader2, Mail, Save, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { LoadingSkeleton } from "@/components/common/loading-skeleton";
import { useBusiness } from "@/lib/context/business-context";
import {
  approvalsEnabled,
  draftEditFields,
  getPendingApprovals,
  type PendingApproval
} from "@/lib/sdr/approvals";
import {
  channelIcon,
  displayHandle,
  markSentActions,
  networkLabel,
  sessionCommand,
  socialProfileLinks
} from "@/lib/sdr/channel";
import type { SocialNetwork } from "@/types/firestore";
import {
  callApproveOutreach,
  callMarkSocialDmSent,
  callSubmitContactForm,
  callRejectOutreach,
  callSendApprovedOutreach,
  callUpdateOutreachDraft,
  getCallableErrorMessage
} from "@/lib/firebase/functions";
import { collection, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { collections } from "@/lib/firebase/firestore";
import { useChangeSignal } from "@/lib/sdr/use-live";
import { invalidateReadCache } from "@/lib/sdr/query-cache";
import { cn } from "@/lib/utils";

/**
 * Review queue for "Draft only" autonomy: one card per prepared email, with the
 * evidence that justified writing it. Approving is deliberately separate from
 * sending, so a person always makes the decision to put mail on the wire.
 */
export function ApprovalsPage() {
  const { currentBusiness, currentBusinessId, workspaceId } = useBusiness();
  const [items, setItems] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { subject: string; body: string }>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const copyMessage = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied((current) => (current === id ? null : current)), 2000);
    } catch {
      // Clipboard blocked: the message is on screen and can be selected.
    }
  };

  const scope = useMemo(
    () => ({ workspaceId: workspaceId || "ws_default", businessId: currentBusinessId || undefined }),
    [workspaceId, currentBusinessId]
  );

  // Autonomy governs email only. It never gates this queue: the DM and
  // contact-form channels always produce a draft a person has to send.
  const draftOnly = approvalsEnabled(currentBusiness?.automationPolicy);

  const refresh = useCallback(async (silent = false) => {
    // A live update must never blank the list it is updating.
    if (!silent) setLoading(true);
    try {
      setItems(await getPendingApprovals(scope));
    } catch (err) {
      console.error("Failed to load drafts", err);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The queue empties as the SDR writes and as you approve, so it should not
  // need a reload to show it. Listening to drafts only keeps this small.
  const changed = useChangeSignal(
    () =>
      query(
        collection(db, collections.outreach),
        where("workspaceId", "==", scope.workspaceId),
        where("status", "==", "draft")
      ),
    `approvals-drafts:${scope.workspaceId}`
  );

  useEffect(() => {
    if (changed === 0) return;
    invalidateReadCache();
    void refresh(true);
  }, [changed, refresh]);

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      invalidateReadCache();
      await refresh();
    } catch (err) {
      setError(getCallableErrorMessage(err, "That didn't work. Try again."));
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Submitting a form can succeed, or come back needing a person — a CAPTCHA
   * that appeared since we looked, safe mode, a rejected POST. None of those
   * throw, so the reason is surfaced here rather than vanishing into a refresh.
   */
  const submitForm = async (item: PendingApproval) => {
    const id = item.outreach.id;
    setBusyId(id);
    setError(null);
    try {
      await persistEdits(item);
      const result = await callSubmitContactForm(id);
      if (result.status !== "sent") {
        setError(result.reason ?? "Their form needs a person — open it and send the message yourself.");
      }
      invalidateReadCache();
      await refresh();
    } catch (err) {
      setError(getCallableErrorMessage(err, "That didn't work. Try again."));
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Saves an edit before anything uses the message. The DM session runner and
   * the form submitter both read the stored text, so an edit left only on
   * screen would be replaced by the original draft at send time.
   */
  async function persistEdits(item: PendingApproval) {
    const fields = draftEditFields(item.outreach, edits[item.outreach.id]);
    if (!fields) return;
    if (fields.generatedBody !== undefined && !fields.generatedBody.trim()) {
      throw new Error("The message is empty. Write it again, or choose Not this one.");
    }
    await callUpdateOutreachDraft(item.outreach.id, fields);
  }

  /**
   * Copies the text on screen, then saves it if it was edited. The copy runs
   * first because browsers only allow clipboard writes during the click
   * itself; saving right after keeps the stored draft equal to what was copied.
   */
  function copyAndSave(item: PendingApproval, text: string, unsaved: boolean) {
    void copyMessage(item.outreach.id, text);
    if (unsaved) void act(item.outreach.id, () => persistEdits(item));
  }

  // Networks with DMs waiting, Instagram first: one session command each.
  const sessionNetworks = useMemo(() => {
    const present = new Set<SocialNetwork>();
    for (const item of items) {
      if (item.outreach.channel !== "social_dm") continue;
      for (const link of socialProfileLinks(item.outreach)) if (link.network) present.add(link.network);
    }
    return (["instagram", "facebook"] as const).filter((network) => present.has(network));
  }, [items]);

  if (loading) return <LoadingSkeleton />;

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <Mail className="mx-auto size-7 text-slate-300" />
        <h1 className="mt-4 text-xl font-semibold text-slate-900">Nothing to approve yet.</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-slate-500">
          {draftOnly
            ? "Your SDR writes an email as soon as it finds a good opportunity with a contact. Drafts land here for you to say yes."
            : "Your SDR sends emails on its own. Messages that can only be sent by hand — direct messages and contact forms — still land here for you."}
        </p>
        <Link href="/app/campaigns" className="mt-5 inline-block text-[14px] font-medium text-slate-700 hover:underline">
          See what your SDR is working on
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 py-2">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">
          {items.length} {items.length === 1 ? "message" : "messages"} to approve
        </h1>
        <p className="mt-1.5 text-[13px] text-slate-500">
          Nothing is sent until you approve it.
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>
      )}

      {sessionNetworks.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[13px] text-slate-600">
          <p>
            Send direct messages in a row from your session on your computer. It opens each profile and types the
            message; nothing goes out until you press Enter.
          </p>
          {sessionNetworks.map((network) => (
            <code
              key={network}
              className="mt-2 block overflow-x-auto whitespace-nowrap rounded-md border border-slate-200 bg-white px-3 py-1.5 font-mono text-[12px] text-slate-800"
            >
              {sessionCommand({ mode: "send", network, businessId: scope.businessId, workspaceId: scope.workspaceId })}
            </code>
          ))}
        </div>
      )}

      <div className="space-y-4">
        {items.map((item) => {
          const id = item.outreach.id;
          const busy = busyId === id;
          const isOpen = expanded === id;
          const isDm = item.outreach.channel === "social_dm";
          const isForm = item.outreach.channel === "contact_form";
          // False when a CAPTCHA or a third-party widget means a person must send it.
          const formSubmittable = item.outreach.contactFormSubmittable === true;
          const edit = edits[id] ?? {
            subject: item.outreach.generatedSubject ?? "",
            body: item.outreach.generatedBody ?? ""
          };
          // True while the text on screen differs from the one that would be sent.
          const unsaved = draftEditFields(item.outreach, edits[id]) !== null;
          const profileLinks = isDm ? socialProfileLinks(item.outreach) : [];
          // Every network this DM can go out on, Instagram first.
          const sessionNetworkNames = profileLinks.flatMap((link) => (link.network ? [networkLabel(link.network)] : []));
          // One "I sent it on …" per network, so the send is recorded where it happened.
          const sentActions = isDm ? markSentActions(item.outreach) : [];

          return (
            <div key={id} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-semibold text-slate-900">
                    {item.company?.name ?? "A prospect"}
                  </h2>
                  <p className="mt-0.5 text-[13px] text-slate-500">
                    {isForm
                      ? formSubmittable
                        ? "Their contact form — no email published"
                        : "Their contact form — needs a person"
                      : isDm
                        ? "Direct message — no email published"
                        : `To ${item.recipient}`}
                  </p>
                </div>
                {item.opportunity && (
                  <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[12px] font-semibold text-emerald-700">
                    {item.opportunity.score} / 100
                  </span>
                )}
              </div>
              {item.outreach.pricingGuardrailPassed === false ? (
                <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
                  This message states a price, a free item, a discount or a commitment that doesn&apos;t match your
                  offer. Correct it before sending.
                </p>
              ) : item.outreach.mentionsCommercialTerms !== false ? (
                // Never shown as "checked": the automatic check catches known
                // mistakes, not every way of phrasing one.
                <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
                  This message talks about price or commitment. Compare it with your offer before sending.
                </p>
              ) : null}

              {item.opportunity && item.opportunity.reasons.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {item.opportunity.reasons.slice(0, 3).map((reason) => (
                    <li key={reason.label} className="flex gap-2 text-[13px] text-slate-600">
                      <span aria-hidden className="text-emerald-600">✓</span>
                      <span>{reason.label}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                {!isDm && !isForm && (
                  <p className="text-[13px] font-medium text-slate-900">
                    {item.outreach.generatedSubject || "(no subject)"}
                  </p>
                )}
                <p
                  className={cn(
                    "whitespace-pre-wrap text-[13px] leading-relaxed text-slate-600",
                    !isDm && !isForm && "mt-2",
                    !isOpen && "line-clamp-4"
                  )}
                >
                  {item.outreach.generatedBody || "(empty)"}
                </p>
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : id)}
                  aria-expanded={isOpen}
                  className="mt-2 flex items-center gap-1 text-[12px] font-medium text-slate-500 hover:text-slate-800"
                >
                  {isOpen ? "Show less" : "Read it all / edit"}
                  <ChevronDown className={cn("size-3.5 transition-transform", isOpen && "rotate-180")} />
                </button>
              </div>

              {isOpen && (
                <div className="mt-3 space-y-2">
                  {/* A DM or a form message has no subject line. */}
                  {!isDm && !isForm && (
                    <Input
                      value={edit.subject}
                      onChange={(e) => setEdits((p) => ({ ...p, [id]: { ...edit, subject: e.target.value } }))}
                      placeholder="Subject"
                    />
                  )}
                  <Textarea
                    value={edit.body}
                    onChange={(e) => setEdits((p) => ({ ...p, [id]: { ...edit, body: e.target.value } }))}
                    className="min-h-[200px] text-[13px] leading-relaxed"
                  />
                  {(isDm || isForm) && unsaved && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button size="sm" onClick={() => void act(id, () => persistEdits(item))} disabled={busy}>
                        {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                        Save changes
                      </Button>
                      <span className="text-[12px] text-slate-500">
                        {isDm ? "Your session types the saved text." : "The form is sent with the saved text."}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {isForm ? (
                <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                  <p className="text-[13px] text-slate-500">
                    {formSubmittable
                      ? "They publish no email address, but their site has a contact form. Approving posts this message through it."
                      : item.outreach.contactFormReason ??
                        "Their form needs a person — open it, paste the message and send it yourself."}
                  </p>

                  <div className="flex flex-wrap items-center gap-2">
                    {formSubmittable ? (
                      <Button onClick={() => void submitForm(item)} disabled={busy}>
                        {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                        Approve &amp; send through their form
                      </Button>
                    ) : (
                      <Button asChild>
                        <a href={item.outreach.contactFormUrl} target="_blank" rel="noopener noreferrer">
                          <FileText className="size-4" />
                          Open their form
                          <ExternalLink className="size-3.5" />
                        </a>
                      </Button>
                    )}

                    <Button variant="outline" onClick={() => copyAndSave(item, edit.body, unsaved)}>
                      <Copy className="size-4" />
                      {copied === id ? "Copied" : "Copy message"}
                    </Button>

                    {!formSubmittable && (
                      <Button
                        variant="outline"
                        onClick={() =>
                          void act(id, async () => {
                            await persistEdits(item);
                            await callMarkSocialDmSent(id);
                          })
                        }
                        disabled={busy}
                      >
                        <Check className="size-4" />
                        I sent it
                      </Button>
                    )}

                    <Button
                      variant="ghost"
                      onClick={() => void act(id, () => callRejectOutreach(id, "Rejected during review"))}
                      disabled={busy}
                      className="text-slate-500"
                    >
                      <X className="size-4" />
                      Not this one
                    </Button>

                    {item.company && (
                      <Link
                        href={`/app/companies/${item.company.id}`}
                        className="ml-auto text-[13px] text-slate-500 hover:text-slate-800 hover:underline"
                      >
                        View company
                      </Link>
                    )}
                  </div>
                </div>
              ) : isDm ? (
                <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                  <p className="text-[13px] text-slate-500">
                    They publish no email address.{" "}
                    {sessionNetworkNames.length > 0
                      ? `Your ${sessionNetworkNames.join(" or ")} session opens their profile and types this message; it is sent when you press Enter.`
                      : "Open their profile, paste this message and send it."}
                  </p>
                  {item.outreach.skippedAt && (
                    <p className="text-[12px] text-slate-400">
                      Skipped in your last session. It comes back in the session queue after 24 hours.
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    {profileLinks.map((link, index) => {
                      const Icon = link.network ? channelIcon(link.network) : ExternalLink;
                      const handle = displayHandle(link.handle, link.network);
                      return (
                        <Button key={link.url} asChild variant={index === 0 ? "default" : "outline"}>
                          <a href={link.url} target="_blank" rel="noopener noreferrer">
                            <Icon className="size-4" />
                            {link.network ? networkLabel(link.network) : "Open profile"}
                            {handle && <span className="font-normal opacity-80">{handle}</span>}
                            <ExternalLink className="size-3.5" />
                          </a>
                        </Button>
                      );
                    })}

                    <Button variant="outline" onClick={() => copyAndSave(item, edit.body, unsaved)}>
                      <Copy className="size-4" />
                      {copied === id ? "Copied" : "Copy message"}
                    </Button>

                    {sentActions.map((action) => (
                      <Button
                        key={action.network ?? "any"}
                        variant="outline"
                        onClick={() =>
                          void act(id, async () => {
                            // What is recorded as sent must be what was sent, on the network it went out on.
                            await persistEdits(item);
                            await callMarkSocialDmSent(id, action.network ?? undefined);
                          })
                        }
                        disabled={busy}
                      >
                        {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                        {action.label}
                      </Button>
                    ))}

                    <Button
                      variant="ghost"
                      onClick={() => void act(id, () => callRejectOutreach(id, "Rejected during review"))}
                      disabled={busy}
                      className="text-slate-500"
                    >
                      <X className="size-4" />
                      Not this one
                    </Button>

                    {item.company && (
                      <Link
                        href={`/app/companies/${item.company.id}`}
                        className="ml-auto text-[13px] text-slate-500 hover:text-slate-800 hover:underline"
                      >
                        View company
                      </Link>
                    )}
                  </div>
                  <p className="text-[12px] text-slate-400">
                    {sentActions.some((action) => action.network)
                      ? "Sent it by hand instead? Press the button for the network you used, so it is never sent twice and your inbox session on that network picks up their reply."
                      : "Sent it by hand instead? Press I sent it afterwards so it is never sent twice."}
                  </p>
                </div>
              ) : (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
                <Button
                  onClick={() =>
                    void act(id, async () => {
                      await persistEdits(item);
                      await callApproveOutreach(id);
                    })
                  }
                  disabled={busy}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  Approve
                </Button>

                <Button
                  variant="outline"
                  onClick={() =>
                    void act(id, async () => {
                      await persistEdits(item);
                      await callApproveOutreach(id);
                      await callSendApprovedOutreach(id);
                    })
                  }
                  disabled={busy}
                >
                  <Send className="size-4" />
                  Approve &amp; send now
                </Button>

                <Button
                  variant="ghost"
                  onClick={() => void act(id, () => callRejectOutreach(id, "Rejected during review"))}
                  disabled={busy}
                  className="text-slate-500"
                >
                  <X className="size-4" />
                  Not this one
                </Button>

                {item.company && (
                  <Link
                    href={`/app/companies/${item.company.id}`}
                    className="ml-auto text-[13px] text-slate-500 hover:text-slate-800 hover:underline"
                  >
                    View company
                  </Link>
                )}
              </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
