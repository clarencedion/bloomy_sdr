"use client";

/**
 * The map on a phone: the same agents in the same left-to-right order, read
 * top to bottom on one rail. Guardrails sit on the rail between Writing and
 * Sending (the gate); Social merges into it just before Replies, its real flow.
 *
 * The rail is plain CSS: each row draws its own segment through its orb, so
 * it stretches with the layout (a row opening, a resize) without React or a
 * measurement. Work moving is a blue wipe along the rail (the visible gaps are
 * too short for a travelling dot); alerts and outcomes ripple in place, as on
 * the desktop map. Only the wipes need the orbs' measured centres, and those
 * are re-measured once the layout has settled, never per frame.
 */

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { agentLabel, type BrainAgentId, type BrainAgentState } from "@/lib/sdr/brain-model";
import { cn } from "@/lib/utils";
import { BRAIN_FOCUS_ORDER, BRAIN_NEXT, type Point } from "./brain-geometry";
import {
  EMPTY_VALUE,
  NO_RECENT_DATA,
  agentStatusKnown,
  formatRate,
  lastEventText,
  shortRelative,
  statusLabel,
  type ActivityCoverage
} from "./brain-format";
import {
  EASE_IN_OUT_CSS,
  EASE_OUT,
  EASE_OUT_CSS,
  KICK_CATCH,
  KICK_PASS,
  KICK_RELEASE,
  OUTCOME_RING_GAP_MS,
  RIPPLE,
  SPINE_RIM_PX,
  railWipeDurationS,
  rippleFrames,
  type RippleKind
} from "./brain-motion";
import { AgentDetailFields, type SocialSession } from "./brain-agent-detail";
import { AgentOrb, orbLook, rippleClass, useAssembleOnce, type OrbHandle, type ParticleSpec } from "./brain-map";
import { CrossfadeText, RollingNumber } from "./brain-number";

type RunningAnimation = ReturnType<HTMLElement["animate"]>;

interface SpineGeometry {
  centres: Record<BrainAgentId, Point>;
  railX: number;
}

/** Social's orb sits this far right of the rail, so the rail passes it by. */
const SOCIAL_INDENT = "pl-[52px]";
/** Radius of Social's merge into the rail. */
const MERGE_R = 12;
/** Quiet time after the last layout change before the orbs are measured again. */
const SETTLE_MS = 120;

/*
 * Rail geometry in CSS, from the row anatomy: buttons are px-4 py-3 around a
 * 40px orb, so an orb's centre is 36px from the row's left and 32px from its
 * top (Social: 72px, indented). The rail is 1.5px wide, centred on x = 36.
 */
const RAIL = "pointer-events-none absolute left-[35.25px] w-[1.5px] bg-slate-300";
const MERGE =
  "pointer-events-none absolute left-[35.25px] top-[31.25px] h-3 w-[16.75px] rounded-tl-[12px] border-l-[1.5px] border-t-[1.5px] border-slate-300";

function wipePath(geo: SpineGeometry, from: BrainAgentId, to: BrainAgentId): string {
  const { centres, railX } = geo;
  const s = centres[from];
  const t = centres[to];
  if (from === "social") {
    return `M${s.x - 20} ${s.y} H${railX + MERGE_R} Q${railX} ${s.y} ${railX} ${s.y + MERGE_R} V${t.y - SPINE_RIM_PX}`;
  }
  return `M${railX} ${s.y + SPINE_RIM_PX} V${t.y - SPINE_RIM_PX}`;
}

/** One pulse on the spine: a wipe along the rail and/or a ripple at the orb. */
function SpineParticle({
  spec,
  geo,
  handles,
  onLand
}: {
  spec: ParticleSpec;
  geo: SpineGeometry;
  handles: React.RefObject<Map<BrainAgentId, OrbHandle>>;
  onLand: (id: string) => void;
}) {
  const wipe = useRef<React.ComponentRef<"path">>(null);
  const ringA = useRef<HTMLDivElement>(null);
  const ringB = useRef<HTMLDivElement>(null);
  const next = spec.kind === "handoff" ? BRAIN_NEXT[spec.agentId] : undefined;
  const d = next ? wipePath(geo, spec.agentId, next) : null;

  useEffect(() => {
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const running: RunningAnimation[] = [];
    const later = (seconds: number, run: () => void) => timers.push(setTimeout(run, Math.max(0, seconds * 1000)));
    const orb = (id: BrainAgentId) => handles.current?.get(id);
    const ripple = (element: HTMLDivElement | null, id: BrainAgentId, kind: RippleKind, delayS: number) => {
      if (!element) return null;
      const at = geo.centres[id];
      const look = RIPPLE[kind];
      const animation = element.animate(rippleFrames(at.x, at.y, look), {
        duration: look.durationMs,
        delay: delayS * 1000,
        easing: EASE_OUT_CSS,
        fill: "none"
      });
      running.push(animation);
      return animation;
    };
    const landAfter = (animation: RunningAnimation | null) => {
      if (!animation) {
        onLand(spec.id);
        return;
      }
      animation.finished.then(
        () => onLand(spec.id),
        () => undefined
      );
    };

    const path = wipe.current;
    if (spec.kind === "handoff" && next && path) {
      const length = path.getTotalLength();
      const duration = railWipeDurationS(length);
      path.style.strokeDasharray = `${length}`;
      path.style.strokeDashoffset = `${length}`;
      running.push(
        path.animate([{ strokeDashoffset: length }, { strokeDashoffset: 0 }], {
          duration: duration * 1000,
          delay: spec.delay * 1000,
          easing: EASE_IN_OUT_CSS,
          fill: "forwards"
        }),
        path.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: 320,
          delay: (spec.delay + duration) * 1000,
          easing: EASE_OUT_CSS,
          fill: "forwards"
        })
      );
      later(spec.delay, () => orb(spec.agentId)?.kick(KICK_RELEASE));
      // Writing → Sending runs under Guardrails: it inspects the work as it passes.
      if (spec.agentId === "writing") later(spec.delay + duration / 2, () => orb("guardrails")?.kick(KICK_PASS));
      later(spec.delay + duration, () => orb(next)?.kick(KICK_CATCH));
      landAfter(ripple(ringA.current, next, "receive", spec.delay + duration - 0.05));
    } else if (spec.kind === "outcome") {
      later(spec.delay, () => orb(spec.agentId)?.kick(KICK_CATCH));
      ripple(ringA.current, spec.agentId, "outcome", spec.delay);
      landAfter(ripple(ringB.current, spec.agentId, "outcome", spec.delay + OUTCOME_RING_GAP_MS / 1000));
    } else if (spec.kind === "check") {
      landAfter(ripple(ringA.current, spec.agentId, "check", spec.delay));
    } else {
      landAfter(ripple(ringA.current, spec.agentId, "alert", spec.delay));
    }

    return () => {
      timers.forEach(clearTimeout);
      running.forEach((animation) => animation.cancel());
    };
    // The geometry is fixed for a particle's life: a layout change drops every particle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, handles, onLand]);

  const ringClass = cn(
    "pointer-events-none absolute left-0 top-0 z-[1] -ml-5 -mt-5 size-10 rounded-full border-2 opacity-0 will-change-transform",
    rippleClass(spec)
  );
  return (
    <>
      {d && (
        <svg aria-hidden className="pointer-events-none absolute inset-0 z-[1] size-full overflow-visible">
          <path ref={wipe} d={d} fill="none" stroke="#2563EB" strokeWidth={2} strokeLinecap="round" />
        </svg>
      )}
      <div ref={ringA} aria-hidden className={ringClass} />
      {spec.kind === "outcome" && <div ref={ringB} aria-hidden className={ringClass} />}
    </>
  );
}

export interface BrainSpineProps {
  agentsById: Map<BrainAgentId, BrainAgentState>;
  loading: boolean;
  stalled: boolean;
  selected: BrainAgentId | null;
  onSelect: (id: BrainAgentId | null) => void;
  now: Date;
  coverage: ActivityCoverage;
  session: SocialSession | null;
  live: boolean;
  particles: ParticleSpec[];
  onLand: (id: string) => void;
  dropAll: () => void;
  reduceMotion: boolean;
  /** Every row's button, by agent: shared with the card, which returns focus to them. */
  buttons: React.RefObject<Map<BrainAgentId, HTMLButtonElement>>;
}

export function BrainSpine({
  agentsById,
  loading,
  stalled,
  selected,
  onSelect,
  now,
  coverage,
  session,
  live,
  particles,
  onLand,
  dropAll,
  reduceMotion,
  buttons
}: BrainSpineProps) {
  const uid = useId();
  const assemble = useAssembleOnce();
  const wrapRef = useRef<HTMLDivElement>(null);
  const orbEls = useRef(new Map<BrainAgentId, HTMLElement>());
  const handles = useRef(new Map<BrainAgentId, OrbHandle>());
  const signature = useRef<string | null>(null);
  const [geo, setGeo] = useState<SpineGeometry | null>(null);
  const [settling, setSettling] = useState(false);
  const hasParticles = useRef(false);
  hasParticles.current = particles.length > 0;

  const refs = useMemo(
    () =>
      Object.fromEntries(
        BRAIN_FOCUS_ORDER.map((id) => [
          id,
          {
            orb: (handle: OrbHandle | null) => {
              if (handle) handles.current.set(id, handle);
              else handles.current.delete(id);
            },
            disc: (element: HTMLElement | null) => {
              if (element) orbEls.current.set(id, element);
              else orbEls.current.delete(id);
            },
            button: (element: HTMLButtonElement | null) => {
              if (element) buttons.current.set(id, element);
              else buttons.current.delete(id);
            }
          }
        ])
      ) as Record<
        BrainAgentId,
        {
          orb: (handle: OrbHandle | null) => void;
          disc: (element: HTMLElement | null) => void;
          button: (element: HTMLButtonElement | null) => void;
        }
      >,
    [buttons]
  );

  // Measure the orbs' centres for the wipes. While the layout moves (a row
  // opening, a resize) work in flight would be drawn in the wrong place, so it
  // is dropped and nothing new is drawn until the layout has settled; then
  // the centres are read once. The rail itself is CSS and never waits.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let size = "";
    const measure = () => {
      const box = wrap.getBoundingClientRect();
      size = `${Math.round(box.width)}x${Math.round(box.height)}`;
      const centres = {} as Record<BrainAgentId, Point>;
      for (const id of BRAIN_FOCUS_ORDER) {
        const element = orbEls.current.get(id);
        if (!element) return;
        const rect = element.getBoundingClientRect();
        centres[id] = { x: rect.left - box.left + rect.width / 2, y: rect.top - box.top + rect.height / 2 };
      }
      const next = BRAIN_FOCUS_ORDER.map((id) => `${Math.round(centres[id].x)},${Math.round(centres[id].y)}`).join(";");
      if (next === signature.current) return;
      signature.current = next;
      setGeo({ centres, railX: centres.discovery.x });
    };
    measure();
    if (typeof window.ResizeObserver !== "function") return;
    const observer = new window.ResizeObserver(() => {
      // Its first call only reports the size measured above: nothing moved.
      const box = wrap.getBoundingClientRect();
      if (`${Math.round(box.width)}x${Math.round(box.height)}` === size) return;
      if (hasParticles.current) dropAll();
      setSettling(true);
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        measure();
        setSettling(false);
      }, SETTLE_MS);
    });
    observer.observe(wrap);
    return () => {
      observer.disconnect();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [dropAll]);

  // Work admitted while the layout moves cannot be drawn in place: drop it, never replay it.
  useEffect(() => {
    if (settling && particles.length > 0) dropAll();
  }, [settling, particles, dropAll]);

  const inactive = loading;
  const lastIndex = BRAIN_FOCUS_ORDER.length - 1;

  return (
    <div ref={wrapRef} className="relative isolate py-1.5">
      {geo &&
        !settling &&
        particles.map((spec) => <SpineParticle key={spec.id} spec={spec} geo={geo} handles={handles} onLand={onLand} />)}

      <ol aria-label="Agents, in pipeline order">
        {BRAIN_FOCUS_ORDER.map((id, index) => {
          const agent = agentsById.get(id);
          const look = orbLook(agent, loading, coverage);
          const known = !!agent && agentStatusKnown(agent, coverage);
          const open = selected === id;
          const detailId = `${uid}-${id}`;
          const label = agent?.label ?? agentLabel(id);
          const lastText = lastEventText(agent, coverage);

          let metric: React.ReactNode;
          if (loading) {
            metric = stalled ? (
              <span className="text-slate-300">{EMPTY_VALUE}</span>
            ) : (
              <span className="inline-block h-2.5 w-12 rounded-full bg-slate-100 align-middle motion-safe:animate-pulse" />
            );
          } else if (!agent) metric = "No data";
          else if (!known) metric = NO_RECENT_DATA;
          else
            metric = (
              <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
                {statusLabel(agent.status)}
                <span aria-hidden>·</span>
                <RollingNumber value={agent.eventsLastHour} text={formatRate(agent.eventsLastHour, coverage.hour)} size="node" />
              </span>
            );

          return (
            <motion.li
              key={id}
              className={cn("relative transition-colors duration-150", open && "bg-slate-50")}
              initial={assemble ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.18, delay: assemble ? 0.03 * index : 0 }}
            >
              {/* The rail through this row: from the first orb's centre to the last one's. */}
              <span
                aria-hidden
                className={cn(RAIL, index === 0 ? "top-8" : "top-0", index === lastIndex ? "h-8" : "bottom-0")}
              />
              {id === "social" && <span aria-hidden className={MERGE} />}
              <button
                ref={refs[id].button}
                type="button"
                aria-expanded={open}
                aria-controls={open ? detailId : undefined}
                aria-disabled={inactive || undefined}
                onClick={() => {
                  if (!inactive) onSelect(open ? null : id);
                }}
                className={cn(
                  "group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  !inactive && "active:bg-slate-100 [@media(hover:hover)]:hover:bg-slate-50",
                  id === "social" && SOCIAL_INDENT
                )}
              >
                <span ref={refs[id].disc} className="relative z-[2] shrink-0 rounded-full">
                  <AgentOrb
                    ref={refs[id].orb}
                    id={id}
                    look={look}
                    errors={agent?.errorsLastHour ?? 0}
                    errorsExact={coverage.hour}
                    live={live}
                    size="sm"
                    selected={open}
                    offset="slate"
                    reduceMotion={reduceMotion}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[14px] font-medium text-slate-900">{label}</span>
                    <span className={cn("shrink-0 text-[12px] tabular-nums", look.style.metric)}>{metric}</span>
                  </span>
                  {loading ? (
                    <span className="mt-0.5 flex h-4 items-center">
                      {!stalled && <span className="h-2 w-28 rounded-full bg-slate-100 motion-safe:animate-pulse" />}
                    </span>
                  ) : agent ? (
                    <span className="mt-0.5 flex min-w-0 gap-1 text-[12px] leading-4 text-slate-500">
                      <CrossfadeText
                        className="min-w-0"
                        text={lastText}
                        k={`${lastText}:${agent.lastEventAt?.getTime() ?? ""}`}
                      />
                      {agent.lastEventAt && (
                        <span className="shrink-0 tabular-nums">· {shortRelative(agent.lastEventAt, now)}</span>
                      )}
                    </span>
                  ) : null}
                </span>
                <ChevronDown
                  className={cn(
                    "size-4 shrink-0 text-slate-300 transition-transform duration-150 group-aria-expanded:rotate-180 motion-reduce:transition-none",
                    inactive && "invisible"
                  )}
                  aria-hidden
                />
              </button>
              <AnimatePresence initial={false}>
                {open && (
                  <motion.div
                    id={detailId}
                    key="detail"
                    data-brain-details
                    className="overflow-hidden"
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
                    <div className={cn("pb-3 pr-4", id === "social" ? "pl-[104px]" : "pl-[68px]")}>
                      <AgentDetailFields
                        id={id}
                        agent={agent}
                        coverage={coverage}
                        session={session}
                        layout="stack"
                        onShowInActivity={() => {
                          const card = document.getElementById("brain-activity");
                          card?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
                          // Focus follows the reader to the card's heading (not left on this
                          // button), without cutting the scroll short.
                          card?.querySelector<HTMLElement>("h2[tabindex='-1']")?.focus({ preventScroll: true });
                        }}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}
