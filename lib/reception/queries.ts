import "server-only";

import type { PatientIdentity } from "@/components/medsync/patient-identity";
import { and, asc, count, desc, eq, gte, ilike, inArray, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { clinicalPhiAccessLog } from "@/db/schema/doctor-workspace";
import { hospitalDepartments } from "@/db/schema/hospital-departments";
import { hospitals } from "@/db/schema/hospitals";
import { entryTypes, patientIntakes, priorityHintRank } from "@/db/schema/patient-intakes";
import { patientProfiles } from "@/db/schema/patient-profiles";
import { provisionalPatients } from "@/db/schema/provisional-patients";
import { appointments, encounters, queueEntries } from "@/db/schema/scheduling";
import { users } from "@/db/schema/users";
import { computeAgeYears } from "@/lib/age";
import { signedAvatarUrl } from "@/lib/avatars";
import { decrypt } from "@/lib/encryption";
import { declaredLast, presenceAt, presenceOf, ts } from "@/lib/intake/queries";
import { logger } from "@/lib/logger";
import { appointmentBookedVia, byBookedAt, intakeBookedVia } from "@/lib/reception/booked-via";
import { maskPhone, matchBasis } from "@/lib/reception/reconcile-basis";
import {
  DEFAULT_TIME_ZONE,
  endOfLocalDay,
  localDateKey,
  startOfLocalDay,
} from "@/supabase/functions/_shared/slots";
import { complaintLine } from "@/supabase/functions/_shared/symptoms";

/**
 * Reception query layer. All reads are STRICTLY operational +
 * demographic — no clinical-content joins. The clinical-content RLS
 * widening in migration 0033 enforces the same boundary at the DB,
 * so even if these helpers grew a buggy join the DB would deny it.
 *
 * Patient names ARE revealed here, narrowly and audited — see the
 * operational name-reveal block below. Everything else stays
 * `patient_code`.
 */

/* ─── Audited operational name reveal (ADR 0084 §11) ────────────── */

/**
 * A patient who declared from home walks up to the desk and says their name.
 * The clerk holds a `patient_code` that exists only on the patient's phone —
 * which may be a relative's, at home, or flat. Unable to match the row, the
 * clerk registers a fresh walk-in: the declared row becomes a ghost and the
 * patient is counted, queued and later clerked twice under two identities.
 *
 * So reception gets names. The scope is drawn as tightly as the job allows:
 *
 *   WHAT — first name + surname, and nothing else. ADR 0032 §2 already grants
 *   reception `patient_code`, `sex` and `date_of_birth` (plaintext columns);
 *   the encrypted set is name, phone, ID number, village address and
 *   next-of-kin. Only the name is needed to match a person who is standing in
 *   front of you, so only the name opens. Phone and address would serve
 *   chasing a no-show, which is not a thing this product does yet, and would
 *   be a larger reveal than the task justifies.
 *
 *   WHO — rows that are already on TODAY'S BOARD at the caller's own
 *   hospital. This is enforced structurally, by the WHERE clause of the query
 *   that loads the rows, not by a separate permission check a later caller
 *   could forget or race: there is no code path here that can name a patient
 *   who is not on the board. Deliberately NOT a hospital-wide
 *   patient-search-by-name.
 *
 *   WHY it is not clinical — reception is a non-clinical cadre (ADR 0032) and
 *   the basis is operational: matching a person to a queue ticket at a desk.
 *   It carries no clinical content and grants none; the RLS widening in
 *   migration 0033 still denies reception every clinical-content table.
 *
 * Every revealed name writes one `clinical_phi_access_log` row, and the
 * reveal FAILS CLOSED if that write fails — the doctor path's contract
 * (`fetchPatientSummaryAudited`), not the triage worklist's best-effort one.
 * Triage may proceed unaudited because blocking a nurse's queue is itself a
 * clinical risk; a front-desk lookup has no such claim, and this is the only
 * record that a non-clinical actor read PHI.
 */

/**
 * ponytail: reception's honest basis is "on this hospital's board today", but
 * `phi_access_basis_check` only permits the four clinical values, so we map
 * onto the nearest and carry the true basis in `surface` — exactly as
 * lib/nurse/patient-access.ts maps its four nursing bases onto two enum
 * values. CEILING: an audit query filtering on `access_basis` alone cannot
 * tell a front-desk name match from a clinician's department read; it has to
 * match `surface LIKE '%#operational_today'`. UPGRADE PATH: additive
 * migration widening the CHECK with 'operational_today', write it directly,
 * backfill from `surface`.
 */
const OPERATIONAL_BASIS_SUFFIX = "#operational_today";

/** Decrypt "First Surname". Null when the patient is unidentified or the
 * payload/key is unusable — never throws into a front-desk page. */
function decryptName(first: string | null, surname: string | null): string | null {
  if (!first || !surname) return null;
  try {
    return `${decrypt(first)} ${decrypt(surname)}`.trim();
  } catch (e) {
    logger.warn("reception.name_reveal.decrypt_failed", { reason: String(e) });
    return null;
  }
}

/** Decrypt one column, or null when the payload/key is unusable. */
function decryptOrNull(payload: string | null): string | null {
  if (!payload) return null;
  try {
    return decrypt(payload);
  } catch (e) {
    logger.warn("reception.decrypt_failed", { reason: String(e) });
    return null;
  }
}

/** One append-only log row per patient named. Returns false if the audit
 * could not be written, in which case the caller MUST withhold the names. */
async function auditNameReveals(args: {
  hospitalId: string;
  receptionUserId: string;
  surface: string;
  patientUserIds: ReadonlyArray<string>;
}): Promise<boolean> {
  const unique = [...new Set(args.patientUserIds)];
  if (unique.length === 0) return true;
  try {
    await db.insert(clinicalPhiAccessLog).values(
      unique.map((patientUserId) => ({
        hospitalId: args.hospitalId,
        clinicianUserId: args.receptionUserId,
        patientUserId,
        accessBasis: "department_recent" as const,
        surface: `${args.surface}${OPERATIONAL_BASIS_SUFFIX}`,
      })),
    );
    return true;
  } catch (e) {
    logger.error("reception.name_reveal.audit_failed", {
      reason: String(e),
      surface: args.surface,
      count: unique.length,
    });
    return false;
  }
}

/**
 * A signed URL per DISTINCT storage path — one Storage call per photo, not
 * per row. A photo is PHI like the name (ADR 0095): callers sign only after
 * the reveal is audited, so a failed audit leaves `photoUrl` null too.
 */
async function signAvatars(
  paths: ReadonlyArray<string | null>,
): Promise<Map<string, string | null>> {
  const unique = [...new Set(paths.filter((p): p is string => !!p))];
  const urls = await Promise.all(unique.map((p) => signedAvatarUrl(p)));
  return new Map(unique.map((p, i) => [p, urls[i] ?? null]));
}

/* ─── Today's front-desk counts ─────────────────────────────────── */

export interface ReceptionTodayCounts {
  expectedToday: number;
  arrivedToday: number;
  awaitingTriage: number;
  noShowsToday: number;
  /** Patient-declared intakes that haven't been checked in yet
   * (status='declared', book-or-queue migration 0035). Reception's
   * cue that someone said "I'm coming today" but isn't here yet. */
  declaredToday: number;
}

export async function fetchReceptionTodayCounts(args: {
  hospitalId: string;
}): Promise<ReceptionTodayCounts> {
  // The hospital's day, not the host's (UTC on Vercel — 03:00 EAT).
  const now = new Date();
  const start = startOfLocalDay(now, DEFAULT_TIME_ZONE);
  const end = endOfLocalDay(now, DEFAULT_TIME_ZONE);

  const [expected, arrived, awaiting, noShows, declared] = await Promise.all([
    db
      .select({ n: count() })
      .from(appointments)
      .where(
        and(
          eq(appointments.hospitalId, args.hospitalId),
          gte(appointments.startsAt, start),
          lt(appointments.startsAt, end),
          inArray(appointments.status, ["confirmed", "pending_approval", "requested"]),
        ),
      ),
    db
      .select({ n: count() })
      .from(appointments)
      .where(
        and(
          eq(appointments.hospitalId, args.hospitalId),
          gte(appointments.startsAt, start),
          lt(appointments.startsAt, end),
          inArray(appointments.status, ["arrived", "in_progress", "completed"]),
        ),
      ),
    db
      .select({ n: count() })
      .from(patientIntakes)
      .where(
        and(
          eq(patientIntakes.hospitalId, args.hospitalId),
          inArray(patientIntakes.status, ["arrived", "awaiting_triage"]),
          // A clinic-routed arrival is 'arrived' too, but is not waiting for
          // triage and never will be (ADR 0101); NULL is legacy, i.e. triage.
          sql`${patientIntakes.routedTo} is distinct from 'clinic'`,
          // Windowed on presence like every sibling count in this function.
          // Unbounded, one intake that never progressed past awaiting_triage
          // inflated "Awaiting triage" under the "Today counts" heading
          // forever — a number the database could not prove was today's.
          gte(presenceAt, ts(start)),
          lt(presenceAt, ts(end)),
        ),
      ),
    db
      .select({ n: count() })
      .from(appointments)
      .where(
        and(
          eq(appointments.hospitalId, args.hospitalId),
          gte(appointments.startsAt, start),
          lt(appointments.startsAt, end),
          eq(appointments.status, "no_show"),
        ),
      ),
    db
      .select({ n: count() })
      .from(patientIntakes)
      .where(
        and(
          eq(patientIntakes.hospitalId, args.hospitalId),
          eq(patientIntakes.status, "declared"),
          gte(patientIntakes.arrivedAt, start),
          lt(patientIntakes.arrivedAt, end),
        ),
      ),
  ]);

  return {
    expectedToday: Number(expected[0]?.n ?? 0),
    arrivedToday: Number(arrived[0]?.n ?? 0),
    awaitingTriage: Number(awaiting[0]?.n ?? 0),
    noShowsToday: Number(noShows[0]?.n ?? 0),
    declaredToday: Number(declared[0]?.n ?? 0),
  };
}

/* ─── Expected arrivals (today, or a chosen date) ───────────────── */

export interface ExpectedArrival {
  id: string;
  startsAtIso: string;
  status: string;
  type: string;
  /** Null for a provisional booking (migration 0060) until the desk confirms who it is for. */
  patientUserId: string | null;
  patientCode: string | null;
  clinicianName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  /** Clinic-day bookings carry a position; slot bookings carry null. */
  positionNumber: number | null;
  /** When the clinic day told the patient to come (ADR 0087); null for a slot booking. */
  arrivalWindowStartIso: string | null;
  /** How it was booked — a label on the Expected list, never its order (ADR 0101). */
  channel: string;
  origin: string;
  /** When it was booked: the Expected list's order. */
  createdAtIso: string;
  /** The patient answered the day-before confirmation (ADR 0090). */
  confirmedByPatient: boolean;
  priority: string;
  /** The six characters on the patient's receipt — what they read out at the desk. */
  bookingCode: string | null;
  /** When the booking's queue row was written, i.e. when they got here; null until then. */
  hereSinceIso: string | null;
  /** An encounter for this booking reached state='completed' — the "Seen" stage. */
  seen: boolean;
  /**
   * The patient card (ADR 0095): the audited name reveal, photo, age, sex and
   * what they said is bothering them. For a provisional booking the title is
   * the declared name (photo null); fail-closed like `displayName` elsewhere.
   */
  identity: PatientIdentity;
  /**
   * Gate D: the booking identity when there is no confirmed account yet.
   * `declaredName` is the audited operational reveal (ADR 0084 §11) — the
   * clerk must match the person at the desk to this row by name.
   */
  provisional: {
    id: string;
    declaredName: string | null;
    state: string;
  } | null;
}

/** An appointment with a completed encounter has been seen. */
const seenSql = sql<boolean>`exists (
  select 1 from ${encounters}
  where ${encounters.appointmentId} = ${appointments.id}
    and ${encounters.state} = 'completed'
)`;

/** The booking's first queue row — its arrival. Keyed on the patient too, for the patient index. */
const hereSinceSql = sql`(
  select min(${queueEntries.arrivedAt}) from ${queueEntries}
  where ${queueEntries.patientUserId} = ${appointments.patientUserId}
    and ${queueEntries.appointmentId} = ${appointments.id}
)`.mapWith(queueEntries.arrivedAt);

/**
 * An in-person booking that is 'arrived' with no intake carrying it: the
 * patient tapped "I have arrived" (ha-mark-arrived), which queues them but
 * sends them nowhere, and the desk has not routed them yet (ADR 0101). Desk
 * check-in always writes the intake, so a checked-in booking never lands here.
 */
const unroutedSql = sql`${appointments.status} = 'arrived'
  and ${appointments.type} <> 'virtual'
  and not exists (
    select 1 from ${patientIntakes}
    where ${patientIntakes.appointmentId} = ${appointments.id}
      and ${patientIntakes.hospitalId} = ${appointments.hospitalId}
  )`;

export async function fetchExpectedArrivals(args: {
  hospitalId: string;
  /** The scoped receptionist — required to audit provisional name reveals. */
  receptionUserId: string;
  date?: Date;
  limit?: number;
  /** What the reveal is audited under; the board by default. */
  surface?: string;
  /** Narrow the day's statuses — the intake pick wants only what check-in accepts. */
  statuses?: string[];
  /** Only arrived bookings nobody has sent on yet (see `unroutedSql`). */
  unrouted?: boolean;
}): Promise<ExpectedArrival[]> {
  const surface = args.surface ?? "reception_expected_list";
  // The hospital's day containing `date` (a `?date=YYYY-MM-DD` parses as
  // UTC midnight = 03:00 EAT, which lands on the right Kampala day).
  const on = args.date ?? new Date();
  const start = startOfLocalDay(on, DEFAULT_TIME_ZONE);
  const end = endOfLocalDay(on, DEFAULT_TIME_ZONE);
  const now = new Date();
  // `users` is already the clinician's row; the patient's photo needs its own.
  const patientUsers = alias(users, "patient_users");

  const rows = await db
    .select({
      id: appointments.id,
      startsAt: appointments.startsAt,
      status: appointments.status,
      type: appointments.type,
      patientUserId: appointments.patientUserId,
      patientCode: patientProfiles.patientCode,
      firstNameEncrypted: patientProfiles.firstNameEncrypted,
      surnameEncrypted: patientProfiles.surnameEncrypted,
      sex: patientProfiles.sex,
      dateOfBirth: patientProfiles.dateOfBirth,
      avatarPath: patientUsers.avatarPath,
      symptoms: appointments.symptoms,
      reasonNote: appointments.reasonNote,
      clinicianName: users.fullName,
      departmentId: appointments.departmentId,
      departmentName: hospitalDepartments.name,
      positionNumber: appointments.positionNumber,
      arrivalWindowStart: appointments.arrivalWindowStart,
      channel: appointments.channel,
      origin: appointments.origin,
      createdAt: appointments.createdAt,
      confirmedByPatientAt: appointments.confirmedByPatientAt,
      priority: appointments.priority,
      bookingCode: appointments.bookingCode,
      hereSince: hereSinceSql,
      seen: seenSql,
      provisionalId: provisionalPatients.id,
      provisionalNameEncrypted: provisionalPatients.declaredNameEncrypted,
      provisionalState: provisionalPatients.reconciliationState,
      provisionalDateOfBirth: provisionalPatients.dateOfBirth,
      provisionalAgeYears: provisionalPatients.ageYears,
    })
    .from(appointments)
    // LEFT: a provisional booking has no profile until it is reconciled.
    .leftJoin(patientProfiles, eq(patientProfiles.id, appointments.patientUserId))
    .leftJoin(patientUsers, eq(patientUsers.id, appointments.patientUserId))
    .leftJoin(provisionalPatients, eq(provisionalPatients.id, appointments.provisionalPatientId))
    .leftJoin(users, eq(users.id, appointments.clinicianUserId))
    .leftJoin(hospitalDepartments, eq(hospitalDepartments.id, appointments.departmentId))
    .where(
      and(
        eq(appointments.hospitalId, args.hospitalId),
        gte(appointments.startsAt, start),
        lt(appointments.startsAt, end),
        inArray(
          appointments.status,
          args.statuses ?? [
            "confirmed",
            "pending_approval",
            "requested",
            "arrived",
            "in_progress",
            "completed",
            "no_show",
          ],
        ),
        args.unrouted ? unroutedSql : undefined,
      ),
    )
    // A clinic day's bookings share a start, so the position the patient was
    // given orders them; booking time settles anything left (a stable board
    // between polls). Slot bookings have no position and follow.
    .orderBy(
      asc(appointments.startsAt),
      sql`${appointments.positionNumber} asc nulls last`,
      asc(appointments.createdAt),
    )
    .limit(args.limit ?? 100);

  const out: ExpectedArrival[] = rows.map((r) => {
    // Only while the booking still has no patient: once confirmed the
    // code is the identifier, and the declared name need not be shown.
    const declaredName = r.patientUserId ? null : decryptOrNull(r.provisionalNameEncrypted);
    return {
      id: r.id,
      startsAtIso: r.startsAt.toISOString(),
      status: r.status,
      type: r.type,
      patientUserId: r.patientUserId,
      patientCode: r.patientCode,
      clinicianName: r.clinicianName,
      departmentId: r.departmentId,
      departmentName: r.departmentName,
      positionNumber: r.positionNumber,
      arrivalWindowStartIso: r.arrivalWindowStart?.toISOString() ?? null,
      channel: r.channel,
      origin: r.origin,
      createdAtIso: r.createdAt.toISOString(),
      confirmedByPatient: r.confirmedByPatientAt !== null,
      priority: r.priority,
      bookingCode: r.bookingCode,
      hereSinceIso: r.hereSince?.toISOString() ?? null,
      seen: r.seen,
      identity: {
        patientCode: r.patientCode,
        displayName: r.patientUserId
          ? decryptName(r.firstNameEncrypted, r.surnameEncrypted)
          : declaredName,
        // Signed below, only once the reveal is audited.
        photoUrl: null,
        ageYears: r.patientUserId
          ? computeAgeYears(r.dateOfBirth, now)
          : (computeAgeYears(r.provisionalDateOfBirth, now) ?? r.provisionalAgeYears),
        sex: r.patientUserId ? r.sex : null,
        complaint: complaintLine(r.symptoms, r.reasonNote),
      },
      provisional: r.provisionalId
        ? { id: r.provisionalId, declaredName, state: r.provisionalState ?? "unreconciled" }
        : null,
    };
  });

  // The profile reveals — name or photo — through the same audited path as
  // the declared list, one row per patient. Fail closed: no audit, no PHI.
  const revealedPatients = rows.filter(
    (r, i) => r.patientUserId && (out[i]!.identity.displayName || r.avatarPath),
  );
  const audited = await auditNameReveals({
    hospitalId: args.hospitalId,
    receptionUserId: args.receptionUserId,
    surface,
    patientUserIds: revealedPatients.map((r) => r.patientUserId!),
  });
  if (audited) {
    const urls = await signAvatars(rows.map((r) => r.avatarPath));
    rows.forEach((r, i) => {
      if (r.avatarPath) out[i]!.identity.photoUrl = urls.get(r.avatarPath) ?? null;
    });
  } else {
    for (const r of out) if (r.patientUserId) r.identity.displayName = null;
  }

  // A provisional row has no patient_user_id to audit against, so the reveal
  // is logged against the provisional id in `surface` — one row per name.
  const revealed = out.filter((r) => r.provisional?.declaredName);
  if (revealed.length > 0) {
    const provisionalAudited = await auditProvisionalReveals({
      hospitalId: args.hospitalId,
      receptionUserId: args.receptionUserId,
      surface,
      provisionalIds: revealed.map((r) => r.provisional!.id),
    });
    if (!provisionalAudited) {
      for (const r of out) {
        if (r.provisional) r.provisional.declaredName = null;
        if (!r.patientUserId) r.identity.displayName = null;
      }
    }
  }
  return out;
}

/**
 * The provisional twin of `auditNameReveals`. `clinical_phi_access_log`
 * requires a patient_user_id and a provisional has none, so the record goes
 * to the application log — a structured line per reveal, fail-closed like
 * the profile path. UPGRADE PATH: a `provisional_patient_id` column on the
 * access log (additive migration) once Gate H settles the audit shape.
 */
async function auditProvisionalReveals(args: {
  hospitalId: string;
  receptionUserId: string;
  surface: string;
  provisionalIds: ReadonlyArray<string>;
}): Promise<boolean> {
  try {
    for (const provisionalId of new Set(args.provisionalIds)) {
      logger.info("reception.provisional_name_reveal", {
        hospital_id: args.hospitalId,
        reception_user_id: args.receptionUserId,
        surface: `${args.surface}${OPERATIONAL_BASIS_SUFFIX}`,
        provisional_patient_id: provisionalId,
      });
    }
    return true;
  } catch (e) {
    logger.error("reception.provisional_name_reveal.audit_failed", { reason: String(e) });
    return false;
  }
}

/* ─── The week strip: counts per hospital-local day ──────────────── */

export interface ExpectedDayCounts {
  /** "2026-09-22" — the hospital's civil date. */
  dateKey: string;
  /** On the board for the day: every booking not cancelled, pending ones included (as the table lists). */
  expected: number;
  /** The subset of `expected` who got here. */
  arrived: number;
  noShow: number;
  /** Patient-declared tickets still in 'declared' — said they were coming, not here (yet). */
  declared: number;
}

const DAY_MS = 86_400_000;

/**
 * One row per day from the day containing `from`, `days` long, zeros filled.
 * Two window reads and a JS bucket on `localDateKey`, so the day boundary is
 * the same helper every other "today" in the product uses — a GROUP BY on
 * `starts_at at time zone` would restate it in SQL and drift.
 */
export async function fetchExpectedCountsByDay(args: {
  hospitalId: string;
  from: Date;
  days: number;
}): Promise<ExpectedDayCounts[]> {
  const start = startOfLocalDay(args.from, DEFAULT_TIME_ZONE);
  // Noon of the last day, so DST (none in Kampala, but the helper is zone-agnostic) can't skip it.
  const end = endOfLocalDay(
    new Date(start.getTime() + (args.days - 1) * DAY_MS + DAY_MS / 2),
    DEFAULT_TIME_ZONE,
  );

  const byKey = new Map<string, ExpectedDayCounts>();
  for (let i = 0; i < args.days; i++) {
    const dateKey = localDateKey(
      new Date(start.getTime() + i * DAY_MS + DAY_MS / 2),
      DEFAULT_TIME_ZONE,
    );
    byKey.set(dateKey, { dateKey, expected: 0, arrived: 0, noShow: 0, declared: 0 });
  }

  const [appts, declared] = await Promise.all([
    db
      .select({ startsAt: appointments.startsAt, status: appointments.status })
      .from(appointments)
      .where(
        and(
          eq(appointments.hospitalId, args.hospitalId),
          gte(appointments.startsAt, start),
          lt(appointments.startsAt, end),
          // The board's own list (fetchExpectedArrivals): one definition of
          // "expected" for the strip, the panel and the table beneath them.
          inArray(appointments.status, [
            "confirmed",
            "pending_approval",
            "requested",
            "arrived",
            "in_progress",
            "completed",
            "no_show",
          ]),
        ),
      ),
    // On a still-declared row `checked_in_at` is null, so `arrived_at` IS
    // the declaration — the same window `fetchReceptionTodayCounts` uses.
    db
      .select({ arrivedAt: patientIntakes.arrivedAt })
      .from(patientIntakes)
      .where(
        and(
          eq(patientIntakes.hospitalId, args.hospitalId),
          eq(patientIntakes.status, "declared"),
          gte(patientIntakes.arrivedAt, start),
          lt(patientIntakes.arrivedAt, end),
        ),
      ),
  ]);

  for (const a of appts) {
    const day = byKey.get(localDateKey(a.startsAt, DEFAULT_TIME_ZONE));
    if (!day) continue;
    if (a.status === "no_show") day.noShow++;
    else {
      day.expected++;
      if (["arrived", "in_progress", "completed"].includes(a.status)) day.arrived++;
    }
  }
  for (const d of declared) {
    const day = byKey.get(localDateKey(d.arrivedAt, DEFAULT_TIME_ZONE));
    if (day) day.declared++;
  }
  return [...byKey.values()];
}

/* ─── The day's queue (operational only, codes not names) ─────────── */

export interface DayQueueRow {
  id: string;
  /**
   * `seeing` — a `queue_entries` row for this patient at this hospital today
   * is 'being_seen' (ha-start-encounter); the intake itself has no such
   * status. `waiting` — arrived / awaiting_triage / triaged and not called.
   * `declared` — a ticket from home, not in the building. `done` —
   * completed or cancelled.
   */
  bucket: "seeing" | "waiting" | "declared" | "done";
  status: string;
  patientCode: string | null;
  patientUnknownLabel: string | null;
  departmentName: string | null;
  entryTypeName: string;
  /** The patient's own "coming today" from the app — the panel says "From the app". */
  declaredByPatient: boolean;
  /** Where the desk sent them (migration 0067). Null is every row before it, and means triage. */
  routedTo: "triage" | "clinic" | null;
  /** `coalesce(checked_in_at, arrived_at)` — see `presenceAt`. */
  presenceAtIso: string;
  triageLevel: number | null;
  priorityHint: string;
}

/** The patient's open queue row at this hospital today has been called. */
function beingSeenSql(start: Date, end: Date) {
  return sql<boolean>`exists (
    select 1 from ${queueEntries}
    where ${queueEntries.patientUserId} = ${patientIntakes.patientUserId}
      and ${queueEntries.hospitalId} = ${patientIntakes.hospitalId}
      and ${queueEntries.state} = 'being_seen'
      and ${queueEntries.arrivedAt} >= ${ts(start)}
      and ${queueEntries.arrivedAt} < ${ts(end)}
  )`;
}

/**
 * Every intake on the hospital's board for one day, in board order
 * (priority, then present before declared, then longest-present first).
 * Codes only: the desk needs a name to CHECK SOMEONE IN, and the declared
 * list on the same page already reveals those through the audited path.
 * Naming every waiting and seen patient on every poll would widen the
 * reveal past the job (ADR 0084 §11) and write an audit row per patient per
 * refresh.
 */
export async function fetchQueueForDay(args: {
  hospitalId: string;
  date: Date;
  limit?: number;
}): Promise<DayQueueRow[]> {
  const start = startOfLocalDay(args.date, DEFAULT_TIME_ZONE);
  const end = endOfLocalDay(args.date, DEFAULT_TIME_ZONE);

  const rows = await db
    .select({
      id: patientIntakes.id,
      status: patientIntakes.status,
      patientUserId: patientIntakes.patientUserId,
      patientCode: patientProfiles.patientCode,
      patientUnknownLabel: patientIntakes.patientUnknownLabel,
      provisionalId: patientIntakes.provisionalPatientId,
      departmentName: hospitalDepartments.name,
      entryTypeName: entryTypes.name,
      declaredByPatient: patientIntakes.declaredByPatient,
      routedTo: patientIntakes.routedTo,
      arrivedAt: patientIntakes.arrivedAt,
      checkedInAt: patientIntakes.checkedInAt,
      triageLevel: patientIntakes.triageLevel,
      priorityHint: patientIntakes.priorityHint,
      beingSeen: beingSeenSql(start, end),
    })
    .from(patientIntakes)
    .innerJoin(entryTypes, eq(entryTypes.code, patientIntakes.entryTypeCode))
    .leftJoin(patientProfiles, eq(patientProfiles.id, patientIntakes.patientUserId))
    .leftJoin(hospitalDepartments, eq(hospitalDepartments.id, patientIntakes.receivingDepartmentId))
    .where(
      and(
        eq(patientIntakes.hospitalId, args.hospitalId),
        gte(presenceAt, ts(start)),
        lt(presenceAt, ts(end)),
      ),
    )
    .orderBy(priorityHintRank, declaredLast, presenceAt)
    .limit(args.limit ?? 300);

  return rows.map((r) => ({
    id: r.id,
    bucket:
      r.status === "declared"
        ? "declared"
        : r.status === "completed" || r.status === "cancelled"
          ? "done"
          : r.beingSeen
            ? "seeing"
            : "waiting",
    status: r.status,
    patientCode: r.patientCode,
    // A provisional booking's arrival has no code yet; say so rather than name them.
    patientUnknownLabel:
      r.patientUnknownLabel ?? (!r.patientUserId && r.provisionalId ? "Identity to confirm" : null),
    departmentName: r.departmentName,
    entryTypeName: r.entryTypeName,
    declaredByPatient: r.declaredByPatient,
    routedTo: r.routedTo === "clinic" || r.routedTo === "triage" ? r.routedTo : null,
    presenceAtIso: presenceOf(r).toISOString(),
    triageLevel: r.triageLevel,
    priorityHint: r.priorityHint,
  }));
}

/* ─── Patient search (operational identifiers only) ─────────────── */

export interface ReceptionPatientHit {
  patientUserId: string;
  patientCode: string;
  sex: string;
  dateOfBirth: string;
  primaryHospitalName: string | null;
}

/**
 * Search by patient_code (exact-prefix). Name + phone are encrypted
 * at rest; a name-search Edge Function is the separate audited path
 * deferred from this PR. For MVP reception searches by code only —
 * which is the lookup the front desk does 95% of the time anyway
 * (patient hands over their MedSync card / states their code).
 */
export async function searchPatientsByCode(args: {
  hospitalId: string;
  query: string;
  limit?: number;
}): Promise<ReceptionPatientHit[]> {
  const q = args.query.trim();
  if (q.length < 3) return [];

  const rows = await db
    .select({
      patientUserId: patientProfiles.id,
      patientCode: patientProfiles.patientCode,
      sex: patientProfiles.sex,
      dateOfBirth: patientProfiles.dateOfBirth,
      primaryHospitalId: patientProfiles.primaryFacilityId,
      primaryHospitalName: hospitals.name,
    })
    .from(patientProfiles)
    .leftJoin(hospitals, eq(hospitals.id, patientProfiles.primaryFacilityId))
    .where(ilike(patientProfiles.patientCode, `${q}%`))
    .orderBy(asc(patientProfiles.patientCode))
    .limit(args.limit ?? 20);

  // Surface order: this-hospital primary first, then others.
  rows.sort((a, b) => {
    const aHere = a.primaryHospitalId === args.hospitalId ? 0 : 1;
    const bHere = b.primaryHospitalId === args.hospitalId ? 0 : 1;
    return aHere - bHere;
  });

  return rows.map((r) => ({
    patientUserId: r.patientUserId,
    patientCode: r.patientCode,
    sex: r.sex,
    dateOfBirth: r.dateOfBirth,
    primaryHospitalName: r.primaryHospitalName,
  }));
}

/* ─── Today's declared queue tickets (book-or-queue, mig 0035) ──── */

export interface DeclaredIntakeRow {
  id: string;
  patientCode: string | null;
  patientUserId: string | null;
  /** Decrypted "First Surname" — the audited operational reveal (ADR 0084
   * §11). Null for an unidentified patient, or when the audit write failed
   * and the reveal was withheld. Render `patientCode` as the fallback. */
  displayName: string | null;
  declaredAtIso: string;
  /** "How booked" — see `intakeBookedVia`. */
  declaredByPatient: boolean;
  entryTypeCode: string;
  departmentId: string | null;
  departmentName: string | null;
  presentingComplaint: string | null;
  /** The patient card (ADR 0095) — same name reveal, plus photo, age, sex and the complaint. */
  identity: PatientIdentity;
}

/**
 * Patient-initiated intakes that are still in 'declared' (haven't been
 * checked in). Reception's "we know they're on their way" list — feeds
 * the Check-in affordance on /reception/expected.
 *
 * Names are revealed and audited: a clerk who cannot match the person at the
 * desk to a row creates a duplicate identity (ADR 0084 §11).
 */
export async function fetchDeclaredIntakesToday(args: {
  hospitalId: string;
  /** The scoped receptionist — required to audit the name reveals. */
  receptionUserId: string;
  limit?: number;
}): Promise<DeclaredIntakeRow[]> {
  const now = new Date();
  const start = startOfLocalDay(now, DEFAULT_TIME_ZONE);
  const end = endOfLocalDay(now, DEFAULT_TIME_ZONE);

  const rows = await db
    .select({
      id: patientIntakes.id,
      patientUserId: patientIntakes.patientUserId,
      patientCode: patientProfiles.patientCode,
      firstNameEncrypted: patientProfiles.firstNameEncrypted,
      surnameEncrypted: patientProfiles.surnameEncrypted,
      sex: patientProfiles.sex,
      dateOfBirth: patientProfiles.dateOfBirth,
      avatarPath: users.avatarPath,
      declaredAt: patientIntakes.arrivedAt,
      declaredByPatient: patientIntakes.declaredByPatient,
      entryTypeCode: patientIntakes.entryTypeCode,
      departmentId: patientIntakes.receivingDepartmentId,
      departmentName: hospitalDepartments.name,
      presentingComplaint: patientIntakes.presentingComplaint,
    })
    .from(patientIntakes)
    .leftJoin(patientProfiles, eq(patientProfiles.id, patientIntakes.patientUserId))
    .leftJoin(users, eq(users.id, patientIntakes.patientUserId))
    .leftJoin(hospitalDepartments, eq(hospitalDepartments.id, patientIntakes.receivingDepartmentId))
    .where(
      and(
        eq(patientIntakes.hospitalId, args.hospitalId),
        eq(patientIntakes.status, "declared"),
        gte(patientIntakes.arrivedAt, start),
        lt(patientIntakes.arrivedAt, end),
      ),
    )
    // Earliest declaration leads: this is a queue the desk works top-down,
    // not a log. (On a still-declared row `checked_in_at` is null, so
    // `arrived_at` IS the declaration — no presence split to make here.)
    .orderBy(asc(patientIntakes.arrivedAt))
    .limit(args.limit ?? 100);

  const named: DeclaredIntakeRow[] = rows.map((r) => {
    const displayName = r.patientUserId
      ? decryptName(r.firstNameEncrypted, r.surnameEncrypted)
      : null;
    return {
      id: r.id,
      patientCode: r.patientCode,
      patientUserId: r.patientUserId,
      displayName,
      declaredAtIso: r.declaredAt.toISOString(),
      declaredByPatient: r.declaredByPatient,
      entryTypeCode: r.entryTypeCode,
      departmentId: r.departmentId,
      departmentName: r.departmentName,
      presentingComplaint: r.presentingComplaint,
      identity: {
        patientCode: r.patientCode,
        displayName,
        // Signed below, only once the reveal is audited.
        photoUrl: null,
        ageYears: r.patientUserId ? computeAgeYears(r.dateOfBirth, now) : null,
        sex: r.patientUserId ? r.sex : null,
        complaint: complaintLine(null, r.presentingComplaint),
      },
    };
  });

  const revealed = rows.filter(
    (r, i) => r.patientUserId && (named[i]!.displayName || r.avatarPath),
  );
  const audited = await auditNameReveals({
    hospitalId: args.hospitalId,
    receptionUserId: args.receptionUserId,
    surface: "reception_declared_list",
    patientUserIds: revealed.map((r) => r.patientUserId!),
  });
  // Fail closed: unaudited PHI is not shown. The list still renders, on
  // patient codes, so check-in keeps working.
  if (!audited) {
    return named.map((r) => ({
      ...r,
      displayName: null,
      identity: { ...r.identity, displayName: null },
    }));
  }
  const urls = await signAvatars(rows.map((r) => r.avatarPath));
  rows.forEach((r, i) => {
    if (r.avatarPath) named[i]!.identity.photoUrl = urls.get(r.avatarPath) ?? null;
  });
  return named;
}

/* ─── Expected today: one list, in the order people booked (ADR 0101) ── */

/** A row on the desk's Expected list: a booking, or a same-day ticket from home. */
export type ExpectedTodayRow = (
  | ({ kind: "booking" } & ExpectedArrival)
  | ({ kind: "declared" } & DeclaredIntakeRow)
) & {
  /** Words, never a sort key — see `appointmentBookedVia` / `intakeBookedVia`. */
  bookedVia: string;
  /** When they booked: `created_at`, or the declaration itself for a ticket. */
  bookedAtIso: string;
};

export interface ExpectedToday {
  /** Not here yet: today's bookings and declared tickets, oldest booking first. */
  expected: ExpectedTodayRow[];
  /** Here but sent nowhere — they marked themselves arrived. Longest-here first. */
  needsRouting: ExpectedArrival[];
}

/**
 * The desk's queue of who is coming today, merged and ordered by WHEN they
 * booked, then id so the order is total and stable between polls (owner
 * ruling, ADR 0101). How they booked rides along as a label and never sorts:
 * the app must not outrank a phone call or a walk to the desk (PRD equity
 * rule), and nothing clinical — symptoms, tier, priority — orders it either.
 * Once they are in the building, the line is acuity then presence (ADR 0084
 * §7b) — `fetchQueueForDay`, untouched.
 *
 * The reads are the audited ones the board already uses, so every name and
 * photo here passes through the same reveal and provisional handling.
 */
export async function fetchExpectedToday(args: {
  hospitalId: string;
  /** The scoped receptionist — required to audit the name reveals. */
  receptionUserId: string;
  limit?: number;
}): Promise<ExpectedToday> {
  const [booked, declared, arrived] = await Promise.all([
    fetchExpectedArrivals({
      hospitalId: args.hospitalId,
      receptionUserId: args.receptionUserId,
      limit: args.limit,
      statuses: ["confirmed", "pending_approval", "requested"],
    }),
    fetchDeclaredIntakesToday({
      hospitalId: args.hospitalId,
      receptionUserId: args.receptionUserId,
      limit: args.limit,
    }),
    fetchExpectedArrivals({
      hospitalId: args.hospitalId,
      receptionUserId: args.receptionUserId,
      limit: args.limit,
      statuses: ["arrived"],
      unrouted: true,
      surface: "reception_needs_routing",
    }),
  ]);

  const expected: ExpectedTodayRow[] = [
    ...booked.map((b) => ({
      ...b,
      kind: "booking" as const,
      bookedVia: appointmentBookedVia(b.origin, b.channel),
      bookedAtIso: b.createdAtIso,
    })),
    ...declared.map((d) => ({
      ...d,
      kind: "declared" as const,
      bookedVia: intakeBookedVia(d.declaredByPatient, d.entryTypeCode),
      bookedAtIso: d.declaredAtIso,
    })),
  ];
  return {
    expected: expected.sort(byBookedAt),
    needsRouting: arrived.sort((a, b) =>
      (a.hereSinceIso ?? a.startsAtIso).localeCompare(b.hereSinceIso ?? b.startsAtIso),
    ),
  };
}

/* ─── Find a person on today's board (ADR 0084 §11) ─────────────── */

export interface BoardSearchHit {
  intakeId: string;
  patientUserId: string;
  patientCode: string | null;
  /** Decrypted "First Surname" — the reveal this search exists for. */
  displayName: string;
  status: string;
  declaredByPatient: boolean;
  /** `coalesce(checked_in_at, arrived_at)` — when they got here, or when
   * they declared if they haven't. */
  presenceAtIso: string;
  /** The declared department — the default the desk routes to. */
  departmentId: string | null;
  departmentName: string | null;
}

/**
 * ponytail: a linear scan of today's board, decrypting to match. Names are
 * AES-256-GCM with a random IV (lib/encryption.ts), so there is no SQL
 * predicate and no index that can match one — searching means decrypting
 * candidates. Bounding the candidate set to one hospital's board for one day
 * is what makes that affordable, and is the same boundary that makes the
 * reveal justifiable at all. CEILING: BOARD_SCAN_ROWS rows per keystroke-load
 * (~2ms of AES at Mulago OPD volumes); a board larger than that silently
 * truncates to the longest-present rows. UPGRADE PATH: a blind index — a
 * deterministic HMAC of the normalised surname in its own column — which is a
 * schema change plus a backfill, and buys nothing until the scan hurts.
 */
const BOARD_SCAN_ROWS = 500;

/**
 * Match a person standing at the desk to a row on today's board, BY NAME.
 * Scoped to live intakes at the caller's hospital today — not a hospital-wide
 * patient search. Every name handed back is audited; if the audit cannot be
 * written, nothing is handed back.
 *
 * Name only, deliberately: patient codes share a prefix, so letting the query
 * match them would turn `MS-` into "show me everyone on the board" — a bulk
 * reveal wearing a search box. Codes are already served by
 * `searchPatientsByCode`, which needs no reveal at all.
 */
export async function searchTodaysBoard(args: {
  hospitalId: string;
  /** The scoped receptionist — required to audit the name reveals. */
  receptionUserId: string;
  query: string;
  limit?: number;
}): Promise<BoardSearchHit[]> {
  const q = args.query.trim().toLowerCase();
  // Same floor as the code search.
  if (q.length < 3) return [];
  const limit = args.limit ?? 20;

  const now = new Date();
  const start = startOfLocalDay(now, DEFAULT_TIME_ZONE);
  const end = endOfLocalDay(now, DEFAULT_TIME_ZONE);

  const rows = await db
    .select({
      intakeId: patientIntakes.id,
      patientUserId: patientIntakes.patientUserId,
      patientCode: patientProfiles.patientCode,
      firstNameEncrypted: patientProfiles.firstNameEncrypted,
      surnameEncrypted: patientProfiles.surnameEncrypted,
      status: patientIntakes.status,
      declaredByPatient: patientIntakes.declaredByPatient,
      arrivedAt: patientIntakes.arrivedAt,
      checkedInAt: patientIntakes.checkedInAt,
      departmentId: patientIntakes.receivingDepartmentId,
      departmentName: hospitalDepartments.name,
    })
    .from(patientIntakes)
    // innerJoin: an unknown-patient intake has no profile and no name to
    // match on — it is found by its label on the flow board, not here.
    .innerJoin(patientProfiles, eq(patientProfiles.id, patientIntakes.patientUserId))
    .leftJoin(hospitalDepartments, eq(hospitalDepartments.id, patientIntakes.receivingDepartmentId))
    .where(
      and(
        eq(patientIntakes.hospitalId, args.hospitalId),
        inArray(patientIntakes.status, ["declared", "arrived", "awaiting_triage", "triaged"]),
        gte(presenceAt, ts(start)),
        lt(presenceAt, ts(end)),
      ),
    )
    .orderBy(presenceAt)
    .limit(BOARD_SCAN_ROWS);

  const hits: BoardSearchHit[] = [];
  for (const r of rows) {
    if (!r.patientUserId) continue;
    // Decrypt-to-match is transient and never leaves this process. Only rows
    // handed back to the caller are a reveal, and only those are audited —
    // logging the whole board on every page load would be both noise and a
    // false record of what the clerk saw.
    const displayName = decryptName(r.firstNameEncrypted, r.surnameEncrypted);
    if (!displayName) continue;
    if (!displayName.toLowerCase().includes(q)) continue;
    hits.push({
      intakeId: r.intakeId,
      patientUserId: r.patientUserId,
      patientCode: r.patientCode,
      displayName,
      status: r.status,
      declaredByPatient: r.declaredByPatient,
      presenceAtIso: presenceOf(r).toISOString(),
      departmentId: r.departmentId,
      departmentName: r.departmentName,
    });
    if (hits.length >= limit) break;
  }

  if (hits.length === 0) return [];
  const audited = await auditNameReveals({
    hospitalId: args.hospitalId,
    receptionUserId: args.receptionUserId,
    surface: "reception_board_search",
    patientUserIds: hits.map((h) => h.patientUserId),
  });
  return audited ? hits : [];
}

/* ─── Today's flow status board (operational only) ──────────────── */

export interface FlowRow {
  patientUserId: string | null;
  patientCode: string | null;
  patientUnknownLabel: string | null;
  /** `declared` = patient-initiated queue ticket, not yet physically
   * present. Distinct from `expected` (booked appointment, not yet
   * arrived) and `arrived` (here, not yet in a triage queue).
   * Migration 0035. */
  stage: "declared" | "expected" | "arrived" | "in_queue" | "awaiting_triage" | "seen";
  departmentName: string | null;
  whenIso: string;
  detail: string;
  /** Set when this row came from a patient_intakes row in 'declared'
   * status — gives the reception UI an ID to wire a Check-in button. */
  declaredIntakeId: string | null;
}

export async function fetchTodayFlow(args: {
  hospitalId: string;
  limit?: number;
}): Promise<FlowRow[]> {
  const now = new Date();
  const start = startOfLocalDay(now, DEFAULT_TIME_ZONE);
  const end = endOfLocalDay(now, DEFAULT_TIME_ZONE);

  // Today's bookings + arrivals via appointments.
  const apptRows = await db
    .select({
      patientUserId: appointments.patientUserId,
      patientCode: patientProfiles.patientCode,
      // A provisional booking (migration 0060) has no code yet; the board
      // says so in words rather than naming the person.
      provisionalId: appointments.provisionalPatientId,
      status: appointments.status,
      startsAt: appointments.startsAt,
      departmentName: hospitalDepartments.name,
      seen: seenSql,
    })
    .from(appointments)
    .leftJoin(patientProfiles, eq(patientProfiles.id, appointments.patientUserId))
    .leftJoin(hospitalDepartments, eq(hospitalDepartments.id, appointments.departmentId))
    .where(
      and(
        eq(appointments.hospitalId, args.hospitalId),
        gte(appointments.startsAt, start),
        lt(appointments.startsAt, end),
      ),
    )
    .orderBy(asc(appointments.startsAt))
    .limit(args.limit ?? 200);

  // Walk-ins / referrals / patient declarations via intake.
  const intakeRows = await db
    .select({
      id: patientIntakes.id,
      patientUserId: patientIntakes.patientUserId,
      patientCode: patientProfiles.patientCode,
      patientUnknownLabel: patientIntakes.patientUnknownLabel,
      status: patientIntakes.status,
      arrivedAt: patientIntakes.arrivedAt,
      checkedInAt: patientIntakes.checkedInAt,
      declaredByPatient: patientIntakes.declaredByPatient,
      routedTo: patientIntakes.routedTo,
      departmentName: hospitalDepartments.name,
    })
    .from(patientIntakes)
    .leftJoin(patientProfiles, eq(patientProfiles.id, patientIntakes.patientUserId))
    .leftJoin(hospitalDepartments, eq(hospitalDepartments.id, patientIntakes.receivingDepartmentId))
    // Windowed and ordered on presence: a patient who declared at 06:10 and
    // was checked in at 13:00 is a 13:00 event on a "what happened today"
    // board, not an 06:10 one — and one who declared at 23:50 last night and
    // walked in this morning belongs on today's.
    .where(
      and(
        eq(patientIntakes.hospitalId, args.hospitalId),
        gte(presenceAt, ts(start)),
        lt(presenceAt, ts(end)),
      ),
    )
    .orderBy(desc(presenceAt))
    .limit(args.limit ?? 200);

  const out: FlowRow[] = [];

  for (const r of apptRows) {
    const stage: FlowRow["stage"] = r.seen
      ? "seen"
      : r.status === "arrived" || r.status === "in_progress"
        ? "in_queue"
        : r.status === "confirmed" || r.status === "pending_approval" || r.status === "requested"
          ? "expected"
          : "arrived";
    out.push({
      patientUserId: r.patientUserId,
      patientCode: r.patientCode,
      patientUnknownLabel: r.patientUserId ? null : r.provisionalId ? "Identity to confirm" : null,
      stage,
      departmentName: r.departmentName,
      whenIso: r.startsAt.toISOString(),
      detail: `Booked · ${r.status}`,
      declaredIntakeId: null,
    });
  }
  for (const r of intakeRows) {
    // 'completed' is set by ha-complete-encounter: the intake's encounter
    // reached state='completed' — the same "Seen" the booking rows derive.
    // One the desk sent straight to the clinic (ADR 0101) is in its queue, as
    // a triaged patient is.
    const stage: FlowRow["stage"] =
      r.status === "completed"
        ? "seen"
        : r.status === "declared"
          ? "declared"
          : r.status === "awaiting_triage"
            ? "awaiting_triage"
            : r.status === "triaged" || (r.status === "arrived" && r.routedTo === "clinic")
              ? "in_queue"
              : "arrived";
    const source = r.declaredByPatient ? "Self-declared" : "Intake";
    out.push({
      patientUserId: r.patientUserId,
      patientCode: r.patientCode,
      patientUnknownLabel: r.patientUnknownLabel,
      stage,
      departmentName: r.departmentName,
      whenIso: presenceOf(r).toISOString(),
      detail: [source, r.status, r.routedTo === "clinic" ? "sent to clinic" : null]
        .filter(Boolean)
        .join(" · "),
      declaredIntakeId: r.status === "declared" ? r.id : null,
    });
  }

  // Stable sort: most-recent event first.
  out.sort((a, b) => b.whenIso.localeCompare(a.whenIso));
  return out.slice(0, args.limit ?? 100);
}

/* ─── Identity to confirm (Gate D, PRD §2.8) ─────────────────────── */

export interface ProvisionalSummary {
  id: string;
  hospitalId: string | null;
  declaredName: string | null;
  /** "+256 7•• ••• 123" — last digits only, to check with the caller. */
  phoneMasked: string | null;
  dateOfBirth: string | null;
  ageYears: number | null;
  reconciliationState: string;
  /** The appointment at this hospital the panel was opened from, if any. */
  createdAtIso: string;
}

export interface ReconciliationCandidate {
  patientUserId: string;
  patientCode: string;
  displayName: string;
  dateOfBirth: string;
  /** Words, never a score: "same phone", "same name and year of birth". */
  basis: string[];
}

/**
 * ponytail: candidates are found by decrypting this hospital's profiles and
 * comparing — `patient_profiles` has no blind index, so `phone_hmac` (which
 * migration 0060 put on provisional_patients) cannot be joined to it yet.
 * The scan is bounded to the newest PROFILE_SCAN_ROWS profiles whose primary
 * facility is this hospital. CEILING: a profile older than that window, or
 * registered elsewhere, is not offered — the clerk still has "Register new"
 * and the code search. UPGRADE PATH: a `phone_hmac` column on
 * patient_profiles (additive migration + backfill via `blindIndex`), after
 * which the phone leg becomes one indexed equality and only the name leg
 * still decrypts.
 */
const PROFILE_SCAN_ROWS = 2000;

interface ScannedProfile {
  patientUserId: string;
  patientCode: string;
  dateOfBirth: string;
  name: string;
  phone: string;
}

/** Decrypt this hospital's profiles, newest first. Transient — never leaves the process undecided. */
async function scanProfiles(hospitalId: string): Promise<ScannedProfile[]> {
  const rows = await db
    .select({
      patientUserId: patientProfiles.id,
      patientCode: patientProfiles.patientCode,
      dateOfBirth: patientProfiles.dateOfBirth,
      firstNameEncrypted: patientProfiles.firstNameEncrypted,
      surnameEncrypted: patientProfiles.surnameEncrypted,
      phoneEncrypted: patientProfiles.phoneEncrypted,
    })
    .from(patientProfiles)
    .where(eq(patientProfiles.primaryFacilityId, hospitalId))
    .orderBy(desc(patientProfiles.createdAt))
    .limit(PROFILE_SCAN_ROWS);

  const out: ScannedProfile[] = [];
  for (const r of rows) {
    const name = decryptName(r.firstNameEncrypted, r.surnameEncrypted);
    const phone = decryptOrNull(r.phoneEncrypted);
    if (!name || !phone) continue;
    out.push({
      patientUserId: r.patientUserId,
      patientCode: r.patientCode,
      dateOfBirth: r.dateOfBirth,
      name,
      phone,
    });
  }
  return out;
}

export async function fetchProvisional(args: {
  hospitalId: string;
  provisionalPatientId: string;
}): Promise<ProvisionalSummary | null> {
  const [row] = await db
    .select({
      id: provisionalPatients.id,
      hospitalId: provisionalPatients.hospitalId,
      declaredNameEncrypted: provisionalPatients.declaredNameEncrypted,
      phoneEncrypted: provisionalPatients.phoneEncrypted,
      dateOfBirth: provisionalPatients.dateOfBirth,
      ageYears: provisionalPatients.ageYears,
      reconciliationState: provisionalPatients.reconciliationState,
      createdAt: provisionalPatients.createdAt,
      // Readable here only when created at this desk or booked here — the
      // same clause as the RLS policy, restated for the service connection.
      bookedHere: sql<boolean>`exists (
        select 1 from ${appointments}
        where ${appointments.provisionalPatientId} = ${provisionalPatients.id}
          and ${appointments.hospitalId} = ${args.hospitalId}
      )`,
    })
    .from(provisionalPatients)
    .where(eq(provisionalPatients.id, args.provisionalPatientId))
    .limit(1);
  if (!row) return null;
  if (row.hospitalId !== args.hospitalId && !row.bookedHere) return null;
  const phone = decryptOrNull(row.phoneEncrypted);
  return {
    id: row.id,
    hospitalId: row.hospitalId,
    declaredName: decryptOrNull(row.declaredNameEncrypted),
    phoneMasked: phone ? maskPhone(phone) : null,
    dateOfBirth: row.dateOfBirth,
    ageYears: row.ageYears,
    reconciliationState: row.reconciliationState,
    createdAtIso: row.createdAt.toISOString(),
  };
}

/**
 * Candidate matches for one provisional booking, each with its BASIS in
 * words. Never ranked, never pre-selected: the clerk confirms, rejects, or
 * registers a new patient. Every candidate named is audited; if the audit
 * cannot be written, nothing is handed back.
 */
export async function fetchReconciliationCandidates(args: {
  hospitalId: string;
  receptionUserId: string;
  provisionalPatientId: string;
}): Promise<ReconciliationCandidate[]> {
  const [row] = await db
    .select({
      hospitalId: provisionalPatients.hospitalId,
      declaredNameEncrypted: provisionalPatients.declaredNameEncrypted,
      phoneEncrypted: provisionalPatients.phoneEncrypted,
      dateOfBirth: provisionalPatients.dateOfBirth,
      ageYears: provisionalPatients.ageYears,
    })
    .from(provisionalPatients)
    .where(eq(provisionalPatients.id, args.provisionalPatientId))
    .limit(1);
  if (!row) return [];
  const name = decryptOrNull(row.declaredNameEncrypted);
  const phone = decryptOrNull(row.phoneEncrypted);
  if (!name || !phone) return [];
  const declared = { name, phone, dateOfBirth: row.dateOfBirth, ageYears: row.ageYears };

  const now = new Date();
  const hits: ReconciliationCandidate[] = [];
  for (const p of await scanProfiles(args.hospitalId)) {
    const basis = matchBasis(
      declared,
      { name: p.name, phone: p.phone, dateOfBirth: p.dateOfBirth, ageYears: null },
      now,
    );
    if (basis.length === 0) continue;
    hits.push({
      patientUserId: p.patientUserId,
      patientCode: p.patientCode,
      displayName: p.name,
      dateOfBirth: p.dateOfBirth,
      basis,
    });
  }
  if (hits.length === 0) return [];

  const audited = await auditNameReveals({
    hospitalId: args.hospitalId,
    receptionUserId: args.receptionUserId,
    surface: "reception_reconcile_candidates",
    patientUserIds: hits.map((h) => h.patientUserId),
  });
  return audited ? hits : [];
}

/* ─── Find a registered patient by phone (desk booking) ─────────── */

export interface PhoneLookupHit {
  patientUserId: string;
  patientCode: string;
  displayName: string;
  dateOfBirth: string;
}

/**
 * "The caller gives their number": the profiles at this hospital whose
 * phone is exactly this E.164. Same bounded decrypt scan as reconciliation
 * (see PROFILE_SCAN_ROWS). The names are revealed so the clerk can confirm
 * "Is this Nakato Sarah?" with the caller, and are audited as such.
 */
export async function findPatientsByPhone(args: {
  hospitalId: string;
  receptionUserId: string;
  phoneE164: string;
}): Promise<PhoneLookupHit[]> {
  const hits = (await scanProfiles(args.hospitalId))
    .filter((p) => p.phone === args.phoneE164)
    .map((p) => ({
      patientUserId: p.patientUserId,
      patientCode: p.patientCode,
      displayName: p.name,
      dateOfBirth: p.dateOfBirth,
    }));
  if (hits.length === 0) return [];
  const audited = await auditNameReveals({
    hospitalId: args.hospitalId,
    receptionUserId: args.receptionUserId,
    surface: "reception_phone_lookup",
    patientUserIds: hits.map((h) => h.patientUserId),
  });
  return audited ? hits : [];
}
