import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { fetchIncomingPreArrivals } from "@/lib/emergency/queries";
import { listHospitalDepartments } from "@/lib/intake/queries";
import { requireReceptionScope } from "@/lib/reception/scope";
import { DEFAULT_TIME_ZONE, startOfLocalDay } from "@/supabase/functions/_shared/slots";
import { IncomingBoard } from "./_components/incoming-board";
import { markArrivedAction, searchPatientsAction, updatePreArrivalAction } from "./actions";

export const metadata: Metadata = { title: "Incoming · Reception · MedSync" };
export const dynamic = "force-dynamic";

/**
 * /reception/incoming — pre-alerts on their way to this facility (PRD
 * MS-PRD-SYM-001 §8.5). Every read pins `facilityId` from the scope: Drizzle
 * bypasses RLS. The nurse's /nurse/incoming is the same board under its scope.
 */
export default async function ReceptionIncomingPage() {
  const scope = await requireReceptionScope();
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
    <div className="stagger-children mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8 lg:py-10">
      <Link
        href="/reception"
        className="text-muted-foreground hover:text-foreground text-body-s ease-expo-out group inline-flex w-fit items-center gap-1 transition-colors duration-150"
      >
        <ArrowLeftIcon
          className="ease-expo-out size-3.5 transition-transform duration-150 group-hover:-translate-x-0.5"
          aria-hidden
        />
        Front desk
      </Link>

      <header className="flex flex-col gap-2">
        <span className="text-muted-foreground text-overline inline-flex items-center gap-1.5 font-mono uppercase">
          <span aria-hidden className="bg-plum-icon ring-plum-edge size-1 rounded-full ring-2" />
          {scope.hospitalName} · Incoming
        </span>
        <h1 className="font-display text-display-s text-foreground">Patients on their way</h1>
        <p className="text-muted-foreground text-body-s max-w-[60ch] leading-relaxed">
          Acknowledge each pre-alert so the reporter sees the hospital is expecting them, mark Ready
          when the bay is prepared, and Arrived when they reach the door.
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
        queueHref="/reception"
      />
    </div>
  );
}
