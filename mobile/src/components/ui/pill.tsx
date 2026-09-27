import type { Palette, TagHue } from "@/theme/tokens";
import { StyleSheet, Text, View } from "react-native";

import { useStyles, useTheme } from "@/theme/theme";
import { font, radius, space } from "@/theme/tokens";

/**
 * The status chip on an appointment — a Chroma tag (ADR 0162).
 *
 * Three rules govern it, and they are not stylistic.
 *
 * 1. **Never colour alone.** Every chip carries a word a patient can read, and
 *    the word is the whole message. A patient who cannot tell the hues apart
 *    loses nothing.
 * 2. **A booking state is not a clinical state.** Red, amber and green belong
 *    to the patient's clinical signals, so an appointment's state is a square
 *    tag with a dot in a cool hue: teal for "going ahead", iris for "waiting
 *    on the clinic", sky for "happening now", slate for "over".
 * 3. **Same words, same hues as the web.** The words are lifted verbatim from
 *    `lib/patient/appointments.ts`'s `STATUS_LABEL` and the hues from its
 *    `STATUS_TONES`, so a patient who books on the phone and then opens the
 *    web app reads the same chip about the same appointment.
 */
const STATUS: Record<string, { hue: TagHue; word: string }> = {
  requested: { hue: "iris", word: "Requested" },
  pending_approval: { hue: "iris", word: "Awaiting approval" },
  confirmed: { hue: "teal", word: "Confirmed" },
  arrived: { hue: "sky", word: "You've arrived" },
  in_progress: { hue: "sky", word: "In progress" },
  completed: { hue: "slate", word: "Completed" },
  cancelled: { hue: "slate", word: "Cancelled" },
  no_show: { hue: "slate", word: "Missed" },
  rescheduled: { hue: "slate", word: "Rescheduled" },
  declined: { hue: "slate", word: "Declined" },
};

export function Pill({ status }: { status: string }) {
  const entry = STATUS[status];
  // A value outside the ten renders nothing rather than printing the raw enum
  // at a patient. The column has a CHECK constraint, so this is insurance
  // against a future status shipped on the server before it ships here — and
  // a missing chip is recoverable, `no_show` spelt at someone is not.
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  if (!entry) return null;
  const t = colors.tag[entry.hue];

  return (
    <View style={[styles.tag, { backgroundColor: t.bg, borderColor: t.edge }]}>
      <View style={[styles.dot, { backgroundColor: t.dot }]} />
      <Text style={[styles.word, { color: t.text }]}>{entry.word}</Text>
    </View>
  );
}

const makeStyles = (_c: Palette) =>
  StyleSheet.create({
    // Square corners and a dot: a tag, never confused with a round clinical status.
    tag: {
      alignSelf: "flex-start",
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      minHeight: 24,
      paddingLeft: 7,
      paddingRight: space[2],
      borderWidth: 1,
      borderRadius: radius.sm,
    },
    dot: { width: 7, height: 7, borderRadius: radius.full },
    word: { fontFamily: font.bodyMedium, fontSize: 12.5 },
  });
