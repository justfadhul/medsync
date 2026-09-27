import type { Palette } from "@/theme/tokens";
import type { ReactNode } from "react";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { useStyles, useTheme } from "@/theme/theme";
import { font, radius, space } from "@/theme/tokens";

/**
 * The empty state.
 *
 * On day one this is the common case, not the edge case: a patient who has
 * just signed up has no visits, no place in line and no history, and the first
 * thing the app shows them is this. So it is composed as a real screen — a
 * mark, a line that says what the state means, and the way out — rather than a
 * grey sentence where a list should have been.
 *
 * `action` takes a node rather than a label and a handler so the call site
 * passes a real `<Button />` and picks its own variant. An empty list on the
 * visits screen wants a primary; one inside a section wants a link.
 */
export function Empty({
  icon,
  title,
  hint,
  action,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  /** What the state means, in a sentence. */
  title: string;
  /** Optional second line — what to do about it. */
  hint?: string;
  action?: ReactNode;
}) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);

  return (
    <View style={styles.root}>
      {/* Decorative. The text carries the meaning, so the glyph is hidden from
          screen readers rather than given a name that repeats the title. */}
      <View
        style={styles.disc}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Ionicons name={icon} size={26} color={colors.placeForeground} />
      </View>

      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: {
      flexGrow: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: space[12],
      gap: space[4],
    },
    disc: {
      width: 64,
      height: 64,
      borderRadius: radius.full,
      backgroundColor: c.place,
      alignItems: "center",
      justifyContent: "center",
    },
    title: {
      fontFamily: font.bodySemiBold,
      fontSize: 20,
      lineHeight: 27,
      letterSpacing: -0.3,
      color: c.foreground,
      textAlign: "center",
    },
    hint: {
      fontFamily: font.body,
      fontSize: 14.5,
      lineHeight: 21,
      color: c.mutedForeground,
      textAlign: "center",
      // Keeps the line short enough to read in one sweep.
      maxWidth: 300,
      marginTop: -space[2],
    },
    action: { width: "100%", maxWidth: 320, marginTop: space[2], alignItems: "center" },
  });
