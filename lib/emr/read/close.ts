import "server-only";

import type { EmrActor } from "@/lib/emr/actor";
import type { WardCounts } from "@/lib/emr/closure";
import type { EmrDb, EmrTx } from "@/lib/emr/db";
import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import { routeWord } from "@/components/emr/prescribing/views";
import { patientVisitSummaries } from "@/db/schema/admissions";
import { hospitalWards } from "@/db/schema/hospital-wards";
import { prescriptions } from "@/db/schema/prescribing";
import { encounters } from "@/db/schema/scheduling";
import { hospitalBeds } from "@/db/schema/services-hub";
import { bedAssignments, bedStateEvents } from "@/db/schema/ward-builder";
import { asClinicalWriter } from "@/lib/emr/db";
import { patientVisitSummaryLiveFor, prescribeV2LiveFor } from "@/lib/emr/feature";
import { wardBuilderLiveFor } from "@/lib/wards/feature";
import { bedState } from "@/supabase/functions/_shared/ward-layout";

/*
 * What the close dialog needs from the record (ADRs 0197–0203): the wards that take admissions with their bed
 * counts as words, this visit's active prescriptions (to continue at home or stop), and, once closed, what the
 * close wrote and the patient copy's current decision. Read in the clinician's owner transaction after the
 * access check, as the Plan's payload is.
 */

export interface CloseWard {
  id: string;
  name: string;
  /** With WARD_BUILDER on: the live counts; null otherwise. */
  counts: WardCounts | null;
}
export interface CloseRx {
  id: string;
  name: string;
  /** The prescription as written: dose, route, how often, how long. */
  line: string;
}
export interface CloseContext {
  wards: CloseWard[];
  /** WARD_BUILDER on: the bed picker is offered. */
  bedsLive: boolean;
  /** PATIENT_VISIT_SUMMARY on: the patient-copy step is offered. */
  summaryLive: boolean;
  /** PRESCRIBE_V2 (kit F1): medicines to take home are prescribed here, collected at the Main window. */
  prescribeV2?: boolean;
  /** Active, non-restricted-or-not drug prescriptions of this visit: continue at home or stop. */
  takeHome: CloseRx[];
  /** Set once the visit is closed. */
  closed: {
    disposition: string | null;
    closureKind: string | null;
    detail: Record<string, string> | null;
  } | null;
  /** The patient copy's current decision, if one was made. */
  summary: { state: "shared" | "held"; version: number; decidedAt: string } | null;
}

/** Free, arriving and occupied beds per ward, by the board's own rule (ADR 0194 §1, ADR 0199). */
export async function wardBedCounts(
  tx: EmrTx,
  hospitalId: string,
  wardIds: readonly string[],
): Promise<Map<string, WardCounts>> {
  const out = new Map<string, WardCounts>();
  if (!wardIds.length) return out;
  const [beds, open, ended, events] = await Promise.all([
    tx
      .select({ id: hospitalBeds.id, wardId: hospitalBeds.wardId, closedAt: hospitalBeds.closedAt })
      .from(hospitalBeds)
      .where(
        and(
          eq(hospitalBeds.hospitalId, hospitalId),
          inArray(hospitalBeds.wardId, [...wardIds]),
          isNull(hospitalBeds.archivedAt),
        ),
      ),
    tx
      .select({
        bedId: bedAssignments.bedId,
        startedAt: bedAssignments.startedAt,
        admissionId: bedAssignments.admissionId,
        arrivedAt: bedAssignments.arrivedAt,
      })
      .from(bedAssignments)
      .where(
        and(
          eq(bedAssignments.hospitalId, hospitalId),
          inArray(bedAssignments.wardId, [...wardIds]),
          isNull(bedAssignments.endedAt),
        ),
      ),
    tx
      .select({ bedId: bedAssignments.bedId, endedAt: bedAssignments.endedAt })
      .from(bedAssignments)
      .where(
        and(
          eq(bedAssignments.hospitalId, hospitalId),
          inArray(bedAssignments.wardId, [...wardIds]),
          isNotNull(bedAssignments.endedAt),
        ),
      ),
    tx
      .select({
        bedId: bedStateEvents.bedId,
        state: bedStateEvents.state,
        reason: bedStateEvents.reason,
        setAt: bedStateEvents.setAt,
      })
      .from(bedStateEvents)
      .where(eq(bedStateEvents.hospitalId, hospitalId))
      .orderBy(desc(bedStateEvents.setAt)),
  ]);
  for (const id of wardIds) out.set(id, { free: 0, arriving: 0, occupied: 0, other: 0 });
  for (const b of beds) {
    const a = open.find((x) => x.bedId === b.id);
    const lastEnded = ended
      .filter((x) => x.bedId === b.id)
      .reduce<Date | null>((m, x) => (m && m > x.endedAt! ? m : x.endedAt), null);
    const s = bedState({
      closed: !!b.closedAt,
      open: a
        ? { startedAt: a.startedAt.toISOString(), arriving: !!a.admissionId && !a.arrivedAt }
        : null,
      lastEndedAt: lastEnded?.toISOString() ?? null,
      events: events
        .filter((e) => e.bedId === b.id)
        .map((e) => ({
          state: e.state as "free" | "cleaning" | "reserved",
          setAt: e.setAt.toISOString(),
          reason: e.reason,
        })),
    }).state;
    const c = out.get(b.wardId!)!;
    if (s === "free") c.free++;
    else if (s === "arriving") c.arriving++;
    else if (s === "occupied") c.occupied++;
    else c.other++;
  }
  return out;
}

/** The wards that take admissions: active, not archived, not closed. */
export async function admittingWards(tx: EmrTx, hospitalId: string): Promise<CloseWard[]> {
  const rows = await tx
    .select({ id: hospitalWards.id, name: hospitalWards.name })
    .from(hospitalWards)
    .where(
      and(
        eq(hospitalWards.hospitalId, hospitalId),
        eq(hospitalWards.state, "active"),
        isNull(hospitalWards.archivedAt),
        isNull(hospitalWards.closedAt),
      ),
    )
    .orderBy(asc(hospitalWards.name));
  const counts = wardBuilderLiveFor(hospitalId)
    ? await wardBedCounts(
        tx,
        hospitalId,
        rows.map((r) => r.id),
      )
    : null;
  return rows.map((r) => ({ ...r, counts: counts?.get(r.id) ?? null }));
}

export function rxLine(r: {
  dose: string;
  route: string;
  frequency: string | null;
  duration: string | null;
}): string {
  return [r.dose, routeWord(r.route), r.frequency, r.duration ? `for ${r.duration}` : null]
    .filter((x): x is string => !!x && x.trim() !== "")
    .join(", ");
}

export async function loadCloseContext(
  actor: EmrActor,
  input: { patientUserId: string; encounterId: string; database?: EmrDb },
): Promise<CloseContext> {
  const scope = { userId: actor.userId, hospitalId: actor.hospitalId };
  return asClinicalWriter(
    scope,
    async (tx) => {
      const [wards, rx, [enc], [summary]] = await Promise.all([
        admittingWards(tx, actor.hospitalId),
        tx
          .select({
            id: prescriptions.id,
            drugName: prescriptions.drugName,
            dose: prescriptions.dose,
            route: prescriptions.route,
            frequency: prescriptions.frequency,
            duration: prescriptions.duration,
          })
          .from(prescriptions)
          .where(
            and(
              eq(prescriptions.encounterId, input.encounterId),
              eq(prescriptions.patientUserId, input.patientUserId),
              eq(prescriptions.hospitalId, actor.hospitalId),
              eq(prescriptions.state, "active"),
              eq(prescriptions.kind, "drug"),
            ),
          )
          .orderBy(asc(prescriptions.createdAt)),
        tx
          .select({
            state: encounters.state,
            disposition: encounters.disposition,
            closureKind: encounters.closureKind,
            detail: encounters.dispositionDetail,
          })
          .from(encounters)
          .where(eq(encounters.id, input.encounterId)),
        tx
          .select({
            state: patientVisitSummaries.state,
            version: patientVisitSummaries.version,
            decidedAt: patientVisitSummaries.decidedAt,
          })
          .from(patientVisitSummaries)
          .where(
            and(
              eq(patientVisitSummaries.encounterId, input.encounterId),
              isNull(patientVisitSummaries.supersededAt),
            ),
          ),
      ]);
      return {
        wards,
        bedsLive: wardBuilderLiveFor(actor.hospitalId),
        summaryLive: patientVisitSummaryLiveFor(actor.hospitalId),
        prescribeV2: prescribeV2LiveFor(actor.hospitalId),
        takeHome: rx.map((r) => ({ id: r.id, name: r.drugName, line: rxLine(r) })),
        closed:
          enc && enc.state !== "in_progress" && enc.state !== "planned"
            ? {
                disposition: enc.disposition,
                closureKind: enc.closureKind,
                detail: (enc.detail as Record<string, string> | null) ?? null,
              }
            : null,
        summary: summary
          ? {
              state: summary.state as "shared" | "held",
              version: summary.version,
              decidedAt: summary.decidedAt.toISOString(),
            }
          : null,
      };
    },
    input.database,
  );
}
