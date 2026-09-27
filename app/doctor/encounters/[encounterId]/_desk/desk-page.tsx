import type { NcdSeed } from "./ncd-section";
import type { DoctorScope } from "@/lib/doctor/scope";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeftIcon } from "lucide-react";

import { sectionWith } from "@/components/emr/desk/model";
import { EncounterPrescriptions } from "@/components/emr/prescribing/encounter-prescriptions";
import { SafetyBarView } from "@/components/emr/safety-bar";
import { loadDesk } from "@/lib/emr/read/desk";
import { DIABETES_CATALOG } from "@/lib/ncd/catalog/diabetes";
import { initialCapture, loadLatestVitals, loadPatientDemographics } from "@/lib/ncd/vitals";
import { doctorWorkspace } from "@/lib/workspace/feature";
import { EncounterOrders } from "../_orders/encounter-orders";
import { EmergencyInlineLink } from "../../../_components/emergency-inline-link";
import { EncounterRail, NextPatient } from "../../../_components/workspace/encounter-extras";
import { DeskClient } from "./desk-client";

/**
 * The clerking desk route body under EMR v1 (UI-BRIEF §3, gate-a E.3). Server-rendered: the top
 * bar, the sticky safety bar (the one bold element), and the client island with its payload. The
 * Workspace rail streams in beside it and never holds the page. The encounter page's drift is not
 * carried over: type sizes are on the scale, no raw-rgba wash, no stagger on a work surface.
 */
export async function DeskPage({
  encounterId,
  scope,
  template,
}: {
  encounterId: string;
  scope: DoctorScope;
  /** The desk switch's clerking form (?template=), honoured only before a draft exists. */
  template?: string;
}) {
  const load = await loadDesk(encounterId, template);
  const workspace = doctorWorkspace(scope.hospitalId);
  const back = workspace
    ? { href: "/doctor", label: "Workspace" }
    : { href: "/doctor/encounters", label: "Encounters" };
  if (!load)
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-8 md:px-8">
        <BackLink {...back} />
        <h1 className="text-heading-m text-foreground font-medium">Encounter unavailable</h1>
        <p className="text-body-s text-muted-foreground">
          It is not at your hospital, or you have no clinical relationship with this patient. Open
          it from the Workspace, or ask the clinician responsible.
        </p>
      </div>
    );

  const p = load.payload;
  const allergySection = sectionWith(p.template, "allergy_status");
  let ncdSeed: NcdSeed | null = null;
  if (p.flags.ncd && p.draft) {
    // The NCD module pre-fills from what the record holds (vitals, sex, life stage), as before.
    const [demographics, vitals] = await Promise.all([
      loadPatientDemographics(p.encounter.patientUserId),
      loadLatestVitals(p.encounter.patientUserId, DIABETES_CATALOG),
    ]);
    ncdSeed = {
      initialValues: initialCapture({ ...demographics.values, ...vitals.values }, undefined),
      ageBand: demographics.ageBand,
      pulled: vitals.vitals.length
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
        : undefined,
    };
  }

  return (
    <div className="bg-background text-foreground flex min-h-svh flex-col xl:h-dvh xl:overflow-hidden">
      <header className="border-border bg-background sticky top-0 z-30 flex min-h-13 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b px-4 py-1 md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <BackLink {...back} />
          <span className="text-body-s text-foreground hidden truncate font-medium sm:inline">
            Clerking
          </span>
        </div>
        <div className="text-caption text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="hidden lg:inline">{scope.hospitalName}</span>
          <span className="hidden lg:inline">{scope.departmentName}</span>
          <span className="text-foreground">{p.viewer.cadreWord}</span>
          <Link
            href="/sign-out"
            className="text-body-s hover:text-foreground underline-offset-4 hover:underline"
          >
            Sign out
          </Link>
          {/* The global Emergency affordance, in the bar: it stands the floating pill down so the
              pill never covers the desk's fixed action bar on a phone or tablet. */}
          <EmergencyInlineLink />
        </div>
      </header>
      <SafetyBarView
        bar={p.safetyBar}
        links={{
          allergies: p.flags.actionsAllowed && allergySection ? `#desk-${allergySection}` : null,
          problems: `${p.links.chart}#chart-problems`,
          results: p.links.results,
        }}
      />
      {workspace && !p.encounter.open ? (
        <Suspense fallback={null}>
          <NextPatient scope={scope} />
        </Suspense>
      ) : null}
      <DeskClient
        key={p.template.id}
        p={p}
        ncdSeed={ncdSeed}
        orders={
          p.flags.actionsAllowed && p.draft ? (
            <Suspense fallback={null}>
              <EncounterOrders encounterId={encounterId} />
              {/* Renders nothing unless EMR_PRESCRIBING is on here (PROMPT Phase 7). */}
              <EncounterPrescriptions
                encounterId={encounterId}
                identity={{ name: p.safetyBar.name, mrn: p.safetyBar.mrn }}
              />
            </Suspense>
          ) : null
        }
        rail={
          workspace ? (
            <Suspense fallback={null}>
              <EncounterRail scope={scope} currentEncounterId={encounterId} />
            </Suspense>
          ) : null
        }
      />
    </div>
  );
}

function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="text-body-s text-muted-foreground hover:text-foreground focus-visible:shadow-focus inline-flex min-h-11 shrink-0 items-center gap-1 rounded-sm outline-none"
    >
      <ArrowLeftIcon className="size-3.5" aria-hidden />
      {label}
    </Link>
  );
}
