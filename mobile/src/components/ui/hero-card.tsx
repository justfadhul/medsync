import type { Palette } from "@/theme/tokens";
import type { ReactNode } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useStyles, useTheme } from "@/theme/theme";
import { font, radius, space, withAlpha } from "@/theme/tokens";

/**
 * The one card on a page that is about a single thing in motion — the next
 * visit, the place saved today, the visit being looked at. Brand fill, light
 * ink, the person on the left, the facts in two tiles, the actions along the
 * bottom. It is the reference design's blue appointment card, and there is at
 * most one on a screen.
 *
 * `tiles` are the facts the row proves — a day and its clock time (ADR 0085
 * §3), a day-part for the walk-in queue, a department — never a count the
 * engine did not derive (ADR 0084 §6). The tint behind each is
 * the card's own ink at low alpha rather than a palette role — white on the
 * light theme's teal, deep teal on the dark theme's pale teal — because
 * every other role would fight the fill.
 */
export function HeroCard({
  leading,
  eyebrow,
  title,
  subtitle,
  trailing,
  tiles,
  actions,
}: {
  /** An `Avatar` with `tone="onPrimary"`, usually. */
  leading?: ReactNode;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** A small control on the title row — a `Pill`, or an `IconButton tone="onPrimary"`. */
  trailing?: ReactNode;
  tiles?: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }[];
  /** A row of `HeroAction`s. */
  actions?: ReactNode;
}) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        {leading}
        <View style={styles.headText}>
          {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {trailing}
      </View>

      {tiles && tiles.length > 0 ? (
        <View style={styles.tiles}>
          {tiles.map((t) => (
            <View key={t.label} style={styles.tile}>
              {/* Decorative: the label beside it names the fact. */}
              <View
                style={styles.tileIcon}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <Ionicons name={t.icon} size={16} color={colors.primaryForeground} />
              </View>
              <View style={styles.tileText}>
                <Text style={styles.tileLabel}>{t.label}</Text>
                <Text style={styles.tileValue} numberOfLines={2}>
                  {t.value}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
}

/**
 * A button that lives on the hero. `primary` is the white pill (the
 * reference's "Re-Schedule"); `ghost` the translucent one beside it.
 */
export function HeroAction({
  label,
  onPress,
  variant = "ghost",
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "ghost";
}) {
  const styles = useStyles(makeStyles);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        variant === "primary" && styles.actionPrimary,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.actionLabel, variant === "primary" && styles.actionLabelPrimary]}>
        {label}
      </Text>
    </Pressable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: {
      padding: space[4],
      borderRadius: radius["2xl"],
      backgroundColor: c.primary,
      gap: space[4],
      // The card's own colour as its shadow — a teal card casting a grey
      // shadow looks cut out and pasted on; casting its own tint it looks
      // lit. Visible on the dark page too, where a black shadow would not be.
      boxShadow: `0 10px 28px ${withAlpha(c.primary, 0.28)}`,
    },
    head: { flexDirection: "row", alignItems: "center", gap: space[3] },
    headText: { flex: 1, gap: 2 },
    eyebrow: {
      fontFamily: font.body,
      fontSize: 12.5,
      letterSpacing: 0.3,
      color: c.primaryForeground,
      opacity: 0.8,
    },
    title: {
      fontFamily: font.bodySemiBold,
      fontSize: 17,
      lineHeight: 23,
      color: c.primaryForeground,
    },
    subtitle: { fontFamily: font.body, fontSize: 13.5, color: c.primaryForeground, opacity: 0.8 },

    tiles: { flexDirection: "row", gap: space[2] },
    tile: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: space[2],
      padding: space[3],
      borderRadius: radius.lg,
      backgroundColor: withAlpha(c.primaryForeground, 0.14),
    },
    tileIcon: {
      width: 28,
      height: 28,
      borderRadius: radius.full,
      backgroundColor: withAlpha(c.primaryForeground, 0.18),
      alignItems: "center",
      justifyContent: "center",
    },
    tileText: { flex: 1 },
    // 0.9, not the eyebrow's 0.8: on the tinted tile the lighter ink lands at
    // 4.07:1 in light, and 12px text needs 4.5.
    tileLabel: { fontFamily: font.body, fontSize: 12, color: c.primaryForeground, opacity: 0.9 },
    tileValue: {
      fontFamily: font.bodyMedium,
      fontSize: 14,
      lineHeight: 19,
      color: c.primaryForeground,
    },

    actions: { flexDirection: "row", gap: space[2] },
    action: {
      flex: 1,
      minHeight: 44,
      paddingHorizontal: space[3],
      borderRadius: radius.full,
      backgroundColor: withAlpha(c.primaryForeground, 0.14),
      alignItems: "center",
      justifyContent: "center",
    },
    actionPrimary: { backgroundColor: c.primaryForeground },
    actionLabel: { fontFamily: font.bodyMedium, fontSize: 14.5, color: c.primaryForeground },
    actionLabelPrimary: { color: c.primary },
    pressed: { opacity: 0.7 },
  });
