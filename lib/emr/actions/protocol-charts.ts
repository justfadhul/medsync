"use server";

import type { WriteCtx } from "@/lib/emr/write/context";
import type { WriteResult } from "@/lib/emr/write/orders";
import { z } from "zod";

import { protocolsLiveFor } from "@/lib/emr/feature";
import { EmrWriteError } from "@/lib/emr/write/context";
import { runEmrWrite } from "@/lib/emr/write/orders";
import {
  addChartNote,
  changeParam,
  chartAct,
  endChart,
  recordSlot,
  recordVitals,
  sendChartOrder,
  startChart,
  undoChartEvent,
} from "@/lib/emr/write/protocol-charts";
import { PRESCRIBE_PLACES } from "@/lib/prescribing/places";
import { isLocalDev } from "@/lib/protocols/quick";

/**
 * Protocol charts (prescribing kit P4, F7–F8), behind PRESCRIBE_V2 (`protocolsLiveFor`). Zod →
 * requireEmrActor → EMR_V1 → the flag → one transaction with the access rule. The role (from the
 * signed-in cadre) and whether the chart offers the act now are decided in the write functions.
 */

const uuid = z.uuid();
const clientKey = z.string().trim().min(8).max(120);
const base = {
  surface: z.enum(["doctor", "clinician", "nurse"]),
  patientUserId: uuid,
  chartId: uuid,
  clientKey,
  /** Local development only: the chart clock moved this many minutes ahead (ignored elsewhere). */
  devAt: z.number().int().min(0).max(100_000).optional(),
};

const gated =
  <I, R extends WriteResult>(write: (ctx: WriteCtx, input: I) => Promise<R>) =>
  (ctx: WriteCtx, input: I) => {
    if (!protocolsLiveFor(ctx.actor.hospitalId))
      throw new EmrWriteError("config", "Protocols are not switched on here.");
    const devAt = (input as { devAt?: number }).devAt;
    return write(
      devAt && isLocalDev() ? { ...ctx, now: new Date(ctx.now.getTime() + devAt * 60_000) } : ctx,
      input,
    );
  };

const key = z.string().min(1).max(60);
const Act = z.discriminatedUnion("t", [
  z.object({ t: z.literal("mark"), key }),
  z.object({ t: z.literal("give"), key, checks: z.array(z.string().max(300)).max(20).optional() }),
  z.object({ t: z.literal("set"), key, value: z.string().max(80) }),
  z.object({ t: z.literal("toggle"), key, value: z.string().max(80) }),
  z.object({ t: z.literal("inv"), key, to: z.enum(["", "ordered", "done", "na"]) }),
  z.object({ t: z.literal("value"), key }),
  z.object({ t: z.literal("weight") }),
  z.object({ t: z.literal("iv") }),
  z.object({ t: z.literal("order"), keys: z.array(key).min(1).max(20) }),
]);

export async function startChartAction(raw: unknown) {
  return runEmrWrite(
    z.object({
      surface: z.enum(["doctor", "clinician"]),
      patientUserId: uuid,
      encounterId: uuid,
      versionId: uuid,
      clientKey,
    }),
    raw,
    gated(startChart),
    { refresh: true },
  );
}

export async function chartActAction(raw: unknown) {
  return runEmrWrite(
    z.object({ ...base, act: Act, value: z.string().max(20).optional() }),
    raw,
    gated(chartAct),
    { refresh: true },
  );
}

const Values = z
  .record(z.string().max(60), z.string().max(40))
  .refine((o) => Object.keys(o).length <= 30);

export async function recordSlotAction(raw: unknown) {
  return runEmrWrite(z.object({ ...base, values: Values }), raw, gated(recordSlot), {
    refresh: true,
  });
}

export async function recordVitalsAction(raw: unknown) {
  return runEmrWrite(z.object({ ...base, values: Values }), raw, gated(recordVitals), {
    refresh: true,
  });
}

export async function changeParamAction(raw: unknown) {
  return runEmrWrite(
    z.object({
      ...base,
      add: z.object({ name: z.string().max(40), unit: z.string().max(12) }).optional(),
      removeId: uuid.optional(),
    }),
    raw,
    gated(changeParam),
    { refresh: true },
  );
}

export async function addChartNoteAction(raw: unknown) {
  return runEmrWrite(z.object({ ...base, text: z.string().max(1000) }), raw, gated(addChartNote), {
    refresh: true,
  });
}

export async function endChartAction(raw: unknown) {
  return runEmrWrite(
    z.object({ ...base, reason: z.string().max(300).optional(), reopen: z.boolean().optional() }),
    raw,
    gated(endChart),
    { refresh: true },
  );
}

export async function undoChartEventAction(raw: unknown) {
  return runEmrWrite(
    z.object({ ...base, eventId: uuid, reason: z.string().max(500) }),
    raw,
    gated(undoChartEvent),
    { refresh: true },
  );
}

export async function sendChartOrderAction(raw: unknown) {
  return runEmrWrite(
    z.object({
      ...base,
      place: z.enum(PRESCRIBE_PLACES),
      answers: z.record(z.string().max(120), z.string().max(40)).default({}),
      witness: z.string().trim().max(120).nullable().default(null),
    }),
    raw,
    gated(sendChartOrder),
    { refresh: true },
  );
}
