import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, HeartPulseIcon, PhoneIcon, ShieldAlertIcon } from "lucide-react";

import { EmrChart } from "@/components/emr/chart/emr-chart";
import { PatientClinicalRecordPanel } from "@/components/encounter/patient-clinical-record-panel";
import { fetchPatientSummaryAudited } from "@/lib/doctor/patient-access";
import { requireDoctorScope } from "@/lib/doctor/scope";
import { emrV1LiveFor } from "@/lib/emr/feature";
import { loadChart } from "@/lib/emr/read/chart";
import { toEncounterScope } from "@/lib/encounter/workspace-scope";

export const metadata: Metadata = { title: "Patient · Doctor · MedSync" };
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ patientId: string }>;
}

const BASIS_LABEL: Record<string, string> = {
  care_team: "Care-team member",
  active_encounter: "Active encounter",
  department_recent: "Department patient (last 30 days)",
  break_glass: "Break-glass access",
};

const SEX_LABEL: Record<string, string> = {
  male: "Male",
  female: "Female",
  intersex: "Intersex",
  prefer_not_say: "Prefer not to say",
};

export default async function DoctorPatientSummaryPage({ params }: PageProps) {
  const { patientId } = await params;
  const scope = await requireDoctorScope();

  // EMR v1 (gate-a E.2): the chart. Flag off, everything below renders exactly as before.
  if (emrV1LiveFor(scope.hospitalId)) {
    const chart = await loadChart("doctor", patientId);
    return chart ? (
      <EmrChart chart={chart} surface="doctor" />
    ) : (
      <NoAccessScreen patientId={patientId} />
    );
  }

  const summary = await fetchPatientSummaryAudited({
    doctor: {
      userId: scope.userId,
      hospitalId: scope.hospitalId,
      departmentId: scope.departmentId,
    },
    patientUserId: patientId,
    surface: "patient_summary_panel",
  });

  if (summary === null) {
    // Treat as "no legitimate access" — render a respectful no-access
    // screen rather than 404, since the patient might exist but be
    // outside the doctor's basis.
    return <NoAccessScreen patientId={patientId} />;
  }

  const ageYears = computeAgeYears(summary.dateOfBirth);

  return (
    <div className="stagger-children mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8 lg:py-10">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/doctor/patients"
          className="text-muted-foreground hover:text-foreground group inline-flex w-fit items-center gap-1 text-[12.5px] transition-colors"
        >
          <ArrowLeftIcon
            className="size-3.5 transition-transform duration-200 group-hover:-translate-x-0.5"
            aria-hidden
          />
          Patient panel
        </Link>
        <Link
          href={`/doctor/patients/${summary.patientUserId}/prescribe`}
          className="border-border bg-card hover:bg-muted/30 hover:border-foreground/15 tap inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors"
        >
          Prescribe / order
        </Link>
      </div>

      {/* Header — name + identity strip */}
      <header className="flex flex-col gap-2">
        <span className="text-muted-foreground inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] uppercase">
          <span aria-hidden className="bg-iris-icon ring-iris-edge size-1 rounded-full ring-2" />
          Patient summary
        </span>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="font-display text-display-s text-foreground">
            {summary.firstName} {summary.surname}
          </h1>
          <span className="text-muted-foreground font-mono text-[12px] tabular-nums">
            {summary.patientCode}
          </span>
        </div>
        <p className="text-muted-foreground text-[12.5px]">
          {SEX_LABEL[summary.sex] ?? summary.sex}
          {ageYears !== null ? ` · ${ageYears}y` : ""}
          {summary.dateOfBirth ? ` · DoB ${summary.dateOfBirth}` : ""}
        </p>
      </header>

      {/* Access basis strip — small, but always visible (defensible: the doctor
          should know on what basis they're reading this record). */}
      <div className="border-border bg-card flex items-center gap-3 rounded-lg border px-4 py-2.5">
        <span
          aria-hidden
          className="bg-brand-50 ring-brand-200/60 dark:bg-brand-950/40 dark:ring-brand-800/40 inline-flex size-7 shrink-0 items-center justify-center rounded-full ring-1"
        >
          <ShieldAlertIcon className="text-brand-600 dark:text-brand-400 size-3.5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-muted-foreground font-mono text-[9.5px] tracking-[0.12em] uppercase">
            Access basis · this read was logged
          </span>
          <span className="text-foreground text-[12.5px]">
            {BASIS_LABEL[summary.accessBasis] ?? summary.accessBasis}
          </span>
        </div>
      </div>

      {/* Two-column main */}
      <div className="stagger-children grid gap-4 lg:grid-cols-3">
        {/* Demographics + contact */}
        <section className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4 lg:col-span-1">
          <h2 className="text-muted-foreground font-mono text-[10.5px] tracking-[0.14em] uppercase">
            Contact
          </h2>
          <Field label="Phone" value={summary.phone} icon={PhoneIcon} mono />
          <Field label="Address" value={summary.villageAddress ?? "—"} />
          <Field label="Preferred language" value={summary.preferredLanguage ?? "—"} />
        </section>

        {/* Known conditions */}
        <section className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4 lg:col-span-2">
          <h2 className="text-muted-foreground font-mono text-[10.5px] tracking-[0.14em] uppercase">
            Known conditions
          </h2>
          {summary.knownConditions.length === 0 ? (
            <p className="text-muted-foreground text-[12.5px]">None on file.</p>
          ) : (
            <ul className="stagger-children flex flex-wrap gap-1.5">
              {summary.knownConditions.map((c) => (
                <li
                  key={c}
                  className="border-border bg-muted/40 text-foreground rounded-full border px-2.5 py-1 text-[12px] transition-colors duration-200 hover:border-gray-300"
                >
                  {c}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Placeholders for engines that haven't shipped */}
        <PlaceholderSection
          title="Recent vitals + trends"
          subtitle="Lands when monitoring connects."
          Icon={HeartPulseIcon}
        />
        <PlaceholderSection
          title="Care team"
          subtitle="Lands with the care-team workspace."
          Icon={ShieldAlertIcon}
        />
      </div>

      {/* Longitudinal clinical record (encounter / EMR engine). Gated until the
          schema is applied; renders an honest state until then. */}
      <PatientClinicalRecordPanel
        scope={toEncounterScope(scope)}
        patientUserId={patientId}
        encounterHrefBase="/doctor/encounters"
      />
    </div>
  );
}

/* ── Sub-components ────────────────────────────────────────────── */

function Field({
  label,
  value,
  icon: Icon,
  mono = false,
}: {
  label: string;
  value: string;
  icon?: typeof PhoneIcon;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground inline-flex items-center gap-1 text-[10.5px] tracking-tight uppercase">
        {Icon ? <Icon className="size-3" aria-hidden /> : null}
        {label}
      </span>
      <span
        className={
          mono
            ? "text-foreground text-body-s font-mono tabular-nums"
            : "text-foreground text-body-s"
        }
      >
        {value}
      </span>
    </div>
  );
}

function PlaceholderSection({
  title,
  subtitle,
  Icon,
}: {
  title: string;
  subtitle: string;
  Icon: typeof PhoneIcon;
}) {
  return (
    <section className="border-border bg-card/40 text-muted-foreground flex items-start gap-3 rounded-lg border border-dashed p-4 lg:col-span-1">
      <span
        aria-hidden
        className="bg-muted/60 text-muted-foreground inline-flex size-8 shrink-0 items-center justify-center rounded-full"
      >
        <Icon className="size-4" />
      </span>
      <span className="flex flex-col">
        <span className="text-foreground/80 text-body-s font-medium">{title}</span>
        <span className="text-[11.5px] leading-relaxed">{subtitle}</span>
      </span>
    </section>
  );
}

function NoAccessScreen({ patientId }: { patientId: string }) {
  void patientId;
  return (
    <div className="stagger-children mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">
      <Link
        href="/doctor/patients"
        className="text-muted-foreground hover:text-foreground group inline-flex w-fit items-center gap-1 text-[12.5px] transition-colors"
      >
        <ArrowLeftIcon
          className="size-3.5 transition-transform duration-200 group-hover:-translate-x-0.5"
          aria-hidden
        />
        Patient panel
      </Link>

      <div className="border-border bg-card flex flex-col items-start gap-3 rounded-lg border p-6">
        <span
          aria-hidden
          className="inline-flex size-10 items-center justify-center rounded-full bg-amber-50 text-amber-700 ring-1 ring-amber-200/70 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800/40"
        >
          <ShieldAlertIcon className="size-5" />
        </span>
        <div className="flex flex-col gap-1.5">
          <span className="text-foreground text-body-m font-medium">Above your current access</span>
          <p className="text-muted-foreground max-w-[56ch] text-[12.5px] leading-relaxed">
            You don&rsquo;t have a current clinical relationship with this patient — no active
            encounter, no department visit in the last 30 days, no care-team membership. If you need
            access for legitimate care, your hospital admin can arrange it.
          </p>
        </div>
      </div>
    </div>
  );
}

function computeAgeYears(dobIso: string | null): number | null {
  if (!dobIso) return null;
  const dob = new Date(dobIso);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

// ensure notFound is treated as a referenced import without forcing
// a runtime call we don't currently need
void notFound;
