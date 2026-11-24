"use server";

import type { ActionResult } from "@/lib/emr/write/context";
import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { CARE_REQUEST_COPY } from "@/content/care-requests";
import { getAuthState } from "@/lib/auth";
import { secondFactorFresh } from "@/lib/auth-fresh";
import { asClinicalWriter } from "@/lib/emr/db";
import { actionError } from "@/lib/emr/write/context";
import { logger } from "@/lib/logger";
import { signRequestTimes } from "@/lib/requests/times";

const C = CARE_REQUEST_COPY.times;
const Sign = z.object({
  hospitalId: z.uuid(),
  versionId: z.uuid(),
  reviewNowAcceptMin: z.number().int(),
  review1hAcceptMin: z.number().int(),
  consultUrgentAcceptMin: z.number().int(),
  routineReplyMin: z.number().int(),
  exceptionNote: z.string().trim().max(500).nullable(),
});

/** The CSO countersigns, gated like signResponseAsCsoAction: superadmin, aal2, a fresh second factor. */
export async function signTimesAsCsoAction(raw: unknown): Promise<ActionResult> {
  const p = Sign.safeParse(raw);
  if (!p.success) return { ok: false, code: "invalid", error: CARE_REQUEST_COPY.notices.invalid };
  const state = await getAuthState();
  if (!state.user || state.aal !== "aal2" || !state.roles.includes("superadmin"))
    return { ok: false, code: "forbidden", error: C.csoOnly };
  if (!(await secondFactorFresh()))
    return { ok: false, code: "forbidden", error: `reauth: ${C.reauth}` };
  const userId = state.user.id;
  try {
    await asClinicalWriter({ userId, hospitalId: p.data.hospitalId }, (tx) =>
      signRequestTimes(
        tx,
        { userId, hospitalId: p.data.hospitalId, as: "cso" },
        {
          versionId: p.data.versionId,
          exceptionNote: p.data.exceptionNote,
          expect: {
            reviewNowAcceptMin: p.data.reviewNowAcceptMin,
            review1hAcceptMin: p.data.review1hAcceptMin,
            consultUrgentAcceptMin: p.data.consultUrgentAcceptMin,
            routineReplyMin: p.data.routineReplyMin,
          },
        },
        new Date(),
      ),
    );
    refresh();
    return { ok: true, id: p.data.versionId, serverTime: new Date().toISOString() };
  } catch (e) {
    unstable_rethrow(e);
    logger.error("requests.times.cso_failed", { error: e instanceof Error ? e.name : "unknown" });
    return actionError(e);
  }
}
