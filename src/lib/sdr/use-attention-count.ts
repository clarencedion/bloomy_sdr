"use client";

import { useEffect, useState } from "react";
import { getUnreadHumanAttentionCount } from "@/lib/firebase/firestore";

/**
 * One shared poll for the "needs your attention" badge.
 *
 * The sidebar and the mobile nav are both mounted at all times (they are hidden
 * from each other by CSS, not unmounted), so without this they would each poll
 * independently and double the read cost of every session.
 */
const POLL_INTERVAL_MS = 30_000;

interface PollState {
  count: number;
  subscribers: Set<(count: number) => void>;
  timer: ReturnType<typeof setInterval> | null;
  key: string;
  inFlight: Promise<void> | null;
}

const state: PollState = { count: 0, subscribers: new Set(), timer: null, key: "", inFlight: null };

async function fetchCount(workspaceId: string, businessId?: string): Promise<void> {
  // Both navs subscribe at the same moment, so share the in-flight request
  // instead of issuing one read per subscriber.
  if (state.inFlight) return state.inFlight;

  state.inFlight = (async () => {
    try {
      const count = await getUnreadHumanAttentionCount(workspaceId, businessId);
      state.count = count;
      state.subscribers.forEach((notify) => notify(count));
    } catch {
      // Background poll: never surface an infrastructure error in the navigation.
    } finally {
      state.inFlight = null;
    }
  })();

  return state.inFlight;
}

export function useAttentionCount(workspaceId: string, businessId?: string): number {
  const [count, setCount] = useState(state.count);

  useEffect(() => {
    const key = `${workspaceId}::${businessId ?? ""}`;

    // Switching business invalidates the cached count.
    if (state.key !== key) {
      state.key = key;
      state.count = 0;
      setCount(0);
      state.inFlight = null;
      if (state.timer) {
        clearInterval(state.timer);
        state.timer = null;
      }
    }

    state.subscribers.add(setCount);
    void fetchCount(workspaceId, businessId);

    if (!state.timer) {
      state.timer = setInterval(() => void fetchCount(workspaceId, businessId), POLL_INTERVAL_MS);
    }

    return () => {
      state.subscribers.delete(setCount);
      if (state.subscribers.size === 0 && state.timer) {
        clearInterval(state.timer);
        state.timer = null;
      }
    };
  }, [workspaceId, businessId]);

  return count;
}
