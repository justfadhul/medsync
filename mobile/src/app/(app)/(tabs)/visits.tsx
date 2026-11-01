import type { Week } from "@/data/visits";
import type { AppointmentRow, HouseholdMember } from "@/lib/booking";
import type { WaitlistEntry } from "@/lib/notifications";
import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { Text, View } from "react-native";

import { Button, Card, DateTile, Icon, Note, Press, Screen, SkeletonCard } from "@/components/tide";
import { useMedicines } from "@/data/medicines";
import { loadWeek } from "@/data/visits";
import {
  addDays,
  dayKeyOf,
  dayNumberOf,
  daysBetween,
  inDays,
  monthGrid,
  monthShortOf,
  monthTitleOf,
  shiftMonth,
  shortDayOf,
  weekdayOf,
} from "@/features/visits/logic";
import { Dot } from "@/features/visits/parts";
import { WaitlistCard } from "@/features/visits/waitlist-card";
import { APPOINTMENT_REASONS, fetchHousehold, STATUS_LABEL } from "@/lib/booking";
import { fetchWaitlist } from "@/lib/notifications";
import { useNow } from "@/lib/use-now";
import { useTide } from "@/theme/theme";
import { tFont, tRadius, tSpace, tType } from "@/theme/tide";

/**
 * This week (board TWeek/DWeek, PRD F-08).
 *
 * All real: the patient's appointments (`fetchAppointments`, RLS), the clinic
 * days that still have a place (`fetchSessions`) and today's medicines from
 * the patient's own list (`useMedicines`). No example rows.
 *
 * The header pill names the next visit by what it is for, never by the
 * clinician. A visit shows its status, never a place number or an hour
 * (law L8, ADR 0084 §6).
 */

/** Statuses that no longer put a visit on the calendar. */
const GONE = new Set(["cancelled", "declined", "no_show", "rescheduled"]);
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

const reasonTitle = (row: AppointmentRow) =>
  APPOINTMENT_REASONS.find((r) => r.value === row.reason)?.title ?? row.departmentName;
const placeWord = (row: AppointmentRow) => STATUS_LABEL[row.status] ?? "";

export default function VisitsScreen() {
  const t = useTide();
  const router = useRouter();
  const now = useNow();
  const today = dayKeyOf(now);
  const meds = useMedicines(now);

  const [week, setWeek] = useState<Week | null>(null);
  const [failed, setFailed] = useState(false);
  const [month, setMonth] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);

  // Re-read on focus: Visit detail moves and cancels, and this list must say so.
  const load = useCallback(() => {
    loadWeek(new Date()).then(
      (w) => {
        setWeek(w);
        setFailed(false);
      },
      () => setFailed(true),
    );
    // Gate E: places in line, named for the household member they are for.
    fetchHousehold()
      .catch(() => [] as HouseholdMember[])
      .then((h) => fetchWaitlist(new Map(h.map((m) => [m.provisionalPatientId, m.label]))))
      .then(setWaitlist, () => setWaitlist([]));
  }, []);
  useFocusEffect(load);

  const shownMonth = month ?? today;
  const sel = picked ?? today;
  const visits = [...(week?.upcoming ?? []), ...(week?.past ?? [])].filter(
    (v) => !GONE.has(v.status),
  );
  const visitsOn = (key: string) => visits.filter((v) => dayKeyOf(v.startsAtIso) === key);
  const next = (week?.upcoming ?? [])
    .filter((v) => !GONE.has(v.status) && v.status !== "completed")
    .sort((a, b) => a.startsAtIso.localeCompare(b.startsAtIso))[0];

  /* the selected-day line */
  const selVisit = visitsOn(sel)[0];
  const selOpen = week?.openDays.has(sel) ?? false;
  let selTitle = shortDayOf(sel);
  let selLine = sel < today ? "Past day" : "Nothing planned. The clinic is closed.";
  if (sel === today) {
    selTitle = "Today";
    selLine = meds.total > 0 ? medsWords(meds.taken, meds.total) : "Nothing planned.";
  }
  if (selOpen) {
    selTitle = `${shortDayOf(sel)} · Clinic open`;
    selLine = "Places left. Book to save one.";
  }
  if (selVisit) {
    selTitle = `${shortDayOf(sel)} · Your visit`;
    selLine = `${reasonTitle(selVisit)} · ${placeWord(selVisit)}`;
  }
  const openVisit = (id: string) => router.push({ pathname: "/visits/[id]", params: { id } });

  /* the week ahead: today's medicines, then this week's visits */
  const end = addDays(today, 6);
  const inWeek = (key: string) => key > today && key <= end;
  const rows: { key: string; node: ReactNode }[] = [
    ...(meds.total > 0
      ? [
          {
            key: today,
            node: (
              <MedicinesCard
                taken={meds.taken}
                total={meds.total}
                onPress={() => router.push("/care/medicines")}
              />
            ),
          },
        ]
      : []),
    ...visits
      .filter((v) => inWeek(dayKeyOf(v.startsAtIso)))
      .map((v) => ({
        key: dayKeyOf(v.startsAtIso),
        node: <VisitCard row={v} onOpen={() => openVisit(v.id)} />,
      })),
  ].sort((a, b) => a.key.localeCompare(b.key));
  const shown = open ? rows : rows.slice(0, 2);
  const hidden = rows.length - 2;

  return (
    <Screen
      underNav
      bell
      helpSource="visits"
      header={
        <NextPill
          row={next ?? null}
          days={next ? daysBetween(today, dayKeyOf(next.startsAtIso)) : 0}
          onPress={() => (next ? openVisit(next.id) : router.push("/book"))}
        />
      }
    >
      {failed ? (
        <View style={{ gap: tSpace[2] }}>
          <Note tone="plain">{"Couldn't load your visits. Check your connection."}</Note>
          <Button label="Try again" variant="outline" size="md" onPress={load} />
        </View>
      ) : week === null ? (
        <View style={{ gap: tSpace[2.5] }}>
          <SkeletonCard label="Loading your visits" lines={2} />
          <SkeletonCard label="" lines={2} />
        </View>
      ) : null}

      {/* An open offer is the most time-bound thing on the page. */}
      {waitlist.map((entry) => (
        <WaitlistCard
          key={entry.id}
          entry={entry}
          onChanged={({ bookedAppointmentId }) => {
            load();
            if (bookedAppointmentId) openVisit(bookedAppointmentId);
          }}
        />
      ))}

      {/* calendar */}
      <Card radius={tRadius.panel} padding={tSpace[3]} style={{ gap: tSpace[2] }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 4,
          }}
        >
          <View>
            <Text style={[tType.overline, { color: t.ink2 }]}>Your calendar</Text>
            <Text accessibilityRole="header" style={[tType.section, { color: t.ink }]}>
              {monthTitleOf(shownMonth)}
            </Text>
          </View>
          <View style={{ flexDirection: "row", gap: tSpace[1.5] }}>
            {([-1, 1] as const).map((d) => (
              <Press
                key={d}
                onPress={() => setMonth(shiftMonth(shownMonth, d))}
                accessibilityLabel={d < 0 ? "Previous month" : "Next month"}
                hitSlop={4}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: t.bg,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon name={d < 0 ? "back" : "forward"} size={18} color={t.ink} />
              </Press>
            ))}
          </View>
        </View>
        <View style={{ flexDirection: "row" }}>
          {WEEKDAYS.map((w, i) => (
            <Text
              key={i}
              style={[
                tType.micro,
                { flex: 1, textAlign: "center", fontFamily: tFont.semibold, color: t.ink3 },
              ]}
            >
              {w}
            </Text>
          ))}
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {monthGrid(shownMonth).map((key, i) => {
            if (!key) return <View key={`b${i}`} style={{ width: `${100 / 7}%`, height: 44 }} />;
            const isToday = key === today;
            const isVisit = visitsOn(key).length > 0;
            const isOpen = week?.openDays.has(key) ?? false;
            const isPicked = key === sel;
            const dot = isVisit ? t.area.visits : "transparent";
            const label = [
              shortDayOf(key),
              isToday ? "today" : null,
              isOpen ? "clinic open" : null,
              isVisit ? "your visit" : null,
            ]
              .filter(Boolean)
              .join(", ");
            return (
              <Press
                key={key}
                onPress={() => setPicked(key)}
                accessibilityLabel={label}
                accessibilityState={{ selected: isPicked }}
                haptic={false}
                style={{
                  width: `${100 / 7}%`,
                  height: 44,
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 2,
                }}
              >
                <View
                  style={{
                    width: 34,
                    height: 30,
                    borderRadius: tRadius.pill,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: isToday ? t.band : isOpen ? t.accentTint : "transparent",
                    borderWidth: isVisit || isPicked ? 2 : 0,
                    borderColor: isVisit ? t.ink : t.accent,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: isToday || isVisit || isOpen ? tFont.bold : tFont.medium,
                      fontSize: 14,
                      color: isToday
                        ? t.onBand
                        : key < today
                          ? t.ink3
                          : isOpen
                            ? t.accentText
                            : t.ink,
                    }}
                  >
                    {Number(key.slice(8))}
                  </Text>
                </View>
                <Dot color={dot} size={5} />
              </Press>
            );
          })}
        </View>
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            columnGap: tSpace[3],
            rowGap: tSpace[1.5],
            paddingHorizontal: 4,
          }}
        >
          <Legend
            swatch={
              <View
                style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: t.accentTint }}
              />
            }
            label="Clinic open"
          />
          <Legend
            swatch={
              <View
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 7,
                  borderWidth: 2,
                  borderColor: t.ink,
                }}
              />
            }
            label="Your visit"
          />
        </View>
        <View
          accessibilityLiveRegion="polite"
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: tSpace[2.5],
            padding: tSpace[3],
            borderRadius: tRadius.field,
            backgroundColor: t.bg,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={[tType.label, { fontSize: 15, color: t.ink }]}>{selTitle}</Text>
            <Text style={[tType.bodyS, { fontFamily: tFont.regular, color: t.ink2 }]}>
              {selLine}
            </Text>
          </View>
          {selVisit ? (
            <Button label="Open" size="sm" onPress={() => openVisit(selVisit.id)} />
          ) : selOpen ? (
            <Button
              label="Book"
              size="sm"
              variant="accent"
              onPress={() => router.push({ pathname: "/book/day", params: { day: sel } })}
            />
          ) : null}
        </View>
      </Card>

      {/* the week ahead */}
      <View style={{ gap: 2, marginTop: tSpace[2] }}>
        <Text style={[tType.bodyM, { fontSize: 14, color: t.ink2 }]}>
          {`${dayNumberOf(today)} to ${dayNumberOf(end)} ${monthShortOf(end)}`}
        </Text>
        <Text accessibilityRole="header" style={[tType.title, { color: t.ink }]}>
          Your week ahead
        </Text>
      </View>
      {week && rows.length === 0 ? (
        <Note tone="plain">
          {visits.length === 0
            ? "No visits yet. When you book one, it shows here."
            : "Nothing planned this week."}
        </Note>
      ) : null}
      {/* The rail has no left gutter, so today's tile meets the screen edge. */}
      <View style={{ marginLeft: -tSpace[5], gap: tSpace[2.5] }}>
        {shown.map((r, i) => (
          <View
            key={`${r.key}-${i}`}
            style={{ flexDirection: "row", gap: tSpace[3.5], alignItems: "flex-start" }}
          >
            {r.key === today ? (
              <View>
                <DateTile day={dayNumberOf(r.key)} label="Today" selected bleed="left" />
                <View style={{ position: "absolute", top: 9, right: 9 }}>
                  <Dot color={t.accent} size={9} />
                </View>
              </View>
            ) : (
              <DateTile day={dayNumberOf(r.key)} label={weekdayOf(r.key)} />
            )}
            <View style={{ flex: 1 }}>{r.node}</View>
          </View>
        ))}
        {hidden > 0 ? (
          <View style={{ alignItems: "center", paddingLeft: tSpace[5] }}>
            <Press
              onPress={() => setOpen((o) => !o)}
              accessibilityState={{ expanded: open }}
              style={{
                minHeight: 44,
                paddingHorizontal: tSpace[4],
                borderRadius: tRadius.pill,
                backgroundColor: t.surface,
                flexDirection: "row",
                alignItems: "center",
                gap: tSpace[1.5],
                boxShadow: t.shadow.card,
              }}
            >
              <Text style={[tType.labelS, { color: t.ink }]}>
                {open ? "Show less" : `${hidden} more this week`}
              </Text>
              <Icon name={open ? "arrowUp" : "down"} size={18} color={t.ink} />
            </Press>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

function Legend({ swatch, label }: { swatch: ReactNode; label: string }) {
  const t = useTide();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      {swatch}
      <Text style={[tType.caption, { fontFamily: tFont.medium, color: t.ink2 }]}>{label}</Text>
    </View>
  );
}

/** The header pill: the next visit by its day and what it is for. No clinician name. */
function NextPill({
  row,
  days,
  onPress,
}: {
  row: AppointmentRow | null;
  days: number;
  onPress: () => void;
}) {
  const t = useTide();
  const key = row ? dayKeyOf(row.startsAtIso) : null;
  const title = row ? reasonTitle(row) : "Book a visit";
  return (
    <Press
      onPress={onPress}
      accessibilityLabel={
        row && key
          ? `Next: your visit on ${shortDayOf(key)}, ${title}, ${placeWord(row)}`
          : "No visit booked. Book a visit"
      }
      style={{
        flex: 1,
        minHeight: 48,
        paddingLeft: 6,
        paddingRight: tSpace[3],
        borderRadius: tRadius.pill,
        backgroundColor: t.surface,
        flexDirection: "row",
        alignItems: "center",
        gap: tSpace[2.5],
        boxShadow: t.shadow.card,
      }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: t.band,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {key ? (
          <>
            <Text style={{ fontFamily: tFont.bold, fontSize: 13, lineHeight: 13, color: t.onBand }}>
              {dayNumberOf(key)}
            </Text>
            <Text
              style={{
                fontFamily: tFont.semibold,
                fontSize: 11,
                lineHeight: 13,
                letterSpacing: 0.3,
                textTransform: "uppercase",
                color: t.onBandAccent,
              }}
            >
              {weekdayOf(key)}
            </Text>
          </>
        ) : (
          <Icon name="calendar" size={18} color={t.onBand} />
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <Dot color={t.area.visits} size={6} />
          <Text
            style={[
              tType.micro,
              {
                fontFamily: tFont.semibold,
                letterSpacing: 0.55,
                textTransform: "uppercase",
                color: t.ink2,
              },
            ]}
          >
            {row ? `Next · ${inDays(days)}` : "No visit booked"}
          </Text>
        </View>
        <Text numberOfLines={1} style={[tType.label, { fontSize: 15, color: t.ink }]}>
          {title}
        </Text>
      </View>
      <Icon name="forward" size={18} color={t.ink3} />
    </Press>
  );
}

function RailCard({
  children,
  onPress,
  label,
}: {
  children: ReactNode;
  onPress?: () => void;
  label?: string;
}) {
  return (
    <Card
      onPress={onPress}
      accessibilityLabel={label}
      radius={tRadius.card}
      padding={tSpace[3]}
      style={{ gap: tSpace[1], marginRight: tSpace[5] }}
    >
      {children}
    </Card>
  );
}

function Kind({ color, label, right }: { color: string; label: string; right?: ReactNode }) {
  const t = useTide();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: tSpace[2],
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 7, flexShrink: 1 }}>
        <Dot color={color} />
        <Text style={[tType.bodyS, { color: t.ink2 }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
      {right}
    </View>
  );
}

/** "2 of 4 medicines taken today": the patient's own list, never an example. */
function medsWords(taken: number, total: number): string {
  return `${taken} of ${total} ${total === 1 ? "medicine" : "medicines"} taken today`;
}

function MedicinesCard({
  taken,
  total,
  onPress,
}: {
  taken: number;
  total: number;
  onPress: () => void;
}) {
  const t = useTide();
  return (
    <RailCard onPress={onPress} label={`Your medicines, ${medsWords(taken, total)}`}>
      <Kind color={t.area.medicines} label="Your medicines" />
      <Text style={[tType.label, { color: t.ink }]}>{medsWords(taken, total)}</Text>
      <View style={{ flexDirection: "row", gap: 4 }}>
        {Array.from({ length: total }, (_, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: 6,
              borderRadius: 3,
              backgroundColor: i < taken ? t.primary : t.line,
            }}
          />
        ))}
      </View>
    </RailCard>
  );
}

function VisitCard({ row, onOpen }: { row: AppointmentRow; onOpen: () => void }) {
  const t = useTide();
  return (
    <RailCard>
      <Kind
        color={t.area.visits}
        label={row.forMember ? `Visit · for ${row.forMember}` : "Visit"}
        right={<Text style={[tType.labelS, { color: t.ink2 }]}>{placeWord(row)}</Text>}
      />
      <Press
        onPress={onOpen}
        accessibilityRole="link"
        haptic={false}
        style={{ minHeight: 28, justifyContent: "center" }}
      >
        <Text style={[tType.label, { color: t.ink }]}>{reasonTitle(row)}</Text>
      </Press>
      <View style={{ flexDirection: "row", alignItems: "center", gap: tSpace[2], paddingTop: 2 }}>
        <Text
          style={[tType.bodyM, { flex: 1, fontFamily: tFont.regular, fontSize: 14, color: t.ink2 }]}
          numberOfLines={1}
        >
          {row.hospitalName}
        </Text>
        <Press
          onPress={onOpen}
          accessibilityLabel="Directions"
          hitSlop={4}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: t.accent,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="mapPin" size={18} color={t.onAccent} />
        </Press>
      </View>
    </RailCard>
  );
}
