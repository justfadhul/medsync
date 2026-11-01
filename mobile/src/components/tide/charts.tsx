import type { ReactNode } from "react";
import { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, {
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Line, Rect } from "react-native-svg";

import { EASE_OUT_FN, ringFillMs } from "@/motion/presets";
import { useTide } from "@/theme/theme";
import { tRadius, tType } from "@/theme/tide";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * A progress ring that fills over 800ms (`ringFill`). `value` 0–1. The
 * centre takes any node: "1/3 taken today", "92%", an icon.
 */
export function Ring({
  value,
  size,
  stroke,
  color,
  track,
  children,
  accessibilityLabel,
}: {
  value: number;
  size: number;
  stroke: number;
  color?: string;
  track?: string;
  children?: ReactNode;
  accessibilityLabel?: string;
}) {
  const t = useTide();
  const reduced = useReducedMotion();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const progress = useSharedValue(0);
  const clamped = Math.max(0, Math.min(1, value));
  useEffect(() => {
    progress.value = withTiming(clamped, { duration: ringFillMs(reduced), easing: EASE_OUT_FN });
  }, [clamped, reduced, progress]);
  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: c * (1 - progress.value) }));
  return (
    <View
      accessible={Boolean(accessibilityLabel)}
      accessibilityRole={accessibilityLabel ? "image" : undefined}
      accessibilityLabel={accessibilityLabel}
      style={{ width: size, height: size }}
    >
      <Svg width={size} height={size} style={{ transform: [{ rotate: "-90deg" }] }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={track ?? t.surface3}
          strokeWidth={stroke}
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color ?? t.accentPressed}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c} ${c}`}
          animatedProps={animatedProps}
        />
      </Svg>
      {children ? (
        <View
          style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }}
        >
          {children}
        </View>
      ) : null}
    </View>
  );
}

/** A thin bar with a fill: medicine supply, live queue progress. */
export function ProgressBar({
  value,
  color,
  height = 5,
  track,
}: {
  value: number;
  color?: string;
  height?: number;
  track?: string;
}) {
  const t = useTide();
  return (
    <View
      style={{
        height,
        borderRadius: height,
        backgroundColor: track ?? t.surface3,
        overflow: "hidden",
        flex: 1,
      }}
    >
      <View
        style={{
          width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`,
          height: "100%",
          borderRadius: height,
          backgroundColor: color ?? t.accentPressed,
        }}
      />
    </View>
  );
}

/**
 * Where a value sits against its healthy band: a grey track, the healthy
 * span in green tint, and a dot. The dot's colour carries the clinical word
 * shown beside it (law L4).
 */
export function RangeBar({
  min,
  max,
  goodFrom,
  goodTo,
  value,
  tone,
  width = 64,
}: {
  min: number;
  max: number;
  goodFrom: number;
  goodTo: number;
  value: number;
  tone: "stable" | "caution";
  width?: number;
}) {
  const t = useTide();
  const x = (v: number) => ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * 110;
  return (
    <Svg width={width} height={14} viewBox="0 0 110 14" preserveAspectRatio="none">
      <Rect x={0} y={5} width={110} height={4} rx={2} fill={t.surface3} />
      <Rect
        x={x(goodFrom)}
        y={5}
        width={x(goodTo) - x(goodFrom)}
        height={4}
        rx={2}
        fill={t.stable.tint}
      />
      <Circle cx={x(value)} cy={7} r={5.5} fill={t[tone].text} stroke={t.surface} strokeWidth={2} />
    </Svg>
  );
}

/**
 * A few bars against a target line: HbA1c by quarter, active minutes by day.
 * The last bar is the one that matters and takes `highlight`.
 */
export function Sparkbars({
  values,
  labels,
  min = 0,
  max,
  target,
  highlight,
  height = 66,
  width = 190,
  showValues = true,
}: {
  values: number[];
  labels?: string[];
  min?: number;
  max: number;
  target?: number;
  highlight?: string;
  height?: number;
  width?: number;
  showValues?: boolean;
}) {
  const t = useTide();
  const W = 310;
  const H = 108;
  const plotTop = showValues ? 18 : 4;
  const plotBottom = labels ? 86 : H - 4;
  const y = (v: number) => plotBottom - ((v - min) / (max - min)) * (plotBottom - plotTop);
  const slot = W / values.length;
  const bar = Math.min(34, slot * 0.6);
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${W} ${H}`}>
      {values.map((v, i) => {
        const cx = slot * i + slot / 2;
        const last = i === values.length - 1;
        return (
          <Rect
            key={`b${i}`}
            x={cx - bar / 2}
            y={y(v)}
            width={bar}
            height={plotBottom - y(v)}
            rx={8}
            fill={last ? (highlight ?? t.ink) : t.lineStrong}
          />
        );
      })}
      {target !== undefined ? (
        <Line
          x1={8}
          x2={W - 8}
          y1={y(target)}
          y2={y(target)}
          stroke={t.accent}
          strokeWidth={2}
          strokeDasharray="5 5"
        />
      ) : null}
    </Svg>
  );
}

/** Label-under-bar helper for `Sparkbars` when the labels must be real text (screen readers). */
export function BarLabels({ labels }: { labels: string[] }) {
  const t = useTide();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
      {labels.map((l, i) => (
        <Text
          key={i}
          style={[tType.micro, { fontSize: 11, color: i === labels.length - 1 ? t.ink : t.ink3 }]}
        >
          {l}
        </Text>
      ))}
    </View>
  );
}

/** The capsule drawing on medicine cards: two halves, tilted. Decorative. */
export function Capsule({
  left,
  right,
  width = 40,
  rotate = -35,
}: {
  left: string;
  right: string;
  width?: number;
  rotate?: number;
}) {
  const t = useTide();
  const h = width * 0.42;
  return (
    <View
      style={{
        width,
        height: h,
        borderRadius: tRadius.pill,
        overflow: "hidden",
        flexDirection: "row",
        transform: [{ rotate: `${rotate}deg` }],
        boxShadow: t.shadow.drawing,
      }}
    >
      <View style={{ flex: 1, backgroundColor: left }} />
      <View style={{ flex: 1, backgroundColor: right }} />
    </View>
  );
}

/** The round tablet drawing. Decorative. */
export function Tablet({ color, size = 30 }: { color: string; size?: number }) {
  const t = useTide();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        alignItems: "center",
        justifyContent: "center",
        boxShadow: t.shadow.drawing,
      }}
    >
      <View style={{ width: "60%", height: 2, borderRadius: 1, backgroundColor: t.tabletLine }} />
    </View>
  );
}
