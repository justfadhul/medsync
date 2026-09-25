"use client";

import type { FlowAction, PatientFlowRow } from "@/lib/workspace/flow";
import type { ReactNode } from "react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { AcuityChip } from "./acuity-chip";
import { Elapsed } from "./elapsed";
import { patientTitle } from "./patient-line";
import { StartButton } from "./start-button";

const ROOMY = "(min-width: 1440px)";

/** Open by default from 1440 px, collapsed below (§5.4); the doctor's toggle wins after that. */
function useRoomy(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia(ROOMY);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    () => window.matchMedia(ROOMY).matches,
    () => false,
  );
}

export function RailPanel({
  rows,
  currentEncounterId,
  serverNowIso,
}: {
  rows: PatientFlowRow[];
  currentEncounterId: string;
  serverNowIso: string;
}) {
  const roomy = useRoomy();
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? roomy;
  const waiting = rows.filter((r) => r.lane === "waiting");
  const running = rows.filter((r) => r.lane === "in_progress");

  if (!open) {
    return (
      <div className="hidden shrink-0 pt-5 pl-3 lg:block">
        <button
          type="button"
          aria-expanded={false}
          onClick={() => setChoice(true)}
          className="tap text-body-s border-border text-foreground hover:bg-muted focus-visible:shadow-focus inline-flex min-h-11 items-center gap-1.5 rounded-md border px-3 outline-none"
        >
          <PanelLeftOpenIcon aria-hidden className="size-4" />
          Workspace
          <span className="text-muted-foreground font-mono text-[12px] tabular-nums">
            {waiting.length + running.length}
          </span>
        </button>
      </div>
    );
  }

  return (
    <aside
      aria-label="Workspace"
      className="border-border bg-muted/30 hidden w-72 shrink-0 flex-col gap-5 overflow-y-auto border-r px-4 py-5 lg:flex"
    >
      <div className="flex items-center justify-between gap-2">
        <Link href="/doctor" className="text-body-s text-foreground font-medium hover:underline">
          Workspace
        </Link>
        <button
          type="button"
          aria-expanded
          aria-label="Collapse the workspace rail"
          onClick={() => setChoice(false)}
          className="tap text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:shadow-focus inline-flex size-11 items-center justify-center rounded-md outline-none"
        >
          <PanelLeftCloseIcon aria-hidden className="size-4" />
        </button>
      </div>
      <RailGroup
        title="Waiting for you"
        rows={waiting}
        serverNowIso={serverNowIso}
        empty="No one waiting."
      />
      <RailGroup
        title="In progress"
        rows={running}
        serverNowIso={serverNowIso}
        empty="Nothing else open."
        currentEncounterId={currentEncounterId}
      />
    </aside>
  );
}

function RailGroup({
  title,
  rows,
  empty,
  serverNowIso,
  currentEncounterId,
}: {
  title: string;
  rows: PatientFlowRow[];
  empty: string;
  serverNowIso: string;
  currentEncounterId?: string;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-caption text-muted-foreground font-medium">
        {title} · <span className="font-mono tabular-nums">{rows.length}</span>
      </h2>
      {rows.length === 0 ? (
        <p className="text-body-s text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((r) => {
            const current = r.primary?.encounterId === currentEncounterId;
            return (
              <li
                key={r.key}
                className={cn(
                  "border-border flex flex-col gap-1.5 rounded-lg border px-3 py-2",
                  current ? "bg-card border-gray-300" : "bg-card/60",
                )}
              >
                <div className="flex items-center gap-2">
                  <AcuityChip level={r.acuity.level} className="w-auto px-1.5" />
                  <span className="text-body-s text-foreground min-w-0 truncate font-medium">
                    {patientTitle(r.identity)}
                  </span>
                </div>
                <div className="text-caption text-muted-foreground flex items-center justify-between gap-2">
                  <span className="font-mono tabular-nums">{r.identity.code ?? ""}</span>
                  <Elapsed sinceMs={r.sinceMs} serverNowIso={serverNowIso} />
                </div>
                {current ? (
                  <span className="text-caption text-muted-foreground">This clerking</span>
                ) : r.primary?.kind === "continue" ? (
                  <Link
                    href={`/doctor/encounters/${r.primary.encounterId}`}
                    className="text-body-s text-foreground font-medium hover:underline"
                  >
                    Continue
                  </Link>
                ) : r.primary ? (
                  <StartButton action={r.primary} className="min-h-9 w-full" />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The "next patient" line under the encounter's top bar, after End visit. */
export function NextPatientBar({ action, children }: { action?: FlowAction; children: ReactNode }) {
  return (
    <div
      role="status"
      className="border-border bg-card flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3 sm:px-6"
    >
      {children}
      <span className="ml-auto flex flex-wrap items-center gap-2">
        {action ? <StartButton action={action} /> : null}
        <Link
          href="/doctor"
          className="tap text-body-s border-border text-foreground hover:bg-muted focus-visible:shadow-focus inline-flex min-h-11 items-center rounded-md border px-4 font-medium outline-none"
        >
          Back to workspace
        </Link>
      </span>
    </div>
  );
}
