import type { IntakeRow } from "@/lib/intake/queries";
import Link from "next/link";
import { AlertTriangleIcon, ClockIcon, DoorOpenIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Shared incoming-intakes panel for the nurse + doctor home pages.
 *
 * Renders the awaiting-triage list scoped to the caller's department
 * (the caller's page filters by departmentId when fetching). Emergency
 * rows get the rose ring + ALERT pill; the list orders emergency-first
 * already via fetchHospitalIncomingIntakes.
 *
 * Declared (patient-initiated, not-yet-arrived) rows are sorted to the
 * tail by fetchHospitalIncomingIntakes and rendered with a muted
 * "Declared · not here yet" chip — they shouldn't be confused with
 * actually-waiting patients. This is the boundary the kickoff calls
 * out: pre-queued vs present must read at a glance.
 *
 * The panel is read-only — triage doesn't exist yet, so there's no
 * "start triage" action.
 */
export function IncomingIntakesPanel({
  rows,
  departmentName,
  triageHref,
}: {
  rows: ReadonlyArray<IntakeRow>;
  departmentName: string;
  /** When set, the footer links to the triage worklist. Passed by
   * surfaces whose viewer can triage (nurse/doctor); omitted for
   * reception/admin, who can't. */
  triageHref?: string;
}) {
  return (
    <section
      aria-label="Incoming intakes"
      className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4"
    >
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-muted-foreground inline-flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.14em] uppercase">
          <DoorOpenIcon className="size-3.5" aria-hidden />
          Incoming · {departmentName}
        </h2>
        <span className="text-muted-foreground font-mono text-[10.5px] tabular-nums">
          {rows.length}
        </span>
      </header>

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-[12.5px]">
          No one incoming in {departmentName} right now.
        </p>
      ) : (
        <ul className="divide-border/60 -mx-2 flex flex-col divide-y">
          {rows.map((r) => (
            <li key={r.id} className="px-2 py-2.5">
              <IntakeRowItem row={r} />
            </li>
          ))}
        </ul>
      )}

      {triageHref ? (
        <Link
          href={triageHref}
          className="bg-brand-600 hover:bg-brand-700 inline-flex w-fit items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium text-white shadow-xs transition-colors"
        >
          Open triage worklist →
        </Link>
      ) : (
        <p className="text-muted-foreground/80 text-caption leading-relaxed">
          These arrivals are assessed on the triage worklist; clinical staff assign each an acuity
          there.
        </p>
      )}
    </section>
  );
}

/** Triage acuity chip (migration 0036). Colour matches the 5-tier model. */
const ACUITY_CHIP: Record<number, { label: string; cls: string }> = {
  1: { label: "L1 RED", cls: "bg-rose-600 text-white" },
  2: { label: "L2 ORANGE", cls: "bg-orange-500 text-white" },
  3: { label: "L3 YELLOW", cls: "bg-amber-400 text-amber-950" },
  4: { label: "L4 GREEN", cls: "bg-brand-600 text-white" },
  5: { label: "L5 BLUE", cls: "bg-slate-400 text-white" },
};

function AcuityChip({ level }: { level: number }) {
  const tier = ACUITY_CHIP[level];
  if (!tier) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-0.5 font-mono text-[9px] font-semibold",
        tier.cls,
      )}
      title={`Triaged acuity level ${level}`}
    >
      {tier.label}
    </span>
  );
}

function IntakeRowItem({ row }: { row: IntakeRow }) {
  const who = row.patientCode ?? row.patientUnknownLabel ?? "Unknown patient";
  const referrer = row.referringHospitalName ?? row.referringFacilityOther;
  const isDeclared = row.status === "declared";

  return (
    <div
      className={cn(
        "-mx-2 flex flex-col gap-1 rounded-md p-2",
        row.isEmergency && "bg-rose-50/30 ring-1 ring-rose-500/40 dark:bg-rose-950/15",
        isDeclared && !row.isEmergency && "opacity-75",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-foreground inline-flex items-center gap-1.5 text-[12.5px] font-medium">
          {who}
          {row.isEmergency ? (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-100 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
              <AlertTriangleIcon className="size-2.5" aria-hidden />
              ALERT
            </span>
          ) : null}
          {isDeclared ? (
            <span
              className="bg-brand-50 text-brand-700 ring-brand-200/60 dark:bg-brand-950/30 dark:text-brand-300 dark:ring-brand-800/40 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-mono text-[9px] font-medium ring-1"
              title="Patient said they're coming today — not checked in yet"
            >
              <ClockIcon className="size-2.5" aria-hidden />
              DECLARED
            </span>
          ) : null}
          {row.triageLevel ? <AcuityChip level={row.triageLevel} /> : null}
        </span>
        <span className="text-muted-foreground font-mono text-[10.5px] tabular-nums">
          {formatRelative(row.arrivedAtIso)}
        </span>
      </div>
      <span className="text-muted-foreground text-[11.5px] leading-snug">
        {isDeclared
          ? "Self-declared · awaiting check-in"
          : `${row.entryTypeName}${referrer ? ` · from ${referrer}` : ""}${
              row.broughtBy ? ` · brought by ${row.broughtBy}` : ""
            }`}
      </span>
      {row.presentingComplaint ? (
        <span className="text-foreground/90 text-[12px] leading-snug">
          {truncate(row.presentingComplaint, 140)}
        </span>
      ) : null}
    </div>
  );
}

function formatRelative(iso: string): string {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…";
}

// Reserved for the next iteration when we add a per-intake detail
// route — link to that destination then. Today the hospital-admin
// intake page is the canonical view of the awaiting list.
void Link;
