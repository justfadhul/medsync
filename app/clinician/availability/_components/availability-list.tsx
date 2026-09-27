"use client";

import type { AvailabilityRow } from "../page";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { CalendarPlusIcon } from "lucide-react";

import {
  AVAILABILITY_KIND_LABEL,
  AVAILABILITY_KIND_TONES,
} from "@/components/scheduling/calendar/helpers";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";
import { AvailabilityFormSheet } from "./availability-form-sheet";

const WEEKDAY_LABEL = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function AvailabilityList({
  blocks,
  selectedBlockId,
  isCreatingNew,
}: {
  blocks: ReadonlyArray<AvailabilityRow>;
  selectedBlockId: string | null;
  isCreatingNew: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const selected = useMemo(
    () => blocks.find((b) => b.id === selectedBlockId) ?? null,
    [blocks, selectedBlockId],
  );
  const sheetOpen = !!selected || isCreatingNew;

  function openCreate(): void {
    const p = new URLSearchParams(searchParams.toString());
    p.delete("block");
    p.set("new", "1");
    router.push(`/clinician/availability?${p.toString()}`, { scroll: false });
  }

  function openEdit(id: string): void {
    const p = new URLSearchParams(searchParams.toString());
    p.delete("new");
    p.set("block", id);
    router.push(`/clinician/availability?${p.toString()}`, { scroll: false });
  }

  function closeSheet(): void {
    const p = new URLSearchParams(searchParams.toString());
    p.delete("block");
    p.delete("new");
    const qs = p.toString();
    router.push(qs ? `/clinician/availability?${qs}` : `/clinician/availability`, {
      scroll: false,
    });
  }

  return (
    <>
      <section className="border-border bg-card overflow-hidden rounded-lg border">
        <header className="border-border flex items-center gap-3 border-b px-4 py-3 sm:px-6">
          <h2 className="text-foreground text-body-s font-medium">Declared blocks</h2>
          <span className="text-muted-foreground text-caption ml-auto font-mono tabular-nums">
            {blocks.length} {blocks.length === 1 ? "block" : "blocks"}
          </span>
          <Button
            type="button"
            variant="primary"
            size="sm"
            className="tap min-h-11"
            onClick={openCreate}
          >
            <CalendarPlusIcon className="size-3.5" />
            Add block
          </Button>
        </header>

        {blocks.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            {/* Quiet week-grid glyph — empty calendar, one slot hinted teal. */}
            <svg viewBox="0 0 112 72" aria-hidden className="text-border mb-1 h-16 w-auto">
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
              <rect
                x="12"
                y="30"
                width="20"
                height="12"
                rx="3"
                fill="currentColor"
                opacity="0.25"
              />
              <rect
                x="40"
                y="30"
                width="20"
                height="12"
                rx="3"
                fill="currentColor"
                opacity="0.15"
              />
              <rect
                x="68"
                y="48"
                width="20"
                height="12"
                rx="3"
                className="text-brand-500/40"
                fill="currentColor"
              />
            </svg>
            <p className="text-foreground text-body-m font-medium">Nothing on your schedule yet</p>
            <p className="text-muted-foreground text-body-s max-w-md leading-relaxed">
              Add bookable hours so patients can book you. Teaching, ward rounds and admin are
              recorded but do not stop a booking — declare Leave or Unavailable over time a patient
              must not reach.
            </p>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={openCreate}
              className="tap mt-2 min-h-11"
            >
              <CalendarPlusIcon className="size-3.5" />
              Add your first block
            </Button>
          </div>
        ) : (
          <ul className="divide-border/70 stagger-children flex flex-col divide-y">
            {blocks.map((b) => (
              <BlockRow key={b.id} block={b} onOpen={() => openEdit(b.id)} />
            ))}
          </ul>
        )}
      </section>

      <AvailabilityFormSheet
        open={sheetOpen}
        block={selected}
        onOpenChange={(open) => {
          if (!open) closeSheet();
        }}
      />

      {/* Keep a hidden link target so the open-create URL works on
          fresh navigation (e.g. shared link). Server renders the open
          state via ?new=1 already. */}
      <Link href="/clinician/availability?new=1" prefetch className="hidden" aria-hidden>
        new
      </Link>
    </>
  );
}

function BlockRow({ block, onOpen }: { block: AvailabilityRow; onOpen: () => void }) {
  const starts = new Date(block.startsAtIso);
  const ends = new Date(block.endsAtIso);
  const sameDay = starts.toDateString() === ends.toDateString();
  const weekly = block.recurrence === "weekly" && !!block.recurrenceWeekday;

  // A weekly block's own date is the template's anchor, often months back.
  // Headlining it read as "this happened in March"; the series is the fact.
  const dateLabel = weekly
    ? `Every ${WEEKDAY_LABEL[block.recurrenceWeekday! - 1]}`
    : starts.toLocaleDateString(undefined, {
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
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "group tap hover:bg-ink-25 flex w-full items-center gap-4 px-4 py-3 text-left transition-colors outline-none sm:px-6",
          "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset",
        )}
      >
        <div className="flex w-32 shrink-0 flex-col">
          <span className="text-foreground text-body-s font-medium tabular-nums">{dateLabel}</span>
          <span className="text-muted-foreground text-caption font-mono tabular-nums">
            {timeLabel}
          </span>
        </div>

        <Pill tone={AVAILABILITY_KIND_TONES[block.kind]}>
          {AVAILABILITY_KIND_LABEL[block.kind]}
        </Pill>

        {/* A custom block is its own name (ADR 0095); the pill still says the kind. */}
        {block.kind === "custom" && block.label ? (
          <span className="text-foreground text-body-s truncate font-medium">{block.label}</span>
        ) : null}

        {weekly ? (
          <span className="text-muted-foreground text-caption whitespace-nowrap">
            from {shortDate(starts)}
            {block.recurrenceUntilIso
              ? ` until ${shortDate(new Date(block.recurrenceUntilIso))}`
              : ""}
          </span>
        ) : null}

        {block.location ? (
          <span className="text-muted-foreground text-caption hidden truncate sm:inline">
            {block.location}
          </span>
        ) : null}

        <span className="text-muted-foreground group-hover:text-foreground text-caption ml-auto inline-flex items-center gap-1 transition-colors">
          Edit
          <span
            aria-hidden
            className="inline-block transition-transform duration-200 group-hover:translate-x-0.5"
          >
            →
          </span>
        </span>
      </button>
    </li>
  );
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function shortDate(d: Date): string {
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
