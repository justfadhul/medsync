import "server-only";

import type { ResusOpenable } from "@/lib/resus/board";
import type { CareLevel, EpisodePhase, OutcomeCode, StepVisual } from "@/lib/resus/model";
import type { AbcdeLetter, TimelineEvent } from "@/lib/resus/types";
import { and, asc, desc, eq, gte, inArray, isNull, or } from "drizzle-orm";

import { db } from "@/db";
import { clinicalPhiAccessLog } from "@/db/schema/doctor-workspace";
import { patientProfiles } from "@/db/schema/patient-profiles";
import { hospitalCareUnits, resusEpisodes, resusRoleAssignments } from "@/db/schema/resus";
import { triageRecords } from "@/db/schema/triage";
import { users } from "@/db/schema/users";
import { computeAgeYears } from "@/lib/age";
import { decrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { formatIdle, idleClass } from "@/lib/resus/closeout/idle";
import { sendIdleNotice } from "@/lib/resus/mobilise";
import { arrestActive } from "@/lib/resus/survey/context";
import { computeStepStates } from "@/lib/resus/survey/floor";
import { fetchActiveResusEvents } from "@/lib/resus/v2-record";
import { buildResusVitals } from "@/lib/resus/vitals";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Resus board v2 (prompt §5.13, §5.14; GATE A §9). Six sections for the
 * clinician's hospital: arrest in progress, active, awaiting bed, needs closing
 * (idle ≥ 2 h), Red/L1 openable, recently ended (24 h). Patient names are
 * decrypted + audited exactly like v1 (basis department_recent, surface
 * resus_board). A board render also sends the 12 h idle notice lazily (at most
 * five per render, once per episode) — nothing ever auto-closes.
 */

export interface BoardV2Row {
  episodeId: string;
  /** The patient, so the doctor workspace can put every episode on one row per patient. */
  patientUserId: string | null;
  displayName: string | null;
  ageYears: number | null;
  trigger: string;
  phase: EpisodePhase;
  /** An arrest is running now (phase arrest and no ROSC / stop since). */
  inArrest: boolean;
  /** The mode in words: "Survey", "Arrest", "Resuscitation stopped", "Post-ROSC", … */
  mode: string;
  startedAtIso: string;
  lastActivityAtIso: string;
  /** "No activity 3 h 5 min" once idle (CO-IDLE-01), else null. */
  idleLabel: string | null;
  /** Idle ≥ 24 h (CO-IDLE-03) — the viewer's authority is checked separately. */
  adminCloseOpen: boolean;
  arrest: { seq: number; sinceIso: string } | null;
  /** The worst step on the survey bar (null = not computed for this row). */
  worst: { step: AbcdeLetter; visual: StepVisual } | null;
  lastVitals: { text: string; atIso: string } | null;
  leader: string | null;
  boarding: {
    destination: string | null;
    level: CareLevel | null;
    unitName: string | null;
    sinceIso: string | null;
  } | null;
}

export interface BoardV2Ended {
  episodeId: string;
  patientUserId: string | null;
  displayName: string | null;
  ageYears: number | null;
  state: "concluded" | "cancelled";
  outcomeCode: OutcomeCode | null;
  closureKind: "bedside" | "administrative" | null;
  disposition: string | null;
  endedAtIso: string | null;
}

export interface ResusBoardV2Data {
  hospitalId: string;
  nowIso: string;
  arrest: BoardV2Row[];
  active: BoardV2Row[];
  boarding: BoardV2Row[];
  needsClosing: BoardV2Row[];
  openable: ResusOpenable[];
  ended: BoardV2Ended[];
}

/** Episodes whose events are loaded for step states (the rest show without them). */
const LIVE_EVENT_CAP = 30;
const IDLE_NOTICES_PER_RENDER = 5;
const DAY_MS = 24 * 3600_000;
/** The "Red / L1 — open a resus" lookback. The doctor workspace reuses it (FW-5): no second number. */
export const OPENABLE_LOOKBACK_MS = DAY_MS;

const MODE_WORD: Record<EpisodePhase, string> = {
  survey: "Survey",
  arrest: "Arrest",
  post_rosc: "Post-ROSC",
  boarding: "Boarding",
};

const TRIGGER_LABEL: Record<string, string> = {
  triage_red: "Triage Red",
  step0_life_threat: "Step-0 life threat",
  in_resus_deterioration: "In-resus deterioration",
};

/** Worst first — an unassessed step is never read as safe. */
const VISUAL_RANK: Record<StepVisual, number> = {
  clear: 0,
  addressed: 1,
  pending: 2,
  threatened: 3,
  active_threat: 4,
};

function safeName(
  patientUserId: string | null,
  first: string | null,
  surname: string | null,
): string | null {
  if (!patientUserId || !first || !surname) return null;
  try {
    return `${decrypt(first)} ${decrypt(surname)}`.trim();
  } catch (e) {
    logger.warn("resus.board_v2.decrypt_failed", { reason: String(e) });
    return null;
  }
}

function worstStep(events: TimelineEvent[], ageYears: number | null, nowMs: number) {
  const states = computeStepStates(events, { ageYears, nowMs });
  let worst: BoardV2Row["worst"] = null;
  for (const s of states)
    if (!worst || VISUAL_RANK[s.visual] > VISUAL_RANK[worst.visual])
      worst = { step: s.step, visual: s.visual };
  return worst;
}

function vitalsLine(events: TimelineEvent[]): BoardV2Row["lastVitals"] {
  const v = buildResusVitals(events);
  if (!v.lastAt) return null;
  const l = v.latest;
  const parts = [
    l.hr != null ? `HR ${l.hr}` : null,
    l.systolicBp != null
      ? `BP ${l.systolicBp}${l.diastolicBp != null ? `/${l.diastolicBp}` : ""}`
      : null,
    l.spo2 != null ? `SpO₂ ${l.spo2}%` : null,
    l.rr != null ? `RR ${l.rr}` : null,
  ].filter((p): p is string => p !== null);
  return parts.length ? { text: parts.join(" · "), atIso: v.lastAt } : null;
}

function latestOf(events: TimelineEvent[], match: (e: TimelineEvent) => boolean) {
  let hit: TimelineEvent | null = null;
  for (const e of events) if (match(e) && (!hit || e.recordedAt >= hit.recordedAt)) hit = e;
  return hit;
}

export async function fetchResusBoardV2(args: {
  hospitalId: string;
  clinicianUserId: string;
  /** Defaults to now (a server component may not call Date.now in render). */
  nowMs?: number;
}): Promise<ResusBoardV2Data> {
  const { hospitalId, nowMs = Date.now() } = args;
  const now = new Date(nowMs);

  const rows = await db
    .select({
      id: resusEpisodes.id,
      patientUserId: resusEpisodes.patientUserId,
      first: patientProfiles.firstNameEncrypted,
      surname: patientProfiles.surnameEncrypted,
      dob: patientProfiles.dateOfBirth,
      triggerKind: resusEpisodes.triggerKind,
      triggerReason: resusEpisodes.triggerReason,
      state: resusEpisodes.state,
      phase: resusEpisodes.phase,
      startedAt: resusEpisodes.startedAt,
      endedAt: resusEpisodes.endedAt,
      lastActivityAt: resusEpisodes.lastActivityAt,
      currentArrestSeq: resusEpisodes.currentArrestSeq,
      arrestDetectedAt: resusEpisodes.arrestDetectedAt,
      openedBy: resusEpisodes.openedByUserId,
      idleNotifiedAt: resusEpisodes.idleNotifiedAt,
      outcomeCode: resusEpisodes.outcomeCode,
      closureKind: resusEpisodes.closureKind,
      disposition: resusEpisodes.disposition,
      chosenLevel: resusEpisodes.chosenLevel,
      decidedAt: resusEpisodes.dispositionDecidedAt,
      unitName: hospitalCareUnits.name,
    })
    .from(resusEpisodes)
    .leftJoin(patientProfiles, eq(patientProfiles.id, resusEpisodes.patientUserId))
    .leftJoin(hospitalCareUnits, eq(hospitalCareUnits.id, resusEpisodes.destinationUnitId))
    .where(
      and(
        eq(resusEpisodes.hospitalId, hospitalId),
        or(eq(resusEpisodes.state, "active"), gte(resusEpisodes.endedAt, new Date(nowMs - DAY_MS))),
      ),
    )
    .orderBy(desc(resusEpisodes.startedAt))
    .limit(100);

  const active = rows.filter((r) => r.state === "active");
  const activeIds = active.map((r) => r.id);
  const leaderRows = activeIds.length
    ? await db
        .select({
          episodeId: resusRoleAssignments.episodeId,
          userId: resusRoleAssignments.userId,
          fullName: users.fullName,
        })
        .from(resusRoleAssignments)
        .leftJoin(users, eq(users.id, resusRoleAssignments.userId))
        .where(
          and(
            inArray(resusRoleAssignments.episodeId, activeIds),
            eq(resusRoleAssignments.role, "leader"),
            isNull(resusRoleAssignments.endedAt),
          ),
        )
        .orderBy(asc(resusRoleAssignments.assignedAt))
    : [];
  const leaderBy = new Map(leaderRows.map((l) => [l.episodeId, l])); // latest wins

  const idleOf = (r: (typeof rows)[number]) =>
    idleClass((r.lastActivityAt ?? r.startedAt).getTime(), nowMs);
  const live = active.filter((r) => idleOf(r).class === "active").slice(0, LIVE_EVENT_CAP);
  // ponytail: one query per live episode (≤ 30, full history); one inArray query if the board gets slow.
  const eventsBy = new Map(
    await Promise.all(
      live.map(async (r) => [r.id, await fetchActiveResusEvents(r.id).catch(() => [])] as const),
    ),
  );

  const toRow = (r: (typeof rows)[number]): BoardV2Row => {
    const idle = idleOf(r);
    const ageYears = r.dob ? computeAgeYears(r.dob.toString(), now) : null;
    const events = eventsBy.get(r.id);
    const arrestEv = events ? latestOf(events, (e) => e.kind === "arrest_detected") : null;
    // After a stop the phase stays "arrest" until close-out: read the record.
    const inArrest = r.phase === "arrest" && (events ? arrestActive(events) : true);
    const mode =
      r.phase !== "arrest" || inArrest
        ? MODE_WORD[r.phase as EpisodePhase]
        : events?.some((e) => e.kind === "death_confirmed")
          ? "Death confirmed"
          : "Resuscitation stopped";
    // A legacy (v1) arrest has arrest_detected_at but no arrest sequence.
    const arrestAt = arrestEv?.recordedAt ?? r.arrestDetectedAt?.toISOString() ?? null;
    const dispo = events
      ? latestOf(events, (e) => e.kind === "decision" && e.payload.decision === "disposition")
      : null;
    return {
      episodeId: r.id,
      patientUserId: r.patientUserId,
      displayName: safeName(r.patientUserId, r.first, r.surname),
      ageYears,
      trigger: r.triggerReason ?? TRIGGER_LABEL[r.triggerKind] ?? r.triggerKind,
      phase: r.phase as EpisodePhase,
      inArrest,
      mode: mode ?? r.phase,
      startedAtIso: r.startedAt.toISOString(),
      lastActivityAtIso: (r.lastActivityAt ?? r.startedAt).toISOString(),
      idleLabel: idle.class === "active" ? null : idle.label,
      adminCloseOpen: idle.class === "admin_close",
      arrest: arrestAt ? { seq: Math.max(1, r.currentArrestSeq), sinceIso: arrestAt } : null,
      worst: events ? worstStep(events, ageYears, nowMs) : null,
      lastVitals: events ? vitalsLine(events) : null,
      leader: leaderBy.get(r.id)?.fullName ?? null,
      boarding:
        r.phase === "boarding"
          ? {
              destination:
                typeof dispo?.payload.destination === "string" ? dispo.payload.destination : null,
              level: (r.chosenLevel as CareLevel | null) ?? null,
              unitName: r.unitName ?? null,
              sinceIso: r.decidedAt?.toISOString() ?? dispo?.recordedAt ?? null,
            }
          : null,
    };
  };

  const board: ResusBoardV2Data = {
    hospitalId,
    nowIso: now.toISOString(),
    arrest: [],
    active: [],
    boarding: [],
    needsClosing: [],
    openable: await fetchOpenable(hospitalId, nowMs),
    ended: [],
  };
  for (const r of active) {
    const row = toRow(r);
    if (row.idleLabel) board.needsClosing.push(row);
    else if (row.inArrest) board.arrest.push(row);
    else if (row.phase === "boarding") board.boarding.push(row);
    else board.active.push(row);
  }
  board.needsClosing.sort((a, b) => a.lastActivityAtIso.localeCompare(b.lastActivityAtIso));
  board.ended = rows
    .filter((r) => r.state !== "active")
    .sort((a, b) => (b.endedAt?.getTime() ?? 0) - (a.endedAt?.getTime() ?? 0))
    .map((r) => ({
      episodeId: r.id,
      patientUserId: r.patientUserId,
      displayName: safeName(r.patientUserId, r.first, r.surname),
      ageYears: r.dob ? computeAgeYears(r.dob.toString(), now) : null,
      state: r.state as BoardV2Ended["state"],
      outcomeCode: (r.outcomeCode as OutcomeCode | null) ?? null,
      closureKind: (r.closureKind as BoardV2Ended["closureKind"]) ?? null,
      disposition: r.disposition,
      endedAtIso: r.endedAt?.toISOString() ?? null,
    }));

  await auditReveals(args, board, rows);
  await sendIdleNotices(
    active.filter((r) => !r.idleNotifiedAt && ["notify", "admin_close"].includes(idleOf(r).class)),
    hospitalId,
    (id) => leaderBy.get(id)?.userId ?? null,
    nowMs,
  );
  return board;
}
/** Red/L1 triage records (24 h) with no episode yet — the v1 openable query, unchanged. */
async function fetchOpenable(hospitalId: string, nowMs: number): Promise<ResusOpenable[]> {
  const rows = await db
    .select({
      triageRecordId: triageRecords.id,
      intakeId: triageRecords.intakeId,
      patientUserId: triageRecords.patientUserId,
      first: patientProfiles.firstNameEncrypted,
      surname: patientProfiles.surnameEncrypted,
      dob: patientProfiles.dateOfBirth,
      triagedAt: triageRecords.triagedAt,
      breakdown: triageRecords.computedBreakdown,
      episodeId: resusEpisodes.id,
    })
    .from(triageRecords)
    .leftJoin(patientProfiles, eq(patientProfiles.id, triageRecords.patientUserId))
    .leftJoin(resusEpisodes, eq(resusEpisodes.triageRecordId, triageRecords.id))
    .where(
      and(
        eq(triageRecords.hospitalId, hospitalId),
        eq(triageRecords.assignedLevel, 1),
        gte(triageRecords.triagedAt, new Date(nowMs - DAY_MS)),
        isNull(resusEpisodes.id),
      ),
    )
    .orderBy(desc(triageRecords.triagedAt))
    .limit(50);
  const now = new Date(nowMs);
  return rows.map((r) => ({
    triageRecordId: r.triageRecordId,
    intakeId: r.intakeId,
    patientUserId: r.patientUserId,
    displayName: safeName(r.patientUserId, r.first, r.surname),
    ageYears: r.dob ? computeAgeYears(r.dob.toString(), now) : null,
    triagedAtIso: r.triagedAt.toISOString(),
    lifeThreatReason:
      (r.breakdown as { lifeThreatReason?: string } | null)?.lifeThreatReason ?? null,
  }));
}

/** One clinical_phi_access_log row per revealed name (as v1). */
async function auditReveals(
  args: { hospitalId: string; clinicianUserId: string },
  board: ResusBoardV2Data,
  rows: { id: string; patientUserId: string | null }[],
): Promise<void> {
  const patientOf = new Map(rows.map((r) => [r.id, r.patientUserId]));
  const episodes = [
    ...board.arrest,
    ...board.active,
    ...board.boarding,
    ...board.needsClosing,
    ...board.ended,
  ];
  const patients = [
    ...episodes.filter((e) => e.displayName).map((e) => patientOf.get(e.episodeId) ?? null),
    ...board.openable.filter((o) => o.displayName).map((o) => o.patientUserId),
  ].filter((p): p is string => !!p);
  if (patients.length === 0) return;
  try {
    await db.insert(clinicalPhiAccessLog).values(
      patients.map((patientUserId) => ({
        hospitalId: args.hospitalId,
        clinicianUserId: args.clinicianUserId,
        patientUserId,
        accessBasis: "department_recent" as const,
        surface: "resus_board",
      })),
    );
  } catch (e) {
    logger.error("resus.board_v2.phi_audit_failed", { reason: String(e) });
  }
}

/**
 * CO-IDLE-02, lazily: claim the episode first (idle_notified_at IS NULL → now),
 * then notify the opener + current leader (+ ward in-charges, inside
 * sendIdleNotice). Claim-then-send keeps it once per episode even when two
 * boards render at the same moment. Never throws.
 */
async function sendIdleNotices(
  candidates: {
    id: string;
    openedBy: string | null;
    lastActivityAt: Date | null;
    startedAt: Date;
  }[],
  hospitalId: string,
  leaderOf: (episodeId: string) => string | null,
  nowMs: number,
): Promise<void> {
  if (candidates.length === 0) return;
  const service = createServiceClient();
  await Promise.all(
    candidates.slice(0, IDLE_NOTICES_PER_RENDER).map(async (r) => {
      try {
        const claimed = await db
          .update(resusEpisodes)
          .set({ idleNotifiedAt: new Date(nowMs) })
          .where(and(eq(resusEpisodes.id, r.id), isNull(resusEpisodes.idleNotifiedAt)))
          .returning({ id: resusEpisodes.id });
        if (claimed.length === 0) return;
        const recipientIds = [r.openedBy, leaderOf(r.id)].filter((u): u is string => !!u);
        await sendIdleNotice({
          service,
          episodeId: r.id,
          hospitalId,
          recipientIds,
          idleLabel: formatIdle(nowMs - (r.lastActivityAt ?? r.startedAt).getTime()),
        });
      } catch (e) {
        logger.warn("resus.board_v2.idle_notice_failed", { episode: r.id, reason: String(e) });
      }
    }),
  );
}
