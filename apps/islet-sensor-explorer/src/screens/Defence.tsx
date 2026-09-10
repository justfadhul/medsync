import { useId, useState } from "react";

import { Card } from "@/components/ui/Card";
import { SectionNumber } from "@/components/ui/SectionNumber";
import { DEFENCE_LAYERS, SAFETY } from "@/content/sensor";
import { cn } from "@/lib/cn";
import { bracketCode, findScreen } from "@/lib/content";

/* Drawing geometry. The innermost ring is the sensing surface, so the rings
   read outwards in the order the content file numbers them: layer 1 is what
   touches fluid, layer 7 is where the whole thing is placed. */
const VIEW = { width: 640, height: 520 };
/* The rings sit left of centre so the names have room to the right of the
   number that marks each one. */
const CENTRE_X = 236;
const CENTRE_Y = 260;
const INNER_R = 40;
const RING_STEP = 26;

function ringRadius(index: number): number {
  return INNER_R + index * RING_STEP;
}

/** A short label for a ring, so the drawing carries words as well as numbers. */
function shortName(name: string): string {
  const bracket = name.indexOf(" (");
  return bracket > 0 ? name.slice(0, bracket) : name;
}

export function Defence() {
  const screen = findScreen("/defence");
  const [active, setActive] = useState<number | null>(null);
  const [removed, setRemoved] = useState<number | null>(null);
  const baseId = useId();

  if (!screen) return null;

  const activeLayer = DEFENCE_LAYERS.find((layer) => layer.n === active);
  const removedLayer = DEFENCE_LAYERS.find((layer) => layer.n === removed);
  const holding = DEFENCE_LAYERS.filter((layer) => layer.n !== removed);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <header className="flex flex-col gap-3">
        <SectionNumber code={bracketCode(screen.code)} className="self-start" />
        <h1 className="font-display text-heading-l lg:text-display-s text-gray-900">
          {screen.title}
        </h1>
        <p className="text-body-l max-w-prose text-gray-600">{screen.blurb}</p>
        <p className="text-body-m max-w-prose text-gray-600">
          Seven layers stand between the electronics and the body, and between the body and the
          sensing surface. They are not ranked: each one does a different job, and none of them is
          load bearing on its own. Take one away and the rest are still there.
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* The rings */}
        <figure className="m-0 flex min-w-0 flex-col gap-4">
          <div className="hidden lg:block">
            <svg
              viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
              role="group"
              aria-labelledby={`${baseId}-title`}
              preserveAspectRatio="xMidYMid meet"
              className="mx-auto block h-auto w-full max-w-xl"
            >
              <title id={`${baseId}-title`}>
                Seven concentric layers of defence, the sensing surface innermost
              </title>

              {/* Drawn from the outside in, so the inner rings sit on top */}
              {[...DEFENCE_LAYERS].reverse().map((layer) => {
                const index = layer.n - 1;
                const r = ringRadius(index);
                const isActive = active === layer.n;
                const isRemoved = removed === layer.n;
                return (
                  <g
                    key={layer.n}
                    role="button"
                    tabIndex={0}
                    aria-label={`${layer.n} ${shortName(layer.name)}. Layer ${layer.n}, ${layer.name}. ${layer.promise}${isRemoved ? " This layer is currently removed." : ""}`}
                    aria-pressed={isActive}
                    onMouseEnter={() => setActive(layer.n)}
                    onMouseLeave={() => setActive(null)}
                    onFocus={() => setActive(layer.n)}
                    onBlur={() => setActive(null)}
                    onClick={() => setRemoved(removed === layer.n ? null : layer.n)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setRemoved(removed === layer.n ? null : layer.n);
                      }
                      if (event.key === "Escape") setRemoved(null);
                    }}
                    className="ease-expo-out cursor-pointer transition-opacity duration-150 focus:outline-none motion-reduce:transition-none"
                  >
                    <circle
                      cx={CENTRE_X}
                      cy={CENTRE_Y}
                      r={r}
                      strokeWidth={isActive ? 3 : 1.5}
                      strokeDasharray={isRemoved ? "4 5" : undefined}
                      className={cn(
                        "fill-none",
                        isRemoved
                          ? "stroke-gray-300"
                          : isActive
                            ? "stroke-teal-700"
                            : "stroke-teal-600",
                      )}
                    />
                    {/* A wider transparent ring, so the line is comfortable to hit */}
                    <circle
                      cx={CENTRE_X}
                      cy={CENTRE_Y}
                      r={r}
                      strokeWidth={16}
                      className="fill-none stroke-transparent"
                    />
                    {/* The number sits on the ring, at the top */}
                    <circle
                      cx={CENTRE_X}
                      cy={CENTRE_Y - r}
                      r={9}
                      strokeWidth={1}
                      className={cn(
                        isRemoved ? "fill-gray-100 stroke-gray-300" : "fill-card stroke-teal-600",
                      )}
                    />
                    {/* Number and name in one text element with positioned
                        spans. Separate elements concatenate with no space, so
                        the ring's visible text would read "7Placement" and
                        would not match its accessible name. */}
                    <text
                      stroke="var(--color-card)"
                      strokeWidth={3}
                      paintOrder="stroke"
                      className="text-caption"
                    >
                      <tspan
                        x={CENTRE_X}
                        y={CENTRE_Y - r + 4}
                        textAnchor="middle"
                        className={cn(
                          "tabular font-mono",
                          isRemoved ? "fill-gray-400" : "fill-teal-800",
                        )}
                      >
                        {layer.n}
                      </tspan>
                      <tspan
                        x={CENTRE_X + 14}
                        y={CENTRE_Y - r + 4}
                        className={cn(
                          isRemoved
                            ? "fill-gray-400"
                            : isActive
                              ? "fill-teal-800 font-medium"
                              : "fill-gray-600",
                        )}
                      >
                        {" "}
                        {shortName(layer.name)}
                      </tspan>
                    </text>
                  </g>
                );
              })}

              <circle
                cx={CENTRE_X}
                cy={CENTRE_Y}
                r={INNER_R - 12}
                className="pointer-events-none fill-teal-50"
                aria-hidden="true"
              />
              <text
                x={CENTRE_X}
                y={CENTRE_Y + 4}
                textAnchor="middle"
                aria-hidden="true"
                className="text-caption pointer-events-none fill-teal-800 font-medium"
              >
                Body
              </text>
            </svg>
          </div>

          <figcaption className="text-body-s text-gray-600">
            <span className="font-medium text-gray-900">Seven layers.</span> Hover or focus a ring
            to read what it promises. Select one to take it away and see the rest still holding.
          </figcaption>
        </figure>

        {/* The panel */}
        <aside className="flex flex-col gap-6 lg:sticky lg:top-32 lg:self-start">
          <Card tone={activeLayer ? "teal" : "standard"} aria-live="polite">
            {activeLayer ? (
              <>
                <p className="text-overline text-gray-500 uppercase">Layer {activeLayer.n}</p>
                <h2 className="text-heading-s mt-2 text-gray-900">{activeLayer.name}</h2>
                <p className="text-body-s mt-2 text-gray-600">{activeLayer.promise}</p>
              </>
            ) : (
              <>
                <h2 className="text-heading-s text-gray-900">What each layer promises</h2>
                <p className="text-body-s mt-2 text-gray-600">
                  Hover or focus a ring, or pick a layer from the list below, to read its promise.
                </p>
              </>
            )}
          </Card>

          <Card tone="muted">
            <h2 className="text-overline text-gray-500 uppercase">Remove a layer</h2>
            {removedLayer ? (
              <>
                <p className="text-body-s mt-3 text-gray-900">
                  Layer {removedLayer.n}, {shortName(removedLayer.name).toLowerCase()}, is removed.
                </p>
                <p className="text-body-s mt-2 text-gray-600">
                  The other {holding.length} are still standing. None of the seven is doing the
                  whole job on its own, which is the point of having seven.
                </p>
                <button
                  type="button"
                  onClick={() => setRemoved(null)}
                  className="tap ease-expo-out bg-card text-body-s mt-4 rounded-md border border-gray-200 px-3 py-2 font-medium text-gray-900 transition-colors duration-150 hover:border-teal-100 hover:bg-teal-50 motion-reduce:transition-none"
                >
                  Put it back
                </button>
              </>
            ) : (
              <p className="text-body-s mt-3 text-gray-600">
                All seven are in place. Select a ring, or a row in the list, to take one away.
              </p>
            )}
          </Card>
        </aside>
      </div>

      {/* The full list: the same seven layers in words, and the whole content at 390px */}
      <section aria-labelledby="defence-list" className="min-w-0">
        <h2 id="defence-list" className="text-overline text-gray-500 uppercase">
          The seven layers
        </h2>
        <ol className="mt-4 flex flex-col gap-2">
          {DEFENCE_LAYERS.map((layer) => {
            const isRemoved = removed === layer.n;
            return (
              <li key={layer.n} className="min-w-0">
                <button
                  type="button"
                  onClick={() => setRemoved(isRemoved ? null : layer.n)}
                  onMouseEnter={() => setActive(layer.n)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(layer.n)}
                  onBlur={() => setActive(null)}
                  aria-pressed={isRemoved}
                  className={cn(
                    "tap ease-expo-out grid w-full grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3 gap-y-1",
                    "rounded-md border px-3 py-2 text-left transition-colors duration-150",
                    "motion-reduce:transition-none",
                    isRemoved
                      ? "border-gray-300 bg-gray-50"
                      : "bg-card border-gray-200 hover:border-teal-100 hover:bg-teal-50",
                  )}
                >
                  <span className="text-caption tabular font-mono text-gray-500">{layer.n}</span>
                  <span className="min-w-0">
                    <span
                      className={cn(
                        "text-body-s block font-medium",
                        isRemoved ? "text-gray-500" : "text-gray-900",
                      )}
                    >
                      {layer.name}
                      {isRemoved ? " (removed)" : ""}
                    </span>
                    <span className="text-body-s block text-gray-600">{layer.promise}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </section>

      <Card tone="teal">
        <p className="text-body-s text-gray-900">
          None of these seven layers doses anything. {SAFETY.onlyRedDoses}
        </p>
      </Card>
    </div>
  );
}
