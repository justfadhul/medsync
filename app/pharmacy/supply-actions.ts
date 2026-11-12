"use server";

import type { EmrDb } from "@/lib/emr/db";
import type { ReviewResult as ActionResult } from "@/lib/pharmacy/review/store";
import type { HandoverOutcome } from "@/lib/pharmacy/supply/store";
import type { PharmacyCtx, PharmacyNeed } from "@/lib/pharmacy/write";
import type { z } from "zod";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { REVIEW } from "@/content/pharmacy-review";
import { SUPPLY } from "@/content/pharmacy-supply";
import { prescribeV2LiveFor } from "@/lib/emr/feature";
import { logger } from "@/lib/logger";
import { requirePharmacyActor } from "@/lib/pharmacy/actor";
import { pharmacyDispensingLiveFor } from "@/lib/pharmacy/feature";
import { patientListLive } from "@/lib/pharmacy/patient-list";
import * as store from "@/lib/pharmacy/supply/store";
import { runPharmacyWrite } from "@/lib/pharmacy/write";

/**
 * Hand-over and supply (Pharmacy Phase 1, Section 8: Supply). The house contract: Zod with a client
 * key → the actor (auth, AAL2, the pharmacy affiliation, the acting point) → `pharmacyDispensing` for
 * the hospital → the permission and the point inside one transaction (`runPharmacyWrite`, PA2-4) →
 * the pharmacy pages revalidated. The hand-over, the typed check and the labels need
 * `pharmacy.dispense` at a live point; Reverse needs `pharmacy.manage` or `pharmacy.review`; Correct
 * the record needs `pharmacy.manage` at a point live now or once. A refusal comes back in words;
 * nothing throws to the client. No result carries a stored date of birth or phone number (SU-4).
 */

async function act<I, R extends { id: string }>(
  schema: z.ZodType<I>,
  raw: unknown,
  need: PharmacyNeed,
  write: (ctx: PharmacyCtx, input: I) => Promise<R>,
): Promise<ActionResult<R>> {
  try {
    const actor = await requirePharmacyActor();
    if (!pharmacyDispensingLiveFor(actor.hospitalId))
      return { ok: false, code: "config", error: REVIEW.refused.flagOff };
    const result = await runPharmacyWrite(schema, raw, actor, need, write);
    if (result.ok) revalidatePath("/pharmacy", "layout");
    return result;
  } catch (e) {
    unstable_rethrow(e);
    logger.error("pharmacy.supply.action_failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, code: "conflict", error: REVIEW.refused.failed };
  }
}

const bare = <R>(r: ActionResult<R>): ActionResult =>
  r.ok ? { ok: true, id: r.id, serverTime: r.serverTime } : r;

/** SU-1: the lines' outcomes come back (ids and event kinds only), so the screen shows each one. */
export async function recordHandover(
  raw: unknown,
): Promise<ActionResult & { lines?: HandoverOutcome[] }> {
  const r = await act(
    store.HandoverInput,
    raw,
    store.DISPENSE_LIVE,
    async (ctx, input: z.infer<typeof store.HandoverInput>) =>
      store.recordHandover(ctx, input, null, {
        patientList: await patientListLive(ctx.actor.hospitalId, ctx.tx as unknown as EmrDb),
        // Kit F4: under PRESCRIBE_V2 the identity and counselling confirmation is required.
        explainRequired: prescribeV2LiveFor(ctx.actor.hospitalId),
      }),
  );
  return r.ok ? { ...bare(r), lines: r.data?.lines ?? [] } : r;
}

/** SU-4: match or mismatch and the attempts left; never a stored value. */
export async function checkSecondIdentifier(
  raw: unknown,
): Promise<ActionResult & { result?: "match" | "mismatch" | "closed"; attemptsLeft?: number }> {
  const r = await act(store.IdentifierInput, raw, store.DISPENSE_LIVE, store.checkSecondIdentifier);
  return r.ok ? { ...bare(r), result: r.data?.result, attemptsLeft: r.data?.attemptsLeft } : r;
}

/** H5: the pharmacy in charge reopens a closed typed check. */
export async function reopenTypedCheck(raw: unknown) {
  return bare(
    await act(
      store.ReopenInput,
      raw,
      { permission: "pharmacy.manage", point: "live" },
      store.reopenTypedCheck,
    ),
  );
}

/**
 * LB-4, SU-13: the print is logged; a failure to log is said in words and never stops the print.
 */
export async function printLabels(raw: unknown) {
  const r = bare(await act(store.PrintInput, raw, store.DISPENSE_LIVE, store.printLabels));
  return r.ok ? r : { ...r, error: `${r.error} ${SUPPLY.labels.notLogged}` };
}
export async function reprintLabels(raw: unknown) {
  const r = bare(await act(store.PrintInput, raw, store.DISPENSE_LIVE, store.reprintLabels));
  return r.ok ? r : { ...r, error: `${r.error} ${SUPPLY.labels.notLogged}` };
}

/** SU-11: `pharmacy.manage` or `pharmacy.review`, the same hospital-local day. */
export async function reverseSupply(raw: unknown) {
  return bare(await act(store.ReverseInput, raw, store.REVERSE_NEED, store.reverseSupply));
}

/** SU-14: `pharmacy.manage`, at a point live now or once. */
export async function correctSupplyRecord(raw: unknown) {
  return bare(await act(store.CorrectInput, raw, store.MANAGE_NEED, store.correctSupplyRecord));
}
