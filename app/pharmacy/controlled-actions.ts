"use server";

import type { EmrDb } from "@/lib/emr/db";
import type { ReviewResult as ActionResult } from "@/lib/pharmacy/review/store";
import type { PharmacyCtx, PharmacyNeed } from "@/lib/pharmacy/write";
import type { z } from "zod";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { REVIEW } from "@/content/pharmacy-review";
import { prescribeV2LiveFor } from "@/lib/emr/feature";
import { logger } from "@/lib/logger";
import { requirePharmacyActor } from "@/lib/pharmacy/actor";
import * as store from "@/lib/pharmacy/controlled-store";
import { pharmacyDispensingLiveFor } from "@/lib/pharmacy/feature";
import { patientListLive } from "@/lib/pharmacy/patient-list";
import { MANAGE_AT_POINT, STOCK_NEED } from "@/lib/pharmacy/stock/store";
import { MANAGE_NEED, REVERSE_NEED } from "@/lib/pharmacy/supply/store";
import { runPharmacyWrite } from "@/lib/pharmacy/write";

/**
 * Controlled drugs (Pharmacy Phase 1, Section 8: Controlled; 5.9, CD-2 to CD-5, DT-8, LB-7). The house
 * contract: Zod with a client key → the actor (auth, AAL2, the pharmacy affiliation, the acting point)
 * → `pharmacyDispensing` for the hospital → the permission and the point inside one transaction
 * (`runPharmacyWrite`, PA2-4). The witness's password and authenticator code reach the server once, in
 * `attestWitness`, and are never logged, stored or returned; five failures an hour lock that witness's
 * attestations (H5), which is this file's rate limit. A refusal comes back in words.
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
    // The error only: never the input, which may hold a witness's password or code.
    logger.error("pharmacy.controlled.action_failed", {
      error: e instanceof Error ? e.name : "unknown",
    });
    return { ok: false, code: "conflict", error: REVIEW.refused.failed };
  }
}

const bare = <R>(r: ActionResult<R>): ActionResult =>
  r.ok ? { ok: true, id: r.id, serverTime: r.serverTime } : r;

/** D-PH1-42: the witness proves who they are. The answer: the attestation and the witness's cadre. */
export async function attestWitness(
  raw: unknown,
): Promise<ActionResult & { cadre?: string | null; at?: string }> {
  const r = await act(store.AttestInput, raw, store.CONTROLLED_NEED, (ctx, i) =>
    store.attestWitness(ctx, i),
  );
  if (!r.ok) return r;
  if (!r.data?.ok) return { ok: false, code: "forbidden", error: r.data?.words ?? "" };
  return { ...bare(r), cadre: r.data.cadre, at: r.data.at };
}

/** CD-3: the typed figures are committed first; MedSync's figures come back only with them. */
export async function recordControlledCount(raw: unknown) {
  const r = await act(
    store.ControlledCountInput,
    raw,
    store.CONTROLLED_NEED,
    store.recordControlledCount,
  );
  return r.ok
    ? { ...bare(r), lines: r.data?.lines ?? [], differences: r.data?.differences ?? 0 }
    : r;
}

/** CD-2: the whole hand-over in one transaction, controlled and other lines. */
export async function recordControlledSupply(raw: unknown) {
  const r = await act(
    store.ControlledSupplyInput,
    raw,
    store.CONTROLLED_LIVE,
    async (ctx, input: z.infer<typeof store.ControlledSupplyInput>) =>
      store.recordControlledSupply(ctx, input, {
        patientList: await patientListLive(ctx.actor.hospitalId, ctx.tx as unknown as EmrDb),
        // Kit F4: under PRESCRIBE_V2 the identity and counselling confirmation is required.
        explainRequired: prescribeV2LiveFor(ctx.actor.hospitalId),
      }),
  );
  return r.ok ? { ...bare(r), lines: r.data?.lines ?? [], entryIds: r.data?.entryIds ?? [] } : r;
}

export async function closeControlledDifference(raw: unknown) {
  return bare(
    await act(store.CloseDifferenceInput, raw, store.CLOSE_NEED, store.closeControlledDifference),
  );
}

export async function printRegisterEntry(raw: unknown) {
  return bare(
    await act(store.PrintRegisterInput, raw, store.CONTROLLED_NEED, store.printRegisterEntry),
  );
}

export async function confirmBackEnteredControlledSupply(raw: unknown) {
  return bare(
    await act(
      store.ConfirmBackEntryInput,
      raw,
      store.CONTROLLED_NEED,
      store.confirmBackEnteredControlledSupply,
    ),
  );
}

/* CD-5: the stock actions and reversals of a controlled product, each with its own permission. */

export async function receiveControlled(raw: unknown) {
  return bare(await act(store.ReceiveControlledInput, raw, STOCK_NEED, store.receiveControlled));
}
export async function adjustControlled(raw: unknown) {
  return bare(await act(store.AdjustControlledInput, raw, STOCK_NEED, store.adjustControlled));
}
export async function transferControlled(raw: unknown) {
  return bare(await act(store.TransferControlledInput, raw, STOCK_NEED, store.transferControlled));
}
export async function correctBatchControlled(raw: unknown) {
  return bare(
    await act(
      store.CorrectBatchControlledInput,
      raw,
      MANAGE_AT_POINT,
      store.correctBatchControlled,
    ),
  );
}
export async function reverseControlled(raw: unknown) {
  return bare(await act(store.ReverseControlledInput, raw, REVERSE_NEED, store.reverseControlled));
}
export async function correctRecordControlled(raw: unknown) {
  return bare(
    await act(store.CorrectRecordControlledInput, raw, MANAGE_NEED, store.correctRecordControlled),
  );
}
