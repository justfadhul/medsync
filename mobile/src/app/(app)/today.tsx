import type { HospitalOption, PatientProfile, WalkInDepartment } from "@/lib/booking";
import type { Palette } from "@/theme/tokens";
import { useCallback, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { EmergencyButton } from "@/components/patient/emergency-button";
import { Button } from "@/components/ui/button";
import { Chip, ChipRow } from "@/components/ui/chip";
import { Empty } from "@/components/ui/empty";
import { Screen } from "@/components/ui/screen";
import { Section } from "@/components/ui/section";
import {
  choosePrimaryHospital,
  declareIntake,
  fetchHospitals,
  fetchLiveIntake,
  fetchPatientProfile,
  fetchWalkInDepartments,
} from "@/lib/booking";
import { clearPendingCatalogDraft, getPendingCatalogDraft } from "@/lib/pending-symptoms";
import { useStyles, useTheme } from "@/theme/theme";
import { font, radius, space } from "@/theme/tokens";

/**
 * Door A — "Coming to the hospital today" (ADR 0084 §1, §2), the primary door.
 *
 * One POST. The screen asks as little as it can:
 *
 *   - **The department is not a question the patient answers (§5).** The ADR
 *     wants the hospital's general-outpatient / assessment department
 *     pre-selected, with the rest behind a disclosure. No column marks such a
 *     row — `hospital_departments` is (id, hospital_id, parent_id, name, slug)
 *     — and guessing it from the NAME would be a heuristic deciding where a
 *     patient is sent, which is exactly what §5 forbids. So the interim the
 *     web already runs: one department open → it is named, not chosen; more
 *     than one → a flat, unpriced list. No count on any department, ever.
 *   - **Closed is not a calendar (§11).** When no department is open the
 *     primary exit is the building, and booking is a plain text link.
 *   - **A refusal because a ticket already exists is not an error.** The
 *     transport keeps only the server's sentence, so the ticket is recovered
 *     by re-reading it: if a live one exists, the patient is taken there
 *     instead of being shown a message they cannot act on.
 */
export default function TodayScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);

  // `undefined` until the profile is in; by then it has a hospital, or the
  // screen has already left.
  const [profile, setProfile] = useState<PatientProfile | undefined>();
  const [departments, setDepartments] = useState<WalkInDepartment[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [noteFocused, setNoteFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hospitals, setHospitals] = useState<HospitalOption[]>([]);
  const [switching, setSwitching] = useState<string | null>(null);
  const [allHospitalsShown, setAllHospitalsShown] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = await fetchPatientProfile();
      // Both doors need a hospital; the home owns telling the patient so.
      // dismissTo pops to the anchor (tabs); replace would stack a second one.
      if (!p?.hospitalId) {
        router.dismissTo("/(app)/(tabs)");
        return;
      }
      const [live, depts, allHospitals] = await Promise.all([
        fetchLiveIntake(p.hospitalId),
        fetchWalkInDepartments(p.hospitalId),
        // The chips: every active hospital, this one first. A failed read
        // hides the chips, never the clinics.
        fetchHospitals().catch(() => [] as HospitalOption[]),
      ]);
      setHospitals([
        ...allHospitals.filter((h) => h.id === p.hospitalId),
        ...allHospitals.filter((h) => h.id !== p.hospitalId),
      ]);
      // Already in today's line: the ticket IS the answer to "coming today".
      if (live) {
        router.replace("/(app)/ticket");
        return;
      }
      setDepartments(depts);
      setProfile(p);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't load this screen.");
    }
  }, [router]);

  // On focus, like the home: a patient coming back from the booking link the
  // closed state offers gets the clinic's current state, not the one they left.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const open = departments.filter((d) => d.openNow);
  const closed = departments.filter((d) => !d.openNow);
  const only = open.length === 1 ? open[0] : null;
  // A choice made before a focus-refresh closed that clinic does not survive it.
  const chosenId = only?.id ?? open.find((d) => d.id === selectedId)?.id ?? null;
  const hospitalId = profile?.hospitalId ?? null;

  // No `useCallback`: the React Compiler memoises this, and a manual one over
  // `chosenId` — derived from a filtered array — is one it refuses to preserve.
  const onSubmit = async () => {
    if (!hospitalId || !chosenId || busy) return;
    setBusy(true);
    setError(null);
    // ADR 0098: a catalog report filed before this door rides with the ticket;
    // the server links it and reads its tier.
    const report = getPendingCatalogDraft();
    const res = await declareIntake({
      hospitalId,
      receivingDepartmentId: chosenId,
      presentingComplaint: note.trim() || null,
      symptomSubmissionId: report?.submissionId,
    });
    if (!res.ok) {
      // A 409 for an existing ticket carries its id in `details`, which the
      // transport drops — so ask the database instead. A live ticket found
      // now is the thing the refusal was about; go there.
      const live = await fetchLiveIntake(hospitalId).catch(() => null);
      if (!live) {
        // The server's sentence, verbatim: "You already have a booking at this
        // department today — check in when you arrive instead." is something
        // a patient can act on; "something went wrong" is not.
        setError(res.error);
        setBusy(false);
        return;
      }
    }
    clearPendingCatalogDraft();
    router.replace("/(app)/ticket");
  };

  if (loadError) {
    return (
      <Screen onBack={router.back} trailing={<EmergencyButton />}>
        <Empty
          icon="cloud-offline-outline"
          title="Couldn't load this screen."
          hint="Check your connection and try again."
          action={
            <Button
              variant="secondary"
              label="Try again"
              onPress={() => {
                setLoadError(null);
                void load();
              }}
            />
          }
        />
      </Screen>
    );
  }

  if (!profile) {
    return (
      <Screen
        onBack={router.back}
        trailing={<EmergencyButton />}
        title="Coming to the hospital today"
      >
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} accessibilityLabel="Loading" />
        </View>
      </Screen>
    );
  }

  const hospitalName = profile.hospitalName ?? "your hospital";
  const switchTo = async (id: string) => {
    setSwitching(id);
    setError(null);
    try {
      await choosePrimaryHospital(id);
      setSelectedId(null);
      await load();
    } catch {
      setError("Couldn't switch hospital — try again in a moment.");
    } finally {
      setSwitching(null);
    }
  };

  const head = (
    <>
      <Text style={styles.lede}>
        We save your place in line. You will be seen in turn. We cannot tell you the hour.
      </Text>
      {/* Yours first and filled, two beside it, the directory beyond that:
          tapping another makes it your hospital (the same write the web's
          chips make) and the clinics below follow. */}
      {hospitals.length > 1 ? (
        <ChipRow>
          {(allHospitalsShown ? hospitals : hospitals.slice(0, 3)).map((h) => (
            <Chip
              key={h.id}
              role="button"
              label={switching === h.id ? "Switching…" : h.name}
              selected={h.id === profile?.hospitalId}
              onPress={() => {
                if (h.id !== profile?.hospitalId && switching === null) void switchTo(h.id);
              }}
            />
          ))}
          {hospitals.length > 3 && !allHospitalsShown ? (
            <Chip
              role="button"
              label={`View more (${hospitals.length - 3})`}
              selected={false}
              onPress={() => setAllHospitalsShown(true)}
            />
          ) : null}
        </ChipRow>
      ) : (
        <Text style={styles.eyebrow}>{hospitalName}</Text>
      )}
    </>
  );
  // Named rather than silently omitted: a patient told to go to a specific
  // clinic has to see that it is the clinic, not the app, that is closed.
  const closedNote =
    closed.length > 0 ? (
      <Text style={styles.muted}>
        Not taking walk-ins at {hospitalName} right now: {closed.map((d) => d.name).join(" · ")}.
      </Text>
    ) : null;

  // §11. Every department is inside a scheduling policy that has closed for
  // the day, and the patient has just said they are coming today. The primary
  // exit is the hospital; booking is demoted to a plain link.
  if (open.length === 0) {
    return (
      <Screen
        onBack={router.back}
        trailing={<EmergencyButton />}
        title="Coming to the hospital today"
      >
        <View style={styles.stack}>
          {head}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Go to the hospital.</Text>
            {/* "the emergency entrance is open at all hours" belongs here only
                where someone has verified it. Nothing records that; not written. */}
            <Text style={styles.body}>Reception can register you when you arrive.</Text>
            {closedNote}
            <Button
              variant="link"
              label="Ask for a day — the clinic confirms"
              onPress={() => router.push("/(app)/book")}
              style={styles.cardLink}
            />
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      // Same split as sign-in: the two platforms report the keyboard
      // differently, and one behaviour for both leaves the docked button under
      // it on whichever platform loses.
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <Screen
        onBack={router.back}
        trailing={<EmergencyButton />}
        title="Coming to the hospital today"
        footer={
          <>
            {error ? (
              <View style={styles.well}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.status.cautionFg} />
                <Text style={styles.wellText} accessibilityLiveRegion="polite">
                  {error}
                </Text>
              </View>
            ) : null}
            <Button
              label="Save a place in line"
              onPress={() => void onSubmit()}
              busy={busy}
              disabled={!chosenId}
            />
          </>
        }
      >
        <View style={styles.stack}>
          {head}

          {only ? (
            <View style={styles.group}>
              <Text style={styles.caption}>Where you are going</Text>
              <DepartmentCard name={only.name} />
            </View>
          ) : (
            <Section title="Which clinic were you told to go to?">
              {/* Two tiles a row: a hospital's clinics on one screen, not a
                  scroll of 76px rows. */}
              <View style={styles.grid} accessibilityRole="radiogroup">
                {open.map((d) => (
                  <View key={d.id} style={styles.gridCell}>
                    <DepartmentCard
                      name={d.name}
                      checked={d.id === selectedId}
                      onPress={() => setSelectedId(d.id)}
                      compact
                    />
                  </View>
                ))}
              </View>
            </Section>
          )}

          {closedNote}

          <View style={styles.field}>
            <Text style={[styles.fieldLabel, noteFocused && styles.fieldLabelFocused]}>
              What brings you in? (optional)
            </Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              onFocus={() => setNoteFocused(true)}
              onBlur={() => setNoteFocused(false)}
              multiline
              maxLength={500}
              placeholder="A short note helps the team prepare — e.g. follow-up for diabetes, persistent cough for 3 days."
              placeholderTextColor={colors.mutedForeground}
              selectionColor={colors.primary}
              accessibilityLabel="What brings you in? Optional."
              style={[styles.input, noteFocused && styles.inputFocused]}
            />
          </View>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

/**
 * One clinic, as the reference's doctor row: a disc, the name, the one fact
 * about it that matters today, a chevron. With `onPress` it is a radio in the
 * list of open clinics; without, it is the named destination.
 */
function DepartmentCard({
  name,
  checked = false,
  onPress,
  compact = false,
}: {
  name: string;
  checked?: boolean;
  onPress?: () => void;
  /** A grid tile: smaller disc, the name on two lines at most, no chevron. */
  compact?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);

  const body = (
    <>
      {/* The disc flips to the brand fill when chosen, so the pick is a shape
          and not only a tint. Decorative: the name is beside it. */}
      <View
        style={[styles.disc, compact && styles.discCompact, checked && styles.discChecked]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Ionicons
          name="medkit-outline"
          size={compact ? 18 : 22}
          color={checked ? colors.primaryForeground : colors.accentForeground}
        />
      </View>
      <View style={styles.optionText}>
        <Text
          style={[
            styles.optionName,
            compact && styles.optionNameCompact,
            checked && styles.optionInkChecked,
          ]}
          numberOfLines={2}
        >
          {name}
        </Text>
        {compact ? null : (
          <Text style={[styles.optionMeta, checked && styles.optionInkChecked]}>Open now</Text>
        )}
      </View>
      {onPress && !compact ? (
        <Ionicons
          name="chevron-forward"
          size={20}
          color={checked ? colors.accentForeground : colors.mutedForeground}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      ) : null}
    </>
  );

  if (!onPress) return <View style={styles.option}>{body}</View>;

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        compact && styles.optionCompact,
        checked && styles.optionChecked,
        pressed && styles.pressed,
      ]}
    >
      {body}
    </Pressable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    fill: { flex: 1 },
    center: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
    stack: { gap: space[5] },

    eyebrow: {
      fontFamily: font.body,
      fontSize: 12.5,
      letterSpacing: 0.3,
      color: c.mutedForeground,
      marginTop: -space[3],
    },
    lede: {
      fontFamily: font.body,
      fontSize: 14.5,
      lineHeight: 21,
      color: c.foreground,
      marginTop: -space[2],
    },

    card: {
      gap: space[1],
      padding: space[4],
      borderRadius: radius["2xl"],
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.border,
    },
    cardTitle: { fontFamily: font.bodySemiBold, fontSize: 17, lineHeight: 23, color: c.foreground },
    body: { fontFamily: font.body, fontSize: 14.5, lineHeight: 21, color: c.foreground },
    cardLink: { alignSelf: "flex-start", marginTop: space[1], marginLeft: -space[2] },
    caption: {
      fontFamily: font.body,
      fontSize: 12.5,
      letterSpacing: 0.3,
      color: c.mutedForeground,
    },
    muted: { fontFamily: font.body, fontSize: 13.5, lineHeight: 19, color: c.mutedForeground },

    group: { gap: space[2] },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
    gridCell: { width: "48.5%" },
    optionCompact: { minHeight: 56, padding: space[3], gap: space[2], borderRadius: radius.xl },
    discCompact: { width: 32, height: 32, borderRadius: 16 },
    optionNameCompact: { fontSize: 14, lineHeight: 19 },
    option: {
      flexDirection: "row",
      alignItems: "center",
      gap: space[3],
      minHeight: 76,
      padding: space[4],
      borderRadius: radius["2xl"],
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.border,
    },
    optionChecked: { backgroundColor: c.accent, borderColor: c.primary },
    disc: {
      width: 44,
      height: 44,
      borderRadius: radius.full,
      backgroundColor: c.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    discChecked: { backgroundColor: c.primary },
    optionText: { flex: 1, gap: 2 },
    optionName: { fontFamily: font.bodyMedium, fontSize: 16, lineHeight: 22, color: c.foreground },
    optionMeta: { fontFamily: font.body, fontSize: 13.5, lineHeight: 19, color: c.mutedForeground },
    optionInkChecked: { color: c.accentForeground },
    pressed: { opacity: 0.88 },

    // The sunken input: a quiet well on the page, the brand hairline on focus
    // — and the label lifts in weight too, so focus is never colour alone.
    field: { gap: space[2] },
    fieldLabel: {
      fontFamily: font.body,
      fontSize: 12.5,
      letterSpacing: 0.3,
      color: c.mutedForeground,
    },
    fieldLabelFocused: { fontFamily: font.bodyMedium, color: c.primary },
    input: {
      fontFamily: font.body,
      fontSize: 14.5,
      lineHeight: 21,
      color: c.foreground,
      minHeight: 96,
      paddingHorizontal: space[4],
      paddingVertical: space[3],
      borderRadius: radius.lg,
      backgroundColor: c.muted,
      // The web's inputs carry `--input` (= border) as their edge; a sunken
      // fill alone is invisible on the dark page until focus, and a field a
      // patient cannot find is not a field.
      borderWidth: 1,
      borderColor: c.border,
      textAlignVertical: "top",
    },
    inputFocused: { borderColor: c.primary },

    // Amber, not red: a refused request is not a clinical emergency. The
    // amber is the frame and the glyph; the words carry the meaning.
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
