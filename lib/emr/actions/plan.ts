"use server";

import { z } from "zod";

import { OBS_FREQUENCIES, PlanOrderLineSchema, PlanRequestLineSchema } from "@/lib/clerking/plan/draft";
import { clerkingPlanV2LiveFor, emrPrescribingLive } from "@/lib/emr/feature";
import { EmrWriteError } from "@/lib/emr/write/context";
import { runEmrWrite } from "@/lib/emr/write/orders";
import * as write from "@/lib/emr/write/plan";
import { PlanRxSchema } from "@/lib/prescribing/plan-rx";
import { careRequestsLiveFor } from "@/lib/requests/feature";

/**
 * The Plan's writes (ADRs 0184, 0186, 0189). Zod → requireEmrActor → EMR_V1 → CLERKING_PLAN_V2
 * for the hospital (and EMR_PRESCRIBING for prescriptions) → one transaction with the access check
 * → lib/emr/write/plan.ts, which re-runs every order rule and prescribing check.
 */

const uuid = z.uuid();
const surface = z.enum(["doctor", "clinician"]);
const obs = z.enum(OBS_FREQUENCIES).nullable();

const PlacePlan = z.object({
  surface,
  patientUserId: uuid,
  encounterId: uuid,
  orders: z.array(PlanOrderLineSchema).max(40),
  prescriptions: z.array(PlanRxSchema).max(40),
  requests: z.array(PlanRequestLineSchema).max(10).default([]),
  observationFrequency: obs,
  measureUrine: z.boolean(),
});

const SyncCharts = z.object({
  surface,
  patientUserId: uuid,
  encounterId: uuid,
  observationFrequency: obs,
  measureUrine: z.boolean(),
});

const OFF = "The Plan is not switched on here.";
const RX_OFF = "Prescribing from the encounter is not switched on here.";

export async function placePlan(raw: unknown) {
  return runEmrWrite(PlacePlan, raw, (ctx, input) => {
    if (!clerkingPlanV2LiveFor(ctx.actor.hospitalId)) throw new EmrWriteError("config", OFF);
    if (input.prescriptions.length && !emrPrescribingLive(ctx.actor.hospitalId))
      throw new EmrWriteError("config", RX_OFF);
    if (input.requests.length && !careRequestsLiveFor(ctx.actor.hospitalId))
      throw new EmrWriteError("config", "Requests are not switched on here.");
    return write.placePlan(ctx, input);
  });
}

/** Opens the charts the plan as recorded calls for (on Mark plan done, and the urine switch). */
export async function syncPlanCharts(raw: unknown) {
  return runEmrWrite(SyncCharts, raw, async (ctx, input) => {
    if (!clerkingPlanV2LiveFor(ctx.actor.hospitalId)) throw new EmrWriteError("config", OFF);
    const ids = await write.openPlanCharts(ctx, input);
    return { id: ids[0] ?? input.encounterId, chartIds: ids };
  });
}
