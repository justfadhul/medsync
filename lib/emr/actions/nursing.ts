"use server";

import type { WriteCtx } from "@/lib/emr/write/context";
import type { WriteResult } from "@/lib/emr/write/orders";
import { z } from "zod";

import { NURSE_TASKS_COPY as C } from "@/content/nurse-tasks";
import { nurseTasksLiveFor } from "@/lib/emr/feature";
import { EmrWriteError } from "@/lib/emr/write/context";
import {
  completeIvTask,
  completeResultTask,
  recordDose,
  reverseDose,
} from "@/lib/emr/write/nursing";
import { runEmrWrite } from "@/lib/emr/write/orders";

/**
 * The nurse side of the one Prescribe (kit P2 b, F5). Zod → requireEmrActor("nurse") → EMR_V1 →
 * PRESCRIBE_V2 nurse side for the hospital → one transaction with the access rule. The cadre gate
 * (nurses only) is in each write; nothing here trusts a drug, dose or route from the screen: a dose
 * is recorded against the prescription line, which names them.
 */

const uuid = z.uuid();
const clientKey = z.string().trim().min(8).max(120);
const base = { surface: z.literal("nurse"), patientUserId: uuid, clientKey };

const gated =
  <I, R extends WriteResult>(write: (ctx: WriteCtx, input: I) => Promise<R>) =>
  (ctx: WriteCtx, input: I) => {
    if (!nurseTasksLiveFor(ctx.actor.hospitalId))
      throw new EmrWriteError("config", "Nurse tasks are not switched on here.");
    return write(ctx, input);
  };

const Cannula = z.object({
  ...base,
  taskId: uuid,
  size: z.enum(C.sizes),
  site: z.enum(C.sites),
});

/** "Done: cannula in". */
export async function doneCannulaTask(raw: unknown) {
  return runEmrWrite(Cannula, raw, gated(completeIvTask));
}

const Result = z
  .object({
    ...base,
    taskId: uuid,
    value: z.string().trim().min(1).max(200).optional(),
    code: z.string().trim().min(1).max(60).optional(),
  })
  .refine((r) => !r.value !== !r.code, { message: "Enter the result." });

/** "Save result" on a task: through the results writer, which completes the order. */
export async function saveTaskResult(raw: unknown) {
  return runEmrWrite(Result, raw, gated(completeResultTask));
}

const Dose = z
  .object({
    ...base,
    prescriptionId: uuid,
    scheduledFor: z.iso.datetime(),
    given: z.boolean(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((d) => d.given || (d.reason?.length ?? 0) >= 3, {
    message: "Say why the dose is withheld.",
  });

/** Given / Withhold on one due dose. */
export async function recordChartDose(raw: unknown) {
  return runEmrWrite(
    Dose,
    raw,
    gated((ctx, i: z.infer<typeof Dose>) =>
      recordDose(ctx, { ...i, scheduledFor: new Date(i.scheduledFor) }),
    ),
  );
}

const Reverse = z.object({ ...base, marId: uuid, reason: z.string().trim().min(3).max(500) });

/** "Wrong entry": undo a dose record with a reason (a reversal row). */
export async function undoChartDose(raw: unknown) {
  return runEmrWrite(Reverse, raw, gated(reverseDose));
}
