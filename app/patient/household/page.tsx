import type { Metadata } from "next";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { formatWhen, STATUS_LABEL, STATUS_TONES } from "@/lib/patient/appointments";
import { fetchHousehold, fetchHouseholdVisits } from "@/lib/patient/household";
import { requirePatientScope } from "@/lib/patient/scope";
import { cn } from "@/lib/utils";
import { PatientPageHeader } from "../_components/page-header";
import { AddMemberForm } from "./_components/add-member-form";

export const metadata: Metadata = { title: "People I book for · MedSync" };
export const dynamic = "force-dynamic";

const RELATIONSHIP_LABEL: Record<string, string> = {
  parent: "Parent",
  guardian: "Someone you look after",
  child: "Adult child",
  spouse: "Spouse",
  relative: "Relative",
  vht: "Village (VHT)",
  other: "Other",
};

/**
 * The household list (PRD §2.9): who this patient may book for, and the
 * visits they have booked for them — logistics only. Nothing clinical is
 * shown or asked here, and the member's own record is not reachable from
 * this page in any way.
 */
export default async function PatientHouseholdPage() {
  const scope = await requirePatientScope();
  const members = await fetchHousehold(scope.userId);
  const visits = await fetchHouseholdVisits(scope.userId, members);

  return (
    <div className="stagger-children flex flex-col gap-6">
      <PatientPageHeader
        eyebrow="MedSync · Household"
        title="People I book for"
        description="Adults you book visits for. You see the date, the place and the code — never their care."
        backHref="/patient/menu"
        backLabel="Back to More"
      />

      <section aria-labelledby="members-heading" className="flex flex-col gap-3">
        <h2 id="members-heading" className="text-heading-s">
          On your list
        </h2>
        {members.length === 0 ? (
          <p className="text-muted-foreground bg-card text-body-s dark:shadow-card rounded-xl p-4 shadow-xs">
            Nobody yet. Add someone below, and they appear as a choice when you book.
          </p>
        ) : (
          <ul className="stagger-children flex flex-col gap-2">
            {members.map((m) => (
              <li
                key={m.bookingAgentId}
                className="bg-card dark:shadow-card flex min-h-16 items-center gap-3 rounded-xl px-4 py-3 shadow-xs"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-foreground text-body-m truncate font-medium">
                    {m.memberLabel}
                  </p>
                  <p className="text-muted-foreground text-body-s">
                    {RELATIONSHIP_LABEL[m.relationship] ?? m.relationship} · Adult
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {members.length > 0 && scope.primaryHospitalId ? (
          <Link
            href="/patient/book"
            className={cn(buttonVariants({ size: "lg" }), "w-full sm:w-fit")}
          >
            Book a visit for someone
          </Link>
        ) : null}
      </section>

      <section aria-labelledby="add-heading" className="flex flex-col gap-3">
        <h2 id="add-heading" className="text-heading-s">
          Add someone
        </h2>
        <AddMemberForm />
      </section>

      {members.length > 0 ? (
        <section aria-labelledby="their-visits" className="flex flex-col gap-3">
          <h2 id="their-visits" className="text-heading-s">
            Visits you booked for them
          </h2>
          {visits.length === 0 ? (
            <p className="text-muted-foreground bg-card text-body-s dark:shadow-card rounded-xl p-4 shadow-xs">
              None yet.
            </p>
          ) : (
            <ul className="stagger-children flex flex-col gap-2">
              {visits.map((v) => (
                <li
                  key={v.id}
                  className="bg-card dark:shadow-card flex flex-col gap-1 rounded-xl p-4 shadow-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-overline text-muted-foreground">For {v.memberLabel}</span>
                    <Pill tone={STATUS_TONES[v.status] ?? "neutral"}>
                      {STATUS_LABEL[v.status] ?? v.status}
                    </Pill>
                  </div>
                  <p className="text-foreground text-body-m font-medium">
                    {formatWhen(v.startsAtIso)}
                  </p>
                  <p className="text-muted-foreground text-body-s">
                    {v.serviceName ?? v.departmentName} · {v.hospitalName}
                  </p>
                  {v.bookingCode ? (
                    <p className="text-foreground text-body-s font-mono tracking-[0.12em]">
                      {v.bookingCode}
                      {v.positionNumber !== null ? (
                        <span className="text-muted-foreground ml-3 tracking-normal">
                          Position {v.positionNumber}
                        </span>
                      ) : null}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
