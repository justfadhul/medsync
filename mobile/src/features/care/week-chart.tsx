import type { Judgement } from "@/data/trends";
import { View } from "react-native";
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from "react-native-svg";

import { useTide } from "@/theme/theme";
import { tFont } from "@/theme/tide";

const W = 322;
const H = 170;
const X0 = 40;
const X1 = 306;
const Y0 = 10;
const Y1 = 146;

/**
 * The week chart on Health trends (board TTrends): the target band, grid,
 * one or two lines and a point for each day with a reading. A point outside
 * the target turns amber (red only for a danger reading) and is drawn as a
 * hollow ring, so the shape says it too; the second line (the bottom number)
 * uses diamonds, never colour alone (Apple HIG, Charts). VoiceOver hears the
 * real values with their days, not a picture.
 */
export function WeekChart({
  a,
  b,
  lo,
  hi,
  grid,
  band,
  days,
  judged,
  label,
  spoken,
  unit,
}: {
  a: (number | null)[];
  b?: (number | null)[];
  lo: number;
  hi: number;
  grid: number[];
  band: { lo: number; hi: number } | null;
  days: string[];
  judged: (Judgement | null)[];
  label: string;
  /** Each day's full name for VoiceOver ("Monday 24"), in the same order as `a`. */
  spoken?: string[];
  unit?: string;
}) {
  const t = useTide();
  const y = (v: number) => Y0 + (1 - (v - lo) / (hi - lo)) * (Y1 - Y0);
  const x = (i: number) => X0 + (i * (X1 - X0)) / (a.length - 1);
  // A day with no reading is a gap: the line joins the days that have one.
  const path = (vs: (number | null)[]) =>
    vs
      .flatMap((v, i) => (v === null ? [] : [[x(i), y(v)]]))
      .map(([px, py], k) => `${k ? "L" : "M"}${px} ${py}`)
      .join(" ");
  const flag = (j: Judgement | null) =>
    j?.tone === "critical" ? t.critical.text : j?.tone === "caution" ? t.caution.text : null;
  const bandTop = band ? y(Math.min(band.hi, hi)) : 0;
  const bandBottom = band ? y(Math.max(band.lo, lo)) : 0;
  const lastI = a.length - 1;
  const lastLogged = a.reduce<number>((n, v, i) => (v === null ? n : i), -1);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={chartWords(label, a, b, spoken ?? days, unit, band)}
    >
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        {band ? (
          <>
            <Rect
              x={30}
              y={bandTop}
              width={286}
              height={Math.max(4, bandBottom - bandTop)}
              rx={6}
              fill={t.accentTint}
              opacity={0.55}
            />
            <SvgText
              x={312}
              y={bandTop + 12}
              textAnchor="end"
              fontFamily={tFont.semibold}
              fontSize={11}
              fill={t.accentText}
            >
              Your target
            </SvgText>
          </>
        ) : null}
        {grid.map((g) => (
          <G key={`g${g}`}>
            <Line x1={30} x2={316} y1={y(g)} y2={y(g)} stroke={t.surface3} strokeWidth={1} />
            <SvgText
              x={24}
              y={y(g) + 3}
              textAnchor="end"
              fontFamily={tFont.regular}
              fontSize={11}
              fill={t.ink3}
            >
              {String(g)}
            </SvgText>
          </G>
        ))}
        {b ? (
          <Path
            d={path(b)}
            fill="none"
            stroke={t.cascade[2]}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        <Path
          d={path(a)}
          fill="none"
          stroke={t.ink}
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {a.map((v, i) =>
          v === null ? null : (
            <Circle
              key={`a${i}`}
              cx={x(i)}
              cy={y(v)}
              r={i === lastLogged ? 6 : 4.5}
              fill={flag(judged[i]) ? t.surface : i === lastLogged ? t.accent : t.ink}
              stroke={flag(judged[i]) ?? t.surface}
              strokeWidth={flag(judged[i]) ? 2.5 : 2}
            />
          ),
        )}
        {b?.map((v, i) =>
          v === null ? null : (
            <Path
              key={`b${i}`}
              d={diamond(x(i), y(v), 5)}
              fill={flag(judged[i]) ? t.surface : t.cascade[2]}
              stroke={flag(judged[i]) ?? t.surface}
              strokeWidth={flag(judged[i]) ? 2.5 : 1.5}
            />
          ),
        )}
        {days.map((d, i) => (
          <SvgText
            key={`d${i}`}
            x={x(i)}
            y={166}
            textAnchor="middle"
            fontFamily={i === lastI ? tFont.bold : tFont.medium}
            fontSize={11}
            fill={t.ink2}
          >
            {d}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}

/** A diamond mark centred on (cx, cy), r from centre to tip. */
export function diamond(cx: number, cy: number, r: number): string {
  return `M${cx} ${cy - r} L${cx + r} ${cy} L${cx} ${cy + r} L${cx - r} ${cy} Z`;
}

/**
 * What VoiceOver reads for a week chart (Apple HIG, Charts: real values,
 * days in words, the axis bounds, no colour): "Blood pressure over the last
 * seven days, in mmHg. Your target 90 to 135. Monday 24: 128 over 82. …".
 * Days with no reading are left out.
 */
export function chartWords(
  label: string,
  a: (number | null)[],
  b: (number | null)[] | undefined,
  days: string[],
  unit?: string,
  band?: { lo: number; hi: number } | null,
): string {
  const head = unit ? `${label}, in ${unit}.` : `${label}.`;
  const target = band ? ` Your target ${band.lo} to ${band.hi}.` : "";
  const each = a.flatMap((v, i) =>
    v === null ? [] : [`${days[i]}: ${b?.[i] != null ? `${v} over ${b[i]}` : v}`],
  );
  return `${head}${target} ${each.length ? `${each.join(". ")}.` : "No readings yet."}`;
}
