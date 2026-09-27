import type { WaitOption } from "@/components/patient/no-silent-wait";
import type { SymptomDraft } from "@/components/patient/symptom-picker";
import type {
  AppointmentReason,
  BookingReceipt,
  BookingSymptomOption,
  ClinicSession,
  HouseholdMember,
  PatientProfile,
  ServiceLine,
} from "@/lib/booking";
import type { Palette } from "@/theme/tokens";
import { useCallback, useEffect, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { FEE_FOOTNOTE, WAIVER_NOTE } from "@shared/fees";
import { CATALOG } from "@shared/symptom-catalog/catalog.v0.1";
import { t } from "@shared/symptom-catalog/classify";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { BookingDone } from "@/components/patient/booking-done";
import { BookingInterstitial } from "@/components/patient/booking-interstitial";
import { EmergencyButton } from "@/components/patient/emergency-button";
import { NoSilentWait } from "@/components/patient/no-silent-wait";
import { completeSymptoms, SymptomPicker } from "@/components/patient/symptom-picker";
import { WaitlistJoin } from "@/components/patient/waitlist-join";
import { Button } from "@/components/ui/button";
import { Chip, ChipRow, Tile } from "@/components/ui/chip";
import { Empty } from "@/components/ui/empty";
import { Screen } from "@/components/ui/screen";
import { Section } from "@/components/ui/section";
import {
  dateKey,
  fetchHousehold,
  fetchPatientProfile,
  fetchServiceLine,
  fetchServiceLines,
  fetchSessions,
  fetchSymptomCatalog,
  formatDateLong,
  INTERSTITIAL_REASONS,
  newIdempotencyKey,
  reasonsFor,
  requestAppointment,
  sessionTakeable,
} from "@/lib/booking";
import {
  clearPendingCatalogDraft,
  clearPendingSymptoms,
  getPendingSymptoms,
  setPendingSymptoms,
  usePendingCatalogDraft,
} from "@/lib/pending-symptoms";
import { useStyles, useTheme } from "@/theme/theme";
import { font, radius, space } from "@/theme/tokens";

/** "12 places left" / "1 place left" / "Full" — the tile's second line. */
function placesWord(n: number): string {
  if (n === 0) return "Full";
  return n === 1 ? "1 place left" : `${n} places left`;
}

/** The same clinic at another hospital, with a day inside the window (PRD §2.4 option 2). */
async function loadElsewhere(
  line: ServiceLine,
  limitIso: string,
): Promise<{ line: ServiceLine; next: ClinicSession }[]> {
  const lines = (await fetchServiceLines({ name: line.name }).catch(() => [])).filter(
    (l) => l.hospitalId !== line.hospitalId && l.capacityMode === "session",
  );
  const found = await Promise.all(
    lines.map(async (l) => {
      const next = (await fetchSessions({ serviceLineId: l.id }).catch(() => [])).find(
        (s) => sessionTakeable(s) && s.startsAtIso <= limitIso,
      );
      return next ? { line: l, next } : null;
    }),
  );
  return found.filter((f): f is { line: ServiceLine; next: ClinicSession } => f !== null);
}

/**
 * One clinic — a session-mode service line (ADR 0087): its published clinic
 * days as tiles, the reasons it takes, a note, and the docked "Book a place".
 * One POST at the end — `pt-request-appointment`'s session path — and the
 * server allocates the position; the tile's count is the allocator's own
 * arithmetic, so a day shown as open is a day the server will take.
 *
 * The reason comes first: a "new or worsening problem" opens the emergency
 * interstitial before any clinic day is on screen (PRD §2.5). When no day
 * falls inside the facility's own target, the no-silent-wait rule's options
 * come before the days beyond it (PRD §2.4).
 */
export default function ClinicScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);

  const [profile, setProfile] = useState<PatientProfile | null | undefined>();
  const [line, setLine] = useState<ServiceLine | null>(null);
  const [sessions, setSessions] = useState<ClinicSession[]>([]);
  // `dateKey` of the window's last day, and what the rule found beyond it.
  const [limit, setLimit] = useState<string | null>(null);
  const [elsewhere, setElsewhere] = useState<{ line: ServiceLine; next: ClinicSession }[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  // Gate D: the adults this account books for; empty hides the choice.
  const [household, setHousehold] = useState<HouseholdMember[]>([]);
  const [forMember, setForMember] = useState<HouseholdMember | null>(null);

  const [reason, setReason] = useState<AppointmentReason | null>(null);
  const [interstitialSeen, setInterstitialSeen] = useState(false);
  const [session, setSession] = useState<ClinicSession | null>(null);
  const [note, setNote] = useState("");
  const [noteFocused, setNoteFocused] = useState(false);
  // ADR 0095: words for the clinic, optional. An empty catalogue hides the picker.
  // Starts from what the home's shortlist took (ADR 0096) and writes back.
  const [catalog, setCatalog] = useState<BookingSymptomOption[]>([]);
  const [symptoms, setSymptoms] = useState<SymptomDraft[]>(getPendingSymptoms);
  // ADR 0098: a catalog report already filed stands in for the descriptive
  // picker — its lay words shown read-only, its id sent, the server deriving
  // the rest. "Change" goes back to the catalog.
  const draft = usePendingCatalogDraft();
  const report = draft?.submissionId ? draft : null;
  const reportLabels = (report?.items ?? [])
    .map((key) => CATALOG.items.find((i) => i.key === key))
    .filter((i) => i !== undefined)
    .map((i) => t(CATALOG, i.labelKey));

  const keyRef = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    receipt: BookingReceipt;
    startsAtIso: string;
    forMember: string | null;
  } | null>(null);

  const load = useCallback(() => {
    fetchPatientProfile()
      .then(async (p) => {
        if (!p) {
          setProfile(null);
          return;
        }
        const found = await fetchServiceLine(id);
        setLine(found);
        // Both fail to empty: a household read that failed hides the chips
        // (the visit is then the patient's own), a catalogue that failed hides
        // the picker. Read together — neither gates the other, and the
        // catalogue is only needed once the sheet opens.
        const [members, catalogue] = await Promise.all([
          fetchHousehold().catch(() => []),
          fetchSymptomCatalog().catch(() => []),
        ]);
        setHousehold(members);
        setCatalog(catalogue);
        if (found) {
          const rows = await fetchSessions({ serviceLineId: found.id });
          setSessions(rows);
          const limitAt = new Date(Date.now() + found.timeToCareDays * 86_400_000);
          setLimit(dateKey(limitAt));
          const within = rows.some(
            (s) => sessionTakeable(s) && s.startsAtIso <= limitAt.toISOString(),
          );
          setElsewhere(within ? [] : await loadElsewhere(found, limitAt.toISOString()));
        }
        setProfile(p);
      })
      .catch(() => setLoadFailed(true));
  }, [id]);

  useEffect(load, [load]);

  const pickReason = (r: AppointmentReason) => {
    setReason(r);
    keyRef.current = null;
  };
  const pickSession = (s: ClinicSession) => {
    setSession(s);
    keyRef.current = null;
  };
  const pickFor = (m: HouseholdMember | null) => {
    setForMember(m);
    keyRef.current = null;
  };
  const pickSymptoms = (next: SymptomDraft[]) => {
    setSymptoms(next);
    setPendingSymptoms(next);
    keyRef.current = null;
  };
  // Null while a chosen entry still has no duration — Confirm waits for it.
  // A catalog report carries its own words: nothing to complete.
  const symptomsReady = report ? [] : completeSymptoms(symptoms);

  const onSubmit = async () => {
    if (!profile || !line || !reason || !session || busy) return;
    setBusy(true);
    setError(null);
    keyRef.current ??= newIdempotencyKey();
    // PRD §2.9: the member chips are hidden on a confidential line; if one
    // was picked anyway, the server's refusal is shown — never a silent
    // booking for someone else.
    const member = forMember;
    const res = await requestAppointment({
      hospitalId: line.hospitalId,
      reason,
      reasonNote: note.trim() || null,
      symptoms: report ? null : symptomsReady,
      symptomSubmissionId: report?.submissionId,
      idempotencyKey: keyRef.current,
      forProvisionalId: member?.provisionalPatientId,
      session: { sessionId: session.id },
    });
    if (res.ok) {
      keyRef.current = null;
      clearPendingSymptoms();
      clearPendingCatalogDraft();
      setDone({
        receipt: res.data ?? {
          appointment_id: "",
          status: "",
          booking_code: null,
          position_number: null,
          arrival_window_start: null,
          arrival_window_end: null,
        },
        startsAtIso: session.startsAtIso,
        forMember: member?.label ?? null,
      });
      return;
    }
    // "This clinic day is full — here are the next two." — the server's
    // sentence, verbatim; then re-read the days so the tiles say which.
    setError(res.error);
    setBusy(false);
    try {
      const fresh = await fetchSessions({ serviceLineId: line.id });
      setSessions(fresh);
      const still = fresh.find((s) => s.id === session.id);
      setSession(still && sessionTakeable(still) ? still : null);
    } catch {
      // Keep what is on screen; the sentence above already says to try again.
    }
  };

  const chrome = { onBack: router.back, trailing: <EmergencyButton /> };

  if (loadFailed) {
    return (
      <Screen {...chrome}>
        <Empty
          icon="cloud-offline-outline"
          title="Couldn't load the days the clinic has open."
          hint="Check your connection and try again."
          action={
            <Button
              variant="secondary"
              label="Try again"
              onPress={() => {
                setLoadFailed(false);
                load();
              }}
            />
          }
        />
      </Screen>
    );
  }

  if (profile === undefined) {
    return (
      <Screen {...chrome}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} accessibilityLabel="Loading" />
        </View>
      </Screen>
    );
  }

  if (profile === null) {
    return (
      <Screen {...chrome}>
        <Empty
          icon="person-circle-outline"
          title="This is the patient app."
          hint="Sign in with your patient account to book a clinic day."
        />
      </Screen>
    );
  }

  if (done) {
    return (
      <Screen
        trailing={<EmergencyButton />}
        footer={<Button label="Done" onPress={() => router.dismissTo("/(app)/(tabs)")} />}
      >
        <BookingDone
          receipt={done.receipt}
          startsAtIso={done.startsAtIso}
          where={line ? `${line.name} · ${line.departmentName} · ${line.hospitalName}` : ""}
          forMember={done.forMember}
        />
      </Screen>
    );
  }

  // The link named a clinic that is no longer active, or never existed.
  if (!line) {
    return (
      <Screen {...chrome}>
        <Empty
          icon="calendar-clear-outline"
          title="This clinic is not open for booking."
          hint="Go back and pull down to refresh."
          action={<Button label="Back" variant="secondary" onPress={router.back} />}
        />
      </Screen>
    );
  }

  if (reason && INTERSTITIAL_REASONS.has(reason) && !interstitialSeen) {
    return (
      <BookingInterstitial
        hospitalName={line.hospitalName}
        emergencyPhone={line.emergencyPhone}
        onContinue={() => setInterstitialSeen(true)}
      />
    );
  }

  const reasons = reasonsFor(line);
  const picked = reasons.find((r) => r.value === reason);
  const beyond =
    limit !== null &&
    sessions.every((s) => !sessionTakeable(s) || dateKey(new Date(s.startsAtIso)) > limit);
  // Gate E: nothing takeable inside the target — the line is the honest offer.
  // Never for a confidential line booked for a member (the server refuses too).
  const waitlistInput =
    reason && limit && !(forMember && line.confidential)
      ? {
          serviceLineId: line.id,
          reason,
          preferredFrom: dateKey(new Date()),
          preferredTo: limit,
          ...(forMember ? { forProvisionalId: forMember.provisionalPatientId } : {}),
        }
      : null;

  const options: WaitOption[] = elsewhere.map(({ line: l, next }) => ({
    key: l.id,
    title: l.hospitalName,
    subtitle: `${formatDateLong(next.startsAtIso)} · ${placesWord(next.placesLeft)}`,
    onPress: () => router.replace({ pathname: "/(app)/clinic/[id]", params: { id: l.id } }),
  }));

  const dayPicker = (
    <View style={styles.tiles} accessibilityRole="radiogroup">
      {sessions.map((s) => (
        <Tile
          key={s.id}
          label={formatDateLong(s.startsAtIso)}
          hint={`${s.clinicianUserId === null ? "Clinician not yet named" : s.clinicianName} · ${
            s.clinicianUserId === null ? "not open yet" : placesWord(s.placesLeft)
          }`}
          selected={s.id === session?.id}
          // PRD §3.6 / book.ts 409: a day with no clinician is not bookable.
          disabled={!sessionTakeable(s)}
          onPress={() => pickSession(s)}
        />
      ))}
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <Screen
        {...chrome}
        title={line.name}
        subtitle={`${line.departmentName} · ${line.hospitalName}`}
        footer={
          sessions.length === 0 ? undefined : (
            <>
              {error ? (
                <View style={styles.well}>
                  <Ionicons name="alert-circle-outline" size={18} color={colors.status.cautionFg} />
                  <Text style={styles.wellText} accessibilityLiveRegion="polite">
                    {error}
                  </Text>
                </View>
              ) : null}
              {symptomsReady === null ? (
                <Text style={styles.hint} accessibilityLiveRegion="polite">
                  Choose a duration for each one.
                </Text>
              ) : null}
              <Button
                label="Book a place"
                busy={busy}
                disabled={!session || !reason || symptomsReady === null}
                onPress={() => void onSubmit()}
              />
            </>
          )
        }
      >
        <View style={styles.stack}>
          {sessions.length === 0 ? (
            <Empty
              icon="calendar-clear-outline"
              title="No days open yet."
              hint="This clinic has not put any clinic days on MedSync. You can still be seen — going to the hospital does not depend on this app."
              action={
                <Button
                  variant="secondary"
                  label="Coming to the hospital today"
                  onPress={() => router.replace("/(app)/today")}
                />
              }
            />
          ) : null}

          {/* Gate D: who the visit is for. Hidden for a confidential line —
              never shown to, or bookable for, a member (PRD §2.9). */}
          {sessions.length > 0 && household.length > 0 && !line.confidential ? (
            <Section title="This visit is for">
              <ChipRow>
                <Chip label="Me" selected={forMember === null} onPress={() => pickFor(null)} />
                {household.map((m) => (
                  <Chip
                    key={m.id}
                    label={m.label}
                    selected={forMember?.id === m.id}
                    onPress={() => pickFor(m)}
                  />
                ))}
              </ChipRow>
            </Section>
          ) : null}

          {sessions.length > 0 ? (
            <Section
              title={forMember ? `Why is ${forMember.label} coming?` : "Why are you coming?"}
            >
              {/* Only the reasons this line takes; the server refuses any other. */}
              <ChipRow>
                {reasons.map((r) => (
                  <Chip
                    key={r.value}
                    label={r.title}
                    selected={r.value === reason}
                    onPress={() => pickReason(r.value)}
                  />
                ))}
              </ChipRow>
              {picked ? <Text style={styles.hint}>{picked.hint}</Text> : null}
            </Section>
          ) : null}

          {/* ADR 0095: what is bothering them, as words for the clinic.
              Hidden when the catalogue did not load; the booking stands. */}
          {sessions.length > 0 && report ? (
            <Section
              title="What you told us"
              action={{ label: "Change", onPress: () => router.push("/(app)/symptoms") }}
            >
              {reportLabels.map((label) => (
                <Text key={label} style={styles.reportLine}>
                  {label}
                </Text>
              ))}
            </Section>
          ) : sessions.length > 0 && (catalog.length > 0 || symptoms.length > 0) ? (
            <SymptomPicker options={catalog} value={symptoms} onChange={pickSymptoms} />
          ) : null}

          {sessions.length > 0 ? (
            <Section title="Select a clinic day">
              {beyond ? (
                <NoSilentWait targetDays={line.timeToCareDays} sameService={[]} elsewhere={options}>
                  {dayPicker}
                </NoSilentWait>
              ) : (
                dayPicker
              )}
            </Section>
          ) : null}

          {/* Offers are released capacity: a line with no days at all has none to release. */}
          {beyond && sessions.length > 0 ? (
            <WaitlistJoin clinicName={line.name} input={waitlistInput} />
          ) : null}

          {/* ADR 0092: the fee, stated before the patient commits. Both
              sentences are non-optional wherever money appears. */}
          {sessions.length > 0 && line.feeLine ? (
            <View style={styles.feeCard}>
              <Text style={styles.feeLabel}>Fee</Text>
              <Text style={styles.feeValue}>{line.feeLine}</Text>
              <Text style={styles.feeNote}>{FEE_FOOTNOTE}</Text>
              <Text style={styles.feeNote}>{WAIVER_NOTE}</Text>
            </View>
          ) : null}

          {sessions.length > 0 ? (
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, noteFocused && styles.fieldLabelFocused]}>
                Add a note for the clinic (optional)
              </Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                onFocus={() => setNoteFocused(true)}
                onBlur={() => setNoteFocused(false)}
                multiline
                maxLength={500}
                placeholder="e.g. I can only come in the morning."
                placeholderTextColor={colors.mutedForeground}
                selectionColor={colors.primary}
                accessibilityLabel="Add a note for the clinic. Optional."
                style={[styles.input, noteFocused && styles.inputFocused]}
              />
            </View>
          ) : null}
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    fill: { flex: 1 },
    center: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
    stack: { flexGrow: 1, gap: space[5] },
    // One clinic day per row: a date in full and its clinician need the width.
    tiles: { gap: space[2] },
    hint: { fontFamily: font.body, fontSize: 13.5, lineHeight: 19, color: c.mutedForeground },
    reportLine: { fontFamily: font.body, fontSize: 14.5, lineHeight: 21, color: c.foreground },

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
      minHeight: 48,
      paddingHorizontal: space[4],
      paddingVertical: space[3],
      borderRadius: radius.lg,
      backgroundColor: c.muted,
      borderWidth: 1,
      borderColor: c.border,
      textAlignVertical: "top",
    },
    inputFocused: { borderColor: c.primary },

    // Amber, not red: a full clinic day is not a clinical emergency.
    feeCard: {
      gap: 2,
      padding: space[4],
      borderRadius: radius.lg,
      backgroundColor: c.muted,
    },
    feeLabel: {
      fontFamily: font.body,
      fontSize: 12.5,
      letterSpacing: 0.4,
      textTransform: "uppercase",
      color: c.mutedForeground,
    },
    feeValue: {
      fontFamily: font.bodySemiBold,
      fontSize: 20,
      lineHeight: 26,
      color: c.foreground,
      fontVariant: ["tabular-nums"],
    },
    feeNote: { fontFamily: font.body, fontSize: 13.5, lineHeight: 19, color: c.mutedForeground },
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
