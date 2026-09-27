import type { ThemePreference } from "@/theme/theme";
import type { Palette } from "@/theme/tokens";
import { useCallback, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Notifications from "expo-notifications";
import { useFocusEffect, useRouter } from "expo-router";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import {
  AVATAR_PICKER_OPTIONS,
  fetchMyAvatarUrl,
  fetchPatientProfile,
  uploadAvatar,
} from "@/lib/booking";
import { SMS_CONSENT_COPY } from "@/lib/consent-copy";
import { fetchSmsConsent, setSmsConsent } from "@/lib/notifications";
import { registerPushToken } from "@/lib/push";
import { useSession } from "@/lib/session";
import { useStyles, useTheme } from "@/theme/theme";
import { font, radius, space } from "@/theme/tokens";

/**
 * Settings — who is signed in (and their photograph), the theme, and the way out.
 *
 * The three options are a radio group, not a switch: "same as phone" is a
 * real third state, and a two-way toggle would have to hide it. The words
 * say what each does rather than naming a mode ("System" is what the phone
 * calls it, not what a patient does).
 */
const APPEARANCE: { value: ThemePreference; label: string; hint: string }[] = [
  { value: "system", label: "Same as phone", hint: "Follows the phone's light or dark setting." },
  { value: "light", label: "Light", hint: "Dark text on a white page." },
  { value: "dark", label: "Dark", hint: "Light text on a black page." },
];

export default function SettingsScreen() {
  const router = useRouter();
  const { session, signOut } = useSession();
  const { colors, preference, setPreference } = useTheme();
  const styles = useStyles(makeStyles);
  const [signingOut, setSigningOut] = useState(false);
  // The account holder, the same way the ticket names them: `full_name` is
  // what signup wrote to auth metadata.
  const fullName = session?.user.user_metadata?.full_name;
  const name = typeof fullName === "string" ? fullName : null;
  const [patientCode, setPatientCode] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  // Gate E: SMS consent (PRD §5.2) and where this phone stands on push.
  // `null` = not read yet; the rows draw nothing until they know.
  const [smsOn, setSmsOn] = useState<boolean | null>(null);
  const [smsBusy, setSmsBusy] = useState(false);
  const [smsError, setSmsError] = useState<string | null>(null);
  const [pushStatus, setPushStatus] = useState<"granted" | "denied" | "undetermined" | null>(null);

  // On focus, like the home. The code and the photo are conveniences on this
  // screen, not the screen: a failed read leaves the line out (or draws the
  // monogram) and says nothing.
  useFocusEffect(
    useCallback(() => {
      void fetchPatientProfile().then(
        (p) => setPatientCode(p?.patientCode ?? null),
        () => {},
      );
      void fetchMyAvatarUrl().then(setAvatarUrl);
      void fetchSmsConsent().then(setSmsOn, () => {});
      void Notifications.getPermissionsAsync().then(
        (p) =>
          setPushStatus(
            p.status === "granted" ? "granted" : p.status === "denied" ? "denied" : "undetermined",
          ),
        () => {},
      );
    }, []),
  );

  const toggleSms = async () => {
    if (smsOn === null || smsBusy) return;
    setSmsBusy(true);
    setSmsError(null);
    const res = await setSmsConsent(!smsOn);
    setSmsBusy(false);
    if (!res.ok) {
      setSmsError(res.error);
      return;
    }
    setSmsOn(res.data.on);
  };

  // Ask again while the phone still allows asking; after a refusal only the
  // phone's own Settings can turn it on, so that is where the row goes.
  const onPush = async () => {
    if (pushStatus === "denied") {
      await Linking.openSettings();
      return;
    }
    const token = await registerPushToken();
    setPushStatus(
      token
        ? "granted"
        : (await Notifications.getPermissionsAsync()).status === "denied"
          ? "denied"
          : "undetermined",
    );
  };

  // ADR 0085 §1: the system picker crops to a square and compresses, so what
  // reaches the bucket is already small. A cancelled pick is not an error and
  // says nothing; a failed upload says the one sentence `uploadAvatar` throws.
  const onChangePhoto = async () => {
    if (uploading) return;
    setPhotoError(null);
    try {
      const picked = await ImagePicker.launchImageLibraryAsync(AVATAR_PICKER_OPTIONS);
      const asset = picked.canceled ? null : picked.assets[0];
      if (!asset) return;
      setUploading(true);
      setAvatarUrl(await uploadAvatar(asset.uri, asset.mimeType ?? "image/jpeg"));
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : "Couldn't save your photo. Try again.");
    } finally {
      setUploading(false);
    }
  };

  const onSignOut = async () => {
    setSigningOut(true);
    try {
      // The gate drops this screen the moment the session is gone; nothing to
      // navigate to.
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <Screen title="Settings">
      <View style={styles.column}>
        <View style={styles.profile}>
          <View style={styles.profileRow}>
            <Avatar name={name} size={72} uri={avatarUrl} />
            <View style={styles.profileText}>
              {name ? <Text style={styles.profileName}>{name}</Text> : null}
              {patientCode ? (
                <Text style={styles.profileCode}>Patient code {patientCode}</Text>
              ) : null}
              <Button
                variant="link"
                label="Change photo"
                busy={uploading}
                onPress={() => void onChangePhoto()}
                style={styles.profileLink}
              />
            </View>
          </View>
          {photoError ? (
            <View style={styles.well}>
              <Ionicons name="alert-circle-outline" size={18} color={colors.status.cautionFg} />
              <Text style={styles.wellText} accessibilityLiveRegion="polite">
                {photoError}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Gate D: the household — adults this account books for (PRD §2.9). */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Household</Text>
          <View style={styles.group}>
            <Pressable
              accessibilityRole="button"
              accessibilityHint="Opens the people you book for"
              onPress={() => router.push("/(app)/household")}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>People I book for</Text>
                <Text style={styles.rowHint}>Book a visit for an adult in your household.</Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={20}
                color={colors.mutedForeground}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              />
            </Pressable>
          </View>
        </View>

        {/* Gate E (ADR 0090): how MedSync reaches this patient. State is a
            word, never a colour; the honest sentence sits under SMS when off. */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Messages</Text>
          <View style={styles.group}>
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>
                  Notifications on this phone ·{" "}
                  {pushStatus === "granted" ? "On" : pushStatus === null ? "…" : "Off"}
                </Text>
                <Text style={styles.rowHint}>
                  {pushStatus === "granted"
                    ? "Your confirmations, reminders and offers arrive here first."
                    : pushStatus === "denied"
                      ? "MedSync is not allowed to notify you. Turn it on in your phone's Settings."
                      : "Allow notifications so your reminders and offers reach this phone."}
                </Text>
              </View>
              {pushStatus !== null && pushStatus !== "granted" ? (
                <Button
                  variant="link"
                  label={pushStatus === "denied" ? "Open Settings" : "Allow"}
                  onPress={() => void onPush()}
                />
              ) : null}
            </View>
            {smsOn !== null ? (
              <View style={[styles.row, styles.rowDivider, styles.rowColumn]}>
                <View style={styles.rowTop}>
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel}>
                      {SMS_CONSENT_COPY.label} · {smsOn ? "On" : "Off"}
                    </Text>
                    <Text style={styles.rowHint}>{SMS_CONSENT_COPY.what}</Text>
                  </View>
                  <Button
                    variant="link"
                    label={smsOn ? "Turn off" : "Turn on"}
                    busy={smsBusy}
                    onPress={() => void toggleSms()}
                  />
                </View>
                {!smsOn ? (
                  <Text style={styles.rowHint}>
                    {SMS_CONSENT_COPY.declined} {SMS_CONSENT_COPY.receiptException}
                  </Text>
                ) : null}
                {smsError ? (
                  <View style={styles.well}>
                    <Ionicons
                      name="alert-circle-outline"
                      size={18}
                      color={colors.status.cautionFg}
                    />
                    <Text style={styles.wellText} accessibilityLiveRegion="polite">
                      {smsError}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Appearance</Text>
          <View accessibilityRole="radiogroup" style={styles.group}>
            {APPEARANCE.map((option, i) => {
              const selected = preference === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={option.label}
                  accessibilityHint={option.hint}
                  onPress={() => setPreference(option.value)}
                  style={({ pressed }) => [
                    styles.row,
                    i > 0 && styles.rowDivider,
                    pressed && styles.rowPressed,
                  ]}
                >
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel}>{option.label}</Text>
                    <Text style={styles.rowHint}>{option.hint}</Text>
                  </View>
                  {/* The check is the state made visible; the radio role and
                      `checked` carry it to a screen reader. */}
                  <Ionicons
                    name={selected ? "checkmark-circle" : "ellipse-outline"}
                    size={24}
                    color={selected ? colors.primary : colors.mutedForeground}
                  />
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.signOut}>
          <Button variant="secondary" label="Sign out" busy={signingOut} onPress={onSignOut} />
        </View>
      </View>
    </Screen>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    column: { flexGrow: 1, gap: space[8] },

    profile: {
      gap: space[3],
      padding: space[4],
      borderRadius: radius["2xl"],
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.border,
    },
    profileRow: { flexDirection: "row", alignItems: "center", gap: space[4] },
    profileText: { flex: 1, gap: 2 },
    // The link's own padding would push its word off the name's left edge.
    profileLink: { alignSelf: "flex-start", marginLeft: -space[2] },
    profileName: {
      fontFamily: font.bodySemiBold,
      fontSize: 17,
      lineHeight: 23,
      color: c.foreground,
    },
    profileCode: {
      fontFamily: font.body,
      fontSize: 13.5,
      lineHeight: 19,
      color: c.mutedForeground,
    },

    section: { gap: space[3] },
    sectionTitle: {
      fontFamily: font.body,
      fontSize: 12.5,
      letterSpacing: 0.4,
      textTransform: "uppercase",
      color: c.mutedForeground,
      marginLeft: space[4],
    },
    group: {
      borderRadius: radius["2xl"],
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.border,
      overflow: "hidden",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: space[3],
      minHeight: 56,
      paddingHorizontal: space[4],
      paddingVertical: space[3],
    },
    rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    // A row that carries a sentence under its controls.
    rowColumn: { flexDirection: "column", alignItems: "stretch", gap: space[2] },
    rowTop: { flexDirection: "row", alignItems: "center", gap: space[3] },
    rowPressed: { backgroundColor: c.muted },
    rowText: { flex: 1, gap: 2 },
    rowLabel: { fontFamily: font.bodyMedium, fontSize: 16, lineHeight: 22, color: c.foreground },
    rowHint: { fontFamily: font.body, fontSize: 13.5, lineHeight: 19, color: c.mutedForeground },

    signOut: { marginTop: "auto", paddingTop: space[6] },

    // Amber, not red: a photo that did not save is not a clinical emergency.
    // The amber is the frame and the glyph; the words carry the meaning.
    well: {
      flexDirection: "row",
      gap: space[2],
      alignItems: "flex-start",
      padding: space[3],
      borderRadius: radius.lg,
      backgroundColor: c.status.cautionBg,
      borderWidth: 1,
      borderColor: c.status.cautionFg,
    },
    wellText: {
      flex: 1,
      fontFamily: font.body,
      fontSize: 14.5,
      lineHeight: 21,
      color: c.foreground,
    },
  });
