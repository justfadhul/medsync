import type { NativeScrollEvent, NativeSyntheticEvent, ScrollViewInstance } from "react-native";
import { useRef } from "react";
import { LinearGradient } from "expo-linear-gradient";
import { ScrollView, Text, View } from "react-native";

import { Press } from "@/components/tide";
import { clearOf } from "@/components/tide/screen";
import { countdownOf } from "@/features/visits/logic";
import { useNow } from "@/lib/use-now";
import { useTide } from "@/theme/theme";
import { tFont, tRadius, tSpace, tType } from "@/theme/tide";

const ROW = 40;
const VISIBLE = 3; // rows: one above, the chosen one, one below
const HEIGHT = ROW * VISIBLE;
const PAD = (HEIGHT - ROW) / 2;

/**
 * A doctor's open times as a scroll wheel (board "C3 + countdown", 18 Oct
 * 2026): the time in the middle band is the chosen one, a tap on any row
 * scrolls it there. No count of what is left (ADR 0084). Remount it (`key`)
 * when the day changes so it starts at the top.
 */
export function TimeWheel({
  times,
  index,
  onChange,
  label,
}: {
  times: readonly string[];
  index: number;
  onChange: (index: number) => void;
  label: string;
}) {
  const t = useTide();
  const ref = useRef<ScrollViewInstance>(null);
  const clamp = (k: number) => Math.max(0, Math.min(times.length - 1, k));
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const k = clamp(Math.round(e.nativeEvent.contentOffset.y / ROW));
    if (k !== index) onChange(k);
  };
  return (
    <View style={{ width: 120, height: HEIGHT }} accessibilityLabel={label}>
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: PAD,
          height: ROW,
          borderRadius: tRadius.row,
          backgroundColor: t.primary,
        }}
      />
      <ScrollView
        ref={ref}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        snapToInterval={ROW}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScroll={onScroll}
        contentOffset={{ x: 0, y: index * ROW }}
        contentContainerStyle={{ paddingVertical: PAD }}
      >
        {times.map((time, k) => {
          const on = k === index;
          const near = Math.abs(k - index) === 1;
          return (
            <Press
              key={time}
              haptic={false}
              onPress={() => {
                ref.current?.scrollTo({ y: k * ROW, animated: true });
                onChange(k);
              }}
              accessibilityState={{ selected: on }}
              accessibilityLabel={time}
              style={{ height: ROW, alignItems: "center", justifyContent: "center" }}
            >
              <Text
                style={{
                  fontFamily: tFont.monoSemibold,
                  fontSize: on ? 21 : near ? 16 : 15,
                  color: on ? t.onPrimary : near ? t.ink2 : t.ink4,
                }}
              >
                {time}
              </Text>
            </Press>
          );
        })}
      </ScrollView>
      {/* Rows fade out above and below the band, as on a wheel. */}
      <LinearGradient
        pointerEvents="none"
        colors={[t.surface, clearOf(t.surface)]}
        style={{ position: "absolute", top: 0, left: 0, right: 0, height: PAD * 0.7 }}
      />
      <LinearGradient
        pointerEvents="none"
        colors={[clearOf(t.surface), t.surface]}
        style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: PAD * 0.7 }}
      />
    </View>
  );
}

/**
 * "Your visit is in 1 day 03 hrs 20 min 05 sec", in a muted card beside the
 * wheel. It keeps its own one-second clock so only this card redraws each tick;
 * a screen reader hears it to the minute, not every second.
 */
export function Countdown({ iso, whenLine }: { iso: string; whenLine: string }) {
  const t = useTide();
  const now = useNow(1000);
  const { days, hours, minutes, seconds } = countdownOf(now, iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const units: [string, string][] = [
    ...(days > 0 ? [[String(days), days === 1 ? "day" : "days"] as [string, string]] : []),
    [pad(hours), "hrs"],
    [pad(minutes), "min"],
  ];
  const spoken = units.map(([n, u]) => `${Number(n)} ${u}`).join(" ");
  units.push([pad(seconds), "sec"]);
  return (
    <View
      accessible
      accessibilityLabel={`Your visit is in ${spoken}, ${whenLine}`}
      style={{
        flex: 1,
        backgroundColor: t.surface2,
        borderRadius: tRadius.card,
        padding: tSpace[3],
        justifyContent: "center",
        gap: tSpace[1.5],
      }}
    >
      <Text style={[tType.micro, { fontFamily: tFont.bold, letterSpacing: 0.6, color: t.ink3 }]}>
        YOUR VISIT IS IN
      </Text>
      <View style={{ flexDirection: "row", gap: tSpace[1.5] }}>
        {units.map(([n, u]) => (
          <View key={u} style={{ alignItems: "center", minWidth: 34 }}>
            <Text style={{ fontFamily: tFont.monoSemibold, fontSize: 22, color: t.ink }}>{n}</Text>
            <Text style={[tType.micro, { fontFamily: tFont.semibold, color: t.ink3 }]}>{u}</Text>
          </View>
        ))}
      </View>
      <Text style={[tType.caption, { fontFamily: tFont.medium, color: t.ink2 }]}>{whenLine}</Text>
    </View>
  );
}
