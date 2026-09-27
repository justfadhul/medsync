import type { EffectiveSchedulingSettings, Slot } from "@/supabase/functions/_shared/slots";

import { DEFAULT_TIME_ZONE } from "@/supabase/functions/_shared/slots";

/**
 * What a patient will actually be offered — the consequence of everything
 * declared below it.
 *
 * This is a server component on purpose: every instant is formatted in the
 * hospital's zone, never the browser's, so it must not re-render on a
 * client whose clock says Europe.
 *
 * Why a per-day summary and not the slot list: one legitimate block already
 * in this database — "every week, Monday 06:00 until Friday 11:00" — runs to
 * several hundred slots over this fortnight, and a wall of timestamps that
 * long answers no question a clinician has. Per day it answers all of them
 * in fourteen rows however much is declared: whether a weekly block expanded
 * (the same weekday keeps reappearing), what grid the slot length and
 * buffer produce (09:00 09:20 09:40), where the department's opening hours
 * clip it (a 06:00 block whose first offer is 08:00), and what leave took
 * away (a day that drops to nothing).
 */

const TIMES_SHOWN = 4;

const DAY_KEY = new Intl.DateTimeFormat("en-CA", {
  timeZone: DEFAULT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const DAY_LABEL = new Intl.DateTimeFormat("en-GB", {
  timeZone: DEFAULT_TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
});

/** 24-hour, per the design system's clinical-data rules. */
const CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: DEFAULT_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export interface SlotPreviewProps {
  slots: ReadonlyArray<Slot>;
  effective: EffectiveSchedulingSettings;
  /** Which rung of ADR 0029 §2's chain the settings above came from. */
  source: "clinician" | "department" | "hard-default";
  policy: {
    bookableWeekdays: number[];
    bookableStartMinutesLocal: number;
    bookableEndMinutesLocal: number;
  } | null;
  departmentName: string;
  kindCounts: Record<string, number>;
  rangeStart: Date;
  days: number;
}

export function SlotPreview({
  slots,
  effective,
  source,
  policy,
  departmentName,
  kindCounts,
  rangeStart,
  days,
}: SlotPreviewProps) {
  const dayRows = groupByDay(slots, rangeStart, days);

  const bookableBlocks = kindCounts.bookable ?? 0;
  const blockingBlocks = (kindCounts.leave ?? 0) + (kindCounts.unavailable ?? 0);
  const recordedOnlyBlocks =
    (kindCounts.teaching ?? 0) +
    (kindCounts.ward_round ?? 0) +
    (kindCounts.admin ?? 0) +
    (kindCounts.custom ?? 0);

  return (
    <section
      aria-labelledby="slot-preview-heading"
      className="border-border bg-card overflow-hidden rounded-lg border"
    >
      <header className="border-border flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-3 sm:px-6">
        <h2 id="slot-preview-heading" className="text-foreground text-body-s font-medium">
          What patients can book
        </h2>
        <span className="text-muted-foreground text-caption ml-auto font-mono tabular-nums">
          next {days} days · {departmentName}
        </span>
      </header>

      <div className="flex flex-col gap-2 px-4 py-4 sm:px-6">
        <p className="text-foreground text-body-s flex items-baseline gap-2">
          <span className="text-heading-m tabular-nums">{slots.length}</span>
          <span>
            {slots.length === 1 ? "bookable appointment" : "bookable appointments"} in the next{" "}
            {days} days
          </span>
        </p>

        {bookableBlocks === 0 ? (
          <p className="text-muted-foreground text-body-s leading-relaxed">
            You have declared no bookable hours, so there is nothing for a patient to choose. Add a{" "}
            <span className="text-foreground font-medium">Bookable</span> block below and this count
            changes.
          </p>
        ) : slots.length === 0 ? (
          <p className="text-muted-foreground text-body-s leading-relaxed">
            Your <span className="text-foreground font-medium tabular-nums">{bookableBlocks}</span>{" "}
            bookable {bookableBlocks === 1 ? "block produces" : "blocks produce"} nothing in this
            window. The lines below are every rule applied to them.
          </p>
        ) : null}

        <ul className="text-muted-foreground text-body-s flex flex-col gap-1 leading-relaxed">
          <li>{settingsLine(effective, source, departmentName)}</li>
          <li>{openingLine(policy, departmentName)}</li>
          {blockingBlocks > 0 ? (
            <li>
              Your declared leave and unavailable time is already subtracted from the count above.
            </li>
          ) : null}
          {recordedOnlyBlocks > 0 ? (
            <li>
              Teaching, ward rounds, admin and custom blocks are recorded but do not stop a booking
              — declare <span className="text-foreground font-medium">Unavailable</span> over time a
              patient must not reach.
            </li>
          ) : null}
        </ul>
      </div>

      {slots.length > 0 ? (
        <div className="border-border overflow-x-auto border-t">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">
              Bookable appointments per day for the next {days} days, in {departmentName}
            </caption>
            <thead>
              <tr className="text-muted-foreground text-overline border-border border-b uppercase">
                <th scope="col" className="px-4 py-2 font-mono font-semibold sm:px-6">
                  Day
                </th>
                <th scope="col" className="px-2 py-2 text-right font-mono font-semibold">
                  Slots
                </th>
                <th scope="col" className="px-4 py-2 font-mono font-semibold">
                  Offered from
                </th>
              </tr>
            </thead>
            <tbody className="divide-border/70 divide-y">
              {dayRows.map(({ key, label, times }) => (
                <tr key={key}>
                  <th
                    scope="row"
                    className="text-foreground text-body-s px-4 py-1.5 font-medium whitespace-nowrap tabular-nums sm:px-6"
                  >
                    {label}
                  </th>
                  <td className="text-foreground text-caption px-2 py-1.5 text-right font-mono tabular-nums">
                    {times.length > 0 ? times.length : "—"}
                  </td>
                  <td className="px-4 py-1.5 whitespace-nowrap">
                    {times.length === 0 ? (
                      <span className="text-muted-foreground text-caption">Nothing bookable</span>
                    ) : (
                      <span className="text-foreground text-caption font-mono tabular-nums">
                        {times.slice(0, TIMES_SHOWN).join("  ")}
                        {times.length > TIMES_SHOWN ? (
                          <span className="text-muted-foreground">
                            {"  "}+{times.length - TIMES_SHOWN} more
                          </span>
                        ) : null}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

/* ─── 483 slots → one row per day ─────────────────────────────────── */

export interface DayRow {
  /** The Kampala civil date, YYYY-MM-DD. */
  key: string;
  label: string;
  /** Every offered start on that day, ascending, 24-hour. */
  times: string[];
}

/**
 * One row per day of the window, whether or not it has slots — a day that
 * dropped to nothing is the visible half of declared leave, and a clinician
 * who declared nothing needs to see the zeroes.
 *
 * Days are the HOSPITAL's, never the reader's: a slot at 01:00 Kampala is
 * still Tuesday here when the browser rendering it says Monday 22:00.
 */
export function groupByDay(slots: ReadonlyArray<Slot>, rangeStart: Date, days: number): DayRow[] {
  const byDay = new Map<string, string[]>();
  for (const slot of slots) {
    const key = DAY_KEY.format(slot.startsAt);
    const times = byDay.get(key) ?? [];
    times.push(CLOCK.format(slot.startsAt));
    byDay.set(key, times);
  }

  // Stepping by 24h is safe because East Africa Time never shifts — the same
  // assumption `DEFAULT_TIME_ZONE` itself rests on.
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(rangeStart.getTime() + i * 86_400_000);
    const key = DAY_KEY.format(date);
    return { key, label: DAY_LABEL.format(date), times: byDay.get(key) ?? [] };
  });
}

/* ─── the honest provenance lines ─────────────────────────────────── */

/**
 * ADR 0029 §2 is clinician override → department policy → hard default, and
 * every column in both tables is NOT NULL — so the whole ROW decides which
 * rung applies. Naming the rung is the difference between telling a
 * clinician what they chose and telling them what was chosen for them.
 */
export function settingsLine(
  effective: EffectiveSchedulingSettings,
  source: SlotPreviewProps["source"],
  departmentName: string,
): string {
  const grid =
    effective.bufferMinutes > 0
      ? `${effective.slotMinutes}-minute slots with a ${effective.bufferMinutes}-minute gap between patients`
      : `${effective.slotMinutes}-minute slots, back to back`;

  if (source === "clinician") return `${grid} — your own setting.`;
  if (source === "department") {
    return `${grid} — ${departmentName}'s default. You have not set your own.`;
  }
  return `${grid} — MedSync's default. Neither you nor ${departmentName} has set one.`;
}

export function openingLine(policy: SlotPreviewProps["policy"], departmentName: string): string {
  if (!policy) {
    return `${departmentName} has not set opening hours, so nothing clips your blocks.`;
  }
  // An empty weekday list is closed every day, not open every day — the same
  // reading the engine applies.
  const open = weekdayList(policy.bookableWeekdays);
  if (!open) {
    return `${departmentName} has no open days set, so nothing is bookable however much you declare.`;
  }
  return (
    `${departmentName} is open ${open}, ${hhmm(policy.bookableStartMinutesLocal)}–` +
    `${hhmm(policy.bookableEndMinutesLocal)}. A slot that would run outside that is not offered, ` +
    `whatever you declare.`
  );
}

/** ISO weekdays, accepting 0 for Sunday the way the engine does. */
function weekdayList(weekdays: ReadonlyArray<number>): string {
  return Array.from(new Set(weekdays.map((w) => (Number(w) === 0 ? 7 : Number(w)))))
    .filter((w) => w >= 1 && w <= 7)
    .sort((a, b) => a - b)
    .map((w) => WEEKDAY_SHORT[w - 1])
    .join(", ");
}

/** Minutes from local midnight → 24-hour clock. 1440 stays 24:00, not 00:00. */
function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
