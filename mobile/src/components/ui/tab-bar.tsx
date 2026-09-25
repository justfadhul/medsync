import type { Palette } from "@/theme/tokens";
import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { createContext, useContext } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { Easing, FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useStyles, useTheme } from "@/theme/theme";
import { font, motion, radius, space } from "@/theme/tokens";

/**
 * The floating tab bar — a pill that hovers above the home indicator, icons
 * only, with the current tab opened out into an icon-and-word chip.
 *
 * The parts live here; the assembly lives in `(tabs)/_layout.tsx`, and that
 * split is not a preference. Expo Router's headless tabs discover the tabs by
 * walking the JSX given to `<Tabs>` for a literal `<TabList>` holding literal
 * `<TabTrigger>`s — a component that rendered them would be invisible to the
 * walk, and the navigator would have no tabs. So the layout owns the two
 * router elements and this file owns what they look like: the bar's frame
 * (`useTabBarFrame`), one tab's button (`TabButton`), and how far a screen has
 * to keep clear of the bar (`TabBarClearance`).
 *
 * Motion is the one place this app animates outside the splash, and it earns
 * it: the chip opening on the tab you just chose is the confirmation that the
 * tap landed, at the sanctioned 250ms on the sanctioned curve. The siblings
 * sliding over to make room is the same transition, not a second one.
 */

/** 44px target + 8px padding either side. */
export const TAB_BAR_HEIGHT = 44 + space[2] * 2;
/** How far the pill floats above the home indicator. */
export const TAB_BAR_GAP = space[3];

const EASE = Easing.bezier(...motion.easing);
export const TAB_TRANSITION = LinearTransition.duration(motion.normal).easing(EASE);

/* ─── clearance ──────────────────────────────────────────────────── */

const ClearanceContext = createContext(0);

/**
 * Wraps the tab navigator so every screen inside it knows the bar is there.
 * `Screen` reads this and pads its content; screens pushed OVER the tabs
 * (the doors, a visit) sit outside it and read zero.
 */
export function TabBarClearance({ children }: { children: ReactNode }) {
  return (
    <ClearanceContext.Provider value={TAB_BAR_HEIGHT + TAB_BAR_GAP * 2}>
      {children}
    </ClearanceContext.Provider>
  );
}

/** Extra bottom padding a screen needs, beyond the safe-area inset. Zero off the tabs. */
export function useTabBarClearance(): number {
  return useContext(ClearanceContext);
}

/* ─── the bar ────────────────────────────────────────────────────── */

/**
 * The pill's own style, for the `<TabList asChild>` child in the layout.
 *
 * Flattened to one object on purpose: the slot behind `asChild` throws in
 * development when the child's `style` is an array.
 */
export function useTabBarFrame(): ViewStyle {
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  return StyleSheet.flatten([styles.bar, { bottom: insets.bottom + TAB_BAR_GAP }]);
}

/* ─── one tab ────────────────────────────────────────────────────── */

export interface TabButtonProps {
  label: string;
  /** The outline glyph, shown while the tab is not current. */
  icon: keyof typeof Ionicons.glyphMap;
  /** The filled glyph, shown inside the open chip. */
  iconActive: keyof typeof Ionicons.glyphMap;
  /**
   * `critical` is the Emergency tab and nothing else: red at rest, because
   * this IS the emergency affordance (ADR 0085 §5). Every other tab is `accent`.
   */
  tone?: "accent" | "critical";
  /** Injected by `<TabTrigger asChild>`. */
  isFocused?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Injected by the trigger's slot; not used, the button has its own frame. */
  style?: StyleProp<ViewStyle>;
  href?: string;
}

export function TabButton({
  label,
  icon,
  iconActive,
  tone = "accent",
  isFocused = false,
  onPress,
}: TabButtonProps) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const critical = tone === "critical";
  const ink = critical
    ? colors.status.criticalFg
    : isFocused
      ? colors.placeForeground
      : colors.mutedForeground;

  return (
    // The fill lives on the animated view, not the Pressable: a layout
    // transition animates only the frame of the view it is on (children keep
    // their final layout), so a fill one level down would snap to its full
    // width while an empty frame grew around it.
    <Animated.View
      layout={TAB_TRANSITION}
      style={[styles.chip, isFocused && (critical ? styles.chipCritical : styles.chipCurrent)]}
    >
      <Pressable
        accessibilityRole="tab"
        accessibilityState={{ selected: isFocused }}
        // The word is only on screen for the current tab; the label is what
        // the other two are called.
        accessibilityLabel={label}
        onPress={onPress}
        style={({ pressed }) => [
          styles.tab,
          isFocused && styles.tabCurrent,
          // Opacity, never scale — same rule as every other control.
          pressed && !isFocused && styles.tabPressed,
        ]}
      >
        <Ionicons name={isFocused ? iconActive : icon} size={20} color={ink} />
        {isFocused ? (
          <Animated.Text
            entering={FadeIn.duration(motion.normal).easing(EASE)}
            exiting={FadeOut.duration(motion.fast).easing(EASE)}
            numberOfLines={1}
            style={[styles.label, { color: ink }]}
          >
            {label}
          </Animated.Text>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

/** A spacer with the bar's footprint, for screens that lay out their own bottom. */
export function TabBarSpacer() {
  const clearance = useTabBarClearance();
  return <View style={{ height: clearance }} />;
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    bar: {
      position: "absolute",
      alignSelf: "center",
      flexDirection: "row",
      alignItems: "center",
      gap: space[1],
      padding: space[2],
      borderRadius: radius.full,
      backgroundColor: c.card,
      // A hairline for the theme where a shadow cannot be seen; a shadow for
      // the one where a hairline is not enough to lift a white pill off a
      // white page.
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      boxShadow: `0 8px 24px ${c.shadow}`,
    },

    chip: { borderRadius: radius.full },
    chipCurrent: { backgroundColor: c.place },
    chipCritical: { backgroundColor: c.status.criticalBg },

    tab: {
      flexDirection: "row",
      alignItems: "center",
      gap: space[2],
      height: 44,
      minWidth: 44,
      paddingHorizontal: space[3],
    },
    tabCurrent: { paddingHorizontal: space[4] },
    tabPressed: { opacity: 0.6 },

    label: {
      fontFamily: font.bodyMedium,
      fontSize: 14.5,
      letterSpacing: 0.1,
      color: c.placeForeground,
    },
  });
