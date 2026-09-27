import "server-only";

import type { Provenance } from "@/components/emr/provenance";
import type { EmrAccessBasis } from "@/lib/emr/access";
import type { EmrActor, EmrSurface } from "@/lib/emr/actor";
import type {
  ChartNoteEventInput,
  ChartOrderInput,
  ChartPayload,
  ChartResultInput,
} from "@/lib/emr/chart";
import type { EmrDb } from "@/lib/emr/db";
import type { ReportInput } from "@/lib/emr/orders";
import { and, eq, getTableName, inArray } from "drizzle-orm";

import { provenanceFor } from "@/components/emr/provenance";
import {
  allergies,
  clinicalNoteEvents,
  clinicalNotes,
  conditions,
  diagnosticReports,
  medicationStatements,
  pregnancyEpisodes,
  procedures,
  resultAcknowledgements,
  testCatalogue,
} from "@/db/schema/emr";
import { encounterOrders } from "@/db/schema/encounter";
import { hospitals } from "@/db/schema/hospitals";
import { clinicalObservations } from "@/db/schema/nurse-workspace";
import { patientProfiles } from "@/db/schema/patient-profiles";
import { resusEpisodes } from "@/db/schema/resus";
import { encounters } from "@/db/schema/scheduling";
import { users } from "@/db/schema/users";
import { computeAgeYears } from "@/lib/age";
import { logChartAccess, resolveEmrAccess } from "@/lib/emr/access";
import { requireEmrActor } from "@/lib/emr/actor";
import { buildChartPayload } from "@/lib/emr/chart";
import { asClinicalReader, asClinicalWriter } from "@/lib/emr/db";
import { isOpen } from "@/lib/emr/encounter";
import { deriveOrderStatus, orderStatusText } from "@/lib/emr/orders";
import { ackState, currentVersion, detectCritical } from "@/lib/emr/results";
import { loadOrderRecords } from "@/lib/emr/write/orders";
import { decrypt } from "@/lib/encryption";
import { loadFactSnapshot } from "@/lib/facts/loader";
import { RULES } from "@/lib/facts/refinements";
import { deathsFor } from "@/lib/workspace/queries";
import { DEFAULT_TIME_ZONE } from "@/supabase/functions/_shared/slots";

/**
 * loadChart: the one read behind the chart, the print routes and anything else that shows a
 * patient's record under EMR v1 (PROMPT §5.2, HARMONISATION §5).
 *
 *  1. Owner transaction (asClinicalWriter): the one access rule (`patient_access_basis` is the
 *     owner's to execute), then identity — name and MRN decrypted as fetchPatientSummaryAudited
 *     does — the hospital's name, and any resus handover still waiting.
 *  2. Reader transaction (asClinicalReader, RLS decides): the fact snapshot with the chart
 *     manifest, encounters, orders with their derivation records, reports with acknowledgement and
 *     critical detection per current version, and signed notes with their events.
 *  3. Names for authors, the death record (lib/workspace deathsFor), buildChartPayload.
 *  4. logChartAccess, after everything succeeded (a failed read logs nothing).
 *
 * A fixed number of queries per render, whatever the record's size. Returns null when there is
 * no basis or no such patient; a decrypt failure throws (never a chart with a missing identity).
 */

/** Everything the chart reads: every concept except findings (note-born, read on the note) and
 *  facility context; plus the two pseudo-concepts. obs.uncatalogued is never loaded (A4). */
export const CHART_MANIFEST: readonly string[] = [...RULES.entries()]
  .filter(([id, r]) => id !== "obs.uncatalogued" && r.kind !== "finding" && r.kind !== "context")
  .map(([id]) => id);
/** ponytail: a per-concept cap keeps a decade of vitals off the flowsheet; page it if asked. */
const PER_CONCEPT_CAP = 100;

export interface ChartOrderRow {
  id: string;
  encounterId: string;
  display: string;
  kind: string;
  priority: string | null;
  requisitionNo: string | null;
  fastingRequired: boolean | null;
  testId: string | null;
  requesterName: string | null;
  requesterCadre: string | null;
  orderedAt: string;
  statusText: string;
  open: boolean;
  restricted: boolean;
}
export interface ChartEncounterRow {
  id: string;
  startedAt: string;
  encounterType: string;
  state: string;
  open: boolean;
  disposition: string | null;
  followUp: unknown;
  dispositionDetail: unknown;
  clinicianName: string | null;
}
export interface ChartLoad {
  patientUserId: string;
  basis: EmrAccessBasis;
  hospitalName: string;
  timeZone: string;
  payload: ChartPayload;
  provenance: Record<string, Provenance>;
  /** The newest open encounter here (the clerking desk to link), if any. */
  openEncounterId: string | null;
  /** Concluded resus episodes whose handover has not reached the record. */
  handoffEpisodeIds: string[];
  encounters: ChartEncounterRow[];
  orders: ChartOrderRow[];
}

export async function loadChart(
  surface: EmrSurface,
  patientUserId: string,
  opts: { logSurface?: string } = {},
): Promise<ChartLoad | null> {
  const actor = await requireEmrActor(surface);
  return loadChartFor(actor, patientUserId, {
    logSurface: opts.logSurface ?? `emr_chart_${surface}`,
  });
}

export async function loadChartFor(
  actor: EmrActor,
  patientUserId: string,
  opts: { logSurface: string; database?: EmrDb; now?: Date },
): Promise<ChartLoad | null> {
  if (!actor.isClinical) return null;
  const scope = { userId: actor.userId, hospitalId: actor.hospitalId };
  const now = opts.now ?? new Date();

  // 1. Access, identity, handovers (owner).
  const head = await asClinicalWriter(
    scope,
    async (tx) => {
      const access = await resolveEmrAccess(tx, { ...scope, patientUserId });
      if (!access.allowed) return null;
      const [profile] = await tx
        .select({
          mrn: patientProfiles.patientCode,
          first: patientProfiles.firstNameEncrypted,
          surname: patientProfiles.surnameEncrypted,
          sex: patientProfiles.sex,
          dob: patientProfiles.dateOfBirth,
        })
        .from(patientProfiles)
        .where(eq(patientProfiles.id, patientUserId))
        .limit(1);
      if (!profile) return null;
      const [hospital] = await tx
        .select({ name: hospitals.name })
        .from(hospitals)
        .where(eq(hospitals.id, actor.hospitalId))
        .limit(1);
      const episodes = await tx
        .select({ id: resusEpisodes.id })
        .from(resusEpisodes)
        .where(
          and(
            eq(resusEpisodes.patientUserId, patientUserId),
            eq(resusEpisodes.hospitalId, actor.hospitalId),
            eq(resusEpisodes.pendingEncounterHandoff, true),
            eq(resusEpisodes.state, "concluded"),
          ),
        );
      return { basis: access.basis, profile, hospitalName: hospital?.name ?? "", episodes };
    },
    opts.database,
  );
  if (!head) return null;
  const name = `${decrypt(head.profile.first)} ${decrypt(head.profile.surname)}`.trim();

  // 2. The record, as the clinician.
  const rec = await asClinicalReader(
    scope,
    async (tx) => {
      const snapshot = await loadFactSnapshot(tx, patientUserId, {
        manifest: CHART_MANIFEST,
        asOf: now,
        purpose: "interactive",
        perConceptCap: PER_CONCEPT_CAP,
        // Voided items stay on the chart, struck through with their reason (Law 4).
        keepEnteredInError: true,
      });
      // Their reasons: an observation's is its note; the versioned tables carry reason columns.
      const voided = (table: string) =>
        snapshot.facts
          .filter((f) => f.status === "entered_in_error" && f.provenance.table === table)
          .map((f) => f.provenance.rowId);
      const obsVoided = voided("clinical_observations");
      const eieRows = [
        ...(obsVoided.length
          ? (
              await tx
                .select({ id: clinicalObservations.id, text: clinicalObservations.noteCiphertext })
                .from(clinicalObservations)
                .where(inArray(clinicalObservations.id, obsVoided))
            ).map((r) => ({ ...r, code: null }))
          : []),
        ...(
          await Promise.all(
            [conditions, medicationStatements, allergies, procedures, pregnancyEpisodes].map(
              (t) => {
                const ids = voided(getTableName(t));
                return ids.length
                  ? tx
                      .select({ id: t.id, code: t.reasonCode, text: t.reasonCiphertext })
                      .from(t)
                      .where(inArray(t.id, ids))
                  : [];
              },
            ),
          )
        ).flat(),
      ];
      const encounterRows = await tx
        .select({
          id: encounters.id,
          hospitalId: encounters.hospitalId,
          encounterType: encounters.encounterType,
          state: encounters.state,
          closureKind: encounters.closureKind,
          startedAt: encounters.startedAt,
          endedAt: encounters.endedAt,
          disposition: encounters.disposition,
          closureReason: encounters.closureReason,
          followUp: encounters.followUp,
          dispositionDetail: encounters.dispositionDetail,
          clinicianUserId: encounters.clinicianUserId,
        })
        .from(encounters)
        .where(eq(encounters.patientUserId, patientUserId));
      const orderRows = await tx
        .select({
          id: encounterOrders.id,
          encounterId: encounterOrders.encounterId,
          lifecycle: encounterOrders.lifecycle,
          status: encounterOrders.status,
          kind: encounterOrders.kind,
          text: encounterOrders.text,
          priority: encounterOrders.priority,
          requisitionNo: encounterOrders.requisitionNo,
          fastingRequired: encounterOrders.fastingRequired,
          testId: encounterOrders.testId,
          authoredByUserId: encounterOrders.authoredByUserId,
          requesterCadre: encounterOrders.requesterCadre,
          createdAt: encounterOrders.createdAt,
          sensitivity: encounterOrders.sensitivity,
        })
        .from(encounterOrders)
        .where(eq(encounterOrders.patientUserId, patientUserId));
      const orderRecords = await loadOrderRecords(
        tx,
        orderRows.map((o) => o.id),
      );
      // Reports: every version (orderless transcribed ones too), their acks and current values.
      const reports = await tx
        .select({
          id: diagnosticReports.id,
          logicalId: diagnosticReports.logicalId,
          version: diagnosticReports.version,
          status: diagnosticReports.status,
          recordedAt: diagnosticReports.recordedAt,
          issuedAt: diagnosticReports.issuedAt,
          orderId: diagnosticReports.orderId,
          testId: diagnosticReports.testId,
          critical: diagnosticReports.critical,
          sensitivity: diagnosticReports.sensitivity,
        })
        .from(diagnosticReports)
        .where(eq(diagnosticReports.patientUserId, patientUserId));
      const reportIds = reports.map((r) => r.id);
      const [acks, values] = reportIds.length
        ? await Promise.all([
            tx
              .select()
              .from(resultAcknowledgements)
              .where(inArray(resultAcknowledgements.reportId, reportIds)),
            tx
              .select({
                reportId: clinicalObservations.reportId,
                conceptId: clinicalObservations.conceptId,
                valueNum: clinicalObservations.valueNum,
                valueComparator: clinicalObservations.valueComparator,
                valueUnit: clinicalObservations.valueUnit,
                valueCanonical: clinicalObservations.valueCanonical,
                context: clinicalObservations.context,
              })
              .from(clinicalObservations)
              .where(inArray(clinicalObservations.reportId, reportIds)),
          ])
        : [[], []];
      const testIds = [
        ...new Set(reports.flatMap((r) => (r.testId && !r.orderId ? [r.testId] : []))),
      ];
      const tests = testIds.length
        ? await tx
            .select({ id: testCatalogue.id, display: testCatalogue.display })
            .from(testCatalogue)
            .where(inArray(testCatalogue.id, testIds))
        : [];
      const notes = await tx
        .select({
          id: clinicalNotes.id,
          noteType: clinicalNotes.noteType,
          templateId: clinicalNotes.templateId,
          state: clinicalNotes.state,
          authorUserId: clinicalNotes.authorUserId,
          authorCadre: clinicalNotes.authorCadre,
          addendumTo: clinicalNotes.addendumTo,
          signedAt: clinicalNotes.signedAt,
          recordedAt: clinicalNotes.recordedAt,
          effectiveAt: clinicalNotes.effectiveAt,
          lateEntry: clinicalNotes.lateEntry,
          sensitivity: clinicalNotes.sensitivity,
        })
        .from(clinicalNotes)
        .where(
          and(eq(clinicalNotes.patientUserId, patientUserId), eq(clinicalNotes.state, "signed")),
        );
      const noteEvents = notes.length
        ? await tx
            .select()
            .from(clinicalNoteEvents)
            .where(
              inArray(
                clinicalNoteEvents.noteId,
                notes.map((n) => n.id),
              ),
            )
        : [];
      return {
        snapshot,
        encounterRows,
        orderRows,
        orderRecords,
        reports,
        acks,
        values,
        tests,
        notes,
        noteEvents,
        eieRows,
      };
    },
    opts.database,
  );

  // 3. Names, death, the payload.
  const nameIds = new Set<string>();
  for (const f of rec.snapshot.facts) if (f.provenance.authorId) nameIds.add(f.provenance.authorId);
  for (const a of rec.snapshot.allergyAssertions ?? []) nameIds.add(a.assertedBy);
  for (const n of rec.notes) nameIds.add(n.authorUserId);
  for (const o of rec.orderRows) if (o.authoredByUserId) nameIds.add(o.authoredByUserId);
  for (const e of rec.encounterRows) nameIds.add(e.clinicianUserId);
  const conn = opts.database ?? ((await import("@/db")).db as unknown as EmrDb);
  const [nameRows, deaths] = await Promise.all([
    nameIds.size
      ? conn
          .select({ id: users.id, name: users.fullName })
          .from(users)
          .where(inArray(users.id, [...nameIds]))
      : [],
    deathsFor(actor.hospitalId, [patientUserId]),
  ]);
  const names: Record<string, string> = {};
  for (const r of nameRows) if (r.name) names[r.id] = r.name;

  const orders: ChartOrderInput[] = [];
  const orderOut: ChartOrderRow[] = [];
  for (const o of rec.orderRows) {
    const derivation = deriveOrderStatus(o, rec.orderRecords);
    orders.push({
      derivation,
      kind: o.kind,
      display: o.text,
      priority: o.priority,
      orderedAt: o.createdAt,
      sensitivity: o.sensitivity,
    });
    orderOut.push({
      id: o.id,
      encounterId: o.encounterId,
      display: o.text,
      kind: o.kind,
      priority: o.priority,
      requisitionNo: o.requisitionNo,
      fastingRequired: o.fastingRequired,
      testId: o.testId,
      requesterName: o.authoredByUserId ? (names[o.authoredByUserId] ?? null) : null,
      requesterCadre: o.requesterCadre,
      orderedAt: o.createdAt.toISOString(),
      statusText: orderStatusText(derivation.status, o.kind),
      open: derivation.open,
      restricted: o.sensitivity === "restricted",
    });
  }

  const orderText = new Map(rec.orderRows.map((o) => [o.id, o.text]));
  const testText = new Map(rec.tests.map((t) => [t.id, t.display]));
  const chains = new Map<string, (typeof rec.reports)[number][]>();
  for (const r of rec.reports) chains.set(r.logicalId, [...(chains.get(r.logicalId) ?? []), r]);
  const results: ChartResultInput[] = [];
  for (const chain of chains.values()) {
    const cur = currentVersion(chain)!;
    const values = rec.values.filter((v) => v.reportId === cur.id);
    results.push({
      reportId: cur.id,
      display:
        (cur.orderId && orderText.get(cur.orderId)) ||
        (cur.testId && testText.get(cur.testId)) ||
        "Transcribed result",
      issuedAt: cur.issuedAt,
      ack: ackState(chain as ReportInput[], rec.acks),
      critical: cur.critical || values.some((v) => detectCritical(v).isCritical),
      sensitivity: cur.sensitivity,
    });
  }

  const noteEvents: ChartNoteEventInput[] = rec.noteEvents.map((e) => ({
    id: e.id,
    noteId: e.noteId,
    kind: e.kind,
    actorUserId: e.actorUserId,
    cosignRequestId: e.cosignRequestId,
    recordedAt: e.recordedAt,
    reasonCode: e.reasonCode,
    reasonText: e.reasonCiphertext ? decrypt(e.reasonCiphertext) : null,
  }));

  const death = deaths.sort((a, b) => b.atMs - a.atMs)[0] ?? null;
  const payload = buildChartPayload({
    patient: {
      name,
      mrn: head.profile.mrn,
      ageYears: computeAgeYears(head.profile.dob, now),
      sex: head.profile.sex,
    },
    snapshot: rec.snapshot,
    encounters: rec.encounterRows,
    orders,
    results,
    notes: rec.notes,
    noteEvents,
    eieReasons: Object.fromEntries(
      rec.eieRows.map((r) => [r.id, { code: r.code, text: r.text ? decrypt(r.text) : null }]),
    ),
    death,
    names,
    timeZone: DEFAULT_TIME_ZONE,
  });

  const openHere = rec.encounterRows
    .filter((e) => e.hospitalId === actor.hospitalId && isOpen(e))
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];

  // 4. Audit the read, now that it succeeded.
  await asClinicalWriter(
    scope,
    (tx) =>
      logChartAccess(tx, {
        ...scope,
        patientUserId,
        basis: head.basis,
        surface: opts.logSurface,
      }),
    opts.database,
  );

  return {
    patientUserId,
    basis: head.basis,
    hospitalName: head.hospitalName,
    timeZone: DEFAULT_TIME_ZONE,
    payload,
    provenance: provenanceFor(rec.snapshot, names, DEFAULT_TIME_ZONE),
    openEncounterId: openHere?.id ?? null,
    handoffEpisodeIds: head.episodes.map((e) => e.id),
    encounters: rec.encounterRows
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .map((e) => ({
        id: e.id,
        startedAt: e.startedAt.toISOString(),
        encounterType: e.encounterType,
        state: e.state,
        open: isOpen(e),
        disposition: e.disposition,
        followUp: e.followUp,
        dispositionDetail: e.dispositionDetail,
        clinicianName: names[e.clinicianUserId] ?? null,
      })),
    orders: orderOut,
  };
}
