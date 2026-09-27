import type { Palette } from "@/theme/tokens";
import { Ionicons } from "@expo/vector-icons";
import { Linking, StyleSheet, Text, View } from "react-native";

import { EmergencyButton } from "@/components/patient/emergency-button";
import { Button } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { useStyles, useTheme } from "@/theme/theme";
import { font, radius, space } from "@/theme/tokens";

/**
 * ⚠ PROVISIONAL — PENDING CLINICAL SAFETY OFFICER SIGN-OFF. ⚠
 *
 * The emergency interstitial (PRD §2.5, ADR 0088 C9): a full-screen static
 * card shown ONCE per booking flow, the moment the patient picks a reason in
 * the "new or worsening problem" family and BEFORE any capacity step. It
 * intercepts at the exact point where a booking becomes a dangerous delay —
 * and it asks nothing. No question, no symptom list, no severity words, no
 * conditional; one dismiss action continues to booking.
 *
 * Byte-identical to the web's interstitial; the strings are the decision.
 * Amber, never red: red on a MedSync surface means a clinician has declared
 * a life threat, and this is a signpost.
 */
export const INTERSTITIAL_TITLE = "Booking is for care that can wait.";
export const INTERSTITIAL_BODY =
  "If this cannot wait, do not book. Go to the nearest emergency unit now.";
export const INTERSTITIAL_DISMISS = "Continue to book";

export function BookingInterstitial({
  hospitalName,
  emergencyPhone,
  onContinue,
}: {
  hospitalName?: string | null;
  /**
   * `hospitals.emergency_phone` of the hospital being booked — verified at
   * activation or null. Null shows no Call control; a guessed number here
   * would be the most dangerous fabricated datum in the product.
   */
  emergencyPhone?: string | null;
  onContinue: () => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);

  // The same digit-presence check the emergency block makes: a value with no
  // digit in it is not a number anyone can ring.
  const phone = emergencyPhone?.trim();
  const dialable = phone && /\d/.test(phone) ? phone : null;

  return (
    <Screen
      trailing={<EmergencyButton />}
      footer={<Button label={INTERSTITIAL_DISMISS} onPress={onContinue} />}
    >
      <View style={styles.root}>
        {/* Decorative: the heading under it says what this is. */}
        <View
          style={styles.disc}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Ionicons name="warning-outline" size={28} color={colors.status.cautionFg} />
        </View>
        <Text accessibilityRole="header" style={styles.title}>
          {INTERSTITIAL_TITLE}
        </Text>
        <Text style={styles.body}>{INTERSTITIAL_BODY}</Text>
        {dialable ? (
          <Button
            variant="secondary"
            label={`Call ${dialable}`}
            accessibilityLabel={hospitalName ? `Call ${dialable}, ${hospitalName}` : undefined}
            onPress={() => {
              Linking.openURL(`tel:${dialable.replace(/[^\d+]/g, "")}`).catch(() => {});
            }}
            style={styles.call}
          />
        ) : null}
      </View>
    </Screen>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: {
      flexGrow: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: space[8],
      gap: space[4],
    },
    disc: {
      width: 72,
      height: 72,
      borderRadius: radius.full,
      backgroundColor: c.status.cautionBg,
      alignItems: "center",
      justifyContent: "center",
    },
    title: {
      fontFamily: font.display,
      fontSize: 28,
      lineHeight: 34,
      letterSpacing: -0.6,
      color: c.foreground,
      textAlign: "center",
    },
    body: {
      fontFamily: font.bodySemiBold,
      fontSize: 17,
      lineHeight: 25,
      color: c.foreground,
      textAlign: "center",
      maxWidth: 320,
    },
    call: { marginTop: space[2], alignSelf: "stretch" },
  });
