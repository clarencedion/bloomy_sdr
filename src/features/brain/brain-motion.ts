/**
 * Motion vocabulary of the Brain page. Pure values and keyframe builders: no
 * React, no DOM. Every animation on the page takes its timing from here, so the
 * whole map moves with one voice.
 *
 * - Enter and feedback use a strong ease-out; movement across the screen uses
 *   ease-in-out. Nothing uses ease-in.
 * - Springs are critically damped by default. The only overshoot is the catch
 *   kick, because a packet's momentum precedes it.
 */

import type { Point } from "./brain-geometry";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Enter and feedback. */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;
/** Movement on screen. */
export const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const;
export const EASE_OUT_CSS = "cubic-bezier(0.23, 1, 0.32, 1)";
export const EASE_IN_OUT_CSS = "cubic-bezier(0.65, 0, 0.35, 1)";

/** Apple's default: critically damped, no overshoot. */
export const SPRING = { type: "spring", duration: 0.35, bounce: 0 } as const;

export interface KickSpring {
  stiffness: number;
  damping: number;
  /** Added to the current velocity, so repeated kicks never restart from rest. */
  velocity: number;
}

/** The sender lets go of a packet: a small dip to about 0.96. */
export const KICK_RELEASE: KickSpring = { stiffness: 520, damping: 26, velocity: -1.5 };
/**
 * The receiver catches it: a peak of about 1.04 with almost no undershoot (damping
 * ratio ≈ 0.61). Allowed because the packet's momentum preceded it, and calm
 * enough for a page watched for hours.
 */
export const KICK_CATCH: KickSpring = { stiffness: 520, damping: 28, velocity: 2.0 };
/** Mobile: guardrails inspecting work that runs under it. */
export const KICK_PASS: KickSpring = { stiffness: 520, damping: 26, velocity: 1.2 };

/** Damping ratio of a kick spring (1 = critically damped). */
export const dampingRatio = (spring: Pick<KickSpring, "stiffness" | "damping">) =>
  spring.damping / (2 * Math.sqrt(spring.stiffness));

/** Delay between the pulses of one burst, seconds. */
export const BURST_STAGGER_S = 0.14;

/** Distance from an orb's centre at which a packet appears and lands (24px radius + 2). */
export const PACKET_RIM_PX = 26;
/** Same, for the 40px orbs of the mobile spine. */
export const SPINE_RIM_PX = 22;
/** Frames in a packet's keyframe track. */
export const PACKET_FRAMES = 32;

/** Travel time of a packet over its visible length, seconds. */
export const packetDurationS = (visiblePx: number) => clamp(visiblePx / 140, 0.55, 1.0);

/** Draw time of a mobile rail wipe, seconds. */
export const railWipeDurationS = (px: number) => clamp(px / 300, 0.22, 0.45);

// A type alias (not an interface) so it is assignable to WAAPI's `Keyframe`.
export type PacketKeyframe = {
  transform: string;
  offset: number;
};

const SCALE_EDGE = 0.12;

function packetScale(offset: number): number {
  if (offset < SCALE_EDGE) return 0.5 + 0.5 * (offset / SCALE_EDGE);
  if (offset > 1 - SCALE_EDGE) return 0.5 + 0.5 * ((1 - offset) / SCALE_EDGE);
  return 1;
}

/**
 * Keyframes that move a packet along an evenly spaced route (one frame per
 * point). It grows from half size as it leaves the sender and shrinks back as
 * it reaches the receiver, so it reads as handed over, not teleported.
 */
export function packetFrames(pointsPx: Point[]): PacketKeyframe[] {
  const last = pointsPx.length - 1;
  return pointsPx.map((point, index) => {
    const offset = last > 0 ? index / last : 0;
    const scale = packetScale(offset);
    return {
      transform: `translate3d(${point.x.toFixed(2)}px, ${point.y.toFixed(2)}px, 0) scale(${scale.toFixed(3)})`,
      offset: Math.round(offset * 10_000) / 10_000
    };
  });
}

export const PACKET_OPACITY = [
  { opacity: 0, offset: 0 },
  { opacity: 1, offset: 0.12 },
  { opacity: 1, offset: 0.88 },
  { opacity: 0, offset: 1 }
];

export type RippleKind = "receive" | "check" | "alert" | "outcome";

export interface RippleSpec {
  /** Final scale of the ring (it starts at the orb's own size). */
  to: number;
  /** Starting opacity of the ring. */
  from: number;
  durationMs: number;
}

export const RIPPLE: Record<RippleKind, RippleSpec> = {
  receive: { to: 1.5, from: 0.45, durationMs: 600 },
  check: { to: 1.45, from: 0.35, durationMs: 500 },
  alert: { to: 1.7, from: 0.6, durationMs: 900 },
  outcome: { to: 1.9, from: 0.55, durationMs: 1100 }
};

/** Gap between the two rings of an outcome ripple. */
export const OUTCOME_RING_GAP_MS = 180;

/** A handoff's trail: drawn under the packet, then released this fast once it lands. */
export const TRAIL_FADE_MS = 320;
export const TRAIL_OPACITY = 0.45;

/** How long an agent "says" what it just did before its line settles back to the time. */
export const SPEAK_MS = 4_000;

/**
 * Period of every status ping on the page (the CSS `livePing` animation runs
 * for exactly this long). Each ping starts at a negative delay taken from one
 * clock, so all of them beat together, whenever they mounted: one heartbeat.
 */
export const PING_PERIOD_MS = 2_000;

export function pingDelay(clockMs: number): string {
  const phase = ((clockMs % PING_PERIOD_MS) + PING_PERIOD_MS) % PING_PERIOD_MS;
  return `-${Math.round(phase)}ms`;
}

/** The gate's tick when work passes it: a quick swell, larger than the mark itself is small. */
export const GATE_TICK_PEAK = 1.4;

/** Ripple keyframes for a ring centred at (x, y) in its layer. */
export function rippleFrames(x: number, y: number, spec: RippleSpec) {
  const at = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
  return [
    { transform: `${at} scale(1)`, opacity: spec.from },
    { transform: `${at} scale(${spec.to})`, opacity: 0 }
  ];
}
