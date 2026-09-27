import type { BookingReceipt } from "@/lib/booking";
import type { Palette } from "@/theme/tokens";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { formatDateLong, formatTime, formatWindow } from "@/lib/booking";
import { useStyles, useTheme } from "@/theme/theme";
import { font, radius, space } from "@/theme/tokens";

/**
 * The confirmation — the screen a patient screenshots and reads aloud to a
 * relative (PRD §6.3). The booking code and, for a clinic day, the position
 * are the biggest things on it and monospaced; the date is in full; the
 * arrival window is a range, never a point.
 *
 * Every value here is what the server wrote back. A reply with no code (a
 * database still without Gate C's columns) shows no code rather than a
 * placeholder, and says where the answer will be.
 */
export function BookingDone({
  receipt,
  startsAtIso,
  where,
  forMember,
}: {
  receipt: BookingReceipt;
  /** The clinic day's or the slot's start — the same instant the visits list prints. */
  startsAtIso: string;
  /** "{clinician or line} · {department} · {hospital}". */
  where: string;
  /** The household member this was booked for (Gate D) — named, so the code is read to the right person. */
  forMember?: string | null;
}) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const session = receipt.position_number !== null;
  const confirmed = receipt.status === "confirmed";
  const title = session
    ? "This place is yours"
    : confirmed
      ? "This time is yours"
      : "We asked the clinic for this time";

  return (
    <View style={styles.root}>
      {/* Decorative: the heading under it says what happened. */}
      <View
        style={styles.disc}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Ionicons name="checkmark" size={32} color={colors.accentForeground} />
      </View>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {forMember ? <Text style={styles.forMember}>For {forMember}</Text> : null}

      {receipt.booking_code ? (
        <View style={styles.codeCard}>
          <Text style={styles.eyebrow}>Booking code</Text>
          <Text
            style={styles.code}
            // Read out letter by letter, the way it is shown at a desk.
            accessibilityLabel={`Booking code ${receipt.booking_code.split("").join(" ")}`}
          >
            {receipt.booking_code}
          </Text>
          <Text style={styles.muted}>Show this at the desk.</Text>
        </View>
      ) : null}

      {session ? (
        <>
          <Text style={styles.position}>Position {receipt.position_number}</Text>
          <Text style={styles.when}>{formatDateLong(startsAtIso)}</Text>
          {receipt.arrival_window_start && receipt.arrival_window_end ? (
            <Text style={styles.when}>
              Arrive between{" "}
              {formatWindow(receipt.arrival_window_start, receipt.arrival_window_end)}
            </Text>
          ) : null}
        </>
      ) : (
        <Text style={styles.when}>
          {formatDateLong(startsAtIso)} · {formatTime(startsAtIso)}
        </Text>
      )}

      <Text style={styles.muted}>{where}</Text>
      {/* §11: no notification is promised — there is no transport that could
          carry one. What replaces it is where the answer will be. */}
      <Text style={styles.muted}>You will find the answer under Visits.</Text>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: {
      flexGrow: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: space[8],
      gap: space[3],
    },
    disc: {
      width: 72,
      height: 72,
      borderRadius: radius.full,
      backgroundColor: c.accent,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: space[2],
    },
    title: {
      fontFamily: font.display,
      fontSize: 28,
      lineHeight: 34,
      letterSpacing: -0.6,
      color: c.foreground,
      textAlign: "center",
    },
    forMember: {
      fontFamily: font.bodyMedium,
      fontSize: 15,
      lineHeight: 21,
      color: c.foreground,
      textAlign: "center",
      marginTop: -space[1],
    },
    codeCard: {
      alignSelf: "stretch",
      alignItems: "center",
      gap: space[1],
      padding: space[5],
      borderRadius: radius["2xl"],
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.border,
      marginVertical: space[2],
    },
    eyebrow: {
      fontFamily: font.body,
      fontSize: 12.5,
      letterSpacing: 0.3,
      color: c.mutedForeground,
    },
    code: {
      fontFamily: font.mono,
      fontSize: 40,
      lineHeight: 48,
      letterSpacing: 6,
      color: c.foreground,
    },
    position: {
      fontFamily: font.mono,
      fontSize: 24,
      lineHeight: 30,
      color: c.foreground,
      textAlign: "center",
    },
    when: {
      fontFamily: font.bodySemiBold,
      fontSize: 17,
      lineHeight: 23,
      color: c.foreground,
      textAlign: "center",
    },
    muted: {
      fontFamily: font.body,
      fontSize: 14.5,
      lineHeight: 21,
      color: c.mutedForeground,
      textAlign: "center",
      maxWidth: 300,
    },
  });
