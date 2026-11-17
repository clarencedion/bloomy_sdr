/**
 * Pure geometry of the Brain map. No React, no DOM: every position, connector
 * and packet route is computed here so it can be unit-tested.
 *
 * The map reads left to right, the way a prospect moves: discovery, research,
 * writing, sending, replies, meetings sit on one horizontal spine. Two agents
 * work beside it rather than on it:
 * - Guardrails sits above the writing → sending connector and inspects it
 *   through the gate drawn on that line: nothing is sent without that check.
 * - Social is a second outbound channel; its only line is the one its work
 *   really takes, into Replies.
 *
 * Every drawn line is either a real `BRAIN_NEXT` flow or the guardrails check.
 */

import type { BrainAgentId } from "@/lib/sdr/brain-model";

export interface Point {
  x: number;
  y: number;
}

/** The order a prospect moves through. */
export const BRAIN_PIPELINE: readonly BrainAgentId[] = [
  "discovery",
  "research",
  "writing",
  "sending",
  "replies",
  "meetings"
];

/** Where an agent's finished work goes next. */
export const BRAIN_NEXT: Readonly<Partial<Record<BrainAgentId, BrainAgentId>>> = {
  discovery: "research",
  research: "writing",
  writing: "sending",
  sending: "replies",
  replies: "meetings",
  social: "replies"
};

// ── Map frame ───────────────────────────────────────────────────────────────

export const MAP_VIEWBOX = { width: 960, height: 352 } as const;
export const SPINE_Y = 240;
export const SATELLITE_Y = 120;

export type MapRole = "spine" | "satellite";

export const MAP_POINTS: Readonly<Record<BrainAgentId, Point & { role: MapRole }>> = {
  discovery: { x: 80, y: SPINE_Y, role: "spine" },
  research: { x: 240, y: SPINE_Y, role: "spine" },
  writing: { x: 400, y: SPINE_Y, role: "spine" },
  sending: { x: 560, y: SPINE_Y, role: "spine" },
  replies: { x: 720, y: SPINE_Y, role: "spine" },
  meetings: { x: 880, y: SPINE_Y, role: "spine" },
  guardrails: { x: 480, y: SATELLITE_Y, role: "satellite" },
  social: { x: 640, y: SATELLITE_Y, role: "satellite" }
};

/** The guardrails check, drawn on the writing → sending connector. */
export const GATE: Point = { x: 480, y: SPINE_Y };

/** Left to right: keyboard order, mobile order and announcement order. */
export const BRAIN_FOCUS_ORDER: readonly BrainAgentId[] = [
  "discovery",
  "research",
  "writing",
  "guardrails",
  "sending",
  "social",
  "replies",
  "meetings"
];

// ── Curves ──────────────────────────────────────────────────────────────────

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function polylineLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
  return total;
}

export function cubicPoint(p0: Point, c1: Point, c2: Point, p1: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * p0.x + b * c1.x + c * c2.x + d * p1.x, y: a * p0.y + b * c1.y + c * c2.y + d * p1.y };
}

/** Tangent direction of a cubic curve at t, in degrees (SVG convention). */
export function cubicAngle(p0: Point, c1: Point, c2: Point, p1: Point, t: number): number {
  const u = 1 - t;
  const dx = 3 * u * u * (c1.x - p0.x) + 6 * u * t * (c2.x - c1.x) + 3 * t * t * (p1.x - c2.x);
  const dy = 3 * u * u * (c1.y - p0.y) + 6 * u * t * (c2.y - c1.y) + 3 * t * t * (p1.y - c2.y);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/** Resamples a polyline into `count` points evenly spaced by arc length. */
export function resampleEvenly(points: Point[], count: number): Point[] {
  if (points.length < 2) return points.slice();
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + distance(points[i - 1], points[i]));
  const total = cumulative[cumulative.length - 1];
  const out: Point[] = [];
  let segment = 1;
  for (let k = 0; k < count; k++) {
    const target = (total * k) / (count - 1);
    while (segment < points.length - 1 && cumulative[segment] < target) segment++;
    const start = cumulative[segment - 1];
    const span = cumulative[segment] - start || 1;
    const f = Math.min(1, Math.max(0, (target - start) / span));
    const a = points[segment - 1];
    const b = points[segment];
    out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  }
  return out;
}

/** Position at progress t ∈ [0, 1] along an evenly resampled route. */
export function samplePoint(points: Point[], t: number): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];
  const clamped = Math.min(1, Math.max(0, t));
  const position = clamped * (points.length - 1);
  const index = Math.min(points.length - 2, Math.floor(position));
  const f = position - index;
  const a = points[index];
  const b = points[index + 1];
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

// ── Edges ───────────────────────────────────────────────────────────────────

export type MapEdgeKind = "pipeline" | "channel" | "guard";

export interface MapEdge {
  id: string;
  kind: MapEdgeKind;
  from: BrainAgentId;
  to: BrainAgentId | "gate";
  d: string;
  /** 64 points evenly spaced by arc length, in viewBox units, centre to centre. */
  points: Point[];
  length: number;
  /** Direction chevron in the visible middle of the line. */
  chevron: { x: number; y: number; angle: number } | null;
  /** Where the gate sits along the edge (0..1), when it does. */
  gateAt?: number;
}

const EDGE_POINTS = 64;
const round = (value: number) => Math.round(value * 10) / 10;

function lineEdge(from: BrainAgentId, to: BrainAgentId, options: { gateAt?: number } = {}): MapEdge {
  const a = MAP_POINTS[from];
  const b = MAP_POINTS[to];
  const points = resampleEvenly([a, b], EDGE_POINTS);
  const chevron = options.gateAt === undefined ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, angle: 0 } : null;
  return {
    id: `pipeline-${from}-${to}`,
    kind: "pipeline",
    from,
    to,
    d: `M${a.x} ${a.y} H${b.x}`,
    points,
    length: distance(a, b),
    chevron,
    ...(options.gateAt === undefined ? {} : { gateAt: options.gateAt })
  };
}

function socialArch(): MapEdge {
  const p0 = MAP_POINTS.social;
  const c1 = { x: 688, y: 120 };
  const c2 = { x: 720, y: 168 };
  const p1 = MAP_POINTS.replies;
  const fine = Array.from({ length: 241 }, (_, i) => cubicPoint(p0, c1, c2, p1, i / 240));
  const mid = cubicPoint(p0, c1, c2, p1, 0.5);
  return {
    id: "channel-social-replies",
    kind: "channel",
    from: "social",
    to: "replies",
    d: `M${p0.x} ${p0.y} C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p1.x} ${p1.y}`,
    points: resampleEvenly(fine, EDGE_POINTS),
    length: polylineLength(fine),
    chevron: { x: round(mid.x), y: round(mid.y), angle: round(cubicAngle(p0, c1, c2, p1, 0.5)) }
  };
}

function guardEdge(): MapEdge {
  const a = MAP_POINTS.guardrails;
  return {
    id: "guard-guardrails-gate",
    kind: "guard",
    from: "guardrails",
    to: "gate",
    d: `M${a.x} ${a.y} V${GATE.y}`,
    points: resampleEvenly([a, GATE], EDGE_POINTS),
    length: distance(a, GATE),
    chevron: null
  };
}

/** Pipeline in order, then the social arch, then the guardrails check. */
export const MAP_EDGES: readonly MapEdge[] = [
  lineEdge("discovery", "research"),
  lineEdge("research", "writing"),
  lineEdge("writing", "sending", { gateAt: 0.5 }),
  lineEdge("sending", "replies"),
  lineEdge("replies", "meetings"),
  socialArch(),
  guardEdge()
];

/** Connectors that touch an agent. Guardrails touch the line they inspect. */
export function incidentEdges(id: BrainAgentId): MapEdge[] {
  return MAP_EDGES.filter(
    (edge) =>
      edge.from === id || edge.to === id || (id === "guardrails" && edge.from === "writing" && edge.to === "sending")
  );
}

/** The connector an agent's finished work travels on, or `null` (guardrails, meetings). */
export function handoffRoute(agentId: BrainAgentId): MapEdge | null {
  const next = BRAIN_NEXT[agentId];
  if (!next) return null;
  return MAP_EDGES.find((edge) => edge.kind !== "guard" && edge.from === agentId && edge.to === next) ?? null;
}

/**
 * Cuts `rimPx` off both ends of a route (so a packet appears at the sender's
 * rim and lands on the receiver's) and resamples it evenly.
 */
export function trimRoute(pointsPx: Point[], rimPx: number, count = 32): Point[] {
  if (pointsPx.length < 2) return pointsPx.slice();
  const even = resampleEvenly(pointsPx, 241);
  const total = polylineLength(even);
  const rim = Math.max(0, Math.min(rimPx, total / 2 - 1));
  const startT = rim / total;
  const endT = 1 - rim / total;
  const span = Array.from({ length: 121 }, (_, i) => samplePoint(even, startT + ((endT - startT) * i) / 120));
  return resampleEvenly(span, count);
}

// ── Responsive variants and label boxes ─────────────────────────────────────

/** Horizontal padding of the canvas around the map. */
export const CANVAS_PAD_X = 24;
export const COMPACT_BELOW_PX = 640;
export const WIDE_FROM_PX = 880;
/** Map width at the widest app content (1024 − 2 borders − 48 padding). */
export const MAP_MAX_WIDTH_PX = 974;

export type MapVariant = "compact" | "medium" | "wide";

/** Variant from the map's own width (card content width − 2 × CANVAS_PAD_X). */
export function mapVariantForWidth(px: number): MapVariant {
  if (!Number.isFinite(px) || px <= 0) return "wide";
  if (px < COMPACT_BELOW_PX) return "compact";
  if (px < WIDE_FROM_PX) return "medium";
  return "wide";
}

/**
 * Node anatomy in map pixels. Every label is name + metric + the agent's
 * "voice": its last action's age at rest (spine only), its last action (up to
 * two lines) for a few seconds when it acts or is pointed at. That slot is
 * always reserved at two lines, so a node never grows or jumps when it speaks.
 */
export const NODE = {
  orb: 48,
  gap: 10,
  line: 16,
  lineGap: 2,
  voice: 32,
  /** Widest label per variant; narrower when neighbours are closer (see `labelWidthPx`). */
  labelWidth: { wide: 136, medium: 104 }
} as const;

/** Clear space kept between two neighbours' labels. */
export const LABEL_GAP_PX = 10;

/** Least vertical padding of the canvas (the wide map's labels sit inside the map). */
export const CANVAS_PAD_MIN_Y = 20;
/** Clear space kept between any label (its voice speaking two lines) and the canvas edge. */
export const CANVAS_EDGE_GAP_PX = 12;

/** Distance between two neighbours on the spine (and between the satellites), in viewBox units. */
const NEIGHBOUR_SPACING = MAP_POINTS.research.x - MAP_POINTS.discovery.x;

/** Width of an agent's label lines: the variant's width, or less when neighbours are closer. */
export function labelWidthPx(variant: "medium" | "wide", mapWidthPx: number): number {
  const spacing = (NEIGHBOUR_SPACING * mapWidthPx) / MAP_VIEWBOX.width;
  return Math.max(0, Math.min(NODE.labelWidth[variant], Math.floor(spacing - LABEL_GAP_PX)));
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Height of the label block under (spine) or over (satellite) an orb: name, metric, voice. */
export function labelHeight(): number {
  return NODE.line * 2 + NODE.lineGap + NODE.lineGap + NODE.voice;
}

export function mapScale(mapWidthPx: number): number {
  return mapWidthPx / MAP_VIEWBOX.width;
}

export function orbCenter(id: BrainAgentId, mapWidthPx: number): Point {
  const scale = mapScale(mapWidthPx);
  return { x: MAP_POINTS[id].x * scale, y: MAP_POINTS[id].y * scale };
}

export function orbBox(id: BrainAgentId, mapWidthPx: number): Box {
  const c = orbCenter(id, mapWidthPx);
  const r = NODE.orb / 2;
  return { left: c.x - r, top: c.y - r, right: c.x + r, bottom: c.y + r };
}

/** The label block's box in map pixels, as rendered (fixed-width lines, centred). */
export function labelBox(id: BrainAgentId, variant: "medium" | "wide", mapWidthPx: number): Box {
  const c = orbCenter(id, mapWidthPx);
  const height = labelHeight();
  const width = labelWidthPx(variant, mapWidthPx);
  const reach = NODE.orb / 2 + NODE.gap;
  const top = MAP_POINTS[id].role === "spine" ? c.y + reach : c.y - reach - height;
  return { left: c.x - width / 2, top, right: c.x + width / 2, bottom: top + height };
}

/**
 * How far the labels reach past the map's top (satellites) and bottom (spine),
 * in map pixels; negative when they stay inside it. Labels keep their pixel
 * size while the map shrinks, so the narrower the map, the further they reach.
 */
export function labelOverhangPx(mapWidthPx: number): { top: number; bottom: number } {
  const mapHeight = MAP_VIEWBOX.height * mapScale(mapWidthPx);
  let top = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const id of BRAIN_FOCUS_ORDER) {
    // Vertical extent does not depend on the variant (only the width does).
    const box = labelBox(id, "medium", mapWidthPx);
    top = Math.max(top, -box.top);
    bottom = Math.max(bottom, box.bottom - mapHeight);
  }
  return { top, bottom };
}

/**
 * Vertical padding of the canvas around the map, the same above and below so
 * the map stays centred: enough to hold the labels that reach past it, plus
 * `CANVAS_EDGE_GAP_PX` of air. It shrinks continuously as the map widens, and
 * meets the wide map's `CANVAS_PAD_MIN_Y` before the variant changes, so
 * nothing jumps at the breakpoint.
 */
export function canvasPadY(mapWidthPx: number): number {
  const { top, bottom } = labelOverhangPx(mapWidthPx);
  return Math.max(CANVAS_PAD_MIN_Y, Math.ceil(Math.max(top, bottom) + CANVAS_EDGE_GAP_PX));
}
