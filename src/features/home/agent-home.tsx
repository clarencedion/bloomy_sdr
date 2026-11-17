"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { collection, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { collections } from "@/lib/firebase/firestore";
import { useBusiness } from "@/lib/context/business-context";
import { useChangeSignal } from "@/lib/sdr/use-live";
import { invalidateReadCache } from "@/lib/sdr/query-cache";
import { callTranslateIcpPrompt } from "@/lib/firebase/functions";
import { getCallableErrorMessage } from "@/lib/firebase/functions";
import { getHomeSummary, type HomeSummary } from "@/lib/sdr/aggregations";
import { launchCampaign } from "@/lib/sdr/launch-campaign";
import { CampaignPlanReview, type PlanOverrides } from "@/features/sdr/campaign-plan-review";
import { OutcomeSummary } from "@/features/sdr/journey";
import type { IcpTranslationResult } from "@/types/domain";

function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * Starter ideas shown to a brand-new account. They are plain sentences, not
 * application logic: each one simply pre-fills the description box.
 */
const QUICK_STARTS = [
  { emoji: "🌸", text: "Independent florists in France whose website could be much better" },
  { emoji: "💇", text: "Beauty salons with no online booking" },
  { emoji: "🛍", text: "Independent retailers with no online store" },
  { emoji: "📈", text: "French SMEs with an established sales team that could need sales training" }
];

export function AgentHome() {
  const router = useRouter();
  const { currentBusinessId, workspaceId, businesses, offers, switchBusiness, loading } = useBusiness();

  const [prompt, setPrompt] = useState("");
  const [offerId, setOfferId] = useState("");
  const [plan, setPlan] = useState<IcpTranslationResult | null>(null);
  const [thinking, setThinking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [summary, setSummary] = useState<HomeSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);

  const scope = useMemo(
    () => ({ workspaceId: workspaceId || "ws_default", businessId: currentBusinessId || undefined }),
    [workspaceId, currentBusinessId]
  );

  useEffect(() => {
    if (offers.length && !offers.some((offer) => offer.id === offerId)) {
      setOfferId(offers[0].id);
    }
  }, [offers, offerId]);

  const refresh = useCallback(async (silent = false) => {
    // A live update must never blank the roll-up it is updating.
    if (!silent) setLoadingSummary(true);
    try {
      setSummary(await getHomeSummary(scope));
    } catch (err) {
      console.error("Failed to load home summary", err);
    } finally {
      setLoadingSummary(false);
    }
  }, [scope]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live while the SDR works, without polling: a listener bills the documents
  // that actually change, where a timer re-read the whole scope on every tick.
  const changed = useChangeSignal(
    () => query(collection(db, collections.companies), where("workspaceId", "==", scope.workspaceId)),
    `page-companies:${scope.workspaceId}`
  );

  useEffect(() => {
    if (changed === 0) return;
    invalidateReadCache();
    void refresh(true);
  }, [changed, refresh]);

  const handleUnderstand = async () => {
    if (prompt.trim().length < 3) {
      setError("Tell your SDR a little more about who you want to reach.");
      return;
    }
    setError(null);
    setThinking(true);
    try {
      const result = await callTranslateIcpPrompt({
        prompt: prompt.trim(),
        offerId: offerId || undefined,
        workspaceId: workspaceId || "ws_default",
        businessId: currentBusinessId || undefined
      });
      setPlan(result);
    } catch (err) {
      setError(getCallableErrorMessage(err, "Your SDR could not read that description. Try rephrasing it."));
    } finally {
      setThinking(false);
    }
  };

  const handleStart = async (overrides: PlanOverrides) => {
    if (!plan) return;
    if (!currentBusinessId) {
      setError("Choose a business before starting a campaign.");
      return;
    }

    setStarting(true);
    setError(null);
    try {
      const result = await launchCampaign({
        plan,
        prompt,
        workspaceId: workspaceId || "ws_default",
        businessId: currentBusinessId,
        offerId: offerId || undefined,
        overrides
      });

      if (!result.started) {
        // The campaign was saved but its first search did not start. Say so
        // rather than dropping the user on a page that will sit at zero.
        setError(
          `${result.startError ?? "Your SDR could not start searching yet."} The campaign is saved — open it to try again.`
        );
        setStarting(false);
        return;
      }

      router.push(`/app/campaigns/${result.campaignId}`);
    } catch (err) {
      setError(getCallableErrorMessage(err, "Could not start the campaign."));
      setStarting(false);
    }
  };

  const activeCampaigns = summary?.activeCampaigns ?? 0;
  const hasHistory = (summary?.totalCampaigns ?? 0) > 0;

  if (plan) {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <CampaignPlanReview
          plan={plan}
          onBack={() => {
            setPlan(null);
            setError(null);
          }}
          onStart={handleStart}
          starting={starting}
          error={error}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-10 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{greeting()} 👋</h1>
        <p className="mt-2 text-[15px] text-slate-500">What do you want meetings for?</p>
      </div>

      <div className="space-y-4">
        <Textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Sell websites to independent florists in France whose digital presence could be improved."
          className="min-h-[132px] resize-none rounded-xl border-slate-200 p-4 text-[15px] leading-relaxed shadow-sm focus-visible:ring-slate-900"
          aria-label="Describe who you want meetings with"
        />

        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex-1 space-y-1.5">
            <label className="text-[12px] font-medium text-slate-500">Business</label>
            <Select value={currentBusinessId} onValueChange={switchBusiness} disabled={loading}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a business" />
              </SelectTrigger>
              <SelectContent>
                {businesses.map((business) => (
                  <SelectItem key={business.id} value={business.id}>
                    {business.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 space-y-1.5">
            <label className="text-[12px] font-medium text-slate-500">Offer</label>
            <Select value={offerId} onValueChange={setOfferId} disabled={offers.length === 0}>
              <SelectTrigger>
                <SelectValue placeholder={offers.length ? "Choose an offer" : "No offer yet"} />
              </SelectTrigger>
              <SelectContent>
                {offers.map((offer) => (
                  <SelectItem key={offer.id} value={offer.id}>
                    {offer.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {error && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>
        )}

        <Button size="lg" className="w-full sm:w-auto" onClick={handleUnderstand} disabled={thinking}>
          {thinking ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {thinking ? "Thinking…" : "Find customers"}
        </Button>
      </div>

      {!hasHistory && (
        <div>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Quick starts</p>
          <div className="space-y-2">
            {QUICK_STARTS.map((quick) => (
              <button
                key={quick.text}
                type="button"
                onClick={() => setPrompt(quick.text)}
                className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-[14px] text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
              >
                <span aria-hidden>{quick.emoji}</span>
                <span className="min-w-0 flex-1">{quick.text}</span>
                <ArrowRight className="size-4 shrink-0 text-slate-300" />
              </button>
            ))}
          </div>
        </div>
      )}

      {hasHistory && summary && !loadingSummary && (
        <div className="space-y-4 border-t border-slate-100 pt-8">
          <div className="flex items-center justify-between">
            <p className="text-[13px] text-slate-500">
              {activeCampaigns > 0 ? (
                <>
                  Your SDR is working on{" "}
                  <span className="font-medium text-slate-800">
                    {activeCampaigns} {activeCampaigns === 1 ? "campaign" : "campaigns"}
                  </span>
                  .
                </>
              ) : (
                "No campaign is running right now."
              )}
            </p>
            <div className="flex shrink-0 items-center gap-4">
              <Link href="/app/brain" className="text-[13px] font-medium text-slate-500 hover:text-slate-700 hover:underline">
                Live view
              </Link>
              <Link href="/app/campaigns" className="text-[13px] font-medium text-slate-700 hover:underline">
                View all
              </Link>
            </div>
          </div>

          <OutcomeSummary
            funnel={summary.funnel}
            needsAttention={summary.needsAttention}
            upcomingMeetings={summary.upcomingMeetings}
          />
        </div>
      )}
    </div>
  );
}
