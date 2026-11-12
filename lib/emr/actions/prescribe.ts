"use server";

import type { WriteCtx } from "@/lib/emr/write/context";
import type { WriteResult } from "@/lib/emr/write/orders";
import { z } from "zod";

import { PlanBasketRxSchema } from "@/lib/clerking/plan/draft";
import { prescribeV2LiveFor } from "@/lib/emr/feature";
import { brandsFor, loadPrescribeSession } from "@/lib/emr/read/prescribe";
import { EmrWriteError } from "@/lib/emr/write/context";
import { requireCadre, runEmrWrite } from "@/lib/emr/write/orders";
import { cancelPrescriptionLine } from "@/lib/emr/write/pharmacy-answers";
import { keepPrescribeDraft as keepDraft, sendPrescribed } from "@/lib/emr/write/plan";
import { PRESCRIBING_CADRES } from "@/lib/emr/write/prescriptions";
import { PRESCRIBE_PLACES } from "@/lib/prescribing/places";

/**
 * The one Prescribe dialog's server side (prescribing kit P1, F1–F3). Zod → requireEmrActor →
 * EMR_V1 → PRESCRIBE_V2 for the hospital → one transaction with the access rule. Sending is
 * `placePlan` with the place: every check runs again there from the record, the cadre gate and
 * co-sign included, whatever the screen showed. Nothing here trusts a dose or a quantity from the
 * screen.
 */

const uuid = z.uuid();
const base = {
  surface: z.enum(["doctor", "clinician"]),
  patientUserId: uuid,
  place: z.enum(PRESCRIBE_PLACES),
};
const OFF = "Prescribe is not switched on here.";

const gated =
  <I, R extends WriteResult>(write: (ctx: WriteCtx, input: I) => Promise<R>) =>
  (ctx: WriteCtx, input: I) => {
    if (!prescribeV2LiveFor(ctx.actor.hospitalId)) throw new EmrWriteError("config", OFF);
    return write(ctx, input);
  };

const Open = z.object({ ...base, encounterId: uuid.optional() });

/** Opens the dialog: the session for this patient, place and visit (the newest open one if none is named). */
export async function openPrescribe(raw: unknown) {
  return runEmrWrite(
    Open,
    raw,
    gated(async (ctx, input) => {
      requireCadre(ctx, PRESCRIBING_CADRES, "prescribe");
      const session = await loadPrescribeSession(ctx, input);
      return { id: session.encounterId, session };
    }),
  );
}

const Brands = z.object({ ...base, medicineId: z.string().trim().min(1).max(80) });

export async function prescribeBrands(raw: unknown) {
  return runEmrWrite(
    Brands,
    raw,
    gated(async (ctx, input) => ({
      id: input.patientUserId,
      brands: await brandsFor(ctx, input.medicineId, input.place),
    })),
  );
}

const Send = z.object({
  ...base,
  encounterId: uuid,
  lines: z.array(PlanBasketRxSchema).min(1).max(40),
});

/** "Sign and send": the basket in one transaction, then the draft is gone. */
export async function sendPrescription(raw: unknown) {
  return runEmrWrite(Send, raw, gated(sendPrescribed));
}

const Draft = z.object({
  ...base,
  encounterId: uuid,
  lines: z.array(PlanBasketRxSchema).max(40),
});

/** Keeps the basket when the dialog closes without sending; an empty basket removes the draft. */
export async function keepPrescribeDraft(raw: unknown) {
  return runEmrWrite(Draft, raw, gated(keepDraft));
}

const Stop = z.object({
  ...base,
  prescriptionId: uuid,
  reason: z.string().trim().min(3, "Say why it is stopped.").max(500),
});

/** "Stop" on an already prescribed line: the prescriber's own cancel (D-PH1-41), with the reason. */
export async function stopPrescribedLine(raw: unknown) {
  return runEmrWrite(
    Stop,
    raw,
    gated((ctx, input) =>
      cancelPrescriptionLine(ctx, {
        patientUserId: input.patientUserId,
        prescriptionId: input.prescriptionId,
        reasonCode: "other",
        note: input.reason,
      }),
    ),
  );
}
