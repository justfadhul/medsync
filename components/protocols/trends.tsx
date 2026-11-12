import type { Panel, VitalTile } from "@/lib/protocols/engine/types";

import {
  GraphFigure,
  GraphSvg,
  INK,
  ReferenceLineMark,
  ValueAxis,
  ValuePath,
} from "@/components/emr/chart/graphs/frame";
import { StatusWord } from "@/components/emr/status-word";
import { CHART_COPY as C } from "@/content/protocol-charts";
import { linearScale } from "@/lib/emr/charts/scale";

/**
 * The chart's trend panels and the vitals card's small trends (F8), on the EMR graph frame: teal
 * values, dashed amber lines for the version's thresholds and the target, words beside every mark.
 * A point the module flags is ringed and named in the panel's sentence (never colour alone).
 */

const W = 520;
const H = 170;
const M = { top: 12, right: 150, bottom: 26, left: 44 };

export function TrendPanel({ p, slots, slotWord }: { p: Panel; slots: number; slotWord: string }) {
  const x = linearScale([0, Math.max(1, slots)], [M.left, W - M.right]);
  const y = linearScale([p.min, p.max], [H - M.bottom, M.top]);
  const fmt = (n: number) => (p.max - p.min <= 1 ? n.toFixed(2) : String(n));
  const bad = p.points.filter((q) => q.bad);
  const label = p.points.length
    ? `${p.name}: ${p.points.map((q) => `${fmt(q.v)} at ${slotWord} ${q.h}`).join(", ")}${
        bad.length ? `. Flagged: ${bad.map((q) => fmt(q.v)).join(", ")}` : ""
      }.`
    : `${p.name}: ${C.noValues}.`;
  return (
    <GraphFigure
      title={`${p.name}${p.unit ? `, ${p.unit}` : ""}`}
      note={
        <span className="inline-flex flex-wrap items-center gap-2">
          <span>
            {C.latest}: {p.latest || "—"}
          </span>
          {p.status ? (
            <StatusWord tone={p.stLvl === "no" ? "caution" : "neutral"}>{p.status}</StatusWord>
          ) : null}
        </span>
      }
    >
      <GraphSvg label={label} height={H} width={W}>
        <ValueAxis ticks={p.ticks} y={y} x={M.left} format={fmt} />
        <line
          x1={M.left}
          x2={W - M.right}
          y1={H - M.bottom}
          y2={H - M.bottom}
          className={INK.axis}
        />
        {[0, Math.round(slots / 2), slots].map((h) => (
          <text key={h} x={x(h)} y={H - 8} textAnchor="middle" className={INK.tick}>
            {h}
          </text>
        ))}
        {p.thr.map((t) => (
          <ReferenceLineMark
            key={t.label}
            y={y(t.v)}
            left={M.left}
            right={W - M.right}
            label={t.label}
          />
        ))}
        {p.target.length > 1 ? (
          <path
            d={p.target.map(([h, v], i) => `${i ? "L" : "M"}${x(h)},${y(v)}`).join(" ")}
            fill="none"
            className="stroke-muted-foreground"
            strokeDasharray="2 4"
            strokeWidth={1.25}
          >
            <title>{C.target}</title>
          </path>
        ) : null}
        <ValuePath points={p.points.map((q) => [x(q.h), y(q.v)] as [number, number])} />
        {p.points.map((q) => (
          <g key={q.h}>
            <circle cx={x(q.h)} cy={y(q.v)} r={4} className="fill-teal-icon stroke-card" />
            {q.bad ? (
              <circle cx={x(q.h)} cy={y(q.v)} r={7.5} fill="none" className="stroke-foreground" />
            ) : null}
          </g>
        ))}
      </GraphSvg>
    </GraphFigure>
  );
}

/** A vitals tile's last readings as a small line, with its normal band shaded. */
export function MiniTrend({ t }: { t: VitalTile }) {
  if (t.series.length < 2) return null;
  const vals = t.series.flatMap((s) => (s.v2 != null ? [s.v, s.v2] : [s.v]));
  const lo = Math.min(...vals, t.band?.[0] ?? Infinity);
  const hi = Math.max(...vals, t.band?.[1] ?? -Infinity);
  const x = linearScale([0, t.series.length - 1], [4, 116]);
  const y = linearScale([lo, hi === lo ? lo + 1 : hi], [36, 4]);
  return (
    <svg
      role="img"
      aria-label={`${t.label}: ${t.series.map((s) => s.v).join(", ")}`}
      width={120}
      height={40}
      className="block"
    >
      {t.band ? (
        <rect
          x={4}
          width={112}
          y={y(t.band[1])}
          height={Math.max(1, y(t.band[0]) - y(t.band[1]))}
          className="fill-muted"
        />
      ) : null}
      <ValuePath points={t.series.map((s, i) => [x(i), y(s.v)] as [number, number])} />
      {t.series.some((s) => s.v2 != null) ? (
        <ValuePath
          points={t.series.flatMap((s, i) =>
            s.v2 != null ? [[x(i), y(s.v2)] as [number, number]] : [],
          )}
        />
      ) : null}
      {t.series.map((s, i) => (
        <circle key={s.at} cx={x(i)} cy={y(s.v)} r={2.5} className="fill-teal-icon" />
      ))}
    </svg>
  );
}
