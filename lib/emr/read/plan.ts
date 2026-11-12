import "server-only";

import type { MedicineAnswer } from "@/components/emr/desk/model";
import type { PlanPayload } from "@/lib/clerking/plan/payload";
import type { AdmissionMedicine, PlacedRx } from "@/lib/clerking/plan/record";
import type { EmrActor } from "@/lib/emr/actor";
import type { ChartFrequency, ChartKind } from "@/lib/emr/charts/rules";
import type { EmrDb } from "@/lib/emr/db";
import type { OrderFrequency, OrderPriority } from "@/lib/emr/orders";
import type { PlanRx, RxEdit } from "@/lib/prescribing/plan-rx";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { medicationStatements, specimens } from "@/db/schema/emr";
import { encounterOrders } from "@/db/schema/encounter";
import { monitoringCharts } from "@/db/schema/monitoring";
import { TEST_UUIDS } from "@/lib/clerking/impression/load";
import { countsWords } from "@/lib/emr/closure";
import { asClinicalReader, asClinicalWriter } from "@/lib/emr/db";
import { emrPrescribingLive, prescribeV2LiveFor } from "@/lib/emr/feature";
import { admittingWards } from "@/lib/emr/read/close";
import { loadMonitoring } from "@/lib/emr/read/monitoring";
import { loadPlanFacts } from "@/lib/emr/write/plan";
import { encounterPrescriptions, prescribeRequirement } from "@/lib/emr/write/prescriptions";
import { loadRepeatsPayload } from "@/lib/emr/write/repeats";
import { decrypt } from "@/lib/encryption";
import { labOneMenuLiveFor } from "@/lib/lab/feature";
import { menuToday } from "@/lib/lab/one-menu-read";
import { interactionContextFor } from "@/lib/pharmacy/clinical/read";
import {
  pharmacyDispensingLiveFor,
  pharmacyInteractionsLiveFor,
  pharmacyStockAnswerLiveFor,
} from "@/lib/pharmacy/feature";
import { loadPrescriberPharmacy } from "@/lib/pharmacy/review/prescriber-read";
import { drugById } from "@/lib/prescribing/formulary";
import { willRead } from "@/lib/prescribing/plan-rx";

/**
 * The Plan's payload for the desk (ADR 0184): what step 10 reads back from the record. Loaded only
 * where CLERKING_PLAN_V2 is on (the desk loader asks). Registries and the owner's reads in one
 * writer transaction, the clinical record under RLS.
 */

const TEST_KEY_BY_UUID = new Map(Object.entries(TEST_UUIDS).map(([k, v]) => [v, k]));
const BLOOD_CULTURE = TEST_UUIDS["test.blood_culture"];
const KIDNEY = new Set(
  ["test.urea_electrolytes", "test.creatinine"].flatMap((k) =>
    TEST_UUIDS[k] ? [TEST_UUIDS[k]] : [],
  ),
);

const safeDecrypt = (c: string | null | undefined) => {
  if (!c) return null;
  try {
    return decrypt(c);
  } catch {
    return null;
  }
};

type RxRow = Awaited<ReturnType<typeof encounterPrescriptions>>[number];

/** A stored prescription read back as the draft that wrote it, for its note words. */
function asPlanRx(r: RxRow): PlanRx {
  const fluid =
    r.kind === "fluid" && r.volumeMl && r.overMinutes && r.fluidPurpose
      ? {
          purpose: r.fluidPurpose as "bolus" | "maintenance" | "replacement",
          volumeMl: Number(r.volumeMl),
          overMinutes: r.overMinutes,
          delivery: r.givingSetDropsPerMl ? ("gravity" as const) : ("pump" as const),
          dropsPerMl: (r.givingSetDropsPerMl as 20 | 60 | null) ?? null,
          warmed: !!r.warmed,
        }
      : null;
  const [num, unit] = r.dose.split(" ");
  return {
    clientKey: r.clientKey ?? r.id,
    kind: r.kind === "fluid" ? "fluid" : "drug",
    drugId: r.drugId,
    conditionId: r.conditionId,
    regimenId: r.regimenId,
    doseNum: Number(num) || null,
    unit: (unit ?? "mg") as PlanRx["unit"],
    strength: r.concentration,
    route: r.route as PlanRx["route"],
    method: r.method,
    infusionOver: r.infusionOver as PlanRx["infusionOver"],
    diluent: r.diluent as PlanRx["diluent"],
    frequency: (r.frequency ?? "stat") as PlanRx["frequency"],
    prn: r.prn,
    course: r.duration as PlanRx["course"],
    start: (r.start ?? "now") as PlanRx["start"],
    note: null,
    fluid,
    answers: [],
    witness: null,
    weightAt: null,
    typedDose: null,
  };
}

function placedRx(r: RxRow): PlacedRx {
  const drug = drugById(r.drugId);
  const reason = safeDecrypt(r.confirmReasonCiphertext);
  return {
    id: r.id,
    drugId: r.drugId,
    drugName: r.drugName,
    // A prescription from the EMR sheet (emergency formulary) keeps its own words.
    display: drug ? willRead(asPlanRx(r), drug) : `${r.drugName} ${r.dose} ${r.route}`,
    conditionId: r.conditionId,
    kind: r.kind === "fluid" ? "fluid" : "drug",
    state: r.state,
    awaitingCosign: r.awaitingCosign,
    cosignWithheld: r.cosignWithheld,
    answered: (reason ?? "")
      .split("; ")
      .filter((l) => l.startsWith("Override ") || l.startsWith("Check ")),
    edits: (r.edits as RxEdit[] | null) ?? [],
    at: r.createdAt.toISOString(),
  };
}

export async function loadPlanPayload(
  actor: EmrActor,
  input: {
    patientUserId: string;
    encounterId: string;
    /** The desk's orders of this visit: their status words. */
    orders: readonly { id: string; statusText: string; open: boolean }[];
    medicines: readonly { id: string; display: string; answer: MedicineAnswer }[];
    database?: EmrDb;
    now: Date;
  },
): Promise<PlanPayload> {
  const scope = { userId: actor.userId, hospitalId: actor.hospitalId };
  const owner = await asClinicalWriter(
    scope,
    async (tx) => {
      const facts = await loadPlanFacts(tx, input.patientUserId, input.now);
      const rx = await encounterPrescriptions(tx, {
        hospitalId: actor.hospitalId,
        patientUserId: input.patientUserId,
        encounterId: input.encounterId,
      });
      const wards = await admittingWards(tx, actor.hospitalId);
      // Pharmacy Phase 3 (5.3): the signed pairs and this patient's current medicines, behind the flag.
      const interactions = pharmacyInteractionsLiveFor(actor.hospitalId)
        ? await interactionContextFor(tx, actor.hospitalId, input.patientUserId, input.now)
        : null;
      // Lab Phase 2 (labOneMenu, §5.1): the Plan basket reads the same availability as the order sheet.
      const today = labOneMenuLiveFor(actor.hospitalId)
        ? await menuToday(tx, actor.hospitalId, input.now)
        : null;
      const labToday = today
        ? Object.fromEntries(
            Object.keys(TEST_UUIDS).map((code) => {
              const d = today(code);
              return [
                code,
                { words: d.words, orderable: d.orderable, linked: d.state !== "not_linked" },
              ];
            }),
          )
        : undefined;
      const ctx = { tx, actor, now: input.now } as Parameters<typeof prescribeRequirement>[0];
      const cosign = {
        routine: await prescribeRequirement(ctx, false),
        controlled: await prescribeRequirement(ctx, true),
      };
      const reasons = input.medicines.length
        ? await tx
            .select({
              id: medicationStatements.id,
              reasonCode: medicationStatements.reasonCode,
              reasonCiphertext: medicationStatements.reasonCiphertext,
            })
            .from(medicationStatements)
            .where(
              inArray(
                medicationStatements.id,
                input.medicines.map((m) => m.id),
              ),
            )
        : [];
      // Pharmacy Phase 4 (5.2): the Repeats step, behind PHARMACY_REPEATS.
      const repeats = await loadRepeatsPayload(
        tx,
        actor.hospitalId,
        rx.map((r) => r.id),
        input.now,
      );
      return {
        facts,
        rx,
        repeats,
        wards: wards.map((w) => ({ id: w.id, name: w.name, counts: countsWords(w.counts) })),
        interactions,
        cosign,
        reasons,
        labToday,
      };
    },
    input.database,
  );

  const reader = await asClinicalReader(
    scope,
    async (tx) => {
      const orders = await tx
        .select({
          id: encounterOrders.id,
          text: encounterOrders.text,
          testId: encounterOrders.testId,
          priority: encounterOrders.priority,
          frequency: encounterOrders.frequency,
          reasonConditionIds: encounterOrders.reasonConditionIds,
          effectiveAt: encounterOrders.effectiveAt,
        })
        .from(encounterOrders)
        .where(
          and(
            eq(encounterOrders.encounterId, input.encounterId),
            eq(encounterOrders.lifecycle, "events"),
          ),
        );
      const cultureOrders = orders.filter((o) => o.testId && o.testId === BLOOD_CULTURE);
      const taken = cultureOrders.length
        ? await tx
            .select({ id: specimens.id })
            .from(specimens)
            .where(
              inArray(
                specimens.orderId,
                cultureOrders.map((o) => o.id),
              ),
            )
            .limit(1)
        : [];
      const charts = await tx
        .select()
        .from(monitoringCharts)
        .where(
          and(
            eq(monitoringCharts.encounterId, input.encounterId),
            isNull(monitoringCharts.closedAt),
          ),
        );
      const monitoring = await loadMonitoring(tx, {
        hospitalId: actor.hospitalId,
        patientUserId: input.patientUserId,
        encounterId: input.encounterId,
        now: input.now,
      });
      return { orders, cultureOrders, taken, charts, monitoring };
    },
    input.database,
  );

  // Pharmacy Phase 1 (5.4): only behind the flag, and only on the doctor's surface (Section 8). A
  // failed read leaves the plan as it was (Law 10): the queries show at the next render.
  const pharmacy =
    actor.surface === "doctor" && pharmacyDispensingLiveFor(actor.hospitalId)
      ? await loadPrescriberPharmacy(actor, {
          patientUserId: input.patientUserId,
          encounterId: input.encounterId,
          now: input.now,
          database: input.database,
        }).catch((e: unknown) => {
          console.warn("pharmacy.prescriber_read_failed", e instanceof Error ? e.name : "error");
          return null;
        })
      : null;

  const status = new Map(input.orders.map((o) => [o.id, o]));
  const reasonOf = new Map(
    owner.reasons.map((r) => [r.id, safeDecrypt(r.reasonCiphertext) ?? r.reasonCode ?? undefined]),
  );
  const medicines: AdmissionMedicine[] = input.medicines.map((m) => ({
    id: m.id,
    display: m.display,
    answer: m.answer,
    ...(m.answer === "held" || m.answer === "stopped" ? { reason: reasonOf.get(m.id) } : {}),
  }));

  return {
    prescribing: emrPrescribingLive(actor.hospitalId),
    labToday: owner.labToday,
    record: {
      orders: reader.orders.map((o) => ({
        id: o.id,
        display: o.text,
        testKey: (o.testId && TEST_KEY_BY_UUID.get(o.testId)) || null,
        testId: o.testId,
        priority: o.priority as OrderPriority | null,
        frequency: o.frequency as OrderFrequency | null,
        reasonConditionIds: o.reasonConditionIds,
        at: (o.effectiveAt ?? input.now).toISOString(),
        statusText: status.get(o.id)?.statusText ?? "",
        open: status.get(o.id)?.open ?? true,
      })),
      prescriptions: owner.rx.map(placedRx),
      medicines,
      charts: reader.charts.map((c) => ({
        id: c.id,
        kind: c.kind as ChartKind,
        frequency: c.frequency as ChartFrequency | null,
        measureUrine: c.measureUrine,
        openedByLabel: (c.openedBy as { label?: string }).label ?? "",
      })),
    },
    wards: owner.wards,
    intern: actor.cadreCode === "INTERN_DOCTOR",
    facts: {
      ageYears: owner.facts.ageYears,
      weight: owner.facts.weight,
      creatinine: owner.facts.creatinine,
      glucose: owner.facts.glucose,
      conditions: owner.facts.conditions,
      sex: owner.facts.sex,
      pregnancy: owner.facts.pregnancy,
    },
    prescribeV2: prescribeV2LiveFor(actor.hospitalId),
    cosign: owner.cosign,
    bloodCulture: reader.cultureOrders.length
      ? reader.taken.length
        ? "collected"
        : "ordered"
      : "none",
    kidneyTestOrdered: reader.orders.some((o) => o.testId && KIDNEY.has(o.testId)),
    monitoring: reader.monitoring,
    ...(pharmacy ? { pharmacy } : {}),
    ...(owner.interactions ? { interactions: owner.interactions } : {}),
    ...(owner.repeats
      ? {
          repeats: {
            ...owner.repeats,
            ...(actor.surface === "doctor" || actor.surface === "clinician"
              ? { who: { surface: actor.surface, patientUserId: input.patientUserId } }
              : {}),
          },
        }
      : {}),
    ...((actor.surface === "doctor" || actor.surface === "clinician") &&
    pharmacyStockAnswerLiveFor(actor.hospitalId)
      ? {
          stockAnswer: {
            surface: actor.surface,
            patientUserId: input.patientUserId,
            encounterId: input.encounterId,
          },
        }
      : {}),
  };
}
