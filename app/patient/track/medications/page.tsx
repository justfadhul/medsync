import type { MedicationRow } from "@/lib/patient/self-tracking";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { PillIcon, PlusIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Pill } from "@/components/ui/data-table";
import { rowTint } from "@/lib/patient/doses";
import { requirePatientScope } from "@/lib/patient/scope";
import { listMedicationsForDay, SCHEDULE_PATTERN_LABEL } from "@/lib/patient/self-tracking";
import { cn } from "@/lib/utils";
import { PatientPageHeader } from "../../_components/page-header";
import { TintedRow } from "../../_components/tinted-row";
import { AddMedicationSheet, MedActions } from "./_components/med-actions";

export const metadata: Metadata = { title: "Medications · MedSync" };
export const dynamic = "force-dynamic";

const PAGE_PATH = "/patient/track/medications";
const ADD_HREF = `${PAGE_PATH}?add=1`;

interface PageProps {
  searchParams: Promise<{ add?: string }>;
}

export default async function PatientMedicationsPage({ searchParams }: PageProps) {
  const [scope, params] = await Promise.all([requirePatientScope(), searchParams]);

  // The day fetcher rather than an active-only one: a medicine stopped earlier
  // today still belongs to today, so it stays on the list until tomorrow with
  // its state on show, instead of disappearing mid-day.
  const medications = await listMedicationsForDay(scope.userId, new Date());
  const rows = medications.map((med) => ({ med, times: clockTimes(med.scheduleTimes) }));

  const active = rows.filter((r) => r.med.state === "active");
  const stopped = rows.filter((r) => r.med.state !== "active");

  return (
    <div className="stagger-children flex flex-col gap-6">
      <PatientPageHeader
        eyebrow="MedSync · Medications"
        title="What you take"
        description="A list you manage yourself. Give each one the times you take it and it turns up on your dose timeline."
        backHref="/patient/track"
        backLabel="Back to tracking"
        action={
          <Link
            href={ADD_HREF}
            scroll={false}
            aria-label="Add a medication"
            className={buttonVariants({ size: "iconLg" })}
          >
            <PlusIcon aria-hidden className="size-5" />
          </Link>
        }
      />

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        // Container query, not a viewport one: the rail and the gutters take
        // roughly 300px out of the window before this grid ever sees it. Below
        // the threshold the aside falls under the list, which is the order the
        // phone shows them in.
        <div className="grid gap-6 @5xl/page:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex flex-col gap-6">
            <section aria-labelledby="meds-active" className="flex flex-col gap-3">
              <SectionHead id="meds-active" title="Taking now" count={active.length} />
              {active.length === 0 ? (
                <EmptyNote>Nothing on your active list right now.</EmptyNote>
              ) : (
                <ul className="stagger-children flex flex-col gap-2">
                  {active.map(({ med, times }) => (
                    <TintedRow
                      key={med.id}
                      tint={rowTint(med.id)}
                      iconKey="pill"
                      title={med.name}
                      subtitle={subtitleOf(med, times)}
                      trailing={
                        <MedActions
                          medicationId={med.id}
                          name={med.name}
                          schedulePattern={med.schedulePattern}
                          times={times}
                        />
                      }
                    />
                  ))}
                </ul>
              )}
            </section>

            {stopped.length > 0 ? (
              <section aria-labelledby="meds-stopped" className="flex flex-col gap-3">
                <SectionHead id="meds-stopped" title="No longer taking" count={stopped.length} />
                <ul className="stagger-children flex flex-col gap-2">
                  {stopped.map(({ med, times }) => (
                    <TintedRow
                      key={med.id}
                      // `neutral` is the one tint that carries meaning, so it
                      // always ships with the word beside it.
                      tint="neutral"
                      iconKey="pill"
                      title={med.name}
                      subtitle={subtitleOf(med, times)}
                      trailing={
                        <Pill tone="neutral">{med.state === "paused" ? "Paused" : "Stopped"}</Pill>
                      }
                    />
                  ))}
                </ul>
              </section>
            ) : null}
          </div>

          <aside aria-labelledby="meds-times" className="flex flex-col gap-3">
            <h2 id="meds-times" className="text-foreground text-heading-s">
              Dose times
            </h2>
            <div className="bg-card dark:shadow-card flex flex-col gap-3 rounded-xl p-4 shadow-xs">
              <p className="text-muted-foreground text-body-s leading-relaxed">
                {timesSummary(active)}
              </p>
              <p className="text-muted-foreground text-body-s leading-relaxed">
                A medicine with times set appears on your timeline at each of them. Without times it
                stays in the as-needed list, where nothing is ever counted as missed.
              </p>
              <Link
                href="/patient/track/doses"
                className={cn(buttonVariants({ variant: "secondary" }), "w-fit")}
              >
                Open dose timeline
              </Link>
            </div>
          </aside>
        </div>
      )}

      <AddMedicationSheet open={params.add === "1"} />
    </div>
  );
}

function SectionHead({ id, title, count }: { id: string; title: string; count: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 id={id} className="text-foreground text-heading-s">
        {title}
      </h2>
      <span className="text-muted-foreground text-caption font-mono tabular-nums">{count}</span>
    </div>
  );
}

function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p className="text-muted-foreground bg-card text-body-s dark:shadow-card rounded-xl p-4 shadow-xs">
      {children}
    </p>
  );
}

/**
 * The empty state is itself the way in. Moving the add form into a sheet took
 * away the permanently-expanded form at the foot of the page, which was the
 * only thing a patient with no medications could reach — so this card carries
 * the same `?add=1` link the header's "+" does.
 */
function EmptyState() {
  return (
    <section className="bg-card dark:shadow-card flex flex-col items-start gap-3 rounded-xl p-5 shadow-xs md:p-6">
      <span
        aria-hidden
        className="bg-brand-200 text-brand-800 grid size-10 place-items-center rounded-full"
      >
        <PillIcon strokeWidth={1.5} className="size-5" />
      </span>
      <h2 className="text-foreground text-heading-s">No medicines yet</h2>
      <p className="text-muted-foreground text-body-s max-w-[48ch] leading-relaxed">
        Add what you take and the times you take it. That is what turns your dose timeline into a
        day you can read at a glance.
      </p>
      <Link href={ADD_HREF} scroll={false} className={buttonVariants()}>
        Add your first medicine
      </Link>
    </section>
  );
}

/**
 * Postgres hands a `time[]` back as "08:00:00"; every consumer here — the
 * sub-line, the `<input type="time">` and `setMedicationTimesAction` — speaks
 * "HH:MM". Deduped and sorted, so the row reads in the order the day runs.
 * Anything that is not a clock time is dropped rather than shown.
 */
function clockTimes(times: string[] | null): string[] {
  if (!times) return [];
  const seen = new Set<string>();
  for (const raw of times) {
    const match = /^([01]\d|2[0-3]):([0-5]\d)/.exec(raw ?? "");
    if (match) seen.add(`${match[1]}:${match[2]}`);
  }
  return [...seen].sort();
}

/**
 * Dose, schedule, instructions — one line, truncated on a narrow screen but
 * complete in the DOM, so a screen reader still gets all three.
 *
 * When a scheduled medicine has times, the times *are* its schedule: the
 * derivation reads them and ignores the coarse pattern, so printing both
 * would have the row describing one thing and the timeline doing another. An
 * as-needed medicine never gets slots, so there the pattern is the whole
 * truth whatever times happen to be stored.
 */
function subtitleOf(med: MedicationRow, times: string[]): string {
  const pattern = SCHEDULE_PATTERN_LABEL[med.schedulePattern] ?? med.schedulePattern;
  const schedule =
    med.schedulePattern !== "as_needed" && times.length > 0 ? times.join(" · ") : pattern;
  return [med.dose, schedule, med.instructions].filter(Boolean).join(" · ");
}

/** How much of the active list the timeline can actually place on a clock. */
function timesSummary(active: ReadonlyArray<{ med: MedicationRow; times: string[] }>): string {
  const schedulable = active.filter((r) => r.med.schedulePattern !== "as_needed");
  if (schedulable.length === 0) {
    return "Everything you are taking is as needed, so there is nothing to put on a clock.";
  }
  const untimed = schedulable.filter((r) => r.times.length === 0).length;
  if (untimed === 0) return "Every scheduled medicine has its times set.";
  if (untimed === schedulable.length) {
    return "None of your scheduled medicines have times yet, so none of them reach the timeline.";
  }
  return untimed === 1
    ? "One scheduled medicine still needs its times."
    : `${untimed} scheduled medicines still need their times.`;
}
