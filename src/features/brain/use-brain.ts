"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type QueryConstraint
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { collections } from "@/lib/firebase/firestore";
import { callGetCostSummary, callGetQueueHealth } from "@/lib/firebase/functions";
import {
  BRAIN_MAX_COMPANY_LOOKUPS,
  activityHorizon,
  brainCountQueries,
  buildBrainKpis,
  companyBelongsToScope,
  computeAgentStates,
  diffPulses,
  pickLiveSocialSession,
  planCompanyLookups,
  scopeBrainLogs,
  socialSessionHealth,
  toBrainEvents,
  toBrainLog,
  toBrainQueue,
  toBrainSpend,
  type BrainCounts,
  type BrainHealth,
  type BrainLog,
  type BrainPulse,
  type BrainScope,
  type BrainSnapshot,
  type CompanyNameResolver,
  type CompanyOwnership,
  type LiveSocialSession,
  type RawSocialSession
} from "@/lib/sdr/brain-model";

/**
 * Live data for the Brain page.
 *
 * Firestore reads are the dominant cost and scale with browsing (State & Cost
 * Contract 3), so this hook never reads a whole collection:
 * - ONE listener on `logs` (workspace, newest 60) feeds agents, events and
 *   pulses. A listener bills its first read, then only documents that change.
 * - KPIs are `getCountFromServer` aggregations with equality filters, at most
 *   once a minute. The running social session is one equality query (limit 5).
 * - Queue and spend come from the backend callables, at most every two minutes.
 * - Company names are read one document at a time, only for companies that
 *   appear in the current log window (each once, then cached; 30 at a time).
 * Everything stops when the tab is hidden or the page unmounts.
 */

const SOCIAL_SESSIONS = "socialSessions";
const LOG_WINDOW = 60;
const COUNTS_EVERY_MS = 60_000;
const HEALTH_EVERY_MS = 120_000;
/** Re-derives "active in the last 10 minutes" without reading anything. */
const CLOCK_EVERY_MS = 15_000;
const LISTENER_RETRY_MS = 60_000;
/** A company read that failed is retried after this long, not on every snapshot. */
const LOOKUP_RETRY_MS = 5 * 60_000;
const MAX_SEEN_IDS = 1_000;
const MAX_COMPANY_CACHE = 500;
/** Pulses kept for the view, newest first; each id is a log id and never repeats. */
const PULSE_BUFFER = 24;

type CompanyEntry =
  | { state: "pending" }
  | { state: "known"; owned: boolean; name?: string }
  | { state: "failed"; at: number };

interface SocialRead {
  session: LiveSocialSession | null;
  stampedCount: number | null;
}

interface BrainData {
  key: string;
  /** `null` until the listener has delivered once. */
  logs: BrainLog[] | null;
  /** The listener returned a full window (`LOG_WINDOW` rows, before any was dropped). */
  windowFull: boolean;
  logsFailed: boolean;
  connected: boolean;
  /** `null` until the first count batch has settled. */
  counts: BrainCounts | null;
  queue: BrainHealth["queue"];
  spend: BrainHealth["spend"];
  /** `undefined` while loading or when it could not be read. */
  social: SocialRead | undefined;
  updatedAt: number | null;
}

/** Per-scope memory that must not trigger renders. Replaced on a scope switch. */
interface ScopeMemory {
  key: string;
  /** Log ids already seen; `null` until the first snapshot (no pulses on load). */
  seen: Set<string> | null;
  companies: Map<string, CompanyEntry>;
  /** Serialises snapshot processing so pulses stay in order. */
  chain: Promise<void>;
  lastCountsAt: number;
  lastHealthAt: number;
}

function emptyData(key: string): BrainData {
  return {
    key,
    logs: null,
    windowFull: false,
    logsFailed: false,
    connected: false,
    counts: null,
    queue: undefined,
    spend: undefined,
    social: undefined,
    updatedAt: null
  };
}

function newMemory(key: string): ScopeMemory {
  return { key, seen: null, companies: new Map(), chain: Promise.resolve(), lastCountsAt: 0, lastHealthAt: 0 };
}

function ownershipOf(companies: ReadonlyMap<string, CompanyEntry>): CompanyOwnership {
  return (companyId) => {
    const entry = companies.get(companyId);
    return entry?.state === "known" ? entry.owned : undefined;
  };
}

function namesOf(companies: ReadonlyMap<string, CompanyEntry>): CompanyNameResolver {
  return (companyId) => {
    const entry = companies.get(companyId);
    return entry?.state === "known" && entry.owned ? entry.name : undefined;
  };
}

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");

  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  return visible;
}

/**
 * Runs `task` every `periodMs`, but never sooner than `periodMs` after its last
 * run — so hiding and showing the tab does not trigger an extra read.
 */
function every(task: () => void, periodMs: number, lastRun: () => number, markRun: () => void): () => void {
  let interval: ReturnType<typeof setInterval> | undefined;
  const run = () => {
    markRun();
    task();
  };
  const timeout = setTimeout(() => {
    run();
    interval = setInterval(run, periodMs);
  }, Math.max(0, lastRun() + periodMs - Date.now()));

  return () => {
    clearTimeout(timeout);
    if (interval) clearInterval(interval);
  };
}

async function readCounts(scope: BrainScope): Promise<BrainCounts> {
  const entries = await Promise.all(
    brainCountQueries(scope).map(async (spec) => {
      try {
        const snapshot = await getCountFromServer(
          query(collection(db, spec.collection), ...spec.equals.map(([field, value]) => where(field, "==", value)))
        );
        return [spec.key, snapshot.data().count] as const;
      } catch {
        // One unreadable count renders "—"; it never becomes zero.
        return [spec.key, null] as const;
      }
    })
  );
  return Object.fromEntries(entries) as BrainCounts;
}

async function readSocialSession(scope: BrainScope): Promise<SocialRead | undefined> {
  try {
    const constraints: QueryConstraint[] = [where("workspaceId", "==", scope.workspaceId)];
    if (scope.businessId) constraints.push(where("businessId", "==", scope.businessId));
    constraints.push(where("status", "==", "running"), limit(5));

    const snapshot = await getDocs(query(collection(db, SOCIAL_SESSIONS), ...constraints));
    const sessions = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as RawSocialSession);
    const session = pickLiveSocialSession(sessions, scope, new Date());
    if (!session) return { session: null, stampedCount: null };

    // The session document only gets its total when it ends; while it runs,
    // the outreach it sent is stamped with its id.
    const stampedCount = await getCountFromServer(
      query(
        collection(db, collections.outreach),
        where("workspaceId", "==", scope.workspaceId),
        where("socialSessionId", "==", session.id)
      )
    )
      .then((result) => result.data().count)
      .catch(() => null);

    return { session, stampedCount };
  } catch {
    return undefined;
  }
}

async function readHealth(scope: BrainScope): Promise<Pick<BrainData, "queue" | "spend">> {
  const input = { workspaceId: scope.workspaceId, businessId: scope.businessId };
  let queue: BrainHealth["queue"] = null;
  let spend: BrainHealth["spend"] = null;

  try {
    // The queue summary already carries today's spend and cap.
    const summary = await callGetQueueHealth(input);
    queue = toBrainQueue(summary);
    spend = toBrainSpend(summary);
  } catch {
    queue = null;
  }

  if (spend === null) {
    try {
      spend = toBrainSpend(await callGetCostSummary(input));
    } catch {
      spend = null;
    }
  }

  return { queue, spend };
}

/**
 * Reads every company named in the log window that is not known yet, to
 * settle whether each belongs to the scope and what it is called. The window
 * holds at most 60 logs, so this is at most 60 reads, 30 at a time; each id is
 * read once and cached. Every batch is read before returning, so no log stays
 * hidden until the next one arrives. Returns whether anything changed.
 */
async function resolveCompanies(memory: ScopeMemory, logs: BrainLog[], scope: BrainScope): Promise<boolean> {
  const now = Date.now();
  const isKnown = (companyId: string) => {
    const entry = memory.companies.get(companyId);
    if (!entry) return false;
    return entry.state !== "failed" || now - entry.at < LOOKUP_RETRY_MS;
  };

  const batches = planCompanyLookups(logs, scope, isKnown, BRAIN_MAX_COMPANY_LOOKUPS);
  if (!batches.length) return false;
  for (const id of batches.flat()) memory.companies.set(id, { state: "pending" });

  for (const ids of batches) {
    await Promise.all(
      ids.map(async (id) => {
        try {
          const snapshot = await getDoc(doc(db, collections.companies, id));
          const company = snapshot.exists()
            ? (snapshot.data() as { workspaceId?: unknown; businessId?: unknown; name?: unknown })
            : null;
          const owned = companyBelongsToScope(company, scope);
          memory.companies.set(id, {
            state: "known",
            owned,
            // Another tenant's company name is never kept.
            name: owned && typeof company?.name === "string" && company.name.trim() ? company.name.trim() : undefined
          });
        } catch {
          memory.companies.set(id, { state: "failed", at: Date.now() });
        }
      })
    );
  }

  if (memory.companies.size > MAX_COMPANY_CACHE) {
    const inWindow = new Set(logs.map((log) => log.metadata?.companyId).filter((id): id is string => typeof id === "string"));
    for (const id of memory.companies.keys()) {
      if (!inWindow.has(id)) memory.companies.delete(id);
    }
  }

  return true;
}

export function useBrain(scope: { workspaceId: string; businessId?: string }): {
  snapshot: BrainSnapshot | null;
  pulses: BrainPulse[];
  error: string | null;
} {
  const workspaceId = scope.workspaceId;
  const businessId = scope.businessId || undefined;
  // An empty workspace keeps the hook idle (the business list is still loading).
  const key = workspaceId ? `${workspaceId}::${businessId ?? ""}` : "";
  const visible = usePageVisible();

  const [data, setData] = useState<BrainData>(() => emptyData(key));
  const [pulses, setPulses] = useState<BrainPulse[]>([]);
  const [companies, setCompanies] = useState<ReadonlyMap<string, CompanyEntry>>(() => new Map());
  const [clock, setClock] = useState(() => Date.now());
  const memory = useRef<ScopeMemory>(newMemory(key));

  // A business switch starts from nothing: no figure, event or pulse of the
  // previous scope may survive into the new one.
  useEffect(() => {
    memory.current = newMemory(key);
    setData(emptyData(key));
    setPulses([]);
    setCompanies(new Map());
  }, [key]);

  useEffect(() => {
    if (!key || !visible) return;

    const mem = memory.current;
    if (mem.key !== key) return;
    const brainScope: BrainScope = { workspaceId, businessId };
    const isCurrent = () => memory.current === mem;
    const update = (patch: (prev: BrainData) => Partial<BrainData>) =>
      setData((prev) => (prev.key === key ? { ...prev, ...patch(prev) } : prev));

    // ── Activity: one listener on the newest 60 logs of the workspace ──────
    let unsubscribe: (() => void) | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;

    /**
     * `armed` is false until this subscription has delivered once from the
     * server. Until then nothing pulses: logs written while the tab was hidden
     * (or before a cached first delivery) are history, not live activity.
     */
    const onLogs = (logs: BrainLog[], windowFull: boolean, connected: boolean, armed: boolean) => {
      if (!isCurrent()) return;
      const known = mem.seen;
      const previous = armed ? known : null;
      const seen = new Set(known ?? []);
      for (const log of logs) seen.add(log.id);
      // Bounded: the window is 60 logs, so the oldest ids can be forgotten.
      mem.seen = seen.size > MAX_SEEN_IDS ? new Set([...seen].slice(-MAX_SEEN_IDS)) : seen;

      update(() => ({ logs, windowFull, logsFailed: false, connected, updatedAt: Date.now() }));

      mem.chain = mem.chain
        .then(async () => {
          const changed = await resolveCompanies(mem, logs, brainScope);
          if (!isCurrent()) return;
          if (changed) setCompanies(new Map(mem.companies));
          // First delivery of this subscription: no pulses.
          if (previous === null) return;
          const scoped = scopeBrainLogs(logs, brainScope, ownershipOf(mem.companies));
          // Stamped with this client's clock: freshness never depends on server time.
          const receivedAt = new Date();
          const batch = diffPulses(previous, scoped, namesOf(mem.companies)).map((pulse) => ({ ...pulse, receivedAt }));
          if (!batch.length) return;
          const ids = new Set(batch.map((pulse) => pulse.id));
          setPulses((prev) => [...batch, ...prev.filter((pulse) => !ids.has(pulse.id))].slice(0, PULSE_BUFFER));
        })
        .catch(() => undefined);
    };

    const subscribe = () => {
      let armed = false;
      unsubscribe = onSnapshot(
        query(
          collection(db, collections.logs),
          where("workspaceId", "==", workspaceId),
          orderBy("createdAt", "desc"),
          limit(LOG_WINDOW)
        ),
        { includeMetadataChanges: true },
        (snapshot) => {
          // Rows are untrusted (any signed-in client can write a log): a
          // malformed one is dropped here instead of crashing the page.
          const logs = snapshot.docs
            .map((entry) => toBrainLog(entry.id, entry.data({ serverTimestamps: "estimate" })))
            .filter((entry): entry is BrainLog => entry !== null);
          const fromServer = !snapshot.metadata.fromCache;
          onLogs(logs, snapshot.size >= LOG_WINDOW, fromServer, armed);
          if (fromServer) armed = true;
        },
        (error) => {
          // Surface, never render as "nothing happened" (State & Cost Contract 1).
          console.warn("Brain activity listener stopped", error.code);
          update(() => ({ logsFailed: true, connected: false }));
          unsubscribe = undefined;
          retry = setTimeout(subscribe, LISTENER_RETRY_MS);
        }
      );
    };
    subscribe();

    // ── KPIs and the running social session: counts, once a minute ────────
    const stopCounts = every(
      () => {
        void Promise.all([readCounts(brainScope), readSocialSession(brainScope)]).then(([counts, social]) => {
          if (!isCurrent()) return;
          update(() => ({ counts, social, updatedAt: Date.now() }));
        });
      },
      COUNTS_EVERY_MS,
      () => mem.lastCountsAt,
      () => {
        mem.lastCountsAt = Date.now();
      }
    );

    // ── Queue and spend: backend callables, every two minutes ─────────────
    const stopHealth = every(
      () => {
        void readHealth(brainScope).then((health) => {
          if (!isCurrent()) return;
          update(() => ({ ...health, updatedAt: Date.now() }));
        });
      },
      HEALTH_EVERY_MS,
      () => mem.lastHealthAt,
      () => {
        mem.lastHealthAt = Date.now();
      }
    );

    // ── Clock: agent states age out without any read ──────────────────────
    setClock(Date.now());
    const clockTimer = setInterval(() => setClock(Date.now()), CLOCK_EVERY_MS);

    return () => {
      unsubscribe?.();
      if (retry) clearTimeout(retry);
      stopCounts();
      stopHealth();
      clearInterval(clockTimer);
    };
  }, [key, visible, workspaceId, businessId]);

  const brainScope = useMemo<BrainScope>(() => ({ workspaceId, businessId }), [workspaceId, businessId]);

  const snapshot = useMemo<BrainSnapshot | null>(() => {
    if (!key || data.key !== key) return null;
    // Wait for activity (or its failure) and the first figures: a KPI shown
    // as "—" means "could not be read", not "still loading".
    if ((data.logs === null && !data.logsFailed) || data.counts === null) return null;

    const now = new Date(Math.max(clock, data.updatedAt ?? 0));
    const resolveCompany = namesOf(companies);
    const scoped = data.logs ? scopeBrainLogs(data.logs, brainScope, ownershipOf(companies)) : [];

    let socialSession: BrainHealth["socialSession"];
    if (data.social) {
      socialSession = data.social.session
        ? socialSessionHealth(data.social.session, data.social.stampedCount, scoped)
        : null;
    }

    return {
      // No activity could be read at all: no agent is shown as idle on the
      // strength of data that failed to load.
      agents: data.logs ? computeAgentStates(scoped, now, { resolveCompany }) : [],
      kpis: buildBrainKpis(data.counts, brainScope),
      health: { queue: data.queue, spend: data.spend, socialSession, queueAllBusinesses: Boolean(brainScope.businessId) },
      events: toBrainEvents(scoped, resolveCompany),
      updatedAt: new Date(data.updatedAt ?? clock),
      liveConnected: visible && data.connected && !data.logsFailed,
      // Cut on the raw window: a busy business can push this one's logs out.
      activitySince: data.logs ? activityHorizon(data.logs, data.windowFull) : undefined
    };
  }, [key, data, clock, companies, brainScope, visible]);

  const error = useMemo<string | null>(() => {
    if (!key || data.key !== key) return null;
    if (data.logsFailed) {
      return data.logs
        ? "Live updates are paused. Showing the last activity received."
        : "Live activity could not be loaded.";
    }
    const values = data.counts ? Object.values(data.counts) : [];
    if (values.length && values.every((value) => value === null)) return "The figures could not be loaded.";
    return null;
  }, [key, data]);

  return { snapshot, pulses: data.key === key ? pulses : [], error };
}
