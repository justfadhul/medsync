import "server-only";

import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { encounters } from "@/db/schema/scheduling";
import { requireEmrActor } from "@/lib/emr/actor";
import { emrV1LiveFor } from "@/lib/emr/feature";
import { loadChartFor } from "@/lib/emr/read/chart";

/**
 * The printouts read through loadChart like the chart does (access rule, RLS, audit), for the
 * encounter's patient at the clinician's own hospital. Flag off, or no basis: not found.
 */
export async function loadPrint(encounterId: string, logSurface: string) {
  const actor = await requireEmrActor("doctor");
  if (!emrV1LiveFor(actor.hospitalId)) notFound();
  const [enc] = await db
    .select({ patientUserId: encounters.patientUserId, hospitalId: encounters.hospitalId })
    .from(encounters)
    .where(eq(encounters.id, encounterId))
    .limit(1);
  if (!enc || enc.hospitalId !== actor.hospitalId) notFound();
  const chart = await loadChartFor(actor, enc.patientUserId, { logSurface });
  const encounter = chart?.encounters.find((e) => e.id === encounterId);
  if (!chart || !encounter) notFound();
  return { chart, encounter };
}

/** `?include=<id>&include=<id>`: the restricted items the clinician chose to print. */
export function includeSet(v: string | string[] | undefined): Set<string> {
  return new Set(v === undefined ? [] : Array.isArray(v) ? v : [v]);
}

/** The restricted items a printout could carry, split by the clinician's choice, for the toolbar. */
export function restrictedChoices(
  items: readonly { id: string; label: string; restricted: boolean }[],
  include: ReadonlySet<string>,
) {
  const r = items.filter((i) => i.restricted).map(({ id, label }) => ({ id, label }));
  return {
    withheld: r.filter((i) => !include.has(i.id)),
    included: r.filter((i) => include.has(i.id)),
  };
}

export type PrintPageProps = {
  params: Promise<{ encounterId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
