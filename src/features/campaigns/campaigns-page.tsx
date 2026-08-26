"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadingSkeleton } from "@/components/common/loading-skeleton";
import { useBusiness } from "@/lib/context/business-context";
import { getCampaignFunnels, listCampaigns, type CampaignFunnel } from "@/lib/sdr/aggregations";
import type { DiscoveryCampaign } from "@/types/firestore";
import { cn } from "@/lib/utils";

interface CampaignCard {
  campaign: DiscoveryCampaign;
  funnel: CampaignFunnel;
}

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  active: { label: "Running", className: "bg-emerald-50 text-emerald-700" },
  paused: { label: "Paused", className: "bg-amber-50 text-amber-700" },
  draft: { label: "Not started", className: "bg-slate-100 text-slate-600" },
  completed: { label: "Finished", className: "bg-slate-100 text-slate-600" },
  archived: { label: "Archived", className: "bg-slate-100 text-slate-500" }
};

export function CampaignsPage() {
  const { workspaceId, currentBusinessId } = useBusiness();
  const [cards, setCards] = useState<CampaignCard[]>([]);
  const [loading, setLoading] = useState(true);

  const scope = useMemo(
    () => ({ workspaceId: workspaceId || "ws_default", businessId: currentBusinessId || undefined }),
    [workspaceId, currentBusinessId]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const campaigns = (await listCampaigns(scope)).filter((campaign) => campaign.status !== "archived");
      const funnels = await getCampaignFunnels(scope, campaigns);
      setCards(
        campaigns.map((campaign) => ({
          campaign,
          funnel:
            funnels.get(campaign.id) ??
            { found: 0, qualified: 0, peopleFound: 0, contacted: 0, replies: 0, meetings: 0 }
        }))
      );
    } catch (error) {
      console.error("Failed to load campaigns", error);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading) return <LoadingSkeleton />;

  if (cards.length === 0) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <h1 className="text-xl font-semibold text-slate-900">No active campaigns yet.</h1>
        <p className="mx-auto mt-3 max-w-sm text-[15px] leading-relaxed text-slate-500">
          Example: &ldquo;Find French retailers that could benefit from an online store.&rdquo;
        </p>
        <Button asChild size="lg" className="mt-6">
          <Link href="/app/home">
            <Plus className="size-4" />
            Start a campaign
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 py-2">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Campaigns</h1>
        <Button asChild>
          <Link href="/app/home">
            <Plus className="size-4" />
            New campaign
          </Link>
        </Button>
      </div>

      <div className="space-y-3">
        {cards.map(({ campaign, funnel }) => {
          const status = STATUS_LABEL[campaign.status] ?? STATUS_LABEL.draft;

          return (
            <Link
              key={campaign.id}
              href={`/app/campaigns/${campaign.id}`}
              className="block rounded-xl border border-slate-200 bg-white p-5 transition-colors hover:border-slate-300"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="truncate font-semibold text-slate-900">{campaign.name}</h2>
                  <span
                    className={cn(
                      "mt-2 inline-block rounded-full px-2 py-0.5 text-[12px] font-medium",
                      status.className
                    )}
                  >
                    {status.label}
                  </span>
                </div>
                <ArrowRight className="mt-1 size-4 shrink-0 text-slate-300" />
              </div>

              <div className="mt-5 grid grid-cols-3 gap-4 sm:grid-cols-6">
                {[
                  { label: "found", value: funnel.found },
                  { label: "opportunities", value: funnel.qualified },
                  { label: "people", value: funnel.peopleFound },
                  { label: "contacted", value: funnel.contacted },
                  { label: "replies", value: funnel.replies },
                  { label: "meetings", value: funnel.meetings, highlight: true }
                ].map((stat) => (
                  <div key={stat.label}>
                    <div
                      className={cn(
                        "text-lg font-semibold tabular-nums",
                        stat.highlight ? "text-emerald-600" : "text-slate-900"
                      )}
                    >
                      {stat.value}
                    </div>
                    <div className="text-[12px] text-slate-500">{stat.label}</div>
                  </div>
                ))}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
