import type { Palette } from "@/theme/tokens";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useStyles, useTheme } from "@/theme/theme";
import { font, space } from "@/theme/tokens";

/**
 * A clinician's rating — "★ 4.8 · 12 reviews" — or the honest absence of
 * one: "No ratings yet" (ADR 0085 §2).
 *
 * Every number here came from `clinician_rating_summary`, which is built from
 * `visit_ratings` rows patients wrote after visits that happened. Nothing is
 * rounded up, padded, or invented on day one. The star is in the page's own
 * ink: amber is a clinical signal under MedSync Chroma (ADR 0162), never
 * decoration, and red stays the emergency affordance's.
 */
export function Rating({
  rating,
  size = "md",
}: {
  rating: { average: number; count: number } | null;
  size?: "sm" | "md";
}) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const sm = size === "sm";

  if (!rating) return <Text style={[styles.muted, sm && styles.mutedSm]}>No ratings yet</Text>;

  const reviews = `${rating.count} ${rating.count === 1 ? "review" : "reviews"}`;
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`${rating.average.toFixed(1)} out of 5, ${reviews}`}
    >
      <Ionicons name="star" size={sm ? 14 : 16} color={colors.foreground} />
      <Text style={[styles.number, sm && styles.numberSm]}>{rating.average.toFixed(1)}</Text>
      <Text style={[styles.muted, sm && styles.mutedSm]}>· {reviews}</Text>
    </View>
  );
}

const STARS = [1, 2, 3, 4, 5] as const;

/**
 * Five stars to tap — the input side of `Rating`. A radiogroup, so a screen
 * reader hears "3 stars, selected" rather than five nameless glyphs.
 */
export function StarInput({
  value,
  onChange,
}: {
  /** 1–5, or null for nothing chosen yet. */
  value: number | null;
  onChange: (stars: number) => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);

  return (
    <View accessibilityRole="radiogroup" style={styles.input}>
      {STARS.map((n) => {
        const lit = value !== null && n <= value;
        return (
          <Pressable
            key={n}
            accessibilityRole="radio"
            accessibilityState={{ checked: n === value }}
            accessibilityLabel={n === 1 ? "1 star" : `${n} stars`}
            onPress={() => onChange(n)}
            style={({ pressed }) => [styles.star, pressed && styles.pressed]}
          >
            <Ionicons
              name={lit ? "star" : "star-outline"}
              size={28}
              color={lit ? colors.foreground : colors.mutedForeground}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: space[1] },
    number: { fontFamily: font.bodyMedium, fontSize: 14, lineHeight: 19, color: c.foreground },
    numberSm: { fontSize: 13.5, lineHeight: 18 },
    muted: { fontFamily: font.body, fontSize: 13.5, lineHeight: 19, color: c.mutedForeground },
    mutedSm: { fontSize: 12.5, lineHeight: 17 },

    input: { flexDirection: "row", gap: space[1] },
    // A 44px target per star, like every other tappable thing.
    star: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    pressed: { opacity: 0.6 },
  });
