import type { Palette } from "@/theme/tokens";
import { Ionicons } from "@expo/vector-icons";
import { Image, StyleSheet, Text, View } from "react-native";

import { useStyles, useTheme } from "@/theme/theme";
import { font, radius, withAlpha } from "@/theme/tokens";

/**
 * A person: their photograph when there is one, else a monogram.
 *
 * ADR 0085 §1: the photo is a signed URL the server (or `fetchMyAvatarUrl`)
 * handed over, and no photo means initials on the brand tint — never a
 * placeholder face, never a stock image. `tone="onPrimary"` is for the hero
 * card, where the tint would vanish into the teal.
 */
export function Avatar({
  name,
  size = 44,
  tone = "accent",
  uri,
}: {
  /** Initials are taken from this; empty or a fallback word draws a glyph instead. */
  name?: string | null;
  size?: 32 | 44 | 56 | 72;
  tone?: "accent" | "onPrimary";
  /** A signed photo URL; null or undefined draws the monogram. */
  uri?: string | null;
}) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const initials = initialsOf(name);
  const ink = tone === "onPrimary" ? colors.primaryForeground : colors.placeForeground;

  return (
    <View
      // Decorative: the name is always written beside it.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.disc,
        tone === "onPrimary" && styles.discOnPrimary,
        { width: size, height: size },
      ]}
    >
      {uri ? (
        <Image source={{ uri }} style={[styles.photo, { width: size, height: size }]} />
      ) : initials ? (
        <Text style={[styles.initials, { color: ink, fontSize: size * 0.36 }]}>{initials}</Text>
      ) : (
        <Ionicons name="person-outline" size={size * 0.45} color={ink} />
      )}
    </View>
  );
}

/** "Amina Okello" → "AO"; "Dr. Amina Okello" → "AO"; "Your clinician" → null. */
export function initialsOf(name?: string | null): string | null {
  if (!name) return null;
  const words = name
    .replace(/\b(dr|prof|mr|mrs|ms|sr)\.?\s+/gi, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0 || /^your\b/i.test(name)) return null;
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  const out = (first + last).toUpperCase();
  return out || null;
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    disc: {
      borderRadius: radius.full,
      backgroundColor: c.place,
      alignItems: "center",
      justifyContent: "center",
    },
    // A translucent white on the teal hero: the disc reads as part of the
    // card rather than a hole in it.
    discOnPrimary: { backgroundColor: withAlpha(c.primaryForeground, 0.18) },
    // Clipped to the disc; the tint shows through until the bytes arrive.
    photo: { borderRadius: radius.full },
    initials: { fontFamily: font.bodyMedium, letterSpacing: 0.5 },
  });
