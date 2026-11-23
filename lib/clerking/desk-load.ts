import "server-only";

import type { ClerkingDeskData } from "./desk-data";
import type { ResultFact } from "./exam/context";
import type { FlowRow } from "@/lib/emr/chart";
import type { EmrDb } from "@/lib/emr/db";
import type { ObservationFact } from "@/lib/facts/types";
import type { Acvpu } from "@/lib/triage/types";
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";

import {
  allergies,
  allergyStatusAssertions,
  medicationStatements,
  pregnancyEpisodes,
} from "@/db/schema/emr";
import { clinicalObservations } from "@/db/schema/nurse-workspace";
import { patientReportedHistory } from "@/db/schema/patient-self-tracking";
import { STAGE_RESULT_CONCEPTS } from "@/lib/clerking/impression/stage-inputs";
import { asClinicalReader } from "@/lib/emr/db";
import { loadAllergyInput } from "@/lib/emr/read/allergies";
import { conceptForToken } from "@/lib/emr/write/notes";
import { loadFactSnapshot } from "@/lib/facts/loader";
import { labHighRiskLiveFor } from "@/lib/lab/feature";
import { PACK_RESULT_CONCEPTS } from "@/lib/ncd/pack/from-clerking";
import { fromRow } from "@/lib/patient/reported-history";
import { RESULT_CONCEPTS } from "./exam/context";
import { EXAM_CATALOGUE, EXAM_SIGNOFF } from "./exam/load";
import { DX_CATALOGUE, DX_SIGNOFF } from "./impression/load";
import { CLERKING_CATALOGUE, CLERKING_LEGACY, CLERKING_SIGNOFF, CLERKING_TOKEN_MAP } from "./load";
import { readOutbreakMode } from "./outbreak";
import { INFORMANT_TO_ALLERGY_SOURCE, MANIFESTATION_TO_REACTION } from "./record-map";

/**
 * The v2 desk's record reads (desk-data.ts), for lib/emr/read/desk.ts. Vitals are the newest
 * reading of each NEWS2 input in the chart's flowsheet (the observation store, triage projected in);
 * allergies come from the one allergy record, across hospitals by decision (STOP 1, O-8).
 */

/** What signing charts (lib/emr/write/notes.ts uses the same map and resolver). */
const CHARTABLE = Object.entries(CLERKING_TOKEN_MAP)
  .filter(([, token]) => conceptForToken(token))
  .map(([symptom]) => symptom);

const AVPU: Record<string, Acvpu> = {
  alert: "A",
  new_confusion: "C", // CFC addendum (exam GATE A, HX3)
  voice: "V",
  pain: "P",
  unresponsive: "U",
};

/** The concepts an examination set writes (lib/clerking/exam/vitals.ts saveLines). */
const SET_CONCEPTS: Record<string, string> = {
  "obs.bp_systolic": "vs.bp",
  "obs.heart_rate": "vs.pulse",
  "obs.resp_rate": "vs.rr",
  "obs.spo2": "vs.spo2",
  "obs.temperature": "vs.temp",
  "obs.glucose": "vs.glucose",
  "obs.weight": "vs.weight",
  "obs.height": "vs.height",
  "obs.waist": "vs.waist",
};

const str = (v: unknown) => (typeof v === "string" ? v : null);

/** The newest set saved at this visit (its reading-set id), with the qualifiers the note writes. */
async function latestExamSet(
  db: EmrDb,
  i: { patientUserId: string; encounterId: string },
): Promise<ClerkingDeskData["exam"]["set"]> {
  const rows = await db
    .select({
      conceptId: clinicalObservations.conceptId,
      context: clinicalObservations.context,
      at: clinicalObservations.effectiveAt,
    })
    .from(clinicalObservations)
    .where(
      and(
        eq(clinicalObservations.patientUserId, i.patientUserId),
        eq(clinicalObservations.encounterId, i.encounterId),
        inArray(clinicalObservations.conceptId, [
          ...Object.keys(SET_CONCEPTS),
          "obs.bp_diastolic",
          "obs.avpu",
          "obs.gcs",
        ]),
        notInArray(clinicalObservations.status, ["entered_in_error", "cancelled"]),
      ),
    )
    .orderBy(desc(clinicalObservations.effectiveAt))
    .limit(40);
  const newest = rows.find((r) => str((r.context as Record<string, unknown>)?.readingSetId));
  if (!newest?.at) return null;
  const setId = (newest.context as Record<string, unknown>).readingSetId;
  const set = rows.filter((r) => (r.context as Record<string, unknown>)?.readingSetId === setId);
  const ctx = (id: string) =>
    (set.find((r) => r.conceptId === id)?.context ?? {}) as Record<string, unknown>;
  const bp = ctx("obs.bp_systolic");
  const spo2 = ctx("obs.spo2");
  const oxygen = str(spo2.oxygenSupport);
  return {
    at: newest.at.toISOString(),
    fields: [
      ...new Set(
        set.flatMap((r) =>
          r.conceptId && SET_CONCEPTS[r.conceptId] ? [SET_CONCEPTS[r.conceptId]!] : [],
        ),
      ),
    ],
    arm: str(bp.arm),
    position: str(bp.position),
    rhythm: str(ctx("obs.heart_rate").rhythm),
    site: str(ctx("obs.temperature").site),
    glucoseContext: str(ctx("obs.glucose").glucoseContext),
    oxygen: oxygen === "room_air" ? "air" : oxygen === "supplemental_oxygen" ? "oxygen" : null,
    oxygenModality: str(spo2.oxygenDevice),
    acvpu:
      (["A", "C", "V", "P", "U"] as const).find(
        (a) => a === (newest.context as Record<string, unknown>).acvpu,
      ) ?? null,
    // A confirmed implausible value is marked in the line's context (E8).
    confirmed: set
      .filter((r) => (r.context as Record<string, unknown>)?.plausibilityConfirmed && r.conceptId)
      .map((r) => r.conceptId!.replace("obs.", "")),
  };
}

type PregnancyRead = {
  pregnant: boolean | null;
  since: string | null;
  gestationWeeks: number | null;
  weeksPostpartum: number | null;
};

const WEEK_MS = 7 * 86_400_000;
/** Completed weeks from a date to now; null without the date. */
const weeksSince = (d: string | Date | null | undefined, now = Date.now()) =>
  d ? Math.floor((now - new Date(d).getTime()) / WEEK_MS) : null;

/** The newest pregnancy episode: its state, and the weeks the diabetes pack reads (gestation from
 *  the LNMP only, as the fact projector does: no obstetric constant, MR-39; weeks since the birth). */
async function pregnancyOf(db: EmrDb, patientUserId: string): Promise<PregnancyRead> {
  const [p] = await db
    .select({
      state: pregnancyEpisodes.pregnancyState,
      at: pregnancyEpisodes.effectiveAt,
      lnmp: pregnancyEpisodes.lnmp,
      deliveredAt: pregnancyEpisodes.deliveredAt,
    })
    .from(pregnancyEpisodes)
    .where(
      and(
        eq(pregnancyEpisodes.patientUserId, patientUserId),
        notInArray(pregnancyEpisodes.status, ["entered_in_error", "cancelled"]),
      ),
    )
    .orderBy(desc(pregnancyEpisodes.effectiveAt))
    .limit(1);
  const pregnant =
    p?.state === "pregnant"
      ? true
      : p?.state === "not_pregnant" || p?.state === "postpartum"
        ? false
        : null;
  return {
    pregnant,
    since: pregnant && p?.at ? new Date(p.at).toISOString() : null,
    gestationWeeks: pregnant ? weeksSince(p?.lnmp) : null,
    weeksPostpartum: weeksSince(p?.deliveredAt),
  };
}

/** A dipstick grade: negative 0, trace 0.5, plusN N. */
const stripGrade = (code: string) =>
  code === "negative" ? 0 : code === "trace" ? 0.5 : Number(/^plus(\d)$/.exec(code)?.[1] ?? NaN);

/** An observation fact as the `result` atom reads it; null when it has no number (a dipstick's
 *  grade counts as one, with its code). */
export function resultFact(f: ObservationFact): ResultFact | null {
  const v = f.value;
  if (!f.interpretable.ok || v.type === "boolean") return null;
  const grade = v.type === "coded" ? stripGrade(v.code) : 0;
  if (Number.isNaN(grade)) return null;
  const c = f.context;
  const ch = c.challenge;
  return {
    concept: f.concept,
    ...(v.type === "quantity"
      ? { value: v.canonical.value, ...(v.comparator ? { comparator: v.comparator } : {}) }
      : { value: grade, code: v.code }),
    at: "at" in f.effective ? f.effective.at : f.effective.start,
    trust: f.trust,
    ...(c.fastingState ? { fastingState: c.fastingState } : {}),
    ...(ch
      ? {
          challenge: {
            type: ch.type,
            minutes: "minutesPostLoad" in ch ? ch.minutesPostLoad : ch.minutesPostMeal,
          },
        }
      : {}),
    ...(c.specimen ? { specimen: c.specimen } : {}),
    ...(c.pointOfCare !== undefined ? { pointOfCare: c.pointOfCare } : {}),
    ...(c.certification ? { certification: c.certification } : {}),
  };
}

function newest(rows: readonly FlowRow[], conceptId: string) {
  const cell = rows.find((r) => r.conceptId === conceptId)?.cells.at(-1);
  return cell ?? null;
}
/** The reading before the newest, when it is from the same day as the newest (the rail's "was");
 *  older ones may be another visit's, so none is shown. */
const DAY_MS = 24 * 60 * 60 * 1000;
function before(rows: readonly FlowRow[], conceptId: string) {
  const cells = rows.find((r) => r.conceptId === conceptId)?.cells;
  const was = cells?.at(-2);
  const now = cells?.at(-1);
  return was && now && Date.parse(now.at) - Date.parse(was.at) <= DAY_MS ? was.value : undefined;
}
const numberOf = (v: string | undefined) => {
  const n = Number.parseFloat((v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/** Which of these current versions began (version 1) at this visit, recorded by this clinician. */
async function addedHere(
  db: EmrDb,
  t: typeof medicationStatements | typeof allergies,
  ids: string[],
  i: { scope: { userId: string }; encounterId: string },
): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const current = await db
    .select({ id: t.id, logicalId: t.logicalId })
    .from(t)
    .where(inArray(t.id, ids));
  const firsts = await db
    .select({ logicalId: t.logicalId })
    .from(t)
    .where(
      and(
        inArray(
          t.logicalId,
          current.map((c) => c.logicalId),
        ),
        eq(t.version, 1),
        eq(t.encounterId, i.encounterId),
        eq(t.recordedByUserId, i.scope.userId),
      ),
    );
  const here = new Set(firsts.map((f) => f.logicalId));
  return new Set(current.filter((c) => here.has(c.logicalId)).map((c) => c.id));
}

export async function clerkingData(i: {
  scope: { userId: string; hospitalId: string };
  database?: EmrDb;
  patientUserId: string;
  encounterId: string;
  encounterType?: string | null;
  sex: string | null;
  ageYears: number | null;
  rows: readonly FlowRow[];
  medicines: Omit<ClerkingDeskData["medicines"][number], "addedHere">[];
}): Promise<ClerkingDeskData> {
  const owner = i.database ?? ((await import("@/db")).db as unknown as EmrDb);

  const cells = {
    rr: newest(i.rows, "obs.resp_rate"),
    spo2: newest(i.rows, "obs.spo2"),
    sbp: newest(i.rows, "obs.bp_systolic"),
    hr: newest(i.rows, "obs.heart_rate"),
    temp: newest(i.rows, "obs.temperature"),
    avpu: newest(i.rows, "obs.avpu"),
  };
  const more = {
    dbp: newest(i.rows, "obs.bp_diastolic"),
    glucose: newest(i.rows, "obs.glucose"),
    weight: newest(i.rows, "obs.weight"),
    height: newest(i.rows, "obs.height"),
    waist: newest(i.rows, "obs.waist"),
  };
  const present = Object.values(cells).filter((c) => c !== null);
  const latest =
    present
      .map((c) => c!.at)
      .sort()
      .at(-1) ?? null;
  const avpuWord = cells.avpu?.value.split(" ")[0]?.toLowerCase().replace(/ /g, "_");
  const [examSet, pregnancy, facts] = await Promise.all([
    latestExamSet(owner, i).catch(() => null),
    pregnancyOf(owner, i.patientUserId).catch(
      (): PregnancyRead => ({
        pregnant: null,
        since: null,
        gestationWeeks: null,
        weeksPostpartum: null,
      }),
    ),
    // Read under RLS as the clinician; a failure leaves every result atom unknown, never false.
    asClinicalReader(
      i.scope,
      (tx) =>
        loadFactSnapshot(tx, i.patientUserId, {
          manifest: [...RESULT_CONCEPTS, ...PACK_RESULT_CONCEPTS, ...STAGE_RESULT_CONCEPTS],
          purpose: "interactive",
          perConceptCap: 20,
        }),
      i.database,
    )
      .then((s) => s.facts.flatMap((f) => (f.kind === "observation" ? (resultFact(f) ?? []) : [])))
      .catch(() => undefined),
  ]);

  const allergy = await loadAllergyInput(owner, i.patientUserId);
  const [touchedAllergy] = await owner
    .select({ id: allergies.id })
    .from(allergies)
    .where(
      and(eq(allergies.patientUserId, i.patientUserId), eq(allergies.encounterId, i.encounterId)),
    )
    .limit(1);
  const [touchedAssertion] = await owner
    .select({ id: allergyStatusAssertions.id })
    .from(allergyStatusAssertions)
    .where(
      and(
        eq(allergyStatusAssertions.patientUserId, i.patientUserId),
        eq(allergyStatusAssertions.encounterId, i.encounterId),
      ),
    )
    .limit(1);

  // What the patient reported on their phone (ADR 0414), read under RLS as the clinician (0189).
  // Before 0189 is applied, or on any failure, the desk simply shows none.
  const patientReported = await asClinicalReader(
    i.scope,
    (tx) =>
      tx
        .select()
        .from(patientReportedHistory)
        .where(
          and(
            eq(patientReportedHistory.patientUserId, i.patientUserId),
            eq(patientReportedHistory.state, "active"),
          ),
        )
        .orderBy(patientReportedHistory.createdAt),
    i.database,
  )
    .then((rows) =>
      rows.flatMap(
        (r) =>
          fromRow({
            id: r.id,
            kind: r.kind,
            item_id: r.itemId,
            other_text: r.otherText,
            onset_year: r.onsetYear,
            resolved: r.resolved,
            relation: r.relation,
            reactions: r.reactions,
            severity: r.severity,
            created_at: r.createdAt,
          }) ?? [],
      ),
    )
    .catch(() => undefined);

  const outbreakMode = await asClinicalReader(
    i.scope,
    (tx) => readOutbreakMode(tx, i.scope.hospitalId),
    i.database,
  ).catch(
    () => false, // before 0076 is applied the table is missing: outbreak mode is off
  );

  const status = allergy.status;
  const listed = status.kind === "listed" ? status.allergies : [];
  const [medsHere, allergiesHere] = await Promise.all([
    addedHere(
      owner,
      medicationStatements,
      i.medicines.map((m) => m.statementId),
      i,
    ),
    addedHere(
      owner,
      allergies,
      listed.map((l) => l.allergy.id),
      i,
    ),
  ]);
  return {
    catalogueUrl: `/api/clerking/catalogue?v=${CLERKING_SIGNOFF.catalogueSha256.slice(0, 16)}`,
    catalogueVersion: CLERKING_CATALOGUE.version,
    sex: i.sex === "female" || i.sex === "male" ? i.sex : null,
    ageYears: i.ageYears,
    encounterType: i.encounterType ?? null,
    ...(facts ? { facts } : {}),
    vitals: {
      respiratoryRate: numberOf(cells.rr?.value),
      spo2: numberOf(cells.spo2?.value),
      spo2Scale: "scale1",
      // Air or oxygen travels with SpO₂ in an examination set (HX2); a triage reading has none.
      oxygen: examSet && cells.spo2 && examSet.at === cells.spo2.at ? examSet.oxygen : null,
      systolicBp: numberOf(cells.sbp?.value),
      pulse: numberOf(cells.hr?.value),
      // The newest of the chart's AVPU and an examination set's ACVPU (C is only in a set, HX3).
      consciousness:
        examSet?.acvpu && (!cells.avpu || examSet.at >= cells.avpu.at)
          ? examSet.acvpu
          : avpuWord
            ? (AVPU[avpuWord] ?? null)
            : null,
      temperature: numberOf(cells.temp?.value),
    },
    vitalsAt: latest,
    vitalsPrev: {
      respiratoryRate: numberOf(before(i.rows, "obs.resp_rate")),
      spo2: numberOf(before(i.rows, "obs.spo2")),
      systolicBp: numberOf(before(i.rows, "obs.bp_systolic")),
      diastolicBp: numberOf(before(i.rows, "obs.bp_diastolic")),
      pulse: numberOf(before(i.rows, "obs.heart_rate")),
      temperature: numberOf(before(i.rows, "obs.temperature")),
    },
    vitalsFromTriage:
      present.length > 0 && present.every((c) => c!.id.startsWith("triage_records:")),
    medicines: i.medicines.map((m) => ({ ...m, addedHere: medsHere.has(m.statementId) })),
    allergies: {
      status: status.kind,
      touchedThisVisit: !!touchedAllergy || !!touchedAssertion,
      items:
        status.kind === "listed"
          ? listed.map((l) => ({
              id: l.allergy.id,
              name: l.allergy.substanceText ?? l.allergy.substanceCode ?? "Allergy",
              coded: l.coded,
              reactions: (l.allergy.manifestations ?? []).flatMap(
                (m) => MANIFESTATION_TO_REACTION[m] ?? [],
              ),
              severity: l.allergy.severity,
              source: l.allergy.informant
                ? (INFORMANT_TO_ALLERGY_SOURCE[l.allergy.informant] ?? null)
                : null,
              restricted: false,
              addedHere: allergiesHere.has(l.allergy.id),
            }))
          : [],
    },
    chartable: CHARTABLE,
    outbreakMode,
    labHighRisk: labHighRiskLiveFor(i.scope.hospitalId),
    canSeeRestricted: true, // the treating clinician, with an access basis (the desk's gate)
    ...(patientReported ? { patientReported } : {}),
    dx: {
      catalogueUrl: `/api/clerking/dx-catalogue?v=${DX_SIGNOFF.catalogueSha256.slice(0, 16)}`,
      catalogueVersion: DX_CATALOGUE.version,
      signoff: {
        profiles: DX_SIGNOFF.profiles,
        rules: DX_SIGNOFF.rules,
        referenceEntries: DX_SIGNOFF.referenceEntries,
        namedScales: DX_SIGNOFF.namedScales,
        withheld: DX_SIGNOFF.withheld,
      },
    },
    exam: {
      catalogueUrl: `/api/clerking/exam-catalogue?v=${EXAM_SIGNOFF.catalogueSha256.slice(0, 16)}`,
      catalogueVersion: EXAM_CATALOGUE.version,
      signoff: {
        flagRules: EXAM_SIGNOFF.flagRules,
        referenceEntries: EXAM_SIGNOFF.referenceEntries,
        classifiers: EXAM_SIGNOFF.classifiers,
        withheld: EXAM_SIGNOFF.withheld,
      },
      latest: {
        sbp: numberOf(cells.sbp?.value),
        dbp: numberOf(more.dbp?.value),
        pulse: numberOf(cells.hr?.value),
        rr: numberOf(cells.rr?.value),
        spo2: numberOf(cells.spo2?.value),
        temp: numberOf(cells.temp?.value),
        glucose: numberOf(more.glucose?.value),
        weight: numberOf(more.weight?.value),
        height: numberOf(more.height?.value),
        waist: numberOf(more.waist?.value),
        // The context is known only when the newest glucose is the set's own reading.
        glucoseContext:
          examSet?.fields.includes("vs.glucose") && more.glucose?.at === examSet.at
            ? examSet.glucoseContext
            : null,
      },
      set: examSet,
      pregnant: pregnancy.pregnant,
      pregnancySince: pregnancy.since,
      gestationWeeks: pregnancy.gestationWeeks,
      weeksPostpartum: pregnancy.weeksPostpartum,
    },
    conversionFlags: CLERKING_LEGACY.flags,
    signoff: {
      flagRules: CLERKING_SIGNOFF.flagRules,
      referenceEntries: CLERKING_SIGNOFF.referenceEntries,
      withheld: CLERKING_SIGNOFF.withheld,
    },
  };
}
