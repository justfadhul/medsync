import type { WardFigures } from "@/lib/nurse/ward-overview";

/** The in-charge's ward at a glance (ADR 0545, Phase 1). Counts only; a figure the build cannot count says so. */
export function WardFiguresPanel({ wards }: { wards: WardFigures[] }) {
  if (!wards.length) return null;
  return (
    <section aria-labelledby="ward-figures" className="flex flex-col gap-3">
      <h2 id="ward-figures" className="text-heading-m text-foreground">
        Your ward today
      </h2>
      {wards.map((w) => {
        const occ =
          w.beds && w.beds.usable > 0
            ? Math.round(((w.beds.occupied + w.beds.arriving) / w.beds.usable) * 100)
            : null;
        const onTime = w.vitals.withDue
          ? Math.round(((w.vitals.withDue - w.vitals.late) / w.vitals.withDue) * 100)
          : null;
        const tiles: [string, string, string][] = [
          [
            "Occupancy",
            occ === null ? "—" : `${occ}%`,
            w.beds
              ? `${w.beds.occupied + w.beds.arriving} of ${w.beds.usable} beds · ${w.beds.free} free`
              : "Needs the ward plan",
          ],
          ["Admitted", String(w.admittedToday), "arrived today"],
          [
            "Waiting for a bed",
            w.waitingForBed === null ? "—" : String(w.waitingForBed),
            w.waitingForBed === null ? "Needs the ward plan" : "decided, not yet in a bed",
          ],
          ["Nurses with patients", String(w.nursesWithPatients), `${w.patients} patients assigned`],
          [
            "Vitals on time",
            onTime === null ? "—" : `${onTime}%`,
            w.vitals.withDue
              ? `${w.vitals.late} late of ${w.vitals.withDue} with a frequency`
              : "No observation charts with a frequency",
          ],
          ["Not given", String(w.notGivenToday), "doses withheld or refused today"],
          [
            "Incidents",
            w.incidents ? String(w.incidents.falls + w.incidents.pressure) : "—",
            w.incidents
              ? `this month · falls ${w.incidents.falls} · pressure injuries ${w.incidents.pressure}`
              : "Needs the incident log (migration 0315)",
          ],
        ];
        return (
          <div
            key={w.wardId}
            className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4"
          >
            <span className="text-muted-foreground font-mono text-[10.5px] tracking-[0.14em] uppercase">
              {w.wardName}
            </span>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
              {tiles.map(([label, value, note]) => (
                <div
                  key={label}
                  className="flex min-w-0 flex-col gap-0.5"
                  title={`${label}: ${value}, ${note}`}
                >
                  <span className="text-muted-foreground text-[11.5px]">{label}</span>
                  <span className="text-foreground text-heading-m tabular-nums">{value}</span>
                  <span className="text-muted-foreground text-caption">{note}</span>
                </div>
              ))}
            </div>
            <p className="text-muted-foreground text-caption">
              Counted from the ward&rsquo;s own records. Incidents are this month&rsquo;s reports.
            </p>
          </div>
        );
      })}
    </section>
  );
}
