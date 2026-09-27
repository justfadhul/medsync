"use server";

import type { ActionResult } from "./common";
import type { ResusScope } from "@/lib/resus/scope";
import type { HeaderPatch, V2EventInput } from "@/lib/resus/v2-record";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { resusArrestRecords, resusEpisodes } from "@/db/schema/resus";
import { saAuditLog } from "@/db/schema/sa-audit-log";
import { emrV1LiveFor } from "@/lib/emr/feature";
import { EmrWriteError, withPatientWrite } from "@/lib/emr/write/context";
import { consumeResusHandoff } from "@/lib/emr/write/handoff";
import { encounterEngineLive } from "@/lib/encounter/feature";
import { openEncounterFromTriage } from "@/lib/encounter/handoff";
import { logger } from "@/lib/logger";
import { arrestSlice, currentArrestSeq } from "@/lib/resus/als/timing";
import { canAdminCloseResus } from "@/lib/resus/authority";
import { OUTSTANDING_REASON_MAX, OUTSTANDING_TESTS_MAX } from "@/lib/resus/closeout/handover";
import { mismatchRequired } from "@/lib/resus/closeout/level-of-care";
import { allowedActions } from "@/lib/resus/closeout/lifecycle";
import { CARE_LEVELS, DESTINATIONS, LEVEL_MISMATCH_CODES, OUTCOME_CODES } from "@/lib/resus/model";
import { reconstructTimeline } from "@/lib/resus/timeline";
import { projectArrestRecord } from "@/lib/resus/utstein/project";
import { commitResusEvents } from "@/lib/resus/v2-record";
import { afterDeathTaskProblem, closeOutcomeProblem } from "@/lib/resus/v2-rules-closeout";
import { fail, prelude, resusScopeOrNull, SIGNED_OUT, WriteBase } from "./common";

/**
 * Resus Desk v2 — close-out server actions (docs/clinical/resus-closeout-clinical-catalog.md,
 * GATE A §1, §9). End a resus with its outcome, destination and handover; board
 * a patient awaiting a bed; re-activate; cancel; administrative close of an idle
 * episode. The recommender only suggests: choosing below it needs a reason.
 */

const done = (r: Awaited<ReturnType<typeof commitResusEvents>>): ActionResult =>
  r.ok ? { ok: true, serverTime: r.serverTime, eventIds: r.events.map((e) => e.eventId) } : r;

const DEST_TO_DISPOSITION: Record<(typeof DESTINATIONS)[number], string> = {
  icu: "icu",
  hdu: "hdu",
  ward: "ward",
  theatre: "theatre",
  cath_lab: "cath_lab",
  labour_ward: "labour_ward",
  transferred: "transferred",
  discharged: "discharged",
  mortuary: "mortuary",
};
const UNIT_DESTINATIONS = new Set(["icu", "hdu", "ward", "labour_ward"]);

const SbarSchema = z.object({
  situation: z.string().max(4000),
  background: z.string().max(4000),
  assessment: z.string().max(6000),
  recommendation: z.string().max(4000),
});

const DispositionSchema = z.object({
  suggestedLevel: z.enum(CARE_LEVELS).nullable(),
  chosenLevel: z.enum(CARE_LEVELS).nullable(),
  destination: z.enum(DESTINATIONS),
  unitId: z.string().uuid().nullable(),
  mismatch: z.enum(LEVEL_MISMATCH_CODES).nullable(),
  mismatchNote: z.string().max(300).nullable(),
  ruleIds: z.array(z.string().max(16)).max(20),
  /** §5.12 step 2 — defaulted so a client that does not send them yet still closes. */
  bed: z.enum(["requested", "accepted", "not_available"]).nullable().default(null),
  bedAcceptedBy: z.string().trim().max(60).nullable().default(null),
});

/** A5: optional; a client that does not send them closes as before. Test ids and a short reason,
 *  stored beside the SBAR as it is (the EMR handoff proposes each; nothing is ordered here). */
const OutstandingTestsSchema = z
  .array(
    z.object({
      testId: z.string().uuid(),
      reason: z.string().trim().max(OUTSTANDING_REASON_MAX).nullable(),
    }),
  )
  .max(OUTSTANDING_TESTS_MAX)
  .default([]);

type Disposition = z.infer<typeof DispositionSchema>;
type DispositionInput = z.input<typeof DispositionSchema>;

const BED_LABEL = {
  requested: "bed requested",
  accepted: "bed accepted",
  not_available: "no bed available",
} as const;

function mismatchProblem(d: Disposition): string | null {
  if (d.suggestedLevel && d.chosenLevel && mismatchRequired(d.suggestedLevel, d.chosenLevel)) {
    if (!d.mismatch)
      return "Below the suggested level — give the reason (no bed, ceiling of care, …).";
    if (d.mismatch === "clinical_judgement" && !d.mismatchNote?.trim())
      return "Clinical judgement — add a short note.";
  }
  return null;
}

function dispositionEvents(d: Disposition, recordedAt: string | undefined): V2EventInput[] {
  const events: V2EventInput[] = [
    {
      clientEventId: crypto.randomUUID(),
      recordedAt,
      kind: "decision",
      step: "post",
      payload: {
        decision: "disposition",
        ...d,
        bedAcceptedBy: d.bed === "accepted" ? d.bedAcceptedBy || null : null,
        label: `Destination: ${d.destination.replace(/_/g, " ")}${d.chosenLevel ? ` (${d.chosenLevel.toUpperCase()})` : ""}${d.mismatch ? ` — below suggestion: ${d.mismatch.replace(/_/g, " ")}` : ""}${d.bed ? ` — ${BED_LABEL[d.bed]}${d.bed === "accepted" && d.bedAcceptedBy ? ` by ${d.bedAcceptedBy}` : ""}` : ""}`,
      },
    },
  ];
  if (UNIT_DESTINATIONS.has(d.destination) && d.chosenLevel) {
    // Q4: the admission request is recorded for the future bed-management build.
    events.push({
      clientEventId: crypto.randomUUID(),
      recordedAt,
      kind: "decision",
      step: "post",
      payload: {
        decision: "admission_request",
        seam: "pending_intent",
        level: d.chosenLevel,
        destination: d.destination,
        label: `Admission requested: ${d.destination.replace(/_/g, " ")} (${d.chosenLevel.toUpperCase()})`,
      },
    });
  }
  return events;
}

/**
 * End the resus (LC-02). The outcome must match the record (closeOutcomeProblem):
 * a death needs a confirmed death, and after a stop or a confirmed death only a
 * death fits; ROSC outcomes need a ROSC and no arrest running;
 * "stabilised" needs no arrest running. Mid-arrest, "transferred out" records
 * leaving with CPR ongoing.
 */
export async function closeResusV2(input: {
  episodeId: string;
  clientEventId: string;
  recordedAt?: string;
  outcomeCode: (typeof OUTCOME_CODES)[number];
  disposition: DispositionInput;
  sbar: z.infer<typeof SbarSchema>;
  receiving: { unit: string; cadre: string } | null;
  escort: string | null;
  cprOngoing?: boolean;
  outstandingTests?: z.input<typeof OutstandingTestsSchema>;
}): Promise<ActionResult<{ encounterId?: string | null }>> {
  const parsed = WriteBase.extend({
    outcomeCode: z.enum(OUTCOME_CODES),
    disposition: DispositionSchema,
    sbar: SbarSchema,
    receiving: z.object({ unit: z.string().max(120), cadre: z.string().max(60) }).nullable(),
    escort: z.string().max(200).nullable(),
    cprOngoing: z.boolean().optional(),
    outstandingTests: OutstandingTestsSchema,
  }).safeParse(input);
  if (!parsed.success) return fail("Invalid close-out.");
  const d = parsed.data;
  const mm = mismatchProblem(d.disposition);
  if (mm) return fail(mm);

  const p = await prelude(d.episodeId, d.clientEventId);
  if (!p.ok) return p;
  if (p.replay) return p.replay;
  const lastMs = (p.header.lastActivityAt ?? p.header.startedAt).getTime();
  const nowMs = Date.now();
  const allowed = allowedActions(
    { state: p.header.state as never, phase: p.header.phase as never, lastActivityAtMs: lastMs },
    nowMs,
    { canAdminClose: false },
  );
  if (!allowed.some((a) => a.action === "end"))
    return fail("This resus is closed — the record is read-only.");

  const problem = closeOutcomeProblem(d.outcomeCode, d.disposition.destination, p.events);
  if (problem) return fail(problem);
  const died = d.outcomeCode === "died_after_cpr" || d.outcomeCode === "died_cpr_not_attempted";

  const at = d.recordedAt;
  const events: V2EventInput[] = [
    {
      clientEventId: d.clientEventId,
      recordedAt: at,
      kind: "handover",
      step: "post",
      payload: {
        sbar: d.sbar,
        receiving: d.receiving,
        escort: d.escort,
        cprOngoing: d.cprOngoing ?? false,
        // Additive: older handover events have none. Repeats collapse to the first.
        ...(d.outstandingTests.length && !died
          ? {
              outstandingTests: d.outstandingTests
                .filter((t, i, all) => all.findIndex((x) => x.testId === t.testId) === i)
                .map((t) => ({ testId: t.testId, reason: t.reason || null })),
            }
          : {}),
        label: `Handover${d.receiving ? ` to ${d.receiving.unit} (${d.receiving.cadre})` : ""}${d.cprOngoing ? " — CPR ongoing" : ""}`,
      },
    },
    ...dispositionEvents(d.disposition, at),
    {
      clientEventId: crypto.randomUUID(),
      recordedAt: at,
      kind: "decision",
      step: "post",
      payload: {
        decision: "closure",
        outcomeCode: d.outcomeCode,
        closureKind: "bedside",
        label: `Resus ended — ${d.outcomeCode.replace(/_/g, " ")}`,
      },
    },
  ];

  // Encounter seam (Q2): link or open the encounter when the engine is live. Under EMR v1 nothing
  // is opened before the commit (an encounter opened for a close-out that then fails was an
  // orphan): the handoff below creates or links it AFTER the resus has committed (R4).
  let encounterId: string | null = null;
  let pendingHandoff = !died;
  const emrHandoff = !died && emrV1LiveFor(p.scope.hospitalId);
  if (!died && !emrHandoff && encounterEngineLive() && p.header.triageRecordId) {
    try {
      const enc = await openEncounterFromTriage(p.header.triageRecordId, {
        userId: p.scope.userId,
        hospitalId: p.scope.hospitalId,
        departmentId: p.scope.departmentId,
        cadreCode: p.scope.cadreCode,
        isClinical: true,
      });
      if (enc.ok) {
        encounterId = enc.encounterId;
        pendingHandoff = false;
      }
    } catch (e) {
      logger.warn("resus.v2.close.encounter_seam_failed", { reason: String(e) });
    }
  }

  const header: HeaderPatch = {
    state: "concluded",
    outcomeCode: d.outcomeCode,
    closureKind: "bedside",
    closedBy: p.scope.userId,
    endedAt: new Date(at ?? nowMs),
    disposition: DEST_TO_DISPOSITION[d.disposition.destination],
    suggestedLevel: d.disposition.suggestedLevel,
    chosenLevel: d.disposition.chosenLevel,
    levelMismatchCode: d.disposition.mismatch,
    destinationUnitId: d.disposition.unitId,
    dispositionDecidedAt: new Date(at ?? nowMs),
    pendingEncounterHandoff: pendingHandoff,
    ...(encounterId ? { encounterId } : {}),
  };
  const r = await commitResusEvents({
    scopeUserId: p.scope.userId,
    hospitalId: p.scope.hospitalId,
    episodeId: d.episodeId,
    events,
    header,
    expectRows: p.rows,
    audit: {
      action: "conclude_resus_episode",
      reason: `Resus ended — ${d.outcomeCode}`,
      after: { outcome: d.outcomeCode, destination: d.disposition.destination },
    },
  });
  if (r.ok && !r.events[0]?.duplicate) await writeArrestRecords(d.episodeId, p.scope.userId, nowMs);
  if (r.ok && emrHandoff && p.header.patientUserId)
    encounterId = await handoffToEncounter(p.scope, d.episodeId, p.header.patientUserId);
  return r.ok
    ? { ...(done(r) as { ok: true; serverTime: string; eventIds: string[] }), encounterId }
    : r;
}

/**
 * R4 (HARMONISATION §5.6): after the close-out committed, one EMR transaction creates or links the
 * encounter, writes the ISBAR handover note and clears `pending_encounter_handoff`. The resus is
 * closed whatever happens here: on a failure the flag stays set, so the handoff can be consumed
 * later (consumeResusHandoff is idempotent on the episode).
 */
async function handoffToEncounter(
  scope: ResusScope,
  episodeId: string,
  patientUserId: string,
): Promise<string | null> {
  try {
    const actor = {
      userId: scope.userId,
      fullName: scope.fullName,
      hospitalId: scope.hospitalId,
      departmentId: scope.departmentId,
      affiliationId: scope.affiliationId,
      cadreCode: scope.cadreCode,
      isClinical: true,
      surface: "nurse" as const,
    };
    const r = await withPatientWrite(actor, patientUserId, (ctx) =>
      consumeResusHandoff(ctx, { patientUserId, episodeId }),
    );
    return r.encounterId;
  } catch (e) {
    logger.warn("resus.v2.close.emr_handoff_failed", {
      episodeId,
      reason: e instanceof EmrWriteError ? e.code : String(e),
    });
    return null;
  }
}

/** One immutable Utstein snapshot per arrest, written once at close (CO-UTS-*). */
async function writeArrestRecords(episodeId: string, userId: string, nowMs: number): Promise<void> {
  try {
    const { fetchActiveResusEvents } = await import("@/lib/resus/v2-record");
    const events = await fetchActiveResusEvents(episodeId);
    const tl = reconstructTimeline(events);
    const last = currentArrestSeq(tl);
    if (last === 0) return;
    const existing = await db
      .select({ seq: resusArrestRecords.arrestSeq })
      .from(resusArrestRecords)
      .where(eq(resusArrestRecords.episodeId, episodeId));
    const have = new Set(existing.map((r) => r.seq));
    for (let seq = 1; seq <= last; seq++) {
      if (have.has(seq) || !arrestSlice(tl, seq)) continue;
      const record = projectArrestRecord(events, seq, nowMs);
      await db.transaction(async (tx) => {
        await tx
          .insert(resusArrestRecords)
          .values({ episodeId, arrestSeq: seq, record, createdBy: userId });
        await tx.insert(saAuditLog).values({
          actorId: userId,
          action: "record_resus_arrest_record",
          targetKind: "resus_arrest_record",
          targetId: episodeId,
          reason: `Utstein record, arrest ${seq}`,
          beforeData: null,
          afterData: { arrestSeq: seq },
        });
      });
    }
  } catch (e) {
    // The episode is closed either way; a missing snapshot is re-projectable from the record.
    logger.error("resus.v2.arrest_records_failed", { reason: String(e) });
  }
}

/** Destination decided but no bed: the episode enters boarding (CO-BRD-01). */
export async function startBoardingV2(input: {
  episodeId: string;
  clientEventId: string;
  recordedAt?: string;
  disposition: DispositionInput;
}): Promise<ActionResult> {
  const parsed = WriteBase.extend({ disposition: DispositionSchema }).safeParse(input);
  if (!parsed.success) return fail("Invalid disposition.");
  const d = parsed.data;
  const mm = mismatchProblem(d.disposition);
  if (mm) return fail(mm);
  const p = await prelude(d.episodeId, d.clientEventId);
  if (!p.ok) return p;
  if (p.replay) return p.replay;
  const lastMs = (p.header.lastActivityAt ?? p.header.startedAt).getTime();
  const allowed = allowedActions(
    { state: p.header.state as never, phase: p.header.phase as never, lastActivityAtMs: lastMs },
    Date.now(),
    { canAdminClose: false },
  );
  if (!allowed.some((a) => a.action === "board"))
    return fail(
      p.header.phase === "arrest" ? "An arrest is running." : "Boarding is not available now.",
    );
  const [first, ...rest] = dispositionEvents(d.disposition, d.recordedAt);
  return done(
    await commitResusEvents({
      scopeUserId: p.scope.userId,
      hospitalId: p.scope.hospitalId,
      episodeId: d.episodeId,
      events: [
        { ...first!, clientEventId: d.clientEventId },
        ...rest,
        {
          clientEventId: crypto.randomUUID(),
          recordedAt: d.recordedAt,
          kind: "decision",
          step: "post",
          payload: { decision: "phase", phase: "boarding", label: "Boarding — awaiting bed" },
        },
      ],
      // The phase decision row above moves the derived phase to boarding.
      header: {
        dispositionDecidedAt: new Date(d.recordedAt ?? Date.now()),
        suggestedLevel: d.disposition.suggestedLevel,
        chosenLevel: d.disposition.chosenLevel,
        levelMismatchCode: d.disposition.mismatch,
        destinationUnitId: d.disposition.unitId,
      },
      expectRows: p.rows,
      audit: {
        action: "set_resus_disposition",
        reason: `Boarding for ${d.disposition.destination}`,
      },
    }),
  );
}
/**
 * Re-activate from boarding (CO-BRD-03): back to the survey, same episode. LC-08
 * needs no reason (allowedActions: requiresReason false); one given is recorded.
 */
export async function reactivateResusV2(input: {
  episodeId: string;
  clientEventId: string;
  recordedAt?: string;
  reason?: string | null;
}): Promise<ActionResult> {
  const parsed = WriteBase.extend({
    reason: z.string().trim().max(300).nullable().optional(),
  }).safeParse(input);
  if (!parsed.success) return fail("Invalid re-activation.");
  const p = await prelude(parsed.data.episodeId, parsed.data.clientEventId);
  if (!p.ok) return p;
  if (p.replay) return p.replay;
  if (p.header.phase !== "boarding") return fail("Only a boarding patient is re-activated.");
  const why = parsed.data.reason || null;
  return done(
    await commitResusEvents({
      scopeUserId: p.scope.userId,
      hospitalId: p.scope.hospitalId,
      episodeId: parsed.data.episodeId,
      events: [
        {
          clientEventId: parsed.data.clientEventId,
          recordedAt: parsed.data.recordedAt,
          kind: "decision",
          step: "pre",
          payload: {
            decision: "phase",
            phase: "survey",
            reason: why,
            label: `Resus re-activated${why ? ` — ${why}` : ""}`,
          },
        },
      ],
      expectRows: p.rows,
      audit: { action: "reactivate_resus", reason: why ?? "Resus re-activated" },
    }),
  );
}

/** Opened in error (LC-03): cancelled with a reason; read-only afterwards. */
export async function cancelResusV2(input: {
  episodeId: string;
  clientEventId: string;
  recordedAt?: string;
  reason: string;
}): Promise<ActionResult> {
  const parsed = WriteBase.extend({ reason: z.string().trim().min(3).max(300) }).safeParse(input);
  if (!parsed.success) return fail("A reason is required to cancel.");
  const p = await prelude(parsed.data.episodeId, parsed.data.clientEventId);
  if (!p.ok) return p;
  if (p.replay) return p.replay;
  return done(
    await commitResusEvents({
      scopeUserId: p.scope.userId,
      hospitalId: p.scope.hospitalId,
      episodeId: parsed.data.episodeId,
      events: [
        {
          clientEventId: parsed.data.clientEventId,
          recordedAt: parsed.data.recordedAt,
          kind: "decision",
          step: "pre",
          payload: {
            decision: "cancel",
            reason: parsed.data.reason,
            label: `Resus cancelled — ${parsed.data.reason}`,
          },
        },
      ],
      header: {
        state: "cancelled",
        cancelReason: parsed.data.reason,
        closedBy: p.scope.userId,
        endedAt: new Date(parsed.data.recordedAt ?? Date.now()),
      },
      audit: { action: "cancel_resus_episode", reason: parsed.data.reason },
    }),
  );
}

/**
 * Administrative close of an idle episode (LC-04, CO-IDLE-03): idle ≥ 24 h,
 * in-charge or consultant, reason required. No clinical outcome is claimed;
 * excluded from clinical statistics.
 */
export async function adminCloseResusV2(input: {
  episodeId: string;
  clientEventId: string;
  recordedAt?: string;
  reason: string;
}): Promise<ActionResult> {
  const parsed = WriteBase.extend({ reason: z.string().trim().min(3).max(300) }).safeParse(input);
  if (!parsed.success) return fail("A reason is required.");
  const p = await prelude(parsed.data.episodeId, parsed.data.clientEventId);
  if (!p.ok) return p;
  if (p.replay) return p.replay;
  const mayClose = await canAdminCloseResus(p.scope.userId, p.scope.hospitalId, p.scope.cadreCode);
  const lastMs = (p.header.lastActivityAt ?? p.header.startedAt).getTime();
  const allowed = allowedActions(
    { state: p.header.state as never, phase: p.header.phase as never, lastActivityAtMs: lastMs },
    Date.now(),
    { canAdminClose: mayClose },
  );
  if (!allowed.some((a) => a.action === "admin_close"))
    return fail(
      mayClose
        ? "Administrative close opens after 24 h without activity."
        : "Administrative close is for the ward in-charge or a consultant.",
    );
  return done(
    await commitResusEvents({
      scopeUserId: p.scope.userId,
      hospitalId: p.scope.hospitalId,
      episodeId: parsed.data.episodeId,
      events: [
        {
          clientEventId: parsed.data.clientEventId,
          recordedAt: parsed.data.recordedAt,
          kind: "decision",
          step: "pre",
          payload: {
            decision: "closure",
            outcomeCode: null,
            closureKind: "administrative",
            reason: parsed.data.reason,
            label: `Closed administratively — ${parsed.data.reason}`,
          },
        },
      ],
      header: {
        state: "concluded",
        closureKind: "administrative",
        closedBy: p.scope.userId,
        endedAt: new Date(parsed.data.recordedAt ?? Date.now()),
      },
      audit: { action: "close_resus_administratively", reason: parsed.data.reason },
    }),
  );
}

/* ─── After close: the after-death checklist and the debrief (D16: ≤ 24 h) ─ */

const AFTER_CLOSE_MS = 24 * 3600_000;

/**
 * R6: after-close records write no timeline row, so nothing else wakes the
 * other desks — say "something changed" on the episode topic (ids only, no
 * PHI). A failing realtime layer never fails the save.
 */
async function broadcastAfterClose(episodeId: string, what: "after_death_task" | "debrief") {
  try {
    await db.execute(
      sql`SELECT realtime.send(${JSON.stringify({ episodeId, what })}::jsonb, 'after_close', ${`resus:${episodeId}`}, true)`,
    );
  } catch (e) {
    logger.warn("resus.v2.after_close_broadcast_failed", { reason: String(e) });
  }
}

async function withinAfterCloseWindow(episodeId: string, hospitalId: string): Promise<boolean> {
  const [ep] = await db
    .select({ state: resusEpisodes.state, endedAt: resusEpisodes.endedAt })
    .from(resusEpisodes)
    .where(and(eq(resusEpisodes.id, episodeId), eq(resusEpisodes.hospitalId, hospitalId)))
    .limit(1);
  if (!ep) return false;
  if (ep.state === "active") return true;
  return !!ep.endedAt && Date.now() - ep.endedAt.getTime() <= AFTER_CLOSE_MS;
}

export async function recordAfterDeathTaskV2(input: {
  episodeId: string;
  taskId: string;
  state: "done" | "not_applicable" | "pending";
  note?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { resusAfterDeathTasks } = await import("@/db/schema/resus");
  const parsed = z
    .object({
      episodeId: z.string().uuid(),
      taskId: z.string().max(16),
      state: z.enum(["done", "not_applicable", "pending"]),
      note: z.string().max(500).nullable().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return fail("Invalid task.");
  const taskProblem = afterDeathTaskProblem(parsed.data.taskId);
  if (taskProblem) return fail(taskProblem);
  const scope = await resusScopeOrNull();
  if (!scope) return fail(SIGNED_OUT);
  if (!(await withinAfterCloseWindow(parsed.data.episodeId, scope.hospitalId)))
    return fail("The after-death checklist closes 24 h after the resus ends.");
  await db.transaction(async (tx) => {
    await tx.insert(resusAfterDeathTasks).values({
      episodeId: parsed.data.episodeId,
      taskId: parsed.data.taskId,
      state: parsed.data.state,
      note: parsed.data.note ?? null,
      recordedBy: scope.userId,
    });
    await tx.insert(saAuditLog).values({
      actorId: scope.userId,
      action: "record_resus_after_death_task",
      targetKind: "resus_after_death_task",
      targetId: parsed.data.episodeId,
      reason: `${parsed.data.taskId} → ${parsed.data.state}`,
      beforeData: null,
      afterData: { taskId: parsed.data.taskId, state: parsed.data.state },
    });
  });
  await broadcastAfterClose(parsed.data.episodeId, "after_death_task");
  return { ok: true };
}

const SUBMITTED = "This debrief was already submitted — it can no longer be edited.";

export async function saveDebriefV2(input: {
  episodeId: string;
  attendeeCount: number | null;
  wentWell: string;
  toImprove: string;
  actions: string;
  equipmentIssues: string;
  welfareCheckDone: boolean;
  submit: boolean;
  /** The saved version this device last saw (null: none yet) — R6, no blind overwrite. */
  baseUpdatedAtIso: string | null;
}): Promise<
  | { ok: true; updatedAtIso: string }
  | { ok: false; error: string; stale?: true; updatedAtIso?: string | null }
> {
  const { resusDebriefs } = await import("@/db/schema/resus");
  const { debriefMetrics } = await import("@/lib/resus/debrief/metrics");
  const { fetchActiveResusEvents } = await import("@/lib/resus/v2-record");
  const T = z.string().max(4000);
  const parsed = z
    .object({
      episodeId: z.string().uuid(),
      attendeeCount: z.number().int().min(0).max(100).nullable(),
      wentWell: T,
      toImprove: T,
      actions: T,
      equipmentIssues: T,
      welfareCheckDone: z.boolean(),
      submit: z.boolean(),
      baseUpdatedAtIso: z.string().datetime({ offset: true }).nullable(),
    })
    .safeParse(input);
  if (!parsed.success) return fail("Invalid debrief.");
  const scope = await resusScopeOrNull();
  if (!scope) return fail(SIGNED_OUT);
  const d = parsed.data;
  if (!(await withinAfterCloseWindow(d.episodeId, scope.hospitalId)))
    return fail("The debrief closes 24 h after the resus ends.");
  const metrics = debriefMetrics(await fetchActiveResusEvents(d.episodeId), Date.now());
  const values = {
    facilitatorUserId: scope.userId,
    attendeeCount: d.attendeeCount,
    wentWell: d.wentWell,
    toImprove: d.toImprove,
    actions: d.actions,
    equipmentIssues: d.equipmentIssues,
    welfareCheckDone: d.welfareCheckDone,
    metrics: metrics as unknown as Record<string, unknown>,
    status: d.submit ? "submitted" : "draft",
    submittedAt: d.submit ? new Date() : null,
  };
  let savedAt: Date | null;
  try {
    savedAt = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(resusDebriefs)
        .values({ episodeId: d.episodeId, ...values })
        .onConflictDoUpdate({
          target: resusDebriefs.episodeId,
          set: values,
          // Only over the version this device saw (updated_at is microsecond; the client ms).
          setWhere: d.baseUpdatedAtIso
            ? sql`date_trunc('milliseconds', ${resusDebriefs.updatedAt}) = ${d.baseUpdatedAtIso}::timestamptz`
            : sql`false`,
        })
        .returning({ updatedAt: resusDebriefs.updatedAt });
      if (!row) return null;
      await tx.insert(saAuditLog).values({
        actorId: scope.userId,
        action: "submit_resus_debrief",
        targetKind: "resus_debrief",
        targetId: d.episodeId,
        reason: d.submit ? "Debrief submitted" : "Debrief draft saved",
        beforeData: null,
        afterData: { status: values.status },
      });
      return row.updatedAt;
    });
  } catch (e) {
    const reason = `${String(e)} ${e instanceof Error ? String(e.cause ?? "") : ""}`;
    // The DB trigger refuses edits to a submitted debrief; anything else is worth a retry.
    if (/immutable once submitted/.test(reason)) return fail(SUBMITTED);
    logger.warn("resus.v2.debrief_save_failed", { reason });
    return fail("Could not save the debrief — try again.");
  }
  if (!savedAt) {
    const [cur] = await db
      .select({ status: resusDebriefs.status, updatedAt: resusDebriefs.updatedAt })
      .from(resusDebriefs)
      .where(eq(resusDebriefs.episodeId, d.episodeId))
      .limit(1);
    if (cur?.status === "submitted") return fail(SUBMITTED);
    return {
      ok: false,
      error: "Another device saved this debrief since you opened it — save again to replace it.",
      stale: true,
      updatedAtIso: cur?.updatedAt.toISOString() ?? null,
    };
  }
  await broadcastAfterClose(d.episodeId, "debrief");
  return { ok: true, updatedAtIso: savedAt.toISOString() };
}
