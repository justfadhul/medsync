"use client";

import type { SavedReading } from "@/lib/patient-web/readings";
import type { CardDay, CardReading } from "@patient-core/care-plan";
import type { SugarContext } from "@patient-core/readings";
import { useState } from "react";
import { daysOf, readingStats } from "@patient-core/care-plan";
import { targetMarks } from "@patient-core/reading-cards";
import {
  readingValueText,
  SUGAR_CONTEXT_WORDS,
  THRESHOLDS_NOTE,
  UNITS,
} from "@patient-core/readings";

import { ReadingForm } from "@/components/tide/reading-dialog";
import { CARE_V2_COPY } from "@/content/patient-app/care";
import { cn } from "@/lib/utils";

const C = CARE_V2_COPY.readingsPage;
const T = CARE_V2_COPY.readings.titles;
type Metric = "sugar" | "bp" | "weight";
const W = 720;
const H = 240;
const PAD = { l: 40, r: 12, t: 12, b: 28 };

/**
 * The Readings page, v2 on the web (patient app v2 §5.7): tabs for sugar, blood pressure and weight; timing
 * chips for sugar; the large 30-day chart (the target band or lines from the signed rules, lines broken where
 * there is no reading, a crosshair and value bar on hover or keyboard focus); stats (average, in target,
 * latest); a plain-words note; Add a reading beside it; and every reading as a table. Every chart has its words
 * (S21). Out of target is never red (MR5); the danger rules stay in the add form (S23).
 */
export function ReadingsPageWeb({
  readings,
  recent,
  nowIso,
  initial = "sugar",
  careFlow = false,
}: {
  readings: CardReading[];
  recent: SavedReading[];
  nowIso: string;
  initial?: Metric;
  careFlow?: boolean;
}) {
  const now = new Date(nowIso);
  const [metric, setMetric] = useState<Metric>(initial);
  const [ctx, setCtx] = useState<SugarContext>("fasting");
  const [focus, setFocus] = useState<number | null>(null);
  const { days } = daysOf(readings, metric, now, 30, ctx);
  const marks = targetMarks(metric, ctx);
  const stats = readingStats(days, marks.band);
  const unit = UNITS[metric];
  const shown = focus !== null ? days[focus]! : stats.latest;
  const val = (d: CardDay | null) =>
    !d || d.value === null
      ? C.gap
      : metric === "bp"
        ? `${d.value}/${d.bottom ?? "–"}`
        : String(d.value);

  // Scale: the readings and the target marks all fit.
  const vals = days.flatMap((d) =>
    d.value === null ? [] : [d.value, ...(typeof d.bottom === "number" ? [d.bottom] : [])],
  );
  const marksVals = [
    ...(marks.band ? [marks.band.lo, marks.band.hi] : []),
    ...marks.lines.map((l) => l.value),
  ];
  const lo = Math.min(...vals, ...marksVals);
  const hi = Math.max(...vals, ...marksVals, 1);
  const min = Number.isFinite(lo) ? lo - (hi - lo) * 0.1 : 0;
  const max = hi + (hi - min) * 0.1;
  const x = (i: number) => PAD.l + (i * (W - PAD.l - PAD.r)) / (days.length - 1);
  const y = (v: number) => PAD.t + (1 - (v - min) / (max - min || 1)) * (H - PAD.t - PAD.b);
  const segments = (pick: (d: CardDay) => number | null | undefined) => {
    let path = "";
    let open = false;
    days.forEach((d, i) => {
      const v = pick(d);
      if (typeof v !== "number") {
        open = false;
        return;
      }
      path += `${open ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      open = true;
    });
    return path;
  };
  const summary = C.chartSummary
    .replace("{title}", T[metric])
    .replace("{logged}", String(stats.logged))
    .replace(
      "{average}",
      stats.average === null
        ? "—"
        : `${stats.average}${stats.averageBottom ? `/${stats.averageBottom}` : ""} ${unit}`,
    );

  const table = [...readings]
    .filter((r) => r.input.kind === metric)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 60);

  return (
    <div className="grid grid-cols-1 gap-6 min-[1100px]:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-w-0 flex-col gap-5">
        <div
          role="tablist"
          aria-label={C.tabsLabel}
          className="bg-pw-surface-2 flex gap-1 self-start rounded-full p-1"
        >
          {(["sugar", "bp", "weight"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={metric === m}
              onClick={() => {
                setMetric(m);
                setFocus(null);
              }}
              className={cn(
                "focus-visible:outline-pw-focus min-h-11 rounded-full px-4 text-[15px] font-semibold focus-visible:outline-2",
                metric === m ? "bg-pw-surface shadow-pw-card" : "text-pw-ink-2",
              )}
            >
              {T[m]}
            </button>
          ))}
        </div>

        {metric === "sugar" ? (
          <fieldset className="flex flex-wrap gap-2">
            <legend className="sr-only">{C.timing}</legend>
            {(Object.keys(SUGAR_CONTEXT_WORDS) as SugarContext[]).map((c) => (
              <label
                key={c}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center rounded-full px-3.5 text-[14px] ring-[1.5px] ring-inset",
                  ctx === c ? "bg-pw-accent-tint ring-pw-accent font-semibold" : "ring-pw-line",
                )}
              >
                <input
                  type="radio"
                  name="sugar-ctx"
                  className="sr-only"
                  checked={ctx === c}
                  onChange={() => setCtx(c)}
                />
                {SUGAR_CONTEXT_WORDS[c]}
              </label>
            ))}
          </fieldset>
        ) : null}

        <section
          className="rounded-pw-card bg-pw-surface shadow-pw-card flex flex-col gap-3 p-5"
          aria-label={T[metric]}
        >
          <div className="flex flex-wrap items-baseline gap-x-3" aria-live="polite">
            <span className="text-[34px] leading-none font-semibold tabular-nums">
              {val(shown)}
            </span>
            <span className="text-pw-ink-2 text-[15px]">{unit}</span>
            <span className="text-pw-ink-3 ms-auto text-[13px]">{shown?.date ?? C.days}</span>
          </div>
          <div className="relative">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="h-auto w-full"
              role="img"
              aria-label={summary}
            >
              {[0.25, 0.5, 0.75].map((f) => (
                <line
                  key={f}
                  x1={PAD.l}
                  x2={W - PAD.r}
                  y1={PAD.t + f * (H - PAD.t - PAD.b)}
                  y2={PAD.t + f * (H - PAD.t - PAD.b)}
                  className="stroke-pw-line"
                  strokeWidth={1}
                />
              ))}
              {marks.band ? (
                <rect
                  x={PAD.l}
                  width={W - PAD.l - PAD.r}
                  y={y(marks.band.hi)}
                  height={Math.max(0, y(marks.band.lo) - y(marks.band.hi))}
                  className="fill-pw-accent-tint"
                />
              ) : null}
              {marks.lines.map((l) => (
                <g key={l.label}>
                  <line
                    x1={PAD.l}
                    x2={W - PAD.r}
                    y1={y(l.value)}
                    y2={y(l.value)}
                    className="stroke-pw-ink-3"
                    strokeDasharray={l.dashed ? "6 4" : undefined}
                    strokeWidth={1.5}
                  />
                  <text
                    x={W - PAD.r}
                    y={y(l.value) - 4}
                    textAnchor="end"
                    className="fill-pw-ink-3 text-[11px]"
                  >
                    {l.label}
                  </text>
                </g>
              ))}
              <path
                d={segments((d) => d.value)}
                className="stroke-pw-accent"
                fill="none"
                strokeWidth={2.5}
                strokeLinejoin="round"
              />
              {metric === "bp" ? (
                <path
                  d={segments((d) => d.bottom)}
                  className="stroke-pw-ink-2"
                  fill="none"
                  strokeWidth={2}
                  strokeLinejoin="round"
                />
              ) : null}
              {days.map((d, i) =>
                d.value === null ? null : (
                  <circle
                    key={d.dayKey}
                    cx={x(i)}
                    cy={y(d.value)}
                    r={3.5}
                    className="fill-pw-accent"
                  />
                ),
              )}
              {focus !== null ? (
                <line
                  x1={x(focus)}
                  x2={x(focus)}
                  y1={PAD.t}
                  y2={H - PAD.b}
                  className="stroke-pw-ink"
                  strokeWidth={1}
                />
              ) : null}
              <text x={PAD.l} y={H - 8} className="fill-pw-ink-3 text-[12px]">
                {days[0]!.date}
              </text>
              <text x={W - PAD.r} y={H - 8} textAnchor="end" className="fill-pw-ink-3 text-[12px]">
                {CARE_V2_COPY.readings.today}
              </text>
            </svg>
            <div
              className="absolute inset-0 flex"
              style={{
                paddingLeft: `${(PAD.l / W) * 100}%`,
                paddingRight: `${(PAD.r / W) * 100}%`,
              }}
            >
              {days.map((d, i) => (
                <button
                  key={d.dayKey}
                  type="button"
                  aria-label={`${d.date}: ${d.value === null ? C.gap : `${val(d)} ${unit}`}`}
                  onMouseEnter={() => setFocus(i)}
                  onMouseLeave={() => setFocus(null)}
                  onFocus={() => setFocus(i)}
                  onBlur={() => setFocus(null)}
                  className="focus-visible:outline-pw-focus h-full flex-1 focus-visible:outline-2"
                />
              ))}
            </div>
          </div>
          <dl className="border-pw-line grid grid-cols-3 gap-3 border-t pt-3">
            <div>
              <dt className="text-pw-ink-3 text-[12px] font-semibold">{C.average}</dt>
              <dd className="text-[17px] font-semibold tabular-nums">
                {stats.average === null
                  ? "—"
                  : `${stats.average}${stats.averageBottom ? `/${stats.averageBottom}` : ""}`}
              </dd>
            </div>
            <div>
              <dt className="text-pw-ink-3 text-[12px] font-semibold">{C.inTarget}</dt>
              <dd className="text-[17px] font-semibold tabular-nums">
                {stats.inTarget === null
                  ? "—"
                  : C.inTargetValue
                      .replace("{n}", String(stats.inTarget))
                      .replace("{logged}", String(stats.logged))}
              </dd>
            </div>
            <div>
              <dt className="text-pw-ink-3 text-[12px] font-semibold">{C.latest}</dt>
              <dd className="text-[17px] font-semibold tabular-nums">
                {stats.latest ? `${val(stats.latest)} · ${stats.latest.date}` : "—"}
              </dd>
            </div>
          </dl>
          <p className="text-pw-ink-2 text-[14px]">
            {stats.logged === 0
              ? C.none
              : stats.inTarget === null
                ? C.noteNoBand.replace("{logged}", String(stats.logged))
                : C.note
                    .replace("{n}", String(stats.inTarget))
                    .replace("{logged}", String(stats.logged))}
          </p>
          <p className="text-pw-ink-3 text-[12px]">{THRESHOLDS_NOTE}</p>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="readings-table">
          <h2 id="readings-table" className="text-[20px] font-semibold">
            {C.table}
          </h2>
          {table.length === 0 ? (
            <p className="text-pw-ink-2 text-[15px]">{C.none}</p>
          ) : (
            <div className="rounded-pw-card bg-pw-surface shadow-pw-card overflow-x-auto">
              <table className="w-full text-left text-[14px]">
                <thead className="text-pw-ink-3 text-[12px]">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      {C.tableDate}
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      {C.tableValue}
                    </th>
                    {metric === "sugar" ? (
                      <th scope="col" className="px-4 py-2.5 font-semibold">
                        {C.tableTiming}
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="divide-pw-line divide-y">
                  {table.map((r) => (
                    <tr key={r.at}>
                      <td className="px-4 py-2.5 tabular-nums">
                        {new Date(new Date(r.at).getTime() + 3 * 3600_000)
                          .toISOString()
                          .slice(0, 16)
                          .replace("T", " ")}
                      </td>
                      <td className="px-4 py-2.5 font-semibold tabular-nums">
                        {readingValueText(r.input as never)}
                      </td>
                      {metric === "sugar" ? (
                        <td className="text-pw-ink-2 px-4 py-2.5">
                          {SUGAR_CONTEXT_WORDS[(r.input as { context: SugarContext }).context] ??
                            ""}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <aside
        className="rounded-pw-card bg-pw-surface shadow-pw-card flex flex-col gap-3 self-start p-5"
        aria-label={C.add}
      >
        <h2 className="text-[20px] font-semibold">{C.add}</h2>
        <ReadingForm key={metric} initialKind={metric} recent={recent} careFlow={careFlow} />
      </aside>
    </div>
  );
}
