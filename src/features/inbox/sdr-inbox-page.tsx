"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Inbox, Loader2, RefreshCw } from "lucide-react";
import type { Company, ConversationDoc } from "@/types/firestore";
import { useBusiness } from "@/lib/context/business-context";
import { listCompanies, listInboxConversations } from "@/lib/firebase/firestore";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  INBOX_FILTERS,
  conversationStateLabel,
  countByFilter,
  matchesFilter,
  needsAttention,
  recommendedAction,
  unconfirmedSendDetail,
  type InboxFilterId
} from "@/lib/sdr/inbox-filters";
import { attentionReason } from "@/lib/sdr/aggregations";
import { channelIcon, displayHandle, networkLabel, socialNetworkOf } from "@/lib/sdr/channel";
import { ConversationThreadView } from "./conversation-thread-view";
import { ProspectDossierPanel } from "./prospect-dossier-panel";

/**
 * The Inbox surfaces only conversations that mean something to the user.
 * "Needs attention" is the default, so an empty screen is the healthy state:
 * it means the SDR is handling everything itself.
 */
export function SdrInboxPage() {
  const { currentBusiness, workspaceId } = useBusiness();
  const [conversations, setConversations] = useState<ConversationDoc[]>([]);
  const [companyNames, setCompanyNames] = useState<Map<string, string>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<InboxFilterId>("needs_attention");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [conversationList, companies] = await Promise.all([
        listInboxConversations(workspaceId || "ws_default", currentBusiness?.id),
        listCompanies()
      ]);
      setConversations(conversationList);
      setCompanyNames(new Map((companies as Company[]).map((company) => [company.id, company.name])));
    } catch (error) {
      console.error("Failed to load conversations", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentBusiness?.id, workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const counts = useMemo(() => countByFilter(conversations), [conversations]);

  const visible = useMemo(
    () => conversations.filter((conversation) => matchesFilter(conversation, filter)),
    [conversations, filter]
  );

  // Keep a valid selection as the filter changes.
  useEffect(() => {
    setSelectedId((current) => {
      if (current && visible.some((conversation) => conversation.id === current)) return current;
      return visible[0]?.id ?? null;
    });
  }, [visible]);

  const selected = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) ?? null,
    [conversations, selectedId]
  );

  // The company list is capped, so the name stored on the conversation wins.
  const nameFor = (conversation: ConversationDoc) =>
    conversation.companyName ?? companyNames.get(conversation.companyId) ?? "A prospect";

  const attentionCount = counts.needs_attention ?? 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="size-5 animate-spin text-slate-300" />
      </div>
    );
  }

  return (
    <div className="space-y-6 py-2">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Inbox</h1>
          <p className="mt-1.5 text-[13px] text-slate-500">
            {attentionCount > 0
              ? `${attentionCount} ${attentionCount === 1 ? "conversation needs" : "conversations need"} your attention.`
              : "Your SDR is handling every conversation."}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing}>
          <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {INBOX_FILTERS.map((item) => {
          const active = filter === item.id;
          const count = counts[item.id] ?? 0;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              aria-pressed={active}
              className={cn(
                "flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                active
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              )}
            >
              <span aria-hidden>{item.emoji}</span>
              {item.label}
              {count > 0 && (
                <span className={cn("tabular-nums", active ? "text-white/70" : "text-slate-400")}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-20 text-center">
          <Inbox className="mx-auto size-7 text-slate-300" />
          <p className="mt-4 text-[15px] font-medium text-slate-700">
            {filter === "needs_attention" ? "Nothing needs you right now." : "No conversations here yet."}
          </p>
          <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-slate-500">
            {filter === "needs_attention"
              ? "Your SDR will bring a conversation here the moment it needs a human decision."
              : "Conversations appear as prospects reply to your SDR."}
          </p>
          <Link
            href="/app/campaigns"
            className="mt-5 inline-block text-[13px] font-medium text-slate-700 hover:underline"
          >
            See what your SDR is working on
          </Link>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_300px]">
          <div className="space-y-2 lg:max-h-[calc(100vh-260px)] lg:overflow-y-auto lg:pr-1">
            {visible.map((conversation) => {
              const active = conversation.id === selectedId;
              const urgent = needsAttention(conversation);
              const recommendation = recommendedAction(conversation);
              const network = socialNetworkOf(conversation);
              const NetworkIcon = network ? channelIcon(network) : null;
              const handle = displayHandle(conversation.socialHandle, network);

              return (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => setSelectedId(conversation.id)}
                  className={cn(
                    "w-full rounded-xl border p-4 text-left transition-colors",
                    active
                      ? "border-slate-900 bg-white"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="truncate font-medium text-slate-900">{nameFor(conversation)}</span>
                    {urgent && <span aria-label="Needs attention">🔥</span>}
                  </div>
                  {network && NetworkIcon && (
                    <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] text-slate-500">
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                        <NetworkIcon className="size-3" aria-hidden />
                        {networkLabel(network)}
                      </span>
                      {handle && <span className="truncate">{handle}</span>}
                    </div>
                  )}
                  <p
                    className={cn(
                      "mt-1 text-[12px] font-medium",
                      urgent ? "text-amber-700" : "text-slate-500"
                    )}
                  >
                    {conversationStateLabel(conversation)}
                  </p>
                  {urgent && (
                    <p className="mt-2 text-[13px] leading-snug text-slate-600">
                      {unconfirmedSendDetail(conversation) ?? attentionReason(conversation)}
                    </p>
                  )}
                  {!urgent && recommendation && (
                    <p className="mt-2 text-[13px] leading-snug text-slate-500">{recommendation}</p>
                  )}
                </button>
              );
            })}
          </div>

          {selected && (
            <>
              <ConversationThreadView conversation={selected} onRefresh={refresh} />
              <div className="hidden xl:block">
                <ProspectDossierPanel conversation={selected} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
