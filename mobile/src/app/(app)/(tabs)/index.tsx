import type {
  AppointmentRow,
  BookingSymptomOption,
  ClinicianOption,
  ClinicSession,
  HospitalOption,
  LiveIntake,
  PatientProfile,
  ServiceLine,
} from "@/lib/booking";
import type { Palette } from "@/theme/tokens";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { DEFAULT_TIME_ZONE, localWeekdayAndMinutes } from "@shared/slots";
import { CATALOG } from "@shared/symptom-catalog/catalog.v0.1";
import { dangerSigns, visibleItems } from "@shared/symptom-catalog/classify";
import { useFocusEffect, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ProviderCard } from "@/components/patient/provider-card";
import { ServiceLineCard } from "@/components/patient/service-line-card";
import { SymptomQuickPick } from "@/components/patient/symptom-quick-pick";
import { DangerStrip } from "@/components/symptoms/danger-strip";
import { Watermark } from "@/components/symptoms/watermark";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Chip, ChipRow } from "@/components/ui/chip";
import { Empty } from "@/components/ui/empty";
import { HeroAction, HeroCard } from "@/components/ui/hero-card";
import { Screen } from "@/components/ui/screen";
import { Section } from "@/components/ui/section";
import {
  canArrive,
  choosePrimaryHospital,
  dateKey,
  dayLabel,
  fetchAppointments,
  fetchBookableClinicians,
  fetchHospitals,
  fetchLiveIntake,
  fetchMyAvatarUrl,
  fetchPatientProfile,
  fetchServiceLines,
  fetchSessions,
  fetchSymptomCatalog,
  formatTime,
  markArrived,
  RESCHEDULABLE,
  sessionTakeable,
  STAGE_WORD,
  STATUS_LABEL,
} from "@/lib/booking";
import { useSession } from "@/lib/session";
import { useCatalogMode } from "@/lib/symptoms";
import { useStyles, useTheme } from "@/theme/theme";
import { font, radius, space, withAlpha } from "@/theme/tokens";

/** Choosing a hospital still lives on the web, like signup does. */

/**
 * What the patient is told they already have today. Lifted verbatim from
 * `app/patient/queue/page.tsx` (`INTAKE_TITLE`) so the phone and the web
 * describe the same intake in the same words. No jargon, no mechanism, no
 * count — the queue is department-scoped and there is no hospital-wide number
 * to show (ADR 0084 §6).
 */
const INTAKE_TITLE: Record<string, string> = {
  declared: "We have already saved you a place today.",
  arrived: "You are already at the hospital today.",
  awaiting_triage: "You are already at the hospital today.",
  triaged: "A nurse has already seen you today.",
};

/** How many doctors the home shows before "View all" — the list is the doctors screen. */
const DOCTORS_ON_HOME = 3;

/**
 * "Good morning" by the HOSPITAL's clock, never the phone's — the same rule
 * every other zone-sensitive value in `lib/booking` follows. Morning until
 * noon, afternoon until five, evening after.
 */
function greetingNow(): string {
  const { minutesOfDay } = localWeekdayAndMinutes(new Date(), DEFAULT_TIME_ZONE);
  if (minutesOfDay < 720) return "Good morning";
  if (minutesOfDay < 1020) return "Good afternoon";
  return "Good evening";
}

type Home =
  | { kind: "loading" }
  /** The profile read failed. Nothing below the emergency block is trustworthy. */
  | { kind: "error" }
  /** Signed in, but no `patient_profiles` row — a staff account in the patient app. */
  | { kind: "not-patient" }
  | {
      kind: "ready";
      profile: PatientProfile;
      visit: AppointmentRow | null;
      ticket: LiveIntake | null;
      /** Null when the read failed — the section is then absent, not an error. */
      doctors: ClinicianOption[] | null;
      /** Session-mode lines at this hospital (ADR 0087), with their open days; null = read failed. */
      clinics: { line: ServiceLine; next: ClinicSession | null }[] | null;
    };

/**
 * The workspace home — ADR 0084 §1–§2 with ADR 0085 §4 on top: the greeting,
 * the question, what is in motion, the two doors, and the doctors.
 *
 * The emergency block no longer lives here; it is the red tab (ADR 0085 §5).
 * The greeting needs no data, so it never moves; everything under it waits
 * for the profile — which is why the hospital name heads the question rather
 * than the screen.
 *
 * Both doors are always shown when there is a hospital; a live ticket does not
 * hide the same-day door. The screen behind it owns the "you already have a
 * place" case, and the server's refusal reaches the patient verbatim if the
 * two ever disagree.
 *
 * "How are you feeling today?" is the heading over a descriptive shortlist
 * (ADR 0096): words the booking carries, `duration: null` until the booking
 * asks. Nothing reads the picks before a booking is filed, and nothing
 * orders, routes or colours by them.
 */
export default function HomeScreen() {
  const router = useRouter();
  const { session, signOut } = useSession();
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const [home, setHome] = useState<Home>({ kind: "loading" });
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [department, setDepartment] = useState<string | null>(null);
  // ADR 0096: the shortlist's words. Empty (a failed read) hides the chips.
  const [catalog, setCatalog] = useState<BookingSymptomOption[]>([]);
  // ADR 0098 Gate CS: the tiered catalog replaces the shortlist only when it may render.
  const catalogMode = useCatalogMode();
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  // Gate D: "I have arrived" from the hero, on the day itself.
  const [arriving, setArriving] = useState(false);
  const [arriveError, setArriveError] = useState<string | null>(null);

  // The account holder, the way the ticket names them: `full_name` is what
  // signup wrote to auth metadata — the same value `users.full_name` mirrors.
  const fullName = session?.user.user_metadata?.full_name;
  const firstName = typeof fullName === "string" ? fullName.split(" ")[0] : undefined;
  const greeting = greetingNow();

  const load = useCallback(async () => {
    // A refresh keeps what is on screen and fails quietly; only the first load
    // shows the spinner or the error. Otherwise every return from a door
    // blanks the doors, and a dropped packet on the way back replaces a good
    // screen with "try again".
    setHome((h) => (h.kind === "ready" ? h : { kind: "loading" }));
    // Never throws; null is the monogram, on day one and on a bad connection.
    void fetchMyAvatarUrl().then(setAvatarUrl);
    let profile: PatientProfile | null;
    try {
      profile = await fetchPatientProfile();
    } catch {
      setHome((h) => (h.kind === "ready" ? h : { kind: "error" }));
      return;
    }
    if (!profile) {
      setHome({ kind: "not-patient" });
      return;
    }
    if (!profile.hospitalId) {
      setHome({
        kind: "ready",
        profile,
        visit: null,
        ticket: null,
        doctors: null,
        clinics: null,
      });
      return;
    }
    // ponytail: the three glances fail to "absent", never to an error screen —
    // the same rule as the web home, which must survive a scheduling outage.
    // The screen then claims nothing about visits, places or doctors, which is
    // true; the doors still work and the server still refuses a duplicate with
    // its own sentence. Ceiling: a patient with a live ticket whose read failed
    // sees no ticket card. Upgrade path: a per-card "couldn't check" line.
    const [visit, ticket, doctors, lines, sessions, catalogue] = await Promise.all([
      fetchAppointments("upcoming-active", 1).then(
        (rows) => rows[0] ?? null,
        () => null,
      ),
      fetchLiveIntake(profile.hospitalId).catch(() => null),
      fetchBookableClinicians(profile.hospitalId).catch(() => null),
      fetchServiceLines({ hospitalId: profile.hospitalId }).catch(() => null),
      fetchSessions({ hospitalId: profile.hospitalId }).catch(() => null),
      fetchSymptomCatalog().catch(() => []),
    ]);
    setCatalog(catalogue);
    // The next open day per clinic — sessions arrive soonest first, so the
    // first open one of a line is its next. A line with none says so.
    const clinics =
      lines && sessions
        ? lines
            .filter((l) => l.capacityMode === "session")
            .map((line) => ({
              line,
              next: sessions.find((s) => s.serviceLineId === line.id && sessionTakeable(s)) ?? null,
            }))
        : null;
    setHome({ kind: "ready", profile, visit, ticket, doctors, clinics });
  }, []);

  // On focus rather than on mount: a patient returning from the same-day door
  // has just been given a place, and the home must show it without a restart.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // The function's own gate is `canArrive`; its refusal sentence lands in
  // the well under the hero verbatim. Success re-reads the home so the hero
  // says "You've arrived" from the row, not from a guess.
  const onArrived = useCallback(
    async (appointmentId: string) => {
      if (arriving) return;
      setArriving(true);
      setArriveError(null);
      const res = await markArrived(appointmentId);
      setArriving(false);
      if (!res.ok) {
        setArriveError(res.error);
        return;
      }
      void load();
    },
    [arriving, load],
  );

  const onSignOut = useCallback(async () => {
    // Feedback, not a lock: `signOut` awaits the server before the gate moves,
    // which on a slow connection is seconds of a tap that seems to do nothing.
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  }, [signOut]);

  let body: ReactNode;
  if (home.kind === "loading") {
    body = (
      <ActivityIndicator
        color={colors.primary}
        accessibilityLabel="Loading"
        style={styles.loading}
      />
    );
  } else if (home.kind === "error") {
    body = (
      <Empty
        icon="cloud-offline-outline"
        title="Couldn't load your hospital."
        hint="Check your connection and try again."
        action={<Button variant="secondary" label="Try again" onPress={load} />}
      />
    );
  } else if (home.kind === "not-patient") {
    // A patient reaches sign-out through Settings; a staff account has no
    // Settings control here, so the way out sits under the sentence that
    // tells them to take it. The gate does the redirect.
    body = (
      <Empty
        icon="person-outline"
        title="We couldn't find a patient account for this sign-in."
        hint="The MedSync app is for patients. Sign out and sign in with your patient account."
        action={
          <Button variant="secondary" label="Sign out" busy={signingOut} onPress={onSignOut} />
        }
      />
    );
  } else if (!home.profile.hospitalId) {
    // A new patient's home is the hospital list until they choose one —
    // MedSync Book starts with "where". The web lands on the same page.
    body = <HospitalPicker onChosen={() => void load()} />;
  } else {
    const { profile, visit, ticket, doctors, clinics } = home;

    // The departments present, in the order the server sends (soonest open
    // day first); a chip that no longer exists after a refresh falls back to
    // "All" rather than filtering everything away.
    const departments = (doctors ?? []).filter(
      (o, i, all) => all.findIndex((x) => x.departmentId === o.departmentId) === i,
    );
    const filter = departments.some((d) => d.departmentId === department) ? department : null;
    // The reference's "Let's find your doctor": one box that narrows both
    // lists to what is already on the screen — a name, a department, a
    // specialty, a clinic. Nothing is fetched to flatter a query.
    const q = query.trim().toLowerCase();
    const hit = (...parts: (string | null | undefined)[]) =>
      q === "" || parts.some((p) => p?.toLowerCase().includes(q));
    const shown = (doctors ?? [])
      .filter((o) => filter === null || o.departmentId === filter)
      .filter((o) => hit(o.fullName, o.departmentName, o.specialty))
      .slice(0, DOCTORS_ON_HOME);
    const shownClinics = (clinics ?? []).filter(({ line }) => hit(line.name, line.departmentName));

    // One thing in motion, at most. A place saved today outranks a visit on
    // another day — same order the two glances always had.
    let hero: ReactNode = null;
    if (ticket) {
      const sentence = INTAKE_TITLE[ticket.status] ?? "You are already in today's line.";
      const stage = STAGE_WORD[ticket.status];
      hero = (
        <HeroCard
          eyebrow="Your place today"
          title={ticket.departmentName ?? sentence}
          subtitle={ticket.departmentName ? sentence : undefined}
          tiles={[
            { icon: "pricetag-outline", label: "Patient code", value: profile.patientCode },
            ...(stage
              ? [{ icon: "footsteps-outline" as const, label: "Stage", value: stage }]
              : []),
          ]}
          actions={
            <HeroAction
              variant="primary"
              label="Open your ticket"
              onPress={() => router.push("/(app)/ticket")}
            />
          }
        />
      );
    } else if (visit) {
      const word = STATUS_LABEL[visit.status];
      const arrivable = canArrive(visit);
      hero = (
        <HeroCard
          leading={
            <Avatar
              name={visit.clinicianName}
              uri={visit.clinicianPhotoUrl}
              size={56}
              tone="onPrimary"
            />
          }
          // A household member's visit says whose it is (Gate D).
          eyebrow={[
            visit.forMember ? `For ${visit.forMember}` : "Your next visit",
            word,
            visit.bookingCode ? `Code ${visit.bookingCode}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          title={visit.clinicianName || "Your clinician"}
          subtitle={`${visit.departmentName} · ${visit.hospitalName}`}
          // The day always beside the time, in the hospital's zone (ADR 0085 §3).
          tiles={[
            {
              icon: "calendar-outline",
              label: "Day",
              value: dayLabel(dateKey(new Date(visit.startsAtIso))),
            },
            // A clinic day is a position, not a time (ADR 0087).
            visit.positionNumber !== null
              ? { icon: "people-outline", label: "Position", value: String(visit.positionNumber) }
              : { icon: "time-outline", label: "Time", value: formatTime(visit.startsAtIso) },
          ]}
          // On the day itself, arriving is the white pill (Gate D); a
          // member's visit is logistics only, so no "Move it" for it.
          actions={
            <>
              {arrivable ? (
                <HeroAction
                  variant="primary"
                  label="I have arrived"
                  onPress={() => void onArrived(visit.id)}
                />
              ) : null}
              <HeroAction
                variant={arrivable ? "ghost" : "primary"}
                label="See this visit"
                onPress={() =>
                  router.push({ pathname: "/(app)/visit/[id]", params: { id: visit.id } })
                }
              />
              {!arrivable && visit.forMember === null && RESCHEDULABLE.has(visit.status) ? (
                <HeroAction
                  label="Move it"
                  onPress={() =>
                    router.push({
                      pathname: "/(app)/visit/[id]",
                      params: { id: visit.id, move: "1" },
                    })
                  }
                />
              ) : null}
            </>
          }
        />
      );
    }

    body = (
      <>
        {/* The hospital the doors lead to, over the one question the screen
            asks. Placed here rather than in the chrome so the greeting stays
            first and never shifts when the name arrives. */}
        <View style={styles.heading}>
          <Text accessibilityRole="header" style={styles.question}>
            How are you feeling today?
          </Text>
        </View>
        {/* ADR 0098 ruling 2: with the catalog live, the adult danger signs
            and the door to "What's wrong?" stand here; a draft says so. With
            it off (production until Gate CS), the ADR 0096 shortlist exactly
            as shipped. Nothing shows until the mode is known. */}
        {catalogMode === "off" && catalog.length > 0 ? (
          <SymptomQuickPick options={catalog} />
        ) : null}
        {catalogMode === "signed" || catalogMode === "draft_watermarked" ? (
          <View style={styles.catalogBlock}>
            {catalogMode === "draft_watermarked" ? <Watermark /> : null}
            <DangerStrip
              items={dangerSigns(CATALOG, "adult")}
              onPress={(item) =>
                router.push({ pathname: "/(app)/symptoms", params: { item: item.key } })
              }
              allCount={visibleItems(CATALOG, "adult").filter((i) => i.tier === "E").length}
              onAll={() => router.push("/(app)/symptoms")}
            />
            <Button label="What's wrong? Tell us" onPress={() => router.push("/(app)/symptoms")} />
          </View>
        ) : null}

        {hero ? (
          <Section title="Coming up">
            {hero}
            {arriveError ? (
              <View style={styles.well}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.status.cautionFg} />
                <Text style={styles.wellText} accessibilityLiveRegion="polite">
                  {arriveError}
                </Text>
              </View>
            ) : null}
          </Section>
        ) : null}

        {/* ⚠ RATIFIED PATIENT-FACING COPY — ADR 0084 §1 and §2. ⚠
            The words are the decision. Do not paraphrase, do not add a number
            to either door. Primary is a LAYOUT fact: full width, the one
            filled surface on the screen, first in order. The booking door is
            demoted by having less of everything. The glyphs are distinct and
            subordinate; the label carries the meaning. */}
        <Section title="Get seen">
          {/* Two doors in one row — the reference's tiles. The disc sits over
              the title, the one sentence under it; the primary is the one
              filled surface (ADR 0084 §1), the other a card with a hairline. */}
          <View style={styles.doors}>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/(app)/today")}
              style={({ pressed }) => [styles.door, styles.primaryDoor, pressed && styles.pressed]}
            >
              <View
                style={[styles.disc, styles.primaryDisc]}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <Ionicons name="walk-outline" size={20} color={colors.ctaForeground} />
              </View>
              <Text style={styles.primaryTitle}>Coming to the hospital today</Text>
              <Text style={styles.primaryBody}>We cannot tell you the hour.</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/(app)/book")}
              style={({ pressed }) => [
                styles.door,
                styles.secondaryDoor,
                pressed && styles.pressed,
              ]}
            >
              <View
                style={[styles.disc, styles.secondaryDisc]}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <Ionicons name="calendar-outline" size={20} color={colors.placeForeground} />
              </View>
              <Text style={styles.secondaryTitle}>Ask for a day — the clinic confirms</Text>
              <Text style={styles.secondaryBody}>Choose from the days the clinic has open.</Text>
            </Pressable>
          </View>
        </Section>

        {(doctors && doctors.length > 0) || (clinics && clinics.length > 0) ? (
          <Section
            title="Let's find your doctor"
            action={{ label: "Book a visit", onPress: () => router.push("/(app)/book") }}
          >
            <View style={[styles.search, searchFocused && styles.searchFocused]}>
              <Ionicons name="search-outline" size={18} color={colors.mutedForeground} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                placeholder="A clinician, a department, a clinic"
                placeholderTextColor={colors.mutedForeground}
                selectionColor={colors.primary}
                autoCorrect={false}
                returnKeyType="search"
                clearButtonMode="while-editing"
                accessibilityLabel="Search clinicians and clinics by name or department"
                style={styles.searchInput}
              />
            </View>
            {q !== "" ? (
              <Text style={styles.searchCount} accessibilityLiveRegion="polite">
                {shown.length} {shown.length === 1 ? "clinician" : "clinicians"} and{" "}
                {shownClinics.length} {shownClinics.length === 1 ? "clinic" : "clinics"} match
              </Text>
            ) : null}
          </Section>
        ) : null}

        {/* ADR 0085 §4: the doctors, filtered by department, three at most —
            the full list is the booking door. Every photo and every rating
            here came from the server; a missing one is a monogram and
            "No ratings yet", never a stand-in. A failed read hides the
            section rather than apologising for it. */}
        {doctors && doctors.length > 0 ? (
          <Section
            title="Doctors"
            action={{ label: "View all", onPress: () => router.push("/(app)/book") }}
          >
            <ChipRow>
              <Chip
                role="button"
                label="All"
                selected={filter === null}
                onPress={() => setDepartment(null)}
              />
              {departments.map((d) => (
                <Chip
                  key={d.departmentId}
                  role="button"
                  label={d.departmentName}
                  selected={filter === d.departmentId}
                  onPress={() => setDepartment(d.departmentId)}
                />
              ))}
            </ChipRow>
            {/* A horizontal carousel of cards — the reference's home row.
                `contentContainerStyle` carries the gutter so the first card
                is whole at the edge rather than cut by the page padding. */}
            {shown.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                snapToAlignment="start"
                decelerationRate="fast"
                contentContainerStyle={styles.carousel}
                style={styles.carouselBleed}
              >
                {shown.map((o) => (
                  <ProviderCard
                    key={`${o.userId}:${o.departmentId}`}
                    option={o}
                    seenBefore={o.seenBefore}
                    width={168}
                    onPress={() =>
                      router.push({
                        pathname: "/(app)/doctor/[id]",
                        params: {
                          id: o.userId,
                          department: o.departmentId,
                          hospital: o.hospitalId,
                        },
                      })
                    }
                  />
                ))}
              </ScrollView>
            ) : (
              // The chips stay so the department can be reset; the query
              // can be cleared from the box above.
              <Text style={styles.searchCount}>No clinician here matches that.</Text>
            )}
          </Section>
        ) : null}

        {/* ADR 0087: the clinics that book by the day — a place in a
            published clinic day rather than a clinician's time. The next
            open day and its places are the allocator's own numbers. */}
        {shownClinics.length > 0 ? (
          <Section title="Find care">
            {/* The reference's category grid. The one filled tile is the
                clinic with something open soonest — emphasis carrying a fact,
                never a decoration. */}
            <View style={styles.grid}>
              {shownClinics.map(({ line, next }) => (
                <ServiceLineCard
                  key={line.id}
                  line={line}
                  soonest={next}
                  emphasis={line.id === soonestClinicId(shownClinics)}
                  onPress={() =>
                    router.push({ pathname: "/(app)/clinic/[id]", params: { id: line.id } })
                  }
                />
              ))}
            </View>
          </Section>
        ) : null}
      </>
    );
  }

  return (
    <Screen>
      <View style={styles.column}>
        {/* The reference's top strip, drawn as the web header is: the
            wordmark, the hospital beside it, and on the right the one circle
            that does something — the patient's own photo, which opens
            Settings. No bell: there is no inbox to open. */}
        <View style={styles.wordmarkRow}>
          <View style={styles.wordmarkGroup}>
            <Text style={styles.wordmark}>MedSync</Text>
            {home.kind === "ready" && home.profile.hospitalName ? (
              <View style={styles.hospitalTag}>
                <View style={styles.dot} accessibilityElementsHidden />
                <Text style={styles.hospitalName} numberOfLines={1}>
                  {home.profile.hospitalName}
                </Text>
              </View>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Your profile and settings"
            onPress={() => router.push("/(app)/(tabs)/settings")}
            hitSlop={8}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Avatar
              name={typeof fullName === "string" ? fullName : undefined}
              size={44}
              uri={avatarUrl}
            />
          </Pressable>
        </View>

        {/* The greeting needs no data, so it never moves. */}
        <View style={styles.greeting}>
          <Text style={styles.greetingWord}>{greeting}</Text>
          {firstName ? <Text style={styles.name}>{firstName}</Text> : null}
        </View>

        {body}
      </View>
    </Screen>
  );
}

/**
 * The landing for a patient with no hospital yet: one question, every active
 * hospital, one tap. Same words as the web's directory.
 */
function HospitalPicker({ onChosen }: { onChosen: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const [hospitals, setHospitals] = useState<HospitalOption[] | null | undefined>(undefined);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchHospitals().then(
      (rows) => {
        if (live) setHospitals(rows);
      },
      () => {
        if (live) setHospitals(null);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const choose = async (id: string) => {
    setChoosing(id);
    setError(null);
    try {
      await choosePrimaryHospital(id);
      onChosen();
    } catch {
      setError("Couldn't save that — try again in a moment.");
      setChoosing(null);
    }
  };

  return (
    <View style={styles.picker}>
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={styles.question}>
          Choose your hospital
        </Text>
        <Text style={styles.pickerLead}>
          See its clinics and book a visit. You can change it any time.
        </Text>
      </View>

      {hospitals === undefined ? (
        <ActivityIndicator style={styles.loading} accessibilityLabel="Loading hospitals" />
      ) : hospitals === null ? (
        <Empty
          icon="cloud-offline-outline"
          title="Couldn't load the hospitals."
          hint="Check your connection and pull to refresh."
        />
      ) : hospitals.length === 0 ? (
        <Empty
          icon="business-outline"
          title="No hospital is accepting patients yet."
          hint="Check back soon."
        />
      ) : (
        <View style={styles.rows}>
          {hospitals.map((h) => {
            const place = [h.district, h.region].filter(Boolean).join(", ");
            return (
              <View key={h.id} style={styles.hospital}>
                <View style={styles.hospitalIcon} accessibilityElementsHidden>
                  <Ionicons name="business-outline" size={20} color={colors.placeForeground} />
                </View>
                <View style={styles.hospitalText}>
                  <Text style={styles.pickName}>{h.name}</Text>
                  <Text style={styles.pickMeta}>
                    {[HOSPITAL_LEVEL_LABEL[h.level] ?? h.level, place].filter(Boolean).join(" · ")}
                  </Text>
                </View>
                <Button
                  label={choosing === h.id ? "Saving…" : "Choose"}
                  accessibilityLabel={`Choose ${h.name} as your hospital`}
                  busy={choosing === h.id}
                  disabled={choosing !== null}
                  onPress={() => void choose(h.id)}
                />
              </View>
            );
          })}
        </View>
      )}

      {error ? (
        <View style={styles.well}>
          <Ionicons name="alert-circle-outline" size={18} color={colors.status.cautionFg} />
          <Text style={styles.wellText} accessibilityLiveRegion="polite">
            {error}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const HOSPITAL_LEVEL_LABEL: Record<string, string> = {
  national_referral: "National referral",
  regional: "Regional referral",
  district: "District hospital",
  hc4: "Health centre IV",
  hc3: "Health centre III",
  private: "Private hospital",
};

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    column: { flexGrow: 1, gap: space[5] },
    picker: { gap: space[5] },
    pickerLead: { fontFamily: font.body, fontSize: 14.5, lineHeight: 21, color: c.mutedForeground },
    hospital: {
      flexDirection: "row",
      alignItems: "center",
      gap: space[3],
      padding: space[4],
      borderRadius: radius["2xl"],
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.border,
    },
    hospitalIcon: {
      width: 44,
      height: 44,
      borderRadius: radius.lg,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.place,
    },
    hospitalText: { flex: 1, gap: 2 },
    pickName: {
      fontFamily: font.bodyMedium,
      fontSize: 15,
      lineHeight: 20,
      color: c.foreground,
    },
    pickMeta: {
      fontFamily: font.body,
      fontSize: 12.5,
      lineHeight: 17,
      color: c.mutedForeground,
    },
    loading: { marginTop: space[8] },
    rows: { gap: space[3] },
    // The carousel bleeds to the screen edge (the Screen pads by space[5])
    // and puts that gutter back inside, so a card sits flush at the start
    // and the last one can scroll fully into view.
    carouselBleed: { marginHorizontal: -space[5] },
    carousel: { paddingHorizontal: space[5], gap: space[3] },
    // Two tiles per row, equal height per row (the tiles stretch).
    grid: { flexDirection: "row", flexWrap: "wrap", gap: space[3] },

    wordmarkRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: space[3],
    },
    wordmarkGroup: { flex: 1, flexDirection: "row", alignItems: "center", gap: space[3] },
    wordmark: {
      fontFamily: font.display,
      fontSize: 17,
      letterSpacing: -0.2,
      color: c.foreground,
    },
    hospitalTag: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
    dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: c.primary },
    hospitalName: {
      flex: 1,
      fontFamily: font.body,
      fontSize: 13,
      color: c.mutedForeground,
    },
    greeting: { gap: 2 },
    greetingWord: {
      fontFamily: font.body,
      fontSize: 13.5,
      lineHeight: 19,
      color: c.mutedForeground,
    },
    name: { fontFamily: font.bodyMedium, fontSize: 16, lineHeight: 22, color: c.foreground },

    heading: { gap: space[1] },
    catalogBlock: { gap: space[3] },
    search: {
      flexDirection: "row",
      alignItems: "center",
      gap: space[2],
      minHeight: 48,
      paddingHorizontal: space[4],
      borderRadius: radius.xl,
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.border,
    },
    searchFocused: { borderColor: c.primary },
    searchInput: {
      flex: 1,
      fontFamily: font.body,
      fontSize: 14.5,
      color: c.foreground,
      paddingVertical: space[3],
    },
    searchCount: { fontFamily: font.body, fontSize: 12.5, color: c.mutedForeground },
    question: {
      fontFamily: font.display,
      fontSize: 28,
      lineHeight: 34,
      letterSpacing: -0.6,
      color: c.foreground,
    },

    doors: { flexDirection: "row", gap: space[3] },
    door: {
      flex: 1,
      gap: space[2],
      borderRadius: radius["2xl"],
    },
    disc: {
      width: 36,
      height: 36,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
    },

    // The signature pair — the mint fill and its dark ink — spent on the one
    // primary act of the screen, as a full-width surface rather than a pill.
    primaryDoor: { padding: space[4], backgroundColor: c.cta },
    primaryDisc: { backgroundColor: withAlpha(c.ctaForeground, 0.12) },
    primaryTitle: {
      fontFamily: font.display,
      fontSize: 17,
      lineHeight: 22,
      letterSpacing: -0.2,
      color: c.ctaForeground,
    },
    primaryBody: { fontFamily: font.body, fontSize: 13, lineHeight: 18, color: c.ctaMuted },

    // A plain card with a hairline: the demotion is having less — no fill, a
    // smaller title, the page's own ink.
    secondaryDoor: {
      padding: space[4],
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.border,
    },
    secondaryDisc: { backgroundColor: c.place },
    // The same card as the secondary door: a clinic is a booking door too.
    clinic: {
      flexDirection: "row",
      alignItems: "center",
      gap: space[3],
      padding: space[4],
      borderRadius: radius["2xl"],
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.border,
    },
    secondaryTitle: {
      fontFamily: font.bodyMedium,
      fontSize: 15,
      lineHeight: 20,
      color: c.foreground,
    },
    secondaryBody: {
      fontFamily: font.body,
      fontSize: 13,
      lineHeight: 18,
      color: c.mutedForeground,
    },

    // Opacity, never scale — same rule as the buttons.
    pressed: { opacity: 0.88 },

    // Amber, not red: a refused arrival is not a clinical emergency.
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

/** The clinic with a day open soonest — the one tile drawn filled; null when nothing is open. */
function soonestClinicId(
  clinics: readonly { line: ServiceLine; next: ClinicSession | null }[],
): string | null {
  const open = clinics.filter((c) => c.next !== null);
  if (open.length === 0) return null;
  return open.reduce((best, c) =>
    (c.next as ClinicSession).startsAtIso < (best.next as ClinicSession).startsAtIso ? c : best,
  ).line.id;
}
