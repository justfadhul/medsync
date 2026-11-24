"use server";

import type { ActionResult } from "@/lib/emr/write/context";
import type { RequestCtx } from "@/lib/emr/write/requests";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { CARE_REQUEST_COPY } from "@/content/care-requests";
import { requireEmrActor } from "@/lib/emr/actor";
import { actionError, EmrWriteError } from "@/lib/emr/write/context";
import { runEmrWrite } from "@/lib/emr/write/orders";
import * as write from "@/lib/emr/write/requests";
import { careRequestsLiveFor } from "@/lib/requests/feature";

/**
 * The care request lifecycle (ADR 0533). Zod → requireEmrActor → CARE_REQUESTS for the hospital →
 * one writer transaction with the request locked (lib/emr/write/requests.ts), which checks who may act.
 * The reply also needs chart access, so it runs through runEmrWrite.
 */

const uuid = z.uuid();
const surface = z.enum(["doctor", "clinician"]);
const clientKey = z.string().trim().min(8).max(120);
const note = z.string().trim().max(2000).optional();
const reasons = <T extends Record<string, string>>(m: T) =>
  z.enum(Object.keys(m) as [keyof T & string, ...(keyof T & string)[]]);

const Base = z.object({ surface, requestId: uuid });
const Seen = Base;
const Accept = Base.extend({
  clientKey,
  expectInMin: z.union([z.literal(15), z.literal(30), z.literal(60)]).nullable(),
});
const Decline = Base.extend({
  clientKey,
  reasonCode: reasons(CARE_REQUEST_COPY.DECLINE_REASONS),
  note,
});
const Redirect = Base.extend({
  clientKey,
  departmentId: uuid,
  reasonCode: reasons(CARE_REQUEST_COPY.REDIRECT_REASONS),
  note,
});
const Cancel = Base.extend({
  clientKey,
  reasonCode: reasons(CARE_REQUEST_COPY.CANCEL_REASONS),
  note,
});
const Close = Base.extend({ clientKey });
const Reply = z.object({
  surface,
  patientUserId: uuid,
  requestId: uuid,
  clientKey,
  findings: z.string().trim().max(4000).optional(),
  assessment: z.string().trim().min(1).max(4000),
  recommendations: z.string().trim().min(1).max(4000),
  followUp: z.boolean(),
});

const OFF = "Requests are not switched on here.";

function revalidate(): void {
  revalidatePath("/doctor/requests");
  revalidatePath("/clinician/requests");
}

async function act<I extends z.infer<typeof Base>>(
  schema: z.ZodType<I>,
  raw: unknown,
  fn: (c: RequestCtx, input: I) => Promise<{ id: string } | void>,
): Promise<ActionResult> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    return {
      ok: false,
      code: "invalid",
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  const input = parsed.data;
  const actor = await requireEmrActor(input.surface);
  if (!careRequestsLiveFor(actor.hospitalId)) return { ok: false, code: "config", error: OFF };
  try {
    const out = await write.withRequestWrite(actor, input.requestId, (c) => fn(c, input));
    revalidate();
    return { ok: true, id: out?.id ?? input.requestId, serverTime: new Date().toISOString() };
  } catch (e) {
    return actionError(e);
  }
}

export async function markRequestSeen(raw: unknown) {
  return act(Seen, raw, (c) => write.markSeen(c));
}

export async function acceptRequestAction(raw: unknown) {
  return act(Accept, raw, (c, i) => write.acceptRequest(c, i));
}

export async function declineRequestAction(raw: unknown) {
  return act(Decline, raw, (c, i) => write.declineRequest(c, i));
}

export async function redirectRequestAction(raw: unknown) {
  return act(Redirect, raw, (c, i) => write.redirectRequest(c, i));
}

export async function cancelRequestAction(raw: unknown) {
  return act(Cancel, raw, (c, i) => write.cancelRequest(c, i));
}

export async function closeRequestAction(raw: unknown) {
  return act(Close, raw, (c, i) => write.closeRequest(c, i));
}

/** Signs the reply note; needs chart access (accepting grants it through care_team). */
export async function replyToRequestAction(raw: unknown) {
  const result = await runEmrWrite(Reply, raw, (ctx, input) => {
    if (!careRequestsLiveFor(ctx.actor.hospitalId)) throw new EmrWriteError("config", OFF);
    return write.replyToRequest(ctx, input);
  });
  if (result.ok) revalidate();
  return result;
}
