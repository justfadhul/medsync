"use client";

import type { DeskNotice } from "@/components/intake/register-patient-dialog";
import { useRouter } from "next/navigation";

import { RegisterPatientDialog } from "@/components/intake/register-patient-dialog";
import { registerWalkInAction } from "../../actions";

/** The person is at the counter: register them (ADR 0475), then book for the record like any patient. */
export function RegisterAndBook({ notice }: { notice: DeskNotice }) {
  const router = useRouter();
  return (
    <RegisterPatientDialog
      notice={notice}
      action={registerWalkInAction}
      onDone={(p) => router.push(`/reception/book?patient=${p.patientUserId}`)}
    />
  );
}
