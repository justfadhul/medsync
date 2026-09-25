import "server-only";

import type { EncounterScope } from "@/lib/encounter/record";
import { and, desc, eq, gte, sql } from "drizzle-orm";

import { db } from "@/db";
import { clinicalDocumentation } from "@/db/schema/encounter";
import { patientIntakes } from "@/db/schema/patient-intakes";
import { encounters } from "@/db/schema/scheduling";
import { triageRecords } from "@/db/schema/triage";
import { seedClerkshipFromTriage } from "@/lib/encounter/clerkship";
import { recordClerkshipVersion } from "@/lib/encounter/record";
import { logger } from "@/lib/logger";
import { DEFAULT_TIME_ZONE, startOfLocalDay } from "@/supabase/functions/_shared/slots";

/**
 * Triage → encounter handoff (kickoff §3): a completed triage opens/links an
 * encounter, carrying the presenting complaint + acuity + vitals into a SEEDED
 * draft clerkship (continuation, not a blank restart). Idempotent: if an
 * encounter is already linked to the triage, it returns that one.
 *
 * The caller (a doctor) becomes the encounter clinician; the freshly-created
 * in-progress encounter satisfies the `active_encounter` access basis, so the
 * seeded clerkship write authorises cleanly. Server-only.
 */

const ACUITY_LABEL: Record<number, string> = {
  1: "1 — immediate (red)",
  2: "2 — very urgent (orange)",
  3: "3 — urgent (yellow)",
  4: "4 — standard (green)",
  5: "5 — non-urgent (blue)",
};

export type OpenEncounterResult =
  | { ok: true; encounterId: string; created: boolean }
  | { ok: false; error: string };

/**
 * The patient's running visit at this hospital today, if there is one.
 *
 * One visit, one encounter (ADR 0101 R3). A doctor who calls the patient from
 * the queue rail opens an encounter through ha-start-encounter with no triage
 * link; a triage handoff or assignment that then INSERTED its own left two
 * in-progress encounters for one visit, and "End visit" closed one while the
 * other stayed open for good. Today is the hospital's day, not the host's.
 */
export async function findOpenEncounterToday(
  patientUserId: string,
  hospitalId: string,
): Promise<{ id: string; clinicianUserId: string } | null> {
  const [row] = await db
    .select({ id: encounters.id, clinicianUserId: encounters.clinicianUserId })
    .from(encounters)
    .where(
      and(
        eq(encounters.patientUserId, patientUserId),
        eq(encounters.hospitalId, hospitalId),
        eq(encounters.state, "in_progress"),
        gte(encounters.startedAt, startOfLocalDay(new Date(), DEFAULT_TIME_ZONE)),
      ),
    )
    .orderBy(desc(encounters.startedAt))
    .limit(1);
  return row ?? null;
}

/**
 * Attach a triage and the booking the visit answers to an encounter, without
 * overwriting either link it already has. The appointment is what lets
 * ha-complete-encounter complete the booking when the visit ends; the triage
 * link is what makes the next handoff for the same triage idempotent.
 */
export async function linkEncounterToVisit(
  encounterId: string,
  triageRecordId: string,
  appointmentId: string | null,
): Promise<void> {
  await db
    .update(encounters)
    .set({
      triageRecordId: sql`coalesce(${encounters.triageRecordId}, ${triageRecordId}::uuid)`,
      appointmentId: sql`coalesce(${encounters.appointmentId}, ${appointmentId}::uuid)`,
    })
    .where(eq(encounters.id, encounterId));
}

export async function openEncounterFromTriage(
  triageRecordId: string,
  scope: EncounterScope,
): Promise<OpenEncounterResult> {
  const [tr] = await db
    .select({
      hospitalId: triageRecords.hospitalId,
      patientUserId: triageRecords.patientUserId,
      departmentId: triageRecords.departmentId,
      intakeId: triageRecords.intakeId,
      assignedLevel: triageRecords.assignedLevel,
      vitalsSnapshot: triageRecords.vitalsSnapshot,
    })
    .from(triageRecords)
    .where(eq(triageRecords.id, triageRecordId))
    .limit(1);

  if (!tr) return { ok: false, error: "Triage record not found." };
  if (tr.hospitalId !== scope.hospitalId) {
    return { ok: false, error: "That triage is outside your hospital." };
  }
  if (!tr.patientUserId) {
    return {
      ok: false,
      error: "This triage has no linked patient — register the patient before clerking.",
    };
  }
  const patientUserId = tr.patientUserId;

  try {
    // The intake holds what the triage does not: the complaint for the seed,
    // and the booking this visit answers (ADR 0101 R4), so ending the encounter
    // completes the appointment instead of leaving it `in_progress` for ever.
    const [intake] = tr.intakeId
      ? await db
          .select({
            pc: patientIntakes.presentingComplaint,
            appointmentId: patientIntakes.appointmentId,
          })
          .from(patientIntakes)
          .where(eq(patientIntakes.id, tr.intakeId))
          .limit(1)
      : [];
    const appointmentId = intake?.appointmentId ?? null;

    // The encounter already linked to this triage may be a `planned` ASSIGNMENT
    // (assign-a-doctor step) or already started. Treat an already-started one
    // as idempotent. Otherwise the patient's running visit today wins — the
    // doctor may have called them from the queue rail already — then the
    // planned one is started, and only then is a fresh one created (direct
    // start without a prior assignment).
    const [existing] = await db
      .select({ id: encounters.id, state: encounters.state })
      .from(encounters)
      .where(eq(encounters.triageRecordId, triageRecordId))
      .limit(1);
    if (existing && existing.state !== "planned") {
      return { ok: true, encounterId: existing.id, created: false };
    }

    let encounterId: string;
    let created: boolean;
    const open = await findOpenEncounterToday(patientUserId, tr.hospitalId);
    if (open) {
      await linkEncounterToVisit(open.id, triageRecordId, appointmentId);
      encounterId = open.id;
      created = false;
    } else if (existing) {
      // Start the assignment — the doctor opening it becomes the clinician, and
      // the visit starts NOW: `started_at` still held the assignment's insert
      // time, so a patient assigned yesterday read as seen since yesterday.
      await db
        .update(encounters)
        .set({
          state: "in_progress",
          clinicianUserId: scope.userId,
          startedAt: new Date(),
          appointmentId: sql`coalesce(${encounters.appointmentId}, ${appointmentId}::uuid)`,
        })
        .where(eq(encounters.id, existing.id));
      encounterId = existing.id;
      created = false;
    } else {
      const [enc] = await db
        .insert(encounters)
        .values({
          hospitalId: tr.hospitalId,
          patientUserId,
          clinicianUserId: scope.userId,
          departmentId: scope.departmentId ?? tr.departmentId ?? null,
          encounterType: "emergency",
          triageRecordId,
          appointmentId,
          state: "in_progress",
        })
        .returning({ id: encounters.id });
      encounterId = enc!.id;
      created = true;
    }

    // Seed the clerkship ONLY if there's no documentation yet (don't double-seed
    // when starting a previously-assigned encounter).
    const [hasDoc] = await db
      .select({ id: clinicalDocumentation.id })
      .from(clinicalDocumentation)
      .where(eq(clinicalDocumentation.encounterId, encounterId))
      .limit(1);
    if (hasDoc) return { ok: true, encounterId, created };

    const seeded = seedClerkshipFromTriage({
      // Presenting complaint comes from the linked intake (if any).
      presentingComplaint: intake?.pc ?? null,
      acuity: ACUITY_LABEL[tr.assignedLevel] ?? String(tr.assignedLevel),
      vitalsSummary: summariseVitals(tr.vitalsSnapshot),
    });
    // Best-effort: a seeding failure shouldn't undo the (already-created) encounter.
    const rec = await recordClerkshipVersion({
      encounterId,
      patientUserId,
      scope,
      clerkship: seeded,
      finalise: false,
    });
    if (rec.error) {
      logger.warn("openEncounterFromTriage: seed clerkship failed", { encounterId });
    }

    return { ok: true, encounterId, created };
  } catch (e) {
    logger.error("openEncounterFromTriage failed", { error: String(e) });
    return { ok: false, error: "Failed to open the encounter." };
  }
}

/** Honest, shape-agnostic summary of the triage vitals snapshot (scalars only). */
function summariseVitals(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(snapshot as Record<string, unknown>)) {
    if ((typeof v === "number" || typeof v === "string") && String(v).trim() !== "") {
      parts.push(`${k} ${v}`);
    }
    if (parts.length >= 8) break;
  }
  return parts.length ? parts.join(", ") : null;
}
