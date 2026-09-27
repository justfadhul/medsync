import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { resolveCapabilities } from "@/lib/doctor/capabilities";
import { fetchPatientSummaryAudited } from "@/lib/doctor/patient-access";
import { requireDoctorScope } from "@/lib/doctor/scope";
import { ProposeForm } from "./_components/propose-form";

export const metadata: Metadata = { title: "Prescribe · Doctor · MedSync" };
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ patientId: string }>;
}

export default async function DoctorPrescribePage({ params }: PageProps) {
  const { patientId } = await params;
  const scope = await requireDoctorScope();

  const summary = await fetchPatientSummaryAudited({
    doctor: {
      userId: scope.userId,
      hospitalId: scope.hospitalId,
      departmentId: scope.departmentId,
    },
    patientUserId: patientId,
    surface: "prescribe_page",
  });

  const caps = await resolveCapabilities({
    hospitalId: scope.hospitalId,
    departmentId: scope.departmentId,
    cadreCode: scope.cadreCode,
  });

  return (
    <div className="stagger-children mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8 lg:py-10">
      <Link
        href={`/doctor/patients/${patientId}`}
        className="text-muted-foreground hover:text-foreground group inline-flex w-fit items-center gap-1 text-[12.5px] transition-colors"
      >
        <ArrowLeftIcon
          className="size-3.5 transition-transform duration-200 group-hover:-translate-x-0.5"
          aria-hidden
        />
        Patient summary
      </Link>

      <header className="flex flex-col gap-2">
        <span className="text-muted-foreground inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] uppercase">
          <span aria-hidden className="bg-iris-icon ring-iris-edge size-1 rounded-full ring-2" />
          Prescribe
        </span>
        <h1 className="font-display text-display-s text-foreground">
          {summary ? `${summary.firstName} ${summary.surname}` : "Above your access"}
        </h1>
        <p className="text-muted-foreground text-[12.5px]">
          {summary ? (
            <>
              {summary.patientCode} · this is the cadre-enforced safety scaffold; the real
              prescribing engine ships with the clinical module.
            </>
          ) : (
            <>You don&rsquo;t have a clinical relationship with this patient.</>
          )}
        </p>
      </header>

      {summary === null ? (
        <div className="border-border bg-card rounded-lg border p-5">
          <p className="text-muted-foreground text-[12.5px] leading-relaxed">
            Open a patient from your panel before prescribing.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <h2 className="text-muted-foreground font-mono text-[10.5px] tracking-[0.14em] uppercase">
              Routine prescription
            </h2>
            <ProposeForm
              patientUserId={patientId}
              patientCode={summary.patientCode}
              requirement={caps.prescription_routine}
              actionKind="prescription_routine"
            />
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-muted-foreground font-mono text-[10.5px] tracking-[0.14em] uppercase">
              Controlled-substance prescription
            </h2>
            <ProposeForm
              patientUserId={patientId}
              patientCode={summary.patientCode}
              requirement={caps.prescription_controlled}
              actionKind="prescription_controlled"
            />
          </section>
        </div>
      )}
    </div>
  );
}
