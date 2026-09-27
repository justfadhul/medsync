import "server-only";

import { randomUUID } from "node:crypto";
import type { WriteCtx } from "./context";
import type { WriteResult } from "./orders";
import type { AllergyRow } from "@/lib/emr/allergy";
import type { IdsrClass } from "@/lib/emr/hmis";
import type { IdsrClasses } from "@/lib/emr/reference/idsr";
import type { DateOfBirth } from "@/lib/facts/project/shared";
import type { FactConcept } from "@/lib/facts/types";
import type { RefEntry } from "@/lib/resus/reference/ref";
import { and, eq, gte, inArray, lte, notInArray, sql } from "drizzle-orm";

import {
  allergies,
  allergyStatusAssertions,
  conditions,
  devices,
  diagnosisTerms,
  medicationStatements,
  pregnancyEpisodes,
  procedures,
} from "@/db/schema/emr";
import { encounterEvents } from "@/db/schema/encounter";
import { clinicalObservations } from "@/db/schema/nurse-workspace";
import { patientProfiles } from "@/db/schema/patient-profiles";
import { encounters } from "@/db/schema/scheduling";
import { currentAllergies, isActiveAllergy, NAME_ONLY_LABEL } from "@/lib/emr/allergy";
import { idsrClass } from "@/lib/emr/hmis";
import { REF_IDSR_CLASSES } from "@/lib/emr/reference/idsr";
import { checkPlausibility } from "@/lib/emr/reference/plausibility";
import { clerkshipWriteAuthority } from "@/lib/encounter/access";
import { encrypt } from "@/lib/encryption";
import {
  DIAGNOSIS_TERMS_RESTRICTED_FOR_MINORS,
  DRUG_CLASS_TAGS,
} from "@/lib/facts/catalogue.generated";
import {
  conceptDef,
  hasMinorRule,
  possiblyMinorAt,
  sensitivityFor,
} from "@/lib/facts/project/shared";
import { EMERGENCY_DRUGS } from "@/lib/prescribing/reference/emergency-drug-catalog";
import { mismatchPrompt, parseComparator, toCanonical } from "@/lib/units";
import { EmrWriteError, stampActivity } from "./context";
import {
  LAB_CADRES,
  NURSE_CADRES,
  openEncounter,
  ORDERING_CADRES,
  replayed,
  requireCadre,
} from "./orders";

/**
 * Chart actions that commit at once as fact rows (PROMPT §8, D-EMR-01): observations, allergies
 * and their assertions, problems and encounter diagnoses, medicines, pregnancy, procedures, and the
 * generic entered-in-error. Every row is insert-only: a change is the next version of the same
 * logical item, keeping its concept or term (STOP 3), with its sensitivity set here at insert and
 * never lowered. Free text is ciphertext. Warnings are returned, never thrown.
 */

const invalid = (m: string) => new EmrWriteError("invalid", m);

/* ─── Who may record what (gate-a-proposal §D) ───────────────────── */
// Senior = MO and above (lib/doctor/scope.ts; mirrored: that module imports the database client).
export const SENIOR_CADRES: readonly string[] = [
  "MEDICAL_OFFICER",
  "MEDICAL_OFFICER_SG",
  "CONSULTANT",
  "SENIOR_CONSULTANT",
];
/** Observations, medicines, pregnancy, procedures: the clerkers and nursing. */
const RECORDING_CADRES: readonly string[] = [...ORDERING_CADRES, ...NURSE_CADRES];

function authority(ctx: WriteCtx) {
  return clerkshipWriteAuthority(ctx.actor.cadreCode, ctx.actor.isClinical);
}

/** Allergy / NKDA: any clinical cadre except the laboratory (matrix). */
function requireAllergyCadre(ctx: WriteCtx): void {
  if (LAB_CADRES.includes(ctx.actor.cadreCode) || !authority(ctx).canRecordAllergies)
    throw new EmrWriteError("forbidden", "Your cadre may not record allergies.");
}

/** Entered in error: the author, or a senior at the hospital (supervisor of others). */
export function requireAuthorOrSupervisor(ctx: WriteCtx, authorUserId: string | null): void {
  if (authorUserId === ctx.actor.userId || SENIOR_CADRES.includes(ctx.actor.cadreCode)) return;
  throw new EmrWriteError(
    "forbidden",
    "Only the author or a supervising senior may mark this entered in error.",
  );
}

/* ─── Shared ─────────────────────────────────────────────────────── */

const TRUST = { clinician: 3, poc_staff: 3, patient_reported: 1 } as const;
type EntrySource = keyof typeof TRUST;

async function linkEncounter(
  ctx: WriteCtx,
  patientUserId: string,
  encounterId: string | null | undefined,
): Promise<string | null> {
  if (!encounterId) return null;
  return (await openEncounter(ctx, patientUserId, encounterId)).id;
}

async function dateOfBirth(ctx: WriteCtx, patientUserId: string): Promise<DateOfBirth | undefined> {
  const [p] = await ctx.tx
    .select({ dob: patientProfiles.dateOfBirth })
    .from(patientProfiles)
    .where(eq(patientProfiles.id, patientUserId));
  return p ? { value: p.dob, precision: "day" } : undefined;
}

const reasonCols = (code?: string | null, text?: string | null) => ({
  reasonCode: code?.trim() || null,
  reasonCiphertext: text?.trim() ? encrypt(text.trim()) : null,
});

function requireReason(
  code: string | null | undefined,
  text: string | null | undefined,
  act: string,
) {
  if (!code?.trim() && !text?.trim()) throw invalid(`A reason is required to ${act}.`);
}

/* ─── Versioned tables (the fact envelope) ───────────────────────── */

const VERSIONED = {
  condition: conditions,
  medication: medicationStatements,
  pregnancy: pregnancyEpisodes,
  procedure: procedures,
  allergy: allergies,
} as const;
type VersionedKind = keyof typeof VERSIONED;
type VersionedTable = (typeof VERSIONED)[VersionedKind];
type RowOf<K extends VersionedKind> = (typeof VERSIONED)[K]["$inferSelect"];
type InsertOf<K extends VersionedKind> = (typeof VERSIONED)[K]["$inferInsert"];

// The five tables share the envelope columns by name (db/schema/emr.ts factEnvelope), so the query
// is built on one of them; the rows read and written are the real table's.
const asEnvelope = (t: VersionedTable) => t as typeof conditions;

/** The row `id` if it is this patient's CURRENT version (nothing supersedes it). */
async function currentVersion<K extends VersionedKind>(
  ctx: WriteCtx,
  kind: K,
  id: string,
  patientUserId: string,
  opts: { anyHospital?: boolean } = {},
): Promise<RowOf<K>> {
  const t = asEnvelope(VERSIONED[kind]);
  const [row] = await ctx.tx.select().from(t).where(eq(t.id, id));
  if (
    !row ||
    row.patientUserId !== patientUserId ||
    (!opts.anyHospital && row.hospitalId !== ctx.actor.hospitalId)
  )
    throw new EmrWriteError("not_found", "Record item not found for this patient here.");
  const [next] = await ctx.tx
    .select({ id: t.id })
    .from(t)
    .where(eq(t.supersedesId, row.id))
    .limit(1);
  if (next) throw new EmrWriteError("conflict", "A newer version exists: reload and try again.");
  if (row.status === "entered_in_error" || row.status === "cancelled")
    throw new EmrWriteError("conflict", "This item was entered in error.");
  return row as unknown as RowOf<K>;
}

/** The next version of a logical item: same logical id and concept, this author, this clock. */
async function insertNextVersion<K extends VersionedKind>(
  ctx: WriteCtx,
  kind: K,
  prev: RowOf<K>,
  patch: Partial<InsertOf<K>>,
  clientKey: string | null,
): Promise<string> {
  const { id: _id, recordedAt: _at, clientKey: _key, ...rest } = prev;
  const id = randomUUID();
  const row = {
    ...rest,
    ...patch,
    id,
    version: prev.version + 1,
    supersedesId: prev.id,
    hospitalId: ctx.actor.hospitalId,
    recordedByUserId: ctx.actor.userId,
    authorCadre: ctx.actor.cadreCode,
    recordedAt: ctx.now,
    clientKey,
    // Restriction only ever rises (C9).
    sensitivity:
      prev.sensitivity === "restricted" ? "restricted" : (patch.sensitivity ?? prev.sensitivity),
  };
  await ctx.tx.insert(asEnvelope(VERSIONED[kind])).values(row as typeof conditions.$inferInsert);
  return id;
}

/* ─── Observations ───────────────────────────────────────────────── */

export type ObservationValue =
  | { type: "quantity"; value: number | string; unit?: string }
  | { type: "coded"; code: string }
  | { type: "boolean"; value: boolean }
  | { type: "presence"; presence: "present" | "absent" | "unknown" };

/** One observation or finding. A superset of lib/ncd/cfc-map.ts CfcObservation. */
export interface ObservationInput {
  conceptId: string;
  effectiveAt?: Date | string;
  value: ObservationValue;
  /** The CFC §6 unit-mismatch question was answered "yes, this unit". */
  unitConfirmed?: boolean;
  /** A soft plausibility bound was confirmed (none is signed yet). */
  plausibilityConfirmed?: boolean;
  /** ObservationContext keys, and for findings elicitedBy / onset / durationDays / severity / laterality. */
  context?: Record<string, unknown>;
  specimen?: string;
  calibration?: string;
  fastingState?: string;
  method?: string;
  pointOfCare?: boolean;
  deviceId?: string;
  note?: string;
  restricted?: boolean;
}

export interface RecordObservationsInput {
  patientUserId: string;
  encounterId?: string | null;
  /** The batch key: line i is written with `${clientKey}#${i}`, so a replay adds nothing. */
  clientKey: string;
  source?: EntrySource;
  observations: ObservationInput[];
}

/** Engineering heuristic, not a clinical number: two equal readings this close are one reading
 *  recorded twice (CFC §6 "within minutes"). Owner may tune it (O-9 list). */
export const DUPLICATE_WINDOW_MS = 10 * 60_000;

type NewObservation = typeof clinicalObservations.$inferInsert;

function categoryOf(conceptId: string, group: string): NonNullable<NewObservation["category"]> {
  const prefix = conceptId.slice(0, conceptId.indexOf("."));
  const byPrefix: Record<string, NonNullable<NewObservation["category"]>> = {
    sx: "symptom",
    sign: "sign",
    exam: "exam",
    hist: "history",
    soc: "social",
    evt: "event",
    derived: "derived",
  };
  if (byPrefix[prefix]) return byPrefix[prefix];
  if (group === "vitals") return "vital_sign";
  if (group === "anthropometry") return "anthropometric";
  return "laboratory";
}

const DEVICE_SPECIMEN: Record<string, string> = {
  glucometer: "capillary_whole_blood",
  ketone_meter: "capillary_whole_blood",
};

type ValueCols = Pick<
  NewObservation,
  | "valueType"
  | "valueNum"
  | "valueComparator"
  | "valueUnit"
  | "valueCanonical"
  | "valueCode"
  | "valueBool"
  | "presence"
>;

function valueCols(o: ObservationInput): ValueCols {
  const def = conceptDef(o.conceptId)!;
  const v = o.value;
  switch (def.valueType) {
    case "quantity": {
      if (v.type !== "quantity") throw invalid(`${def.display}: enter a number.`);
      const parsed =
        typeof v.value === "number"
          ? { comparator: null, value: v.value }
          : parseComparator(v.value);
      if ("error" in parsed || !Number.isFinite(parsed.value))
        throw invalid(`${def.display}: enter a number (a comparator such as < is allowed).`);
      const unit = v.unit?.trim() || def.canonicalUnit;
      if (!unit) throw invalid(`${def.display}: a unit is required.`);
      let canonical = parsed.value;
      if (unit !== def.canonicalUnit) {
        const c = toCanonical(o.conceptId, parsed.value, unit);
        if ("error" in c) throw invalid(`${def.display}: ${c.error}.`);
        canonical = c.value;
      }
      // The client asked already; the server asks again and refuses an unconfirmed mismatch.
      const ask = mismatchPrompt(o.conceptId, parsed.value, unit);
      if (ask && !o.unitConfirmed)
        throw invalid(`${def.display}: ${ask.ask} Confirm the unit to save.`);
      const plaus = checkPlausibility(o.conceptId, canonical);
      if (plaus.kind === "reject") throw invalid(`${def.display}: the value is not possible.`);
      if (plaus.kind === "confirm" && !o.plausibilityConfirmed)
        throw invalid(`${def.display}: the value is unusual. Confirm it to save.`);
      return {
        valueType: "quantity",
        valueNum: String(parsed.value),
        valueComparator: parsed.comparator,
        valueUnit: unit,
        valueCanonical: String(canonical),
      };
    }
    case "coded":
    case "ordinal": {
      const code = v.type === "coded" ? v.code.trim() : "";
      if (!code || (def.answers && !def.answers.includes(code)))
        throw invalid(`${def.display}: choose one of ${def.answers?.join(", ") ?? "the answers"}.`);
      return { valueType: def.valueType, valueCode: code };
    }
    case "boolean":
      if (v.type !== "boolean") throw invalid(`${def.display}: answer yes or no.`);
      return { valueType: "boolean", valueBool: v.value };
    case "presence":
      if (v.type !== "presence") throw invalid(`${def.display}: present, absent or unknown.`);
      return { valueType: "presence", presence: v.presence };
    default:
      throw invalid(`${def.display} is not recorded as an observation.`);
  }
}

const sameValue = (
  a: ValueCols,
  b: Pick<ValueCols, "valueCanonical" | "valueCode" | "valueBool" | "presence">,
): boolean =>
  a.valueCanonical != null
    ? b.valueCanonical != null &&
      Math.abs(Number(a.valueCanonical) - Number(b.valueCanonical)) < 1e-9
    : a.valueCode != null
      ? a.valueCode === b.valueCode
      : a.valueBool != null
        ? a.valueBool === b.valueBool
        : a.presence === b.presence;

/**
 * Write a batch of observation / finding rows. Shared by recordObservations and signing (note-born
 * findings, NCD capture). `keyOf(i)` names each line's idempotency key.
 */
export async function insertObservations(
  ctx: WriteCtx,
  input: {
    patientUserId: string;
    encounterId: string | null;
    source: EntrySource;
    lines: ObservationInput[];
    keyOf: (i: number) => string;
  },
): Promise<{ ids: string[]; warnings: string[] }> {
  const { tx, actor, now } = ctx;
  const ids: string[] = [];
  const warnings: string[] = [];
  const needsDob = input.lines.some((l) => hasMinorRule(l.conceptId as FactConcept));
  const dob = needsDob ? await dateOfBirth(ctx, input.patientUserId) : undefined;

  for (const [i, line] of input.lines.entries()) {
    const clientKey = input.keyOf(i);
    const replay = await replayed(tx, clinicalObservations, clientKey, input.patientUserId);
    if (replay) {
      ids.push(replay);
      continue;
    }
    const def = conceptDef(line.conceptId);
    if (
      !def ||
      (def.kind !== "observation" && def.kind !== "finding") ||
      line.conceptId.startsWith("derived.") ||
      def.valueType === "as_typed"
    )
      throw invalid(`${line.conceptId} is not an observation that can be recorded here.`);
    const cols = valueCols(line);
    const effectiveAt = line.effectiveAt ? new Date(line.effectiveAt) : now;
    if (Number.isNaN(effectiveAt.getTime())) throw invalid("The time of the reading is not valid.");

    let specimen = line.specimen ?? null;
    let calibration = line.calibration ?? null;
    let pointOfCare = line.pointOfCare ?? null;
    if (line.deviceId) {
      // CFC §6: a registered device supplies specimen and calibration; staff pick only the fasting chip.
      const [d] = await tx
        .select()
        .from(devices)
        .where(
          and(
            eq(devices.id, line.deviceId),
            eq(devices.hospitalId, actor.hospitalId),
            eq(devices.active, true),
          ),
        );
      if (!d) throw invalid("That device is not registered at this hospital.");
      specimen ??= DEVICE_SPECIMEN[d.kind] ?? null;
      calibration ??= d.calibration;
      pointOfCare ??= true;
    }

    // CFC §6 duplicate detection: flagged for merging, never silently counted twice.
    const near = await tx
      .select({
        id: clinicalObservations.id,
        valueCanonical: clinicalObservations.valueCanonical,
        valueCode: clinicalObservations.valueCode,
        valueBool: clinicalObservations.valueBool,
        presence: clinicalObservations.presence,
      })
      .from(clinicalObservations)
      .where(
        and(
          eq(clinicalObservations.patientUserId, input.patientUserId),
          eq(clinicalObservations.conceptId, line.conceptId),
          notInArray(clinicalObservations.status, ["entered_in_error", "cancelled"]),
          gte(
            clinicalObservations.effectiveAt,
            new Date(effectiveAt.getTime() - DUPLICATE_WINDOW_MS),
          ),
          lte(
            clinicalObservations.effectiveAt,
            new Date(effectiveAt.getTime() + DUPLICATE_WINDOW_MS),
          ),
        ),
      );
    const dup = near.find((r) => sameValue(cols, r));
    const context: Record<string, unknown> = { ...(line.context ?? {}) };
    if (dup) {
      context.duplicateOf = dup.id;
      warnings.push(
        `${def.display}: the same value is already recorded at that time; flagged as a possible duplicate.`,
      );
    }
    if (def.valueType === "presence" && !context.elicitedBy) context.elicitedBy = "history";

    const id = randomUUID();
    await tx.insert(clinicalObservations).values({
      ...cols,
      id,
      hospitalId: actor.hospitalId,
      patientUserId: input.patientUserId,
      encounterId: input.encounterId,
      recordedByUserId: actor.userId,
      observationKind: "fact",
      state: "fact",
      conceptId: line.conceptId,
      logicalId: id,
      version: 1,
      category: categoryOf(line.conceptId, def.group),
      specimen,
      calibration,
      fastingState: line.fastingState ?? null,
      method: line.method?.trim() || null,
      pointOfCare,
      deviceId: line.deviceId ?? null,
      context,
      source: input.source,
      trust: TRUST[input.source],
      status: "final",
      sensitivity: sensitivityFor(
        line.conceptId as FactConcept,
        line.restricted ? "restricted" : null,
        dob ? { dob, effectiveAt } : undefined,
      ),
      effectiveAt,
      recordedAt: now,
      authorCadre: actor.cadreCode,
      noteCiphertext: line.note?.trim() ? encrypt(line.note.trim()) : null,
      clientKey,
    });
    ids.push(id);
  }
  return { ids, warnings };
}

export async function recordObservations(
  ctx: WriteCtx,
  input: RecordObservationsInput,
): Promise<WriteResult & { ids: string[] }> {
  requireCadre(ctx, RECORDING_CADRES, "record observations");
  if (input.observations.length === 0) throw invalid("Nothing to record.");
  const encounterId = await linkEncounter(ctx, input.patientUserId, input.encounterId);
  const source =
    input.source ?? (NURSE_CADRES.includes(ctx.actor.cadreCode) ? "poc_staff" : "clinician");
  const r = await insertObservations(ctx, {
    patientUserId: input.patientUserId,
    encounterId,
    source,
    lines: input.observations,
    keyOf: (i) => `${input.clientKey}#${i}`,
  });
  await stampActivity(ctx, encounterId);
  return { id: r.ids[0]!, ids: r.ids, warnings: r.warnings };
}

/* ─── Allergies ──────────────────────────────────────────────────── */

const FORMULARY_KEYS = new Set<string>(EMERGENCY_DRUGS.map((d) => d.drugKey));
const FORMULARY_CLASSES = new Set<string>(EMERGENCY_DRUGS.map((d) => d.drugClass));

type AllergyInsert = typeof allergies.$inferInsert;

export interface RecordAllergyInput {
  patientUserId: string;
  encounterId?: string | null;
  clientKey: string;
  /** Revise this current version (same logical allergy, same substance). */
  supersedesId?: string;
  substance?: {
    kind?: "drug_ingredient" | "drug_class" | "food" | "environmental" | "other";
    /** A formulary drugKey (drug_ingredient) or drugClass (drug_class): one vocabulary [H]. */
    code?: string;
    text?: string;
  };
  category?: AllergyInsert["category"];
  allergyType?: AllergyInsert["allergyType"];
  criticality?: AllergyInsert["criticality"];
  manifestations?: string[];
  severity?: AllergyInsert["severity"];
  clinicalStatus?: "active" | "inactive" | "resolved";
  verification?: "unconfirmed" | "confirmed" | "refuted";
  onset?: Record<string, unknown>;
  informant?: "patient" | "relative" | "record" | "clinician_observed";
  effectiveAt?: Date;
  reasonCode?: string;
  reasonText?: string;
  /** Provenance of a write-through from a resus AMPLE capture: the timeline note and the substance's
   *  index in it. It is the key the 0071 backfill uses, so a re-run never copies it twice. */
  legacyRef?: { table: "resus_timeline_events"; id: string; index: string };
}

/**
 * One allergy, or the next version of one. A coded substance is the prescribing formulary's own key
 * or class (lib/emr/allergy.ts); anything else is stored as encrypted text, which prescribing still
 * matches by name [H]. An active allergy outranks a "no known drug allergies" assertion by itself
 * (lib/emr/allergy.ts resolveAllergyStatus): nothing is updated.
 */
export async function recordAllergy(
  ctx: WriteCtx,
  input: RecordAllergyInput,
): Promise<WriteResult> {
  requireAllergyCadre(ctx);
  const replay = await replayed(ctx.tx, allergies, input.clientKey, input.patientUserId);
  if (replay) return { id: replay };
  const encounterId = await linkEncounter(ctx, input.patientUserId, input.encounterId);
  if (input.verification === "refuted")
    requireReason(input.reasonCode, input.reasonText, "refute an allergy");
  const warnings: string[] = [];
  const clinical = {
    ...(input.category !== undefined ? { category: input.category } : {}),
    ...(input.allergyType !== undefined ? { allergyType: input.allergyType } : {}),
    ...(input.criticality !== undefined ? { criticality: input.criticality } : {}),
    ...(input.manifestations !== undefined ? { manifestations: input.manifestations } : {}),
    ...(input.severity !== undefined ? { severity: input.severity } : {}),
    ...(input.clinicalStatus !== undefined ? { clinicalStatus: input.clinicalStatus } : {}),
    ...(input.verification !== undefined ? { verification: input.verification } : {}),
    ...(input.onset !== undefined ? { onset: input.onset } : {}),
    ...(input.informant !== undefined ? { informant: input.informant } : {}),
    ...(input.effectiveAt ? { effectiveAt: input.effectiveAt } : {}),
    ...reasonCols(input.reasonCode, input.reasonText),
  } satisfies Partial<AllergyInsert>;

  let id: string;
  if (input.supersedesId) {
    // Allergies cross hospitals (STOP 1): a clinician here may revise one recorded elsewhere.
    const prev = await currentVersion(ctx, "allergy", input.supersedesId, input.patientUserId, {
      anyHospital: true,
    });
    if (input.substance?.code && input.substance.code !== prev.substanceCode)
      throw invalid("A different substance is a new allergy, not a change to this one.");
    id = await insertNextVersion(
      ctx,
      "allergy",
      prev,
      // legacy_ref stays: a backfilled row's substance text lives in its source.
      { ...clinical, encounterId: encounterId ?? prev.encounterId },
      input.clientKey,
    );
  } else {
    const s = input.substance;
    const text = s?.text?.trim() || null;
    const coded =
      !!s?.code &&
      ((s.kind === "drug_ingredient" && FORMULARY_KEYS.has(s.code)) ||
        (s.kind === "drug_class" && FORMULARY_CLASSES.has(s.code)));
    // A code the formulary does not know is kept as text, never dropped.
    const substanceText = text ?? (!coded && s?.code ? s.code.trim() : null);
    if (!coded && !substanceText) throw invalid("Name the substance.");
    if (!coded) warnings.push(NAME_ONLY_LABEL);
    id = randomUUID();
    await ctx.tx.insert(allergies).values({
      id,
      logicalId: id,
      hospitalId: ctx.actor.hospitalId,
      patientUserId: input.patientUserId,
      encounterId,
      effectiveAt: input.effectiveAt ?? ctx.now,
      recordedAt: ctx.now,
      recordedByUserId: ctx.actor.userId,
      authorCadre: ctx.actor.cadreCode,
      source: "clinician",
      trust: 3,
      status: "final",
      sensitivity: "standard",
      substanceKind: coded ? s!.kind! : null,
      substanceCode: coded ? s!.code! : null,
      substanceTextCiphertext: substanceText ? encrypt(substanceText) : null,
      informant: "patient",
      legacyRef: input.legacyRef ?? null,
      clientKey: input.clientKey,
      ...clinical,
    });
  }
  await stampActivity(ctx, encounterId);
  return { id, warnings };
}

export interface AssertAllergyStatusInput {
  patientUserId: string;
  encounterId?: string | null;
  clientKey: string;
  assertion: "no_known_drug_allergies" | "unable_to_assess";
  assertedAt?: Date;
  /** A resus AMPLE NKDA: the capture it came from (the 0071 backfill's key, so no double copy). */
  legacyRef?: { table: "resus_timeline_events"; id: string };
}

/** NKDA or unable to assess: a statement by a named person at a time. An active allergy on the
 *  record still outranks it (the resolver), so this never hides one. */
export async function assertAllergyStatus(
  ctx: WriteCtx,
  input: AssertAllergyStatusInput,
): Promise<WriteResult> {
  requireAllergyCadre(ctx);
  const replay = await replayed(
    ctx.tx,
    allergyStatusAssertions,
    input.clientKey,
    input.patientUserId,
  );
  if (replay) return { id: replay };
  const encounterId = await linkEncounter(ctx, input.patientUserId, input.encounterId);
  const rows = await ctx.tx
    .select()
    .from(allergies)
    .where(eq(allergies.patientUserId, input.patientUserId));
  const active = currentAllergies(
    rows.map((r): AllergyRow => ({ ...r, substanceText: null })),
  ).filter(isActiveAllergy);
  const [a] = await ctx.tx
    .insert(allergyStatusAssertions)
    .values({
      hospitalId: ctx.actor.hospitalId,
      patientUserId: input.patientUserId,
      encounterId,
      assertion: input.assertion,
      assertedByUserId: ctx.actor.userId,
      asserterCadre: ctx.actor.cadreCode,
      assertedAt: input.assertedAt ?? ctx.now,
      recordedAt: ctx.now,
      source: "clinician",
      legacyRef: input.legacyRef ?? null,
      clientKey: input.clientKey,
    })
    .returning({ id: allergyStatusAssertions.id });
  await stampActivity(ctx, encounterId);
  return {
    id: a!.id,
    warnings: active.length
      ? ["An active allergy is on the record: it outranks this assertion."]
      : [],
  };
}

/* ─── Conditions ─────────────────────────────────────────────────── */

type ConditionInsert = typeof conditions.$inferInsert;
const MINOR_TERMS = new Set<string>(Object.values(DIAGNOSIS_TERMS_RESTRICTED_FOR_MINORS));

export interface ConditionInput {
  patientUserId: string;
  encounterId?: string | null;
  clientKey: string;
  /** A MedSync diagnosis term (the clinician picks a term, never a raw code). */
  termId?: string;
  /** Uncoded: shown, never HMIS-counted or engine-read. */
  text?: string;
  clinicalStatus?: ConditionInsert["clinicalStatus"];
  verification?: ConditionInsert["verification"];
  subjectRelation?: ConditionInsert["subjectRelation"];
  assertedBy?: ConditionInsert["assertedBy"];
  onset?: Record<string, unknown>;
  effectiveAt?: Date;
}

/** Term codes and sensitivity at insert: a restricted term or concept, or a pregnancy term for a
 *  possible minor (D-CFC-09), restricts the row. */
async function conditionColumns(
  ctx: WriteCtx,
  input: ConditionInput,
  effectiveAt: Date,
): Promise<
  Pick<
    ConditionInsert,
    "termId" | "conceptId" | "textCiphertext" | "icd11Code" | "cielId" | "sensitivity"
  >
> {
  const text = input.text?.trim();
  if (!input.termId) {
    if (!text) throw invalid("Pick a diagnosis term or type the diagnosis.");
    return {
      termId: null,
      conceptId: null,
      textCiphertext: encrypt(text),
      sensitivity: "standard",
    };
  }
  const [term] = await ctx.tx
    .select()
    .from(diagnosisTerms)
    .where(and(eq(diagnosisTerms.id, input.termId), eq(diagnosisTerms.active, true)));
  if (!term) throw invalid("That diagnosis term is not in the catalogue.");
  let restricted =
    term.sensitivity === "restricted" ||
    (!!term.conceptId && sensitivityFor(term.conceptId as FactConcept, null) === "restricted");
  if (!restricted && MINOR_TERMS.has(term.id)) {
    const dob = await dateOfBirth(ctx, input.patientUserId);
    restricted = !dob || possiblyMinorAt(dob, effectiveAt);
  }
  return {
    termId: term.id,
    conceptId: term.conceptId,
    textCiphertext: text ? encrypt(text) : null,
    icd11Code: term.icd11Code,
    cielId: term.cielId,
    sensitivity: restricted ? "restricted" : "standard",
  };
}

async function insertCondition(
  ctx: WriteCtx,
  input: ConditionInput,
  category: "problem_list_item" | "encounter_diagnosis",
  extra: Partial<ConditionInsert>,
  clientKey: string,
): Promise<string> {
  const effectiveAt = input.effectiveAt ?? ctx.now;
  const id = randomUUID();
  await ctx.tx.insert(conditions).values({
    id,
    logicalId: id,
    hospitalId: ctx.actor.hospitalId,
    patientUserId: input.patientUserId,
    encounterId: input.encounterId ?? null,
    effectiveAt,
    recordedAt: ctx.now,
    recordedByUserId: ctx.actor.userId,
    authorCadre: ctx.actor.cadreCode,
    source: "clinician",
    trust: input.assertedBy === "patient_reported" ? 1 : 3,
    status: "final",
    category,
    subjectRelation: input.subjectRelation ?? "self",
    clinicalStatus: input.clinicalStatus ?? "active",
    verification: input.verification ?? "confirmed",
    assertedBy: input.assertedBy ?? "clinician",
    onset: input.onset ?? null,
    clientKey,
    ...(await conditionColumns(ctx, input, effectiveAt)),
    ...extra,
  });
  return id;
}

export async function recordProblem(ctx: WriteCtx, input: ConditionInput): Promise<WriteResult> {
  requireCadre(ctx, ORDERING_CADRES, "add to the problem list");
  const replay = await replayed(ctx.tx, conditions, input.clientKey, input.patientUserId);
  if (replay) return { id: replay };
  if (input.clinicalStatus === "resolved" || input.verification === "refuted")
    throw invalid("Add the problem first; resolving or refuting is a status change with a reason.");
  const encounterId = await linkEncounter(ctx, input.patientUserId, input.encounterId);
  const id = await insertCondition(
    ctx,
    { ...input, encounterId },
    "problem_list_item",
    {},
    input.clientKey,
  );
  await stampActivity(ctx, encounterId);
  return { id };
}

/** The visit's encounters, locked, so two diagnoses racing for "primary" serialise. */
async function lockVisit(ctx: WriteCtx, encounterId: string): Promise<string[]> {
  const [e] = await ctx.tx
    .select({ visitId: encounters.visitId })
    .from(encounters)
    .where(eq(encounters.id, encounterId))
    .for("update");
  if (!e?.visitId) return [encounterId];
  const rows = await ctx.tx
    .select({ id: encounters.id })
    .from(encounters)
    .where(eq(encounters.visitId, e.visitId))
    .for("update");
  return rows.map((r) => r.id);
}

async function currentPrimary(ctx: WriteCtx, encounterIds: string[], exceptLogicalId?: string) {
  const rows = await ctx.tx
    .select({ id: conditions.id, logicalId: conditions.logicalId })
    .from(conditions)
    .where(
      and(
        inArray(conditions.encounterId, encounterIds),
        eq(conditions.category, "encounter_diagnosis"),
        eq(conditions.rank, "primary"),
        notInArray(conditions.status, ["entered_in_error", "cancelled"]),
        sql`${conditions.verification} <> 'refuted'`,
        sql`NOT EXISTS (SELECT 1 FROM public.conditions s WHERE s.supersedes_id = ${conditions.id})`,
      ),
    );
  return rows.find((r) => r.logicalId !== exceptLogicalId) ?? null;
}

export interface EncounterDiagnosisInput extends ConditionInput {
  encounterId: string;
  verification?: "provisional" | "confirmed" | "differential";
  /** Default: primary when the visit has none yet, else secondary. */
  rank?: "primary" | "secondary";
  /** Default on for chronic-flagged terms (PROMPT §5.5). */
  addToProblemList?: boolean;
}

export const IPC_PROMPT =
  "Infection prevention and control: apply the precautions for this notifiable disease.";

/**
 * One primary diagnosis per visit (HMIS counts it): a second primary is refused, not replaced.
 * A notifiable term (D-EMR-11; a signed REF-IDSR-CLASSES entry only) never blocks: the diagnosis is
 * recorded, a pending notification intent lands on the visit timeline (the notifications engine is
 * not built), and the class with its signed action text and the IPC prompt are returned for the
 * confirm sheet. The timeline label never names the class, so a restricted term is not revealed.
 */
export async function recordEncounterDiagnosis(
  ctx: WriteCtx,
  input: EncounterDiagnosisInput,
  idsrRef: RefEntry & { data?: IdsrClasses } = REF_IDSR_CLASSES,
): Promise<WriteResult & { notifiable?: IdsrClass }> {
  requireCadre(ctx, ORDERING_CADRES, "record a diagnosis");
  const replay = await replayed(ctx.tx, conditions, input.clientKey, input.patientUserId);
  if (replay) return { id: replay };
  const encounter = await openEncounter(ctx, input.patientUserId, input.encounterId);
  const visit = await lockVisit(ctx, encounter.id);
  const warnings: string[] = [];
  let verification = input.verification ?? "provisional";
  if (verification === "confirmed" && !authority(ctx).canWriteFinalDiagnosis) {
    verification = "provisional";
    warnings.push("Recorded as working: a senior confirms the final diagnosis.");
  }
  const primary = await currentPrimary(ctx, visit);
  if (input.rank === "primary" && primary)
    throw new EmrWriteError(
      "conflict",
      "This visit already has a primary diagnosis: make that one secondary first.",
    );
  const rank = input.rank ?? (primary ? "secondary" : "primary");
  const id = await insertCondition(
    ctx,
    { ...input, encounterId: encounter.id, verification },
    "encounter_diagnosis",
    { rank },
    input.clientKey,
  );
  const [term] = input.termId
    ? await ctx.tx
        .select({ chronic: diagnosisTerms.chronic })
        .from(diagnosisTerms)
        .where(eq(diagnosisTerms.id, input.termId))
    : [];
  if (input.addToProblemList ?? term?.chronic ?? false) {
    const problemKey = `${input.clientKey}:problem`;
    if (!(await replayed(ctx.tx, conditions, problemKey, input.patientUserId)))
      await insertCondition(
        ctx,
        {
          ...input,
          encounterId: encounter.id,
          verification: verification === "differential" ? "provisional" : verification,
        },
        "problem_list_item",
        {},
        problemKey,
      );
  }
  const notifiable = idsrClass(input.termId ?? null, idsrRef);
  if (notifiable) {
    await ctx.tx.insert(encounterEvents).values({
      encounterId: encounter.id,
      kind: "diagnosis",
      refId: id,
      label: "Notification pending (IDSR)",
      actorUserId: ctx.actor.userId,
    });
    warnings.push(`Notifiable (${notifiable.label}): ${notifiable.actionText}`, IPC_PROMPT);
  }
  await stampActivity(ctx, encounter.id);
  return { id, warnings, ...(notifiable ? { notifiable } : {}) };
}

export interface UpdateConditionInput {
  patientUserId: string;
  /** The current version the clinician saw. */
  id: string;
  clientKey: string;
  clinicalStatus?: ConditionInsert["clinicalStatus"];
  verification?: ConditionInsert["verification"];
  rank?: "primary" | "secondary";
  reasonCode?: string;
  reasonText?: string;
  abatementAt?: Date;
}

/** A problem's (or an encounter diagnosis's) status change is its next version. Resolving or
 *  refuting takes a reason and a clinician allowed a final diagnosis. */
export async function updateProblemStatus(
  ctx: WriteCtx,
  input: UpdateConditionInput,
): Promise<WriteResult> {
  requireCadre(ctx, ORDERING_CADRES, "change a problem or diagnosis");
  const replay = await replayed(ctx.tx, conditions, input.clientKey, input.patientUserId);
  if (replay) return { id: replay };
  const prev = await currentVersion(ctx, "condition", input.id, input.patientUserId);
  const closing = input.clinicalStatus === "resolved" || input.verification === "refuted";
  if (closing || input.verification === "confirmed") {
    if (!authority(ctx).canWriteFinalDiagnosis)
      throw new EmrWriteError("forbidden", "A senior confirms, resolves or refutes a diagnosis.");
  }
  if (closing) requireReason(input.reasonCode, input.reasonText, "resolve or refute");
  if (input.rank && prev.category !== "encounter_diagnosis")
    throw invalid("Only an encounter diagnosis has a rank.");
  if (input.rank === "primary" && prev.encounterId) {
    const visit = await lockVisit(ctx, prev.encounterId);
    if (await currentPrimary(ctx, visit, prev.logicalId))
      throw new EmrWriteError(
        "conflict",
        "This visit already has a primary diagnosis: make that one secondary first.",
      );
  }
  const id = await insertNextVersion(
    ctx,
    "condition",
    prev,
    {
      ...(input.clinicalStatus ? { clinicalStatus: input.clinicalStatus } : {}),
      ...(input.verification ? { verification: input.verification } : {}),
      ...(input.rank ? { rank: input.rank } : {}),
      abatementAt:
        input.clinicalStatus === "resolved" ? (input.abatementAt ?? ctx.now) : prev.abatementAt,
      ...reasonCols(input.reasonCode, input.reasonText),
    },
    input.clientKey,
  );
  await stampActivity(ctx, prev.encounterId);
  return { id };
}

/* ─── Medicines ──────────────────────────────────────────────────── */

type MedicationInsert = typeof medicationStatements.$inferInsert;

export interface MedicationStatementLine {
  /** Formulary drugKey where known; otherwise the name as typed goes in drugText. */
  drugCode?: string;
  drugText?: string;
  productKind?: MedicationInsert["productKind"];
  classTags?: string[];
  atcCode?: string;
  medicationStatus: MedicationInsert["medicationStatus"];
  periodStart?: string;
  periodEnd?: string;
  route?: MedicationInsert["route"];
  medicationSource: MedicationInsert["medicationSource"];
}

const restrictedTag = (tag: string) =>
  (DRUG_CLASS_TAGS as Record<string, { sensitivity: string } | undefined>)[tag]?.sensitivity ===
  "restricted";

export async function recordMedicationStatements(
  ctx: WriteCtx,
  input: {
    patientUserId: string;
    encounterId?: string | null;
    clientKey: string;
    statements: MedicationStatementLine[];
  },
): Promise<WriteResult & { ids: string[] }> {
  requireCadre(ctx, RECORDING_CADRES, "record medicines");
  if (input.statements.length === 0) throw invalid("Nothing to record.");
  const encounterId = await linkEncounter(ctx, input.patientUserId, input.encounterId);
  const ids: string[] = [];
  for (const [i, s] of input.statements.entries()) {
    const clientKey = `${input.clientKey}#${i}`;
    const replay = await replayed(ctx.tx, medicationStatements, clientKey, input.patientUserId);
    if (replay) {
      ids.push(replay);
      continue;
    }
    const text = s.drugText?.trim();
    if (!s.drugCode && !text) throw invalid("Name the medicine.");
    const tags = [...new Set(s.classTags ?? [])];
    const unknown = tags.find((t) => !(t in DRUG_CLASS_TAGS));
    if (unknown) throw invalid(`Unknown drug class ${unknown}.`);
    const id = randomUUID();
    await ctx.tx.insert(medicationStatements).values({
      id,
      logicalId: id,
      hospitalId: ctx.actor.hospitalId,
      patientUserId: input.patientUserId,
      encounterId,
      effectiveAt: ctx.now,
      recordedAt: ctx.now,
      recordedByUserId: ctx.actor.userId,
      authorCadre: ctx.actor.cadreCode,
      source: "clinician",
      trust: s.medicationSource === "patient_reported" ? 1 : 3,
      status: "final",
      sensitivity: tags.some(restrictedTag) ? "restricted" : "standard",
      drugCode: s.drugCode ?? null,
      drugTextCiphertext: text ? encrypt(text) : null,
      productKind: s.productKind ?? "medicine",
      classTags: tags,
      atcCode: s.atcCode ?? null,
      medicationStatus: s.medicationStatus,
      periodStart: s.periodStart ?? null,
      periodEnd: s.periodEnd ?? null,
      route: s.route ?? null,
      medicationSource: s.medicationSource,
      clientKey,
    });
    ids.push(id);
  }
  await stampActivity(ctx, encounterId);
  return { id: ids[0]!, ids };
}

/** "Confirm current medicines" (WHO solution 6): each current statement continued, stopped (with a
 *  reason) or changed, as its next version on this encounter. */
export async function confirmCurrentMedicines(
  ctx: WriteCtx,
  input: {
    patientUserId: string;
    encounterId: string;
    clientKey: string;
    items: {
      id: string;
      reconciliation: "continued" | "stopped" | "changed";
      reasonCode?: string;
      reasonText?: string;
    }[];
  },
): Promise<WriteResult & { ids: string[] }> {
  requireCadre(ctx, RECORDING_CADRES, "reconcile medicines");
  if (input.items.length === 0) throw invalid("Nothing to confirm.");
  const encounter = await openEncounter(ctx, input.patientUserId, input.encounterId);
  const ids: string[] = [];
  for (const [i, item] of input.items.entries()) {
    const clientKey = `${input.clientKey}#${i}`;
    const replay = await replayed(ctx.tx, medicationStatements, clientKey, input.patientUserId);
    if (replay) {
      ids.push(replay);
      continue;
    }
    if (item.reconciliation === "stopped")
      requireReason(item.reasonCode, item.reasonText, "stop a medicine");
    const prev = await currentVersion(ctx, "medication", item.id, input.patientUserId);
    ids.push(
      await insertNextVersion(
        ctx,
        "medication",
        prev,
        {
          reconciliation: item.reconciliation,
          encounterId: encounter.id,
          effectiveAt: ctx.now,
          ...(item.reconciliation === "stopped"
            ? {
                medicationStatus: "stopped" as const,
                periodEnd: ctx.now.toISOString().slice(0, 10),
              }
            : {}),
          ...reasonCols(item.reasonCode, item.reasonText),
        },
        clientKey,
      ),
    );
  }
  await stampActivity(ctx, encounter.id);
  return { id: ids[0]!, ids };
}

/**
 * Stop a statement outside a reconciliation, e.g. its prescription was withdrawn because a senior
 * returned the co-sign. A new version, never an edit (C7), carrying the reason; replay-safe on the key.
 */
export async function stopMedicationStatement(
  ctx: WriteCtx,
  input: { patientUserId: string; statementId: string; reasonCode: string; clientKey: string },
): Promise<string> {
  const replay = await replayed(ctx.tx, medicationStatements, input.clientKey, input.patientUserId);
  if (replay) return replay;
  const prev = await currentVersion(ctx, "medication", input.statementId, input.patientUserId);
  return insertNextVersion(
    ctx,
    "medication",
    prev,
    {
      medicationStatus: "stopped",
      periodEnd: ctx.now.toISOString().slice(0, 10),
      effectiveAt: ctx.now,
      ...reasonCols(input.reasonCode),
    },
    input.clientKey,
  );
}

/* ─── Pregnancy and procedures ───────────────────────────────────── */

type PregnancyInsert = typeof pregnancyEpisodes.$inferInsert;

export interface PregnancyInput {
  patientUserId: string;
  encounterId?: string | null;
  clientKey: string;
  /** Update this current version of the episode (logical_id = the episode). */
  supersedesId?: string;
  pregnancyState: PregnancyInsert["pregnancyState"];
  lnmp?: string | null;
  lnmpCertainty?: PregnancyInsert["lnmpCertainty"];
  edd?: string | null;
  eddBasis?: PregnancyInsert["eddBasis"];
  gravida?: number | null;
  parity?: number | null;
  deliveredAt?: Date | null;
  outcome?: PregnancyInsert["outcome"];
  birthWeightGrams?: number | null;
  effectiveAt?: Date;
}

/** Pregnancy is an episode; restricted for a possible minor (SR-PREG-MINOR) at insert. */
export async function recordPregnancy(ctx: WriteCtx, input: PregnancyInput): Promise<WriteResult> {
  requireCadre(ctx, RECORDING_CADRES, "record pregnancy");
  const replay = await replayed(ctx.tx, pregnancyEpisodes, input.clientKey, input.patientUserId);
  if (replay) return { id: replay };
  const encounterId = await linkEncounter(ctx, input.patientUserId, input.encounterId);
  const effectiveAt = input.effectiveAt ?? ctx.now;
  const dob = await dateOfBirth(ctx, input.patientUserId);
  const sensitivity = sensitivityFor(
    "preg.status" as FactConcept,
    null,
    dob ? { dob, effectiveAt } : undefined,
  );
  const { patientUserId: _p, encounterId: _e, clientKey: _k, supersedesId, ...fields } = input;
  const values = { ...fields, effectiveAt, sensitivity } satisfies Partial<PregnancyInsert>;
  let id: string;
  if (supersedesId) {
    const prev = await currentVersion(ctx, "pregnancy", supersedesId, input.patientUserId);
    id = await insertNextVersion(
      ctx,
      "pregnancy",
      prev,
      { ...values, encounterId: encounterId ?? prev.encounterId },
      input.clientKey,
    );
  } else {
    id = randomUUID();
    await ctx.tx.insert(pregnancyEpisodes).values({
      ...values,
      id,
      logicalId: id,
      hospitalId: ctx.actor.hospitalId,
      patientUserId: input.patientUserId,
      encounterId,
      recordedAt: ctx.now,
      recordedByUserId: ctx.actor.userId,
      authorCadre: ctx.actor.cadreCode,
      source: "clinician",
      trust: 3,
      status: "final",
      clientKey: input.clientKey,
    });
  }
  await stampActivity(ctx, encounterId);
  return { id };
}

export interface ProcedureInput {
  patientUserId: string;
  encounterId?: string | null;
  clientKey: string;
  /** A proc.* concept; otherwise the procedure as typed. */
  conceptId?: string;
  text?: string;
  outcome: "completed" | "not_done" | "declined" | "unable";
  laterality?: "left" | "right" | "bilateral";
  noteId?: string;
  effectiveAt?: Date;
}

export async function recordProcedure(ctx: WriteCtx, input: ProcedureInput): Promise<WriteResult> {
  requireCadre(ctx, RECORDING_CADRES, "record procedures");
  const replay = await replayed(ctx.tx, procedures, input.clientKey, input.patientUserId);
  if (replay) return { id: replay };
  const text = input.text?.trim();
  if (input.conceptId && conceptDef(input.conceptId)?.kind !== "procedure")
    throw invalid(`${input.conceptId} is not a procedure.`);
  if (!input.conceptId && !text) throw invalid("Name the procedure.");
  const encounterId = await linkEncounter(ctx, input.patientUserId, input.encounterId);
  const effectiveAt = input.effectiveAt ?? ctx.now;
  const id = randomUUID();
  await ctx.tx.insert(procedures).values({
    id,
    logicalId: id,
    hospitalId: ctx.actor.hospitalId,
    patientUserId: input.patientUserId,
    encounterId,
    effectiveAt,
    recordedAt: ctx.now,
    recordedByUserId: ctx.actor.userId,
    authorCadre: ctx.actor.cadreCode,
    source: "clinician",
    trust: 3,
    status: "final",
    sensitivity: input.conceptId
      ? sensitivityFor(input.conceptId as FactConcept, null)
      : "standard",
    conceptId: input.conceptId ?? null,
    textCiphertext: text ? encrypt(text) : null,
    outcome: input.outcome,
    laterality: input.laterality ?? null,
    noteId: input.noteId ?? null,
    clientKey: input.clientKey,
  });
  await stampActivity(ctx, encounterId);
  return { id };
}

/* ─── Entered in error (generic) ─────────────────────────────────── */

export type FactKind = VersionedKind | "observation" | "allergy_assertion";

export interface MarkFactEnteredInErrorInput {
  patientUserId: string;
  kind: FactKind;
  id: string;
  reasonCode?: string;
  reasonText?: string;
  clientKey: string;
}

/**
 * Void one item: a new version with status entered_in_error and the reason, keeping its concept or
 * term (STOP 3), so it stays visible struck through and every reader drops it. Author or supervisor.
 */
export async function markFactEnteredInError(
  ctx: WriteCtx,
  input: MarkFactEnteredInErrorInput,
): Promise<WriteResult> {
  requireReason(input.reasonCode, input.reasonText, "mark this entered in error");
  const { tx, actor, now } = ctx;

  if (input.kind === "observation") {
    const replay = await replayed(tx, clinicalObservations, input.clientKey, input.patientUserId);
    if (replay) return { id: replay };
    return { id: await voidObservation(ctx, input) };
  }

  if (input.kind === "allergy_assertion") {
    const replay = await replayed(
      tx,
      allergyStatusAssertions,
      input.clientKey,
      input.patientUserId,
    );
    if (replay) return { id: replay };
    const [a] = await tx
      .select()
      .from(allergyStatusAssertions)
      .where(eq(allergyStatusAssertions.id, input.id));
    if (!a || a.patientUserId !== input.patientUserId)
      throw new EmrWriteError("not_found", "Assertion not found for this patient.");
    requireAuthorOrSupervisor(ctx, a.assertedByUserId);
    const [v] = await tx
      .insert(allergyStatusAssertions)
      .values({
        hospitalId: actor.hospitalId,
        patientUserId: a.patientUserId,
        encounterId: a.encounterId,
        assertion: a.assertion,
        assertedByUserId: actor.userId,
        asserterCadre: actor.cadreCode,
        assertedAt: a.assertedAt,
        recordedAt: now,
        source: "clinician",
        status: "entered_in_error",
        supersedesId: a.id,
        ...reasonCols(input.reasonCode, input.reasonText),
        clientKey: input.clientKey,
      })
      .returning({ id: allergyStatusAssertions.id });
    return { id: v!.id };
  }

  const table = VERSIONED[input.kind];
  const replay = await replayed(tx, table, input.clientKey, input.patientUserId);
  if (replay) return { id: replay };
  const prev = await currentVersion(ctx, input.kind, input.id, input.patientUserId, {
    anyHospital: input.kind === "allergy",
  });
  requireAuthorOrSupervisor(ctx, prev.recordedByUserId);
  const id = await insertNextVersion(
    ctx,
    input.kind,
    prev,
    { status: "entered_in_error", ...reasonCols(input.reasonCode, input.reasonText) },
    input.clientKey,
  );
  await stampActivity(ctx, prev.encounterId);
  return { id };
}

/** An observation's EIE version: same logical id and concept; the reason is the note (obs_cfc_shape). */
export async function voidObservation(
  ctx: WriteCtx,
  input: {
    patientUserId: string;
    id: string;
    reasonCode?: string;
    reasonText?: string;
    clientKey: string;
  },
  opts: { skipAuthorCheck?: boolean } = {},
): Promise<string> {
  const { tx, actor, now } = ctx;
  const [o] = await tx
    .select()
    .from(clinicalObservations)
    .where(eq(clinicalObservations.id, input.id));
  if (
    !o ||
    o.patientUserId !== input.patientUserId ||
    o.hospitalId !== actor.hospitalId ||
    !o.conceptId
  )
    throw new EmrWriteError("not_found", "Observation not found for this patient here.");
  const [next] = await tx
    .select({ id: clinicalObservations.id })
    .from(clinicalObservations)
    .where(eq(clinicalObservations.supersedesId, o.id))
    .limit(1);
  if (next) throw new EmrWriteError("conflict", "A newer version exists: reload and try again.");
  if (o.status === "entered_in_error")
    throw new EmrWriteError("conflict", "Already entered in error.");
  if (!opts.skipAuthorCheck) requireAuthorOrSupervisor(ctx, o.recordedByUserId);
  const { id: _id, createdAt: _c, updatedAt: _u, clientKey: _k, ...rest } = o;
  const reason = [input.reasonCode?.trim(), input.reasonText?.trim()].filter(Boolean).join(": ");
  const id = randomUUID();
  await tx.insert(clinicalObservations).values({
    ...rest,
    id,
    logicalId: o.logicalId ?? o.id,
    version: (o.version ?? 1) + 1,
    supersedesId: o.id,
    status: "entered_in_error",
    noteCiphertext: encrypt(reason),
    recordedByUserId: actor.userId,
    authorCadre: actor.cadreCode,
    recordedAt: now,
    clientKey: input.clientKey,
  });
  await stampActivity(ctx, o.encounterId);
  return id;
}
