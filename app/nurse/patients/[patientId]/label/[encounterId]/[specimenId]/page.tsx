import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import {
  includeSet,
  restrictedChoices,
} from "@/app/doctor/encounters/[encounterId]/print/_lib/load";
import { LABEL_CSS, SpecimenLabel } from "@/components/emr/orders/specimen-label";
import { PrintToolbar } from "@/components/emr/print-toolbar";
import { requireEmrActor } from "@/lib/emr/actor";
import { emrV1LiveFor } from "@/lib/emr/feature";
import { loadSpecimenLabel } from "@/lib/emr/read/orders";

export const metadata: Metadata = { title: "Specimen label · MedSync" };
export const dynamic = "force-dynamic";

/**
 * The specimen label from the nurse chart (gate-a E.8), as the desk prints it: the same loader
 * (access rule, the specimen must belong to this visit's patient, the read is logged) and the same
 * restricted-name choice. Flag off, a malformed id, or no basis: not found.
 */
export default async function NurseSpecimenLabelPage({
  params,
  searchParams,
}: {
  params: Promise<{ patientId: string; encounterId: string; specimenId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { encounterId, specimenId } = await params;
  const actor = await requireEmrActor("nurse");
  if (!emrV1LiveFor(actor.hospitalId)) notFound();
  if (!z.uuid().safeParse(encounterId).success || !z.uuid().safeParse(specimenId).success)
    notFound();
  const include = includeSet((await searchParams).include);
  const label = await loadSpecimenLabel(actor, encounterId, specimenId, { include });
  if (!label) notFound();
  const choices = restrictedChoices(
    label.restricted ? [{ ...label.restricted, restricted: true }] : [],
    include,
  );
  return (
    <div className="flex flex-col items-start gap-4 px-4 py-6 md:px-8">
      <style>{LABEL_CSS}</style>
      <div className="flex flex-wrap items-center gap-4 print:hidden">
        <h1 className="text-heading-s text-foreground font-medium">Specimen label</h1>
        <PrintToolbar withheld={choices.withheld} included={choices.included} />
      </div>
      <SpecimenLabel data={label.data} />
    </div>
  );
}
