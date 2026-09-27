import "server-only";

import type {
  Acuity,
  FlowDeath,
  FlowEncounter,
  FlowIdentity,
  FlowIntake,
  FlowResult,
  FlowResus,
  FlowTask,
  FlowTriage,
  ResusSection,
} from "./flow";
import type { LaneId } from "./lanes";
import type { EmrDb } from "@/lib/emr/db";
import type { BoardV2Row, ResusBoardV2Data } from "@/lib/resus/board-v2";
import { and, eq, gte, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";

import { endedWord } from "@/app/nurse/resus/[episodeId]/_components/v2/close-out-words";
import { db } from "@/db";
import { staffAffiliations } from "@/db/schema/clinician-profiles";
import { clinicalCosignPolicies, clinicalCosignRequests } from "@/db/schema/doctor-workspace";
import { clinicalNotes, diagnosticReports } from "@/db/schema/emr";
import { clinicalDocumentation, encounterOrders } from "@/db/schema/encounter";
import { entryTypes, patientIntakes } from "@/db/schema/patient-intakes";
import { patientProfiles } from "@/db/schema/patient-profiles";
import { resusEpisodes } from "@/db/schema/resus";
import { encounters } from "@/db/schema/scheduling";
import { triageRecords } from "@/db/schema/triage";
import { users } from "@/db/schema/users";
import { computeAgeYears } from "@/lib/age";
import { emrV1LiveFor } from "@/lib/emr/feature";
import { OPEN_RESULT_ORDER, openResultFor } from "@/lib/emr/read/results";
import { SENIOR_CADRES } from "@/lib/emr/write/facts";
import { fetchResusBoardV2, OPENABLE_LOOKBACK_MS } from "@/lib/resus/board-v2";
import { revealPatientIdentities } from "@/lib/scheduling/patient-identity";
import { resolveTriageAuthority } from "@/lib/triage/authority";
import { DEFAULT_TIME_ZONE, startOfLocalDay } from "@/supabase/functions/_shared/slots";
import { computeFlow, ENCOUNTER_IDLE_MS } from "./flow";

export { ENCOUNTER_IDLE_MS };

/**
 * The workspace's one query layer (prompt §6 "Data access"). It reads what the
 * flow projection needs for the viewer's hospital and department in a FIXED
 * number of round trips — three phases, whatever the row count
 * (tests/workspace/queries.test.ts counts them):
 *
 *   A  policies · open intakes · open + today's encounters · the resus v2 board
 *      (+ under EMR v1: results to acknowledge · note co-signs, E8)
 *   B  triage records · patient profiles · deaths (resus, encounter)
 *   C  one audited name reveal for the patients actually on the board
 *
 * Reads go through `db` like the four pages it replaces (Q2: app-level scope,
 * RLS is the backstop at the tables). Names are revealed AFTER the projection
 * decides who is on the board, so a patient the viewer never sees is never
 * decrypted or logged (Q9: one `clinical_phi_access_log` row per patient per
 * load, fail closed).
 */

/** Never more rows than a board can show; a department past this has a bigger problem. */
const ROW_CAP = 300;

export interface WorkspaceViewer {
  userId: string;
  hospitalId: string;
  departmentId: string;
  cadreCode: string;
}

export interface WorkspaceData {
  flow: FlowResult;
  board: ResusBoardV2Data;
  mayAssign: boolean;
  /** The scope the board was built for: Department only for whoever may assign (D8). */
  scope: "mine" | "department";
  nowIso: string;
  /** EMR v1 is on here: the record's lanes (E8) are shown. */
  emr: boolean;
}

const RESUS_DIED = ["died_after_cpr", "died_cpr_not_attempted"];

/** The open visits a doctor's board can hold — the triage worklist's own filter. */
function openIntakeWhere(viewer: WorkspaceViewer) {
  return and(
    eq(patientIntakes.hospitalId, viewer.hospitalId),
    inArray(patientIntakes.status, ["arrived", "awaiting_triage", "triaged"]),
    // ADR 0101 R1: sent straight to the clinic → the Schedule queue, not here (D12).
    or(isNull(patientIntakes.routedTo), ne(patientIntakes.routedTo, "clinic")),
    or(
      eq(patientIntakes.receivingDepartmentId, viewer.departmentId),
      isNull(patientIntakes.receivingDepartmentId),
    ),
  );
}

export async function loadWorkspace(args: {
  viewer: WorkspaceViewer;
  scope: "mine" | "department";
  /** Only these lanes' rows are returned and revealed (the encounter page's rail). */
  lanes?: LaneId[];
  /** Defaults to now (a server component may not call Date.now in render). */
  nowMs?: number;
}): Promise<WorkspaceData> {
  const { viewer, scope, lanes, nowMs = Date.now() } = args;
  const dayStart = startOfLocalDay(new Date(nowMs), DEFAULT_TIME_ZONE);
  // 0071's columns and tables exist only once the owner applied it, which EMR v1 waits for.
  const emr = emrV1LiveFor(viewer.hospitalId);
  // The encounter clinician's own drafts only: a reviewer's draft is theirs to sign, not the owner's.
  const ownDraft = sql`${clinicalNotes.encounterId} = ${encounters.id} and ${clinicalNotes.state} = 'draft' and ${clinicalNotes.authorUserId} = ${encounters.clinicianUserId}`;
  const unsignedDraft = sql`exists (select 1 from ${clinicalNotes} where ${ownDraft})`;

  /* ── A ─────────────────────────────────────────────────────────────── */
  const openIntakePatients = db
    .select({ id: patientIntakes.patientUserId })
    .from(patientIntakes)
    .where(openIntakeWhere(viewer));
  const activeResusPatients = db
    .select({ id: resusEpisodes.patientUserId })
    .from(resusEpisodes)
    .where(and(eq(resusEpisodes.hospitalId, viewer.hospitalId), eq(resusEpisodes.state, "active")));

  const [authority, intakeRows, encounterRows, board, tasks] = await Promise.all([
    triageAuthorityFor(viewer.hospitalId, viewer.cadreCode),
    db
      .select({
        id: patientIntakes.id,
        patientUserId: patientIntakes.patientUserId,
        status: patientIntakes.status,
        departmentId: patientIntakes.receivingDepartmentId,
        appointmentId: patientIntakes.appointmentId,
        arrivedAt: patientIntakes.arrivedAt,
        checkedInAt: patientIntakes.checkedInAt,
        complaint: patientIntakes.presentingComplaint,
        unknownLabel: patientIntakes.patientUnknownLabel,
        entryType: entryTypes.name,
        isEmergency: entryTypes.isEmergency,
      })
      .from(patientIntakes)
      .innerJoin(entryTypes, eq(entryTypes.code, patientIntakes.entryTypeCode))
      .where(openIntakeWhere(viewer))
      .limit(ROW_CAP),
    db
      .select({
        id: encounters.id,
        patientUserId: encounters.patientUserId,
        clinicianUserId: encounters.clinicianUserId,
        clinicianName: users.fullName,
        departmentId: encounters.departmentId,
        state: encounters.state,
        triageRecordId: encounters.triageRecordId,
        appointmentId: encounters.appointmentId,
        createdAt: encounters.createdAt,
        startedAt: encounters.startedAt,
        endedAt: encounters.endedAt,
        updatedAt: encounters.updatedAt,
        lastDocAt:
          sql`(select max(${clinicalDocumentation.createdAt}) from ${clinicalDocumentation} where ${clinicalDocumentation.encounterId} = ${encounters.id})`.mapWith(
            clinicalDocumentation.createdAt,
          ),
        lastActivityAt: (emr ? sql`${encounters.lastActivityAt}` : sql`null`).mapWith(
          encounters.lastActivityAt,
        ),
        unsignedNoteAt: (emr
          ? sql`(select max(${clinicalNotes.updatedAt}) from ${clinicalNotes} where ${ownDraft})`
          : sql`null`
        ).mapWith(clinicalNotes.updatedAt),
      })
      .from(encounters)
      .leftJoin(users, eq(users.id, encounters.clinicianUserId))
      .where(
        and(
          eq(encounters.hospitalId, viewer.hospitalId),
          or(
            and(
              inArray(encounters.state, ["planned", "in_progress"]),
              or(
                eq(encounters.clinicianUserId, viewer.userId),
                // Whoever holds an open visit or a running resus: decides Unassigned vs assigned.
                inArray(encounters.patientUserId, openIntakePatients),
                inArray(encounters.patientUserId, activeResusPatients),
                scope === "department"
                  ? eq(encounters.departmentId, viewer.departmentId)
                  : undefined,
              ),
            ),
            and(
              eq(encounters.state, "completed"),
              gte(encounters.endedAt, dayStart),
              scope === "department"
                ? or(
                    eq(encounters.clinicianUserId, viewer.userId),
                    eq(encounters.departmentId, viewer.departmentId),
                  )
                : eq(encounters.clinicianUserId, viewer.userId),
            ),
            // §5.11: a visit ended, any day, with a note still unsigned (the viewer's own).
            emr
              ? and(
                  eq(encounters.state, "completed"),
                  eq(encounters.clinicianUserId, viewer.userId),
                  unsignedDraft,
                )
              : undefined,
          ),
        ),
      )
      .limit(ROW_CAP),
    fetchResusBoardV2({ hospitalId: viewer.hospitalId, clinicianUserId: viewer.userId, nowMs }),
    emr ? loadEmrTasks(db as unknown as EmrDb, viewer) : ([] as FlowTask[]),
  ]);

  const resus = resusFromBoard(board);
  const patientIds = [
    ...new Set(
      [
        ...intakeRows.map((r) => r.patientUserId),
        ...encounterRows.map((r) => r.patientUserId),
        ...resus.map((r) => r.patientId),
        ...tasks.map((t) => t.patientId),
      ].filter((id): id is string => !!id),
    ),
  ];
  const intakeIds = intakeRows.map((r) => r.id);
  const triageIds = [
    ...new Set(encounterRows.map((r) => r.triageRecordId).filter((id): id is string => !!id)),
  ];

  /* ── B ─────────────────────────────────────────────────────────────── */
  const [triageRows, profileRows, deaths] = await Promise.all([
    intakeIds.length || triageIds.length
      ? db
          .select({
            id: triageRecords.id,
            intakeId: triageRecords.intakeId,
            patientUserId: triageRecords.patientUserId,
            level: triageRecords.assignedLevel,
            triagedAt: triageRecords.triagedAt,
            byName: users.fullName,
            lifeThreat: triageRecords.lifeThreatFastTracked,
            breakdown: triageRecords.computedBreakdown,
            hasResus: sql<boolean>`exists (select 1 from ${resusEpisodes} where ${resusEpisodes.triageRecordId} = ${triageRecords.id})`,
          })
          .from(triageRecords)
          .leftJoin(users, eq(users.id, triageRecords.triagedByUserId))
          .where(
            and(
              eq(triageRecords.hospitalId, viewer.hospitalId),
              or(
                intakeIds.length ? inArray(triageRecords.intakeId, intakeIds) : undefined,
                triageIds.length ? inArray(triageRecords.id, triageIds) : undefined,
              ),
            ),
          )
      : [],
    patientIds.length
      ? db
          .select({
            id: patientProfiles.id,
            code: patientProfiles.patientCode,
            first: patientProfiles.firstNameEncrypted,
            surname: patientProfiles.surnameEncrypted,
            sex: patientProfiles.sex,
            dateOfBirth: patientProfiles.dateOfBirth,
          })
          .from(patientProfiles)
          .where(inArray(patientProfiles.id, patientIds))
      : [],
    deathsFor(viewer.hospitalId, patientIds),
  ]);

  const now = new Date(nowMs);
  const patients: Record<string, FlowIdentity> = {};
  for (const p of profileRows) {
    patients[p.id] = {
      name: null, // revealed in C, only for the patients the board shows
      code: p.code,
      ageYears: computeAgeYears(p.dateOfBirth ? String(p.dateOfBirth) : null, now),
      sex: p.sex,
      unknownLabel: null,
    };
  }

  // D8: Department scope is for whoever may assign. Phase A may have read the
  // department already; FW-11 then keeps colleagues' items off a Mine board.
  const boardScope = authority.mayTriage ? scope : "mine";
  const flow = computeFlow({
    nowMs,
    dayStartMs: dayStart.getTime(),
    timeZone: DEFAULT_TIME_ZONE,
    viewer: {
      userId: viewer.userId,
      departmentId: viewer.departmentId,
      scope: boardScope,
      mayAssign: authority.mayTriage,
    },
    settings: { encounterIdleMs: ENCOUNTER_IDLE_MS, l1LookbackMs: OPENABLE_LOOKBACK_MS },
    // Law 5: no wait target is CSO-signed yet, so none reaches the engine (D4).
    signedRefs: { waitTargets: [] },
    patients,
    intakes: intakeRows.map(
      (r): FlowIntake => ({
        id: r.id,
        patientId: r.patientUserId,
        status: r.status as FlowIntake["status"],
        departmentId: r.departmentId,
        appointmentId: r.appointmentId,
        presentAtMs: (r.checkedInAt ?? r.arrivedAt).getTime(),
        complaint: r.complaint,
        entryType: r.entryType,
        isEmergency: r.isEmergency,
        unknownLabel: r.unknownLabel,
      }),
    ),
    triages: triageRows.map(
      (r): FlowTriage => ({
        id: r.id,
        intakeId: r.intakeId,
        patientId: r.patientUserId,
        level: r.level as Acuity,
        atMs: r.triagedAt.getTime(),
        byName: r.byName,
        lifeThreat: r.lifeThreat,
        why: firstReason(r.breakdown),
        hasResus: Boolean(r.hasResus),
      }),
    ),
    encounters: encounterRows.map(
      (r): FlowEncounter => ({
        id: r.id,
        patientId: r.patientUserId,
        clinicianId: r.clinicianUserId,
        clinicianName: r.clinicianName,
        departmentId: r.departmentId,
        state: r.state as FlowEncounter["state"],
        triageRecordId: r.triageRecordId,
        appointmentId: r.appointmentId,
        createdAtMs: r.createdAt.getTime(),
        startedAtMs: r.startedAt.getTime(),
        endedAtMs: r.endedAt?.getTime() ?? null,
        // HARMONISATION §2: max(updated_at, latest doc, last_activity_at).
        lastActivityAtMs: Math.max(
          r.updatedAt.getTime(),
          r.lastDocAt?.getTime() ?? 0,
          r.lastActivityAt?.getTime() ?? 0,
        ),
        unsignedNoteAtMs: r.unsignedNoteAt?.getTime() ?? null,
      }),
    ),
    resus,
    deaths,
    tasks,
  });

  /* ── C ─────────────────────────────────────────────────────────────── */
  const rows = lanes ? flow.rows.filter((r) => lanes.includes(r.lane)) : flow.rows;
  const shown = new Set(rows.map((r) => r.patientId).filter((id): id is string => !!id));
  const revealed = await revealPatientIdentities({
    viewer: { userId: viewer.userId, hospitalId: viewer.hospitalId },
    surface: "doctor_workspace",
    clinical: true,
    patients: profileRows
      .filter((p) => shown.has(p.id))
      .map((p) => ({
        patientUserId: p.id,
        patientCode: p.code,
        firstNameEncrypted: p.first,
        surnameEncrypted: p.surname,
        sex: p.sex,
        dateOfBirth: p.dateOfBirth ? String(p.dateOfBirth) : null,
        avatarPath: null, // two identifiers are the name and the MRN; no photo fetch per row
      })),
  });

  return {
    flow: {
      ...flow,
      rows: rows.map((row) =>
        row.patientId && revealed.get(row.patientId)?.displayName
          ? {
              ...row,
              identity: { ...row.identity, name: revealed.get(row.patientId)!.displayName },
            }
          : row,
      ),
    },
    board,
    mayAssign: authority.mayTriage,
    scope: boardScope,
    nowIso: now.toISOString(),
    emr,
  };
}

const RELEASED = ["final", "amended", "corrected"];

/**
 * The E8 lane sources, in two reads (EMR v1 only):
 *  - released results (final/amended/corrected) on events-lifecycle orders whose CURRENT version has
 *    no acknowledgement, where I placed the order or cover its orderer (D-EMR-07). Legacy `resulted`
 *    orders never enter. ponytail: "cover" = the orderer holds an active affiliation in my department
 *    here — lib/emr/write/results.ts requireResponsible's rule; a cover rota replaces both.
 *  - pending `sign_note` co-sign requests I may answer: a co-signing cadre, not my own request, and
 *    requested from my department.
 * A restricted result or note is never named on a board (label null).
 */
export async function loadEmrTasks(database: EmrDb, viewer: WorkspaceViewer): Promise<FlowTask[]> {
  const r = diagnosticReports;
  const o = encounterOrders;
  const c = clinicalCosignRequests;
  const [results, cosigns] = await Promise.all([
    database
      .select({
        id: r.id,
        patientUserId: r.patientUserId,
        critical: r.critical,
        at: r.recordedAt,
        encounterId: o.encounterId,
        text: o.text,
        restricted: sql<boolean>`(${r.sensitivity} <> 'standard' or ${o.sensitivity} <> 'standard')`,
      })
      .from(r)
      .innerJoin(o, eq(o.id, r.orderId))
      .where(
        and(
          eq(r.hospitalId, viewer.hospitalId),
          eq(o.lifecycle, "events"),
          inArray(r.status, RELEASED),
          // The current version of the chain, and nobody has acknowledged that version.
          sql`not exists (select 1 from ${diagnosticReports} n where n.logical_id = ${r.logicalId} and n.version > ${r.version})`,
          // Unacknowledged and mine (placed or covered), or forwarded to me.
          openResultFor(viewer),
        ),
      )
      .orderBy(...OPEN_RESULT_ORDER)
      .limit(ROW_CAP),
    // cosignNote's own cadre rule, so the lane never offers what the write refuses.
    SENIOR_CADRES.includes(viewer.cadreCode)
      ? database
          .select({
            id: c.id,
            patientUserId: c.patientUserId,
            at: c.createdAt,
            encounterId: clinicalNotes.encounterId,
            noteType: clinicalNotes.noteType,
            sensitivity: clinicalNotes.sensitivity,
          })
          .from(c)
          .innerJoin(clinicalNotes, eq(clinicalNotes.id, c.noteId))
          .innerJoin(staffAffiliations, eq(staffAffiliations.id, c.requestedByAffiliationId))
          .where(
            and(
              eq(c.hospitalId, viewer.hospitalId),
              eq(c.actionKind, "sign_note"),
              eq(c.state, "pending_review"),
              ne(c.requestedByUserId, viewer.userId),
              eq(staffAffiliations.departmentId, viewer.departmentId),
            ),
          )
          .limit(ROW_CAP)
      : [],
  ]);
  return [
    ...results.map(
      (x): FlowTask => ({
        id: x.id,
        patientId: x.patientUserId,
        kind: x.critical ? "critical_result" : "result_to_review",
        encounterId: x.encounterId,
        atMs: x.at.getTime(),
        label: x.restricted ? null : x.text,
      }),
    ),
    ...cosigns.map(
      (x): FlowTask => ({
        id: x.id,
        patientId: x.patientUserId,
        kind: "cosign",
        encounterId: x.encounterId,
        atMs: x.at.getTime(),
        label:
          x.sensitivity === "standard"
            ? `${x.noteType[0]!.toUpperCase()}${x.noteType.slice(1).replace(/_/g, " ")} note`
            : null,
      }),
    ),
  ];
}

/** Who may triage and assign here (D8): this hospital's `clinical_cosign_policies`, resolved. */
export async function triageAuthorityFor(hospitalId: string, cadreCode: string) {
  const rows = await db
    .select({
      cadreCode: clinicalCosignPolicies.cadreCode,
      actionKind: clinicalCosignPolicies.actionKind,
      requirement: clinicalCosignPolicies.requirement,
    })
    .from(clinicalCosignPolicies)
    .where(
      and(
        eq(clinicalCosignPolicies.hospitalId, hospitalId),
        inArray(clinicalCosignPolicies.actionKind, ["triage_patient", "triage_downgrade"]),
      ),
    );
  return resolveTriageAuthority(
    cadreCode,
    rows.map((r) => ({
      cadreCode: r.cadreCode,
      actionKind: r.actionKind,
      requirement: r.requirement as "allowed" | "cosign_required" | "blocked",
    })),
  );
}

/**
 * D2, read and never copied: a death is what the resus record (a confirmed
 * death, a died outcome, the mortuary) or an encounter's `deceased`
 * disposition says. Corrections stay in those records, so nothing here can
 * drift from them. Two reads, in parallel.
 */
export async function deathsFor(hospitalId: string, patientIds: string[]): Promise<FlowDeath[]> {
  if (patientIds.length === 0) return [];
  const [resus, encounterRows] = await Promise.all([
    db
      .select({
        id: resusEpisodes.id,
        patientUserId: resusEpisodes.patientUserId,
        deathConfirmedAt: resusEpisodes.deathConfirmedAt,
        endedAt: resusEpisodes.endedAt,
        byName: users.fullName,
      })
      .from(resusEpisodes)
      .leftJoin(users, eq(users.id, resusEpisodes.closedBy))
      .where(
        and(
          eq(resusEpisodes.hospitalId, hospitalId),
          inArray(resusEpisodes.patientUserId, patientIds),
          or(
            isNotNull(resusEpisodes.deathConfirmedAt),
            inArray(resusEpisodes.outcomeCode, RESUS_DIED),
            inArray(resusEpisodes.disposition, ["mortuary", "deceased"]),
          ),
        ),
      ),
    db
      .select({
        id: encounters.id,
        patientUserId: encounters.patientUserId,
        endedAt: encounters.endedAt,
        updatedAt: encounters.updatedAt,
        byName: users.fullName,
      })
      .from(encounters)
      .leftJoin(users, eq(users.id, encounters.clinicianUserId))
      .where(
        and(
          eq(encounters.hospitalId, hospitalId),
          inArray(encounters.patientUserId, patientIds),
          eq(encounters.disposition, "deceased"),
        ),
      ),
  ]);
  return [
    ...resus
      .filter((d) => d.patientUserId && (d.deathConfirmedAt ?? d.endedAt))
      .map((d) => ({
        patientId: d.patientUserId!,
        atMs: (d.deathConfirmedAt ?? d.endedAt)!.getTime(),
        source: "resus" as const,
        sourceId: d.id,
        byName: d.byName,
      })),
    ...encounterRows.map((d) => ({
      patientId: d.patientUserId,
      atMs: (d.endedAt ?? d.updatedAt).getTime(),
      source: "encounter" as const,
      sourceId: d.id,
      byName: d.byName,
    })),
  ];
}

/** The resus v2 board's own sections, as the projection's episodes (no second board). */
export function resusFromBoard(board: ResusBoardV2Data): FlowResus[] {
  const live = (section: ResusSection) => (r: BoardV2Row) =>
    ({
      id: r.episodeId,
      patientId: r.patientUserId,
      section,
      mode: r.mode,
      trigger: r.trigger,
      startedAtMs: Date.parse(r.startedAtIso),
      lastActivityAtMs: Date.parse(r.lastActivityAtIso),
      endedAtMs: null,
      arrestSinceMs: r.arrest ? Date.parse(r.arrest.sinceIso) : null,
      leader: r.leader,
      idleLabel: r.idleLabel,
      outcome: null,
      worst: r.worst,
    }) satisfies FlowResus;
  return [
    ...board.arrest.map(live("arrest")),
    ...board.active.map(live("active")),
    ...board.boarding.map(live("boarding")),
    ...board.needsClosing.map(live("needs_closing")),
    ...board.ended.map((e): FlowResus => {
      const at = e.endedAtIso ? Date.parse(e.endedAtIso) : Date.parse(board.nowIso);
      return {
        id: e.episodeId,
        patientId: e.patientUserId,
        section: "ended",
        mode: "Ended",
        trigger: "Resus",
        startedAtMs: at,
        lastActivityAtMs: at,
        endedAtMs: at,
        arrestSinceMs: null,
        leader: null,
        idleLabel: null,
        outcome: endedWord(e),
        worst: null,
      };
    }),
  ];
}

/** The triage engine's first stated reason, or the Step-0 life threat (rapid Red). */
function firstReason(breakdown: unknown): string | null {
  const b = breakdown as { lifeThreatReason?: unknown; reasoning?: unknown } | null;
  if (typeof b?.lifeThreatReason === "string") return b.lifeThreatReason;
  if (Array.isArray(b?.reasoning) && typeof b.reasoning[0] === "string") return b.reasoning[0];
  return null;
}
