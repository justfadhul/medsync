"use client";

import type { AvailabilityRow as ClinicianAvailabilityRow } from "@/app/clinician/availability/page";
import type { AvailabilityKind } from "@/db/schema/scheduling";
import type { AvailabilityRow as DoctorAvailabilityRow } from "@/lib/scheduling/doctor";
import { useState } from "react";
import { CalendarClockIcon, CalendarPlusIcon, PencilIcon } from "lucide-react";

import { AvailabilityFormSheet } from "@/app/clinician/availability/_components/availability-form-sheet";
import { EditorDialog } from "@/components/medsync/editor-dialog";
import {
  AVAILABILITY_KIND_LABEL,
  AVAILABILITY_KIND_TONES,
} from "@/components/scheduling/calendar/helpers";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/data-table";
import { SheetBody, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * Inline availability editor for the doctor's schedule.
 *
 * Wraps a sheet (the "Availability" button on the calendar top bar)
 * that lists upcoming blocks + an "Add block" / "Edit" entry into
 * the existing AvailabilityFormSheet. The form sheet handles its own
 * save / cancel via the existing clinician/availability actions; on
 * success those actions revalidate /doctor/schedule so this list
 * updates without a navigation.
 *
 * The form is presented as a second, nested sheet on top of this
 * one — base-ui handles the focus + escape correctly for stacked
 * dialogs, and the two roles (browse the list vs author one block)
 * are distinct enough to deserve separate surfaces.
 */

/**
 * The kinds `buildSlots()` subtracts from bookable time — kept in step with
 * BLOCKING_KINDS in `supabase/functions/_shared/slots.ts`, which is the only
 * place that decides it. Teaching / ward rounds / admin are deliberately NOT
 * here: they are the clinician's own commitments and do not stop a patient
 * booking over them. This surface used to claim they did.
 */
const BLOCKS_BOOKING: ReadonlySet<string> = new Set(["leave", "unavailable"]);

const WEEKDAY_LABEL = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function AvailabilitySheetButton({
  blocks,
}: {
  blocks: ReadonlyArray<DoctorAvailabilityRow>;
}) {
  const [listOpen, setListOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ClinicianAvailabilityRow | null>(null);
  // A count of DECLARED blocking rows — not a count of slots removed. Only the
  // engine can say how many slots a leave block cost, and this surface never
  // runs it, so it never claims a number it cannot prove.
  const blockingCount = blocks.filter((b) => BLOCKS_BOOKING.has(b.kind)).length;

  function openCreate(): void {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(block: DoctorAvailabilityRow): void {
    // Shape-match the clinician AvailabilityRow (same fields, narrower
    // kind type — cast is safe because the values come from the same
    // CHECK constraint).
    setEditing({
      id: block.id,
      kind: block.kind as AvailabilityKind,
      startsAtIso: block.startsAtIso,
      endsAtIso: block.endsAtIso,
      recurrence: block.recurrence,
      recurrenceWeekday: block.recurrenceWeekday,
      recurrenceUntilIso: block.recurrenceUntilIso,
      location: block.location,
      notes: block.notes,
      label: block.label,
    });
    setFormOpen(true);
  }

  return (
    <>
      {/* The calendar bar's pair: the list as the secondary, a new block as the one primary.
          size="sm" is ~24px tall; min-h-11 restores the 44px touch floor. */}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="min-h-11"
        onClick={() => setListOpen(true)}
      >
        <CalendarClockIcon className="size-3.5" aria-hidden />
        Availability
      </Button>
      <Button type="button" size="sm" className="min-h-11" onClick={openCreate}>
        <CalendarPlusIcon className="size-3.5" aria-hidden />
        Set availability
      </Button>

      <EditorDialog width="medium" open={listOpen} onOpenChange={setListOpen}>
        <div className="flex min-h-0 flex-1 flex-col">
          <SheetHeader>
            <SheetTitle>Your availability</SheetTitle>
            <SheetDescription>
              Bookable blocks are the only time patients can request. Leave and Unavailable take
              time back off that grid. Teaching, ward rounds and admin are yours to see — they do
              not stop a patient booking over them, so declare Unavailable when you need the time
              protected. Changes are audited.
            </SheetDescription>
          </SheetHeader>

          <SheetBody>
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="text-muted-foreground text-overline font-mono uppercase">
                Upcoming · {blocks.length}
                {blockingCount > 0 ? ` · ${blockingCount} blocking` : ""}
              </span>
              <Button type="button" size="sm" className="min-h-11" onClick={openCreate}>
                <CalendarPlusIcon className="size-3.5" aria-hidden />
                Add block
              </Button>
            </div>

            {blocks.length === 0 ? (
              <div className="border-border bg-card flex flex-col items-start gap-3 rounded-lg border p-5">
                {/* No `dark:` overrides: the brand ramp inverts in dark mode, so
                    a hand-written dark step fights the flip and loses contrast. */}
                <span
                  aria-hidden
                  className="bg-plum-tint text-plum-icon ring-plum-edge inline-flex size-9 items-center justify-center rounded-full ring-1"
                >
                  <CalendarClockIcon className="size-4" />
                </span>
                <div className="flex flex-col gap-1">
                  <span className="text-foreground text-body-m font-medium">
                    Nothing on your schedule yet
                  </span>
                  <p className="text-muted-foreground text-body-s max-w-[48ch] leading-relaxed">
                    Add bookable hours so patients can book you. Teaching, ward rounds and admin
                    show on your calendar but do not hold time against bookings — declare Leave or
                    Unavailable for the hours you need protected.
                  </p>
                </div>
                <Button type="button" size="sm" className="min-h-11" onClick={openCreate}>
                  <CalendarPlusIcon className="size-3.5" aria-hidden />
                  Add your first block
                </Button>
              </div>
            ) : (
              <ul className="border-border bg-card divide-border/60 stagger-children flex flex-col divide-y overflow-hidden rounded-lg border">
                {blocks.map((b) => (
                  <li key={b.id}>
                    <BlockRow block={b} onEdit={() => openEdit(b)} />
                  </li>
                ))}
              </ul>
            )}
          </SheetBody>
        </div>
      </EditorDialog>

      <AvailabilityFormSheet
        open={formOpen}
        block={editing}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
      />
    </>
  );
}

function BlockRow({ block, onEdit }: { block: DoctorAvailabilityRow; onEdit: () => void }) {
  const starts = new Date(block.startsAtIso);
  const ends = new Date(block.endsAtIso);
  const sameDay = starts.toDateString() === ends.toDateString();

  const dateLabel = starts.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const timeLabel = sameDay
    ? `${formatTime(starts)} – ${formatTime(ends)}`
    : `${formatTime(starts)} → ${ends.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })}`;

  return (
    <button
      type="button"
      onClick={onEdit}
      className={cn(
        "hover:bg-muted/40 active:bg-muted/60 group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-200 outline-none",
        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset",
      )}
    >
      <div className="flex w-28 shrink-0 flex-col">
        <span className="text-foreground text-body-s font-medium tabular-nums">{dateLabel}</span>
        <span className="text-muted-foreground text-caption font-mono tabular-nums">
          {timeLabel}
        </span>
      </div>

      <Pill tone={AVAILABILITY_KIND_TONES[block.kind] ?? "neutral"}>
        {AVAILABILITY_KIND_LABEL[block.kind] ?? block.kind}
      </Pill>

      {/* A custom block is its own name (ADR 0095); the pill still says the kind. */}
      {block.kind === "custom" && block.label ? (
        <span className="text-foreground text-body-s truncate font-medium">{block.label}</span>
      ) : null}

      {/* Spelled out, never carried by the pill's tint alone: this is the one
          thing on the row that changes what patients can do to the diary. */}
      {BLOCKS_BOOKING.has(block.kind) ? (
        <span className="text-muted-foreground text-caption shrink-0">Blocks bookings</span>
      ) : null}

      {block.recurrence === "weekly" && block.recurrenceWeekday ? (
        <span className="text-muted-foreground text-caption">
          Every {WEEKDAY_LABEL[block.recurrenceWeekday - 1]}
        </span>
      ) : null}

      {block.location ? (
        <span className="text-muted-foreground text-caption hidden truncate sm:inline">
          {block.location}
        </span>
      ) : null}

      <span
        aria-hidden
        className="text-muted-foreground text-caption ml-auto inline-flex items-center gap-1 opacity-60 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        <PencilIcon className="size-3" />
        Edit
      </span>
    </button>
  );
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
