import type { SeriesPoint } from "@/lib/emr/chart";

import { formatters } from "./format";

/**
 * An inline SVG trend (no chart library, UI-BRIEF §6) and its table alternative. The line is
 * scaled to its own min–max, so it shows shape only: no axis, no threshold, no clinical number.
 * The table (screen readers; visible in print) is the same values as words.
 */
export function Sparkline({
  series,
  label,
  unit,
  timeZone,
  width = 64,
  height = 20,
}: {
  series: readonly SeriesPoint[];
  label: string;
  unit: string | null;
  timeZone?: string;
  width?: number;
  height?: number;
}) {
  if (series.length < 2) return null;
  const values = series.map((p) => p.value);
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const pad = 2;
  const x = (i: number) => pad + (i * (width - 2 * pad)) / (series.length - 1);
  const y = (v: number) => height - pad - ((v - min) * (height - 2 * pad)) / span;
  const points = series.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const last = series.at(-1)!;
  const fmt = formatters(timeZone);
  return (
    <span className="inline-flex items-center">
      <svg
        aria-hidden
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="overflow-visible text-teal-600"
      >
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={x(series.length - 1)} cy={y(last.value)} r={2} fill="currentColor" />
      </svg>
      <table className="sr-only">
        <caption>{`${label} trend, oldest first`}</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">{unit ? `Value (${unit})` : "Value"}</th>
          </tr>
        </thead>
        <tbody>
          {series.map((p) => (
            <tr key={p.id}>
              <td>{fmt.dateTime(p.at)}</td>
              <td>{p.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </span>
  );
}
