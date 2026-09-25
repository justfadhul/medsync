"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { patientProfiles } from "@/db/schema/patient-profiles";
import { encrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { requirePatientScope } from "@/lib/patient/scope";

/*
 * "Complete your profile" (Onboarding v2, Appendix A): the fields signup no longer asks for.
 * An ID can be ADDED while none is on file; once added it is identity and changes go through
 * support, as before (the WHERE clause makes that race-safe).
 */

export type CompleteState = { ok?: boolean; error?: string };

const IdSchema = z.object({
  id_type: z.enum(["nin", "passport", "refugee_id", "other"], "Choose the type of ID."),
  id_number: z
    .string()
    .trim()
    .min(4, "Enter the number as it's printed.")
    .max(40, "That number is too long."),
});

export async function addPatientIdAction(
  _prev: CompleteState,
  formData: FormData,
): Promise<CompleteState> {
  const scope = await requirePatientScope();
  const parsed = IdSchema.safeParse({
    id_type: formData.get("id_type"),
    id_number: formData.get("id_number"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const number =
    parsed.data.id_type === "nin"
      ? parsed.data.id_number.replace(/\s+/g, "").toUpperCase()
      : parsed.data.id_number;
  const updated = await db
    .update(patientProfiles)
    .set({ idType: parsed.data.id_type, idNumberEncrypted: encrypt(number) })
    .where(and(eq(patientProfiles.id, scope.userId), eq(patientProfiles.idType, "none")))
    .returning({ id: patientProfiles.id });
  if (updated.length === 0)
    return { error: "An ID is already on file. To change it, contact support." };
  logger.info("patient.profile.id_added", { id_type: parsed.data.id_type });
  revalidatePath("/patient/profile");
  return { ok: true };
}

const TitleSchema = z.object({
  title_code: z.enum(["mr", "ms", "mrs", "dr", "other"]).or(z.literal("")),
});

export async function setPatientTitleAction(
  _prev: CompleteState,
  formData: FormData,
): Promise<CompleteState> {
  const scope = await requirePatientScope();
  const parsed = TitleSchema.safeParse({ title_code: formData.get("title_code") ?? "" });
  if (!parsed.success) return { error: "Choose a title from the list." };
  await db
    .update(patientProfiles)
    .set({ titleCode: parsed.data.title_code || null })
    .where(eq(patientProfiles.id, scope.userId));
  revalidatePath("/patient/profile");
  return { ok: true };
}
