"use server";

import { z } from "zod";

import * as orders from "@/lib/emr/write/orders";
import { runEmrWrite } from "@/lib/emr/write/orders";
import * as specimens from "@/lib/emr/write/specimens";

/**
 * Orders and specimens (PROMPT §8). Each action: Zod → requireEmrActor(surface) → EMR_V1 for the
 * hospital → one transaction with the access check → the write in lib/emr/write/*. Idempotent on
 * the client key; audited by the 0071 triggers.
 */

const surface = z.enum(["doctor", "nurse", "clinician", "lab"]);
const uuid = z.uuid();
const clientKey = z.string().trim().min(8).max(120);
const base = { surface, patientUserId: uuid };

const OrderLine = z.object({
  clientKey,
  testId: uuid,
  priority: z.enum(["routine", "urgent", "immediate"]),
  reasonConditionIds: z.array(uuid).max(10).optional(),
  reasonText: z.string().trim().max(500).optional(),
});
export type OrderLineInput = z.infer<typeof OrderLine>;

const PlaceOrders = z.object({
  ...base,
  encounterId: uuid,
  orders: z.array(OrderLine).min(1).max(30),
});

const CancelOrder = z.object({
  ...base,
  orderId: uuid,
  reasonCode: z.string().trim().min(1).max(60).optional(),
  reasonText: z.string().trim().max(500).optional(),
  clientKey,
});

const CollectSpecimen = z.object({
  ...base,
  orderId: uuid,
  identifiersConfirmed: z.literal(true, { error: "Confirm two identifiers before collecting." }),
  fastingState: z.enum(["fasting", "non_fasting", "unknown"]).optional(),
  fastingHours: z.number().min(0).max(240).optional(),
  collectedAt: z.coerce.date().optional(),
  specimenType: z.enum(specimens.SPECIMEN_TYPES).optional(),
  container: z.enum(specimens.CONTAINERS).optional(),
  labelNo: z.string().trim().max(60).optional(),
  clientKey,
});

const SpecimenAct = z.object({ ...base, specimenId: uuid, clientKey });
const RejectSpecimen = SpecimenAct.extend({ reasonCode: z.enum(specimens.REJECTION_REASONS) });

export async function placeOrders(raw: unknown) {
  return runEmrWrite(PlaceOrders, raw, orders.placeOrders);
}

export async function cancelOrder(raw: unknown) {
  return runEmrWrite(CancelOrder, raw, orders.cancelOrder);
}

export async function collectSpecimen(raw: unknown) {
  return runEmrWrite(CollectSpecimen, raw, specimens.collectSpecimen);
}

export async function receiveSpecimen(raw: unknown) {
  return runEmrWrite(SpecimenAct, raw, specimens.receiveSpecimen);
}

export async function rejectSpecimen(raw: unknown) {
  return runEmrWrite(RejectSpecimen, raw, specimens.rejectSpecimen);
}
