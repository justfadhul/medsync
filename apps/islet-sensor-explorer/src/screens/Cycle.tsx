import { useEffect } from "react";

import {
  awakeMsThrough,
  barShare,
  ITEMISED_AWAKE_MS,
  PERIODIC_STEP,
  STATED_AWAKE_MS,
} from "@/components/cycle/cycle-data";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SectionNumber } from "@/components/ui/SectionNumber";
import { CYCLE, CYCLE_META, SAFETY, TRUST_RULE } from "@/content/sensor";
import { cn } from "@/lib/cn";
import { bracketCode, findScreen } from "@/lib/content";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { useExplorerStore } from "@/store/explorer";

/** How long one step is held while the cycle plays itself, in milliseconds. */
const STEP_HOLD_MS = 900;

export function Cycle() {
  const screen = findScreen("/cycle");
  const reduced = useReducedMotion();
  const step = useExplorerStore((state) => state.cycleStep);
  const playing = useExplorerStore((state) => state.cycleStepPlaying);
  const setStep = useExplorerStore((state) => state.setCycleStep);
  const playCycle = useExplorerStore((state) => state.playCycle);
  const pauseCycle = useExplorerStore((state) => state.pauseCycle);
  const cycleForward = useExplorerStore((state) => state.cycleForward);
  const cycleBack = useExplorerStore((state) => state.cycleBack);
  const resetCycle = useExplorerStore((state) => state.resetCycle);

  // Playing walks the ten steps and stops at sleep. It never starts on its own,
  // and under reduced motion it is not offered at all.
  useEffect(() => {
    if (!playing || reduced) return;
    const timer = window.setInterval(cycleForward, STEP_HOLD_MS);
    return () => window.clearInterval(timer);
  }, [playing, reduced, cycleForward]);

  useEffect(() => {
    if (reduced && playing) pauseCycle();
  }, [reduced, playing, pauseCycle]);

  const current = CYCLE[step];
  if (!screen || !current) return null;

  const awakeSoFar = current.awake ? awakeMsThrough(step) : ITEMISED_AWAKE_MS;
  const last = CYCLE.length - 1;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <header className="flex flex-col gap-3">
        <SectionNumber code={bracketCode(screen.code)} className="self-start" />
        <h1 className="font-display text-heading-l lg:text-display-s text-gray-900">
          {screen.title}
        </h1>
        <p className="text-body-l max-w-prose text-gray-600">{screen.blurb}</p>
        <p className="text-body-m max-w-prose text-gray-600">
          {CYCLE_META.periodLabel}, the implant wakes, measures, hands over a value and goes back to
          sleep. {CYCLE_META.awakeLabel}, out of every sixty seconds.
        </p>
      </header>

      {/* Transport */}
      <section aria-labelledby="cycle-transport" className="border-y border-gray-200 py-5">
        <h2 id="cycle-transport" className="text-overline text-gray-500 uppercase">
          Playback
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {reduced ? null : (
            <Button
              variant="primary"
              size="sm"
              onClick={playing ? pauseCycle : playCycle}
              aria-label={playing ? "Pause the cycle" : "Play the cycle"}
            >
              {playing ? "Pause" : "Play"}
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={cycleBack} disabled={step === 0}>
            Step back
          </Button>
          <Button variant="secondary" size="sm" onClick={cycleForward} disabled={step === last}>
            Step forward
          </Button>
          <Button variant="ghost" size="sm" onClick={resetCycle}>
            Reset
          </Button>
        </div>

        <label className="mt-4 flex flex-col gap-1.5">
          <span className="text-caption text-gray-500">Scrub through the cycle</span>
          <input
            type="range"
            min={0}
            max={last}
            step={1}
            value={step}
            onChange={(event) => setStep(Number(event.target.value))}
            className="accent-primary w-full max-w-md"
            aria-label="Cycle step"
            aria-valuetext={`Step ${current.n} of ${CYCLE.length}, ${current.step}`}
          />
        </label>

        {reduced ? (
          <p className="text-body-s mt-3 text-gray-600">
            Motion is reduced on this device, so the cycle does not run on its own. Step back, Step
            forward and the scrubber move through the same ten steps.
          </p>
        ) : null}
      </section>

      {/* The timeline */}
      <section aria-labelledby="cycle-timeline" className="flex min-w-0 flex-col gap-3">
        <h2 id="cycle-timeline" className="text-overline text-gray-500 uppercase">
          The ten steps
        </h2>
        <ol className="flex min-w-0 flex-col gap-1.5">
          {CYCLE.map((entry, index) => {
            const active = index === step;
            const reached = index <= step;
            return (
              <li key={entry.n} className="min-w-0">
                <button
                  type="button"
                  onClick={() => setStep(index)}
                  aria-current={active ? "step" : undefined}
                  className={cn(
                    "tap ease-expo-out grid w-full grid-cols-[1.5rem_1fr] items-center gap-x-3 gap-y-1",
                    "sm:grid-cols-[2rem_minmax(6rem,10rem)_minmax(0,1fr)]",
                    "rounded-md border px-3 py-2 text-left transition-colors duration-150",
                    "motion-reduce:transition-none",
                    active
                      ? "ring-ring/40 border-teal-600 bg-teal-50 ring-2"
                      : "bg-card border-gray-200 hover:border-teal-100 hover:bg-teal-50",
                  )}
                >
                  <span className="text-caption tabular font-mono text-gray-500">{entry.n}</span>
                  <span
                    className={cn(
                      "text-body-s font-medium",
                      active ? "text-teal-800" : "text-gray-900",
                    )}
                  >
                    {entry.step}
                  </span>
                  <span className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 sm:col-span-1">
                    {/* The bar is proportional to the itemised time, so the
                        reader can see that the current read dominates. */}
                    <span
                      aria-hidden="true"
                      className={cn(
                        "h-2 shrink-0 rounded-full",
                        entry.awake ? (reached ? "bg-teal-600" : "bg-teal-100") : "bg-gray-300",
                      )}
                      style={{ width: `${barShare(entry.ms) * 5}rem`, maxWidth: "40vw" }}
                    />
                    <span className="text-caption tabular shrink-0 font-mono text-gray-500">
                      {entry.duration}
                    </span>
                    <span className="text-caption truncate text-gray-500">
                      {entry.awake ? "Awake" : "Asleep"}
                      {entry.periodic ? ", not every cycle" : ""}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </section>

      {/* What the current step is, and the running total */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <p className="text-overline text-gray-500 uppercase">
            Step {current.n} of {CYCLE.length}
          </p>
          <h2 className="text-heading-s mt-2 text-gray-900">{current.step}</h2>
          <p className="text-body-m mt-2 text-gray-600">{current.detail}</p>
          <p className="text-body-s mt-4 text-gray-500">
            {current.awake
              ? "The sensors are powered for this step."
              : "The sensors are unpowered. Only the bias on the electrode is held."}
          </p>
        </Card>

        <Card tone="muted">
          <p className="text-overline text-gray-500 uppercase">Awake time</p>
          <p
            className="text-heading-l tabular mt-2 font-mono text-gray-900"
            role="status"
            aria-live="polite"
          >
            {awakeSoFar} ms
          </p>
          <p className="text-body-s mt-2 text-gray-600">
            Summed from the steps up to here. A whole cycle itemises {ITEMISED_AWAKE_MS} ms against
            the stated figure of about {STATED_AWAKE_MS} ms. Both come from the source and neither
            is adjusted to fit the other.
          </p>
          {PERIODIC_STEP ? (
            <p className="text-body-s mt-4 text-gray-600">
              <span className="font-medium text-gray-900">
                Step {PERIODIC_STEP.n}, {PERIODIC_STEP.step}.
              </span>{" "}
              {PERIODIC_STEP.detail}. It does not run on every cycle, so it adds nothing to the
              per-cycle total.
            </p>
          ) : null}
        </Card>
      </div>

      <Card tone="teal">
        <p className="text-body-s text-gray-900">{TRUST_RULE}</p>
        <p className="text-body-s mt-3 text-gray-600">
          {SAFETY.onlyRedDoses} {SAFETY.noOutsideDosing}
        </p>
      </Card>
    </div>
  );
}
