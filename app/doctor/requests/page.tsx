import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { StaffNotices } from "@/components/medsync/staff-notices";
import { RequestsView } from "@/components/requests/requests-view";
import { CARE_REQUEST_COPY } from "@/content/care-requests";
import { requireDoctorScope } from "@/lib/doctor/scope";
import { requireEmrActor } from "@/lib/emr/actor";
import { requestsPageData } from "@/lib/emr/read/requests";
import { myNotices } from "@/lib/notices/read";
import { careRequestsLiveFor } from "@/lib/requests/feature";

const P = CARE_REQUEST_COPY.page;
export const metadata: Metadata = { title: P.metaTitle("Doctor") };
export const dynamic = "force-dynamic";

/**
 * Reviews and consults (ADR 0537): asked of you, of your department, and by you. `?request=<id>` opens
 * one; `?view=department` scrolls to the department's list. Behind CARE_REQUESTS; off, not found.
 */
export default async function DoctorRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string }>;
}) {
  const scope = await requireDoctorScope();
  if (!careRequestsLiveFor(scope.hospitalId)) notFound();
  const actor = await requireEmrActor("doctor");
  const at = new Date();
  const now = at.getTime();
  const [data, notices] = await Promise.all([
    requestsPageData(actor, (await searchParams).request, { now: at }),
    myNotices(actor.userId, ["care_request", "care_request_update"]),
  ]);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8 lg:py-10">
      <header className="flex flex-col gap-2">
        <span className="text-muted-foreground font-mono text-[10px] tracking-[0.16em] uppercase">
          {P.overline}
        </span>
        <h1 className="font-display text-display-s text-foreground">{P.title}</h1>
        <p className="text-muted-foreground max-w-[60ch] text-[12.5px] leading-relaxed">
          {P.lead} {CARE_REQUEST_COPY.responsible}
        </p>
      </header>
      <StaffNotices notices={notices} />
      <RequestsView surface="doctor" now={now} {...data} />
    </div>
  );
}
