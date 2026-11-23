import type { NcdSeed } from "./ncd-section";
import type { DoctorScope } from "@/lib/doctor/scope";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeftIcon } from "lucide-react";

import { sectionWith } from "@/components/emr/desk/model";
import { EncounterPrescriptions } from "@/components/emr/prescribing/encounter-prescriptions";
import { SafetyBarView } from "@/components/emr/safety-bar";
import { TideScope } from "@/components/medsync/tide-scope";
import { ncdDmDeskFor } from "@/lib/emr/feature";
import { loadDesk } from "@/lib/emr/read/desk";
import { ncdPackLive } from "@/lib/encounter/feature";
import { isTetherHost } from "@/lib/landing/feature";
import {
  leanDiabetesPack,
  ncdCatalog,
  packCaptureCatalog,
  packFieldCodes,
} from "@/lib/ncd/pack/capture";
import { moreQuestionsCatalog } from "@/lib/ncd/pack/more-questions";
import { initialCapture, loadLatestVitals, loadPatientDemographics } from "@/lib/ncd/vitals";
import { doctorWorkspace } from "@/lib/workspace/feature";
import { EncounterOrders } from "../_orders/encounter-orders";
import { EncounterRail, NextPatient } from "../../../_components/workspace/encounter-extras";
import { DeskClient } from "./desk-client";
import { DeskTopBar } from "./desk-top-bar";

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
  // ADR 0532: opened from the Tether clinic floor, the desk is the same desk, in the Tether look, without the
  // diabetes module, and it goes back to the Clinic line.
  const tether = isTetherHost((await headers()).get("host"));
  const back = tether
    ? { href: "/clinic?view=line", label: "Clinic line" }
    : workspace
      ? { href: "/doctor", label: "Workspace" }
      : { href: "/doctor/encounters", label: "Encounters" };
  if (!load)
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-8 md:px-8">
        <BackLink {...back} />
        <h1 className="text-heading-m text-foreground">Encounter unavailable</h1>
        <p className="text-body-s text-muted-foreground">
          It is not at your hospital, or you have no clinical relationship with this patient. Open
          it from the Workspace, or ask the clinician responsible.
        </p>
      </div>
    );

  const p = load.payload;
  const allergySection = sectionWith(p.template, "allergy_status");
  let ncdSeed: NcdSeed | null = null;
  if (!tether && p.flags.ncd && p.draft) {
    // The NCD module pre-fills from what the record holds (vitals, sex, life stage), as before.
    const [demographics, vitals] = await Promise.all([
      loadPatientDemographics(p.encounter.patientUserId),
      loadLatestVitals(p.encounter.patientUserId, ncdCatalog()),
    ]);
    ncdSeed = {
      initialValues: initialCapture({ ...demographics.values, ...vitals.values }, undefined),
      ageBand: demographics.ageBand,
      // NCD_DM_PACK_LIVE: the pack's form and its decision panel (absent keeps the v0.1.0 section unchanged).
      ...(ncdPackLive()
        ? {
            catalog: ncdCatalog(),
            pack: {
              data: leanDiabetesPack(),
              fields: packFieldCodes(),
              ageYears: demographics.ageYears ?? null,
              careSetting:
                p.encounter.encounterType === "inpatient"
                  ? ("inpatient" as const)
                  : p.encounter.encounterType === "emergency"
                    ? ("emergency" as const)
                    : ("outpatient" as const),
            },
          }
        : {}),
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
  // NCD_DM_DESK (ADR 0216): the pack reads the clerking; the module keeps only the questions the
  // clerking does not ask, with no panel of its own (the desk shows the result).
  const dmDesk = !tether && !!p.clerking && ncdDmDeskFor(scope.hospitalId);
  if (dmDesk && ncdSeed) {
    ncdSeed = {
      ...ncdSeed,
      catalog: moreQuestionsCatalog(packCaptureCatalog()),
      pack: undefined,
      formOnly: true,
    };
  }

  return (
    <TideScope group="doctor" force={tether}>
      <div
        data-tether-desk={tether ? "" : undefined}
        className="bg-background text-foreground flex min-h-svh flex-col xl:h-dvh xl:overflow-hidden"
      >
        <DeskTopBar
          back={back}
          hospital={scope.hospitalName}
          department={scope.departmentName}
          cadreWord={p.viewer.cadreWord}
          name={scope.fullName}
          phone={!!p.clerking}
        />
        {/* Clerking desk v2 draws its own safety bar (Draft, saved time, the NEWS2 chip). */}
        {p.clerking ? null : (
          <SafetyBarView
            bar={p.safetyBar}
            links={{
              allergies:
                p.flags.actionsAllowed && allergySection ? `#desk-${allergySection}` : null,
              problems: `${p.links.chart}#chart-problems`,
              results: p.links.results,
            }}
          />
        )}
        {workspace && !p.encounter.open ? (
          <Suspense fallback={null}>
            <NextPatient scope={scope} />
          </Suspense>
        ) : null}
        <DeskClient
          key={p.template.id}
          p={p}
          ncdSeed={ncdSeed}
          dm={
            // NCD_DM_DESK (ADR 0216): the diabetes pack runs on the ten-step clerking record.
            dmDesk ? { pack: leanDiabetesPack(), fields: packFieldCodes() } : null
          }
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
    </TideScope>
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
