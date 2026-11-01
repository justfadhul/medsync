import type { DoctorCard, DoctorPlace } from "@/data/doctors";
import { useCallback, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { ActivityIndicator, Image, ScrollView, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { Button, Chip, ChipRow, Icon, Note, Press, SectionHead, TextLink } from "@/components/tide";
import {
  availabilityWords,
  doctorFilters,
  loadDoctors,
  matchesFilter,
  ratingWords,
  useDoctors,
} from "@/data/doctors";
import { shortDayOf } from "@/features/visits/logic";
import { dateKey } from "@/lib/booking";
import { useNow } from "@/lib/use-now";
import { useTide } from "@/theme/theme";
import { tFont, tRadius, tSpace, tType } from "@/theme/tide";

/**
 * "See a doctor": the real clinicians at every hospital (contract in
 * `data/doctors.ts`), no hospital to choose first, one ID badge each. No count of people anywhere
 * (ADR 0084 §6), no rating, no placeholder doctor.
 */
export function Doctors() {
  const router = useRouter();
  const t = useTide();
  const { status, doctors } = useDoctors();
  const [filter, setFilter] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      void loadDoctors();
    }, []),
  );

  const filters = doctorFilters(doctors);
  const active = filter && filters.includes(filter) ? filter : null;
  const shown = doctors.filter((d) => matchesFilter(d, active));

  const body =
    status === "loading" ? (
      <ActivityIndicator color={t.ink} accessibilityLabel="Loading the doctors" />
    ) : status === "error" ? (
      <View style={{ gap: tSpace[2] }}>
        <Note tone="plain">{"Couldn't load the doctors. Check your connection."}</Note>
        <TextLink label="Try again" onPress={() => void loadDoctors()} />
      </View>
    ) : doctors.length === 0 ? (
      <Note tone="plain">No doctor takes bookings on MedSync yet.</Note>
    ) : (
      <>
        {filters.length > 0 ? (
          <ChipRow scroll>
            {filters.map((f) => (
              <Chip
                key={f}
                label={f}
                size="sm"
                selected={active === f}
                onPress={() => setFilter(active === f ? null : f)}
              />
            ))}
          </ChipRow>
        ) : null}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginHorizontal: -tSpace[5], flexGrow: 0 }}
          contentContainerStyle={{
            paddingHorizontal: tSpace[5],
            paddingBottom: tSpace[2],
            gap: tSpace[3],
          }}
        >
          {shown.map((d) => (
            <DoctorTile key={d.key} d={d} />
          ))}
        </ScrollView>
      </>
    );

  return (
    <View style={{ gap: tSpace[3] }}>
      <SectionHead title="See a doctor" action="See all" onAction={() => router.push("/book")} />
      {body}
    </View>
  );
}

/** The badge: a portrait card, photo over a navy band with a curved shoulder. */
const BADGE_W = 236;
/** The text band is about 40% of the badge (owner, 19 Oct 2026). */
const BADGE_H = 420;
const PHOTO_H = 252;
const CURVE_H = 40;

/**
 * One doctor as an ID badge (owner, 19 Oct 2026): the photo (or their
 * initials) on top, a navy band rising over it in a curve, the name and
 * role in it, and along the foot the next open day and the fee. Tapping the
 * badge asks for a day where they are open first; "Come today" shows when
 * their clinic at the patient's hospital takes walk-ins now.
 */
function DoctorTile({ d }: { d: DoctorCard }) {
  const t = useTide();
  const router = useRouter();
  const ask = (p: DoctorPlace) =>
    router.push({
      pathname: "/book/day",
      params: { doctor: d.userId, department: p.departmentId, hospital: p.hospitalId },
    });
  const now = useNow();
  const firstOpen = d.places.find((p) => p.nextDayKey !== null) ?? null;
  const available = availabilityWords(d.nextDayKey, dateKey(now), shortDayOf);
  // The fee where they would book first.
  const where = firstOpen ?? d.places[0];
  const walkIn = d.places.find((p) => p.walkInToday) ?? null;
  const placeWords =
    d.places.length === 1
      ? `${where.departmentName} · ${where.hospitalName}`
      : `${where.hospitalName} and ${d.places.length - 1} more`;

  return (
    <Press
      onPress={firstOpen ? () => ask(firstOpen) : undefined}
      disabled={!firstOpen}
      accessibilityLabel={`${d.name}, ${d.role}. ${placeWords}. ${available.text}. ${where.feeWords}. ${ratingWords(d.rating)}.${
        firstOpen ? " Ask for a day." : ""
      }`}
      style={{
        width: BADGE_W,
        // A floor, not a fixed height: at large text sizes the band grows (Apple HIG, Dynamic Type).
        minHeight: BADGE_H,
        borderRadius: tRadius.cardLg,
        overflow: "hidden",
        backgroundColor: t.band,
        boxShadow: t.shadow.float,
      }}
    >
      {/* The photo clips its own top corners: an iOS image ignores the card's clip. */}
      <View
        style={{
          height: PHOTO_H,
          backgroundColor: t.surface2,
          borderTopLeftRadius: tRadius.cardLg,
          borderTopRightRadius: tRadius.cardLg,
          overflow: "hidden",
        }}
      >
        {d.photoUrl ? (
          <Image
            source={{ uri: d.photoUrl }}
            accessibilityIgnoresInvertColors
            resizeMode="cover"
            style={{
              width: "100%",
              height: "100%",
              borderTopLeftRadius: tRadius.cardLg,
              borderTopRightRadius: tRadius.cardLg,
            }}
          />
        ) : (
          <View
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              paddingBottom: CURVE_H,
              backgroundColor: t.info.tint,
            }}
          >
            <View
              style={{
                width: 104,
                height: 104,
                borderRadius: 52,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: t.surface,
              }}
            >
              <Text style={{ fontFamily: tFont.semibold, fontSize: 40, color: t.info.text }}>
                {d.initials}
              </Text>
            </View>
          </View>
        )}
        {/* Availability as one icon (the words are in the card's label): a tick when open
            today, a calendar for a later day, a clock when none is open yet. */}
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            position: "absolute",
            top: tSpace[3],
            left: tSpace[3],
            flexDirection: "row",
            alignItems: "center",
            gap: tSpace[1.5],
          }}
        >
          <View
            style={{
              width: 30,
              height: 30,
              borderRadius: 15,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: available.today ? t.accent : t.surface,
            }}
          >
            <Icon
              name={available.today ? "check" : d.nextDayKey ? "calendar" : "clock"}
              size={15}
              strokeWidth={available.today ? 3 : 2}
              color={available.today ? t.onAccent : d.nextDayKey ? t.ink : t.ink3}
            />
          </View>
          {walkIn ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                minHeight: 26,
                paddingHorizontal: 10,
                borderRadius: tRadius.pill,
                backgroundColor: t.band,
              }}
            >
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: t.accent }} />
              <Text style={[tType.caption, { color: t.onBandAccent }]}>Walk-ins today</Text>
            </View>
          ) : null}
        </View>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            position: "absolute",
            top: tSpace[3],
            right: tSpace[3],
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            minHeight: 26,
            paddingHorizontal: 9,
            borderRadius: tRadius.pill,
            backgroundColor: t.surface,
          }}
        >
          <Icon name="star" size={12} color={d.rating ? t.ink : t.ink3} />
          <Text style={[tType.caption, { color: d.rating ? t.ink : t.ink3 }]}>
            {d.rating ? d.rating.average.toFixed(1) : "New"}
          </Text>
        </View>
        {/* The band's shoulder: high on the left, curving down to the right. */}
        <Svg
          width={BADGE_W}
          height={CURVE_H}
          viewBox={`0 0 ${BADGE_W} ${CURVE_H}`}
          style={{ position: "absolute", left: 0, bottom: 0 }}
        >
          <Path
            d={`M0 0 H${BADGE_W * 0.52} C${BADGE_W * 0.66} 0 ${BADGE_W * 0.66} ${CURVE_H * 0.8} ${BADGE_W * 0.8} ${CURVE_H * 0.8} H${BADGE_W} V${CURVE_H} H0 Z`}
            fill={t.band}
          />
        </Svg>
      </View>

      {/* The band stays small so the photo carries the badge. */}
      <View
        style={{
          flex: 1,
          paddingHorizontal: tSpace[4],
          paddingBottom: tSpace[4],
          gap: tSpace[1],
        }}
      >
        <Text
          style={{
            fontFamily: tFont.semibold,
            fontSize: 21,
            lineHeight: 25,
            letterSpacing: -0.3,
            color: t.onBand,
          }}
          numberOfLines={2}
        >
          {d.name}
        </Text>
        <Text style={[tType.bodyS, { color: t.onBand2 }]} numberOfLines={1}>
          {d.role}
        </Text>
        <Text style={[tType.caption, { color: t.onBand2 }]} numberOfLines={1}>
          {placeWords}
        </Text>

        {/* The foot, pinned to the bottom so every badge in the row lines up. */}
        <View style={{ marginTop: "auto", paddingTop: tSpace[2.5], gap: tSpace[2] }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon name="wallet" size={13} color={t.onBand2} />
            <Text style={[tType.caption, { flex: 1, color: t.onBand }]} numberOfLines={1}>
              {where.feeWords}
            </Text>
            {walkIn ? (
              <Button
                size="sm"
                variant="accent"
                label="Come today"
                accessibilityLabel={`Come today to ${walkIn.departmentName}, ${walkIn.hospitalName}`}
                onPress={() =>
                  router.push({ pathname: "/book/today", params: { clinic: walkIn.departmentId } })
                }
              />
            ) : null}
            {firstOpen && !walkIn ? (
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 15,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: t.bandGlass,
                }}
              >
                <Icon name="arrowRight" size={15} color={t.onBand} />
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </Press>
  );
}
