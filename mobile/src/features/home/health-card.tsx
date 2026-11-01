import type { Metric } from "@/data/trends";
import type { SugarContext } from "@/lib/readings";
import { useState } from "react";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { Icon, Press, SectionHead } from "@/components/tide";
import { lastDays } from "@/data/health-log";
import { useReadings } from "@/data/readings";
import { chartRange, insight, judge, METRICS, targetBand, weekSeries } from "@/data/trends";
import { diamond } from "@/features/care/week-chart";
import { readingValueText } from "@/lib/readings";
import { useNow } from "@/lib/use-now";
import { useTide } from "@/theme/theme";
import { tFont, tRadius, tSpace, tType } from "@/theme/tide";

const W = 320;
const H = 84;
const DAYS = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * "Your health" on Home (owner, 25 Oct 2026; canvas "Home: health snippet",
 * option C): one navy card that switches between blood pressure and blood
 * sugar, from the patient's own readings of the last seven days. The latest
 * value and its word, the week with the target band from the thresholds
 * file, and the Trends page's own sentence. Sugar follows the time of day of
 * the latest sugar reading, so the band is the right target. The card opens
 * Trends; the + logs a reading. Words always carry the judgement (law L4);
 * no red here, a danger reading is handled where it is logged.
 */
export function HealthCard() {
  const t = useTide();
  const router = useRouter();
  const now = useNow();
  const [metric, setMetric] = useState<Extract<Metric, "bp" | "sugar">>("bp");
  const { readings } = useReadings();

  const m = METRICS[metric];
  const days = lastDays(now);
  const latest = readings.find((r) => r.input.kind === metric) ?? null;
  const ctx: SugarContext = latest?.input.kind === "sugar" ? latest.input.context : "fasting";
  const series = weekSeries(readings, metric, ctx, days);
  const band = targetBand(metric, ctx);
  const range = chartRange(m, [...series.a, ...(series.b ?? [])], band);
  const judged = latest ? judge(latest.input) : null;
  const word = judged?.tone === "stable" ? "In your range" : judged?.word;

  const x = (i: number) => 8 + (i * (W - 16)) / 6;
  const y = (v: number) => 6 + (1 - (v - range.lo) / (range.hi - range.lo)) * (H - 12);
  const path = (vs: (number | null)[]) =>
    vs
      .flatMap((v, i) => (v === null ? [] : [[x(i), y(v)]]))
      .map(([px, py], k) => `${k ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`)
      .join(" ");
  const lastI = series.a.reduce<number>((n, v, i) => (v === null ? n : i), -1);

  return (
    <View style={{ gap: tSpace[2.5] }}>
      <SectionHead
        title="Your health"
        action="See trends"
        onAction={() => router.push("/care/trends")}
      />
      <View
        style={{
          backgroundColor: t.band,
          borderRadius: tRadius.panel,
          padding: tSpace[4],
          gap: tSpace[2.5],
        }}
      >
        <View
          accessibilityRole="tablist"
          style={{
            flexDirection: "row",
            gap: 4,
            padding: 4,
            borderRadius: tRadius.pill,
            backgroundColor: t.bandGlass,
          }}
        >
          {(["bp", "sugar"] as const).map((k) => {
            const on = metric === k;
            return (
              <Press
                key={k}
                haptic={false}
                onPress={() => setMetric(k)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={METRICS[k].label}
                style={{
                  flex: 1,
                  minHeight: 36,
                  borderRadius: tRadius.pill,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: on ? t.surface : "transparent",
                }}
              >
                <Text style={[tType.labelS, { color: on ? t.ink : t.onBand2 }]}>
                  {METRICS[k].label}
                </Text>
              </Press>
            );
          })}
        </View>

        <Press
          haptic={false}
          onPress={() => router.push("/care/trends")}
          accessibilityLabel={
            latest
              ? `${m.label}, ${readingValueText(latest.input)}, ${word}. ${insight(metric, series, days)} Open trends.`
              : `No ${m.label.toLowerCase()} this week. Open trends.`
          }
          style={{ gap: tSpace[2.5] }}
        >
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: tSpace[2.5] }}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[tType.overline, { color: t.onBand2 }]}>{m.label} · this week</Text>
              {latest ? (
                <>
                  <Text
                    style={{
                      fontFamily: tFont.monoSemibold,
                      fontSize: 34,
                      lineHeight: 38,
                      letterSpacing: -1,
                      color: t.onBand,
                    }}
                  >
                    {readingValueText(latest.input).split(" ")[0]}
                    <Text style={[tType.bodyM, { fontSize: 14, color: t.onBand2 }]}> {m.unit}</Text>
                  </Text>
                  <View
                    style={{
                      alignSelf: "flex-start",
                      paddingHorizontal: tSpace[2.5],
                      paddingVertical: 3,
                      borderRadius: tRadius.pill,
                      backgroundColor: t.bandGlass,
                    }}
                  >
                    <Text
                      style={[
                        tType.caption,
                        { color: judged?.tone === "stable" ? t.onBandAccent : t.onBand },
                      ]}
                    >
                      {word}
                    </Text>
                  </View>
                </>
              ) : (
                <Text style={[tType.bodyM, { color: t.onBand }]}>
                  Nothing logged this week. Tap + to log one.
                </Text>
              )}
            </View>
            <Press
              onPress={() => router.push("/care/reading")}
              accessibilityLabel="Log a reading"
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: t.accent,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="plus" size={22} color={t.onAccent} strokeWidth={2.4} />
            </Press>
          </View>

          {lastI >= 0 ? (
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
                {band ? (
                  <Rect
                    x={0}
                    y={y(Math.min(band.hi, range.hi))}
                    width={W}
                    height={Math.max(
                      4,
                      y(Math.max(band.lo, range.lo)) - y(Math.min(band.hi, range.hi)),
                    )}
                    rx={6}
                    fill={t.onBandAccent}
                    opacity={0.12}
                  />
                ) : null}
                {series.b ? (
                  <Path
                    d={path(series.b)}
                    stroke={t.onBandAccent}
                    strokeOpacity={0.45}
                    strokeWidth={2}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : null}
                <Path
                  d={path(series.a)}
                  stroke={t.onBandAccent}
                  strokeWidth={2.5}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {series.b?.map((v, i) =>
                  v === null ? null : (
                    <Path
                      key={`b${i}`}
                      d={diamond(x(i), y(v), 4.5)}
                      fill={t.band}
                      stroke={t.onBandAccent}
                      strokeOpacity={0.7}
                      strokeWidth={2}
                    />
                  ),
                )}
                {series.a.map((v, i) =>
                  v === null ? null : (
                    <Circle
                      key={i}
                      cx={x(i)}
                      cy={y(v)}
                      r={i === lastI ? 5 : 3}
                      fill={i === lastI ? t.onBandAccent : t.band}
                      stroke={t.onBandAccent}
                      strokeWidth={2}
                    />
                  ),
                )}
              </Svg>
              {series.b ? (
                <View
                  style={{ flexDirection: "row", gap: tSpace[3.5], paddingBottom: tSpace[1.5] }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <View
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: 5,
                        backgroundColor: t.onBandAccent,
                      }}
                    />
                    <Text style={[tType.caption, { color: t.onBand2 }]}>{m.l1}</Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderWidth: 2,
                        borderColor: t.onBandAccent,
                        transform: [{ rotate: "45deg" }],
                      }}
                    />
                    <Text style={[tType.caption, { color: t.onBand2 }]}>{m.l2}</Text>
                  </View>
                </View>
              ) : null}
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                {days.map((d, i) => (
                  <Text
                    key={i}
                    style={[
                      tType.micro,
                      {
                        width: 32,
                        textAlign: "center",
                        color: i === 6 ? t.onBandAccent : t.onBand2,
                      },
                    ]}
                  >
                    {i === 6 ? "Today" : DAYS[d.getDay()]}
                  </Text>
                ))}
              </View>
            </View>
          ) : null}

          {latest ? (
            <View
              style={{
                paddingTop: tSpace[2.5],
                borderTopWidth: 1,
                borderTopColor: t.bandGlass,
              }}
            >
              <Text style={[tType.bodyS, { color: t.onBand2 }]}>
                {insight(metric, series, days)}
              </Text>
            </View>
          ) : null}
        </Press>
      </View>
    </View>
  );
}
