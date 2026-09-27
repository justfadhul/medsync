import "server-only";

import type { WriteCtx } from "./context";
import type { DispositionCode, FollowUp, TransitionError } from "@/lib/emr/encounter";
import type { ClosureReasonCode } from "@/lib/emr/settings";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { clinicalNotes, conditions, encounterOrderEvents, specimens } from "@/db/schema/emr";
import { encounterOrders } from "@/db/schema/encounter";
import { encounters } from "@/db/schema/scheduling";
import { completionWarnings, planTransition } from "@/lib/emr/encounter";
import { decrypt, encrypt } from "@/lib/encryption";
import { EmrWriteError } from "./context";
import { ORDERING_CADRES, requireCadre } from "./orders";

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
      ...(input.followUp ? { follow_up: input.followUp } : {}),
    },
  };
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
