"use server";

import { z } from "zod";

import { EmrWriteError } from "@/lib/emr/write/context";
import * as care from "@/lib/emr/write/nursing-care";
import { runEmrWrite } from "@/lib/emr/write/orders";
import { nurseWardV2LiveFor } from "@/lib/nurse/feature";

/**
 * The nursing care plan from the nurse's chart (ADR 0546 Phase 2). Zod → requireEmrActor("nurse") → EMR_V1 and
 * NURSE_WARD_V2 for the hospital → one transaction with the access check → lib/emr/write/nursing-care.ts.
 * Idempotent on the client key; append-only and audited by the 0314 triggers.
 */
const uuid = z.uuid();
const clientKey = z.string().trim().min(8).max(120);
const text = z.string().max(300);
const base = { surface: z.literal("nurse"), patientUserId: uuid, clientKey };
const OFF = "The nurse ward desk is not switched on here.";
const guard = (hospitalId: string) => {
  if (!nurseWardV2LiveFor(hospitalId)) throw new EmrWriteError("config", OFF);
};

const AddProblem = z.object({
  ...base,
  encounterId: uuid,
  problem: text.min(1, "Write the problem."),
  label: text.nullable().optional(),
  relatedTo: text.nullable().optional(),
  asShownBy: text.nullable().optional(),
  goal: text.min(1, "Write the goal."),
  goalBy: text.nullable().optional(),
  careItems: z.array(text).min(1, "Add at least one care item.").max(20),
  libraryKey: z.string().max(60).nullable().optional(),
});
const EndProblem = z.object({
  ...base,
  problemId: uuid,
  how: z.enum(["resolved", "entered_in_error"]),
  reason: text.nullable().optional(),
});
const CareEvent = z.object({
  ...base,
  problemId: uuid,
  kind: z.enum(["tick", "untick", "evaluation"]),
  itemIndex: z.number().int().min(0).max(19).nullable().optional(),
  evaluation: z.enum(care.EVALUATIONS).nullable().optional(),
  note: text.nullable().optional(),
});

export async function addCareProblem(raw: unknown) {
  return runEmrWrite(
    AddProblem,
    raw,
    (ctx, input) => (guard(ctx.actor.hospitalId), care.addCareProblem(ctx, input)),
  );
}

export async function endCareProblem(raw: unknown) {
  return runEmrWrite(
    EndProblem,
    raw,
    (ctx, input) => (guard(ctx.actor.hospitalId), care.endCareProblem(ctx, input)),
  );
}

export async function recordCareEvent(raw: unknown) {
  return runEmrWrite(
    CareEvent,
    raw,
    (ctx, input) => (guard(ctx.actor.hospitalId), care.recordCareEvent(ctx, input)),
  );
}
