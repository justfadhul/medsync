"use server";

import type { WriteCtx } from "@/lib/emr/write/context";
import type { WriteResult } from "@/lib/emr/write/orders";
import { z } from "zod";

import { protocolsLiveFor } from "@/lib/emr/feature";
import { EmrWriteError } from "@/lib/emr/write/context";
import { runEmrWrite } from "@/lib/emr/write/orders";
import {
  listProtocols,
  orderStartTest,
  previewProtocol,
  saveProtocolDraft,
  signProtocolVersion,
  startProtocol,
} from "@/lib/emr/write/protocols";
import { PRESCRIBE_PLACES } from "@/lib/prescribing/places";
import { BuilderInput } from "@/lib/protocols/quick";

/**
 * Prescribe › Protocols (prescribing kit P3, F6), behind PRESCRIBE_V2 (`protocolsLiveFor`). Zod →
 * requireEmrActor → EMR_V1 → the flag → one transaction with the access rule; the cadre gates, the
 * sign-off rule and every blocking check are in the write functions.
 */

const uuid = z.uuid();
const base = { surface: z.enum(["doctor", "clinician"]), patientUserId: uuid };
const OFF = "Protocols are not switched on here.";

const gated =
  <I, R extends WriteResult>(write: (ctx: WriteCtx, input: I) => Promise<R>) =>
  (ctx: WriteCtx, input: I) => {
    if (!protocolsLiveFor(ctx.actor.hospitalId)) throw new EmrWriteError("config", OFF);
    return write(ctx, input);
  };

export async function openProtocols(raw: unknown) {
  return runEmrWrite(
    z.object(base),
    raw,
    gated(async (ctx, input) => ({ id: input.patientUserId, ...(await listProtocols(ctx)) })),
  );
}

const typed = z.record(z.string().max(31), z.string().trim().max(20)).default({});
const One = z.object({
  ...base,
  encounterId: uuid,
  place: z.enum(PRESCRIBE_PLACES),
  versionId: uuid,
  typed,
});

export async function previewProtocolAction(raw: unknown) {
  return runEmrWrite(One, raw, gated(previewProtocol));
}

const Start = One.extend({
  clientKey: z.string().trim().min(8).max(100),
  answers: z.record(z.string().max(120), z.string().max(40)).default({}),
  witness: z.string().trim().max(120).nullable().default(null),
});

export async function startProtocolAction(raw: unknown) {
  return runEmrWrite(Start, raw, gated(startProtocol));
}

const Order = z.object({
  ...base,
  encounterId: uuid,
  versionId: uuid,
  key: z.string().max(31),
  clientKey: z.string().trim().min(8).max(100),
});

export async function orderStartTestAction(raw: unknown) {
  return runEmrWrite(Order, raw, gated(orderStartTest));
}

export async function signProtocolAction(raw: unknown) {
  return runEmrWrite(z.object({ ...base, versionId: uuid }), raw, gated(signProtocolVersion));
}

export async function saveProtocolDraftAction(raw: unknown) {
  return runEmrWrite(
    BuilderInput.extend(base),
    raw,
    gated((ctx, input) => saveProtocolDraft(ctx, input)),
  );
}
