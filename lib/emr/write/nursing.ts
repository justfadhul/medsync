import "server-only";

import type { WriteCtx } from "./context";
import type { WriteResult } from "./orders";
import type { PlanRx } from "@/lib/prescribing/plan-rx";
import { and, eq, or } from "drizzle-orm";

import { fill } from "@/content/lab-workspace-v2";
import { NURSE_TASKS_COPY as C } from "@/content/nurse-tasks";
import { medicationAdministrationRecords, nurseTasks } from "@/db/schema/nurse-workspace";
import { prescriptions } from "@/db/schema/prescribing";
import { drugById } from "@/lib/prescribing/formulary";
import { EmrWriteError } from "./context";
import { recordProcedure } from "./facts";
import { NURSE_CADRES } from "./orders";
import { enterResults } from "./results";

/**
 * Nurse tasks and the medicine chart (prescribing kit P2 (b), F5). Tasks are raised on the server
 * when lines are sent (never by the screen); a nurse closes one by doing it, and what she records
 * goes to the record's own writers (a `procedures` row for a cannula, `enterResults` for a result).
 * A dose on a prescription line is a MAR event; a mistake is undone by a reversal row, never edited.
 */

const conflict = (m: string) => new EmrWriteError("conflict", m);
const invalid = (m: string) => new EmrWriteError("invalid", m);

export type NurseTaskSource = "prescription" | "order" | "protocol_chart" | "manual";

/** The one insert for every task type (P4's protocol charts call this too). Idempotent by key. */
export async function raiseNurseTask(
  ctx: WriteCtx,
  input: {
    patientUserId: string;
    encounterId: string | null;
    type: string;
    sourceKind: NurseTaskSource;
    sourceId: string | null;
    payload: Record<string, unknown>;
    dueAt: Date | null;
    clientKey: string;
  },
): Promise<string> {
  const [row] = await ctx.tx
    .insert(nurseTasks)
    .values({
      hospitalId: ctx.actor.hospitalId,
      patientUserId: input.patientUserId,
      encounterId: input.encounterId,
      type: input.type,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      payload: input.payload,
      dueAt: input.dueAt,
      createdAt: ctx.now,
      createdByUserId: ctx.actor.userId,
      clientKey: input.clientKey,
    })
    .onConflictDoNothing()
    .returning({ id: nurseTasks.id });
  if (row) return row.id;
  const [had] = await ctx.tx
    .select({ id: nurseTasks.id })
    .from(nurseTasks)
    .where(eq(nurseTasks.clientKey, input.clientKey));
  return had!.id;
}

/**
 * Sending: IV lines for a patient with no line on this visit and no open cannula task raise one
 * "Insert an IV cannula" task, due now when the first IV dose is now.
 * ponytail: a line counts for the whole visit (no resite or removal yet); a cannula noted only in
 * the examination's free text is not seen. Add line removal when the IV-access record lands.
 */
export async function raiseIvTaskOnSend(
  ctx: WriteCtx,
  input: { patientUserId: string; encounterId: string; lines: PlanRx[]; prescriptionIds: string[] },
): Promise<string | null> {
  const iv = input.lines.flatMap((rx, i) =>
    rx.route === "iv" || rx.route === "infusion" ? [{ rx, id: input.prescriptionIds[i]! }] : [],
  );
  if (!iv.length) return null;
  const [has] = await ctx.tx
    .select({ id: nurseTasks.id })
    .from(nurseTasks)
    .where(
      and(
        eq(nurseTasks.patientUserId, input.patientUserId),
        eq(nurseTasks.type, "iv_cannula"),
        or(
          eq(nurseTasks.status, "open"),
          and(eq(nurseTasks.status, "done"), eq(nurseTasks.encounterId, input.encounterId)),
        ),
      ),
    )
    .limit(1);
  if (has) return null;
  const now = iv.some((l) => l.rx.start !== "next_round");
  return raiseNurseTask(ctx, {
    patientUserId: input.patientUserId,
    encounterId: input.encounterId,
    type: "iv_cannula",
    sourceKind: "prescription",
    sourceId: iv[0]!.id,
    payload: {
      prescriptionIds: iv.map((l) => l.id),
      drugs: iv.map((l) => drugById(l.rx.drugId)?.generic ?? l.rx.drugId),
      first: now ? "now" : "next_round",
    },
    dueAt: now ? ctx.now : null,
    clientKey: `${iv[0]!.rx.clientKey}:iv-task`,
  });
}

async function openTask(ctx: WriteCtx, patientUserId: string, taskId: string, type: string) {
  const [t] = await ctx.tx
    .select()
    .from(nurseTasks)
    .where(
      and(
        eq(nurseTasks.id, taskId),
        eq(nurseTasks.patientUserId, patientUserId),
        eq(nurseTasks.hospitalId, ctx.actor.hospitalId),
      ),
    );
  if (!t || t.type !== type) throw new EmrWriteError("not_found", "No such task.");
  return t;
}

async function closeTask(ctx: WriteCtx, taskId: string, outcome: Record<string, unknown>) {
  const done = await ctx.tx
    .update(nurseTasks)
    .set({ status: "done", doneAt: ctx.now, doneByUserId: ctx.actor.userId, outcome })
    .where(and(eq(nurseTasks.id, taskId), eq(nurseTasks.status, "open")))
    .returning({ id: nurseTasks.id });
  if (!done.length) throw conflict("This task is already done.");
}

const outcomeOf = (o: unknown) => (o ?? {}) as Record<string, unknown>;

/** "Done: cannula in": the line is saved to the patient as a procedure, then the task closes. */
export async function completeIvTask(
  ctx: WriteCtx,
  input: { patientUserId: string; taskId: string; size: string; site: string; clientKey: string },
): Promise<WriteResult> {
  if (!NURSE_CADRES.includes(ctx.actor.cadreCode))
    throw new EmrWriteError("forbidden", "Only nurses record a cannula from a task.");
  if (!(C.sizes as readonly string[]).includes(input.size)) throw invalid("Pick the size.");
  if (!(C.sites as readonly string[]).includes(input.site)) throw invalid("Pick the site.");
  const t = await openTask(ctx, input.patientUserId, input.taskId, "iv_cannula");
  if (t.status !== "open") {
    if (outcomeOf(t.outcome).clientKey === input.clientKey) return { id: t.id };
    throw conflict("This task is already done.");
  }
  const proc = await recordProcedure(ctx, {
    patientUserId: input.patientUserId,
    encounterId: t.encounterId,
    clientKey: input.clientKey,
    text: fill(C.procedureText, { size: input.size, site: input.site }),
    outcome: "completed",
    laterality: input.site.startsWith("left")
      ? "left"
      : input.site.startsWith("right")
        ? "right"
        : undefined,
  });
  await closeTask(ctx, t.id, {
    size: input.size,
    site: input.site,
    procedureId: proc.id,
    clientKey: input.clientKey,
  });
  return { id: t.id };
}

/**
 * A result typed on a task goes through the results writer (its own gates: a nurse enters bedside
 * results only), which completes the order; then the task closes.
 */
export async function completeResultTask(
  ctx: WriteCtx,
  input: {
    patientUserId: string;
    taskId: string;
    value?: string;
    code?: string;
    clientKey: string;
  },
): Promise<WriteResult> {
  const value = input.value?.trim();
  const code = input.code?.trim();
  if (!value === !code) throw invalid("Enter the result.");
  const t = await openTask(ctx, input.patientUserId, input.taskId, "enter_result");
  if (t.status !== "open") {
    if (outcomeOf(t.outcome).clientKey === input.clientKey) return { id: t.id };
    throw conflict("This task is already done.");
  }
  const p = t.payload as { orderId?: string; conceptId?: string; unit?: string };
  if (!p.orderId || !p.conceptId) throw invalid("This task names no test.");
  const r = await enterResults(ctx, {
    patientUserId: input.patientUserId,
    orderId: p.orderId,
    status: "final",
    values: [
      value ? { conceptId: p.conceptId, value, unit: p.unit } : { conceptId: p.conceptId, code },
    ],
    clientKey: input.clientKey,
  });
  await closeTask(ctx, t.id, { reportId: r.id, clientKey: input.clientKey });
  return { id: t.id, warnings: r.warnings };
}

/* ─── The medicine chart: Given / Withhold on a prescription line ── */

const MAR_ROUTE: Readonly<Record<string, string>> = {
  oral: "oral",
  iv: "iv",
  infusion: "iv",
  im: "im",
  sc: "sc",
  inhaled: "inhaled",
  nebulised: "inhaled",
  pr: "pr",
};

/** Lines given on this chart: not high-alert or controlled (those keep their co-sign/CD routes). */
export function chartableLine(rx: { drugId: string; controlled: boolean }): boolean {
  return !rx.controlled && !drugById(rx.drugId)?.flags.highAlert;
}

export async function recordDose(
  ctx: WriteCtx,
  input: {
    patientUserId: string;
    prescriptionId: string;
    scheduledFor: Date;
    given: boolean;
    reason?: string;
    clientKey: string;
  },
): Promise<WriteResult> {
  if (!NURSE_CADRES.includes(ctx.actor.cadreCode))
    throw new EmrWriteError("forbidden", "Only nurses record doses.");
  const reason = input.reason?.trim();
  if (!input.given && !reason) throw invalid("Say why the dose is withheld.");
  const [replay] = await ctx.tx
    .select({ id: medicationAdministrationRecords.id })
    .from(medicationAdministrationRecords)
    .where(
      and(
        eq(medicationAdministrationRecords.clientKey, input.clientKey),
        eq(medicationAdministrationRecords.patientUserId, input.patientUserId),
      ),
    );
  if (replay) return { id: replay.id };
  const [rx] = await ctx.tx
    .select()
    .from(prescriptions)
    .where(
      and(
        eq(prescriptions.id, input.prescriptionId),
        eq(prescriptions.patientUserId, input.patientUserId),
        eq(prescriptions.hospitalId, ctx.actor.hospitalId),
        eq(prescriptions.isEmergency, false),
      ),
    );
  if (!rx) throw new EmrWriteError("not_found", "No such prescription line.");
  if (rx.state !== "active") throw conflict("This line is stopped.");
  if (!chartableLine(rx)) throw conflict(C.notHere);
  if (rx.protocolVersionId) throw conflict("This line is given on its protocol chart.");
  // One live record per due time: a second needs the first undone.
  const same = await ctx.tx
    .select({
      id: medicationAdministrationRecords.id,
      state: medicationAdministrationRecords.state,
    })
    .from(medicationAdministrationRecords)
    .where(
      and(
        eq(medicationAdministrationRecords.emrPrescriptionId, rx.id),
        eq(medicationAdministrationRecords.scheduledFor, input.scheduledFor),
      ),
    );
  const reversed = new Set(
    (
      await ctx.tx
        .select({ reverses: medicationAdministrationRecords.reversesId })
        .from(medicationAdministrationRecords)
        .where(
          and(
            eq(medicationAdministrationRecords.emrPrescriptionId, rx.id),
            eq(medicationAdministrationRecords.state, "reversed"),
          ),
        )
    ).map((r) => r.reverses),
  );
  if (same.some((m) => m.state !== "reversed" && !reversed.has(m.id)))
    throw conflict("This dose is already recorded.");
  const [row] = await ctx.tx
    .insert(medicationAdministrationRecords)
    .values({
      hospitalId: ctx.actor.hospitalId,
      patientUserId: input.patientUserId,
      encounterId: rx.encounterId,
      administeredByUserId: ctx.actor.userId,
      prescriptionId: rx.id,
      emrPrescriptionId: rx.id,
      drugName: rx.drugName,
      dose: rx.dose,
      route: MAR_ROUTE[rx.route] ?? "other",
      isHighAlert: false,
      state: input.given ? "administered" : "withheld",
      withheldReason: input.given ? null : reason!,
      scheduledFor: input.scheduledFor,
      administeredAt: ctx.now,
      clientKey: input.clientKey,
    })
    .returning({ id: medicationAdministrationRecords.id });
  return { id: row!.id };
}

/** "Wrong entry": a reversal row naming the dose it undoes, with the reason. At most once. */
export async function reverseDose(
  ctx: WriteCtx,
  input: { patientUserId: string; marId: string; reason: string; clientKey: string },
): Promise<WriteResult> {
  if (!NURSE_CADRES.includes(ctx.actor.cadreCode))
    throw new EmrWriteError("forbidden", "Only nurses undo a dose record.");
  const reason = input.reason.trim();
  if (reason.length < 3) throw invalid("Say what was wrong.");
  const [m] = await ctx.tx
    .select()
    .from(medicationAdministrationRecords)
    .where(
      and(
        eq(medicationAdministrationRecords.id, input.marId),
        eq(medicationAdministrationRecords.patientUserId, input.patientUserId),
        eq(medicationAdministrationRecords.hospitalId, ctx.actor.hospitalId),
      ),
    );
  if (!m || !m.emrPrescriptionId || m.state === "reversed")
    throw new EmrWriteError("not_found", "No such dose record.");
  const [had] = await ctx.tx
    .select({
      id: medicationAdministrationRecords.id,
      key: medicationAdministrationRecords.clientKey,
    })
    .from(medicationAdministrationRecords)
    .where(eq(medicationAdministrationRecords.reversesId, m.id));
  if (had) {
    if (had.key === input.clientKey) return { id: had.id };
    throw conflict("This record is already undone.");
  }
  const [row] = await ctx.tx
    .insert(medicationAdministrationRecords)
    .values({
      hospitalId: m.hospitalId,
      patientUserId: m.patientUserId,
      encounterId: m.encounterId,
      administeredByUserId: ctx.actor.userId,
      prescriptionId: m.prescriptionId,
      emrPrescriptionId: m.emrPrescriptionId,
      drugName: m.drugName,
      dose: m.dose,
      route: m.route,
      isHighAlert: m.isHighAlert,
      state: "reversed",
      withheldReason: reason,
      scheduledFor: m.scheduledFor,
      administeredAt: ctx.now,
      reversesId: m.id,
      clientKey: input.clientKey,
    })
    .returning({ id: medicationAdministrationRecords.id });
  return { id: row!.id };
}
