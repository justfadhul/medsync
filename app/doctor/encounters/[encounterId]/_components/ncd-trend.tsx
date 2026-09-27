"use client";

import type { ResultBand } from "@/lib/ncd/catalog/schema";
import type { Interpretation } from "@/lib/ncd/engine/assess";
import { useMemo, useState } from "react";
import { ActivityIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { bandFor } from "@/lib/ncd/catalog/schema";

/**
 * One vital over time, read the way a chart is actually read.
 *
 * ── Switch, do not overlay ───────────────────────────────────────────────────
 * An earlier version let several vitals share the plot, each scaled to its own
 * range. It was wrong: a saturation lives at 95 and a systolic at 150, so either
 * one axis flattens the other into a straight line, or both are normalised and
 * the y-position stops meaning anything — a chart whose height is not a quantity
 * is a picture of a chart.
 *
 * So the vitals are a SWITCHER. One at a time, on its own true axis, with its
 * own scale. Comparing two of them is a question about shape, and the honest way
 * to answer it is to look at one and then the other.
 *
 * ── Every reading is judged on its own ───────────────────────────────────────
 * The LINE carries the current verdict, because that is what the headline number
 * beside it says. Each DOT carries its own — a respiratory rate that was 22 four
 * hours ago was tachypnoeic then, and colouring that point by what the patient
 * happens to be now would quietly erase the episode the chart exists to show.
 * Out-of-range points also get a ring, so the state survives being printed in
 * grey or read by someone who does not separate green from orange.
 *
 * ── The line is not evidence ─────────────────────────────────────────────────
 * Between two dots there is no measurement, only interpolation. Usually that is
 * a fair reading of a patient watched every half hour; across a six-hour gap it
 * is a claim nobody made. Those segments are dashed, and the chart says so.
 */

const ms = (iso: string) => new Date(iso).getTime();
const clock = (iso: string) => new Date(iso).toTimeString().slice(0, 5);
const day = (iso: string) => new Date(iso).toDateString().slice(4, 10);

/** Enough of the name to tell the vitals apart in a row of buttons. */
const short = (display: string) =>
  display
    .replace("Blood pressure — ", "")
    .replace("Oxygen saturation", "SpO₂")
    .replace("Respiratory rate", "Resp. rate")
    .replace("Temperature", "Temp.")
    .replace(/^./, (c) => c.toUpperCase());

/** Round axis labels a reader can hold in their head — 5s, 10s, 25s, never 7.3s. */
function ticks(lo: number, hi: number, count = 4): number[] {
  const raw = (hi - lo) / count || 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const start = Math.floor(lo / step) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + step / 2; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

const median = (ns: number[]): number => {
  const s = [...ns].sort((a, b) => a - b);
  const mid = s.length >> 1;
  const v = s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
  return Math.round(v * 10) / 10;
};

/** "18 min", "4 h 12 min", "2 d 3 h" — how long the chart is actually looking at. */
function humanSpan(span: number): string {
  const mins = Math.round(span / 60000);
  if (mins < 1) return "under a minute";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `${h} h ${m} min` : `${h} h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d} d ${rh} h` : `${d} d`;
}

const LINE: Record<string, string> = {
  brand: "stroke-brand-500",
  emerald: "stroke-emerald-500",
  amber: "stroke-amber-500",
  orange: "stroke-orange-500",
  red: "stroke-red-500",
  grey: "stroke-gray-400",
};
const DOT: Record<string, string> = {
  brand: "fill-brand-500",
  emerald: "fill-emerald-500",
  amber: "fill-amber-500",
  orange: "fill-orange-500",
  red: "fill-red-500",
  grey: "fill-gray-400",
};
const CHIP: Record<string, string> = {
  brand: "bg-brand-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  orange: "bg-orange-500",
  red: "bg-red-500",
  grey: "bg-gray-400",
};
const STOP: Record<string, string> = {
  brand: "text-brand-500",
  emerald: "text-emerald-500",
  amber: "text-amber-500",
  orange: "text-orange-500",
  red: "text-red-500",
  grey: "text-gray-400",
};

export function NcdTrend({
  row,
  siblings,
  colorOf,
}: {
  row: Interpretation;
  /** Every tracked measure, offered in the switcher. */
  siblings: Interpretation[];
  colorOf: (band: ResultBand | undefined) => string;
}) {
  const [open, setOpen] = useState(false);
  const [showing, setShowing] = useState(row.feature);
  const [hover, setHover] = useState<number | undefined>(undefined);

  const tracked = useMemo(() => {
    const all = [row, ...siblings.filter((s) => s.feature !== row.feature)];
    return all.filter((s) => (s.series?.length ?? 0) > 1);
  }, [row, siblings]);

  const active = tracked.find((s) => s.feature === showing) ?? row;
  const series = useMemo(
    () => [...(active.series ?? [])].sort((a, b) => a.at.localeCompare(b.at)),
    [active],
  );

  if ((row.series?.length ?? 0) < 2) return null;

  const values = series.map((r) => r.value);
  const edges = active.bands
    .flatMap((b) => [b.from, b.to])
    .filter((n): n is number => n !== undefined);
  const dataLo = Math.min(...values);
  const dataHi = Math.max(...values);
  const pad = (dataHi - dataLo) * 0.25 || Math.max(dataHi * 0.08, 2);
  // Band edges just outside the data are pulled in, so "how far from normal" is
  // visible — but a band 60 units away is not allowed to squash the line flat.
  const near = edges.filter((e) => e >= dataLo - pad * 2 && e <= dataHi + pad * 2);
  const lo = Math.min(dataLo - pad, ...near);
  const hi = Math.max(dataHi + pad, ...near);

  const W = 820;
  const H = 300;
  const L = 66;
  const R = 22;
  const TOP = 18;
  const BOT = 56;
  const t0 = ms(series[0]!.at);
  const t1 = ms(series[series.length - 1]!.at);
  const x = (at: number) => L + (t1 === t0 ? 0.5 : (at - t0) / (t1 - t0)) * (W - L - R);
  const y = (v: number) => H - BOT - ((v - lo) / (hi - lo || 1)) * (H - BOT - TOP);

  const color = colorOf(active.band);
  const first = series[0]!;
  const last = series[series.length - 1]!;
  const normal = active.bands.find((b) => b.tone === "normal");

  /** Each reading judged against the same scale the row is read on. */
  const bandAt = (v: number) => bandFor(active.bands, v);
  const offScale = (v: number) => {
    const b = bandAt(v);
    return b !== undefined && b.tone !== "normal";
  };

  // Five identical dates down the x-axis say nothing; the date moves to the
  // axis title and the ticks show only the clock.
  const sameDay = day(first.at) === day(last.at);
  const xLabel = (at: number) => {
    const iso = new Date(at).toISOString();
    return sameDay ? clock(iso) : `${day(iso)} ${clock(iso)}`;
  };
  const delta = Math.round((last.value - first.value) * 10) / 10;
  const pct = first.value === 0 ? 0 : Math.round(((last.value - first.value) / first.value) * 100);

  // A stretch with no reading in it is not a flat patient, it is an unwatched
  // one. Needs enough intervals to have a normal to depart from.
  const gaps = series.slice(1).map((r, i) => ms(r.at) - ms(series[i]!.at));
  const typical = gaps.length ? median(gaps) : 0;
  const unwatched = (g: number) =>
    gaps.length >= 3 && typical > 0 && g > typical * 3 && g > 30 * 60_000;
  const anyUnwatched = gaps.some(unwatched);

  /** How many readings sat in each band — the episode, counted, in words. */
  const spread = (() => {
    const by = new Map<string, { display: string; color: string; n: number }>();
    for (const r of series) {
      const b = bandAt(r.value);
      const key = b?.code ?? "—";
      const held = by.get(key) ?? {
        display: b?.display ?? "Not classified",
        color: colorOf(b),
        n: 0,
      };
      held.n += 1;
      by.set(key, held);
    }
    return [...by.values()].sort((a, b) => b.n - a.n);
  })();

  const hovered = hover !== undefined ? series.find((r) => ms(r.at) === hover) : undefined;
  const hoveredIndex = hovered ? series.indexOf(hovered) : -1;
  const prev = hoveredIndex > 0 ? series[hoveredIndex - 1] : undefined;
  const hoveredBand = hovered ? bandAt(hovered.value) : undefined;
  const hoverPct = hovered ? x(ms(hovered.at)) / W : 0;

  /** Arrow keys walk the readings, so the crosshair is not mouse-only. */
  const step = (dir: number) => {
    const from = hoveredIndex >= 0 ? hoveredIndex : series.length - 1;
    const next = Math.min(series.length - 1, Math.max(0, from + dir));
    setHover(ms(series[next]!.at));
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setShowing(row.feature);
          setOpen(true);
        }}
        className="tap text-caption text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-950/40 mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium"
      >
        <TrendingUpIcon className="size-3" aria-hidden />
        See trend
        <span className="text-muted-foreground tabular-nums">({row.series!.length})</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] w-[min(94vw,54rem)] max-w-none overflow-y-auto sm:max-w-none">
          <DialogHeader className="sr-only">
            <DialogTitle>{active.display} — trend</DialogTitle>
          </DialogHeader>

          {/* Title, and the switcher — one axis at a time, never two. */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <span className="flex items-center gap-2">
              <span className="bg-iris-tint text-iris-icon grid size-7 shrink-0 place-items-center rounded-lg">
                <ActivityIcon className="size-4" aria-hidden />
              </span>
              <span className="text-foreground text-body-l font-medium">{active.display}</span>
            </span>

            {tracked.length > 1 ? (
              <div className="bg-muted flex flex-wrap items-center gap-0.5 rounded-lg p-0.5">
                {tracked.map((s) => (
                  <button
                    key={s.feature}
                    type="button"
                    aria-pressed={s.feature === showing}
                    onClick={() => {
                      setShowing(s.feature);
                      setHover(undefined);
                    }}
                    className={`tap text-caption ease-expo-out rounded-md px-2.5 py-1 font-medium transition-colors duration-100 ${
                      s.feature === showing
                        ? "bg-card text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {short(s.display)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* Where it is now, how far it has moved, and what that means. */}
          <div className="mt-1 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-foreground text-display-m leading-none tabular-nums">
                {last.value}
              </span>
              <span className="flex flex-col">
                <span className="text-muted-foreground text-caption">
                  {active.unit} · latest at {clock(last.at)}
                </span>
                {/* Direction, not judgement: a rising saturation is good news. */}
                <span
                  className={`text-caption mt-0.5 inline-flex w-fit items-center gap-1 rounded px-1.5 py-0.5 font-medium tabular-nums ${
                    delta === 0 ? "bg-muted text-muted-foreground" : "bg-muted text-foreground"
                  }`}
                >
                  {delta > 0 ? (
                    <TrendingUpIcon className="size-3" aria-hidden />
                  ) : delta < 0 ? (
                    <TrendingDownIcon className="size-3" aria-hidden />
                  ) : null}
                  {delta > 0 ? "+" : ""}
                  {delta} ({pct > 0 ? "+" : ""}
                  {pct}%) since {clock(first.at)}
                </span>
              </span>
            </div>

            <span className="flex flex-wrap items-center gap-1.5">
              <span aria-hidden className={`h-0.5 w-4 rounded-full ${CHIP[color]}`} />
              <span className="text-caption text-foreground font-medium">Now</span>
              {active.band ? (
                <span className="text-caption text-muted-foreground">· {active.band.display}</span>
              ) : null}
              {normal && normal.from !== undefined && normal.to !== undefined ? (
                <span className="text-caption text-muted-foreground border-border ml-1 rounded border border-dashed px-1.5 py-0.5 tabular-nums">
                  Normal {normal.from}–{normal.to}
                </span>
              ) : null}
            </span>
          </div>

          {/*
           * What the chart cannot say in a shape: the extremes, the middle, and
           * how long a window this actually is. A trace that looks alarming over
           * eight hours and one that looks alarming over eight minutes are not
           * the same finding, and the picture is identical.
           */}
          <dl className="border-border/60 text-caption grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border px-3 py-2 sm:grid-cols-4">
            {[
              { k: "Readings", v: String(series.length) },
              { k: "Range", v: `${dataLo} – ${dataHi}` },
              { k: "Median", v: String(median(values)) },
              { k: "Over", v: t1 === t0 ? "one moment" : humanSpan(t1 - t0) },
            ].map((s) => (
              <div key={s.k} className="min-w-0">
                <dt className="text-muted-foreground">{s.k}</dt>
                <dd className="text-foreground mt-0.5 font-medium tabular-nums">{s.v}</dd>
              </div>
            ))}
          </dl>

          {/* Which bands the readings actually fell in — colour with its word
              attached, so the distribution survives being read in grey. */}
          {spread.length > 1 ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {spread.map((s) => (
                <span key={s.display} className="text-caption flex items-center gap-1.5">
                  <span aria-hidden className={`size-2 rounded-full ${CHIP[s.color]}`} />
                  <span className="text-foreground font-medium tabular-nums">{s.n}</span>
                  <span className="text-muted-foreground">{s.display}</span>
                </span>
              ))}
            </div>
          ) : null}

          {/* The chart, and the tooltip that floats at the reading. */}
          <div className="relative">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="focus-visible:ring-ring h-auto w-full cursor-crosshair rounded-lg outline-none focus-visible:ring-2"
              role="img"
              tabIndex={0}
              aria-label={`${active.display} in ${active.unit ?? "no unit"}, ${series.length} readings over ${humanSpan(t1 - t0)}: ${series.map((r) => `${r.value} at ${day(r.at)} ${clock(r.at)}, ${bandAt(r.value)?.display ?? "not classified"}`).join("; ")}`}
              onBlur={() => setHover(undefined)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") {
                  e.preventDefault();
                  step(1);
                } else if (e.key === "ArrowLeft") {
                  e.preventDefault();
                  step(-1);
                } else if (e.key === "Home") {
                  e.preventDefault();
                  setHover(ms(first.at));
                } else if (e.key === "End") {
                  e.preventDefault();
                  setHover(ms(last.at));
                } else if (e.key === "Escape" && hover !== undefined) {
                  // Clears the crosshair without also closing the dialog.
                  e.stopPropagation();
                  setHover(undefined);
                }
              }}
              onMouseLeave={() => setHover(undefined)}
              onMouseMove={(e) => {
                const box = e.currentTarget.getBoundingClientRect();
                const px = ((e.clientX - box.left) / box.width) * W;
                const at = t0 + ((px - L) / (W - L - R)) * (t1 - t0);
                const nearest = series.reduce((a, b) =>
                  Math.abs(ms(b.at) - at) < Math.abs(ms(a.at) - at) ? b : a,
                );
                setHover(ms(nearest.at));
              }}
            >
              {/*
               * No coloured wash behind the line.
               *
               * Four tinted bands stacked up the plot turned the chart into a
               * background with a line on it, and their colours competed with
               * the line’s — which is the one colour here that carries a
               * verdict. The normal range is still drawn, because “how far out
               * is this” is what the chart is for, as two grey hairlines with
               * the numbers spelled out in the legend.
               */}
              {normal ? (
                <g className="stroke-muted-foreground/35">
                  {[normal.from, normal.to].map((v) =>
                    v === undefined || v <= lo || v >= hi ? null : (
                      <line key={v} x1={L} x2={W - R} y1={y(v)} y2={y(v)} strokeDasharray="2 5" />
                    ),
                  )}
                </g>
              ) : null}

              {ticks(lo, hi).map((v) => (
                <g key={v}>
                  <line
                    x1={L}
                    x2={W - R}
                    y1={y(v)}
                    y2={y(v)}
                    className="stroke-border"
                    strokeDasharray="4 5"
                  />
                  <line x1={L - 5} x2={L} y1={y(v)} y2={y(v)} className="stroke-border" />
                  <text
                    x={L - 10}
                    y={y(v) + 4}
                    textAnchor="end"
                    className="fill-current opacity-55"
                    style={{ fontSize: 13 }}
                  >
                    {v}
                  </text>
                </g>
              ))}

              {/* Time gridlines, so a rise can be placed against the clock
                  without tracking a finger down to the axis. */}
              {[0.25, 0.5, 0.75].map((f) => (
                <line
                  key={f}
                  x1={x(t0 + f * (t1 - t0))}
                  x2={x(t0 + f * (t1 - t0))}
                  y1={TOP}
                  y2={H - BOT}
                  className="stroke-border/50"
                  strokeDasharray="3 7"
                />
              ))}

              {/* The axes themselves — without them the ticks are floating text. */}
              <line x1={L} x2={L} y1={TOP} y2={H - BOT} className="stroke-border" />
              <line x1={L} x2={W - R} y1={H - BOT} y2={H - BOT} className="stroke-border" />

              {/* What each axis is measuring, said out loud. */}
              <text
                transform={`rotate(-90 16 ${(TOP + H - BOT) / 2})`}
                x={16}
                y={(TOP + H - BOT) / 2 + 4}
                textAnchor="middle"
                className="fill-current font-medium opacity-70"
                style={{ fontSize: 13 }}
              >
                {active.display}
                {active.unit ? ` (${active.unit})` : ""}
              </text>
              <text
                x={(L + W - R) / 2}
                y={H - 8}
                textAnchor="middle"
                className="fill-current font-medium opacity-70"
                style={{ fontSize: 13 }}
              >
                {sameDay ? `Time · ${day(first.at)}` : "Time"}
              </text>

              {[0, 0.25, 0.5, 0.75, 1].map((f, i, all) => {
                const at = t0 + f * (t1 - t0);
                return (
                  <g key={i}>
                    <line
                      x1={x(at)}
                      x2={x(at)}
                      y1={H - BOT}
                      y2={H - BOT + 5}
                      className="stroke-border"
                    />
                    <text
                      x={x(at)}
                      y={H - BOT + 20}
                      textAnchor={i === 0 ? "start" : i === all.length - 1 ? "end" : "middle"}
                      className="fill-current opacity-55"
                      style={{ fontSize: 12 }}
                    >
                      {xLabel(at)}
                    </text>
                  </g>
                );
              })}

              <defs>
                <linearGradient id={`fill-${active.feature}`} x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="currentColor"
                    stopOpacity={0.16}
                    className={STOP[color]}
                  />
                  <stop
                    offset="100%"
                    stopColor="currentColor"
                    stopOpacity={0}
                    className={STOP[color]}
                  />
                </linearGradient>
              </defs>

              <path
                d={`${series.map((r, i) => `${i === 0 ? "M" : "L"}${x(ms(r.at))},${y(r.value)}`).join(" ")} L${x(t1)},${H - BOT} L${x(t0)},${H - BOT} Z`}
                fill={`url(#fill-${active.feature})`}
              />

              {/* Drawn segment by segment so an unobserved stretch can be dashed
                  — the interpolation is ours, not the patient's. */}
              {series.slice(1).map((r, i) => {
                const from = series[i]!;
                return (
                  <line
                    key={`seg-${r.at}-${i}`}
                    x1={x(ms(from.at))}
                    y1={y(from.value)}
                    x2={x(ms(r.at))}
                    y2={y(r.value)}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeDasharray={unwatched(gaps[i]!) ? "5 6" : undefined}
                    className={LINE[color]}
                  />
                );
              })}

              {hovered ? (
                <g className="stroke-muted-foreground/45" strokeDasharray="3 4">
                  <line x1={x(ms(hovered.at))} x2={x(ms(hovered.at))} y1={TOP} y2={H - BOT} />
                  <line x1={L} x2={x(ms(hovered.at))} y1={y(hovered.value)} y2={y(hovered.value)} />
                </g>
              ) : null}

              {/* A dot at every reading, coloured by ITS OWN band — and ringed
                  when it is off the scale, so the state is not colour alone. */}
              {series.map((r) => {
                const on = hover === ms(r.at);
                const out = offScale(r.value);
                return (
                  <g key={r.at}>
                    {out ? (
                      <circle
                        cx={x(ms(r.at))}
                        cy={y(r.value)}
                        r={on ? 8 : 6.5}
                        fill="none"
                        strokeWidth={1.25}
                        className={`${LINE[colorOf(bandAt(r.value))]} opacity-60`}
                      />
                    ) : null}
                    <circle
                      cx={x(ms(r.at))}
                      cy={y(r.value)}
                      r={on ? 5.5 : r === last ? 4 : 3}
                      strokeWidth={on || r === last ? 2.25 : 0}
                      className={`${DOT[colorOf(bandAt(r.value))]} stroke-white dark:stroke-gray-900`}
                    />
                  </g>
                );
              })}

              {/* The hovered value, printed on the axis it is being read against. */}
              {hovered ? (
                <g>
                  <rect
                    x={2}
                    y={y(hovered.value) - 9}
                    width={L - 8}
                    height={18}
                    rx={4}
                    className="fill-foreground"
                  />
                  <text
                    x={L - 10}
                    y={y(hovered.value) + 4}
                    textAnchor="end"
                    className="fill-background font-medium"
                    style={{ fontSize: 12 }}
                  >
                    {hovered.value}
                  </text>
                </g>
              ) : null}
            </svg>

            {/*
             * The number where the eye already is. A dot, not a bar — the rule
             * down the side of the reference tooltip is the one thing this
             * project's design system rules out.
             */}
            {hovered ? (
              <div
                className="border-border bg-card pointer-events-none absolute top-4 z-10 rounded-lg border px-3 py-2 shadow-lg"
                style={
                  hoverPct > 0.62
                    ? { right: `${(1 - hoverPct) * 100 + 1.5}%` }
                    : { left: `${hoverPct * 100 + 1.5}%` }
                }
              >
                <p className="text-foreground text-caption font-medium">
                  {day(hovered.at)}{" "}
                  <span className="text-muted-foreground font-normal">{clock(hovered.at)}</span>
                  {prev ? (
                    <span className="text-muted-foreground font-normal">
                      {" "}
                      · {humanSpan(ms(hovered.at) - ms(prev.at))} after the last
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 flex items-baseline gap-2">
                  <span
                    aria-hidden
                    className={`size-2 shrink-0 self-center rounded-full ${CHIP[colorOf(hoveredBand)]}`}
                  />
                  <span className="text-foreground font-mono text-[17px] font-medium tabular-nums">
                    {hovered.value}
                  </span>
                  <span className="text-muted-foreground text-[11px]">{active.unit}</span>
                  {prev ? (
                    <span className="text-caption text-muted-foreground font-medium tabular-nums">
                      {hovered.value - prev.value > 0 ? "+" : ""}
                      {Math.round((hovered.value - prev.value) * 10) / 10}
                    </span>
                  ) : null}
                </p>
                {hoveredBand ? (
                  <p className="text-caption text-muted-foreground mt-0.5 pl-4">
                    {hoveredBand.display}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Two things the plot is quietly assuming, said rather than implied. */}
          <p className="text-caption text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
            {anyUnwatched ? (
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="border-muted-foreground/60 w-4 border-t border-dashed"
                />
                dashed where nothing was measured for a while
              </span>
            ) : null}
            <span className="ml-auto">← → to step through readings</span>
          </p>

          {/* Exact, because a chart is an impression and a record is not — and
              because a screen reader gets nothing from an SVG path. */}
          <details className="border-border/60 rounded-lg border">
            <summary className="text-caption text-muted-foreground hover:text-foreground cursor-pointer px-2.5 py-1.5">
              All {series.length} readings
            </summary>
            <ul className="divide-border/50 max-h-40 divide-y overflow-y-auto border-t">
              {[...series].reverse().map((r, i) => {
                const b = bandAt(r.value);
                return (
                  <li
                    key={`${r.at}-${i}`}
                    onMouseEnter={() => setHover(ms(r.at))}
                    onMouseLeave={() => setHover(undefined)}
                    className={`ease-expo-out flex items-baseline gap-2 px-2.5 py-1.5 text-[11.5px] transition-colors duration-100 ${
                      hover === ms(r.at) ? "bg-muted" : ""
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`size-1.5 shrink-0 self-center rounded-full ${CHIP[colorOf(b)]}`}
                    />
                    <span className="text-foreground w-[3.5rem] shrink-0 font-mono font-medium tabular-nums">
                      {r.value}
                    </span>
                    <span className="text-muted-foreground shrink-0 font-mono tabular-nums">
                      {day(r.at)} {clock(r.at)}
                    </span>
                    <span className="text-muted-foreground ml-auto">{b?.display ?? "—"}</span>
                  </li>
                );
              })}
            </ul>
          </details>
        </DialogContent>
      </Dialog>
    </>
  );
}
