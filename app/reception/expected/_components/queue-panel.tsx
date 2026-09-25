import type { PillTone } from "@/components/ui/pill";
import type { DayQueueRow } from "@/lib/reception/queries";

import { Panel } from "@/components/medsync/panel";
import { Pill } from "@/components/ui/pill";
import { DEFAULT_TIME_ZONE } from "@/supabase/functions/_shared/slots";

const SECTIONS: ReadonlyArray<{ bucket: DayQueueRow["bucket"]; title: string; empty?: string }> = [
  { bucket: "seeing", title: "Now seeing" },
  { bucket: "waiting", title: "Waiting", empty: "No one waiting." },
  { bucket: "declared", title: "Declared, not here yet" },
  { bucket: "done", title: "Done" },
];

/** Level 1 is the one genuine emergency; the word carries it either way. */
const TRIAGE_TONE: Record<number, PillTone> = {
  1: "critical",
  2: "caution",
  3: "caution",
  4: "neutral",
  5: "neutral",
};

/**
 * The day's queue beside the booked board. Today it is live (the disc counts
 * people in the building); a past day is the record; a future day has no
 * queue yet and says so. Codes, never names — see `fetchQueueForDay`.
 */
export function QueuePanel({
  rows,
  when,
  expected,
}: {
  rows: ReadonlyArray<DayQueueRow>;
  when: "past" | "today" | "future";
  expected: number;
}) {
  if (when === "future") {
    return (
      <Panel title="Queue">
        <p className="text-muted-foreground text-body-s p-5 leading-relaxed">
          The queue forms on the day — {expected} expected.
        </p>
      </Panel>
    );
  }

  const present = rows.filter((r) => r.bucket === "seeing" || r.bucket === "waiting").length;
  return (
    <Panel
      title="Queue"
      count={when === "today" ? present : undefined}
      action={
        when === "past" ? (
          <span className="text-muted-foreground text-caption">
            Read-only · the day&rsquo;s record
          </span>
        ) : null
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 xl:max-h-[calc(100svh-22rem)] xl:overflow-y-auto">
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-body-s">
            {when === "today" ? "No one has arrived yet." : "No one came through on this day."}
          </p>
        ) : (
          SECTIONS.map(({ bucket, title, empty }) => {
            const list = rows.filter((r) => r.bucket === bucket);
            if (list.length === 0 && !(empty && when === "today")) return null;
            return (
              <section key={bucket} className="flex flex-col gap-1.5">
                <h3 className="text-muted-foreground text-overline font-mono uppercase">
                  {title} · {list.length}
                </h3>
                {list.length === 0 ? (
                  <p className="text-muted-foreground text-body-s">{empty}</p>
                ) : (
                  <ul className="stagger-children flex flex-col gap-1">
                    {list.map((r) => (
                      <li
                        key={r.id}
                        className="border-border flex items-start justify-between gap-2 rounded-md border px-2.5 py-2"
                      >
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="text-foreground text-body-s truncate font-medium">
                            {r.patientCode ? (
                              <span className="font-mono tabular-nums">{r.patientCode}</span>
                            ) : (
                              (r.patientUnknownLabel ?? "Unknown patient")
                            )}
                          </span>
                          <span className="text-muted-foreground text-caption font-normal">
                            {[
                              r.departmentName ?? "No department",
                              r.declaredByPatient ? "From the app" : r.entryTypeName,
                              // Which door the desk sent them through (ADR 0101); a
                              // row from before the choice existed was triaged.
                              bucket === "declared"
                                ? null
                                : r.routedTo === "clinic"
                                  ? "To clinic"
                                  : "To triage",
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                          <span className="text-muted-foreground text-caption font-mono tabular-nums">
                            {bucket === "declared" ? "declared" : "since"}{" "}
                            {formatClock(r.presenceAtIso)}
                          </span>
                        </div>
                        {r.triageLevel ? (
                          <Pill tone={TRIAGE_TONE[r.triageLevel] ?? "neutral"} className="shrink-0">
                            Triage L{r.triageLevel}
                          </Pill>
                        ) : r.priorityHint !== "routine" ? (
                          <Pill tone="caution" className="shrink-0">
                            {r.priorityHint === "urgent" ? "Urgent" : "High priority"}
                          </Pill>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })
        )}
      </div>
    </Panel>
  );
}

/** "09:12" on the hospital's clock — 24-hour, per the design system. */
function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: DEFAULT_TIME_ZONE,
  });
}
