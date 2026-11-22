import type { VisitRow } from "@/lib/patient-web/visits-data";
import type { Metadata } from "next";
import Link from "next/link";
import { STATUS_LABEL } from "@patient-core/visits";
import {
  dayKeyOf,
  dayLabel,
  dayNumberOf,
  monthGrid,
  monthTitleOf,
  nextVisit,
  onCalendar,
  partOf,
  shiftMonth,
  shortDayOf,
  weekdayOf,
} from "@patient-core/visits-calendar";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { buttonClass, ICON } from "@/components/tide/kit";
import { PageHeader } from "@/components/tide/shell";
import { VISITS_COPY as C } from "@/content/patient/visits";
import { VISITS_WEB_COPY as V } from "@/content/patient/visits-web";
import { loadWeek } from "@/lib/patient-web/visits-data";
import { formatFullDate, formatOfferExpiry } from "@/lib/patient/booking-format";
import { requirePatientScope } from "@/lib/patient/scope";
import { fetchWaitlist } from "@/lib/patient/waitlist";
import { cn } from "@/lib/utils";
import { RetryButton } from "../_components/home-bits";
import { VisitDetail } from "./_components/visit-detail";
import { WaitlistOffer } from "./_components/waitlist-offer";
import { reasonTitle } from "./_lib/reason";

export const metadata: Metadata = { title: "Visits" };
export const dynamic = "force-dynamic";

const CARD = "rounded-pw-card bg-pw-surface shadow-pw-card flex min-w-0 flex-col";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH = /^\d{4}-\d{2}$/;

/**
 * Visits (the owner's three-page redesign): one page, master and detail. The visit picked (`?v=`, else the next
 * one) opens in place with its ticket, steps, questions and actions; Coming up, the waiting-list offers and the
 * month calendar sit beside it; past visits below. A visit shows its status, never a place number or an hour (L8).
 * Desktop is two columns; tablet puts Coming up and the calendar side by side above the visit; a phone stacks
 * offers, Coming up, the visit, the calendar and past visits.
 */
export default async function VisitsPage({
  searchParams,
}: {
  searchParams: Promise<{ v?: string; m?: string }>;
}) {
  const q = await searchParams;
  const scope = await requirePatientScope();
  const now = new Date();
  const todayKey = dayKeyOf(now);
  const [week, waitlist] = await Promise.all([
    loadWeek(scope.userId, scope.primaryHospitalId, now).catch(() => null),
    fetchWaitlist(scope.userId).catch(() => []),
  ]);

  const upcoming = (week?.upcoming ?? [])
    .filter((v) => onCalendar(v.status) && v.status !== "completed")
    .sort((a, b) => a.startsAtIso.localeCompare(b.startsAtIso));
  const past = [...(week?.past ?? [])].sort((a, b) => b.startsAtIso.localeCompare(a.startsAtIso));
  const all = [...(week?.upcoming ?? []), ...past];
  const picked = q.v && UUID.test(q.v) ? (all.find((v) => v.id === q.v) ?? null) : null;
  const selected = picked ?? (week ? nextVisit(week.upcoming) : null);
  const month = q.m && MONTH.test(q.m) ? `${q.m}-01` : `${todayKey.slice(0, 7)}-01`;
  const href = (v: string | null, m: string = month) =>
    `/patient/visits?${new URLSearchParams({ ...(v ? { v } : {}), m: m.slice(0, 7) })}`;

  return (
    <>
      <PageHeader
        overline={upcoming.length ? V.line(upcoming.length) : C.noVisit}
        area="visits"
        title={V.title}
        tools={
          <Link href="/patient#book" className={buttonClass("primary", "m")}>
            {C.bookVisit}
          </Link>
        }
      />
      {week ? null : (
        <div className="flex flex-col items-start gap-2">
          <p className="rounded-pw-row bg-pw-surface-2 text-pw-ink-2 p-4 text-[15px]">{C.failed}</p>
          <RetryButton />
        </div>
      )}

      <div className="grid items-start gap-6 min-[761px]:max-[1100px]:grid-cols-2 min-[1101px]:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6 max-[1100px]:contents">
          <section
            aria-label={V.yourVisit}
            className={cn(CARD, "order-3 gap-5 p-6 max-[760px]:p-4 min-[761px]:max-[1100px]:col-span-2")}
          >
            {selected ? (
              <VisitDetail visit={selected} userId={scope.userId} />
            ) : (
              <div className="flex flex-col items-start gap-2">
                <h2 className="text-[22px] font-semibold">{V.nothingBooked}</h2>
                <p className="text-pw-ink-2 text-[15px]">{V.nothingLine}</p>
                <Link href="/patient#book" className={buttonClass("primary", "m")}>
                  {C.bookVisit}
                </Link>
              </div>
            )}
          </section>

        </div>

        <aside className="flex min-w-0 flex-col gap-4 max-[1100px]:contents">
          {waitlist.length ? (
            <div className="order-1 flex flex-col gap-3 min-[761px]:max-[1100px]:col-span-2">
              {waitlist.map((entry) => (
                <WaitlistOffer
                  key={entry.id}
                  id={entry.id}
                  offered={entry.state === "offered" && !!entry.offeredStartsAtIso}
                  overline={`${entry.memberName ? C.forMember(entry.memberName) : ""}${
                    entry.state === "offered" && entry.offeredStartsAtIso ? C.offerOpened : C.inLine
                  }`}
                  title={entry.serviceLineName}
                  hospitalName={entry.hospitalName}
                  line={
                    entry.state === "offered" && entry.offeredStartsAtIso && entry.offerExpiresAtIso
                      ? C.offerLine(
                          formatFullDate(entry.offeredStartsAtIso),
                          formatOfferExpiry(entry.offerExpiresAtIso, now),
                        )
                      : C.waitingLine(
                          dayLabel(entry.preferredFrom, now),
                          entry.preferredTo ? dayLabel(entry.preferredTo, now) : null,
                        )
                  }
                />
              ))}
            </div>
          ) : null}

          <section aria-labelledby="up-h" className={cn(CARD, "order-2 gap-1 p-3")}>
            <div className="flex items-center justify-between px-1 pb-1">
              <h2 id="up-h" className="text-[17px] font-semibold">
                {V.comingUp}
              </h2>
              <span className="text-pw-ink-3 text-[13px]">{upcoming.length}</span>
            </div>
            {upcoming.length ? (
              upcoming.map((v) => <Row key={v.id} v={v} href={href(v.id)} on={v.id === selected?.id} />)
            ) : (
              <p className="text-pw-ink-3 px-1 text-[14px]">{C.nothingPlanned}</p>
            )}
          </section>

          <Calendar
            month={month}
            todayKey={todayKey}
            visits={all.filter((v) => onCalendar(v.status))}
            openDays={week?.openDays ?? []}
            href={(v, m) => href(v ?? selected?.id ?? null, m)}
            selected={selected?.id ?? null}
          />

          {past.length ? (
            <section
              aria-labelledby="past-h"
              className="order-5 flex min-w-0 flex-col gap-2.5 min-[761px]:max-[1100px]:col-span-2"
            >
              <h2 id="past-h" className="text-[19px] font-semibold">
                {V.past}
              </h2>
              {/* Six visits in view (rows are 66 px, gaps 10); the rest scroll inside. The padding keeps the shadows. */}
              <div className="-m-1 grid max-h-[454px] gap-2.5 overflow-y-auto overscroll-contain p-1 [scrollbar-width:thin] min-[761px]:max-[1100px]:max-h-[226px] min-[761px]:max-[1100px]:grid-cols-2">
                {past.map((v) => (
                  <Row key={v.id} v={v} href={href(v.id)} on={v.id === selected?.id} past />
                ))}
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </>
  );
}

/** A visit as a row: the day tile, what it is for, who and when in the day, the status word. */
function Row(p: { v: VisitRow; href: string; on: boolean; past?: boolean }) {
  const key = dayKeyOf(p.v.startsAtIso);
  return (
    <Link
      href={p.href}
      scroll={false}
      aria-current={p.on ? "true" : undefined}
      className={cn(
        "rounded-pw-row flex min-w-0 items-center gap-3 p-2 transition-colors duration-150",
        p.past ? "bg-pw-surface shadow-pw-card pr-3" : "hover:bg-pw-surface-2",
        p.on && "bg-pw-surface-2 ring-pw-ink ring-2 ring-inset",
      )}
    >
      <span
        className={cn(
          "flex h-12 w-11 shrink-0 flex-col items-center justify-center rounded-[13px] leading-none",
          p.past ? "bg-pw-surface-2" : "bg-pw-ticket-navy text-pw-ticket-on-navy",
        )}
      >
        <b className="text-[19px]">{dayNumberOf(key)}</b>
        <span className={cn("text-[10px] font-bold uppercase", p.past ? "text-pw-ink-3" : "text-pw-ticket-day")}>
          {weekdayOf(key)}
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14px] font-semibold">{reasonTitle(p.v)}</span>
        <span className="text-pw-ink-3 truncate text-[12px]">
          {p.v.forMember ?? V.you} · {p.past ? p.v.departmentName : partOf(p.v.startsAtIso)}
        </span>
      </span>
      <span className="text-pw-ink-3 shrink-0 text-[12px]">{STATUS_LABEL[p.v.status] ?? ""}</span>
    </Link>
  );
}

/** This month: clinic-open days tinted, your visit days ringed (a visit day opens it), today filled. */
function Calendar(p: {
  month: string;
  todayKey: string;
  visits: VisitRow[];
  openDays: string[];
  href: (v: string | null, m?: string) => string;
  selected: string | null;
}) {
  const mine = new Map(p.visits.map((v) => [dayKeyOf(v.startsAtIso), v.id]));
  const open = new Set(p.openDays);
  return (
    <section aria-labelledby="cal-h" className={cn(CARD, "order-2 gap-2.5 p-4 max-[760px]:order-4")}>
      <div className="flex items-center justify-between">
        <Link href={p.href(null, shiftMonth(p.month, -1))} scroll={false} aria-label={V.prevMonth} className="grid size-9 place-items-center rounded-full hover:bg-pw-surface-2">
          <ChevronLeftIcon className="size-[18px]" {...ICON} />
        </Link>
        <h2 id="cal-h" className="text-[17px] font-semibold">
          {monthTitleOf(p.month)}
        </h2>
        <Link href={p.href(null, shiftMonth(p.month, 1))} scroll={false} aria-label={V.nextMonth} className="grid size-9 place-items-center rounded-full hover:bg-pw-surface-2">
          <ChevronRightIcon className="size-[18px]" {...ICON} />
        </Link>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={i} className="text-pw-ink-3 py-1 text-[12px] font-bold">
            {d}
          </span>
        ))}
        {monthGrid(p.month).map((key, i) => {
          if (!key) return <span key={i} />;
          const visit = mine.get(key);
          const isOpen = open.has(key);
          const cls = cn(
            "relative grid aspect-square place-items-center rounded-[10px] text-[13px] font-semibold",
            key === p.todayKey
              ? "bg-pw-band text-pw-on-band"
              : visit
                ? "ring-pw-ink text-pw-ink ring-2 ring-inset"
                : isOpen
                  ? "bg-pw-accent-tint text-pw-ink"
                  : "text-pw-ink-3",
            visit && visit === p.selected && "outline-pw-accent outline-2 outline-offset-2",
          );
          const label = V.dayAria(shortDayOf(key), !!visit, isOpen);
          return visit ? (
            <Link key={key} href={p.href(visit)} scroll={false} aria-label={label} className={cls}>
              {dayNumberOf(key)}
            </Link>
          ) : (
            <span key={key} aria-label={label} className={cls}>
              {dayNumberOf(key)}
            </span>
          );
        })}
      </div>
      <div className="text-pw-ink-3 flex flex-wrap gap-4 text-[12px]">
        <span className="flex items-center gap-1.5">
          <i className="bg-pw-accent-tint inline-block size-3.5 rounded-[4px]" />
          {V.clinicOpen}
        </span>
        <span className="flex items-center gap-1.5">
          <i className="ring-pw-ink inline-block size-3.5 rounded-[4px] ring-2 ring-inset" />
          {V.yourVisit}
        </span>
      </div>
    </section>
  );
}
