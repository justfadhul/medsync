import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangleIcon } from "lucide-react";

import { requireHospitalAdminScope } from "@/lib/hospital-admin/scope";
import { availabilityCount, hubSummary } from "@/lib/services/data";
import { HubTabs } from "./_components/hub-tabs";

/**
 * Departments & services (ADR 0150) — the frame every tab renders in: title, one-line lead, the
 * amber count when anything is out, a strip of REAL counts (Law 5: no occupancy), the tabs.
 */
export default async function ServicesHubLayout({ children }: { children: ReactNode }) {
  const scope = await requireHospitalAdminScope();
  const [summary, problems] = await Promise.all([
    hubSummary(scope.hospitalId),
    availabilityCount(scope.hospitalId),
  ]);
  const n = (v: number, one: string, many = `${one}s`) => (
    <span>
      <span className="text-foreground font-mono tabular-nums">{v}</span> {v === 1 ? one : many}
    </span>
  );
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="font-display text-display-s text-foreground">
            Departments &amp; services
          </h1>
          {problems > 0 ? (
            <Link
              href="/hospital-admin/departments/availability"
              className="bg-status-caution-bg dark:text-status-caution-fg text-body-s inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium text-amber-800 hover:underline"
            >
              <AlertTriangleIcon className="size-3.5" aria-hidden />
              {problems} {problems === 1 ? "thing" : "things"} unavailable · View
            </Link>
          ) : null}
        </div>
        <p className="text-muted-foreground max-w-2xl text-[13.5px] leading-relaxed">
          What your hospital runs, where and when. Staff sign-up, booking, ordering and emergency
          directions all read from here.
        </p>
        <p className="text-muted-foreground text-body-s flex flex-wrap gap-x-3 gap-y-1">
          {n(summary.departments, "department")}
          <span aria-hidden>·</span>
          <span>
            <span className="text-foreground font-mono tabular-nums">{summary.live}</span> live
          </span>
          <span aria-hidden>·</span>
          {n(summary.wards, "ward")}
          <span aria-hidden>·</span>
          {n(summary.beds, "bed")}
          <span aria-hidden>·</span>
          {n(summary.clinics, "clinic")}
          <span aria-hidden>·</span>
          <span>
            <span className="text-foreground font-mono tabular-nums">{summary.testsInHouse}</span>{" "}
            tests in-house
          </span>
        </p>
      </header>
      <HubTabs />
      {children}
    </div>
  );
}
