import type { Part } from "@/content/sensor";
import type { GraphNode } from "@/lib/graph";
import type { PathFilter } from "@/store/explorer";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";

import { DiagramFrame } from "@/components/diagram/DiagramFrame";
import {
  COLUMN_IDS,
  LAYOUT,
  linksFor,
  nodeSentence,
  nodeTitle,
  relatedIds,
  talksToSentence,
  ZONE_GROUPS,
} from "@/components/parts/parts-data";
import { PATH_LABELS, SAFETY, ZONE_LABELS } from "@/content/sensor";
import { cn } from "@/lib/cn";
import {
  LANE_GAP,
  LANE_OFFSET,
  LINK_STROKE,
  NODE_RADIUS,
  pathClass,
  routeLinks,
  wrapLabel,
  ZONE_HEADER_Y,
} from "@/lib/graph";
import { DURATION_MS, EASE_EXPO_OUT, seconds } from "@/lib/motion";
import { nodeById } from "@/lib/nodes";
import { useReducedMotion } from "@/lib/use-reduced-motion";

/**
 * The component map: the twenty-one parts and the virtual pump, in one column
 * per zone. Coordinates come from PARTS_LAYOUT and routeLinks, so the picture
 * is the shared layout drawn, not a second layout invented here.
 */

/** Room under the zone headings for the note over the outside column. */
const TOP_ROOM = 26;
/** A lane can sit one gap to the right of the last column, so leave it room. */
const RIGHT_ROOM = LANE_OFFSET + LANE_GAP;

/** Label box: 13px text in the width left after the id chip. */
const LABEL_CHARS = 22;
const LABEL_LINES = 2;
const LABEL_LINE_H = 15;
const LABEL_X = 34;

const ID_CHIP_X = 8;
const ID_CHIP_W = 20;
const ID_CHIP_H = 20;

/** The note over the outside column: 11px in one column width. */
const NOTE_CHARS = 30;
const NOTE_LINE_H = 13;
const NOTE_FIRST_Y = ZONE_HEADER_Y + 14;

const VIEW_BOX = {
  width: LAYOUT.viewBox.width + RIGHT_ROOM,
  height: LAYOUT.viewBox.height + TOP_ROOM,
};

const NOTE_LINES = wrapLabel(SAFETY.noOutsideDosing, NOTE_CHARS, 2);

type NodeState = "selected" | "related" | "dimmed" | "plain";

const RECT_CLASSES: Record<NodeState, string> = {
  selected: "fill-teal-50 stroke-teal-600",
  related: "fill-teal-100 stroke-teal-600",
  dimmed: "fill-card stroke-gray-300",
  plain: "fill-card",
};

function columnLeft(column: number): number {
  return LAYOUT.columnLeftX[column] ?? 0;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** The node the arrow key lands on: up and down in a column, left and right across. */
function nextNodeId(id: number, key: string): number | null {
  let column = -1;
  let row = -1;
  COLUMN_IDS.forEach((ids, index) => {
    const found = ids.indexOf(id);
    if (found >= 0) {
      column = index;
      row = found;
    }
  });
  if (column < 0) return null;

  let nextColumn = column;
  let nextRow = row;
  if (key === "ArrowUp") nextRow = row - 1;
  else if (key === "ArrowDown") nextRow = row + 1;
  else if (key === "ArrowLeft") nextColumn = column - 1;
  else if (key === "ArrowRight") nextColumn = column + 1;
  else if (key === "Home") nextRow = 0;
  else if (key === "End") nextRow = Number.MAX_SAFE_INTEGER;
  else return null;

  const target = COLUMN_IDS[clamp(nextColumn, 0, COLUMN_IDS.length - 1)] ?? [];
  return target[clamp(nextRow, 0, target.length - 1)] ?? null;
}

interface MapNodeProps {
  node: GraphNode;
  state: NodeState;
  selected: boolean;
  label: string;
  tabIndex: number;
  onActivate: () => void;
  onFocus: () => void;
  onKeyDown: (event: ReactKeyboardEvent<SVGGElement>) => void;
}

function MapNode({
  node,
  state,
  selected,
  label,
  tabIndex,
  onActivate,
  onFocus,
  onKeyDown,
}: MapNodeProps) {
  const part: Part = node.part;
  // Every node on the insulin path carries the word as well as the colour, so
  // red is never the only cue. The pump is one of them.
  const insulin = part.path === "insulin";
  const lines = wrapLabel(part.name, LABEL_CHARS, LABEL_LINES);
  const rows = lines.length + (insulin ? 1 : 0);
  const firstY = node.cy - ((rows - 1) * LABEL_LINE_H) / 2;

  return (
    <g
      data-node-id={node.id}
      role="button"
      tabIndex={tabIndex}
      aria-pressed={selected}
      aria-label={label}
      onClick={onActivate}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      className={cn(
        "group ease-expo-out cursor-pointer transition-opacity duration-150 focus:outline-none motion-reduce:transition-none",
        state === "dimmed" && "opacity-45",
      )}
    >
      {/* Selection ring, and the keyboard focus ring, both drawn rather than
          outlined, so they follow the rounded box exactly. */}
      <rect
        x={node.x - 3}
        y={node.y - 3}
        width={node.width + 6}
        height={node.height + 6}
        rx={NODE_RADIUS + 3}
        strokeWidth={2}
        className={cn(
          "group-focus-visible:stroke-ring fill-none",
          selected ? "stroke-teal-600/40" : "stroke-none",
        )}
      />

      <rect
        x={node.x}
        y={node.y}
        width={node.width}
        height={node.height}
        rx={NODE_RADIUS}
        strokeWidth={1}
        className={cn(
          "ease-expo-out transition-colors duration-150 motion-reduce:transition-none",
          RECT_CLASSES[state],
          state === "plain" && pathClass(part.path).stroke,
          state === "plain" && "group-hover:fill-teal-50",
        )}
      />

      <rect
        x={node.x + ID_CHIP_X}
        y={node.cy - ID_CHIP_H / 2}
        width={ID_CHIP_W}
        height={ID_CHIP_H}
        rx={4}
        className="fill-gray-100"
      />
      <text
        x={node.x + ID_CHIP_X + ID_CHIP_W / 2}
        y={node.cy}
        textAnchor="middle"
        dominantBaseline="central"
        className="text-caption tabular fill-gray-600 font-mono"
      >
        {part.id}
      </text>

      {lines.map((line, index) => (
        <text
          key={`${index}-${line}`}
          x={node.x + LABEL_X}
          y={firstY + index * LABEL_LINE_H}
          dominantBaseline="central"
          className="text-body-s fill-gray-900"
        >
          {line}
        </text>
      ))}

      {insulin ? (
        <text
          x={node.x + LABEL_X}
          y={firstY + lines.length * LABEL_LINE_H}
          dominantBaseline="central"
          className="text-caption fill-status-critical-fg"
        >
          {PATH_LABELS.insulin}
        </text>
      ) : null}
    </g>
  );
}

export interface PartsMapProps {
  selectedId: number | null;
  activePaths: PathFilter;
  onToggleNode: (id: number) => void;
  onClearSelection: () => void;
  className?: string;
}

export function PartsMap({
  selectedId,
  activePaths,
  onToggleNode,
  onClearSelection,
  className,
}: PartsMapProps) {
  const reduced = useReducedMotion();
  const rootRef = useRef<SVGGElement | null>(null);
  const [rovingId, setRovingId] = useState<number | null>(null);

  const selected = selectedId === null ? null : (nodeById(selectedId) ?? null);
  const related = useMemo(() => new Set<number>(selected ? relatedIds(selected) : []), [selected]);
  const routed = useMemo(
    () => (selected ? routeLinks(LAYOUT, linksFor(selected.id)) : []),
    [selected],
  );

  const firstId = COLUMN_IDS[0]?.[0] ?? null;
  const activeId = rovingId ?? selectedId ?? firstId;

  const focusNode = (id: number) => {
    setRovingId(id);
    rootRef.current?.querySelector<SVGGElement>(`[data-node-id="${id}"]`)?.focus();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<SVGGElement>, id: number) => {
    if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      onToggleNode(id);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClearSelection();
      return;
    }
    const next = nextNodeId(id, event.key);
    if (next === null) return;
    event.preventDefault();
    focusNode(next);
  };

  const textAlternative = (
    <ul>
      {ZONE_GROUPS.map((group) => (
        <li key={group.zone}>
          {ZONE_LABELS[group.zone]}
          {group.zone === "outside" ? `. ${SAFETY.noOutsideDosing}` : ""}
          <ul>
            {group.nodes.map((part) => (
              <li key={part.id}>
                {nodeTitle(part)}. {PATH_LABELS[part.path]} path.{" "}
                {talksToSentence(relatedIds(part))} {part.job}.
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );

  return (
    <DiagramFrame
      title="Component map"
      description={`Each part sits in the column for where it lives: ${ZONE_LABELS.cavity}, ${ZONE_LABELS.housing}, ${ZONE_LABELS.outside}. Select a part to read its detail and to see the parts it talks to.`}
      viewBox={VIEW_BOX}
      textAlternative={textAlternative}
      className={className}
    >
      {/* The zone headings and the note under the outside heading. The written
          alternative carries the same words, so this copy is not read twice. */}
      <g aria-hidden="true">
        {ZONE_GROUPS.map((group, column) => (
          <text
            key={group.zone}
            x={columnLeft(column)}
            y={ZONE_HEADER_Y}
            className="text-overline fill-gray-500 uppercase"
          >
            {ZONE_LABELS[group.zone]}
          </text>
        ))}

        {NOTE_LINES.map((line, index) => (
          <text
            key={line}
            x={columnLeft(ZONE_GROUPS.length - 1)}
            y={NOTE_FIRST_Y + index * NOTE_LINE_H}
            className="text-caption fill-gray-600"
          >
            {line}
          </text>
        ))}
      </g>

      <g ref={rootRef} transform={`translate(0, ${TOP_ROOM})`}>
        <g aria-hidden="true">
          {routed.map((link) => {
            const length = link.segments.reduce((total, piece) => total + piece.length, 0);
            return (
              <motion.path
                key={link.key}
                d={link.d}
                fill="none"
                strokeWidth={LINK_STROKE}
                strokeLinecap="round"
                strokeDasharray={length}
                initial={{ strokeDashoffset: length }}
                animate={{ strokeDashoffset: 0 }}
                transition={{
                  duration: reduced ? 0 : seconds(DURATION_MS.slow),
                  ease: EASE_EXPO_OUT,
                }}
                className={cn(
                  pathClass(link.link.path).stroke,
                  !activePaths[link.link.path] && "opacity-40",
                )}
              />
            );
          })}
        </g>

        {LAYOUT.nodes.map((node) => {
          const isSelected = node.id === selectedId;
          const isRelated = related.has(node.id);
          const isDimmed = !activePaths[node.part.path];
          const state: NodeState = isSelected
            ? "selected"
            : isRelated
              ? "related"
              : isDimmed
                ? "dimmed"
                : "plain";

          return (
            <MapNode
              key={node.id}
              node={node}
              state={state}
              selected={isSelected}
              label={nodeSentence(
                node.part,
                state === "dimmed" ? "Dimmed by the signal path filter." : undefined,
              )}
              tabIndex={node.id === activeId ? 0 : -1}
              onActivate={() => onToggleNode(node.id)}
              onFocus={() => setRovingId(node.id)}
              onKeyDown={(event) => handleKeyDown(event, node.id)}
            />
          );
        })}
      </g>
    </DiagramFrame>
  );
}
