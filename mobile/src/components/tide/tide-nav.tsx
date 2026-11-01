import type { IconName } from "@/components/tide/icon";
import { Text, View } from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import { Icon } from "@/components/tide/icon";
import { Press } from "@/components/tide/press";
import { motion } from "@/motion/presets";
import { useTide } from "@/theme/theme";
import { tFont, tType } from "@/theme/tide";

export type NavPlace = "home" | "visits" | "care" | "me";

/** Body of the pill: y 20 to 92, ends are half-circles of radius 36. */
export const NAV_H = 92;
const BODY_TOP = 20;
const END_R = 36;
/** The cradle: a circle of radius 33 centred on the plus at (cx, 28), with 10pt fillets. */
const CRADLE_R = 33;
const PLUS = 56;
const PLUS_RING = 5;

/**
 * The cradle outline, generalised from the 358pt board to any width. Every
 * curve shares one centre per feature (build prompt §7): the ends are
 * half-circles around (36, 56) and (w − 36, 56); the cradle is a true circle
 * around the plus, so the plus's 5pt ring (33 outer) sits concentric in it.
 * The fillet joins are the board's own numbers, offset from the centre.
 */
export function navPath(w: number): string {
  const cx = w / 2;
  const join = 39.05;
  const lip = 29.97;
  const lipY = 14.19;
  return [
    `M${END_R} ${BODY_TOP}`,
    `H${cx - join}`,
    `A10 10 0 0 0 ${cx - lip} ${lipY}`,
    `A${CRADLE_R} ${CRADLE_R} 0 0 1 ${cx + lip} ${lipY}`,
    `A10 10 0 0 0 ${cx + join} ${BODY_TOP}`,
    `H${w - END_R}`,
    `A${END_R} ${END_R} 0 0 1 ${w - END_R} ${NAV_H}`,
    `H${END_R}`,
    `A${END_R} ${END_R} 0 0 1 ${END_R} ${BODY_TOP}`,
    "Z",
  ].join(" ");
}

const TABS: { key: NavPlace; label: string; icon: IconName }[] = [
  { key: "home", label: "Home", icon: "home" },
  { key: "visits", label: "Visits", icon: "calendar" },
  { key: "care", label: "Care", icon: "heart" },
  { key: "me", label: "Me", icon: "user" },
];

/**
 * The floating pill nav: Home, Visits, the cradled plus, Care, Me.
 * Presentational: the tabs layout passes `current` and the handlers.
 */
export function TideNav({
  current,
  onNavigate,
  onPlus,
  careCount = 0,
  width,
}: {
  current: NavPlace;
  onNavigate: (place: NavPlace) => void;
  onPlus: () => void;
  careCount?: number;
  width: number;
}) {
  const t = useTide();
  const reduced = useReducedMotion();
  const dark = t.scheme === "dark";
  const activeBg = t.primary;
  const activeFg = t.onPrimary;
  const off = dark ? t.ink2 : t.ink3;
  const cx = width / 2;

  const tab = (item: (typeof TABS)[number]) => {
    const on = item.key === current;
    const label = item.key === "care" && careCount > 0 ? `Care, ${careCount} due` : item.label;
    return (
      <Press
        key={item.key}
        onPress={() => onNavigate(item.key)}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        accessibilityLabel={label}
        style={{ flex: 1, height: 56 }}
      >
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 3 }}>
          {on ? (
            <Animated.View
              style={[
                {
                  position: "absolute",
                  inset: 0,
                  borderRadius: 28,
                  backgroundColor: activeBg,
                },
                motion.tabPop(reduced),
              ]}
            />
          ) : null}
          <NavGlyph name={item.icon} on={on} color={on ? activeFg : off} cut={activeBg} />
          <Text
            style={{
              fontFamily: on ? tFont.bold : tFont.medium,
              fontSize: 11,
              lineHeight: 13,
              color: on ? activeFg : off,
            }}
          >
            {item.label}
          </Text>
          {item.key === "care" && careCount > 0 ? (
            <View
              style={{
                position: "absolute",
                top: 6,
                right: 14,
                minWidth: 16,
                height: 16,
                paddingHorizontal: 4,
                borderRadius: 8,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: on ? t.accent : t.primary,
                boxShadow: `0px 0px 0px 2px ${t.surfaceRaised}`,
              }}
            >
              <Text
                style={{
                  fontFamily: tFont.bold,
                  fontSize: 11,
                  color: on ? t.onAccent : t.onPrimary,
                }}
              >
                {careCount}
              </Text>
            </View>
          ) : null}
        </View>
      </Press>
    );
  };

  return (
    <Animated.View
      accessibilityRole="tablist"
      style={[{ width, height: NAV_H }, motion.navRise(reduced)]}
    >
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: BODY_TOP,
          bottom: 0,
          borderRadius: END_R,
          boxShadow: t.shadow.float,
        }}
      />
      <Svg width={width} height={NAV_H} style={{ position: "absolute", inset: 0 }}>
        <Path
          d={navPath(width)}
          fill={t.surfaceRaised}
          stroke={t.line}
          strokeOpacity={0.5}
          strokeWidth={1}
        />
      </Svg>
      <View
        style={{
          position: "absolute",
          left: 8,
          right: 8,
          bottom: 8,
          height: 56,
          flexDirection: "row",
          alignItems: "center",
          gap: 2,
        }}
      >
        {tab(TABS[0])}
        {tab(TABS[1])}
        <View style={{ flex: 1 }} />
        {tab(TABS[2])}
        {tab(TABS[3])}
      </View>
      <Press
        onPress={onPlus}
        accessibilityLabel="Add: log a reading, a medicine, or tell your team"
        style={{
          position: "absolute",
          top: 0,
          left: cx - 31,
          width: 62,
          alignItems: "center",
          gap: 4,
        }}
      >
        <Animated.View
          style={[
            {
              width: PLUS,
              height: PLUS,
              borderRadius: PLUS / 2,
              backgroundColor: t.accent,
              alignItems: "center",
              justifyContent: "center",
              boxShadow: `0px 0px 0px ${PLUS_RING}px ${t.surfaceRaised}, ${t.shadow.accent}`,
            },
            motion.plusIn(reduced),
          ]}
        >
          <Icon name="plus" size={26} color={t.onAccent} strokeWidth={2.4} />
        </Animated.View>
        <Text style={[tType.micro, { fontFamily: tFont.semibold, color: t.ink }]}>Add</Text>
      </Press>
    </Animated.View>
  );
}

/** A nav glyph: outline when off, filled when on, with the inner detail cut in the pill colour. */
function NavGlyph({
  name,
  on,
  color,
  cut,
}: {
  name: IconName;
  on: boolean;
  color: string;
  cut: string;
}) {
  if (name === "home")
    return (
      <View style={{ width: 22, height: 22 }}>
        <View style={{ position: "absolute" }}>
          <Icon name="home" size={22} color={color} fill={on ? color : "none"} />
        </View>
        <Icon name="homeDoor" size={22} color={color} fill={on ? cut : "none"} />
      </View>
    );
  return (
    <Icon name={name} size={22} color={color} fill={on && name !== "calendar" ? color : "none"} />
  );
}

/** How far a tab screen's content must clear the nav: the nav, its 14pt float, the home indicator. */
export function useNavClearance(): number {
  const insets = useSafeAreaInsets();
  return NAV_H + 14 + insets.bottom;
}
