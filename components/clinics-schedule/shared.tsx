"use client";

import type { CsPort } from "./port";
import type { CsData } from "@/lib/clinics-schedule/fixture";
import type {
  Change,
  Clinic,
  Edit,
  Exception,
  Person,
  readiness,
  Session,
  Snapshot,
  Weekday,
} from "@/lib/clinics-schedule/model";
import type { InputHTMLAttributes, ReactNode } from "react";
import { useState } from "react";

import desk from "@/components/reception/desk.module.css";
import { CS } from "@/content/clinics-schedule/copy";
import { fill } from "@/content/lab-workspace-v2";
import { clinicFee } from "@/lib/clinics-schedule/model";
import { initials } from "@/lib/reception/desk/model";
import cs from "./cs.module.css";

/** Class names from this module and the desk module (both apply when both define one). */
export const k = (...n: (string | false | null | undefined)[]) =>
  n
    .filter(Boolean)
    .map((x) => [cs[x as string], desk[x as string]].filter(Boolean).join(" "))
    .join(" ");

export type View = "ready" | "clinics" | "week" | "closures" | "people" | "devices" | "history";
export const VIEWS: readonly View[] = [
  "ready",
  "clinics",
  "week",
  "closures",
  "people",
  "devices",
  "history",
];

export type Modal =
  | { k: "ses"; clinicId: string; id?: string; weekday?: Weekday }
  | { k: "cx"; date?: string; type?: Exception["type"]; personId?: string; leaveId?: string }
  | { k: "dev" }
  | { k: "addP" }
  | { k: "open"; id: string }
  | { k: "pause"; id: string }
  | { k: "openAll" }
  | { k: "publish" }
  | { k: "sched" }
  | { k: "tpl" }
  | { k: "bulk" }
  | { k: "print" }
  | { k: "ppv"; id: string }
  | { k: "bands" }
  | { k: "user" }
  | { k: "keys" }
  | { k: "emerg" }
  | { k: "restore"; n: number };

export interface Ctx {
  d: CsData;
  /** published + scheduled + drafts: what admins see. */
  view: Snapshot;
  published: Snapshot;
  drafts: Change[];
  commit: (summary: string, edits: Edit[], toast?: string) => void;
  say: (text: string, undo?: () => void) => void;
  modal: (m: Modal | null) => void;
  go: (v: View, sel?: string | null) => void;
  sel: string | null;
  setSel: (id: string | null) => void;
  q: string;
  deptLive: (departmentId: string) => boolean;
  rd: (clinicId: string) => ReturnType<typeof readiness>;
  newId: () => string;
  port: CsPort;
  offline: boolean;
}

export const ugx = (n: number) => fill(CS.ugx, { n: n.toLocaleString("en-US") });
export const ini = (name: string) =>
  initials(name.replace(/^(Dr|Sister|Midwife|Physio|Nutritionist)\.?\s+/i, ""));
export const dayName = (w: Weekday) => CS.days[w - 1] ?? "";
export const dayLong = (w: Weekday) => CS.daysLong[w - 1] ?? "";
export const hm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
/** "Tue 17 Nov" from YYYY-MM-DD (civil date, no time zone). */
export const dateTxt = (ymd: string) => {
  const t = new Date(`${ymd}T00:00:00Z`);
  return `${CS.days[(t.getUTCDay() + 6) % 7]} ${t.getUTCDate()} ${CS.months[t.getUTCMonth()]}`;
};
export const addDays = (ymd: string, n: number) =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** The next date (today or later) that falls on this weekday. */
export const nextOn = (today: string, w: Weekday) => {
  const dow = ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
  return addDays(today, (w - dow + 7) % 7);
};

export function feeTxt(c: Clinic, s: Snapshot): { t: string; unset: boolean } {
  if (c.feeMode === "free") return { t: CS.clinics.free, unset: false };
  const f = clinicFee(c, s);
  if (f.min == null) return { t: CS.clinics.notSet, unset: true };
  return {
    t: f.min === f.max ? ugx(f.min) : fill(CS.clinics.from, { f: ugx(f.min) }),
    unset: false,
  };
}

export const sesTime = (x: Session) => `${hm(x.start)}–${hm(x.end)}`;
export const placeName = (s: Snapshot, id: string | null | undefined) =>
  id ? (s.places[id]?.name ?? "") : "";
export const personName = (s: Snapshot, id: string) => s.people[id]?.name ?? "";
export const docsTxt = (s: Snapshot, x: Session) =>
  x.personIds.length ? x.personIds.map((p) => personName(s, p)).join(", ") : CS.ed.nobody;
/** The search box: one lower-case test over a few fields. */
export const hit = (q: string, ...f: (string | null | undefined)[]) =>
  !q.trim() || f.some((x) => x?.toLowerCase().includes(q.trim().toLowerCase()));

export function Toggle({
  on,
  flip,
  t,
  disabled,
}: {
  on: boolean;
  flip: () => void;
  /** [label, sub when on, sub when off] */
  t: readonly [string, string, string?];
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={k("togg", on && "on")}
      aria-pressed={on}
      onClick={flip}
      disabled={disabled}
    >
      <span className={k("toggTb")} aria-hidden="true" />
      <span className={k("su-tgt")}>
        <b>{t[0]}</b>
        <small>{on || t[2] == null ? t[1] : t[2]}</small>
      </span>
    </button>
  );
}

export function Seg<T extends string | number>({
  opts,
  value,
  onPick,
  label,
  sm = true,
  className,
}: {
  opts: readonly (readonly [T, string])[];
  value: T | null;
  onPick: (v: T) => void;
  label?: string;
  sm?: boolean;
  className?: string;
}) {
  return (
    <div className={`${k("seg", sm && "sm")} ${className ?? ""}`} role="group" aria-label={label}>
      {opts.map(([v, l]) => (
        <button
          key={String(v)}
          type="button"
          className={k(value === v && "on")}
          aria-pressed={value === v}
          onClick={() => onPick(v)}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/** A row of chips; `on` per item. */
export function ChipRow({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className={k("chips", "sm")} role="group" aria-label={label}>
      {children}
    </div>
  );
}
export function Chip({
  on,
  onClick,
  children,
  cls,
  title,
}: {
  on?: boolean;
  onClick: () => void;
  children: ReactNode;
  cls?: string | false;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={k("chip", on && "on", cls)}
      aria-pressed={on}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );
}

export function Pav({ p, cls }: { p: Person | undefined; cls?: string }) {
  return (
    <span className={`${k("pav", !p && "hid")} ${cls ?? ""}`} aria-hidden="true">
      <b>{p ? ini(p.name) : "?"}</b>
    </span>
  );
}

export function Field({
  label,
  hint,
  children,
  as = "div",
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  as?: "div" | "label";
}) {
  const T = as;
  return (
    <T className={k("su-f")}>
      <span>
        {label}
        {hint != null ? <small>{hint}</small> : null}
      </span>
      {children}
    </T>
  );
}

/** − value + stepper. */
export function Step({
  value,
  dn,
  up,
  dnLabel,
  upLabel,
}: {
  value: ReactNode;
  dn: () => void;
  up: () => void;
  dnLabel: string;
  upLabel: string;
}) {
  return (
    <span className={k("su-step")}>
      <button type="button" className={k("btn", "sm")} onClick={dn} aria-label={dnLabel}>
        −
      </button>
      <b>{value}</b>
      <button type="button" className={k("btn", "sm")} onClick={up} aria-label={upLabel}>
        +
      </button>
    </span>
  );
}

/** A centred dialog frame on the desk's DeskDialog (ADR 0161); `size` sets the width. */
export { DeskDialog } from "@/components/reception/desk-dialog";
export { Icon } from "@/components/reception/ui";

/**
 * A text input that keeps its own value while typing and commits once on blur or Enter, so a draft change is
 * one edit, not one per keystroke. `numeric` keeps digits only.
 */
export function Txt({
  value,
  onCommit,
  numeric,
  className,
  ...rest
}: {
  value: string;
  onCommit: (v: string) => void;
  numeric?: boolean;
  className?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "className">) {
  const [v, setV] = useState(value);
  const [was, setWas] = useState(value);
  if (was !== value) {
    setWas(value);
    setV(value);
  }
  const done = () => v !== value && onCommit(v);
  return (
    <input
      {...rest}
      className={`${k("in")} ${className ?? ""}`}
      inputMode={numeric ? "numeric" : rest.inputMode}
      value={v}
      onChange={(e) => setV(numeric ? e.target.value.replace(/[^\d]/g, "") : e.target.value)}
      onBlur={done}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        rest.onKeyDown?.(e);
      }}
    />
  );
}
