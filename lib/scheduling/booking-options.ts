import "server-only";

import type {
  ClinicianOption,
  ElsewhereOption,
  LineOption,
  SessionOption,
  SlotOffer,
} from "@/app/patient/book/_lib/booking";
import type { CapacityMode } from "@/db/schema/service-lines";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";

import { DAY_MS, firstOpenDay, windowEndMs } from "@/app/patient/book/_lib/booking";
import { db } from "@/db";
import { clinicSessions } from "@/db/schema/clinic-sessions";
import { staffAffiliations } from "@/db/schema/clinician-profiles";
import { hospitalDepartments } from "@/db/schema/hospital-departments";
import { hospitals } from "@/db/schema/hospitals";
import { cadres } from "@/db/schema/reference-data";
import {
  appointments,
  availabilityBlocks,
  clinicianSchedulingSettings,
  departmentSchedulingPolicy,
} from "@/db/schema/scheduling";
import { serviceLines } from "@/db/schema/service-lines";
import { users } from "@/db/schema/users";
import { ts } from "@/lib/intake/queries";
import {
  buildSlots,
  DEFAULT_TIME_ZONE,
  LIVE_APPOINTMENT_STATUSES,
  localDateKey,
  resolveSchedulingSettings,
} from "@/supabase/functions/_shared/slots";

/**
 * What a booker can pick at a hospital — one read shared by `/patient/book`
 * (the patient, for themself or a household member) and `/reception/book`
 * (the desk, on behalf of a caller). Lifted out of the patient page for
 * Gate D so the desk does not grow a second copy of the slot derivation.
 *
 * ADR 0084 §8. A rule, never a promise: nothing on either screen says "the
 * next two weeks", because the days a booker can actually see are the
 * covering clinician's open days, which are usually far fewer.
 */
export const LOOKAHEAD_DAYS = 14;

/** A visit that happened — the basis for "Seen you before" (PRD §2.7). */
const ATTENDED = ["arrived", "in_progress", "completed"] as const;

/* ─── Data fetch ──────────────────────────────────────────────────── */

/**
 * Every active service line at the hospital, each carrying what a patient
 * can pick inside it: the department's bookable clinicians with their open
 * slots (slot mode), the line's published clinic days (session mode), or
 * nothing but the door (open queue) — plus, for PRD §2.4, the other
 * hospitals running a line of the same name with something open inside this
 * line's window.
 *
 * ponytail: the whole hospital ships on first paint, as before; the wizard
 * stays a pure renderer with no round trip per pick (§2 prices a chatty flow
 * in shillings). Ceiling: a Mulago-sized roster. Upgrade path: ship the
 * chosen line's options and fetch the rest on demand — `buildSlots` is
 * already called per (clinician, department) pair, so only the fan-out moves.
 */
export async function fetchLines(
  hospitalId: string,
  /** Null when there is no account to read continuity for (a provisional caller). */
  patientUserId: string | null,
  now: Date,
  /**
   * 0080 (§5.5): patient-facing callers see only clinics patients book directly; the Desk
   * (reception) books every audience. Defaults to the patient view so a new caller is safe.
   */
  forPatients = true,
): Promise<LineOption[]> {
  const until = new Date(now.getTime() + LOOKAHEAD_DAYS * DAY_MS);

  const lineRows = await db
    .select({
      id: serviceLines.id,
      name: serviceLines.name,
      capacityMode: serviceLines.capacityMode,
      confidential: serviceLines.confidential,
      reasonCodes: serviceLines.reasonCodes,
      timeToCareDays: serviceLines.timeToCareDays,
      departmentId: serviceLines.departmentId,
      departmentName: hospitalDepartments.name,
    })
    .from(serviceLines)
    .innerJoin(hospitalDepartments, eq(hospitalDepartments.id, serviceLines.departmentId))
    .where(
      and(
        eq(serviceLines.hospitalId, hospitalId),
        eq(serviceLines.active, true),
        // D-SVC-02: a clinic is bookable only while its department is live and not archived.
        sql`${hospitalDepartments.medsyncLiveAt} IS NOT NULL`,
        sql`${hospitalDepartments.archivedAt} IS NULL`,
        forPatients ? eq(serviceLines.audience, "patients") : undefined,
      ),
    )
    .orderBy(asc(hospitalDepartments.name), asc(serviceLines.name));
  if (lineRows.length === 0) return [];

  const sessionLineIds = lineRows.filter((l) => l.capacityMode === "session").map((l) => l.id);
  const slotDepartmentIds = Array.from(
    new Set(lineRows.filter((l) => l.capacityMode === "slot").map((l) => l.departmentId)),
  );

  const [clinicians, sessions, elsewhere] = await Promise.all([
    fetchBookableClinicians(hospitalId, patientUserId, slotDepartmentIds, now, until),
    fetchSessions(sessionLineIds, now, until),
    fetchElsewhere(
      hospitalId,
      lineRows.map((l) => ({ name: l.name, timeToCareDays: l.timeToCareDays })),
      now,
      until,
    ),
  ]);

  return lineRows.map((l) => ({
    id: l.id,
    name: l.name,
    capacityMode: l.capacityMode as CapacityMode,
    confidential: l.confidential,
    reasonCodes: l.reasonCodes,
    timeToCareDays: l.timeToCareDays,
    departmentId: l.departmentId,
    departmentName: l.departmentName,
    clinicians: l.capacityMode === "slot" ? (clinicians.get(l.departmentId) ?? []) : [],
    sessions: l.capacityMode === "session" ? (sessions.get(l.id) ?? []) : [],
    elsewhere: elsewhere.get(l.name.toLowerCase()) ?? [],
  }));
}

/**
 * The slot engine's read, unchanged in what it derives: `buildSlots` over the
 * same blocks and live appointments `pt-request-appointment` checks with.
 * What changed for Gate C is what it keeps — every slot, not the first per
 * day-part (ADR 0085 §3) — and the continuity mark (PRD §2.7).
 */
async function fetchBookableClinicians(
  hospitalId: string,
  patientUserId: string | null,
  departmentIds: string[],
  now: Date,
  until: Date,
): Promise<Map<string, ClinicianOption[]>> {
  const out = new Map<string, ClinicianOption[]>();
  if (departmentIds.length === 0) return out;

  // 1. Active CLINICAL affiliations in the slot-mode departments — the
  //    bookable set. The cadres join keeps reception, lab and pharmacy out.
  const affiliations = await db
    .select({
      userId: staffAffiliations.userId,
      departmentId: staffAffiliations.departmentId,
      fullName: users.fullName,
    })
    .from(staffAffiliations)
    .innerJoin(users, eq(users.id, staffAffiliations.userId))
    .innerJoin(cadres, eq(cadres.id, staffAffiliations.cadreId))
    .where(
      and(
        eq(staffAffiliations.hospitalId, hospitalId),
        inArray(staffAffiliations.departmentId, departmentIds),
        inArray(staffAffiliations.state, ["active", "approved"]),
        eq(cadres.isClinical, true),
      ),
    )
    .orderBy(asc(users.fullName));
  if (affiliations.length === 0) return out;

  const clinicianIds = Array.from(new Set(affiliations.map((a) => a.userId)));

  // 2-6. Independent of each other, all scoped by step 1's ids.
  const [settings, deptPolicies, blocks, liveAppts, attended] = await Promise.all([
    db
      .select()
      .from(clinicianSchedulingSettings)
      .where(
        and(
          eq(clinicianSchedulingSettings.hospitalId, hospitalId),
          inArray(clinicianSchedulingSettings.clinicianUserId, clinicianIds),
        ),
      ),
    db
      .select()
      .from(departmentSchedulingPolicy)
      .where(inArray(departmentSchedulingPolicy.departmentId, departmentIds)),
    db
      .select()
      .from(availabilityBlocks)
      .where(
        and(
          eq(availabilityBlocks.hospitalId, hospitalId),
          // No kind filter, matching `pt-request-appointment`: the engine
          // owns "bookable" and needs the blocking kinds to subtract.
          eq(availabilityBlocks.state, "active"),
          inArray(availabilityBlocks.clinicianUserId, clinicianIds),
          or(
            and(gte(availabilityBlocks.endsAt, now), lt(availabilityBlocks.startsAt, until)),
            // A weekly block's own starts_at is the template — often months
            // back. Window it on the recurrence instead.
            and(
              eq(availabilityBlocks.recurrence, "weekly"),
              or(
                isNull(availabilityBlocks.recurrenceUntil),
                gte(availabilityBlocks.recurrenceUntil, now),
              ),
            ),
          ),
        ),
      ),
    db
      .select({
        clinicianUserId: appointments.clinicianUserId,
        startsAt: appointments.startsAt,
        endsAt: appointments.endsAt,
      })
      .from(appointments)
      .where(
        and(
          // NOT scoped to the hospital: a clinician booked at their other
          // hospital is still one person, and the write path subtracts them.
          inArray(appointments.clinicianUserId, clinicianIds),
          inArray(appointments.status, [...LIVE_APPOINTMENT_STATUSES]),
          gte(appointments.endsAt, now),
          lt(appointments.startsAt, until),
        ),
      ),
    // PRD §2.7 — who last saw this patient, per department. Newest first,
    // so the first row per department wins below. No account, no history.
    patientUserId
      ? db
          .select({
            clinicianUserId: appointments.clinicianUserId,
            departmentId: appointments.departmentId,
          })
          .from(appointments)
          .where(
            and(
              eq(appointments.patientUserId, patientUserId),
              eq(appointments.hospitalId, hospitalId),
              inArray(appointments.departmentId, departmentIds),
              inArray(appointments.status, [...ATTENDED]),
            ),
          )
          .orderBy(desc(appointments.startsAt))
          .limit(50)
      : Promise.resolve([]),
  ]);

  const settingsByClinician = new Map(settings.map((s) => [s.clinicianUserId, s]));
  const policyByDepartment = new Map(deptPolicies.map((d) => [d.departmentId, d]));
  const blocksByClinician = groupBy(blocks, (b) => b.clinicianUserId);
  const apptsByClinician = groupBy(liveAppts, (a) => a.clinicianUserId);
  const lastSeenByDepartment = new Map<string, string>();
  for (const a of attended) {
    if (!lastSeenByDepartment.has(a.departmentId)) {
      lastSeenByDepartment.set(a.departmentId, a.clinicianUserId);
    }
  }

  // 7. Derive. One option per (clinician, department) pair, judged against
  //    that department's policy.
  for (const a of affiliations) {
    const clinicianSettings = settingsByClinician.get(a.userId) ?? null;
    const departmentPolicy = policyByDepartment.get(a.departmentId) ?? null;
    const slots = buildSlots({
      blocks: (blocksByClinician.get(a.userId) ?? []).filter(
        (b) => b.departmentId === null || b.departmentId === a.departmentId,
      ),
      appointments: apptsByClinician.get(a.userId) ?? [],
      clinicianSettings,
      departmentPolicy,
      timeZone: DEFAULT_TIME_ZONE,
      now,
      rangeStart: now,
      rangeEnd: until,
    });

    const slotsByDate: Record<string, SlotOffer[]> = {};
    for (const slot of slots) {
      (slotsByDate[localDateKey(slot.startsAt, DEFAULT_TIME_ZONE)] ??= []).push({
        startsAtIso: slot.startsAt.toISOString(),
        endsAtIso: slot.endsAt.toISOString(),
      });
    }

    const list = out.get(a.departmentId) ?? [];
    list.push({
      userId: a.userId,
      fullName: a.fullName ?? "Your clinician",
      // The clinician's OWN row, not the resolved chain — the write path
      // reads `settings?.auto_confirm` alone, and this flag becomes a
      // promise on the check step. Under-promising is the safe direction.
      autoConfirm: clinicianSettings?.autoConfirm ?? false,
      allowVirtual: resolveSchedulingSettings(clinicianSettings, departmentPolicy).allowVirtual,
      seenBefore: lastSeenByDepartment.get(a.departmentId) === a.userId,
      slotsByDate,
    });
    out.set(a.departmentId, list);
  }

  // Continuity first (PRD §2.7), then whoever has a day soonest, then the
  // query's name order — so a reload lands on the same person.
  for (const list of out.values()) {
    list.sort(
      (x, y) =>
        Number(y.seenBefore) - Number(x.seenBefore) ||
        (firstOpenDay(x) ?? "9").localeCompare(firstOpenDay(y) ?? "9"),
    );
  }
  return out;
}

/** Published clinic days in the window, with the places the allocator would still grant. */
async function fetchSessions(
  lineIds: string[],
  now: Date,
  until: Date,
): Promise<Map<string, SessionOption[]>> {
  const out = new Map<string, SessionOption[]>();
  if (lineIds.length === 0) return out;

  const rows = await db
    .select({
      id: clinicSessions.id,
      serviceLineId: clinicSessions.serviceLineId,
      startsAt: clinicSessions.startsAt,
      endsAt: clinicSessions.endsAt,
      clinicianUserId: clinicSessions.clinicianUserId,
      clinicianName: users.fullName,
      venue: clinicSessions.venue,
      // The allocator's own guard, restated (ADR 0087): what it will admit.
      placesLeft: sql<number>`greatest(ceil(${clinicSessions.capacityBooked} * ${clinicSessions.overbookingFactor}) - ${clinicSessions.bookedCount}, 0)::int`,
    })
    .from(clinicSessions)
    .leftJoin(users, eq(users.id, clinicSessions.clinicianUserId))
    .where(
      and(
        inArray(clinicSessions.serviceLineId, lineIds),
        eq(clinicSessions.status, "published"),
        gt(clinicSessions.startsAt, now),
        lt(clinicSessions.startsAt, until),
      ),
    )
    .orderBy(asc(clinicSessions.startsAt));

  for (const r of rows) {
    const list = out.get(r.serviceLineId) ?? [];
    list.push({
      id: r.id,
      startsAtIso: r.startsAt.toISOString(),
      endsAtIso: r.endsAt.toISOString(),
      clinicianUserId: r.clinicianUserId,
      clinicianName: r.clinicianName,
      venue: r.venue,
      placesLeft: r.placesLeft,
    });
    out.set(r.serviceLineId, list);
  }
  return out;
}

/**
 * PRD §2.4 option 2: the same-named line at another active hospital with
 * something open inside OUR line's window — a published clinic day with a
 * place, or a bookable block. Keyed by lower-cased line name.
 *
 * ponytail: a bookable block is "declared open time", not a derived slot —
 * running the engine for every other hospital's roster is the upgrade path,
 * and this can over-promise by one fully booked clinic, never invent one.
 */
async function fetchElsewhere(
  hospitalId: string,
  lines: ReadonlyArray<{ name: string; timeToCareDays: number }>,
  now: Date,
  until: Date,
): Promise<Map<string, ElsewhereOption[]>> {
  const out = new Map<string, ElsewhereOption[]>();
  if (lines.length === 0) return out;
  const names = Array.from(new Set(lines.map((l) => l.name.toLowerCase())));

  // Dates inside raw `sql` go through ts(): postgres.js refuses a bare Date there (lib/intake/queries.ts).
  const rows = await db
    .select({
      name: sql<string>`lower(${serviceLines.name})`,
      hospitalId: hospitals.id,
      hospitalName: hospitals.name,
      region: hospitals.region,
      soonestSession: sql<Date | null>`(
        select min(${clinicSessions.startsAt}) from ${clinicSessions}
        where ${clinicSessions.serviceLineId} = ${serviceLines.id}
          and ${clinicSessions.status} = 'published'
          and ${clinicSessions.startsAt} > ${ts(now)}
          and ${clinicSessions.startsAt} < ${ts(until)}
          and ${clinicSessions.bookedCount} < ceil(${clinicSessions.capacityBooked} * ${clinicSessions.overbookingFactor})
      )`,
      soonestBlock: sql<Date | null>`(
        select min(greatest(${availabilityBlocks.startsAt}, ${ts(now)})) from ${availabilityBlocks}
        where ${availabilityBlocks.hospitalId} = ${hospitals.id}
          and (${availabilityBlocks.departmentId} = ${serviceLines.departmentId} or ${availabilityBlocks.departmentId} is null)
          and ${availabilityBlocks.kind} = 'bookable'
          and ${availabilityBlocks.state} = 'active'
          and ((${availabilityBlocks.endsAt} >= ${ts(now)} and ${availabilityBlocks.startsAt} < ${ts(until)})
            or (${availabilityBlocks.recurrence} = 'weekly'
              and (${availabilityBlocks.recurrenceUntil} is null or ${availabilityBlocks.recurrenceUntil} >= ${ts(now)})))
      )`,
    })
    .from(serviceLines)
    .innerJoin(hospitals, eq(hospitals.id, serviceLines.hospitalId))
    .where(
      and(
        ne(serviceLines.hospitalId, hospitalId),
        eq(serviceLines.active, true),
        eq(hospitals.state, "active"),
        inArray(sql`lower(${serviceLines.name})`, names),
      ),
    )
    .orderBy(asc(hospitals.name));

  for (const line of lines) {
    const key = line.name.toLowerCase();
    if (out.has(key)) continue;
    const endMs = windowEndMs(now.getTime(), line.timeToCareDays);
    const within = (d: Date | string | null) => d !== null && new Date(d).getTime() <= endMs;
    out.set(
      key,
      rows
        .filter((r) => r.name === key && (within(r.soonestSession) || within(r.soonestBlock)))
        .map((r) => ({ hospitalId: r.hospitalId, hospitalName: r.hospitalName, region: r.region })),
    );
  }
  return out;
}

function groupBy<T>(rows: ReadonlyArray<T>, key: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const list = grouped.get(key(row));
    if (list) list.push(row);
    else grouped.set(key(row), [row]);
  }
  return grouped;
}
