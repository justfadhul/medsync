"use client";

import type { ResusBoard as ResusBoardData } from "@/lib/resus/board";
import Link from "next/link";
import { useTransition } from "react";
import { ChevronRightIcon, SirenIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { openBlankResus, openResusFromTriage } from "../actions";

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m ago`;
}

function patientLabel(name: string | null): string {
  return name ?? "Unidentified patient";
}

export function ResusBoard({
  board,
  leaderRecommended,
  basePath = "/nurse/resus",
}: {
  board: ResusBoardData;
  leaderRecommended: boolean;
  /** Workspace base for desk links + the open-resus redirect target. */
  basePath?: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="stagger-children flex flex-col gap-7">
      {/* Active episodes */}
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-foreground/80 flex items-center gap-1.5 text-[12px] font-medium">
            Active resuscitations{" "}
            {board.active.length > 0 ? (
              <span
                aria-hidden
                className="pulse-dot size-1.5 rounded-full bg-rose-500 ring-2 ring-rose-500/20"
              />
            ) : null}
            <span className="text-muted-foreground/70 font-mono text-[10px]">
              {board.active.length} running
            </span>
          </h2>
        </div>

        {board.active.length === 0 ? (
          <div className="text-muted-foreground border-border/70 bg-muted/20 flex flex-col items-center gap-2.5 rounded-xl border border-dashed px-4 py-7 text-center text-[12.5px]">
            <svg
              viewBox="0 0 120 24"
              fill="none"
              aria-hidden
              className="text-muted-foreground/40 h-5 w-28"
            >
              <path
                d="M2 12h42l5 0 4-8 5 16 4-8h56"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <p>
              No active resuscitation. Open one from a Red/L1 patient below, or start an ad-hoc
              resus.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {board.active.map((e) => (
              <li key={e.episodeId}>
                <Link
                  href={`${basePath}/${e.episodeId}`}
                  className={cn(
                    "group flex items-center gap-3 rounded-xl border px-4 py-3 transition-all duration-200 hover:shadow-md motion-safe:hover:-translate-y-0.5",
                    e.arrestDetected
                      ? "border-rose-500/70 bg-rose-50/70 ring-1 ring-rose-500/30 dark:bg-rose-950/30"
                      : "border-border bg-card hover:border-rose-300/70 hover:bg-rose-50/30 dark:hover:bg-rose-950/15",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-lg",
                      e.arrestDetected
                        ? "bg-rose-600 text-white"
                        : "bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-200",
                    )}
                  >
                    <SirenIcon className="size-4.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground truncate text-[13.5px] font-medium">
                      {patientLabel(e.displayName)}
                    </p>
                    <p className="text-muted-foreground font-mono text-[10.5px]">
                      {e.arrestDetected ? "⚠ ARREST · CPR / ALS · " : ""}
                      {e.triggerReason ?? e.triggerKind.replace(/_/g, " ")} · started{" "}
                      {ago(e.startedAtIso)}
                    </p>
                  </div>
                  <ChevronRightIcon className="text-muted-foreground/50 size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Openable Red/L1 triage records */}
      <section className="flex flex-col gap-3">
        <h2 className="text-foreground/80 text-[12px] font-medium">
          Red / L1 — open a resus{" "}
          <span className="text-muted-foreground/70 font-mono text-[10px]">
            {board.openable.length} waiting
          </span>
        </h2>

        {board.openable.length === 0 ? (
          <div className="text-muted-foreground border-border/70 bg-muted/20 flex flex-col items-center gap-2.5 rounded-xl border border-dashed px-4 py-7 text-center text-[12.5px]">
            <svg
              viewBox="0 0 120 24"
              fill="none"
              aria-hidden
              className="text-muted-foreground/40 h-5 w-28"
            >
              <path
                d="M2 12h116"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeDasharray="2 5"
              />
            </svg>
            <p>No recent Red/L1 triage records without a resus episode.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {board.openable.map((o) => (
              <li
                key={o.triageRecordId}
                className="border-border bg-card hover:border-border hover:bg-muted/20 flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors"
              >
                <span
                  aria-hidden
                  className="inline-flex shrink-0 items-center rounded-full bg-rose-600 px-2 py-0.5 font-mono text-[10px] font-semibold text-white"
                >
                  L1
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-foreground truncate text-[13.5px] font-medium">
                    {patientLabel(o.displayName)}
                    {o.ageYears != null ? (
                      <span className="text-muted-foreground/70 ml-1.5 font-mono text-[10.5px]">
                        {o.ageYears}y
                      </span>
                    ) : null}
                  </p>
                  <p className="text-muted-foreground font-mono text-[10.5px]">
                    {o.lifeThreatReason ?? "Red / Level 1"} · triaged {ago(o.triagedAtIso)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await openResusFromTriage(o.triageRecordId, basePath);
                    })
                  }
                  className="tap inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-rose-700 disabled:opacity-50"
                >
                  <SirenIcon className="size-3.5" aria-hidden />
                  Open resus
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="border-border/60 flex items-center justify-between gap-3 border-t pt-4">
        <p className="text-muted-foreground/70 text-caption">
          {leaderRecommended
            ? "Your cadre is recommended to lead. Role assignment stays open — never blocked."
            : "Any clinical responder can take any role. The team leader is usually a doctor."}
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(async () => void (await openBlankResus(basePath)))}
          className="tap text-muted-foreground hover:text-foreground border-border hover:bg-muted/40 inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] transition-colors disabled:opacity-50"
        >
          Start ad-hoc resus
        </button>
      </div>
    </div>
  );
}
