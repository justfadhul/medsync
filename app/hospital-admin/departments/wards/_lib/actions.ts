"use server";

import type { HubResult } from "../../_lib/types";
import { revalidatePath } from "next/cache";

import { WARDS } from "@/content/hospital-admin/wards";
import { requireHospitalAdminScope } from "@/lib/hospital-admin/scope";
import { callEdge } from "@/lib/supabase/edge";
import { euObservationLiveFor, wardBuilderLiveFor } from "@/lib/wards/feature";

/*
 * Wards and beds (phase 2 of ADR 0520): the list's writes, the same ha-services-hub ops the old panel ran and no
 * others. The scope ALWAYS comes from requireHospitalAdminScope(); a hospital_id from the page is overwritten. The
 * Edge Function owns Zod, the role check, the audit row and the write.
 */

const OPS = new Set([
  "upsert_ward",
  "set_ward_closure",
  "assign_ward_in_charge",
  "end_ward_in_charge",
  "generate_beds",
  "set_bed",
  "archive",
  "unarchive",
  "start_layout_from_register",
  "link_resus_bay",
]);

export async function wardOpAction(
  input: { op: string } & Record<string, unknown>,
): Promise<HubResult> {
  if (!OPS.has(input.op)) return { ok: false, error: WARDS.errors.invalid };
  if (
    (input.op === "archive" || input.op === "unarchive") &&
    input.target !== "ward" &&
    input.target !== "bed"
  )
    return { ok: false, error: WARDS.errors.invalid };
  const scope = await requireHospitalAdminScope();
  if (input.op === "start_layout_from_register" && !wardBuilderLiveFor(scope.hospitalId))
    return { ok: false, error: WARDS.errors.invalid };
  if (input.op === "link_resus_bay" && !euObservationLiveFor(scope.hospitalId))
    return { ok: false, error: WARDS.errors.invalid };
  const r = await callEdge(
    "ha-services-hub",
    { ...input, hospital_id: scope.hospitalId },
    "hospital-admin.wards",
  );
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath("/hospital-admin/departments", "layout");
  const d = (r.data as { data?: unknown } | undefined)?.data;
  return {
    ok: true,
    data: d && typeof d === "object" ? (d as Record<string, unknown>) : undefined,
  };
}
