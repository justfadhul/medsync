import "server-only";

import type {
  DeskEpisode,
  DeskInitialData,
  DeskSnapshot,
} from "@/app/nurse/resus/[episodeId]/_components/v2/types";
import type { BayProfile, CareLevel, CareUnit, EpisodePhase, OutcomeCode } from "@/lib/resus/model";
import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { hospitalDepartments } from "@/db/schema/hospital-departments";
import {
  hospitalCareUnits,
  hospitalResusSettings,
  resusAfterDeathTasks,
  resusBayProfiles,
  resusDebriefs,
  resusEpisodes,
  resusTimelineEvents,
} from "@/db/schema/resus";
import { users } from "@/db/schema/users";
import { resolveCapabilities } from "@/lib/doctor/capabilities";
import { emrV1LiveFor } from "@/lib/emr/feature";
import { loadTestMenu } from "@/lib/emr/read/orders";
import { stopAuthority } from "@/lib/resus/als/termination";
import { canAdminCloseResus } from "@/lib/resus/authority";
import { fetchResusPatient } from "@/lib/resus/board";
import { fetchResusResponders, fetchResusRoster } from "@/lib/resus/record";
import { requireResusScope } from "@/lib/resus/scope";
import { fetchAllResusEvents } from "@/lib/resus/v2-record";

type EpisodeRow = typeof resusEpisodes.$inferSelect & { departmentName: string | null };
const iso = (d: Date | null) => (d ? d.toISOString() : null);

function toDeskEpisode(ep: EpisodeRow): DeskEpisode {
  return {
    id: ep.id,
    state: ep.state as DeskEpisode["state"],
    phase: ep.phase as EpisodePhase,
    currentArrestSeq: ep.currentArrestSeq,
    triggerKind: ep.triggerKind,
    triggerReason: ep.triggerReason,
    startedAtIso: ep.startedAt.toISOString(),
    endedAtIso: iso(ep.endedAt),
    lastActivityAtIso: iso(ep.lastActivityAt),
    arrestDetectedAtIso: iso(ep.arrestDetectedAt),
    deathConfirmedAtIso: iso(ep.deathConfirmedAt),
    disposition: ep.disposition,
    outcomeCode: (ep.outcomeCode as OutcomeCode | null) ?? null,
    closureKind: (ep.closureKind as "bedside" | "administrative" | null) ?? null,
    cancelReason: ep.cancelReason,
    suggestedLevel: (ep.suggestedLevel as CareLevel | null) ?? null,
    chosenLevel: (ep.chosenLevel as CareLevel | null) ?? null,
    destinationUnitId: ep.destinationUnitId,
    dispositionDecidedAtIso: iso(ep.dispositionDecidedAt),
    bayProfileId: ep.bayProfileId,
    triageRecordId: ep.triageRecordId,
    departmentName: ep.departmentName ?? null,
  };
}

async function episodeRow(hospitalId: string, episodeId: string): Promise<EpisodeRow | null> {
  const [row] = await db
    .select({ ep: resusEpisodes, departmentName: hospitalDepartments.name })
    .from(resusEpisodes)
    .leftJoin(hospitalDepartments, eq(hospitalDepartments.id, resusEpisodes.departmentId))
    .where(and(eq(resusEpisodes.id, episodeId), eq(resusEpisodes.hospitalId, hospitalId)))
    .limit(1);
  return row ? { ...row.ep, departmentName: row.departmentName } : null;
}

/** The team + after-close records of an episode already scoped to the caller. */
async function snapshotParts(ep: EpisodeRow): Promise<DeskSnapshot> {
  const [roster, responders, tasks, debriefs, recorders] = await Promise.all([
    fetchResusRoster(ep.id),
    fetchResusResponders(ep.id),
    db
      .select({
        taskId: resusAfterDeathTasks.taskId,
        state: resusAfterDeathTasks.state,
        recordedAt: resusAfterDeathTasks.recordedAt,
      })
      .from(resusAfterDeathTasks)
      .where(eq(resusAfterDeathTasks.episodeId, ep.id))
      .orderBy(asc(resusAfterDeathTasks.recordedAt)),
    db.select().from(resusDebriefs).where(eq(resusDebriefs.episodeId, ep.id)).limit(1),
    db
      .selectDistinct({ userId: users.id, fullName: users.fullName })
      .from(resusTimelineEvents)
      .innerJoin(users, eq(users.id, resusTimelineEvents.recordedByUserId))
      .where(eq(resusTimelineEvents.episodeId, ep.id)),
  ]);
  const d = debriefs[0];
  return {
    episode: toDeskEpisode(ep),
    roster,
    responders,
    recorders,
    afterDeathTasks: tasks.map((t) => ({
      taskId: t.taskId,
      state: t.state as DeskSnapshot["afterDeathTasks"][number]["state"],
      recordedAtIso: t.recordedAt.toISOString(),
    })),
    debrief: d
      ? {
          attendeeCount: d.attendeeCount,
          wentWell: d.wentWell ?? "",
          toImprove: d.toImprove ?? "",
          actions: d.actions ?? "",
          equipmentIssues: d.equipmentIssues ?? "",
          welfareCheckDone: d.welfareCheckDone,
          status: d.status === "submitted" ? "submitted" : "draft",
          updatedAtIso: d.updatedAt.toISOString(),
        }
      : null,
  };
}

/**
 * The mutable parts of the desk (episode row, team, after-close records) for
 * an episode in the caller's hospital — no patient-name reveal, so re-reading
 * it on every record change writes no audit row. Null when out of scope.
 */
export async function loadDeskSnapshotV2(args: {
  hospitalId: string;
  episodeId: string;
}): Promise<DeskSnapshot | null> {
  const ep = await episodeRow(args.hospitalId, args.episodeId);
  return ep ? snapshotParts(ep) : null;
}

/**
 * Resus Desk v2 — everything the desk needs, loaded once per page render
 * (GATE A §2). The patient name goes through the audited reveal
 * (fetchResusPatient). Returns null when the episode is not in the caller's
 * hospital (the page then 404s).
 */
export async function loadDeskV2(args: {
  episodeId: string;
  basePath: string;
}): Promise<DeskInitialData | null> {
  const scope = await requireResusScope(`${args.basePath}/${args.episodeId}`);
  const ep = await episodeRow(scope.hospitalId, args.episodeId);
  if (!ep) return null;

  const [patient, events, snapshot, caps, settingsRow, bays, units, mayAdminClose, testMenu] =
    await Promise.all([
      fetchResusPatient({
        patientUserId: ep.patientUserId,
        hospitalId: scope.hospitalId,
        clinicianUserId: scope.userId,
      }),
      fetchAllResusEvents(args.episodeId),
      snapshotParts(ep),
      resolveCapabilities({
        hospitalId: scope.hospitalId,
        departmentId: scope.departmentId,
        cadreCode: scope.cadreCode,
      }),
      db
        .select()
        .from(hospitalResusSettings)
        .where(eq(hospitalResusSettings.hospitalId, scope.hospitalId))
        .limit(1),
      db
        .select()
        .from(resusBayProfiles)
        .where(
          and(eq(resusBayProfiles.hospitalId, scope.hospitalId), eq(resusBayProfiles.active, true)),
        )
        .orderBy(asc(resusBayProfiles.bayLabel)),
      db
        .select()
        .from(hospitalCareUnits)
        .where(eq(hospitalCareUnits.hospitalId, scope.hospitalId))
        .orderBy(asc(hospitalCareUnits.name)),
      canAdminCloseResus(scope.userId, scope.hospitalId, scope.cadreCode),
      // A5: the close-out's outstanding tests become EMR suggestions; only asked for under EMR v1.
      emrV1LiveFor(scope.hospitalId) ? loadTestMenu(db, scope.hospitalId) : null,
    ]);
  const settings = settingsRow[0];
  const bayProfiles: BayProfile[] = bays.map((b) => ({
    id: b.id,
    label: b.deviceModel ? `${b.bayLabel} · ${b.deviceModel}` : b.bayLabel,
    waveform: b.waveform as BayProfile["waveform"],
    energySequenceJ: b.energySequenceJ ?? null,
    capnography: b.capnography,
    ultrasound: b.ultrasound,
    mechanicalCpr: b.mechanicalCpr,
    ecpr: b.ecpr,
  }));
  const careUnits: CareUnit[] = units.map((u) => ({
    id: u.id,
    name: u.name,
    unitType: u.unitType as CareUnit["unitType"],
    ageGroup: u.ageGroup as CareUnit["ageGroup"],
    capabilities: (
      [
        ["continuous_ecg", u.continuousEcg],
        ["arterial_line", u.arterialLine],
        ["vasopressors", u.vasopressors],
        ["niv_cpap", u.nivCpap],
        ["invasive_ventilation", u.invasiveVentilation],
        ["rrt", u.rrt],
      ] as const
    )
      .filter(([, on]) => on)
      .map(([c]) => c),
    active: u.active,
  }));

  return {
    ...snapshot,
    patient,
    events,
    me: {
      userId: scope.userId,
      fullName: scope.fullName,
      cadreCode: scope.cadreCode,
      cadreName: scope.cadreName,
      hospitalName: scope.hospitalName,
      departmentName: scope.departmentName,
      leaderRecommended: scope.leaderRecommended,
      stopRecommended: stopAuthority(scope.cadreCode).recommended,
      canAdminClose: mayAdminClose,
      prescribeAuthority: {
        routine: caps.prescription_routine,
        controlled: caps.prescription_controlled,
      },
    },
    settings: {
      antiarrhythmic:
        (settings?.antiarrhythmic as "amiodarone" | "lidocaine" | undefined) ?? "amiodarone",
      rhythmCheckTone: settings?.rhythmCheckTone ?? true,
      metronome: settings?.metronome ?? false,
    },
    bayProfiles,
    careUnits,
    testMenu,
    serverTimeIso: new Date().toISOString(),
    basePath: args.basePath,
  };
}
