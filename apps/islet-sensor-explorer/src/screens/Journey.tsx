import { useState } from "react";

import { PathSample } from "@/components/diagram/PathSample";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { SectionNumber } from "@/components/ui/SectionNumber";
import { JOURNEY, JOURNEY_COMPARISON, PATH_LABELS, SAFETY } from "@/content/sensor";
import { cn } from "@/lib/cn";
import { bracketCode, findScreen } from "@/lib/content";

/**
 * The comparison the content file states is a delay at the second station. The
 * screen shows it as an extra step wedged in there rather than as a number of
 * its own: the wording is the content file's and is never restated.
 */
const SKIN_AT_STATION = 2;

export function Journey() {
  const screen = findScreen("/journey");
  const [index, setIndex] = useState(0);
  const [compare, setCompare] = useState(false);

  if (!screen) return null;

  const current = JOURNEY[index];
  if (!current) return null;
  const last = JOURNEY.length - 1;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <header className="flex flex-col gap-3">
        <SectionNumber code={bracketCode(screen.code)} className="self-start" />
        <h1 className="font-display text-heading-l lg:text-display-s text-gray-900">
          {screen.title}
        </h1>
        <p className="text-body-l max-w-prose text-gray-600">{screen.blurb}</p>
        <p className="text-body-m max-w-prose text-gray-600">
          One value, from the blood it is really in to the person who acts on it. Each station adds
          its own delay, and the delays are not the same size.
        </p>
      </header>

      {/* Scrubber and comparison toggle */}
      <section aria-labelledby="journey-controls" className="border-y border-gray-200 py-5">
        <h2 id="journey-controls" className="text-overline text-gray-500 uppercase">
          Move along the journey
        </h2>
        <label className="mt-3 flex flex-col gap-1.5">
          <span className="text-caption text-gray-500">
            Station {current.n} of {JOURNEY.length}: {current.name}
          </span>
          <input
            type="range"
            min={0}
            max={last}
            step={1}
            value={index}
            onChange={(event) => setIndex(Number(event.target.value))}
            className="accent-primary w-full max-w-lg"
            aria-label="Station"
            aria-valuetext={`Station ${current.n} of ${JOURNEY.length}, ${current.name}, ${current.arrival}`}
          />
        </label>

        <div className="mt-4 flex items-start gap-3">
          <input
            id="journey-compare"
            type="checkbox"
            checked={compare}
            onChange={(event) => setCompare(event.target.checked)}
            className="accent-primary mt-0.5 size-4 shrink-0"
          />
          <label htmlFor="journey-compare" className="min-w-0 flex-1 cursor-pointer">
            <span className="text-body-s block font-medium text-gray-900">
              Compare with a skin (subcutaneous) sensor
            </span>
            <span className="text-caption block text-gray-600">{JOURNEY_COMPARISON}</span>
          </label>
        </div>
      </section>

      {/* The stations */}
      <section aria-labelledby="journey-stations" className="min-w-0">
        <h2 id="journey-stations" className="text-overline text-gray-500 uppercase">
          The eight stations
        </h2>
        <ol className="mt-4 flex flex-col gap-2">
          {JOURNEY.map((station, position) => {
            const active = position === index;
            const reached = position <= index;
            const insulin = station.path === "insulin";
            return (
              <li key={station.n} className="min-w-0">
                <button
                  type="button"
                  onClick={() => setIndex(position)}
                  aria-current={active ? "step" : undefined}
                  className={cn(
                    "tap ease-expo-out grid w-full grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3 gap-y-1",
                    "rounded-md border px-3 py-2 text-left transition-colors duration-150",
                    "sm:grid-cols-[1.5rem_9rem_7rem_minmax(0,1fr)] sm:items-baseline",
                    "motion-reduce:transition-none",
                    active
                      ? "ring-ring/40 border-teal-600 bg-teal-50 ring-2"
                      : reached
                        ? "bg-card border-gray-200"
                        : "border-gray-200 bg-gray-50",
                  )}
                >
                  <span className="text-caption tabular font-mono text-gray-500">{station.n}</span>
                  <span
                    className={cn(
                      "text-body-s font-medium",
                      active ? "text-teal-800" : "text-gray-900",
                    )}
                  >
                    {station.name}
                  </span>
                  <span className="text-caption tabular font-mono text-gray-600">
                    {station.arrival}
                  </span>
                  <span className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 sm:col-span-1">
                    <PathSample path={station.path} />
                    <span className="text-caption shrink-0 text-gray-500">
                      {PATH_LABELS[station.path]}
                    </span>
                    {insulin ? (
                      <Badge label="Changes a dose" tone="critical" className="shrink-0" />
                    ) : null}
                    <span className="text-caption min-w-0 text-gray-600">{station.note}</span>
                  </span>
                </button>

                {/* The skin sensor's extra wait, wedged in where the content says */}
                {compare && station.n === SKIN_AT_STATION ? (
                  <div className="mt-2 ml-6 border-l border-dashed border-gray-300 pl-4">
                    <div className="bg-status-caution-bg/40 rounded-md border border-gray-200 px-3 py-2">
                      <p className="text-body-s font-medium text-gray-900">
                        A skin (subcutaneous) sensor would wait here
                      </p>
                      <p className="text-caption mt-1 text-gray-600">{JOURNEY_COMPARISON}</p>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      </section>

      {/* The station showing now */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <p className="text-overline text-gray-500 uppercase">
            Station {current.n} of {JOURNEY.length}
          </p>
          <h2 className="text-heading-s mt-2 text-gray-900">{current.name}</h2>
          <p className="text-caption tabular mt-1 font-mono text-gray-600">{current.arrival}</p>
          <p className="text-body-m mt-3 text-gray-600">{current.note}</p>
        </Card>

        <Card tone={current.path === "insulin" ? "standard" : "muted"}>
          <h2 className="text-overline text-gray-500 uppercase">Does this station dose</h2>
          {current.path === "insulin" ? (
            <>
              <Badge label="Changes a dose" tone="critical" className="mt-3" />
              <p className="text-body-s mt-3 text-gray-900">
                This is the only station on the journey that changes insulin, and it is inside the
                body.
              </p>
            </>
          ) : (
            <>
              <Badge label="Reports only" tone="pending" className="mt-3" />
              <p className="text-body-s mt-3 text-gray-600">
                This station carries or reads the value. It does not change a dose.
              </p>
            </>
          )}
          <p className="text-body-s mt-3 text-gray-500">{SAFETY.noOutsideDosing}</p>
        </Card>
      </div>
    </div>
  );
}
