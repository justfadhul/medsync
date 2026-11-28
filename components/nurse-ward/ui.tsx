import type { ReactNode } from "react";

import d from "@/components/reception/desk.module.css";
import s from "./ward.module.css";

/**
 * Class names for the ward desk (ADR 0546): each name from the clinic floor's desk module and from the ward's own
 * module (prototype v82's styles), so markup reads like the prototype: `k("btn", "sm", "k")`.
 */
export const k = (...n: (string | false | null | undefined)[]) =>
  n
    .filter(Boolean)
    .flatMap((x) => [d[x as string], s[x as string]])
    .filter(Boolean)
    .join(" ");

/** Prototype v82's ward icons (the desk's own set has no bed, pill or lock). */
const PATHS: Record<string, ReactNode> = {
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  bed: (
    <>
      <path d="M3 18V6M3 13h18v5M21 13v-2a3 3 0 0 0-3-3h-7v5" />
      <circle cx="7" cy="10" r="2" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16 4.5a3 3 0 0 1 0 6M21 20a5 5 0 0 0-3.5-4.8" />
    </>
  ),
  cal: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </>
  ),
  check: (
    <>
      <path d="M9 12l2 2 4-4" />
      <circle cx="12" cy="12" r="9" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  pill: (
    <>
      <path d="M10.5 3.5a5 5 0 0 1 7 7l-7 7a5 5 0 0 1-7-7z" />
      <path d="M7 7l7 7" />
    </>
  ),
  swap: <path d="M7 7h11l-3-3M17 17H6l3 3" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  inbox: (
    <>
      <path d="M3 13h5l1.5 3h5L16 13h5" />
      <path d="M5 5h14l2 8v6H3v-6z" />
    </>
  ),
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  assign: (
    <>
      <circle cx="8" cy="8" r="3" />
      <path d="M2 20a6 6 0 0 1 12 0" />
      <path d="M16 11l2 2 4-4" />
    </>
  ),
  tick: <path d="M5 12l5 5L20 7" />,
};

export function WIcon({ n, size = 19 }: { n: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[n]}
    </svg>
  );
}

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

export const hm = (d: Date | string) =>
  new Date(d).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Kampala",
  });

export const dayWord = (d: Date) =>
  d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Africa/Kampala",
  });

/** The prototype's page head: title, date and time, stat pills, then the page's own controls. */
export function WardPage({
  title,
  now,
  stats,
  controls,
  side,
  children,
}: {
  title: string;
  now: Date;
  stats: readonly (readonly [ReactNode, string])[];
  controls?: ReactNode;
  side?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={k("cf-wrap")}>
      <div className={k("cf-l")}>
        <div className={k("ahead")}>
          <div className={k("ahl")}>
            <h1>{title}</h1>
            <span className={k("adate")}>
              {dayWord(now)} · {hm(now)}
            </span>
          </div>
          <div className={k("cf-stats")}>
            {stats.map(([b, t]) => (
              <span key={t} className={k("cf-stat")}>
                <b>{b}</b> {t}
              </span>
            ))}
          </div>
          <span className={k("grow")} />
          {controls}
        </div>
        {children}
      </div>
      {side}
    </div>
  );
}

/**
 * NEWS2 as the prototype's level pill, always with the number and the signed band's words. Red only for the signed
 * emergency band; no other threshold is drawn here (the band comes from the monitoring payload).
 */
export function Lvl({
  total,
  emergency,
  band,
}: {
  total: number | null;
  emergency: boolean;
  band: string | null;
}) {
  if (total === null) return <span className={k("cf-tag")}>No score yet</span>;
  return (
    <span className={emergency ? k("lvl", "high") : k("cf-tag")} title={band ?? undefined}>
      NEWS2 {total}
      {band ? ` · ${band}` : ""}
    </span>
  );
}
