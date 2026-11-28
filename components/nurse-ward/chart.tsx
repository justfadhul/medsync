import type { NewsSummary } from "@/lib/nurse/news-summary";
import type { ReactNode } from "react";
import Link from "next/link";

import { dueWords } from "./screens";
import { hm, initialsOf, k, Lvl } from "./ui";

export type ChartTab = "care" | "obs" | "meds" | "doc";
export const CHART_TABS: readonly (readonly [ChartTab, string])[] = [
  ["care", "Care plan"],
  ["obs", "Observations"],
  ["meds", "Medicines"],
  ["doc", "Doctor's plan"],
];
export const chartTab = (t: string | undefined): ChartTab =>
  CHART_TABS.some(([x]) => x === t) ? (t as ChartTab) : "care";

/**
 * Prototype v82's patient chart (ADR 0546): who the patient is, NEWS2 and when vitals are next due, the actions, and
 * four tabs, each its own address (`?tab=`), so the back button and a shared link land on the same tab.
 */
export function NurseChartFrame({
  patientUserId,
  name,
  line,
  eyebrow,
  news,
  allergy,
  tab,
  actionsAllowed,
  now,
  children,
}: {
  patientUserId: string;
  name: string;
  line: string;
  eyebrow: string;
  news: NewsSummary | null;
  allergy: string;
  tab: ChartTab;
  actionsAllowed: boolean;
  now: Date;
  children: ReactNode;
}) {
  const base = `/nurse/patients/${patientUserId}`;
  return (
    <div className={k("cf-wrap")}>
      <div className={k("cf-l")}>
        <div className={k("cf-nc")}>
          <div className={k("ch-h")}>
            <div className={k("ch-id")}>
              <span className={k("pav", "lg")}>{initialsOf(name) || "P"}</span>
              <div style={{ minWidth: 0 }}>
                <span className={k("ch-eye")}>
                  <Link
                    href="/nurse/patients"
                    prefetch={false}
                    className={k("ch-back")}
                    aria-label="Back to my patients"
                  >
                    ←
                  </Link>
                  {eyebrow}
                </span>
                <h2>{name}</h2>
                <p>
                  {line} · <b>{allergy}</b>
                </p>
              </div>
            </div>
            <div className={k("ch-stat")}>
              {news ? (
                <Lvl total={news.total} emergency={news.emergency} band={news.bandLabel} />
              ) : null}
              {news?.dueAt ? (
                <span className={k("ch-due", news.late && "late")}>
                  {news.late ? "Vitals overdue since" : "Next vitals"} <b>{hm(news.dueAt)}</b>
                </span>
              ) : news ? (
                <span className={k("ch-due")}>{dueWords(news, now)}</span>
              ) : null}
            </div>
            <div className={k("ch-acts")}>
              {actionsAllowed ? (
                <Link
                  href={`/nurse/observations?patient=${patientUserId}`}
                  prefetch={false}
                  className={k("btn", "k", "sm")}
                >
                  Record vitals
                </Link>
              ) : null}
            </div>
          </div>
          <nav className={k("ctabs")} aria-label="Chart">
            {CHART_TABS.map(([t, label]) => (
              <Link
                key={t}
                href={t === "care" ? base : `${base}?tab=${t}`}
                prefetch={false}
                aria-current={t === tab ? "page" : undefined}
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className={k("cbody")}>{children}</div>
        </div>
      </div>
    </div>
  );
}
