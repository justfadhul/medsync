import type { CadenceStep } from "@/components/links/cadence";

import { nodeLabel } from "@/components/links/labels";
import { Button } from "@/components/ui/Button";
import { CYCLE_META, PATH_LABELS, SAFETY } from "@/content/sensor";
import { cn } from "@/lib/cn";
import { CYCLE_PLAY_MS, stepFiresOnCycle } from "./cadence";

export interface LinkTransportProps {
  steps: CadenceStep[];
  step: CadenceStep;
  /** Which measurement cycle the sequence is on, counted from one. */
  cycleNumber: number;
  /** How many measurement cycles the sequence runs before it repeats. */
  cyclesInLoop: number;
  playing: boolean;
  /** True when the reader has asked for less motion. */
  reduced: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStepBack: () => void;
  onStepForward: () => void;
  onReset: () => void;
  headingId: string;
  className?: string;
}

/** Milliseconds read as whole seconds, for the one written note about pace. */
const PLAY_SECONDS = CYCLE_PLAY_MS / 1000;

/**
 * The play control: real buttons with written labels, and a written status line
 * saying which cadence step is showing. Nothing here depends on colour.
 *
 * When motion is reduced the Play button is not offered at all. The step
 * controls do the same work, and a written note says so.
 */
export function LinkTransport({
  steps,
  step,
  cycleNumber,
  cyclesInLoop,
  playing,
  reduced,
  onPlay,
  onPause,
  onStepBack,
  onStepForward,
  onReset,
  headingId,
  className,
}: LinkTransportProps) {
  const fires = stepFiresOnCycle(step, cycleNumber);

  return (
    <section aria-labelledby={headingId} className={cn("min-w-0", className)}>
      <h2 id={headingId} className="text-overline text-gray-500 uppercase">
        Playback
      </h2>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {reduced ? null : (
          <Button
            variant="primary"
            size="sm"
            onClick={playing ? onPause : onPlay}
            aria-label={playing ? "Pause playback" : "Play the cadence"}
          >
            {playing ? "Pause" : "Play"}
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={onStepBack}>
          Step back
        </Button>
        <Button variant="secondary" size="sm" onClick={onStepForward}>
          Step forward
        </Button>
        <Button variant="ghost" size="sm" onClick={onReset}>
          Reset
        </Button>
      </div>

      <p
        role="status"
        aria-live={playing ? "off" : "polite"}
        className="text-body-s mt-3 text-gray-600"
      >
        <span className="font-medium text-gray-900">
          Step {step.index + 1} of {steps.length}: {step.cadence}.
        </span>{" "}
        Measurement cycle {cycleNumber} of {cyclesInLoop}.
      </p>

      <ul className="text-body-s mt-2 flex flex-col gap-1 text-gray-600">
        {step.links.map((link) => (
          <li key={`${link.from}-${link.to}`}>
            <span className="text-gray-900">
              {nodeLabel(link.from)} to {nodeLabel(link.to)}:
            </span>{" "}
            {link.what}
          </li>
        ))}
      </ul>

      {step.carriesInsulin ? (
        <p className="text-body-s mt-2">
          <span className="font-medium text-gray-900">{PATH_LABELS.insulin} path.</span>{" "}
          <span className="text-gray-600">{SAFETY.onlyRedDoses}</span>
        </p>
      ) : null}

      {step.tier === "multi-cycle" && !fires ? (
        <p className="text-body-s mt-2 text-gray-600">
          This step fires on one measurement cycle in {step.everyNthCycle}. It is not firing on this
          one, so its links are drawn but no packet travels.
        </p>
      ) : null}

      <p className="text-caption mt-3 text-gray-500">
        {reduced
          ? "Motion is reduced on this device, so playback does not run on its own and no packet moves. Step back and Step forward move through the cadence, and each step marks its own links and shows where a packet sits on them."
          : `The steps of one measurement cycle (${CYCLE_META.periodLabel}) play in about ${PLAY_SECONDS} seconds. The slower steps are held for the same length, so the pace stays even.`}
      </p>
    </section>
  );
}
