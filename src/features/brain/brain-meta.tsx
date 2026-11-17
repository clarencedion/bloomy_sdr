"use client";

/**
 * Visual vocabulary of the Brain page, in the app's own tokens: white surfaces,
 * slate neutrals, emerald for active or outcome, amber for attention, rose for
 * error. Blue is reserved for work moving and never marks a status.
 * Status is never colour alone: every status also has a word and a glyph.
 *
 * Class strings are written out in full so Tailwind's compiler sees them.
 */

import { useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AtSign,
  CalendarCheck,
  CirclePause,
  MessagesSquare,
  OctagonAlert,
  PenLine,
  Radar,
  ScanSearch,
  Send,
  ShieldCheck,
  TriangleAlert,
  type LucideIcon
} from "lucide-react";
import type { BrainAgentId, BrainAgentStatus, BrainEvent } from "@/lib/sdr/brain-model";
import { cn } from "@/lib/utils";
import { errorBadgeText, statusLabel } from "./brain-format";
import { PING_PERIOD_MS, pingDelay } from "./brain-motion";
import styles from "./brain.module.css";

export const AGENT_ICONS: Record<BrainAgentId, LucideIcon> = {
  discovery: Radar,
  research: ScanSearch,
  writing: PenLine,
  sending: Send,
  replies: MessagesSquare,
  meetings: CalendarCheck,
  social: AtSign,
  guardrails: ShieldCheck
};

export const TONE_WORD: Record<BrainEvent["tone"], string> = {
  ok: "Done",
  warn: "Warning",
  error: "Error"
};

export const NETWORK_LABEL = { instagram: "Instagram", facebook: "Facebook" } as const;

export interface OrbStyle {
  /**
   * Disc border, fill and depth. Fills are opaque so lines and packets pass
   * beneath. Depth is on or off: agents at work sit forward on white with a
   * shadow, idle ones recede onto slate-50 with none (readable in greyscale).
   */
  orb: string;
  icon: string;
  metric: string;
  pill: string;
  PillIcon: LucideIcon | null;
}

export const STATUS_STYLE: Record<BrainAgentStatus, OrbStyle> = {
  active: {
    orb: "border-slate-300 bg-white shadow-sm",
    icon: "text-slate-900",
    // The dot and the word already say "active": colour is kept for problems.
    metric: "text-slate-600",
    pill: "bg-emerald-50 text-emerald-700",
    PillIcon: Activity
  },
  idle: {
    orb: "border-slate-200 bg-slate-50 shadow-none",
    icon: "text-slate-400",
    metric: "text-slate-400",
    pill: "bg-slate-100 text-slate-600",
    PillIcon: CirclePause
  },
  warning: {
    orb: "border-amber-300 bg-amber-50 shadow-sm",
    icon: "text-amber-600",
    metric: "text-amber-700",
    pill: "bg-amber-50 text-amber-700",
    PillIcon: TriangleAlert
  },
  error: {
    orb: "border-rose-300 bg-rose-50 shadow-sm",
    icon: "text-rose-600",
    metric: "text-rose-700",
    pill: "bg-rose-50 text-rose-700",
    PillIcon: OctagonAlert
  }
};

/** Status not provable ("No recent data") or not readable ("No data"). */
export const UNKNOWN_STYLE: OrbStyle = {
  orb: "border-dashed border-slate-300 bg-slate-50 shadow-none",
  icon: "text-slate-400",
  metric: "text-slate-400",
  pill: "bg-slate-100 text-slate-500",
  PillIcon: null
};

/** Before the first snapshot. */
export const LOADING_STYLE: OrbStyle = {
  orb: "border-slate-200 bg-slate-50 shadow-none",
  icon: "text-slate-300",
  metric: "text-slate-400",
  pill: "bg-slate-100 text-slate-500",
  PillIcon: null
};

/** Tone chips of the activity stream (the app's ActivityFeed pattern). */
export const EVENT_CHIP: Record<BrainEvent["tone"], string> = {
  ok: "bg-slate-100 text-slate-600",
  warn: "bg-amber-50 text-amber-600",
  error: "bg-rose-50 text-rose-600"
};

export function StatusPill({
  status,
  emptyLabel = "No data",
  className
}: {
  status: BrainAgentStatus | undefined;
  /** Shown when the status is unknown. */
  emptyLabel?: string;
  className?: string;
}) {
  const style = status ? STATUS_STYLE[status] : UNKNOWN_STYLE;
  const Icon = style.PillIcon;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium",
        style.pill,
        className
      )}
    >
      {Icon && <Icon className="size-3" aria-hidden />}
      {status ? statusLabel(status) : emptyLabel}
    </span>
  );
}

export type SignalKind = BrainAgentStatus | "unknown" | "loading";

/**
 * A soft ring that grows out from behind a status dot. Every ping on the page
 * shares one period and one phase, so they all beat together whenever they
 * appeared: the delay taken from the clock at render gets it close, and once
 * the CSS animation exists its start is pinned to a whole period of the
 * document timeline, so render latency cannot put it out of step.
 * Hidden under reduced motion (CSS), where there is no animation to pin.
 */
export function Ping({ className }: { className?: string }) {
  const ref = useRef<React.ComponentRef<"span">>(null);
  // The same clock as the document timeline (both count from the page's time origin).
  const [delay] = useState(() => pingDelay(typeof window === "undefined" ? Date.now() : window.performance.now()));
  useLayoutEffect(() => {
    const animation = ref.current?.getAnimations?.()[0];
    const now = document.timeline?.currentTime;
    if (!animation || typeof now !== "number") return;
    const delayMs = Number(animation.effect?.getTiming().delay ?? 0);
    // Active time = now − start − delay ≡ now (mod period): the same phase for every ping.
    animation.startTime = Math.floor(now / PING_PERIOD_MS) * PING_PERIOD_MS - delayMs;
  }, []);
  return (
    <span
      ref={ref}
      aria-hidden
      className={cn("absolute inset-0 rounded-full", styles.livePing, className)}
      style={{ animationDelay: delay }}
      // A server render reads another clock; the layout effect re-pins the phase from whatever delay it got.
      suppressHydrationWarning
    />
  );
}

const SIGNAL_SPRING = { type: "spring", duration: 0.25, bounce: 0 } as const;

/**
 * The small status mark on an orb's shoulder. A change swaps it in place: the
 * new mark settles in while the old one fades out faster than it came.
 */
export function StatusSignal({
  kind,
  errors,
  errorsExact,
  live,
  size = "md"
}: {
  kind: SignalKind;
  errors: number;
  /** The window reaches back an hour: the count is exact, else it is a floor ("3+"). */
  errorsExact: boolean;
  /** Ping only while the live feed is connected: liveness proportional to truth. */
  live: boolean;
  size?: "md" | "sm";
}) {
  if (kind === "loading") return null;
  const dotPlace = size === "md" ? "-right-0.5 -top-0.5" : "-right-1 -top-1";
  return (
    <AnimatePresence initial={false} mode="popLayout">
      <motion.span
        key={kind}
        aria-hidden
        className={cn(
          "absolute",
          kind === "warning" && "-right-1 -top-1",
          kind === "error" && "-right-1.5 -top-1.5",
          (kind === "active" || kind === "idle" || kind === "unknown") && dotPlace
        )}
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1, transition: SIGNAL_SPRING }}
        exit={{ opacity: 0, transition: { duration: 0.12 } }}
      >
        {kind === "active" && (
          <span className="relative block size-2.5">
            {live && <Ping className="bg-emerald-500" />}
            <span className="relative block size-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
          </span>
        )}
        {kind === "idle" && <span className="block size-2.5 rounded-full bg-slate-300 ring-2 ring-white" />}
        {kind === "unknown" && (
          <span className="block size-2.5 rounded-full border border-slate-300 bg-white ring-2 ring-white" />
        )}
        {kind === "warning" && (
          <span className="grid size-4 place-items-center rounded-full bg-amber-500 text-[10px] font-bold leading-none text-white ring-2 ring-white">
            !
          </span>
        )}
        {kind === "error" && (
          <span className="block h-4 min-w-4 rounded-full bg-rose-500 px-1 text-center text-[10px] font-semibold leading-4 tabular-nums text-white ring-2 ring-white">
            {errorBadgeText(errors, errorsExact)}
          </span>
        )}
      </motion.span>
    </AnimatePresence>
  );
}
