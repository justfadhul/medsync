import "server-only";

import type { WriteCtx } from "./context";
import type { EmrDb, EmrTx } from "@/lib/emr/db";
import type { ResusScope } from "@/lib/resus/scope";
import { sql } from "drizzle-orm";

import { resolveEmrAccess } from "@/lib/emr/access";
import { emrV1Live } from "@/lib/emr/feature";
import { loadAllergyInput } from "@/lib/emr/read/allergies";
import { logger } from "@/lib/logger";
import { assertAllergyStatus, recordAllergy } from "./facts";

export type AmpleScope = Pick<
  ResusScope,
  "userId" | "fullName" | "hospitalId" | "departmentId" | "affiliationId" | "cadreCode"
>;
export type AmpleCapture = { substances: string[]; nkda: boolean };

/**
 * R1 (HARMONISATION §2, ADR 0135): a resus allergy capture (the AMPLE editor, v1 or v2, or the
 * prescribe dialog's box) also lands on the allergy record — each substance not already there
 * through recordAllergy (informant: the patient; provenance: the timeline note), NKDA through
 * assertAllergyStatus. Keyed on the note id, the same key the 0071 backfill uses, so nothing is
 * copied twice.
 *
 * Gated on emrV1Live() (0071 applied anywhere), not on this hospital: the allergy record crosses
 * hospitals (STOP 1, O-8), so a hospital with the EMR still off must feed it too.
 */
export async function ampleToRecord(
  tx: EmrTx,
  scope: AmpleScope,
  o: { patientUserId: string; episodeId: string; noteId: string; capture: AmpleCapture },
): Promise<void> {
  if (!emrV1Live()) return;
  // Identity for the audit triggers, as lib/emr/db.ts asClinicalWriter sets it.
  await tx.execute(
    sql`SELECT set_config('app.user_id', ${scope.userId}, true),
               set_config('app.hospital_id', ${scope.hospitalId}, true),
               set_config('request.jwt.claim.sub', ${scope.userId}, true)`,
  );
  const access = await resolveEmrAccess(tx, {
    userId: scope.userId,
    patientUserId: o.patientUserId,
    hospitalId: scope.hospitalId,
  });
  if (!access.allowed) {
    logger.warn("resus.ample.no_record_basis", { episodeId: o.episodeId });
    return;
  }
  const ctx: WriteCtx = {
    tx,
    actor: { ...scope, isClinical: true, surface: "nurse" },
    basis: access.basis,
    now: new Date(),
  };
  const onRecord = new Set(
    (await loadAllergyInput(tx, o.patientUserId)).entries.map((e) => e.value.toLowerCase()),
  );
  for (const [i, raw] of o.capture.substances.entries()) {
    const text = raw.trim();
    if (!text || onRecord.has(text.toLowerCase())) continue;
    onRecord.add(text.toLowerCase());
    await recordAllergy(ctx, {
      patientUserId: o.patientUserId,
      encounterId: null,
      clientKey: `ample:${o.noteId}:${i}`,
      substance: { text },
      informant: "patient",
      legacyRef: { table: "resus_timeline_events", id: o.noteId, index: String(i) },
    });
  }
  if (o.capture.nkda && o.capture.substances.length === 0)
    await assertAllergyStatus(ctx, {
      patientUserId: o.patientUserId,
      encounterId: null,
      clientKey: `ample:${o.noteId}:nkda`,
      assertion: "no_known_drug_allergies",
      legacyRef: { table: "resus_timeline_events", id: o.noteId },
    });
}

/**
 * The v1 desk appends its note through the service client, outside any transaction, so the
 * write-through runs in its own, after the note. It never fails the resus entry: the note is kept
 * either way, and a skipped copy is logged.
 */
export async function ampleNoteToRecord(
  scope: AmpleScope,
  o: {
    patientUserId: string | null;
    episodeId: string;
    noteId: string;
    capture: AmpleCapture;
  },
  database?: EmrDb,
): Promise<void> {
  const { patientUserId } = o;
  if (!patientUserId || !emrV1Live()) return;
  try {
    const conn = database ?? ((await import("@/db")).db as unknown as EmrDb);
    await conn.transaction((tx) => ampleToRecord(tx, scope, { ...o, patientUserId }));
  } catch (e) {
    logger.warn("resus.ample.record_write_failed", { episodeId: o.episodeId, reason: String(e) });
  }
}
