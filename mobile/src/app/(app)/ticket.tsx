import type { LiveIntake, PatientProfile } from "@/lib/booking";
import type { Palette } from "@/theme/tokens";
import { useCallback, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { EmergencyButton } from "@/components/patient/emergency-button";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { HeroCard } from "@/components/ui/hero-card";
import { Screen } from "@/components/ui/screen";
import { cancelIntake, fetchLiveIntake, fetchPatientProfile, STAGE_WORD } from "@/lib/booking";
import { useSession } from "@/lib/session";
import { useStyles, useTheme } from "@/theme/theme";
import { font, radius, space } from "@/theme/tokens";

/**
 * The ticket: the one screen a patient holds while they wait.
 *
 * Status surface, in words and never colour alone: declared → arrived →
 * awaiting_triage → triaged. Terminal rows (completed / cancelled) do not come
 * back from the live-intake read, so "nothing saved today" covers them.
 *
 * **No "N ahead of you" here — and not by oversight (ADR 0084 §6).** The
 * number is honest only when counted against this patient's own row among
 * present patients in this department. Under RLS a patient can SELECT their
 * own intakes and nobody else's (`patient_intakes_select_scoped`), so a count
 * run from the phone returns 0 whatever the room looks like, and "No one is
 * ahead of you" would be a fabricated datum on the highest-anxiety screen in
 * the product. The web computes it server-side over a direct connection. Until
 * an Edge Function or a SECURITY DEFINER RPC serves the count to the patient,
 * this screen says where they stand and what happens next, and no number.
 *
 * Refresh is on focus and on demand (§15), never on a timer: the patient owns
 * the spend, and a screen that reloads itself every 30 seconds for a
 * five-hour wait is a data charge with nothing to show for it.
 *
 * Self-cancel only while `declared` (ADR 0034 §5): once reception has
 * registered the patient, the desk owns the row.
 */
export default function TicketScreen() {
  const router = useRouter();
  const { session } = useSession();
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  // §2: the confirmation names the ACCOUNT HOLDER, because the person holding
  // the phone is routinely not the person who will arrive. `full_name` is what
  // signup wrote to auth metadata — the same value `users.full_name` mirrors
  // and the web's `scope.fullName` reads.
  const fullName = session?.user.user_metadata?.full_name;
  const firstName = typeof fullName === "string" ? fullName.split(" ")[0] : undefined;

  // The hospital the hero names, and the patient code reception matches
  // against at the desk (§11) — the one fact on the hero a patient may be
  // asked to read out.
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  // `undefined` = not loaded yet. `null` = nothing live today.
  const [intake, setIntake] = useState<LiveIntake | null | undefined>();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set by this screen's own cancel, so the patient sees that it went through
  // rather than an empty state that could mean anything.
  const [removed, setRemoved] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    setChecking(true);
    try {
      const p = await fetchPatientProfile();
      // Both doors need a hospital; the home owns telling the patient so.
      // dismissTo pops to the anchor (tabs); replace would stack a second one.
      if (!p?.hospitalId) {
        router.dismissTo("/(app)/(tabs)");
        return;
      }
      const live = await fetchLiveIntake(p.hospitalId);
      setProfile(p);
      setIntake(live);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't load your place in line.");
    } finally {
      setChecking(false);
    }
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onCancel = useCallback(async () => {
    if (!intake || busy) return;
    setBusy(true);
    setError(null);
    const res = await cancelIntake(intake.id);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setRemoved(true);
    setIntake(null);
  }, [intake, busy]);

  if (loadError) {
    return (
      <Screen onBack={router.back} trailing={<EmergencyButton />}>
        <Empty
          icon="cloud-offline-outline"
          title="Couldn't load your place in line."
          hint="Check your connection and try again."
          action={<Button variant="secondary" label="Try again" onPress={() => void load()} />}
        />
      </Screen>
    );
  }

  // `profile` is set in the same tick as `intake`, so past this line it is in.
  if (intake === undefined || !profile) {
    return (
      <Screen onBack={router.back} trailing={<EmergencyButton />}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} accessibilityLabel="Loading" />
        </View>
      </Screen>
    );
  }

  if (removed) {
    return (
      <Screen onBack={router.back} trailing={<EmergencyButton />} title="We removed your place.">
        <View style={styles.stack}>
          <View style={styles.card}>
            <Text style={styles.cardLead}>Nothing is saved for you today.</Text>
            <Text style={styles.muted}>
              You can tell us again any time you are coming in today.
            </Text>
          </View>
          <Button
            variant="link"
            label="Coming to the hospital today"
            onPress={() => router.replace("/(app)/today")}
            style={styles.inlineLink}
          />
        </View>
      </Screen>
    );
  }

  if (!intake) {
    return (
      <Screen onBack={router.back} trailing={<EmergencyButton />}>
        <Empty
          icon="business-outline"
          title="Nothing is saved for you today."
          hint="If you are coming to the hospital today, we can save your place in line."
          action={
            <Button
              label="Coming to the hospital today"
              onPress={() => router.replace("/(app)/today")}
            />
          }
        />
      </Screen>
    );
  }

  const stage = STAGES[intake.status] ?? STAGES.declared;
  const step = STEP_OF[intake.status] ?? 0;
  const hospitalName = profile.hospitalName ?? "your hospital";

  return (
    <Screen
      onBack={router.back}
      trailing={<EmergencyButton />}
      title={headlineFor(intake.status, firstName)}
      footer={
        <Button
          variant="secondary"
          label="Check for an update"
          onPress={() => void load()}
          busy={checking}
        />
      }
    >
      <View style={styles.stack}>
        {/* The place, and the two facts about it that are true: the code the
            desk matches on, and the stage. Never a position (§6), never an
            hour (§10). */}
        <HeroCard
          eyebrow="Your place today"
          title={intake.departmentName ?? hospitalName}
          subtitle={intake.departmentName ? hospitalName : undefined}
          tiles={[
            { icon: "pricetag-outline", label: "Patient code", value: profile.patientCode },
            { icon: "footsteps-outline", label: "Stage", value: (STEPS[step] ?? STEPS[0]).word },
          ]}
        />

        <View style={styles.card}>
          {/* The line as a timeline. State is a shape and a word — a tick
              for done, weight for now — never the tint alone. */}
          <View>
            {STEPS.map((s, i) => {
              const done = i < step;
              const current = i === step;
              return (
                <View key={s.word} style={styles.step}>
                  <View style={styles.rail}>
                    <View
                      style={[styles.dot, done && styles.dotDone, current && styles.dotCurrent]}
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                    >
                      {done ? (
                        <Ionicons name="checkmark" size={14} color={colors.primaryForeground} />
                      ) : null}
                    </View>
                    {i < STEPS.length - 1 ? <View style={styles.connector} /> : null}
                  </View>
                  <Text style={[styles.stepWord, current && styles.stepWordCurrent]}>{s.word}</Text>
                </View>
              );
            })}
          </View>

          <View style={styles.rule} />

          <Text style={styles.cardLead}>{stage.lead}</Text>
          <Text style={styles.muted}>{stage.body}</Text>
        </View>

        {intake.status === "declared" ? (
          confirming ? (
            <View style={styles.card}>
              <Text style={styles.cardLead}>
                Take your place out of today’s line? You can tell us again any time today.
              </Text>
              {error ? (
                <View style={styles.well}>
                  <Ionicons name="alert-circle-outline" size={18} color={colors.status.cautionFg} />
                  <Text style={styles.wellText} accessibilityLiveRegion="polite">
                    {error}
                  </Text>
                </View>
              ) : null}
              <View style={styles.confirmActions}>
                <Button
                  variant="link"
                  label="Keep my place"
                  onPress={() => setConfirming(false)}
                  disabled={busy}
                />
                <Button
                  variant="secondary"
                  label="Yes, remove my place"
                  onPress={() => void onCancel()}
                  busy={busy}
                  style={styles.confirmYes}
                />
              </View>
            </View>
          ) : (
            <Button
              variant="link"
              label="I am not coming today"
              onPress={() => setConfirming(true)}
              style={styles.inlineLink}
            />
          )
        ) : null}
      </View>
    </Screen>
  );
}

/* ─── copy — the web ticket's words, verbatim ───────────────────── */

interface Stage {
  /** One line naming where the patient stands. */
  lead: string;
  /** What happens next — and nothing about when. */
  body: string;
}

const STAGES: Record<string, Stage> = {
  declared: {
    lead: "Go to the hospital when you can.",
    body: "Reception will register you at the desk when you arrive. You will be seen in turn. We cannot tell you the hour.",
  },
  arrived: {
    lead: "You will be seen in turn.",
    body: "We cannot tell you the hour. A nurse will see you first for a quick check.",
  },
  awaiting_triage: {
    lead: "You will be seen in turn.",
    body: "We cannot tell you the hour. A nurse will see you first for a quick check.",
  },
  triaged: {
    lead: "Follow the directions the team gave you.",
    body: "If you are not sure where to go, ask at the desk.",
  },
};

/**
 * The line as three steps, each named with the headline's own words. `arrived`
 * and `awaiting_triage` are one step to the patient — both mean "at the desk,
 * not yet seen" — so the four statuses fold to three.
 */
const STEPS = [
  { word: STAGE_WORD.declared },
  { word: STAGE_WORD.arrived },
  { word: STAGE_WORD.triaged },
] as const;

const STEP_OF: Record<string, number> = {
  declared: 0,
  arrived: 1,
  awaiting_triage: 1,
  triaged: 2,
};

function headlineFor(intakeStatus: string, firstName: string | undefined): string {
  switch (intakeStatus) {
    case "declared":
      return firstName ? `We saved a place for ${firstName}.` : "We saved your place.";
    case "arrived":
    case "awaiting_triage":
      return "You are in the line.";
    case "triaged":
      return "The nurse has seen you.";
    default:
      return "Your place in line.";
  }
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    center: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
    stack: { gap: space[5] },
    muted: { fontFamily: font.body, fontSize: 14.5, lineHeight: 21, color: c.mutedForeground },

    card: {
      gap: space[2],
      padding: space[4],
      borderRadius: radius["2xl"],
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.border,
    },
    cardLead: { fontFamily: font.bodyMedium, fontSize: 16, lineHeight: 23, color: c.foreground },
    rule: { height: 1, backgroundColor: c.border, marginVertical: space[2] },

    step: { flexDirection: "row", alignItems: "flex-start", gap: space[3] },
    rail: { alignItems: "center" },
    dot: {
      width: 24,
      height: 24,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },
    dotDone: { backgroundColor: c.primary, borderColor: c.primary },
    // Done is state (teal); the current step is place (plum) — ADR 0097.
    dotCurrent: { backgroundColor: c.place, borderColor: c.placeForeground },
    connector: { width: 1, height: space[5], backgroundColor: c.border },
    stepWord: {
      fontFamily: font.body,
      fontSize: 15,
      lineHeight: 24,
      color: c.mutedForeground,
    },
    stepWordCurrent: { fontFamily: font.bodyMedium, color: c.foreground },

    inlineLink: { alignSelf: "center" },
    confirmActions: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: space[2],
      marginTop: space[1],
    },
    // The secondary variant stretches by default; beside "Keep my place" it
    // takes only its own width.
    confirmYes: { alignSelf: "auto" },

    // Amber, not red: a cancel that did not go through is not a clinical
    // emergency. The amber is the frame and the glyph; the words carry the
    // meaning.
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
