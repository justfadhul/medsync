import "server-only";

import type { EuStayInput, EuTrackingRow } from "./board";
import type { ObsFrequencyChoice } from "@/lib/clerking/plan/draft";
import type { EmrAccessBasis } from "@/lib/emr/access";
import type { WaitReason } from "@/lib/emr/closure";
import type { EmrDb, EmrTx } from "@/lib/emr/db";
import type { AcuityLevel } from "@/lib/triage/types";
import type { BoardBed, BoardData } from "@/lib/wards/board";
import { and, asc, eq, gte, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { admissions } from "@/db/schema/admissions";
import { clinicalPhiAccessLog } from "@/db/schema/doctor-workspace";
import { clinicalNotes } from "@/db/schema/emr";
import { encounterOrders, encounterResults } from "@/db/schema/encounter";
import { hospitalWards } from "@/db/schema/hospital-wards";
import { clinicalObservations } from "@/db/schema/nurse-workspace";
import { patientIntakes } from "@/db/schema/patient-intakes";
import { patientProfiles } from "@/db/schema/patient-profiles";
import { resusEpisodes } from "@/db/schema/resus";
import { hospitalBeds } from "@/db/schema/services-hub";
import { triageRecords } from "@/db/schema/triage";
import { users } from "@/db/schema/users";
import { bedAssignments } from "@/db/schema/ward-builder";
import { OBS_FREQUENCIES } from "@/lib/clerking/plan/draft";
import { resolveEmrAccess } from "@/lib/emr/access";
import { decrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { loadBedBoard } from "@/lib/wards/board";
import { euObservationLiveFor } from "@/lib/wards/feature";
import { euTracking } from "./board";
import { euStayLimitHours } from "./limit";

/*
 * The EU board read (ADR 0541, D10). The open stays come under RLS (eu_stays_select_scoped, through the viewer's
 * own session); everything else is an owner lookup for those stays only. Names only for EU staff (`viewer.names`,
 * from mayReadEuNames), each shown name logged once a day per viewer with a basis the viewer holds; without
 * `names`, no name, no MRN and nothing logged.
 */

export interface EuBoardData {
  board: BoardData;
  rows: EuTrackingRow[];
  needsAttention: ReturnType<typeof euTracking>["needsAttention"];
  limitHours: number;
  names: boolean;
}

type Surface = "nurse" | "admin" | "doctor";

/** A value phi_access_basis_check allows (0313): a chart basis, or eu_staff. */
export type EuNameBasis = EmrAccessBasis | "eu_staff";

/**
 * The basis a name reveal is logged with (R64): the viewer's chart basis for the patient when they hold one;
 * otherwise `eu_staff`, the EU staff D10 shows names to (the ward's nurses and in-charge, the rota's EU doctor,
 * the hospital admin). Never `assigned`, which is a nursing assignment for that patient.
 */
export function euNameBasis(chartBasis: EmrAccessBasis | null): EuNameBasis {
  return chartBasis ?? "eu_staff";
}

/** `content.plan.observations.frequency` of a note's content, as the desk reads it; anything else is null. */
export function planObsFrequency(content: unknown): ObsFrequencyChoice | null {
  const f = (content as { plan?: { observations?: { frequency?: unknown } } } | null)?.plan
    ?.observations?.frequency;
  return (OBS_FREQUENCIES as readonly unknown[]).includes(f) ? (f as ObsFrequencyChoice) : null;
}

type StayRow = {
  id: string;
  patient_user_id: string;
  status: "awaiting_space" | "in_space";
  decided_at: string;
  encounter_id: string | null;
  intake_id: string | null;
  space_wait_reason: WaitReason | null;
  admission_id: string | null;
};

export async function loadEuBoard(
  hospitalId: string,
  wardId: string,
  viewer: { userId: string; names: boolean; surface: Surface },
): Promise<EuBoardData | null> {
  if (!euObservationLiveFor(hospitalId)) return null;
  const board = await loadBedBoard(hospitalId, wardId, {
    patients: viewer.names ? "names" : "none",
  });
  if (!board || board.ward.wardType !== "emergency_observation") return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("eu_stays")
    .select(
      "id, patient_user_id, status, decided_at, encounter_id, intake_id, space_wait_reason, admission_id",
    )
    .eq("hospital_id", hospitalId)
    .eq("ward_id", wardId)
    .neq("status", "ended");
  if (error) throw new Error(`eu_stays read failed (${error.code})`);
  const stays = (data ?? []) as StayRow[];

  const now = new Date();
  const [inputs, limitHours] = await Promise.all([
    stayInputs(hospitalId, wardId, stays, viewer.names),
    euStayLimitHours(hospitalId),
  ]);

  // Every patient a name could show for: the stays, and the board's own lists.
  const named = [
    ...inputs.map((s) => s.patientUserId),
    ...board.waiting.map((w) => w.patientUserId),
    ...board.candidates.map((c) => c.patientUserId),
  ];
  const shown = viewer.names
    ? await auditEuNames(hospitalId, viewer, [...new Set(named)], now)
    : new Set<string>();
  const nameIf = (patientUserId: string, name: string | null) =>
    shown.has(patientUserId) ? name : null;
  const stayPatient = new Map(inputs.map((s) => [s.stayId, s.patientUserId]));
  const bedNames = (b: BoardBed): BoardBed => {
    const p = b.euStayId ? stayPatient.get(b.euStayId) : undefined;
    return b.patient
      ? { ...b, patient: { ...b.patient, name: p ? nameIf(p, b.patient.name) : null } }
      : b;
  };

  const tracking = euTracking(
    inputs.map((s) => ({ ...s, name: nameIf(s.patientUserId, s.name) })),
    now.getTime(),
    limitHours,
  );
  return {
    board: {
      ...board,
      beds: board.beds.map(bedNames),
      needsAttention: board.needsAttention.map(bedNames),
      waiting: board.waiting.map((w) => ({ ...w, name: nameIf(w.patientUserId, w.name) })),
      candidates: board.candidates.map((c) => ({ ...c, name: nameIf(c.patientUserId, c.name) })),
    },
    rows: tracking.rows,
    needsAttention: tracking.needsAttention,
    limitHours,
    names: viewer.names,
  };
}

/** Owner lookups for the stays that passed RLS: their ids, patients, intakes, encounters and admissions only. */
async function stayInputs(
  hospitalId: string,
  wardId: string,
  stays: StayRow[],
  names: boolean,
): Promise<EuStayInput[]> {
  if (!stays.length) return [];
  const ids = stays.map((s) => s.id);
  const patients = stays.map((s) => s.patient_user_id);
  const intakes = stays.flatMap((s) => (s.intake_id ? [s.intake_id] : []));
  const encs = stays.flatMap((s) => (s.encounter_id ? [s.encounter_id] : []));
  const adms = stays.flatMap((s) => (s.admission_id ? [s.admission_id] : []));
  const earliest = new Date(Math.min(...stays.map((s) => Date.parse(s.decided_at))));

  const [arrived, levels, notes, obs, released, admitted, resus, spaces, people] =
    await Promise.all([
      intakes.length
        ? db
            .select({ id: patientIntakes.id, at: patientIntakes.arrivedAt })
            .from(patientIntakes)
            .where(inArray(patientIntakes.id, intakes))
        : [],
      intakes.length
        ? db
            .select({ intakeId: triageRecords.intakeId, level: triageRecords.assignedLevel })
            .from(triageRecords)
            .where(inArray(triageRecords.intakeId, intakes))
            .orderBy(asc(triageRecords.triagedAt))
        : [],
      encs.length
        ? db
            .select({ encounterId: clinicalNotes.encounterId, c: clinicalNotes.contentCiphertext })
            .from(clinicalNotes)
            .where(and(inArray(clinicalNotes.encounterId, encs), isNull(clinicalNotes.addendumTo)))
            .orderBy(asc(clinicalNotes.recordedAt))
        : [],
      // Nursing obs only: a legacy row or a vital sign, never an entered-in-error one or a lab fact.
      db
        .select({
          patientUserId: clinicalObservations.patientUserId,
          at: sql<Date>`max(${clinicalObservations.recordedAt})`.mapWith(
            clinicalObservations.recordedAt,
          ),
        })
        .from(clinicalObservations)
        .where(
          and(
            eq(clinicalObservations.hospitalId, hospitalId),
            inArray(clinicalObservations.patientUserId, patients),
            gte(clinicalObservations.recordedAt, earliest),
            or(
              isNull(clinicalObservations.conceptId),
              eq(clinicalObservations.category, "vital_sign"),
            ),
            or(
              isNull(clinicalObservations.status),
              ne(clinicalObservations.status, "entered_in_error"),
            ),
          ),
        )
        .groupBy(clinicalObservations.patientUserId),
      // The clinic floor's "results back" query (lib/clinic-floor/load.ts): times only, no value.
      db
        .select({ patientUserId: encounterOrders.patientUserId, at: encounterResults.releasedAt })
        .from(encounterResults)
        .innerJoin(encounterOrders, eq(encounterOrders.id, encounterResults.orderId))
        .where(
          and(
            eq(encounterOrders.hospitalId, hospitalId),
            inArray(encounterOrders.patientUserId, patients),
            eq(encounterResults.qualityStatus, "released"),
            isNotNull(encounterResults.releasedAt),
            gte(encounterResults.releasedAt, earliest),
          ),
        ),
      adms.length
        ? db
            .select({
              id: admissions.id,
              status: admissions.status,
              decidedAt: admissions.decidedAt,
              wardName: hospitalWards.name,
            })
            .from(admissions)
            .innerJoin(hospitalWards, eq(hospitalWards.id, admissions.wardId))
            .where(inArray(admissions.id, adms))
        : [],
      db
        .select({ id: resusEpisodes.id, patientUserId: resusEpisodes.patientUserId })
        .from(resusEpisodes)
        .where(
          and(
            eq(resusEpisodes.hospitalId, hospitalId),
            eq(resusEpisodes.state, "active"),
            inArray(resusEpisodes.patientUserId, patients),
          ),
        ),
      db
        .select({
          stayId: bedAssignments.euStayId,
          label: hospitalBeds.label,
          startedAt: bedAssignments.startedAt,
          arrivedAt: bedAssignments.arrivedAt,
        })
        .from(bedAssignments)
        .innerJoin(hospitalBeds, eq(hospitalBeds.id, bedAssignments.bedId))
        .where(
          and(
            inArray(bedAssignments.euStayId, ids),
            eq(bedAssignments.wardId, wardId),
            isNull(bedAssignments.endedAt),
          ),
        ),
      names
        ? db
            .select({
              id: patientProfiles.id,
              mrn: patientProfiles.patientCode,
              name: users.fullName,
            })
            .from(patientProfiles)
            .leftJoin(users, eq(users.id, patientProfiles.id))
            .where(inArray(patientProfiles.id, patients))
        : [],
    ]);

  const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
  const level = new Map(levels.map((l) => [l.intakeId, l.level as AcuityLevel])); // latest wins
  const frequency = new Map<string, ObsFrequencyChoice>();
  for (const n of notes) {
    if (!n.encounterId) continue;
    let f: ObsFrequencyChoice | null = null;
    try {
      f = planObsFrequency(JSON.parse(decrypt(n.c)));
    } catch {
      // An unreadable note gives no frequency; the row stays.
    }
    if (f) frequency.set(n.encounterId, f); // the latest note with a Plan frequency wins
  }

  return stays.map((s): EuStayInput => {
    const decided = Date.parse(s.decided_at);
    const space = spaces.find((x) => x.stayId === s.id);
    const lastObs = obs.find((o) => o.patientUserId === s.patient_user_id)?.at;
    const a = admitted.find((x) => x.id === s.admission_id);
    const who = people.find((p) => p.id === s.patient_user_id);
    return {
      stayId: s.id,
      patientUserId: s.patient_user_id,
      wardId,
      status: s.status,
      decidedAt: new Date(decided).toISOString(),
      hospitalArrivedAt: iso(arrived.find((x) => x.id === s.intake_id)?.at),
      spaceStartedAt: iso(space?.startedAt),
      arriving: !!space && space.arrivedAt === null,
      bedLabel: space?.label ?? null,
      level: (s.intake_id && level.get(s.intake_id)) || null,
      obsFrequency: (s.encounter_id && frequency.get(s.encounter_id)) || null,
      lastObsAt: lastObs && new Date(lastObs).getTime() >= decided ? iso(lastObs) : null,
      resultsReady: released.some(
        (r) => r.patientUserId === s.patient_user_id && !!r.at && r.at.getTime() >= decided,
      ),
      admission:
        a && a.status !== "arrived"
          ? {
              wardName: a.wardName,
              decidedAt: a.decidedAt.toISOString(),
              status: a.status as "awaiting_bed" | "bed_allocated" | "cancelled",
            }
          : null,
      resusEpisodeId: resus.find((r) => r.patientUserId === s.patient_user_id)?.id ?? null,
      waitReason: s.space_wait_reason,
      name: who?.name ?? null,
      mrn: names ? (who?.mrn ?? null) : null,
    };
  });
}

/**
 * One clinical_phi_access_log row per shown patient per viewer per Kampala day (surface eu_board), with a basis
 * the viewer holds (euNameBasis). Returns the patients whose names may show. Fails closed but never breaks the
 * board: if the log cannot be written, no name shows (MRNs still do).
 */
async function auditEuNames(
  hospitalId: string,
  viewer: { userId: string },
  patients: string[],
  now: Date,
): Promise<Set<string>> {
  if (!patients.length) return new Set();
  // Kampala is UTC+3 all year: its midnight, as an instant.
  const day = new Date(
    `${new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10)}T00:00:00+03:00`,
  );
  try {
    return await (db as unknown as EmrDb).transaction(async (tx: EmrTx) => {
      const basis = new Map<string, EuNameBasis>();
      for (const p of patients) {
        const access = await resolveEmrAccess(tx, {
          userId: viewer.userId,
          patientUserId: p,
          hospitalId,
        });
        basis.set(p, euNameBasis(access.basis));
      }
      const done = new Set(
        (
          await tx
            .select({ id: clinicalPhiAccessLog.patientUserId })
            .from(clinicalPhiAccessLog)
            .where(
              and(
                eq(clinicalPhiAccessLog.clinicianUserId, viewer.userId),
                eq(clinicalPhiAccessLog.hospitalId, hospitalId),
                eq(clinicalPhiAccessLog.surface, "eu_board"),
                inArray(clinicalPhiAccessLog.patientUserId, [...basis.keys()]),
                gte(clinicalPhiAccessLog.createdAt, day),
              ),
            )
        ).map((r) => r.id),
      );
      const fresh = [...basis].filter(([p]) => !done.has(p));
      if (fresh.length)
        await tx.insert(clinicalPhiAccessLog).values(
          fresh.map(([patientUserId, accessBasis]) => ({
            hospitalId,
            clinicianUserId: viewer.userId,
            patientUserId,
            accessBasis,
            surface: "eu_board",
          })),
        );
      return new Set(basis.keys());
    });
  } catch (e) {
    logger.error("eu.board.phi_audit_failed", { reason: String(e) });
    return new Set();
  }
}
