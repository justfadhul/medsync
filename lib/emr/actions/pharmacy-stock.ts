"use server";

import { z } from "zod";

import { runEmrWrite } from "@/lib/emr/write/orders";
import { pharmacyStockAnswerLiveFor } from "@/lib/pharmacy/feature";
import { stockLinesFor } from "@/lib/pharmacy/stock/availability-read";
import { PLACE, PRESCRIBE_PLACES } from "@/lib/prescribing/places";

/**
 * The prescriber's stock line in the prescribing dialog (Pharmacy Phase 1, 5.10). Zod →
 * requireEmrActor → EMR_V1 → the access rule, in one transaction (a read: nothing is written) →
 * getAvailability's answer per medicine, no quantity (AV-6). With `pharmacyStockAnswer` off: null,
 * and the dialog keeps "Pharmacy not linked yet." (S88).
 */
const StockLines = z.object({
  surface: z.enum(["doctor", "clinician"]),
  patientUserId: z.uuid(),
  encounterId: z.uuid(),
  medicineIds: z.array(z.string().trim().min(1).max(80)).min(1).max(5),
  /** Prescribing kit F1: the place's collect point; absent, the encounter's (AV-2). */
  place: z.enum(PRESCRIBE_PLACES).optional(),
});

export async function stockLines(raw: unknown) {
  return runEmrWrite(StockLines, raw, async (ctx, input) => ({
    id: input.encounterId,
    lines: pharmacyStockAnswerLiveFor(ctx.actor.hospitalId)
      ? Object.fromEntries(
          await stockLinesFor(ctx.tx, {
            hospitalId: ctx.actor.hospitalId,
            encounterId: input.encounterId,
            medicineIds: input.medicineIds,
            now: ctx.now,
            ...(input.place ? { origin: PLACE[input.place].origin } : {}),
          }),
        )
      : null,
  }));
}
