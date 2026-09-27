import type { WaitOption } from "@/components/patient/no-silent-wait";
import type { SymptomDraft } from "@/components/patient/symptom-picker";
import type {
  AppointmentReason,
  BookingReceipt,
  BookingSymptomOption,
  ClinicianOption,
  HouseholdMember,
  PatientProfile,
  ServiceLine,
  SlotOffer,
} from "@/lib/booking";
import type { Palette } from "@/theme/tokens";
import { useCallback, useEffect, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { FEE_FOOTNOTE, quoteLine, resolveFee, WAIVER_NOTE } from "@shared/fees";
import { CATALOG } from "@shared/symptom-catalog/catalog.v0.1";
import { t } from "@shared/symptom-catalog/classify";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { BookingDone } from "@/components/patient/booking-done";
import { BookingInterstitial } from "@/components/patient/booking-interstitial";
import { DateTimeFields } from "@/components/patient/date-time-fields";
import { EmergencyButton } from "@/components/patient/emergency-button";
import { NoSilentWait } from "@/components/patient/no-silent-wait";
import { ProviderHero } from "@/components/patient/provider-hero";
import { completeSymptoms, SymptomPicker } from "@/components/patient/symptom-picker";
import { Button } from "@/components/ui/button";
import { Chip, ChipRow } from "@/components/ui/chip";
import { Empty } from "@/components/ui/empty";
import { Screen } from "@/components/ui/screen";
import { Section } from "@/components/ui/section";
import {
  APPOINTMENT_REASONS,
  dateKey,
  dayLabel,
  fetchBookableClinicians,
  fetchHousehold,
  fetchPatientProfile,
  fetchServiceLines,
  fetchSymptomCatalog,
  formatTime,
  INTERSTITIAL_REASONS,
  newIdempotencyKey,
  reasonsFor,
  requestAppointment,
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

/** The days this clinician has anything open, earliest first. */
const openDays = (c: ClinicianOption) => Object.keys(c.slotsByDate).sort();

/** The (clinician, department) pair the list row named, from a fresh read. */
function pick(list: ClinicianOption[], id: string, department?: string): ClinicianOption | null {
  return (
    list.find((c) => c.userId === id && (!department || c.departmentId === department)) ?? null
  );
}

/** The last day inside the facility's target: today + N days, as a `dateKey`. */
const windowKey = (days: number) => dateKey(new Date(Date.now() + days * 86_400_000));

/**
 * The no-silent-wait rule's inputs for a slot-mode page (PRD §2.4): the line
 * whose target applies (the department's slot line), and — only when nothing
 * of this doctor's falls inside it — the other clinicians here and elsewhere
 * who have a day that does. Fetched once, with the doctor.
 */
interface Wait {
  line: ServiceLine | null;
  /** `dateKey` of the window's last day; null when no line sets a target. */
  limit: string | null;
  sameService: ClinicianOption[];
  elsewhere: ClinicianOption[];
}

async function loadWait(doctor: ClinicianOption, here: ClinicianOption[]): Promise<Wait> {
  const lines = await fetchServiceLines({ hospitalId: doctor.hospitalId }).catch(() => []);
  const line =
    lines.find((l) => l.departmentId === doctor.departmentId && l.capacityMode === "slot") ?? null;
  if (!line) return { line: null, limit: null, sameService: [], elsewhere: [] };
  const limit = windowKey(line.timeToCareDays);
  const within = (c: ClinicianOption) => openDays(c).some((d) => d <= limit);
  if (within(doctor)) return { line, limit, sameService: [], elsewhere: [] };
  const sameService = here.filter(
    (c) => c.departmentId === doctor.departmentId && c.userId !== doctor.userId && within(c),
  );
  // ADR 0086: every hospital's roster, narrowed to the same-named department.
  const elsewhere = (await fetchBookableClinicians().catch(() => [])).filter(
    (c) =>
      c.hospitalId !== doctor.hospitalId && c.departmentName === doctor.departmentName && within(c),
  );
  return { line, limit, sameService, elsewhere };
}

/**
 * One doctor — the reference's second screen (ADR 0085 §4): photo, rating,
 * name, department; say why, select a day, select a time, and the docked
 * "Book an appointment". One POST at the end — `pt-request-appointment`'s
 * slot path — carrying the chosen slot's instants and a key that makes a
 * retry safe.
 *
 * The reason comes FIRST (PRD §3.3.2): a "new or worsening problem" opens
 * the emergency interstitial before any day or time is on screen, once per
 * flow. Everything shown is what the server offered: the days are the keys
 * of `slotsByDate`, the times are its entries, the count is the length of
 * the list beside it (§3), and the rating is `clinician_rating_summary` or
 * "No ratings yet" (§2). Nothing here derives, filters or rounds. A time is
 * never shown without its day.
 */
export default function DoctorScreen() {
  const router = useRouter();
  // `hospital` is the DOCTOR's hospital, carried by the row that was tapped —
  // not the patient's, which need not be the same (ADR 0086).
  const { id, department, hospital } = useLocalSearchParams<{
    id: string;
    department?: string;
    hospital?: string;
  }>();
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);

  // `undefined` = still loading. `null` = no patient profile for this session.
  const [profile, setProfile] = useState<PatientProfile | null | undefined>();
  // `null` = this doctor has no day open any more (or never did).
  const [doctor, setDoctor] = useState<ClinicianOption | null>(null);
  const [wait, setWait] = useState<Wait | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // Gate D: the adults this account books for; empty hides the choice.
  const [household, setHousehold] = useState<HouseholdMember[]>([]);
  const [forMember, setForMember] = useState<HouseholdMember | null>(null);

  const [reason, setReason] = useState<AppointmentReason | null>(null);
  // Once per flow: dismissed stays dismissed even if the reason changes and comes back.
  const [interstitialSeen, setInterstitialSeen] = useState(false);
  // The reference's screen ends at "Book Session"; who the visit is for, why,
  // the note and the fee live in a sheet that button opens — the choice of a
  // day and a time stays on one screen.
  const [confirming, setConfirming] = useState(false);
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [slot, setSlot] = useState<SlotOffer | null>(null);
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

  // One key per submission attempt, minted on the first press and kept
  // across retries; cleared when the pick changes or the booking lands.
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
        // A patient with no hospital of their own can still book at any of
        // them; only a non-patient has nothing to do here.
        if (!p) {
          setProfile(null);
          return;
        }
        const here = await fetchBookableClinicians(hospital ?? p.hospitalId ?? undefined);
        const found = pick(here, id, department);
        setDoctor(found);
        setDayKey(found ? (openDays(found)[0] ?? null) : null);
        setWait(found ? await loadWait(found, here) : null);
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
        setProfile(p);
      })
      .catch(() => setLoadFailed(true));
  }, [id, department, hospital]);

  useEffect(load, [load]);

  // The DOCTOR's hospital: the row names where the booking lands.
  const hospitalName = doctor?.hospitalName ?? profile?.hospitalName ?? "your hospital";
  const days = doctor ? openDays(doctor) : [];
  // The line's own list when the department has one; Appendix A's 13 otherwise.
  const reasons = wait?.line ? reasonsFor(wait.line) : APPOINTMENT_REASONS;

  const pickReason = (r: AppointmentReason) => {
    setReason(r);
    keyRef.current = null;
  };
  const pickDay = (key: string) => {
    setDayKey(key);
    setSlot(null);
    keyRef.current = null;
  };
  const pickSlot = (s: SlotOffer) => {
    setSlot(s);
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
  // PRD §2.9: a confidential line is never offered for a member.
  const confidential = wait?.line?.confidential === true;

  const onSubmit = async () => {
    if (!profile || !doctor || !reason || !dayKey || !slot || busy) return;
    setBusy(true);
    setError(null);
    keyRef.current ??= newIdempotencyKey();
    // The chips are hidden on a confidential line; a pick that slipped past
    // is refused by the server, never silently re-pointed at the patient.
    const member = forMember;
    const res = await requestAppointment({
      hospitalId: doctor.hospitalId,
      reason,
      reasonNote: note.trim() || null,
      symptoms: report ? null : symptomsReady,
      symptomSubmissionId: report?.submissionId,
      idempotencyKey: keyRef.current,
      forProvisionalId: member?.provisionalPatientId,
      slot: {
        clinicianUserId: doctor.userId,
        departmentId: doctor.departmentId,
        startsAtIso: slot.startsAtIso,
        endsAtIso: slot.endsAtIso,
        // The line whose fee this screen showed — so the core snapshots the
        // quote (ADR 0092). Absent only when no line covers the department.
        serviceLineId: wait?.line?.id,
      },
    });
    if (res.ok) {
      keyRef.current = null;
      clearPendingSymptoms();
      clearPendingCatalogDraft();
      // `data` is undefined on a 2xx with no body (see `callEdge`): the write
      // landed, and the confirmation under-promises rather than guess.
      setDone({
        receipt: res.data ?? {
          appointment_id: "",
          status: "",
          booking_code: null,
          position_number: null,
          arrival_window_start: null,
          arrival_window_end: null,
        },
        startsAtIso: slot.startsAtIso,
        forMember: member?.label ?? null,
      });
      return;
    }
    // The server's sentence, verbatim — "Someone just took this slot — pick
    // another and try again." is something a patient can act on.
    setError(res.error);
    setBusy(false);
    // Then make "pick another" possible: re-read this doctor's open slots, and
    // keep the pick only if it is still offered — otherwise the next tap would
    // ask for the same refused instant again.
    try {
      const fresh = pick(await fetchBookableClinicians(doctor.hospitalId), id, department);
      setDoctor(fresh);
      const freshDays = fresh ? openDays(fresh) : [];
      const day = freshDays.includes(dayKey) ? dayKey : (freshDays[0] ?? null);
      setDayKey(day);
      const still = fresh && day ? fresh.slotsByDate[day] : undefined;
      setSlot(still?.find((s) => s.startsAtIso === slot.startsAtIso) ?? null);
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
          hint="Sign in with your patient account to book a doctor."
        />
      </Screen>
    );
  }

  if (done) {
    // No back control: the request is filed, and a step back would offer the
    // same instant a second time.
    return (
      <Screen
        trailing={<EmergencyButton />}
        footer={<Button label="Done" onPress={() => router.dismissTo("/(app)/(tabs)")} />}
      >
        <BookingDone
          receipt={done.receipt}
          startsAtIso={done.startsAtIso}
          where={
            doctor
              ? `${doctor.fullName} · ${doctor.departmentName} · ${hospitalName}`
              : hospitalName
          }
          forMember={done.forMember}
        />
      </Screen>
    );
  }

  // The row named someone the roster no longer has — the link is stale. A
  // doctor with nothing open is a different case, drawn below with their name.
  if (!doctor) {
    return (
      <Screen {...chrome}>
        <Empty
          icon="calendar-clear-outline"
          title="No days open yet."
          action={
            <View style={styles.exit}>
              <Button
                label="Coming to the hospital today"
                onPress={() => router.replace("/(app)/today")}
              />
              <Text style={styles.exitBody}>
                We save your place in line. You will be seen in turn. We cannot tell you the hour.
              </Text>
            </View>
          }
        />
      </Screen>
    );
  }

  // PRD §2.5: the static card, before any day or time, once per flow. The
  // number is the DOCTOR's hospital's — the line carries it — or none.
  if (reason && INTERSTITIAL_REASONS.has(reason) && !interstitialSeen) {
    return (
      <BookingInterstitial
        hospitalName={hospitalName}
        emergencyPhone={
          wait?.line?.emergencyPhone ??
          (doctor.hospitalId === profile.hospitalId ? profile.emergencyPhone : null)
        }
        onContinue={() => setInterstitialSeen(true)}
      />
    );
  }

  const picked = reasons.find((r) => r.value === reason);
  // Nothing inside the facility's target: the rule's ordered options, then
  // the beyond-window days under their label (PRD §2.4).
  const limit = wait?.limit ?? null;
  const beyond = limit !== null && days.every((d) => d > limit);

  const toOption = (c: ClinicianOption): WaitOption => ({
    key: `${c.userId}:${c.departmentId}`,
    title: c.hospitalId === doctor.hospitalId ? c.fullName : `${c.hospitalName} · ${c.fullName}`,
    subtitle: `Next open: ${dayLabel(openDays(c)[0] ?? "")}`,
    onPress: () =>
      router.replace({
        pathname: "/(app)/doctor/[id]",
        params: { id: c.userId, department: c.departmentId, hospital: c.hospitalId },
      }),
  });

  // The reference's two fields: the day (a calendar behind it) and the time
  // (the day's open times behind it).
  const picker = (
    <DateTimeFields
      slotsByDate={doctor.slotsByDate}
      day={dayKey}
      slot={slot}
      onDay={pickDay}
      onSlot={pickSlot}
    />
  );

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      // Same split as sign-in: the two platforms report the keyboard
      // differently, and one behaviour for both leaves the docked button under
      // it on whichever platform loses.
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <Screen
        {...chrome}
        footer={
          days.length === 0 ? undefined : (
            <Button label="Book session" disabled={!slot} onPress={() => setConfirming(true)} />
          )
        }
      >
        <View style={styles.stack}>
          {/* The person — the reference design's photo card, credential lines,
              action row and stats strip, component for component. Every
              number is one the tables hold (ADR 0085 §2). */}
          <ProviderHero
            doctor={doctor}
            hospitalName={hospitalName}
            allowVirtual={doctor.allowVirtual}
            seenBefore={doctor.seenBefore}
          />

          {/* Nothing open in the next fortnight: say so under the name rather
              than draw an empty strip, and point at the door that is open. */}
          {days.length === 0 ? (
            <Empty
              icon="calendar-clear-outline"
              title="No days open yet."
              hint={`${doctor.fullName} has not put any clinic days on MedSync. You can still be seen — going to the hospital does not depend on this app.`}
              action={
                <Button
                  variant="secondary"
                  label="Coming to the hospital today"
                  onPress={() => router.replace("/(app)/today")}
                />
              }
            />
          ) : null}

          {days.length > 0 ? (
            <Section title="When">
              {beyond && wait?.line ? (
                <NoSilentWait
                  targetDays={wait.line.timeToCareDays}
                  sameService={wait.sameService.map(toOption)}
                  elsewhere={wait.elsewhere.map(toOption)}
                >
                  {picker}
                </NoSilentWait>
              ) : (
                picker
              )}
            </Section>
          ) : null}
        </View>
      </Screen>

      {/* The confirm sheet: everything the booking needs beyond a day and a
          time. Slides up over the screen; the screen itself never scrolls
          for it. */}
      <Modal
        visible={confirming}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setConfirming(false)}
      >
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text accessibilityRole="header" style={styles.sheetTitle}>
              Confirm your visit
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={() => setConfirming(false)}
              hitSlop={8}
              style={styles.sheetClose}
            >
              <Ionicons name="close" size={22} color={colors.foreground} />
            </Pressable>
          </View>
          {slot && dayKey ? (
            <Text style={styles.sheetSummary}>
              {doctor.fullName} · {dayLabel(dayKey)} · {formatTime(slot.startsAtIso)}
            </Text>
          ) : null}
          {/* A pageSheet is its own view controller on iOS, so the page's
              KeyboardAvoidingView never reaches it; the ScrollView pads for
              the keyboard itself, or the search / "Something else" / note
              inputs sit under it. */}
          <ScrollView
            contentContainerStyle={styles.sheetBody}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
          >
            {/* Gate D: who the visit is for. Hidden for a confidential line —
              never shown to, or bookable for, a member (PRD §2.9). */}
            {household.length > 0 && !confidential ? (
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

            <Section
              title={forMember ? `Why is ${forMember.label} coming?` : "Why are you coming?"}
            >
              {/* Appendix A's words, or the department's own list. No entry
                  is a symptom; `urgent_review` is not one of them (ADR 0084 §12). */}
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

            {/* ADR 0095: what is bothering them, as words for the clinic.
                Hidden when the catalogue did not load; the booking stands. */}
            {report ? (
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
            ) : catalog.length > 0 || symptoms.length > 0 ? (
              <SymptomPicker options={catalog} value={symptoms} onChange={pickSymptoms} />
            ) : null}

            {/* ADR 0092: what this clinician's line charges, before the patient
              commits. A single number where the line charges one; a range
              over its cadre fees otherwise — the quote is fixed at booking. */}
            {wait?.line?.id && quoteLine(resolveFee(wait.line.fee, doctor.cadreId)) ? (
              <View style={styles.feeCard}>
                <Text style={styles.feeLabel}>Fee</Text>
                {/* THIS clinician's number, resolved against their cadre — the
                  rule the core applies at booking — never the line's range. */}
                <Text style={styles.feeValue}>
                  {quoteLine(resolveFee(wait.line.fee, doctor.cadreId))}
                </Text>
                <Text style={styles.feeNote}>{FEE_FOOTNOTE}</Text>
                <Text style={styles.feeNote}>{WAIVER_NOTE}</Text>
              </View>
            ) : null}

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

            {error ? (
              <View style={styles.well}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.status.cautionFg} />
                <Text style={styles.wellText} accessibilityLiveRegion="polite">
                  {error}
                </Text>
              </View>
            ) : null}
          </ScrollView>
          <View style={styles.sheetFoot}>
            {symptomsReady === null ? (
              <Text style={styles.hint} accessibilityLiveRegion="polite">
                Choose a duration for each one.
              </Text>
            ) : null}
            <Button
              label="Confirm booking"
              busy={busy}
              disabled={!slot || !reason || symptomsReady === null}
              onPress={() => void onSubmit()}
            />
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    fill: { flex: 1 },
    center: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
    stack: { flexGrow: 1, gap: space[4] },
    sheet: { flex: 1, backgroundColor: c.background },
    sheetHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: space[5],
      paddingTop: space[5],
      paddingBottom: space[2],
    },
    sheetTitle: {
      fontFamily: font.bodySemiBold,
      fontSize: 22,
      lineHeight: 28,
      letterSpacing: -0.3,
      color: c.foreground,
    },
    sheetClose: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.muted,
    },
    sheetSummary: {
      fontFamily: font.body,
      fontSize: 14.5,
      lineHeight: 21,
      color: c.mutedForeground,
      paddingHorizontal: space[5],
      paddingBottom: space[3],
    },
    sheetBody: { paddingHorizontal: space[5], paddingBottom: space[5], gap: space[5] },
    sheetFoot: {
      gap: space[2],
      paddingHorizontal: space[5],
      paddingVertical: space[4],
      borderTopWidth: 1,
      borderTopColor: c.border,
      backgroundColor: c.background,
    },

    // The rating rides on a raised pill so it reads as a badge, not a caption.

    // `Section`'s own head, with a count where its link would go.
    section: { gap: space[3] },
    sectionHead: {
      flexDirection: "row",
      alignItems: "baseline",
      justifyContent: "space-between",
      gap: space[3],
    },
    sectionTitle: {
      fontFamily: font.bodyMedium,
      fontSize: 16.5,
      lineHeight: 22,
      color: c.foreground,
    },
    count: { fontFamily: font.body, fontSize: 13.5, lineHeight: 19, color: c.mutedForeground },

    hint: { fontFamily: font.body, fontSize: 13.5, lineHeight: 19, color: c.mutedForeground },
    reportLine: { fontFamily: font.body, fontSize: 14.5, lineHeight: 21, color: c.foreground },

    // The sunken input: a muted well, no edge until it has focus — and the
    // label lifts in weight too, so focus is never colour alone.
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
      // The web's inputs carry `--input` (= border) as their edge; a sunken
      // fill alone is invisible on the dark page until focus, and a field a
      // patient cannot find is not a field.
      borderWidth: 1,
      borderColor: c.border,
      textAlignVertical: "top",
    },
    inputFocused: { borderColor: c.primary },

    exit: { width: "100%", gap: space[3], alignItems: "center" },
    exitBody: {
      fontFamily: font.body,
      fontSize: 14.5,
      lineHeight: 21,
      color: c.mutedForeground,
      textAlign: "center",
      maxWidth: 300,
    },

    // Amber, not red: a refused request is not a clinical emergency. The amber
    // is the frame and the glyph; the words are in the page's own ink.
    feeCard: { gap: 2, padding: space[4], borderRadius: radius.lg, backgroundColor: c.muted },
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
