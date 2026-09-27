import type { ScheduleAppointmentRow } from "./_components/schedule-list";
import type { PillTone } from "@/components/ui/data-table";
import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { AlertTriangleIcon, CalendarClockIcon, CircleIcon, ListChecksIcon } from "lucide-react";

import { SectionRule } from "@/components/medsync/panel";
import { StatCard } from "@/components/medsync/stat-card";
import { buttonVariants } from "@/components/ui/button";
import { db } from "@/db";
import { patientProfiles } from "@/db/schema/patient-profiles";
import { appointments } from "@/db/schema/scheduling";
import { users } from "@/db/schema/users";
import { requireClinicianScope } from "@/lib/clinician/scope";
import { revealPatientIdentities, toPatientIdentity } from "@/lib/scheduling/patient-identity";
import { DEFAULT_TIME_ZONE, startOfLocalDay } from "@/supabase/functions/_shared/slots";
import { ScheduleList } from "./_components/schedule-list";

export const metadata: Metadata = { title: "Schedule · MedSync" };
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ aff?: string }>;
}

// Workflow states are tags, never a patient's clinical colours (ADR 0162).
const STATUS_TONES: Record<string, PillTone> = {
  pending_approval: "notice",
  confirmed: "active",
  arrived: "info",
  in_progress: "info",
};

const STATUS_LABEL: Record<string, string> = {
  pending_approval: "Awaiting your approval",
  confirmed: "Confirmed",
  arrived: "Arrived",
  in_progress: "In progress",
};

const VISIBLE_STATUSES = ["pending_approval", "confirmed", "arrived", "in_progress"] as const;

export default async function ClinicianSchedulePage({ searchParams }: PageProps) {
  const scope = await requireClinicianScope();
  const params = await searchParams;

  // The hospital's today, not UTC's — a 01:00 EAT booking is today's.
  const today = startOfLocalDay(new Date(), DEFAULT_TIME_ZONE);
  const fortnight = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      id: appointments.id,
      status: appointments.status,
      priority: appointments.priority,
      type: appointments.type,
      reason: appointments.reason,
      reasonNote: appointments.reasonNote,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
      symptoms: appointments.symptoms,
      patientUserId: appointments.patientUserId,
      patientCode: patientProfiles.patientCode,
      firstNameEncrypted: patientProfiles.firstNameEncrypted,
      surnameEncrypted: patientProfiles.surnameEncrypted,
      sex: patientProfiles.sex,
      dateOfBirth: patientProfiles.dateOfBirth,
      avatarPath: users.avatarPath,
    })
    .from(appointments)
    .innerJoin(users, eq(users.id, appointments.patientUserId))
    .leftJoin(patientProfiles, eq(patientProfiles.id, appointments.patientUserId))
    .where(
      and(
        eq(appointments.clinicianUserId, scope.userId),
        eq(appointments.hospitalId, scope.hospitalId),
        inArray(appointments.status, [...VISIBLE_STATUSES]),
        gte(appointments.startsAt, today),
        lt(appointments.startsAt, fortnight),
      ),
    )
    .orderBy(asc(appointments.startsAt));

  // The audited reveal (ADR 0095) — the booking is the care relationship.
  // `users.full_name` is not read: it is unaudited and, for a patient, not
  // the profile's name.
  const revealed = await revealPatientIdentities({
    viewer: { userId: scope.userId, hospitalId: scope.hospitalId },
    surface: "clinician_schedule",
    patients: rows,
  });

  const list: ScheduleAppointmentRow[] = rows.map((r) => {
    const who = toPatientIdentity(r, revealed);
    return {
      id: r.id,
      status: r.status,
      priority: r.priority,
      type: r.type,
      reason: r.reason,
      reasonNote: r.reasonNote,
      startsAtIso: r.startsAt.toISOString(),
      endsAtIso: r.endsAt.toISOString(),
      patientName: who.displayName ?? who.patientCode ?? "Patient",
      patientCode: r.patientCode ?? null,
      photoUrl: who.photoUrl,
      ageYears: who.ageYears,
      sex: who.sex,
      complaint: who.complaint,
    };
  });

  const pendingCount = list.filter((r) => r.status === "pending_approval").length;
  const urgentCount = list.filter((r) => r.priority === "urgent").length;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-5 sm:px-6">
      <header className="flex flex-col gap-1">
        <span className="text-muted-foreground inline-flex w-fit items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] uppercase">
          <span aria-hidden className="bg-iris-icon ring-iris-edge size-1 rounded-full ring-2" />
          {scope.hospitalName} · {scope.departmentName}
        </span>
        <SectionRule
          title="Your schedule"
          action={
            <Link
              href="/clinician/availability"
              className={buttonVariants({ variant: "secondary" })}
            >
              <CalendarClockIcon className="size-3.5" aria-hidden />
              Availability
            </Link>
          }
        />
      </header>

      <section className="grid grid-cols-3 gap-3" aria-label="Schedule stats">
        <StatCard
          domain="operations"
          label="Booked"
          value={list.length}
          hint="next 14 days"
          icon={<ListChecksIcon className="size-4" aria-hidden />}
        />
        <StatCard
          domain="operations"
          label="Awaiting approval"
          value={pendingCount}
          hint="need your answer"
          icon={<CircleIcon className="size-4" aria-hidden />}
        />
        <StatCard
          domain="operations"
          label="Urgent"
          value={urgentCount}
          hint="alert-triggered"
          icon={<AlertTriangleIcon className="size-4" aria-hidden />}
        />
      </section>

      <ScheduleList
        rows={list}
        selectedAppointmentId={params.aff ?? null}
        statusTones={STATUS_TONES}
        statusLabel={STATUS_LABEL}
      />
    </div>
  );
}

// Re-export the Pill component type so the child doesn't import twice.
export type { PillTone };
