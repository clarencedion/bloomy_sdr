"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { collections } from "@/lib/firebase/firestore";
import { invalidateReadCache } from "@/lib/sdr/query-cache";
import { cn } from "@/lib/utils";

type OutreachChannel = "email" | "social_dm" | "contact_form";

/**
 * Turns the non-email channels on for a campaign that is already running.
 *
 * Channels were only settable at launch, so every campaign created before they
 * existed carried none and resolved to email alone. On a live campaign that
 * left 39 companies — each with a website and no published email — failing
 * every day with "no contact found" while a channel that could have reached
 * them sat deployed and unreachable.
 *
 * Both switches are off by default and stay a deliberate choice: these messages
 * go somewhere more personal than an inbox, and that is the operator's call to
 * make, not a default to inherit.
 */
export function CampaignChannels({
  campaignId,
  channels,
  preferredChannel,
  onChanged
}: {
  campaignId: string;
  channels: string[] | undefined;
  /** "social_dm": write a DM whenever the prospect has a trusted profile, email or not. */
  preferredChannel?: string;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState<OutreachChannel | "prefer_dm" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enabled = (channel: OutreachChannel) => (channels ?? ["email"]).includes(channel);

  const toggle = async (channel: OutreachChannel) => {
    const current = new Set(channels ?? ["email"]);
    // Email is never removable: it is the channel every other one falls back from.
    current.add("email");
    if (current.has(channel)) current.delete(channel);
    else current.add(channel);

    setSaving(channel);
    setError(null);
    try {
      await updateDoc(doc(db, collections.discoveryCampaigns, campaignId), {
        channels: [...current],
        updatedAt: serverTimestamp()
      });
      invalidateReadCache();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that.");
    } finally {
      setSaving(null);
    }
  };

  const prefersDm = preferredChannel === "social_dm" && enabled("social_dm");
  const togglePreferDm = async () => {
    setSaving("prefer_dm");
    setError(null);
    try {
      await updateDoc(doc(db, collections.discoveryCampaigns, campaignId), {
        preferredChannel: prefersDm ? "email" : "social_dm",
        updatedAt: serverTimestamp()
      });
      invalidateReadCache();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that.");
    } finally {
      setSaving(null);
    }
  };

  const options: Array<{ id: OutreachChannel; title: string; detail: string }> = [
    {
      id: "social_dm",
      title: "Direct message",
      detail: "When they publish no email but have a public profile. You send it yourself."
    },
    {
      id: "contact_form",
      title: "Their contact form",
      detail: "When they publish no email but their site has a form. Sent after you approve."
    }
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="font-semibold text-slate-900">How this campaign reaches people</h2>
      <p className="mt-1 text-[13px] text-slate-500">
        Email is always on. These two only ever apply to companies with no email address at all.
      </p>

      {error && <p className="mt-3 text-[13px] text-rose-600">{error}</p>}

      <div className="mt-4 space-y-2">
        {options.map((option) => {
          const on = enabled(option.id);
          const busy = saving === option.id;

          return (
            <button
              key={option.id}
              type="button"
              role="switch"
              aria-checked={on}
              aria-label={option.title}
              disabled={busy}
              onClick={() => void toggle(option.id)}
              className="flex w-full items-center gap-3 rounded-lg border border-slate-200 p-3 text-left transition-colors hover:border-slate-300 disabled:opacity-60"
            >
              <span
                className={cn(
                  "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                  on ? "bg-slate-900" : "bg-slate-200"
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 size-4 rounded-full bg-white transition-all",
                    on ? "left-[18px]" : "left-0.5"
                  )}
                />
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-medium text-slate-900">{option.title}</span>
                <span className="block text-[13px] text-slate-500">{option.detail}</span>
              </span>
              {busy && <Loader2 className="ml-auto size-4 shrink-0 animate-spin text-slate-400" />}
            </button>
          );
        })}
        {enabled("social_dm") && (
          <button
            type="button"
            role="switch"
            aria-checked={prefersDm}
            aria-label="Prefer direct messages"
            disabled={saving === "prefer_dm"}
            onClick={() => void togglePreferDm()}
            className="flex w-full items-center gap-3 rounded-lg border border-slate-200 p-3 text-left transition-colors hover:border-slate-300 disabled:opacity-60"
          >
            <span className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", prefersDm ? "bg-slate-900" : "bg-slate-200")}>
              <span className={cn("absolute top-0.5 size-4 rounded-full bg-white transition-all", prefersDm ? "left-[18px]" : "left-0.5")} />
            </span>
            <span className="min-w-0">
              <span className="block text-[14px] font-medium text-slate-900">Prefer direct messages</span>
              <span className="block text-[13px] text-slate-500">
                Write a DM whenever the prospect has a verified profile, even if they publish an email.
              </span>
            </span>
            {saving === "prefer_dm" && <Loader2 className="ml-auto size-4 shrink-0 animate-spin text-slate-400" />}
          </button>
        )}
      </div>
    </div>
  );
}
