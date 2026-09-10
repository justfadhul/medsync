import type { GraphLayout, GraphNode, RoutedLink } from "@/lib/graph";
import { describe, expect, it } from "vitest";

import { LINKS, PARTS, PUMP_NODE } from "@/content/sensor";
import {
  buildLayout,
  LINKS_LAYOUT,
  MIN_LANE_SEPARATION,
  neighboursOf,
  packetPointAt,
  PARTS_LAYOUT,
  pathClass,
  routeLinks,
  wrapLabel,
  ZONE_COLUMN_ORDER,
} from "@/lib/graph";

const partsLayout = buildLayout(PARTS_LAYOUT);
const linksLayout = buildLayout(LINKS_LAYOUT);
const routed = routeLinks(linksLayout, LINKS);

function rowsIn(layout: GraphLayout, column: number): GraphNode[] {
  return layout.nodes.filter((node) => node.column === column).sort((a, b) => a.row - b.row);
}

function overlaps(a: GraphNode, b: GraphNode): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function boundingBox(link: RoutedLink) {
  const xs = link.segments.flatMap((segment) => [segment.x1, segment.x2]);
  const ys = link.segments.flatMap((segment) => [segment.y1, segment.y2]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

describe("buildLayout", () => {
  it("puts the zones in column order", () => {
    expect(ZONE_COLUMN_ORDER).toEqual(["cavity", "housing", "outside"]);
    ZONE_COLUMN_ORDER.forEach((zone, column) => {
      for (const node of rowsIn(partsLayout, column)) {
        expect(node.zone).toBe(zone);
      }
    });
  });

  it("places seven cavity rows, ten housing rows and five outside rows", () => {
    expect(rowsIn(partsLayout, 0)).toHaveLength(7);
    expect(rowsIn(partsLayout, 1)).toHaveLength(10);
    expect(rowsIn(partsLayout, 2)).toHaveLength(5);
  });

  it("sits the pump at the foot of the housing column, row nine", () => {
    const pump = partsLayout.byId.get(PUMP_NODE.id);
    expect(pump).toBeDefined();
    expect(pump?.column).toBe(1);
    expect(pump?.row).toBe(9);
    expect(pump?.isPump).toBe(true);
  });

  it("holds every part plus the pump, with rows in ascending part id", () => {
    expect(partsLayout.nodes).toHaveLength(PARTS.length + 1);
    expect(partsLayout.nodes).toHaveLength(22);
    for (const column of [0, 1, 2]) {
      const ids = rowsIn(partsLayout, column).map((node) => node.id);
      expect(ids).toEqual([...ids].sort((a, b) => a - b));
    }
  });

  it("keeps every node inside its viewBox, in both presets", () => {
    for (const layout of [partsLayout, linksLayout]) {
      for (const node of layout.nodes) {
        expect(node.x).toBeGreaterThanOrEqual(0);
        expect(node.y).toBeGreaterThanOrEqual(0);
        expect(node.x + node.width).toBeLessThanOrEqual(layout.viewBox.width);
        expect(node.y + node.height).toBeLessThanOrEqual(layout.viewBox.height);
      }
    }
  });

  it("never overlaps two nodes", () => {
    for (const layout of [partsLayout, linksLayout]) {
      for (let i = 0; i < layout.nodes.length; i += 1) {
        for (let j = i + 1; j < layout.nodes.length; j += 1) {
          const a = layout.nodes[i];
          const b = layout.nodes[j];
          if (!a || !b) continue;
          expect(overlaps(a, b)).toBe(false);
        }
      }
    }
  });
});

describe("routeLinks", () => {
  it("routes every link to a drawable path with a finite midpoint", () => {
    expect(routed).toHaveLength(LINKS.length);
    for (const link of routed) {
      expect(link.d.length).toBeGreaterThan(0);
      expect(link.d.startsWith("M ")).toBe(true);
      expect(Number.isFinite(link.midpoint.x)).toBe(true);
      expect(Number.isFinite(link.midpoint.y)).toBe(true);
      expect(link.key).toBe(`${link.from.id}-${link.to.id}`);
      expect(link.segments.length).toBeGreaterThan(0);
    }
  });

  it("classifies each link by column and row distance", () => {
    for (const link of routed) {
      const sameColumn = link.from.column === link.to.column;
      const span = Math.abs(link.from.row - link.to.row);
      if (!sameColumn) expect(link.kind).toBe("cross");
      else if (span === 1) expect(link.kind).toBe("adjacent");
      else expect(link.kind).toBe("lane");
    }
  });

  it("gives every same-column lane in a column its own lane x", () => {
    const perColumn = new Map<number, number[]>();
    for (const link of routed) {
      if (link.kind !== "lane" || link.laneX === null) continue;
      const lanes = perColumn.get(link.from.column) ?? [];
      lanes.push(Math.round(link.laneX * 1000));
      perColumn.set(link.from.column, lanes);
    }
    expect(perColumn.size).toBeGreaterThan(0);
    for (const lanes of perColumn.values()) {
      expect(new Set(lanes).size).toBe(lanes.length);
    }
  });

  it("gives every crossing link in a gutter its own lane x, inside that gutter", () => {
    const perGutter = new Map<number, number[]>();
    for (const link of routed) {
      if (link.kind !== "cross" || link.laneX === null) continue;
      const gutter = Math.min(link.from.column, link.to.column);
      const lanes = perGutter.get(gutter) ?? [];
      lanes.push(Math.round(link.laneX * 1000));
      perGutter.set(gutter, lanes);

      const left = linksLayout.columnLeftX[gutter];
      const right = linksLayout.columnLeftX[gutter + 1];
      expect(left).toBeDefined();
      expect(right).toBeDefined();
      expect(link.laneX).toBeGreaterThan((left ?? 0) + linksLayout.nodeWidth);
      expect(link.laneX).toBeLessThan(right ?? 0);
    }
    expect(perGutter.size).toBeGreaterThan(0);
    for (const lanes of perGutter.values()) {
      expect(new Set(lanes).size).toBe(lanes.length);
    }
  });

  it("draws a link between rows of equal height as one straight line", () => {
    const straight = routed.filter((link) => link.from.cy === link.to.cy);
    expect(straight.length).toBeGreaterThan(0);
    for (const link of straight) {
      expect(link.segments).toHaveLength(1);
      expect(link.d.split("L")).toHaveLength(2);
    }
  });
});

describe("packetPointAt", () => {
  it("starts at the path start and ends at the path end for every link", () => {
    for (const link of routed) {
      const first = link.segments[0];
      const last = link.segments[link.segments.length - 1];
      expect(first).toBeDefined();
      expect(last).toBeDefined();
      if (!first || !last) continue;

      const start = packetPointAt(link, 0);
      expect(start.x).toBeCloseTo(first.x1, 6);
      expect(start.y).toBeCloseTo(first.y1, 6);

      const end = packetPointAt(link, 1);
      expect(end.x).toBeCloseTo(last.x2, 6);
      expect(end.y).toBeCloseTo(last.y2, 6);
    }
  });

  it("keeps the halfway point inside the bounding box of the path", () => {
    for (const link of routed) {
      const box = boundingBox(link);
      const middle = packetPointAt(link, 0.5);
      expect(middle.x).toBeGreaterThanOrEqual(box.minX - 1e-6);
      expect(middle.x).toBeLessThanOrEqual(box.maxX + 1e-6);
      expect(middle.y).toBeGreaterThanOrEqual(box.minY - 1e-6);
      expect(middle.y).toBeLessThanOrEqual(box.maxY + 1e-6);
    }
  });

  it("clamps a fraction outside the range", () => {
    const link = routed[0];
    expect(link).toBeDefined();
    if (!link) return;
    expect(packetPointAt(link, -1)).toEqual(packetPointAt(link, 0));
    expect(packetPointAt(link, 2)).toEqual(packetPointAt(link, 1));
  });
});

describe("neighboursOf", () => {
  it("reads both directions, lowest id first", () => {
    expect(neighboursOf(10, LINKS)).toEqual([8, 9, 11, 12, 13]);
    expect(neighboursOf(PUMP_NODE.id, LINKS)).toEqual([12]);
  });

  it("returns nothing for a part that says nothing", () => {
    expect(neighboursOf(2, LINKS)).toEqual([]);
  });
});

describe("pathClass", () => {
  it("never uses teal-600 for text, and keeps red for insulin only", () => {
    expect(pathClass("optical").stroke).toBe("stroke-teal-600");
    expect(pathClass("optical").text).toBe("text-teal-700");
    expect(pathClass("electrical").text).toBe("text-gray-900");
    expect(pathClass("support").text).toBe("text-gray-500");
    expect(pathClass("insulin").text).toBe("text-status-critical-fg");
    for (const path of ["optical", "electrical", "support"] as const) {
      const classes = pathClass(path);
      expect(`${classes.stroke} ${classes.fill} ${classes.text} ${classes.chip}`).not.toContain(
        "critical",
      );
    }
  });
});

describe("wrapLabel", () => {
  const samples = PARTS.map((part) => part.name);

  it("never splits a word", () => {
    for (const sample of samples) {
      const words = sample.split(/\s+/);
      for (const line of wrapLabel(sample, 18, 2)) {
        for (const word of line.replace("…", "").split(" ")) {
          if (word.length === 0) continue;
          expect(words).toContain(word);
        }
      }
    }
  });

  it("never returns more than maxLines lines", () => {
    for (const sample of samples) {
      for (const lines of [1, 2, 3]) {
        expect(wrapLabel(sample, 14, lines).length).toBeLessThanOrEqual(lines);
      }
    }
  });

  it("adds an ellipsis only when the text truly overflows", () => {
    expect(wrapLabel("Optical tip", 20, 2)).toEqual(["Optical tip"]);
    const clipped = wrapLabel("Electrochemical front end (AD5941 chip)", 16, 1);
    expect(clipped).toHaveLength(1);
    expect(clipped[0]?.endsWith("…")).toBe(true);
  });

  it("keeps a word longer than the width on a line of its own", () => {
    expect(wrapLabel("Electrochemical tip", 6, 2)).toEqual(["Electrochemical", "tip"]);
  });

  it("returns nothing for empty text", () => {
    expect(wrapLabel("   ", 10, 2)).toEqual([]);
  });
});

describe("lane separation", () => {
  // Two vertical lanes that sit a few pixels apart read as one thick line, so
  // the same-column lanes and the crossing lanes are allocated from one pool.
  function lanesByGutter(layout: GraphLayout) {
    const byGutter = new Map<number, number[]>();
    for (const link of routeLinks(layout, LINKS)) {
      if (link.laneX === null) continue;
      const gutter =
        link.kind === "lane" ? link.from.column : Math.min(link.from.column, link.to.column);
      byGutter.set(gutter, [...(byGutter.get(gutter) ?? []), link.laneX]);
    }
    return byGutter;
  }

  for (const [name, preset] of [
    ["PARTS_LAYOUT", PARTS_LAYOUT],
    ["LINKS_LAYOUT", LINKS_LAYOUT],
  ] as const) {
    it(`keeps every pair of lanes in a gutter at least ${MIN_LANE_SEPARATION}px apart in ${name}`, () => {
      const layout = buildLayout(preset);
      for (const [gutter, lanes] of lanesByGutter(layout)) {
        const sorted = [...lanes].sort((a, b) => a - b);
        for (let index = 1; index < sorted.length; index += 1) {
          const gap = (sorted[index] as number) - (sorted[index - 1] as number);
          expect(
            gap,
            `gutter ${gutter} in ${name} has two lanes ${gap.toFixed(1)}px apart`,
          ).toBeGreaterThanOrEqual(MIN_LANE_SEPARATION - 0.001);
        }
      }
    });

    it(`keeps every lane inside the drawing in ${name}`, () => {
      const layout = buildLayout(preset);
      for (const [, lanes] of lanesByGutter(layout)) {
        for (const lane of lanes) {
          expect(lane).toBeGreaterThan(0);
          expect(lane).toBeLessThanOrEqual(layout.viewBox.width);
        }
      }
    });
  }
});

describe("links that connect the same two parts both ways", () => {
  // The optical module flashes the tip and the tip glows back. Both nodes sit
  // on row 0, so without a separation the two routes are the same line and the
  // reader sees one line with an arrow at each end.
  const pairs = new Map<string, RoutedLink[]>();
  for (const link of routed) {
    const key = [link.from.id, link.to.id].sort((a, b) => a - b).join(":");
    pairs.set(key, [...(pairs.get(key) ?? []), link]);
  }
  const bothWays = [...pairs.entries()].filter(([, group]) => group.length > 1);

  it("finds at least one such pair in the content", () => {
    expect(bothWays.length).toBeGreaterThan(0);
  });

  it.each(bothWays)("draws %s as two distinct lines", (_key, group) => {
    const drawn = new Set(group.map((link) => link.d));
    expect(drawn.size).toBe(group.length);
  });

  it.each(bothWays)("keeps both ends of each line of %s on its own route", (_key, group) => {
    for (const link of group) {
      const start = packetPointAt(link, 0);
      const end = packetPointAt(link, 1);
      // The line still leaves and enters within the height of a node box, so a
      // separated line never floats away from the part it belongs to.
      expect(Math.abs(start.y - link.from.cy)).toBeLessThanOrEqual(link.from.height / 2);
      expect(Math.abs(end.y - link.to.cy)).toBeLessThanOrEqual(link.to.height / 2);
    }
  });
});
