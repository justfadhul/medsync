"use client";

import type { Door } from "../../_components/why-coming";
import type { Attachment } from "./attachments";
import type { DayReceipt } from "@/lib/patient-web/book-actions";
import type { Days } from "@/lib/patient-web/book-data";
import type { PatientReasonCode } from "@/supabase/functions/_shared/sessions-sql";
import type { Part, SessionOption } from "@patient-core/book-days";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  canShift,
  clockOf,
  countdownOf,
  dayKeyOf,
  dayNumberOf,
  dayState,
  firstOpenDay,
  longDayOf,
  monthGrid,
  monthShortOf,
  monthTitleOf,
  resolveDay,
  shiftMonth,
  shortDayOf,
  weekdayOf,
  weeksOf,
} from "@patient-core/book-days";
import { feeText } from "@patient-core/fees";
import {
  CalendarIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
} from "lucide-react";

import { joinWaitlistAction } from "@/app/patient/book/actions";
import { Button, ButtonLink, Card, ICON, IconDisc, Note } from "@/components/tide/kit";
import { PageHeader } from "@/components/tide/shell";
import { DAY_COPY as D } from "@/content/patient/book";
import { PATIENT_WEB_COPY } from "@/content/patient/web";
import { payAction, requestDayAction } from "@/lib/patient-web/book-actions";
import { toSlot } from "@/lib/patient-web/opaque";
import { cn } from "@/lib/utils";
import { PATIENT_REASON_CODES } from "@/supabase/functions/_shared/sessions-sql";
import { TextArea } from "../../_components/fields";
import { SentTicket } from "../../_components/ticket-bits";
import { HonestNote, StepTitle, WhyComing } from "../../_components/why-coming";
import { AttachmentTools, sendAttachments } from "./attachments";

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pw-focus";

function useNow(ms: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** No reason yet (Home's doctor card): the patient says why first; the server then reads the days. */
export function ReasonFirst({
  unseen,
  carry,
  areas,
}: {
  unseen: number;
  carry: Record<string, string>;
  areas: { key: string; label: string }[] | null;
}) {
  const router = useRouter();
  const [door, setDoor] = useState<Door | null>(null);
  return (
    <>
      <PageHeader
        back={{ href: "/patient/book", label: D.back }}
        title={D.title}
        unseen={unseen}
        hideHelp={door === "wrong"}
      />
      <div className="max-w-3xl">
        <WhyComing
          door={door}
          onDoor={setDoor}
          reason={null}
          onReason={(reason) =>
            router.push(
              `/patient/book/day?${new URLSearchParams({ r: toSlot(PATIENT_REASON_CODES, reason), ...carry })}`,
            )
          }
          areas={areas}
          wrongHref={(area) =>
            `/patient/book/wrong?${new URLSearchParams({
              ...(area
                ? {
                    a: toSlot(
                      (areas ?? []).map((x) => x.key),
                      area,
                    ),
                  }
                : {}),
              ...carry,
            })}`
          }
        />
      </div>
    </>
  );
}

export function DayFailed() {
  const router = useRouter();
  return (
    <div className="flex max-w-2xl flex-col items-center gap-3 py-6 text-center">
      <IconDisc className="size-14">
        <CalendarIcon className="size-6" {...ICON} />
      </IconDisc>
      <h2 className="text-[22px] leading-[27px] font-semibold">{D.failedTitle}</h2>
      <p className="text-pw-ink-2 text-[17px] leading-[25px]">{D.failedLine}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Button onClick={() => router.refresh()}>{D.tryAgain}</Button>
        <ButtonLink href="/patient/book" tone="outline">
          {D.backToBook}
        </ButtonLink>
      </div>
    </div>
  );
}

type Sent = {
  receipt: DayReceipt;
  session: SessionOption;
  dayKey: string;
  at: string;
  unsent: number;
  paid: boolean;
  demo: boolean;
};

export function DayForm({
  unseen,
  userId,
  days,
  reason,
  member,
  patient,
  patientCode,
  submissionId,
  paymentsOn,
  waitlistLine,
  doctorBack,
}: {
  unseen: number;
  userId: string;
  days: Days;
  reason: PatientReasonCode;
  member: string | null;
  patient: string;
  patientCode: string | null;
  submissionId: string | null;
  paymentsOn: boolean;
  waitlistLine: string | null;
  doctorBack: boolean;
}) {
  const now = useNow(60_000);
  const [picked, setPicked] = useState<string | null>(null);
  const [part, setPart] = useState<Part | null>(null);
  const [slotId, setSlotId] = useState<string | null>(null);
  const [whoId, setWhoId] = useState<string | null>(null);
  const [pay, setPay] = useState<"momo" | "later">("momo");
  const [note, setNote] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);

  if (sent)
    return (
      <SentView
        sent={sent}
        unseen={unseen}
        hospitalName={days.hospitalName}
        patient={patient}
        patientCode={patientCode}
        onPaid={(demo) => setSent({ ...sent, paid: true, demo })}
      />
    );

  const today = dayKeyOf(now);
  const doctorName = days.doctorName;
  const r = resolveDay(days.days, today, doctorName !== null, { picked, part, whoId, slotId });
  const { day, session, slots, slotSession, chosenPart, anySession, named, whoSel } = r;
  const clinicName =
    day?.sessions[0]?.clinicName ?? days.days[0]?.sessions[0]?.clinicName ?? D.theClinic;
  const header = (
    <PageHeader
      back={{ href: "/patient/book", label: D.back }}
      overline={doctorName ? `${days.hospitalName} · ${clinicName}` : days.hospitalName}
      area="visits"
      title={doctorName ? D.askDoctor(doctorName) : D.title}
      unseen={unseen}
    />
  );
  const reset = () => setKey(null);

  if (!r.first) {
    return (
      <>
        {header}
        <div className="flex max-w-2xl flex-col gap-4">
          <Card className="flex flex-col items-center gap-3 py-6 text-center">
            <IconDisc className="size-14">
              <CalendarIcon className="size-6" {...ICON} />
            </IconDisc>
            <h2 className="text-[22px] leading-[27px] font-semibold">{D.noDaysTitle}</h2>
            <p className="text-pw-ink-2 text-[17px] leading-[25px]">
              {doctorName ? D.noDaysDoctor(doctorName) : D.noDays}
            </p>
          </Card>
          {waitlistLine ? (
            <Waitlist line={waitlistLine} reason={reason} today={today} member={member} />
          ) : null}
          <ButtonLink href={doctorBack ? "/patient" : "/patient/book"} tone="outline">
            {doctorBack ? D.backToDoctors : D.backToBook}
          </ButtonLink>
        </div>
      </>
    );
  }

  const whoOptions = doctorName
    ? []
    : [
        { key: "any", name: D.anyDoctor, fee: anySession?.fee ?? null },
        ...named.map((s) => ({ key: s.id, name: s.clinicianName, fee: s.fee })),
      ];
  const fee = session?.fee ?? null;
  const when = slotSession?.slot
    ? clockOf(slotSession.slot.startsAtIso)
    : (chosenPart ?? "").toLowerCase();
  const dayWords = day ? `${weekdayOf(day.key)} ${dayNumberOf(day.key)} ${when}` : "";
  const send = !session
    ? doctorName
      ? D.chooseTimeBtn
      : D.chooseDayBtn
    : fee && pay === "momo"
      ? D.payAsk(feeText(fee), dayWords)
      : D.ask(dayWords);

  const onSend = async () => {
    if (!day || !session || busy) return;
    const k = key ?? crypto.randomUUID();
    setKey(k);
    setBusy(true);
    setError(null);
    const res = await requestDayAction({
      hospitalId: days.hospitalId,
      reason,
      note,
      idempotencyKey: k,
      submissionId,
      forProvisionalId: member,
      sessionId: session.slot ? null : session.id,
      slot: session.slot ?? null,
    }).catch(() => ({ ok: false as const, error: PATIENT_WEB_COPY.offline }));
    if (!res.ok) {
      setBusy(false);
      setError(res.error);
      return;
    }
    let paid = false;
    let demo = false;
    if (fee && pay === "momo") {
      const p = await payAction(fee).catch(() => null);
      if (p?.ok) [paid, demo] = [true, p.demo];
    }
    // The request stands whatever happens to the files; the ticket says if any did not go.
    const { failed } = await sendAttachments(userId, res.receipt.appointment_id, attachments);
    setBusy(false);
    setKey(null);
    setSent({
      receipt: res.receipt,
      session,
      dayKey: day.key,
      at: new Date().toISOString(),
      unsent: failed,
      paid,
      demo,
    });
  };

  return (
    <>
      {header}
      <div className="flex max-w-2xl flex-col gap-6">
        <Calendar
          today={today}
          open={r.openKeys}
          selected={day?.key ?? null}
          onSelect={(k) => {
            setPicked(k);
            setSlotId(null);
            setPart(null);
            setWhoId(null);
            reset();
          }}
        />

        {day && doctorName ? (
          <section className="flex flex-col gap-3">
            <StepTitle>{D.chooseTime(longDayOf(day.key))}</StepTitle>
            {slotSession?.slot ? (
              <Card className="flex flex-col gap-3 p-3">
                <Countdown
                  iso={slotSession.slot.startsAtIso}
                  whenLine={D.at(shortDayOf(day.key), clockOf(slotSession.slot.startsAtIso))}
                />
                <div
                  role="radiogroup"
                  aria-label={D.timesOn(longDayOf(day.key))}
                  className="flex flex-wrap gap-2"
                >
                  {slots.map((s) => {
                    const on = s.id === slotSession.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => {
                          setSlotId(s.id);
                          reset();
                        }}
                        className={cn(
                          "min-h-12 rounded-full px-4 text-[17px] font-semibold tabular-nums",
                          FOCUS,
                          on
                            ? "bg-pw-act text-pw-on-act"
                            : "bg-pw-surface ring-pw-line ring-1 ring-inset",
                        )}
                      >
                        {s.slot ? clockOf(s.slot.startsAtIso) : ""}
                      </button>
                    );
                  })}
                </div>
              </Card>
            ) : null}
            {slotSession ? (
              <div className="bg-pw-surface-2 text-pw-ink-2 rounded-pw-row flex items-start gap-3 p-4 text-[15px] font-medium">
                <ClockIcon className="mt-0.5 size-5 shrink-0" {...ICON} />
                {D.arriveEarly}
              </div>
            ) : null}
          </section>
        ) : null}

        {day && !doctorName ? (
          <section className="flex flex-col gap-2">
            <StepTitle>{D.partTitle}</StepTitle>
            <div className="grid grid-cols-2 gap-2">
              {(["Morning", "Afternoon"] as const).map((pt) => {
                const ss = r.inPart(pt);
                const ok = r.partOpen(pt);
                const doors = ss[0]?.doors ?? null;
                const on = pt === chosenPart;
                return (
                  <button
                    key={pt}
                    type="button"
                    aria-pressed={on}
                    aria-disabled={!ok || undefined}
                    aria-label={
                      ok ? D.doorsOpenLabel(pt, doors) : D.partOffLabel(pt, ss.length > 0)
                    }
                    onClick={() => {
                      if (!ok) return;
                      setPart(pt);
                      setWhoId(null);
                      reset();
                    }}
                    className={cn(
                      "rounded-pw-card flex min-h-[72px] flex-col justify-center gap-0.5 px-3.5 text-left ring-inset",
                      FOCUS,
                      on
                        ? "bg-pw-accent-tint ring-pw-accent ring-2"
                        : "bg-pw-surface ring-pw-line ring-1",
                      !ok && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <span className="text-base font-semibold">{D.partWords[pt]}</span>
                    <span className="text-pw-ink-2 text-[13px] font-medium">
                      {ss.length === 0
                        ? D.noClinic
                        : ok
                          ? doors
                            ? D.doors(doors)
                            : D.open
                          : D.full}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-pw-ink-3 text-[13px] leading-[18px] font-medium">{D.partNote}</p>
          </section>
        ) : null}

        {session ? (
          <section className="flex flex-col gap-2">
            {doctorName ? (
              <p className="text-pw-ink-2 text-[17px]">{`${doctorName} · ${session.feeLabel ?? feeText(session.fee)}`}</p>
            ) : (
              <>
                <StepTitle>{D.whoTitle}</StepTitle>
                <div role="radiogroup" aria-label={D.whoTitle} className="grid grid-cols-2 gap-2">
                  {whoOptions.map((o) => {
                    const on = o.key === "any" ? whoSel === null : whoSel === o.key;
                    return (
                      <button
                        key={o.key}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        aria-label={`${o.name}, ${feeText(o.fee)}`}
                        onClick={() => {
                          setWhoId(o.key);
                          reset();
                        }}
                        className={cn(
                          "rounded-pw-row flex min-w-0 flex-col gap-0.5 p-3 text-left ring-inset",
                          FOCUS,
                          on
                            ? "bg-pw-accent-tint ring-pw-accent ring-2"
                            : "bg-pw-surface ring-pw-line ring-1",
                        )}
                      >
                        <span className="truncate text-[15px] font-semibold">{o.name}</span>
                        <span className="text-pw-ink-2 text-[13px] font-medium">
                          {feeText(o.fee)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        ) : null}

        <section className="flex flex-col gap-2">
          <TextArea
            label={D.noteLabel}
            hint={D.optional}
            value={note}
            maxLength={500}
            placeholder={D.notePlaceholder}
            onChange={(e) => {
              setNote(e.target.value);
              reset();
            }}
          />
          <AttachmentTools
            value={attachments}
            onAdd={(list) => setAttachments((a) => [...a, ...list])}
            onRemove={(id) => setAttachments((a) => a.filter((x) => x.id !== id))}
          />
        </section>

        {session && fee ? (
          <section className="flex flex-col gap-2">
            <div role="radiogroup" aria-label={D.payLabel} className="grid grid-cols-2 gap-2">
              {(
                [
                  ["momo", ...D.momo],
                  ["later", ...D.later],
                ] as const
              ).map(([k, title, line]) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={pay === k}
                  aria-label={`${title}. ${line}`}
                  onClick={() => setPay(k)}
                  className={cn(
                    "rounded-pw-field flex flex-col gap-0.5 p-3 text-left ring-inset",
                    FOCUS,
                    pay === k
                      ? "bg-pw-accent-tint ring-pw-accent ring-2"
                      : "bg-pw-surface ring-pw-line ring-1",
                  )}
                >
                  <span className="text-[15px] font-semibold">{title}</span>
                  <span className="text-pw-ink-2 text-[13px]">{line}</span>
                </button>
              ))}
            </div>
            {pay === "momo" && !paymentsOn ? <Note>{D.demoPayment}</Note> : null}
          </section>
        ) : null}

        {error ? (
          <p role="alert" className="text-pw-ink text-[15px] font-semibold">
            {error}
          </p>
        ) : null}
        <div className="flex flex-col gap-2">
          <Button
            busy={busy}
            disabledReason={session ? undefined : D.noSessionReason}
            onClick={() => void onSend()}
          >
            {send}
          </Button>
          <p className="text-pw-ink-3 text-center text-[13px] font-medium">{D.confirmLine}</p>
        </div>
      </div>
    </>
  );
}

/** The month calendar (mobile/src/features/visits/calendar.tsx): open days bold with a dot, 60 days ahead. */
function Calendar({
  today,
  open,
  selected,
  onSelect,
}: {
  today: string;
  open: ReadonlySet<string>;
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const [month, setMonth] = useState<string | null>(null);
  const shown = month ?? shiftMonth(selected ?? firstOpenDay(today, open) ?? today, 0);
  return (
    <Card className="flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-[19px] leading-6 font-semibold">{monthTitleOf(shown)}</h2>
        <div className="flex gap-1.5">
          {([-1, 1] as const).map((d) => {
            const ok = canShift(shown, d, today);
            const Icon = d < 0 ? ChevronLeftIcon : ChevronRightIcon;
            return (
              <button
                key={d}
                type="button"
                aria-label={d < 0 ? D.prevMonth : D.nextMonth}
                aria-disabled={!ok || undefined}
                onClick={() => ok && setMonth(shiftMonth(shown, d))}
                className={cn(
                  "bg-pw-bg grid size-12 place-items-center rounded-full",
                  FOCUS,
                  !ok && "cursor-not-allowed opacity-40",
                )}
              >
                <Icon className="size-[18px]" {...ICON} />
              </button>
            );
          })}
        </div>
      </div>
      <table className="w-full table-fixed border-collapse">
        <thead>
          <tr>
            {D.weekdays.map((w, i) => (
              <th key={i} aria-hidden className="text-pw-ink-3 pb-1 text-xs font-semibold">
                {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeksOf(monthGrid(shown)).map((week, w) => (
            <tr key={w}>
              {week.map((k, i) => {
                if (!k) return <td key={i} className="h-12" />;
                const state = dayState(k, today, open);
                const on = k === selected && state === "open";
                const isToday = k === today;
                return (
                  <td key={k} className="h-12 p-0 text-center">
                    <button
                      type="button"
                      aria-pressed={on}
                      aria-disabled={state !== "open" || undefined}
                      aria-label={D.dayLabel(shortDayOf(k), isToday, state)}
                      onClick={() => state === "open" && onSelect(k)}
                      className={cn(
                        "inline-flex h-12 w-full flex-col items-center justify-center gap-0.5",
                        FOCUS,
                        state === "out" && "opacity-45",
                        state !== "open" && "cursor-default",
                      )}
                    >
                      <span
                        className={cn(
                          "grid h-8 w-9 place-items-center rounded-full text-[15px]",
                          on
                            ? "bg-pw-act text-pw-on-act"
                            : state === "open"
                              ? "text-pw-ink"
                              : "text-pw-ink-4",
                          state === "open" ? "font-bold" : "font-medium",
                          isToday && !on && "ring-pw-ink-2 ring-[1.5px] ring-inset",
                        )}
                      >
                        {Number(k.slice(8))}
                      </span>
                      <span
                        aria-hidden
                        className={cn(
                          "size-[5px] rounded-full",
                          state === "open" && !on ? "bg-pw-accent-text" : "bg-transparent",
                        )}
                      />
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-pw-ink-2 flex items-center gap-1.5 p-1 text-[13px] font-medium">
        <span aria-hidden className="bg-pw-accent-text size-1.5 rounded-full" />
        {D.legend}
      </p>
    </Card>
  );
}

/** "Your visit is in 1 day 03 hrs 20 min 05 sec" (time-wheel.tsx Countdown); read aloud to the minute. */
function Countdown({ iso, whenLine }: { iso: string; whenLine: string }) {
  const now = useNow(1000);
  const { days, hours, minutes, seconds } = countdownOf(now, iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const units: [string, string][] = [
    ...(days > 0 ? [[String(days), days === 1 ? "day" : "days"] as [string, string]] : []),
    [pad(hours), "hrs"],
    [pad(minutes), "min"],
  ];
  const spoken = units.map(([n, u]) => `${Number(n)} ${u}`).join(" ");
  return (
    <div
      role="timer"
      aria-label={D.visitInLabel(spoken, whenLine)}
      className="bg-pw-surface-2 rounded-pw-card flex flex-col gap-1.5 p-3"
      suppressHydrationWarning
    >
      <p className="text-pw-ink-3 text-[11px] font-bold tracking-[0.06em] uppercase">{D.visitIn}</p>
      {/* The clock differs between server and browser: suppress on the elements that hold the digits (one level only). */}
      <div aria-hidden className="flex gap-1.5">
        {[...units, [pad(seconds), "sec"] as [string, string]].map(([n, u]) => (
          <span key={u} className="flex min-w-[34px] flex-col items-center">
            <span
              className="font-pw-mono text-[22px] font-semibold tabular-nums"
              suppressHydrationWarning
            >
              {n}
            </span>
            <span className="text-pw-ink-3 text-[11px] font-semibold">{u}</span>
          </span>
        ))}
      </div>
      <p className="text-pw-ink-2 text-[13px] font-medium">{whenLine}</p>
    </div>
  );
}

/** "Tell me if a place opens" (pt-join-waitlist): no hold, no promise, and its place in line is never shown. */
function Waitlist({
  line,
  reason,
  today,
  member,
}: {
  line: string;
  reason: PatientReasonCode;
  today: string;
  member: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (done) return <Note tone="info">{D.waitlistDone}</Note>;
  return (
    <div className="flex flex-col gap-2">
      <Button
        tone="soft"
        busy={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void joinWaitlistAction({
            service_line_id: line,
            reason,
            preferred_from: today,
            ...(member ? { for_provisional_id: member } : {}),
          })
            .catch(() => ({
              ok: false as const,
              error: PATIENT_WEB_COPY.offline,
              alreadyOn: false,
            }))
            .then((r) => {
              setBusy(false);
              if (r.ok || r.alreadyOn) setDone(true);
              else setError(r.error);
            });
        }}
      >
        {D.waitlistAsk}
      </Button>
      {error ? (
        <p role="alert" className="text-pw-ink text-[15px] font-semibold">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The day ticket and what happens next (day.tsx Sent). */
function SentView({
  sent,
  unseen,
  hospitalName,
  patient,
  patientCode,
  onPaid,
}: {
  sent: Sent;
  unseen: number;
  hospitalName: string;
  patient: string;
  patientCode: string | null;
  onPaid: (demo: boolean) => void;
}) {
  const [paying, setPaying] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { receipt, session: s, dayKey } = sent;
  const awaiting = receipt.status === "requested" || receipt.status === "pending_approval";
  const time = s.slot ? clockOf(s.slot.startsAtIso) : null;
  const steps = D.steps.map((label, i) => [label, i === 0 || (i === 1 && !awaiting)] as const);
  return (
    <>
      <PageHeader
        overline={D.sentOverline}
        area="visits"
        title={awaiting ? D.waitingTitle : D.confirmedTitle}
        unseen={unseen}
      />
      <div className="flex max-w-2xl flex-col gap-5">
        <SentTicket
          kind="day"
          title={hospitalName}
          status={awaiting ? D.waitingStatus : D.confirmed}
          codeLabel={D.codeLabel}
          code={receipt.booking_code ?? patientCode}
          details={[
            {
              label: `${weekdayOf(dayKey)} · ${monthShortOf(dayKey)}`.toUpperCase(),
              value: `${dayNumberOf(dayKey)} · ${D.sessionLine(s.part, s.doors)}`,
            },
            { label: D.clinicLabel, value: s.clinicName },
            { label: D.see, value: s.clinicianName },
            { label: D.roomLabel, value: s.room },
            { label: D.timeLabel, value: time ? D.timeEarly(time) : D.notPromised },
            { label: D.patientLabel, value: patient },
            { label: D.asked, value: `${shortDayOf(dayKeyOf(sent.at))} · ${clockOf(sent.at)}` },
          ]}
          pay={
            s.fee
              ? {
                  fee: s.fee,
                  feeLabel: s.feeLabel,
                  paid: sent.paid,
                  demo: sent.demo,
                  paying,
                  onPayNow: () => {
                    setPaying(true);
                    void payAction(s.fee).then((r) => {
                      setPaying(false);
                      if (r.ok) onPaid(r.demo);
                      else setErr(r.error);
                    });
                  },
                }
              : undefined
          }
        />
        {err ? (
          <p role="alert" className="text-pw-ink text-[15px] font-semibold">
            {err}
          </p>
        ) : null}
        {sent.unsent ? <Note>{D.unsent(sent.unsent)}</Note> : null}
        <Card className="flex flex-col gap-2.5">
          <h2 className="text-base font-semibold">{D.nextTitle}</h2>
          <ol className="flex flex-col gap-2">
            {steps.map(([label, done], i) => (
              <li key={label} className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-full",
                    done
                      ? "bg-pw-act text-pw-on-act"
                      : cn("ring-2 ring-inset", i === 1 ? "ring-pw-act" : "ring-pw-line-strong"),
                  )}
                >
                  {done ? <CheckIcon className="size-3.5" strokeWidth={2.4} /> : null}
                </span>
                <span
                  className={cn("text-[17px]", done || i === 1 ? "text-pw-ink" : "text-pw-ink-2")}
                >
                  {done ? label : D.notYet(label)}
                </span>
              </li>
            ))}
          </ol>
        </Card>
        <HonestNote after={D.honestAfter} />
        <div className="grid grid-cols-2 gap-2">
          <ButtonLink href={`/patient/visits/${receipt.appointment_id}`} tone="outline">
            {D.changeDay}
          </ButtonLink>
          <ButtonLink href="/patient/visits">{D.seeWeek}</ButtonLink>
        </div>
      </div>
    </>
  );
}
