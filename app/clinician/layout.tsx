import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SignOutButton } from "@/components/medsync/sign-out-button";
import { ArrestAlarm } from "@/components/resus/arrest-alarm";
import { requireClinicianScope } from "@/lib/clinician/scope";
import { isDoctorUser } from "@/lib/doctor/scope";
import { isLabTechUser } from "@/lib/lab-tech/scope";
import { isPharmacyUser } from "@/lib/pharmacy/scope";
import { resusDeskV2 } from "@/lib/resus/feature";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Minimal clinician workspace shell.
 *
 * GATE B of scheduling lands the first clinician-facing surface
 * (availability editor). When more clinician features ship, this
 * grows into a full Attio shell — sidebar, ⌘K, etc. — modelled on
 * the hospital-admin shell. For now: top bar + main slot is enough,
 * keeps the chrome out of the way while we ship the first feature.
 *
 * Auth: `requireClinicianScope()` enforces auth + AAL2 + an active
 * clinician affiliation. No scope = bounce to `/onboarding/clinical-
 * pending` (where the rejected / pending / approved-no-MFA flows
 * already live).
 */
export default async function ClinicianLayout({ children }: { children: ReactNode }) {
  const scope = await requireClinicianScope();
  // A doctor-cadre user belongs in /doctor — a stale bookmark or a link
  // into /clinician/availability must not strand them in the fallback
  // workspace. isDoctorUser runs requireDoctorScope's own query, so the
  // two gates cannot bounce a user back and forth.
  if (await isDoctorUser(scope.userId)) redirect("/doctor/schedule");
  // Likewise a laboratory technician or technologist belongs in /lab.
  if (await isLabTechUser(scope.userId)) redirect("/lab");
  // And pharmacy staff, where the pharmacy workspace is on for their hospital (LD-P4).
  if (await isPharmacyUser(scope.userId)) redirect("/pharmacy");

  return (
    <div className="bg-background text-foreground flex min-h-svh w-full flex-col">
      <header className="border-border glass sticky top-0 z-30 flex h-[52px] items-center justify-between gap-3 border-b px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="font-display text-foreground text-body-m font-semibold">
            MedSync
          </Link>
          <span
            className="text-muted-foreground text-overline hidden truncate font-mono uppercase sm:inline"
            title={`${scope.hospitalName} · ${scope.departmentName}`}
          >
            Clinician · {scope.hospitalName}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span
            className={cn("text-muted-foreground text-body-s truncate", "hidden sm:inline")}
            title={scope.userEmail}
          >
            {scope.fullName ?? scope.userEmail}
          </span>
          <Link
            href="/accounts"
            className="text-muted-foreground hover:text-foreground text-body-s underline-offset-4 transition-colors hover:underline"
          >
            Switch account
          </Link>
          <SignOutButton className="text-muted-foreground hover:text-foreground text-body-s underline-offset-4 transition-colors hover:underline" />
        </div>
      </header>

      <main className="min-w-0 flex-1">{children}</main>
      {/* No resus route in this workspace: the banner names the place, without "Open resus". */}
      {resusDeskV2() ? <ArrestAlarm hospitalId={scope.hospitalId} resusBase={null} /> : null}
    </div>
  );
}
