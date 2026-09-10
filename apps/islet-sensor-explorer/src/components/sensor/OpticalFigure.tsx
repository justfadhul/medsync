import { motion } from "framer-motion";

import { PHYSICS } from "@/content/sensor";
import { cn } from "@/lib/cn";
import { EASE_EXPO_OUT, seconds } from "@/lib/motion";

/* Geometry. Nothing here is content: these are drawing coordinates. */
const VIEW = { width: 680, height: 268 };
const MODULE = { x: 16, y: 62, w: 150, h: 144 };
const TIP = { x: 438, y: 78, w: 158, h: 112 };
const CAP = { cx: 556, cy: 134, r: 30 };
const FIBRE_START = MODULE.x + MODULE.w;
const FIBRE_END = TIP.x;
const EXCITATION_Y = 108;
const COLLECTION_Y = 168;
const PULSE_LENGTH = 34;

/** One full travel of the flash or of the returning glow. */
const TRAVEL_MS = 400;

/** Where the glucose molecules start, out in the peritoneal fluid. */
const FLUID_DOTS = [
  { x: 646, y: 92 },
  { x: 664, y: 122 },
  { x: 650, y: 154 },
  { x: 630, y: 176 },
  { x: 668, y: 176 },
  { x: 626, y: 96 },
];

/** Where each of those molecules docks on the rim of the cap. */
const DOCKED_DOTS = [
  { x: CAP.cx + 22, y: CAP.cy - 20 },
  { x: CAP.cx + 30, y: CAP.cy },
  { x: CAP.cx + 22, y: CAP.cy + 20 },
  { x: CAP.cx, y: CAP.cy + 30 },
  { x: CAP.cx - 22, y: CAP.cy + 20 },
  { x: CAP.cx - 22, y: CAP.cy - 20 },
];

export interface OpticalFigureProps {
  /** Which of the four steps is showing, counted from zero. */
  step: number;
  reduced: boolean;
  moduleName: string;
  tipName: string;
  /** The wording of the outward link, so the flash is described from content. */
  flashLabel: string;
  /** The wording of the returning link. */
  glowLabel: string;
  titleId: string;
  descId: string;
}

/**
 * The optical story as one drawing that changes with the step: a flash goes out
 * along one fibre, the cap glows, glucose docks and the glow rises, and the two
 * colours come back along the other fibre to be counted.
 *
 * Under reduced motion nothing travels. Each step holds the state it ends in,
 * so the same four pictures are readable without a single moving pixel.
 */
export function OpticalFigure({
  step,
  reduced,
  moduleName,
  tipName,
  flashLabel,
  glowLabel,
  titleId,
  descId,
}: OpticalFigureProps) {
  const flashing = step >= 0;
  const glowing = step >= 1;
  const docked = step >= 2;
  const reading = step >= 3;

  // The ratio at the default glucose of the illustrative model. Both numbers
  // come from the content file; nothing here is a new figure.
  const ratio = PHYSICS.optical.intercept + PHYSICS.optical.slope * PHYSICS.glucose.default;
  // A docked cap glows brighter. The step-3 picture shows that as a wider ring.
  const glowRadius = CAP.r + (docked ? 16 : 8);

  const travel = { duration: seconds(TRAVEL_MS), ease: EASE_EXPO_OUT };

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
        A drawing of the optical path: {moduleName} in the housing, two fibres in Lead A, and{" "}
        {tipName} in the peritoneal cavity with a cap on its end.
      </desc>

      {/* The housing that holds the module */}
      <rect
        x={MODULE.x}
        y={MODULE.y}
        width={MODULE.w}
        height={MODULE.h}
        rx={8}
        strokeWidth={1}
        className="fill-gray-50 stroke-gray-200"
      />
      <text
        x={MODULE.x + 12}
        y={MODULE.y + 24}
        className="text-caption fill-gray-500 font-mono uppercase"
      >
        Housing
      </text>
      <text x={MODULE.x + 12} y={MODULE.y + 46} className="text-body-s fill-gray-900">
        Optical
      </text>
      <text x={MODULE.x + 12} y={MODULE.y + 62} className="text-body-s fill-gray-900">
        module
      </text>

      {/* Counts, shown once the two colours are back and separated */}
      {reading ? (
        <g>
          <text
            x={MODULE.x + 12}
            y={MODULE.y + 92}
            className="text-caption fill-gray-500 font-mono uppercase"
          >
            Glow
          </text>
          <rect
            x={MODULE.x + 12}
            y={MODULE.y + 98}
            width={110}
            height={8}
            rx={4}
            className="fill-teal-600"
          />
          <text
            x={MODULE.x + 12}
            y={MODULE.y + 122}
            className="text-caption fill-gray-500 font-mono uppercase"
          >
            Reference
          </text>
          <rect
            x={MODULE.x + 12}
            y={MODULE.y + 128}
            width={76}
            height={8}
            rx={4}
            className="fill-gray-500"
          />
        </g>
      ) : null}

      {/* Lead A: the two fibres */}
      <line
        x1={FIBRE_START}
        y1={EXCITATION_Y}
        x2={FIBRE_END}
        y2={EXCITATION_Y}
        strokeWidth={1.5}
        className={cn(step === 0 ? "stroke-teal-600" : "stroke-gray-300")}
      />
      <line
        x1={FIBRE_START}
        y1={COLLECTION_Y}
        x2={FIBRE_END}
        y2={COLLECTION_Y}
        strokeWidth={1.5}
        className={cn(reading ? "stroke-teal-600" : "stroke-gray-300")}
      />
      <text
        x={(FIBRE_START + FIBRE_END) / 2}
        y={EXCITATION_Y - 12}
        textAnchor="middle"
        className="text-caption fill-gray-500"
      >
        Excitation fibre
      </text>
      <text
        x={(FIBRE_START + FIBRE_END) / 2}
        y={COLLECTION_Y + 22}
        textAnchor="middle"
        className="text-caption fill-gray-500"
      >
        Collection fibre
      </text>

      {/* The flash going out */}
      {flashing && step === 0 ? (
        <motion.rect
          y={EXCITATION_Y - 3}
          width={PULSE_LENGTH}
          height={6}
          rx={3}
          className="fill-teal-600"
          initial={{ x: reduced ? FIBRE_END - PULSE_LENGTH : FIBRE_START }}
          animate={{ x: FIBRE_END - PULSE_LENGTH }}
          transition={reduced ? { duration: 0 } : travel}
        />
      ) : null}

      {/* The two colours coming back */}
      {reading ? (
        <>
          <motion.rect
            y={COLLECTION_Y - 7}
            width={PULSE_LENGTH}
            height={6}
            rx={3}
            className="fill-teal-600"
            initial={{ x: reduced ? FIBRE_START : FIBRE_END - PULSE_LENGTH }}
            animate={{ x: FIBRE_START }}
            transition={reduced ? { duration: 0 } : travel}
          />
          <motion.rect
            y={COLLECTION_Y + 1}
            width={PULSE_LENGTH}
            height={6}
            rx={3}
            className="fill-gray-500"
            initial={{ x: reduced ? FIBRE_START : FIBRE_END - PULSE_LENGTH }}
            animate={{ x: FIBRE_START }}
            transition={reduced ? { duration: 0 } : travel}
          />
        </>
      ) : null}

      {/* The tip, in the peritoneal cavity */}
      <rect
        x={TIP.x}
        y={TIP.y}
        width={TIP.w}
        height={TIP.h}
        rx={8}
        strokeWidth={1}
        className="fill-card stroke-teal-600"
      />
      <text
        x={TIP.x + 12}
        y={TIP.y + 22}
        className="text-caption fill-gray-500 font-mono uppercase"
      >
        Cavity
      </text>
      <text x={TIP.x + 12} y={TIP.y + 44} className="text-body-s fill-gray-900">
        Optical tip
      </text>

      {/* The cap, and its glow once the flash has landed */}
      {glowing ? (
        <motion.circle
          cx={CAP.cx}
          cy={CAP.cy}
          r={glowRadius}
          className="fill-teal-100"
          initial={{ opacity: reduced ? (docked ? 0.9 : 0.55) : 0 }}
          animate={{ opacity: docked ? 0.9 : 0.55 }}
          transition={reduced ? { duration: 0 } : { duration: seconds(250), ease: EASE_EXPO_OUT }}
        />
      ) : null}
      <circle
        cx={CAP.cx}
        cy={CAP.cy}
        r={CAP.r}
        strokeWidth={1.5}
        className={cn("stroke-teal-600", glowing ? "fill-teal-50" : "fill-card")}
      />
      <text
        x={CAP.cx}
        y={CAP.cy + 4}
        textAnchor="middle"
        className="text-caption fill-teal-800 font-medium"
      >
        Cap
      </text>

      {/* Glucose in the fluid, and the same molecules docked on the cap */}
      {(glowing ? DOCKED_DOTS : FLUID_DOTS).map((dot, index) => {
        const from = FLUID_DOTS[index] ?? dot;
        return (
          <motion.circle
            key={`glucose-${index}`}
            r={5}
            strokeWidth={1}
            className="fill-teal-200 stroke-teal-600"
            initial={{ cx: reduced ? dot.x : from.x, cy: reduced ? dot.y : from.y }}
            animate={{ cx: dot.x, cy: dot.y }}
            transition={reduced ? { duration: 0 } : travel}
          />
        );
      })}
      <text x={VIEW.width - 8} y={216} textAnchor="end" className="text-caption fill-gray-500">
        Glucose in the peritoneal fluid
      </text>

      {/* What the step produces, in words from the content file */}
      <text x={MODULE.x} y={VIEW.height - 8} className="text-caption fill-gray-600">
        {step === 0 ? flashLabel : null}
        {step === 1 ? "Two colours leave the cap: one answers to glucose, one does not." : null}
        {step === 2 ? "More glucose docked, brighter glow channel, reference unmoved." : null}
        {step === 3 ? glowLabel : null}
      </text>
      {reading ? (
        <text
          x={VIEW.width - 8}
          y={VIEW.height - 8}
          textAnchor="end"
          className="text-caption tabular fill-teal-800 font-mono"
        >
          {`Ratio ${ratio.toFixed(2)} at ${PHYSICS.glucose.default} ${PHYSICS.glucose.unit}`}
        </text>
      ) : null}
    </svg>
  );
}
