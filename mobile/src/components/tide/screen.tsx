import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { Children, isValidElement, useState } from "react";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ScrollView, Text, View } from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/components/tide/icon";
import { KeyboardFrame, useKeyboardAware } from "@/components/tide/keyboard";
import { Press } from "@/components/tide/press";
import { DemoRibbon } from "@/components/tide/primitives";
import { NAV_H } from "@/components/tide/tide-nav";
import { track } from "@/lib/analytics";
import { motion } from "@/motion/presets";
import { useTide } from "@/theme/theme";
import { tRadius, tSpace, tType } from "@/theme/tide";

/** Room left under scrolling content on a tab screen so it clears the floating nav. */
export const NAV_CLEARANCE = 130;

/** How tall the soft fade under the header is. */
const EDGE_FADE = 28;
/** The floating nav's gap above the home indicator (the tabs layout's `bottom: 14 + inset`). */
const NAV_BOTTOM = 14;

/**
 * The page colour with no opacity, for the end of the fade. A plain
 * "transparent" is clear black and greys the middle of the fade on iOS.
 */
export function clearOf(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}00` : "transparent";
}

/**
 * The red Help control (law L6). Round with the accessible label
 * "Help, emergency", or a pill carrying the word where the board shows it
 * (Home, Visit detail). It is on every screen: `<Screen>` renders it unless
 * the screen IS Help, and the route-crawl test fails a route without one.
 */
export function HelpButton({
  variant = "round",
  source,
}: {
  variant?: "round" | "pill";
  /** The route it was pressed on, for `help_opened`. */
  source?: string;
}) {
  const t = useTide();
  const router = useRouter();
  const open = () => {
    track("help_opened", { source: source ?? "unknown" });
    router.push("/help");
  };
  if (variant === "pill")
    return (
      <Press
        onPress={open}
        accessibilityLabel="Help, emergency"
        style={{
          height: 40,
          paddingLeft: 10,
          paddingRight: 13,
          borderRadius: tRadius.pill,
          backgroundColor: t.emergency,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          boxShadow: t.shadow.emergency,
        }}
        hitSlop={4}
      >
        <Icon name="phone" size={16} color={t.onEmergency} strokeWidth={2} />
        <Text style={[tType.label, { fontSize: 15, color: t.onEmergency }]}>Help</Text>
      </Press>
    );
  return (
    <Press
      onPress={open}
      accessibilityLabel="Help, emergency"
      style={{
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: t.emergency,
        alignItems: "center",
        justifyContent: "center",
        boxShadow: t.shadow.emergency,
      }}
    >
      <Icon name="phone" size={20} color={t.onEmergency} strokeWidth={2} />
    </Press>
  );
}

/**
 * The bell. Opens Notifications from anywhere; the count is ink on surface,
 * never red. With unseen notifications it turns teal and rings now and then
 * (`motion.bellRing`), so "something new" never rests on colour alone.
 */
export function BellButton({ count = 0, raised = false }: { count?: number; raised?: boolean }) {
  const t = useTide();
  const router = useRouter();
  const reduced = useReducedMotion();
  const unseen = count > 0;
  const fill = unseen ? t.accent : raised ? t.surface : "transparent";
  const ground = unseen ? t.accent : raised ? t.surface : t.bg;
  return (
    <Press
      onPress={() => router.push("/notifications")}
      accessibilityLabel={unseen ? `Notifications, ${count} new` : "Notifications"}
      style={{
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: fill,
        boxShadow: raised || unseen ? t.shadow.card : undefined,
      }}
    >
      <Animated.View
        key={unseen ? "ring" : "still"}
        style={[{ transformOrigin: "50% 8%" }, unseen ? motion.bellRing(reduced) : null]}
      >
        <Icon name="bell" size={22} color={unseen ? t.onAccent : t.ink} />
      </Animated.View>
      {unseen ? (
        <View
          style={{
            position: "absolute",
            top: 3,
            right: 3,
            minWidth: 17,
            height: 17,
            paddingHorizontal: 4,
            borderRadius: 9,
            backgroundColor: t.primary,
            alignItems: "center",
            justifyContent: "center",
            boxShadow: `0px 0px 0px 2px ${ground}`,
          }}
        >
          <Text style={[tType.micro, { fontSize: 11, color: t.onPrimary }]}>{count}</Text>
        </View>
      ) : null}
    </Press>
  );
}

/** "‹ Care": the back control with the name of where it goes. */
export function BackLink({
  label,
  onPress,
  color,
  icon = "back",
}: {
  label?: string;
  onPress?: () => void;
  color?: string;
  icon?: "back" | "close";
}) {
  const t = useTide();
  const router = useRouter();
  const fg = color ?? t.ink;
  return (
    <Press
      onPress={onPress ?? (() => router.back())}
      accessibilityLabel={label ? `Back to ${label}` : icon === "close" ? "Close" : "Back"}
      style={{
        minHeight: 44,
        minWidth: 44,
        paddingHorizontal: tSpace[2.5],
        borderRadius: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
      }}
    >
      <Icon name={icon} size={icon === "close" ? 20 : 22} color={fg} />
      {label ? <Text style={[tType.label, { fontSize: 15, color: fg }]}>{label}</Text> : null}
    </Press>
  );
}

/**
 * The frame every Tide screen sits in.
 *
 * Header row: a back link (or a custom `header`), then `headerRight`, the bell
 * and the red Help. Below it the overline, the display title and the content,
 * which scrolls, rises in on mount (`pageIn`) and staggers its children
 * (`staggerUp`). Tab screens pass `underNav` so the last card clears the
 * floating nav. Fixture-fed screens pass `demo` for the ribbon (law L1).
 */
export function Screen({
  children,
  back,
  header,
  headerRight,
  bell,
  help = "round",
  helpSource,
  overline,
  overlineColor,
  title,
  subtitle,
  demo = false,
  underNav = false,
  footer,
  scroll = true,
  gap = tSpace[4],
  stagger = true,
  contentStyle,
  background,
  topBand,
  growLast = false,
  bounce = true,
}: {
  children: ReactNode;
  back?: { label?: string; onPress?: () => void; icon?: "back" | "close" };
  /** Replaces the back link on the left of the header (Home's greeting). */
  header?: ReactNode;
  headerRight?: ReactNode;
  /** Show the bell; a number shows a count badge. */
  bell?: boolean | number;
  /** `none` only for Help itself, which is the destination. */
  help?: "round" | "pill" | "none";
  helpSource?: string;
  overline?: string;
  overlineColor?: string;
  title?: string;
  subtitle?: string;
  demo?: boolean;
  underNav?: boolean;
  footer?: ReactNode;
  scroll?: boolean;
  gap?: number;
  stagger?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  background?: string;
  /** A full-bleed band drawn under the header (Visit detail, Help). */
  topBand?: ReactNode;
  /** The last child stretches to the bottom of the screen (a sheet-style card under a band, Sign in). */
  growLast?: boolean;
  /** Off where stretching past the end would show the wrong colour (a white card over a navy page). */
  bounce?: boolean;
}) {
  const t = useTide();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const { scrollRef, keyboardShown } = useKeyboardAware();
  const bg = background ?? t.bg;
  // True once the content has moved under the header: then it fades out there instead of
  // stopping at a hard line. Set only when it changes, not on every scroll event.
  const [scrolled, setScrolled] = useState(false);

  const headerRow = (
    <View
      style={{
        paddingTop: insets.top + 6,
        paddingLeft: header ? tSpace[5] : tSpace[2.5],
        paddingRight: tSpace[5],
        flexDirection: "row",
        alignItems: "center",
        gap: tSpace[2],
        minHeight: insets.top + 50,
      }}
    >
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center" }}>
        {header ?? (back ? <BackLink {...back} /> : null)}
      </View>
      {headerRight}
      {bell ? <BellButton count={typeof bell === "number" ? bell : 0} raised={!header} /> : null}
      {help !== "none" ? <HelpButton variant={help} source={helpSource} /> : null}
    </View>
  );

  const heading =
    title || overline ? (
      <View style={{ gap: tSpace[1] }}>
        {overline ? (
          <Text style={[tType.overline, { color: overlineColor ?? t.ink3 }]}>{overline}</Text>
        ) : null}
        {title ? (
          <Text accessibilityRole="header" style={[tType.display, { color: t.ink }]}>
            {title}
          </Text>
        ) : null}
        {subtitle ? <Text style={[tType.bodyM, { color: t.ink2 }]}>{subtitle}</Text> : null}
      </View>
    ) : null;

  const items = [
    demo ? <DemoRibbon key="__demo" /> : null,
    heading,
    ...Children.toArray(children),
  ].filter((c) => c !== null);
  const body = items.map((child, i) => (
    <Animated.View
      key={isValidElement(child) && child.key != null ? String(child.key) : `i${i}`}
      style={[
        stagger && !underNav ? motion.staggerUp(i, reduced) : undefined,
        growLast && i === items.length - 1 ? { flexGrow: 1 } : undefined,
      ]}
    >
      {child}
    </Animated.View>
  ));

  const padding: ViewStyle = {
    paddingHorizontal: tSpace[5],
    paddingTop: tSpace[1],
    paddingBottom: underNav
      ? NAV_CLEARANCE + insets.bottom
      : footer
        ? tSpace[6]
        : tSpace[10] + insets.bottom,
    gap,
  };

  return (
    // A tab page (underNav) appears at once: an entrance starting from transparent could stall
    // while the tab navigator swaps scenes and leave the page white (owner report, 18 Oct 2026).
    <Animated.View
      style={[{ flex: 1, backgroundColor: bg }, underNav ? undefined : motion.pageIn(reduced)]}
    >
      <StatusBar style={t.scheme === "dark" ? "light" : "dark"} />
      {topBand}
      {headerRow}
      <KeyboardFrame>
        {scroll ? (
          <View style={{ flex: 1 }}>
            <ScrollView
              ref={scrollRef}
              style={{ flex: 1 }}
              contentContainerStyle={[padding, contentStyle]}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              bounces={bounce}
              overScrollMode={bounce ? "auto" : "never"}
              showsVerticalScrollIndicator={false}
              scrollEventThrottle={32}
              onScroll={(e) => {
                const next = e.nativeEvent.contentOffset.y > 2;
                if (next !== scrolled) setScrolled(next);
              }}
            >
              {body}
            </ScrollView>
            {/* The soft edge under the header: the page colour fading to clear. */}
            <Animated.View
              pointerEvents="none"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: EDGE_FADE,
                opacity: scrolled ? 1 : 0,
                transitionProperty: "opacity",
                transitionDuration: reduced ? 0 : 150,
              }}
            >
              <LinearGradient colors={[bg, clearOf(bg)]} style={{ flex: 1 }} />
            </Animated.View>
            {underNav ? (
              /* The same soft edge behind the floating nav: content melts into the page colour
                 before it reaches the bar, instead of showing round its corners. */
              <LinearGradient
                pointerEvents="none"
                colors={[clearOf(bg), bg, bg]}
                locations={[0, 0.45, 1]}
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: NAV_BOTTOM + NAV_H + insets.bottom + EDGE_FADE,
                }}
              />
            ) : null}
          </View>
        ) : (
          <View style={[{ flex: 1 }, padding, contentStyle]}>{body}</View>
        )}
        {footer ? (
          <View
            style={{
              paddingHorizontal: tSpace[5],
              paddingTop: tSpace[3],
              // On top of the keyboard there is no home indicator to clear.
              paddingBottom: keyboardShown
                ? tSpace[3]
                : Math.max(insets.bottom, tSpace[4]) + tSpace[2],
              backgroundColor: bg,
              gap: tSpace[2],
            }}
          >
            {footer}
          </View>
        ) : null}
      </KeyboardFrame>
    </Animated.View>
  );
}
