import type { DiaryClass, Metric } from "@/data/trends";
import type { SugarContext } from "@/lib/readings";
import type { Tide } from "@/theme/tide";
import { useState } from "react";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";

import {
  Band,
  Button,
  Card,
  Chip,
  ChipRow,
  Icon,
  Press,
  Screen,
  Segments,
  StatusPill,
} from "@/components/tide";
import { lastDays } from "@/data/health-log";
import { useReadings } from "@/data/readings";
import {
  chartRange,
  DIARY_SLOTS,
  DIARY_WORDS,
  diaryClass,
  insight,
  judge,
  METRICS,
  readingsIn,
  SUGAR_CHIPS,
  sugarDiary,
  targetBand,
  weekSeries,
} from "@/data/trends";
import { lastSevenDays } from "@/features/care/logic";
import { WeekChart } from "@/features/care/week-chart";
import { readingValueText, THRESHOLDS_NOTE } from "@/lib/readings";
import { useNow } from "@/lib/use-now";
import { useTide } from "@/theme/theme";
import { tRadius, tSpace, tType } from "@/theme/tide";

const TABS = (["bp", "sugar", "weight", "pulse"] as const).map((key) => ({
  key,
  label: METRICS[key].name,
}));

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const hhmmOf = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/**
 * Health trends (board TTrends, PRD F-16), from the patient's own readings
 * of the last seven days. A day with no reading is a gap in the chart. Only
 * the patient sees these; the screen says so.
 */
export default function TrendsScreen() {
  const t = useTide();
  const router = useRouter();
  const now = useNow();
  const [metric, setMetric] = useState<Metric>("bp");
  const [ctx, setCtx] = useState<SugarContext>("fasting");
  const { readings, loading, error, retry } = useReadings();

  const m = METRICS[metric];
  const chip = SUGAR_CHIPS.find((c) => c.ctx === ctx) ?? SUGAR_CHIPS[0];
  const label = metric === "sugar" ? `Blood sugar · ${chip.name.toLowerCase()}` : m.label;
  const dates = lastDays(now);
  const series = weekSeries(readings, metric, ctx, dates);
  const band = targetBand(metric, ctx);
  const range = chartRange(m, [...series.a, ...(series.b ?? [])], band);
  const judged = series.inputs.map((i) => (i ? judge(i) : null));
  const week = lastSevenDays(now);
  const list = readingsIn(readings, metric, ctx, dates);
  const latest = list[0];
  const latestJudged = latest ? judge(latest.input) : null;
  const status =
    latestJudged?.tone === "stable" ? { ...latestJudged, word: "In your range" } : latestJudged;

  return (
    <Screen
      back={{ label: "Care" }}
      title="Health trends"
      headerRight={
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
            boxShadow: t.shadow.accent,
          }}
        >
          <Icon name="plus" size={20} color={t.onAccent} strokeWidth={2.3} />
        </Press>
      }
    >
      <Segments options={TABS} value={metric} onChange={setMetric} />

      {metric === "sugar" ? (
        <View style={{ gap: tSpace[2] }}>
          <Text style={[tType.bodyS, { color: t.ink2 }]}>When was it measured?</Text>
          <ChipRow scroll>
            {SUGAR_CHIPS.map((s) => (
              <Chip
                key={s.ctx}
                label={s.name}
                size="sm"
                selected={s.ctx === ctx}
                onPress={() => setCtx(s.ctx)}
              />
            ))}
          </ChipRow>
          {band ? (
            <Text style={[tType.bodyS, { color: t.ink2 }]}>
              Target {chip.name.toLowerCase()}: up to {band.hi} {m.unit}
            </Text>
          ) : null}
        </View>
      ) : null}

      {loading && !readings.length ? (
        <Text style={[tType.bodyM, { color: t.ink2 }]}>Loading your readings…</Text>
      ) : error ? (
        <View style={{ gap: tSpace[2], alignItems: "flex-start" }}>
          <Text style={[tType.bodyM, { color: t.ink2 }]}>Couldn&apos;t load your readings.</Text>
          <Button label="Try again" variant="outline" size="sm" onPress={retry} />
        </View>
      ) : (
        <>
          <Card radius={tRadius.panel} style={{ paddingTop: tSpace[4] }}>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "flex-start",
                paddingHorizontal: 4,
              }}
            >
              <View style={{ gap: 2, flex: 1 }}>
                <Text style={[tType.bodyS, { color: t.ink2 }]}>{label} · this week</Text>
                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 5 }}>
                  <Text style={[tType.numeral, { color: t.ink }]}>
                    {latest ? readingValueText(latest.input).split(" ")[0] : "–"}
                  </Text>
                  <Text style={[tType.bodyM, { fontSize: 14, color: t.ink2 }]}>{m.unit}</Text>
                </View>
              </View>
              {status ? <StatusPill tone={status.tone} label={status.word} /> : null}
            </View>
            <WeekChart
              a={series.a}
              b={series.b}
              lo={range.lo}
              hi={range.hi}
              grid={range.grid}
              band={band}
              days={week.map((d, i) => (i === 6 ? "Today" : d.name.slice(0, 3)))}
              judged={judged}
              label={`${label} over the last seven days`}
              spoken={week.map((d, i) => (i === 6 ? "Today" : `${d.name} ${d.date}`))}
              unit={m.unit}
            />
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: tSpace[3.5],
                paddingHorizontal: 4,
              }}
            >
              <Legend color={t.ink} label={m.l1} mark="dot" />
              {m.l2 ? <Legend color={t.cascade[2]} label={m.l2} mark="diamond" /> : null}
              {band ? <Legend color={t.caution.text} label="Outside target" mark="ring" /> : null}
            </View>
          </Card>

          {metric === "sugar" ? (
            <SugarDiary
              cells={sugarDiary(readings, dates)}
              days={week.map((d) => d.name.slice(0, 3))}
            />
          ) : null}

          <Band
            style={{
              flexDirection: "row",
              gap: tSpace[3],
              alignItems: "flex-start",
              borderRadius: tRadius.cardLg,
            }}
          >
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: 17,
                backgroundColor: t.bandGlass,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="trend" size={17} color={t.onBand} />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={[tType.label, { fontSize: 15, color: t.onBand }]}>
                {insight(metric, series, dates)}
              </Text>
              <Text style={[tType.bodyS, { color: t.onBand2 }]}>
                Only you can see this chart. Show it at your visit.
              </Text>
            </View>
          </Band>

          <Text
            accessibilityRole="header"
            style={[tType.heading, { fontSize: 18, lineHeight: 24, color: t.ink }]}
          >
            Readings
          </Text>
          {list.length ? (
            <Card padding={0} style={{ gap: 0, overflow: "hidden" }}>
              {list.slice(0, 8).map((r, n) => {
                const d = new Date(r.at);
                const j = judge(r.input);
                return (
                  <View
                    key={r.id}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: tSpace[3],
                      paddingVertical: tSpace[3],
                      paddingHorizontal: tSpace[4],
                      borderTopWidth: n ? 1 : 0,
                      borderTopColor: t.surface3,
                    }}
                  >
                    <View style={{ width: 52 }}>
                      <Text style={[tType.labelS, { fontSize: 13, color: t.ink2 }]}>
                        {SHORT_DAYS[d.getDay()]} {d.getDate()}
                      </Text>
                      <Text style={[tType.bodyS, { color: t.ink2 }]}>{hhmmOf(r.at)}</Text>
                    </View>
                    <Text
                      style={[
                        tType.heading,
                        { flex: 1, color: t.ink, fontVariant: ["tabular-nums"] },
                      ]}
                    >
                      {readingValueText(r.input).split(" ")[0]}{" "}
                      <Text style={[tType.bodyS, { fontSize: 12, color: t.ink2 }]}>{m.unit}</Text>
                    </Text>
                    <StatusPill tone={j.tone} label={j.word} />
                  </View>
                );
              })}
            </Card>
          ) : (
            <Text style={[tType.bodyM, { color: t.ink2 }]}>
              No readings of this kind in the last seven days. Tap + to log one.
            </Text>
          )}
        </>
      )}
      <Text style={[tType.bodyS, { fontSize: 12, color: t.ink3, textAlign: "center" }]}>
        {THRESHOLDS_NOTE}
      </Text>
    </Screen>
  );
}

/** A legend key: a short line for a series, a dot for the "above target" points. Always with its word. */
/** A legend entry with the same mark the chart draws, so shape and words carry it, not colour. */
function Legend({
  color,
  label,
  mark,
}: {
  color: string;
  label: string;
  mark: "dot" | "diamond" | "ring";
}) {
  const t = useTide();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: tSpace[1.5] }}>
      <View
        style={
          mark === "diamond"
            ? { width: 8, height: 8, backgroundColor: color, transform: [{ rotate: "45deg" }] }
            : mark === "ring"
              ? { width: 10, height: 10, borderRadius: 5, borderWidth: 2.5, borderColor: color }
              : { width: 9, height: 9, borderRadius: 5, backgroundColor: color }
        }
      />
      <Text style={[tType.bodyS, { fontSize: 12, color: t.ink2 }]}>{label}</Text>
    </View>
  );
}

const cellColours = (t: Tide, c: DiaryClass) =>
  ({
    in: { bg: t.stable.tint, fg: t.stable.text },
    high: { bg: t.caution.tint, fg: t.caution.text },
    low: { bg: t.critical.tint, fg: t.critical.text },
    veryHigh: { bg: t.critical.tint, fg: t.critical.text },
    none: { bg: t.bg, fg: t.ink },
  })[c];

/** "Your sugar diary": seven days × six times of day, each cell judged against its own target. */
function SugarDiary({ cells: values, days }: { cells: (number | null)[][]; days: string[] }) {
  const t = useTide();
  const cells = values.map((row) =>
    row.map((v, j) => ({ v, c: diaryClass(v, DIARY_SLOTS[j].ctx) })),
  );
  const shown = new Set(cells.flat().map((x) => x.c));
  const legend = (["in", "high", "low", "veryHigh", "none"] as const).filter(
    (c) => c !== "veryHigh" || shown.has(c),
  );
  return (
    <Card radius={tRadius.cardLg} padding={tSpace[3]}>
      <View style={{ paddingHorizontal: 4 }}>
        <Text accessibilityRole="header" style={[tType.heading, { fontSize: 16, color: t.ink }]}>
          Your sugar diary
        </Text>
        <Text style={[tType.bodyS, { fontSize: 12, color: t.ink2 }]}>
          Every reading this week, by time of day
        </Text>
      </View>
      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: "row", gap: 4, alignItems: "flex-end" }}>
          <View style={{ width: 38 }} />
          {DIARY_SLOTS.map((s) => (
            <Text
              key={s.head}
              style={[
                tType.micro,
                { flex: 1, fontSize: 11, lineHeight: 14, color: t.ink2, textAlign: "center" },
              ]}
            >
              {s.head}
            </Text>
          ))}
        </View>
        {cells.map((row, i) => (
          <View key={i} style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
            <Text style={[tType.caption, { width: 38, color: i === 6 ? t.ink : t.ink2 }]}>
              {days[i]}
            </Text>
            {row.map(({ v, c }, j) => {
              const col = cellColours(t, c);
              return (
                <View
                  key={j}
                  accessible
                  accessibilityLabel={`${days[i]} ${DIARY_SLOTS[j].words}: ${v === null ? "" : `${v}, `}${DIARY_WORDS[c]}`}
                  style={{
                    flex: 1,
                    height: 30,
                    borderRadius: 8,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: col.bg,
                    borderWidth: c === "none" ? 1 : 0,
                    borderColor: t.line,
                  }}
                >
                  <Text style={[tType.caption, { color: col.fg, fontVariant: ["tabular-nums"] }]}>
                    {v ?? ""}
                  </Text>
                </View>
              );
            })}
          </View>
        ))}
      </View>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          columnGap: tSpace[3],
          rowGap: tSpace[1.5],
          paddingHorizontal: 4,
        }}
      >
        {legend.map((c) => {
          const col = cellColours(t, c);
          return (
            <View key={c} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <View
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  backgroundColor: col.bg,
                  borderWidth: c === "none" ? 1 : 0,
                  borderColor: t.line,
                }}
              />
              <Text style={[tType.micro, { color: t.ink2 }]}>{DIARY_WORDS[c]}</Text>
            </View>
          );
        })}
      </View>
    </Card>
  );
}
