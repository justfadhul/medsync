import type { PatientReasonCode } from "@/supabase/functions/_shared/sessions-sql";
import type { DoctorCard } from "@patient-core/doctors";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Suspense } from "react";
import { feeText } from "@patient-core/fees";
import { lastDays, monthDays, moodsFor, readingsFrom, yearMix } from "@patient-core/log";
import { checkReading } from "@patient-core/readings";
import { nextVisit } from "@patient-core/visits-calendar";
import {
  AlertCircleIcon,
  CalendarDaysIcon,
  ClockIcon,
  FlaskConicalIcon,
  HeartPulseIcon,
  PillIcon,
  UsersRoundIcon,
} from "lucide-react";

import { REASONS } from "@/app/patient/book/_lib/booking";
import { ICON } from "@/components/tide/kit";
import { HelpButton } from "@/components/tide/shell";
import { CARE_V2_COPY } from "@/content/patient-app/care";
import { VISIT_COPY } from "@/content/patient-app/visit";
import { BOOK_COPY as B, DAY_COPY as D, WRONG_COPY as W } from "@/content/patient/book";
import { CARE_COPY } from "@/content/patient/care";
import { HOME_COPY as C } from "@/content/patient/home";
import { TODAY_WEB_COPY as T } from "@/content/patient/today-web";
import { loadDays, loadWalkIns } from "@/lib/patient-web/book-data";
import { loadLabNames } from "@/lib/patient-web/care-labs";
import { loadLog, loadMedicines, today } from "@/lib/patient-web/day";
import { loadDoctors } from "@/lib/patient-web/doctors";
import { careModeOn } from "@/lib/patient-web/flags";
import { fromSlot } from "@/lib/patient-web/opaque";
import { loadWeek } from "@/lib/patient-web/visits-data";
import { fetchHousehold } from "@/lib/patient/household";
import { requirePatientScope } from "@/lib/patient/scope";
import { cn } from "@/lib/utils";
import { PATIENT_REASON_CODES } from "@/supabase/functions/_shared/sessions-sql";
import { DoctorsView, QuietRow } from "./_components/doctors";
import { MoodCard } from "./_components/mood-card";
import { BookHub } from "./_components/today/book-hub";
import { ReadingButton } from "./_components/today/reading-button";
import { shownName } from "./_lib/names";
import { kampalaClock, loadToday } from "./care/_v2/data";
import { TodayClient } from "./care/_v2/today";

export const metadata: Metadata = { title: "Today" };
export const dynamic = "force-dynamic";

const KAMPALA = "Africa/Kampala";
const DATE = new Intl.DateTimeFormat("en-GB", {
  timeZone: KAMPALA,
  weekday: "long",
  day: "numeric",
  month: "long",
});
const SHORT = new Intl.DateTimeFormat("en-GB", {
  timeZone: KAMPALA,
  weekday: "short",
  day: "numeric",
  month: "short",
});
const HOUR = new Intl.DateTimeFormat("en-GB", {
  timeZone: KAMPALA,
  hour: "numeric",
  hourCycle: "h23",
});
const initials = (s: string) =>
  s
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "·";
const CARD = "rounded-pw-card bg-pw-surface shadow-pw-card flex min-w-0 flex-col gap-3 p-5";
const WD = new Intl.DateTimeFormat("en-GB", { weekday: "short" });
const DAYNUM = new Intl.DateTimeFormat("en-GB", { day: "numeric" });
const MON = new Intl.DateTimeFormat("en-GB", { month: "short" });
/** A "Your health" tile on the phone: tinted from its place's colour (`--c`), as the phone's places are. */
const TILE =
  "rounded-[22px] flex min-h-[132px] min-w-0 flex-col gap-1.5 p-3.5 bg-[color-mix(in_srgb,var(--c)_13%,var(--pw-surface))] active:scale-[0.98] transition-[scale] duration-150";
const TAG =
  "bg-pw-surface text-pw-ink-2 self-start rounded-[4px] px-1.5 py-0.5 text-[11px] leading-4 font-bold";

/**
 * Today (the owner's three-page redesign, 22 Nov 2026; replaces Home, Book and the Care hub): the day's band with
 * the greeting, a glance at the next visit, lab tests and blood pressure, the mood check-in and who the patient
 * books for; booking on the page; then readings, medicines, lab tests and the care team, and See a doctor. In
 * Care mode (`careModeOn()`, locked until Gate CG) the care plan comes before booking. Real rows only.
 */
export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string }>;
}) {
  const scope = await requirePatientScope();
  const now = new Date();
  const q = await searchParams;
  const reason: PatientReasonCode = fromSlot(PATIENT_REASON_CODES, q.r) ?? REASONS[0]!.value;
  const home = scope.primaryHospitalId
    ? { id: scope.primaryHospitalId, name: scope.primaryHospitalName ?? "Your hospital" }
    : null;
  // One load for See a doctor and the booking panel's photos; neither waits for it to render.
  const doctors = home ? loadDoctors(home.id).catch(() => null) : Promise.resolve(null);
  const care = careModeOn() ? await loadToday(scope.userId, now).catch(() => null) : null;
  const [week, labs, household, rows, meds, days, walkIns] = await Promise.all([
    loadWeek(scope.userId, scope.primaryHospitalId, now).catch(() => null),
    loadLabNames(scope.userId, scope.primaryHospitalId).catch(() => ({ state: "off" as const })),
    fetchHousehold(scope.userId).catch(() => []),
    // Enough for the mood card's year view, as the mood screen reads it.
    loadLog(scope.userId, 400).catch(() => null),
    loadMedicines(scope.userId).catch(() => null),
    home ? loadDays(home, reason, null).catch(() => null) : Promise.resolve(null),
    home ? loadWalkIns(home.id).catch(() => null) : Promise.resolve(null),
  ]);

  const name = scope.fullName?.trim() || "";
  const first = name.split(/\s+/)[0] || C.there;
  const h = Number(HOUR.format(now));
  const greeting = h < 12 ? T.greeting.morning : h < 17 ? T.greeting.afternoon : T.greeting.evening;
  const next = week ? nextVisit(week.upcoming) : null;
  const readings = rows ? readingsFrom(rows) : [];
  const latest = (k: string) => readings.filter((r) => r.input.kind === k).at(-1) ?? null;
  const bp = latest("bp");
  const bpCheck = bp ? checkReading(bp.input) : null;
  const moods = rows?.filter((r) => r.kind === "mood") ?? [];
  const mood = moodsFor(moods, lastDays(now));
  const todayMood = mood.at(-1);
  const day = meds ? today(meds.meds, meds.takes, now) : null;
  const ready = labs.state === "ready" ? labs.ready.length : 0;
  const waiting = labs.state === "ready" ? labs.notReady.length : 0;
  const who = [
    { id: null, label: name || "Me", rel: T.me },
    ...household.map((m) => ({
      id: m.provisionalPatientId,
      label: m.memberLabel,
      rel: m.relationship,
    })),
  ];

  const moodProps = {
    today: todayMood && todayMood !== "none" ? todayMood : null,
    week: mood,
    weekdays: lastDays(now).map((d) => d.getDay()),
    month: moodsFor(moods, monthDays(now)),
    monthStart: new Date(now.getFullYear(), now.getMonth(), 1).getDay(),
    year: yearMix(moods, now),
    chat: false,
  };
  const last = week
    ? ([...week.past]
        .filter((v) => v.status === "completed")
        .sort((a, b) => b.startsAtIso.localeCompare(a.startsAtIso))[0] ?? null)
    : null;
  const openDay = days?.days[0]?.key ?? null;
  const open = days?.days[0]?.sessions.find((s) => s.placesLeft > 0) ?? null;

  const glance: ReactNode[] = [
    <Glance
      key="visit"
      icon={<CalendarDaysIcon className="size-5" {...ICON} />}
      k={T.glance.nextVisit}
      v={next ? SHORT.format(new Date(next.startsAtIso)) : T.glance.noVisit}
      s={next ? `${next.departmentName} · ${next.hospitalName}` : T.glance.bookOne}
      href={next ? `/patient/visits/${next.id}` : "#book"}
    />,
    <Glance
      key="labs"
      icon={<FlaskConicalIcon className="size-5" {...ICON} />}
      k={T.glance.labs}
      v={labs.state === "ready" ? String(ready + waiting) : "–"}
      s={labs.state === "ready" ? T.glance.labsLine(ready, waiting) : T.labsLater}
      href="#labs"
    />,
    <ReadingButton
      key="bp"
      kind="bp"
      label={`${T.glance.bloodPressure}: ${bp && bp.input.kind === "bp" ? `${bp.input.top}/${bp.input.bottom}` : T.glance.noReading}. ${T.logReading}`}
      className="bg-pw-band-glass flex min-w-0 flex-col items-start gap-0.5 rounded-[18px] p-4 text-left hover:opacity-90"
    >
      <span className="text-pw-on-band-2 flex items-center gap-2 text-[12px] font-semibold">
        <HeartPulseIcon className="size-4" {...ICON} />
        {T.glance.bloodPressure}
      </span>
      <span className="text-[22px] leading-[28px] font-bold tabular-nums">
        {bp && bp.input.kind === "bp" ? `${bp.input.top}/${bp.input.bottom}` : T.glance.noReading}
      </span>
      <span className="text-pw-on-band-2 truncate text-[12px]">
        {bpCheck ? bpCheck.text : T.logReading}
      </span>
    </ReadingButton>,
  ];

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-labelledby="day-h"
        className="rounded-pw-card bg-pw-band text-pw-on-band grid gap-6 p-6 max-[760px]:hidden min-[1101px]:grid-cols-[minmax(0,1fr)_400px]"
      >
        <div className="flex min-w-0 flex-col justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="bg-pw-accent-tint text-pw-accent-text ring-pw-band grid size-[72px] shrink-0 place-items-center rounded-full text-[24px] font-bold ring-4">
              {initials(name || first)}
            </span>
            <div className="min-w-0">
              <p className="text-pw-on-band-2 text-[14px] font-semibold">{DATE.format(now)}</p>
              <h1
                id="day-h"
                className="text-[36px] leading-[42px] font-semibold tracking-[-0.03em]"
              >
                {greeting}, {first}
              </h1>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2.5 min-[700px]:grid-cols-3">{glance}</div>
          <div className="border-pw-on-band/20 flex flex-wrap items-center justify-between gap-3 border-t-2 border-dashed pt-3">
            <p className="text-pw-on-band-2 text-[13px]">
              {T.yourHospital}: <b className="text-pw-on-band">{home?.name ?? "–"}</b>{" "}
              <Link href="/patient/hospitals" className="text-pw-on-band-accent font-semibold">
                {T.change}
              </Link>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-pw-on-band-2 text-[13px] font-semibold">{T.bookFor}</span>
              {household.map((m) => (
                <Link
                  key={m.provisionalPatientId}
                  href="#book"
                  className="bg-pw-band-glass flex min-h-11 items-center gap-2 rounded-full py-1 pr-4 pl-1"
                >
                  <span className="bg-pw-accent-tint text-pw-accent-text grid size-9 place-items-center rounded-full text-[12px] font-bold">
                    {initials(m.memberLabel)}
                  </span>
                  <span className="flex flex-col leading-4">
                    <span className="text-[14px] font-semibold">{m.memberLabel}</span>
                    <span className="text-pw-on-band-2 text-[12px]">{m.relationship}</span>
                  </span>
                </Link>
              ))}
              <Link
                href="/patient/me/household"
                className="border-pw-on-band/30 flex min-h-11 items-center rounded-full border border-dashed px-4 text-[14px] font-semibold"
              >
                + {T.addSomeone}
              </Link>
            </div>
          </div>
        </div>
        <MoodCard {...moodProps} />
      </section>

      {/* The phone's Today (up to 760 px): the greeting, the mood question, the next visit, the ways in, your health. */}
      <div className="flex flex-col gap-6 min-[761px]:hidden">
        <div className="flex items-center gap-3">
          <span className="bg-pw-accent-tint text-pw-accent-text grid size-11 shrink-0 place-items-center rounded-full text-[15px] font-bold">
            {initials(name || first)}
          </span>
          <p className="text-pw-ink-3 min-w-0 flex-1 text-[13px] leading-[17px]">
            {DATE.format(now)}
            <b className="text-pw-ink block text-[15px]">
              {greeting}, {first}
            </b>
          </p>
          {/* The phone's Today has no page header and its booking panel is hidden, so Help sits here (S6). */}
          <HelpButton />
        </div>

        <MoodCard {...moodProps} tone="page" />

        <section
          aria-labelledby="nv-h"
          className="bg-pw-band text-pw-on-band shadow-pw-float flex flex-col gap-3.5 rounded-[26px] p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-pw-on-band-2 text-[12px] font-semibold">{T.glance.nextVisit}</p>
              <h2 id="nv-h" className="text-[20px] leading-[26px] font-semibold">
                {next ? SHORT.format(new Date(next.startsAtIso)) : T.glance.noVisit}
              </h2>
            </div>
            {last ? (
              <p className="text-pw-on-band-2 shrink-0 text-right text-[11px] leading-[15px]">
                {T.lastVisit}
                <b className="text-pw-on-band block text-[13px]">
                  {SHORT.format(new Date(last.startsAtIso))}
                </b>
                {last.departmentName}
              </p>
            ) : null}
          </div>
          {next ? (
            <p className="bg-pw-band-glass rounded-[18px] p-3 text-[14px] font-semibold">
              {next.departmentName} · {next.hospitalName}
            </p>
          ) : open && openDay ? (
            <>
              <div className="bg-pw-band-glass flex items-center gap-3 rounded-[18px] p-2.5">
                <span className="bg-pw-on-band text-pw-band flex h-[62px] w-14 shrink-0 flex-col items-center justify-center rounded-[14px] leading-tight">
                  <small className="text-[10px] font-bold uppercase">
                    {WD.format(new Date(`${openDay}T12:00:00`))}
                  </small>
                  <b className="text-[22px] tabular-nums">
                    {DAYNUM.format(new Date(`${openDay}T12:00:00`))}
                  </b>
                  <small className="text-[10px] font-bold uppercase">
                    {MON.format(new Date(`${openDay}T12:00:00`))}
                  </small>
                </span>
                <span className="text-pw-on-band-2 flex min-w-0 flex-col text-[12px]">
                  <small className="text-[11px]">{T.nextOpenFor}</small>
                  <b className="text-pw-on-band text-[16px]">{open.clinicName}</b>
                  <span>
                    {[
                      open.doors ? D.doors(open.doors) : null,
                      open.clinicianName ? shownName(open.clinicianName) : null,
                      open.feeLabel ?? feeText(open.fee),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </div>
              <ol className="grid grid-cols-3 gap-1.5" aria-label={B.askDayTitle}>
                {T.how.map((h, i) => (
                  <li
                    key={h}
                    className="text-pw-on-band-2 flex flex-col gap-1.5 text-[11px] leading-[14px] font-semibold"
                  >
                    <span className="ring-pw-on-band/35 text-pw-on-band grid size-[22px] place-items-center rounded-full ring-1 ring-inset">
                      {i + 1}
                    </span>
                    {h}
                  </li>
                ))}
              </ol>
            </>
          ) : null}
          <div className="flex flex-wrap gap-1.5 text-[12px] font-semibold">
            <span className="bg-pw-band-glass rounded-full px-2.5 py-1.5">
              {home?.name ?? T.yourHospital}
            </span>
            <span className="bg-pw-band-glass rounded-full px-2.5 py-1.5">
              {VISIT_COPY.ticket.seenInTurn}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={next ? `/patient/visits/${next.id}` : "#book"}
              className="bg-pw-on-band text-pw-band flex min-h-11 items-center rounded-full px-5 text-[15px] font-bold"
            >
              {next ? T.seeInVisits : B.askDayTitle}
            </Link>
            {next ? null : (
              <Link
                href="/patient/book/day"
                className="ring-pw-on-band/30 flex min-h-11 items-center rounded-full px-4 text-[14px] font-semibold ring-1 ring-inset"
              >
                {T.otherDays}
              </Link>
            )}
          </div>
        </section>

        <div className="-mt-3 grid grid-cols-2 gap-2">
          {(
            [
              [
                "/patient/book/today",
                ClockIcon,
                B.comeTodayTitle,
                walkIns?.length ? T.walkInsOpen(walkIns.length) : B.noWalkIns,
              ],
              ["/patient/book/wrong", AlertCircleIcon, W.title, B.doorWrongSub],
            ] as const
          ).map(([href, Icon, title, line]) => (
            <Link
              key={href}
              href={href}
              className="rounded-pw-card bg-pw-surface shadow-pw-card flex flex-col gap-2 p-3"
            >
              <span className="bg-pw-surface-2 grid size-9 place-items-center rounded-xl">
                <Icon className="size-[18px]" {...ICON} />
              </span>
              <b className="text-[14px] leading-[18px]">{title}</b>
              <span className="text-pw-ink-3 text-[12px] leading-4">{line}</span>
            </Link>
          ))}
        </div>

        <section aria-labelledby="yh-h" className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="yh-h" className="text-[19px] font-semibold">
              {T.yourHealth}
            </h2>
            <span className="text-pw-ink-3 text-[12px]">{T.onlyYouShort}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <ReadingButton
              kind="bp"
              className={cn(TILE, "text-left [--c:var(--pw-area-readings)]")}
              label={`${T.glance.bloodPressure}. ${T.logReading}`}
            >
              <TileHead Icon={HeartPulseIcon} k={T.glance.bloodPressure} />
              <span className="mt-auto text-[26px] leading-8 font-bold tracking-[-0.02em] tabular-nums">
                {bp && bp.input.kind === "bp" ? `${bp.input.top}/${bp.input.bottom}` : "–"}
              </span>
              <span className="text-pw-ink-2 text-[12px]">
                {bp ? SHORT.format(new Date(bp.at)) : T.glance.noReading}
              </span>
              {bpCheck ? <span className={TAG}>{bpCheck.text}</span> : null}
            </ReadingButton>
            <Link
              href="/patient/care/medicines"
              className={cn(TILE, "[--c:var(--pw-area-medicines)]")}
            >
              <TileHead Icon={PillIcon} k={T.medicines} />
              {day && day.doses.length ? (
                <>
                  <span className="mt-auto text-[26px] leading-8 font-bold tabular-nums">
                    {day.taken} / {day.total}
                  </span>
                  <span className="text-pw-ink-2 truncate text-[12px]">
                    {day.doses[0]!.medicine} · {day.doses[0]!.time}
                  </span>
                </>
              ) : (
                <span className="text-pw-ink-2 mt-auto text-[13px]">{C.addMedicine}</span>
              )}
            </Link>
            <Link
              href={labs.state === "ready" && ready ? "/patient/care/labs" : "/patient/me/records"}
              className={cn(TILE, "[--c:var(--pw-area-visits)]")}
            >
              <TileHead Icon={FlaskConicalIcon} k={T.labTests} />
              {labs.state === "ready" && ready + waiting > 0 ? (
                <>
                  <span className="mt-auto text-[26px] leading-8 font-bold tabular-nums">
                    {ready + waiting}
                  </span>
                  <span className="text-pw-ink-2 text-[12px]">
                    {T.glance.labsLine(ready, waiting)}
                  </span>
                </>
              ) : (
                <span className="text-pw-ink-2 mt-auto text-[12px]">{T.labsLater}</span>
              )}
            </Link>
            <Link
              href={care ? "/patient/care/my-care" : "#book"}
              className={cn(TILE, "[--c:var(--pw-area-team)]")}
            >
              <TileHead Icon={UsersRoundIcon} k={care ? T.myCare : T.careTeam} />
              <span className="text-pw-ink-2 mt-auto text-[12px]">{CARE_COPY.messages.notYet}</span>
            </Link>
            <ReadingButton
              className={cn(
                TILE,
                "col-span-2 min-h-0 flex-row items-center justify-between text-left [--c:var(--pw-accent)]",
              )}
            >
              <span className="text-pw-ink-2 text-[12px]">
                <b className="text-pw-ink block text-[14px]">{T.logReading}</b>
                {T.logLine}
              </span>
              <span className="bg-pw-surface rounded-full px-3 py-2 text-[12px] font-bold">
                {T.log}
              </span>
            </ReadingButton>
          </div>
        </section>
      </div>

      {care ? (
        <section aria-labelledby="plan-h" className={CARD}>
          <h2 id="plan-h" className="text-[24px] font-semibold">
            {T.carePlan}
          </h2>
          <p className="text-pw-ink-3 -mt-2 text-[13px]">{T.carePlanLine}</p>
          <TodayClient
            hero={care.hero}
            slots={care.slots}
            nowLabel={kampalaClock(now)}
            snippets={care.snippets}
            planVersionId={care.care.planVersionId}
          />
        </section>
      ) : null}

      <BookHub
        hospitalId={home?.id ?? null}
        hospitalName={days?.hospitalName ?? home?.name ?? ""}
        who={who}
        reasons={REASONS.map((r) => ({ value: r.value, title: r.title }))}
        reason={reason}
        days={days ? days.days : home ? null : []}
        walkIns={walkIns ? walkIns.length : null}
        doctors={doctors}
      />

      <div className="grid grid-cols-1 gap-4 max-[760px]:hidden min-[761px]:grid-cols-2 min-[1101px]:grid-cols-4">
        <section aria-labelledby="rd-h" className={CARD}>
          <div className="flex items-center justify-between gap-2">
            <h2 id="rd-h" className="text-[17px] font-semibold">
              {T.readings}
            </h2>
            <ReadingButton className="text-pw-accent-text min-h-11 text-[14px] font-semibold">
              {T.logReading}
            </ReadingButton>
          </div>
          {(["bp", "sugar", "weight"] as const).map((k) => {
            const r = latest(k);
            const v = !r
              ? T.glance.noReading
              : r.input.kind === "bp"
                ? `${r.input.top}/${r.input.bottom}`
                : String("value" in r.input ? r.input.value : "");
            return (
              <div
                key={k}
                className="bg-pw-surface-2 rounded-pw-row flex items-center justify-between gap-2 px-3 py-2"
              >
                <span className="flex flex-col">
                  <span className="text-pw-ink-3 text-[12px]">
                    {CARE_V2_COPY.readings.titles[k]}
                  </span>
                  <span className="text-[17px] font-bold tabular-nums">{v}</span>
                </span>
                <span className="text-pw-ink-3 text-[12px]">
                  {r ? SHORT.format(new Date(r.at)) : ""}
                </span>
              </div>
            );
          })}
          <p className="text-pw-ink-3 text-[13px]">{T.onlyYou}</p>
        </section>

        <section aria-labelledby="md-h" className={CARD}>
          <div className="flex items-center justify-between gap-2">
            <h2 id="md-h" className="text-[17px] font-semibold">
              {T.medicines}
            </h2>
            {day ? (
              <span className="text-pw-ink-3 text-[13px]">
                {day.taken} / {day.total}
              </span>
            ) : null}
          </div>
          {day && day.doses.length ? (
            day.doses.map((d) => (
              <Link
                key={d.id}
                href="/patient/care/medicines"
                className="bg-pw-surface-2 rounded-pw-row flex items-center justify-between gap-2 px-3 py-2"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[15px] font-semibold">{d.medicine}</span>
                  <span className="text-pw-ink-3 text-[12px]">{d.time}</span>
                </span>
                <span className="text-[13px] font-bold">
                  {d.status === "taken"
                    ? CARE_V2_COPY.plan.taken
                    : d.status === "due"
                      ? CARE_V2_COPY.plan.due
                      : d.status === "missed"
                        ? CARE_V2_COPY.plan.missed
                        : CARE_V2_COPY.plan.later}
                </span>
              </Link>
            ))
          ) : (
            <Link
              href="/patient/care/medicines"
              className="text-pw-accent-text text-[15px] font-semibold"
            >
              {C.addMedicine}
            </Link>
          )}
        </section>

        <section id="labs" aria-labelledby="lb-h" className={`${CARD} scroll-mt-24`}>
          <h2 id="lb-h" className="text-[17px] font-semibold">
            {T.labTests}
          </h2>
          {labs.state === "ready" && labs.ready.length + labs.notReady.length > 0 ? (
            <>
              {labs.notReady.map((l) => (
                <div key={l.key} className="bg-pw-surface-2 rounded-pw-row flex flex-col px-3 py-2">
                  <span className="text-pw-ink-3 text-[12px]">{T.labsWaiting}</span>
                  <span className="text-[15px] font-semibold">{l.test}</span>
                  <span className="text-pw-ink-3 text-[12px]">{l.line}</span>
                </div>
              ))}
              {labs.ready.map((l) => (
                <Link
                  key={l.id}
                  href="/patient/care/labs"
                  className="bg-pw-surface-2 rounded-pw-row flex flex-col px-3 py-2"
                >
                  <span className="text-pw-ink-3 text-[12px]">{T.labsReady}</span>
                  <span className="text-[15px] font-semibold">{l.test}</span>
                  <span className="text-pw-ink-3 text-[12px]">
                    {l.releasedOn} · {l.hospitalName}
                  </span>
                </Link>
              ))}
            </>
          ) : (
            <p className="text-pw-ink-2 text-[15px]">{T.labsLater}</p>
          )}
          <Link
            href="/patient/me/records"
            className="text-pw-accent-text mt-auto text-[15px] font-semibold"
          >
            {T.openRecords}
          </Link>
        </section>

        <section aria-labelledby="ct-h" className={CARD}>
          <h2 id="ct-h" className="text-[17px] font-semibold">
            {care ? CARE_V2_COPY.myCare.title : T.careTeam}
          </h2>
          {care ? (
            <Link
              href="/patient/care/my-care"
              className="text-pw-accent-text text-[15px] font-semibold"
            >
              {CARE_V2_COPY.myCare.team} · {CARE_V2_COPY.myCare.checks} · {T.messages}
            </Link>
          ) : (
            <>
              <p className="text-[15px]">
                {CARE_COPY.messages.notYet} {CARE_COPY.messages.instead}
              </p>
              <Link href="#book" className="text-pw-accent-text text-[15px] font-semibold">
                {T.bookVisit}
              </Link>
            </>
          )}
          <p className="text-pw-ink-3 text-[13px]">{CARE_V2_COPY.messages.notForEmergencies}</p>
        </section>
      </div>

      {/* DoctorsView carries its own heading and See all. */}
      <section className={CARD}>
        {home ? (
          <Suspense fallback={<QuietRow line={C.doctorsLoading} />}>
            <Doctors doctors={doctors} />
          </Suspense>
        ) : (
          <QuietRow line={C.doctorsNoHospital} href="/patient/hospitals" />
        )}
      </section>
    </div>
  );
}

async function Doctors(p: { doctors: Promise<DoctorCard[] | null> }) {
  return <DoctorsView doctors={await p.doctors} />;
}

function TileHead(p: { Icon: typeof PillIcon; k: string }) {
  return (
    <span className="text-pw-ink-2 flex items-center gap-2 text-[12px] font-semibold">
      <span className="bg-pw-surface grid size-[30px] place-items-center rounded-full text-[var(--c)]">
        <p.Icon className="size-4" {...ICON} />
      </span>
      {p.k}
    </span>
  );
}

function Glance(p: { icon: ReactNode; k: string; v: string; s: string; href: string }) {
  return (
    <Link
      href={p.href}
      className="bg-pw-band-glass flex min-w-0 flex-col gap-0.5 rounded-[18px] p-4 hover:opacity-90"
    >
      <span className="text-pw-on-band-2 flex items-center gap-2 text-[12px] font-semibold">
        {p.icon}
        {p.k}
      </span>
      <span className="truncate text-[22px] leading-[28px] font-bold tabular-nums">{p.v}</span>
      <span className="text-pw-on-band-2 truncate text-[12px]">{p.s}</span>
    </Link>
  );
}
