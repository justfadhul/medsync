import "server-only";

import type {
  Availability,
  EncounterOrderRow,
  MenuTest,
  PatientIdentity,
  ReasonOption,
} from "@/components/emr/orders/model";
import type { LabelData } from "@/components/emr/orders/specimen-label";
import type { ResultEntryData } from "@/components/emr/results/model";
import type { EmrAccessBasis } from "@/lib/emr/access";
import type { EmrActor } from "@/lib/emr/actor";
import type { EmrDb } from "@/lib/emr/db";
import type { FactConcept } from "@/lib/facts/types";
import { and, eq, inArray, isNull, or } from "drizzle-orm";

import { formatters } from "@/components/emr/format";
import {
  ageSexWords,
  containerWords,
  labelTestWords,
  PRIORITY_WORD,
} from "@/components/emr/orders/model";
import {
  conditions,
  diagnosisTerms,
  facilityCapabilities,
  specimens,
  testCatalogue,
} from "@/db/schema/emr";
import { encounterOrders } from "@/db/schema/encounter";
import { patientProfiles } from "@/db/schema/patient-profiles";
import { encounters } from "@/db/schema/scheduling";
import { users } from "@/db/schema/users";
import { computeAgeYears } from "@/lib/age";
import { logChartAccess, resolveEmrAccess } from "@/lib/emr/access";
import { asClinicalReader, asClinicalWriter } from "@/lib/emr/db";
import {
  deriveOrderStatus,
  needsFastingChip,
  orderStatusText,
  REJECTION_REASON_TEXT,
} from "@/lib/emr/orders";
import { loadOrderRecords } from "@/lib/emr/write/orders";
import { decrypt } from "@/lib/encryption";
import { conceptDef, sensitivityFor } from "@/lib/facts/project/shared";
import { DEFAULT_TIME_ZONE } from "@/supabase/functions/_shared/slots";
import { entryComponents } from "./results";

/**
 * The reads behind order entry and bedside collection on the clerking desk (PROMPT §5.8; gate-a
 * E.7, E.8), and the specimen label.
 *
 *  1. Owner transaction: the encounter is here and open to this clinician (the one access rule),
 *     and the patient's identity, decrypted as the chart does.
 *  2. Reader transaction (RLS decides): the facility's test menu with its availability, this
 *     visit's diagnoses (the reasons on offer), and this visit's orders with everything their
 *     derived status reads.
 *  3. The access is logged once the read has succeeded.
 */

export interface EncounterOrdersLoad {
  encounterId: string;
  patientUserId: string;
  identity: PatientIdentity;
  timeZone: string;
  menu: MenuTest[];
  reasons: ReasonOption[];
  orders: EncounterOrderRow[];
  /** Transcription screens for the orders that can take a paper or imaging report now. */
  transcribe: Record<string, ResultEntryData>;
  collectorName: string | null;
}

async function identityHead(
  actor: EmrActor,
  encounterId: string,
  database?: EmrDb,
): Promise<{
  patientUserId: string;
  identity: PatientIdentity;
  dob: string | null;
  basis: EmrAccessBasis;
} | null> {
  const scope = { userId: actor.userId, hospitalId: actor.hospitalId };
  return asClinicalWriter(
    scope,
    async (tx) => {
      const [e] = await tx
        .select({ patientUserId: encounters.patientUserId })
        .from(encounters)
        .where(and(eq(encounters.id, encounterId), eq(encounters.hospitalId, actor.hospitalId)))
        .limit(1);
      if (!e) return null;
      const access = await resolveEmrAccess(tx, { ...scope, patientUserId: e.patientUserId });
      if (!access.allowed) return null;
      const [p] = await tx
        .select({
          mrn: patientProfiles.patientCode,
          first: patientProfiles.firstNameEncrypted,
          surname: patientProfiles.surnameEncrypted,
          sex: patientProfiles.sex,
          dob: patientProfiles.dateOfBirth,
        })
        .from(patientProfiles)
        .where(eq(patientProfiles.id, e.patientUserId))
        .limit(1);
      if (!p) return null;
      return {
        patientUserId: e.patientUserId,
        basis: access.basis,
        dob: p.dob ? String(p.dob) : null,
        identity: {
          name: `${decrypt(p.first)} ${decrypt(p.surname)}`.trim(),
          mrn: p.mrn,
          ageSex: ageSexWords(computeAgeYears(p.dob ? String(p.dob) : null), p.sex),
        },
      };
    },
    database,
  );
}

async function logRead(
  actor: EmrActor,
  patientUserId: string,
  basis: EmrAccessBasis,
  surface: string,
  database?: EmrDb,
) {
  await asClinicalWriter(
    { userId: actor.userId, hospitalId: actor.hospitalId },
    (tx) =>
      logChartAccess(tx, {
        hospitalId: actor.hospitalId,
        userId: actor.userId,
        patientUserId,
        basis,
        surface,
      }),
    database,
  );
}

const AVAILABILITY: readonly string[] = ["available", "intermittent", "unavailable"];

type TestRow = typeof testCatalogue.$inferSelect;

/** The facility's test menu from its catalogue rows and capability statuses. */
function buildTestMenu(tests: TestRow[], capRows: { id: string; status: string }[]): MenuTest[] {
  // A test menu entry keeps the "local" row when a hospital overrides a default by code.
  const byCode = new Map<string, TestRow>();
  for (const t of tests) if (!byCode.has(t.code) || t.hospitalId !== null) byCode.set(t.code, t);
  const caps = new Map(capRows.map((c) => [c.id, c.status]));
  return [...byCode.values()].map((t) => ({
    id: t.id,
    code: t.code,
    display: t.display,
    kind: t.kind,
    components: t.components.map((c) => conceptDef(c)?.display ?? c),
    specimenType: t.specimenType,
    container: t.container,
    fastingRequired: t.fastingRequired,
    ionising: t.ionising,
    inHouse: t.inHouse,
    favouriteRank: t.favouriteRank,
    availability: (t.capabilityId && AVAILABILITY.includes(caps.get(t.capabilityId) ?? "")
      ? caps.get(t.capabilityId)
      : "unknown") as Availability,
    restricted: t.components.some((c) => sensitivityFor(c as FactConcept, null) === "restricted"),
  }));
}

/**
 * The test menu as the order sheet reads it (defaults, a local row winning by code, with
 * availability). Also the resus close-out's "Outstanding tests" (PROMPT §5.12).
 */
export async function loadTestMenu(
  tx: Pick<EmrDb, "select">,
  hospitalId: string,
): Promise<MenuTest[]> {
  const tests = await tx
    .select()
    .from(testCatalogue)
    .where(
      and(
        eq(testCatalogue.active, true),
        or(isNull(testCatalogue.hospitalId), eq(testCatalogue.hospitalId, hospitalId)),
      ),
    );
  const caps = await tx
    .select({ id: facilityCapabilities.capabilityId, status: facilityCapabilities.status })
    .from(facilityCapabilities)
    .where(eq(facilityCapabilities.hospitalId, hospitalId));
  return buildTestMenu(tests, caps);
}

export async function loadEncounterOrders(
  actor: EmrActor,
  encounterId: string,
  opts: { database?: EmrDb } = {},
): Promise<EncounterOrdersLoad | null> {
  const head = await identityHead(actor, encounterId, opts.database);
  if (!head) return null;
  const { patientUserId } = head;
  const scope = { userId: actor.userId, hospitalId: actor.hospitalId };

  const rec = await asClinicalReader(
    scope,
    async (tx) => {
      const tests = await tx
        .select()
        .from(testCatalogue)
        .where(
          and(
            eq(testCatalogue.active, true),
            or(isNull(testCatalogue.hospitalId), eq(testCatalogue.hospitalId, actor.hospitalId)),
          ),
        );
      const caps = await tx
        .select({ id: facilityCapabilities.capabilityId, status: facilityCapabilities.status })
        .from(facilityCapabilities)
        .where(eq(facilityCapabilities.hospitalId, actor.hospitalId));
      const dx = await tx
        .select({
          id: conditions.id,
          supersedesId: conditions.supersedesId,
          status: conditions.status,
          verification: conditions.verification,
          rank: conditions.rank,
          sensitivity: conditions.sensitivity,
          textCiphertext: conditions.textCiphertext,
          term: diagnosisTerms.display,
        })
        .from(conditions)
        .leftJoin(diagnosisTerms, eq(diagnosisTerms.id, conditions.termId))
        .where(
          and(
            eq(conditions.encounterId, encounterId),
            eq(conditions.patientUserId, patientUserId),
            eq(conditions.category, "encounter_diagnosis"),
          ),
        );
      const orderRows = await tx
        .select()
        .from(encounterOrders)
        .where(
          and(
            eq(encounterOrders.encounterId, encounterId),
            eq(encounterOrders.lifecycle, "events"),
          ),
        );
      const records = await loadOrderRecords(
        tx,
        orderRows.map((o) => o.id),
      );
      return { tests, caps, dx, orderRows, records };
    },
    opts.database,
  );

  const menu = buildTestMenu(rec.tests, rec.caps);

  // Current versions only: not superseded, not withdrawn, not refuted.
  const superseded = new Set(rec.dx.map((d) => d.supersedesId).filter(Boolean));
  const reasons: ReasonOption[] = rec.dx
    .filter(
      (d) =>
        !superseded.has(d.id) && d.status !== "entered_in_error" && d.verification !== "refuted",
    )
    .map((d) => ({
      id: d.id,
      display: d.term ?? (d.textCiphertext ? decrypt(d.textCiphertext) : "Diagnosis"),
      primary: d.rank === "primary",
      restricted: d.sensitivity === "restricted",
    }))
    .sort((a, b) => Number(b.primary) - Number(a.primary));

  const testById = new Map(rec.tests.map((t) => [t.id, t]));
  const requesterIds = [
    ...new Set(rec.orderRows.map((o) => o.authoredByUserId).filter((x): x is string => !!x)),
  ];
  const conn = opts.database ?? ((await import("@/db")).db as unknown as EmrDb);
  const nameRows = requesterIds.length
    ? await conn
        .select({ id: users.id, name: users.fullName })
        .from(users)
        .where(inArray(users.id, requesterIds))
    : [];
  const names = new Map(nameRows.map((r) => [r.id, r.name]));

  const orders: EncounterOrderRow[] = [];
  const transcribe: Record<string, ResultEntryData> = {};
  for (const o of rec.orderRows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
    const { status } = deriveOrderStatus(o, rec.records);
    const test = o.testId ? (testById.get(o.testId) ?? null) : null;
    const rejection =
      status.state === "active" && status.rejection
        ? `Rejected: ${REJECTION_REASON_TEXT[status.rejection.reasonCode] ?? status.rejection.reasonCode} — recollect`
        : null;
    const newestSpecimen =
      (rec.records.specimens ?? [])
        .filter((s) => s.orderId === o.id)
        .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())[0]?.id ?? null;
    const canTranscribe =
      ["lab", "imaging", "ecg"].includes(o.kind) &&
      ["active", "collected", "in_progress"].includes(status.state);
    orders.push({
      id: o.id,
      display: o.text,
      kind: o.kind,
      priority: o.priority,
      orderedAtIso: o.createdAt.toISOString(),
      requesterName: o.authoredByUserId ? (names.get(o.authoredByUserId) ?? null) : null,
      statusText: orderStatusText(status, o.kind),
      caution: !!rejection || (status.state === "resulted" && status.review !== "legacy"),
      restricted: o.sensitivity === "restricted",
      collect:
        o.kind === "lab" && status.state === "active"
          ? {
              orderId: o.id,
              display: o.text,
              priority: o.priority,
              specimenType: test?.specimenType ?? null,
              container: test?.container ?? null,
              needsFasting: needsFastingChip(o, test),
              rejection,
            }
          : null,
      specimenId: newestSpecimen,
      canTranscribe,
    });
    if (canTranscribe)
      transcribe[o.id] = {
        orderId: o.id,
        patientUserId,
        identity: head.identity,
        test: o.text,
        kind: o.kind,
        requisitionNo: o.requisitionNo,
        priority: o.priority,
        mode: "transcribed",
        components: entryComponents(test),
        report: null,
        communicate: null,
      };
  }

  await logRead(actor, patientUserId, head.basis, `emr_orders_${actor.surface}`, opts.database);
  return {
    encounterId,
    patientUserId,
    identity: head.identity,
    timeZone: DEFAULT_TIME_ZONE,
    menu,
    reasons,
    orders,
    transcribe,
    collectorName: actor.fullName,
  };
}

/** The label for one specimen of this encounter (two identifiers, test, container, time). A
 *  restricted test's name is printed only when `include` holds the specimen id. */
export async function loadSpecimenLabel(
  actor: EmrActor,
  encounterId: string,
  specimenId: string,
  opts: { database?: EmrDb; include?: ReadonlySet<string> } = {},
): Promise<{ data: LabelData; restricted: { id: string; label: string } | null } | null> {
  const head = await identityHead(actor, encounterId, opts.database);
  if (!head) return null;
  const row = await asClinicalReader(
    { userId: actor.userId, hospitalId: actor.hospitalId },
    async (tx) => {
      const [r] = await tx
        .select({
          container: specimens.container,
          collectedAt: specimens.collectedAt,
          labelNo: specimens.labelNo,
          test: encounterOrders.text,
          sensitivity: encounterOrders.sensitivity,
          requisitionNo: encounterOrders.requisitionNo,
          priority: encounterOrders.priority,
        })
        .from(specimens)
        .innerJoin(encounterOrders, eq(encounterOrders.id, specimens.orderId))
        .where(
          and(
            eq(specimens.id, specimenId),
            eq(specimens.patientUserId, head.patientUserId),
            eq(encounterOrders.encounterId, encounterId),
          ),
        )
        .limit(1);
      return r ?? null;
    },
    opts.database,
  );
  if (!row) return null;
  await logRead(actor, head.patientUserId, head.basis, "emr_specimen_label", opts.database);
  const f = formatters(DEFAULT_TIME_ZONE);
  const restricted = row.sensitivity === "restricted";
  return {
    data: {
      identity: head.identity,
      dob: head.dob ? f.date(`${head.dob}T12:00:00Z`) : null,
      test: labelTestWords(row.test, restricted, !!opts.include?.has(specimenId)),
      container: containerWords(row.container),
      collectedAt: f.dateTime(row.collectedAt.toISOString()),
      requisitionNo: row.requisitionNo,
      priority: row.priority ? (PRIORITY_WORD[row.priority] ?? row.priority) : null,
      labelNo: row.labelNo,
    },
    restricted: restricted ? { id: specimenId, label: row.test } : null,
  };
}
