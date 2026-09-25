"use server";

import { revalidatePath } from "next/cache";

import { STAFF_PENDING } from "@/content/onboarding-staff";
import { storeAvatar } from "@/lib/avatars";
import { logger } from "@/lib/logger";
import { PROFILE_GRADES } from "@/lib/onboarding/profession";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

/*
 * The staff pending page's "Your details" card (gate-a §2.9): fields deferred from the signup form.
 * Each action acts on the signed-in caller only; nothing here takes a user id from the client.
 */

export type DetailsState = { ok?: boolean; error?: string };

async function callerId(): Promise<string | null> {
  const { data } = await (await createClient()).auth.getUser();
  return data.user?.id ?? null;
}

/** Photo (ADR 0085 §1): downscaled and stored by lib/avatars. Field name: `photo`. */
export async function updateMyPhotoAction(
  _prev: DetailsState,
  formData: FormData,
): Promise<DetailsState> {
  const uid = await callerId();
  if (!uid) return { error: STAFF_PENDING.signInAgain };
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return { error: STAFF_PENDING.photoNone };
  if (!(await storeAvatar(uid, file))) return { error: STAFF_PENDING.photoFailed };
  revalidatePath("/onboarding/clinical-pending");
  return { ok: true };
}

/**
 * The optional qualification for cadres whose grade doesn't change scope (PROFILE_GRADES: clinical
 * officer, lab technician). Saves cadre_grade_id on the caller's own latest affiliation; "" clears it.
 */
export async function saveMyGradeAction(
  _prev: DetailsState,
  formData: FormData,
): Promise<DetailsState> {
  const uid = await callerId();
  if (!uid) return { error: STAFF_PENDING.signInAgain };
  const code = formData.get("grade");
  if (typeof code !== "string") return { error: STAFF_PENDING.gradeFailed };

  const service = createServiceClient();
  const { data: aff } = await service
    .from("staff_affiliations")
    .select("id, cadre_id")
    .eq("user_id", uid)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!aff) return { error: STAFF_PENDING.gradeFailed };
  const { data: cadre } = await service
    .from("cadres")
    .select("code")
    .eq("id", aff.cadre_id)
    .maybeSingle();
  const allowed = PROFILE_GRADES[String(cadre?.code ?? "")];
  if (!allowed || (code !== "" && !allowed.some((g) => g.code === code)))
    return { error: STAFF_PENDING.gradeFailed };

  let gradeId: string | null = null;
  if (code) {
    const { data: grade } = await service
      .from("cadre_grades")
      .select("id")
      .eq("cadre_id", aff.cadre_id)
      .eq("code", code)
      .maybeSingle();
    if (!grade) return { error: STAFF_PENDING.gradeFailed };
    gradeId = grade.id as string;
  }
  const { error } = await service
    .from("staff_affiliations")
    .update({ cadre_grade_id: gradeId })
    .eq("id", aff.id)
    .eq("user_id", uid);
  if (error) {
    logger.error("staff-pending.grade_failed", { reason: error.message });
    return { error: STAFF_PENDING.gradeFailed };
  }
  revalidatePath("/onboarding/clinical-pending");
  return { ok: true };
}
