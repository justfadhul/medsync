import type { Metadata } from "next";

import { IncomingBoard } from "@/app/reception/incoming/_components/incoming-board";
import { fetchIncomingPreArrivals } from "@/lib/emergency/queries";
import { listHospitalDepartments } from "@/lib/intake/queries";
import { requireNurseScope } from "@/lib/nurse/scope";
import { DEFAULT_TIME_ZONE, startOfLocalDay } from "@/supabase/functions/_shared/slots";
import { markArrivedAction, searchPatientsAction, updatePreArrivalAction } from "./actions";

export const metadata: Metadata = {
  title: "Incoming · Nurse · MedSync",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

/**
 * /nurse/incoming — the same Incoming board the desk sees (PRD §8.5: "also
 * visible to triage/ED roles at that facility"), under the nurse scope.
 * Every read pins `facilityId` from that scope.
 */
export default async function NurseIncomingPage() {
  const scope = await requireNurseScope();
  const facilityId = scope.hospitalId;
  const dayStart = startOfLocalDay(new Date(), DEFAULT_TIME_ZONE);
  const [open, closedRecent, departments] = await Promise.all([
    fetchIncomingPreArrivals({ facilityId }),
    fetchIncomingPreArrivals({
      facilityId,
      statuses: ["arrived", "not_arriving", "hoax", "expired"],
      limit: 20,
    }),
    listHospitalDepartments(facilityId),
  ]);
  const closed = closedRecent.filter((r) => r.createdAt >= dayStart);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-9">
      <header className="flex flex-col gap-1.5">
        <span className="text-muted-foreground inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] uppercase">
          <span aria-hidden className="bg-iris-icon ring-iris-edge size-1 rounded-full ring-2" />
          {scope.hospitalName} · Incoming
        </span>
        <h1 className="font-display text-display-s text-foreground">Patients on their way</h1>
        <p className="text-muted-foreground text-body-s max-w-2xl leading-relaxed">
          Pre-alerts sent to this facility. Acknowledge so the reporter sees the hospital is
          expecting them; Ready when the bay is prepared; Arrived puts them in the triage queue.
        </p>
      </header>

      <IncomingBoard
        open={open}
        closed={closed}
        facilityId={facilityId}
        departments={departments}
        actions={{
          update: updatePreArrivalAction,
          arrived: markArrivedAction,
          search: searchPatientsAction,
        }}
        queueHref="/nurse/triage"
      />
    </div>
  );
}
