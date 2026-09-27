"use client";

import type { DataTableColumn } from "@/components/ui/data-table";
import type { PendingRequest } from "@/lib/hospital-admin/pending";
import { useState } from "react";
import { ClockIcon } from "lucide-react";

import { EditorDialog } from "@/components/medsync/editor-dialog";
import { StatButton } from "@/components/medsync/stat-card";
import { Button } from "@/components/ui/button";
import { DataTable, Pill } from "@/components/ui/data-table";
import {
  SheetBody,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { DEFAULT_TIME_ZONE } from "@/supabase/functions/_shared/slots";
import { REASON_LABEL } from "./service-lines-section";

/** The hospital's clock, as the page prints it. */
const DAY_FMT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: DEFAULT_TIME_ZONE,
});
const TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: DEFAULT_TIME_ZONE,
});

/** A request nobody has answered in two days is the clinic's signal, not the patient's. */
const STALE_MS = 48 * 3_600_000;

/** "40 min" / "5 h" / "2 d" — the coarsest unit that is still honest. */
function waitingLabel(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

export function PendingDialog({
  rows,
  value,
}: {
  rows: ReadonlyArray<PendingRequest>;
  /** The strip's count; the page decides whether it is the stats' or the rows'. */
  value: number | string;
}) {
  // The instant the dialog opened, or null while closed: every row's age is
  // measured from the same moment, and the table is not mounted until then.
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const open = openedAt !== null;
  const setOpen = (next: boolean) => setOpenedAt(next ? Date.now() : null);
  const now = openedAt ?? 0;

  const columns: ReadonlyArray<DataTableColumn<PendingRequest>> = [
    {
      id: "startsAt",
      header: "Requested for",
      mono: true,
      cell: (r) => (
        <span className="whitespace-nowrap">
          {DAY_FMT.format(r.startsAt)} · {TIME_FMT.format(r.startsAt)}
          {r.type === "virtual" ? (
            <span className="text-muted-foreground font-sans"> · Virtual</span>
          ) : null}
        </span>
      ),
    },
    {
      id: "patient",
      header: "Patient",
      mono: true,
      cell: (r) =>
        r.patientCode ?? <span className="text-muted-foreground font-sans">Provisional</span>,
    },
    {
      id: "clinician",
      header: "Clinician · Department",
      cell: (r) => (
        <span className="flex flex-col">
          <span>{r.clinicianName}</span>
          <span className="text-muted-foreground text-caption">
            {r.serviceLineName ? `${r.departmentName} · ${r.serviceLineName}` : r.departmentName}
          </span>
        </span>
      ),
    },
    {
      id: "reason",
      header: "Reason",
      cell: (r) => REASON_LABEL[r.reason] ?? r.reason,
    },
    {
      id: "waiting",
      header: "Waiting",
      mono: true,
      cell: (r) => {
        const age = now - r.createdAt.getTime();
        return (
          <span className="inline-flex items-center gap-2 whitespace-nowrap">
            {waitingLabel(age)}
            {age >= STALE_MS ? <Pill tone="notice">Stale</Pill> : null}
          </span>
        );
      },
    },
    {
      id: "priority",
      header: "Priority",
      cell: (r) =>
        r.priority === "urgent" ? (
          <Pill tone="critical">Urgent</Pill>
        ) : (
          <span className="text-muted-foreground">Routine</span>
        ),
    },
  ];

  return (
    <>
      <StatButton
        domain="operations"
        label="Pending"
        value={value}
        hint="awaiting a clinician"
        icon={<ClockIcon className="size-4" aria-hidden />}
        expanded={open}
        onClick={() => setOpen(true)}
      />

      <EditorDialog width="medium" open={open} onOpenChange={setOpen}>
        <div className="flex min-h-0 flex-1 flex-col">
          <SheetHeader>
            <SheetTitle>Awaiting a clinician</SheetTitle>
            <SheetDescription>
              {rows.length === 1
                ? "1 request is waiting to be confirmed or declined."
                : `${rows.length} requests are waiting to be confirmed or declined.`}
              {typeof value === "number" && value > rows.length
                ? ` Showing the oldest ${rows.length} of ${value}.`
                : ""}
            </SheetDescription>
          </SheetHeader>

          <SheetBody className="flex flex-col gap-3">
            <DataTable
              data={rows}
              columns={columns}
              rowKey={(r) => r.id}
              caption="Appointment requests awaiting a clinician, oldest first"
              className="border-border overflow-hidden rounded-lg border"
              scrollClassName="max-h-[52svh]"
              empty="Nothing is waiting for a clinician."
            />
            <p className="text-muted-foreground text-caption">
              Clinicians confirm or decline these from their own schedule.
            </p>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Close
            </Button>
          </SheetFooter>
        </div>
      </EditorDialog>
    </>
  );
}
