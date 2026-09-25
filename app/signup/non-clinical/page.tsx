import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { consentVersions } from "@/db/schema/consent-versions";
import { onboardingV2 } from "@/lib/onboarding/feature";
import { listHospitals } from "@/lib/reference-data";
import { SignupUnavailable } from "../_components/unavailable";
import { NonClinicalSignupForm } from "./_lazy";
import { NonClinicalSignupV2 } from "./_v2/view";
import {
  loadDepartmentsForHospitalAction,
  loadNonClinicalCadresAction,
  loadRolesForCadreAction,
  submitNonClinicalSignupAction,
} from "./actions";

export const metadata: Metadata = {
  title: "Non-clinical staff signup · MedSync",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function NonClinicalSignupPage() {
  if (await onboardingV2()) return <NonClinicalSignupV2 />;
  const [hospitals, [activeConsent]] = await Promise.all([
    listHospitals(),
    db
      .select()
      .from(consentVersions)
      .where(eq(consentVersions.consentType, "data_processing"))
      .orderBy(desc(consentVersions.effectiveDate))
      .limit(1),
  ]);

  if (!activeConsent) {
    return (
      <SignupUnavailable title="Signup unavailable">
        The current consent text isn&apos;t ready yet. Please check back shortly.
      </SignupUnavailable>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-5 py-12">
      <header className="stagger-children mb-8 flex flex-col gap-2">
        <p className="text-muted-foreground inline-flex items-center gap-2 font-mono text-[10.5px] tracking-[0.14em] uppercase">
          <span aria-hidden className="bg-brand-500 size-1 rounded-full" />
          Non-clinical staff
        </p>
        <h1 className="text-foreground font-display text-3xl leading-tight tracking-[-0.02em]">
          Sign up to work the front desk
        </h1>
        <p className="text-muted-foreground text-[13.5px] leading-relaxed">
          For reception, records and other non-clinical hospital staff. If you&rsquo;re a clinician,
          nurse, pharmacist or lab tech, use the{" "}
          <Link
            className="text-foreground hover:text-brand-700 dark:hover:text-brand-300 underline underline-offset-2 transition-colors duration-150"
            href="/signup/clinical"
          >
            clinical signup
          </Link>{" "}
          instead.
        </p>
      </header>

      <NonClinicalSignupForm
        hospitals={hospitals.map((h) => ({ id: h.id, name: h.name }))}
        consent={{
          version: activeConsent.version,
          bodySha256: activeConsent.bodySha256,
        }}
        loadCadres={loadNonClinicalCadresAction}
        loadRoles={loadRolesForCadreAction}
        loadDepartments={loadDepartmentsForHospitalAction}
        submit={submitNonClinicalSignupAction}
      />
    </div>
  );
}
