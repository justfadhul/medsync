import type { Link, Part, Path, Zone } from "@/content/sensor";

import { PATH_COLOURS, PUMP_NODE } from "@/content/sensor";
import { ALL_NODES } from "@/lib/nodes";

/**
 * Layout and routing for the two node diagrams (Parts, and Who talks to whom).
 *
 * This module is pure: no React, no side effects, no randomness, no reading of
 * the document. The same input always gives the same coordinates, which is what
 * lets the routing be unit tested and lets a packet be placed on a link without
 * asking the browser for the geometry of a path.
 *
 * Nothing here holds copy. Every name, label and colour token is read from
 * src/content/sensor.ts.
 */

/* ------------------------------------------------------------------ */
/* Geometry constants                                                  */
/* ------------------------------------------------------------------ */

/** Height of a node box. */
export const NODE_H = 52;
/** Corner radius of a node box. */
export const NODE_RADIUS = 8;
/** Vertical distance from one row to the next. */
export const ROW_STEP = 68;
/** Top edge of row 0. */
export const FIRST_ROW_Y = 84;
/** Baseline the zone heading sits on, above row 0. */
export const ZONE_HEADER_Y = 62;

/** Stroke width of a drawn connector, and of the sample of it in a legend. */
export const LINK_STROKE = 1.5;

/** Radius of the quadratic corner that softens a right angle on a link. */
export const CORNER_RADIUS = 6;
/** Gap between the column and the first vertical lane beside it. */
export const LANE_OFFSET = 16;
/** Distance between one vertical lane and the next. */
export const LANE_GAP = 14;
/**
 * Closest two vertical lanes in the same gutter may sit. Below this they read
 * as one thick line rather than as two separate signals.
 */
export const MIN_LANE_SEPARATION = 12;

/**
 * Distance between the two lines of a pair of links that connect the same two
 * parts in opposite directions and would otherwise draw on top of each other.
 * Each line is moved half of this, one to each side of the shared route.
 */
export const PAIR_SEPARATION = 10;

/** Number of straight chords a rounded corner is flattened into for walking. */
const CORNER_CHORDS = 6;

/**
 * Columns run in this order, left to right. It is a layout decision rather than
 * content, so it lives here: the cavity is furthest from the reader, the world
 * outside the body is nearest.
 */
export const ZONE_COLUMN_ORDER: Zone[] = ["cavity", "housing", "outside"];

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface Point {
  x: number;
  y: number;
}

export interface LayoutPreset {
  /** Width of every node box in this preset. */
  nodeWidth: number;
  /** Left edge of each column, in column order. */
  columnLeftX: number[];
  viewBox: { width: number; height: number };
}

export interface GraphNode {
  id: number;
  part: Part;
  zone: Zone;
  column: number;
  row: number;
  /** Left edge. */
  x: number;
  /** Top edge. */
  y: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
  isPump: boolean;
}

export interface GraphLayout {
  nodes: GraphNode[];
  byId: Map<number, GraphNode>;
  viewBox: { width: number; height: number };
  nodeWidth: number;
  columnLeftX: number[];
  zoneHeaderY: number;
}

export type LinkKind = "adjacent" | "lane" | "cross";

/** One straight piece of a routed path, kept so a packet can be walked along it. */
export interface PathSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  length: number;
}

export interface RoutedLink {
  link: Link;
  from: GraphNode;
  to: GraphNode;
  /** The SVG path data, corners softened with a quadratic curve. */
  d: string;
  /** The same path as straight chords, in order, for packetPointAt. */
  segments: PathSegment[];
  /** Where a tooltip or a moving packet anchors. */
  midpoint: Point;
  key: string;
  kind: LinkKind;
  /** The vertical lane this link runs in, or null when it has no lane. */
  laneX: number | null;
}

export interface PathClasses {
  stroke: string;
  fill: string;
  text: string;
  chip: string;
}

/* ------------------------------------------------------------------ */
/* Presets                                                             */
/* ------------------------------------------------------------------ */

/**
 * 784 is FIRST_ROW_Y + 10 * ROW_STEP + 20 of bottom padding: room for the ten
 * rows of the tallest column and a clear edge under the last box.
 */
const VIEWBOX_HEIGHT = FIRST_ROW_Y + 10 * ROW_STEP + 20;

/** Parts screen: three even columns, no room needed for crossing lanes. */
export const PARTS_LAYOUT: LayoutPreset = {
  nodeWidth: 200,
  columnLeftX: [16, 292, 568],
  viewBox: { width: 784, height: VIEWBOX_HEIGHT },
};

/** Links screen: wider gutters and a margin on the right for the lanes. */
export const LINKS_LAYOUT: LayoutPreset = {
  nodeWidth: 200,
  columnLeftX: [16, 348, 680],
  viewBox: { width: 950, height: VIEWBOX_HEIGHT },
};

/* ------------------------------------------------------------------ */
/* Node placement                                                      */
/* ------------------------------------------------------------------ */

/** The virtual pump's id: the one node that is not one of the parts. */
const PUMP_ID = PUMP_NODE.id;

/** Left edge of a column, or an error if the preset does not define it. */
function columnLeft(columnLeftX: number[], column: number): number {
  const left = columnLeftX[column];
  if (left === undefined) {
    throw new Error(`No column ${column} in this layout preset.`);
  }
  return left;
}

/** Right edge of a column. */
export function columnRight(layout: GraphLayout, column: number): number {
  return columnLeft(layout.columnLeftX, column) + layout.nodeWidth;
}

/**
 * Place every node. Zones become columns in ZONE_COLUMN_ORDER, and within a
 * column the rows follow ascending part id. The pump carries the housing zone
 * and the highest id, so it lands at the foot of the housing column.
 */
export function buildLayout(preset: LayoutPreset): GraphLayout {
  const parts: Part[] = ALL_NODES;
  const nodes: GraphNode[] = [];

  ZONE_COLUMN_ORDER.forEach((zone, column) => {
    const x = columnLeft(preset.columnLeftX, column);
    const inZone = parts.filter((part) => part.zone === zone).sort((a, b) => a.id - b.id);

    inZone.forEach((part, row) => {
      const y = FIRST_ROW_Y + row * ROW_STEP;
      nodes.push({
        id: part.id,
        part,
        zone,
        column,
        row,
        x,
        y,
        width: preset.nodeWidth,
        height: NODE_H,
        cx: x + preset.nodeWidth / 2,
        cy: y + NODE_H / 2,
        isPump: part.id === PUMP_ID,
      });
    });
  });

  const byId = new Map<number, GraphNode>();
  for (const node of nodes) byId.set(node.id, node);

  return {
    nodes,
    byId,
    viewBox: preset.viewBox,
    nodeWidth: preset.nodeWidth,
    columnLeftX: [...preset.columnLeftX],
    zoneHeaderY: ZONE_HEADER_Y,
  };
}

/* ------------------------------------------------------------------ */
/* Path building                                                       */
/* ------------------------------------------------------------------ */

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function segment(a: Point, b: Point): PathSegment {
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, length: distance(a, b) };
}

/** Move from `origin` towards `towards` by `amount`, in absolute coordinates. */
function towardsBy(origin: Point, towards: Point, amount: number): Point {
  const span = distance(origin, towards);
  if (span === 0) return { x: origin.x, y: origin.y };
  const fraction = amount / span;
  return {
    x: origin.x + (towards.x - origin.x) * fraction,
    y: origin.y + (towards.y - origin.y) * fraction,
  };
}

/** Drop repeated points and points that sit on the line between their neighbours. */
function simplify(points: Point[]): Point[] {
  const kept: Point[] = [];
  for (const point of points) {
    const last = kept[kept.length - 1];
    if (last && last.x === point.x && last.y === point.y) continue;
    kept.push({ x: point.x, y: point.y });
  }

  const straightened: Point[] = [];
  for (let i = 0; i < kept.length; i += 1) {
    const previous = straightened[straightened.length - 1];
    const current = kept[i];
    const next = kept[i + 1];
    if (!current) continue;
    if (previous && next) {
      const cross =
        (current.x - previous.x) * (next.y - previous.y) -
        (current.y - previous.y) * (next.x - previous.x);
      if (cross === 0) continue;
    }
    straightened.push(current);
  }
  return straightened;
}

function quadraticPoint(start: Point, control: Point, end: Point, t: number): Point {
  const inverse = 1 - t;
  return {
    x: inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
    y: inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y,
  };
}

/**
 * Turn a run of orthogonal points into an SVG path with softened corners, and
 * into the straight chords that describe the same shape. The chords are what
 * packetPointAt walks, so a packet stays on the drawn line without the browser.
 */
function buildPath(rawPoints: Point[]): { d: string; segments: PathSegment[] } {
  const points = simplify(rawPoints);
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return { d: "", segments: [] };
  if (points.length < 2) {
    return { d: `M ${round(first.x)} ${round(first.y)}`, segments: [] };
  }

  let d = `M ${round(first.x)} ${round(first.y)}`;
  const segments: PathSegment[] = [];
  let cursor: Point = first;

  for (let i = 1; i < points.length - 1; i += 1) {
    const previous = points[i - 1];
    const corner = points[i];
    const next = points[i + 1];
    if (!previous || !corner || !next) continue;

    const radius = Math.min(
      CORNER_RADIUS,
      distance(previous, corner) / 2,
      distance(corner, next) / 2,
    );
    const entry = towardsBy(corner, previous, radius);
    const exit = towardsBy(corner, next, radius);

    d += ` L ${round(entry.x)} ${round(entry.y)}`;
    d += ` Q ${round(corner.x)} ${round(corner.y)} ${round(exit.x)} ${round(exit.y)}`;

    segments.push(segment(cursor, entry));
    let chordStart = entry;
    for (let step = 1; step <= CORNER_CHORDS; step += 1) {
      const chordEnd =
        step === CORNER_CHORDS ? exit : quadraticPoint(entry, corner, exit, step / CORNER_CHORDS);
      segments.push(segment(chordStart, chordEnd));
      chordStart = chordEnd;
    }
    cursor = exit;
  }

  d += ` L ${round(last.x)} ${round(last.y)}`;
  segments.push(segment(cursor, last));

  return { d, segments };
}

/* ------------------------------------------------------------------ */
/* Link routing                                                        */
/* ------------------------------------------------------------------ */

interface WorkingLink {
  link: Link;
  from: GraphNode;
  to: GraphNode;
  kind: LinkKind;
  span: number;
  laneX: number | null;
}

function orderForLanes(a: WorkingLink, b: WorkingLink): number {
  // Longest run first, then by part id so the order never depends on chance.
  return b.span - a.span || a.link.from - b.link.from || a.link.to - b.link.to;
}

function orderForGutter(a: WorkingLink, b: WorkingLink): number {
  return (
    a.from.row - b.from.row ||
    a.to.row - b.to.row ||
    a.link.from - b.link.from ||
    a.link.to - b.link.to
  );
}

/**
 * Route the whole link set at once, so lanes are allocated across all of the
 * links that share a column or a gutter and never sit on top of one another.
 *
 * Same column, one row apart: a straight line down the middle of the column.
 * Same column, further apart: out of the right edge, down a lane to the right
 * of the column, back in through the right edge.
 * Different columns: out of the edge facing the target, across to a lane in the
 * gutter, along the lane, then into the edge facing the source.
 */
export function routeLinks(layout: GraphLayout, links: Link[]): RoutedLink[] {
  const working: WorkingLink[] = [];

  for (const link of links) {
    const from = layout.byId.get(link.from);
    const to = layout.byId.get(link.to);
    if (!from || !to) continue;

    const sameColumn = from.column === to.column;
    const span = Math.abs(from.row - to.row);
    const kind: LinkKind = !sameColumn ? "cross" : span === 1 ? "adjacent" : "lane";
    working.push({ link, from, to, kind, span, laneX: null });
  }

  // Lanes are allocated from ONE pool per gutter, holding both the same-column
  // lanes that leave the column on its right and the crossing lanes that pass
  // through. Allocating the two kinds separately let them land within a few
  // pixels of each other, and two signals a few pixels apart read as one thick
  // line rather than as two.
  //
  // Within a pool, same-column lanes sit nearer their own column and crossing
  // lanes further out. Among the same-column lanes the longest run sits
  // furthest from the column, so a long run never crosses a short one.
  const pools = new Map<number, WorkingLink[]>();
  const poolFor = (gutter: number): WorkingLink[] => {
    const pool = pools.get(gutter) ?? [];
    pools.set(gutter, pool);
    return pool;
  };
  for (const item of working) {
    if (item.kind === "lane") poolFor(item.from.column).push(item);
    if (item.kind === "cross") poolFor(Math.min(item.from.column, item.to.column)).push(item);
  }

  for (const [gutter, pool] of pools) {
    const gutterLeft = columnRight(layout, gutter);
    // The last column has no column to its right, so its lanes run in the
    // margin between it and the edge of the drawing.
    const nextLeft = layout.columnLeftX[gutter + 1];
    const gutterRight = nextLeft === undefined ? layout.viewBox.width : nextLeft;

    const inner = pool.filter((item) => item.kind === "lane").sort(orderForLanes);
    const outer = pool.filter((item) => item.kind === "cross").sort(orderForGutter);
    // Descending span first, numbered from the outside in, then the crossing
    // lanes beyond them.
    const ordered = [...inner.slice().reverse(), ...outer];

    const spanStart = gutterLeft + LANE_OFFSET;
    const spanEnd = gutterRight - LANE_OFFSET;
    const available = Math.max(0, spanEnd - spanStart);
    const gaps = ordered.length - 1;
    // Even spacing where the gutter allows it, never closer than the minimum.
    const step = gaps <= 0 ? 0 : Math.max(MIN_LANE_SEPARATION, available / Math.max(gaps, 1));
    const used = step * gaps;
    // Centre the run of lanes in the gutter when they do not fill it.
    const start =
      gaps <= 0
        ? gutterLeft + (gutterRight - gutterLeft) / 2
        : spanStart + Math.max(0, (available - used) / 2);

    ordered.forEach((item, index) => {
      item.laneX = start + step * index;
    });
  }

  // Two parts can talk to each other both ways (the optical module flashes the
  // tip, the tip glows back). When both nodes sit on the same row, the two
  // routes are the same straight line, so the reader sees one line with an
  // arrow at each end and two focus targets stacked on the same pixels. Move
  // each line half of PAIR_SEPARATION to its own side of the shared route.
  const pairOffsets = new Map<WorkingLink, number>();
  const pairs = new Map<string, WorkingLink[]>();
  for (const item of working) {
    const key = [item.from.id, item.to.id].sort((a, b) => a - b).join(":");
    const group = pairs.get(key) ?? [];
    group.push(item);
    pairs.set(key, group);
  }
  for (const group of pairs.values()) {
    if (group.length < 2) continue;
    // Ordered by the direction of travel, so the layout never depends on the
    // order the links happen to arrive in.
    const ordered = [...group].sort((a, b) => a.link.from - b.link.from || a.link.to - b.link.to);
    ordered.forEach((item, index) => {
      pairOffsets.set(item, (index - (ordered.length - 1) / 2) * PAIR_SEPARATION);
    });
  }

  return working.map((item) => {
    const { from, to } = item;
    let points: Point[];
    let midpoint: Point;

    if (item.kind === "adjacent") {
      const downwards = from.row < to.row;
      const startY = downwards ? from.y + from.height : from.y;
      const endY = downwards ? to.y : to.y + to.height;
      points = [
        { x: from.cx, y: startY },
        { x: to.cx, y: endY },
      ];
      midpoint = { x: from.cx, y: (startY + endY) / 2 };
    } else if (item.kind === "lane") {
      const laneX = item.laneX ?? columnRight(layout, from.column) + LANE_OFFSET;
      points = [
        { x: from.x + from.width, y: from.cy },
        { x: laneX, y: from.cy },
        { x: laneX, y: to.cy },
        { x: to.x + to.width, y: to.cy },
      ];
      midpoint = { x: laneX, y: (from.cy + to.cy) / 2 };
    } else {
      const targetIsRight = to.column > from.column;
      const exitX = targetIsRight ? from.x + from.width : from.x;
      const entryX = targetIsRight ? to.x : to.x + to.width;
      const laneX = item.laneX ?? (exitX + entryX) / 2;
      points = [
        { x: exitX, y: from.cy },
        { x: laneX, y: from.cy },
        { x: laneX, y: to.cy },
        { x: entryX, y: to.cy },
      ];
      midpoint = { x: laneX, y: (from.cy + to.cy) / 2 };
    }

    const offset = pairOffsets.get(item) ?? 0;
    if (offset !== 0) {
      // A run that is flat moves in y, a run that is upright moves in x, so the
      // separation is always across the line rather than along it. Every point
      // moves together, so each arrowhead still lands on its own line.
      const flat = points.every((point) => point.y === points[0]?.y);
      const upright = points.every((point) => point.x === points[0]?.x);
      if (flat) {
        points = points.map((point) => ({ x: point.x, y: point.y + offset }));
        midpoint = { x: midpoint.x, y: midpoint.y + offset };
      } else if (upright) {
        points = points.map((point) => ({ x: point.x + offset, y: point.y }));
        midpoint = { x: midpoint.x + offset, y: midpoint.y };
      }
      // Any other shape already differs between the two directions, because the
      // two routes leave and enter on different edges at different heights.
    }

    const { d, segments } = buildPath(points);

    return {
      link: item.link,
      from,
      to,
      d,
      segments,
      midpoint,
      key: `${from.id}-${to.id}`,
      kind: item.kind,
      laneX: item.laneX,
    };
  });
}

/**
 * The point at fraction t along a routed link, walked from the link's own
 * segment list. No DOM, no getPointAtLength, so it runs in a unit test and on
 * every frame of a packet without touching layout.
 */
export function packetPointAt(routed: RoutedLink, t: number): Point {
  const segments = routed.segments;
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (!first || !last) return { x: routed.midpoint.x, y: routed.midpoint.y };

  const safe = Number.isFinite(t) ? t : 0;
  const clamped = Math.min(1, Math.max(0, safe));
  const total = segments.reduce((sum, item) => sum + item.length, 0);
  if (clamped <= 0 || total === 0) return { x: first.x1, y: first.y1 };
  if (clamped >= 1) return { x: last.x2, y: last.y2 };

  let travelled = clamped * total;
  for (const item of segments) {
    if (travelled <= item.length) {
      const fraction = item.length === 0 ? 0 : travelled / item.length;
      return {
        x: item.x1 + (item.x2 - item.x1) * fraction,
        y: item.y1 + (item.y2 - item.y1) * fraction,
      };
    }
    travelled -= item.length;
  }
  return { x: last.x2, y: last.y2 };
}

/* ------------------------------------------------------------------ */
/* Small helpers the screens share                                     */
/* ------------------------------------------------------------------ */

/** The ids a part talks to, in either direction, lowest first. */
export function neighboursOf(partId: number, links: Link[]): number[] {
  const found = new Set<number>();
  for (const link of links) {
    if (link.from === partId) found.add(link.to);
    if (link.to === partId) found.add(link.from);
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * One token name to one set of utility classes. The token names themselves come
 * from PATH_COLOURS in the content file, so a colour decision is made there and
 * only the translation into Tailwind classes is made here.
 *
 * Text is never teal-600: it fails AA on white. teal-600 is for strokes, fills
 * and keylines, teal-700 for words.
 */
const TOKEN_CLASSES: Record<string, PathClasses> = {
  "teal-600": {
    stroke: "stroke-teal-600",
    fill: "fill-teal-600",
    text: "text-teal-700",
    chip: "border-teal-100 bg-teal-50 text-teal-800",
  },
  "gray-900": {
    stroke: "stroke-gray-900",
    fill: "fill-gray-900",
    text: "text-gray-900",
    chip: "border-gray-200 bg-gray-100 text-gray-900",
  },
  "gray-500": {
    stroke: "stroke-gray-500",
    fill: "fill-gray-500",
    text: "text-gray-500",
    chip: "border-gray-200 bg-gray-100 text-gray-700",
  },
  "status-critical-fg": {
    stroke: "stroke-status-critical-fg",
    fill: "fill-status-critical-fg",
    text: "text-status-critical-fg",
    chip: "border-alert-border bg-status-critical-bg text-status-critical-fg",
  },
};

const FALLBACK_CLASSES: PathClasses = {
  stroke: "stroke-gray-500",
  fill: "fill-gray-500",
  text: "text-gray-500",
  chip: "border-gray-200 bg-gray-100 text-gray-700",
};

/** Stroke, fill, text and chip classes for one of the four signal paths. */
export function pathClass(path: Path): PathClasses {
  return TOKEN_CLASSES[PATH_COLOURS[path].token] ?? FALLBACK_CLASSES;
}

/**
 * Deterministic word wrap for SVG tspans. A word is never split. If the text
 * does not fit in maxLines, the last line ends with an ellipsis character, and
 * whole words are dropped (never cut) to make room for it.
 */
export function wrapLabel(text: string, maxChars: number, maxLines: number): string[] {
  const width = Math.max(1, Math.floor(maxChars));
  const limit = Math.max(1, Math.floor(maxLines));
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length === 0) {
      current = word;
      continue;
    }
    if (current.length + 1 + word.length <= width) {
      current = `${current} ${word}`;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current.length > 0) lines.push(current);

  if (lines.length <= limit) return lines;

  const kept = lines.slice(0, limit);
  const lastIndex = kept.length - 1;
  const lastLine = kept[lastIndex];
  if (lastLine === undefined) return kept;

  let parts = lastLine.split(" ");
  while (parts.length > 1 && parts.join(" ").length + 1 > width) {
    parts = parts.slice(0, -1);
  }
  kept[lastIndex] = `${parts.join(" ")}…`;
  return kept;
}
