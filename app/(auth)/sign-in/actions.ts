"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { SIGN_IN } from "@/content/auth";
import { DOCTOR_CADRE_CODES } from "@/lib/doctor/scope";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { safeRedirect, signInErrorMessage } from "./errors";

const SignInSchema = z.object({
  email: z.string().email(SIGN_IN.errors.email),
  password: z.string().min(1, SIGN_IN.errors.required),
  redirect: z.string().optional(),
});

export type SignInState = {
  errors?: Partial<Record<"email" | "password" | "_form", string>>;
};

export async function signInAction(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = SignInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    redirect: formData.get("redirect") ?? undefined,
  });

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      errors: {
        email: fieldErrors.email?.[0],
        password: fieldErrors.password?.[0],
      },
    };
  }

  const supabase = await createClient();
  const { data: signInData, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    logger.warn("sign-in failed", { reason: error.message });
    // Never leak whether email exists: one message for an unknown email and a
    // wrong password. Only a rate limit (429) says something different.
    return { errors: { _form: signInErrorMessage(error) } };
  }

  // Role-aware default landing. Resolution order:
  //   1. superadmin / hospital_admin → /admin
  //   2. hospital applicant with a not-yet-approved application →
  //      /onboarding/hospital-pending (their status page)
  //   3. clinician with a not-yet-approved staff_affiliation →
  //      /onboarding/clinical-pending (their status page)
  //   4. everyone else → /  (landing — Phase 0 has no clinical/patient
  //      workspace yet for approved users; that lands when /clinical
  //      ships).
  // An explicit ?redirect= param always wins over this default.
  //
  // Uses the service client to bypass RLS — the user-context session
  // cookie isn't reliably applied to the same request's downstream
  // queries, so a user-context query would intermittently return
  // empty and silently default away. Matches the pattern
  // /admin/layout.tsx uses for role lookup.
  let defaultTarget = "/";
  let routeReason = "default-landing";
  if (signInData.user) {
    const service = createServiceClient();

    const { data: roles, error: rolesError } = await service
      .from("user_roles")
      .select("role")
      .eq("user_id", signInData.user.id);
    if (rolesError) {
      logger.warn("sign-in.routing.user_roles_query_failed", { reason: rolesError.message });
    }

    if (roles?.some((r) => r.role === "superadmin")) {
      defaultTarget = "/admin";
      routeReason = "superadmin-role";
    } else if (roles?.some((r) => r.role === "hospital_admin")) {
      // Hospital admins get their own scoped workspace — never /admin,
      // which is now superadmin-only chrome. The /hospital-admin layout
      // resolves the tenant scope via requireHospitalAdminScope().
      defaultTarget = "/hospital-admin";
      routeReason = "hospital-admin-role";
    } else if (
      roles?.some((r) => ["clinician", "nurse", "pharmacist", "lab_tech"].includes(r.role))
    ) {
      // Active clinical staff. Doctors (UMDPC cadres) get the
      // cadre-tailored /doctor workspace; everyone else stays on the
      // generic /clinician shell (scheduling availability for now).
      // We detect doctor-cadre membership via a join through
      // staff_affiliations → cadres on the catalog `code`.
      const { data: doctorAff, error: doctorAffError } = await service
        .from("staff_affiliations")
        .select("id, cadres!inner(code)")
        .eq("user_id", signInData.user.id)
        .in("state", ["active", "approved"])
        // The doctor workspace's own cadre set — never a copy of it, or a
        // cadre it serves (the Clinical Officer) is routed to /clinician.
        .in("cadres.code", [...DOCTOR_CADRE_CODES])
        .limit(1);
      if (doctorAffError) {
        logger.warn("sign-in.routing.doctor_cadre_query_failed", {
          reason: doctorAffError.message,
        });
      }
      if (doctorAff && doctorAff.length > 0) {
        defaultTarget = "/doctor";
        routeReason = "doctor-cadre";
      } else {
        defaultTarget = "/clinician";
        routeReason = "clinician-role";
      }
    } else {
      // Check for a pending hospital application — these users have
      // an account but no admin role yet. The pending page shows
      // their application status; once the superadmin approves, they
      // get the hospital_admin role and this branch falls through
      // to the /admin path above.
      const { data: app, error: appError } = await service
        .from("hospital_applications")
        .select("state")
        .eq("applicant_user_id", signInData.user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (appError) {
        logger.warn("sign-in.routing.hospital_applications_query_failed", {
          reason: appError.message,
        });
      }

      if (app && ["pending_approval", "under_review", "rejected"].includes(app.state)) {
        defaultTarget = "/onboarding/hospital-pending";
        routeReason = `hospital-application-${app.state}`;
      } else {
        // Check the most-recent staff_affiliation. Three branches:
        //   1. approved/active + doctor cadre → /doctor
        //   2. approved/active + any other clinical cadre → /clinician
        //   3. pending / under_review / rejected → /onboarding/clinical-pending
        //
        // The affiliation-approval flow doesn't grant a `clinician`
        // role in `user_roles` today, so we can't rely on the earlier
        // role-based branch — the affiliation row itself is the
        // signal that this user belongs in a clinical workspace.
        const { data: aff, error: affError } = await service
          .from("staff_affiliations")
          .select("state, cadres!inner(code)")
          .eq("user_id", signInData.user.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (affError) {
          logger.warn("sign-in.routing.staff_affiliations_query_failed", {
            reason: affError.message,
          });
        }

        if (aff) {
          const cadreCode = (aff as unknown as { cadres?: { code?: string } }).cadres?.code;
          const isDoctorCadre =
            cadreCode != null && (DOCTOR_CADRE_CODES as ReadonlyArray<string>).includes(cadreCode);
          const isNurseCadre =
            cadreCode != null && ["NURSE", "MIDWIFE", "SPECIALIST_NURSE"].includes(cadreCode);
          const isReceptionCadre = cadreCode === "RECEPTION";
          if (["approved", "active"].includes(aff.state)) {
            if (isDoctorCadre) {
              defaultTarget = "/doctor";
              routeReason = `staff-affiliation-${aff.state}-doctor-cadre`;
            } else if (isNurseCadre) {
              defaultTarget = "/nurse";
              routeReason = `staff-affiliation-${aff.state}-nurse-cadre`;
            } else if (isReceptionCadre) {
              defaultTarget = "/reception";
              routeReason = `staff-affiliation-${aff.state}-reception-cadre`;
            } else {
              defaultTarget = "/clinician";
              routeReason = `staff-affiliation-${aff.state}-non-doctor`;
            }
          } else {
            // pending_approval / under_review / rejected — the
            // status page handles each state's framing.
            defaultTarget = "/onboarding/clinical-pending";
            routeReason = `staff-affiliation-${aff.state}`;
          }
        } else {
          // Patient detection: presence of a patient_profiles row.
          // The patient signup flow doesn't grant a 'patient' role
          // in user_roles (yet) — the row itself is the signal.
          const { data: patientProfile, error: patientError } = await service
            .from("patient_profiles")
            .select("id")
            .eq("id", signInData.user.id)
            .maybeSingle();
          if (patientError) {
            logger.warn("sign-in.routing.patient_profiles_query_failed", {
              reason: patientError.message,
            });
          }
          if (patientProfile) {
            defaultTarget = "/patient";
            routeReason = "patient-profile";
          } else {
            routeReason = "no-affiliation-or-patient-profile";
          }
        }
      }
    }
  }

  const target = safeRedirect(parsed.data.redirect) ?? defaultTarget;

  logger.info("sign-in succeeded", { target, routeReason });
  redirect(target);
}
