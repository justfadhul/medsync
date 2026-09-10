import { motion } from "framer-motion";

import { cn } from "@/lib/cn";
import { EASE_EXPO_OUT, seconds } from "@/lib/motion";

/* Geometry. Drawing coordinates only, never content. */
const VIEW = { width: 760, height: 372 };
/* The stack sits to the right of a margin wide enough for the longest layer
   name, so no label is ever clipped. */
const STACK = { x: 220, w: 330 };
const LABEL_X = STACK.x - 12;

/** The layers of the tip, top to bottom, with the y each one starts at. */
const LAYERS = [
  { key: "fluid", name: "Peritoneal fluid", y: 16, h: 52, fill: "fill-gray-50" },
  { key: "outer", name: "Outer membrane", y: 68, h: 34, fill: "fill-teal-50" },
  { key: "enzyme", name: "Enzyme layer (glucose oxidase)", y: 102, h: 74, fill: "fill-teal-100" },
  { key: "inner", name: "Inner membrane", y: 176, h: 34, fill: "fill-teal-50" },
  { key: "platinum", name: "Platinum electrode", y: 210, h: 46, fill: "fill-gray-150" },
] as const;

const STACK_BOTTOM = 256;
const FLUID_Y = 42;
const ENZYME_Y = 139;
const INNER_Y = 193;
const PLATINUM_Y = 233;

/** Lanes the molecules travel down, spread across the width of the stack. */
const LANES = [STACK.x + 70, STACK.x + 140, STACK.x + 210];
/** The lane the interferent uses, clear of the glucose lanes. */
const INTERFERENT_LANE = STACK.x + 285;

/** One crossing of a membrane. */
const TRAVEL_MS = 400;

export interface ElectrochemicalFigureProps {
  /** Which of the four steps is showing, counted from zero. */
  step: number;
  reduced: boolean;
  /** True when the reader has switched the interferent on. */
  interferent: boolean;
  /** The name of the interferent, read from the content file. */
  interferentName: string;
  tipName: string;
  /** The wording of the bias link, so the voltage is quoted from content. */
  biasLabel: string;
  /** The wording of the current link, so the range is quoted from content. */
  currentLabel: string;
  titleId: string;
  descId: string;
}

/** One entry in the key: a drawn mark and the word for what it is. */
function KeyEntry({
  x,
  y,
  label,
  children,
}: {
  x: number;
  y: number;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {children}
      <text x={16} y={4} className="text-caption fill-gray-600">
        {label}
      </text>
    </g>
  );
}

/**
 * The electrochemical story as a layer stack seen edge on. Glucose goes in at
 * the top, the enzyme turns it into peroxide, the peroxide gives up electrons
 * at the platinum, and a current leaves for the front end.
 *
 * Shape carries the meaning and the key names every shape in words, so nothing
 * here depends on colour alone. The interferent is drawn in the caution colour,
 * never in red: red on this screen would mean the insulin path, and paracetamol
 * is not on it.
 *
 * Under reduced motion nothing travels; each step holds its end state.
 */
export function ElectrochemicalFigure({
  step,
  reduced,
  interferent,
  interferentName,
  tipName,
  biasLabel,
  currentLabel,
  titleId,
  descId,
}: ElectrochemicalFigureProps) {
  const converted = step >= 1;
  const atPlatinum = step >= 2;
  const measured = step >= 3;

  const travel = reduced ? { duration: 0 } : { duration: seconds(TRAVEL_MS), ease: EASE_EXPO_OUT };

  // One molecule is turned back at the outer membrane, so the picture shows
  // that the membrane lets only a share of the glucose through.
  const turnedBack = STACK.x + 285;

  return (
    <svg
      viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
      role="img"
      aria-labelledby={`${titleId} ${descId}`}
      preserveAspectRatio="xMidYMid meet"
      className="block h-auto w-full max-w-full"
    >
      <title id={titleId}>{tipName}</title>
      <desc id={descId}>
        A cut through the electrochemical tip, showing the peritoneal fluid, the outer membrane, the
        enzyme layer, the inner membrane and the platinum electrode.
      </desc>

      {/* The layers, with their names written beside them */}
      {LAYERS.map((layer) => (
        <g key={layer.key}>
          <rect
            x={STACK.x}
            y={layer.y}
            width={STACK.w}
            height={layer.h}
            strokeWidth={1}
            className={cn(layer.fill, "stroke-gray-200")}
          />
          <text
            x={LABEL_X}
            y={layer.y + layer.h / 2 + 4}
            textAnchor="end"
            className="text-caption fill-gray-600"
          >
            {layer.name}
          </text>
        </g>
      ))}

      {/* Glucose entering, with one molecule turned back at the outer membrane */}
      {LANES.map((x, index) => (
        <motion.circle
          key={`glucose-${x}`}
          r={6}
          strokeWidth={1}
          className="fill-teal-200 stroke-teal-600"
          initial={{ cx: x, cy: reduced ? (converted ? ENZYME_Y : ENZYME_Y - 30) : FLUID_Y }}
          animate={{ cx: x, cy: converted ? ENZYME_Y : ENZYME_Y - 30 }}
          transition={{ ...travel, delay: reduced ? 0 : index * 0.04 }}
        />
      ))}
      <circle
        cx={turnedBack}
        cy={FLUID_Y}
        r={6}
        strokeWidth={1}
        className="fill-teal-200 stroke-teal-600"
      />
      <text x={turnedBack + 13} y={FLUID_Y + 4} className="text-caption fill-gray-500">
        held back
      </text>

      {/* Peroxide, once the enzyme has converted the glucose */}
      {converted
        ? LANES.map((x, index) => (
            <motion.rect
              key={`peroxide-${x}`}
              width={12}
              height={12}
              rx={3}
              strokeWidth={1}
              className="fill-teal-600 stroke-teal-800"
              initial={{
                x: x - 6,
                y: reduced ? (atPlatinum ? PLATINUM_Y - 6 : ENZYME_Y + 14) : ENZYME_Y - 6,
              }}
              animate={{ x: x - 6, y: atPlatinum ? PLATINUM_Y - 6 : ENZYME_Y + 14 }}
              transition={{ ...travel, delay: reduced ? 0 : index * 0.04 }}
            />
          ))
        : null}

      {/* Two electrons per peroxide molecule, given up at the platinum */}
      {atPlatinum
        ? LANES.flatMap((x, index) =>
            [0, 1].map((which) => (
              <motion.text
                key={`electron-${x}-${which}`}
                x={x + (which === 0 ? -15 : 9)}
                textAnchor="middle"
                className="text-caption tabular fill-gray-900 font-mono"
                initial={{ y: reduced ? STACK_BOTTOM + 18 : PLATINUM_Y, opacity: reduced ? 1 : 0 }}
                animate={{ y: STACK_BOTTOM + 18, opacity: 1 }}
                transition={{ ...travel, delay: reduced ? 0 : index * 0.04 }}
              >
                e
              </motion.text>
            )),
          )
        : null}

      {/* The interferent, when the reader switches it on. Most of it stops at
          the inner membrane; the trace that gets through adds current. */}
      {interferent ? (
        <g>
          <circle
            cx={INTERFERENT_LANE}
            cy={INNER_Y}
            r={6}
            strokeWidth={1}
            className="fill-status-caution-bg stroke-status-caution-fg"
          />
          <circle
            cx={INTERFERENT_LANE - 22}
            cy={INNER_Y}
            r={6}
            strokeWidth={1}
            className="fill-status-caution-bg stroke-status-caution-fg"
          />
          <motion.circle
            r={6}
            strokeWidth={1}
            className="fill-status-caution-bg stroke-status-caution-fg"
            initial={{
              cx: INTERFERENT_LANE,
              cy: reduced ? (atPlatinum ? PLATINUM_Y : ENZYME_Y) : FLUID_Y,
            }}
            animate={{ cx: INTERFERENT_LANE, cy: atPlatinum ? PLATINUM_Y : ENZYME_Y }}
            transition={travel}
          />
          <text
            x={STACK.x + STACK.w + 12}
            y={INNER_Y - 4}
            className="text-caption fill-status-caution-fg font-medium"
          >
            {interferentName}
          </text>
          <text x={STACK.x + STACK.w + 12} y={INNER_Y + 14} className="text-caption fill-gray-600">
            most is held at the
          </text>
          <text x={STACK.x + STACK.w + 12} y={INNER_Y + 30} className="text-caption fill-gray-600">
            inner membrane
          </text>
        </g>
      ) : null}

      {/* The current leaving for the front end, taken off the foot of the stack
          so it never crosses a layer name. */}
      {measured ? (
        <g>
          <path
            d={`M ${STACK.x + 24} ${STACK_BOTTOM} V ${VIEW.height - 46} H ${LABEL_X - 96}`}
            fill="none"
            strokeWidth={1.5}
            className="stroke-gray-900"
          />
          <text
            x={LABEL_X - 100}
            y={VIEW.height - 42}
            textAnchor="end"
            className="text-caption fill-gray-900 font-medium"
          >
            To the front end
          </text>
        </g>
      ) : null}

      {/* The key: every mark named in words, so shape and colour never stand alone */}
      <g transform={`translate(${STACK.x} ${VIEW.height - 22})`}>
        <KeyEntry x={0} y={0} label="Glucose">
          <circle r={6} strokeWidth={1} className="fill-teal-200 stroke-teal-600" />
        </KeyEntry>
        <KeyEntry x={92} y={0} label="Hydrogen peroxide">
          <rect x={-6} y={-6} width={12} height={12} rx={3} className="fill-teal-600" />
        </KeyEntry>
        <KeyEntry x={250} y={0} label="Electron">
          <text x={-4} y={4} className="text-caption tabular fill-gray-900 font-mono">
            e
          </text>
        </KeyEntry>
        {interferent ? (
          <KeyEntry x={340} y={0} label={interferentName}>
            <circle
              r={6}
              strokeWidth={1}
              className="fill-status-caution-bg stroke-status-caution-fg"
            />
          </KeyEntry>
        ) : null}
      </g>

      {/* What this step produces, in wording taken from the content file */}
      <text
        x={STACK.x + STACK.w}
        y={VIEW.height - 70}
        textAnchor="end"
        className="text-caption fill-gray-600"
      >
        {!converted ? "Only a small, steady share of the glucose gets through." : null}
        {converted && !atPlatinum ? "Glucose becomes hydrogen peroxide in the enzyme layer." : null}
        {atPlatinum && !measured ? biasLabel : null}
        {measured ? currentLabel : null}
      </text>
    </svg>
  );
}
