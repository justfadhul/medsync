import type { ExpectedPick } from "@/components/intake/front-door-form";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { FrontDoorForm } from "@/components/intake/front-door-form";
import { loadBookingSymptoms } from "@/lib/catalog/symptoms";
import { catalogRenderMode } from "@/lib/emergency/feature";
import { fetchCatalogVersionStatus } from "@/lib/emergency/queries";
import { listActiveHospitals, listEntryTypes, listHospitalDepartments } from "@/lib/intake/queries";
import { liveNotice } from "@/lib/onboarding/notice";
import { fetchExpectedArrivals } from "@/lib/reception/queries";
import { requireReceptionScope } from "@/lib/reception/scope";
import {
  CATALOG,
  CATALOG_CHECKSUM,
} from "@/supabase/functions/_shared/symptom-catalog/catalog.v0.1";
import { registerWalkInAction } from "../actions";
import { receptionRegisterIntakeAction, receptionSearchPatientsAction } from "./actions";

export const metadata: Metadata = { title: "Register · Reception · MedSync" };
export const dynamic = "force-dynamic";

export default async function ReceptionIntakePage() {
  const scope = await requireReceptionScope();
  const [entryTypes, departments, hospitals, symptomOptions, catalogStatus, arrivals, notice] =
    await Promise.all([
      listEntryTypes(),
      listHospitalDepartments(scope.hospitalId),
      listActiveHospitals(),
      loadBookingSymptoms(),
      // Gate CS (ADR 0098): a database before migration 0066 has no versions
      // table — "not signed", never a crash at the desk. Fails closed to `off`.
      fetchCatalogVersionStatus(CATALOG.version, CATALOG_CHECKSUM).catch(() => null),
      // Today (the query defaults to the hospital's current day, as /reception/expected does with no ?date).
      // Only confirmed bookings: check-in refuses every other status, so the
      // pick offers nothing it cannot act on — and reveals no other name.
      fetchExpectedArrivals({
        hospitalId: scope.hospitalId,
        receptionUserId: scope.userId,
        limit: 200,
        surface: "reception_intake_pick",
        statuses: ["confirmed"],
      }),
      // The sign-up notice, for a walk-in registered here (ADR 0475). None published: no register button.
      liveNotice(),
    ]);
  const catalogMode = catalogRenderMode(catalogStatus?.signed === true);
  // A provisional booking has no patient to check in until the desk
  // confirms who it is (/reception/expected → Confirm identity).
  const expected: ExpectedPick[] = arrivals.flatMap((r) =>
    r.patientUserId
      ? [
          {
            appointmentId: r.id,
            patientUserId: r.patientUserId,
            patientCode: r.patientCode,
            identity: r.identity,
            startsAtIso: r.startsAtIso,
            clinicianName: r.clinicianName,
          },
        ]
      : [],
  );

  return (
    <div className="stagger-children mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6">
      <Link
        href="/reception"
        className="text-muted-foreground hover:text-foreground text-body-s ease-expo-out group inline-flex w-fit items-center gap-1 transition-colors duration-150"
      >
        <ArrowLeftIcon
          className="ease-expo-out size-3.5 transition-transform duration-150 group-hover:-translate-x-0.5"
          aria-hidden
        />
        Today
      </Link>

      <header className="flex flex-col gap-1">
        <span className="text-muted-foreground text-overline inline-flex items-center gap-1.5 font-mono uppercase">
          <span aria-hidden className="bg-plum-icon ring-plum-edge size-1 rounded-full ring-2" />
          {scope.hospitalName} · Register an entry
        </span>
        <h1 className="font-display text-display-s text-foreground">Front door</h1>
        <p className="text-muted-foreground text-body-s max-w-[60ch] leading-relaxed">
          Walk-in, booked check-in, referral, emergency, transfer, follow-up. Emergency entries skip
          required fields — capture fast, complete later.
        </p>
      </header>

      <FrontDoorForm
        entryTypes={entryTypes}
        departments={departments}
        hospitals={hospitals.filter((h) => h.id !== scope.hospitalId)}
        symptomOptions={symptomOptions}
        submitAction={receptionRegisterIntakeAction}
        searchAction={receptionSearchPatientsAction}
        expected={expected}
        homeHref="/reception"
        todayHref="/reception"
        catalogMode={catalogMode}
        register={notice ? { notice, action: registerWalkInAction } : undefined}
      />
    </div>
  );
}
