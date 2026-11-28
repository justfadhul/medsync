"use client";

import type { DayMood, Mood } from "@patient-core/log";
import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { countMoods } from "@patient-core/log";

import { Toast } from "@/components/tide/controls";
import { MoodFace } from "@/components/tide/mood-face";
import { HOME_COPY as C, MOOD_COPY as M } from "@/content/patient/home";
import { cn } from "@/lib/utils";
import { saveMoodAction } from "../_lib/day-actions";

const MOODS: DayMood[] = ["good", "okay", "low"];
const VIEWS = ["week", "month", "year"] as const;
type View = (typeof VIEWS)[number];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
/** The year bars take the faces' own fills; the legend and each bar's hidden line say the numbers (never colour alone). */
const MIX = ["bg-pw-mood-good", "bg-pw-mood-okay", "bg-pw-mood-low"] as const;
const FOCUS =
  "focus-visible:outline-pw-focus focus-visible:outline-2 focus-visible:outline-offset-2";

/**
 * "How are you today?" on Today's navy band: three faces, then the week, the month or the year in place (the
 * phone's mood screen, without leaving Today). A not-well day offers Book a visit; Help is in the header. A save
 * that fails says so; a save that lands says nothing (as the phone).
 */
export function MoodCard(p: {
  today: DayMood | null;
  week: Mood[];
  /** `getDay()` of each of the week's days, oldest first. */
  weekdays: number[];
  month: Mood[];
  /** `getDay()` of the 1st of this month. */
  monthStart: number;
  year: ([number, number, number] | null)[];
  chat: boolean;
  /** "band" sits on Today's navy band (desktop); "page" is the phone's: the question as the page's headline,
   * big face tiles and the views in their own card. The page tone maps the band tokens onto the page's. */
  tone?: "band" | "page";
}) {
  const page = p.tone === "page";
  const id = useId();
  const [picked, setPicked] = useState<DayMood | null>(null);
  const [view, setView] = useState<View>("week");
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const shown = picked ?? p.today;
  // Today's face is the last day of the week and the month as soon as it is picked.
  const withToday = (days: Mood[]) => (shown ? [...days.slice(0, -1), shown] : days);
  const week = withToday(p.week);
  const month = withToday(p.month);
  const count = view === "week" ? countMoods(week) : countMoods(month);

  const pick = (m: DayMood) => {
    setPicked(m);
    start(async () => {
      const r = await saveMoodAction(m);
      if (!r.ok) {
        setPicked(null);
        setError(r.error);
      }
    });
  };

  const seg = (
    <div
      role="group"
      aria-label={M.viewsLabel}
      className="bg-pw-band-glass flex rounded-full p-0.5"
    >
      {VIEWS.map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          onClick={() => setView(v)}
          className={cn(
            "min-h-8 rounded-full px-3 text-[12px] font-semibold transition-colors duration-150",
            FOCUS,
            view === v ? "bg-pw-on-band text-pw-band" : "text-pw-on-band-2 hover:text-pw-on-band",
          )}
        >
          {M.views[v]}
        </button>
      ))}
    </div>
  );

  return (
    <section
      aria-labelledby={id}
      className={cn(
        "text-pw-on-band [&_.pw-mood-none]:stroke-pw-on-band/40 flex min-w-0 flex-col gap-3",
        page
          ? "[--pw-band-glass:var(--pw-surface-2)] [--pw-band:var(--pw-surface)] [--pw-on-band-2:var(--pw-ink-3)] [--pw-on-band-accent:var(--pw-accent-text)] [--pw-on-band:var(--pw-ink)]"
          : "rounded-pw-card bg-pw-band-glass p-4",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h2
          id={id}
          className={
            page
              ? "text-[30px] leading-[34px] font-semibold tracking-[-0.03em]"
              : "text-[17px] leading-[22px] font-semibold"
          }
        >
          {C.moodTitle}
        </h2>
        {page ? null : seg}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {MOODS.map((m) => {
          const on = shown === m;
          return (
            <button
              key={m}
              type="button"
              aria-pressed={on}
              aria-label={C.moodPick(C.moods[m])}
              onClick={() => pick(m)}
              className={cn(
                page
                  ? "rounded-pw-card bg-pw-surface shadow-pw-card flex flex-col items-center gap-1.5 py-3 ring-2 ring-inset"
                  : "rounded-pw-row flex min-h-12 items-center justify-center gap-2 px-2 ring-1 ring-inset",
                "transition-[background-color,scale] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.97] motion-reduce:active:scale-100",
                FOCUS,
                page
                  ? on
                    ? "ring-pw-ink"
                    : "text-pw-ink-2 ring-transparent"
                  : on
                    ? "bg-pw-accent-tint text-pw-accent-text ring-pw-on-band-accent"
                    : "ring-pw-on-band/20 hover:bg-pw-band-glass",
              )}
            >
              <MoodFace mood={m} size={page ? 44 : 28} pop={on} decorative />
              <span className="text-[13px] font-semibold">{C.moods[m]}</span>
            </button>
          );
        })}
      </div>

      <div
        className={cn(
          "flex flex-col justify-between gap-2",
          page
            ? "rounded-pw-card bg-pw-surface shadow-pw-card h-[184px] p-3"
            : "border-pw-on-band/15 h-[140px] border-t pt-3",
        )}
      >
        {page ? (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-semibold">
              {view === "week" ? M.thisWeek : view === "month" ? M.thisMonth : M.byMonth}
            </span>
            {seg}
          </div>
        ) : null}
        {view === "week" ? (
          <ol className="flex flex-1 items-center justify-between">
            {week.map((mood, i) => (
              <li key={i} className="flex flex-col items-center gap-1.5">
                <MoodFace mood={mood} size={30} />
                <span className="text-pw-on-band-2 text-[11px] font-semibold">
                  {i === week.length - 1 ? M.today : WEEKDAYS[p.weekdays[i] ?? 0]}
                </span>
              </li>
            ))}
          </ol>
        ) : null}

        {view === "month" ? (
          <div className="flex flex-col gap-0.5">
            <div aria-hidden className="grid grid-cols-7">
              {WEEKDAYS.map((d, i) => (
                <span key={i} className="text-pw-on-band-2 text-center text-[10px] font-semibold">
                  {d}
                </span>
              ))}
            </div>
            <ol className="grid grid-cols-7 gap-y-0.5">
              {month.map((mood, i) => (
                <li
                  key={i}
                  className="flex justify-center"
                  style={i === 0 ? { gridColumnStart: p.monthStart + 1 } : undefined}
                >
                  <span className="sr-only">{`${i + 1}: ${M.faces[mood]}`}</span>
                  <MoodFace mood={mood} size={14} decorative />
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        {view === "year" ? (
          <ol className="grid flex-1 grid-cols-12 gap-1.5">
            {MONTHS.map((name, i) => {
              const mix = p.year[i];
              return (
                <li key={name} className="flex flex-col items-center gap-1">
                  <span className="sr-only">
                    {i >= p.year.length
                      ? name
                      : mix
                        ? M.monthMix(name, mix[0], mix[1], mix[2])
                        : M.monthNone(name)}
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      "flex w-full max-w-4 flex-1 flex-col-reverse overflow-hidden rounded-full",
                      !mix && "border-pw-on-band/25 border border-dashed",
                      i >= p.year.length && "opacity-40",
                    )}
                  >
                    {mix?.map((pct, k) => (
                      <span key={k} className={MIX[k]} style={{ flexGrow: pct }} />
                    ))}
                  </span>
                  <span aria-hidden className="text-pw-on-band-2 text-[10px] font-semibold">
                    {name[0]}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : null}

        <div className="flex min-h-6 items-center justify-between gap-2">
          {view === "year" ? (
            <span className="flex flex-wrap gap-3">
              {MOODS.map((k) => (
                <span
                  key={k}
                  className="text-pw-on-band-2 flex items-center gap-1 text-[12px] font-semibold"
                >
                  <MoodFace mood={k} size={14} decorative />
                  {M.faces[k]}
                </span>
              ))}
            </span>
          ) : (
            <span className="text-pw-on-band-2 text-[12px] font-semibold">
              {view === "week"
                ? M.weekCount(count.good, count.okay, count.low)
                : M.monthCount(count.good, count.okay, count.low)}
            </span>
          )}
          {shown === "low" ? (
            <Link
              href={p.chat ? "/patient/care/messages" : "#book"}
              className={cn(
                "text-pw-on-band-accent shrink-0 rounded-full text-[13px] font-semibold",
                FOCUS,
              )}
            >
              {p.chat ? C.tellTeam : C.bookVisit}
            </Link>
          ) : null}
        </div>
      </div>
      {error ? <Toast message={error} onClose={() => setError(null)} /> : null}
    </section>
  );
}
