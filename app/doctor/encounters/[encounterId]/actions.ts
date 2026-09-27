"use server";

import type { CaptureMap } from "@/lib/ncd/engine/evaluate";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { encounters } from "@/db/schema/scheduling";
import { requireDoctorScope } from "@/lib/doctor/scope";
import { resolveEmrAccess } from "@/lib/emr/access";
import { asClinicalWriter } from "@/lib/emr/db";
import { isOpen } from "@/lib/emr/encounter";
import { emrV1LiveFor } from "@/lib/emr/feature";
import { ncdClerkshipLive } from "@/lib/encounter/feature";
import { resolveEncounterAccess } from "@/lib/encounter/scope";
import { DIABETES_CATALOG } from "@/lib/ncd/catalog/diabetes";
import { saveNcdDraft } from "@/lib/ncd/draft";

export type SaveDraftResult = { ok: true; at: number } | { ok: false; error: string };

/**
 * Autosave the in-progress clerkship.
 *
 * Writes to the mutable `clerkship_drafts` scratchpad, NOT to the append-only
 * clinical documentation — see lib/ncd/draft.ts for why that distinction is the
 * whole design. This is not a clinical save and does not put anything on the
 * audited timeline; it exists so that closing a laptop does not cost an hour of
 * clerking.
 *
 * The encounter is re-checked against the caller's hospital on every call. The
 * client is not trusted for that even though the page already checked it: an
 * action is a public endpoint, and the scope pin is what makes it one the
 * clinician's own hospital can rely on. The caller must also have a legitimate
 * basis for the patient — the one access rule where EMR v1 is on (0071), the
 * legacy resolver elsewhere — and a completed or cancelled encounter takes no
 * more drafts (STOP 0 safety finding).
 */
export async function saveNcdDraftAction(
  encounterId: string,
  values: CaptureMap,
): Promise<SaveDraftResult> {
  if (!ncdClerkshipLive()) return { ok: false, error: "The clerkship surface is not active." };

  const scope = await requireDoctorScope();

  const [enc] = await db
    .select({
      hospitalId: encounters.hospitalId,
      patientUserId: encounters.patientUserId,
      state: encounters.state,
    })
    .from(encounters)
    .where(eq(encounters.id, encounterId))
    .limit(1);

  if (!enc || enc.hospitalId !== scope.hospitalId) {
    return { ok: false, error: "That encounter is not yours to write to." };
  }
  if (!isOpen(enc))
    return { ok: false, error: "This encounter is closed: the draft was not saved." };
  const access = emrV1LiveFor(scope.hospitalId)
    ? await asClinicalWriter(scope, (tx) =>
        resolveEmrAccess(tx, {
          userId: scope.userId,
          patientUserId: enc.patientUserId,
          hospitalId: scope.hospitalId,
        }),
      )
    : await resolveEncounterAccess({
        userId: scope.userId,
        departmentId: scope.departmentId,
        patientUserId: enc.patientUserId,
      });
  if (!access.allowed) return { ok: false, error: "That encounter is not yours to write to." };

  const saved = await saveNcdDraft(encounterId, scope.userId, DIABETES_CATALOG, values);
  return saved
    ? { ok: true, at: Date.now() }
    : { ok: false, error: "Draft autosave is not switched on for this deployment." };
}
