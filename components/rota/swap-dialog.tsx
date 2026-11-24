"use client";

import type { RotaAction } from "./assign-dialog";
import { useState, useTransition } from "react";

import { EditorDialog } from "@/components/medsync/editor-dialog";
import { LabButton } from "@/components/tide/work/button";
import { DialogTitle } from "@/components/ui/dialog";
import { DUTY_ROTA_COPY } from "@/content/duty-rota";
import { chip } from "./assign-dialog";

const S = DUTY_ROTA_COPY.swap;

/**
 * The holder asks a colleague to cover a duty or swap it. The colleague must be someone the post's grades take;
 * a swap also names which of their duties on the same post the holder takes. The guard checks all of it again.
 */
export function SwapDialog({
  title,
  assignmentId,
  colleagues,
  theirDuties,
  ask,
  onClose,
}: {
  title: string;
  assignmentId: string;
  colleagues: { userId: string; name: string }[];
  theirDuties: { id: string; userId: string; label: string }[];
  ask: RotaAction;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<"cover" | "swap">("cover");
  const [colleague, setColleague] = useState<string | null>(null);
  const [theirs, setTheirs] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const options = theirDuties.filter((d) => d.userId === colleague);

  const blocked = !colleague
    ? S.chooseColleague
    : kind === "swap" && !theirs
      ? S.chooseTheirs
      : null;
  const save = () =>
    start(async () => {
      setError(null);
      const r = await ask({
        assignmentId,
        kind,
        colleagueUserId: colleague,
        ...(kind === "swap" ? { swapAssignmentId: theirs } : {}),
      });
      if (!r.ok) return setError(r.error);
      onClose();
    });

  return (
    <EditorDialog open onOpenChange={(o) => !o && !pending && onClose()} width="medium">
      <div className="flex flex-col gap-1 px-6 pt-5">
        <DialogTitle>{title}</DialogTitle>
        <p className="text-body-s text-ink-600">{DUTY_ROTA_COPY.plannedNotPresent}</p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-body-s mb-2 font-semibold">{S.kind}</legend>
          <div className="flex flex-wrap gap-2">
            {(["cover", "swap"] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => {
                  setKind(k);
                  setTheirs(null);
                }}
                className={chip(kind === k)}
              >
                {k === "cover" ? S.cover : S.swap}
              </button>
            ))}
          </div>
          <p className="text-caption text-ink-600">{kind === "cover" ? S.coverHelp : S.swapHelp}</p>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-body-s mb-2 font-semibold">{S.colleague}</legend>
          {colleagues.length ? (
            <div className="flex flex-wrap gap-2">
              {colleagues.map((c) => (
                <button
                  key={c.userId}
                  type="button"
                  aria-pressed={colleague === c.userId}
                  onClick={() => {
                    setColleague(c.userId);
                    setTheirs(null);
                  }}
                  className={chip(colleague === c.userId)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-body-s text-ink-600">{S.noColleagues}</p>
          )}
        </fieldset>
        {kind === "swap" && colleague ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-body-s mb-2 font-semibold">{S.theirs}</legend>
            {options.length ? (
              <div className="flex flex-wrap gap-2">
                {options.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    aria-pressed={theirs === d.id}
                    onClick={() => setTheirs(d.id)}
                    className={chip(theirs === d.id)}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-body-s text-ink-600">{S.noTheirs}</p>
            )}
          </fieldset>
        ) : null}
        {error ? (
          <p role="alert" className="text-body-s text-foreground">
            {error}
          </p>
        ) : null}
      </div>
      <div className="border-border flex flex-wrap items-center justify-end gap-2 border-t px-6 py-3">
        <LabButton variant="quiet" onClick={onClose} busy={pending}>
          {S.cancel}
        </LabButton>
        <LabButton variant="primary" onClick={save} busy={pending} disabledReason={blocked}>
          {S.save}
        </LabButton>
      </div>
    </EditorDialog>
  );
}
