"use client";

import type { DeskBookingReceipt, DeskBookInput } from "../actions";
import type { DraftSymptom, LineOption } from "@/app/patient/book/_lib/booking";
import type { BookingSymptomOption } from "@/lib/catalog/symptoms";
import type { PatientReasonCode } from "@/supabase/functions/_shared/sessions-sql";
import type { BookingSymptom } from "@/supabase/functions/_shared/symptoms";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { ArrowLeftIcon, CheckIcon } from "lucide-react";

import { ChoiceList, SessionStep, SlotStep } from "@/app/patient/book/_components/pick-steps";
import { SymptomPicker } from "@/app/patient/book/_components/symptom-picker";
import { firstOpenDay, MODE_LABEL, REASONS } from "@/app/patient/book/_lib/booking";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pill } from "@/components/ui/pill";
import { formatArrivalWindow, formatFullDate, formatTime } from "@/lib/patient/booking-format";
import { cn } from "@/lib/utils";
import { formatSymptoms } from "@/supabase/functions/_shared/symptoms";
import { bookOnBehalfAction } from "../actions";

/**
 * Book on behalf (Gate D, PRD §3.4). Who → reason → clinic → the pick →
 * check → the code, big. The pick steps are the patient wizard's own
 * components, so the desk offers exactly the days a patient would see.
 *
 * A "new caller" is a declared identity — name, phone, date of birth or age,
 * an adult declaration — and nothing else. No clinical question is asked
 * anywhere on this surface, and none may be added; what the caller chooses
 * to say (ADR 0095) is the patient wizard's own picker, words only.
 */

export interface DeskPatient {
  patientUserId: string;
  patientCode: string;
  /** Present only when the desk found them by phone (audited reveal). */
  displayName: string | null;
}

interface Caller {
  declaredName: string;
  phone: string;
  dateOfBirth: string;
  ageYears: string;
  declaredAdult: boolean;
}

type StepId = "who" | "reason" | "line" | "pick" | "check";

interface Props {
  hospitalName: string;
  patient: DeskPatient | null;
  lines: ReadonlyArray<LineOption>;
  nowIso: string;
  todayIso: string;
  symptomOptions: ReadonlyArray<BookingSymptomOption>;
}

const MINOR_REFUSAL = "Booking for a child is not available yet.";
const ADULT_YEARS = 18;

/**
 * The lower of the typed age and the whole years since the YYYY-MM-DD, against
 * the hospital's date — the same arithmetic `ha-book-on-behalf` runs, so the
 * desk and the server agree on an 18th birthday. Null when neither is given.
 */
function statedAge(caller: Caller, todayIso: string): number | null {
  const ages: number[] = [];
  if (caller.ageYears !== "") ages.push(Number(caller.ageYears));
  if (/^\d{4}-\d{2}-\d{2}$/.test(caller.dateOfBirth)) {
    const years = Number(todayIso.slice(0, 4)) - Number(caller.dateOfBirth.slice(0, 4));
    ages.push(todayIso.slice(5) < caller.dateOfBirth.slice(5) ? years - 1 : years);
  }
  return ages.length > 0 ? Math.min(...ages) : null;
}

const EMPTY_CALLER: Caller = {
  declaredName: "",
  phone: "",
  dateOfBirth: "",
  ageYears: "",
  declaredAdult: false,
};

export function DeskBooking({
  hospitalName,
  patient,
  lines,
  nowIso,
  todayIso,
  symptomOptions,
}: Props) {
  const router = useRouter();
  const [stepId, setStepId] = useState<StepId>(patient ? "reason" : "who");
  const [caller, setCaller] = useState<Caller>(EMPTY_CALLER);
  const [reason, setReason] = useState<PatientReasonCode | null>(null);
  const [note, setNote] = useState("");
  const [symptoms, setSymptoms] = useState<DraftSymptom[]>([]);
  const [lineId, setLineId] = useState<string | null>(null);
  const [clinicianUserId, setClinicianUserId] = useState<string | null>(null);
  const [dateIso, setDateIso] = useState("");
  const [slotStartsAtIso, setSlotStartsAtIso] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [appointmentType, setAppointmentType] = useState<"in_person" | "virtual">("in_person");
  // One key per attempt; a retry of the same pick replays (ADR 0088).
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [receipt, setReceipt] = useState<DeskBookingReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const nowMs = new Date(nowIso).getTime();

  const eligible = reason ? lines.filter((l) => l.reasonCodes.includes(reason)) : [];
  const line = eligible.find((l) => l.id === lineId) ?? null;
  const clinician =
    line?.clinicians.find((c) => c.userId === clinicianUserId) ?? line?.clinicians[0] ?? null;
  const slot =
    clinician?.slotsByDate[dateIso]?.find((s) => s.startsAtIso === slotStartsAtIso) ?? null;
  const session = line?.sessions.find((s) => s.id === sessionId) ?? null;
  const picked = line?.capacityMode === "session" ? session !== null : slot !== null;

  // Adults only at this gate (ADR 0089): the declaration AND the numbers
  // must agree. A ticked box beside an age of 12 is a child.
  const age = statedAge(caller, todayIso);
  const minor = age !== null && age < ADULT_YEARS;
  const callerOk =
    caller.declaredName.trim().length > 0 &&
    caller.phone.trim().length > 0 &&
    (caller.dateOfBirth !== "" || caller.ageYears !== "") &&
    caller.declaredAdult &&
    !minor;

  const steps: ReadonlyArray<{ id: StepId; label: string }> = [
    ...(patient ? [] : [{ id: "who" as const, label: "New caller" }]),
    { id: "reason", label: "Reason" },
    { id: "line", label: "Clinic" },
    { id: "pick", label: line?.capacityMode === "session" ? "Clinic day" : "Day and time" },
    { id: "check", label: "Check" },
  ];
  const index = Math.max(
    0,
    steps.findIndex((s) => s.id === stepId),
  );
  const goTo = (delta: 1 | -1) => {
    const next = steps[index + delta];
    if (next) setStepId(next.id);
    setError(null);
  };
  const canAdvance =
    stepId === "who"
      ? callerOk
      : stepId === "reason"
        ? reason !== null && symptoms.every((s) => s.duration !== null)
        : stepId === "line"
          ? line !== null
          : picked;

  const bump = () => setIdempotencyKey(crypto.randomUUID());

  const submit = () => {
    if (!line || !reason || !picked) return;
    const said = symptoms.filter((s): s is BookingSymptom => s.duration !== null);
    const input: DeskBookInput = {
      reason,
      note: note || undefined,
      symptoms: said.length ? said : undefined,
      idempotency_key: idempotencyKey,
      ...(patient
        ? { patient_user_id: patient.patientUserId }
        : {
            provisional: {
              declared_name: caller.declaredName.trim(),
              phone_e164: normalisePhone(caller.phone),
              date_of_birth: caller.dateOfBirth || undefined,
              age_years: caller.ageYears ? Number(caller.ageYears) : undefined,
              phone_verified: false as const,
            },
          }),
      ...(line.capacityMode === "session" && session
        ? { session: { session_id: session.id } }
        : clinician && slot
          ? {
              slot: {
                clinician_user_id: clinician.userId,
                department_id: line.departmentId,
                service_line_id: line.id,
                starts_at: slot.startsAtIso,
                ends_at: slot.endsAtIso,
                type: appointmentType,
              },
            }
          : {}),
    };
    setError(null);
    startTransition(async () => {
      const res = await bookOnBehalfAction(input);
      if (res.ok) {
        setReceipt(res.receipt);
        return;
      }
      setError(res.error);
      // A full day or a taken slot: re-derive the offer; keep the picks.
      router.refresh();
    });
  };

  if (receipt && line) {
    return (
      <DeskReceipt
        receipt={receipt}
        hospitalName={hospitalName}
        forLabel={patient ? patient.patientCode : caller.declaredName.trim()}
        provisional={!patient}
        lineName={line.name}
        whenIso={session?.startsAtIso ?? slot?.startsAtIso ?? nowIso}
        mode={line.capacityMode === "session" ? "session" : "slot"}
      />
    );
  }

  const titles: Record<StepId, string> = {
    who: "Who is calling?",
    reason: "Why are they coming?",
    line: "Which clinic?",
    pick: line?.capacityMode === "session" ? "Which clinic day?" : "Which day and time?",
    check: "Check before booking",
  };

  return (
    <div className="flex flex-col gap-5">
      <ol className="text-caption text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 font-mono uppercase">
        {steps.map((s, i) => (
          <li
            key={s.id}
            aria-current={i === index ? "step" : undefined}
            className={i === index ? "text-foreground" : i < index ? "" : "opacity-50"}
          >
            {i + 1}. {s.label}
          </li>
        ))}
      </ol>

      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-foreground text-heading-s">{titles[stepId]}</h2>
        {patient ? (
          <span className="text-muted-foreground text-caption font-mono tabular-nums">
            For {patient.displayName ? `${patient.displayName} · ` : ""}
            {patient.patientCode}
          </span>
        ) : caller.declaredName ? (
          <span className="text-muted-foreground text-caption">For {caller.declaredName}</span>
        ) : null}
      </div>

      {stepId === "who" ? (
        <CallerStep
          caller={caller}
          minor={minor}
          onChange={(patch) => setCaller({ ...caller, ...patch })}
        />
      ) : null}

      {stepId === "reason" ? (
        <div className="flex flex-col gap-4">
          <ChoiceList
            name="reason"
            value={reason}
            onChange={(v) => {
              setReason(v);
              setLineId(null);
              bump();
            }}
            options={REASONS}
          />
          <SymptomPicker
            idPrefix="desk"
            options={symptomOptions}
            value={symptoms}
            onChange={(next) => {
              setSymptoms(next);
              bump();
            }}
            compact
          />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="desk-note">
              Note for the clinic{" "}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <textarea
              id="desk-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="e.g. Told to come back once results were in."
              className="border-input text-foreground placeholder:text-muted-foreground focus-visible:shadow-focus bg-card text-body-m min-h-16 resize-y rounded-lg border px-3 py-2 outline-none"
            />
          </div>
        </div>
      ) : null}

      {stepId === "line" ? (
        eligible.filter((l) => l.capacityMode !== "open_queue").length === 0 ? (
          <p className="text-muted-foreground text-body-s">
            No clinic at {hospitalName} takes this reason with days on MedSync. Register them as a
            walk-in on the day instead.
          </p>
        ) : (
          <ChoiceList
            name="line"
            value={lineId}
            onChange={(id) => {
              setLineId(id);
              setClinicianUserId(null);
              setDateIso("");
              setSlotStartsAtIso(null);
              setSessionId(null);
              bump();
            }}
            options={eligible
              .filter((l) => l.capacityMode !== "open_queue")
              .map((l) => ({
                value: l.id,
                title: l.name,
                hint: l.departmentName,
                trailing: (
                  <span className="flex gap-1">
                    {l.confidential ? <Pill tone="sensitive">Confidential</Pill> : null}
                    <Pill tone="neutral">{MODE_LABEL[l.capacityMode]}</Pill>
                  </span>
                ),
              }))}
          />
        )
      ) : null}

      {stepId === "pick" && line ? (
        line.capacityMode === "session" ? (
          <SessionStep
            line={line}
            sessionId={session?.id ?? null}
            nowMs={nowMs}
            desk
            onPick={(id) => {
              setSessionId(id);
              bump();
            }}
          />
        ) : (
          <SlotStep
            line={line}
            clinician={clinician}
            dateIso={dateIso}
            slotStartsAtIso={slot?.startsAtIso ?? null}
            appointmentType={appointmentType}
            nowMs={nowMs}
            todayIso={todayIso}
            desk
            onClinician={(userId) => {
              const next = line.clinicians.find((c) => c.userId === userId);
              setClinicianUserId(userId);
              setDateIso(next ? (firstOpenDay(next) ?? "") : "");
              setSlotStartsAtIso(null);
              bump();
            }}
            onDate={(d) => {
              setDateIso(d);
              setSlotStartsAtIso(null);
              bump();
            }}
            onSlot={(s) => {
              setSlotStartsAtIso(s);
              bump();
            }}
            onType={(t) => {
              setAppointmentType(t);
              bump();
            }}
          />
        )
      ) : null}

      {stepId === "check" && line ? (
        <dl className="bg-card dark:shadow-card grid gap-x-6 gap-y-3 rounded-xl p-4 shadow-xs sm:grid-cols-2">
          <Fact label="For">
            {patient
              ? `${patient.displayName ? `${patient.displayName} · ` : ""}${patient.patientCode}`
              : `${caller.declaredName.trim()} · new caller, identity to confirm on arrival`}
          </Fact>
          <Fact label="Clinic">
            {line.name} · {line.departmentName}
          </Fact>
          <Fact label="When">
            {formatFullDate(session?.startsAtIso ?? slot?.startsAtIso ?? nowIso)}
            {line.capacityMode === "session"
              ? " · clinic day"
              : slot
                ? ` · ${formatTime(slot.startsAtIso)}`
                : ""}
          </Fact>
          <Fact label="Reason">
            {REASONS.find((r) => r.value === reason)?.title ?? reason}
            {appointmentType === "virtual" ? " · video or phone" : ""}
          </Fact>
          {symptoms.length ? (
            <Fact label="What is bothering them">
              {formatSymptoms(symptoms.filter((s): s is BookingSymptom => s.duration !== null))}
            </Fact>
          ) : null}
          {note ? <Fact label="Note">{note}</Fact> : null}
        </dl>
      ) : null}

      <div className="flex flex-col items-end gap-2">
        {error ? (
          <p role="alert" className="text-status-caution-fg text-body-s w-full">
            {error}
          </p>
        ) : null}
        <div className="flex w-full flex-wrap justify-between gap-2">
          {index > 0 ? (
            <Button type="button" variant="ghost" size="lg" onClick={() => goTo(-1)}>
              <ArrowLeftIcon className="size-4" aria-hidden />
              Back
            </Button>
          ) : (
            <Link
              href="/reception/book"
              className={cn(buttonVariants({ variant: "ghost", size: "lg" }))}
            >
              <ArrowLeftIcon className="size-4" aria-hidden />
              Someone else
            </Link>
          )}
          {stepId === "check" ? (
            <Button type="button" size="lg" disabled={!picked || pending} onClick={submit}>
              {pending
                ? "Booking…"
                : line?.capacityMode === "session"
                  ? "Book a place"
                  : "Book this time"}
            </Button>
          ) : (
            <Button type="button" size="lg" disabled={!canAdvance} onClick={() => goTo(1)}>
              Continue
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Pieces ──────────────────────────────────────────────────────── */

/**
 * The declared booking identity (PRD §2.8): non-blocking — no NIN, no ID.
 * Adults only at this gate; a minor is refused by the server with one
 * sentence, and the declaration here says so before the clerk types.
 */
function CallerStep({
  caller,
  minor,
  onChange,
}: {
  caller: Caller;
  /** The stated age or date of birth says under 18. */
  minor: boolean;
  onChange: (patch: Partial<Caller>) => void;
}) {
  const id = useId();
  return (
    <div className="bg-card dark:shadow-card flex flex-col gap-4 rounded-xl p-5 shadow-xs">
      <p className="text-muted-foreground text-body-s leading-relaxed">
        No patient record is created. The booking carries what the caller says; the desk confirms
        who they are when they arrive.
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-name`}>Name as given</Label>
        <Input
          id={`${id}-name`}
          value={caller.declaredName}
          onChange={(e) => onChange({ declaredName: e.target.value })}
          maxLength={120}
          autoComplete="off"
          // `?caller=new` exists to fill this form; the field is labelled and
          // first after the heading, so a screen reader lands on its name.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-phone`}>Phone</Label>
        <Input
          id={`${id}-phone`}
          type="tel"
          inputMode="tel"
          value={caller.phone}
          onChange={(e) => onChange({ phone: e.target.value })}
          placeholder="07XX XXX XXX"
          className="font-mono"
        />
        <p className="text-muted-foreground text-caption">The booking code is texted here.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-dob`}>Date of birth</Label>
          <Input
            id={`${id}-dob`}
            type="date"
            value={caller.dateOfBirth}
            onChange={(e) => onChange({ dateOfBirth: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-age`}>or age in years</Label>
          <Input
            id={`${id}-age`}
            type="number"
            inputMode="numeric"
            min={0}
            max={130}
            value={caller.ageYears}
            onChange={(e) => onChange({ ageYears: e.target.value })}
          />
        </div>
      </div>
      <label className="text-body-s flex min-h-11 cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={caller.declaredAdult}
          onChange={(e) => onChange({ declaredAdult: e.target.checked })}
          className="accent-brand-500 mt-1 size-4 shrink-0"
        />
        <span className="text-foreground">
          The caller says this person is an adult (18 or older).{" "}
          <span className="text-muted-foreground">{MINOR_REFUSAL}</span>
        </span>
      </label>
      {minor ? (
        <p role="alert" className="text-status-caution-fg text-body-s">
          {MINOR_REFUSAL}
        </p>
      ) : null}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-overline text-muted-foreground">{label}</dt>
      <dd className="text-foreground text-body-s">{children}</dd>
    </div>
  );
}

/** The code, big — read aloud down the phone and written on a card. */
function DeskReceipt({
  receipt,
  hospitalName,
  forLabel,
  provisional,
  lineName,
  whenIso,
  mode,
}: {
  receipt: DeskBookingReceipt;
  hospitalName: string;
  forLabel: string;
  provisional: boolean;
  lineName: string;
  whenIso: string;
  mode: "session" | "slot";
}) {
  const window =
    receipt.arrival_window_start && receipt.arrival_window_end
      ? formatArrivalWindow(receipt.arrival_window_start, receipt.arrival_window_end)
      : null;
  return (
    <section aria-labelledby="desk-receipt" className="ncd-reveal flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <span
          aria-hidden
          className="bg-accent text-accent-foreground grid size-10 place-items-center rounded-full"
        >
          <CheckIcon className="size-5" strokeWidth={1.5} />
        </span>
        <h2 id="desk-receipt" className="text-foreground text-heading-m">
          {mode === "session"
            ? "Place booked"
            : receipt.status === "confirmed"
              ? "Time booked"
              : "Time requested"}
        </h2>
        <p className="text-muted-foreground text-body-s">
          For {forLabel} · {lineName} · {hospitalName} · {formatFullDate(whenIso)}
          {mode === "slot" ? ` · ${formatTime(whenIso)}` : ""}
        </p>
      </div>

      <dl className="bg-card dark:shadow-card flex flex-col gap-5 rounded-xl p-5 shadow-xs">
        {receipt.booking_code ? (
          <div className="flex flex-col gap-1">
            <dt className="text-overline text-muted-foreground">Booking code — read it out</dt>
            <dd className="text-foreground text-display-l font-mono tracking-[0.14em]">
              {receipt.booking_code}
            </dd>
          </div>
        ) : null}
        {mode === "session" && receipt.position_number !== null ? (
          <div className="flex flex-col gap-1">
            <dt className="text-overline text-muted-foreground">Position</dt>
            <dd className="text-foreground text-display-s font-mono tabular-nums">
              {receipt.position_number}
            </dd>
          </div>
        ) : null}
        {window ? (
          <div className="flex flex-col gap-1">
            <dt className="text-overline text-muted-foreground">Arrive between</dt>
            <dd className="text-foreground text-body-m">{window}</dd>
          </div>
        ) : null}
        {provisional ? (
          <p className="text-muted-foreground text-body-s leading-relaxed">
            Booked as a new caller. On the Expected board this row reads{" "}
            <span className="text-foreground font-medium">Identity to confirm</span> until the desk
            matches or registers the person on arrival.
          </p>
        ) : null}
      </dl>

      <div className="flex flex-wrap gap-2">
        <Link href="/reception/book" className={cn(buttonVariants({ size: "lg" }))}>
          Book another
        </Link>
        <Link
          href="/reception/expected"
          className={cn(buttonVariants({ variant: "secondary", size: "lg" }))}
        >
          Expected board
        </Link>
      </div>
    </section>
  );
}

/** "0772 123 456" → "+256772123456"; E.164 input passes through. */
function normalisePhone(raw: string): string {
  const digits = raw.replace(/[\s()-]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("0")) return `+256${digits.slice(1)}`;
  if (digits.startsWith("256")) return `+${digits}`;
  return digits;
}
