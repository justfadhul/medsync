"use server";

import type { ActionResult } from "@/lib/emr/write/context";
import type { RequestTimes } from "@/lib/requests/escalation";
import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { CARE_REQUEST_COPY } from "@/content/care-requests";
import { secondFactorFresh } from "@/lib/auth-fresh";
import { asClinicalWriter } from "@/lib/emr/db";
import { actionError } from "@/lib/emr/write/context";
import { requireHospitalAdminScope } from "@/lib/hospital-admin/scope";
import { logger } from "@/lib/logger";
import { saveRequestTimesDraft, signRequestTimes } from "@/lib/requests/times";

/** The hospital admin sets and signs the request response times (ADR 0536); the CSO countersigns from /admin. */
const C = CARE_REQUEST_COPY.times;
const pick = ({
  reviewNowAcceptMin,
  review1hAcceptMin,
  consultUrgentAcceptMin,
  routineReplyMin,
}: RequestTimes) => ({
  reviewNowAcceptMin,
  review1hAcceptMin,
  consultUrgentAcceptMin,
  routineReplyMin,
});
const min = z.number().int().min(1).max(2880);
const Draft = z.object({
  reviewNowAcceptMin: min,
  review1hAcceptMin: min,
  consultUrgentAcceptMin: min,
  routineReplyMin: min,
  source: z.string().trim().min(3).max(500),
});

async function run(fn: (a: { userId: string; hospitalId: string }) => Promise<string>) {
  try {
    const s = await requireHospitalAdminScope();
    const a = { userId: s.userId, hospitalId: s.hospitalId };
    const id = await fn(a);
    refresh();
    return { ok: true, id, serverTime: new Date().toISOString() } as ActionResult;
  } catch (e) {
    unstable_rethrow(e);
    logger.error("requests.times.action_failed", {
      error: e instanceof Error ? e.name : "unknown",
    });
    return actionError(e);
  }
}

export async function saveTimesDraftAction(raw: unknown): Promise<ActionResult> {
  const p = Draft.safeParse(raw);
  if (!p.success)
    return {
      ok: false,
      code: "invalid",
      error: p.error.issues.some((i) => i.path[0] === "source")
        ? C.sourceShort
        : C.range(C.fields.routineReplyMin),
    };
  return run((a) => asClinicalWriter(a, (tx) => saveRequestTimesDraft(tx, a, p.data)));
}

export async function signTimesAsAdminAction(raw: unknown): Promise<ActionResult> {
  const { source: _s, ...times } = Draft.shape;
  const p = z.object({ versionId: z.uuid(), ...times }).safeParse(raw);
  if (!p.success) return { ok: false, code: "invalid", error: CARE_REQUEST_COPY.notices.invalid };
  await requireHospitalAdminScope();
  if (!(await secondFactorFresh()))
    return { ok: false, code: "forbidden", error: `reauth: ${C.reauth}` };
  return run((a) =>
    asClinicalWriter(a, async (tx) => {
      await signRequestTimes(
        tx,
        { ...a, as: "admin" },
        { versionId: p.data.versionId, exceptionNote: null, expect: pick(p.data) },
        new Date(),
      );
      return p.data.versionId;
    }),
  );
}
