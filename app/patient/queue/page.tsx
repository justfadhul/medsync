import type { DepartmentOption } from "./_components/declare-intake-form";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { and, asc, eq, gte, inArray, isNull, lt } from "drizzle-orm";

import { db } from "@/db";
import { hospitalDepartments } from "@/db/schema/hospital-departments";
import { hospitals } from "@/db/schema/hospitals";
import { patientIntakes } from "@/db/schema/patient-intakes";
import { appointments, departmentSchedulingPolicy } from "@/db/schema/scheduling";
import { INTAKE_TITLE } from "@/lib/patient/appointments";
import { requirePatientScope } from "@/lib/patient/scope";
import {
  DEFAULT_TIME_ZONE,
  endOfLocalDay,
  localWeekdayAndMinutes,
  startOfLocalDay,
} from "@/supabase/functions/_shared/slots";
import { PatientPageHeader } from "../_components/page-header";
import { TintedRow } from "../_components/tinted-row";
import { DeclareIntakeForm } from "./_components/declare-intake-form";
import { HospitalChips } from "./_components/hospital-chips";

export const metadata: Metadata = {
  title: "Coming to the hospital today · MedSync",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

/**
 * /patient/queue — the same-day door (ADR 0084 §1), now the primary one.
 *
 * The head of the page carries §2's ratified words: it names the act the
 * patient is performing ("Coming to the hospital today") and the only two
 * things we can honestly say about what follows — a place, in turn, no hour.
 *
 * Walk-ins are open by DEFAULT (§14, ratifying the revision ADR 0034 §2 had
 * only a code comment behind). A departmentSchedulingPolicy, when present,
 * NARROWS the walk-in window to its hours; its absence is "no restriction",
 * not "closed". Same helper and same rule as the gate in pt-declare-intake,
 * so what this page offers and what the Edge Function accepts cannot drift.
 *
 * No count appears anywhere on this screen (§5, §6). `aheadByDept` used to
 * price each department by its queue length, which made a differential
 * ("Cardiology or General Medicine?") into a wait-shopping decision. The one
 * place a count is honest is the ticket page, where it is computed against
 * this patient's own row.
 *
 * If the patient already has a live intake or a booking today at this
 * hospital, we surface that first instead of letting them bounce off a 409.
 */
export default async function PatientQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ submission?: string }>;
}) {
  const scope = await requirePatientScope();
  // ADR 0098: the catalog's "Join today's queue" hands its report id along; a
  // malformed one is dropped here rather than bounced by the Edge Function.
  const { submission } = await searchParams;
  const submissionId =
    typeof submission === "string" && /^[0-9a-f-]{36}$/i.test(submission) ? submission : null;
  if (!scope.primaryHospitalId) {
    redirect("/patient/hospitals");
  }
  const hospitalId = scope.primaryHospitalId;
  // Every active hospital, this one first: the chips above the clinics.
  const activeHospitals = await db
    .select({ id: hospitals.id, name: hospitals.name })
    .from(hospitals)
    .where(eq(hospitals.state, "active"))
    .orderBy(asc(hospitals.name));
  const hospitalChips = [
    ...activeHospitals.filter((h) => h.id === hospitalId),
    ...activeHospitals.filter((h) => h.id !== hospitalId),
  ];

  // The hospital's day, never the server's — a ticket declared at 01:00 EAT
  // is today's, not "yesterday's" as UTC midnight would have it.
  const now = new Date();
  const startOfDay = startOfLocalDay(now, DEFAULT_TIME_ZONE);
  const endOfDay = endOfLocalDay(now, DEFAULT_TIME_ZONE);
  // The hospital's clock, never the server's. `getDay()`/`getHours()` here
  // read whatever zone the host runs in — UTC on Vercel — which is the wrong
  // WEEKDAY for the first three hours of every East African day and a
  // walk-in window displaced by three hours for all of them. ISO 1-7, so a
  // policy that ticks Sunday (stored as 7 under migration 0052) matches.
  // Same helper as the server-side gate in pt-declare-intake, so the page
  // and the 409 can never disagree.
  const { isoWeekday: nowWeekday, minutesOfDay: nowMinutes } = localWeekdayAndMinutes(
    now,
    DEFAULT_TIME_ZONE,
  );

  const [departments, existingIntake, existingAppointment] = await Promise.all([
    db
      .select({
        id: hospitalDepartments.id,
        name: hospitalDepartments.name,
        bookableWeekdays: departmentSchedulingPolicy.bookableWeekdays,
        bookableStart: departmentSchedulingPolicy.bookableStartMinutesLocal,
        bookableEnd: departmentSchedulingPolicy.bookableEndMinutesLocal,
      })
      .from(hospitalDepartments)
      .leftJoin(
        departmentSchedulingPolicy,
        eq(departmentSchedulingPolicy.departmentId, hospitalDepartments.id),
      )
      .where(
        and(eq(hospitalDepartments.hospitalId, hospitalId), isNull(hospitalDepartments.parentId)),
      )
      .orderBy(asc(hospitalDepartments.name)),
    db
      .select({
        id: patientIntakes.id,
        status: patientIntakes.status,
        departmentId: patientIntakes.receivingDepartmentId,
      })
      .from(patientIntakes)
      .where(
        and(
          eq(patientIntakes.patientUserId, scope.userId),
          eq(patientIntakes.hospitalId, hospitalId),
          inArray(patientIntakes.status, ["declared", "arrived", "awaiting_triage", "triaged"]),
          gte(patientIntakes.arrivedAt, startOfDay),
          lt(patientIntakes.arrivedAt, endOfDay),
        ),
      )
      .limit(1),
    db
      .select({
        id: appointments.id,
        startsAt: appointments.startsAt,
        departmentId: appointments.departmentId,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.patientUserId, scope.userId),
          eq(appointments.hospitalId, hospitalId),
          inArray(appointments.status, [
            "confirmed",
            "pending_approval",
            "requested",
            "arrived",
            "in_progress",
          ]),
          gte(appointments.startsAt, startOfDay),
          lt(appointments.startsAt, endOfDay),
        ),
      )
      .orderBy(asc(appointments.startsAt))
      .limit(1),
  ]);

  // Both off the scope, which read this hospital's row once for the request:
  // the name it already carried, and the emergency number §3's block needs.
  const hospitalName = scope.primaryHospitalName ?? "your hospital";
  const liveIntake = existingIntake[0] ?? null;
  const liveAppt = existingAppointment[0] ?? null;

  const items: DepartmentOption[] = departments.map((d) => {
    // Open for walk-ins by DEFAULT (§14). A scheduling policy, when present,
    // narrows the window to its hours; its absence means "no restriction",
    // not "closed". Mirrors the pt-declare-intake gate.
    const hasPolicy = d.bookableWeekdays !== null;
    const inWeekday = hasPolicy && (d.bookableWeekdays ?? []).includes(nowWeekday);
    const inWindow =
      hasPolicy &&
      d.bookableStart !== null &&
      d.bookableEnd !== null &&
      nowMinutes >= d.bookableStart &&
      nowMinutes < d.bookableEnd;
    const openNow = !hasPolicy || (inWeekday && inWindow);
    return {
      id: d.id,
      name: d.name,
      openNow,
      reason: openNow ? null : !inWeekday ? "closed today" : "outside walk-in hours",
    };
  });

  return (
    <div className="stagger-children mx-auto flex w-full max-w-3xl flex-col gap-5">
      {/* The hospital's name is the eyebrow because §2's screen opens with it:
          the patient has to know which building the rest of the page is about
          before it tells them to walk into one. */}
      <PatientPageHeader
        eyebrow={hospitalName}
        title="Coming to the hospital today"
        description="We save your place in line. You will be seen in turn. We cannot tell you the hour."
        backHref="/patient"
        backLabel="Back to home"
      />

      <HospitalChips hospitals={hospitalChips} currentId={hospitalId} />

      {liveIntake || liveAppt ? (
        <ul className="stagger-children flex flex-col gap-2">
          {liveIntake ? (
            <TintedRow
              tint="brand"
              iconKey="hospital"
              title={INTAKE_TITLE[liveIntake.status] ?? "You are already in today's line."}
              subtitle="Open this for the latest."
              href={`/patient/queue/${liveIntake.id}`}
            />
          ) : liveAppt ? (
            <TintedRow
              tint="mint"
              iconKey="calendar"
              // No clock numeral: the Luganda clock is dawn-anchored, so "9:00"
              // on a patient surface is read six hours out (ADR 0084 §10). The
              // row's destination is the visits list, which is where a time
              // belongs if one is shown at all.
              title="You already have a visit at the hospital today."
              subtitle="Go to the front desk when you arrive."
              href="/patient/appointments"
            />
          ) : null}
        </ul>
      ) : null}

      {liveIntake ? null : (
        <DeclareIntakeForm
          departments={items}
          hospitalName={hospitalName}
          submissionId={submissionId}
        />
      )}
    </div>
  );
}
