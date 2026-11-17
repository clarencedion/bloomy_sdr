"use client";

/**
 * The living map: eight agents on the app's own white canvas, the real
 * connectors between them, and work visibly changing hands.
 *
 * Layers, bottom to top (all inside one isolated box with the map's aspect):
 * 1. SVG connectors and chevrons. At rest each line is worn by its real
 *    traffic: busy routes darken and thicken, quiet ones recede.
 * 2. Trails (z-5), packets (z-10) and ripples (z-15): a handoff draws a blue
 *    trail behind its packet along the same route, then releases it. All are
 *    driven by the Web Animations API; packets and ripples use transform and
 *    opacity only, so they run on the compositor.
 * 3. Nodes (z-20): real buttons with opaque orbs, so lines and packets pass
 *    beneath them; the gate mark sits here too and hides a packet passing
 *    under it.
 *
 * Nothing animates per frame in React: a packet is admitted (one render),
 * flies on WAAPI, and is removed when its last ripple finishes (one render).
 */

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { AnimatePresence, animate, motion, useMotionValue, type Variants } from "framer-motion";
import { agentLabel, type BrainAgentId, type BrainAgentState } from "@/lib/sdr/brain-model";
import { cn } from "@/lib/utils";
import {
  BRAIN_FOCUS_ORDER,
  GATE,
  MAP_EDGES,
  MAP_POINTS,
  MAP_VIEWBOX,
  NODE,
  handoffRoute,
  incidentEdges,
  labelWidthPx,
  orbCenter,
  polylineLength,
  trimRoute,
  type MapEdge,
  type Point
} from "./brain-geometry";
import {
  EMPTY_VALUE,
  NO_RECENT_DATA,
  agentMetric,
  agentStatusKnown,
  connectorLook,
  formatRate,
  formatRelativeTime,
  lastEventText,
  routeTraffic,
  statusLabel,
  type ActivityCoverage,
  type ConnectorLook
} from "./brain-format";
import {
  AGENT_ICONS,
  LOADING_STYLE,
  STATUS_STYLE,
  StatusSignal,
  UNKNOWN_STYLE,
  type OrbStyle,
  type SignalKind
} from "./brain-meta";
import {
  EASE_IN_OUT_CSS,
  EASE_OUT,
  EASE_OUT_CSS,
  GATE_TICK_PEAK,
  KICK_CATCH,
  KICK_RELEASE,
  OUTCOME_RING_GAP_MS,
  PACKET_FRAMES,
  PACKET_OPACITY,
  PACKET_RIM_PX,
  RIPPLE,
  SPEAK_MS,
  TRAIL_FADE_MS,
  TRAIL_OPACITY,
  packetDurationS,
  packetFrames,
  rippleFrames,
  type KickSpring,
  type RippleKind
} from "./brain-motion";
import { RollingNumber } from "./brain-number";
import { nodeAriaLabel, type SocialSession } from "./brain-agent-detail";
import styles from "./brain.module.css";

// ── Shared types ────────────────────────────────────────────────────────────

export type ParticleKind = "handoff" | "alert" | "outcome" | "check";

export interface ParticleSpec {
  id: string;
  agentId: BrainAgentId;
  tone: "ok" | "warn" | "error";
  kind: ParticleKind;
  /** Stagger within a burst, seconds. */
  delay: number;
}

export interface OrbHandle {
  kick(spring: KickSpring): void;
}

export interface GateHandle {
  tick(): void;
}

type RunningAnimation = ReturnType<HTMLElement["animate"]>;

/**
 * The entrance plays once per page load. Brain is primary navigation and is
 * opened many times a day: anything seen that often must not replay.
 */
let mapAssembled = false;

export function useAssembleOnce(): boolean {
  const [assemble] = useState(() => !mapAssembled);
  useEffect(() => {
    mapAssembled = true;
  }, []);
  return assemble;
}

// ── Orb ─────────────────────────────────────────────────────────────────────

export interface OrbLook {
  kind: SignalKind;
  style: OrbStyle;
}

/** How an agent's orb looks: its status when provable, else unknown or loading. */
export function orbLook(agent: BrainAgentState | undefined, loading: boolean, coverage: ActivityCoverage): OrbLook {
  if (loading) return { kind: "loading", style: LOADING_STYLE };
  if (!agent || !agentStatusKnown(agent, coverage)) return { kind: "unknown", style: UNKNOWN_STYLE };
  return { kind: agent.status, style: STATUS_STYLE[agent.status] };
}

interface AgentOrbProps {
  id: BrainAgentId;
  look: OrbLook;
  errors: number;
  /** The activity window reaches back an hour: the error count is exact, else a floor. */
  errorsExact: boolean;
  live: boolean;
  size: "md" | "sm";
  selected: boolean;
  located?: boolean;
  dimmed?: boolean;
  /** Ring offset colour behind a selected orb (the row background on mobile). */
  offset?: "white" | "slate";
  reduceMotion: boolean;
}

/**
 * One agent's disc. Its scale is a motion value so work arriving or leaving can
 * "kick" it with a spring that adds to whatever velocity it already has:
 * repeated kicks blend instead of restarting.
 */
export const AgentOrb = forwardRef<OrbHandle, AgentOrbProps>(function AgentOrb(
  { id, look, errors, errorsExact, live, size, selected, located = false, dimmed = false, offset = "white", reduceMotion },
  ref
) {
  const scale = useMotionValue(1);
  useImperativeHandle(
    ref,
    () => ({
      kick(spring: KickSpring) {
        if (reduceMotion) return;
        animate(scale, 1, {
          type: "spring",
          stiffness: spring.stiffness,
          damping: spring.damping,
          velocity: scale.getVelocity() + spring.velocity
        });
      }
    }),
    [scale, reduceMotion]
  );

  const Icon = AGENT_ICONS[id];
  return (
    <span className={cn(styles.lift, "relative block rounded-full")}>
      <motion.span className="relative block rounded-full" style={{ scale }}>
        <span
          className={cn(
            // box-shadow is deliberately not transitioned: the focus ring must be instant.
            "relative grid place-items-center rounded-full border transition-[border-color,background-color,color] duration-200",
            size === "md" ? "size-12" : "size-10",
            look.style.orb,
            look.style.icon,
            selected
              ? cn("ring-2 ring-slate-900 ring-offset-2", offset === "slate" ? "ring-offset-slate-50" : "ring-offset-white")
              : located && "ring-2 ring-slate-300 ring-offset-2 ring-offset-white",
            "group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-2"
          )}
        >
          <Icon
            className={cn(
              size === "md" ? "size-5" : "size-[18px]",
              "transition-opacity duration-200 ease-out",
              dimmed && "opacity-60"
            )}
            strokeWidth={1.75}
            aria-hidden
          />
          <StatusSignal kind={look.kind} errors={errors} errorsExact={errorsExact} live={live} size={size} />
        </span>
      </motion.span>
    </span>
  );
});

// ── Gate ────────────────────────────────────────────────────────────────────

const GATE_TONE = {
  ok: "border-slate-400",
  warn: "border-amber-500",
  error: "border-rose-500"
} as const;

/**
 * The guardrails check on the writing → sending line: a small opaque diamond,
 * above the packets, so work visibly passes under it. It ticks once the work
 * is through (or when guardrails report a check).
 */
const GateMarker = forwardRef<
  GateHandle,
  {
    tone: keyof typeof GATE_TONE;
    /** Its line recedes (another agent is selected): the mark recedes with it. */
    dimmed: boolean;
    reduceMotion: boolean;
    assemble: boolean;
  }
>(function GateMarker({ tone, dimmed, reduceMotion, assemble }, ref) {
  const mark = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  useImperativeHandle(
    ref,
    () => ({
      tick() {
        if (reduceMotion) return;
        mark.current?.animate(
          [
            { transform: "rotate(45deg) scale(1)" },
            { transform: `rotate(45deg) scale(${GATE_TICK_PEAK})`, offset: 0.4 },
            { transform: "rotate(45deg) scale(1)" }
          ],
          { duration: 300, easing: EASE_OUT_CSS }
        );
        ring.current?.animate(
          [
            { transform: "rotate(45deg) scale(1)", opacity: 0.5 },
            { transform: "rotate(45deg) scale(2.2)", opacity: 0 }
          ],
          { duration: 400, easing: EASE_OUT_CSS }
        );
      }
    }),
    [reduceMotion]
  );
  return (
    <motion.div
      aria-hidden
      className="absolute size-0"
      style={{ left: `${(GATE.x / MAP_VIEWBOX.width) * 100}%`, top: `${(GATE.y / MAP_VIEWBOX.height) * 100}%` }}
      // On the first load it appears as the writing → sending line reaches it.
      initial={assemble ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: EASE_OUT, delay: reduceMotion ? 0 : 0.3 }}
    >
      <div
        ref={ring}
        className="absolute -ml-[5px] -mt-[5px] size-2.5 rotate-45 rounded-[2px] border border-slate-400/60 opacity-0"
      />
      <div
        ref={mark}
        className={cn(
          "absolute -ml-[5px] -mt-[5px] size-2.5 rotate-45 rounded-[2px] border-[1.5px] bg-white transition-[border-color,opacity] duration-200",
          GATE_TONE[tone],
          dimmed && "opacity-[0.45]"
        )}
      />
    </motion.div>
  );
});

// ── Particles ───────────────────────────────────────────────────────────────

const RIPPLE_CLASS: Record<RippleKind | "alert-warn" | "alert-error", string> = {
  receive: "border-blue-500/40",
  check: "border-blue-500/30",
  alert: "border-amber-500/60",
  "alert-warn": "border-amber-500/60",
  "alert-error": "border-rose-500/60",
  outcome: "border-emerald-500/50"
};

export function rippleClass(spec: Pick<ParticleSpec, "kind" | "tone">): string {
  if (spec.kind === "alert") return RIPPLE_CLASS[spec.tone === "error" ? "alert-error" : "alert-warn"];
  if (spec.kind === "handoff") return RIPPLE_CLASS.receive;
  return RIPPLE_CLASS[spec.kind];
}

interface Handles {
  orbs: Map<BrainAgentId, OrbHandle>;
  gate: GateHandle | null;
}

/** A handoff's route in map pixels: from the sender's rim to the receiver's, evenly spaced. */
function packetRoute(spec: ParticleSpec, mapWidth: number): { edge: MapEdge; points: Point[]; length: number } | null {
  if (spec.kind !== "handoff") return null;
  const edge = handoffRoute(spec.agentId);
  if (!edge || edge.to === "gate") return null;
  const scale = mapWidth / MAP_VIEWBOX.width;
  const points = trimRoute(
    edge.points.map((point) => ({ x: point.x * scale, y: point.y * scale })),
    PACKET_RIM_PX,
    PACKET_FRAMES
  );
  return { edge, points, length: polylineLength(points) };
}

/**
 * One pulse, played once: a packet with its trail from the sender's rim to the
 * receiver's on the real connector, or a ripple where the agent is.
 * Everything is scheduled up front on WAAPI; the spec leaves when its last
 * ripple has finished, so a ripple is never cut short.
 */
const MapParticle = memo(function MapParticle({
  spec,
  mapWidth,
  handles,
  onLand
}: {
  spec: ParticleSpec;
  mapWidth: number;
  handles: React.RefObject<Handles>;
  onLand: (id: string) => void;
}) {
  const packet = useRef<HTMLDivElement>(null);
  const trail = useRef<React.ComponentRef<"path">>(null);
  const ringA = useRef<HTMLDivElement>(null);
  const ringB = useRef<HTMLDivElement>(null);
  const route = useMemo(() => packetRoute(spec, mapWidth), [spec, mapWidth]);
  // The trail's dash runs a little past its own length so no round cap shows before it starts.
  const trailDash = route ? route.length + 2 : 0;

  useEffect(() => {
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const running: RunningAnimation[] = [];
    const later = (seconds: number, run: () => void) => timers.push(setTimeout(run, Math.max(0, seconds * 1000)));
    const orb = (id: BrainAgentId) => handles.current?.orbs.get(id);
    const ripple = (element: HTMLDivElement | null, id: BrainAgentId, kind: RippleKind, delayS: number) => {
      if (!element) return null;
      const at = orbCenter(id, mapWidth);
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

    if (spec.kind === "handoff") {
      const target = route?.edge.to;
      if (!route || !target || target === "gate" || !packet.current) {
        onLand(spec.id);
        return;
      }
      const duration = packetDurationS(route.length);
      const timing = { duration: duration * 1000, delay: spec.delay * 1000, easing: EASE_IN_OUT_CSS, fill: "none" as const };
      const move = packet.current.animate(packetFrames(route.points), timing);
      running.push(move, packet.current.animate(PACKET_OPACITY, timing));
      if (trail.current) {
        // Same route, timing and curve as the packet: the trail's front is the packet.
        running.push(
          trail.current.animate([{ strokeDashoffset: trailDash }, { strokeDashoffset: 0 }], { ...timing, fill: "forwards" }),
          trail.current.animate([{ opacity: 1 }, { opacity: 0 }], {
            duration: TRAIL_FADE_MS,
            delay: (spec.delay + duration) * 1000,
            easing: EASE_OUT_CSS,
            fill: "forwards"
          })
        );
      }
      later(spec.delay, () => orb(spec.agentId)?.kick(KICK_RELEASE));
      move.finished.then(
        () => orb(target)?.kick(KICK_CATCH),
        () => undefined
      );
      if (route.edge.gateAt !== undefined) {
        // The packet is under the opaque gate at the route's midpoint; it ticks once through.
        later(spec.delay + duration * route.edge.gateAt + 0.06, () => handles.current?.gate?.tick());
      }
      landAfter(ripple(ringA.current, target, "receive", spec.delay + duration - 0.05));
    } else if (spec.kind === "check") {
      // A check is not a handoff: nothing travels. Guardrails ripples, then the gate ticks.
      landAfter(ripple(ringA.current, spec.agentId, "check", spec.delay));
      later(spec.delay + 0.15, () => handles.current?.gate?.tick());
    } else if (spec.kind === "outcome") {
      later(spec.delay, () => orb(spec.agentId)?.kick(KICK_CATCH));
      ripple(ringA.current, spec.agentId, "outcome", spec.delay);
      landAfter(ripple(ringB.current, spec.agentId, "outcome", spec.delay + OUTCOME_RING_GAP_MS / 1000));
    } else {
      // Problems stay where they happen: one ring, no travel, no kick.
      landAfter(ripple(ringA.current, spec.agentId, "alert", spec.delay));
    }

    return () => {
      timers.forEach(clearTimeout);
      running.forEach((animation) => animation.cancel());
    };
  }, [spec, mapWidth, route, trailDash, handles, onLand]);

  const ringClass = cn(
    "pointer-events-none absolute left-0 top-0 z-[15] -ml-6 -mt-6 size-12 rounded-full border-2 opacity-0 will-change-transform",
    rippleClass(spec)
  );
  return (
    <>
      {route && (
        <>
          <svg aria-hidden className="pointer-events-none absolute inset-0 z-[5] size-full overflow-visible">
            <path
              ref={trail}
              d={`M${route.points.map((point) => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" L")}`}
              fill="none"
              stroke="#2563EB"
              strokeOpacity={TRAIL_OPACITY}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={`${trailDash} ${trailDash}`}
              strokeDashoffset={trailDash}
            />
          </svg>
          <div
            ref={packet}
            className="pointer-events-none absolute left-0 top-0 z-10 -ml-1 -mt-1 size-2 rounded-full bg-blue-600 opacity-0 shadow-[0_0_0_3px_rgba(37,99,235,0.14)] will-change-transform"
          />
        </>
      )}
      <div ref={ringA} className={ringClass} />
      {spec.kind === "outcome" && <div ref={ringB} className={ringClass} />}
    </>
  );
});

// ── Node ────────────────────────────────────────────────────────────────────

/**
 * Whether an agent is "speaking": the time of its newest event for SPEAK_MS
 * after it arrives, else `null`. The first value seen is history, never news.
 * `at` is `null` while the agent is not readable (loading, or activity
 * unavailable): the baseline is then forgotten, so when activity comes back
 * its backlog is history too, and every agent does not speak at once.
 */
function useSpeech(at: number | null): number | null {
  const baseline = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [speakingAt, setSpeakingAt] = useState<number | null>(null);

  useEffect(() => {
    if (at === null) {
      baseline.current = null;
      if (timer.current !== undefined) clearTimeout(timer.current);
      timer.current = undefined;
      setSpeakingAt(null);
      return;
    }
    if (baseline.current === null || at <= baseline.current) {
      baseline.current = Math.max(baseline.current ?? at, at);
      return;
    }
    baseline.current = at;
    setSpeakingAt(at);
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSpeakingAt(null), SPEAK_MS);
  }, [at]);

  useEffect(
    () => () => {
      if (timer.current !== undefined) clearTimeout(timer.current);
    },
    []
  );

  return speakingAt;
}

/**
 * The voice crossfades (a 2px blur bridges the two lines) when the agent acts
 * or is pointed at with the mouse. Driven from the keyboard it is instant:
 * moving focus is done many times in a row and must never wait on motion.
 */
const VOICE_VARIANTS: Variants = {
  initial: (instant: boolean) => (instant ? { opacity: 0 } : { opacity: 0, y: 4, filter: "blur(2px)" }),
  animate: (instant: boolean) => ({
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: instant ? { duration: 0 } : { duration: 0.22, ease: EASE_OUT }
  }),
  exit: (instant: boolean) => ({
    opacity: 0,
    y: instant ? 0 : -4,
    filter: instant ? "blur(0px)" : "blur(2px)",
    transition: instant ? { duration: 0 } : { duration: 0.12, ease: EASE_OUT }
  })
};

/**
 * An agent's voice. At rest a spine agent says only how long ago it last acted
 * ("40s ago"); a satellite says nothing, so its name and status stay next to
 * its orb. When the agent acts, or is pointed at, it says what it did on up to
 * two lines, then settles back. The slot is always two lines tall, so nothing
 * around it moves. It is the line furthest from the orb: under the label on
 * the spine, above it (aligned to the label) on satellites.
 */
function NodeVoice({
  agent,
  coverage,
  now,
  speakingAt,
  pointed,
  above,
  width,
  compact,
  instant
}: {
  agent: BrainAgentState;
  coverage: ActivityCoverage;
  now: Date;
  speakingAt: number | null;
  pointed: boolean;
  above: boolean;
  width: number;
  /** The medium map: one size smaller. */
  compact: boolean;
  instant: boolean;
}) {
  const said = lastEventText(agent, coverage);
  const saying = speakingAt !== null || (pointed && (above || !!agent.lastEventAt));
  const rest = above ? null : agent.lastEventAt ? formatRelativeTime(agent.lastEventAt, now) : said;
  return (
    <span
      className={cn("grid h-8 justify-items-center [&>*]:col-start-1 [&>*]:row-start-1", above ? "items-end" : "items-start")}
      style={{ width }}
    >
      <AnimatePresence initial={false} custom={instant}>
        {saying ? (
          <motion.span
            // Keyed by the words: a new action crossfades in, the same words stay put.
            key={`say:${said}`}
            // The leading comes after the size: `cn` drops a line-height that a
            // later font-size would override, and two 18px lines overflow the slot.
            // A long token (an email address) breaks, so the clamp ends in "…"
            // instead of cutting a word off at the label's edge.
            className={cn(
              "line-clamp-2 text-balance text-slate-600 [overflow-wrap:anywhere]",
              compact ? "text-[11px]" : "text-[12px]",
              "leading-4"
            )}
            style={{ maxWidth: width }}
            custom={instant}
            variants={VOICE_VARIANTS}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            {said}
          </motion.span>
        ) : rest !== null ? (
          <motion.span
            key="rest"
            className="truncate text-[11px] leading-4 tabular-nums text-slate-400"
            style={{ maxWidth: width }}
            custom={instant}
            variants={VOICE_VARIANTS}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            {rest}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </span>
  );
}

interface MapNodeProps {
  id: BrainAgentId;
  agent: BrainAgentState | undefined;
  variant: "medium" | "wide";
  loading: boolean;
  stalled: boolean;
  selected: boolean;
  located: boolean;
  /** Under the mouse or keyboard focus: the node says what it last did. */
  pointed: boolean;
  /** Keyboard focus is driving the map: its changes are instant. */
  instant: boolean;
  /** Width of the label lines, in map pixels. */
  labelWidth: number;
  dimmed: boolean;
  tabbable: boolean;
  live: boolean;
  index: number;
  now: Date;
  coverage: ActivityCoverage;
  session: SocialSession | null;
  inspectorId: string;
  /** First mount of this page load: fade the node in. */
  assemble: boolean;
  reduceMotion: boolean;
  orbRef: (handle: OrbHandle | null) => void;
  buttonRef: (element: HTMLButtonElement | null) => void;
  onToggle: (id: BrainAgentId) => void;
  onHover: (id: BrainAgentId | null) => void;
  onFocusNode: (id: BrainAgentId, visible: boolean) => void;
  onBlurNode: () => void;
}

/**
 * One label line, exactly `NODE.line` (16 px) tall, as the geometry assumes.
 * Passed to `cn` after the font size: tailwind-merge drops a `leading-*` that
 * precedes a font-size class, and the line would fall back to 1.5 × the size.
 */
const LINE = "block truncate";
const LINE_HEIGHT = "leading-4";

const MapNode = memo(function MapNode({
  id,
  agent,
  variant,
  loading,
  stalled,
  selected,
  located,
  pointed,
  instant,
  labelWidth,
  dimmed,
  tabbable,
  live,
  index,
  now,
  coverage,
  session,
  inspectorId,
  assemble,
  reduceMotion,
  orbRef,
  buttonRef,
  onToggle,
  onHover,
  onFocusNode,
  onBlurNode
}: MapNodeProps) {
  const point = MAP_POINTS[id];
  const satellite = point.role === "satellite";
  const look = orbLook(agent, loading, coverage);
  const label = agent?.label ?? agentLabel(id);
  const wide = variant === "wide";
  const known = !!agent && agentStatusKnown(agent, coverage);
  const inactive = loading;
  const speakingAt = useSpeech(loading || !agent ? null : (agent.lastEventAt?.getTime() ?? 0));

  let metric: React.ReactNode;
  if (loading) {
    metric = stalled ? (
      <span className="text-slate-300">{EMPTY_VALUE}</span>
    ) : (
      <span className="flex h-4 items-center justify-center">
        <span className="h-2.5 w-14 rounded-full bg-slate-100 motion-safe:animate-pulse" />
      </span>
    );
  } else if (!agent) {
    metric = "No data";
  } else if (!known) {
    metric = NO_RECENT_DATA;
  } else {
    metric = (
      <span className="inline-flex items-baseline justify-center gap-1 whitespace-nowrap">
        <span>{statusLabel(agent.status)}</span>
        <span aria-hidden>·</span>
        <RollingNumber value={agent.eventsLastHour} text={formatRate(agent.eventsLastHour, coverage.hour)} size="node" />
      </span>
    );
  }

  const voice = loading ? (
    <span
      className={cn("flex h-8 justify-center", satellite ? "items-end pb-1" : "items-start pt-1")}
      style={{ width: labelWidth }}
    >
      {!stalled && !satellite && <span className="h-2 w-14 rounded-full bg-slate-100 motion-safe:animate-pulse" />}
    </span>
  ) : agent ? (
    <NodeVoice
      agent={agent}
      coverage={coverage}
      now={now}
      speakingAt={speakingAt}
      pointed={pointed}
      above={satellite}
      width={labelWidth}
      compact={!wide}
      instant={instant}
    />
  ) : (
    <span className="block h-8" style={{ width: labelWidth }} />
  );

  return (
    <motion.div
      className="absolute size-0"
      style={{ left: `${(point.x / MAP_VIEWBOX.width) * 100}%`, top: `${(point.y / MAP_VIEWBOX.height) * 100}%` }}
      initial={assemble ? { opacity: 0, scale: reduceMotion ? 1 : 0.96 } : false}
      animate={{ opacity: 1, scale: 1 }}
      transition={
        reduceMotion ? { duration: 0.15 } : { duration: 0.24, ease: EASE_OUT, delay: 0.08 + 0.03 * index }
      }
    >
      <button
        ref={buttonRef}
        type="button"
        data-agent={id}
        tabIndex={tabbable ? 0 : -1}
        aria-pressed={selected}
        aria-disabled={inactive || undefined}
        aria-label={nodeAriaLabel(id, agent, now, coverage, id === "social" ? session : null)}
        // The inspector's quiet summary (role, errors), not its whole content.
        aria-describedby={selected ? `${inspectorId}-about` : undefined}
        className={cn(
          styles.node,
          "group pointer-events-auto absolute left-0 flex w-max -translate-x-1/2 items-center gap-2.5 text-center focus-visible:outline-none",
          satellite ? "bottom-0 translate-y-6 flex-col-reverse" : "top-0 -translate-y-6 flex-col"
        )}
        onClick={() => {
          if (!inactive) onToggle(id);
        }}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") onHover(id);
        }}
        onPointerLeave={() => onHover(null)}
        onFocus={(event) => onFocusNode(id, event.currentTarget.matches(":focus-visible"))}
        onBlur={onBlurNode}
      >
        <AgentOrb
          ref={orbRef}
          id={id}
          look={look}
          errors={agent?.errorsLastHour ?? 0}
          errorsExact={coverage.hour}
          live={live}
          size="md"
          selected={selected}
          located={located}
          dimmed={dimmed}
          reduceMotion={reduceMotion}
        />
        <span
          aria-hidden
          className={cn(
            "flex flex-col items-center gap-0.5 transition-opacity duration-200 ease-out",
            dimmed && "opacity-60"
          )}
        >
          {satellite && voice}
          <span
            className={cn(LINE, "text-[13px] text-slate-900", LINE_HEIGHT, selected ? "font-semibold" : "font-medium")}
            style={{ maxWidth: labelWidth }}
          >
            {label}
          </span>
          <span
            className={cn(
              LINE,
              "tabular-nums transition-colors duration-200",
              wide ? "text-[12px]" : "text-[11px]",
              LINE_HEIGHT,
              look.style.metric
            )}
            style={{ maxWidth: labelWidth }}
            title={loading ? undefined : agentMetric(agent, coverage)}
          >
            {metric}
          </span>
          {!satellite && voice}
        </span>
      </button>
    </motion.div>
  );
});

// ── Connectors ──────────────────────────────────────────────────────────────

const INCIDENT: Record<BrainAgentId, ReadonlySet<string>> = Object.fromEntries(
  BRAIN_FOCUS_ORDER.map((id) => [id, new Set(incidentEdges(id).map((edge) => edge.id))])
) as unknown as Record<BrainAgentId, ReadonlySet<string>>;

/** Draw order of the entrance: the pipeline left to right, then the social arch. */
const DRAW_INDEX = new Map(MAP_EDGES.filter((edge) => edge.kind !== "guard").map((edge, index) => [edge.id, index]));
const DRAW_MS = 480;
/** The connector the gate sits on. */
const GATED_EDGE = MAP_EDGES.find((edge) => edge.gateAt !== undefined)?.id ?? "";
const DRAW_STAGGER_MS = 40;

/**
 * One connector. Its colour, width and opacity are plain inline style written
 * on every render, so traffic, hover and selection always reach it, through
 * one interruptible CSS transition (instant while the keyboard drives the
 * map). The entrance is separate: the line draws itself in once, on WAAPI,
 * along its normalised length, and nothing about it is held afterwards.
 */
function Connector({
  edge,
  unit,
  look,
  assemble,
  draw
}: {
  edge: MapEdge;
  /** viewBox units per screen pixel: keeps strokes at their pixel width at every map size. */
  unit: number;
  look: ConnectorLook;
  /** First mount of this page load: fade in. */
  assemble: boolean;
  /** Same, with motion allowed: draw the line in. */
  draw: boolean;
}) {
  const line = useRef<React.ComponentRef<"path">>(null);
  const drawIndex = DRAW_INDEX.get(edge.id) ?? 0;
  const style = { stroke: look.stroke, opacity: look.opacity, strokeWidth: look.width * unit };

  // Before first paint, so the line never flashes in full before drawing.
  const shouldDraw = useRef(draw && edge.kind !== "guard");
  useLayoutEffect(() => {
    const element = line.current;
    if (!shouldDraw.current || !element || typeof element.animate !== "function") return;
    shouldDraw.current = false;
    // `pathLength` is 1, so a 1 1 dash is the whole line; it only exists while drawing.
    const animation = element.animate(
      [
        { strokeDasharray: "1 1", strokeDashoffset: 1 },
        { strokeDasharray: "1 1", strokeDashoffset: 0 }
      ],
      { duration: DRAW_MS, delay: DRAW_STAGGER_MS * drawIndex, easing: EASE_IN_OUT_CSS, fill: "backwards" }
    );
    return () => {
      // Cut short before it finished (an effect re-run, as in Strict Mode): draw again on the next run.
      if (animation.playState !== "finished") shouldDraw.current = true;
      animation.cancel();
    };
  }, [drawIndex]);

  const chevron = edge.chevron;
  return (
    <>
      {edge.kind === "guard" ? (
        <motion.g
          initial={assemble ? { opacity: 0 } : false}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2, delay: 0.3 }}
        >
          <path
            d={edge.d}
            fill="none"
            strokeDasharray={`${3 * unit} ${4 * unit}`}
            strokeLinecap="round"
            className={styles.connector}
            style={style}
          />
        </motion.g>
      ) : (
        <path
          ref={line}
          d={edge.d}
          pathLength={1}
          fill="none"
          strokeLinecap="round"
          data-edge={edge.id}
          className={styles.connector}
          style={style}
        />
      )}
      {chevron && (
        <motion.g
          initial={assemble ? { opacity: 0 } : false}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.15, delay: (DRAW_STAGGER_MS * drawIndex) / 1000 + 0.3 }}
        >
          <path
            d="M-3 -3.5 L1.5 0 L-3 3.5"
            transform={`translate(${chevron.x} ${chevron.y}) rotate(${chevron.angle}) scale(${unit})`}
            fill="none"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            data-chevron={edge.id}
            className={styles.connector}
            style={{ stroke: look.chevron, opacity: look.opacity }}
          />
        </motion.g>
      )}
    </>
  );
}

// ── Map ─────────────────────────────────────────────────────────────────────

export interface BrainMapProps {
  agentsById: Map<BrainAgentId, BrainAgentState>;
  variant: "medium" | "wide";
  mapWidth: number;
  loading: boolean;
  stalled: boolean;
  selected: BrainAgentId | null;
  onSelect: (id: BrainAgentId | null) => void;
  located: BrainAgentId | null;
  now: Date;
  coverage: ActivityCoverage;
  session: SocialSession | null;
  live: boolean;
  particles: ParticleSpec[];
  onLand: (id: string) => void;
  inspectorId: string;
  reduceMotion: boolean;
  /** Every node's button, by agent: shared with the card, which returns focus to them. */
  buttons: React.RefObject<Map<BrainAgentId, HTMLButtonElement>>;
}

export function BrainMap({
  agentsById,
  variant,
  mapWidth,
  loading,
  stalled,
  selected,
  onSelect,
  located,
  now,
  coverage,
  session,
  live,
  particles,
  onLand,
  inspectorId,
  reduceMotion,
  buttons
}: BrainMapProps) {
  const assemble = useAssembleOnce();
  const draw = assemble && !reduceMotion;
  const [hovered, setHovered] = useState<BrainAgentId | null>(null);
  const [focusedVisible, setFocusedVisible] = useState<BrainAgentId | null>(null);
  const [lastFocused, setLastFocused] = useState<BrainAgentId>("discovery");

  const handles = useRef<Handles>({ orbs: new Map(), gate: null });
  const gateRef = useCallback((handle: GateHandle | null) => {
    handles.current.gate = handle;
  }, []);
  const refs = useMemo(
    () =>
      Object.fromEntries(
        BRAIN_FOCUS_ORDER.map((id) => [
          id,
          {
            orb: (handle: OrbHandle | null) => {
              if (handle) handles.current.orbs.set(id, handle);
              else handles.current.orbs.delete(id);
            },
            button: (element: HTMLButtonElement | null) => {
              if (element) buttons.current.set(id, element);
              else buttons.current.delete(id);
            }
          }
        ])
      ) as Record<BrainAgentId, { orb: (handle: OrbHandle | null) => void; button: (element: HTMLButtonElement | null) => void }>,
    [buttons]
  );

  const toggle = useCallback((id: BrainAgentId) => onSelect(selected === id ? null : id), [onSelect, selected]);
  const onFocusNode = useCallback((id: BrainAgentId, visible: boolean) => {
    setLastFocused(id);
    setFocusedVisible(visible ? id : null);
  }, []);
  const onBlurNode = useCallback(() => setFocusedVisible(null), []);

  const tabStop = selected ?? lastFocused;
  // The mouse wins over keyboard focus; either makes a node say what it did.
  const pointed = hovered ?? focusedVisible;
  // Keyboard focus is driving the map: lines and voices change instantly.
  const instant = focusedVisible !== null && hovered === null;
  const labelWidth = labelWidthPx(variant, mapWidth);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const current = (event.target as HTMLElement).dataset?.agent as BrainAgentId | undefined;
    const index = current ? BRAIN_FOCUS_ORDER.indexOf(current) : -1;
    if (index < 0) return;
    const last = BRAIN_FOCUS_ORDER.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    if (next === null) return;
    event.preventDefault();
    buttons.current.get(BRAIN_FOCUS_ORDER[next])?.focus();
  };

  const unit = MAP_VIEWBOX.width / Math.max(1, mapWidth);
  const guardrails = agentsById.get("guardrails");
  const gateTone =
    !loading && guardrails && agentStatusKnown(guardrails, coverage)
      ? guardrails.status === "error"
        ? "error"
        : guardrails.status === "warning"
          ? "warn"
          : "ok"
      : "ok";

  return (
    <div className="relative isolate w-full" style={{ aspectRatio: `${MAP_VIEWBOX.width} / ${MAP_VIEWBOX.height}` }}>
      <svg
        viewBox={`0 0 ${MAP_VIEWBOX.width} ${MAP_VIEWBOX.height}`}
        aria-hidden
        className="absolute inset-0 size-full overflow-visible"
        data-instant={instant ? true : undefined}
      >
        {MAP_EDGES.map((edge) => {
          const bySelection = selected !== null && INCIDENT[selected].has(edge.id);
          const byPointer = pointed !== null && INCIDENT[pointed].has(edge.id);
          const look = connectorLook(
            loading ? "rest" : routeTraffic(agentsById.get(edge.from), coverage),
            bySelection ? "selected" : byPointer ? "hover" : "rest",
            selected !== null && !bySelection
          );
          return <Connector key={edge.id} edge={edge} unit={unit} look={look} assemble={assemble} draw={draw} />;
        })}
      </svg>

      <div aria-hidden className="pointer-events-none absolute inset-0">
        {particles.map((spec) => (
          <MapParticle key={spec.id} spec={spec} mapWidth={mapWidth} handles={handles} onLand={onLand} />
        ))}
      </div>

      <div className="pointer-events-none absolute inset-0 z-20">
        <GateMarker
          ref={gateRef}
          tone={gateTone}
          dimmed={selected !== null && !INCIDENT[selected].has(GATED_EDGE)}
          reduceMotion={reduceMotion}
          assemble={assemble}
        />
        <div role="toolbar" aria-label="Agents, in pipeline order" aria-orientation="horizontal" onKeyDown={onKeyDown}>
          {BRAIN_FOCUS_ORDER.map((id, index) => (
            <MapNode
              key={id}
              id={id}
              agent={agentsById.get(id)}
              variant={variant}
              loading={loading}
              stalled={stalled}
              selected={selected === id}
              located={located === id && selected !== id}
              pointed={pointed === id}
              instant={instant}
              labelWidth={labelWidth}
              dimmed={selected !== null && selected !== id}
              tabbable={tabStop === id}
              live={live}
              index={index}
              now={now}
              coverage={coverage}
              session={session}
              inspectorId={inspectorId}
              assemble={assemble}
              reduceMotion={reduceMotion}
              orbRef={refs[id].orb}
              buttonRef={refs[id].button}
              onToggle={toggle}
              onHover={setHovered}
              onFocusNode={onFocusNode}
              onBlurNode={onBlurNode}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Orb diameter, re-exported for the spine and tests. */
export const ORB_PX = NODE.orb;
