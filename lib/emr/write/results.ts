import "server-only";

import { randomUUID } from "node:crypto";
import type { WriteCtx } from "./context";
import type { OrderRow, TestRow, WriteResult } from "./orders";
import type { CriticalRef } from "@/lib/emr/reference/critical";
import type { LabInterpretation, ReportStatus } from "@/lib/emr/results";
import type { DateOfBirth } from "@/lib/facts/project/shared";
import type { FactConcept } from "@/lib/facts/types";
import { and, eq, inArray } from "drizzle-orm";

import { staffAffiliations } from "@/db/schema/clinician-profiles";
import {
  criticalResultCommunications,
  diagnosticReports,
  resultAcknowledgements,
  specimens,
} from "@/db/schema/emr";
import { encounterOrders } from "@/db/schema/encounter";
import { clinicalObservations } from "@/db/schema/nurse-workspace";
import { patientProfiles } from "@/db/schema/patient-profiles";
import { CRITICAL_REFS } from "@/lib/emr/reference/critical";
import {
  ackState,
  canTransitionReport,
  currentVersion,
  detectCritical,
  isWithdrawn,
  resultTrust,
} from "@/lib/emr/results";
import { encrypt } from "@/lib/encryption";
import { conceptDef, hasMinorRule, sensitivityFor } from "@/lib/facts/project/shared";
import { mismatchPrompt, parseComparator, toCanonical } from "@/lib/units";
import { EmrWriteError, stampActivity } from "./context";
import {
  isHospitalStaff,
  LAB_CADRES,
  loadOrder,
  loadTest,
  NURSE_CADRES,
  ORDERING_CADRES,
  orderStatus,
  replayed,
  requireCadre,
  statusConflict,
} from "./orders";

/**
 * Results (PROMPT §5.8, D-EMR-06/07/08). A report is versioned: entry, release, amendment and
 * withdrawal each insert a new diagnostic_reports row, and every version carries its own
 * observation rows (report_id), each the next version of the same logical value with the same
 * concept. Nothing is updated. MedSync's critical flag comes only from lib/emr/results.ts over
 * signed REF-CRIT entries (none signed yet); the lab's own flag and range travel as context.
 */

type ReportRow = typeof diagnosticReports.$inferSelect;
type SpecimenRow = typeof specimens.$inferSelect;
type NewObservation = typeof clinicalObservations.$inferInsert;

export const UNCATALOGUED = "obs.uncatalogued";

export interface ResultValueInput {
  /** A component concept of the ordered test, or "obs.uncatalogued" (shown, never interpreted). */
  conceptId: string;
  /** Quantity as reported; a comparator is kept ("<0.5" is not 0.5). Uncatalogued: as typed. */
  value?: string;
  unit?: string;
  /** The CFC §6 unit-mismatch question was answered "yes, this unit". */
  unitConfirmed?: boolean;
  /** Coded or ordinal answer. */
  code?: string;
  method?: string;
  /** The performing lab's own range for this result (MedSync never supplies one). */
  referenceRange?: { low?: number; high?: number; unit: string };
  labInterpretation?: LabInterpretation;
  restricted?: boolean;
  /** Uncatalogued: the test name as typed. */
  name?: string;
  /** Amendment of an uncatalogued value: the observation it supersedes. */
  replaces?: string;
}

type Entry = { entryMode: "direct" | "transcribed"; source: "lab" | "poc_staff"; poc: boolean };

/** D-EMR-08 and §D: lab staff enter directly, nurses at the bedside, clinicians transcribe. */
function entryFor(ctx: WriteCtx): Entry {
  const c = ctx.actor.cadreCode;
  if (LAB_CADRES.includes(c)) return { entryMode: "direct", source: "lab", poc: false };
  if (NURSE_CADRES.includes(c)) return { entryMode: "direct", source: "poc_staff", poc: true };
  if (ORDERING_CADRES.includes(c)) return { entryMode: "transcribed", source: "lab", poc: false };
  throw new EmrWriteError("forbidden", "Your cadre may not enter results.");
}

const invalid = (m: string) => new EmrWriteError("invalid", m);

/** The current (unsuperseded) version of a report of this patient here. */
async function currentReport(
  ctx: WriteCtx,
  patientUserId: string,
  reportId: string,
): Promise<ReportRow> {
  const [r] = await ctx.tx
    .select()
    .from(diagnosticReports)
    .where(eq(diagnosticReports.id, reportId));
  if (!r || r.patientUserId !== patientUserId || r.hospitalId !== ctx.actor.hospitalId)
    throw new EmrWriteError("not_found", "Report not found for this patient here.");
  const [next] = await ctx.tx
    .select({ id: diagnosticReports.id })
    .from(diagnosticReports)
    .where(eq(diagnosticReports.supersedesId, r.id))
    .limit(1);
  if (next) throw new EmrWriteError("conflict", "A newer version of this report exists.");
  return r;
}

async function loadSpecimen(ctx: WriteCtx, id: string | null): Promise<SpecimenRow | null> {
  if (!id) return null;
  const [s] = await ctx.tx.select().from(specimens).where(eq(specimens.id, id));
  return s ?? null;
}

/** SR-PREG-MINOR needs the date of birth at insert (cfc-v1.1-addendum A3). */
async function dobIfNeeded(
  ctx: WriteCtx,
  patientUserId: string,
  concepts: readonly string[],
): Promise<DateOfBirth | undefined> {
  if (!concepts.some((c) => hasMinorRule(c as FactConcept))) return undefined;
  const [p] = await ctx.tx
    .select({ dob: patientProfiles.dateOfBirth })
    .from(patientProfiles)
    .where(eq(patientProfiles.id, patientUserId));
  return p ? { value: p.dob, precision: "day" } : undefined;
}

/* ─── One report version and its values ──────────────────────────── */

interface VersionSpec {
  patientUserId: string;
  order: OrderRow;
  test: TestRow | null;
  prior: ReportRow | null;
  status: ReportStatus;
  entry: Entry;
  specimen: SpecimenRow | null;
  values: readonly ResultValueInput[];
  enteredByUserId: string;
  verifiedByUserId: string | null;
  conclusionCode?: "normal" | "abnormal" | "indeterminate";
  conclusionText?: string;
  performerLabName?: string;
  reasonCode?: string | null;
  reasonText?: string;
  clientKey: string | null;
  criticalRefs: readonly CriticalRef[];
}

function valueColumns(
  v: ResultValueInput,
  test: TestRow | null,
): Pick<
  NewObservation,
  | "conceptId"
  | "valueType"
  | "valueNum"
  | "valueComparator"
  | "valueUnit"
  | "valueCanonical"
  | "valueCode"
  | "noteCiphertext"
> {
  if (v.conceptId === UNCATALOGUED) {
    const name = v.name?.trim();
    if (!name) throw invalid("An uncatalogued result needs the test name as typed.");
    // CFC C2: kept as typed, encrypted, never interpreted.
    return {
      conceptId: UNCATALOGUED,
      valueType: "as_typed",
      noteCiphertext: encrypt(
        JSON.stringify({ name, value: v.value ?? v.code ?? "", unit: v.unit ?? null }),
      ),
    };
  }
  const def = conceptDef(v.conceptId);
  if (!def || !test?.components.includes(v.conceptId))
    throw invalid(
      `${v.conceptId} is not part of ${test?.display ?? "this test"}: enter it as uncatalogued.`,
    );
  if (def.valueType === "coded" || def.valueType === "ordinal") {
    const code = v.code?.trim();
    if (!code || (def.answers && !def.answers.includes(code)))
      throw invalid(`${def.display}: choose one of ${def.answers?.join(", ") ?? "the answers"}.`);
    return { conceptId: v.conceptId, valueType: def.valueType, valueCode: code };
  }
  if (def.valueType !== "quantity") throw invalid(`${def.display} cannot be entered as a result.`);
  const parsed = parseComparator(v.value ?? "");
  if ("error" in parsed)
    throw invalid(`${def.display}: enter a number (a comparator such as < is allowed).`);
  const defaults = (test.defaultUnits ?? {}) as Record<string, string>;
  const unit = v.unit?.trim() || defaults[v.conceptId] || def.canonicalUnit;
  if (!unit) throw invalid(`${def.display}: a unit is required.`);
  let canonical = parsed.value;
  if (unit !== (def.canonicalUnit ?? unit)) {
    const c = toCanonical(v.conceptId, parsed.value, unit);
    if ("error" in c) throw invalid(`${def.display}: ${c.error}.`);
    canonical = c.value;
  }
  const ask = mismatchPrompt(v.conceptId, parsed.value, unit);
  if (ask && !v.unitConfirmed)
    throw invalid(`${def.display}: ${ask.ask} Confirm the unit to save.`);
  return {
    conceptId: v.conceptId,
    valueType: "quantity",
    valueNum: String(parsed.value),
    valueComparator: parsed.comparator,
    valueUnit: unit,
    valueCanonical: String(canonical),
  };
}

function labContext(v: ResultValueInput, specimen: SpecimenRow | null): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  if (v.referenceRange) c.referenceRange = { ...v.referenceRange, source: "lab" };
  if (v.labInterpretation) c.labInterpretation = v.labInterpretation;
  if (specimen && specimen.container !== "unknown") c.container = specimen.container;
  if (specimen?.fastingHours != null) c.fastingHours = Number(specimen.fastingHours);
  return c;
}

async function writeReportVersion(
  ctx: WriteCtx,
  spec: VersionSpec,
): Promise<{ id: string; critical: boolean }> {
  const { tx, actor, now } = ctx;
  const { order, prior, specimen, entry, status } = spec;
  const kind = order.kind;
  if (kind !== "lab" && kind !== "imaging" && kind !== "ecg")
    throw invalid("Only laboratory, imaging and ECG orders carry a report.");

  const priorRows = prior
    ? await tx
        .select()
        .from(clinicalObservations)
        .where(eq(clinicalObservations.reportId, prior.id))
    : [];
  // Only each value's current version: a value voided on this report (voidObservation keeps the
  // report_id) leaves its superseded version here too, and carrying both forward would collide.
  const superseded = new Set(priorRows.map((o) => o.supersedesId));
  const priorObs = priorRows.filter((o) => !superseded.has(o.id));
  const id = randomUUID();
  const trust = resultTrust({
    entryMode: entry.entryMode,
    status,
    source: entry.source,
    verifiedByUserId: spec.verifiedByUserId,
  });
  const effectiveAt = prior?.effectiveAt ?? specimen?.collectedAt ?? now;
  const inherited = order.sensitivity === "restricted" || prior?.sensitivity === "restricted";
  const dob = await dobIfNeeded(ctx, spec.patientUserId, [
    ...spec.values.map((v) => v.conceptId),
    ...priorObs.map((o) => o.conceptId ?? ""),
  ]);
  const common = {
    hospitalId: actor.hospitalId,
    patientUserId: spec.patientUserId,
    encounterId: order.encounterId,
    recordedByUserId: actor.userId,
    observationKind: "fact",
    state: "fact",
    category: "laboratory",
    source: entry.source,
    trust,
    status,
    effectiveAt,
    authorCadre: actor.cadreCode,
    reportId: id,
    orderId: order.id,
    entryMode: entry.entryMode,
    recordedAt: now,
  } satisfies Partial<NewObservation>;

  const rows: NewObservation[] = [];
  const used = new Set<string>();
  const seen = new Set<string>();
  for (const v of spec.values) {
    const cols = valueColumns(v, spec.test);
    if (cols.conceptId !== UNCATALOGUED) {
      if (seen.has(v.conceptId)) throw invalid(`${v.conceptId} is entered twice.`);
      seen.add(v.conceptId);
    }
    const match = v.replaces
      ? priorObs.find((o) => o.id === v.replaces)
      : cols.conceptId === UNCATALOGUED
        ? undefined
        : priorObs.find((o) => o.conceptId === cols.conceptId);
    if (v.replaces && !match) throw invalid("The value being replaced is not on this report.");
    // Every version of a logical value keeps its concept (STOP 3 invariant).
    if (match && match.conceptId !== cols.conceptId)
      throw invalid("A corrected value keeps its test component.");
    if (match) {
      if (used.has(match.id)) throw invalid("A value is replaced twice.");
      used.add(match.id);
    }
    const obsId = randomUUID();
    const restricted = inherited || v.restricted === true || match?.sensitivity === "restricted";
    rows.push({
      ...common,
      ...cols,
      id: obsId,
      logicalId: match?.logicalId ?? obsId,
      version: match ? (match.version ?? 1) + 1 : 1,
      supersedesId: match?.id ?? null,
      specimen: specimen?.specimenType ?? null,
      fastingState: specimen?.fastingState ?? null,
      method: v.method?.trim() || null,
      pointOfCare: entry.poc || null,
      context: labContext(v, specimen),
      sensitivity: sensitivityFor(
        cols.conceptId as FactConcept,
        restricted ? "restricted" : null,
        dob ? { dob, effectiveAt } : undefined,
      ),
    });
  }
  // Values not re-entered carry forward into this version unchanged (release, withdrawal, or an
  // amendment that touches one component of a panel).
  for (const o of priorObs) {
    if (used.has(o.id)) continue;
    const { id: _id, createdAt: _c, updatedAt: _u, clientKey: _k, ...rest } = o;
    const obsId = randomUUID();
    rows.push({
      ...rest,
      ...common,
      id: obsId,
      logicalId: o.logicalId ?? o.id,
      version: (o.version ?? 1) + 1,
      supersedesId: o.id,
      // A voided value stays voided, with its reason (note_ciphertext, carried in `rest`).
      status: o.status === "entered_in_error" ? o.status : status,
      sensitivity: inherited ? "restricted" : o.sensitivity,
    });
  }
  if (rows.length === 0 && kind === "lab") throw invalid("Enter at least one value.");

  const critical = rows.some(
    (r) =>
      r.status !== "entered_in_error" &&
      detectCritical(
        {
          conceptId: r.conceptId ?? null,
          valueNum: r.valueNum ?? null,
          valueComparator: r.valueComparator ?? null,
          valueUnit: r.valueUnit ?? null,
          valueCanonical: r.valueCanonical ?? null,
          context: r.context ?? {},
        },
        spec.criticalRefs,
      ).isCritical,
  );
  const conclusionText = spec.conclusionText?.trim();
  await tx.insert(diagnosticReports).values({
    id,
    logicalId: prior?.logicalId ?? id,
    version: prior ? prior.version + 1 : 1,
    supersedesId: prior?.id ?? null,
    hospitalId: actor.hospitalId,
    patientUserId: spec.patientUserId,
    encounterId: order.encounterId,
    effectiveAt,
    recordedAt: now,
    recordedByUserId: actor.userId,
    authorCadre: actor.cadreCode,
    source: entry.source,
    trust,
    status,
    sensitivity:
      inherited || rows.some((r) => r.sensitivity === "restricted") ? "restricted" : "standard",
    reasonCode: spec.reasonCode ?? null,
    reasonCiphertext: spec.reasonText ? encrypt(spec.reasonText) : null,
    clientKey: spec.clientKey,
    orderId: order.id,
    specimenId: specimen?.id ?? prior?.specimenId ?? null,
    testId: order.testId,
    kind,
    issuedAt: now,
    performer: order.performer === "in_house" ? "in_house" : "external",
    performerLabName: spec.performerLabName ?? prior?.performerLabName ?? null,
    entryMode: entry.entryMode,
    enteredByUserId: spec.enteredByUserId,
    verifiedByUserId: spec.verifiedByUserId,
    conclusionCode: spec.conclusionCode ?? prior?.conclusionCode ?? null,
    conclusionCiphertext: conclusionText
      ? encrypt(conclusionText)
      : (prior?.conclusionCiphertext ?? null),
    critical,
    uncatalogued: rows.some((r) => r.conceptId === UNCATALOGUED),
  });
  if (rows.length) await tx.insert(clinicalObservations).values(rows);
  return { id, critical };
}

const CRITICAL_WARNING = "A value is critical: record who was told, how, and the read-back.";

/* ─── enterResults ───────────────────────────────────────────────── */

export interface EnterResultsInput {
  patientUserId: string;
  orderId: string;
  status: "preliminary" | "final";
  values: ResultValueInput[];
  conclusionCode?: "normal" | "abnormal" | "indeterminate";
  conclusionText?: string;
  performerLabName?: string;
  clientKey: string;
}

export type ReportResult = WriteResult & { critical?: boolean };

/**
 * First entry on an order, or re-entry over a preliminary version (a correction before release).
 * A released result is changed only by amendResults.
 */
export async function enterResults(
  ctx: WriteCtx,
  input: EnterResultsInput,
  criticalRefs: readonly CriticalRef[] = CRITICAL_REFS,
): Promise<ReportResult> {
  const entry = entryFor(ctx);
  const replay = await replayed(ctx.tx, diagnosticReports, input.clientKey, input.patientUserId);
  if (replay) return { id: replay };
  const order = await loadOrder(ctx, input.patientUserId, input.orderId);
  const test = await loadTest(ctx.tx, order.testId);
  // ponytail: "point of care" = a bedside test (capillary_direct container); a POC flag on the
  // test menu replaces this when the hub's offerings carry one.
  if (entry.poc && test?.container !== "capillary_direct")
    throw new EmrWriteError("forbidden", "Nurses enter point-of-care (bedside) results only.");

  const status = await orderStatus(ctx.tx, order);
  let prior: ReportRow | null = null;
  let specimenId: string | null = null;
  if (status.state === "resulted" && status.review === "not_released") {
    prior = await currentReport(ctx, input.patientUserId, status.reportId!);
    specimenId = prior.specimenId;
  } else if (status.state === "resulted" || status.state === "acknowledged") {
    throw new EmrWriteError("conflict", "This order already has a released result: amend it.");
  } else if (status.state === "cancelled" || status.state === "on_hold") {
    throw statusConflict(status, order, "enter results");
  } else if (status.state === "collected" || status.state === "in_progress") {
    specimenId = status.specimenId;
  }
  // A laboratory result needs its specimen: received by the lab for lab staff, at least collected
  // at the bedside. A transcribed paper report may come from elsewhere.
  if (order.kind === "lab" && !prior && entry.entryMode === "direct") {
    const ready = entry.poc
      ? status.state === "collected" || status.state === "in_progress"
      : status.state === "in_progress";
    if (!ready)
      throw statusConflict(
        status,
        order,
        entry.poc ? "enter results" : "enter results before receipt",
      );
  }
  if (!canTransitionReport(prior ? (prior.status as ReportStatus) : null, input.status))
    throw new EmrWriteError("conflict", "That report status cannot follow the current one.");

  const released = input.status !== "preliminary";
  const r = await writeReportVersion(ctx, {
    patientUserId: input.patientUserId,
    order,
    test,
    prior,
    status: input.status,
    entry,
    specimen: await loadSpecimen(ctx, specimenId),
    values: input.values,
    enteredByUserId: ctx.actor.userId,
    // Lab staff entering a final result verify it by the act; a transcription stays T3.
    verifiedByUserId:
      released && entry.source === "lab" && !entry.poc && entry.entryMode === "direct"
        ? ctx.actor.userId
        : null,
    conclusionCode: input.conclusionCode,
    conclusionText: input.conclusionText,
    performerLabName: input.performerLabName,
    clientKey: input.clientKey,
    criticalRefs,
  });
  await stampActivity(ctx, order.encounterId);
  return { id: r.id, critical: r.critical, warnings: r.critical ? [CRITICAL_WARNING] : [] };
}

/* ─── releaseResults (lab: preliminary → final) ──────────────────── */

export interface ReleaseResultsInput {
  patientUserId: string;
  reportId: string;
  clientKey: string;
}

export async function releaseResults(
  ctx: WriteCtx,
  input: ReleaseResultsInput,
  criticalRefs: readonly CriticalRef[] = CRITICAL_REFS,
): Promise<ReportResult> {
  requireCadre(ctx, LAB_CADRES, "release results");
  const replay = await replayed(ctx.tx, diagnosticReports, input.clientKey, input.patientUserId);
  if (replay) return { id: replay };
  const prior = await currentReport(ctx, input.patientUserId, input.reportId);
  if (prior.status !== "preliminary")
    throw new EmrWriteError("conflict", "Only a preliminary result can be released.");
  const order = await loadOrder(ctx, input.patientUserId, prior.orderId!);
  const r = await writeReportVersion(ctx, {
    patientUserId: input.patientUserId,
    order,
    test: await loadTest(ctx.tx, order.testId),
    prior,
    status: "final",
    entry: {
      entryMode: prior.entryMode as Entry["entryMode"],
      source: prior.source as Entry["source"],
      poc: false,
    },
    specimen: await loadSpecimen(ctx, prior.specimenId),
    values: [],
    enteredByUserId: prior.enteredByUserId,
    // Release by laboratory staff verifies the result, a transcription included (D-EMR-08 → T4).
    verifiedByUserId: ctx.actor.userId,
    clientKey: input.clientKey,
    criticalRefs,
  });
  await stampActivity(ctx, order.encounterId);
  return { id: r.id, critical: r.critical, warnings: r.critical ? [CRITICAL_WARNING] : [] };
}

/* ─── amendResults ───────────────────────────────────────────────── */

export interface AmendResultsInput {
  patientUserId: string;
  reportId: string;
  status: "amended" | "corrected";
  values: ResultValueInput[];
  reasonText: string;
  conclusionCode?: "normal" | "abnormal" | "indeterminate";
  conclusionText?: string;
  clientKey: string;
}

export async function amendResults(
  ctx: WriteCtx,
  input: AmendResultsInput,
  criticalRefs: readonly CriticalRef[] = CRITICAL_REFS,
): Promise<ReportResult> {
  const replay = await replayed(ctx.tx, diagnosticReports, input.clientKey, input.patientUserId);
  if (replay) return { id: replay };
  const prior = await currentReport(ctx, input.patientUserId, input.reportId);
  const lab = LAB_CADRES.includes(ctx.actor.cadreCode);
  if (!lab && prior.enteredByUserId !== ctx.actor.userId)
    throw new EmrWriteError(
      "forbidden",
      "Only the laboratory, or whoever entered it, amends a result.",
    );
  if (
    prior.status === "preliminary" ||
    !canTransitionReport(prior.status as ReportStatus, input.status)
  )
    throw new EmrWriteError(
      "conflict",
      "Only a released result is amended; a preliminary one is entered again.",
    );
  if (!input.reasonText.trim()) throw invalid("An amendment needs a reason.");
  if (input.values.length === 0 && !input.conclusionCode && !input.conclusionText)
    throw invalid("Nothing to amend.");
  const order = await loadOrder(ctx, input.patientUserId, prior.orderId!);
  const r = await writeReportVersion(ctx, {
    patientUserId: input.patientUserId,
    order,
    test: await loadTest(ctx.tx, order.testId),
    prior,
    status: input.status,
    entry: {
      entryMode: prior.entryMode as Entry["entryMode"],
      source: prior.source as Entry["source"],
      poc: prior.source === "poc_staff",
    },
    specimen: await loadSpecimen(ctx, prior.specimenId),
    values: input.values,
    enteredByUserId: ctx.actor.userId,
    verifiedByUserId: lab ? ctx.actor.userId : null,
    conclusionCode: input.conclusionCode,
    conclusionText: input.conclusionText,
    reasonText: input.reasonText.trim(),
    clientKey: input.clientKey,
    criticalRefs,
  });
  await stampActivity(ctx, order.encounterId);
  // D-EMR-07: acknowledgement is per version, so the amended one lands in Results to review again.
  const warnings = ["The ordering clinician must acknowledge the amended result again."];
  if (r.critical) warnings.push(CRITICAL_WARNING);
  return { id: r.id, critical: r.critical, warnings };
}

/** A specimen rejection withdraws any preliminary report on it (a new 'cancelled' version), so the
 *  order returns to "to collect" with the reason visible (lib/emr/orders.ts). */
export async function withdrawPreliminary(
  ctx: WriteCtx,
  patientUserId: string,
  order: OrderRow,
  specimenId: string,
  reasonCode: string,
): Promise<number> {
  const reports = await ctx.tx
    .select()
    .from(diagnosticReports)
    .where(eq(diagnosticReports.orderId, order.id));
  const chains = new Map<string, ReportRow[]>();
  for (const r of reports) chains.set(r.logicalId, [...(chains.get(r.logicalId) ?? []), r]);
  let withdrawn = 0;
  for (const chain of chains.values()) {
    const current = currentVersion(chain)!;
    if (current.status !== "preliminary" || (current.specimenId ?? specimenId) !== specimenId)
      continue;
    await writeReportVersion(ctx, {
      patientUserId,
      order,
      test: await loadTest(ctx.tx, order.testId),
      prior: current,
      status: "cancelled",
      entry: {
        entryMode: current.entryMode as Entry["entryMode"],
        source: current.source as Entry["source"],
        poc: false,
      },
      specimen: await loadSpecimen(ctx, current.specimenId),
      values: [],
      enteredByUserId: current.enteredByUserId,
      verifiedByUserId: null,
      reasonCode,
      clientKey: null,
      criticalRefs: [],
    });
    withdrawn++;
  }
  return withdrawn;
}

/* ─── acknowledgeResults (D-EMR-07) ──────────────────────────────── */

export interface AckItem {
  reportId: string;
  action: "seen" | "acted" | "forwarded";
  forwardedToUserId?: string;
  note?: string;
}

export interface AcknowledgeResultsInput {
  patientUserId: string;
  items: AckItem[];
  /** Batch key; each item replays on `<clientKey>:<reportId>`. */
  clientKey: string;
}

/**
 * The orderer or their cover acknowledges. ponytail: "cover" = a clinician in the orderer's
 * department at this hospital, or whoever the result was forwarded to (brief W2); a cover rota
 * replaces the department rule when one exists.
 */
async function requireResponsible(
  ctx: WriteCtx,
  report: ReportRow,
  acks: readonly { forwardedToUserId: string | null }[],
): Promise<void> {
  const { actor } = ctx;
  const [order] = report.orderId
    ? await ctx.tx
        .select({ orderer: encounterOrders.authoredByUserId })
        .from(encounterOrders)
        .where(eq(encounterOrders.id, report.orderId))
    : [];
  const orderer = order?.orderer ?? report.enteredByUserId;
  if (orderer === actor.userId) return;
  if (acks.some((a) => a.forwardedToUserId === actor.userId)) return;
  if (orderer && actor.departmentId) {
    const [cover] = await ctx.tx
      .select({ id: staffAffiliations.id })
      .from(staffAffiliations)
      .where(
        and(
          eq(staffAffiliations.userId, orderer),
          eq(staffAffiliations.hospitalId, actor.hospitalId),
          eq(staffAffiliations.departmentId, actor.departmentId),
          inArray(staffAffiliations.state, ["active", "approved"]),
        ),
      )
      .limit(1);
    if (cover) return;
  }
  throw new EmrWriteError(
    "forbidden",
    "Only the ordering clinician, or whoever covers them, acknowledges this result.",
  );
}

export async function acknowledgeResults(
  ctx: WriteCtx,
  input: AcknowledgeResultsInput,
): Promise<WriteResult & { ackIds: string[] }> {
  requireCadre(ctx, ORDERING_CADRES, "acknowledge results");
  if (input.items.length === 0) throw invalid("Nothing to acknowledge.");
  const { tx, actor, now } = ctx;
  const ackIds: string[] = [];
  for (const item of input.items) {
    const key = `${input.clientKey}:${item.reportId}`;
    const replay = await replayed(tx, resultAcknowledgements, key, input.patientUserId);
    if (replay) {
      ackIds.push(replay);
      continue;
    }
    const report = await currentReport(ctx, input.patientUserId, item.reportId);
    const chain = await tx
      .select()
      .from(diagnosticReports)
      .where(eq(diagnosticReports.logicalId, report.logicalId));
    const acks = await tx
      .select()
      .from(resultAcknowledgements)
      .where(
        inArray(
          resultAcknowledgements.reportId,
          chain.map((c) => c.id),
        ),
      );
    const state = ackState(chain, acks);
    if (state.kind === "not_released")
      throw new EmrWriteError(
        "conflict",
        "A preliminary result is acknowledged once the laboratory releases it.",
      );
    if (state.kind === "withdrawn")
      throw new EmrWriteError("conflict", "This result was withdrawn.");
    await requireResponsible(ctx, report, acks);
    const forwarded = item.action === "forwarded";
    if (
      forwarded &&
      (!item.forwardedToUserId ||
        item.forwardedToUserId === actor.userId ||
        !(await isHospitalStaff(ctx, item.forwardedToUserId)))
    )
      throw invalid("Forward to another clinician at this hospital.");
    const note = item.note?.trim();
    const [a] = await tx
      .insert(resultAcknowledgements)
      .values({
        reportId: report.id,
        hospitalId: actor.hospitalId,
        patientUserId: input.patientUserId,
        acknowledgedByUserId: actor.userId,
        acknowledgerCadre: actor.cadreCode,
        action: item.action,
        forwardedToUserId: forwarded ? item.forwardedToUserId! : null,
        noteCiphertext: note ? encrypt(note) : null,
        recordedAt: now,
        clientKey: key,
      })
      .returning({ id: resultAcknowledgements.id });
    await stampActivity(ctx, report.encounterId);
    ackIds.push(a!.id);
  }
  return { id: ackIds[0]!, ackIds };
}

/* ─── recordCriticalCommunication (D-EMR-06) ─────────────────────── */

export interface CriticalCommunicationInput {
  patientUserId: string;
  reportId: string;
  communicatedToUserId: string;
  communicatedToRole: "orderer" | "covering_clinician" | "in_charge";
  method: "in_app" | "phone" | "in_person";
  readBack: boolean;
  communicatedAt?: Date;
  clientKey: string;
}

/** The laboratory records who it told, how, when and whether it was read back. */
export async function recordCriticalCommunication(
  ctx: WriteCtx,
  input: CriticalCommunicationInput,
): Promise<WriteResult> {
  requireCadre(ctx, LAB_CADRES, "record a critical-result call");
  const replay = await replayed(
    ctx.tx,
    criticalResultCommunications,
    input.clientKey,
    input.patientUserId,
  );
  if (replay) return { id: replay };
  const report = await currentReport(ctx, input.patientUserId, input.reportId);
  if (isWithdrawn(report.status)) throw new EmrWriteError("conflict", "This result was withdrawn.");
  if (!(await isHospitalStaff(ctx, input.communicatedToUserId)))
    throw invalid("The person told must be staff at this hospital.");
  const at = input.communicatedAt ?? ctx.now;
  if (at.getTime() > ctx.now.getTime()) throw invalid("The call cannot be in the future.");
  const [c] = await ctx.tx
    .insert(criticalResultCommunications)
    .values({
      reportId: report.id,
      hospitalId: ctx.actor.hospitalId,
      patientUserId: input.patientUserId,
      communicatedByUserId: ctx.actor.userId,
      communicatedToUserId: input.communicatedToUserId,
      communicatedToRole: input.communicatedToRole,
      method: input.method,
      readBack: input.readBack,
      communicatedAt: at,
      recordedAt: ctx.now,
      clientKey: input.clientKey,
    })
    .returning({ id: criticalResultCommunications.id });
  await stampActivity(ctx, report.encounterId);
  return { id: c!.id };
}
