"use client";

import type { BandColor, ResultBand } from "@/lib/ncd/catalog/schema";
import type { Interpretation } from "@/lib/ncd/engine/assess";
import type { CaptureReading } from "@/lib/ncd/engine/evaluate";
import type { ReactNode } from "react";
import { AlertTriangleIcon } from "lucide-react";

/**
 * The glycaemic tests, captured INSIDE the scale that reads them.
 *
 * The input used to sit in a card above this table, which asked the clinician to
 * type a number in one place and find out what it meant in another. Now each row
 * IS the test: name, input, and the three bands it could fall in, on one line of
 * sight. Entering 7.4 and watching the right-hand cell light up is the whole
 * interaction.
 *
 * Styling stays plain on purpose: this is a dense clinical surface, and the
 * table earns its place by being readable rather than by being decorated.
 *
 * ── The colours are the clinical lead's call ─────────────────────────────────
 * Red for the diabetes range, brand for normal, green for the intermediate band.
 * Two of those cut against convention — green usually means all-clear, and this
 * project otherwise reserves red for a genuine emergency — so it is recorded
 * here as a deliberate choice rather than left to be "corrected" later.
 *
 * What makes it safe either way is that COLOUR IS NEVER THE MESSAGE. Every
 * column carries its band name in the header, every cell prints its own numeric
 * range and label, and the occupied cell is marked with a tick and the words
 * "this patient". Read in greyscale, nothing is lost.
 *
 * ── A band is not a verdict ──────────────────────────────────────────────────
 * Stated in the footer on every render. Confirmation on a second sample and the
 * HbA1c validity caveats bear on the diagnosis and not on where a number sits,
 * so a single unconfirmed fasting glucose reads Diabetes range here while the
 * profile still reads "not yet established" — and both are true at once.
 */

import { NcdTrend } from "@/app/doctor/encounters/[encounterId]/_components/ncd-trend";

const COLUMNS = ["low", "normal", "intermediate", "diagnostic"] as const;
type Tone = (typeof COLUMNS)[number];

/**
 * The default palette. A table may override any tone: `intermediate` is
 * prediabetes on a glucose scale and a raised pulse on a vital, and those do not
 * want the same colour — one is a risk state the patient lives in, the other is
 * a number that is off right now.
 *
 * Normal is GREEN. It was the brand teal, which is the colour of every button
 * and link on the page and therefore reads as chrome rather than as a verdict —
 * a clinician scanning a column of results has to stop and decode it. Green is
 * the one thing everyone already reads as "this one is fine", and the design
 * system permits it here because the colour never travels alone: the band's
 * word sits in the same cell.
 *
 * Intermediate moves to amber accordingly. It is a risk state, not an
 * emergency, so it must not be red — and it can no longer be green.
 */
const DEFAULT_COLOR: Record<Tone, BandColor> = {
  low: "red",
  normal: "emerald",
  intermediate: "amber",
  diagnostic: "red",
};

const HEAD_BY_COLOR: Record<BandColor, string> = {
  brand: "text-brand-700 dark:text-brand-300",
  emerald: "text-emerald-700 dark:text-emerald-400",
  amber: "text-amber-700 dark:text-amber-400",
  orange: "text-orange-700 dark:text-orange-400",
  red: "text-red-700 dark:text-red-400",
  grey: "text-muted-foreground",
};

const ON_BY_COLOR: Record<BandColor, string> = {
  brand: "bg-brand-100 text-brand-900 dark:bg-brand-900/50 dark:text-brand-100",
  emerald: "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  amber: "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100",
  orange: "bg-orange-100 text-orange-900 dark:bg-orange-900/50 dark:text-orange-100",
  red: "bg-red-100 text-red-900 dark:bg-red-900/50 dark:text-red-100",
  grey: "bg-muted text-foreground",
};

const LINE_BY_COLOR: Record<BandColor, string> = {
  brand: "stroke-brand-500",
  emerald: "stroke-emerald-500",
  amber: "stroke-amber-500",
  orange: "stroke-orange-500",
  red: "stroke-red-500",
  grey: "stroke-gray-400",
};

/** The glucose vocabulary. A table meaning something else brings its own. */
const LABEL: Record<Tone, string> = {
  low: "Hypoglycaemia",
  normal: "Not diabetes",
  intermediate: "Intermediate",
  diagnostic: "Diabetes range",
};

const headings = (row: Interpretation): Record<Tone, string> => ({
  ...LABEL,
  ...(row.toneLabels ?? {}),
});

/**
 * The input's own colour, once there is a value to read. The clinician's eye is
 * on the field they just typed in, not on the row it belongs to.
 *
 * Keyed by the RESOLVED colour, not by the tone. Keyed by tone it ignored a
 * table's `toneColors`, so a pulse of 118 sat in an orange column with a
 * green number in the box.
 */
const FIELD_BY_COLOR: Record<BandColor, string> = {
  brand: "text-brand-800 dark:text-brand-200",
  emerald: "text-emerald-800 dark:text-emerald-300",
  amber: "text-amber-800 dark:text-amber-300",
  orange: "text-orange-800 dark:text-orange-300",
  red: "text-red-700 dark:text-red-400",
  grey: "text-foreground",
};

const hhmm = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toTimeString().slice(0, 5);
};

/**
 * The trend, at the size it is read at.
 *
 * Deliberately not a charting library: this is a handful of points beside a
 * number, and an axis, a legend and a tooltip layer would take more room than
 * the data. Each point carries its own value and time, so hovering says what it
 * is without any of that.
 */
function Sparkline({ series, color }: { series: CaptureReading[]; color: BandColor }) {
  if (series.length < 2) return null;
  const sorted = [...series].sort((a, b) => a.at.localeCompare(b.at));
  const values = sorted.map((r) => r.value);
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const w = 76;
  const h = 20;
  const x = (i: number) => (i / (sorted.length - 1)) * w;
  const y = (v: number) => h - ((v - min) / span) * (h - 4) - 2;

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="mt-1 shrink-0 overflow-visible"
      role="img"
      aria-label={`Trend: ${sorted.map((r) => `${r.value} at ${hhmm(r.at)}`).join(", ")}`}
    >
      <path
        d={sorted
          .map((r, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(r.value).toFixed(1)}`)
          .join(" ")}
        fill="none"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        className={LINE_BY_COLOR[color]}
      />
      {sorted.map((r, i) => (
        <circle
          key={`${r.at}-${i}`}
          cx={x(i)}
          cy={y(r.value)}
          r={i === sorted.length - 1 ? 2.4 : 1.5}
          className={`${LINE_BY_COLOR[color]} fill-current`}
        >
          <title>{`${r.value} · ${hhmm(r.at)}`}</title>
        </circle>
      ))}
    </svg>
  );
}

/** "≥ 130 and < 150 mmHg" — the rule a value fell under, said back. */
function bandRule(band: ResultBand, unit?: string): string {
  const u = unit ? ` ${unit}` : "";
  if (band.from === undefined && band.to !== undefined) return `< ${band.to}${u}`;
  if (band.from !== undefined && band.to === undefined) return `≥ ${band.from}${u}`;
  return `≥ ${band.from} and < ${band.to}${u}`;
}

/** "< 5.6", "5.6 – 7.0", "≥ 7.0" — an open end reads as open. */
function bandRange(from: number | undefined, to: number | undefined, unit?: string): string {
  const u = unit === "%" ? "%" : "";
  if (from === undefined && to !== undefined) return `< ${to}${u}`;
  if (from !== undefined && to === undefined) return `≥ ${from}${u}`;
  if (from !== undefined && to !== undefined) return `${from} – ${to}${u}`;
  return "—";
}

export function NcdInterpretation({
  rows,
  renderInput,
}: {
  rows: Interpretation[];
  /** The capture control for one test, supplied by the form that owns the values. */
  renderInput: (featureCode: string) => ReactNode;
}) {
  if (!rows.length) return null;

  /**
   * One table per VOCABULARY, not one per section.
   *
   * A blood pressure and a BMI cannot share a column headed "Diabetes range",
   * and a table whose heading means something different in each row is worse
   * than two tables. Rows are grouped by the headings they share, so the four
   * glucose tests stay one table and the examination's BMI and blood pressure
   * become two.
   */
  const groups: { key: string; head: Record<Tone, string>; rows: Interpretation[] }[] = [];
  for (const row of rows) {
    const head = headings(row);
    const key = COLUMNS.map((t) => head[t]).join("|");
    const found = groups.find((g) => g.key === key);
    if (found) found.rows.push(row);
    else groups.push({ key, head, rows: [row] });
  }

  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => (
        <InterpretationTable
          key={g.key}
          rows={g.rows}
          head={g.head}
          /* Every tracked measure, so the trend dialog can offer the rest for
             comparison — a respiratory rate is read against the pulse beside it,
             and those two can live in different tables. */
          trending={rows.filter((r) => (r.series?.length ?? 0) > 1)}
          renderInput={renderInput}
        />
      ))}
    </div>
  );
}

function InterpretationTable({
  rows,
  head,
  trending,
  renderInput,
}: {
  rows: Interpretation[];
  head: Record<Tone, string>;
  trending: Interpretation[];
  renderInput: (featureCode: string) => ReactNode;
}) {
  /** This table's palette — its own where it declares one, the default otherwise. */
  const colorOf = (row: Interpretation, band: ResultBand | undefined): BandColor =>
    band ? (row.toneColors?.[band.tone] ?? DEFAULT_COLOR[band.tone]) : "grey";
  const first = rows[0]!;
  /**
   * Rows whose OCCUPIED BAND declares an alert — never rows whose tone happens
   * to be `low`. `low` means "below normal" on every scale, so keying off it
   * announced a respiratory rate of 10 as a hypoglycaemia.
   */
  const alerts = rows.filter((r) => r.band?.alert);
  // Only the columns this table's rows actually use — an always-empty column is
  // a question the table is not answering.
  const columns = COLUMNS.filter((t) => rows.some((r) => r.bands.some((b) => b.tone === t)));

  return (
    <section className="border-border bg-card overflow-hidden rounded-lg border shadow-xs">
      <header className="border-border/60 bg-muted/40 flex flex-wrap items-baseline gap-x-2 border-b px-3.5 py-2">
        <h4 className="text-foreground text-body-s font-medium">Interpretation</h4>
        {/* Which standard, always: the intermediate bands differ between them,
            and a table that did not say which it applied would be printing one
            body's threshold under everyone's name. */}
        <span className="text-caption text-muted-foreground">
          bands per <span className="text-foreground font-medium">{first.standard}</span>{" "}
          {first.version}
        </span>
      </header>

      {/*
       * The one moment this surface is allowed to move.
       *
       * Hypoglycaemia is the emergency on this scale: it kills faster than
       * hyperglycaemia and its treatment is the opposite, so a clinician reading
       * a glucose of 2.8 must not scan past it. The design system permits motion
       * that carries meaning and forbids it otherwise — this is the case it was
       * written for, and it is the only animation in the module.
       *
       * The pulse is reduced-motion gated at the utility, and the words carry
       * the message without it.
       */}
      {alerts.length ? (
        <div
          role="alert"
          className="flex flex-col gap-1 border-b border-red-500/30 bg-red-50 px-3.5 py-2 dark:bg-red-950/40"
        >
          {alerts.map((a) => (
            <p key={a.feature} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {/*
               * The one moment this surface moves. Hypoglycaemia kills faster
               * than hyperglycaemia and its treatment is the opposite, so a
               * glucose of 2.8 must not be scanned past. Reduced-motion gated at
               * the utility; the words carry it without the pulse.
               */}
              <span className="pulse-dot inline-flex shrink-0 items-center text-red-600 dark:text-red-400">
                <AlertTriangleIcon className="size-4" aria-hidden />
              </span>
              <span className="text-body-s font-medium text-red-900 dark:text-red-200">
                {a.band!.alert!.title}
              </span>
              <span className="text-caption text-red-800/90 dark:text-red-300/90">
                {a.display} {a.value}
                {a.unit ? ` ${a.unit}` : ""} — {a.band!.alert!.action}
              </span>
            </p>
          ))}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full table-fixed border-collapse text-left">
          <colgroup>
            <col className="w-[30%]" />
            {columns.map((c) => (
              <col key={c} />
            ))}
          </colgroup>
          <thead>
            <tr className="border-border/60 border-b">
              <th className="text-muted-foreground text-caption px-3.5 py-1.5 font-medium">Test</th>
              {columns.map((tone) => (
                <th
                  key={tone}
                  className={`text-caption px-2 py-1.5 font-medium ${
                    HEAD_BY_COLOR[rows[0]?.toneColors?.[tone] ?? DEFAULT_COLOR[tone]]
                  }`}
                >
                  {head[tone]}
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-border/50 divide-y">
            {rows.map((row) => (
              <tr key={row.feature} className="align-top">
                {/* The capture lives with its own scale, not in a card above it. */}
                <th scope="row" className="px-3.5 py-2 text-left font-normal">
                  <span className="text-body-s text-foreground block font-medium">
                    {row.display}
                  </span>
                  {/* The editor sets its own text colour, so the reading has to
                      override it — the eye is on the field just typed in, not on
                      the row it belongs to. */}
                  <span
                    className={`mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 ${
                      row.band
                        ? `${FIELD_BY_COLOR[colorOf(row, row.band)]} [&_input]:!font-medium [&_input]:!text-current`
                        : ""
                    }`}
                  >
                    {renderInput(row.feature)}
                    {row.unit ? (
                      <span className="text-muted-foreground font-mono text-[10px]">
                        {row.unit}
                      </span>
                    ) : null}
                  </span>
                  {/* The other scale, for the clinician who reads in it. */}
                  {row.value !== undefined && row.altUnit ? (
                    <span className="text-muted-foreground mt-1 block font-mono text-[10px] tabular-nums">
                      = {Math.round(row.value * row.altUnit.factor)} {row.altUnit.unit}
                    </span>
                  ) : null}
                  {row.state === "unavailable" ? (
                    <span className="text-muted-foreground/70 mt-1 block text-[10.5px] italic">
                      not available at this site
                    </span>
                  ) : null}
                  {/* Where a measure is tracked, where it is heading. */}
                  {row.series && row.series.length > 1 ? (
                    <>
                      <Sparkline series={row.series} color={colorOf(row, row.band)} />
                      <NcdTrend row={row} siblings={trending} colorOf={(b) => colorOf(row, b)} />
                    </>
                  ) : null}
                </th>

                {columns.map((tone) => {
                  const band = row.bands.find((b) => b.tone === tone);
                  const here = Boolean(band && row.band && row.band.code === band.code);
                  return (
                    <td
                      key={tone}
                      title={
                        here && band
                          ? [
                              `${row.display} ${row.value}${row.unit ? ` ${row.unit}` : ""}`,
                              row.series?.length
                                ? `measured ${hhmm(row.series[row.series.length - 1]!.at)}`
                                : undefined,
                              `rule: ${bandRule(band, row.unit)}`,
                              `${row.standard} ${row.version}`,
                            ]
                              .filter(Boolean)
                              .join(" · ")
                          : undefined
                      }
                      className={`px-2 py-2 align-middle text-[11.5px] ${
                        here
                          ? `${ON_BY_COLOR[colorOf(row, band)]} cursor-help font-medium`
                          : "text-muted-foreground"
                      }`}
                    >
                      {band ? (
                        <>
                          <span className="font-mono tabular-nums">
                            {bandRange(band.from, band.to, row.unit)}
                          </span>
                          <span className="mt-0.5 block text-[10px] leading-tight">
                            {band.display}
                          </span>
                          {/* Never colour alone. */}
                          {here ? (
                            <span className="mt-0.5 block text-[10px] font-medium">
                              ◂ this patient
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-muted-foreground/50 italic">not defined</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.some((r) => r.note) ? (
        <ul className="border-border/60 space-y-1 border-t px-3.5 py-2">
          {rows
            .filter((r) => r.note)
            .map((r) => (
              <li key={r.feature} className="text-muted-foreground text-[11px] leading-snug">
                <span className="text-foreground/80 font-medium">{r.display}:</span> {r.note}
              </li>
            ))}
        </ul>
      ) : null}

      <p className="border-border/60 text-muted-foreground border-t px-3.5 py-2 text-[11px] leading-snug">
        A band is where the number sits on a published scale. It is not a diagnosis — the profile
        weighs confirmation and test validity before it says that.
      </p>
    </section>
  );
}
