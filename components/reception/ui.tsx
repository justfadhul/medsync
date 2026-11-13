"use client";

import type { ReactNode } from "react";

import { EditorDialog } from "@/components/medsync/editor-dialog";
import s from "./desk.module.css";

/** Class names from the desk module: `c("btn", "sm", on && "on")`. */
export const c = (...n: (string | false | null | undefined)[]) =>
  n
    .filter(Boolean)
    .map((x) => s[x as string] ?? "")
    .join(" ");

const PATHS: Record<string, ReactNode> = {
  arrivals: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M17 11l2 2 4-4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  phone: (
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
  ),
  walk: (
    <>
      <circle cx="12" cy="5" r="2" />
      <path d="M10 22l1.5-6.5L9 13V9.5l3-1.5 3 2.5 3 1" />
      <path d="M13.5 15.5L15 22" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  ticket: (
    <>
      <path d="M3 9V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a3 3 0 0 0 0 6v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a3 3 0 0 0 0-6z" />
      <path d="M9 9.5h.01M9 14.5h.01" />
    </>
  ),
  nav: <path d="M3 11l19-9-9 19-2-8-8-2z" />,
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h10" />,
  rail: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M9 4v16" />
      <path d="m15 10-2 2 2 2" />
    </>
  ),
  down: <path d="m6 9 6 6 6-6" />,
  left: <path d="M15 6l-6 6 6 6" />,
  right: <path d="M9 6l6 6-6 6" />,
  tick: <path d="M20 6L9 17l-5-5" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  person: (
    <>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21a7 7 0 0 1 14 0" />
    </>
  ),
  chat: <path d="M4 5h16v11H9l-5 4z" />,
  card: (
    <>
      <rect x="2" y="6" width="20" height="13" rx="2" />
      <path d="M2 10h20" />
    </>
  ),
  keys: (
    <>
      <rect x="2" y="6" width="20" height="13" rx="3" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 15h10" />
    </>
  ),
  swap: (
    <>
      <path d="M16 3l4 4-4 4" />
      <path d="M20 7H4" />
      <path d="M8 21l-4-4 4-4" />
      <path d="M4 17h16" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  print: (
    <>
      <path d="M6 9V3h12v6" />
      <rect x="3" y="9" width="18" height="8" rx="2" />
      <path d="M7 14h10v7H7z" />
    </>
  ),
};

export function Icon({
  n,
  size = 16,
  w = 1.8,
}: {
  n: keyof typeof PATHS | string;
  size?: number;
  w?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={w}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[n]}
    </svg>
  );
}

/** One row of toggle chips. */
export function Chips<T extends string>({
  items,
  value,
  onPick,
  label,
  multi,
  extra,
}: {
  items: readonly (T | readonly [T, string])[];
  value: T | T[] | "" | null | undefined;
  onPick: (v: T) => void;
  label?: string;
  multi?: boolean;
  extra?: ReactNode;
}) {
  return (
    <div className={c("chips")} role="group" aria-label={label}>
      {items.map((it) => {
        const [v, l] = typeof it === "string" ? [it, it] : (it as readonly [T, string]);
        const on = multi ? ((value as T[]) ?? []).includes(v) : value === v;
        return (
          <button
            key={v}
            type="button"
            className={c("chip", on && "on")}
            aria-pressed={on}
            onClick={() => onPick(v)}
          >
            {l}
          </button>
        );
      })}
      {extra}
    </div>
  );
}

/** A centred desk dialog (ADR 0161): EditorDialog underneath, the canvas card on top. */
export function DeskDialog({
  open,
  onClose,
  label,
  size,
  tile,
  red,
  title,
  lead,
  closeLabel = "Close",
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  size?: "xw" | "cbm" | "slm";
  tile: string;
  red?: boolean;
  title: ReactNode;
  lead?: ReactNode;
  closeLabel?: string;
  children: ReactNode;
}) {
  return (
    <EditorDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      width="xl"
      className="w-auto max-w-none overflow-visible rounded-none bg-transparent p-0 shadow-none ring-0 sm:max-h-none sm:max-w-none"
    >
      <div className={`${s.tokens} ${c("modal", size)}`} aria-label={label}>
        <div className={c("mh")}>
          <span className={c("tile", red && "red")} aria-hidden="true">
            <Icon n={tile} size={18} />
          </span>
          <div>
            <h2 className={red ? s.redText : undefined}>{title}</h2>
            {lead ? <p>{lead}</p> : null}
          </div>
          <button type="button" className={c("btn", "sm", "q", "x")} onClick={onClose}>
            {closeLabel}
          </button>
        </div>
        {children}
      </div>
    </EditorDialog>
  );
}
