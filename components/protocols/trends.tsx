import type { Panel, VitalTile } from "@/lib/protocols/engine/types";

import {
  GraphSvg,
  GutterText,
  INK,
  labelLines,
  ValueAxis,
  ValuePath,
} from "@/components/emr/chart/graphs/frame";
import { StatusWord } from "@/components/emr/status-word";
import { CHART_COPY as C, fill } from "@/content/protocol-charts";
import { formatClock, linearScale } from "@/lib/emr/charts/scale";
import { cn } from "@/lib/utils";

/**
 * The monitoring chart's Trends card and the vitals tiles' small trends (F7–F8), laid out as the
 * prototype's: one small panel per measure on one shared time axis (never a second y-axis), the
 * version's thresholds as dashed lines with their words (kept apart when close), a dashed target,
 * a "now" line, flagged points ringed and named in the panel's sentence (never colour alone).
 * Drawn on the EMR graph frame's tokens; a panel scrolls inside its own box on a phone.
 */

/** "Start", "3 h", "1 h 30 min", "45 min": a slot index on the chart's clock. */
export function slotLabel(i: number, slotMinutes: number) {
  const m = Math.round(i * slotMinutes);
  if (slotMinutes >= 60) return fill(C.h, { h: Math.round((m / 60) * 10) / 10 });
  if (m >= 60)
    return m % 60 ? fill(C.hMin, { h: Math.floor(m / 60), m: m % 60 }) : fill(C.h, { h: m / 60 });
  return fill(C.min, { n: m });
}

const W = 560;
const PH = 92;
const AXIS = 20;
const M = { top: 10, right: 128, bottom: 8, left: 40 };

export function TrendsCard({
  panels,
  slots,
  slotMinutes,
  slotWord,
  nowSlot,
}: {
  panels: Panel[];
  slots: number;
  slotMinutes: number;
  slotWord: string;
  /** The chart's clock now, in slots (fractional). */
  nowSlot: number;
}) {
  const NS = Math.max(1, slots);
  const x = linearScale([0, NS], [M.left, W - M.right]);
  const step = NS % 4 === 0 ? NS / 4 : NS % 3 === 0 ? NS / 3 : NS / 2;
  const xticks = Array.from({ length: Math.round(NS / step) + 1 }, (_, j) => Math.round(j * step));
  const hasTarget = panels.some((p) => p.target.length > 1);
  return (
    <section
      aria-label={C.trends}
      className="bg-card shadow-card flex min-w-0 flex-col gap-2.5 rounded-2xl px-4 py-3.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <h3 className="text-heading-s text-foreground">{C.trends}</h3>
        <ul className="text-caption text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="bg-teal-icon h-0.5 w-4 rounded-full" />
            {C.measured}
          </li>
          {hasTarget ? (
            <li className="inline-flex items-center gap-1.5">
              <span aria-hidden className="border-muted-foreground w-4 border-t border-dashed" />
              {C.target}
            </li>
          ) : null}
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="bg-primary h-3 w-0.5 rounded-full" />
            {C.now}
          </li>
        </ul>
      </div>
      {panels.map((p, i) => (
        <TrendPanel
          key={p.key}
          p={p}
          x={x}
          xticks={i === panels.length - 1 ? xticks : null}
          nowX={x(Math.min(NS, Math.max(0, nowSlot)))}
          slotMinutes={slotMinutes}
          slotWord={slotWord}
        />
      ))}
    </section>
  );
}

function TrendPanel({
  p,
  x,
  xticks,
  nowX,
  slotMinutes,
  slotWord,
}: {
  p: Panel;
  x: (n: number) => number;
  /** The shared time axis's labels, under the last panel only. */
  xticks: number[] | null;
  nowX: number;
  slotMinutes: number;
  slotWord: string;
}) {
  const H = PH + (xticks ? AXIS : 0);
  const base = PH - M.bottom;
  const vs = p.points.map((q) => q.v);
  const min = Math.min(p.min, ...vs);
  const max = Math.max(p.max, ...vs);
  const y = linearScale([min, max === min ? min + 1 : max], [base, M.top]);
  const fmt = (n: number) => (max - min <= 1 ? n.toFixed(2) : String(Math.round(n * 10) / 10));
  const bad = p.points.filter((q) => q.bad);
  // Threshold words, top to bottom, at least one line apart.
  const thr = [...p.thr]
    .map((t) => ({ ...t, y: y(t.v) }))
    .sort((a, b) => a.y - b.y)
    .reduce<{ v: number; label: string; lvl: "amb" | "grn"; y: number; ly: number }[]>(
      (out, t) => [...out, { ...t, ly: Math.max(t.y, (out.at(-1)?.ly ?? -Infinity) + 14) }],
      [],
    );
  const label = p.points.length
    ? `${p.name}: ${p.points.map((q) => `${fmt(q.v)} at ${slotWord} ${q.h}`).join(", ")}${
        bad.length ? `. Out of range: ${bad.map((q) => fmt(q.v)).join(", ")}` : ""
      }.`
    : `${p.name}: ${C.noValues}.`;
  const last = p.points.at(-1);
  return (
    <figure className="flex min-w-0 flex-col gap-1">
      <figcaption className="text-body-s flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-foreground font-semibold">{p.name}</span>
        {p.unit ? <span className="text-caption text-muted-foreground">{p.unit}</span> : null}
        <span className="grow" />
        <span className="text-foreground font-mono tabular-nums">{p.latest || C.noValues}</span>
        {p.status ? (
          <StatusWord tone={p.stLvl === "no" ? "caution" : "neutral"}>{p.status}</StatusWord>
        ) : null}
      </figcaption>
      <GraphSvg label={label} height={H} width={W}>
        <ValueAxis ticks={p.ticks} y={y} x={M.left} format={fmt} />
        {p.ticks.map((t) => (
          <line
            key={t}
            x1={M.left}
            x2={W - M.right}
            y1={y(t)}
            y2={y(t)}
            className={INK.axis}
            strokeWidth={1}
          />
        ))}
        {thr.map((t) => (
          <g key={t.label}>
            <line
              x1={M.left}
              x2={W - M.right}
              y1={t.y}
              y2={t.y}
              className={t.lvl === "amb" ? INK.referenceLine : "stroke-muted-foreground"}
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
            <GutterText
              x={W - M.right + 8}
              y={t.ly}
              lines={labelLines(t.label, 20).slice(0, 1)}
              className={t.lvl === "amb" ? INK.referenceText : INK.label}
            />
          </g>
        ))}
        {p.target.length > 1 ? (
          <path
            d={p.target.map(([h, v], i) => `${i ? "L" : "M"}${x(h)},${y(v)}`).join(" ")}
            fill="none"
            className="stroke-muted-foreground"
            strokeDasharray="4 4"
            strokeWidth={1.5}
          >
            <title>{C.target}</title>
          </path>
        ) : null}
        <line
          x1={nowX}
          x2={nowX}
          y1={M.top - 4}
          y2={base + 4}
          className="stroke-primary"
          strokeWidth={2}
        >
          <title>{C.now}</title>
        </line>
        <ValuePath points={p.points.map((q) => [x(q.h), y(q.v)] as [number, number])} />
        {p.points.map((q) => (
          <g key={q.h}>
            <circle
              cx={x(q.h)}
              cy={y(q.v)}
              r={4}
              className={cn(q.bad ? "fill-status-caution-fg" : INK.nursingDot, "stroke-card")}
              strokeWidth={1.5}
            >
              <title>{`${p.name}: ${fmt(q.v)} at ${slotLabel(q.h, slotMinutes)} (${formatClock(new Date(q.at))})`}</title>
            </circle>
            {q.bad ? (
              <circle cx={x(q.h)} cy={y(q.v)} r={7} fill="none" className="stroke-foreground" />
            ) : null}
          </g>
        ))}
        {last ? (
          <text
            x={x(last.h) + 9}
            y={y(last.v) - 7}
            className="fill-foreground text-caption font-semibold"
          >
            {fmt(last.v)}
          </text>
        ) : null}
        {xticks ? (
          <g>
            <line x1={M.left} x2={W - M.right} y1={base + 6} y2={base + 6} className={INK.axis} />
            {xticks.map((t, i) => (
              <text
                key={t}
                x={x(t)}
                y={H - 4}
                textAnchor={i === 0 ? "start" : i === xticks.length - 1 ? "end" : "middle"}
                className={INK.tick}
              >
                {t === 0 ? C.start2 : slotLabel(t, slotMinutes)}
              </text>
            ))}
          </g>
        ) : null}
      </GraphSvg>
    </figure>
  );
}

const DOT = { ok: "bg-teal-icon", abn: "bg-status-caution-fg", crit: "bg-status-critical-fg" };

/**
 * A vitals tile's small trend (the prototype's mini chart): the last readings in time, the normal
 * band shaded, each reading a dot whose colour follows its clinical reading (the tile names it in
 * words), the diastolic as small grey dots, the times of the first and last reading beneath.
 */
export function MiniTrend({ t }: { t: VitalTile }) {
  if (!t.series.length) return null;
  const vals = t.series.flatMap((s) => (s.v2 != null ? [s.v, s.v2] : [s.v]));
  let lo = t.key === "gcs" ? 3 : Math.min(...vals, t.band?.[0] ?? Infinity);
  let hi = t.key === "gcs" ? 15 : Math.max(...vals, t.band?.[1] ?? -Infinity);
  if (hi === lo) {
    hi += 1;
    lo -= 1;
  }
  if (t.key !== "gcs") {
    const pad = (hi - lo) * 0.15;
    hi += pad;
    lo = Math.max(0, lo - pad);
  }
  const Y = (v: number) => (1 - (v - lo) / (hi - lo)) * 100;
  const t0 = t.series[0]!.at;
  const t1 = t.series.at(-1)!.at;
  const X = (at: number) => (t1 === t0 ? 50 : 4 + ((at - t0) / (t1 - t0)) * 92);
  const line = (k: "v" | "v2") =>
    t.series
      .filter((s) => s[k] != null)
      .map((s) => `${X(s.at)},${Y(s[k]!)}`)
      .join(" ");
  const tick =
    "text-muted-foreground text-kbd absolute left-0 w-5 text-right font-mono tabular-nums";
  return (
    <div className="flex flex-col gap-0.5" aria-hidden>
      <div className="relative mt-2 h-[38px]">
        <span className={cn(tick, "-top-2")}>{Math.round(hi)}</span>
        <span className={cn(tick, "-bottom-2")}>{Math.round(lo)}</span>
        <div className="border-border absolute inset-y-0 right-0 left-6 border-b">
          <span className="bg-border absolute inset-y-0 left-0 w-px" />
          {t.band ? (
            <span
              title={fill(C.normalBand, { lo: t.band[0], hi: t.band[1] })}
              className="border-border bg-card/70 absolute inset-x-0 border-y border-dashed"
              style={{
                top: `${Y(t.band[1])}%`,
                height: `${Math.max(2, Y(t.band[0]) - Y(t.band[1]))}%`,
              }}
            />
          ) : null}
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 size-full overflow-visible"
          >
            {t.series.some((s) => s.v2 != null) ? (
              <polyline
                points={line("v2")}
                fill="none"
                className="stroke-muted-foreground"
                strokeWidth={1.5}
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            <polyline
              points={line("v")}
              fill="none"
              className="stroke-foreground"
              strokeWidth={2}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {t.series.map((s, i) => (
            <span key={s.at}>
              {s.v2 != null ? (
                <span
                  className="bg-muted-foreground absolute -mt-[3px] -ml-[3px] size-1.5 rounded-full"
                  style={{ left: `${X(s.at)}%`, top: `${Y(s.v2)}%` }}
                />
              ) : null}
              <span
                title={`${formatClock(new Date(s.at))} · ${s.v}${s.v2 != null ? `/${s.v2}` : ""}`}
                className={cn(
                  "ring-card absolute rounded-full ring-[1.5px]",
                  DOT[s.lvl ?? "ok"],
                  i === t.series.length - 1
                    ? "-mt-[4.5px] -ml-[4.5px] size-[9px]"
                    : "-mt-[3.5px] -ml-[3.5px] size-[7px]",
                )}
                style={{ left: `${X(s.at)}%`, top: `${Y(s.v)}%` }}
              />
            </span>
          ))}
        </div>
      </div>
      <span className="text-muted-foreground text-kbd ml-6 flex justify-between font-mono tabular-nums">
        <span>{formatClock(new Date(t0))}</span>
        <span>{formatClock(new Date(t1))}</span>
      </span>
    </div>
  );
}
