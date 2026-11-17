/**
 * A short-lived read cache in front of Firestore.
 *
 * Every screen is assembled from whole-collection reads — the funnel, the
 * activity feed, the attention list and the meeting list each want the company
 * list — and Firestore bills per document returned, not per query. Measured on
 * a real workspace of 123 companies: one visit to Home read the companies
 * collection four times, and moving between two pages read it eight. Daily
 * reads went from 101 to 73,922 while the number of prospects barely moved,
 * because the cost was tracking *browsing*, not work done.
 *
 * Two mechanisms, both keyed by an explicit string:
 *  - **In-flight de-duplication.** Concurrent callers asking for the same data
 *    share one network round trip. This is what collapses a single page load.
 *  - **A short TTL.** A repeat within the window is served from memory. This is
 *    what collapses navigation between pages.
 *
 * The TTL is deliberately short. Cached data that outlives the user's sense of
 * "I just did something" is worse than an extra read, so anything that changes
 * state calls `invalidateReadCache()` and the next screen reads fresh.
 */

const TTL_MS = 30_000;

interface Entry {
  at: number;
  value: Promise<unknown>;
}

const entries = new Map<string, Entry>();

/**
 * Returns the cached value for `key`, or runs `load` and caches it.
 *
 * A rejected load is evicted immediately so a transient failure is never
 * remembered as a result — the next caller retries rather than inheriting it.
 */
export function cachedRead<T>(key: string, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const existing = entries.get(key);

  if (existing && now - existing.at < TTL_MS) {
    return existing.value as Promise<T>;
  }

  const value = load().catch((error) => {
    entries.delete(key);
    throw error;
  });

  entries.set(key, { at: now, value });
  return value;
}

/**
 * Drops cached reads. Call after anything that writes — approving, sending,
 * launching a campaign — so the next screen reflects what just happened.
 *
 * `prefix` narrows the eviction; omitting it clears everything, which is the
 * right default when a business is switched or deleted.
 */
export function invalidateReadCache(prefix?: string): void {
  if (!prefix) {
    entries.clear();
    return;
  }
  for (const key of entries.keys()) {
    if (key.startsWith(prefix)) entries.delete(key);
  }
}

/** Test seam: the number of live cache entries. */
export function readCacheSize(): number {
  return entries.size;
}
