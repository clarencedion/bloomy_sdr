"use client";

/**
 * Small text primitives that make figures and words react to change without
 * ever inventing an in-between value: a number rolls to its new text like an
 * odometer (direction hints up or down), a "+N" chip says by how much, and a
 * line of text crossfades when the agent says something new.
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "framer-motion";
import { cn } from "@/lib/utils";
import { formatCount } from "./brain-format";
import { EASE_OUT } from "./brain-motion";

function makeRoll(enterS: number, exitS: number): Variants {
  return {
    enter: (dir: number) => ({ y: `${dir * 40}%`, opacity: 0, filter: "blur(2px)" }),
    center: { y: "0%", opacity: 1, filter: "blur(0px)", transition: { duration: enterS, ease: EASE_OUT } },
    // Resolved with AnimatePresence's latest `custom`, so a leaving figure
    // always exits in the direction of the change that replaced it.
    exit: (dir: number) => ({
      y: `${-dir * 40}%`,
      opacity: 0,
      filter: "blur(2px)",
      transition: { duration: exitS, ease: EASE_OUT }
    })
  };
}

const ROLL: Record<"kpi" | "node", Variants> = { kpi: makeRoll(0.22, 0.14), node: makeRoll(0.18, 0.12) };

/**
 * A figure that rolls to its new text. `value` gives the direction (up rolls
 * up, down rolls down, unknown only fades); `text` is what is shown, already
 * formatted ("12", "60+", "—"). Screen readers get the final text only.
 */
export function RollingNumber({
  value,
  text,
  size = "kpi",
  className
}: {
  value?: number | null;
  text: string;
  size?: "kpi" | "node";
  className?: string;
}) {
  const [last, setLast] = useState({ text, value, dir: 0 });
  if (last.text !== text) {
    const before = last.value;
    const dir = typeof before === "number" && typeof value === "number" && before !== value ? Math.sign(value - before) : 0;
    setLast({ text, value, dir });
  }
  // Reduced motion: a plain crossfade. Without this the figure leaving would
  // not glide but jump 40% up (transforms are skipped, not slowed) and fade there.
  const dir = useReducedMotion() ? 0 : last.dir;

  return (
    <span className={cn("relative inline-grid overflow-hidden [&>*]:col-start-1 [&>*]:row-start-1", className)}>
      <AnimatePresence initial={false} custom={dir}>
        <motion.span
          key={text}
          aria-hidden
          custom={dir}
          variants={ROLL[size]}
          initial="enter"
          animate="center"
          exit="exit"
          className="whitespace-nowrap"
        >
          {text}
        </motion.span>
      </AnimatePresence>
      <span className="sr-only">{text}</span>
    </span>
  );
}

const DELTA_HOLD_MS = 2400;

/**
 * "+N" beside a figure that just went up. Increases within the hold window add
 * up and restart it; the chip then fades away. Decorative: the figure itself
 * carries the value for screen readers.
 */
export function DeltaChip({ value, tone = "ok" }: { value: number | null; tone?: "ok" | "attention" }) {
  const [delta, setDelta] = useState(0);
  const previous = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const before = previous.current;
    previous.current = value;
    if (typeof before !== "number" || typeof value !== "number" || value <= before) return;
    setDelta((current) => current + (value - before));
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDelta(0), DELTA_HOLD_MS);
  }, [value]);

  useEffect(
    () => () => {
      if (timer.current !== undefined) clearTimeout(timer.current);
    },
    []
  );

  return (
    <AnimatePresence>
      {delta > 0 && (
        <motion.span
          key="delta"
          aria-hidden
          className={cn(
            "text-[12px] font-medium leading-none tabular-nums tracking-normal",
            tone === "attention" ? "text-amber-700" : "text-emerald-600"
          )}
          initial={{ opacity: 0, y: 2 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.15, ease: EASE_OUT } }}
          exit={{ opacity: 0, transition: { duration: 0.3 } }}
        >
          +{formatCount(delta)}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/**
 * A line that crossfades (with a 2px blur bridge) when its key changes, e.g. an
 * agent's last action. The old line leaves upward, faster than the new one
 * arrives.
 */
export function CrossfadeText({ text, k, className }: { text: string; k: string; className?: string }) {
  return (
    <span className={cn("inline-grid min-w-0 grid-cols-[minmax(0,1fr)] [&>*]:col-start-1 [&>*]:row-start-1", className)}>
      <AnimatePresence initial={false}>
        <motion.span
          key={k}
          className="truncate"
          title={text}
          initial={{ opacity: 0, y: 4, filter: "blur(2px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.22, ease: EASE_OUT } }}
          exit={{ opacity: 0, y: -4, filter: "blur(2px)", transition: { duration: 0.12, ease: EASE_OUT } }}
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
