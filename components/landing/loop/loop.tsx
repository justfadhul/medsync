import { CheckIcon, RotateCcwIcon } from "lucide-react";

import { Section, SectionHeader } from "@/components/landing/primitives";
import { LOOP, LOOP_LOCKED } from "@/content/loop";
import { cn } from "@/lib/utils";

/**
 * S3 — The loop: one record from admission to the next visit, all four steps
 * visible at once, drawn in CSS. Server-rendered, zero client JavaScript, no
 * motion. One markup, two layouts:
 *
 *   ≥ lg  a two-row grid: step text (row 1) above a stadium (row 2) holding the
 *         fragments. Each <li> spans both rows through subgrid, so the <ol> stays
 *         one list of title + sentence + fragment; the nodes sit on the stadium's
 *         top border at the column centres.
 *   < lg  a rail down the left edge (each <li>'s ::before) through the nodes,
 *         ending in a U-turn marker and the loop label.
 *
 * The drawing (stadium, chevrons, label, U-turn) and the nodes are aria-hidden;
 * the sr-only summary tells the story. Teal-600 is only ever a ring or a stroke
 * here; teal text is teal-700.
 */
export function Loop() {
  return (
    <Section id="loop" labelledBy="loop-title" tight>
      <SectionHeader
        n={3}
        kicker={LOOP.kicker}
        title={LOOP.title}
        titleId="loop-title"
        aside={<p className="text-body-m text-muted-foreground">{LOOP.intro}</p>}
      />

      <p className="sr-only">{LOOP.summary}</p>

      <div className="mt-10 lg:grid lg:grid-rows-[auto_auto] lg:gap-y-7">
        <ol
          role="list"
          className="lg:relative lg:z-10 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:grid lg:grid-cols-4 lg:grid-rows-subgrid lg:gap-x-6 lg:px-6"
        >
          {LOOP.steps.map((step, i) => (
            <li
              key={step.title}
              className="relative pb-6 pl-11 before:absolute before:top-7 before:bottom-0 before:left-3.25 before:border-l-2 before:border-gray-300 lg:row-span-2 lg:grid lg:grid-rows-subgrid lg:p-0 lg:before:hidden"
            >
              {/* Phones: on the rail. lg: centred on the stadium's 2px top border. */}
              <span
                aria-hidden="true"
                data-loop-node
                className="bg-background absolute top-0 left-0 grid size-7 place-items-center rounded-full border-2 border-teal-600 font-mono text-xs text-teal-700 tabular-nums lg:relative lg:col-start-1 lg:row-start-2 lg:mt-px lg:-translate-y-1/2 lg:self-start lg:justify-self-center"
              >
                {i + 1}
              </span>
              <div className="flex flex-col gap-1 pt-0.5 lg:row-start-1 lg:items-center lg:pt-0 lg:text-center">
                <h3 className="text-heading-s text-foreground text-balance">{step.title}</h3>
                <p className="text-body-m text-muted-foreground lg:max-w-[28ch]">{step.body}</p>
              </div>
              <RecordFragment pairs={LOOP_LOCKED[i] ?? []} />
            </li>
          ))}
        </ol>

        <div
          aria-hidden="true"
          data-loop-drawing
          className="flex items-center gap-4 lg:relative lg:col-start-1 lg:row-start-2 lg:block lg:rounded-full lg:border-2 lg:border-gray-300"
        >
          <span className="bg-background text-muted-foreground grid size-7 shrink-0 place-items-center rounded-full border-2 border-gray-300 lg:hidden">
            <RotateCcwIcon className="size-3.5" strokeWidth={2} />
          </span>
          <span className="text-muted-foreground lg:bg-background font-mono text-xs lg:absolute lg:bottom-px lg:left-1/2 lg:-translate-x-1/2 lg:translate-y-1/2 lg:px-3 lg:whitespace-nowrap">
            {LOOP.loopLabel}
          </span>
          <Chevron className="top-1/2 right-px translate-x-1/2 -translate-y-1/2" />
          <Chevron className="bottom-px left-1/4 -translate-x-1/2 translate-y-1/2 rotate-90" />
        </div>
      </div>

      <p className="text-caption text-muted-foreground mt-4 font-mono lg:text-right">
        {LOOP.caption}
      </p>
    </Section>
  );
}

/** One step's slice of the record. Phones: label left, value right; lg: stacked, sized to content. */
function RecordFragment({
  pairs,
}: {
  pairs: ReadonlyArray<{ label: string; value: string; check?: boolean }>;
}) {
  return (
    <dl className="bg-muted border-gray-150 mt-3 flex max-w-sm flex-col gap-1 rounded-lg border px-3 py-2.5 lg:col-start-1 lg:row-start-2 lg:my-8 lg:w-44 lg:max-w-none lg:gap-2 lg:self-start lg:justify-self-center">
      {pairs.map(({ label, value, check }) => (
        <div
          key={label}
          className="flex items-baseline justify-between gap-3 lg:flex-col lg:items-start lg:gap-0"
        >
          <dt className="text-overline text-muted-foreground font-mono uppercase">{label}</dt>
          <dd className="text-body-m/5.5 text-foreground flex items-center gap-1.5">
            {check ? (
              <CheckIcon
                aria-hidden="true"
                className="size-3.5 shrink-0 text-teal-700"
                strokeWidth={2}
              />
            ) : null}
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The hero's arrowhead (4.5px arms, 1.5 stroke, round caps), pointing down; rotate for left. */
function Chevron({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("absolute hidden size-4 stroke-teal-600 lg:block", className)}
    >
      <path d="M3.5 5.75 8 10.25l4.5-4.5" />
    </svg>
  );
}
