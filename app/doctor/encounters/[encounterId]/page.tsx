import type { PatientSummary } from "@/lib/doctor/patient-access";
import type { CaptureMap } from "@/lib/ncd/engine/evaluate";
import type { Metadata } from "next";
import lazy from "next/dynamic";
import Link from "next/link";
import { Suspense } from "react";
import { eq } from "drizzle-orm";
import { AlertTriangleIcon, ArrowLeftIcon } from "lucide-react";

import { db } from "@/db";
import { encounters } from "@/db/schema/scheduling";
import { fetchPatientSummaryAudited } from "@/lib/doctor/patient-access";
import { requireDoctorScope } from "@/lib/doctor/scope";
import { emrV1LiveFor } from "@/lib/emr/feature";
import { encounterEngineLive, ncdClerkshipLive } from "@/lib/encounter/feature";
import { loadEncounterRecord } from "@/lib/encounter/record";
import { toEncounterScope } from "@/lib/encounter/workspace-scope";
import { DIABETES_CATALOG, DISTRICT_SITE, REFERRAL_SITE } from "@/lib/ncd/catalog/diabetes";
import { loadNcdDraft } from "@/lib/ncd/draft";
import { initialCapture, loadLatestVitals, loadPatientDemographics } from "@/lib/ncd/vitals";
import { doctorWorkspace } from "@/lib/workspace/feature";
import { EncounterRail, NextPatient } from "../../_components/workspace/encounter-extras";
import { NcdClerkship } from "./_components/ncd-clerkship";
import { VisitStatus } from "./_components/visit-status";
import { saveNcdDraftAction } from "./actions";

// The clerking desk loads only under EMR v1: next/dynamic keeps it (and its client island) out of
// this route's static graph, so a flag-off visit downloads nothing new (lazy-loading guide,
// "Importing Server Components"; tests/emr/ui/flag-off.test.ts walks the graph).
const EmrDesk = lazy(() => import("./_desk/desk-page").then((m) => m.DeskPage));

export const metadata: Metadata = { title: "Encounter · Doctor · MedSync" };
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ encounterId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function DoctorEncounterPage({ params, searchParams }: PageProps) {
  const { encounterId } = await params;
  const scope = await requireDoctorScope();

  // EMR v1 (flag per hospital): the clerking desk. Off, everything below renders as before.
  if (emrV1LiveFor(scope.hospitalId)) {
    const { template } = await searchParams;
    return (
      <EmrDesk
        encounterId={encounterId}
        scope={scope}
        template={typeof template === "string" ? template : undefined}
      />
    );
  }

  if (!encounterEngineLive()) {
    return (
      <Wrap>
        <Note
          title="Clinical module not active"
          body="The encounter / EMR schema is applied at sign-off. The documentation surface activates then."
        />
      </Wrap>
    );
  }

  /**
   * Bound to this encounter, so the action the client can call cannot be aimed
   * at another one. It still re-checks the caller's scope on the server — a
   * server action is a public endpoint and the closure is convenience, not
   * security.
   */
  async function saveDraft(values: CaptureMap) {
    "use server";
    return saveNcdDraftAction(encounterId, values);
  }

  const [enc] = await db
    .select({
      patientUserId: encounters.patientUserId,
      hospitalId: encounters.hospitalId,
      encounterType: encounters.encounterType,
      state: encounters.state,
      startedAt: encounters.startedAt,
      endedAt: encounters.endedAt,
    })
    .from(encounters)
    .where(eq(encounters.id, encounterId))
    .limit(1);

  if (!enc || enc.hospitalId !== scope.hospitalId) {
    return (
      <Wrap>
        <Note
          title="Encounter unavailable"
          body="It doesn't exist, or it's outside your hospital."
        />
      </Wrap>
    );
  }

  const record = await loadEncounterRecord(encounterId, enc.patientUserId, toEncounterScope(scope));
  if (!record.ok) {
    return (
      <Wrap>
        <Note title="No access" body={record.error} />
      </Wrap>
    );
  }

  // Patient info — pulled, not typed (read-only header). Audited PHI read.
  const patient = await fetchPatientSummaryAudited({
    doctor: {
      userId: scope.userId,
      hospitalId: scope.hospitalId,
      departmentId: scope.departmentId,
    },
    patientUserId: enc.patientUserId,
    surface: "encounter_clerking_header",
  });

  const doc = record.documentation;

  // Undefined when the flag is off, the migration is un-applied, or there is
  // simply no draft — all three are the same honest empty state to the form.
  const vitals = ncdClerkshipLive()
    ? await loadLatestVitals(enc.patientUserId, DIABETES_CATALOG)
    : undefined;
  /**
   * Demographics the chart already holds. The waist bands are sex-specific and
   * WHO's anaemia cutoffs are too, so the alternative to reading it here is
   * asking a clinician for something the record knows — which is how a form
   * earns the reputation of wasting time.
   *
   * Read from the profile column DIRECTLY, not from `patient` above. That
   * summary decrypts the name, the phone and the address, and returns null if
   * any of them fails — so an unreadable name took the sex down with it, and
   * the examination asked for a demographic sitting in plaintext one table
   * away. Nothing a reference scale needs should ride on a decrypt.
   *
   * The date of birth now comes across too, as a LIFE STAGE rather than a
   * number (ADR 0083). It is read in the same query and from the same kind of
   * plaintext column, and it scopes age-specific findings and reference bands.
   * The band is deliberately allowed to be absent: an unknown stage leaves
   * everything in scope, where a guessed one would quietly narrow the
   * examination.
   */
  const demographics = ncdClerkshipLive()
    ? await loadPatientDemographics(enc.patientUserId)
    : { values: {} as CaptureMap };
  const draft = ncdClerkshipLive()
    ? await loadNcdDraft(encounterId, scope.userId, DIABETES_CATALOG)
    : undefined;
  // Doctor workspace on: back goes to the board, the rail and "next patient" join the page.
  const workspace = doctorWorkspace(scope.hospitalId);

  return (
    <div className="bg-background text-foreground relative isolate flex min-h-svh flex-col">
      {/* Ambient clinical atmosphere — a whisper of teal at the top, 95% monochrome below */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 bg-[radial-gradient(ellipse_80%_100%_at_50%_0%,rgba(159,47,126,0.05),transparent_70%)]"
      />
      <WorkspaceTopBar
        scope={scope}
        patientName={patient ? `${patient.firstName} ${patient.surname}` : null}
        visit={<VisitStatus encounterId={encounterId} state={enc.state} endedAt={enc.endedAt} />}
        back={workspace ? { href: "/doctor", label: "Workspace" } : undefined}
      />
      {workspace && enc.state === "completed" ? (
        <Suspense fallback={null}>
          <NextPatient scope={scope} />
        </Suspense>
      ) : null}
      <div className="flex flex-1">
        {workspace ? (
          <Suspense fallback={null}>
            <EncounterRail scope={scope} currentEncounterId={encounterId} />
          </Suspense>
        ) : null}
        <div className="stagger-children mx-auto flex w-full max-w-[1500px] min-w-0 flex-1 flex-col gap-5 px-4 py-5 lg:px-8 lg:py-6">
          {patient ? <PatientHeader patient={patient} allergies={record.allergies} /> : null}

          <header className="flex flex-col gap-0.5">
            <span className="text-muted-foreground/80 font-mono text-[10px] tracking-[0.18em] uppercase">
              Clinical documentation
            </span>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="font-display text-display-s text-foreground">
                {enc.encounterType} · {enc.state}
              </h1>
              <p className="text-muted-foreground text-caption font-mono tabular-nums">
                Started {enc.startedAt.toISOString().slice(0, 16).replace("T", " ")}
                {doc
                  ? ` · documentation v${doc.version} (${doc.status})`
                  : " · no documentation yet"}
              </p>
            </div>
          </header>

          {/* The NCD clerkship (ADR 0082). Gated by NCD_CLERKSHIP_LIVE; the
            criteria carry their own sign-off state, and the profile shows a
            gated-dark notice while any citation is unratified — so the surface
            can be reviewed without any part of it claiming to be ratified
            clinical advice.

            The working draft autosaves to the MUTABLE `clerkship_drafts`
            scratchpad, not to clinical_documentation: that table is append-only
            and audited, and writing a version every time a clinician changes tab
            would turn the clinical timeline into noise. The explicit clinical
            save — the one that does write a version — is the next increment. */}
          {ncdClerkshipLive() ? (
            <NcdClerkship
              catalog={DIABETES_CATALOG}
              site={REFERRAL_SITE}
              siteOptions={[REFERRAL_SITE, DISTRICT_SITE]}
              initialValues={initialCapture(
                { ...demographics.values, ...(vitals?.values ?? {}) },
                draft,
              )}
              ageBand={demographics.ageBand}
              onSave={saveDraft}
              pulled={
                vitals?.vitals.length
                  ? {
                      values: vitals.values,
                      items: vitals.vitals.map((v) => ({
                        feature: v.feature,
                        display: v.display,
                        value: v.value,
                        fromTriage: v.fromTriage,
                      })),
                      latestAt: vitals.latestAt?.toISOString().slice(11, 16),
                      anyFromTriage: vitals.anyFromTriage,
                    }
                  : undefined
              }
            />
          ) : (
            <section className="border-border bg-card flex flex-col gap-2 rounded-lg border p-5 shadow-xs">
              <span className="text-muted-foreground/80 font-mono text-[10px] tracking-[0.18em] uppercase">
                Clerkship
              </span>
              <h2 className="text-foreground text-heading-s leading-[1.3] tracking-[-0.01em]">
                Being rebuilt for NCD care
              </h2>
              <p className="text-muted-foreground text-body-s max-w-prose leading-relaxed">
                The previous clerkship is no longer available for new entries. Existing
                documentation for this encounter is unchanged and still readable — in the timeline
                below and in the patient&apos;s clinical record.
              </p>
              {doc ? (
                <p className="text-muted-foreground text-caption font-mono tabular-nums">
                  Last documented: v{doc.version} ({doc.status})
                </p>
              ) : null}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

const CADRE_LABEL: Record<string, string> = {
  INTERN_DOCTOR: "Intern Doctor",
  CLINICAL_OFFICER: "Clinical Officer",
  MEDICAL_OFFICER: "Medical Officer",
  MEDICAL_OFFICER_SG: "MO Special Grade",
  CONSULTANT: "Consultant",
  SENIOR_CONSULTANT: "Senior Consultant",
};

/** Full-bleed workspace top bar (the doctor shell chrome is hidden here). */
function WorkspaceTopBar({
  scope,
  patientName,
  visit,
  back = { href: "/doctor/encounters", label: "Encounters" },
}: {
  scope: Awaited<ReturnType<typeof requireDoctorScope>>;
  patientName: string | null;
  /** End visit / "Completed · 14:05" (ADR 0101 R3). */
  visit: React.ReactNode;
  /** Where the back link goes: the Encounters list, or the doctor workspace's board. */
  back?: { href: string; label: string };
}) {
  return (
    // min-h, not h: the End visit confirm and its refusal line need room, and
    // on a phone the right-hand group wraps rather than pushing off-screen.
    <header className="border-border glass sticky top-0 z-30 flex min-h-13 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-4 py-1 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <Link
          href={back.href}
          className="text-muted-foreground hover:text-foreground group inline-flex shrink-0 items-center gap-1 text-[12.5px] transition-colors"
        >
          <ArrowLeftIcon
            className="size-3.5 transition-transform duration-200 group-hover:-translate-x-0.5"
            aria-hidden
          />
          {back.label}
        </Link>
        <span className="text-border hidden sm:inline" aria-hidden>
          |
        </span>
        <span className="text-foreground text-body-s hidden truncate font-medium sm:inline">
          {patientName ?? "Clerking"}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {visit}
        <span className="text-muted-foreground hidden items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] uppercase lg:inline-flex">
          <span
            aria-hidden
            className="bg-iris-icon ring-iris-edge size-1.5 shrink-0 rounded-full ring-2"
          />
          <span className="max-w-[180px] truncate" title={scope.hospitalName}>
            {scope.hospitalName}
          </span>
          <span className="text-muted-foreground/70" aria-hidden>
            ·
          </span>
          <span className="max-w-[140px] truncate">{scope.departmentName}</span>
        </span>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] tracking-[0.12em] uppercase ${
            scope.isJunior
              ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
              : "bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200"
          }`}
        >
          {CADRE_LABEL[scope.cadreCode] ?? scope.cadreCode}
        </span>
        <Link
          href="/sign-out"
          className="text-muted-foreground hover:text-foreground text-[12px] transition-colors"
        >
          Sign out
        </Link>
      </div>
    </header>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8 lg:py-10">
      <Link
        href="/doctor/encounters"
        className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-[12.5px] transition-colors"
      >
        <ArrowLeftIcon className="size-3.5" aria-hidden />
        Encounters
      </Link>
      {children}
    </div>
  );
}

function Note({ title, body }: { title: string; body: string }) {
  return (
    <div className="border-border bg-card/40 text-muted-foreground reveal-up rounded-lg border border-dashed p-6">
      <span className="text-foreground/80 text-[14px] font-medium">{title}</span>
      <p className="mt-1 text-[12px] leading-relaxed">{body}</p>
    </div>
  );
}

const SEX_LABEL: Record<string, string> = {
  male: "Male",
  female: "Female",
  intersex: "Intersex",
  prefer_not_say: "—",
};

/**
 * Patient info — PULLED from the record, shown read-only (no re-typing). Allergies
 * surfaced first (safety). Corrections happen on the patient record, not here.
 */
function PatientHeader({
  patient,
  allergies,
}: {
  patient: PatientSummary;
  allergies: { id: string; substance: string; severity: string | null }[];
}) {
  const age = computeAgeYears(patient.dateOfBirth);
  const anaphylaxis = allergies.some((a) => a.severity === "anaphylaxis");
  return (
    <div className="border-border bg-card flex flex-col gap-2 rounded-lg border p-4 shadow-xs">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-foreground text-heading-s tracking-[-0.01em]">
          {patient.firstName} {patient.surname}
        </span>
        <span className="text-muted-foreground font-mono text-[11.5px] tabular-nums">
          {patient.patientCode}
        </span>
        <span className="text-muted-foreground text-[12px]">
          {SEX_LABEL[patient.sex] ?? patient.sex}
          {age !== null ? ` · ${age}y` : ""}
        </span>
        <span className="text-muted-foreground/70 ml-auto font-mono text-[9.5px] tracking-[0.12em] uppercase">
          pulled · read-only
        </span>
      </div>
      <div
        className={
          allergies.length > 0
            ? "flex flex-wrap items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 ring-1 ring-amber-200/70 dark:bg-amber-950/30 dark:ring-amber-800/40"
            : "text-muted-foreground text-[12px]"
        }
      >
        <span className="inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.12em] text-amber-700 uppercase dark:text-amber-300">
          {allergies.length > 0 ? <AlertTriangleIcon className="size-3" aria-hidden /> : null}
          Allergies{anaphylaxis ? " · anaphylaxis" : ""}
        </span>
        {allergies.length === 0 ? (
          <span className="text-[12px]">None recorded</span>
        ) : (
          allergies.map((a) => {
            const ana = a.severity === "anaphylaxis";
            return (
              <span
                key={a.id}
                className={`scale-in inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] ${
                  ana
                    ? "bg-red-100 text-red-900 ring-1 ring-red-500/30 ring-inset dark:bg-red-950/40 dark:text-red-200"
                    : "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
                }`}
              >
                {ana ? <AlertTriangleIcon className="size-3" aria-hidden /> : null}
                {a.substance}
                {a.severity ? ` (${a.severity})` : ""}
              </span>
            );
          })
        )}
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
