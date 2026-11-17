"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Pause, Play, RefreshCw } from "lucide-react";
import { collection, doc, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { collections } from "@/lib/firebase/firestore";
import { Button } from "@/components/ui/button";
import { LoadingSkeleton } from "@/components/common/loading-skeleton";
import { useBusiness } from "@/lib/context/business-context";
import { getCampaignOverview, type CampaignOverview as Overview } from "@/lib/sdr/aggregations";
import { ActivityFeed } from "@/features/sdr/activity-feed";
import { JourneyBars, JourneyStats } from "@/features/sdr/journey";
import { ProspectCard } from "@/features/sdr/prospect-card";
import { CampaignChannels } from "@/features/campaigns/campaign-channels";
import { useChangeSignal } from "@/lib/sdr/use-live";
import { invalidateReadCache } from "@/lib/sdr/query-cache";
import { cn } from "@/lib/utils";

export function CampaignOverview({ campaignId }: { campaignId: string }) {
  const { workspaceId, currentBusinessId } = useBusiness();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const scope = useMemo(
    () => ({ workspaceId: workspaceId || "ws_default", businessId: currentBusinessId || undefined }),
    [workspaceId, currentBusinessId]
  );

  const refresh = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        setOverview(await getCampaignOverview(campaignId, scope));
      } catch (error) {
        console.error("Failed to load campaign overview", error);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [campaignId, scope]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Keep the page live while the SDR works.
  //
  // This was a 30-second poll, which re-read roughly 250 documents every tick
  // whether or not anything had happened - about 30,000 reads an hour to watch
  // numbers that are usually still. A listener costs one read per document that
  // actually changes, so this is both cheaper and genuinely live: the funnel
  // moves as the SDR works instead of up to 30 seconds later.
  const changed = useChangeSignal(
    () => query(collection(db, collections.companies), where("workspaceId", "==", scope.workspaceId)),
    `campaign-companies:${scope.workspaceId}`
  );

  useEffect(() => {
    if (changed === 0) return;
    // The cached read must not serve the very numbers we just learned changed.
    invalidateReadCache();
    void refresh(true);
  }, [changed, refresh]);

  const toggleStatus = async () => {
    if (!overview?.campaign) return;
    const next = overview.campaign.status === "active" ? "paused" : "active";
    setUpdatingStatus(true);
    try {
      await updateDoc(doc(db, collections.discoveryCampaigns, campaignId), {
        status: next,
        updatedAt: serverTimestamp()
      });
      await refresh(true);
    } catch (error) {
      console.error("Failed to update campaign status", error);
    } finally {
      setUpdatingStatus(false);
    }
  };

  if (loading) return <LoadingSkeleton />;

  if (!overview?.campaign) {
    return (
      <div className="py-20 text-center">
        <p className="text-slate-500">This campaign no longer exists.</p>
        <Button asChild variant="ghost" className="mt-4">
          <Link href="/app/campaigns">
            <ArrowLeft className="size-4" />
            Back to campaigns
          </Link>
        </Button>
      </div>
    );
  }

  const { campaign, funnel, bestProspects, activity } = overview;
  const running = campaign.status === "active";

  return (
    <div className="space-y-10 py-2">
      <div>
        <Link
          href="/app/campaigns"
          className="inline-flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft className="size-3.5" />
          Campaigns
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{campaign.name}</h1>
            <div className="mt-2 flex items-center gap-2">
              <span
                className={cn(
                  "size-2 rounded-full",
                  running ? "animate-pulse bg-emerald-500" : "bg-slate-300"
                )}
              />
              <span className="text-[13px] text-slate-500">
                {running ? "Your SDR is working." : "Paused."}
              </span>
              {refreshing && <Loader2 className="size-3 animate-spin text-slate-300" />}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void refresh(true)} disabled={refreshing}>
              <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => void toggleStatus()} disabled={updatingStatus}>
              {running ? <Pause className="size-4" /> : <Play className="size-4" />}
              {running ? "Pause" : "Resume"}
            </Button>
          </div>
        </div>
      </div>

      <JourneyStats funnel={funnel} />

      <section>
        <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Journey</h2>
        <JourneyBars funnel={funnel} />
      </section>

      <section>
        <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Best opportunities
        </h2>
        {bestProspects.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">
            {running
              ? "Your SDR is still looking. Opportunities will appear here as they are found."
              : "No opportunities found yet."}
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {bestProspects.map((prospect) => (
              <ProspectCard key={prospect.company.id} prospect={prospect} />
            ))}
          </div>
        )}
      </section>

      <section>
        <CampaignChannels
          campaignId={campaignId}
          channels={(campaign as { channels?: string[] }).channels}
          preferredChannel={(campaign as { preferredChannel?: string }).preferredChannel}
          onChanged={() => void refresh(true)}
        />
      </section>

      <section>
        <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">SDR activity</h2>
        <ActivityFeed
          events={activity}
          emptyMessage={
            running ? "Your SDR has just started. Activity will appear here shortly." : "No activity yet."
          }
        />
      </section>
    </div>
  );
}
