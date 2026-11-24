"use client";

import type { Eligible, RotaAction } from "./assign-dialog";
import type { Post, Shift } from "@/lib/rota/cover";
import type { TemplateLine } from "@/lib/rota/templates";
import { useState, useTransition } from "react";

import { EditorDialog } from "@/components/medsync/editor-dialog";
import { LabButton } from "@/components/tide/work/button";
import { DialogTitle } from "@/components/ui/dialog";
import { DUTY_ROTA_COPY } from "@/content/duty-rota";
import { SHIFTS } from "@/lib/rota/cover";
import { chip } from "./assign-dialog";

const T = DUTY_ROTA_COPY.template;

/** The department's repeating week: lines of post, weekdays, shift and (optionally) a person. Ending a line is the only change. */
export function TemplateDialog({
  posts,
  lines,
  eligible,
  save,
  end,
  onClose,
}: {
  posts: Post[];
  lines: TemplateLine[];
  eligible: Eligible[];
  save: RotaAction;
  end: RotaAction;
  onClose: () => void;
}) {
  const [postId, setPostId] = useState<string | null>(null);
  const [days, setDays] = useState<number[]>([]);
  const [shift, setShift] = useState<Shift>("day");
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const post = posts.find((p) => p.id === postId);
  const people = eligible.filter((e) => post?.eligibleCadres.includes(e.cadre));
  const nameOf = (id: string | null) =>
    eligible.find((e) => e.userId === id)?.name ?? (id ? DUTY_ROTA_COPY.unnamed : T.unnamed);

  const run = (go: () => ReturnType<RotaAction>, then?: () => void) =>
    start(async () => {
      setError(null);
      const r = await go();
      if (!r.ok) return setError(r.error);
      then?.();
    });
  const blocked = !postId ? T.choosePost : !days.length ? T.chooseDays : null;

  return (
    <EditorDialog open onOpenChange={(o) => !o && !pending && onClose()} width="medium">
      <div className="flex flex-col gap-1 px-6 pt-5">
        <DialogTitle>{T.title}</DialogTitle>
        <p className="text-body-s text-ink-600">{T.lead}</p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-4">
        <section aria-label={T.lines} className="flex flex-col gap-2">
          <h3 className="text-body-s font-semibold">{T.lines}</h3>
          {lines.length ? (
            <ul className="flex flex-col gap-1">
              {lines.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-body-s">
                    {T.line(
                      posts.find((p) => p.id === l.postId)?.name ?? "",
                      l.weekdays.map((d) => T.weekdays[d - 1]).join(" "),
                      DUTY_ROTA_COPY.shift[l.shift].label,
                      nameOf(l.userId),
                    )}
                  </span>
                  <LabButton
                    size="sm"
                    variant="text"
                    busy={pending}
                    onClick={() => run(() => end({ lineId: l.id }))}
                  >
                    {T.end}
                  </LabButton>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body-s text-ink-600">{T.none}</p>
          )}
        </section>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-body-s mb-2 font-semibold">{T.post}</legend>
          <div className="flex flex-wrap gap-2">
            {posts.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={postId === p.id}
                onClick={() => {
                  setPostId(p.id);
                  setUserId(null);
                }}
                className={chip(postId === p.id)}
              >
                {p.name}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-body-s mb-2 font-semibold">{T.days}</legend>
          <div className="flex flex-wrap gap-2">
            {T.weekdays.map((w, i) => (
              <button
                key={w}
                type="button"
                aria-pressed={days.includes(i + 1)}
                onClick={() =>
                  setDays((d) => (d.includes(i + 1) ? d.filter((x) => x !== i + 1) : [...d, i + 1]))
                }
                className={chip(days.includes(i + 1))}
              >
                {w}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-body-s mb-2 font-semibold">{T.shift}</legend>
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
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-body-s mb-2 font-semibold">{T.person}</legend>
          <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
            {[{ userId: null, name: T.noPerson }, ...people].map((p) => (
              <button
                key={p.userId ?? "none"}
                type="button"
                aria-pressed={userId === p.userId}
                onClick={() => setUserId(p.userId)}
                className={chip(userId === p.userId)}
              >
                {p.name}
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
          {T.close}
        </LabButton>
        <LabButton
          variant="primary"
          busy={pending}
          disabledReason={blocked}
          onClick={() =>
            run(
              () => save({ postId, weekdays: [...days].sort(), shift, userId }),
              () => {
                setDays([]);
                setUserId(null);
              },
            )
          }
        >
          {T.add}
        </LabButton>
      </div>
    </EditorDialog>
  );
}
