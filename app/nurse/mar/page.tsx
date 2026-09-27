import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { fetchNursePatientSummaryAudited } from "@/lib/nurse/patient-access";
import { requireNurseScope } from "@/lib/nurse/scope";
import { AdministerForm } from "./_components/administer-form";

export const metadata: Metadata = { title: "Medications · Nurse · MedSync" };
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ patient?: string }>;
}

export default async function NurseMarPage({ searchParams }: PageProps) {
  const { patient } = await searchParams;
  const scope = await requireNurseScope();

  if (!patient) {
    return (
      <div className="stagger-children mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">
        <header className="flex flex-col gap-2">
          <span className="text-muted-foreground font-mono text-[10px] tracking-[0.16em] uppercase">
            Medication administration
          </span>
          <h1 className="font-display text-display-s text-foreground">Pick a patient first</h1>
          <p className="text-muted-foreground max-w-[56ch] text-[12.5px]">
            Open a patient from your panel, then tap &ldquo;Administer medication&rdquo; — the form
            here will know who you&rsquo;re charting for. Real prescription orders land with the
            prescribing engine; for now you record administration freehand against the patient.
          </p>
        </header>
        <Link
          href="/nurse/patients"
          className="border-border bg-card hover:bg-muted/30 card-lift tap group text-body-s inline-flex w-fit items-center gap-2 rounded-lg border px-4 py-2.5 transition-colors"
        >
          Open patient panel
          <span
            aria-hidden
            className="inline-block transition-transform duration-200 group-hover:translate-x-0.5"
          >
            →
          </span>
        </Link>
      </div>
    );
  }

  const summary = await fetchNursePatientSummaryAudited({
    nurse: {
      userId: scope.userId,
      hospitalId: scope.hospitalId,
      inChargeWardIds: scope.inChargeWardIds,
    },
    patientUserId: patient,
    surface: "mar_screen",
  });

  if (summary === null) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">
        <Link
          href="/nurse/patients"
          className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-[12.5px] transition-colors"
        >
          <ArrowLeftIcon className="size-3.5" aria-hidden />
          Patient panel
        </Link>
        <p className="text-destructive border-destructive/30 bg-destructive/5 rounded-xl border p-4 text-[12.5px]">
          You don&rsquo;t have access to this patient&rsquo;s MAR. Ask the ward in-charge.
        </p>
      </div>
    );
  }

  return (
    <div className="stagger-children mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-8">
      <Link
        href={`/nurse/patients/${summary.patientUserId}`}
        className="text-muted-foreground hover:text-foreground group inline-flex w-fit items-center gap-1 text-[12.5px] transition-colors"
      >
        <ArrowLeftIcon
          className="size-3.5 transition-transform duration-200 group-hover:-translate-x-0.5"
          aria-hidden
        />
        Patient summary
      </Link>
      <header className="flex flex-col gap-2">
        <span className="text-muted-foreground font-mono text-[10px] tracking-[0.16em] uppercase">
          Administer medication · {summary.patientCode}
        </span>
        <h1 className="font-display text-display-s text-foreground">
          {summary.firstName} {summary.surname}
        </h1>
        <p className="text-muted-foreground text-[12px] leading-relaxed">
          Real prescription orders land with the prescribing engine. For now, record what was given
          against this patient — the MAR is fully audited.
        </p>
      </header>
      <AdministerForm patientUserId={summary.patientUserId} isEnrolled={scope.isEnrolled} />
    </div>
  );
}
