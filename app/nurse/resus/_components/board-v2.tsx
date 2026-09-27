"use client";

import type { ResusBoardV2Data } from "@/lib/resus/board-v2";
import Link from "next/link";
import { useState, useTransition } from "react";
import { BedIcon, ChevronRightIcon, PlusIcon, SirenIcon } from "lucide-react";

import {
  AMBER_NOTE,
  DESTINATION_WORD,
  hhmm,
  levelShort,
} from "@/app/nurse/resus/[episodeId]/_components/v2/close-out-words";
import { cn } from "@/lib/utils";
import { openBlankResus, openResusFromTriage } from "../actions";
import { Since, useLiveBoard } from "./board-v2-live";
import {
  endedWord,
  EpisodeRow,
  NeedsClosingRow,
  ROW,
  Section,
  StepChip,
  Who,
} from "./board-v2-rows";

/**
 * Resus board v2 (prompt §5.13). Six sections, top to bottom: arrest in
 * progress, active, awaiting bed, needs closing, Red/L1 to open, recently
 * ended. Live: the private realtime topic resus-board:<hospital> says
 * "something changed" (no PHI in the payload) and the page re-reads the
 * server; without a channel it re-reads every 30 s. Red appears only as the
 * arrest dot and an active-threat step (Law 5).
 */

export function ResusBoardV2({
  board,
  basePath,
  me,
}: {
  board: ResusBoardV2Data;
  basePath: string;
  me: { canAdminClose: boolean; leaderRecommended?: boolean; place?: string };
}) {
  const live = useLiveBoard(board.hospitalId);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const now = board.nowIso;
  const href = (id: string) => `${basePath}/${id}`;
  const run = (fn: () => Promise<{ error: string } | undefined | void>) =>
    startTransition(async () => {
      setError(null);
      const r = await fn();
      if (r && "error" in r) setError(r.error);
    });

  return (
    <div
      data-resus-board=""
      className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-9"
    >
      {/* Sticky under the 52 px shell bar, so Emergency stays on screen (S4). */}
      <div className="bg-background/95 sticky top-13 z-20 -mx-4 -mb-6.5 flex items-center justify-between gap-3 px-4 py-1 supports-backdrop-filter:backdrop-blur-sm sm:-mx-6 sm:px-6">
        <p className="text-overline text-muted-foreground min-w-0 truncate uppercase">
          {me.place ? `${me.place} · ` : ""}Resus
        </p>
        <Link
          href="/emergency"
          aria-label="Emergency — get help now"
          // The floating platform pill stands down while this one is on the page.
          data-emergency-inline
          className="tap text-body-s inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border border-rose-600 px-3 font-medium text-rose-700 hover:bg-rose-50 dark:border-rose-500 dark:text-rose-300 dark:hover:bg-rose-950/40"
        >
          <SirenIcon aria-hidden className="size-4" />
          Emergency
        </Link>
      </div>
      <header className="flex flex-col gap-1.5">
        <h1 className="text-heading-l text-foreground">Resuscitation board</h1>
        <p className="text-body-s text-muted-foreground max-w-2xl">
          Open a resus for any Red/L1 patient or Step-0 life threat. Opening starts the record and
          calls the team. The app records what the team does — the clinician leads.
        </p>
        <p className="text-caption text-muted-foreground" aria-live="polite">
          {live ? "Live" : "Updates every 30 s"}
        </p>
      </header>

      <Section id="arrest" title="Arrest in progress" count={board.arrest.length}>
        {board.arrest.map((r) => (
          <EpisodeRow key={r.episodeId} row={r} href={href(r.episodeId)} serverNowIso={now}>
            <span className="text-foreground font-medium">
              Arrest{r.arrest && r.arrest.seq > 1 ? ` #${r.arrest.seq}` : ""} · A+{" "}
              {r.arrest ? <Since iso={r.arrest.sinceIso} serverNowIso={now} seconds /> : null}
            </span>
          </EpisodeRow>
        ))}
      </Section>

      <Section
        id="active"
        title="Active"
        count={board.active.length}
        empty="No active resuscitation."
      >
        {board.active.map((r) => (
          <EpisodeRow key={r.episodeId} row={r} href={href(r.episodeId)} serverNowIso={now}>
            <span className="text-foreground">{r.mode}</span>
            <StepChip worst={r.worst} />
          </EpisodeRow>
        ))}
      </Section>

      <Section id="boarding" title="Awaiting bed" count={board.boarding.length}>
        {board.boarding.map((r) => (
          <EpisodeRow
            key={r.episodeId}
            row={r}
            href={href(r.episodeId)}
            serverNowIso={now}
            resusClock={false}
          >
            <span className="text-foreground inline-flex items-center gap-1">
              <BedIcon aria-hidden className="size-3.5" />
              {r.boarding?.destination
                ? (DESTINATION_WORD[r.boarding.destination] ?? r.boarding.destination)
                : "Destination"}
              {r.boarding?.level ? ` (${levelShort(r.boarding.level)})` : ""}
              {r.boarding?.unitName ? ` — ${r.boarding.unitName}` : ""}
            </span>
            {r.boarding?.sinceIso ? (
              <span>
                · boarding <Since iso={r.boarding.sinceIso} serverNowIso={now} />
              </span>
            ) : null}
          </EpisodeRow>
        ))}
      </Section>
      <Section id="needs-closing" title="Needs closing" count={board.needsClosing.length}>
        {board.needsClosing.map((r) => (
          <NeedsClosingRow
            key={r.episodeId}
            row={r}
            href={href(r.episodeId)}
            adminClose={r.adminCloseOpen && me.canAdminClose}
          />
        ))}
      </Section>

      <Section
        id="openable"
        title="Red / L1 — open a resus"
        count={board.openable.length}
        empty="No Red/L1 triage in the last 24 h without a resus."
      >
        {board.openable.map((o) => (
          <li
            key={o.triageRecordId}
            className="border-border bg-card flex min-h-11 items-center gap-3 rounded-lg border px-4 py-3"
          >
            <span className="text-caption border-border text-foreground shrink-0 rounded-sm border px-1.5 py-0.5">
              L1
            </span>
            <div className="min-w-0 flex-1">
              <Who name={o.displayName} age={o.ageYears} />
              <p className="text-body-s text-muted-foreground">
                {o.lifeThreatReason ?? "Red / Level 1"} · triaged {hhmm(o.triagedAtIso)}
              </p>
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => openResusFromTriage(o.triageRecordId, basePath))}
              className="tap text-body-s bg-primary text-primary-foreground hover:bg-primary-hover focus-visible:shadow-focus inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-4 font-medium outline-none disabled:opacity-50"
            >
              <SirenIcon aria-hidden className="size-4" />
              Open resus
            </button>
          </li>
        ))}
      </Section>

      <Section id="ended" title="Recently ended · 24 h" count={board.ended.length}>
        {board.ended.map((e) => (
          <li key={e.episodeId}>
            <Link href={href(e.episodeId)} className={ROW}>
              <div className="min-w-0 flex-1">
                <Who name={e.displayName} age={e.ageYears} />
                <p className="text-body-s text-muted-foreground flex flex-wrap items-center gap-x-2">
                  <span className="text-caption bg-muted text-foreground rounded-sm px-1.5 py-0.5">
                    {endedWord(e)}
                  </span>
                  {e.disposition ? (
                    <span>{DESTINATION_WORD[e.disposition] ?? e.disposition}</span>
                  ) : null}
                  {e.endedAtIso ? <span>· ended {hhmm(e.endedAtIso)}</span> : null}
                </p>
              </div>
              <ChevronRightIcon aria-hidden className="text-muted-foreground size-4 shrink-0" />
            </Link>
          </li>
        ))}
      </Section>

      {error ? (
        <p role="alert" className={cn("text-body-s rounded-md px-3 py-2", AMBER_NOTE)}>
          {error}
        </p>
      ) : null}

      <footer className="border-border flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-caption text-muted-foreground">
          {me.leaderRecommended
            ? "Your cadre is recommended to lead. Role assignment stays open — never blocked."
            : "Any clinical responder can take any role. The team leader is usually a doctor."}
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => openBlankResus(basePath))}
          className="tap text-body-s border-border text-foreground hover:bg-muted focus-visible:shadow-focus inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border px-4 font-medium outline-none disabled:opacity-50"
        >
          <PlusIcon aria-hidden className="size-4" />
          Start ad-hoc resus
        </button>
      </footer>
    </div>
  );
}
