"use server";

import type { ActionResult } from "@/lib/emr/write/context";
import type { RotaActor } from "@/lib/rota/write";
import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { DUTY_ROTA_COPY } from "@/content/duty-rota";
import { requireHospitalAdminScope } from "@/lib/hospital-admin/scope";
import { logger } from "@/lib/logger";
import * as w from "@/lib/rota/write";

/**
 * The admin rota's server actions (ADR 0534): the session admin acts. lib/rota/write.ts parses with Zod, refuses
 * when DUTY_ROTA is off, and maps the 0307 guard's refusals to content sentences; anything else is logged and
 * answered with one sentence, never a raw error.
 */
type Write = (actor: RotaActor, raw: unknown) => Promise<ActionResult<{ id: string }>>;
async function run(fn: Write, raw: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const s = await requireHospitalAdminScope();
    const out = await fn({ userId: s.userId, hospitalId: s.hospitalId }, raw);
    if (out.ok) refresh();
    return out;
  } catch (e) {
    unstable_rethrow(e);
    logger.error("rota.admin.action_failed", { error: e instanceof Error ? e.name : "unknown" });
    return { ok: false, code: "conflict", error: DUTY_ROTA_COPY.failed };
  }
}

export const createPostAction = async (raw: unknown) => run(w.createPost, raw);
export const archivePostAction = async (raw: unknown) => run(w.archivePost, raw);
export const assignDutyAction = async (raw: unknown) => run(w.assignDuty, raw);
export const endDutyAction = async (raw: unknown) => run(w.endDuty, raw);
