"use client";

import type { ClinicianOption, ElsewhereOption, LineOption, SessionOption } from "../_lib/booking";
import type { JoinWaitlistInput } from "../actions";
import type { ReactNode } from "react";
import Link from "next/link";

import { Pill } from "@/components/ui/pill";
import { formatFullDate, formatShortDate, formatTime } from "@/lib/patient/booking-format";
import { cn } from "@/lib/utils";
import { DEFAULT_TIME_ZONE, localDateKey } from "@/supabase/functions/_shared/slots";
import {
  accessAlternatives,
  sessionTakeable,
  splitDays,
  splitSessions,
  windowEndMs,
} from "../_lib/booking";
import { WaitlistJoin } from "./waitlist-join";

/**
 * The pick — a clinician's day and time, or a clinic day — and the pieces it
 * is built from. Shared by the patient wizard and `/reception/book` (Gate D),
 * so the desk offers exactly the days the patient would see and never grows
 * a second slot renderer.
 *
 * `desk` hides the patient-facing "Sooner options" panel: its links lead to
 * the patient's own queue and hospital pages, which a clerk has no use for.
 * `forMember` is the patient booking for someone on their household list
 * (Gate D, PRD §2.9): "Seen you before" is the signed-in patient's own
 * continuity, not the member's, and the same-day queue is declared for
 * oneself — both are withheld. The beyond-target days stay labelled on every
 * surface (PRD §2.4 rule 4).
 *
 * No clinical question anywhere in this file, and none may be added.
 */

export function SlotStep({
  line,
  clinician,
  dateIso,
  slotStartsAtIso,
  appointmentType,
  nowMs,
  todayIso,
  desk = false,
  forMember = false,
  onClinician,
  onDate,
  onSlot,
  onType,
}: {
  line: LineOption;
  clinician: ClinicianOption | null;
  dateIso: string;
  slotStartsAtIso: string | null;
  appointmentType: "in_person" | "virtual";
  nowMs: number;
  todayIso: string;
  /** Reception's surface: no patient-app links. */
  desk?: boolean;
  /** Booking for a household member: no continuity mark, no queue door. */
  forMember?: boolean;
  onClinician: (userId: string) => void;
  onDate: (dateIso: string) => void;
  onSlot: (startsAtIso: string) => void;
  onType: (t: "in_person" | "virtual") => void;
}) {
  if (!clinician) {
    return <p className="text-muted-foreground text-body-s">Go back and choose a clinic.</p>;
  }
  const endMs = windowEndMs(nowMs, line.timeToCareDays);
  const { within, beyond } = splitDays(clinician, endMs);
  const alternatives = desk ? null : accessAlternatives(line, clinician, nowMs);
  const times = clinician.slotsByDate[dateIso] ?? [];

  return (
    <div className="flex flex-col gap-5">
      <p className="text-muted-foreground text-body-s leading-relaxed">
        This day is with <span className="text-foreground font-medium">{clinician.fullName}</span>{" "}
        in {line.departmentName}.
        {clinician.seenBefore && !desk && !forMember ? (
          <>
            {" "}
            <Pill tone="active">Seen you before</Pill>
          </>
        ) : null}
      </p>

      {line.clinicians.length > 1 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-foreground text-body-s font-medium">Clinician</h3>
          {/* A tile grid in the open, not a list behind a disclosure: every
              clinician on the line is one tap and one screen away. */}
          <ChoiceList
            name="clinician"
            value={clinician.userId}
            onChange={onClinician}
            options={line.clinicians.map((c) => ({
              value: c.userId,
              title: c.fullName,
              hint: c.seenBefore && !forMember ? "Seen you before" : line.departmentName,
            }))}
          />
        </div>
      ) : null}

      {alternatives ? (
        <Alternatives
          line={line}
          otherClinicians={alternatives.otherClinicians}
          elsewhere={alternatives.elsewhere}
          queue={!forMember}
          onClinician={onClinician}
        />
      ) : null}

      {within.length > 0 ? (
        <DayChips
          label="Choose a day"
          days={within}
          dateIso={dateIso}
          todayIso={todayIso}
          onDate={onDate}
        />
      ) : null}
      {beyond.length > 0 ? (
        <DayChips
          label={`Beyond this clinic's target of ${line.timeToCareDays} days`}
          days={beyond}
          dateIso={dateIso}
          todayIso={todayIso}
          onDate={onDate}
        />
      ) : null}

      {dateIso ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-foreground text-body-s font-medium">Choose a time</h3>
            <span className="text-muted-foreground text-caption font-mono tabular-nums">
              {times.length} {times.length === 1 ? "time" : "times"}
            </span>
          </div>
          <ul className="flex flex-wrap gap-2" aria-label="Times">
            {times.map((t) => (
              <li key={t.startsAtIso}>
                <Chip
                  selected={t.startsAtIso === slotStartsAtIso}
                  onSelect={() => onSlot(t.startsAtIso)}
                >
                  {formatTime(t.startsAtIso)}
                </Chip>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {clinician.allowVirtual ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-foreground text-body-s font-medium">How do you want to be seen?</h3>
          <ChoiceList
            name="visit-type"
            value={appointmentType}
            onChange={onType}
            options={[
              {
                value: "in_person",
                title: "Come to the clinic",
                hint: "You travel to the hospital.",
              },
              {
                value: "virtual",
                title: "Video or phone",
                hint: "Instead of travelling to the clinic.",
              },
            ]}
          />
        </div>
      ) : null}
    </div>
  );
}

export function SessionStep({
  line,
  sessionId,
  nowMs,
  desk = false,
  forMember = false,
  waitlist,
  onPick,
}: {
  line: LineOption;
  sessionId: string | null;
  nowMs: number;
  /** Reception's surface: no patient-app links. */
  desk?: boolean;
  /** Booking for a household member: no queue door. */
  forMember?: boolean;
  /** Gate E: what a "Tell me if a place opens" join would send; absent on the desk. */
  waitlist?: { reason: string; forProvisionalId?: string; todayYmd: string };
  onPick: (id: string) => void;
}) {
  const endMs = windowEndMs(nowMs, line.timeToCareDays);
  const { within, beyond } = splitSessions(line.sessions, endMs);
  const alternatives = desk ? null : accessAlternatives(line, null, nowMs);
  // Nothing takeable inside the target: full, unnamed, or none at all.
  const nothingWithin = !within.some(sessionTakeable);
  const toOption = (s: SessionOption): Choice<string> => {
    // PRD §3.6: a day with no clinician is never offered as bookable, and
    // `_shared/book.ts` 409s it ("This clinic day has no clinician assigned
    // yet."). Offering it anyway sent the patient into a refusal they could
    // not have predicted.
    const unnamed = s.clinicianUserId === null;
    return {
      value: s.id,
      title: formatFullDate(s.startsAtIso),
      hint: [s.clinicianName ?? "Clinician not yet named", s.venue].filter(Boolean).join(" · "),
      disabled: s.placesLeft === 0 || unnamed,
      trailing: unnamed ? (
        <Pill tone="neutral">Not open yet</Pill>
      ) : s.placesLeft === 0 ? (
        <Pill tone="neutral">Full</Pill>
      ) : (
        <span className="text-muted-foreground text-body-s whitespace-nowrap tabular-nums">
          {s.placesLeft} {s.placesLeft === 1 ? "place" : "places"} left
        </span>
      ),
    };
  };

  return (
    <div className="flex flex-col gap-5">
      {alternatives ? (
        <Alternatives
          line={line}
          otherClinicians={[]}
          elsewhere={alternatives.elsewhere}
          queue={!forMember}
        />
      ) : null}
      {within.length > 0 ? (
        <ChoiceList
          name="session"
          value={sessionId}
          onChange={onPick}
          options={within.map(toOption)}
        />
      ) : null}
      {waitlist && nothingWithin ? (
        <WaitlistJoin
          clinicName={line.name}
          input={{
            service_line_id: line.id,
            reason: waitlist.reason as JoinWaitlistInput["reason"],
            preferred_from: waitlist.todayYmd,
            preferred_to: ymdInKampala(endMs),
            ...(waitlist.forProvisionalId ? { for_provisional_id: waitlist.forProvisionalId } : {}),
          }}
        />
      ) : null}
      {beyond.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-foreground text-body-s font-medium">
            Beyond this clinic&rsquo;s target of {line.timeToCareDays} days
          </h3>
          <ChoiceList
            name="session"
            value={sessionId}
            onChange={onPick}
            options={beyond.map(toOption)}
          />
        </div>
      ) : null}
      {/* PRD §2.2: stated at the pick and again on the receipt. */}
      <p className="text-muted-foreground text-body-s leading-relaxed">
        {desk || forMember
          ? "A clinic day gives the patient a position and a time to arrive by, not an exact time. Arriving early does not change the position."
          : "A clinic day gives you a position and a time to arrive by, not an exact time. Arriving early does not change your position."}
      </p>
    </div>
  );
}

/**
 * PRD §2.4, in its order, shown only when nothing falls inside the line's
 * own target: another clinician here, the same clinic elsewhere, the
 * same-day queue. The beyond-target days follow, labelled, in the step.
 */
function Alternatives({
  line,
  otherClinicians,
  elsewhere,
  queue,
  onClinician,
}: {
  line: LineOption;
  otherClinicians: ReadonlyArray<ClinicianOption>;
  elsewhere: ReadonlyArray<ElsewhereOption>;
  /** The same-day queue door — the patient's own, so absent for a member. */
  queue: boolean;
  onClinician?: (userId: string) => void;
}) {
  return (
    <section
      aria-label="Sooner options"
      className="bg-card dark:shadow-card flex flex-col gap-3 rounded-xl p-4 shadow-xs"
    >
      <p className="text-foreground text-body-s leading-relaxed">
        Nothing is open within this clinic&rsquo;s target of {line.timeToCareDays} days. Sooner
        options, in order:
      </p>
      <ol className="flex flex-col gap-2">
        {otherClinicians.map((c) => (
          <li key={c.userId}>
            <button
              type="button"
              onClick={() => onClinician?.(c.userId)}
              className="tap bg-accent text-accent-foreground text-body-s flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-4 text-left"
            >
              <span>
                <span className="font-medium">{c.fullName}</span> has a day open sooner
              </span>
              <span aria-hidden>→</span>
            </button>
          </li>
        ))}
        {elsewhere.map((h) => (
          <li key={h.hospitalId}>
            <Link
              href={`/patient/hospitals?q=${encodeURIComponent(line.name)}`}
              className="tap bg-accent text-accent-foreground text-body-s flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-4"
            >
              <span>
                <span className="font-medium">{line.name}</span> at {h.hospitalName}
                {h.region ? ` (${h.region})` : ""} has days open
              </span>
              <span aria-hidden>→</span>
            </Link>
          </li>
        ))}
        {queue ? (
          <li>
            <Link
              href="/patient/queue"
              className="tap bg-accent text-accent-foreground text-body-s flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-4"
            >
              <span className="font-medium">Coming to the hospital today</span>
              <span aria-hidden>→</span>
            </Link>
          </li>
        ) : null}
      </ol>
    </section>
  );
}

/* ─── Pieces ──────────────────────────────────────────────────────── */

export interface Choice<T extends string> {
  value: T;
  title: string;
  hint?: string;
  disabled?: boolean;
  trailing?: ReactNode;
}

/**
 * Pick one of a short list. A real `<input type="radio">` rather than a
 * pressed button: arrow-key traversal, a single tab stop and an announced
 * selected state for no code — and the dot is a non-colour signal, so the
 * tint beside it never carries the state alone.
 */
export function ChoiceList<T extends string>({
  name,
  value,
  onChange,
  options,
}: {
  name: string;
  value: T | null;
  onChange: (v: T) => void;
  options: ReadonlyArray<Choice<T>>;
}) {
  // Tiles in a grid, not rows in a column: fourteen reasons or a hospital's
  // clinics fit one screen instead of a scroll. The native radio stays
  // visible — it is the control a patient recognises.
  return (
    <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <li key={o.value} className="min-w-0">
            <label
              className={cn(
                "tap has-[:focus-visible]:shadow-focus flex min-h-12 items-center gap-2.5 rounded-lg px-3 py-2",
                o.disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                selected ? "bg-accent ring-brand-300 ring-1" : "bg-card dark:shadow-card shadow-xs",
              )}
            >
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={selected}
                disabled={o.disabled}
                onChange={() => onChange(o.value)}
                className="accent-brand-500 size-4 shrink-0 outline-none"
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-foreground text-body-s truncate font-medium">{o.title}</span>
                {o.hint ? (
                  <span className="text-muted-foreground text-caption truncate">{o.hint}</span>
                ) : null}
              </span>
              {o.trailing ? <span className="shrink-0">{o.trailing}</span> : null}
            </label>
          </li>
        );
      })}
    </ul>
  );
}

export function Chip({
  selected,
  onSelect,
  children,
  ariaLabel,
}: {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={ariaLabel}
      className={cn(
        "tap text-body-s min-h-11 rounded-lg px-3 tabular-nums",
        selected
          ? "bg-primary text-primary-foreground font-medium"
          : "bg-card text-muted-foreground dark:shadow-card shadow-xs",
      )}
    >
      {children}
    </button>
  );
}

/**
 * A flat list of the days the clinic has open, not an `<input type="date">`:
 * on a low-end Android WebView that degrades to a typed yyyy-mm-dd field,
 * and date entry with low-literacy users is the largest hole in the
 * research. Full dates are always in the accessible name (PRD §6.3).
 */
export function DayChips({
  label,
  days,
  dateIso,
  todayIso,
  onDate,
}: {
  label: string;
  days: ReadonlyArray<string>;
  dateIso: string;
  todayIso: string;
  onDate: (iso: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-foreground text-body-s font-medium">{label}</h3>
      <ul className="flex flex-wrap gap-2" aria-label={label}>
        {days.map((iso) => {
          // Noon UTC of the civil day keeps the label on that day in every zone.
          const day = new Date(`${iso}T12:00:00Z`);
          const relative = iso === todayIso ? "Today" : null;
          return (
            <li key={iso}>
              <Chip
                selected={iso === dateIso}
                onSelect={() => onDate(iso)}
                ariaLabel={
                  relative
                    ? `${relative}, ${formatFullDate(day.toISOString())}`
                    : formatFullDate(day.toISOString())
                }
              >
                {relative ?? formatShortDate(day.toISOString())}
              </Chip>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** "YYYY-MM-DD" in the clinic's zone — the waitlist window's last day. */
function ymdInKampala(ms: number): string {
  return localDateKey(new Date(ms), DEFAULT_TIME_ZONE);
}
