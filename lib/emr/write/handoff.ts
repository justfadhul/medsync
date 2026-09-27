import "server-only";

import type { WriteCtx } from "./context";
import type { OrderLine, WriteResult } from "./orders";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";

import { staffAffiliations } from "@/db/schema/clinician-profiles";
import { testCatalogue } from "@/db/schema/emr";
import { encounterOrders } from "@/db/schema/encounter";
import { patientProfiles } from "@/db/schema/patient-profiles";
import { cadres } from "@/db/schema/reference-data";
import { resusEpisodes, resusRoleAssignments, resusTimelineEvents } from "@/db/schema/resus";
import { encounters } from "@/db/schema/scheduling";
import { outstandingTestsOf } from "@/lib/resus/closeout/handover";
import { EmrWriteError } from "./context";
import { insertSignedNote } from "./notes";
import { placeOrders, replayed } from "./orders";

/**
 * The resus → encounter handoff (PROMPT §5.12, HARMONISATION R4). Runs AFTER the resus close-out has
 * committed: in one transaction it creates or links the encounter (an open one for the patient here is
 * reused, never duplicated), writes the ISBAR handover note authored by the resus leader (Identify from
 * the record, S/B/A/R from the close-out's SBAR) and clears `pending_encounter_handoff`. A second call
 * finds the flag cleared and returns the same note.
 *
 * The close-out's outstanding tests (A5) become PROPOSED orders on the encounter, authored like the
 * note (intent_source 'resus_handover', source_intent_id '<episodeId>:<testId>'). They show in the
 * desk Plan as suggestions; nothing is ordered until a clinician accepts one (Law 6). A test no
 * longer on this hospital's menu is left out rather than failing the handoff; a re-consume proposes
 * nothing twice (each line's key is the episode and the test).
 */

/** The proposal's reason when the close-out gave none (an order always carries one). */
export const HANDOVER_REASON = "Suggested by the resus handover";

type Sbar = {
  situation?: string;
  background?: string;
  assessment?: string;
  recommendation?: string;
};

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export async function consumeResusHandoff(
  ctx: WriteCtx,
  /** patientUserId: the patient the access check ran for; it must be the episode's. */
  input: { patientUserId: string; episodeId: string },
): Promise<WriteResult & { encounterId: string }> {
  const { tx, actor, now } = ctx;
  const [ep] = await tx
    .select()
    .from(resusEpisodes)
    .where(
      and(eq(resusEpisodes.id, input.episodeId), eq(resusEpisodes.hospitalId, actor.hospitalId)),
    )
    .for("update");
  if (!ep) throw new EmrWriteError("not_found", "Resus episode not found in this hospital.");
  if (!ep.patientUserId)
    throw new EmrWriteError("invalid", "The patient is not identified yet: link the record first.");
  if (ep.patientUserId !== input.patientUserId)
    throw new EmrWriteError("forbidden", "This resus episode is another patient's.");
  const clientKey = `resus-handoff:${ep.id}`;
  if (ep.state !== "concluded") throw new EmrWriteError("conflict", "The resus is still running.");

  // 1. The encounter: the episode's, else the patient's open one here, else a new emergency one.
  let encounterId = ep.encounterId;
  if (!encounterId) {
    const [open] = await tx
      .select({ id: encounters.id })
      .from(encounters)
      .where(
        and(
          eq(encounters.patientUserId, ep.patientUserId),
          eq(encounters.hospitalId, ep.hospitalId),
          inArray(encounters.state, ["planned", "in_progress"]),
        ),
      )
      .orderBy(desc(encounters.createdAt))
      .limit(1);
    encounterId =
      open?.id ??
      (
        await tx
          .insert(encounters)
          .values({
            hospitalId: ep.hospitalId,
            patientUserId: ep.patientUserId,
            clinicianUserId: actor.userId,
            departmentId: ep.departmentId,
            encounterType: "emergency",
            triageRecordId: ep.triageRecordId,
            visitId: ep.intakeId,
            state: "in_progress",
            startedAt: now,
          })
          .returning({ id: encounters.id })
      )[0]!.id;
  }

  // 2. The ISBAR note, authored by the resus leader (the actor when no leader was recorded).
  const [leader] = await tx
    .select({ userId: resusRoleAssignments.userId, cadreCode: cadres.code })
    .from(resusRoleAssignments)
    .leftJoin(
      staffAffiliations,
      and(
        eq(staffAffiliations.userId, resusRoleAssignments.userId),
        eq(staffAffiliations.hospitalId, ep.hospitalId),
      ),
    )
    .leftJoin(cadres, eq(cadres.id, staffAffiliations.cadreId))
    .where(and(eq(resusRoleAssignments.episodeId, ep.id), eq(resusRoleAssignments.role, "leader")))
    // The current leader first, then the latest.
    .orderBy(desc(isNull(resusRoleAssignments.endedAt)), desc(resusRoleAssignments.assignedAt))
    .limit(1);
  const [handover] = await tx
    .select({ payload: resusTimelineEvents.payload, recordedAt: resusTimelineEvents.recordedAt })
    .from(resusTimelineEvents)
    .where(and(eq(resusTimelineEvents.episodeId, ep.id), eq(resusTimelineEvents.kind, "handover")))
    .orderBy(desc(resusTimelineEvents.recordedAt))
    .limit(1);
  const payload = (handover?.payload ?? {}) as {
    sbar?: Sbar;
    receiving?: { unit?: string; cadre?: string } | null;
  };
  const sbar = payload.sbar ?? {};
  const [profile] = await tx
    .select({ patientCode: patientProfiles.patientCode, dob: patientProfiles.dateOfBirth })
    .from(patientProfiles)
    .where(eq(patientProfiles.id, ep.patientUserId));
  const recommendation = text(sbar.recommendation);

  const noteId = await insertSignedNote(ctx, {
    patientUserId: ep.patientUserId,
    encounterId,
    templateId: "tpl.handover.isbar",
    effectiveAt: handover?.recordedAt ?? ep.endedAt ?? now,
    author: leader?.userId
      ? { userId: leader.userId, cadreCode: leader.cadreCode ?? "UNKNOWN" }
      : undefined,
    // Two identifiers from the record, never names typed at the bedside.
    content: {
      sections: {
        s01: {
          items: [
            {
              kind: "identify",
              patientCode: profile?.patientCode ?? null,
              dateOfBirth: profile?.dob ?? null,
              resusEpisodeId: ep.id,
            },
          ],
        },
        s02: {
          narrative:
            text(sbar.situation) || `Resus ended: ${ep.outcomeCode ?? "outcome not recorded"}.`,
        },
        s03: { narrative: text(sbar.background) },
        s04: { narrative: text(sbar.assessment) },
        s05: {
          // Missing is not normal: an empty recommendation is recorded as not recorded, never "none".
          items: [
            recommendation
              ? { kind: "tasks", text: recommendation }
              : { kind: "tasks", text: null, notRecorded: true },
          ],
          narrative: recommendation,
        },
        s06: {
          items: payload.receiving
            ? [
                {
                  kind: "receiver",
                  unit: payload.receiving.unit ?? null,
                  cadre: payload.receiving.cadre ?? null,
                },
              ]
            : [],
        },
      },
    },
    clientKey,
  });

  // 3. The outstanding tests, proposed (never placed) by the note's author.
  const wanted = outstandingTestsOf(handover?.payload);
  const onMenu = new Set(
    wanted.length
      ? (
          await tx
            .select({ id: testCatalogue.id })
            .from(testCatalogue)
            .where(
              and(
                inArray(
                  testCatalogue.id,
                  wanted.map((t) => t.testId),
                ),
                eq(testCatalogue.active, true),
                or(isNull(testCatalogue.hospitalId), eq(testCatalogue.hospitalId, ep.hospitalId)),
              ),
            )
        ).map((t) => t.id)
      : [],
  );
  const lines: OrderLine[] = [];
  for (const t of wanted) {
    const line: OrderLine = {
      clientKey: `resus-handover:${ep.id}:${t.testId}`,
      testId: t.testId,
      priority: "routine",
      reasonText: t.reason ?? HANDOVER_REASON,
      intentSource: "resus_handover",
      sourceIntentId: `${ep.id}:${t.testId}`,
    };
    if (
      onMenu.has(t.testId) &&
      !(await replayed(tx, encounterOrders, line.clientKey, ep.patientUserId))
    )
      lines.push(line);
  }
  if (lines.length)
    await placeOrders(
      leader?.userId
        ? {
            ...ctx,
            actor: { ...actor, userId: leader.userId, cadreCode: leader.cadreCode ?? "UNKNOWN" },
          }
        : ctx,
      { patientUserId: ep.patientUserId, encounterId, orders: lines },
      { propose: true },
    );

  // 4. Clear the flag and link the episode.
  await tx
    .update(resusEpisodes)
    .set({ pendingEncounterHandoff: false, encounterId })
    .where(eq(resusEpisodes.id, ep.id));
  return { id: noteId, encounterId };
}
