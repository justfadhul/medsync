import type { AsNeededRow } from "@/lib/patient/doses";
import type { Metadata } from "next";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { DataTableEmpty, Pill } from "@/components/ui/data-table";
import { buildDayDoses, isRecordableDay, TINT_ROW } from "@/lib/patient/doses";
import { requirePatientScope } from "@/lib/patient/scope";
import {
  listMedicationsForDay,
  listTakesForDay,
  SCHEDULE_PATTERN_LABEL,
} from "@/lib/patient/self-tracking";
import { cn } from "@/lib/utils";
import { MarkTakenButton } from "../_components/mark-taken-button";
import {
  addDays,
  clampDay,
  DayStrip,
  fromDayIso,
  startOfDay,
  toDayIso,
} from "../../_components/day-strip";
import { DoseTimeline } from "../../_components/dose-timeline";
import { PatientPageHeader } from "../../_components/page-header";
import { TintedRow } from "../../_components/tinted-row";

export const metadata: Metadata = { title: "Doses · MedSync" };
export const dynamic = "force-dynamic";

/** How far back a patient may look. Forward is never — you cannot record
 *  a dose you have not taken, and a week is as far back as the timeline can
 *  say anything useful about. */
const REACHABLE_DAYS = 7;

const DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

interface PageProps {
  searchParams: Promise<{ d?: string }>;
}

/**
 * The dose timeline: one day, one clock, every medicine on it.
 *
 * The selected day is the `?d=YYYY-MM-DD` search param and nothing else —
 * no client state, no picker component — so the page is shareable, the back
 * button works, and the day survives a refresh. Anything outside
 * `[today − 7, today]` is clamped rather than rejected: a stale bookmark
 * should land on today, not on an error.
 */
export default async function PatientDosesPage({ searchParams }: PageProps) {
  const [params, scope] = await Promise.all([searchParams, requirePatientScope()]);

  const now = new Date();
  const today = startOfDay(now);
  const earliest = addDays(today, -REACHABLE_DAYS);
  const day = clampDay(fromDayIso(params.d) ?? today, earliest, today);
  const isToday = day.getTime() === today.getTime();

  const [medications, takes] = await Promise.all([
    listMedicationsForDay(scope.userId, day),
    listTakesForDay(scope.userId, day),
  ]);
  const dayDoses = buildDayDoses({ medications, takes, day, now });

  // One group per clock time: several medicines at 08:00 are one act, so
  // they share a label and a dot. `slots` is already chronological.
  const groups: { timeLabel: string; isNext: boolean; slots: typeof dayDoses.slots }[] = [];
  for (const slot of dayDoses.slots) {
    const last = groups.at(-1);
    if (last?.timeLabel === slot.timeLabel) last.slots.push(slot);
    else
      groups.push({
        timeLabel: slot.timeLabel,
        isNext: slot.timeLabel === dayDoses.next?.timeLabel,
        slots: [slot],
      });
  }

  const stateById = new Map(medications.map((m) => [m.id, m.state]));
  const missed = dayDoses.slots.filter((s) => s.state === "missed").length;
  const hasTimeless = dayDoses.asNeeded.some((row) => row.hasNoTimes);
  const hasContext = dayDoses.total > 0 || dayDoses.asNeeded.length > 0;
  // The same rule the timeline gates its buttons on, read from the same
  // place, so the summary never offers a recording the screen can't take.
  const recordable = isRecordableDay(day, now);

  return (
    <div className="stagger-children flex flex-col gap-6">
      <PatientPageHeader
        eyebrow="MedSync · Doses"
        title="Doses"
        description="What you take, and when. This is your own record — it is not shared with a clinician."
        backHref="/patient/track"
        backLabel="Back to tracking"
      />

      <DayStrip
        selectedIso={toDayIso(day)}
        basePath="/patient/track/doses"
        minIso={toDayIso(earliest)}
        maxIso={toDayIso(today)}
      />

      <div
        className={
          hasContext
            ? "grid gap-6 @5xl/page:grid-cols-[minmax(0,1fr)_20rem] @5xl/page:items-start"
            : "grid gap-6"
        }
      >
        <section aria-labelledby="doses-head" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 id="doses-head" className="text-foreground text-heading-s">
              {isToday ? "Today" : DATE_FMT.format(day)}
            </h2>
            <Link
              href="/patient/track/medications"
              className={cn(buttonVariants({ variant: "link", size: "sm" }), "min-h-11")}
            >
              Manage medicines
            </Link>
          </div>

          {medications.length === 0 ? (
            <div className="bg-card dark:shadow-card rounded-xl p-6 shadow-xs">
              {isToday ? (
                <DataTableEmpty
                  title="Nothing to track yet"
                  description="Add a medicine and the times you take it, and this becomes your day at a glance."
                  action={
                    <Link
                      href="/patient/track/medications"
                      className={buttonVariants({ size: "lg" })}
                    >
                      Add a medication
                    </Link>
                  }
                />
              ) : (
                <p className="text-muted-foreground text-body-m leading-relaxed">
                  You weren&rsquo;t tracking any medicines on {DATE_FMT.format(day)}.
                </p>
              )}
            </div>
          ) : groups.length === 0 ? (
            // The likely state on day one: medicines exist, none carry times.
            // It gets a sentence and a real next step, not an error face.
            <p className="text-muted-foreground text-body-m max-w-[60ch] leading-relaxed">
              None of your medicines have set times yet — they&rsquo;re all below, as needed. Add
              times to one and it appears here on the clock.
            </p>
          ) : (
            <DoseTimeline groups={groups} day={day} now={now} />
          )}
        </section>

        {hasContext ? (
          <aside aria-labelledby="day-detail-head" className="flex flex-col gap-6">
            {/* The sections below carry their own headings; this one names
                the landmark that holds them, the way the medicines page
                names its own aside. Unnamed, it announces as a bare
                "complementary". */}
            <h2 id="day-detail-head" className="sr-only">
              More about this day
            </h2>
            {dayDoses.total > 0 ? (
              // A plain box, not a second named region inside the aside:
              // two sentences are not a landmark.
              <div className="bg-card dark:shadow-card flex flex-col gap-1 rounded-xl p-4 shadow-xs">
                <p className="text-foreground text-body-m tabular font-mono">
                  {dayDoses.taken} of {dayDoses.total} doses recorded
                </p>
                <p className="text-muted-foreground text-body-s">
                  {missed === 0
                    ? "Recorded by you, for you — nothing here is adherence data."
                    : recordable
                      ? `${missed} with no entry past its time. You can still record ${missed === 1 ? "it" : "them"}.`
                      : `${missed} with no entry past its time.`}
                </p>
              </div>
            ) : null}

            {dayDoses.asNeeded.length > 0 ? (
              <section aria-labelledby="as-needed-head" className="flex flex-col gap-3">
                <h2 id="as-needed-head" className="text-foreground text-heading-s">
                  As needed
                </h2>
                <ul className="stagger-children flex flex-col gap-2">
                  {dayDoses.asNeeded.map((row) => (
                    <AsNeededItem
                      key={row.medicationId}
                      row={row}
                      state={stateById.get(row.medicationId) ?? "active"}
                      recordable={isToday}
                    />
                  ))}
                </ul>
                {hasTimeless ? (
                  <p className="text-muted-foreground text-body-s leading-relaxed">
                    Some of these follow a schedule but have no times set.{" "}
                    <Link
                      href="/patient/track/medications"
                      className="text-primary underline-offset-4 hover:underline focus-visible:underline"
                    >
                      Add times
                    </Link>{" "}
                    to put them on the timeline.
                  </p>
                ) : null}
              </section>
            ) : null}

            {dayDoses.extras.length > 0 ? (
              <section aria-labelledby="extras-head" className="flex flex-col gap-2">
                <h2 id="extras-head" className="text-foreground text-heading-s">
                  Also recorded
                </h2>
                <p className="text-muted-foreground text-body-s leading-relaxed">
                  Doses you recorded beyond the schedule. Nothing is wrong with them.
                </p>
                <ul className="flex flex-wrap gap-1.5">
                  {dayDoses.extras.map((extra) => (
                    <li
                      key={extra.key}
                      // The medicine's own recognition tint, which the row
                      // for it upstairs already wears — and which is the
                      // only reason the chip is visible at all: `gray-100`
                      // on the layout's `bg-muted` ground is #f5f5f5 on
                      // #fafafa light, #171717 on #111111 dark.
                      className={cn(
                        "text-muted-foreground text-caption tabular rounded-full px-3 py-1.5",
                        TINT_ROW[extra.tint],
                      )}
                    >
                      <span className="text-foreground font-medium">{extra.name}</span>
                      <span className="font-mono"> · {extra.timeLabel}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A medicine with no slots on this day — as-needed, or a schedule whose
 * times were never set. It is never scored and never "missed": there is no
 * time it could have been late for.
 */
function AsNeededItem({
  row,
  state,
  recordable,
}: {
  row: AsNeededRow;
  state: string;
  recordable: boolean;
}) {
  const active = state === "active";
  const recorded = row.takenTimeLabels.length
    ? `Recorded ${row.takenTimeLabels.join(", ")}`
    : "None recorded";
  const subtitle = [row.dose, row.hasNoTimes ? SCHEDULE_PATTERN_LABEL[row.schedulePattern] : null]
    .filter(Boolean)
    .concat(recorded)
    .join(" · ");

  return (
    <TintedRow
      tint={row.tint}
      iconKey="pill"
      title={row.name}
      subtitle={subtitle}
      trailing={
        active ? (
          recordable ? (
            <MarkTakenButton
              medicationId={row.medicationId}
              label={`Record a dose of ${row.name}`}
              size="iconLg"
            />
          ) : null
        ) : (
          // `neutral` is the tint for a medicine that is no longer running,
          // and a tint never carries meaning on its own — so it ships the
          // word with it.
          <Pill tone="neutral">{state === "paused" ? "Paused" : "Stopped"}</Pill>
        )
      }
    />
  );
}
