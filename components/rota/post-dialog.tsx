"use client";

import type { RotaAction } from "./assign-dialog";
import type { Post, PostLevel } from "@/lib/rota/cover";
import type { ReactNode } from "react";
import { useState, useTransition } from "react";

import { EditorDialog } from "@/components/medsync/editor-dialog";
import { LabButton } from "@/components/tide/work/button";
import { DialogTitle } from "@/components/ui/dialog";
import { DUTY_ROTA_COPY } from "@/content/duty-rota";
import { POST_LEVELS } from "@/lib/rota/cover";
import { chip } from "./assign-dialog";

const P = DUTY_ROTA_COPY.post;

/** A new post on the department's rota (ADR 0534): the PostInput fields, the grades as chips. */
export function PostDialog({
  departmentId,
  wards,
  cadres,
  posts,
  createPost,
  onClose,
}: {
  departmentId: string;
  wards: { id: string; name: string }[];
  cadres: { code: string; name: string }[];
  /** The department's live posts: what a new post may escalate to. */
  posts: Post[];
  createPost: RotaAction;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [wardId, setWardId] = useState<string | null>(null);
  const [level, setLevel] = useState<PostLevel>("junior");
  const [picked, setPicked] = useState<string[]>([]);
  const [takesConsults, setTakesConsults] = useState(false);
  const [escalatesToPostId, setEscalates] = useState<string | null>(null);
  const [capacity, setCapacity] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const blocked = name.trim().length < 2 ? P.chooseName : !picked.length ? P.chooseCadre : null;
  const toggle = (code: string) =>
    setPicked((xs) => (xs.includes(code) ? xs.filter((x) => x !== code) : [...xs, code]));
  const save = () =>
    start(async () => {
      setError(null);
      const r = await createPost({
        departmentId,
        wardId,
        name,
        level,
        eligibleCadres: picked,
        takesConsults,
        escalatesToPostId,
        capacity,
      });
      if (!r.ok) return setError(r.error);
      onClose();
    });

  const group = (legend: string, children: ReactNode) => (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-body-s mb-2 font-semibold">{legend}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );

  return (
    <EditorDialog open onOpenChange={(o) => !o && !pending && onClose()} width="wide">
      <div className="flex flex-col gap-1 px-6 pt-5">
        <DialogTitle>{P.title}</DialogTitle>
      </div>
      <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto px-6 py-4 md:grid-cols-2">
        <div className="flex flex-col gap-5">
          <label className="flex flex-col gap-2">
            <span className="text-body-s font-semibold">{P.name}</span>
            <input
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              placeholder={P.namePlaceholder}
              className="border-input bg-card text-body-s h-10 rounded-[10px] border px-3"
            />
          </label>
          {group(
            P.place,
            [{ id: null, name: P.wholeDepartment }, ...wards].map((w) => (
              <button
                key={w.id ?? "dept"}
                type="button"
                aria-pressed={wardId === w.id}
                onClick={() => setWardId(w.id)}
                className={chip(wardId === w.id)}
              >
                {w.name}
              </button>
            )),
          )}
          {group(
            P.level,
            POST_LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={level === l}
                onClick={() => setLevel(l)}
                className={chip(level === l)}
              >
                {DUTY_ROTA_COPY.level[l]}
              </button>
            )),
          )}
          {group(
            P.consults,
            [true, false].map((v) => (
              <button
                key={String(v)}
                type="button"
                aria-pressed={takesConsults === v}
                onClick={() => setTakesConsults(v)}
                className={chip(takesConsults === v)}
              >
                {v ? P.yes : P.no}
              </button>
            )),
          )}
        </div>
        <div className="flex flex-col gap-5">
          {group(
            P.cadres,
            cadres.map((c) => (
              <button
                key={c.code}
                type="button"
                aria-pressed={picked.includes(c.code)}
                onClick={() => toggle(c.code)}
                className={chip(picked.includes(c.code))}
              >
                {c.name}
              </button>
            )),
          )}
          {group(
            P.escalates,
            [{ id: null, name: P.noEscalation }, ...posts].map((p) => (
              <button
                key={p.id ?? "head"}
                type="button"
                aria-pressed={escalatesToPostId === p.id}
                onClick={() => setEscalates(p.id)}
                className={chip(escalatesToPostId === p.id)}
              >
                {p.name}
              </button>
            )),
          )}
          {group(
            P.capacity,
            <div className="flex items-center gap-3">
              <LabButton aria-label={P.less} onClick={() => setCapacity(Math.max(1, capacity - 1))}>
                −
              </LabButton>
              <span className="text-heading-s min-w-8 text-center tabular-nums" aria-live="polite">
                {capacity}
              </span>
              <LabButton
                aria-label={P.more}
                onClick={() => setCapacity(Math.min(20, capacity + 1))}
              >
                +
              </LabButton>
            </div>,
          )}
        </div>
        {error ? (
          <p role="alert" className="text-body-s text-foreground md:col-span-2">
            {error}
          </p>
        ) : null}
      </div>
      <div className="border-border flex flex-wrap items-center justify-end gap-2 border-t px-6 py-3">
        <LabButton variant="quiet" onClick={onClose} busy={pending}>
          {P.cancel}
        </LabButton>
        <LabButton variant="primary" onClick={save} busy={pending} disabledReason={blocked}>
          {P.save}
        </LabButton>
      </div>
    </EditorDialog>
  );
}
