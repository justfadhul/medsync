"use client";

import type { FlowAction } from "@/lib/workspace/flow";
import { useState, useTransition } from "react";
import { SirenIcon } from "lucide-react";

import { AMBER_CHIP } from "@/app/nurse/resus/[episodeId]/_components/v2/close-out-words";
import { openResusFromIntake, openResusFromTriage } from "@/app/nurse/resus/actions";
import { cn } from "@/lib/utils";
import { startForWorkspaceAction } from "../../_lib/workspace-actions";
import { PRIMARY_BUTTON } from "./row-actions";

/**
 * Start (or Open resus, for a fresh L1) outside the board — the encounter
 * page's rail and its "next patient" offer. The same server actions as the
 * board; a death on record is refused here with its words (the board's
 * confirm is where a reason is given).
 */
export function StartButton({
  action,
  label,
  className,
}: {
  action: FlowAction;
  label?: string;
  className?: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const resus = action.kind === "open_resus";
  const go = () =>
    start(async () => {
      setError(null);
      const r = resus
        ? action.intakeId
          ? await openResusFromIntake(action.intakeId, "/doctor/resus")
          : await openResusFromTriage(action.triageRecordId!, "/doctor/resus")
        : await startForWorkspaceAction({ triageRecordId: action.triageRecordId! });
      if (r && "error" in r && r.error) setError(r.error);
    });
  return (
    <span className="flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={go}
        className={cn(PRIMARY_BUTTON, className)}
      >
        {resus ? <SirenIcon aria-hidden className="size-4" /> : null}
        {pending ? "Starting…" : (label ?? action.label)}
      </button>
      {error ? (
        <span role="alert" className={cn("text-caption rounded-sm px-2 py-1", AMBER_CHIP)}>
          {error}
        </span>
      ) : null}
    </span>
  );
}
