"use client";

import type { FlowAction, PatientFlowRow } from "@/lib/workspace/flow";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { EllipsisIcon, SirenIcon } from "lucide-react";

import { openResusFromIntake, openResusFromTriage } from "@/app/nurse/resus/actions";
import { cn } from "@/lib/utils";
import { startForWorkspaceAction, takePatientAction } from "../../_lib/workspace-actions";
import { useBoard } from "./board-context";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "./buttons";
import { patientTitle } from "./patient-line";

const RESUS_BASE = "/doctor/resus";

/** Loaded only when a death is on record and someone asks to start anyway. */
const DeathConfirm = dynamic(() => import("./death-confirm"), { ssr: false });

export { PRIMARY_BUTTON, SECONDARY_BUTTON };

/** Where a link action goes; null for those that run on the server or open the panel. */
export function hrefOf(a: FlowAction): string | null {
  switch (a.kind) {
    case "open_desk":
      return `${RESUS_BASE}/${a.episodeId}`;
    case "close_resus":
      return `${RESUS_BASE}/${a.episodeId}?close=1`;
    case "triage":
    case "retriage":
      return `/doctor/triage/${a.intakeId}`;
    case "continue":
    case "view":
      return `/doctor/encounters/${a.encounterId}`;
    default:
      return null;
  }
}

type Outcome = { ok?: boolean; error?: string; deceased?: { atIso: string; source: string } };

/** The existing and the new server actions, by kind. They redirect on success. */
function serverAction(a: FlowAction, overrideReason?: string): Promise<Outcome | void> {
  switch (a.kind) {
    case "take":
      return takePatientAction({ intakeId: a.intakeId!, overrideReason });
    case "start":
      return startForWorkspaceAction({ triageRecordId: a.triageRecordId!, overrideReason });
    case "start_override":
      return a.encounterId
        ? startForWorkspaceAction({ triageRecordId: a.triageRecordId!, overrideReason })
        : takePatientAction({ intakeId: a.intakeId!, overrideReason });
    case "open_resus":
      return a.intakeId
        ? openResusFromIntake(a.intakeId, RESUS_BASE)
        : openResusFromTriage(a.triageRecordId!, RESUS_BASE);
    default:
      return Promise.resolve({ error: `${a.label} is not available here.` });
  }
}

/** Runs one action for a row: a link, a server action, or the patient panel. */
export function useRunAction(row: PatientFlowRow) {
  const board = useBoard();
  const router = useRouter();
  const [pending, start] = useTransition();
  // Stays mounted once asked, so the confirm can animate out when closed.
  const [confirm, setConfirm] = useState<{ action: FlowAction; open: boolean } | null>(null);
  const ask = (action: FlowAction) => setConfirm({ action, open: true });
  const dismiss = () => setConfirm((c) => c && { ...c, open: false });

  const run = (a: FlowAction, overrideReason?: string) => {
    const href = hrefOf(a);
    if (href) return router.push(href);
    if (a.kind === "review") return board.openPanel(row.key, "also_open");
    if (a.kind === "assign") return board.openPanel(row.key, "assign");
    if (a.kind === "reassign") return board.openPanel(row.key, "reassign");
    if (a.kind === "start_override" && !overrideReason) return ask(a);
    start(async () => {
      board.report(null);
      board.follow();
      const res = await serverAction(a, overrideReason);
      if (!res || !res.error) return;
      // A death recorded since the board loaded: the same confirm, never a block (Law 2).
      if (res.deceased && !overrideReason) return ask(a);
      board.report(res.error);
    });
  };

  const dialog = confirm ? (
    <DeathConfirm
      row={row}
      open={confirm.open}
      pending={pending}
      onCancel={dismiss}
      onConfirm={(reason) => {
        dismiss();
        run(confirm.action, reason);
      }}
    />
  ) : null;
  return { run, pending, dialog };
}

/** The row's one next step (≤ 2 visible controls per row: this and ⋯). */
export function PrimaryAction({
  row,
  tabIndex,
  className,
}: {
  row: PatientFlowRow;
  tabIndex?: number;
  className?: string;
}) {
  const { run, pending, dialog } = useRunAction(row);
  const a = row.primary;
  if (!a) return null;
  const resus = a.kind === "open_resus" || a.kind === "open_desk";
  const body = (
    <>
      {resus ? <SirenIcon aria-hidden className="size-4" /> : null}
      {pending ? `${a.label}…` : a.label}
    </>
  );
  const href = hrefOf(a);
  return (
    <>
      {href ? (
        <Link
          href={href}
          data-primary
          tabIndex={tabIndex}
          className={cn(PRIMARY_BUTTON, className)}
        >
          {body}
        </Link>
      ) : (
        <button
          type="button"
          data-primary
          tabIndex={tabIndex}
          disabled={pending}
          onClick={() => run(a)}
          className={cn(PRIMARY_BUTTON, className)}
        >
          {body}
        </button>
      )}
      {dialog}
    </>
  );
}

/**
 * ⋯ — "more for this patient": opens the panel, where the row's other actions
 * are plain buttons (§5.2: ≤ 2 visible controls per row). A menu would repeat
 * the panel and cost the board a menu library for the privilege.
 */
export function OverflowMenu({ row, tabIndex }: { row: PatientFlowRow; tabIndex?: number }) {
  const board = useBoard();
  return (
    <button
      type="button"
      tabIndex={tabIndex}
      aria-label={`More for ${patientTitle(row.identity)}`}
      onClick={() => board.openPanel(row.key)}
      className="tap text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:shadow-focus inline-flex size-11 shrink-0 items-center justify-center rounded-md outline-none"
    >
      <EllipsisIcon aria-hidden className="size-4" />
    </button>
  );
}
