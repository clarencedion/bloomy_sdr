"use client";

/**
 * Live activity: what each agent logged, newest first, in the app's activity
 * row style (tone chip, title, detail, meta). New rows open in and wash blue
 * for a moment, once; the agent's name selects it on the map; pointing at a
 * row locates the agent there. Filtering (an agent selected) swaps the list in
 * one short fade: rows that were already there never replay their entrance.
 */

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { OctagonAlert, TriangleAlert, Workflow, X } from "lucide-react";
import { agentLabel, type BrainAgentId, type BrainAgentState, type BrainEvent } from "@/lib/sdr/brain-model";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { filterEventsByAgent, formatRelativeTime, sortEventsNewestFirst } from "./brain-format";
import { AGENT_ICONS, EVENT_CHIP, TONE_WORD } from "./brain-meta";
import { EASE_OUT, EASE_OUT_CSS, SPRING } from "./brain-motion";

interface BrainEventsProps {
  /** `null` while the first snapshot loads. */
  events: BrainEvent[] | null;
  /** No activity could be read: say so instead of "nothing happened". */
  unavailable?: boolean;
  /** The first read failed: placeholders stop pulsing. */
  stalled?: boolean;
  agents: BrainAgentState[];
  selected: BrainAgentId | null;
  onClearSelected: () => void;
  onSelectAgent: (id: BrainAgentId) => void;
  onHoverAgent: (id: BrainAgentId | null) => void;
  now: Date;
  reduceMotion: boolean;
}

/** Within this distance from the top, a new event scrolls the stream back to it. */
const STICKY_TOP_PX = 64;
/** Rows shown below xl before "Show all" (no nested scroll on small screens). */
const COLLAPSED_ROWS = 8;
const ARRIVAL_WASH = "#EFF6FF";

/** Row entrance: space opens on the page's critically damped spring; words fade in just behind it. */
const ROW_ENTER = { height: SPRING, opacity: { duration: 0.2, delay: 0.06, ease: EASE_OUT } };
/** Exit is faster than entrance. */
const ROW_EXIT = { height: { duration: 0.16, ease: EASE_OUT }, opacity: { duration: 0.12 } };
/** Reduced motion: no growing, only a short fade. */
const ROW_INSTANT = { height: { duration: 0 }, opacity: { duration: 0.15 } };

const EMPTY = "m-4 rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-400";

/**
 * Ids that arrived after the stream first painted. The first readable list is
 * history, not news: it never washes. `null` (loading, or activity that could
 * not be read) forgets the baseline, so a feed coming back after an outage
 * paints its backlog as history too instead of flashing every row at once.
 */
function useArrivals(events: BrainEvent[] | null): ReadonlySet<string> {
  const known = useRef<Set<string> | null>(null);
  const arrived = useMemo(() => {
    if (!events || known.current === null) return new Set<string>();
    return new Set(events.filter((event) => !known.current?.has(event.id)).map((event) => event.id));
  }, [events]);
  useEffect(() => {
    if (!events) {
      known.current = null;
      return;
    }
    if (known.current === null) known.current = new Set();
    for (const event of events) known.current.add(event.id);
  }, [events]);
  return arrived;
}

/**
 * Whether an element currently scrolls (its content overflows it). Re-read on
 * resize of the element or of its content. `content` names what the element
 * holds (skeleton, empty note, one list per filter): when it changes, the new
 * child is the one watched, not the skeleton that was there at mount.
 */
function useScrollable(ref: React.RefObject<HTMLElement | null>, content: string): boolean {
  const [scrollable, setScrollable] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const read = () => setScrollable(element.scrollHeight > element.clientHeight + 1);
    read();
    if (typeof window.ResizeObserver !== "function") return;
    const observer = new window.ResizeObserver(read);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [ref, content]);
  return scrollable;
}

const EventRow = memo(function EventRow({
  event,
  agentName,
  hiddenBelowXl,
  arrived,
  washed,
  now,
  reduceMotion,
  onHoverAgent,
  onSelectAgent
}: {
  event: BrainEvent;
  agentName: string;
  hiddenBelowXl: boolean;
  arrived: boolean;
  /** Ids that already had their wash (or arrived out of view): shared by every list the filter shows. */
  washed: React.RefObject<Set<string>>;
  now: Date;
  reduceMotion: boolean;
  onHoverAgent: (id: BrainAgentId | null) => void;
  onSelectAgent: (id: BrainAgentId) => void;
}) {
  const rowRef = useRef<React.ComponentRef<"li">>(null);
  const Icon =
    event.tone === "error"
      ? OctagonAlert
      : event.tone === "warn"
        ? TriangleAlert
        : event.agentId
          ? AGENT_ICONS[event.agentId]
          : Workflow;

  // A new row washes blue (work moving) once and settles to its resting colour.
  // Kept under reduced motion: it is colour, not movement.
  useEffect(() => {
    const element = rowRef.current;
    if (!arrived || washed.current.has(event.id) || !element || typeof element.animate !== "function") return;
    washed.current.add(event.id);
    const resting = window.getComputedStyle(element).backgroundColor;
    // Held for a beat so the eye finds the new row, then released.
    element.animate(
      [
        { backgroundColor: ARRIVAL_WASH, offset: 0 },
        { backgroundColor: ARRIVAL_WASH, offset: 0.2, easing: EASE_OUT_CSS },
        { backgroundColor: resting, offset: 1 }
      ],
      { duration: 1400 }
    );
  }, [arrived, washed, event.id]);

  const agentId = event.agentId;
  return (
    <motion.li
      ref={rowRef}
      // A new row opens its own space (height) and its words fade in as it does,
      // so rows below are pushed down continuously and never overlap it.
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1, transition: reduceMotion ? ROW_INSTANT : ROW_ENTER }}
      exit={{ height: 0, opacity: 0, transition: reduceMotion ? ROW_INSTANT : ROW_EXIT }}
      className={cn("overflow-hidden", hiddenBelowXl && "max-xl:hidden")}
      onPointerEnter={(pointer) => {
        if (pointer.pointerType === "mouse") onHoverAgent(agentId);
      }}
      onPointerLeave={() => onHoverAgent(null)}
    >
      <div className="flex gap-3 px-5 py-3 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-slate-50">
        <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full", EVENT_CHIP[event.tone])}>
          <Icon className="size-3.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm text-slate-800">
            {event.tone !== "ok" && <span className="sr-only">{TONE_WORD[event.tone]}: </span>}
            {event.title}
          </p>
          {event.detail && <p className="mt-0.5 line-clamp-2 text-[13px] text-slate-500">{event.detail}</p>}
          <p className="mt-1 flex items-center gap-1.5 text-[12px] text-slate-400">
            {agentId ? (
              <button
                type="button"
                onClick={() => onSelectAgent(agentId)}
                className="-my-1 truncate py-1 font-medium text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {agentName}
              </button>
            ) : (
              <span className="font-medium text-slate-500">System</span>
            )}
            <span aria-hidden>·</span>
            <time dateTime={event.at.toISOString()} className="shrink-0 tabular-nums">
              {formatRelativeTime(event.at, now)}
            </time>
          </p>
        </div>
      </div>
    </motion.li>
  );
});

export function BrainEvents({
  events,
  unavailable = false,
  stalled = false,
  agents,
  selected,
  onClearSelected,
  onSelectAgent,
  onHoverAgent,
  now,
  reduceMotion
}: BrainEventsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const washed = useRef(new Set<string>());
  const listShown = useRef(false);
  const [showAll, setShowAll] = useState(false);
  const labels = useMemo(() => new Map(agents.map((agent) => [agent.id, agent.label])), [agents]);
  const visible = useMemo(
    () => (events ? filterEventsByAgent(sortEventsNewestFirst(events), selected) : []),
    [events, selected]
  );
  const arrivals = useArrivals(unavailable ? null : events);
  const scrollable = useScrollable(
    listRef,
    events === null ? "loading" : unavailable ? "unavailable" : visible.length === 0 ? "empty" : `list:${selected ?? "all"}`
  );
  const newestId = visible[0]?.id;

  // Rows wash in their own effects, which run before this one. Whatever
  // arrived is then spent, visible or not: a later filter change remounts rows
  // but never washes them again. Ids that left the window are forgotten.
  useEffect(() => {
    for (const id of arrivals) washed.current.add(id);
    if (!events) return;
    const present = new Set(events.map((event) => event.id));
    for (const id of washed.current) if (!present.has(id)) washed.current.delete(id);
  }, [arrivals, events]);

  // After the first list, a new one (another filter) fades in as a whole.
  const listEnter = listShown.current ? { opacity: 0 } : false;
  useEffect(() => {
    if (visible.length > 0) listShown.current = true;
  }, [visible.length]);

  // The chip leaves when the filter is cleared (by itself or by Escape): if it
  // held focus, focus goes to this card's heading instead of the page.
  useLayoutEffect(() => {
    if (selected) return;
    const chip = chipRef.current;
    if (chip && chip.contains(document.activeElement)) headingRef.current?.focus();
  }, [selected]);

  // Follow the newest event, unless the reader has scrolled down to read older ones.
  useEffect(() => {
    const element = listRef.current;
    if (!element || !newestId) return;
    if (element.scrollTop > 0 && element.scrollTop < STICKY_TOP_PX) {
      element.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    }
  }, [newestId, reduceMotion]);

  const selectedLabel = selected ? (labels.get(selected) ?? agentLabel(selected)) : null;
  const overflow = visible.length > COLLAPSED_ROWS;

  return (
    <section
      id="brain-activity"
      aria-label="Live activity"
      className="flex scroll-mt-20 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white"
    >
      <div className="flex min-h-[45px] items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="rounded-sm text-sm font-semibold text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Live activity
        </h2>
        <AnimatePresence initial={false} mode="popLayout">
          {selectedLabel ? (
            <motion.button
              ref={chipRef}
              key="filter"
              type="button"
              onClick={onClearSelected}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1, transition: { duration: 0.15, ease: EASE_OUT } }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2.5 py-0.5 text-[12px] font-medium text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label={`Showing ${selectedLabel} only. Show all agents`}
            >
              {selectedLabel}
              <X className="size-3" aria-hidden />
            </motion.button>
          ) : events && !unavailable ? (
            events.length > 0 ? (
              <motion.span
                key="count"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: 0.15 } }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
                className="text-[12px] tabular-nums text-slate-400"
              >
                {events.length} recent
              </motion.span>
            ) : null
          ) : null}
        </AnimatePresence>
      </div>

      <div
        ref={listRef}
        role="region"
        aria-label="Activity stream, newest first"
        // A tab stop only where it actually scrolls (xl, with more rows than fit).
        tabIndex={scrollable ? 0 : undefined}
        // `relative`: the scroller is the containing block of the rows' sr-only
        // (absolutely positioned) words. Without it they escape its clip and a
        // warning far down the stream stretches the page into a blank void.
        className="relative overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring xl:max-h-[30rem] xl:overflow-y-auto"
        // A row pushed out (new events, Show fewer) never sends its own leave: clear here too.
        onPointerLeave={() => onHoverAgent(null)}
      >
        {events === null ? (
          <ul className="divide-y divide-slate-100" aria-label="Activity loading">
            {Array.from({ length: 5 }, (_, index) => (
              <li key={index} className="flex gap-3 px-5 py-3" aria-hidden>
                <span className={cn("size-7 shrink-0 rounded-full bg-slate-100", !stalled && "motion-safe:animate-pulse")} />
                <span className="flex-1 space-y-2 pt-1">
                  <span
                    className={cn("block h-3 rounded bg-slate-100", !stalled && "motion-safe:animate-pulse")}
                    style={{ width: `${72 - index * 7}%` }}
                  />
                  <span className={cn("block h-2.5 w-1/4 rounded bg-slate-100", !stalled && "motion-safe:animate-pulse")} />
                </span>
              </li>
            ))}
          </ul>
        ) : unavailable ? (
          <p className={EMPTY}>Activity unavailable. Events will appear once the live feed is back.</p>
        ) : visible.length === 0 ? (
          <p className={EMPTY}>
            {selectedLabel ? `Nothing recent from ${selectedLabel}.` : "No activity yet. Events appear here as agents work."}
          </p>
        ) : (
          // Keyed by the filter: another filter is another list, mounted whole
          // (no row replays its entrance, none exits one by one); within one
          // list, only rows that really arrive open in.
          <motion.ol
            key={selected ?? "all"}
            className="divide-y divide-slate-100"
            initial={listEnter}
            animate={{ opacity: 1, transition: { duration: 0.15, ease: EASE_OUT } }}
          >
            <AnimatePresence initial={false}>
              {visible.map((event, index) => (
                <EventRow
                  key={event.id}
                  event={event}
                  agentName={event.agentId ? (labels.get(event.agentId) ?? agentLabel(event.agentId)) : "System"}
                  hiddenBelowXl={!showAll && index >= COLLAPSED_ROWS}
                  arrived={arrivals.has(event.id)}
                  washed={washed}
                  now={now}
                  reduceMotion={reduceMotion}
                  onHoverAgent={onHoverAgent}
                  onSelectAgent={onSelectAgent}
                />
              ))}
            </AnimatePresence>
          </motion.ol>
        )}
      </div>

      {events && !unavailable && overflow && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-10 w-full rounded-none border-t border-slate-100 text-[13px] text-slate-600 xl:hidden"
          onClick={() => setShowAll((open) => !open)}
          aria-expanded={showAll}
        >
          {showAll ? "Show fewer" : `Show all ${visible.length}`}
        </Button>
      )}
    </section>
  );
}
