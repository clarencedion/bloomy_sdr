"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "framer-motion";
import { OctagonAlert, WifiOff } from "lucide-react";
import type { BrainAgentId, BrainAgentState, BrainPulse, BrainSnapshot } from "@/lib/sdr/brain-model";
import { cn } from "@/lib/utils";
import {
  activityCoverage,
  formatRelativeTime,
  isActivityUnavailable,
  statusAnnouncements,
  summarizeAgents,
  type AgentSummary
} from "./brain-format";
import { BrainEvents } from "./brain-events";
import { BrainGraph } from "./brain-graph";
import { BrainHealth } from "./brain-health";
import { BrainKpis } from "./brain-kpis";
import { Ping } from "./brain-meta";
import { EASE_OUT } from "./brain-motion";

export interface BrainViewProps {
  snapshot: BrainSnapshot | null;
  pulses: BrainPulse[];
  error: string | null;
}

/** Relative times refresh on a slow tick, paused while the tab is hidden. */
const CLOCK_TICK_MS = 15_000;

function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    const start = () => {
      stop();
      setNow(new Date());
      timer = setInterval(() => setNow(new Date()), intervalMs);
    };
    const onVisibility = () => (document.visibilityState === "hidden" ? stop() : start());
    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs]);
  return now;
}

/** Collected for this long before speaking, so a burst is one announcement. */
const ANNOUNCE_DEBOUNCE_MS = 2_000;
/** An agent is announced at most once in this window. */
const ANNOUNCE_AGENT_GAP_MS = 10_000;
/**
 * The region is emptied this long before new words are set. A live region
 * whose text does not change says nothing, so the same message twice in a
 * row ("Sending is now in error." again after a recovery) would be silent.
 */
const ANNOUNCE_CLEAR_MS = 150;

/**
 * Speaks (politely) when an agent enters error or warning. Routine changes
 * stay silent: the page is watched for hours, and a chatty live region would
 * be ignored, or worse, interrupt.
 */
function useStatusAnnouncer(agents: BrainAgentState[] | null): string {
  const previous = useRef<BrainAgentState[] | null>(null);
  const queued = useRef(new Map<BrainAgentId, string>());
  const spoken = useRef(new Map<BrainAgentId, number>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const speak = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [text, setText] = useState("");

  useEffect(() => {
    if (!agents) return;
    const messages = statusAnnouncements(previous.current, agents);
    previous.current = agents;
    if (messages.length === 0) return;
    for (const { agentId, message } of messages) queued.current.set(agentId, message);
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const at = Date.now();
      const said: string[] = [];
      for (const [agentId, message] of queued.current) {
        if (at - (spoken.current.get(agentId) ?? Number.NEGATIVE_INFINITY) < ANNOUNCE_AGENT_GAP_MS) continue;
        spoken.current.set(agentId, at);
        said.push(message);
      }
      queued.current.clear();
      if (!said.length) return;
      // Clear, then speak: every announcement is a change, even a repeated one.
      setText("");
      if (speak.current !== undefined) clearTimeout(speak.current);
      speak.current = setTimeout(() => setText(said.join(" ")), ANNOUNCE_CLEAR_MS);
    }, ANNOUNCE_DEBOUNCE_MS);
  }, [agents]);

  useEffect(
    () => () => {
      if (timer.current !== undefined) clearTimeout(timer.current);
      if (speak.current !== undefined) clearTimeout(speak.current);
    },
    []
  );

  return text;
}

type LiveState = "connecting" | "live" | "reconnecting";

const PILL = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium";
const LIVE_TEXT: Record<LiveState, string> = { live: "Live", reconnecting: "Reconnecting", connecting: "Connecting" };

/**
 * The connection state. One live region whose words change in place (a newly
 * inserted region is often not announced); the visible pill crossfades.
 */
function LivePill({ state }: { state: LiveState }) {
  return (
    <span role="status" className="relative inline-flex">
      <span className="sr-only">{LIVE_TEXT[state]}</span>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={state}
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.15 } }}
          exit={{ opacity: 0, transition: { duration: 0.15 } }}
          className={cn(
            PILL,
            state === "live" && "bg-emerald-50 text-emerald-700",
            state === "reconnecting" && "bg-amber-50 text-amber-700",
            state === "connecting" && "bg-slate-100 text-slate-600"
          )}
        >
          {state === "live" && (
            <span className="relative flex size-1.5">
              <Ping className="bg-emerald-500" />
              <span className="relative size-1.5 rounded-full bg-emerald-500" />
            </span>
          )}
          {state === "reconnecting" && <WifiOff className="size-3.5" />}
          {state === "connecting" && <span className="size-1.5 rounded-full bg-slate-400 motion-safe:animate-pulse" />}
          {LIVE_TEXT[state]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** Solid, always: the colour is the state. The only heartbeat on the page is the pings. */
function HeadlineDot({ tone }: { tone: AgentSummary["tone"] | "stalled" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full transition-colors duration-200",
        tone === "ok" ? "bg-emerald-500" : tone === "warn" ? "bg-amber-500" : tone === "error" ? "bg-rose-500" : "bg-slate-300"
      )}
    />
  );
}

/**
 * The Brain page: every agent of the SDR at work, on the app's own surfaces.
 *
 * Purely presentational: it renders the snapshot it is given and never reads
 * Firestore, so it can be driven by fixtures. Numbers it does not have render
 * as "—"; it never computes or invents one.
 */
export function BrainView({ snapshot, pulses, error }: BrainViewProps) {
  const reduceMotion = useReducedMotion() ?? false;
  const now = useNow(CLOCK_TICK_MS);
  const [selected, setSelected] = useState<BrainAgentId | null>(null);
  const [hoveredAgent, setHoveredAgent] = useState<BrainAgentId | null>(null);
  const clearSelected = useCallback(() => setSelected(null), []);

  // Activity could not be read at all: every activity figure renders "—", never 0.
  const activityUnavailable = isActivityUnavailable(snapshot);
  const activitySince = snapshot?.activitySince;
  const coverage = useMemo(() => activityCoverage(activitySince, now), [activitySince, now]);
  const summary = useMemo(() => (snapshot ? summarizeAgents(snapshot.agents, coverage) : null), [snapshot, coverage]);
  const stalled = !!error && !snapshot;
  const live = snapshot?.liveConnected === true;
  const liveState: LiveState = !snapshot ? (error ? "reconnecting" : "connecting") : live ? "live" : "reconnecting";
  const announcement = useStatusAnnouncer(snapshot ? snapshot.agents : null);

  // While reconnecting, the picture is the last one received: say so.
  const headline = summary
    ? snapshot && !live && !activityUnavailable
      ? `Last known: ${summary.headline}`
      : summary.headline
    : error
      ? "Not connected"
      : "Connecting to your SDR…";
  const headlineTone = summary ? (activityUnavailable ? "idle" : summary.tone) : "stalled";

  return (
    <MotionConfig reducedMotion="user">
      <div className="space-y-5 py-2 sm:space-y-6">
        <header className="min-w-0">
          <div className="flex flex-nowrap items-center justify-between gap-4">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Brain</h1>
            <div className="flex shrink-0 items-center gap-3">
              {/* While live the pill says it all; the age only matters once updates stop. */}
              {snapshot && !live && (
                <span className="hidden text-[12px] tabular-nums text-slate-400 sm:inline">
                  Last update {formatRelativeTime(snapshot.updatedAt, now)}
                </span>
              )}
              <LivePill state={liveState} />
            </div>
          </div>
          <p className="mt-1.5 flex min-w-0 items-center gap-2 text-[13px] text-slate-500">
            <HeadlineDot tone={headlineTone} />
            <span className="truncate">{headline}</span>
          </p>
        </header>

        <AnimatePresence initial={false}>
          {error && (
            <motion.div
              key="error"
              role="alert"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: EASE_OUT } }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
              className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm"
            >
              <OctagonAlert className="mt-0.5 size-4 shrink-0 text-rose-500" aria-hidden />
              <div className="min-w-0">
                <p className="font-medium text-rose-800">Part of the brain could not be loaded</p>
                <p className="mt-0.5 text-rose-700">{error}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <BrainKpis kpis={snapshot ? snapshot.kpis : null} stalled={stalled} />

        <BrainGraph
          agents={snapshot ? snapshot.agents : null}
          pulses={pulses}
          selected={selected}
          onSelect={setSelected}
          located={hoveredAgent}
          now={now}
          coverage={coverage}
          activitySince={activitySince}
          reduceMotion={reduceMotion}
          live={live}
          stalled={stalled}
          socialSession={snapshot?.health.socialSession}
          allIdle={summary?.tone === "idle" && !activityUnavailable}
        />

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px] xl:gap-6">
          <BrainEvents
            events={snapshot ? snapshot.events : null}
            unavailable={activityUnavailable}
            stalled={stalled}
            agents={snapshot?.agents ?? []}
            selected={selected}
            onClearSelected={clearSelected}
            onSelectAgent={setSelected}
            onHoverAgent={setHoveredAgent}
            now={now}
            reduceMotion={reduceMotion}
          />
          <BrainHealth health={snapshot ? snapshot.health : null} now={now} stalled={stalled} live={live} />
        </div>

        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>
      </div>
    </MotionConfig>
  );
}
