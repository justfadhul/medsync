import type { AgreementState } from "@/content/sensor";
import type { PlaygroundInputs } from "@/lib/playground";
import { useMemo, useState } from "react";

import { Controls } from "@/components/playground/Controls";
import { Gauge } from "@/components/playground/Gauge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SectionNumber } from "@/components/ui/SectionNumber";
import { ARBITRATION_NOTE, PHYSICS, SAFETY, STATES, TRUST_RULE } from "@/content/sensor";
import { cn } from "@/lib/cn";
import { bracketCode, findScreen } from "@/lib/content";
import { cleanCurrent, cleanRatio, DEFAULT_INPUTS, holdTrust, runModel } from "@/lib/playground";

/** The tone each agreement state uses. Colour never travels without its label. */
const TONE: Record<AgreementState["colour"], "teal" | "caution" | "critical" | "pending"> = {
  teal: "teal",
  amber: "caution",
  red: "critical",
  grey: "pending",
};

/** The card's own surface per state, so the state is legible at a glance too. */
const SURFACE: Record<AgreementState["colour"], string> = {
  teal: "border-teal-100 bg-teal-50",
  amber: "border-status-caution-bg bg-status-caution-bg/40",
  red: "border-alert-border bg-card",
  grey: "border-gray-200 bg-gray-50",
};

function StateCard({
  state,
  heading,
  reason,
  className,
}: {
  state: AgreementState;
  heading: string;
  reason?: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border p-6", SURFACE[state.colour], className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-overline text-gray-500 uppercase">{heading}</p>
        <Badge label={state.label} tone={TONE[state.colour]} />
      </div>
      <h3 className="text-heading-m mt-3 text-gray-900">{state.label}</h3>
      <p className="text-body-s mt-1 text-gray-600">{state.condition}</p>
      {reason ? <p className="text-body-s mt-3 text-gray-900">{reason}</p> : null}

      <dl className="mt-5 flex flex-col gap-4">
        <div>
          <dt className="text-caption text-gray-500">What the controller may do</dt>
          <dd className="text-body-s mt-0.5 font-medium text-gray-900">{state.controller}</dd>
        </div>
        <div>
          <dt className="text-caption text-gray-500">What the patient sees</dt>
          <dd className="text-body-s mt-0.5 text-gray-900">{state.patientSees}</dd>
        </div>
        <div>
          <dt className="text-caption text-gray-500">What MedSync does</dt>
          <dd className="text-body-s mt-0.5 text-gray-900">{state.medsync}</dd>
        </div>
      </dl>
    </div>
  );
}

/** [06] Playground: break a sensor and watch what the controller is allowed to do. */
export function Playground() {
  const screen = findScreen("/playground");
  const [inputs, setInputs] = useState<PlaygroundInputs>(DEFAULT_INPUTS);
  const [held, setHeld] = useState<AgreementState>(() => runModel(DEFAULT_INPUTS).state);

  const result = useMemo(() => runModel(inputs), [inputs]);

  function change(next: Partial<PlaygroundInputs>) {
    const merged = { ...inputs, ...next };
    setInputs(merged);
    // Trust ratchets down as the inputs move. It is never recomputed from
    // scratch, which is what stops a reader lifting autonomy by tidying up the
    // sliders after having broken a sensor.
    setHeld((previous) => holdTrust(previous, runModel(merged).state));
  }

  function resetAll() {
    setInputs(DEFAULT_INPUTS);
    setHeld(runModel(DEFAULT_INPUTS).state);
  }

  function resetTrust() {
    setHeld(result.state);
  }

  if (!screen) return null;

  const heldIsLower = held.autonomy < result.state.autonomy;
  // The gauges are drawn against the reading at the top of the glucose range,
  // so the bars stay comparable as the sliders move.
  const ratioMax = cleanRatio(PHYSICS.glucose.max) + PHYSICS.optical.mannitolOffset;
  const currentMax = cleanCurrent(PHYSICS.glucose.max) + PHYSICS.enzymatic.paracetamolOffset;
  const glucoseMax = PHYSICS.glucose.max + PHYSICS.optical.mannitolOffset / PHYSICS.optical.slope;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <header className="flex flex-col gap-3">
        <SectionNumber code={bracketCode(screen.code)} className="self-start" />
        <h1 className="font-display text-heading-l lg:text-display-s text-gray-900">
          {screen.title}
        </h1>
        <p className="text-body-l max-w-prose text-gray-600">{screen.blurb}</p>
        <p className="text-body-s max-w-prose text-gray-500">
          {PHYSICS.disclaimer} It exists to show how the two sensors keep each other honest and what
          happens to insulin autonomy when one of them stops being trustworthy. Nothing here doses
          anything.
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[22rem_minmax(0,1fr)]">
        {/* Controls */}
        <section aria-labelledby="pg-controls" className="min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="pg-controls" className="text-overline text-gray-500 uppercase">
              Controls
            </h2>
            <Button variant="ghost" size="sm" onClick={resetAll}>
              Reset everything
            </Button>
          </div>
          <div className="mt-4">
            <Controls inputs={inputs} onChange={change} />
          </div>
        </section>

        {/* Readouts and state */}
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby="pg-readouts" className="min-w-0">
            <h2 id="pg-readouts" className="text-overline text-gray-500 uppercase">
              What each sensor reports
            </h2>
            <div className="mt-4 grid gap-6 sm:grid-cols-2">
              <Gauge
                label="Optical ratio, R (dimensionless)"
                value={result.ratio}
                unit=""
                max={ratioMax}
                note={
                  inputs.photobleaching > 0
                    ? `Both channels are at ${(result.channels.reference * 100).toFixed(0)} per cent of full strength. ${PHYSICS.photobleaching.note}`
                    : undefined
                }
              />
              <Gauge
                label={`Enzymatic current, I (${PHYSICS.enzymatic.unit})`}
                value={result.current}
                unit={PHYSICS.enzymatic.unit}
                max={currentMax}
              />
              <Gauge
                label={`Glucose A, optical (${PHYSICS.glucose.unit})`}
                value={result.a.value}
                unit={PHYSICS.glucose.unit}
                places={1}
                max={glucoseMax}
                flagged={result.a.flags.length > 0}
                note={result.a.flags[0]}
              />
              <Gauge
                label={`Glucose B, electrochemical (${PHYSICS.glucose.unit})`}
                value={result.b.value}
                unit={PHYSICS.glucose.unit}
                places={1}
                max={glucoseMax}
                flagged={result.b.flags.length > 0}
                note={result.b.flags[0]}
              />
              <Gauge
                className="sm:col-span-2"
                label={`Difference between them, |A minus B| (${PHYSICS.glucose.unit})`}
                value={result.difference}
                unit={PHYSICS.glucose.unit}
                places={2}
                max={Math.max(result.tolerance * 3, result.difference * 1.1, 1)}
                marker={{
                  at: result.tolerance,
                  label: `They agree while the difference stays at or under ${result.tolerance.toFixed(2)} ${PHYSICS.glucose.unit}, which is the wider of ${PHYSICS.tolerance.absoluteMmol.toFixed(1)} ${PHYSICS.glucose.unit} and ${PHYSICS.tolerance.relativeFraction * 100} per cent of their mean. Right now they ${result.agree ? "agree" : "disagree"}.`,
                }}
                flagged={!result.agree}
              />
            </div>
          </section>

          <StateCard
            state={held}
            heading="What the controller is allowed to do"
            reason={heldIsLower ? undefined : result.reason}
          />

          {heldIsLower ? (
            <Card tone="muted">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-body-s font-medium text-gray-900">
                    The sensors read {result.state.label.toLowerCase()} again, but the controller is
                    still held at {held.label.toLowerCase()}.
                  </p>
                  <p className="text-body-s mt-1 text-gray-600">
                    Trust does not come back on its own. Tidying the sliders up after breaking a
                    sensor cannot raise insulin autonomy: a clinician has to look at the implant and
                    release it. This button stands in for that review.
                  </p>
                </div>
                <Button variant="secondary" size="sm" onClick={resetTrust}>
                  Clinician review: release the hold
                </Button>
              </div>
              <hr className="my-5 border-gray-200" />
              <StateCard
                state={result.state}
                heading="What the sensors say right now"
                reason={result.reason}
                className="border-0 bg-transparent p-0"
              />
            </Card>
          ) : null}

          {result.state.id === "invalid" &&
          result.a.flags.length === 0 &&
          result.b.flags.length === 0 ? (
            <Card tone="muted">
              <h3 className="text-heading-s text-gray-900">Why this is invalid and not doubtful</h3>
              <p className="text-body-s mt-2 text-gray-600">{ARBITRATION_NOTE}</p>
            </Card>
          ) : null}

          {/* Every state, so the one showing is read against the others */}
          <section aria-labelledby="pg-all-states" className="min-w-0">
            <h2 id="pg-all-states" className="text-overline text-gray-500 uppercase">
              The four states, in order of how much the controller may do
            </h2>
            <ol className="mt-4 flex flex-col gap-2">
              {[...STATES]
                .sort((a, b) => b.autonomy - a.autonomy)
                .map((state) => {
                  const showing = state.id === held.id;
                  return (
                    <li
                      key={state.id}
                      aria-current={showing ? "true" : undefined}
                      className={cn(
                        "grid gap-x-3 gap-y-1 rounded-md border px-3 py-2 sm:grid-cols-[10rem_minmax(0,1fr)]",
                        showing ? "ring-ring/40 border-teal-600 ring-2" : "bg-card border-gray-200",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <Badge label={state.label} tone={TONE[state.colour]} />
                      </span>
                      <span className="text-body-s min-w-0 text-gray-600">{state.controller}</span>
                    </li>
                  );
                })}
            </ol>
          </section>
        </div>
      </div>

      {/* The rule, verbatim, pinned to the foot of the screen */}
      <div className="bg-background sticky bottom-0 z-10 border-t border-gray-200 pt-4 pb-4">
        <p className="text-body-s font-medium text-gray-900">{TRUST_RULE}</p>
        <p className="text-caption mt-1 text-gray-600">
          {SAFETY.onlyRedDoses} {SAFETY.noOutsideDosing}
        </p>
      </div>
    </div>
  );
}
