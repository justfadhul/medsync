import "server-only";

import type { MarRow } from "@/lib/emr/charts/payload";
import type { EmrTx } from "@/lib/emr/db";
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";

import { medicationAdministrationRecords, nurseTasks } from "@/db/schema/nurse-workspace";
import { prescriptions } from "@/db/schema/prescribing";
import { encounters } from "@/db/schema/scheduling";
import { buildMarRow, liveDoses } from "@/lib/emr/charts/build";
import { chartDayStart } from "@/lib/emr/charts/fluids";
import { chartableLine } from "@/lib/emr/write/nursing";

/**
 * Nurse tasks and the medicine chart, read as the clinician (RLS: the reader's scoped SELECT on
 * nurse_tasks, prescriptions and the MAR). Prescribing kit P2 (b), F5.
 */

export type NurseTaskRow = typeof nurseTasks.$inferSelect;

/** Open tasks first (by due time), then the last done ones. */
export async function loadNurseTasks(tx: EmrTx, hospitalId: string, doneLimit = 20) {
  const open = await tx
    .select()
    .from(nurseTasks)
    .where(and(eq(nurseTasks.hospitalId, hospitalId), eq(nurseTasks.status, "open")))
    .orderBy(nurseTasks.dueAt, nurseTasks.createdAt)
    .limit(200);
  const done = await tx
    .select()
    .from(nurseTasks)
    .where(and(eq(nurseTasks.hospitalId, hospitalId), eq(nurseTasks.status, "done")))
    .orderBy(desc(nurseTasks.doneAt))
    .limit(doneLimit);
  return { open, done };
}

export interface IvLine {
  size: string;
  site: string;
  at: Date;
}

/** The lines recorded from tasks on the patient's open visits ("the line shows on the patient"). */
export async function ivLinesFor(tx: EmrTx, patientUserId: string): Promise<IvLine[]> {
  const rows = await tx
    .select({ outcome: nurseTasks.outcome, at: nurseTasks.doneAt })
    .from(nurseTasks)
    .innerJoin(encounters, eq(encounters.id, nurseTasks.encounterId))
    .where(
      and(
        eq(nurseTasks.patientUserId, patientUserId),
        eq(nurseTasks.type, "iv_cannula"),
        eq(nurseTasks.status, "done"),
        eq(encounters.state, "in_progress"),
      ),
    )
    .orderBy(desc(nurseTasks.doneAt));
  return rows.flatMap((r) => {
    const o = (r.outcome ?? {}) as { size?: string; site?: string };
    return o.size && o.site && r.at ? [{ size: o.size, site: o.site, at: r.at }] : [];
  });
}

export interface ChartDose {
  id: string;
  prescriptionId: string;
  state: string;
  reason: string | null;
  at: string;
}

export interface NurseMarLine {
  row: MarRow;
  /** False for high-alert and controlled lines: they keep the co-sign / CD dose routes. */
  chartable: boolean;
  /** The doses that stand, newest first, for "Wrong entry". */
  doses: ChartDose[];
}

/** Today's medicine chart: every active structured line on the patient's open visits. */
export async function loadNurseMar(
  tx: EmrTx,
  i: { hospitalId: string; patientUserId: string; now: Date },
): Promise<NurseMarLine[]> {
  const rx = await tx
    .select({ p: prescriptions })
    .from(prescriptions)
    .innerJoin(encounters, eq(encounters.id, prescriptions.encounterId))
    .where(
      and(
        eq(prescriptions.patientUserId, i.patientUserId),
        eq(prescriptions.hospitalId, i.hospitalId),
        eq(prescriptions.isEmergency, false),
        ne(prescriptions.state, "cancelled"),
        eq(encounters.state, "in_progress"),
        // Protocol lines are given on their protocol chart (kit P4), not on the MAR.
        isNull(prescriptions.protocolVersionId),
      ),
    )
    .orderBy(prescriptions.createdAt);
  if (!rx.length) return [];
  const records = liveDoses(
    await tx
      .select()
      .from(medicationAdministrationRecords)
      .where(
        and(
          inArray(
            medicationAdministrationRecords.emrPrescriptionId,
            rx.map((r) => r.p.id),
          ),
          eq(medicationAdministrationRecords.patientUserId, i.patientUserId),
        ),
      ),
  );
  const dayStart = chartDayStart(i.now);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600_000);
  return rx.map(({ p }) => {
    const mine = records.filter((m) => m.emrPrescriptionId === p.id);
    return {
      row: buildMarRow(
        p,
        mine.map((m) => ({ ...m, prescriptionId: p.id })),
        { windowStart: dayStart, dayEnd, now: i.now },
      ),
      chartable: chartableLine(p),
      doses: mine
        .sort((a, b) => b.administeredAt.getTime() - a.administeredAt.getTime())
        .map((m) => ({
          id: m.id,
          prescriptionId: p.id,
          state: m.state,
          reason: m.withheldReason,
          at: (m.scheduledFor ?? m.administeredAt).toISOString(),
        })),
    };
  });
}
