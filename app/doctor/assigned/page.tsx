import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireDoctorScope } from "@/lib/doctor/scope";
import { listAssignedEncountersForDoctor } from "@/lib/encounter/assignment";
import { encounterEngineLive } from "@/lib/encounter/feature";
import { doctorWorkspace } from "@/lib/workspace/feature";
import { DoctorEmptyState } from "../_components/empty-state";
import { AssignedRow } from "./_components/assigned-row";

export const metadata: Metadata = { title: "Assigned · Doctor · MedSync" };
export const dynamic = "force-dynamic";

export default async function DoctorAssignedPage() {
  const scope = await requireDoctorScope();
  // Doctor workspace on: this list is the board's Waiting for you lane (307).
  if (doctorWorkspace(scope.hospitalId)) redirect("/doctor?lane=waiting");

  return (
    <div className="stagger-children mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8 lg:py-10">
      <header className="flex flex-col gap-1.5">
        <span className="text-muted-foreground inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] uppercase">
          <span
            aria-hidden
            className="pulse-dot bg-brand-500 ring-brand-500/20 size-1 rounded-full ring-2"
          />
          Assigned to you
        </span>
        <h1 className="font-display text-foreground text-[26px] leading-[1.1] font-medium tracking-[-0.015em]">
          Patients waiting to be seen
        </h1>
        <p className="text-muted-foreground text-[12.5px]">
          Triaged patients assigned to you. Start the encounter to open the clerking, or hand it to
          a colleague.
        </p>
      </header>

      {!encounterEngineLive() ? (
        <Note
          title="Clinical module not active"
          body="Assignments appear here once the encounter module is enabled."
        />
      ) : (
        <AssignedList doctorUserId={scope.userId} hospitalId={scope.hospitalId} />
      )}
    </div>
  );
}

async function AssignedList({
  doctorUserId,
  hospitalId,
}: {
  doctorUserId: string;
  hospitalId: string;
}) {
  const rows = await listAssignedEncountersForDoctor({ doctorUserId, hospitalId });
  if (rows.length === 0) {
    return <Note title="Nothing waiting" body="No patients are currently assigned to you." />;
  }
  return (
    <ul className="stagger-children flex flex-col gap-2">
      {rows.map((r) => (
        <AssignedRow key={r.encounterId} row={r} />
      ))}
    </ul>
  );
}

function Note({ title, body }: { title: string; body: string }) {
  return <DoctorEmptyState title={title} body={body} />;
}
