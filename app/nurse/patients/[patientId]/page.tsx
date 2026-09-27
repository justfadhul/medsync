import type { EmrDb } from "@/lib/emr/db";
import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { ArrowLeftIcon, HeartPulseIcon, PhoneIcon, PillIcon, ShieldAlertIcon } from "lucide-react";

import { EmrChart } from "@/components/emr/chart/emr-chart";
import { PatientClinicalRecordPanel } from "@/components/encounter/patient-clinical-record-panel";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { clinicalObservations, medicationAdministrationRecords } from "@/db/schema/nurse-workspace";
import { emrV1Live, emrV1LiveFor } from "@/lib/emr/feature";
import { loadChart } from "@/lib/emr/read/chart";
import { loadCfcVitals } from "@/lib/emr/read/vitals";
import { toEncounterScope } from "@/lib/encounter/workspace-scope";
import { fetchNursePatientSummaryAudited } from "@/lib/nurse/patient-access";
import { requireNurseScope } from "@/lib/nurse/scope";
import { NurseOrders } from "./_orders/nurse-orders";

export const metadata: Metadata = { title: "Patient · Nurse · MedSync" };
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ patientId: string }>;
}

const BASIS_LABEL: Record<string, string> = {
  assigned: "Assigned to you",
  ward_census: "Ward census (today)",
  in_charge: "Ward in-charge",
  care_team: "Care team",
};

const SEX_LABEL: Record<string, string> = {
  male: "Male",
  female: "Female",
  intersex: "Intersex",
  prefer_not_say: "Prefer not to say",
};

const OBS_LABEL: Record<string, string> = {
  bp: "Blood pressure",
  hr: "Heart rate",
  temperature: "Temperature",
  rr: "Respiratory rate",
  spo2: "SpO₂",
  glucose: "Glucose",
  pain: "Pain",
  weight: "Weight",
  height: "Height",
  intake: "Intake",
  output: "Output",
  gcs: "GCS",
  other: "Observation",
};

export default async function NursePatientSummaryPage({ params }: PageProps) {
  const { patientId } = await params;
  const scope = await requireNurseScope();

  // EMR v1 (gate-a E.2): the chart. Flag off, everything below renders exactly as before.
  if (emrV1LiveFor(scope.hospitalId)) {
    const chart = await loadChart("nurse", patientId);
    if (!chart) return <NoAccessScreen />;
    // The open visit's orders: collect the specimen, print the label (no ordering here).
    const orders = chart.openEncounterId ? (
      <NurseOrders encounterId={chart.openEncounterId} />
    ) : null;
    return <EmrChart chart={chart} surface="nurse" orders={orders} />;
  }

  const summary = await fetchNursePatientSummaryAudited({
    nurse: {
      userId: scope.userId,
      hospitalId: scope.hospitalId,
      inChargeWardIds: scope.inChargeWardIds,
    },
    patientUserId: patientId,
    surface: "patient_summary_panel",
  });

  if (summary === null) {
    return <NoAccessScreen />;
  }

  // Pull recent obs + MAR in parallel (read-side; both tables have
  // broad-clinical SELECT policies so we can read with the user-context
  // db without extra audit — the AUDITED PHI read happened above).
  const [legacyObs, cfcObs, recentMar] = await Promise.all([
    db
      .select({
        id: clinicalObservations.id,
        kind: clinicalObservations.observationKind,
        recordedAt: clinicalObservations.recordedAt,
        numericValue1: clinicalObservations.numericValue1,
        numericValue2: clinicalObservations.numericValue2,
        unit: clinicalObservations.unit,
        notes: clinicalObservations.notes,
      })
      .from(clinicalObservations)
      .where(
        and(
          eq(clinicalObservations.patientUserId, summary.patientUserId),
          eq(clinicalObservations.state, "active"),
        ),
      )
      .orderBy(desc(clinicalObservations.recordedAt))
      .limit(10),
    // EMR v1: CFC vital-sign rows join the list (STOP 2), so one series shows everywhere.
    emrV1Live()
      ? loadCfcVitals(db as unknown as EmrDb, summary.patientUserId, { limit: 10 })
      : Promise.resolve([]),
    db
      .select({
        id: medicationAdministrationRecords.id,
        drugName: medicationAdministrationRecords.drugName,
        dose: medicationAdministrationRecords.dose,
        route: medicationAdministrationRecords.route,
        state: medicationAdministrationRecords.state,
        isHighAlert: medicationAdministrationRecords.isHighAlert,
        administeredAt: medicationAdministrationRecords.administeredAt,
      })
      .from(medicationAdministrationRecords)
      .where(eq(medicationAdministrationRecords.patientUserId, summary.patientUserId))
      .orderBy(desc(medicationAdministrationRecords.administeredAt))
      .limit(10),
  ]);

  const recentObs = [
    ...legacyObs,
    ...cfcObs.map((v) => ({
      id: v.id,
      kind: v.kind,
      recordedAt: v.recordedAt,
      numericValue1: v.value1 === null ? null : String(v.value1),
      numericValue2: v.value2 === null ? null : String(v.value2),
      unit: v.unit,
      notes: null,
    })),
  ]
    .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())
    .slice(0, 10);

  const ageYears = computeAgeYears(summary.dateOfBirth);

  return (
    <div className="stagger-children mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8 lg:py-10">
      <Link
        href="/nurse/patients"
        className="text-muted-foreground hover:text-foreground group inline-flex w-fit items-center gap-1 text-[12.5px] transition-colors"
      >
        <ArrowLeftIcon
          className="size-3.5 transition-transform duration-200 group-hover:-translate-x-0.5"
          aria-hidden
        />
        Patient panel
      </Link>

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

      <div className="border-border bg-card ring-brand-500/5 flex items-center gap-3 rounded-lg border px-4 py-2.5 ring-1">
        <ShieldAlertIcon
          className="text-brand-600 dark:text-brand-400 size-4 shrink-0"
          aria-hidden
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-muted-foreground font-mono text-[9.5px] tracking-[0.12em] uppercase">
            Access basis · this read was logged
          </span>
          <span className="text-foreground text-[12.5px]">
            {BASIS_LABEL[summary.accessBasis] ?? summary.accessBasis}
          </span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4 lg:col-span-1">
          <h2 className="text-muted-foreground font-mono text-[10.5px] tracking-[0.14em] uppercase">
            Contact
          </h2>
          <Field label="Phone" value={summary.phone} icon={PhoneIcon} mono />
          <Field label="Address" value={summary.villageAddress ?? "—"} />
          <Field label="Preferred language" value={summary.preferredLanguage ?? "—"} />
        </section>

        <section className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4 lg:col-span-2">
          <h2 className="text-muted-foreground font-mono text-[10.5px] tracking-[0.14em] uppercase">
            Known conditions
          </h2>
          {summary.knownConditions.length === 0 ? (
            <p className="text-muted-foreground text-[12.5px]">None on file.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {summary.knownConditions.map((c) => (
                <li
                  key={c}
                  className="border-border bg-muted/40 text-foreground hover:border-foreground/20 rounded-full border px-2.5 py-1 text-[12px] transition-colors"
                >
                  {c}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Recent observations */}
        <section className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4 lg:col-span-2">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-muted-foreground font-mono text-[10.5px] tracking-[0.14em] uppercase">
              Recent vitals
            </h2>
            <Link
              href={`/nurse/observations?patient=${summary.patientUserId}`}
              className="text-muted-foreground hover:text-foreground text-[11.5px] transition-colors"
            >
              Record →
            </Link>
          </div>
          {recentObs.length === 0 ? (
            <p className="text-muted-foreground text-[12.5px]">
              No observations recorded yet.{" "}
              <Link
                href={`/nurse/observations?patient=${summary.patientUserId}`}
                className="text-foreground underline-offset-2 hover:underline"
              >
                Record one
              </Link>
              .
            </p>
          ) : (
            <ul className="divide-border/60 -mx-2 divide-y">
              {recentObs.map((o) => (
                <li
                  key={o.id}
                  className="hover:bg-muted/40 flex items-baseline justify-between gap-2 rounded-sm px-2 py-1.5 transition-colors"
                >
                  <span className="text-foreground text-[12.5px]">
                    <span className="text-muted-foreground inline-block w-[110px] font-mono text-[10.5px] tracking-[0.06em] uppercase">
                      {OBS_LABEL[o.kind] ?? o.kind}
                    </span>{" "}
                    <span className="font-mono tabular-nums">{formatObsValue(o)}</span>
                  </span>
                  <span className="text-muted-foreground font-mono text-[10.5px] tabular-nums">
                    {formatRelative(o.recordedAt.toISOString())}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Recent MAR */}
        <section className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4 lg:col-span-1">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-muted-foreground font-mono text-[10.5px] tracking-[0.14em] uppercase">
              Recent meds
            </h2>
            <Link
              href={`/nurse/mar?patient=${summary.patientUserId}`}
              className="text-muted-foreground hover:text-foreground text-[11.5px] transition-colors"
            >
              MAR →
            </Link>
          </div>
          {recentMar.length === 0 ? (
            <p className="text-muted-foreground text-[12.5px]">No doses logged yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {recentMar.map((m) => (
                <li key={m.id} className="flex flex-col gap-0.5">
                  <span className="text-foreground inline-flex items-center gap-1.5 text-[12.5px] font-medium">
                    {m.drugName} {m.dose}
                    {m.isHighAlert ? (
                      <span className="rounded-full bg-rose-100 px-1.5 py-0 font-mono text-[9px] font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                        HIGH-ALERT
                      </span>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground font-mono text-[10.5px] tabular-nums">
                    {m.state} · {m.route} · {formatRelative(m.administeredAt.toISOString())}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Longitudinal clinical record (encounter / EMR engine). Gated until the
          schema is applied; renders an honest state until then. */}
      <PatientClinicalRecordPanel scope={toEncounterScope(scope)} patientUserId={patientId} />

      {/* Bottom action — quick-record */}
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/nurse/observations?patient=${summary.patientUserId}`}>
          <Button type="button" className="tap">
            <HeartPulseIcon className="size-3.5" aria-hidden />
            Record vitals
          </Button>
        </Link>
        <Link href={`/nurse/mar?patient=${summary.patientUserId}`}>
          <Button type="button" variant="secondary" className="tap">
            <PillIcon className="size-3.5" aria-hidden />
            Administer medication
          </Button>
        </Link>
      </div>
    </div>
  );
}

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

function NoAccessScreen() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">
      <Link
        href="/nurse/patients"
        className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-[12.5px] transition-colors"
      >
        <ArrowLeftIcon className="size-3.5" aria-hidden />
        Patient panel
      </Link>

      <div className="border-border bg-card reveal-up flex flex-col items-start gap-3 rounded-lg border p-6">
        <span
          aria-hidden
          className="scale-in inline-flex size-10 items-center justify-center rounded-full bg-amber-50 text-amber-700 ring-1 ring-amber-200/70 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800/40"
        >
          <ShieldAlertIcon className="size-5" />
        </span>
        <div className="flex flex-col gap-1.5">
          <span className="text-foreground text-body-m font-medium">Above your current access</span>
          <p className="text-muted-foreground max-w-[56ch] text-[12.5px] leading-relaxed">
            You don&rsquo;t have a current clinical relationship with this patient — no assignment,
            no ward-census activity today, no in-charge basis. If you need access for legitimate
            care, your ward in-charge can pair you.
          </p>
        </div>
      </div>
    </div>
  );
}

function formatObsValue(o: {
  kind: string;
  numericValue1: string | null;
  numericValue2: string | null;
  unit: string | null;
}): string {
  if (o.kind === "bp" && o.numericValue1 && o.numericValue2) {
    return `${trimZero(o.numericValue1)}/${trimZero(o.numericValue2)} ${o.unit ?? "mmHg"}`;
  }
  if (!o.numericValue1) return "—";
  return `${trimZero(o.numericValue1)}${o.unit ? ` ${o.unit}` : ""}`;
}

function trimZero(v: string): string {
  if (!v.includes(".")) return v;
  return v.replace(/\.?0+$/, "");
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

function formatRelative(iso: string): string {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
