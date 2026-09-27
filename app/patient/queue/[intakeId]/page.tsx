import type { LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { and, count, eq, gte, inArray, lt } from "drizzle-orm";
import { CheckCircleIcon, ClockIcon, HospitalIcon, MinusIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { db } from "@/db";
import { hospitalDepartments } from "@/db/schema/hospital-departments";
import { hospitals } from "@/db/schema/hospitals";
import { patientIntakes } from "@/db/schema/patient-intakes";
import { presenceAt, presenceOf, ts } from "@/lib/intake/queries";
import { TINT_GLYPH } from "@/lib/patient/doses";
import { requirePatientScope } from "@/lib/patient/scope";
import { cn } from "@/lib/utils";
import { DEFAULT_TIME_ZONE, startOfLocalDay } from "@/supabase/functions/_shared/slots";
import { PatientPageHeader } from "../../_components/page-header";
import { CancelDeclaredIntakeButton } from "./_components/cancel-button";

export const metadata: Metadata = {
  title: "Your place in line · MedSync",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ intakeId: string }>;
}

/**
 * The one screen a patient holds while they wait, and the only place in the
 * product where "ahead of you" is a true sentence (ADR 0084 §6).
 *
 * RLS already gates the read — `patient_intakes_select_scoped` grants SELECT
 * to the patient themselves — and the ownership check below is belt and
 * braces for a URL typed by hand.
 *
 * Status surface: declared → arrived → awaiting_triage → triaged. Terminal:
 * completed / cancelled.
 */
export default async function PatientQueueDetailPage({ params }: PageProps) {
  const { intakeId } = await params;
  const scope = await requirePatientScope();

  // One clock read for the whole render — the day window and the refresh
  // interval below must agree about "now".
  const now = new Date();
  // The hospital's day, not the host's: "N ahead of you" counts today's
  // tickets, and today does not begin at 03:00 EAT.
  const startOfDay = startOfLocalDay(now, DEFAULT_TIME_ZONE);

  const rows = await db
    .select({
      id: patientIntakes.id,
      status: patientIntakes.status,
      hospitalId: patientIntakes.hospitalId,
      hospitalName: hospitals.name,
      departmentId: patientIntakes.receivingDepartmentId,
      departmentName: hospitalDepartments.name,
      presentingComplaint: patientIntakes.presentingComplaint,
      arrivedAt: patientIntakes.arrivedAt,
      checkedInAt: patientIntakes.checkedInAt,
      patientUserId: patientIntakes.patientUserId,
    })
    .from(patientIntakes)
    .innerJoin(hospitals, eq(hospitals.id, patientIntakes.hospitalId))
    .leftJoin(hospitalDepartments, eq(hospitalDepartments.id, patientIntakes.receivingDepartmentId))
    .where(eq(patientIntakes.id, intakeId))
    .limit(1);

  const intake = rows[0];
  if (!intake) notFound();
  if (intake.patientUserId !== scope.userId) redirect("/patient/queue");

  const isPresent = intake.status === "arrived" || intake.status === "awaiting_triage";

  // "N ahead of you" = people from THIS intake's department who are in the
  // building and got here before this patient. Counted only once the patient
  // is physically here, because a `declared` row is not a position among
  // present patients (§7b) — rendering a number against it would sell someone
  // a place in a line they are not standing in. Past triage the count is
  // meaningless and is skipped.
  //
  // PRESENCE, not intent, on both sides of the comparison (§6, §7b): the same
  // `coalesce(checked_in_at, arrived_at)` the triage worklist and reception's
  // boards order by, so the number the patient holds and the order the nurse
  // works cannot disagree. Ordering on `arrived_at` counted a 06:10 declaration
  // made from home as a place in front of a 07:30 desk registration, and
  // counted thirty people who had not left home yet as "ahead of you".
  //
  // Never a wait estimate, and never a bare last place — the screen shows how
  // many are in front, never an ordinal and never a total (§6, ADR 0034 §6).
  let positionAhead: number | null = null;
  if (intake.departmentId && isPresent) {
    const aheadRows = await db
      .select({ n: count() })
      .from(patientIntakes)
      .where(
        and(
          eq(patientIntakes.hospitalId, intake.hospitalId),
          eq(patientIntakes.receivingDepartmentId, intake.departmentId),
          inArray(patientIntakes.status, ["arrived", "awaiting_triage"]),
          gte(presenceAt, ts(startOfDay)),
          // Bounded above by this patient's own presence, which is never
          // later than `now` — so today's upper bound is already implied.
          lt(presenceAt, ts(presenceOf(intake))),
        ),
      );
    positionAhead = Number(aheadRows[0]?.n ?? 0);
  }

  const isTerminal = intake.status === "completed" || intake.status === "cancelled";
  const stage: Stage = STAGES[intake.status as StageKey] ?? STAGES.declared;
  const firstName = scope.fullName?.split(" ")[0];

  // §15. The page used to reload every 30 seconds for the whole visit — about
  // 690 full document loads across Mulago's documented 346-minute median wait,
  // and every one of them a chance for a dropped signal to replace the ticket
  // with a browser error page. It backs off to five minutes once the first
  // five are past, and the patient owns the spend with the control below.
  const sinceChange = now.getTime() - presenceOf(intake).getTime();
  const refreshSeconds = sinceChange < 5 * 60_000 ? 30 : 300;

  return (
    <div className="stagger-children mx-auto flex w-full max-w-xl flex-col gap-6">
      {!isTerminal ? <meta httpEquiv="refresh" content={String(refreshSeconds)} /> : null}

      <PatientPageHeader
        eyebrow={intake.hospitalName}
        title={headlineFor(intake.status, firstName)}
        description={intake.departmentName ?? undefined}
        backHref="/patient"
        backLabel="Back to home"
      />

      <section className="bg-card dark:shadow-card flex flex-col gap-3 rounded-xl p-4 shadow-xs">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className={cn(
              "grid size-10 shrink-0 place-items-center rounded-full",
              TINT_GLYPH.brand,
            )}
          >
            <stage.Icon strokeWidth={1.5} className="size-5" />
          </span>
          <p className="text-foreground text-body-m font-medium">{stage.lead}</p>
        </div>

        <p className="text-muted-foreground text-body-s leading-relaxed">{stage.body}</p>

        {positionAhead === null ? null : positionAhead === 0 ? (
          <p className="text-foreground text-body-m font-medium">No one is ahead of you.</p>
        ) : (
          <>
            <p className="text-foreground text-body-m flex items-baseline gap-2 font-medium">
              <span className="text-heading-l font-mono leading-none tabular-nums">
                {positionAhead}
              </span>
              ahead of you
            </p>
            {/* Maister's "uncertain waits feel longer" is answered with an
                explanation, never with an estimate (§6). */}
            <p className="text-muted-foreground text-body-s">
              Sicker people are seen first, so this number can go up as well as down.
            </p>
          </>
        )}
      </section>

      {intake.presentingComplaint ? (
        <section className="bg-card dark:shadow-card flex flex-col gap-1 rounded-xl p-4 shadow-xs">
          <h2 className="text-muted-foreground text-caption">What you told us</h2>
          <p className="text-foreground text-body-m">{intake.presentingComplaint}</p>
        </section>
      ) : null}

      {/* Self-cancel while `declared` only (ADR 0034 §5) — once reception has
          registered you, the desk owns the row. */}
      {intake.status === "declared" ? <CancelDeclaredIntakeButton intakeId={intake.id} /> : null}

      {!isTerminal ? (
        <div className="flex flex-col items-center gap-2">
          {/* A bare anchor, not `next/link`: this is the control that has to
              work when the bundle never loaded or the signal died mid-wait,
              which is the failure §15 is about. It reloads the page it is on. */}
          <a
            href={`/patient/queue/${intake.id}`}
            className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "w-full sm:w-fit")}
          >
            {positionAhead === null ? "Check for an update" : "Check my position"}
          </a>
          <p className="text-muted-foreground text-caption text-center">
            This page also checks on its own every{" "}
            {refreshSeconds === 30 ? "30 seconds" : "5 minutes"}.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/* ─── copy ────────────────────────────────────────────────────── */

interface Stage {
  Icon: LucideIcon;
  /** One line naming where the patient stands. */
  lead: string;
  /** What happens next — and nothing about when. */
  body: string;
}

const STAGES = {
  declared: {
    Icon: HospitalIcon,
    lead: "Go to the hospital when you can.",
    body: "Reception will register you at the desk when you arrive. You will be seen in turn. We cannot tell you the hour.",
  },
  arrived: {
    Icon: ClockIcon,
    lead: "You will be seen in turn.",
    body: "We cannot tell you the hour. A nurse will see you first for a quick check.",
  },
  awaiting_triage: {
    Icon: ClockIcon,
    lead: "You will be seen in turn.",
    body: "We cannot tell you the hour. A nurse will see you first for a quick check.",
  },
  triaged: {
    Icon: CheckCircleIcon,
    lead: "Follow the directions the team gave you.",
    body: "If you are not sure where to go, ask at the desk.",
  },
  completed: {
    Icon: CheckCircleIcon,
    lead: "You can tell us again on any day you are coming in.",
    body: "We save your place in line. You will be seen in turn.",
  },
  cancelled: {
    Icon: MinusIcon,
    lead: "Nothing is saved for you today.",
    body: "You can tell us again any time you are coming in today.",
  },
} satisfies Record<string, Stage>;

type StageKey = keyof typeof STAGES;

function headlineFor(status: string, firstName: string | undefined): string {
  switch (status) {
    case "declared":
      // §2: the confirmation names the account holder, because the person
      // holding the phone is routinely not the person who will arrive.
      return firstName ? `We saved a place for ${firstName}.` : "We saved your place.";
    case "arrived":
    case "awaiting_triage":
      return "You are in the line.";
    case "triaged":
      return "The nurse has seen you.";
    case "completed":
      return "All done for today.";
    case "cancelled":
      return "We removed your place.";
    default:
      return "Your place in line.";
  }
}
