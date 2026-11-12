import type { Entry, Pack, Payload } from "./content";
import type { CurrentMed, EarlierAnswer, InteractionsChecked } from "./interactions";
import type { EmrDb, EmrTx } from "@/lib/emr/db";
import { and, eq, gte, sql } from "drizzle-orm";

import { medicationStatements } from "@/db/schema/emr";
import { medicationAdministrationRecords } from "@/db/schema/nurse-workspace";
import { pharmacyContentEntries } from "@/db/schema/pharmacy-clinical";
import { pharmacyProducts, pharmacySupplies } from "@/db/schema/pharmacy-dispensing";
import { prescriptions } from "@/db/schema/prescribing";
import { currentMedicines, interactionsChecked } from "./interactions";

/** Pharmacy Phase 3: reads for the interaction check (IX-2) and the content pages. Server only. */

/**
 * A dose that stands on the medicine chart: given, and not undone by a later `reversed` row (0281;
 * the same rule as `liveDoses` in lib/emr/charts/build.ts). Every pharmacy read of the MAR uses this.
 */
export const liveDose = () =>
  and(
    eq(medicationAdministrationRecords.state, "administered"),
    sql`NOT EXISTS (SELECT 1 FROM public.medication_administration_records r
                     WHERE r.reverses_id = ${medicationAdministrationRecords.id})`,
  )!;

type Db = EmrDb | EmrTx;

export async function entriesInForce<P extends Pack>(
  db: Db,
  hospitalId: string,
  pack: P,
): Promise<Entry<P>[]> {
  const rows = await db
    .select()
    .from(pharmacyContentEntries)
    .where(
      and(
        eq(pharmacyContentEntries.hospitalId, hospitalId),
        eq(pharmacyContentEntries.pack, pack),
        eq(pharmacyContentEntries.status, "in_force"),
      ),
    );
  return rows.map((r) => ({ ...r, pack, payload: r.payload as Payload<P> })) as Entry<P>[];
}

const single = async <P extends "alert_levels" | "lookback_windows" | "check_worth_signing">(
  db: Db,
  hospitalId: string,
  pack: P,
) => (await entriesInForce(db, hospitalId, pack))[0] ?? null;

/** What the dialog and the review need to run the check, with nothing patient-identifying beyond the meds. */
export interface InteractionContext {
  entries: Entry<"interaction_pair">[];
  levels: Payload<"alert_levels"> | null;
  current: CurrentMed[];
  earlier: EarlierAnswer[];
  /** IX-9: the signed pair count, for the "checked against" line. */
  pairs: number;
}

/** IX-2 over the record: active lines, charted doses, window supplies and Continue admission medicines. */
export async function interactionContextFor(
  db: Db,
  hospitalId: string,
  patientUserId: string,
  now: Date,
): Promise<InteractionContext> {
  const [entries, levels, windows] = await Promise.all([
    entriesInForce(db, hospitalId, "interaction_pair"),
    single(db, hospitalId, "alert_levels"),
    single(db, hospitalId, "lookback_windows"),
  ]);
  const w = windows?.payload ?? null;
  const longest = Math.max(
    w?.chartedHours ?? 0,
    (w?.suppliedDays ?? 0) * 24,
    ...Object.values(w?.suppliedDaysByMedicine ?? {}).map((d) => d * 24),
  );
  const since = new Date(now.getTime() - longest * 3_600_000);
  const [active, charted, supplied, continued] = await Promise.all([
    db
      .select({
        id: prescriptions.drugId,
        at: prescriptions.createdAt,
        answers: prescriptions.checkAnswers,
      })
      .from(prescriptions)
      .where(
        and(eq(prescriptions.patientUserId, patientUserId), eq(prescriptions.state, "active")),
      ),
    w
      ? db
          .select({ id: prescriptions.drugId, at: medicationAdministrationRecords.administeredAt })
          .from(medicationAdministrationRecords)
          .innerJoin(
            prescriptions,
            eq(prescriptions.id, medicationAdministrationRecords.emrPrescriptionId),
          )
          .where(
            and(
              eq(medicationAdministrationRecords.patientUserId, patientUserId),
              liveDose(),
              gte(medicationAdministrationRecords.administeredAt, since),
            ),
          )
      : [],
    w
      ? db
          .select({ id: pharmacyProducts.medicineId, at: pharmacySupplies.suppliedAt })
          .from(pharmacySupplies)
          .innerJoin(pharmacyProducts, eq(pharmacyProducts.id, pharmacySupplies.productId))
          .where(
            and(
              eq(pharmacySupplies.patientUserId, patientUserId),
              gte(pharmacySupplies.suppliedAt, since),
            ),
          )
      : [],
    db
      .select({ id: medicationStatements.drugCode, at: medicationStatements.recordedAt })
      .from(medicationStatements)
      .where(
        and(
          eq(medicationStatements.patientUserId, patientUserId),
          eq(medicationStatements.reconciliation, "continued"),
          sql`${medicationStatements.drugCode} IS NOT NULL`,
        ),
      ),
  ]);
  const rows: CurrentMed[] = [
    ...active.map((r) => ({
      medicineId: r.id,
      source: "active_line" as const,
      since: new Date(r.at),
    })),
    ...charted.map((r) => ({
      medicineId: r.id,
      source: "charted" as const,
      since: new Date(r.at),
    })),
    ...supplied.map((r) => ({
      medicineId: r.id,
      source: "supplied" as const,
      since: new Date(r.at),
    })),
    ...continued.map((r) => ({
      medicineId: r.id!,
      source: "admission_continue" as const,
      since: new Date(r.at),
    })),
  ];
  // IX-5, IX-7: earlier answers are stored on the prescription's check answers with the entries they answered.
  const earlier: EarlierAnswer[] = active.flatMap((p) =>
    (
      (p.answers ?? []) as {
        code: string;
        answer?: string;
        entries?: { id: string; key: string }[];
      }[]
    )
      .filter((a) => a.code === "interactions" && a.entries?.length)
      .flatMap((a) =>
        a.entries!.map((e) => ({
          entryId: e.id,
          key: e.key,
          answeredAt: new Date(p.at),
          cadre: "Prescriber",
          reason: a.answer ?? "",
        })),
      ),
  );
  return {
    entries,
    levels: levels?.payload ?? null,
    current: currentMedicines(rows, w, now),
    earlier,
    pairs: entries.filter((e) => !e.blocked).length,
  };
}

/** IX-9 for the notice: `none` with the flag off or nothing in force; `partial` with the signed count. */
export async function interactionsStateFor(
  db: Db,
  hospitalId: string,
  flagOn: boolean,
): Promise<InteractionsChecked> {
  if (!flagOn) return { state: "none" };
  const [entries, levels] = await Promise.all([
    entriesInForce(db, hospitalId, "interaction_pair"),
    entriesInForce(db, hospitalId, "alert_levels"),
  ]);
  const latest = entries
    .map((e) => (e as Entry & { inForceAt?: Date | null }).inForceAt)
    .filter(Boolean) as Date[];
  return interactionsChecked(
    entries,
    levels.length > 0,
    latest.length ? new Date(Math.max(...latest.map(Number))) : null,
  );
}
