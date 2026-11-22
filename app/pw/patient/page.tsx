import type { PatientReasonCode } from "@/supabase/functions/_shared/sessions-sql";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Suspense } from "react";
import { lastDays, monthDays, moodsFor, readingsFrom, yearMix } from "@patient-core/log";
import { checkReading } from "@patient-core/readings";
import { nextVisit } from "@patient-core/visits-calendar";
import { CalendarDaysIcon, FlaskConicalIcon, HeartPulseIcon } from "lucide-react";

import { REASONS } from "@/app/patient/book/_lib/booking";
import { ICON } from "@/components/tide/kit";
import { CARE_V2_COPY } from "@/content/patient-app/care";
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
import { PATIENT_REASON_CODES } from "@/supabase/functions/_shared/sessions-sql";
import { DoctorsView, QuietRow } from "./_components/doctors";
import { MoodCard } from "./_components/mood-card";
import { BookHub } from "./_components/today/book-hub";
import { ReadingButton } from "./_components/today/reading-button";
import { kampalaClock, loadToday } from "./care/_v2/data";
import { TodayClient } from "./care/_v2/today";

export const metadata: Metadata = { title: "Today" };
export const dynamic = "force-dynamic";

const KAMPALA = "Africa/Kampala";
const DATE = new Intl.DateTimeFormat("en-GB", { timeZone: KAMPALA, weekday: "long", day: "numeric", month: "long" });
const SHORT = new Intl.DateTimeFormat("en-GB", { timeZone: KAMPALA, weekday: "short", day: "numeric", month: "short" });
const HOUR = new Intl.DateTimeFormat("en-GB", { timeZone: KAMPALA, hour: "numeric", hourCycle: "h23" });
const initials = (s: string) =>
  s
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "·";
const CARD = "rounded-pw-card bg-pw-surface shadow-pw-card flex min-w-0 flex-col gap-3 p-5";

/**
 * Today (the owner's three-page redesign, 22 Nov 2026; replaces Home, Book and the Care hub): the day's band with
 * the greeting, a glance at the next visit, lab tests and blood pressure, the mood check-in and who the patient
 * books for; booking on the page; then readings, medicines, lab tests and the care team, and See a doctor. In
 * Care mode (`careModeOn()`, locked until Gate CG) the care plan comes before booking. Real rows only.
 */
export default async function TodayPage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const scope = await requirePatientScope();
  const now = new Date();
  const q = await searchParams;
  const reason: PatientReasonCode = fromSlot(PATIENT_REASON_CODES, q.r) ?? REASONS[0]!.value;
  const home = scope.primaryHospitalId
    ? { id: scope.primaryHospitalId, name: scope.primaryHospitalName ?? "Your hospital" }
    : null;
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
    ...household.map((m) => ({ id: m.provisionalPatientId, label: m.memberLabel, rel: m.relationship })),
  ];

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
      className="flex min-w-0 flex-col items-start gap-0.5 rounded-[18px] bg-pw-band-glass p-4 text-left hover:opacity-90"
    >
      <span className="text-pw-on-band-2 flex items-center gap-2 text-[12px] font-semibold">
        <HeartPulseIcon className="size-4" {...ICON} />
        {T.glance.bloodPressure}
      </span>
      <span className="text-[22px] leading-[28px] font-bold tabular-nums">
        {bp && bp.input.kind === "bp" ? `${bp.input.top}/${bp.input.bottom}` : T.glance.noReading}
      </span>
      <span className="text-pw-on-band-2 truncate text-[12px]">{bpCheck ? bpCheck.text : T.logReading}</span>
    </ReadingButton>,
  ];

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-labelledby="day-h"
        className="rounded-pw-card bg-pw-band text-pw-on-band grid gap-6 p-6 min-[1101px]:grid-cols-[minmax(0,1fr)_400px]"
      >
        <div className="flex min-w-0 flex-col justify-between gap-5">
          <div className="flex items-center gap-4">
            <span className="bg-pw-accent-tint text-pw-accent-text ring-pw-band grid size-[72px] shrink-0 place-items-center rounded-full text-[24px] font-bold ring-4">
              {initials(name || first)}
            </span>
            <div className="min-w-0">
              <p className="text-pw-on-band-2 text-[14px] font-semibold">{DATE.format(now)}</p>
              <h1 id="day-h" className="text-[36px] leading-[42px] font-semibold tracking-[-0.03em]">
                {greeting}, {first}
              </h1>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2.5 min-[700px]:grid-cols-3">{glance}</div>
        </div>
        <MoodCard
          today={todayMood && todayMood !== "none" ? todayMood : null}
          week={mood}
          weekdays={lastDays(now).map((d) => d.getDay())}
          month={moodsFor(moods, monthDays(now))}
          monthStart={new Date(now.getFullYear(), now.getMonth(), 1).getDay()}
          year={yearMix(moods, now)}
          chat={false}
        />
        <div className="border-pw-on-band/20 col-span-full flex flex-wrap items-center justify-between gap-3 border-t-2 border-dashed pt-4">
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
                className="flex min-h-11 items-center gap-2 rounded-full bg-pw-band-glass py-1 pr-4 pl-1"
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
              className="flex min-h-11 items-center rounded-full border border-dashed border-pw-on-band/30 px-4 text-[14px] font-semibold"
            >
              + {T.addSomeone}
            </Link>
          </div>
        </div>
      </section>

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
      />

      <div className="grid grid-cols-1 gap-4 min-[761px]:grid-cols-2 min-[1101px]:grid-cols-4">
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
              <div key={k} className="bg-pw-surface-2 rounded-pw-row flex items-center justify-between gap-2 px-3 py-2">
                <span className="flex flex-col">
                  <span className="text-pw-ink-3 text-[12px]">{CARE_V2_COPY.readings.titles[k]}</span>
                  <span className="text-[17px] font-bold tabular-nums">{v}</span>
                </span>
                <span className="text-pw-ink-3 text-[12px]">{r ? SHORT.format(new Date(r.at)) : ""}</span>
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
            <Link href="/patient/care/medicines" className="text-pw-accent-text text-[15px] font-semibold">
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
          <Link href="/patient/me/records" className="text-pw-accent-text mt-auto text-[15px] font-semibold">
            {T.openRecords}
          </Link>
        </section>

        <section aria-labelledby="ct-h" className={CARD}>
          <h2 id="ct-h" className="text-[17px] font-semibold">
            {care ? CARE_V2_COPY.myCare.title : T.careTeam}
          </h2>
          {care ? (
            <Link href="/patient/care/my-care" className="text-pw-accent-text text-[15px] font-semibold">
              {CARE_V2_COPY.myCare.team} · {CARE_V2_COPY.myCare.checks} · {T.messages}
            </Link>
          ) : (
            <>
              <p className="text-[15px]">{CARE_COPY.messages.notYet} {CARE_COPY.messages.instead}</p>
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
            <Doctors hospitalId={home.id} />
          </Suspense>
        ) : (
          <QuietRow line={C.doctorsNoHospital} href="/patient/hospitals" />
        )}
      </section>
    </div>
  );
}

async function Doctors({ hospitalId }: { hospitalId: string }) {
  return <DoctorsView doctors={await loadDoctors(hospitalId).catch(() => null)} />;
}

function Glance(p: { icon: ReactNode; k: string; v: string; s: string; href: string }) {
  return (
    <Link
      href={p.href}
      className="flex min-w-0 flex-col gap-0.5 rounded-[18px] bg-pw-band-glass p-4 hover:opacity-90"
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
