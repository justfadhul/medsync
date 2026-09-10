import type { Link, Part, Zone } from "@/content/sensor";

import { LINKS, PATH_LABELS, PUMP_NODE, ZONE_LABELS } from "@/content/sensor";
import { buildLayout, neighboursOf, PARTS_LAYOUT, ZONE_COLUMN_ORDER } from "@/lib/graph";
import { ALL_NODES, NODE_BY_ID } from "@/lib/nodes";

/**
 * Derivations the Parts screen shares between the map, the panel and the
 * stacked list. Nothing here holds copy: every name, zone and path label is
 * read from src/content/sensor.ts, and every coordinate from src/lib/graph.ts.
 */

/** One layout for the whole screen, built once: buildLayout is pure. */
export const LAYOUT = buildLayout(PARTS_LAYOUT);

/** The pump is not one of the twenty-one parts, so it is named, never numbered. */
export function isPumpNode(part: Part): boolean {
  return part.id === PUMP_NODE.id;
}

export interface ZoneGroup {
  zone: Zone;
  nodes: Part[];
}

/** The three zones in column order, each with its nodes in id order. */
export const ZONE_GROUPS: ZoneGroup[] = ZONE_COLUMN_ORDER.map((zone) => ({
  zone,
  nodes: ALL_NODES.filter((node) => node.zone === zone).sort((a, b) => a.id - b.id),
}));

/** Node ids by column and row, which is what the arrow keys walk. */
export const COLUMN_IDS: number[][] = ZONE_GROUPS.map((group) =>
  group.nodes.map((node) => node.id),
);

/** Every link that touches this node, in either direction. */
export function linksFor(id: number): Link[] {
  return LINKS.filter((link) => link.from === id || link.to === id);
}

/**
 * The nodes one node talks to. The part's own talksTo list and the link set are
 * both read, so the boxes that highlight are exactly the boxes the drawn
 * connectors reach: part 12 talks to 10, 11 and 20 by its own list, and the
 * link set adds the phone and the pump.
 */
export function relatedIds(part: Part): number[] {
  const found = new Set<number>(part.talksTo);
  for (const id of neighboursOf(part.id, LINKS)) found.add(id);
  found.delete(part.id);
  return [...found].sort((a, b) => a - b);
}

export function relatedParts(part: Part): Part[] {
  const found: Part[] = [];
  for (const id of relatedIds(part)) {
    const other = NODE_BY_ID.get(id);
    if (other) found.push(other);
  }
  return found;
}

function joinWithAnd(values: string[]): string {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0] ?? "";
  return `${values.slice(0, -1).join(", ")} and ${values.at(-1) ?? ""}`;
}

/**
 * "10 Sensor-management microcontroller", or the pump by name alone.
 *
 * The number comes first and unpunctuated because that is exactly what the node
 * box shows. An accessible name has to contain the control's visible text, so
 * that someone driving the page by voice can say what they can see.
 */
export function nodeTitle(part: Part): string {
  return `${part.id} ${part.name}`;
}

export function talksToSentence(ids: number[]): string {
  if (ids.length === 0) return "Talks to no other part.";
  const noun = ids.length === 1 ? "part" : "parts";
  return `Talks to ${noun} ${joinWithAnd(ids.map((id) => String(id)))}.`;
}

/**
 * The accessible name of a node, written as a sentence rather than as geometry,
 * for example: "Part 10, Sensor-management microcontroller. Implanted housing.
 * Support path. Talks to parts 8, 9, 11, 12 and 13."
 */
export function nodeSentence(part: Part, note?: string): string {
  // A node on the insulin path shows its path as a written tag, so the tag is
  // part of the control's visible text and has to be part of its name too. The
  // separate path sentence would then just say the same thing twice.
  const insulin = part.path === "insulin";
  const sentences = [
    insulin ? `${nodeTitle(part)} ${PATH_LABELS.insulin}.` : `${nodeTitle(part)}.`,
    `${ZONE_LABELS[part.zone]}.`,
    ...(insulin ? [] : [`${PATH_LABELS[part.path]} path.`]),
    talksToSentence(relatedIds(part)),
  ];
  if (note) sentences.push(note);
  return sentences.join(" ");
}
