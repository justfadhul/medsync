import "server-only";

import { randomUUID } from "node:crypto";
import type { WriteCtx } from "./context";
import type { WriteResult } from "./orders";
import type { ObservationFact } from "@/lib/facts/types";
import type { PrescribePlace } from "@/lib/prescribing/places";
import type { OtherMedicine } from "@/lib/prescribing/plan-checks";
import type { PlanRx } from "@/lib/prescribing/plan-rx";
import type {
  BuilderInput,
  ProtoAnswer,
  ProtoCheck,
  QuickRules as Rules,
  StartValues,
} from "@/lib/protocols/quick";
import { and, desc, eq, isNull, or } from "drizzle-orm";

import { nurseTasks } from "@/db/schema/nurse-workspace";
import { prescriptions } from "@/db/schema/prescribing";
import { protocols, protocolVersions } from "@/db/schema/protocols";
import { TEST_UUIDS } from "@/lib/clerking/impression/load";
import { readAsClinician } from "@/lib/emr/db";
import { prescribeV2LiveFor } from "@/lib/emr/feature";
import { ivLinesFor } from "@/lib/emr/read/nursing";
import { loadFactSnapshot } from "@/lib/facts/loader";
import { drugById } from "@/lib/prescribing/formulary";
import { needingAnswer, planChecks } from "@/lib/prescribing/plan-checks";
import { willRead } from "@/lib/prescribing/plan-rx";
import {
  bandOf,
  canStart,
  fromBuilder,
  planOf,
  protocolChecks,
  QuickRules,
  supplyOf,
  verifyProtocol,
} from "@/lib/protocols/quick";
import { EmrWriteError } from "./context";
import { openEncounter, placeOrders, requireCadre } from "./orders";
import { loadPlanFacts, sendPrescribed } from "./plan";
import { prescribeRequirement, PRESCRIBING_CADRES } from "./prescriptions";

/**
 * Quick protocols inside Prescribe (prescribing kit P3, F6). Every check runs here from the record,
 * whatever the screen showed: the version must start (`canStart`: signed, in production), every
 * blocking check needs its answer, and the first supply goes as one placement through
 * `sendPrescribed`, where each medicine's own checks run again. Signing needs two different
 * consultants (or the DTC chair and a consultant); the database holds that too (0282).
 */

const invalid = (m: string) => new EmrWriteError("invalid", m);
const conflict = (m: string) => new EmrWriteError("conflict", m);

/** Who signs a protocol version (FEATURES §5). The DTC chair has no role in MedSync yet (0282 allows it). */
export const PROTOCOL_SIGNER_CADRES: readonly string[] = ["CONSULTANT", "SENIOR_CONSULTANT"];

/* ─── Versions ───────────────────────────────────────────────────── */

const visible = (hospitalId: string) =>
  and(
    or(isNull(protocols.hospitalId), eq(protocols.hospitalId, hospitalId)),
    or(isNull(protocolVersions.hospitalId), eq(protocolVersions.hospitalId, hospitalId)),
  );

const versionCols = {
  id: protocolVersions.id,
  protocolId: protocolVersions.protocolId,
  hospitalId: protocolVersions.hospitalId,
  version: protocolVersions.version,
  status: protocolVersions.status,
  rules: protocolVersions.rules,
  seed: protocolVersions.seed,
  slotMinutes: protocolVersions.slotMinutes,
  slotCount: protocolVersions.slotCount,
  source: protocolVersions.source,
  signer1UserId: protocolVersions.signer1UserId,
  signer2UserId: protocolVersions.signer2UserId,
  signedAt: protocolVersions.signedAt,
  name: protocols.name,
  groupKey: protocols.groupKey,
};
type VersionRow = Awaited<ReturnType<typeof versionFor>>;

export async function versionFor(ctx: WriteCtx, versionId: string) {
  const [row] = await ctx.tx
    .select(versionCols)
    .from(protocolVersions)
    .innerJoin(protocols, eq(protocols.id, protocolVersions.protocolId))
    .where(and(eq(protocolVersions.id, versionId), visible(ctx.actor.hospitalId)));
  if (!row) throw new EmrWriteError("not_found", "That protocol is not here.");
  return row;
}

export interface ProtocolItem {
  protocolId: string;
  versionId: string;
  version: number;
  name: string;
  group: string;
  status: "draft" | "signed";
  signedAt: string | null;
  signatures: number;
  source: string;
  slotMinutes: number;
  slotCount: number;
  startable: boolean;
  /** This user signed it already (they cannot be the second signer). */
  signedByMe: boolean;
}

/**
 * The protocols this hospital sees, one version each: its own newest signed version, else its newest
 * draft (a copy being signed, or the builder's), else the MedSync seed.
 */
export async function listProtocols(
  ctx: WriteCtx,
): Promise<{ items: ProtocolItem[]; canSign: boolean }> {
  const rows = await ctx.tx
    .select(versionCols)
    .from(protocolVersions)
    .innerJoin(protocols, eq(protocols.id, protocolVersions.protocolId))
    .where(visible(ctx.actor.hospitalId))
    .orderBy(protocols.name, desc(protocolVersions.version));
  const rank = (r: VersionRow) => (r.hospitalId ? (r.status === "signed" ? 0 : 1) : 2);
  const best = new Map<string, VersionRow>();
  for (const r of rows) {
    const had = best.get(r.protocolId);
    if (!had || rank(r) < rank(had)) best.set(r.protocolId, r);
  }
  const items = [...best.values()].map((r) => ({
    protocolId: r.protocolId,
    versionId: r.id,
    version: r.version,
    name: r.name,
    group: r.groupKey,
    status: r.status as "draft" | "signed",
    signedAt: r.signedAt?.toISOString() ?? null,
    signatures: (r.signer1UserId ? 1 : 0) + (r.signer2UserId ? 1 : 0),
    source: r.source,
    slotMinutes: r.slotMinutes,
    slotCount: r.slotCount,
    startable: canStart(r),
    signedByMe: r.signer1UserId === ctx.actor.userId || r.signer2UserId === ctx.actor.userId,
  }));
  return { items, canSign: PROTOCOL_SIGNER_CADRES.includes(ctx.actor.cadreCode) };
}

/* ─── The patient the protocol is for ────────────────────────────── */

const SOURCE: Record<string, string> = {
  clinical_observations: "vitals",
  triage_records: "triage",
};

export interface StartRow {
  key: string;
  label: string;
  unit: string;
  options: string[] | null;
  value: string | null;
  source: string | null;
  at: string | null;
  typed: boolean;
  orderable: boolean;
  bands: { range: string; text: string; on: boolean; stop: boolean }[];
}

async function startValues(
  ctx: WriteCtx,
  patientUserId: string,
  rules: Rules,
  typed: Record<string, string>,
) {
  const concepts = [...new Set(rules.start.flatMap((s) => (s.fact ? [s.fact] : [])))];
  const snap = concepts.length
    ? await readAsClinician(ctx.tx, () =>
        loadFactSnapshot(ctx.tx, patientUserId, {
          manifest: concepts,
          asOf: ctx.now,
          purpose: "interactive",
        }),
      )
    : null;
  const values: StartValues = {};
  const rows: StartRow[] = rules.start.map((s) => {
    const f = snap?.facts.find(
      (x): x is ObservationFact =>
        x.concept === s.fact && x.kind === "observation" && x.value.type === "quantity",
    );
    const q = f && f.value.type === "quantity" ? f.value.canonical : null;
    const t = typed[s.key]?.trim();
    const value = t ? t : q ? String(q.value) : null;
    values[s.key] = value;
    const at = !t && f ? ("at" in f.effective ? f.effective.at : f.effective.start) : null;
    return {
      key: s.key,
      label: s.label,
      unit: s.unit,
      options: s.options ?? null,
      value,
      source: t ? null : f ? (SOURCE[f.provenance.table] ?? "results") : null,
      at,
      typed: !!t,
      orderable: !!(s.test && TEST_UUIDS[s.test]),
      bands: (s.bands ?? []).map((b) => ({
        range: b.range,
        text: b.text,
        on: false,
        stop: !!b.stop,
      })),
    };
  });
  return { values, rows };
}

/** Lines of the same protocol still active for this patient. */
async function running(ctx: WriteCtx, patientUserId: string, protocolId: string) {
  const [row] = await ctx.tx
    .select({ id: prescriptions.id })
    .from(prescriptions)
    .innerJoin(protocolVersions, eq(protocolVersions.id, prescriptions.protocolVersionId))
    .where(
      and(
        eq(prescriptions.patientUserId, patientUserId),
        eq(protocolVersions.protocolId, protocolId),
        eq(prescriptions.state, "active"),
      ),
    )
    .limit(1);
  return !!row;
}

/** A cannula recorded this visit, or one asked for (P2 nurse tasks). */
async function ivAccess(ctx: WriteCtx, patientUserId: string) {
  if ((await ivLinesFor(ctx.tx, patientUserId)).length) return true;
  const [open] = await ctx.tx
    .select({ id: nurseTasks.id })
    .from(nurseTasks)
    .where(
      and(
        eq(nurseTasks.patientUserId, patientUserId),
        eq(nurseTasks.type, "iv_cannula"),
        eq(nurseTasks.status, "open"),
      ),
    )
    .limit(1);
  return !!open;
}

/* ─── Preview: what the dialog shows, what the send re-checks ────── */

export interface ProtocolInput {
  patientUserId: string;
  encounterId: string;
  place: PrescribePlace;
  versionId: string;
  /** Starting values typed in the dialog ("Enter one"), by key. */
  typed: Record<string, string>;
}

/** The answers a medicine's own check takes in protocol mode (an allergy: only a senior's). */
const lineAnswers = (code: string, outcome: string): ProtoAnswer[] =>
  outcome === "stop"
    ? code === "allergy"
      ? ["senior_agreed"]
      : ["senior_agreed", "no_alternative"]
    : ["aware_monitor", "senior_agreed", "result_awaited"];

async function prepare(ctx: WriteCtx, input: ProtocolInput, clientKey: string) {
  const v = await versionFor(ctx, input.versionId);
  const parsed = QuickRules.safeParse(v.rules);
  if (!parsed.success) throw new EmrWriteError("config", "This protocol version does not read.");
  const rules = parsed.data;
  const enc = await openEncounter(ctx, input.patientUserId, input.encounterId);
  const facts = await loadPlanFacts(ctx.tx, input.patientUserId, ctx.now);
  const pf = {
    ageYears: facts.ageYears,
    sex: facts.sex,
    weightKg: facts.weight?.kg ?? null,
    pregnant: facts.pregnancy ? facts.pregnancy.state === "pregnant" : null,
  };
  const start = await startValues(ctx, input.patientUserId, rules, input.typed);
  const startable = canStart(v);
  const checks: ProtoCheck[] = protocolChecks(rules, {
    facts: pf,
    start: start.values,
    running: await running(ctx, input.patientUserId, v.protocolId),
    ivLine: await ivAccess(ctx, input.patientUserId),
    startable,
    signed: v.status === "signed",
  });
  const plan = planOf(rules, pf, start.values);
  const supply = supplyOf(rules, pf);
  const holdNote = new Map(plan.filter((p) => p.held).map((p) => [p.id, p.note]));

  // The first supply as lines, built here from the version (never from the screen).
  const lines: PlanRx[] = [];
  const doses: Record<string, { dose: string; quantity: string | null }> = {};
  const labels: string[] = [];
  for (const [i, s] of supply.entries()) {
    const drug = drugById(s.drug);
    if (!drug || !drug.routes.includes(s.route as never))
      throw new EmrWriteError("config", `${s.drug}: not in the formulary by that route.`);
    const key = `${clientKey}:${i}`;
    const held =
      s.step && holdNote.has(s.step) ? `On hold: ${holdNote.get(s.step) ?? ""}`.trim() : "";
    lines.push({
      clientKey: key,
      kind: "drug",
      drugId: drug.id,
      conditionId: null,
      regimenId: null,
      doseNum: null,
      unit: "mg",
      strength: null,
      route: s.route as PlanRx["route"],
      method: null,
      infusionOver: null,
      diluent: null,
      frequency: "stat",
      prn: false,
      course: "single",
      start: "now",
      note: [`${v.name} protocol: given as the protocol sets out.`, held]
        .filter(Boolean)
        .join(" ")
        .slice(0, 500),
      fluid: null,
      answers: [],
      witness: null,
      weightAt: null,
      typedDose: null,
    });
    doses[key] = {
      dose: (s.doseText || `As in the ${v.name} protocol`).slice(0, 400),
      quantity: s.qty != null ? `${s.qty} ${s.unit}` : null,
    };
    labels.push(drug.generic);
  }

  // Each medicine's own checks, as placePlan will run them (this visit's lines, then this basket's).
  const visit = await ctx.tx
    .select({ drugId: prescriptions.drugId, drugName: prescriptions.drugName })
    .from(prescriptions)
    .where(
      and(
        eq(prescriptions.encounterId, enc.id),
        eq(prescriptions.isEmergency, false),
        eq(prescriptions.state, "active"),
      ),
    );
  const others: OtherMedicine[] = visit.map((r) => ({
    drugId: r.drugId,
    classId: drugById(r.drugId)?.class,
    display: r.drugName,
    source: "this_visit",
  }));
  let controlled = false;
  for (const rx of lines) {
    const drug = drugById(rx.drugId)!;
    controlled ||= drug.flags.controlled;
    const found = planChecks(drug, rx, {
      ...facts,
      kidneyTestPlanned: false,
      sepsisTypeProblem: false,
      bloodCulture: "none",
      others: [...others],
      cosign: await prescribeRequirement(ctx, drug.flags.controlled),
      v2: prescribeV2LiveFor(ctx.actor.hospitalId),
    });
    for (const c of found.filter((x) => x.outcome === "stop" && !x.overrideable))
      checks.push({
        id: `line:${drug.id}:${c.code}`,
        level: "stop",
        title: `${drug.generic}: ${c.title}`,
        message: c.message,
        answers: [],
        hard: true,
      });
    for (const c of needingAnswer(found))
      checks.push({
        id: `line:${drug.id}:${c.code}`,
        level: c.outcome === "stop" ? "stop" : "check",
        title: `${drug.generic}: ${c.title}`,
        message: c.message,
        answers: lineAnswers(c.code, c.outcome),
        hard: false,
      });
    others.push({
      drugId: drug.id,
      classId: drug.class,
      display: willRead(rx, drug),
      source: "this_visit",
    });
  }

  return {
    v,
    rules,
    start,
    checks,
    plan,
    supply,
    labels,
    lines,
    doses,
    startable,
    controlled,
    enc,
  };
}

/** What the dialog shows for this protocol and patient. Reading only. */
export async function previewProtocol(ctx: WriteCtx, input: ProtocolInput) {
  requireCadre(ctx, PRESCRIBING_CADRES, "prescribe");
  const p = await prepare(ctx, input, "preview");
  return {
    id: p.v.id,
    protocol: {
      versionId: p.v.id,
      name: p.v.name,
      status: p.v.status as "draft" | "signed",
      source: p.v.source,
      intro: p.rules.intro,
      who: p.rules.who.label,
      slotMinutes: p.v.slotMinutes,
      slotCount: p.v.slotCount,
      startable: p.startable,
    },
    start: p.start.rows.map((r) => {
      const bands = p.rules.start.find((x) => x.key === r.key)!.bands ?? [];
      const hit = bandOf(bands, r.value);
      return { ...r, bands: r.bands.map((b, i) => ({ ...b, on: bands[i] === hit })) };
    }),
    checks: p.checks,
    plan: p.plan,
    supply: p.supply.map((s, i) => ({
      name: p.labels[i]!,
      qty: s.qty,
      unit: s.unit,
      dose: p.doses[p.lines[i]!.clientKey]!.dose,
    })),
    controlled: p.controlled,
  };
}

/**
 * "Sign and send": the protocol's first supply as one placement, refused unless the version can
 * start here (P1) and every check has its answer (P6). What the prescriber saw goes on every line.
 */
export async function startProtocol(
  ctx: WriteCtx,
  input: ProtocolInput & {
    clientKey: string;
    answers: Record<string, string>;
    witness: string | null;
  },
): Promise<WriteResult & { prescriptionIds: string[] }> {
  requireCadre(ctx, PRESCRIBING_CADRES, "start a protocol");
  const p = await prepare(ctx, input, input.clientKey);
  if (!p.startable)
    throw new EmrWriteError("forbidden", "Not signed off: this protocol cannot start.");
  const verdict = verifyProtocol(p.checks, input.answers);
  if (!verdict.ok) throw invalid(verdict.reason!);
  if (p.controlled && !(input.witness && input.witness.trim().length >= 2))
    throw invalid("Record a witness for the controlled medicines.");
  const lines = p.lines.map((rx) => ({
    ...rx,
    witness: drugById(rx.drugId)!.flags.controlled ? input.witness!.trim() : null,
    answers: p.checks
      .filter((c) => c.id.startsWith(`line:${rx.drugId}:`) && c.answers.length)
      .map((c) => ({
        code: c.id.split(":")[2]!,
        answer: input.answers[c.id] as PlanRx["answers"][number]["answer"],
      })),
  }));
  const startRecord = {
    protocolId: p.v.protocolId,
    name: p.v.name,
    version: p.v.version,
    status: p.v.status,
    start: p.start.rows.map((r) => ({
      key: r.key,
      label: r.label,
      value: r.value,
      unit: r.unit,
      source: r.typed ? "entered here" : r.source,
      at: r.at,
    })),
    held: p.plan.filter((s) => s.held).map((s) => s.id),
    answers: Object.fromEntries(
      p.checks.filter((c) => c.answers.length).map((c) => [c.id, input.answers[c.id]]),
    ),
  };
  return sendPrescribed(ctx, {
    patientUserId: input.patientUserId,
    encounterId: p.enc.id,
    place: input.place,
    lines,
    protocol: { versionId: p.v.id, start: startRecord, lines: p.doses },
  });
}

/** "Order it": a missing starting value's test, through the lab order writer. */
export async function orderStartTest(
  ctx: WriteCtx,
  input: {
    patientUserId: string;
    encounterId: string;
    versionId: string;
    key: string;
    clientKey: string;
  },
): Promise<WriteResult & { orderIds: string[] }> {
  const v = await versionFor(ctx, input.versionId);
  const s = QuickRules.parse(v.rules).start.find((x) => x.key === input.key);
  const testId = s?.test ? TEST_UUIDS[s.test] : undefined;
  if (!testId) throw invalid("That value is not ordered as a test: enter it.");
  return placeOrders(ctx, {
    patientUserId: input.patientUserId,
    encounterId: input.encounterId,
    orders: [
      {
        clientKey: input.clientKey,
        testId,
        priority: "urgent",
        frequency: "once",
        reasonText: `Starting ${s!.label.toLowerCase()} for the ${v.name} protocol`,
      },
    ],
  });
}

/* ─── Sign-off and the builder ───────────────────────────────────── */

/**
 * A consultant signs a version. A MedSync seed is never signed itself: the first signature makes
 * this hospital's own copy (local sign-off) and signs that. The second signer must be someone else;
 * then the version is signed and frozen (0282 CHECKs and trigger).
 */
export async function signProtocolVersion(
  ctx: WriteCtx,
  input: { versionId: string },
): Promise<WriteResult & { signed: boolean }> {
  requireCadre(ctx, PROTOCOL_SIGNER_CADRES, "sign off a protocol");
  let v = await versionFor(ctx, input.versionId);
  if (v.status === "signed") throw conflict("This version is already signed off.");
  if (!v.hospitalId) {
    // An existing copy being signed here takes the signature, never a second copy.
    const [copy] = await ctx.tx
      .select({ id: protocolVersions.id, status: protocolVersions.status })
      .from(protocolVersions)
      .where(
        and(
          eq(protocolVersions.protocolId, v.protocolId),
          eq(protocolVersions.hospitalId, ctx.actor.hospitalId),
        ),
      )
      .orderBy(desc(protocolVersions.version))
      .limit(1);
    if (copy?.status === "draft") v = await versionFor(ctx, copy.id);
    else {
      const [made] = await ctx.tx
        .insert(protocolVersions)
        .values({
          protocolId: v.protocolId,
          hospitalId: ctx.actor.hospitalId,
          version: v.version,
          status: "draft",
          rules: v.rules,
          seed: v.seed,
          slotMinutes: v.slotMinutes,
          slotCount: v.slotCount,
          source: v.source,
          createdAt: ctx.now,
          createdByUserId: ctx.actor.userId,
        })
        .returning({ id: protocolVersions.id });
      v = await versionFor(ctx, made!.id);
    }
  }
  if (!v.signer1UserId) {
    await ctx.tx
      .update(protocolVersions)
      .set({
        signer1UserId: ctx.actor.userId,
        signer1Role: ctx.actor.cadreCode,
        signer1At: ctx.now,
      })
      .where(eq(protocolVersions.id, v.id));
    return { id: v.id, signed: false };
  }
  if (v.signer1UserId === ctx.actor.userId)
    throw conflict("You signed this version already. A second, different consultant signs.");
  await ctx.tx
    .update(protocolVersions)
    .set({
      signer2UserId: ctx.actor.userId,
      signer2Role: ctx.actor.cadreCode,
      signer2At: ctx.now,
      status: "signed",
      signedAt: ctx.now,
    })
    .where(eq(protocolVersions.id, v.id));
  return { id: v.id, signed: true };
}

/** The builder: a hospital's own protocol, saved as a draft version 1. It cannot start until signed. */
export async function saveProtocolDraft(ctx: WriteCtx, input: BuilderInput): Promise<WriteResult> {
  requireCadre(ctx, PRESCRIBING_CADRES, "build a protocol");
  for (const s of input.steps)
    if (s.drug && !drugById(s.drug)) throw invalid("A step names a medicine not in the formulary.");
  // ponytail: builder protocols chart in 1-hour slots × 24; add a slot field when a hospital needs another.
  const rules = fromBuilder(
    input,
    (id) => drugById(id)?.generic,
    (id) => drugById(id)?.routes,
  );
  const id = `custom-${randomUUID()}`;
  await ctx.tx.insert(protocols).values({
    id,
    hospitalId: ctx.actor.hospitalId,
    name: input.name,
    groupKey: "custom",
    createdAt: ctx.now,
    createdByUserId: ctx.actor.userId,
  });
  const [row] = await ctx.tx
    .insert(protocolVersions)
    .values({
      protocolId: id,
      hospitalId: ctx.actor.hospitalId,
      version: 1,
      status: "draft",
      rules,
      slotMinutes: 60,
      slotCount: 24,
      source: "Created here",
      createdAt: ctx.now,
      createdByUserId: ctx.actor.userId,
    })
    .returning({ id: protocolVersions.id });
  return { id: row!.id };
}
