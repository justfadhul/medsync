"use client";

import type { BoardV2Row } from "@/lib/resus/board-v2";
import type { StepVisual } from "@/lib/resus/model";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronRightIcon, ClockIcon } from "lucide-react";

import {
  AMBER_CHIP,
  AMBER_NOTE,
  endedWord,
  hhmm,
} from "@/app/nurse/resus/[episodeId]/_components/v2/close-out-words";
import { cn } from "@/lib/utils";
import { adminCloseResusV2 } from "../_v2/actions-closeout";
import { Since } from "./board-v2-live";

/**
 * Resus board v2 — sections and rows. Every state carries a word; colour only
 * reinforces it (red for an active-threat step, per the resus colour system).
 */

const VISUAL: Record<StepVisual, { word: string; chip: string }> = {
  pending: { word: "Not yet assessed", chip: "bg-muted text-muted-foreground" },
  clear: { word: "Clear", chip: "bg-teal-100 text-teal-800" },
  // Semantic pair, not bg-teal-700 text-white: the teal scale flips in .dark (white on #99f6e4).
  addressed: { word: "Addressed", chip: "bg-primary-hover text-primary-foreground" },
  threatened: { word: "Threatened", chip: AMBER_CHIP },
  active_threat: { word: "Active threat", chip: "bg-rose-600 text-white" },
};

export { endedWord };

export function Section({
  id,
  title,
  count,
  empty,
  children,
}: {
  id: string;
  title: string;
  count: number;
  empty?: string;
  children: ReactNode;
}) {
  if (count === 0 && !empty) return null;
  return (
    <section
      data-testid={`board-section-${id}`}
      aria-labelledby={`board-${id}`}
      className="flex flex-col gap-2"
    >
      <h2 id={`board-${id}`} className="text-heading-s text-foreground flex items-baseline gap-2">
        {title}
        <span className="text-caption text-muted-foreground font-mono tabular-nums">{count}</span>
      </h2>
      {count === 0 ? (
        <p className="text-body-s text-muted-foreground border-border rounded-lg border border-dashed px-4 py-3">
          {empty}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">{children}</ul>
      )}
    </section>
  );
}

export const ROW =
  "tap group border-border bg-card flex min-h-11 items-center gap-3 rounded-lg border px-4 py-3 outline-none transition-colors duration-150 ease-expo-out hover:bg-muted focus-visible:shadow-focus";

export function Who({ name, age }: { name: string | null; age: number | null }) {
  return (
    <p className="text-body-m text-foreground truncate font-medium">
      {name ?? "Unidentified patient"}
      {age != null ? (
        <span className="text-caption text-muted-foreground ml-2">{age} y</span>
      ) : null}
    </p>
  );
}

export function EpisodeRow({
  row,
  href,
  serverNowIso,
  resusClock = true,
  children,
}: {
  row: BoardV2Row;
  href: string;
  serverNowIso: string;
  /** Boarding stops the resus clock (CO-BRD-01) — its row shows the boarding clock instead. */
  resusClock?: boolean;
  children?: ReactNode;
}) {
  return (
    <li>
      <Link href={href} className={ROW}>
        {row.inArrest && !row.idleLabel ? (
          <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-rose-600" />
        ) : null}
        <div className="min-w-0 flex-1">
          <Who name={row.displayName} age={row.ageYears} />
          <p className="text-body-s text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
            {children}
            <span>{row.trigger}</span>
            {row.leader ? <span>· Leader {row.leader}</span> : null}
          </p>
          {row.lastVitals ? (
            <p className="text-caption text-muted-foreground font-mono tabular-nums">
              {row.lastVitals.text} · {hhmm(row.lastVitals.atIso)}
            </p>
          ) : null}
        </div>
        {resusClock ? (
          <span className="text-caption text-muted-foreground shrink-0">
            T+ <Since iso={row.startedAtIso} serverNowIso={serverNowIso} />
          </span>
        ) : null}
        <ChevronRightIcon aria-hidden className="text-muted-foreground size-4 shrink-0" />
      </Link>
    </li>
  );
}

export function StepChip({ worst }: { worst: BoardV2Row["worst"] }) {
  if (!worst) return null;
  const v = VISUAL[worst.visual];
  return (
    <span className={cn("text-caption rounded-sm px-1.5 py-0.5", v.chip)}>
      {worst.step} · {v.word}
    </span>
  );
}

const SECONDARY =
  "tap text-body-s border-border text-foreground hover:bg-muted focus-visible:shadow-focus inline-flex min-h-11 shrink-0 items-center rounded-md border px-4 font-medium outline-none disabled:opacity-50";

/**
 * A "Needs closing" row (§5.13 item 4): Open (the row) / Close…. When the
 * administrative close is open to this user (idle ≥ 24 h, in-charge or
 * consultant — LC-04) Close… expands the reason form here, so an in-charge can
 * clear legacy episodes without opening each desk. Otherwise it opens the desk
 * with the close-out sheet (?close=1).
 */
export function NeedsClosingRow({
  row,
  href,
  adminClose,
}: {
  row: BoardV2Row;
  href: string;
  adminClose: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  // One idempotency key per row: a retry replays the same close, never a second one.
  const [clientEventId] = useState(() => crypto.randomUUID());
  const [pending, start] = useTransition();
  const formId = `admin-close-${row.episodeId}`;

  const submit = () =>
    start(async () => {
      setError(null);
      try {
        const r = await adminCloseResusV2({
          episodeId: row.episodeId,
          clientEventId,
          reason: reason.trim(),
        });
        if (!r.ok) return setError(r.error);
        router.refresh();
      } catch {
        // The close may have committed before the response was lost.
        setError("No response — it may have been recorded. Check the board before trying again.");
        router.refresh();
      }
    });

  return (
    <li className="border-border bg-card flex flex-col rounded-lg border">
      <div className="flex items-center gap-2 pr-3">
        <Link
          href={href}
          className="tap ease-expo-out hover:bg-muted focus-visible:shadow-focus flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg px-4 py-3 transition-colors duration-150 outline-none"
        >
          <div className="min-w-0 flex-1">
            <Who name={row.displayName} age={row.ageYears} />
            <p className="text-body-s text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
              <span
                className={cn(
                  "text-caption inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5",
                  AMBER_CHIP,
                )}
              >
                <ClockIcon aria-hidden className="size-3" />
                {row.idleLabel}
              </span>
              <span>{row.mode}</span>
              <span>· {row.trigger}</span>
              {adminClose ? <span>· administrative close available</span> : null}
            </p>
          </div>
          <ChevronRightIcon aria-hidden className="text-muted-foreground size-4 shrink-0" />
        </Link>
        {adminClose ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={formId}
            onClick={() => setOpen((o) => !o)}
            className={SECONDARY}
          >
            Close…
          </button>
        ) : (
          <Link href={`${href}?close=1`} className={SECONDARY}>
            Close…
          </Link>
        )}
      </div>
      {open ? (
        <div id={formId} className="border-border flex flex-col gap-2 border-t px-4 py-3">
          <p className="text-body-s text-muted-foreground">
            Close administratively — no clinical outcome is recorded; the episode is left out of
            clinical statistics and kept in data-quality reports.
          </p>
          <label htmlFor={`${formId}-reason`} className="text-caption text-muted-foreground">
            Reason (required)
          </label>
          <textarea
            id={`${formId}-reason`}
            rows={2}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="border-input bg-card text-foreground text-body-s focus-visible:shadow-focus w-full min-w-0 rounded-sm border px-2.5 py-2 outline-none focus-visible:border-teal-500 disabled:opacity-50"
          />
          <button
            type="button"
            disabled={reason.trim().length < 3 || pending}
            onClick={submit}
            className="tap text-body-s bg-foreground text-background focus-visible:shadow-focus inline-flex min-h-11 items-center justify-center self-start rounded-md px-4 font-medium outline-none hover:opacity-90 disabled:pointer-events-none disabled:opacity-40"
          >
            {pending ? "Recording…" : "Close administratively"}
          </button>
          {error ? (
            <p role="alert" className={cn("text-body-s rounded-md px-3 py-2", AMBER_NOTE)}>
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
