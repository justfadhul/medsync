import type { Part, Path } from "@/content/sensor";

import { PARTS, PATH_LABELS, PUMP_NODE } from "@/content/sensor";

/**
 * The node set and the path set, derived once from the content file.
 *
 * Both screens draw the same twenty-one parts and the same virtual pump, and
 * both offer the same four signal paths, so the derivation is made here once
 * instead of in each screen. Nothing here holds copy: every name and label is
 * read from src/content/sensor.ts.
 */

/** Every drawable node: the twenty-one parts, then the virtual pump. */
export const ALL_NODES: Part[] = [...PARTS, PUMP_NODE];

/** The node behind an id, including the virtual pump. */
export const NODE_BY_ID: ReadonlyMap<number, Part> = new Map(
  ALL_NODES.map((node) => [node.id, node]),
);

export function nodeById(id: number): Part | undefined {
  return NODE_BY_ID.get(id);
}

/** The four signal paths, in the order the content file lists them. */
export const PATHS = Object.keys(PATH_LABELS) as Path[];
