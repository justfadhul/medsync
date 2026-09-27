"use server";

import type { ActionResult } from "@/lib/emr/write/context";
import { z } from "zod";

import { ROUTES } from "@/components/emr/prescribing/model";
import { emrPrescribingLive } from "@/lib/emr/feature";
import { EmrWriteError } from "@/lib/emr/write/context";
import { runEmrWrite } from "@/lib/emr/write/orders";
import * as write from "@/lib/emr/write/prescriptions";

/**
 * Prescribe from the encounter (PROMPT Phase 7). Zod → requireEmrActor → EMR_V1 → EMR_PRESCRIBING
 * for the hospital → one transaction with the access check → lib/emr/write/prescriptions.ts, which
 * re-runs the prescribing checks. Idempotent on the client key; audited by the 0039 trigger.
 */

const text = (max: number) => z.string().trim().max(max);

const Prescribe = z.object({
  surface: z.enum(["doctor", "clinician"]),
  patientUserId: z.uuid(),
  encounterId: z.uuid(),
  clientKey: text(120).min(8),
  drugId: text(80).min(1),
  dose: text(120).optional(),
  doseMg: z.number().positive().finite().optional(),
  route: z.enum(ROUTES),
  concentration: text(120).optional(),
  frequency: text(120).min(1, "Say how often."),
  duration: text(120).min(1, "Say for how long."),
  quantity: text(120).optional(),
  instructions: text(500).optional(),
  confirmReason: text(500).optional(),
  typedDose: z.number().finite().optional(),
});
export type PrescribeRequest = z.infer<typeof Prescribe>;

const OFF_TEXT = "Prescribing from the encounter is not switched on here.";
const OFF: ActionResult<never> = { ok: false, code: "config", error: OFF_TEXT };

export async function prescribe(raw: unknown) {
  // Off everywhere: refuse before any scope or database work.
  if (!emrPrescribingLive()) return OFF;
  return runEmrWrite(Prescribe, raw, (ctx, input) => {
    if (!emrPrescribingLive(ctx.actor.hospitalId)) throw new EmrWriteError("config", OFF_TEXT);
    return write.prescribe(ctx, input);
  });
}
