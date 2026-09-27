import type { PrintPageProps } from "../_lib/load";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { inArray } from "drizzle-orm";

import { formatters } from "@/components/emr/format";
import { PrescriptionLine } from "@/components/emr/prescribing/views";
import { printable, PrintField, PrintLayout } from "@/components/emr/print-layout";
import { PrintToolbar } from "@/components/emr/print-toolbar";
import { identityOf } from "@/components/emr/print-views";
import { cadres } from "@/db/schema/reference-data";
import { users } from "@/db/schema/users";
import { requireEmrActor } from "@/lib/emr/actor";
import { asClinicalWriter } from "@/lib/emr/db";
import { emrPrescribingLive } from "@/lib/emr/feature";
import { encounterPrescriptions } from "@/lib/emr/write/prescriptions";
import { decrypt } from "@/lib/encryption";
import { includeSet, loadPrint, restrictedChoices } from "../_lib/load";

export const metadata: Metadata = { title: "Prescription · MedSync" };
export const dynamic = "force-dynamic";

/**
 * The printed prescription (PROMPT Phase 7): the visit's prescriptions with both identifiers on
 * every page (PrintLayout), the date, and each prescriber's name and cadre with a line to sign.
 * A prescription the senior did not co-sign never prints (encounterPrescriptions forPrint).
 * Restricted items print only when included one by one. loadPrint has already applied the access
 * rule and logged the read; flag off, the route is not found.
 */
export default async function PrescriptionPrintPage({ params, searchParams }: PrintPageProps) {
  const { encounterId } = await params;
  const include = includeSet((await searchParams).include);
  const actor = await requireEmrActor("doctor");
  if (!emrPrescribingLive(actor.hospitalId)) notFound();
  const { chart } = await loadPrint(encounterId, "emr_print_prescription");

  const { rows, prescribers } = await asClinicalWriter(
    { userId: actor.userId, hospitalId: actor.hospitalId },
    async (tx) => {
      const rows = await encounterPrescriptions(tx, {
        hospitalId: actor.hospitalId,
        patientUserId: chart.patientUserId,
        encounterId,
        forPrint: true,
      });
      const ids = [...new Set(rows.map((r) => r.prescriberUserId))];
      const names = ids.length
        ? await tx
            .select({ id: users.id, name: users.fullName })
            .from(users)
            .where(inArray(users.id, ids))
        : [];
      const codes = [
        ...new Set(rows.flatMap((r) => (r.prescriberCadre ? [r.prescriberCadre] : []))),
      ];
      const cadreNames = codes.length
        ? await tx
            .select({ code: cadres.code, name: cadres.name })
            .from(cadres)
            .where(inArray(cadres.code, codes))
        : [];
      const nameOf = new Map(names.map((n) => [n.id, n.name]));
      const cadreOf = new Map(cadreNames.map((c) => [c.code, c.name]));
      const prescribers = new Map<string, { name: string; cadre: string }>();
      for (const r of rows)
        prescribers.set(r.prescriberUserId, {
          name: nameOf.get(r.prescriberUserId) ?? "",
          cadre: r.prescriberCadre ? (cadreOf.get(r.prescriberCadre) ?? r.prescriberCadre) : "",
        });
      return { rows, prescribers };
    },
  );

  const items = rows.map((r) => ({
    ...r,
    restricted: r.sensitivity === "restricted",
    label: r.drugName,
  }));
  const choices = restrictedChoices(items, include);
  const kept = printable(items, include).kept;
  const f = formatters(chart.timeZone);
  const newest = kept.at(-1)?.createdAt;
  const signers = [...new Set(kept.map((r) => r.prescriberUserId))].map((id) => ({
    id,
    ...prescribers.get(id)!,
  }));

  return (
    <PrintLayout
      title="Prescription"
      hospital={chart.hospitalName}
      patient={identityOf(chart.payload)}
      date={newest ? f.date(newest.toISOString()) : ""}
      toolbar={<PrintToolbar withheld={choices.withheld} included={choices.included} />}
    >
      <section className="flex flex-col gap-3">
        {kept.length ? (
          <ol className="flex flex-col gap-3">
            {kept.map((r) => (
              <li key={r.id} className="flex break-inside-avoid flex-col gap-0.5">
                <span className="font-medium">{r.drugName}</span>
                {r.concentration ? <span>{r.concentration}</span> : null}
                <PrescriptionLine item={r} />
                {r.instructionsCiphertext ? <span>{decrypt(r.instructionsCiphertext)}</span> : null}
                {r.awaitingCosign ? <span>Awaiting senior co-sign</span> : null}
              </li>
            ))}
          </ol>
        ) : (
          <p>Nothing prescribed in this visit.</p>
        )}
      </section>
      <section className="flex flex-col gap-3 border-t border-gray-300 pt-3">
        {signers.map((s) => (
          <div key={s.id} className="flex flex-col gap-1">
            <PrintField label="Prescriber">{s.name}</PrintField>
            <PrintField label="Cadre">{s.cadre}</PrintField>
            <PrintField label="Signature" />
          </div>
        ))}
      </section>
    </PrintLayout>
  );
}
