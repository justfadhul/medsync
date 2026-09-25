import "server-only";

import type { PatientIdentity } from "@/components/medsync/patient-identity";
import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { patientProfiles } from "@/db/schema/patient-profiles";
import {
  appointments,
  availabilityBlocks,
  clinicianSchedulingSettings,
  departmentSchedulingPolicy,
  queueEntries,
} from "@/db/schema/scheduling";
import { users } from "@/db/schema/users";
import { revealPatientIdentities, toPatientIdentity } from "@/lib/scheduling/patient-identity";
import { ACUITY_TIERS } from "@/lib/triage/constants";
import {
  DEFAULT_TIME_ZONE,
  endOfLocalDay,
  startOfLocalDay,
} from "@/supabase/functions/_shared/slots";

/**
 * Doctor-scheduling read helpers. Pure reads against the existing
 * scheduling tables — no engine behaviour change. Used by the doctor
 * scheduling surface to compose the stat rail, pending-approvals rail,
 * and the day's queue.
 */

/* ─── Stat rail counts ───────────────────────────────────────────── */

export interface SchedulingStats {
  total: number;
  confirmed: number;
  pending: number;
  urgent: number;
  completed: number;
  cancelled: number;
}

export async function fetchSchedulingStats(args: {
  clinicianUserId: string;
  hospitalId: string;
  rangeStart: Date;
  rangeEnd: Date;
}): Promise<SchedulingStats> {
  const rows = await db
    .select({
      status: appointments.status,
      priority: appointments.priority,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.clinicianUserId, args.clinicianUserId),
        eq(appointments.hospitalId, args.hospitalId),
        gte(appointments.startsAt, args.rangeStart),
        lt(appointments.startsAt, args.rangeEnd),
      ),
    );

  const stats: SchedulingStats = {
    total: rows.length,
    confirmed: 0,
    pending: 0,
    urgent: 0,
    completed: 0,
    cancelled: 0,
  };
  for (const r of rows) {
    if (r.priority === "urgent") stats.urgent++;
    if (r.status === "confirmed" || r.status === "arrived" || r.status === "in_progress") {
      stats.confirmed++;
    } else if (r.status === "requested" || r.status === "pending_approval") {
      stats.pending++;
    } else if (r.status === "completed") {
      stats.completed++;
    } else if (
      r.status === "cancelled" ||
      r.status === "declined" ||
      r.status === "no_show" ||
      r.status === "rescheduled"
    ) {
      stats.cancelled++;
    }
  }
  return stats;
}

/* ─── Pending-approvals rail ─────────────────────────────────────── */

export interface PendingApprovalRow {
  id: string;
  startsAtIso: string;
  endsAtIso: string;
  type: string;
  reason: string;
  reasonNote: string | null;
  patientName: string;
  patientCode: string;
  /** The audited reveal (ADR 0095) — name, photo, age, sex, what they said is bothering them. */
  identity: PatientIdentity;
  priority: string;
}

export async function fetchPendingApprovals(args: {
  clinicianUserId: string;
  hospitalId: string;
  limit?: number;
}): Promise<PendingApprovalRow[]> {
  const rows = await db
    .select({
      id: appointments.id,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
      type: appointments.type,
      reason: appointments.reason,
      reasonNote: appointments.reasonNote,
      symptoms: appointments.symptoms,
      priority: appointments.priority,
      patientUserId: appointments.patientUserId,
      patientCode: patientProfiles.patientCode,
      firstNameEncrypted: patientProfiles.firstNameEncrypted,
      surnameEncrypted: patientProfiles.surnameEncrypted,
      sex: patientProfiles.sex,
      dateOfBirth: patientProfiles.dateOfBirth,
      avatarPath: users.avatarPath,
    })
    .from(appointments)
    .innerJoin(patientProfiles, eq(patientProfiles.id, appointments.patientUserId))
    .leftJoin(users, eq(users.id, appointments.patientUserId))
    .where(
      and(
        eq(appointments.clinicianUserId, args.clinicianUserId),
        eq(appointments.hospitalId, args.hospitalId),
        inArray(appointments.status, ["requested", "pending_approval"]),
      ),
    )
    .orderBy(asc(appointments.startsAt))
    .limit(args.limit ?? 20);

  const revealed = await revealPatientIdentities({
    viewer: { userId: args.clinicianUserId, hospitalId: args.hospitalId },
    surface: "doctor_pending_rail",
    patients: rows,
  });

  return rows.map((r) => {
    const identity = toPatientIdentity(r, revealed);
    return {
      id: r.id,
      startsAtIso: r.startsAt.toISOString(),
      endsAtIso: r.endsAt.toISOString(),
      type: r.type,
      reason: r.reason,
      reasonNote: r.reasonNote,
      patientName: identity.displayName ?? r.patientCode,
      patientCode: r.patientCode,
      identity,
      priority: r.priority,
    };
  });
}

/* ─── Day's queue rail ───────────────────────────────────────────── */

export interface DepartmentQueueRow {
  id: string;
  kind: string;
  state: string;
  arrivedAtIso: string;
  calledAtIso: string | null;
  sequenceNumber: number;
  /** The triage acuity a nurse assigned, spelled out. Null = un-triaged.
   *  The rail REORDERS on this, so it has to be able to say why. */
  priorityLabel: string | null;
  patientUserId: string;
  patientCode: string | null;
  /** The audited reveal (ADR 0095). A walk-in has no booking, so no complaint line. */
  identity: PatientIdentity;
  appointmentId: string | null;
  /** Set by ha-start-encounter when the row is called. The rail's "End visit"
   *  closes THIS encounter (ADR 0101 R3), so a being_seen row without one has
   *  nothing to end and offers nothing. */
  encounterId: string | null;
  notes: string | null;
}

export async function fetchDepartmentQueueToday(args: {
  departmentId: string;
  viewer: { userId: string; hospitalId: string };
}): Promise<DepartmentQueueRow[]> {
  // The hospital's day, not the host's (UTC on Vercel — 03:00 EAT).
  const now = new Date();
  const start = startOfLocalDay(now, DEFAULT_TIME_ZONE);
  const end = endOfLocalDay(now, DEFAULT_TIME_ZONE);

  const rows = await db
    .select({
      id: queueEntries.id,
      kind: queueEntries.kind,
      state: queueEntries.state,
      arrivedAt: queueEntries.arrivedAt,
      calledAt: queueEntries.calledAt,
      sequenceNumber: queueEntries.sequenceNumber,
      priorityOrder: queueEntries.priorityOrder,
      patientUserId: queueEntries.patientUserId,
      patientCode: patientProfiles.patientCode,
      firstNameEncrypted: patientProfiles.firstNameEncrypted,
      surnameEncrypted: patientProfiles.surnameEncrypted,
      sex: patientProfiles.sex,
      dateOfBirth: patientProfiles.dateOfBirth,
      avatarPath: users.avatarPath,
      appointmentId: queueEntries.appointmentId,
      encounterId: queueEntries.encounterId,
      symptoms: appointments.symptoms,
      reasonNote: appointments.reasonNote,
      notes: queueEntries.notes,
    })
    .from(queueEntries)
    .leftJoin(patientProfiles, eq(patientProfiles.id, queueEntries.patientUserId))
    .leftJoin(users, eq(users.id, queueEntries.patientUserId))
    .leftJoin(appointments, eq(appointments.id, queueEntries.appointmentId))
    .where(
      and(
        eq(queueEntries.departmentId, args.departmentId),
        gte(queueEntries.arrivedAt, start),
        lt(queueEntries.arrivedAt, end),
        inArray(queueEntries.state, ["waiting", "being_seen"]),
      ),
    )
    // Acuity first, arrival as the tiebreak — the contract migration 0036
    // wrote for this column ("lower = seen sooner, sequence_number is the
    // tiebreak"). `app/nurse/triage/actions.ts` sets `priority_order` to the
    // assigned acuity on triage; ordering by sequence alone meant a patient
    // triaged as immediate stayed at their FIFO position on the doctor's
    // rail, so the nurse's re-rank reached the database and nothing else.
    // NULLS LAST keeps un-triaged entries in plain arrival order behind the
    // ones a nurse has actually assessed.
    .orderBy(sql`${queueEntries.priorityOrder} ASC NULLS LAST`, asc(queueEntries.sequenceNumber));

  const revealed = await revealPatientIdentities({
    viewer: args.viewer,
    surface: "doctor_queue_rail",
    patients: rows,
  });

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    state: r.state,
    arrivedAtIso: r.arrivedAt.toISOString(),
    calledAtIso: r.calledAt?.toISOString() ?? null,
    sequenceNumber: r.sequenceNumber,
    priorityLabel: acuityLabel(r.priorityOrder),
    patientUserId: r.patientUserId,
    patientCode: r.patientCode,
    identity: toPatientIdentity(r, revealed),
    appointmentId: r.appointmentId,
    encounterId: r.encounterId,
    notes: r.notes,
  }));
}

/**
 * `queue_entries.priority_order` holds the acuity a nurse assigned at triage
 * (`app/nurse/triage/actions.ts`). Rendered server-side so the rail gets a
 * string and the browser never pays for the clinical constants module.
 * An unrecognised value still prints its level rather than being swallowed.
 */
function acuityLabel(priorityOrder: number | null): string | null {
  if (priorityOrder === null) return null;
  const tier = ACUITY_TIERS.find((t) => t.level === priorityOrder);
  return tier ? `Triaged L${tier.level} · ${tier.meaning}` : `Triaged L${priorityOrder}`;
}

/* ─── Settings + dept-policy resolver ────────────────────────────── */

export interface EffectiveSchedulingSettings {
  autoConfirm: boolean;
  defaultSlotMinutes: number;
  bufferMinutes: number;
  allowVirtual: boolean;
  allowOutOfHoursOverride: boolean;
  /** true when the value is the dept default, not a clinician override. */
  usingDefaults: {
    autoConfirm: boolean;
    defaultSlotMinutes: boolean;
    bufferMinutes: boolean;
    allowVirtual: boolean;
  };
}

const HARD_DEFAULTS = {
  autoConfirm: false,
  defaultSlotMinutes: 15,
  bufferMinutes: 0,
  allowVirtual: false,
  allowOutOfHoursOverride: true,
};

/**
 * Resolution order: clinician_scheduling_settings → department_scheduling_policy
 * → hard defaults. Per GATE A proposal §4.
 */
export async function fetchEffectiveSchedulingSettings(args: {
  clinicianUserId: string;
  hospitalId: string;
  departmentId: string;
}): Promise<EffectiveSchedulingSettings> {
  const [own] = await db
    .select({
      autoConfirm: clinicianSchedulingSettings.autoConfirm,
      defaultSlotMinutes: clinicianSchedulingSettings.defaultSlotMinutes,
      bufferMinutes: clinicianSchedulingSettings.bufferMinutes,
      allowVirtual: clinicianSchedulingSettings.allowVirtual,
      allowOutOfHoursOverride: clinicianSchedulingSettings.allowOutOfHoursOverride,
    })
    .from(clinicianSchedulingSettings)
    .where(
      and(
        eq(clinicianSchedulingSettings.clinicianUserId, args.clinicianUserId),
        eq(clinicianSchedulingSettings.hospitalId, args.hospitalId),
      ),
    )
    .limit(1);

  const [policy] = await db
    .select({
      defaultAutoConfirm: departmentSchedulingPolicy.defaultAutoConfirm,
      defaultSlotMinutes: departmentSchedulingPolicy.defaultSlotMinutes,
      defaultBufferMinutes: departmentSchedulingPolicy.defaultBufferMinutes,
      allowVirtual: departmentSchedulingPolicy.allowVirtual,
    })
    .from(departmentSchedulingPolicy)
    .where(eq(departmentSchedulingPolicy.departmentId, args.departmentId))
    .limit(1);

  const ac = own?.autoConfirm ?? policy?.defaultAutoConfirm ?? HARD_DEFAULTS.autoConfirm;
  const slot =
    own?.defaultSlotMinutes ?? policy?.defaultSlotMinutes ?? HARD_DEFAULTS.defaultSlotMinutes;
  const buf = own?.bufferMinutes ?? policy?.defaultBufferMinutes ?? HARD_DEFAULTS.bufferMinutes;
  const virt = own?.allowVirtual ?? policy?.allowVirtual ?? HARD_DEFAULTS.allowVirtual;
  const ooh = own?.allowOutOfHoursOverride ?? HARD_DEFAULTS.allowOutOfHoursOverride;

  return {
    autoConfirm: ac,
    defaultSlotMinutes: slot,
    bufferMinutes: buf,
    allowVirtual: virt,
    allowOutOfHoursOverride: ooh,
    usingDefaults: {
      autoConfirm: own?.autoConfirm === undefined || own?.autoConfirm === null,
      defaultSlotMinutes: own?.defaultSlotMinutes === undefined || own?.defaultSlotMinutes === null,
      bufferMinutes: own?.bufferMinutes === undefined || own?.bufferMinutes === null,
      allowVirtual: own?.allowVirtual === undefined || own?.allowVirtual === null,
    },
  };
}

/**
 * Latest patient seen on the day's queue — used to surface "now seeing"
 * on the doctor's calendar header. Cheap; safe noop when empty.
 */
export async function fetchCurrentlyBeingSeen(args: {
  departmentId: string;
}): Promise<{ patientCode: string | null; calledAtIso: string | null } | null> {
  const start = startOfLocalDay(new Date(), DEFAULT_TIME_ZONE);

  const [row] = await db
    .select({
      patientCode: patientProfiles.patientCode,
      calledAt: queueEntries.calledAt,
    })
    .from(queueEntries)
    .leftJoin(patientProfiles, eq(patientProfiles.id, queueEntries.patientUserId))
    .where(
      and(
        eq(queueEntries.departmentId, args.departmentId),
        eq(queueEntries.state, "being_seen"),
        gte(queueEntries.arrivedAt, start),
      ),
    )
    .orderBy(desc(queueEntries.calledAt))
    .limit(1);

  if (!row) return null;
  return { patientCode: row.patientCode, calledAtIso: row.calledAt?.toISOString() ?? null };
}

/* ─── Availability blocks (for inline editing on /doctor/schedule) ─── */

export interface AvailabilityRow {
  id: string;
  kind: string;
  startsAtIso: string;
  endsAtIso: string;
  recurrence: string;
  recurrenceWeekday: number | null;
  recurrenceUntilIso: string | null;
  location: string | null;
  notes: string | null;
  /** ADR 0095: the clinician's own name for a `custom` block. */
  label: string | null;
}

export async function fetchClinicianAvailabilityBlocks(args: {
  clinicianUserId: string;
  hospitalId: string;
  limit?: number;
}): Promise<AvailabilityRow[]> {
  const since = startOfLocalDay(new Date(), DEFAULT_TIME_ZONE);
  const rows = await db
    .select({
      id: availabilityBlocks.id,
      kind: availabilityBlocks.kind,
      startsAt: availabilityBlocks.startsAt,
      endsAt: availabilityBlocks.endsAt,
      recurrence: availabilityBlocks.recurrence,
      recurrenceWeekday: availabilityBlocks.recurrenceWeekday,
      recurrenceUntil: availabilityBlocks.recurrenceUntil,
      location: availabilityBlocks.location,
      notes: availabilityBlocks.notes,
      label: availabilityBlocks.label,
    })
    .from(availabilityBlocks)
    .where(
      and(
        eq(availabilityBlocks.clinicianUserId, args.clinicianUserId),
        eq(availabilityBlocks.hospitalId, args.hospitalId),
        eq(availabilityBlocks.state, "active"),
        // A weekly template keeps its ORIGINAL starts_at/ends_at as the
        // anchor, so `ends_at >= today` alone hid every series set up more
        // than a week ago — the doctor could not see, edit or cancel a
        // recurrence the engine was still offering to patients. Window the
        // SERIES for those, matching `app/clinician/availability/page.tsx`.
        or(
          gte(availabilityBlocks.endsAt, since),
          and(
            eq(availabilityBlocks.recurrence, "weekly"),
            or(
              isNull(availabilityBlocks.recurrenceUntil),
              gte(availabilityBlocks.recurrenceUntil, since),
            ),
          ),
        ),
      ),
    )
    .orderBy(asc(availabilityBlocks.startsAt))
    .limit(args.limit ?? 50);

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    startsAtIso: r.startsAt.toISOString(),
    endsAtIso: r.endsAt.toISOString(),
    recurrence: r.recurrence,
    recurrenceWeekday: r.recurrenceWeekday,
    recurrenceUntilIso: r.recurrenceUntil?.toISOString() ?? null,
    location: r.location,
    notes: r.notes,
    label: r.label,
  }));
}
