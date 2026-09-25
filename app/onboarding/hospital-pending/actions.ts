"use server";

import { revalidatePath } from "next/cache";
import { desc } from "drizzle-orm";

import { HOSPITAL_PENDING } from "@/content/onboarding-hospital";
import { db } from "@/db";
import { hospitalDpaVersions } from "@/db/schema/hospital-dpa-versions";
import { logger } from "@/lib/logger";
import { fieldErrors } from "@/lib/onboarding/schemas";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { agreementSchema } from "./_lib/schema";

export type AgreementState = {
  ok?: boolean;
  fieldErrors?: Record<string, string>;
  formError?: string;
};

const E = HOSPITAL_PENDING.errors;

/**
 * The agreement gate (§5.10, D7): after `verified`, the applicant signs the latest DPA on the
 * pending page. The second super-admin Approve then provisions from these columns, as today.
 */
export async function signAgreementAction(
  _prev: AgreementState,
  form: FormData,
): Promise<AgreementState> {
  const parsed = agreementSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser(); // verified with Auth: this writes
  const uid = auth.user?.id;
  if (!uid) return { formError: E.signIn };

  const service = createServiceClient();
  const { data: app } = await service
    .from("hospital_applications")
    .select("id, applicant_user_id, state, agreement_accepted_version")
    .eq("applicant_user_id", uid)
    .maybeSingle();
  if (
    !app ||
    app.applicant_user_id !== uid ||
    app.state !== "verified" ||
    app.agreement_accepted_version
  )
    return { formError: E.notNow };

  const [dpa] = await db
    .select({ id: hospitalDpaVersions.id, sha: hospitalDpaVersions.bodySha256 })
    .from(hospitalDpaVersions)
    .orderBy(desc(hospitalDpaVersions.effectiveDate))
    .limit(1);
  if (!dpa || dpa.id !== v.dpaId || dpa.sha.toLowerCase() !== v.dpaSha.toLowerCase())
    return { formError: E.changed };

  const { data: updated, error } = await service
    .from("hospital_applications")
    .update({
      signatory_name: v.signatoryName,
      signatory_title: v.signatoryTitle,
      authorised_to_bind: true,
      agreement_accepted_version: dpa.id,
      agreement_accepted_at: new Date().toISOString(),
    })
    .eq("id", app.id)
    .eq("state", "verified")
    .is("agreement_accepted_version", null) // a double submit signs once
    .select("id");
  if (error || !updated?.length) {
    logger.error("hospital-agreement.sign_failed", { reason: error?.message ?? "no row" });
    return { formError: E.failed };
  }
  logger.info("hospital-agreement.signed", {});
  revalidatePath("/onboarding/hospital-pending");
  return { ok: true };
}
