"use client";

import type { PatientIdentity } from "@/components/medsync/patient-identity";
import type { PillTone } from "@/components/ui/data-table";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { AlertCircleIcon } from "lucide-react";

import { PatientIdentityCard } from "@/components/medsync/patient-identity";
import { Pill } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";
import { AppointmentDetailSheet } from "./appointment-detail-sheet";

export interface ScheduleAppointmentRow {
  id: string;
  status: string;
  priority: string;
  type: string;
  reason: string;
  reasonNote: string | null;
  startsAtIso: string;
  endsAtIso: string;
  /** The audited reveal (ADR 0095), or the code when it was withheld — never a placeholder. */
  patientName: string;
  patientCode: string | null;
  photoUrl?: string | null;
  ageYears?: number | null;
  sex?: string | null;
  complaint?: string | null;
}

/** The card's shape from a row. `patientName` falls back to the code, so a name equal to it is no name. */
export function identityOf(row: ScheduleAppointmentRow): PatientIdentity {
  return {
    patientCode: row.patientCode,
    displayName: row.patientName === (row.patientCode ?? "Patient") ? null : row.patientName,
    photoUrl: row.photoUrl ?? null,
    ageYears: row.ageYears ?? null,
    sex: row.sex ?? null,
    complaint: row.complaint ?? null,
  };
}

interface ScheduleListProps {
  rows: ReadonlyArray<ScheduleAppointmentRow>;
  selectedAppointmentId: string | null;
  statusTones: Record<string, PillTone>;
  statusLabel: Record<string, string>;
}

/**
 * Day-grouped schedule list. URL drives the open detail sheet via
 * ?aff=<uuid>. Pending requests render at the top of their day with
 * a soft amber background; urgent appointments get a red accent dot.
 * Each row is the patient card (ADR 0095): photo or monogram, name or
 * code, age and sex, what they said is bothering them.
 */
export function ScheduleList({
  rows,
  selectedAppointmentId,
  statusTones,
  statusLabel,
}: ScheduleListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const selected = useMemo(
    () => rows.find((r) => r.id === selectedAppointmentId) ?? null,
    [rows, selectedAppointmentId],
  );

  const grouped = useMemo(() => groupByDay(rows), [rows]);

  function openRow(id: string): void {
    const p = new URLSearchParams(searchParams.toString());
    p.set("aff", id);
    router.push(`/clinician/schedule?${p.toString()}`, { scroll: false });
  }

  function closeSheet(): void {
    const p = new URLSearchParams(searchParams.toString());
    p.delete("aff");
    const qs = p.toString();
    router.push(qs ? `/clinician/schedule?${qs}` : `/clinician/schedule`, {
      scroll: false,
    });
  }

  if (rows.length === 0) {
    return (
      <div className="border-border bg-card reveal-up flex flex-col items-center gap-2 rounded-lg border py-14 text-center">
        {/* Quiet week-grid glyph — an open fortnight. */}
        <svg viewBox="0 0 112 72" aria-hidden className="text-border mb-1 h-14 w-auto">
          <rect
            x="1.5"
            y="1.5"
            width="109"
            height="69"
            rx="8"
            stroke="currentColor"
            strokeWidth="3"
            fill="none"
            opacity="0.6"
          />
          <line
            x1="1"
            y1="20"
            x2="111"
            y2="20"
            stroke="currentColor"
            strokeWidth="3"
            opacity="0.4"
          />
          <rect x="12" y="30" width="20" height="12" rx="3" fill="currentColor" opacity="0.2" />
          <rect
            x="40"
            y="48"
            width="20"
            height="12"
            rx="3"
            className="text-brand-500/40"
            fill="currentColor"
          />
        </svg>
        <p className="text-foreground text-body-m font-medium">Nothing booked</p>
        <p className="text-muted-foreground text-body-s max-w-md leading-relaxed">
          Patients can&apos;t book without your declared availability. Add bookable hours from{" "}
          <a className="underline-offset-2 hover:underline" href="/clinician/availability">
            Availability
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <>
      <ul className="stagger-children flex flex-col gap-4">
        {grouped.map(([day, dayRows]) => (
          <li key={day}>
            <p className="text-muted-foreground text-overline mb-2 font-mono uppercase">{day}</p>
            <ul className="border-border bg-card divide-border/70 flex flex-col divide-y rounded-lg border">
              {dayRows.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => openRow(r.id)}
                    className={cn(
                      "group tap hover:bg-ink-25 flex w-full items-center gap-3 px-4 py-3 text-left transition-colors outline-none",
                      "focus-visible:bg-muted/60 focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset",
                      r.status === "pending_approval" &&
                        "bg-amber-50/40 hover:bg-amber-50/70 dark:bg-amber-950/15 dark:hover:bg-amber-950/25",
                    )}
                  >
                    <div className="text-caption w-20 shrink-0 font-mono tabular-nums">
                      <div className="text-foreground">{formatTime(r.startsAtIso)}</div>
                      <div className="text-muted-foreground text-caption">
                        → {formatTime(r.endsAtIso)}
                      </div>
                    </div>
                    <PatientIdentityCard
                      patient={identityOf(r)}
                      className="flex-1"
                      trailing={
                        r.priority === "urgent" ? (
                          <AlertCircleIcon
                            className="size-3.5 shrink-0 text-red-600 dark:text-red-400"
                            aria-hidden
                          />
                        ) : null
                      }
                    />
                    <span className="text-muted-foreground text-caption hidden shrink-0 sm:inline">
                      {formatReason(r.reason)} · {r.type === "virtual" ? "Virtual" : "In-person"}
                    </span>
                    <Pill tone={statusTones[r.status] ?? "neutral"}>
                      {statusLabel[r.status] ?? r.status}
                    </Pill>
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      <AppointmentDetailSheet
        item={selected}
        onOpenChange={(open) => {
          if (!open) closeSheet();
        }}
      />
    </>
  );
}

function groupByDay(
  rows: ReadonlyArray<ScheduleAppointmentRow>,
): Array<[string, ScheduleAppointmentRow[]]> {
  const map = new Map<string, ScheduleAppointmentRow[]>();
  for (const r of rows) {
    const key = new Date(r.startsAtIso).toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
    const list = map.get(key) ?? [];
    list.push(r);
    map.set(key, list);
  }
  return Array.from(map.entries());
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatReason(r: string): string {
  return r.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
