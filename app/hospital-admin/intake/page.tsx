import type { Metadata } from "next";
import { AlertTriangleIcon, UserPlusIcon } from "lucide-react";

import { FrontDoorForm } from "@/components/intake/front-door-form";
import { loadBookingSymptoms } from "@/lib/catalog/symptoms";
import { catalogRenderMode } from "@/lib/emergency/feature";
import { fetchCatalogVersionStatus } from "@/lib/emergency/queries";
import { requireHospitalAdminScope } from "@/lib/hospital-admin/scope";
import {
  fetchHospitalIncomingIntakes,
  fetchTodayIntakeCount,
  listActiveHospitals,
  listEntryTypes,
  listHospitalDepartments,
} from "@/lib/intake/queries";
import { fetchTriageMetricsToday } from "@/lib/triage/worklist";
import {
  CATALOG,
  CATALOG_CHECKSUM,
} from "@/supabase/functions/_shared/symptom-catalog/catalog.v0.1";
import { TriageAcuitySnippet } from "./_components/triage-acuity-snippet";
import { registerIntakeAction, searchPatientsAction } from "./actions";

export const metadata: Metadata = { title: "Intake · Hospital admin · MedSync" };
export const dynamic = "force-dynamic";

export default async function HospitalAdminIntakePage() {
  const scope = await requireHospitalAdminScope();
  const [
    entryTypes,
    departments,
    hospitals,
    symptomOptions,
    catalogStatus,
    today,
    awaiting,
    triageMetrics,
  ] = await Promise.all([
    listEntryTypes(),
    listHospitalDepartments(scope.hospitalId),
    listActiveHospitals(),
    loadBookingSymptoms(),
    // Gate CS (ADR 0098): a database before migration 0066 has no versions
    // table — "not signed", never a crash at the desk. Fails closed to `off`.
    fetchCatalogVersionStatus(CATALOG.version, CATALOG_CHECKSUM).catch(() => null),
    fetchTodayIntakeCount({ hospitalId: scope.hospitalId }),
    fetchHospitalIncomingIntakes({ hospitalId: scope.hospitalId, limit: 30 }),
    fetchTriageMetricsToday({ hospitalId: scope.hospitalId }),
  ]);
  const catalogMode = catalogRenderMode(catalogStatus?.signed === true);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-8 lg:py-10">
      <header className="flex flex-col gap-2">
        <span className="text-muted-foreground inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] uppercase">
          <span aria-hidden className="bg-slate-icon ring-slate-edge size-1 rounded-full ring-2" />
          {scope.hospitalName} · Intake
        </span>
        <h1 className="font-display text-display-s text-foreground">Front door</h1>
        <p className="text-muted-foreground max-w-[60ch] text-[12.5px] leading-relaxed">
          Register a patient arriving at the hospital — walk-in, booked appointment, referral,
          emergency, transfer, or follow-up. Emergency entries skip required fields: capture fast,
          complete later.
        </p>
      </header>

      {/* Today's count rail */}
      <ul className="grid grid-cols-2 gap-2">
        <li className="border-border bg-card flex flex-col gap-1 rounded-lg border p-3">
          <span className="text-muted-foreground inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] uppercase">
            <UserPlusIcon className="size-3" aria-hidden />
            Awaiting triage
          </span>
          <span className="text-foreground text-heading-l leading-none tabular-nums">
            {today.awaitingTriage}
          </span>
        </li>
        <li
          className={
            today.emergencyAwaiting > 0
              ? "flex flex-col gap-1 rounded-xl border border-rose-500/40 bg-rose-50/40 p-3 dark:bg-rose-950/15"
              : "border-border bg-card flex flex-col gap-1 rounded-lg border p-3"
          }
        >
          <span
            className={
              today.emergencyAwaiting > 0
                ? "inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] text-rose-700 uppercase dark:text-rose-300"
                : "text-muted-foreground inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] uppercase"
            }
          >
            <AlertTriangleIcon className="size-3" aria-hidden />
            Emergency awaiting
          </span>
          <span
            className={
              today.emergencyAwaiting > 0
                ? "text-heading-l leading-none text-rose-700 tabular-nums dark:text-rose-300"
                : "text-foreground text-heading-l leading-none tabular-nums"
            }
          >
            {today.emergencyAwaiting}
          </span>
        </li>
      </ul>

      {/* Triage acuity snippet (GATE E) — aggregate, scoped, no PHI. */}
      <TriageAcuitySnippet metrics={triageMetrics} />

      {/* The workstation is two panels of its own, so it takes the full width; the
          awaiting list sits beneath it. Admin is code-only (ADR 0032): no `expected`. */}
      <FrontDoorForm
        entryTypes={entryTypes}
        departments={departments}
        hospitals={hospitals.filter((h) => h.id !== scope.hospitalId)}
        symptomOptions={symptomOptions}
        submitAction={registerIntakeAction}
        searchAction={searchPatientsAction}
        homeHref="/hospital-admin"
        todayHref="#awaiting"
        catalogMode={catalogMode}
      />

      {/* Awaiting-triage list */}
      <aside
        id="awaiting"
        className="border-border bg-card flex flex-col gap-2 rounded-lg border p-4"
      >
        <h2 className="text-muted-foreground font-mono text-[10.5px] tracking-[0.14em] uppercase">
          Awaiting triage · {awaiting.length}
        </h2>
        {awaiting.length === 0 ? (
          <p className="text-muted-foreground text-[12.5px]">No one waiting right now.</p>
        ) : (
          <ul className="divide-border/60 -mx-2 divide-y">
            {awaiting.map((i) => (
              <li
                key={i.id}
                className={
                  i.isEmergency
                    ? "flex flex-col gap-1 rounded-md bg-rose-50/60 px-2 py-2 ring-1 ring-rose-500/30 ring-inset dark:bg-rose-950/20"
                    : "flex flex-col gap-1 px-2 py-2"
                }
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-foreground inline-flex items-center gap-1 text-[12.5px] font-medium">
                    {i.patientCode ?? i.patientUnknownLabel ?? "Patient"}
                    {i.isEmergency ? (
                      <AlertTriangleIcon className="size-3 text-rose-600" aria-hidden />
                    ) : null}
                  </span>
                  <span className="text-muted-foreground font-mono text-[10px] tabular-nums">
                    {formatRelative(i.arrivedAtIso)}
                  </span>
                </div>
                <span className="text-muted-foreground text-[11.5px]">
                  {i.entryTypeName}
                  {i.receivingDepartmentName ? ` · ${i.receivingDepartmentName}` : ""}
                </span>
                {i.presentingComplaint ? (
                  <span className="text-muted-foreground/90 line-clamp-1 text-[11.5px] italic">
                    {i.presentingComplaint}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}

function formatRelative(iso: string): string {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.round(diffMin / 60);
  return `${diffH}h`;
}
