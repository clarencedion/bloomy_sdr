"use client";

/**
 * The Agents card: a white app card holding the living map (or, on a phone,
 * the spine), a toolbar with the hour's activity in plain words, a note when
 * the figures need context, and the inspector of the selected agent.
 *
 * It owns the pulse → particle pipeline: pulses never seen before become one
 * particle each, capped at 16 in flight, and never replayed.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Info } from "lucide-react";
import type { BrainAgentId, BrainAgentState, BrainPulse } from "@/lib/sdr/brain-model";
import { cn } from "@/lib/utils";
import { BRAIN_FOCUS_ORDER, BRAIN_NEXT, CANVAS_PAD_X, canvasPadY, mapVariantForWidth } from "./brain-geometry";
import {
  FULL_COVERAGE,
  MAX_PARTICLES,
  admitParticles,
  agentErrorsText,
  coreActivityText,
  liveWindowNote,
  selectFreshPulses,
  type ActivityCoverage
} from "./brain-format";
import { BURST_STAGGER_S, EASE_OUT } from "./brain-motion";
import { AgentDetailFields, type SocialSession } from "./brain-agent-detail";
import { BrainMap, type ParticleKind, type ParticleSpec } from "./brain-map";
import { BrainSpine } from "./brain-spine";
import styles from "./brain.module.css";

interface BrainGraphProps {
  /** `null` while the first snapshot loads. `[]` when activity could not be read. */
  agents: BrainAgentState[] | null;
  pulses: BrainPulse[];
  selected: BrainAgentId | null;
  onSelect: (id: BrainAgentId | null) => void;
  /** An agent pointed at elsewhere (an activity row under the mouse): ringed on the map. */
  located?: BrainAgentId | null;
  now: Date;
  /** How far back the activity window reaches; hourly figures are floors when it is short. */
  coverage?: ActivityCoverage;
  activitySince?: Date;
  reduceMotion: boolean;
  /** The live feed is connected: only then do active agents breathe. */
  live: boolean;
  /** The first read failed: placeholders stop pulsing and show "—". */
  stalled: boolean;
  socialSession?: SocialSession | null;
  /** Every agent provably idle: point to where work starts. */
  allIdle: boolean;
}

const NO_PARTICLES: ParticleSpec[] = [];

function particleKind(pulse: BrainPulse): ParticleKind {
  if (pulse.tone !== "ok") return "alert";
  if (pulse.agentId === "meetings") return "outcome";
  if (pulse.agentId === "guardrails") return "check";
  return BRAIN_NEXT[pulse.agentId] ? "handoff" : "check";
}

/**
 * Turns new pulses into particles. State changes only when a burst arrives or a
 * particle lands; the flight itself runs on the Web Animations API.
 */
function useParticles(pulses: BrainPulse[], enabled: boolean) {
  const seen = useRef<Set<string>>(new Set());
  const [particles, setParticles] = useState<ParticleSpec[]>([]);

  useEffect(() => {
    const fresh = selectFreshPulses(pulses, seen.current, Date.now()).filter((pulse) =>
      BRAIN_FOCUS_ORDER.includes(pulse.agentId)
    );
    seen.current = new Set(pulses.map((pulse) => pulse.id));
    if (!enabled || fresh.length === 0) return;
    const specs: ParticleSpec[] = fresh.map((pulse, index) => ({
      id: pulse.id,
      agentId: pulse.agentId,
      tone: pulse.tone,
      kind: particleKind(pulse),
      delay: index * BURST_STAGGER_S
    }));
    setParticles((current) => admitParticles(current, specs, MAX_PARTICLES));
  }, [pulses, enabled]);

  // Particles in flight when the map was disabled (loading after a business
  // switch, reduced motion) are dropped, never replayed later.
  useEffect(() => {
    if (!enabled) setParticles((current) => (current.length ? NO_PARTICLES : current));
  }, [enabled]);

  const land = useCallback((id: string) => {
    setParticles((current) => current.filter((particle) => particle.id !== id));
  }, []);

  const dropAll = useCallback(() => {
    setParticles((current) => (current.length ? NO_PARTICLES : current));
  }, []);

  return { particles: enabled ? particles : NO_PARTICLES, land, dropAll };
}

/** The map's own width (card content − canvas padding), measured before first paint. */
function useMapWidth(ref: React.RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const read = (contentWidth: number) => setWidth(Math.max(0, Math.round(contentWidth - CANVAS_PAD_X * 2)));
    read(element.clientWidth);
    if (typeof window.ResizeObserver !== "function") return;
    const observer = new window.ResizeObserver((entries) => {
      const contentWidth = entries[0]?.contentRect.width;
      if (contentWidth) read(contentWidth);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function NoteBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 border-t border-slate-100 bg-slate-50 px-5 py-2.5 text-[12px] leading-5 text-slate-500">
      <Info className="mt-0.5 size-3.5 shrink-0 text-slate-400" aria-hidden />
      <p className="min-w-0">{children}</p>
    </div>
  );
}

export function BrainGraph({
  agents,
  pulses,
  selected,
  onSelect,
  located = null,
  now,
  coverage = FULL_COVERAGE,
  activitySince,
  reduceMotion,
  live,
  stalled,
  socialSession = null,
  allIdle
}: BrainGraphProps) {
  const titleId = useId();
  const inspectorId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  // Every agent's button (map node or phone row), so focus can be handed back to it.
  const buttons = useRef(new Map<BrainAgentId, HTMLButtonElement>());
  const mapWidth = useMapWidth(sectionRef);
  const variant = mapWidth === null ? null : mapVariantForWidth(mapWidth);
  const loading = agents === null;
  const unavailable = agents !== null && agents.length === 0;

  const agentsById = useMemo(() => new Map((agents ?? []).map((agent) => [agent.id, agent])), [agents]);
  // "…" loading, "— actions…" when activity could not be read, "N+ actions…" when the window is short.
  const activity = stalled && loading ? coreActivityText([], coverage) : coreActivityText(agents, coverage);
  const { particles, land, dropAll } = useParticles(pulses, !reduceMotion && !loading);

  // A new map size or a switch to the spine moves every route: drop work in flight.
  useEffect(() => {
    dropAll();
  }, [mapWidth, variant, dropAll]);

  // Escape clears the selection wherever focus is, unless it was meant for
  // something else: an open menu, dialog or listbox that handles it itself.
  useEffect(() => {
    if (!selected) return;
    const onKey = (event: { key: string; defaultPrevented: boolean; target: unknown }) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return;
      onSelect(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected, onSelect]);

  // Details that close while they hold focus (their ✕, Escape, a link inside)
  // would drop it on the page: hand it back to the agent it belonged to. The
  // closing details are still mounted here (they animate out), so the check is
  // reliable.
  const previousSelected = useRef(selected);
  useLayoutEffect(() => {
    const was = previousSelected.current;
    previousSelected.current = selected;
    if (!was || was === selected) return;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !sectionRef.current?.contains(active)) return;
    if (!active.closest("[data-brain-details]")) return;
    buttons.current.get(selected ?? was)?.focus();
  }, [selected]);

  const windowNote = liveWindowNote(activitySince, now);
  const note = unavailable ? (
    "Agent activity could not be read. The numbers above are still live."
  ) : !loading && !coverage.hour && windowNote ? (
    `Busy hour: the live window covers ${windowNote}, so rates are minimums.`
  ) : !loading && allIdle && coverage.recent ? (
    <>
      Agents work while a campaign is running.{" "}
      <Link href="/app/campaigns" className="font-medium text-slate-700 hover:underline">
        Open campaigns
      </Link>
    </>
  ) : null;

  const mapped = variant === "medium" || variant === "wide";
  const selectedAgent = selected ? agentsById.get(selected) : undefined;
  // The selected node's description: what the agent does and its errors, not
  // the inspector's buttons ("Open inbox Close details").
  const selectedAbout = selectedAgent
    ? [selectedAgent.role, agentErrorsText(selectedAgent.errorsLastHour, coverage.hour)].filter(Boolean).join(". ")
    : "";
  // The key explains blue only while blue can actually appear.
  // The key shows only when blue can actually appear: never on an all-idle board.
  const workCanMove = mapped && !loading && !unavailable && !stalled && !reduceMotion && live && !allIdle;
  // Reconnecting: the picture is the last one received, not a live one. It
  // recedes, so confident colours from minutes ago are not read as now.
  const stale = !loading && !live;
  const staleClass = cn(
    "transition-[opacity,filter] duration-300 ease-out",
    stale && "opacity-60 saturate-50"
  );

  return (
    <section
      ref={sectionRef}
      aria-labelledby={titleId}
      className="overflow-hidden rounded-xl border border-slate-200 bg-white"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-slate-100 px-5 py-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 id={titleId} className="text-sm font-semibold text-slate-900">
            Agents
          </h2>
          <span className="truncate text-[12px] tabular-nums text-slate-500">{activity}</span>
        </div>
        <AnimatePresence initial={false}>
          {workCanMove && (
            <motion.span
              key="work-moving"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: 0.2, ease: EASE_OUT } }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
            >
              <WorkMovingKey />
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {variant === null ? (
        <div className="px-6 py-5">
          <div style={{ aspectRatio: "960 / 352" }} />
        </div>
      ) : mapped && mapWidth !== null ? (
        <div
          className={cn(styles.canvas, "px-6", staleClass)}
          // Room for the labels that reach past a narrow map, plus air: never touching the card.
          style={{ paddingTop: canvasPadY(mapWidth), paddingBottom: canvasPadY(mapWidth) }}
          data-stale={stale || undefined}
          onClick={(event) => {
            // A click on empty canvas clears the selection.
            if (!(event.target as HTMLElement).closest?.("button")) onSelect(null);
          }}
        >
          <BrainMap
            agentsById={agentsById}
            variant={variant}
            mapWidth={mapWidth}
            loading={loading}
            stalled={stalled}
            selected={selected}
            onSelect={onSelect}
            located={located}
            now={now}
            coverage={coverage}
            session={socialSession}
            live={live}
            particles={particles}
            onLand={land}
            inspectorId={inspectorId}
            reduceMotion={reduceMotion}
            buttons={buttons}
          />
        </div>
      ) : (
        <div className={staleClass} data-stale={stale || undefined}>
          <BrainSpine
            agentsById={agentsById}
            loading={loading}
            stalled={stalled}
            selected={selected}
            onSelect={onSelect}
            now={now}
            coverage={coverage}
            session={socialSession}
            live={live}
            particles={particles}
            onLand={land}
            dropAll={dropAll}
            reduceMotion={reduceMotion}
            buttons={buttons}
          />
        </div>
      )}

      {note && <NoteBar>{note}</NoteBar>}

      {mapped && (
        <AnimatePresence initial={false}>
          {selected && (
            <motion.div
              key="inspector"
              id={inspectorId}
              data-brain-details
              role="region"
              aria-label={`${selectedAgent?.label ?? selected} details`}
              className="overflow-hidden border-t border-slate-100"
              initial={{ height: 0, opacity: 0 }}
              animate={{
                height: "auto",
                opacity: 1,
                transition: reduceMotion
                  ? { height: { duration: 0 }, opacity: { duration: 0.12 } }
                  : { duration: 0.22, ease: EASE_OUT }
              }}
              exit={{
                height: 0,
                opacity: 0,
                transition: reduceMotion
                  ? { height: { duration: 0 }, opacity: { duration: 0.12 } }
                  : { duration: 0.16, ease: EASE_OUT }
              }}
            >
              <div className="relative px-5 py-3.5">
                {/* Outside the crossfade: one element, never two with the same id. */}
                <span id={`${inspectorId}-about`} hidden>
                  {selectedAbout}
                </span>
                <AnimatePresence initial={false} mode="popLayout">
                  <motion.div
                    key={selected}
                    initial={{ opacity: 0, filter: "blur(2px)" }}
                    animate={{ opacity: 1, filter: "blur(0px)", transition: { duration: 0.16, ease: EASE_OUT } }}
                    exit={{ opacity: 0, filter: "blur(2px)", transition: { duration: 0.1 } }}
                  >
                    <AgentDetailFields
                      id={selected}
                      agent={selectedAgent}
                      coverage={coverage}
                      session={socialSession}
                      layout="row"
                      onClose={() => onSelect(null)}
                    />
                  </motion.div>
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </section>
  );
}

/**
 * The one key the map needs. Status is never colour alone (every node says its
 * status in words), but blue is only explained here: it is work changing hands.
 */
export function WorkMovingKey() {
  return (
    <span className="flex items-center gap-1.5 text-[12px] text-slate-400">
      <span className="size-1.5 rounded-full bg-blue-600 ring-[3px] ring-blue-600/15" aria-hidden />
      Work moving
    </span>
  );
}
