"use client";

import type { Eligible, RotaAction } from "./assign-dialog";
import { useState, useTransition } from "react";

import { EditorDialog } from "@/components/medsync/editor-dialog";
import { LabButton } from "@/components/tide/work/button";
import { DialogTitle } from "@/components/ui/dialog";
import { DUTY_ROTA_COPY } from "@/content/duty-rota";
import { addDays } from "@/lib/rota/cover";
import { cn } from "@/lib/utils";
import { chip } from "./assign-dialog";

const D = DUTY_ROTA_COPY.delegate;
const UNTIL = [
  { key: "w1", label: D.week1, days: 7 },
  { key: "w4", label: D.weeks4, days: 28 },
  { key: "none", label: D.noEnd, days: null },
] as const;

/** Hand this department's rota to someone for a while (0309). "Until" is a chip, never a date field. */
export function DelegateDialog({
  eligible,
  add,
  onClose,
}: {
  eligible: Eligible[];
  add: RotaAction;
  onClose: () => void;
}) {
  const [find, setFind] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [canPublish, setCanPublish] = useState(false);
  const [until, setUntil] = useState<(typeof UNTIL)[number]["key"]>("w1");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const shown = eligible.filter((p) => p.name.toLowerCase().includes(find.trim().toLowerCase()));

  const save = () =>
    start(async () => {
      setError(null);
      const days = UNTIL.find((u) => u.key === until)!.days;
      // Today in Kampala, plus the chip's days.
      const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
      const r = await add({
        toUserId: userId,
        canPublish,
        until: days === null ? null : addDays(today, days),
      });
      if (!r.ok) return setError(r.error);
      onClose();
    });

  return (
    <EditorDialog open onOpenChange={(o) => !o && !pending && onClose()} width="medium">
      <div className="flex flex-col gap-1 px-6 pt-5">
        <DialogTitle>{D.title}</DialogTitle>
        <p className="text-body-s text-ink-600">{D.lead}</p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-body-s mb-2 font-semibold">{D.person}</legend>
          {eligible.length ? (
            <>
              <input
                type="search"
                value={find}
                onChange={(e) => setFind(e.target.value)}
                placeholder={D.find}
                aria-label={D.find}
                className="border-input bg-card text-body-s h-10 rounded-[10px] border px-3"
              />
              <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                {shown.map((p) => (
                  <li key={p.userId}>
                    <button
                      type="button"
                      aria-pressed={userId === p.userId}
                      onClick={() => setUserId(p.userId)}
                      className={cn(
                        "flex min-h-11 w-full items-center rounded-xl px-3 text-left",
                        userId === p.userId
                          ? "bg-tide-navy-900 text-tide-on-band"
                          : "hover:bg-ink-50",
                      )}
                    >
                      <span className="text-label">{p.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-body-s text-ink-600">{D.noOne}</p>
          )}
        </fieldset>
        <label className="text-body-s flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            checked={canPublish}
            onChange={(e) => setCanPublish(e.target.checked)}
            className="size-5"
          />
          <span className="font-semibold">{D.canPublish}</span>
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-body-s mb-2 font-semibold">{D.until}</legend>
          <div className="flex flex-wrap gap-2">
            {UNTIL.map((u) => (
              <button
                key={u.key}
                type="button"
                aria-pressed={until === u.key}
                onClick={() => setUntil(u.key)}
                className={chip(until === u.key)}
              >
                {u.label}
              </button>
            ))}
          </div>
        </fieldset>
        {error ? (
          <p role="alert" className="text-body-s text-foreground">
            {error}
          </p>
        ) : null}
      </div>
      <div className="border-border flex flex-wrap items-center justify-end gap-2 border-t px-6 py-3">
        <LabButton variant="quiet" onClick={onClose} busy={pending}>
          {D.cancel}
        </LabButton>
        <LabButton
          variant="primary"
          onClick={save}
          busy={pending}
          disabledReason={userId ? null : D.choosePerson}
        >
          {D.save}
        </LabButton>
      </div>
    </EditorDialog>
  );
}
