import "server-only";

import type { WriteCtx } from "./context";
import type { DispositionCode, FollowUp, TransitionError } from "@/lib/emr/encounter";
import type { ClosureReasonCode } from "@/lib/emr/settings";
import { and, eq, inArray, isNull, or } from "drizzle-orm";

import { clinicalCosignPolicies, clinicalCosignRequests } from "@/db/schema/doctor-workspace";
import { clinicalNotes, conditions, encounterOrderEvents, specimens } from "@/db/schema/emr";
import { encounterOrders } from "@/db/schema/encounter";
import { prescriptions } from "@/db/schema/prescribing";
import { encounters } from "@/db/schema/scheduling";
import { admissionNeedsCosign } from "@/lib/emr/closure";
import { completionWarnings, planTransition } from "@/lib/emr/encounter";
import { decrypt, encrypt } from "@/lib/encryption";
import { careRequestsLiveFor } from "@/lib/requests/feature";
import { EmrWriteError } from "./context";
import { stopMedicationStatement } from "./facts";
import { ORDERING_CADRES, requireCadre } from "./orders";
import { notifyWardIncoming } from "./requests";

/**
 * Completion and administrative closure (PROMPT §5.10, ADR 0139). The Edge Function
 * `ha-complete-encounter` stays the ONE lifecycle writer (HARMONISATION R2): it closes the encounter
 * and cascades to the queue, intake, nursing and booking. What happens here, in the clinician's
 * transaction with the access check, is the planning: lib/emr/encounter.ts decides whether the move is
 * allowed and what it writes, and the three warnings are computed so they are returned, never
 * thrown. The action then sends the planned body to the Edge Function.
 */

const TRANSITION_MESSAGE: Record<TransitionError, [EmrWriteError["code"], string]> = {
  not_open: ["conflict", "The encounter is already closed."],
  not_planned: ["conflict", "Only a planned encounter can do that."],
  not_in_progress: ["conflict", "Only an encounter in progress can be completed."],
  disposition_required: ["invalid", "Choose a disposition to complete the visit."],
  follow_up_date_required: ["invalid", "Choose the review date."],
  reason_required: ["invalid", "Choose a reason for closing."],
  reason_not_allowed: ["invalid", "That reason is not offered here."],
  note_required_for_other: ["invalid", "Say why, for 'other'."],
  actor_required: ["invalid", "A named user closes an encounter."],
};

async function loadEncounter(ctx: WriteCtx, patientUserId: string, encounterId: string) {
  const [e] = await ctx.tx
    .select()
    .from(encounters)
    .where(
      and(
        eq(encounters.id, encounterId),
        eq(encounters.patientUserId, patientUserId),
        eq(encounters.hospitalId, ctx.actor.hospitalId),
      ),
    );
  if (!e) throw new EmrWriteError("not_found", "Encounter not found for this patient here.");
  return e;
}

/** The body ha-complete-encounter takes (snake case, as the function's schema). */
export type CompleteEncounterBody = Record<string, unknown> & {
  encounter_id: string;
  reason: string;
};

export interface PlanCompletionInput {
  patientUserId: string;
  encounterId: string;
  disposition: DispositionCode;
  dispositionDetail?: Record<string, string>;
  followUp?: FollowUp;
  /** ADR 0198–0200: the ward, and a bed or why the patient waits. Only with `admitted`. */
  admission?: {
    wardId: string;
    bedId?: string;
    waitReason?: "no_free_bed" | "extra_bed" | "floor" | "other";
    waitNote?: string;
    leadingConditionId?: string;
  };
}

const WARNING_TEXT = {
  unsigned_notes: (n: number) =>
    `${n} note${n === 1 ? " is" : "s are"} not signed yet: the visit stays in Needs closing until signed.`,
  no_diagnosis: () => "No diagnosis is recorded for this visit.",
  orders_not_collected: (n: number) =>
    `${n} order${n === 1 ? " has" : "s have"} no specimen collected yet.`,
};

/** Complete a visit: a disposition is required; unsigned notes, no diagnosis and uncollected
 *  orders are warnings. Pending results are normal and carry into Results to review. */
export async function planCompletion(
  ctx: WriteCtx,
  input: PlanCompletionInput,
): Promise<{ id: string; warnings: string[]; body: CompleteEncounterBody }> {
  requireCadre(ctx, ORDERING_CADRES, "complete a visit");
  const e = await loadEncounter(ctx, input.patientUserId, input.encounterId);
  const plan = planTransition(e, {
    kind: "complete",
    at: ctx.now,
    actorUserId: ctx.actor.userId,
    disposition: input.disposition,
    followUp: input.followUp,
  });
  if (!plan.ok) {
    const [code, message] = TRANSITION_MESSAGE[plan.error];
    throw new EmrWriteError(code, message);
  }
  const a = input.admission;
  if (a && input.disposition !== "admitted")
    throw new EmrWriteError("invalid", "Only an admission names a ward.");
  if (input.disposition === "admitted" && a && !a.bedId && !a.waitReason)
    throw new EmrWriteError("invalid", "Choose a bed, or say why the patient waits for one.");
  if (a?.waitReason === "other" && !a.waitNote?.trim())
    throw new EmrWriteError("invalid", "Say why the patient waits.");

  const notes = await ctx.tx
    .select({
      id: clinicalNotes.id,
      state: clinicalNotes.state,
      authorUserId: clinicalNotes.authorUserId,
      contentCiphertext: clinicalNotes.contentCiphertext,
    })
    .from(clinicalNotes)
    .where(and(eq(clinicalNotes.encounterId, e.id), isNull(clinicalNotes.addendumTo)));
  const dx = await ctx.tx
    .select({
      logicalId: conditions.logicalId,
      version: conditions.version,
      status: conditions.status,
      verification: conditions.verification,
    })
    .from(conditions)
    .where(and(eq(conditions.encounterId, e.id), eq(conditions.category, "encounter_diagnosis")));
  const newest = new Map<string, (typeof dx)[number]>();
  for (const d of dx)
    if ((newest.get(d.logicalId)?.version ?? 0) < d.version) newest.set(d.logicalId, d);
  // A deferred diagnosis in a signed note counts as an impression.
  const diagnosisDeferred = notes.some(
    (n) => n.state === "signed" && hasDeferred(JSON.parse(decrypt(n.contentCiphertext))),
  );

  const orders = await ctx.tx
    .select({ id: encounterOrders.id, kind: encounterOrders.kind })
    .from(encounterOrders)
    .where(and(eq(encounterOrders.encounterId, e.id), eq(encounterOrders.lifecycle, "events")));
  const ids = orders.map((o) => o.id);
  const collected = new Set(
    ids.length
      ? (
          await ctx.tx
            .select({ orderId: specimens.orderId })
            .from(specimens)
            .where(inArray(specimens.orderId, ids))
        ).map((s) => s.orderId)
      : [],
  );
  const orderEvents = ids.length
    ? await ctx.tx
        .select({ orderId: encounterOrderEvents.orderId, kind: encounterOrderEvents.kind })
        .from(encounterOrderEvents)
        .where(
          and(
            inArray(encounterOrderEvents.orderId, ids),
            inArray(encounterOrderEvents.kind, ["cancelled", "dismissed", "proposed", "placed"]),
          ),
        )
    : [];
  const placed = new Set(orderEvents.filter((e) => e.kind === "placed").map((e) => e.orderId));
  // A dismissed suggestion, or one nobody accepted, is not an order: there is nothing to collect.
  const cancelled = new Set(
    orderEvents
      .filter(
        (e) =>
          e.kind === "cancelled" ||
          e.kind === "dismissed" ||
          (e.kind === "proposed" && !placed.has(e.orderId)),
      )
      .map((e) => e.orderId),
  );

  const warnings = completionWarnings({
    // Only the encounter clinician's drafts: a reviewer's draft is theirs to sign (as the Workspace).
    notes: notes.filter((n) => n.state !== "draft" || n.authorUserId === e.clinicianUserId),
    diagnoses: [...newest.values()],
    diagnosisDeferred,
    orders: orders.map((o) => ({
      id: o.id,
      collected: collected.has(o.id),
      cancelled: cancelled.has(o.id),
      needsSpecimen: o.kind === "lab",
    })),
  }).map((w) =>
    w.code === "unsigned_notes"
      ? WARNING_TEXT.unsigned_notes(w.noteIds.length)
      : w.code === "orders_not_collected"
        ? WARNING_TEXT.orders_not_collected(w.orderIds.length)
        : WARNING_TEXT.no_diagnosis(),
  );

  return {
    id: e.id,
    warnings,
    body: {
      encounter_id: e.id,
      completion_reason: "ended_by_clinician",
      reason: "Visit completed by the clinician.",
      closure_kind: "clinical",
      disposition: input.disposition,
      ...(input.dispositionDetail ? { disposition_detail: input.dispositionDetail } : {}),
      ...(input.followUp
        ? {
            follow_up:
              input.followUp.kind === "booked"
                ? {
                    kind: "booked",
                    date: input.followUp.date,
                    appointment_id: input.followUp.appointmentId,
                  }
                : input.followUp,
          }
        : {}),
      ...(a
        ? {
            admission: {
              ward_id: a.wardId,
              ...(a.bedId ? { bed_id: a.bedId } : {}),
              ...(!a.bedId && a.waitReason ? { bed_wait_reason: a.waitReason } : {}),
              ...(!a.bedId && a.waitReason === "other" && a.waitNote?.trim()
                ? { bed_wait_note_ciphertext: encrypt(a.waitNote.trim()) }
                : {}),
              ...(a.leadingConditionId ? { leading_condition_id: a.leadingConditionId } : {}),
            },
          }
        : {}),
    },
  };
}

/**
 * After the close (ADR 0197, 0201), in the clinician's transaction: stop the medicines the clinician chose not
 * to continue at home (the prescription completes, its medication statement stops), and raise the admission's
 * co-sign request where the cadre needs one. Returns warnings in words; never throws for a co-sign.
 */
export async function afterClose(
  ctx: WriteCtx,
  input: {
    patientUserId: string;
    encounterId: string;
    stopRxIds: readonly string[];
    admissionId: string | null;
  },
): Promise<string[]> {
  const warnings: string[] = [];
  if (input.stopRxIds.length) {
    const rows = await ctx.tx
      .select({ id: prescriptions.id, statementId: prescriptions.medicationStatementId })
      .from(prescriptions)
      .where(
        and(
          inArray(prescriptions.id, [...input.stopRxIds]),
          eq(prescriptions.encounterId, input.encounterId),
          eq(prescriptions.patientUserId, input.patientUserId),
          eq(prescriptions.hospitalId, ctx.actor.hospitalId),
          eq(prescriptions.state, "active"),
        ),
      );
    for (const r of rows) {
      await ctx.tx
        .update(prescriptions)
        .set({ state: "completed", updatedAt: ctx.now })
        .where(eq(prescriptions.id, r.id));
      if (r.statementId)
        await stopMedicationStatement(ctx, {
          patientUserId: input.patientUserId,
          statementId: r.statementId,
          reasonCode: "stopped_at_discharge",
          clientKey: `close-stop:${r.id}`,
        });
    }
  }
  if (input.admissionId) {
    const policies = await ctx.tx
      .select({
        departmentId: clinicalCosignPolicies.departmentId,
        requirement: clinicalCosignPolicies.requirement,
      })
      .from(clinicalCosignPolicies)
      .where(
        and(
          eq(clinicalCosignPolicies.hospitalId, ctx.actor.hospitalId),
          eq(clinicalCosignPolicies.cadreCode, ctx.actor.cadreCode),
          eq(clinicalCosignPolicies.actionKind, "admit_patient"),
          ctx.actor.departmentId
            ? or(
                isNull(clinicalCosignPolicies.departmentId),
                eq(clinicalCosignPolicies.departmentId, ctx.actor.departmentId),
              )
            : isNull(clinicalCosignPolicies.departmentId),
        ),
      );
    // The department's own row wins; no row at all requests one, never refuses (ADR 0201 §2).
    const row = policies.find((p) => p.departmentId !== null) ?? policies[0];
    if (admissionNeedsCosign(row?.requirement)) {
      await ctx.tx.insert(clinicalCosignRequests).values({
        hospitalId: ctx.actor.hospitalId,
        patientUserId: input.patientUserId,
        requestedByUserId: ctx.actor.userId,
        requestedByAffiliationId: ctx.actor.affiliationId,
        requestedByCadreCode: ctx.actor.cadreCode,
        actionKind: "admit_patient",
        // PHI-free (gate-a-proposal A.5).
        actionPayload: { admissionId: input.admissionId, encounterId: input.encounterId },
      });
      warnings.push("A senior co-sign of the admission has been requested.");
    }
    // The ward's nurse in charge is told; a failed notice never fails the close (savepoint, caught).
    if (careRequestsLiveFor(ctx.actor.hospitalId)) await notifyWardIncoming(ctx, input.admissionId);
  }
  return warnings;
}

function hasDeferred(content: {
  sections?: Record<string, { items?: { kind: string; reason?: unknown }[] }>;
}) {
  return Object.values(content.sections ?? {}).some((s) =>
    (s.items ?? []).some(
      (i) =>
        i.kind === "diagnosis_deferred" && typeof i.reason === "string" && i.reason.trim() !== "",
    ),
  );
}

export interface PlanClosureInput {
  patientUserId: string;
  encounterId: string;
  reason: ClosureReasonCode;
  /** Required for 'other'; encrypted here, stored by the Edge Function as closure_note_ciphertext. */
  note?: string;
}

/** Administrative closure of an open encounter: a named user and a reason code; never automatic. */
export async function planAdministrativeClosure(
  ctx: WriteCtx,
  input: PlanClosureInput,
): Promise<{ id: string; body: CompleteEncounterBody }> {
  requireCadre(ctx, ORDERING_CADRES, "close an encounter");
  const e = await loadEncounter(ctx, input.patientUserId, input.encounterId);
  const plan = planTransition(e, {
    kind: "close_administrative",
    at: ctx.now,
    actorUserId: ctx.actor.userId,
    reason: input.reason,
    note: input.note,
  });
  if (!plan.ok) {
    const [code, message] = TRANSITION_MESSAGE[plan.error];
    throw new EmrWriteError(code, message);
  }
  return {
    id: e.id,
    body: {
      encounter_id: e.id,
      completion_reason: "closed_administratively",
      reason: `Closed administratively: ${input.reason}.`,
      closure_kind: "administrative",
      closure_reason: input.reason,
      ...(plan.patch.closureNote
        ? { closure_note_ciphertext: encrypt(plan.patch.closureNote) }
        : {}),
    },
  };
}
