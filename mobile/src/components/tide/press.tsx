import type { ReactNode } from "react";
import type {
  AccessibilityRole,
  AccessibilityState,
  Insets,
  LayoutChangeEvent,
  StyleProp,
  ViewStyle,
} from "react-native";
import { useState } from "react";
import * as Haptics from "expo-haptics";
import { Pressable, StyleSheet } from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";

import { transition } from "@/motion/presets";

/**
 * Every Tide pressable: shrinks to 0.96 while held (160ms) with a light
 * haptic, the `press` preset. Under reduce motion it does not move; the
 * haptic stays, because it is feedback, not motion.
 *
 * The scale lives on an inner view so the hit area never shrinks under the
 * thumb. A control drawn smaller than 44 × 44 pt still takes a 44 pt touch
 * (Apple HIG, Buttons and Accessibility): the hit region grows around it.
 */
export function Press({
  onPress,
  children,
  style,
  disabled = false,
  accessibilityLabel,
  accessibilityRole = "button",
  accessibilityState,
  accessibilityHint,
  hitSlop,
  haptic = true,
  testID,
}: {
  onPress?: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: AccessibilityState;
  accessibilityHint?: string;
  hitSlop?: number | Insets;
  haptic?: boolean;
  testID?: string;
}) {
  const reduced = useReducedMotion();
  const [held, setHeld] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  // How the control sits in its parent (flex, width, margins) belongs on the
  // pressable; how it looks belongs on the view that scales.
  const { outer, inner } = splitStyle(style);
  return (
    <Pressable
      style={outer}
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      hitSlop={minHitSlop(size, hitSlop)}
      onLayout={(e: LayoutChangeEvent) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        if (w !== size?.w || h !== size?.h) setSize({ w, h });
      }}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, ...accessibilityState }}
      onPressIn={() => {
        setHeld(true);
        if (haptic) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }}
      onPressOut={() => setHeld(false)}
    >
      <Animated.View
        style={[
          inner,
          transition.press(reduced),
          { transform: [{ scale: held && !reduced && !disabled ? 0.96 : 1 }] },
        ]}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
}

/** Apple's minimum touch target, in points. */
export const MIN_HIT = 44;

/** The caller's hit slop, grown on each side as needed so the touch is at least 44 × 44. */
export function minHitSlop(
  size: { w: number; h: number } | null,
  slop?: number | Insets,
): Insets | undefined {
  const base: Insets =
    typeof slop === "number" ? { top: slop, bottom: slop, left: slop, right: slop } : (slop ?? {});
  if (!size) return slop === undefined ? undefined : base;
  const v = Math.max(0, (MIN_HIT - size.h) / 2);
  const h = Math.max(0, (MIN_HIT - size.w) / 2);
  return {
    top: Math.max(base.top ?? 0, v),
    bottom: Math.max(base.bottom ?? 0, v),
    left: Math.max(base.left ?? 0, h),
    right: Math.max(base.right ?? 0, h),
  };
}

const OUTER_KEYS = new Set([
  "flex",
  "flexGrow",
  "flexShrink",
  "flexBasis",
  "alignSelf",
  "width",
  "minWidth",
  "maxWidth",
  "margin",
  "marginTop",
  "marginBottom",
  "marginLeft",
  "marginRight",
  "marginHorizontal",
  "marginVertical",
  "position",
  "top",
  "left",
  "right",
  "bottom",
  "zIndex",
]);

function splitStyle(style: StyleProp<ViewStyle>): { outer: ViewStyle; inner: ViewStyle } {
  const flat = (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
  const outer: Record<string, unknown> = {};
  const inner: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flat)) (OUTER_KEYS.has(k) ? outer : inner)[k] = v;
  // A control told to fill its row must fill it on the inside too.
  if (outer.flex !== undefined || outer.width !== undefined || outer.alignSelf === "stretch")
    inner.flexGrow = 1;
  return { outer: outer as ViewStyle, inner: inner as ViewStyle };
}
