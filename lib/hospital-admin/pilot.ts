import "server-only";

import { and, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import { clinicSessions } from "@/db/schema/clinic-sessions";
import { appointments, queueEntries } from "@/db/schema/scheduling";
import { serviceLines } from "@/db/schema/service-lines";
import { HELD_PAST_STATUSES, MIN_RATE_SAMPLE } from "@/lib/hospital-admin/reports";
import {
  DEFAULT_TIME_ZONE,
  localDateKey,
  startOfLocalDay,
} from "@/supabase/functions/_shared/slots";

/**
 * Pilot numbers, week by week (MedSync Book pilot). Per hospital, then per
 * clinic line: bookings made and how, missed visits, and two median waits.
 *
 * Same boundary as ./reports: every read is a COUNT or an array of minutes
 * grouped by hospital, line and week — no name, code, phone or patient id is
 * selected, and the minutes never leave the server (only the median does).
 *
 *   bookings   rows CREATED in the week, by `channel`; a move (the new row of
 *              a reschedule) is not a new booking, `void` was entered in error,
 *              and `system` (urgent-review proposals) is not a booking anyone made.
 *   no-shows   visits whose time was IN the week and has ended: status no_show ÷
 *              HELD_PAST_STATUSES (the facility report's denominator).
 *   waits      booked arrivals checked in at the desk (queue_entries.arrived_at,
 *              ha-mark-arrived), against the time the patient was given
 *              (arrival_window_start, else starts_at), and then to the
 *              clinician's call (called_at, ha-start-encounter).
 */

export const PILOT_WEEKS = 8;
export const PILOT_CHANNELS = ["web", "app", "desk", "ussd"] as const;
export type PilotChannel = (typeof PILOT_CHANNELS)[number];

const DAY_MS = 86_400_000;

export interface Median {
  /** Minutes; null when nothing was measured. */
  median: number | null;
  n: number;
}

export interface PilotWeek {
  /** The Monday the week starts on, local date "YYYY-MM-DD". */
  week: string;
  booked: Record<PilotChannel, number> & { total: number };
  noShow: number;
  held: number;
  /** Held and past, still `confirmed` — nobody marked arrived or no-show. */
  unmarked: number;
  /** noShow ÷ held, or null under MIN_RATE_SAMPLE. */
  noShowShare: number | null;
  /** Check-in minus the time given; negative = early. */
  checkInVsBooked: Median;
  /** Check-in to the clinician's call. */
  checkInToSeen: Median;
}

export interface PilotLine {
  /** null: bookings not on a clinic day (slot mode), which carry no line. */
  lineId: string | null;
  lineName: string | null;
  weeks: PilotWeek[];
}

export interface PilotHospital {
  hospitalId: string;
  weeks: PilotWeek[];
  lines: PilotLine[];
}

interface Keyed {
  hospitalId: string;
  lineId: string | null;
  lineName: string | null;
  week: string;
}
export interface BookingRow extends Keyed {
  channel: string;
  n: number;
}
export interface VisitRow extends Keyed {
  noShow: number;
  held: number;
  unmarked: number;
}
export interface WaitRow extends Keyed {
  toCheckIn: number[];
  toSeen: number[];
}

/* ─── pure ───────────────────────────────────────────────────────── */

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * The last `count` local weeks (Monday first day), newest first, and the
 * instant the oldest one starts. Kampala keeps no DST, so a week is 7 × 24h.
 */
export function pilotWeeks(now: Date, count = PILOT_WEEKS): { from: Date; weeks: string[] } {
  const today = Date.parse(`${localDateKey(now, DEFAULT_TIME_ZONE)}T00:00:00Z`);
  const back = ((new Date(today).getUTCDay() + 6) % 7) + (count - 1) * 7;
  const oldest = today - back * DAY_MS;
  return {
    from: startOfLocalDay(new Date(now.getTime() - back * DAY_MS), DEFAULT_TIME_ZONE),
    weeks: Array.from({ length: count }, (_, i) =>
      new Date(oldest + (count - 1 - i) * 7 * DAY_MS).toISOString().slice(0, 10),
    ),
  };
}

interface Cell {
  booked: Record<PilotChannel, number>;
  noShow: number;
  held: number;
  unmarked: number;
  toCheckIn: number[];
  toSeen: number[];
}

const emptyCell = (): Cell => ({
  booked: { web: 0, app: 0, desk: 0, ussd: 0 },
  noShow: 0,
  held: 0,
  unmarked: 0,
  toCheckIn: [],
  toSeen: [],
});

function toWeek(week: string, c: Cell): PilotWeek {
  return {
    week,
    booked: { ...c.booked, total: PILOT_CHANNELS.reduce((n, ch) => n + c.booked[ch], 0) },
    noShow: c.noShow,
    held: c.held,
    unmarked: c.unmarked,
    noShowShare: c.held >= MIN_RATE_SAMPLE ? c.noShow / c.held : null,
    checkInVsBooked: { median: median(c.toCheckIn), n: c.toCheckIn.length },
    checkInToSeen: { median: median(c.toSeen), n: c.toSeen.length },
  };
}

/**
 * Rows → per hospital, per line, every week zero-filled. A hospital's median
 * is taken over all its lines' minutes together, never a median of medians.
 */
export function assemblePilot(
  weeks: readonly string[],
  bookings: readonly BookingRow[],
  visits: readonly VisitRow[],
  waits: readonly WaitRow[],
): Map<string, PilotHospital> {
  const inWindow = new Set(weeks);
  type Acc = {
    total: Map<string, Cell>;
    lines: Map<string, { name: string | null; id: string | null; cells: Map<string, Cell> }>;
  };
  const acc = new Map<string, Acc>();
  // Both the hospital's cell and the line's cell for one row's key.
  const cells = (r: Keyed): Cell[] => {
    let h = acc.get(r.hospitalId);
    if (!h) acc.set(r.hospitalId, (h = { total: new Map(), lines: new Map() }));
    const lineKey = r.lineId ?? "";
    let l = h.lines.get(lineKey);
    if (!l) h.lines.set(lineKey, (l = { id: r.lineId, name: r.lineName, cells: new Map() }));
    return [h.total, l.cells].map((m) => {
      let c = m.get(r.week);
      if (!c) m.set(r.week, (c = emptyCell()));
      return c;
    });
  };

  for (const r of bookings) {
    if (!inWindow.has(r.week) || !(PILOT_CHANNELS as readonly string[]).includes(r.channel)) {
      continue;
    }
    for (const c of cells(r)) c.booked[r.channel as PilotChannel] += r.n;
  }
  for (const r of visits) {
    if (!inWindow.has(r.week)) continue;
    for (const c of cells(r)) {
      c.noShow += r.noShow;
      c.held += r.held;
      c.unmarked += r.unmarked;
    }
  }
  for (const r of waits) {
    if (!inWindow.has(r.week)) continue;
    for (const c of cells(r)) {
      c.toCheckIn.push(...r.toCheckIn);
      c.toSeen.push(...r.toSeen);
    }
  }

  const out = new Map<string, PilotHospital>();
  const series = (m: Map<string, Cell>) => weeks.map((w) => toWeek(w, m.get(w) ?? emptyCell()));
  for (const [hospitalId, h] of acc) {
    out.set(hospitalId, {
      hospitalId,
      weeks: series(h.total),
      lines: Array.from(h.lines.values())
        .map((l) => ({ lineId: l.id, lineName: l.name, weeks: series(l.cells) }))
        // Named lines A→Z, the unlined bookings last.
        .sort((a, b) =>
          a.lineName === null ? 1 : b.lineName === null ? -1 : a.lineName.localeCompare(b.lineName),
        ),
    });
  }
  return out;
}

/* ─── the reads ──────────────────────────────────────────────────── */

const num = (v: unknown) => Number(v) || 0;
/** postgres-js hands int[] back parsed; a text "{1,2}" is read the same. */
const nums = (v: unknown): number[] =>
  (Array.isArray(v)
    ? v
    : String(v ?? "")
        .replace(/[{}]/g, "")
        .split(",")
        .filter(Boolean)
  ).map(Number);

/** A literal, so the select and the GROUP BY are the same SQL text. */
const TZ = sql.raw(`'${DEFAULT_TIME_ZONE}'`);
const weekOf = (col: typeof appointments.createdAt | typeof appointments.startsAt) =>
  sql<string>`to_char(date_trunc('week', ${col} at time zone ${TZ}), 'YYYY-MM-DD')`;

const minutes = (later: unknown, earlier: unknown) =>
  sql`round(extract(epoch from (${later} - ${earlier})) / 60)::int`;

/**
 * Every hospital (the superadmin rollup) or one (its own reports page),
 * over the last PILOT_WEEKS local weeks.
 */
export async function fetchPilotWeeks(
  hospitalId?: string,
  now = new Date(),
): Promise<{ weeks: string[]; hospitals: Map<string, PilotHospital> }> {
  const { from, weeks } = pilotWeeks(now);
  const nowIso = now.toISOString();
  const forHospital = hospitalId ? eq(appointments.hospitalId, hospitalId) : undefined;
  const createdWeek = weekOf(appointments.createdAt);
  const visitWeek = weekOf(appointments.startsAt);
  const ended = sql`${appointments.endsAt} <= ${nowIso}`;
  const held = inArray(appointments.status, [...HELD_PAST_STATUSES]);
  const booked = sql`coalesce(${appointments.arrivalWindowStart}, ${appointments.startsAt})`;

  const [bookings, visits, waits] = await Promise.all([
    db
      .select({
        hospitalId: appointments.hospitalId,
        lineId: serviceLines.id,
        lineName: serviceLines.name,
        week: createdWeek,
        channel: appointments.channel,
        n: sql<string>`count(*)`,
      })
      .from(appointments)
      .leftJoin(clinicSessions, eq(clinicSessions.id, appointments.sessionId))
      .leftJoin(serviceLines, eq(serviceLines.id, clinicSessions.serviceLineId))
      .where(
        and(
          forHospital,
          gte(appointments.createdAt, from),
          ne(appointments.status, "void"),
          ne(appointments.channel, "system"),
          isNull(appointments.rescheduledFromAppointmentId),
        ),
      )
      .groupBy(
        appointments.hospitalId,
        serviceLines.id,
        serviceLines.name,
        createdWeek,
        appointments.channel,
      ),
    db
      .select({
        hospitalId: appointments.hospitalId,
        lineId: serviceLines.id,
        lineName: serviceLines.name,
        week: visitWeek,
        noShow: sql<string>`count(*) filter (where ${appointments.status} = 'no_show' and ${ended})`,
        held: sql<string>`count(*) filter (where ${held} and ${ended})`,
        unmarked: sql<string>`count(*) filter (where ${appointments.status} = 'confirmed' and ${ended})`,
      })
      .from(appointments)
      .leftJoin(clinicSessions, eq(clinicSessions.id, appointments.sessionId))
      .leftJoin(serviceLines, eq(serviceLines.id, clinicSessions.serviceLineId))
      .where(and(forHospital, gte(appointments.startsAt, from), lt(appointments.startsAt, now)))
      .groupBy(appointments.hospitalId, serviceLines.id, serviceLines.name, visitWeek),
    db
      .select({
        hospitalId: appointments.hospitalId,
        lineId: serviceLines.id,
        lineName: serviceLines.name,
        week: visitWeek,
        toCheckIn: sql<unknown>`array_agg(${minutes(queueEntries.arrivedAt, booked)})`,
        toSeen: sql<unknown>`array_agg(${minutes(queueEntries.calledAt, queueEntries.arrivedAt)}) filter (where ${queueEntries.calledAt} is not null)`,
      })
      .from(queueEntries)
      .innerJoin(appointments, eq(appointments.id, queueEntries.appointmentId))
      .leftJoin(clinicSessions, eq(clinicSessions.id, appointments.sessionId))
      .leftJoin(serviceLines, eq(serviceLines.id, clinicSessions.serviceLineId))
      .where(and(forHospital, gte(appointments.startsAt, from), lt(appointments.startsAt, now)))
      .groupBy(appointments.hospitalId, serviceLines.id, serviceLines.name, visitWeek),
  ]);

  return {
    weeks,
    hospitals: assemblePilot(
      weeks,
      bookings.map((r) => ({ ...r, n: num(r.n) })),
      visits.map((r) => ({
        ...r,
        noShow: num(r.noShow),
        held: num(r.held),
        unmarked: num(r.unmarked),
      })),
      waits.map((r) => ({ ...r, toCheckIn: nums(r.toCheckIn), toSeen: nums(r.toSeen) })),
    ),
  };
}
