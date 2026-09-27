import "server-only";

import type { PillTone } from "@/components/ui/data-table";
import type { BookingSymptom } from "@/supabase/functions/_shared/symptoms";
import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";

import { db } from "@/db";
import { hospitalDepartments } from "@/db/schema/hospital-departments";
import { hospitals } from "@/db/schema/hospitals";
import { patientIntakes } from "@/db/schema/patient-intakes";
import { appointments } from "@/db/schema/scheduling";
import { users } from "@/db/schema/users";
import {
  DEFAULT_TIME_ZONE,
  endOfLocalDay,
  localDateKey,
  localWeekdayAndMinutes,
  startOfLocalDay,
} from "@/supabase/functions/_shared/slots";
import { normaliseSymptoms } from "@/supabase/functions/_shared/symptoms";

/**
 * Patient-facing appointment reads + the status vocabulary that goes
 * with them. Home and the visits list rendered byte-identical copies
 * of the tone map, the label map and `formatWhen`, and two queries
 * that differed only in filter and limit — so a status renamed on one
 * screen silently disagreed with the other.
 *
 * `server-only`: the Drizzle/postgres driver must not reach the
 * browser bundle. `PillTone` is a type-only import, so it is erased
 * and never pulls the client `data-table` module in at runtime. If a
 * client component ever needs the label/tone maps, split them into a
 * `-constants.ts` sibling the way `self-tracking-constants.ts` does.
 */

/** "Thu 18 Sep" in the clinic's zone — the same label the reschedule picker speaks. */
const DAY_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: DEFAULT_TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
});

/** Statuses whose appointment is still going to happen. */
const LIVE_STATUSES = [
  "requested",
  "pending_approval",
  "confirmed",
  "arrived",
  "in_progress",
] as const;

/**
 * Appointment states are scheduling workflow, not a patient's clinical state,
 * so they render as square tags in cool place hues — never red, amber or
 * green (ADR 0162, MedSync Chroma). The word always carries the meaning.
 */
export const STATUS_TONES: Record<string, PillTone> = {
  requested: "notice",
  pending_approval: "notice",
  confirmed: "active",
  arrived: "info",
  in_progress: "info",
  completed: "neutral",
  cancelled: "neutral",
  no_show: "neutral",
  rescheduled: "neutral",
  declined: "neutral",
};

export const STATUS_LABEL: Record<string, string> = {
  requested: "Requested",
  pending_approval: "Awaiting approval",
  confirmed: "Confirmed",
  arrived: "You've arrived",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "Missed",
  rescheduled: "Rescheduled",
  declined: "Declined",
};

/** Statuses a patient may still cancel themselves. */
export const CANCELLABLE: ReadonlySet<string> = new Set([
  "requested",
  "pending_approval",
  "confirmed",
  "arrived",
]);

export interface AppointmentRow {
  id: string;
  startsAtIso: string;
  status: string;
  type: string;
  reasonNote: string | null;
  /** ADR 0095: what the patient said at booking, read back as words; empty when none. */
  symptoms: BookingSymptom[];
  /** `users.fullName` is nullable; falls back to "Your clinician". */
  clinicianName: string;
  departmentName: string;
  hospitalName: string;
  /** Six characters the patient shows at the desk (ADR 0088); null on rows that predate Gate C. */
  bookingCode: string | null;
  /** Set together with `positionNumber` and the window: this is a place in a clinic day, not a time. */
  sessionId: string | null;
  positionNumber: number | null;
  arrivalWindowStartIso: string | null;
  arrivalWindowEndIso: string | null;
  /** Gate E: the patient's answer to the T-24h confirmation request; null = not yet. */
  confirmedByPatientAtIso: string | null;
  /**
   * A closed code, never words (Gate H, ADR 0094 — `_shared/cancel-reasons.ts`):
   * 'session_cancelled' when the clinic cancelled the day (the card offers a
   * rebooking); otherwise only ever read through `cancellationSentence`.
   */
  cancelledReason: string | null;
  /** ADR 0092: the fee quoted at booking, snapshotted — never re-read from the line. Null = none quoted. */
  quotedFeeUgx: number | null;
  quotedFeeLabel: string | null;
}

/**
 * - `upcoming` — everything from `now` forward, whatever its status.
 *   The visits list needs this: a cancelled or declined future visit
 *   is still something the patient must be able to see.
 * - `upcoming-active` — only the statuses that are still going to
 *   happen. Home's "Coming up", which must not offer a cancelled
 *   visit as the next thing you are doing; home passes the start of
 *   the clinic's day as `now`, so a session already under way stays.
 * - `past` — everything before `now`, newest first.
 */
export type AppointmentListKind = "upcoming" | "upcoming-active" | "past";

/**
 * `now` is a parameter, not a local `new Date()`, so a caller
 * fetching upcoming and past together can partition both halves on
 * one instant. Two independent clocks leave a sliver in which an
 * appointment belongs to neither list.
 */
export async function fetchAppointments(
  patientUserId: string,
  kind: AppointmentListKind,
  limit = 30,
  now: Date = new Date(),
): Promise<AppointmentRow[]> {
  const isPast = kind === "past";

  const rows = await db
    .select({
      id: appointments.id,
      startsAt: appointments.startsAt,
      status: appointments.status,
      type: appointments.type,
      reasonNote: appointments.reasonNote,
      symptoms: appointments.symptoms,
      clinicianName: users.fullName,
      departmentName: hospitalDepartments.name,
      hospitalName: hospitals.name,
      bookingCode: appointments.bookingCode,
      sessionId: appointments.sessionId,
      positionNumber: appointments.positionNumber,
      arrivalWindowStart: appointments.arrivalWindowStart,
      arrivalWindowEnd: appointments.arrivalWindowEnd,
      confirmedByPatientAt: appointments.confirmedByPatientAt,
      cancelledReason: appointments.cancelledReason,
      quotedFeeUgx: appointments.quotedFeeUgx,
      quotedFeeLabel: appointments.quotedFeeLabel,
    })
    .from(appointments)
    .innerJoin(users, eq(users.id, appointments.clinicianUserId))
    .innerJoin(hospitalDepartments, eq(hospitalDepartments.id, appointments.departmentId))
    .innerJoin(hospitals, eq(hospitals.id, appointments.hospitalId))
    .where(
      and(
        eq(appointments.patientUserId, patientUserId),
        isPast ? lt(appointments.startsAt, now) : gte(appointments.startsAt, now),
        kind === "upcoming-active" ? inArray(appointments.status, [...LIVE_STATUSES]) : undefined,
      ),
    )
    .orderBy(isPast ? desc(appointments.startsAt) : asc(appointments.startsAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    startsAtIso: r.startsAt.toISOString(),
    status: r.status,
    type: r.type,
    reasonNote: r.reasonNote,
    symptoms: normaliseSymptoms(r.symptoms) ?? [],
    clinicianName: r.clinicianName ?? "Your clinician",
    departmentName: r.departmentName,
    hospitalName: r.hospitalName,
    bookingCode: r.bookingCode,
    sessionId: r.sessionId,
    positionNumber: r.positionNumber,
    arrivalWindowStartIso: r.arrivalWindowStart?.toISOString() ?? null,
    arrivalWindowEndIso: r.arrivalWindowEnd?.toISOString() ?? null,
    confirmedByPatientAtIso: r.confirmedByPatientAt?.toISOString() ?? null,
    cancelledReason: r.cancelledReason,
    quotedFeeUgx: r.quotedFeeUgx,
    quotedFeeLabel: r.quotedFeeLabel,
  }));
}

/** Gate E: the T-24h confirmation request is open — confirmed, unanswered, inside the last day. */
export const CONFIRM_WINDOW_MS = 24 * 3_600_000;
export function confirmationPending(r: AppointmentRow, now: Date): boolean {
  const startsMs = new Date(r.startsAtIso).getTime();
  return (
    r.status === "confirmed" &&
    r.confirmedByPatientAtIso === null &&
    startsMs > now.getTime() &&
    startsMs - now.getTime() <= CONFIRM_WINDOW_MS
  );
}

/**
 * PRD §3.5: only a confirmed, in-person visit on the clinic's own today can
 * be arrived at. Judged on the server's clock, in the hospital's zone. Home
 * and the visits list both offer "I have arrived", so the rule lives here.
 */
export function canArrive(r: AppointmentRow, todayKey: string): boolean {
  return (
    r.status === "confirmed" &&
    r.type !== "virtual" &&
    localDateKey(new Date(r.startsAtIso), DEFAULT_TIME_ZONE) === todayKey
  );
}

/**
 * What the patient is told they already have today. No jargon, no mechanism,
 * and never a count — the queue is department-scoped, and the ticket page is
 * the one place a position is shown (ADR 0084 §6). The queue page and the
 * home's "Coming up" read the same words from here.
 */
export const INTAKE_TITLE: Record<string, string> = {
  declared: "We have already saved you a place today.",
  arrived: "You are already at the hospital today.",
  awaiting_triage: "You are already at the hospital today.",
  triaged: "A nurse has already seen you today.",
};

export interface LiveIntakeToday {
  id: string;
  status: string;
  departmentName: string | null;
}

/**
 * Today's live same-day ticket at this hospital, or null — the query the
 * queue page gates its form on, plus the department's name. "Today" is the
 * hospital's day, not the host's: a ticket declared at 01:00 EAT is today's.
 */
export async function fetchLiveIntakeToday(
  patientUserId: string,
  hospitalId: string,
  now: Date = new Date(),
): Promise<LiveIntakeToday | null> {
  const rows = await db
    .select({
      id: patientIntakes.id,
      status: patientIntakes.status,
      departmentName: hospitalDepartments.name,
    })
    .from(patientIntakes)
    .leftJoin(hospitalDepartments, eq(hospitalDepartments.id, patientIntakes.receivingDepartmentId))
    .where(
      and(
        eq(patientIntakes.patientUserId, patientUserId),
        eq(patientIntakes.hospitalId, hospitalId),
        inArray(patientIntakes.status, ["declared", "arrived", "awaiting_triage", "triaged"]),
        gte(patientIntakes.arrivedAt, startOfLocalDay(now, DEFAULT_TIME_ZONE)),
        lt(patientIntakes.arrivedAt, endOfLocalDay(now, DEFAULT_TIME_ZONE)),
      ),
    )
    // Newest first, as pt-declare-intake and the phone read it, so a second
    // live row (a desk registration beside a declaration) cannot make the
    // two surfaces name different tickets.
    .orderBy(desc(patientIntakes.arrivedAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * "Thu 18 Sep · Morning session" — a day and a day-part, never a clock
 * numeral (ADR 0084 §10). Luganda and Swahili run a dawn-anchored clock in
 * which _ssawa bbiri_ is literally "two" and denotes 8:00am, so the numeral
 * itself is offset by six and an English AM/PM word does not fix that: it
 * disambiguates a distinction that was never the failure mode and leaves
 * "14:00" to be re-read against the local convention. §10 extends the rule
 * past the two entry screens to the appointments list by name, and home
 * renders the same string — this is the one function both read it from.
 *
 * Pinned to the clinic's zone, never the host's. The 24-hour version read
 * `toLocaleTimeString(undefined, …)` with no `timeZone`, which on a UTC host
 * is three hours behind Kampala: a 09:00 EAT visit printed "06:00", and one
 * before 03:00 EAT printed the previous day.
 */
export function formatWhen(iso: string): string {
  const at = new Date(iso);
  const { minutesOfDay } = localWeekdayAndMinutes(at, DEFAULT_TIME_ZONE);
  // Local noon, the same boundary /patient/book and the reschedule picker
  // split on, so the three screens cannot name the same visit differently.
  return `${DAY_FMT.format(at)} · ${minutesOfDay < 12 * 60 ? "Morning" : "Afternoon"} session`;
}
