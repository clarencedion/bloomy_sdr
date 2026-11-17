/**
 * SDR brain — the visual layer.
 *
 * The view is driven by pure helpers (geometry, formatting, pulse selection)
 * that are tested directly here. The .tsx components are checked at source
 * level: the root tsconfig keeps JSX as "preserve" for Next, so Vitest does not
 * import them, and no DOM runner is configured.
 *
 * Offline: nothing here touches Firebase.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BrainAgentId, BrainAgentState, BrainEvent, BrainPulse } from "@/lib/sdr/brain-model";
import {
  BRAIN_FOCUS_ORDER,
  BRAIN_NEXT,
  BRAIN_PIPELINE,
  CANVAS_EDGE_GAP_PX,
  CANVAS_PAD_MIN_Y,
  COMPACT_BELOW_PX,
  GATE,
  MAP_EDGES,
  MAP_MAX_WIDTH_PX,
  MAP_POINTS,
  MAP_VIEWBOX,
  SATELLITE_Y,
  SPINE_Y,
  WIDE_FROM_PX,
  NODE,
  handoffRoute,
  incidentEdges,
  labelBox,
  labelHeight,
  labelOverhangPx,
  labelWidthPx,
  canvasPadY,
  mapVariantForWidth,
  orbBox,
  orbCenter,
  polylineLength,
  resampleEvenly,
  samplePoint,
  trimRoute,
  type Box,
  type MapEdge
} from "@/features/brain/brain-geometry";
import {
  BURST_STAGGER_S,
  GATE_TICK_PEAK,
  KICK_CATCH,
  KICK_PASS,
  KICK_RELEASE,
  PACKET_FRAMES,
  PACKET_OPACITY,
  PING_PERIOD_MS,
  SPEAK_MS,
  TRAIL_FADE_MS,
  TRAIL_OPACITY,
  dampingRatio,
  packetDurationS,
  packetFrames,
  pingDelay,
  railWipeDurationS
} from "@/features/brain/brain-motion";
import {
  AGENT_ACTIONS,
  CONNECTOR_STROKE,
  EMPTY_VALUE,
  FULL_COVERAGE,
  MAX_PARTICLES,
  NO_RECENT_DATA,
  activityCoverage,
  activityShare,
  admitParticles,
  agentErrorsText,
  agentMetric,
  agentStatusKnown,
  connectorLook,
  coreActivityText,
  coreRateLabel,
  errorBadgeText,
  filterEventsByAgent,
  formatAtLeast,
  formatCount,
  formatRate,
  formatRelativeTime,
  formatUsd,
  isActivityUnavailable,
  lastEventText,
  liveWindowNote,
  routeTraffic,
  selectFreshPulses,
  shortRelative,
  socialSentLabel,
  sortEventsNewestFirst,
  spendGauge,
  statusAnnouncements,
  summarizeAgents
} from "@/features/brain/brain-format";
import { BRAIN_AGENTS } from "@/lib/sdr/brain-model";
import { cn } from "@/lib/utils";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file: string) => fs.readFileSync(path.join(repoRoot, file), "utf8");

const ALL_AGENTS: BrainAgentId[] = [
  "discovery",
  "research",
  "writing",
  "sending",
  "replies",
  "meetings",
  "social",
  "guardrails"
];
function agent(id: BrainAgentId, patch: Partial<BrainAgentState> = {}): BrainAgentState {
  return { id, label: id, role: "role", status: "idle", eventsLastHour: 0, errorsLastHour: 0, ...patch };
}

const DIAGONAL_STEPS = (points: Array<{ x: number; y: number }>) =>
  points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));

function evenlySpaced(points: Array<{ x: number; y: number }>, tolerance = 0.05) {
  const steps = DIAGONAL_STEPS(points);
  const mean = steps.reduce((sum, step) => sum + step, 0) / steps.length;
  for (const step of steps) expect(Math.abs(step - mean)).toBeLessThan(mean * tolerance);
}

const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const inside = (box: Box, point: { x: number; y: number }) =>
  point.x > box.left && point.x < box.right && point.y > box.top && point.y < box.bottom;
const grow = (box: Box, by: number): Box => ({
  left: box.left - by,
  top: box.top - by,
  right: box.right + by,
  bottom: box.bottom + by
});

describe("Brain geometry — the living map", () => {
  it("lists every agent once, in left-to-right order", () => {
    expect([...BRAIN_FOCUS_ORDER].sort()).toEqual([...ALL_AGENTS].sort());
    expect(new Set(BRAIN_FOCUS_ORDER).size).toBe(ALL_AGENTS.length);
    const xs = BRAIN_FOCUS_ORDER.map((id) => MAP_POINTS[id].x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  it("puts the pipeline on one spine, in order, and the two helpers above it", () => {
    expect(BRAIN_PIPELINE).toEqual(["discovery", "research", "writing", "sending", "replies", "meetings"]);
    for (const id of BRAIN_PIPELINE) {
      expect(MAP_POINTS[id].y, id).toBe(SPINE_Y);
      expect(MAP_POINTS[id].role, id).toBe("spine");
    }
    for (const id of ["guardrails", "social"] as const) {
      expect(MAP_POINTS[id].y, id).toBe(SATELLITE_Y);
      expect(MAP_POINTS[id].role, id).toBe("satellite");
    }
    expect(MAP_VIEWBOX).toEqual({ width: 960, height: 352 });
  });

  it("wires the pipeline D → R → W → S → Re → M on the spine, with the gate on W → S", () => {
    const pipeline = MAP_EDGES.filter((edge) => edge.kind === "pipeline");
    expect(pipeline.map((edge) => [edge.from, edge.to])).toEqual(
      BRAIN_PIPELINE.slice(0, -1).map((id, index) => [id, BRAIN_PIPELINE[index + 1]])
    );
    for (const edge of pipeline) {
      for (const point of edge.points) expect(point.y, edge.id).toBe(SPINE_Y);
      if (edge.from === "writing") {
        expect(edge.chevron).toBeNull();
        expect(edge.gateAt).toBe(0.5);
        const atGate = samplePoint(edge.points, edge.gateAt!);
        expect(atGate.x).toBeCloseTo(GATE.x, 5);
        expect(atGate.y).toBeCloseTo(GATE.y, 5);
      } else {
        expect(edge.chevron, edge.id).not.toBeNull();
        expect(edge.gateAt).toBeUndefined();
      }
    }
  });

  it("draws the guardrails check as a line from guardrails down to the gate", () => {
    const guard = MAP_EDGES.filter((edge) => edge.kind === "guard");
    expect(guard).toHaveLength(1);
    expect(guard[0].from).toBe("guardrails");
    expect(guard[0].to).toBe("gate");
    expect(guard[0].points[0]).toEqual({ x: MAP_POINTS.guardrails.x, y: MAP_POINTS.guardrails.y });
    const end = guard[0].points[guard[0].points.length - 1];
    expect(end.x).toBeCloseTo(GATE.x, 5);
    expect(end.y).toBeCloseTo(GATE.y, 5);
    expect(incidentEdges("guardrails").map((edge) => edge.id).sort()).toEqual(
      [guard[0].id, "pipeline-writing-sending"].sort()
    );
  });

  it("draws only real flows: every line is a BRAIN_NEXT pair, and every pair is drawn", () => {
    const flows = MAP_EDGES.filter((edge) => edge.kind !== "guard");
    for (const edge of flows) expect(BRAIN_NEXT[edge.from], edge.id).toBe(edge.to);
    for (const [from, to] of Object.entries(BRAIN_NEXT)) {
      expect(flows.some((edge) => edge.from === from && edge.to === to), `${from} → ${to}`).toBe(true);
    }
    expect(MAP_EDGES.some((edge) => edge.to === "social")).toBe(false);
    expect(MAP_EDGES.find((edge) => edge.from === "social")?.kind).toBe("channel");
  });

  it("routes a handoff on the real connector, centre to centre, at constant speed", () => {
    expect(handoffRoute("guardrails")).toBeNull();
    expect(handoffRoute("meetings")).toBeNull();
    for (const id of ALL_AGENTS) {
      const next = BRAIN_NEXT[id];
      if (!next) continue;
      const route = handoffRoute(id) as MapEdge;
      expect(route.from).toBe(id);
      expect(route.to).toBe(next);
      const start = route.points[0];
      const end = route.points[route.points.length - 1];
      expect(start.x).toBeCloseTo(MAP_POINTS[id].x, 5);
      expect(start.y).toBeCloseTo(MAP_POINTS[id].y, 5);
      expect(end.x).toBeCloseTo(MAP_POINTS[next].x, 5);
      expect(end.y).toBeCloseTo(MAP_POINTS[next].y, 5);
      evenlySpaced(route.points);
      expect(route.length).toBeCloseTo(polylineLength(route.points), 0);
    }
  });

  it("trims a route to start and land on the orbs' rims, still evenly spaced", () => {
    const route = handoffRoute("social") as MapEdge;
    const scale = 0.9;
    const px = route.points.map((point) => ({ x: point.x * scale, y: point.y * scale }));
    const trimmed = trimRoute(px, 26, 32);
    expect(trimmed).toHaveLength(32);
    const from = orbCenter("social", 960 * scale);
    const to = orbCenter("replies", 960 * scale);
    expect(Math.hypot(trimmed[0].x - from.x, trimmed[0].y - from.y)).toBeCloseTo(26, 0);
    const last = trimmed[trimmed.length - 1];
    expect(Math.hypot(last.x - to.x, last.y - to.y)).toBeCloseTo(26, 0);
    evenlySpaced(trimmed);
    const line = trimRoute(
      (handoffRoute("research") as MapEdge).points.map((point) => ({ x: point.x, y: point.y })),
      26
    );
    expect(line[0].x).toBeCloseTo(MAP_POINTS.research.x + 26, 5);
    expect(line[line.length - 1].x).toBeCloseTo(MAP_POINTS.writing.x - 26, 5);
  });

  it("picks the variant from the map's own width", () => {
    expect(COMPACT_BELOW_PX).toBe(640);
    expect(WIDE_FROM_PX).toBe(880);
    expect(mapVariantForWidth(639)).toBe("compact");
    expect(mapVariantForWidth(640)).toBe("medium");
    expect(mapVariantForWidth(879)).toBe("medium");
    expect(mapVariantForWidth(880)).toBe("wide");
    expect(mapVariantForWidth(MAP_MAX_WIDTH_PX)).toBe("wide");
    // App content widths (1024, 1280 and 768 viewports) minus borders and canvas padding.
    expect(mapVariantForWidth(744 - 2 - 48)).toBe("medium");
    expect(mapVariantForWidth(1000 - 2 - 48)).toBe("wide");
    expect(mapVariantForWidth(488 - 2 - 48)).toBe("compact");
    expect(mapVariantForWidth(0)).toBe("wide");
    expect(mapVariantForWidth(Number.NaN)).toBe("wide");
  });

  it("reserves the voice slot at two lines on every map, so a node never grows when it speaks", () => {
    expect(NODE.voice).toBe(2 * NODE.line);
    expect(labelHeight()).toBe(2 * NODE.line + 2 * NODE.lineGap + NODE.voice);
    // Both satellites carry the same stack, so their names line up.
    for (const variant of ["medium", "wide"] as const) {
      const width = variant === "wide" ? 960 : 694;
      const guard = labelBox("guardrails", variant, width);
      const social = labelBox("social", variant, width);
      expect(guard.top).toBe(social.top);
      expect(guard.bottom).toBe(social.bottom);
    }
  });

  it("sizes labels to the room between neighbours, up to the variant's width", () => {
    expect(NODE.labelWidth).toEqual({ wide: 136, medium: 104 });
    // 1024 viewport: 694px map, neighbours 116px apart, labels 104px with a 12px gap.
    expect(labelWidthPx("medium", 694)).toBe(104);
    // The narrowest medium map still keeps 10px between neighbours.
    expect(labelWidthPx("medium", 640)).toBe(96);
    expect(labelWidthPx("wide", 880)).toBe(136);
    expect(labelWidthPx("wide", MAP_MAX_WIDTH_PX)).toBe(136);
  });

  it("pads the canvas by how far the labels reach past the map, plus air (P2-B)", () => {
    // Narrowest medium map (972px viewport): the spine's voices reach ~27px below the map.
    expect(labelOverhangPx(640).bottom).toBeCloseTo(102 - 112 * (640 / 960), 5);
    expect(labelOverhangPx(640).top).toBeCloseTo(102 - 120 * (640 / 960), 5);
    expect(canvasPadY(640)).toBe(40);
    expect(canvasPadY(642)).toBe(40);
    // The wide map's labels stay inside it: the minimum padding holds.
    expect(canvasPadY(880)).toBe(CANVAS_PAD_MIN_Y);
    expect(canvasPadY(MAP_MAX_WIDTH_PX)).toBe(CANVAS_PAD_MIN_Y);
    // Never grows as the map widens, and meets the wide padding before the breakpoint: nothing jumps.
    let previous = Number.POSITIVE_INFINITY;
    for (let width = COMPACT_BELOW_PX; width <= MAP_MAX_WIDTH_PX; width++) {
      const pad = canvasPadY(width);
      expect(pad, `${width}px`).toBeLessThanOrEqual(previous);
      previous = pad;
    }
    expect(canvasPadY(WIDE_FROM_PX - 1)).toBe(canvasPadY(WIDE_FROM_PX));
  });

  const cases: Array<{ variant: "medium" | "wide"; width: number }> = [
    { variant: "medium", width: 640 },
    { variant: "medium", width: 879 },
    { variant: "wide", width: 880 },
    { variant: "wide", width: MAP_MAX_WIDTH_PX }
  ];

  for (const { variant, width } of cases) {
    it(`keeps every label clear at ${width}px (${variant})`, () => {
      const height = (width * MAP_VIEWBOX.height) / MAP_VIEWBOX.width;
      // Labels keep their pixel size while the map shrinks: the canvas padding holds what reaches past it.
      const pad = canvasPadY(width);
      const labels = ALL_AGENTS.map((id) => ({ id, box: labelBox(id, variant, width) }));
      const scale = width / MAP_VIEWBOX.width;
      const gate = { x: GATE.x * scale, y: GATE.y * scale };
      const gateBox: Box = { left: gate.x - 14, top: gate.y - 14, right: gate.x + 14, bottom: gate.y + 14 };
      const connectorPoints = MAP_EDGES.flatMap((edge) =>
        edge.points.map((point) => ({ x: point.x * scale, y: point.y * scale }))
      );

      for (const { id, box } of labels) {
        expect(box.left, `${id} left`).toBeGreaterThanOrEqual(0);
        expect(box.right, `${id} right`).toBeLessThanOrEqual(width);
        // At least 8px (the padding keeps CANVAS_EDGE_GAP_PX) between a label and the card's edge (P2-B).
        expect(box.top + pad, `${id} top edge gap`).toBeGreaterThanOrEqual(8);
        expect(height + pad - box.bottom, `${id} bottom edge gap`).toBeGreaterThanOrEqual(8);
        expect(Math.min(box.top + pad, height + pad - box.bottom)).toBeGreaterThanOrEqual(
          Math.min(CANVAS_EDGE_GAP_PX, CANVAS_PAD_MIN_Y)
        );
        expect(overlaps(box, gateBox), `${id} vs gate`).toBe(false);
        for (const other of ALL_AGENTS) {
          // +6px: the status badge sits on the orb's shoulder.
          expect(overlaps(box, grow(orbBox(other, width), 6)), `${id} label vs ${other} orb`).toBe(false);
        }
        for (const point of connectorPoints) expect(inside(box, point), `${id} label vs connector`).toBe(false);
      }
      for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) {
          expect(overlaps(labels[i].box, labels[j].box), `${labels[i].id}/${labels[j].id}`).toBe(false);
        }
      }
      for (let i = 0; i < ALL_AGENTS.length; i++) {
        for (let j = i + 1; j < ALL_AGENTS.length; j++) {
          const a = orbCenter(ALL_AGENTS[i], width);
          const b = orbCenter(ALL_AGENTS[j], width);
          expect(Math.hypot(a.x - b.x, a.y - b.y), `${ALL_AGENTS[i]}/${ALL_AGENTS[j]}`).toBeGreaterThanOrEqual(64);
        }
      }
    });
  }

  it("never draws a metric wider than the medium label is sized for", () => {
    // The window holds 60 logs, so no agent counts more than 60 an hour.
    const widest = "Warning · 60+/h".length;
    const coverages = [FULL_COVERAGE, { complete: false, hour: false, recent: false }];
    for (const status of ["active", "idle", "warning", "error"] as const) {
      for (const coverage of coverages) {
        for (const eventsLastHour of [0, 9, 60]) {
          const metric = agentMetric(agent("research", { status, eventsLastHour }), coverage);
          expect(metric.length, metric).toBeLessThanOrEqual(widest);
        }
      }
    }
  });

  it("resamples evenly and clamps sampling", () => {
    const points = resampleEvenly(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 }
      ],
      5
    );
    expect(points).toHaveLength(5);
    expect(points[2]).toEqual({ x: 10, y: 0 });
    expect(samplePoint(points, -1)).toEqual({ x: 0, y: 0 });
    expect(samplePoint(points, 2)).toEqual({ x: 10, y: 10 });
  });
});

describe("Brain motion — purposeful and bounded", () => {
  it("clamps packet and wipe durations", () => {
    expect(packetDurationS(0)).toBe(0.55);
    expect(packetDurationS(110)).toBeCloseTo(110 / 140, 5);
    expect(packetDurationS(5000)).toBe(1);
    expect(railWipeDurationS(0)).toBe(0.22);
    expect(railWipeDurationS(100)).toBeCloseTo(1 / 3, 5);
    expect(railWipeDurationS(5000)).toBe(0.45);
  });

  it("builds 32 monotonic packet frames on the compositor (translate3d), half size at both ends", () => {
    const route = trimRoute((handoffRoute("writing") as MapEdge).points, 26, PACKET_FRAMES);
    const frames = packetFrames(route);
    expect(frames).toHaveLength(32);
    for (let i = 1; i < frames.length; i++) expect(frames[i].offset).toBeGreaterThan(frames[i - 1].offset);
    expect(frames[0].offset).toBe(0);
    expect(frames[frames.length - 1].offset).toBe(1);
    for (const frame of frames) expect(frame.transform).toMatch(/^translate3d\(/);
    expect(frames[0].transform).toMatch(/scale\(0\.500\)$/);
    expect(frames[frames.length - 1].transform).toMatch(/scale\(0\.500\)$/);
    expect(frames[16].transform).toMatch(/scale\(1\.000\)$/);
    expect(PACKET_OPACITY[0].opacity).toBe(0);
    expect(PACKET_OPACITY[PACKET_OPACITY.length - 1].opacity).toBe(0);
  });

  it("dips the sender and lets the receiver catch, calmly", () => {
    expect(KICK_RELEASE.velocity).toBeLessThan(0);
    expect(KICK_CATCH.velocity).toBeGreaterThan(0);
    expect(KICK_PASS.velocity).toBeGreaterThan(0);
    // Calm enough to watch for hours: barely any undershoot after the catch.
    expect(dampingRatio(KICK_CATCH)).toBeGreaterThanOrEqual(0.6);
    expect(dampingRatio(KICK_CATCH)).toBeLessThan(1);
    expect(BURST_STAGGER_S).toBeGreaterThan(0);
  });

  it("releases a handoff's trail quickly once the packet lands", () => {
    expect(TRAIL_FADE_MS).toBeLessThanOrEqual(320);
    expect(TRAIL_OPACITY).toBeLessThan(0.5);
    expect(SPEAK_MS).toBe(4000);
    expect(GATE_TICK_PEAK).toBeGreaterThan(1.15);
  });

  it("beats every ping in step: one phase from one clock, whenever it mounted", () => {
    expect(PING_PERIOD_MS).toBe(2000);
    expect(pingDelay(0)).toBe("-0ms");
    expect(pingDelay(2_500)).toBe("-500ms");
    // Mounted 2 periods apart at the same phase: same delay.
    expect(pingDelay(12_345)).toBe(pingDelay(12_345 + 2 * PING_PERIOD_MS));
    // A ping started at clock t with delay -(t mod P) is at phase (now mod P) for every t.
    for (const mountedAt of [0, 731, 1999, 52_004]) {
      const now = 90_123;
      const delayMs = -Number(pingDelay(mountedAt).replace("ms", ""));
      const phase = (now - mountedAt + delayMs) % PING_PERIOD_MS;
      expect(phase).toBeCloseTo(now % PING_PERIOD_MS, 0);
    }
  });
});

describe("Brain format — never invents a number", () => {
  it("renders unknown values as an em dash", () => {
    expect(formatCount(null)).toBe(EMPTY_VALUE);
    expect(formatCount(undefined)).toBe(EMPTY_VALUE);
    expect(formatCount(Number.NaN)).toBe(EMPTY_VALUE);
    expect(formatCount(0)).toBe("0");
    expect(formatCount(12345)).toBe("12,345");
    expect(formatUsd(null)).toBe(EMPTY_VALUE);
    expect(formatUsd(0.4)).toBe("$0.40");
    expect(formatUsd(1234.5)).toBe("$1,235");
  });

  it("formats relative time", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    expect(formatRelativeTime(new Date("2026-11-10T11:59:55Z"), now)).toBe("just now");
    expect(formatRelativeTime(new Date("2026-11-10T12:00:03Z"), now)).toBe("just now");
    expect(formatRelativeTime(new Date("2026-11-10T11:59:30Z"), now)).toBe("30s ago");
    expect(formatRelativeTime(new Date("2026-11-10T11:55:00Z"), now)).toBe("5 min ago");
    expect(formatRelativeTime(new Date("2026-11-10T09:00:00Z"), now)).toBe("3h ago");
    expect(formatRelativeTime(new Date("2026-11-08T12:00:00Z"), now)).toBe("2d ago");
    expect(formatRelativeTime(undefined, now)).toBe(EMPTY_VALUE);
    expect(formatRelativeTime(new Date("nope"), now)).toBe(EMPTY_VALUE);
  });

  it("describes an agent with a word, not only a colour", () => {
    expect(agentMetric(agent("research", { status: "active", eventsLastHour: 12 }))).toBe("Active · 12/h");
    expect(agentMetric(agent("research", { status: "error", eventsLastHour: 3 }))).toBe("Error · 3/h");
    expect(agentMetric(undefined)).toBe("No data");
  });

  it("summarises the agents", () => {
    const summary = summarizeAgents([
      agent("discovery", { status: "active", eventsLastHour: 4 }),
      agent("research", { status: "active", eventsLastHour: 6, errorsLastHour: 0 }),
      agent("sending", { status: "error", eventsLastHour: 2, errorsLastHour: 2 }),
      agent("social", { status: "warning" }),
      agent("meetings")
    ]);
    expect(summary).toMatchObject({ active: 2, error: 1, warning: 1, idle: 1, total: 5, eventsLastHour: 12, errorsLastHour: 2 });
    expect(summary.tone).toBe("error");
    // Most severe first, naming who is in trouble.
    expect(summary.headline).toBe("sending: 2 errors · social needs a look · 2 working");
    expect(summarizeAgents([agent("meetings")]).headline).toBe("All agents idle");
    expect(summarizeAgents([agent("research", { status: "active" })]).headline).toBe("1 agent working");
    expect(
      summarizeAgents([agent("guardrails", { label: "Guardrails", status: "error", errorsLastHour: 1 })]).headline
    ).toBe("Guardrails: 1 error");
    expect(summarizeAgents([agent("guardrails", { label: "Guardrails", status: "error" })]).headline).toBe(
      "Guardrails in error"
    );
    // Beyond two, count rather than name.
    const many = (["discovery", "research", "writing"] as const).map((id) => agent(id, { status: "warning" }));
    expect(summarizeAgents(many).headline).toBe("3 agents need a look");
    expect(summarizeAgents(many.map((item) => ({ ...item, status: "error" as const }))).headline).toBe(
      "3 agents in error"
    );
    // A short window makes error counts floors.
    expect(
      summarizeAgents([agent("sending", { label: "Sending", status: "error", errorsLastHour: 1 })], {
        complete: false,
        hour: false,
        recent: true
      }).headline
    ).toBe("Sending: 1+ errors");
  });

  it("says the hour's activity in plain words", () => {
    expect(coreActivityText(null)).toBe("…");
    expect(coreActivityText([])).toBe(`${EMPTY_VALUE} actions in the last hour`);
    expect(coreActivityText([agent("research", { eventsLastHour: 40 }), agent("discovery", { eventsLastHour: 18 })])).toBe(
      "58 actions in the last hour"
    );
    expect(coreActivityText([agent("research", { eventsLastHour: 1 })])).toBe("1 action in the last hour");
    expect(coreActivityText([agent("research")])).toBe("No actions in the last hour");
    const short = { complete: false, hour: false, recent: true };
    expect(coreActivityText([agent("research", { eventsLastHour: 60 })], short)).toBe("60+ actions in the last hour");
  });

  it("wears each route by the real traffic of the agent sending on it", () => {
    expect(routeTraffic(undefined)).toBe("rest");
    expect(routeTraffic(agent("research"))).toBe("quiet");
    expect(routeTraffic(agent("research", { status: "active", eventsLastHour: 1 }))).toBe("steady");
    expect(routeTraffic(agent("research", { status: "active", eventsLastHour: 9 }))).toBe("steady");
    expect(routeTraffic(agent("research", { status: "active", eventsLastHour: 10 }))).toBe("busy");
    expect(routeTraffic(agent("research", { status: "active", eventsLastHour: 29 }))).toBe("busy");
    expect(routeTraffic(agent("research", { status: "active", eventsLastHour: 30 }))).toBe("busiest");
    // An idle agent the window cannot prove idle keeps the neutral style.
    expect(routeTraffic(agent("research"), { complete: false, hour: false, recent: false })).toBe("rest");
    expect(routeTraffic(agent("research", { eventsLastHour: Number.NaN, status: "active" }))).toBe("rest");
  });

  it("styles each connector from live data, hover and selection (the line follows every change)", () => {
    // Loading: every line is the neutral rest style.
    expect(connectorLook("rest", "rest", false)).toEqual({
      stroke: CONNECTOR_STROKE.rest,
      width: 1.5,
      chevron: CONNECTOR_STROKE.worn,
      opacity: 1
    });
    // Data arrives: a busy sender wears its route darker and thicker.
    const research = agent("research", { status: "active", eventsLastHour: 22 });
    const busy = connectorLook(routeTraffic(research), "rest", false);
    expect(busy).toMatchObject({ stroke: "#94A3B8", width: 2, chevron: "#64748B", opacity: 1 });
    expect(connectorLook("busiest", "rest", false).width).toBe(2.5);
    // Pointing at Research: its worn lines go one step darker, in step with their chevrons.
    const hovered = connectorLook("busy", "hover", false);
    expect(hovered.stroke).toBe("#64748B");
    expect(hovered.chevron).toBe(hovered.stroke);
    // A quiet line under the pointer still darkens, but stays lighter than its chevron.
    expect(connectorLook("quiet", "hover", false)).toMatchObject({ stroke: "#94A3B8", chevron: "#64748B" });
    // Replies selected: its lines are the darkest; every other line recedes.
    expect(connectorLook("steady", "selected", false)).toMatchObject({ stroke: "#64748B", opacity: 1 });
    expect(connectorLook("busy", "rest", true)).toMatchObject({ stroke: "#94A3B8", opacity: 0.45 });
    // At rest the chevron is always one step darker than its line.
    const steps = Object.values(CONNECTOR_STROKE);
    for (const traffic of ["rest", "quiet", "steady", "busy", "busiest"] as const) {
      const look = connectorLook(traffic, "rest", false);
      expect(steps.indexOf(look.chevron as (typeof steps)[number]), traffic).toBe(
        steps.indexOf(look.stroke as (typeof steps)[number]) + 1
      );
    }
  });

  it("gives every agent one place to act, on a route that exists, chosen by role", () => {
    expect(Object.keys(AGENT_ACTIONS).sort()).toEqual([...ALL_AGENTS].sort());
    expect(AGENT_ACTIONS.replies).toEqual({ href: "/app/inbox", label: "Open inbox" });
    expect(AGENT_ACTIONS.writing).toEqual({ href: "/app/approvals", label: "Review approvals" });
    expect(AGENT_ACTIONS.meetings.href).toBe("/app/meetings");
    expect(AGENT_ACTIONS.discovery.href).toBe("/app/campaigns");
    expect(AGENT_ACTIONS.research.href).toBe("/app/campaigns");
    for (const [id, action] of Object.entries(AGENT_ACTIONS)) {
      const route = action.href.replace(/^\/app\//, "");
      expect(fs.existsSync(path.join(repoRoot, "src/app/(app)/app", route, "page.tsx")), `${id} → ${action.href}`).toBe(true);
      expect(action.label, id).toMatch(/^(Open|Review) [a-z]+$/);
    }
  });

  it("names an agent's errors only when there are some, as a floor when the window is short", () => {
    expect(agentErrorsText(0, true)).toBeNull();
    expect(agentErrorsText(undefined, true)).toBeNull();
    expect(agentErrorsText(Number.NaN, true)).toBeNull();
    expect(agentErrorsText(1, true)).toBe("1 error in the last hour");
    expect(agentErrorsText(2, true)).toBe("2 errors in the last hour");
    expect(agentErrorsText(1, false)).toBe("1+ errors in the last hour");
    expect(agentErrorsText(2, false)).toBe("2+ errors in the last hour");
  });

  it("puts a floor on the error badge when the window is short", () => {
    expect(errorBadgeText(3, true)).toBe("3");
    expect(errorBadgeText(3, false)).toBe("3+");
    expect(errorBadgeText(120, true)).toBe("99+");
    expect(errorBadgeText(120, false)).toBe("99+");
    expect(errorBadgeText(0, false)).toBe("!");
    expect(errorBadgeText(undefined, true)).toBe("!");
  });

  it("says activity is unavailable, never \"nothing happened\", when no log could be read", () => {
    // Once logs are read every agent is listed, so an empty list is a failed read.
    expect(summarizeAgents([]).headline).toBe("Activity unavailable");
    expect(isActivityUnavailable({ agents: [] })).toBe(true);
    expect(isActivityUnavailable({ agents: BRAIN_AGENTS.map(({ id }) => agent(id)) })).toBe(false);
    expect(isActivityUnavailable(null)).toBe(false);
    expect(coreRateLabel(null)).toBe("…");
    expect(coreRateLabel([])).toBe(`${EMPTY_VALUE}/h`);
    expect(coreRateLabel([agent("research", { eventsLastHour: 4 }), agent("discovery", { eventsLastHour: 3 })])).toBe("7/h");
    expect(lastEventText(undefined)).toBe(EMPTY_VALUE);
    expect(agentMetric(undefined)).toBe("No data");
  });

  it("measures spend against the cap without inventing one", () => {
    expect(spendGauge(undefined)).toBeNull();
    expect(spendGauge(null)).toBeNull();
    expect(spendGauge({ todayUsd: 1, dailyCapUsd: 4 })).toEqual({ ratio: 0.25, tone: "ok", percent: 25 });
    expect(spendGauge({ todayUsd: 3, dailyCapUsd: 4 })?.tone).toBe("warn");
    expect(spendGauge({ todayUsd: 5, dailyCapUsd: 4 })).toEqual({ ratio: 1, tone: "error", percent: 125 });
    expect(spendGauge({ todayUsd: 2, dailyCapUsd: 0 })).toEqual({ ratio: null, tone: "ok", percent: null });
  });

  it("computes the activity arc from real counts only", () => {
    const agents = [agent("discovery", { eventsLastHour: 10 }), agent("research", { eventsLastHour: 5 })];
    expect(activityShare(agents[0], agents)).toBe(1);
    expect(activityShare(agents[1], agents)).toBe(0.5);
    expect(activityShare(undefined, agents)).toBe(0);
    expect(activityShare(agent("meetings"), [agent("meetings")])).toBe(0);
  });

  it("sorts events newest first and filters them by agent", () => {
    const events: BrainEvent[] = [
      { id: "a", agentId: "research", title: "A", tone: "ok", at: new Date(1000) },
      { id: "b", agentId: "sending", title: "B", tone: "error", at: new Date(3000) },
      { id: "c", agentId: null, title: "C", tone: "warn", at: new Date(2000) }
    ];
    expect(sortEventsNewestFirst(events).map((event) => event.id)).toEqual(["b", "c", "a"]);
    expect(events.map((event) => event.id)).toEqual(["a", "b", "c"]);
    expect(filterEventsByAgent(events, "sending").map((event) => event.id)).toEqual(["b"]);
    expect(filterEventsByAgent(events, null)).toBe(events);
  });
});

describe("Brain format — a short activity window is a floor, not a total", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

  it("measures how far back the window reaches", () => {
    expect(activityCoverage(undefined, now)).toEqual(FULL_COVERAGE);
    expect(activityCoverage(new Date("nope"), now)).toEqual(FULL_COVERAGE);
    expect(activityCoverage(ago(4), now)).toEqual({ complete: false, hour: false, recent: false });
    expect(activityCoverage(ago(20), now)).toEqual({ complete: false, hour: false, recent: true });
    expect(activityCoverage(ago(90), now)).toEqual({ complete: false, hour: true, recent: true });
  });

  it("shows hourly figures as N+ when the window is under an hour", () => {
    const short = activityCoverage(ago(8), now);
    expect(formatAtLeast(60, true)).toBe("60");
    expect(formatAtLeast(60, false)).toBe("60+");
    expect(formatAtLeast(null, false)).toBe(EMPTY_VALUE);
    expect(formatRate(12, false)).toBe("12+/h");
    expect(formatRate(undefined, true)).toBe(`${EMPTY_VALUE}/h`);
    expect(agentMetric(agent("research", { status: "active", eventsLastHour: 60 }), short)).toBe("Active · 60+/h");
    expect(coreRateLabel([agent("research", { status: "active", eventsLastHour: 60 })], short)).toBe("60+/h");
    expect(agentMetric(agent("research", { status: "active", eventsLastHour: 60 }), activityCoverage(ago(61), now))).toBe(
      "Active · 60/h"
    );
  });

  it("never calls an agent idle when the window is too short to prove it", () => {
    const short = activityCoverage(ago(4), now);
    const quiet = agent("meetings");
    expect(agentStatusKnown(quiet, short)).toBe(false);
    expect(agentMetric(quiet, short)).toBe(NO_RECENT_DATA);
    expect(agentStatusKnown(agent("research", { status: "active" }), short)).toBe(true);
    expect(agentStatusKnown(quiet, activityCoverage(ago(16), now))).toBe(true);
    // "At least 0" says nothing: a zero floor reads as unknown.
    expect(agentMetric(quiet, activityCoverage(ago(16), now))).toBe(`Idle · ${EMPTY_VALUE}/h`);
    expect(formatAtLeast(0, false)).toBe(EMPTY_VALUE);
    expect(formatAtLeast(0, true)).toBe("0");
    expect(summarizeAgents([quiet], short).headline).toBe("Nothing in the latest activity");
    expect(summarizeAgents([quiet, agent("research", { status: "active" })], short).headline).toBe("1 agent working");
  });

  it("says \"Nothing recent\" rather than \"Nothing yet\" when older logs are out of view", () => {
    const quiet = agent("meetings");
    expect(lastEventText(quiet, FULL_COVERAGE)).toBe("Nothing yet");
    expect(lastEventText(quiet, activityCoverage(ago(90), now))).toBe("Nothing recent");
  });
});

describe("Brain format — a last event never shows a time without a label", () => {
  it("falls back to a neutral label when only a time is known", () => {
    const at = new Date("2026-11-10T11:59:00Z");
    expect(lastEventText(agent("guardrails", { lastEventAt: at, lastEventLabel: "Email sent to Atelier Nord" }))).toBe(
      "Email sent to Atelier Nord"
    );
    expect(lastEventText(agent("guardrails", { lastEventAt: at }))).toBe("Background work");
    expect(lastEventText(agent("guardrails", { lastEventAt: at }), { complete: false, hour: false, recent: false })).toBe(
      "Background work"
    );
  });
});

describe("Brain format — social session sends", () => {
  it("renders the log-window fallback as a floor", () => {
    expect(socialSentLabel({ sent: 3 })).toBe("3 sent");
    expect(socialSentLabel({ sent: 3, sentIsFloor: false })).toBe("3 sent");
    expect(socialSentLabel({ sent: 0, sentIsFloor: false })).toBe("0 sent");
    expect(socialSentLabel({ sent: 3, sentIsFloor: true })).toBe("3+ sent");
    expect(socialSentLabel({ sent: 0, sentIsFloor: true })).toBe(`${EMPTY_VALUE} sent`);
  });
});

describe("Brain pulses — bounded and never replayed", () => {
  const now = Date.parse("2026-11-10T12:00:00Z");
  const pulse = (id: string, tone: BrainPulse["tone"], agoMs: number): BrainPulse => ({
    id,
    agentId: "research",
    tone,
    label: id,
    at: new Date(now - agoMs)
  });

  it("animates only new, recent pulses, alerts first", () => {
    const fresh = selectFreshPulses(
      [pulse("old", "ok", 60_000), pulse("seen", "ok", 1000), pulse("ok1", "ok", 2000), pulse("err", "error", 500), pulse("warn", "warn", 800), pulse("ok1", "ok", 2000)],
      new Set(["seen"]),
      now
    );
    expect(fresh.map((item) => item.id)).toEqual(["err", "warn", "ok1"]);
  });

  it("ages a pulse from when this client received it, so clock skew cannot hide it", () => {
    // Client clock 5 minutes ahead of the server: server time looks old.
    const skewed: BrainPulse = { ...pulse("skewed", "ok", 5 * 60_000), receivedAt: new Date(now - 1000) };
    expect(selectFreshPulses([skewed], new Set(), now).map((item) => item.id)).toEqual(["skewed"]);
    // Received long ago (e.g. buffered while the graph was disabled): history.
    const stale: BrainPulse = { ...pulse("stale", "ok", 1000), receivedAt: new Date(now - 30_000) };
    expect(selectFreshPulses([stale], new Set(), now)).toEqual([]);
    // Without a receipt stamp, server time is the fallback.
    expect(selectFreshPulses([pulse("legacy", "ok", 1000)], new Set(), now).map((item) => item.id)).toEqual(["legacy"]);
  });

  it("caps particles in flight and never cuts one short", () => {
    const inFlight = Array.from({ length: MAX_PARTICLES - 2 }, (_, index) => ({ id: `p${index}` }));
    const next = admitParticles(inFlight, [{ id: "p0" }, { id: "n1" }, { id: "n2" }, { id: "n3" }]);
    expect(next).toHaveLength(MAX_PARTICLES);
    expect(next.slice(0, inFlight.length)).toEqual(inFlight);
    expect(next.map((item) => item.id)).toContain("n1");
    expect(next.map((item) => item.id)).not.toContain("n3");
    expect(MAX_PARTICLES).toBeLessThanOrEqual(16);
  });
});

describe("Brain format — compact ages, window notes and announcements", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("shortens relative times for tight lines", () => {
    expect(shortRelative(ago(3_000), now)).toBe("now");
    expect(shortRelative(ago(42_000), now)).toBe("42s");
    expect(shortRelative(ago(5 * 60_000), now)).toBe("5 min");
    expect(shortRelative(ago(3 * 3600_000), now)).toBe("3h");
    expect(shortRelative(ago(2 * 86_400_000), now)).toBe("2d");
    expect(shortRelative(undefined, now)).toBe(EMPTY_VALUE);
  });

  it("describes a short live window, and nothing once it reaches an hour", () => {
    expect(liveWindowNote(undefined, now)).toBeNull();
    expect(liveWindowNote(new Date("nope"), now)).toBeNull();
    expect(liveWindowNote(ago(12 * 60_000), now)).toBe("the last 12 min");
    expect(liveWindowNote(ago(20_000), now)).toBe("the last 1 min");
    expect(liveWindowNote(ago(60 * 60_000), now)).toBeNull();
    expect(liveWindowNote(ago(90 * 60_000), now)).toBeNull();
  });

  it("announces only agents entering error or warning", () => {
    const before = [agent("sending", { label: "Sending", status: "active" }), agent("replies", { label: "Replies" })];
    expect(
      statusAnnouncements(before, [
        agent("sending", { label: "Sending", status: "error" }),
        agent("replies", { label: "Replies", status: "warning" })
      ])
    ).toEqual([
      { agentId: "sending", message: "Sending is now in error." },
      { agentId: "replies", message: "Replies has a warning." }
    ]);
    // Routine changes are silent.
    expect(
      statusAnnouncements(before, [
        agent("sending", { label: "Sending", status: "idle" }),
        agent("replies", { label: "Replies", status: "active" })
      ])
    ).toEqual([]);
    // Staying in error is not news.
    const failing = [agent("sending", { label: "Sending", status: "error" })];
    expect(statusAnnouncements(failing, failing)).toEqual([]);
    // No baseline, or an unreadable list: silent.
    expect(statusAnnouncements(null, failing)).toEqual([]);
    expect(statusAnnouncements([], failing)).toEqual([]);
    expect(statusAnnouncements(before, [])).toEqual([]);
  });
});

describe("Brain view — source-level contract", () => {
  const files = [
    "src/features/brain/brain-view.tsx",
    "src/features/brain/brain-graph.tsx",
    "src/features/brain/brain-map.tsx",
    "src/features/brain/brain-spine.tsx",
    "src/features/brain/brain-kpis.tsx",
    "src/features/brain/brain-health.tsx",
    "src/features/brain/brain-events.tsx",
    "src/features/brain/brain-meta.tsx",
    "src/features/brain/brain-number.tsx",
    "src/features/brain/brain-agent-detail.tsx",
    "src/features/brain/brain-motion.ts",
    "src/features/brain/brain-geometry.ts",
    "src/features/brain/brain-format.ts",
    "src/features/brain/brain.module.css"
  ];
  const sources = Object.fromEntries(files.map((file) => [file, read(file)]));
  const view = sources["src/features/brain/brain-view.tsx"];
  const graph = sources["src/features/brain/brain-graph.tsx"];
  const map = sources["src/features/brain/brain-map.tsx"];
  const spine = sources["src/features/brain/brain-spine.tsx"];
  const health = sources["src/features/brain/brain-health.tsx"];
  const css = sources["src/features/brain/brain.module.css"];

  it("exports BrainView with the shared props", () => {
    expect(view).toMatch(/export function BrainView\(\{ snapshot, pulses, error \}: BrainViewProps\)/);
    expect(view).toMatch(/snapshot: BrainSnapshot \| null;/);
    expect(view).toMatch(/pulses: BrainPulse\[\];/);
    expect(view).toMatch(/error: string \| null;/);
  });

  it("is purely presentational: no Firestore, no callables, no polling", () => {
    for (const [file, source] of Object.entries(sources)) {
      expect(source, file).not.toMatch(/firebase/);
      expect(source, file).not.toMatch(/onSnapshot|getDocs|getCountFromServer|httpsCallable/);
      expect(source, file).not.toMatch(/from "@\/features\/brain\/use-brain"|from "\.\/use-brain"/);
    }
    // The only timer is the relative-time clock, and it stops when the tab is hidden.
    expect(view).toMatch(/visibilitychange/);
    expect(view).toMatch(/clearInterval/);
  });

  it("never renders a raw log message", () => {
    for (const [file, source] of Object.entries(sources)) {
      expect(source, file).not.toMatch(/\.message\b/);
    }
  });

  it("stays business-agnostic (Invariant 1)", () => {
    for (const [file, source] of Object.entries(sources)) {
      expect(source, file).not.toMatch(/bloomy|devcomm|florist|biz_/i);
      expect(source, file).not.toMatch(/businessId\s*===|business\.name\s*===/);
    }
  });

  it("is built from the app's own light surfaces, not a separate dark canvas", () => {
    for (const [file, source] of Object.entries(sources)) {
      expect(source, file).not.toMatch(/backdrop-blur|backdrop-filter|bg-gradient-to|radialGradient|#020617/);
      expect(source, file).not.toMatch(/linear-gradient|conic-gradient/);
      // The only gradient is the canvas's faint dot texture and its edge mask, in the CSS module.
      if (file !== "src/features/brain/brain.module.css") expect(source, file).not.toMatch(/radial-gradient/);
    }
    const dotRule = css.slice(css.indexOf(".canvas::before"), css.indexOf("}", css.indexOf(".canvas::before")));
    expect(dotRule).toMatch(/rgb\(148 163 184 \/ 0\.16\)/);
    expect(dotRule).toMatch(/background-size: 24px 24px/);
    expect(css.match(/radial-gradient/g)).toHaveLength(dotRule.match(/radial-gradient/g)?.length ?? -1);
  });

  it("beats one heartbeat: solid status dots, every ping phase-locked", () => {
    for (const [file, source] of Object.entries(sources)) {
      // Status dots never fade: a fading dot reads as another status.
      expect(source, file).not.toMatch(/animate-pulse-dot/);
      expect(source, file).not.toMatch(/animationDelay: `-\$\{index/);
    }
    expect(sources["src/features/brain/brain-meta.tsx"]).toMatch(/pingDelay\(/);
    expect(sources["src/features/brain/brain-meta.tsx"]).toMatch(/export function Ping/);
    expect(view).toMatch(/<Ping /);
    expect(health).toMatch(/<Ping /);
    expect(css).toMatch(/opacity: 0\.35/);
  });

  it("keeps the map clear: no session line, no legend, no shield inside the gate", () => {
    expect(map).not.toMatch(/SessionLine/);
    expect(map).not.toMatch(/ShieldCheck/);
    expect(graph).not.toMatch(/BrainLegend/);
    expect(graph).toMatch(/export function WorkMovingKey/);
    // Agents speak when they act, then settle back to the time.
    expect(map).toMatch(/SPEAK_MS/);
    expect(map).toMatch(/line-clamp-2/);
    // Active agents come forward, idle ones recede.
    const meta = sources["src/features/brain/brain-meta.tsx"];
    expect(meta).toMatch(/active: \{\s*orb: "border-slate-300 bg-white shadow-sm"/);
    expect(meta).toMatch(/idle: \{\s*orb: "border-slate-200 bg-slate-50 shadow-none"/);
  });

  it("draws a trail behind each handoff and wears routes by real traffic", () => {
    expect(map).toMatch(/strokeDashoffset/);
    expect(map).toMatch(/TRAIL_FADE_MS/);
    expect(map).toMatch(/routeTraffic\(agentsById\.get\(edge\.from\), coverage\)/);
  });

  it("keeps the activity stream calm and accessible", () => {
    const events = sources["src/features/brain/brain-events.tsx"];
    expect(events).not.toMatch(/bg-rose-50\/50|bg-amber-50\/40/);
    expect(events).toMatch(/role="region"/);
    expect(events).toMatch(/tabIndex=\{scrollable \? 0 : undefined\}/);
    expect(events).toMatch(/useArrivals\(unavailable \? null : events\)/);
    // A row that unmounts under the pointer never leaves the agent ringed.
    expect(events.match(/onPointerLeave=\{\(\) => onHoverAgent\(null\)\}/g)?.length).toBeGreaterThanOrEqual(2);
    // One persistent live region for the connection state, no stale "Updated" while live.
    expect(view.match(/role="status"/g)).toHaveLength(1);
    expect(view).toMatch(/snapshot && !live &&/);
    // Escape meant for a menu or dialog is not stolen by the map.
    expect(graph).toMatch(/event\.defaultPrevented/);
  });

  it("is titled like its navigation entry", () => {
    expect(view).toMatch(/>Brain<\/h1>/);
    const navigation = read("src/lib/constants/navigation.ts");
    expect(navigation).toMatch(/label: "Brain"/);
  });

  it("respects reduced motion", () => {
    expect(view).toMatch(/useReducedMotion/);
    expect(view).toMatch(/MotionConfig reducedMotion="user"/);
    // No particles at all when the user asked for less motion.
    expect(graph).toMatch(/useParticles\(pulses, !reduceMotion && !loading\)/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toMatch(/\.livePing[\s\S]*animation/);
    for (const [file, source] of Object.entries(sources)) {
      // Tailwind's pulse only runs when motion is allowed.
      expect(source, file).not.toMatch(/(?<!motion-safe:)\banimate-pulse\b/);
      expect(source, file).not.toMatch(/requestAnimationFrame/);
    }
  });

  it("moves the spend bar by transform, with no entrance animation", () => {
    expect(health).toMatch(/translateX\(/);
    expect(health).toMatch(/motion-reduce:transition-none/);
    expect(health).not.toMatch(/\{ width:/);
  });

  it("drops in-flight particles when disabled, and starts fresh on a business switch", () => {
    expect(graph).toMatch(/if \(!enabled\) setParticles\(/);
    const page = read("src/app/(app)/app/brain/page.tsx");
    expect(page).toMatch(/<BrainView[\s\S]*key=\{`\$\{scopeWorkspaceId\}::\$\{scopeBusinessId \?\? ""\}`\}/);
  });

  it("says when activity is unavailable instead of showing zeros", () => {
    expect(view).toMatch(/isActivityUnavailable\(snapshot\)/);
    expect(view).toMatch(/unavailable=\{activityUnavailable\}/);
    const events = sources["src/features/brain/brain-events.tsx"];
    expect(events).toMatch(/Activity unavailable/);
    expect(events).toMatch(/events && !unavailable \?/);
    expect(graph).toMatch(/coreActivityText\(agents, coverage\)/);
    expect(graph).not.toMatch(/"Nothing yet"/);
  });

  it("marks the work queue as covering every business", () => {
    expect(health).toMatch(/text: "All businesses"/);
    expect(health).toMatch(/allBusinesses=\{health\.queueAllBusinesses === true\}/);
    expect(health).toMatch(/socialSentLabel\(session\)/);
  });

  it("caps particles and flies them on the compositor, not React state per frame", () => {
    expect(graph).toMatch(/admitParticles\(current, specs, MAX_PARTICLES\)/);
    expect(map).toMatch(/useMotionValue/);
    expect(map).toMatch(/\.animate\(/);
    expect(map).toMatch(/packetFrames\(/);
    expect(map).toMatch(/rippleFrames\(/);
    expect(sources["src/features/brain/brain-motion.ts"]).toMatch(/translate3d/);
  });

  it("makes every agent on the map a real, labelled button in one toolbar", () => {
    expect(map).toMatch(/<button/);
    expect(map).toMatch(/aria-pressed=\{selected\}/);
    expect(map).toMatch(/role="toolbar"/);
    expect(map).toMatch(/<svg[^>]*aria-hidden/);
    expect(map).toMatch(/aria-label=\{nodeAriaLabel\(/);
  });

  it("makes the phone spine a set of disclosures on a CSS rail, measured only once layout settles", () => {
    expect(spine).toMatch(/aria-expanded=\{open\}/);
    // Points only at a region that exists.
    expect(spine).toMatch(/aria-controls=\{open \? detailId : undefined\}/);
    expect(spine).toMatch(/ResizeObserver/);
    expect(spine).toMatch(/dropAll\(\)/);
    expect(spine).toMatch(/SETTLE_MS/);
    expect(spine).toMatch(/const RAIL = /);
    expect(spine).toMatch(/group-aria-expanded:rotate-180 motion-reduce:transition-none/);
  });

  it("writes each connector's look on every render, never only on its first (P0-1)", () => {
    // A motion component's `style` on an SVG path was applied once and never
    // again: lines stayed at their loading look. The line is a plain path now.
    expect(map).not.toMatch(/motion\.path/);
    const connector = map.slice(map.indexOf("function Connector("), map.indexOf("// ── Map"));
    expect(connector).toMatch(/const style = \{ stroke: look\.stroke, opacity: look\.opacity, strokeWidth: look\.width \* unit \}/);
    expect(connector.match(/style=\{style\}/g)).toHaveLength(2);
    expect(connector).toMatch(/style=\{\{ stroke: look\.chevron, opacity: look\.opacity \}\}/);
    // Drawn in once on WAAPI along a normalised length, holding nothing afterwards.
    expect(connector).toMatch(/pathLength=\{1\}/);
    expect(connector).toMatch(/strokeDashoffset: 1 \}/);
    expect(connector).toMatch(/fill: "backwards"/);
    expect(map).toMatch(/connectorLook\(/);
    // Hover, selection and keyboard focus all reach the lines.
    expect(map).toMatch(/const pointed = hovered \?\? focusedVisible;/);
    expect(map).toMatch(/pointed=\{pointed === id\}/);
  });

  it("keeps colour for problems: active and idle figures are slate (P1-2)", () => {
    const meta = sources["src/features/brain/brain-meta.tsx"];
    expect(meta).toMatch(/active: \{[^}]*metric: "text-slate-600"/);
    expect(meta).toMatch(/idle: \{[^}]*metric: "text-slate-400"/);
    expect(meta).not.toMatch(/metric: "text-emerald/);
  });

  it("shows the selected agent in one compact row with a way to act, never repeating the node (P1-3)", () => {
    const detail = sources["src/features/brain/brain-agent-detail.tsx"];
    expect(detail).not.toMatch(/Events · last hour|Errors · last hour|Last event/);
    expect(detail).not.toMatch(/StatusPill/);
    expect(detail).toMatch(/AGENT_ACTIONS\[id\]/);
    expect(detail).toMatch(/variant="ghost"\s+size="sm"/);
    expect(detail).toMatch(/agentErrorsText\(agent\?\.errorsLastHour, coverage\.hour\)/);
    expect(detail).toMatch(/text-rose-700/);
    expect(graph).toMatch(/px-5 py-3\.5/);
  });

  it("lets the medium map speak, satellites stay quiet at rest, and the key only shows when work can move (P2)", () => {
    expect(map).not.toMatch(/!wide \? null/);
    expect(map).toMatch(/labelWidthPx\(variant, mapWidth\)/);
    expect(map).toMatch(/const rest = above \? null/);
    expect(graph).toMatch(/mapped && !loading && !unavailable && !stalled && !reduceMotion && live/);
    expect(graph).toMatch(/paddingTop: canvasPadY\(mapWidth\), paddingBottom: canvasPadY\(mapWidth\)/);
  });

  it("says when the picture is the last one received (P2-6)", () => {
    expect(view).toMatch(/`Last known: \$\{summary\.headline\}`/);
    expect(graph).toMatch(/const stale = !loading && !live;/);
    expect(graph).toMatch(/opacity-60 saturate-50/);
    expect(graph).toMatch(/transition-\[opacity,filter\] duration-300/);
  });

  it("fits the figures on a phone in three columns, Needs you on its own row (P2-7)", () => {
    const kpis = sources["src/features/brain/brain-kpis.tsx"];
    expect(kpis).toMatch(/const GRID =\s*"grid grid-cols-3 /);
    expect(kpis).toMatch(/NEEDS_YOU_SPAN = "col-span-3 /);
    expect(kpis).toMatch(/px-2\.5 py-3 sm:px-4 sm:py-4/);
    // Wrapped, never cut, on a narrow phone.
    expect(kpis).toMatch(/line-clamp-2 text-\[11px\]/);
    expect(kpis).toMatch(/text-lg font-semibold leading-6/);
  });

  it("keeps the top bar's dot solid, motionless and independent of the Brain feature (P2-10, P2-C)", () => {
    const topbar = read("src/components/layout/topbar.tsx");
    expect(topbar).not.toMatch(/animate-pulse|animate-ping|<Ping\b/);
    // The app shell never depends on a feature module (no brain CSS or framer-motion on every page).
    expect(topbar).not.toMatch(/from "@\/features\//);
    expect(topbar).toMatch(/"size-2 shrink-0 rounded-full", automationPaused \? "bg-slate-300" : "bg-emerald-500"/);
    expect(read("src/app/(app)/app/brain/page.tsx")).not.toMatch(/never part of primary navigation/);
  });

  it("keeps the activity stream's screen-reader words inside its scroller, so the page never scrolls into a void (P1-A)", () => {
    const events = sources["src/features/brain/brain-events.tsx"];
    const scroller = events.match(/aria-label="Activity stream, newest first"[\s\S]*?className="([^"]+)"/);
    expect(scroller).not.toBeNull();
    const classes = (scroller?.[1] ?? "").split(/\s+/);
    // The scroller clips (xl) and is the containing block of the rows' absolutely positioned sr-only spans.
    expect(classes).toContain("xl:overflow-y-auto");
    expect(classes).toContain("relative");
    // The spans it must contain are there: error and warning rows say so to screen readers.
    expect(events).toMatch(/<span className="sr-only">\{TONE_WORD\[event\.tone\]\}: <\/span>/);
  });

  it("gives every map label line the 16px the geometry assumes: leading after the size, never merged away (P2-B)", () => {
    // tailwind-merge drops a line-height that precedes a font-size: the hazard this guards against.
    expect(cn("block truncate leading-4", "text-[13px]")).not.toMatch(/leading-4/);
    expect(cn("block truncate", "text-[13px]", "leading-4")).toMatch(/leading-4/);
    expect(map).toMatch(/const LINE = "block truncate";/);
    expect(map).toMatch(/const LINE_HEIGHT = "leading-4";/);
    expect(map).toMatch(/cn\(LINE, "text-\[13px\] text-slate-900", LINE_HEIGHT,/);
    expect(map).toMatch(/wide \? "text-\[12px\]" : "text-\[11px\]",\s*LINE_HEIGHT,/);
    expect(map).toMatch(/compact \? "text-\[11px\]" : "text-\[12px\]",\s*"leading-4"\s*\)/);
    // A long token (an email address) in a voice wraps and ellipsizes, never cut at the label's edge.
    expect(map).toMatch(/"line-clamp-2 text-balance text-slate-600 \[overflow-wrap:anywhere\]"/);
    // No cn() call in the map puts a leading-* before a later font-size argument.
    for (const call of map.match(/cn\([^)]*\)/g) ?? []) {
      const leading = call.search(/leading-/);
      const size = call.search(/text-\[\d+px\]/);
      if (leading >= 0 && size >= 0) expect(leading, call).toBeGreaterThan(size);
    }
  });

  it("keeps Health's section headers on one row, the eyebrow truncating instead (P3)", () => {
    expect(health).toMatch(/"flex flex-nowrap items-center justify-between gap-2"/);
    expect(health).not.toMatch(/flex flex-wrap items-center justify-between gap-x-2 gap-y-1/);
    // Equal thirds at lg, so the spend header fits at 1024 without truncating its eyebrow.
    expect(health.match(/lg:grid lg:grid-cols-3 /g)).toHaveLength(2);
    expect(health).not.toMatch(/1\.4fr/);
  });

  it("describes a selected node by its role and errors only, and lands focus on the activity heading from the phone", () => {
    expect(map).toMatch(/aria-describedby=\{selected \? `\$\{inspectorId\}-about` : undefined\}/);
    expect(graph).toMatch(/<span id=\{`\$\{inspectorId\}-about`\} hidden>/);
    expect(spine).toMatch(/querySelector<HTMLElement>\("h2\[tabindex='-1'\]"\)\?\.focus\(\{ preventScroll: true \}\)/);
    const events = sources["src/features/brain/brain-events.tsx"];
    // Reduced motion: figures crossfade in place, never jump up or down.
    expect(sources["src/features/brain/brain-number.tsx"]).toMatch(/const dir = useReducedMotion\(\) \? 0 : last\.dir;/);
    // The scroll watcher follows the stream's content, not the skeleton that was there at mount.
    expect(events).toMatch(/\}, \[ref, content\]\);/);
  });

  it("hands focus back when details close, and to the card heading when the filter clears", () => {
    const events = sources["src/features/brain/brain-events.tsx"];
    // Inspector (map) and disclosure (phone) are marked as details; closing them returns focus to the agent.
    expect(graph).toMatch(/data-brain-details/);
    expect(spine).toMatch(/data-brain-details/);
    expect(graph).toMatch(/buttons\.current\.get\(selected \?\? was\)\?\.focus\(\)/);
    expect(map).toMatch(/buttons\.current\.set\(id, element\)/);
    expect(spine).toMatch(/buttons\.current\.set\(id, element\)/);
    // The filter chip leaving with focus hands it to the Live activity heading.
    expect(events).toMatch(/tabIndex=\{-1\}/);
    expect(events).toMatch(/chip\.contains\(document\.activeElement\)\) headingRef\.current\?\.focus\(\)/);
  });

  it("speaks a repeated announcement again (the region is cleared first)", () => {
    expect(view).toMatch(/setText\(""\);/);
    expect(view).toMatch(/setTimeout\(\(\) => setText\(said\.join\(" "\)\), ANNOUNCE_CLEAR_MS\)/);
  });

  it("forgets an agent's speech baseline while it is unreadable, so recovery is not a chorus", () => {
    const speech = map.slice(map.indexOf("function useSpeech("), map.indexOf("const VOICE_VARIANTS"));
    expect(speech).toMatch(/if \(at === null\) \{\s*baseline\.current = null;/);
    expect(speech).toMatch(/setSpeakingAt\(null\);/);
  });

  it("refilters activity without replaying entrances or washes", () => {
    const events = sources["src/features/brain/brain-events.tsx"];
    expect(events).toMatch(/<motion\.ol\s+key=\{selected \?\? "all"\}/);
    expect(events).toMatch(/<AnimatePresence initial=\{false\}>/);
    expect(events).toMatch(/washed\.current\.has\(event\.id\)/);
    expect(events).toMatch(/for \(const id of arrivals\) washed\.current\.add\(id\)/);
  });

  it("shows the error badge as a floor in a short window", () => {
    expect(sources["src/features/brain/brain-meta.tsx"]).toMatch(/errorBadgeText\(errors, errorsExact\)/);
    expect(map).toMatch(/errorsExact=\{coverage\.hour\}/);
    expect(spine).toMatch(/errorsExact=\{coverage\.hour\}/);
  });

  it("renders unknown numbers as a dash", () => {
    expect(sources["src/features/brain/brain-kpis.tsx"]).toMatch(/value === null/);
    expect(sources["src/features/brain/brain-kpis.tsx"]).toMatch(/EMPTY_VALUE/);
    expect(health).toMatch(/EMPTY_VALUE/);
  });
});
