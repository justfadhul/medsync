import type { Link, Path } from "@/content/sensor";
import type { GraphLayout, GraphNode, RoutedLink } from "@/lib/graph";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";

import { DiagramFrame } from "@/components/diagram/DiagramFrame";
import { FIELD_LABELS, linkKey, linkSentence, nodeLabel } from "@/components/links/labels";
import { LINKS, PATH_LABELS, ZONE_LABELS } from "@/content/sensor";
import { cn } from "@/lib/cn";
import {
  LINK_STROKE,
  NODE_RADIUS,
  packetPointAt,
  pathClass,
  wrapLabel,
  ZONE_COLUMN_ORDER,
} from "@/lib/graph";
import { EASE_EXPO_OUT, seconds } from "@/lib/motion";
import { PATHS } from "@/lib/nodes";
import { PACKET_STAGGER_MS, PACKET_TRAVEL_MS, STATIC_PACKET_T } from "./cadence";

/* ------------------------------------------------------------------ */
/* Drawing constants (geometry and motion, never content)              */
/* ------------------------------------------------------------------ */

/** Transparent stroke width that makes a drawn line comfortable to hit. */
const HIT_STROKE = 14;
/** Radius of a travelling packet, in diagram units. */
const PACKET_RADIUS = 4;
/** Radius of the ring drawn round a link's midpoint when it holds focus. */
const FOCUS_RING_RADIUS = 9;

/** Text insets inside a node box. */
const NODE_TEXT_X = 32;
const NODE_ID_X = 10;
const NODE_LINE_ONE_Y = 21;
const NODE_LINE_TWO_Y = 37;
const NODE_TAG_INSET = 10;

/** Characters per wrapped line of a node name, and of a node that carries a tag. */
const NODE_WRAP_CHARS = 22;
const TAGGED_WRAP_CHARS = 15;

/** Past this fraction of the width or the height, a tooltip flips to the other side. */
const FLIP_X_AT = 0.55;
const FLIP_Y_AT = 0.6;
/** Gap between the anchor point and the tooltip, in pixels on the page. */
const TOOLTIP_GAP = 12;

/* ------------------------------------------------------------------ */
/* Nodes                                                               */
/* ------------------------------------------------------------------ */

interface NodeBoxProps {
  node: GraphNode;
}

/**
 * A node on this screen is plainer than on the Parts screen: a box, the part
 * number in mono, and the name over two lines. The lines are the interactive
 * thing here, so the whole node layer is hidden from assistive technology and
 * the written alternative carries the parts instead.
 */
function NodeBox({ node }: NodeBoxProps) {
  // Every node on the insulin path is drawn the same way here as on the Parts
  // screen: the path colour on the stroke and the word beside it, so red never
  // carries the meaning on its own and the same part never looks like two
  // different things on two screens. That is parts 12 and 20 as well as the
  // pump, because the content file puts all three on the insulin path.
  //
  // The fill is deliberately grey rather than the white the Parts screen uses:
  // there the node is the subject, here the link is, and the boxes are context.
  const insulin = node.part.path === "insulin";
  const lines = wrapLabel(node.part.name, insulin ? TAGGED_WRAP_CHARS : NODE_WRAP_CHARS, 2);

  return (
    <g>
      <rect
        x={node.x}
        y={node.y}
        width={node.width}
        height={node.height}
        rx={NODE_RADIUS}
        strokeWidth={1}
        className={cn("fill-gray-50", insulin ? pathClass("insulin").stroke : "stroke-gray-200")}
      />
      <text
        x={node.x + NODE_ID_X}
        y={node.y + NODE_LINE_ONE_Y}
        className="text-caption tabular fill-gray-500 font-mono"
      >
        {node.id}
      </text>
      {lines.map((line, index) => (
        <text
          key={line}
          x={node.x + NODE_TEXT_X}
          y={node.y + (index === 0 ? NODE_LINE_ONE_Y : NODE_LINE_TWO_Y)}
          className="text-body-s fill-gray-900"
        >
          {line}
        </text>
      ))}
      {insulin ? (
        <text
          x={node.x + node.width - NODE_TAG_INSET}
          y={node.y + NODE_LINE_ONE_Y}
          textAnchor="end"
          className="text-caption fill-status-critical-fg"
        >
          {PATH_LABELS.insulin}
        </text>
      ) : null}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Packets                                                             */
/* ------------------------------------------------------------------ */

interface PacketProps {
  routed: RoutedLink;
  reduced: boolean;
  /** Sibling stagger, in seconds. */
  delay: number;
}

/**
 * A packet is a small circle walked along the routed line by packetPointAt, so
 * it stays on the drawn path without asking the browser for its geometry.
 *
 * One crossing per step, ending at the target. Under reduced motion it does not
 * move at all: it is parked halfway along the line and stays there.
 */
function Packet({ routed, reduced, delay }: PacketProps) {
  const progress = useMotionValue(reduced ? STATIC_PACKET_T : 0);
  const cx = useTransform(progress, (t: number) => packetPointAt(routed, t).x);
  const cy = useTransform(progress, (t: number) => packetPointAt(routed, t).y);

  useEffect(() => {
    if (reduced) {
      progress.set(STATIC_PACKET_T);
      return;
    }
    progress.set(0);
    const controls = animate(progress, 1, {
      duration: seconds(PACKET_TRAVEL_MS),
      delay,
      ease: EASE_EXPO_OUT,
    });
    return () => controls.stop();
  }, [delay, progress, reduced]);

  return (
    <motion.circle
      cx={cx}
      cy={cy}
      r={PACKET_RADIUS}
      strokeWidth={1}
      className={cn(pathClass(routed.link.path).fill, "stroke-background")}
    />
  );
}

/* ------------------------------------------------------------------ */
/* One link                                                            */
/* ------------------------------------------------------------------ */

interface LinkGroupProps {
  routed: RoutedLink;
  markerId: (path: Path) => string;
  /** 1 when the line is emphasised, lower when another line has the reader's attention. */
  opacityClass: string;
  focused: boolean;
  pinned: boolean;
  describedBy: string | undefined;
  onShow: (key: string) => void;
  onHide: (key: string) => void;
  onFocusLink: (key: string) => void;
  onBlurLink: (key: string) => void;
  onToggle: (key: string) => void;
  onDismiss: () => void;
}

function LinkGroup({
  routed,
  markerId,
  opacityClass,
  focused,
  pinned,
  describedBy,
  onShow,
  onHide,
  onFocusLink,
  onBlurLink,
  onToggle,
  onDismiss,
}: LinkGroupProps) {
  const key = routed.key;
  const classes = pathClass(routed.link.path);

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={linkSentence(routed.link)}
      aria-describedby={describedBy}
      aria-pressed={pinned}
      className={cn(
        "ease-expo-out cursor-pointer transition-opacity duration-150 motion-reduce:transition-none",
        opacityClass,
      )}
      onMouseEnter={() => onShow(key)}
      onMouseLeave={() => onHide(key)}
      onFocus={() => onFocusLink(key)}
      onBlur={() => onBlurLink(key)}
      onClick={() => onToggle(key)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
          event.preventDefault();
          onToggle(key);
          return;
        }
        if (event.key === "Escape" || event.key === "Esc") {
          event.preventDefault();
          onDismiss();
        }
      }}
    >
      <path
        d={routed.d}
        strokeWidth={LINK_STROKE}
        strokeLinecap="round"
        markerEnd={`url(#${markerId(routed.link.path)})`}
        className={cn("fill-none", classes.stroke)}
      />
      {focused ? (
        <circle
          cx={routed.midpoint.x}
          cy={routed.midpoint.y}
          r={FOCUS_RING_RADIUS}
          strokeWidth={2}
          className="stroke-ring fill-none"
        />
      ) : null}
      <path d={routed.d} strokeWidth={HIT_STROKE} className="fill-none stroke-transparent" />
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Written alternative to the picture                                  */
/* ------------------------------------------------------------------ */

/** The same eighteen links as the map, in words, for a screen reader. */
function MapTextAlternative() {
  return (
    <ul>
      {LINKS.map((link) => (
        <li key={linkKey(link)}>{linkSentence(link)}</li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* The map                                                             */
/* ------------------------------------------------------------------ */

export interface LinkMapProps {
  layout: GraphLayout;
  routed: RoutedLink[];
  title: string;
  description: string;
  /** The links of the cadence step that is showing. */
  activeKeys: Set<string>;
  /** The links of the step, in order, that a packet should be sent along. */
  packetLinks: Link[];
  /** Changes whenever the step or the cycle changes, so packets start again. */
  packetSeed: string;
  reduced: boolean;
  className?: string;
}

export function LinkMap({
  layout,
  routed,
  title,
  description,
  activeKeys,
  packetLinks,
  packetSeed,
  reduced,
  className,
}: LinkMapProps) {
  // useId can carry colons, which are awkward inside a url(#...) reference.
  const rawId = useId();
  const uid = rawId.replace(/:/g, "");
  const tooltipId = `${uid}-link-tooltip`;
  const markerId = useCallback((path: Path) => `${uid}-arrow-${path}`, [uid]);

  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);

  const shownKey = pinned ?? focused ?? hovered;
  const shown = useMemo(
    () => routed.find((item) => item.key === shownKey) ?? null,
    [routed, shownKey],
  );

  const dismiss = useCallback(() => {
    setPinned(null);
    setFocused(null);
    setHovered(null);
  }, []);

  // Escape closes the tooltip wherever the reader is, pointer or keyboard.
  useEffect(() => {
    if (!shownKey) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Esc") dismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dismiss, shownKey]);

  // The tooltip is a real element over the picture rather than an SVG title,
  // so it needs the drawn box of the SVG. Nothing is measured for it: the
  // overlay below is the width of the picture and carries its ratio, so a
  // fraction of the viewBox is a percentage of the overlay, in any size of
  // window and before anything has been laid out.
  const tooltipPlacement = useMemo(() => {
    if (!shown) return null;
    const fractionX = shown.midpoint.x / layout.viewBox.width;
    const fractionY = shown.midpoint.y / layout.viewBox.height;
    const flipX = fractionX > FLIP_X_AT;
    const flipY = fractionY > FLIP_Y_AT;
    const style: CSSProperties = {
      left: `${fractionX * 100}%`,
      top: `${fractionY * 100}%`,
      transform: [
        `translateX(${flipX ? `calc(-100% - ${TOOLTIP_GAP}px)` : `${TOOLTIP_GAP}px`})`,
        `translateY(${flipY ? `calc(-100% - ${TOOLTIP_GAP}px)` : `${TOOLTIP_GAP}px`})`,
      ].join(" "),
    };
    return style;
  }, [layout.viewBox.height, layout.viewBox.width, shown]);

  const tooltipShown = shown !== null && tooltipPlacement !== null;

  return (
    <div className={cn("relative min-w-0", className)}>
      <DiagramFrame
        title={title}
        description={description}
        viewBox={layout.viewBox}
        textAlternative={<MapTextAlternative />}
      >
        <defs>
          {PATHS.map((path) => (
            <marker
              key={path}
              id={markerId(path)}
              markerUnits="userSpaceOnUse"
              markerWidth={9}
              markerHeight={9}
              refX={8}
              refY={4.5}
              orient="auto"
            >
              <path d="M 0 0 L 9 4.5 L 0 9 Z" className={pathClass(path).fill} />
            </marker>
          ))}
        </defs>

        <g>
          {routed.map((item) => {
            const isShown = shownKey === item.key;
            const isActive = activeKeys.has(item.key);
            const opacityClass =
              shownKey === null
                ? isActive
                  ? "opacity-100"
                  : "opacity-70"
                : isShown
                  ? "opacity-100"
                  : "opacity-25";

            return (
              <LinkGroup
                key={item.key}
                routed={item}
                markerId={markerId}
                opacityClass={opacityClass}
                focused={focused === item.key}
                pinned={pinned === item.key}
                describedBy={isShown && tooltipShown ? tooltipId : undefined}
                onShow={setHovered}
                onHide={(key) => setHovered((current) => (current === key ? null : current))}
                onFocusLink={setFocused}
                onBlurLink={(key) => setFocused((current) => (current === key ? null : current))}
                onToggle={(key) => setPinned((current) => (current === key ? null : key))}
                onDismiss={dismiss}
              />
            );
          })}
        </g>

        <g aria-hidden="true" className="pointer-events-none">
          {ZONE_COLUMN_ORDER.map((zone, column) => (
            <text
              key={zone}
              x={layout.columnLeftX[column] ?? 0}
              y={layout.zoneHeaderY}
              className="text-overline fill-gray-500 uppercase"
            >
              {ZONE_LABELS[zone]}
            </text>
          ))}
          {layout.nodes.map((node) => (
            <NodeBox key={node.id} node={node} />
          ))}
        </g>

        <g aria-hidden="true" className="pointer-events-none">
          {packetLinks.map((link, index) => {
            const item = routed.find((candidate) => candidate.key === linkKey(link));
            if (!item) return null;
            return (
              <Packet
                key={`${packetSeed}-${item.key}`}
                routed={item}
                reduced={reduced}
                delay={(index * PACKET_STAGGER_MS) / 1000}
              />
            );
          })}
        </g>
      </DiagramFrame>

      <div
        aria-hidden={tooltipShown ? undefined : true}
        className="pointer-events-none absolute inset-x-0 top-0"
        style={{ aspectRatio: `${layout.viewBox.width} / ${layout.viewBox.height}` }}
      >
        {tooltipShown && shown && tooltipPlacement ? (
          <div
            id={tooltipId}
            role="tooltip"
            style={tooltipPlacement}
            className={cn(
              "bg-popover shadow-popover absolute z-10 w-64 border-gray-200",
              "rounded-lg border p-3",
            )}
          >
            <p className="text-body-s font-medium text-gray-900">
              {nodeLabel(shown.link.from)} to {nodeLabel(shown.link.to)}
            </p>
            <p className={cn("text-caption mt-1", pathClass(shown.link.path).text)}>
              {PATH_LABELS[shown.link.path]} path
            </p>
            <dl className="text-body-s mt-2 flex flex-col gap-1.5">
              <div>
                <dt className="text-caption text-gray-500 uppercase">{FIELD_LABELS.what}</dt>
                <dd className="text-gray-900">{shown.link.what}</dd>
              </div>
              <div>
                <dt className="text-caption text-gray-500 uppercase">{FIELD_LABELS.how}</dt>
                <dd className="text-gray-900">{shown.link.how}</dd>
              </div>
              <div>
                <dt className="text-caption text-gray-500 uppercase">{FIELD_LABELS.cadence}</dt>
                <dd className="text-gray-900">{shown.link.cadence}</dd>
              </div>
            </dl>
          </div>
        ) : null}
      </div>
    </div>
  );
}
