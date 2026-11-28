"use client";

import type { PatientReasonCode } from "@/supabase/functions/_shared/sessions-sql";
import type { DayOption, Part, SessionOption } from "@patient-core/book-days";
import type { DoctorCard } from "@patient-core/doctors";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, use, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { feeText } from "@patient-core/fees";
import {
  AlertCircleIcon,
  BabyIcon,
  CalendarDaysIcon,
  CheckIcon,
  ClockIcon,
  FlaskConicalIcon,
  HeartHandshakeIcon,
  HospitalIcon,
  MessageCircleQuestionIcon,
  PillIcon,
  PlusIcon,
  RefreshCwIcon,
  ScissorsIcon,
  ShieldPlusIcon,
  StethoscopeIcon,
  UserRoundIcon,
  UsersRoundIcon,
} from "lucide-react";

import { Dialog } from "@/components/tide/controls";
import { Button, buttonClass, ICON } from "@/components/tide/kit";
import { HelpButton } from "@/components/tide/shell";
import { TicketV2 } from "@/components/tide/v2-ticket";
import { BOOK_COPY as B, DAY_COPY as D, WRONG_COPY as W } from "@/content/patient/book";
import { TODAY_WEB_COPY as T } from "@/content/patient/today-web";
import { requestDayAction } from "@/lib/patient-web/book-actions";
import { toSlot } from "@/lib/patient-web/opaque";
import { cn } from "@/lib/utils";
import { PATIENT_REASON_CODES } from "@/supabase/functions/_shared/sessions-sql";
import { shownName } from "../../_lib/names";

export interface HubWho {
  /** null = the patient; else a household member's provisional id. */
  id: string | null;
  label: string;
  rel: string;
}

const KAMPALA = "Africa/Kampala";
const fmt = (o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: KAMPALA, ...o });
const WD = fmt({ weekday: "short" });
const DAY = fmt({ day: "numeric" });
const MON = fmt({ month: "short" });
const LONG = fmt({ weekday: "long", month: "long" });
const at = (key: string) => new Date(`${key}T09:00:00Z`);
const PARTS: Part[] = ["Morning", "Afternoon"];
const initials = (s: string) =>
  s
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

/**
 * Book a visit on Today (the three-page redesign, 22 Nov 2026): the ways in and the live ticket on the left; who,
 * why, when, which clinic and which doctor on the right, one step each. The reason sets the days (`loadDays`), so
 * picking one reloads the page's days through the URL (`?r=`), as the ask-for-a-day page does. The request is the
 * booking slice's own action (S9), one idempotency key per attempt. No count of people in line (ADR 0084 §5).
 */
/** Each booking reason's picture on the phone's reason tiles (the words stay the phone's own). */
const REASON_ICON: Record<PatientReasonCode, LucideIcon> = {
  follow_up: RefreshCwIcon,
  post_discharge: HospitalIcon,
  new_concern: AlertCircleIcon,
  refill: PillIcon,
  test_results: FlaskConicalIcon,
  antenatal: HeartHandshakeIcon,
  immunisation: ShieldPlusIcon,
  child_wellness: BabyIcon,
  specialist_review: StethoscopeIcon,
  routine: CalendarDaysIcon,
  procedure: ScissorsIcon,
  counselling: UsersRoundIcon,
  second_opinion: MessageCircleQuestionIcon,
};
/** On a phone a row of tiles scrolls sideways, edge to edge. */
const ROW =
  "max-[760px]:-mx-4 max-[760px]:flex max-[760px]:flex-nowrap max-[760px]:overflow-x-auto max-[760px]:px-4 max-[760px]:pt-0.5 max-[760px]:pb-2 max-[760px]:[scrollbar-width:none]";

export function BookHub(p: {
  hospitalId: string | null;
  hospitalName: string;
  who: HubWho[];
  reasons: { value: PatientReasonCode; title: string }[];
  reason: PatientReasonCode;
  days: DayOption[] | null;
  walkIns: number | null;
  /** See a doctor's list, for the doctors' photos (the same load as that section). */
  doctors: Promise<DoctorCard[] | null>;
  footer?: ReactNode;
}) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [member, setMember] = useState<string | null>(p.who[0]?.id ?? null);
  const [more, setMore] = useState(false);
  const days = useMemo(() => (p.days ?? []).slice(0, 5), [p.days]);
  const [dayKey, setDayKey] = useState<string | null>(days[0]?.key ?? null);
  const day = days.find((d) => d.key === dayKey) ?? days[0] ?? null;
  const partsOpen = PARTS.filter((pt) =>
    day?.sessions.some((s) => s.part === pt && s.placesLeft > 0),
  );
  const [part, setPart] = useState<Part | null>(null);
  const shownPart = part && partsOpen.includes(part) ? part : (partsOpen[0] ?? null);
  const inPart = (day?.sessions ?? []).filter((s) => s.part === shownPart);
  const clinics = [...new Set(inPart.map((s) => s.clinicName))].sort();
  const [clinic, setClinic] = useState<string | null>(null);
  const shownClinic = clinic && clinics.includes(clinic) ? clinic : (clinics[0] ?? null);
  const sessions = inPart.filter((s) => s.clinicName === shownClinic && s.placesLeft > 0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const session: SessionOption | null =
    sessions.find((s) => s.id === sessionId) ?? sessions[0] ?? null;
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState<{ code: string | null } | null>(null);
  const [preview, setPreview] = useState(false);
  // The phone's ask bar shows while the booking steps are on screen.
  const stepsRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = stepsRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(!!e?.isIntersecting), {
      rootMargin: "0px 0px -160px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const who = p.who.find((w) => w.id === member) ?? p.who[0];
  const reasonTitle = p.reasons.find((r) => r.value === p.reason)?.title ?? "";

  const pickReason = (r: PatientReasonCode) => {
    const q = new URLSearchParams(params.toString());
    q.set("r", toSlot(PATIENT_REASON_CODES, r));
    router.replace(`${path}?${q.toString()}#book`, { scroll: false });
  };

  const ask = () =>
    start(async () => {
      if (!p.hospitalId || !session) return;
      setError(null);
      const res = await requestDayAction({
        hospitalId: p.hospitalId,
        reason: p.reason,
        note: "",
        idempotencyKey: crypto.randomUUID(),
        submissionId: null,
        forProvisionalId: member,
        sessionId: session.slot ? null : session.id,
        slot: session.slot ?? null,
      });
      if (res.ok) setBooked({ code: res.receipt.booking_code });
      else setError(res.error);
    });

  const ticket = day && session && (
    <TicketV2
      hospitalName={p.hospitalName}
      hospitalInitials={initials(p.hospitalName)}
      day={DAY.format(at(day.key))}
      dayLine={LONG.format(at(day.key)).replace(" ", " · ")}
      window={session.doors ? D.doors(session.doors) : session.slot ? session.clinicianName : ""}
      doctorTime={!!session.slot}
      clinic={session.clinicName}
      room={session.room || null}
      patient={who?.label ?? ""}
      block={null}
      pay={session.fee ? { kind: "to_pay", amountUgx: session.fee } : { kind: "free" }}
      code={booked?.code ?? "··· ···"}
      stacked
    />
  );

  return (
    <section
      id="book"
      aria-labelledby="book-h"
      className="rounded-pw-card bg-pw-surface shadow-pw-card grid scroll-mt-24 overflow-hidden min-[761px]:grid-cols-[260px_minmax(0,1fr)] min-[1101px]:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)]"
    >
      <div className="bg-pw-band text-pw-on-band flex flex-col gap-3 p-6 max-[760px]:hidden">
        <div>
          <h2 id="book-h" className="text-[24px] leading-[30px] font-semibold">
            {B.title}
          </h2>
          <p className="text-pw-on-band-2 text-[14px]">{B.honest}</p>
        </div>
        <Way
          icon={<CalendarDaysIcon className="size-5" {...ICON} />}
          title={B.askDayTitle}
          line={
            days[0]
              ? `${T.nextOpen} ${WD.format(at(days[0].key))} ${DAY.format(at(days[0].key))} ${MON.format(at(days[0].key))} · ${T.clinicConfirms}`
              : B.askDayLine
          }
          on
        />
        <Way
          icon={<ClockIcon className="size-5" {...ICON} />}
          title={B.comeTodayTitle}
          line={p.walkIns ? T.walkInsOpen(p.walkIns) : B.noWalkIns}
          href="/patient/book/today"
        />
        <Way
          icon={<AlertCircleIcon className="size-5" {...ICON} />}
          title={W.title}
          line={B.doorWrongSub}
          href="/patient/book/wrong"
        />
        {/* A tablet's side panel is too narrow for the ticket: it opens from Preview ticket instead. */}
        <div className="max-[1100px]:hidden">{ticket}</div>
        <div className="bg-pw-band-glass mt-auto flex items-center justify-between gap-3 rounded-[18px] p-4 max-[1100px]:flex-col max-[1100px]:items-start">
          <p className="text-[14px] font-semibold">{B.footnote}</p>
          <HelpButton />
        </div>
      </div>

      <div
        ref={stepsRef}
        className="flex min-w-0 flex-col gap-6 p-6 max-[760px]:gap-5 max-[760px]:p-4"
      >
        <div className="min-[761px]:hidden">
          <h2 className="text-[22px] leading-7 font-semibold">{B.askDayTitle}</h2>
          <p className="text-pw-ink-3 text-[13px]">{B.honest}</p>
        </div>
        <Step n={1} title={B.whoTitle}>
          <div className={cn("flex flex-wrap gap-2", ROW)}>
            {p.who.map((w) => (
              <Tile
                key={w.id ?? "me"}
                on={w.id === member}
                onClick={() => setMember(w.id)}
                className="max-[760px]:shrink-0"
              >
                <span className="bg-pw-accent-tint text-pw-accent-text grid size-9 shrink-0 place-items-center rounded-full text-[13px] font-bold">
                  {initials(w.label)}
                </span>
                <span className="flex min-w-0 flex-col text-left">
                  <span className="truncate text-[15px] font-semibold">{w.label}</span>
                  <span className="text-pw-ink-3 text-[13px]">{w.rel}</span>
                </span>
              </Tile>
            ))}
            <Link
              href="/patient/me/household"
              className="rounded-pw-row border-pw-line-strong text-pw-ink-2 flex min-h-14 shrink-0 items-center gap-2 border border-dashed px-4 text-[15px] font-semibold"
            >
              <PlusIcon className="size-4" {...ICON} />
              {B.addSomeone}
            </Link>
          </div>
        </Step>

        <Step
          n={2}
          title={B.whyTitle}
          tool={
            p.reasons.length > 4 ? (
              <button
                type="button"
                className="text-pw-accent-text min-h-11 text-[14px] font-semibold max-[760px]:hidden"
                onClick={() => setMore((m) => !m)}
              >
                {more ? T.fewerReasons : T.moreReasons}
              </button>
            ) : null
          }
        >
          <div className={cn("grid grid-cols-2 gap-2 min-[1101px]:grid-cols-4", ROW)}>
            {p.reasons.map((r, i) => {
              const Icon = REASON_ICON[r.value];
              return (
                <Tile
                  key={r.value}
                  on={r.value === p.reason}
                  onClick={() => pickReason(r.value)}
                  // Past the first four, desktop shows a reason only after More reasons; the phone's row scrolls.
                  className={cn(
                    "max-[760px]:w-[108px] max-[760px]:shrink-0 max-[760px]:flex-col max-[760px]:justify-start max-[760px]:gap-2 max-[760px]:px-2 max-[760px]:py-3",
                    i >= 4 && !more && "min-[761px]:hidden",
                  )}
                >
                  <span className="bg-pw-surface-3 grid size-11 place-items-center rounded-[14px] min-[761px]:hidden">
                    <Icon className="size-5" {...ICON} />
                  </span>
                  <span className="text-left text-[14px] leading-[18px] font-semibold max-[760px]:text-center max-[760px]:text-[12px] max-[760px]:leading-[15px]">
                    {r.title}
                  </span>
                </Tile>
              );
            })}
          </div>
        </Step>

        {!p.hospitalId ? (
          <p className="text-pw-ink-2 text-[15px]">
            {B.pickHospitalLine}{" "}
            <Link href="/patient/hospitals" className="text-pw-accent-text font-semibold">
              {B.pickHospitalTitle}
            </Link>
          </p>
        ) : p.days === null ? (
          <p className="text-pw-ink-2 text-[15px]">{D.failedLine}</p>
        ) : days.length === 0 ? (
          <p className="text-pw-ink-2 text-[15px]">{D.noDays}</p>
        ) : (
          <>
            <div className="grid gap-6 min-[1101px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
              <Step n={3} title={T.when}>
                <div className="grid grid-cols-5 gap-2">
                  {days.map((d) => {
                    const on = d.key === day?.key;
                    return (
                      <button
                        key={d.key}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setDayKey(d.key)}
                        className={cn(
                          "rounded-pw-row flex min-h-16 flex-col items-center justify-center",
                          on ? "bg-pw-band text-pw-on-band" : "bg-pw-surface-2",
                        )}
                      >
                        <span className="text-[11px] font-bold uppercase">
                          {WD.format(at(d.key))}
                        </span>
                        <span className="text-[22px] leading-[26px] font-bold">
                          {DAY.format(at(d.key))}
                        </span>
                        <span className="text-[11px]">{MON.format(at(d.key))}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {PARTS.map((pt) => {
                    const open = partsOpen.includes(pt);
                    const s = day?.sessions.find((x) => x.part === pt);
                    return (
                      <Tile
                        key={pt}
                        on={pt === shownPart}
                        disabled={!open}
                        onClick={() => setPart(pt)}
                      >
                        <span className="flex flex-col text-left">
                          <span className="text-[15px] font-semibold">{D.partWords[pt]}</span>
                          <span className="text-pw-ink-3 text-[13px]">
                            {!s ? D.noClinic : !open ? D.full : s.doors ? D.doors(s.doors) : D.open}
                          </span>
                        </span>
                      </Tile>
                    );
                  })}
                </div>
                <p className="text-pw-ink-3 text-[13px]">{D.partNote}</p>
              </Step>
              <Step n={4} title={T.whichClinic}>
                <div className="flex flex-col gap-2">
                  {clinics.map((c) => (
                    <Tile key={c} on={c === shownClinic} onClick={() => setClinic(c)}>
                      <span className="flex-1 text-left text-[15px] font-semibold">{c}</span>
                    </Tile>
                  ))}
                </div>
              </Step>
            </div>

            <Step n={5} title={D.whoTitle}>
              {/* One row; past the section's width it scrolls sideways (padding keeps the shadow unclipped). */}
              <div className="-mx-2 flex snap-x [scrollbar-width:thin] gap-3 overflow-x-auto px-2 pt-1 pb-3">
                {sessions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={s.id === session?.id}
                    onClick={() => setSessionId(s.id)}
                    className={cn(
                      "rounded-pw-row relative flex min-h-[84px] w-[300px] shrink-0 snap-start items-center gap-3 p-3 pr-10 text-left max-[760px]:w-[264px]",
                      "transition-[background-color,box-shadow,scale] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.98] motion-reduce:active:scale-100",
                      s.id === session?.id
                        ? "bg-pw-surface shadow-pw-card"
                        : "bg-pw-surface-2 hover:bg-pw-surface-3",
                    )}
                  >
                    {s.clinicianName ? (
                      <Suspense
                        fallback={
                          <Clinician name={s.clinicianName} fee={s.feeLabel ?? feeText(s.fee)} />
                        }
                      >
                        <Doctor
                          name={s.clinicianName}
                          fee={s.feeLabel ?? feeText(s.fee)}
                          doctors={p.doctors}
                        />
                      </Suspense>
                    ) : (
                      <>
                        <span className="bg-pw-surface-3 text-pw-ink-3 grid size-12 shrink-0 place-items-center rounded-full">
                          <UserRoundIcon className="size-6" {...ICON} />
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <span className="text-[15px] leading-5 font-semibold">{D.anyDoctor}</span>
                          <span className="text-pw-ink-3 text-[13px] font-semibold">
                            {s.feeLabel ?? feeText(s.fee)}
                          </span>
                        </span>
                      </>
                    )}
                    {s.id === session?.id ? (
                      <span className="bg-pw-ink text-pw-surface absolute top-1/2 right-3 grid size-5 -translate-y-1/2 place-items-center rounded-full">
                        <CheckIcon className="size-3" strokeWidth={3} aria-hidden />
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </Step>

            <p className="text-pw-ink-3 text-[13px] min-[761px]:hidden">{B.footnote}</p>
            <div className="border-pw-line flex flex-wrap items-center justify-between gap-3 border-t pt-4 max-[760px]:hidden">
              <p className="text-[15px]">
                {who?.label}, {reasonTitle},{" "}
                {day
                  ? `${WD.format(at(day.key))} ${DAY.format(at(day.key))} ${MON.format(at(day.key))}`
                  : ""}
                {shownClinic ? ` · ${shownClinic}` : ""}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPreview(true)}
                  className="text-pw-accent-text min-h-11 px-2 text-[14px] font-semibold min-[1101px]:hidden"
                >
                  {T.previewTicket}
                </button>
                <Button tone="primary" size="m" onClick={ask} busy={busy}>
                  {T.askThisDay}
                </Button>
              </div>
            </div>
            {error ? (
              <p role="alert" className="text-pw-ink text-[15px] font-semibold">
                {error}
              </p>
            ) : null}
          </>
        )}
        {p.footer}
      </div>

      {day && session ? (
        <div
          aria-hidden={!inView}
          className={cn(
            "bg-pw-band text-pw-on-band shadow-pw-float fixed inset-x-3 bottom-[calc(92px+env(safe-area-inset-bottom))] z-20 flex items-center gap-3 rounded-[24px] py-2.5 pr-2.5 pl-4 min-[761px]:hidden",
            "transition-[translate,opacity] duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
            inView ? "" : "pointer-events-none translate-y-4 opacity-0",
          )}
        >
          <div className="text-pw-on-band-2 min-w-0 flex-1 text-[11px] leading-[15px]">
            <b className="text-pw-on-band block text-[16px] leading-5">
              {session.feeLabel ?? feeText(session.fee)}
            </b>
            {`${WD.format(at(day.key))} ${DAY.format(at(day.key))} ${MON.format(at(day.key))} · ${session.clinicName}`}
            {" · "}
            <button
              type="button"
              tabIndex={inView ? 0 : -1}
              onClick={() => setPreview(true)}
              className="text-pw-on-band-accent font-semibold underline"
            >
              {T.previewTicket}
            </button>
          </div>
          <button
            type="button"
            tabIndex={inView ? 0 : -1}
            onClick={ask}
            disabled={busy}
            className="bg-pw-accent text-pw-on-accent min-h-12 shrink-0 rounded-full px-4 text-[14px] font-bold active:scale-[0.97] disabled:opacity-60"
          >
            {T.askThisDay}
          </button>
        </div>
      ) : null}

      <Dialog open={preview} onOpenChange={setPreview} title={T.previewTitle} width="medium">
        {ticket}
      </Dialog>

      <Dialog
        open={!!booked}
        onOpenChange={(o) => !o && setBooked(null)}
        title={T.bookedTitle}
        width="medium"
        footer={
          <Link href="/patient/visits" className={buttonClass("primary", "m")}>
            {T.seeInVisits}
          </Link>
        }
      >
        {ticket}
        <p className="text-pw-ink-2 text-[15px]">{W.answerInVisits}</p>
      </Dialog>
    </section>
  );
}

function Step(p: { n: number; title: string; tool?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-[16px] font-semibold">
          <span className="bg-pw-surface-2 grid size-6 place-items-center rounded-full text-[12px] font-bold">
            {p.n}
          </span>
          {p.title}
        </h3>
        {p.tool}
      </div>
      {p.children}
    </div>
  );
}

/**
 * A session's clinician, filled in from See a doctor's list (doctors only), matched by name: on that list they
 * get "Dr", their role and their photo; otherwise, and while it loads, their name and initials only.
 */
function Doctor(p: { name: string; fee: string; doctors: Promise<DoctorCard[] | null> }) {
  const d = use(p.doctors)?.find((x) => x.name === p.name);
  return <Clinician name={p.name} fee={p.fee} doctor={d} />;
}

function Clinician(p: { name: string; fee: string; doctor?: DoctorCard }) {
  return (
    <>
      <Face name={p.name} photo={p.doctor?.photoUrl} />
      <span className="flex min-w-0 flex-col">
        <span className="line-clamp-2 text-[15px] leading-5 font-semibold">
          {p.doctor ? `Dr ${shownName(p.name)}` : shownName(p.name)}
        </span>
        {p.doctor?.role ? (
          <span className="text-pw-ink-3 truncate text-[13px]">{p.doctor.role}</span>
        ) : null}
        <span className="text-[13px] font-semibold">{p.fee}</span>
      </span>
    </>
  );
}

function Face(p: { name: string; photo?: string | null }) {
  return (
    <span className="bg-pw-accent-tint text-pw-accent-text relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-full text-[15px] font-bold">
      {initials(p.name)}
      {p.photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL, as See a doctor shows it
        <img src={p.photo} alt="" className="absolute inset-0 size-full object-cover" />
      ) : null}
    </span>
  );
}

function Tile(p: {
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={p.on}
      disabled={p.disabled}
      onClick={p.onClick}
      className={cn(
        "rounded-pw-row relative flex min-h-14 min-w-0 items-center gap-3 px-3 py-2 pr-9 transition-colors disabled:opacity-45",
        p.on ? "bg-pw-surface ring-pw-ink ring-2" : "bg-pw-surface-2 hover:bg-pw-surface-3",
        p.className,
      )}
    >
      {p.children}
      {p.on ? (
        <span className="bg-pw-ink text-pw-surface absolute top-1/2 right-2 grid size-5 -translate-y-1/2 place-items-center rounded-full max-[760px]:top-2 max-[760px]:translate-y-0">
          <CheckIcon className="size-3" strokeWidth={3} aria-hidden />
        </span>
      ) : null}
    </button>
  );
}

function Way(p: { icon: ReactNode; title: string; line: string; href?: string; on?: boolean }) {
  const body = (
    <>
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-[13px]",
          p.on ? "bg-pw-surface-2 text-pw-ink" : "bg-pw-band-glass",
        )}
      >
        {p.icon}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-[15px] font-semibold">{p.title}</span>
        <span className={cn("text-[13px]", p.on ? "text-pw-ink-2" : "text-pw-on-band-2")}>
          {p.line}
        </span>
      </span>
    </>
  );
  const cls = cn(
    "rounded-pw-row flex items-center gap-3 p-3",
    p.on ? "bg-pw-surface text-pw-ink" : "bg-pw-band-glass hover:opacity-90",
  );
  return p.href ? (
    <Link href={p.href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
