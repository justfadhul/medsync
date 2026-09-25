import type { Metadata } from "next";
import Link from "next/link";
import { HospitalIcon, MapPinIcon, SearchIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { DataTableEmpty, Pill } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { HOSPITAL_LEVEL_LABEL, listDirectoryHospitals } from "@/lib/patient/hospitals";
import { requirePatientScope } from "@/lib/patient/scope";
import { cn } from "@/lib/utils";
import { PatientDoors } from "../_components/doors";
import { PatientPageHeader } from "../_components/page-header";
import { SelectHospitalButton } from "./_components/select-hospital-button";

export const metadata: Metadata = { title: "Hospitals · MedSync" };
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function PatientHospitalsPage({ searchParams }: PageProps) {
  const { q } = await searchParams;
  const scope = await requirePatientScope();
  const search = (q ?? "").trim();
  const results = await listDirectoryHospitals({ search });
  const landing = !scope.primaryHospitalId;
  return (
    <div className="stagger-children mx-auto flex w-full max-w-5xl flex-col gap-6">
      {landing ? (
        // The landing for a patient who has just signed in: no home behind
        // it yet, so no Back, and the one question the app has for them.
        <PatientPageHeader
          eyebrow="MedSync · Welcome"
          title={scope.fullName ? `Welcome, ${scope.fullName.split(" ")[0]}.` : "Welcome."}
          description="Pick your hospital to see its clinics and book a visit. You can change it any time."
        />
      ) : (
        <PatientPageHeader
          eyebrow="MedSync · Hospitals"
          title="Hospitals on MedSync"
          description="Switch your primary hospital, or just see who's here."
          backHref="/patient"
          backLabel="Back to home"
        />
      )}

      {/* Native GET form: search survives a reload, a shared link and no JS. */}
      <form role="search" action="/patient/hospitals" className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon
            aria-hidden
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2"
          />
          <Input
            type="search"
            name="q"
            defaultValue={search}
            aria-label="Search hospitals"
            placeholder="Hospital, clinic or district"
            className="h-11 rounded-full pl-10"
          />
        </div>
        {search ? (
          <Link
            href="/patient/hospitals"
            className="text-muted-foreground hover:text-foreground text-body-s duration-fast ease-expo-out inline-flex min-h-11 shrink-0 items-center rounded-md px-3 transition-colors"
          >
            Clear
          </Link>
        ) : null}
      </form>

      <section className="flex flex-col gap-3" aria-labelledby="hospitals-heading">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="hospitals-heading" className="text-heading-s font-medium">
            {search ? "Matches" : "All hospitals"}
          </h2>
          <span className="text-muted-foreground text-body-s tabular-nums">{results.length}</span>
        </div>

        {results.length === 0 ? (
          <div className="bg-card dark:shadow-card rounded-xl p-6 shadow-xs">
            <DataTableEmpty
              title={search ? `No hospitals match “${search}”` : "No hospitals listed yet"}
              description={
                search
                  ? "Try a shorter search — a district or a region works too."
                  : "No hospital in the network is accepting patients right now. Check back soon."
              }
              action={
                search ? (
                  <Link
                    href="/patient/hospitals"
                    className={buttonVariants({ variant: "secondary", size: "lg" })}
                  >
                    Clear search
                  </Link>
                ) : undefined
              }
            />
          </div>
        ) : (
          <ul className="stagger-children grid gap-3 sm:grid-cols-2 @5xl/page:grid-cols-3">
            {results.map((h) => {
              const isPrimary = h.id === scope.primaryHospitalId;
              const place = [h.district, h.region].filter(Boolean).join(", ");
              return (
                <li
                  key={h.id}
                  className={cn(
                    // A card that lifts a hair on hover: the affordance is the
                    // motion; the button underneath is the promise.
                    "bg-card dark:shadow-card ease-expo-out flex flex-col gap-4 rounded-xl p-5 shadow-xs transition-[transform,box-shadow] duration-150 hover:-translate-y-px hover:shadow-md motion-reduce:transform-none",
                    isPrimary && "bg-accent ring-brand-300 ring-1",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden
                      className="bg-plum-100 text-plum-800 grid size-11 shrink-0 place-items-center rounded-xl"
                    >
                      <HospitalIcon strokeWidth={1.5} className="size-5" />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <h3 className="text-foreground text-body-m leading-snug font-medium">
                        {h.name}
                      </h3>
                      <p className="text-muted-foreground text-body-s">
                        {HOSPITAL_LEVEL_LABEL[h.level] ?? h.level}
                      </p>
                    </div>
                    {isPrimary ? (
                      // Keyed on the primary id so the flare replays when the
                      // choice changes — never by remounting the row.
                      <Pill
                        key={scope.primaryHospitalId ?? "none"}
                        tone="stable"
                        className="select-flare shrink-0"
                      >
                        Your hospital
                      </Pill>
                    ) : null}
                  </div>

                  <dl className="text-body-s flex flex-col gap-1">
                    <div className="flex items-center gap-1.5">
                      <dt className="sr-only">Where</dt>
                      <MapPinIcon className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                      <dd className="text-muted-foreground truncate">
                        {place || "Location not listed"}
                        {h.departmentCount > 0
                          ? ` · ${h.departmentCount} ${h.departmentCount === 1 ? "department" : "departments"}`
                          : ""}
                      </dd>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <dt className="sr-only">Bookings</dt>
                      {/* PRD §3.3.1's honesty rule: "accepting" only when a
                          clinic day or a bookable block exists in the next 14
                          days. A word beside the dot, never the dot alone. */}
                      <span
                        aria-hidden
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          h.acceptingBookings ? "bg-status-stable-fg" : "bg-muted-foreground/50",
                        )}
                      />
                      <dd
                        className={
                          h.acceptingBookings ? "text-status-stable-fg" : "text-muted-foreground"
                        }
                      >
                        {h.acceptingBookings ? "Accepting bookings" : "No days open yet"}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-auto">
                    {isPrimary ? (
                      <div className="border-brand-300/60 border-t pt-3">
                        <PatientDoors />
                      </div>
                    ) : (
                      <SelectHospitalButton
                        hospitalId={h.id}
                        label={landing ? "Choose this hospital" : "Make this my hospital"}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
