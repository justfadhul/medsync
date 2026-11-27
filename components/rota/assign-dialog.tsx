"use client";

import type { ActionResult } from "@/lib/emr/write/context";
import type { Post, Shift } from "@/lib/rota/cover";
import { useState, useTransition } from "react";

import { EditorDialog } from "@/components/medsync/editor-dialog";
import { LabButton } from "@/components/tide/work/button";
import { DialogTitle } from "@/components/ui/dialog";
import { DUTY_ROTA_COPY } from "@/content/duty-rota";
import { SHIFTS } from "@/lib/rota/cover";
import { cn } from "@/lib/utils";
import { dayLabel } from "./gap-report";

const A = DUTY_ROTA_COPY.assign;
export type RotaAction = (raw: unknown) => Promise<ActionResult<{ id: string }>>;
export type Eligible = {
  userId: string;
  name: string;
  cadre: string;
  departmentName: string | null;
};

export const chip = (on: boolean) =>
  cn(
    "min-h-11 rounded-full px-4 text-[13.5px]",
    on ? "bg-tide-navy-900 text-tide-on-band font-semibold" : "bg-card shadow-tide-card",
  );

/**
 * Put someone on a post for the clicked day (ADR 0534). The day is fixed by the cell; the times come from the shift
 * chips. Only people whose grade this post takes are offered; the guard checks grade, leave and room again.
 */
export function AssignDialog({
  post,
  day,
  eligible,
  cadreNames,
  holders,
  assign,
  onClose,
}: {
  post: Post;
  day: string;
  /** The department's eligible staff; filtered here to the grades this post takes. */
  eligible: Eligible[];
  cadreNames: Record<string, string>;
  /** Who holds this post on this day: whom a cover can replace. */
  holders: { id: string; name: string }[];
  assign: RotaAction;
  onClose: () => void;
}) {
  const people = eligible.filter((e) => post.eligibleCadres.includes(e.cadre));
  const [find, setFind] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [shift, setShift] = useState<Shift>("day");
  const [kind, setKind] = useState<"rostered" | "cover">("rostered");
  const [covers, setCovers] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const shown = people.filter((p) => p.name.toLowerCase().includes(find.trim().toLowerCase()));

  const blocked = !userId ? A.choosePerson : kind === "cover" && !covers ? A.chooseWhom : null;
  const save = () =>
    start(async () => {
      setError(null);
      const r = await assign({
        postId: post.id,
        userId,
        day,
        shift,
        kind,
        coversAssignmentId: kind === "cover" ? covers : null,
      });
      if (!r.ok) return setError(r.error);
      onClose();
    });

  return (
    <EditorDialog open onOpenChange={(o) => !o && !pending && onClose()} width="medium">
      <div className="flex flex-col gap-1 px-6 pt-5">
        <DialogTitle>{A.title(post.name, dayLabel(day))}</DialogTitle>
        <p className="text-body-s text-ink-600">{DUTY_ROTA_COPY.plannedNotPresent}</p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-body-s mb-2 font-semibold">{A.person}</legend>
          {people.length ? (
            <>
              <input
                type="search"
                value={find}
                onChange={(e) => setFind(e.target.value)}
                placeholder={A.find}
                aria-label={A.find}
                className="border-input bg-card text-body-s h-10 rounded-[10px] border px-3"
              />
              <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
                {shown.map((p) => (
                  <li key={p.userId}>
                    <button
                      type="button"
                      aria-pressed={userId === p.userId}
                      onClick={() => setUserId(p.userId)}
                      className={cn(
                        "flex min-h-11 w-full flex-col items-start justify-center rounded-xl px-3 text-left",
                        userId === p.userId
                          ? "bg-tide-navy-900 text-tide-on-band"
                          : "hover:bg-ink-50",
                      )}
                    >
                      <span className="text-label">{p.name}</span>
                      <span className="text-caption opacity-80">
                        {[cadreNames[p.cadre] ?? p.cadre, p.departmentName]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-body-s text-ink-600">{A.noOne}</p>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-body-s mb-2 font-semibold">{A.shift}</legend>
          <div className="flex flex-wrap gap-2">
            {SHIFTS.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={shift === s}
                onClick={() => setShift(s)}
                className={chip(shift === s)}
              >
                {DUTY_ROTA_COPY.shift[s].label}
                <span className="ml-2 text-[12px] opacity-75">{DUTY_ROTA_COPY.shift[s].hours}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-body-s mb-2 font-semibold">{A.kind}</legend>
          <div className="flex flex-wrap gap-2">
            {(["rostered", "cover"] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                className={chip(kind === k)}
              >
                {k === "rostered" ? A.rostered : A.coverFor}
              </button>
            ))}
          </div>
          {kind === "cover" ? (
            holders.length ? (
              <div className="flex flex-wrap gap-2" role="group" aria-label={A.whom}>
                {holders.map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    aria-pressed={covers === x.id}
                    onClick={() => setCovers(x.id)}
                    className={chip(covers === x.id)}
                  >
                    {x.name}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-body-s text-ink-600">{A.noneToCover}</p>
            )
          ) : null}
        </fieldset>

        {error ? (
          <p role="alert" className="text-body-s text-foreground">
            {error}
          </p>
        ) : null}
      </div>
      <div className="border-border flex flex-wrap items-center justify-end gap-2 border-t px-6 py-3">
        <LabButton variant="quiet" onClick={onClose} busy={pending}>
          {A.cancel}
        </LabButton>
        <LabButton variant="primary" onClick={save} busy={pending} disabledReason={blocked}>
          {A.save}
        </LabButton>
      </div>
    </EditorDialog>
  );
}
