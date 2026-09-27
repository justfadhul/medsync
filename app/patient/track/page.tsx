import type { DoseSlot } from "@/lib/patient/doses";
import type { ReadingRow } from "@/lib/patient/self-tracking";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, ClockIcon, PlusIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { DataTableEmpty, Pill } from "@/components/ui/data-table";
import { buildDayDoses, pendingSlotAt, rowTint, slotStateLabel } from "@/lib/patient/doses";
import { requirePatientScope } from "@/lib/patient/scope";
import {
  formatReadingValue,
  formatReadingWhen,
  listMedicationsForDay,
  listRecentReadings,
  listTakesForDay,
  READING_KIND_LABEL,
  SCHEDULE_PATTERN_LABEL,
} from "@/lib/patient/self-tracking";
import { cn } from "@/lib/utils";
import { startOfDay } from "../_components/day-strip";
import { DoseStatus } from "../_components/dose-status";
import { PatientPageHeader } from "../_components/page-header";
import { TintedRow } from "../_components/tinted-row";
import { MarkTakenButton } from "./_components/mark-taken-button";
import { ReadingActions } from "./_components/reading-actions";

export const metadata: Metadata = { title: "Track · MedSync" };
export const dynamic = "force-dynamic";

/** How many readings the list shows. The count chip says so when it bites. */
const READINGS_SHOWN = 30;

export default async function PatientTrackHub() {
  const scope = await requirePatientScope();
  const now = new Date();
  const day = startOfDay(now);

  // The same three fetchers the dose timeline runs, so the hub and
  // /patient/track/doses can never disagree about what is still due.
  const [readings, medications, takes] = await Promise.all([
    listRecentReadings(scope.userId, READINGS_SHOWN),
    listMedicationsForDay(scope.userId, day),
    listTakesForDay(scope.userId, day),
  ]);

  const dayDoses = buildDayDoses({ medications, takes, day, now });

  const slotsByMed = new Map<string, DoseSlot[]>();
  for (const slot of dayDoses.slots) {
    const list = slotsByMed.get(slot.medicationId);
    if (list) list.push(slot);
    else slotsByMed.set(slot.medicationId, [slot]);
  }
  // An as-needed medicine has no slots, so its takes are the only record of
  // it today — carry them into the row's sub-line rather than losing them.
  const asNeededTakes = new Map(dayDoses.asNeeded.map((r) => [r.medicationId, r.takenTimeLabels]));

  const missed = dayDoses.slots.filter((s) => s.state === "missed").length;
  const activeCount = medications.filter((m) => m.state === "active").length;
  const readingsToday = readings.filter((r) => isSameDay(new Date(r.recordedAtIso), now)).length;

  return (
    <div className="stagger-children flex flex-col gap-6">
      <PatientPageHeader
        eyebrow="MedSync · Tracking"
        title="Day to day"
        description="Only you can see this — it is not shared with a clinician yet."
      />

      {/* ── Today at a glance ─────────────────────────────────── */}
      <section aria-labelledby="glance-head">
        <h2 id="glance-head" className="sr-only">
          Today at a glance
        </h2>
        <dl className="bg-card dark:shadow-card grid grid-cols-3 divide-x rounded-xl shadow-xs">
          <Stat label="Doses" value={`${dayDoses.taken}/${dayDoses.total}`} />
          <Stat label="Readings" value={String(readingsToday)} />
          <Stat label="Medicines" value={String(activeCount)} />
        </dl>
      </section>

      {/* The hub's one call to action. In the flow rather than pinned: a
          fixed bar would land under the layout's own fixed tab bar on a
          phone, and the pinned pill is for forms, which this is not. */}
      <Link
        href="/patient/track/log"
        className={cn(
          buttonVariants({ size: "lg" }),
          "w-full rounded-full md:w-auto md:self-start",
        )}
      >
        <PlusIcon aria-hidden className="size-4" />
        Log a reading
      </Link>

      {/* Below @5xl the two columns fall back into source order, which is
          the order a phone shows them in — doses first, then readings. */}
      <div className="grid gap-6 @5xl/page:grid-cols-[minmax(0,1fr)_20rem] @5xl/page:items-start">
        <div className="flex flex-col gap-6">
          {/* ── The timeline, and the way in ──────────────────── */}
          {medications.length > 0 ? (
            <Link
              href="/patient/track/doses"
              className="bg-card dark:shadow-card tap group flex min-h-16 items-center gap-3 rounded-xl px-4 py-3 shadow-xs md:hover:brightness-[0.98] dark:md:hover:brightness-110"
            >
              <span
                aria-hidden
                className="bg-accent text-accent-foreground grid size-10 shrink-0 place-items-center rounded-full"
              >
                <ClockIcon strokeWidth={1.5} className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-foreground text-body-m block font-medium">
                  Open dose timeline
                </span>
                <span className="text-muted-foreground text-body-s flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>{doseSummary(dayDoses.total, dayDoses.taken, dayDoses.next)}</span>
                  {/* Amber and a word. A dose you didn't record is not an
                      emergency, so it is never red and never an ✗. */}
                  {missed > 0 ? <Pill tone="caution">{missed} missed</Pill> : null}
                </span>
              </span>
              <ArrowRightIcon
                aria-hidden
                className="text-muted-foreground duration-fast ease-expo-out size-4 shrink-0 transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          ) : null}

          {/* ── Today's medicines ─────────────────────────────── */}
          <section className="flex flex-col gap-3" aria-labelledby="medicines-head">
            <div className="flex items-center justify-between gap-3">
              <h2 id="medicines-head" className="text-heading-s">
                Today&rsquo;s medicines
              </h2>
              <Link
                href="/patient/track/medications?add=1"
                aria-label="Add a medication"
                className={buttonVariants({ variant: "ghost", size: "iconLg" })}
              >
                <PlusIcon aria-hidden className="size-5" />
              </Link>
            </div>

            {medications.length === 0 ? (
              <div className="bg-card dark:shadow-card rounded-xl p-5 shadow-xs">
                <DataTableEmpty
                  title="No medicines yet"
                  description="Add what you take and the day lays itself out — each dose at its time, and what is still to come."
                  action={
                    <Link
                      href="/patient/track/medications?add=1"
                      className={buttonVariants({ variant: "secondary", size: "lg" })}
                    >
                      Add a medication
                    </Link>
                  }
                />
              </div>
            ) : (
              <ul className="stagger-children flex flex-col gap-2">
                {medications.map((med) => {
                  const active = med.state === "active";
                  const slots = slotsByMed.get(med.id) ?? [];
                  // Nearest to the clock, never the earliest: one button
                  // stands for the whole medicine here, so it has to name
                  // the slot it is recording against, and naming the first
                  // unrecorded one writes a 19:55 tap against 08:00 — which
                  // leaves the 20:00 dose the patient actually just took
                  // unclaimed, to flip to "Missed" at 21:00.
                  const pendingSlot = pendingSlotAt(slots, now);
                  const lastSlot = slots.at(-1);
                  const takenLabels = asNeededTakes.get(med.id) ?? [];

                  return (
                    <TintedRow
                      key={med.id}
                      tint={active ? rowTint(med.id) : "neutral"}
                      iconKey="pill"
                      title={med.name}
                      subtitle={medicineLine(med, takenLabels)}
                      href="/patient/track/medications"
                      trailing={
                        !active ? (
                          <Pill tone="neutral">
                            {med.state === "paused" ? "Paused" : "Stopped"}
                          </Pill>
                        ) : pendingSlot ? (
                          <MarkTakenButton
                            // Keyed on the slot, not the medicine: this
                            // control *is* the pending slot, and a stale
                            // error from the dose before it should not
                            // survive the flip.
                            key={pendingSlot.key}
                            medicationId={med.id}
                            scheduledForIso={pendingSlot.at.toISOString()}
                          />
                        ) : lastSlot ? (
                          <DoseStatus
                            state={lastSlot.state}
                            label={slotStateLabel(lastSlot, day, now)}
                          />
                        ) : (
                          // No slots at all: as-needed, or a schedule we
                          // can't turn into times. A take is still real.
                          <MarkTakenButton medicationId={med.id} />
                        )
                      }
                    />
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* ── Recent readings ─────────────────────────────────── */}
        <section className="flex flex-col gap-3" aria-labelledby="readings-head">
          <div className="flex items-center justify-between gap-3">
            <h2 id="readings-head" className="text-heading-s">
              Recent readings
            </h2>
            {readings.length > 0 ? (
              <span className="text-muted-foreground text-caption tabular font-mono">
                {readings.length === READINGS_SHOWN
                  ? `latest ${READINGS_SHOWN}`
                  : `${readings.length} ${readings.length === 1 ? "entry" : "entries"}`}
              </span>
            ) : null}
          </div>

          {readings.length === 0 ? (
            medications.length === 0 ? (
              <EmptyReadings />
            ) : (
              <p className="text-muted-foreground text-body-m leading-relaxed">
                Nothing logged yet. &ldquo;Log a reading&rdquo; above starts your first one.
              </p>
            )
          ) : (
            <ul className="stagger-children flex flex-col gap-2">
              {readings.map((r) => (
                <ReadingCard key={r.id} reading={r} now={now} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/* ── Stat ─────────────────────────────────────────────────────── */

/** One cell of the glance strip. A read-out, not a link: all three of its
 *  destinations are already one tap away on this screen. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <dt className="text-muted-foreground text-overline font-mono uppercase">{label}</dt>
      <dd className="text-foreground text-heading-m tabular font-mono leading-none">{value}</dd>
    </div>
  );
}

/* ── Reading card ─────────────────────────────────────────────── */

function ReadingCard({ reading, now }: { reading: ReadingRow; now: Date }) {
  const kindLabel = READING_KIND_LABEL[reading.kind] ?? reading.kind;
  const when = formatReadingWhen(reading.recordedAtIso, now);
  const value = formatReadingValue(reading);
  // A note or a symptom has no number. Render the prose where the value
  // would go rather than leaving an empty mono slot — and then don't
  // repeat it underneath.
  const valueText = value ?? (reading.note ? truncate(reading.note, 80) : null);
  const noteBelow = value && reading.note ? reading.note : null;

  return (
    <li className="bg-card dark:shadow-card flex items-start gap-2 rounded-xl p-4 shadow-xs">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-foreground text-body-m truncate font-medium">{kindLabel}</span>
          <span className="text-muted-foreground text-body-s tabular shrink-0 font-mono">
            {when}
          </span>
        </div>
        {valueText ? (
          <span className="text-foreground text-heading-s tabular font-mono">{valueText}</span>
        ) : reading.severity === null ? (
          <span className="text-muted-foreground text-body-s">No value recorded</span>
        ) : null}
        {/* Plain text, in the same words the home screen uses, because the
            two screens must not disagree about the same field — and
            uncoloured, because amber is a judgement. `personal_health_logs`
            carries no reference range and no threshold: a severity the
            patient chose themselves, whose own form copy calls 1 "barely
            noticeable", cannot be graded by us. Decision support, never
            autonomous. */}
        {reading.severity !== null ? (
          <span className="text-muted-foreground text-body-s">
            Severity <span className="font-mono tabular-nums">{reading.severity}</span> of 5
          </span>
        ) : null}
        {noteBelow ? (
          <p className="text-muted-foreground text-body-s line-clamp-2 leading-relaxed">
            {noteBelow}
          </p>
        ) : null}
      </div>
      <ReadingActions readingId={reading.id} label={`${kindLabel} logged ${when}`} />
    </li>
  );
}

/* ── Readings empty state ─────────────────────────────────────── */

/** A dotted baseline waiting for its first point — the same quiet figure
 *  this page has always opened with, retokenised. */
function EmptyReadings() {
  return (
    <div className="bg-card dark:shadow-card flex flex-col gap-3 rounded-xl p-5 shadow-xs">
      <svg
        viewBox="0 0 320 40"
        aria-hidden
        className="text-muted-foreground/40 h-10 w-full"
        fill="none"
      >
        <path
          d="M4 28 H316"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray="1 7"
        />
        <circle cx="48" cy="28" r="3" className="fill-brand-500/60" />
      </svg>
      <div className="flex flex-col gap-1">
        <span className="text-foreground text-body-m font-medium">Nothing logged yet</span>
        <p className="text-muted-foreground text-body-s max-w-[44ch] leading-relaxed">
          One reading is enough to start. Even a single entry a day adds up quickly when you look
          back at the week.
        </p>
      </div>
    </div>
  );
}

/* ── Helpers ──────────────────────────────────────────────────── */

/** What the timeline card promises before you tap it. Counts only — there
 *  is no adherence target in the data, so there is no fraction of one. */
function doseSummary(
  total: number,
  taken: number,
  next: { name: string; timeLabel: string } | null,
): string {
  if (total === 0) return "No set times yet";
  const recorded = `${taken} of ${total} recorded`;
  return next ? `${recorded} · next ${next.timeLabel} ${next.name}` : recorded;
}

function medicineLine(
  med: { dose: string | null; instructions: string | null; schedulePattern: string },
  takenLabels: ReadonlyArray<string>,
): string | undefined {
  const parts = [
    med.dose,
    SCHEDULE_PATTERN_LABEL[med.schedulePattern] ?? med.schedulePattern,
    med.instructions,
    takenLabels.length > 0 ? `Taken ${takenLabels.join(", ")}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…";
}
