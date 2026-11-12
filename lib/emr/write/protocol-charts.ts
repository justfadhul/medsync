import "server-only";

import type { WriteCtx } from "./context";
import type { WriteResult } from "./orders";
import type { ObservationFact } from "@/lib/facts/types";
import type { PrescribePlace } from "@/lib/prescribing/places";
import type {
  Act,
  ChartEvent,
  ChartFacts,
  ChartVersion,
  ChartView,
  Role,
} from "@/lib/protocols/engine/types";
import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { problemList } from "@/db/schema/encounter";
import { nurseTasks } from "@/db/schema/nurse-workspace";
import { protocolChartEvents, protocolCharts } from "@/db/schema/protocols";
import { TEST_UUIDS } from "@/lib/clerking/impression/load";
import { readAsClinician } from "@/lib/emr/db";
import { ivLinesFor } from "@/lib/emr/read/nursing";
import { loadFactSnapshot } from "@/lib/facts/loader";
import { egfrOf } from "@/lib/prescribing/plan-checks";
import { deriveChart, isOffered } from "@/lib/protocols/engine/derive";
import { fold } from "@/lib/protocols/engine/fold";
import { GCS_PARTS, groupOf, KEY_CONCEPTS, KEY_OF_CONCEPT } from "@/lib/protocols/engine/keys";
import { makeKit } from "@/lib/protocols/engine/kit";
import { canStart } from "@/lib/protocols/quick";
import { moduleFor } from "@/lib/protocols/rules";
import { EmrWriteError } from "./context";
import { recordObservations } from "./facts";
import { raiseNurseTask } from "./nursing";
import {
  loadOrder,
  NURSE_CADRES,
  openEncounter,
  ORDERING_CADRES,
  placeOrders,
  requireCadre,
} from "./orders";
import { loadPlanFacts } from "./plan";
import { PRESCRIBING_CADRES } from "./prescriptions";
import { startProtocol, versionFor } from "./protocols";
import { enterResults } from "./results";

/**
 * Protocol charts (prescribing kit P4, F7–F8). The chart is its events: every write re-derives the
 * chart from the record and accepts an act only when the chart offers it to this role now
 * (`isOffered`: the P2 role gates and the P6 blocks, whatever the screen showed). The nurse tasks
 * the chart raises are kept in step after each write (`syncTasks`).
 */

const invalid = (m: string) => new EmrWriteError("invalid", m);
const conflict = (m: string) => new EmrWriteError("conflict", m);
const forbidden = (m: string) => new EmrWriteError("forbidden", m);

/** Who the signed-in user is on a chart: the doctor, the nurse, else the pharmacy (reads only). */
export function roleOf(cadreCode: string): Role {
  if (ORDERING_CADRES.includes(cadreCode)) return "dr";
  if (NURSE_CADRES.includes(cadreCode)) return "rn";
  return "ph";
}

const roleFor = (ctx: WriteCtx, need?: Role) => {
  const r = roleOf(ctx.actor.cadreCode);
  if (r === "ph") throw forbidden("The pharmacy reads the chart; it does not write on it.");
  if (need && r !== need)
    throw forbidden(need === "dr" ? "Only the doctor does this." : "Only the nurse does this.");
  return r;
};

/* ─── Reading the chart ──────────────────────────────────────────── */

type ChartRow = typeof protocolCharts.$inferSelect;

/** The chart, here, and (from an action) of the patient the access rule was checked for. */
async function chartRow(ctx: WriteCtx, chartId: string, patientUserId?: string): Promise<ChartRow> {
  const [c] = await ctx.tx
    .select()
    .from(protocolCharts)
    .where(
      and(eq(protocolCharts.id, chartId), eq(protocolCharts.hospitalId, ctx.actor.hospitalId)),
    );
  if (!c || (patientUserId && c.patientUserId !== patientUserId))
    throw new EmrWriteError("not_found", "That chart is not here.");
  return c;
}

async function chartVersion(ctx: WriteCtx, versionId: string): Promise<ChartVersion> {
  const v = await versionFor(ctx, versionId);
  return {
    protocolId: v.protocolId,
    name: v.name,
    status: v.status as "draft" | "signed",
    source: v.source,
    slotMinutes: v.slotMinutes,
    slotCount: v.slotCount,
    rules: v.rules,
    seed: (v.seed ?? {}) as Record<string, unknown>,
  };
}

async function chartEvents(ctx: WriteCtx, chartId: string): Promise<ChartEvent[]> {
  const rows = await ctx.tx
    .select()
    .from(protocolChartEvents)
    .where(eq(protocolChartEvents.chartId, chartId))
    .orderBy(asc(protocolChartEvents.at));
  return rows.map((e) => ({
    id: e.id,
    type: e.type,
    payload: e.payload as Record<string, unknown>,
    role: e.actorRole as Role,
    at: e.at.getTime(),
    reversesId: e.reversesId,
  }));
}

/** The patient's facts the engine reads: who, weight, kidneys, problems, results by chart key, lines. */
async function chartFacts(
  ctx: WriteCtx,
  patientUserId: string,
  events: ChartEvent[],
): Promise<ChartFacts> {
  const pf = await loadPlanFacts(ctx.tx, patientUserId, ctx.now);
  const snap = await readAsClinician(ctx.tx, () =>
    loadFactSnapshot(ctx.tx, patientUserId, {
      manifest: [...new Set(Object.values(KEY_CONCEPTS).map((k) => k.concept))],
      asOf: ctx.now,
      purpose: "interactive",
    }),
  );
  const results: ChartFacts["results"] = {};
  for (const f of snap.facts) {
    if (f.kind !== "observation" || f.value.type !== "quantity") continue;
    const key = KEY_OF_CONCEPT[f.concept];
    if (!key || results[key]) continue;
    const o = f as ObservationFact;
    const at = "at" in o.effective ? o.effective.at : o.effective.start;
    results[key] = {
      value: f.value.type === "quantity" ? f.value.canonical.value : NaN,
      source: o.provenance.table === "clinical_observations" ? "vitals" : "results",
      at: new Date(at).getTime(),
    };
  }
  const problems = await ctx.tx
    .select({ item: problemList.item })
    .from(problemList)
    .where(and(eq(problemList.patientUserId, patientUserId), eq(problemList.active, true)));
  // ponytail: "ordered, waiting" comes from the chart's own orders; an order placed elsewhere is
  // not seen until its result lands. Read open encounter orders when that matters.
  const pending: Record<string, number> = {};
  const reversed = new Set(events.flatMap((e) => (e.reversesId ? [e.reversesId] : [])));
  for (const e of events)
    if (e.type === "order" && !reversed.has(e.id))
      for (const k of (e.payload.keys as string[] | undefined) ?? [])
        if (!results[k] || results[k]!.at < e.at) pending[k] = e.at;
  const lines = await ivLinesFor(ctx.tx, patientUserId);
  const [ivTask] = await ctx.tx
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
  const eg = egfrOf(pf);
  return {
    ageYears: pf.ageYears,
    sex: pf.sex,
    weightKg: pf.weight?.kg ?? null,
    weightFrom: pf.weight?.source ?? null,
    pregnant: pf.pregnancy ? pf.pregnancy.state === "pregnant" : null,
    problems: problems.map((p) => p.item),
    creatinine: pf.creatinine?.value ?? null,
    egfr: eg?.value ?? null,
    results,
    pending,
    ivLines: lines.map((l) => `${l.size}, ${l.site}`),
    ivTaskOpen: !!ivTask,
  };
}

export interface LoadedChart {
  chart: ChartRow;
  version: ChartVersion;
  events: ChartEvent[];
  facts: ChartFacts;
  view: ChartView;
  role: Role;
}

/** One chart as this user sees it now. Reading only. */
export async function loadChart(
  ctx: WriteCtx,
  input: { chartId: string; patientUserId?: string },
): Promise<LoadedChart> {
  const chart = await chartRow(ctx, input.chartId, input.patientUserId);
  const version = await chartVersion(ctx, chart.protocolVersionId);
  const events = await chartEvents(ctx, chart.id);
  const facts = await chartFacts(ctx, chart.patientUserId, events);
  const view = deriveChart(version, { startedAt: chart.startedAt }, events, facts, ctx.now);
  return { chart, version, events, facts, view, role: roleOf(ctx.actor.cadreCode) };
}

/** The patient's charts, running first. */
export async function listPatientCharts(ctx: WriteCtx, patientUserId: string) {
  return ctx.tx
    .select({
      id: protocolCharts.id,
      protocolId: protocolCharts.protocolId,
      versionId: protocolCharts.protocolVersionId,
      startedAt: protocolCharts.startedAt,
      endedAt: protocolCharts.endedAt,
      endReason: protocolCharts.endReason,
    })
    .from(protocolCharts)
    .where(
      and(
        eq(protocolCharts.patientUserId, patientUserId),
        eq(protocolCharts.hospitalId, ctx.actor.hospitalId),
      ),
    )
    .orderBy(sql`${protocolCharts.endedAt} IS NOT NULL`, sql`${protocolCharts.startedAt} DESC`);
}

/* ─── Writing ────────────────────────────────────────────────────── */

async function addEvent(
  ctx: WriteCtx,
  chart: ChartRow,
  role: Role,
  e: {
    type: string;
    payload?: Record<string, unknown>;
    clientKey: string;
    reversesId?: string;
    reason?: string;
  },
): Promise<string> {
  const [row] = await ctx.tx
    .insert(protocolChartEvents)
    .values({
      chartId: chart.id,
      hospitalId: chart.hospitalId,
      patientUserId: chart.patientUserId,
      protocolVersionId: chart.protocolVersionId,
      type: e.type,
      payload: e.payload ?? {},
      actorUserId: ctx.actor.userId,
      actorRole: role,
      actorCadre: ctx.actor.cadreCode,
      at: ctx.now,
      reversesId: e.reversesId ?? null,
      reason: e.reason ?? null,
      clientKey: e.clientKey,
    })
    .onConflictDoNothing()
    .returning({ id: protocolChartEvents.id });
  if (row) return row.id;
  const [had] = await ctx.tx
    .select({ id: protocolChartEvents.id })
    .from(protocolChartEvents)
    .where(eq(protocolChartEvents.clientKey, e.clientKey));
  return had!.id;
}

/**
 * P11: a nurse's entry queued offline is resent until a reply arrives, so a resend may find it
 * already saved (the reply was lost). It returns that event, not a refusal from the chart as it is
 * now (the dose is no longer due, the slot has moved on).
 */
async function savedBefore(ctx: WriteCtx, chartId: string, clientKey: string) {
  const [had] = await ctx.tx
    .select({ id: protocolChartEvents.id })
    .from(protocolChartEvents)
    .where(
      and(eq(protocolChartEvents.chartId, chartId), eq(protocolChartEvents.clientKey, clientKey)),
    );
  return had ? { id: had.id } : null;
}

/** The chart's nurse tasks follow the chart: raise what is due, close what the chart no longer asks. */
async function syncTasks(ctx: WriteCtx, chartId: string) {
  const { chart, view } = await loadChart(ctx, { chartId });
  const open = await ctx.tx
    .select({ id: nurseTasks.id, payload: nurseTasks.payload })
    .from(nurseTasks)
    .where(
      and(
        eq(nurseTasks.type, "protocol_step"),
        eq(nurseTasks.sourceId, chart.id),
        eq(nurseTasks.status, "open"),
      ),
    );
  const want = new Map(view.tasks.map((t) => [t.key, t]));
  const have = new Set<string>();
  for (const t of open) {
    const key = String((t.payload as { key?: string }).key ?? "");
    if (want.has(key)) {
      have.add(key);
      continue;
    }
    await ctx.tx
      .update(nurseTasks)
      .set({
        status: view.endedAt ? "cancelled" : "done",
        doneAt: ctx.now,
        doneByUserId: ctx.actor.userId,
        outcome: { on: "protocol_chart" },
      })
      .where(eq(nurseTasks.id, t.id));
  }
  for (const t of view.tasks) {
    if (have.has(t.key)) continue;
    await raiseNurseTask(ctx, {
      patientUserId: chart.patientUserId,
      encounterId: chart.encounterId,
      type: "protocol_step",
      sourceKind: "protocol_chart",
      sourceId: chart.id,
      payload: { key: t.key, title: t.title, sub: t.sub, chartId: chart.id, short: view.short },
      dueAt: new Date(t.at),
      // A key can come back (a second hypo): each raise is its own task.
      clientKey: `pchart:${chart.id}:${t.key}:${ctx.now.getTime()}`,
    });
  }
}

/** Start a chart. A draft version starts only where `canStart` allows (local development, tests). */
export async function startChart(
  ctx: WriteCtx,
  input: { patientUserId: string; encounterId: string; versionId: string; clientKey: string },
): Promise<WriteResult> {
  requireCadre(ctx, PRESCRIBING_CADRES, "start a protocol chart");
  const v = await versionFor(ctx, input.versionId);
  if (!canStart(v)) throw forbidden("Not signed off: this protocol cannot start.");
  const enc = await openEncounter(ctx, input.patientUserId, input.encounterId);
  const [had] = await ctx.tx
    .select()
    .from(protocolCharts)
    .where(eq(protocolCharts.clientKey, input.clientKey));
  if (had) return { id: had.id };
  const [running] = await ctx.tx
    .select({ id: protocolCharts.id })
    .from(protocolCharts)
    .where(
      and(
        eq(protocolCharts.patientUserId, input.patientUserId),
        eq(protocolCharts.protocolId, v.protocolId),
        isNull(protocolCharts.endedAt),
      ),
    );
  if (running) throw conflict("This protocol is already running for this patient.");
  if (v.status !== "signed")
    await ctx.tx.execute(sql`SELECT set_config('medsync.protocol_draft_start', 'on', true)`);
  const [chart] = await ctx.tx
    .insert(protocolCharts)
    .values({
      hospitalId: ctx.actor.hospitalId,
      patientUserId: input.patientUserId,
      encounterId: enc.id,
      protocolId: v.protocolId,
      protocolVersionId: v.id,
      startedAt: ctx.now,
      startedByUserId: ctx.actor.userId,
      clientKey: input.clientKey,
    })
    .returning();
  await addEvent(ctx, chart!, "dr", { type: "start", clientKey: `${input.clientKey}:start` });
  await syncTasks(ctx, chart!.id);
  return { id: chart!.id };
}

const NUM = /^-?\d{1,5}(\.\d{1,3})?$/;

/** One press on the chart: a button, chip, segment, field value, weight, IV request or order. */
export async function chartAct(
  ctx: WriteCtx,
  input: { patientUserId: string; chartId: string; act: Act; value?: string; clientKey: string },
): Promise<WriteResult> {
  const role = roleFor(ctx);
  const again = await savedBefore(ctx, input.chartId, input.clientKey);
  if (again) return again;
  const { chart, view, events } = await loadChart(ctx, input);
  const act = input.act;
  if (["end", "send", "rx", "screen", "proto"].includes(act.t))
    throw invalid("That is done from its own button.");
  if (!isOffered(view, role, act))
    throw forbidden(
      act.t === "give" && act.checks
        ? "Tick every check before the dose."
        : "The chart does not offer this to you now.",
    );
  let payload: Record<string, unknown>;
  switch (act.t) {
    case "value": {
      const x = input.value?.trim() ?? "";
      if (x !== "" && !NUM.test(x)) throw invalid("Enter a number.");
      payload = { key: act.key, value: x };
      if (x !== "")
        await chartValuesToRecord(
          ctx,
          chart,
          events,
          view.short,
          { [act.key]: x },
          input.clientKey,
        );
      break;
    }
    case "weight": {
      const x = input.value?.trim() ?? "";
      const kg = Number(x);
      if (!NUM.test(x) || kg <= 0) throw invalid("Enter the weight in kg.");
      await recordObservations(ctx, {
        patientUserId: chart.patientUserId,
        encounterId: chart.encounterId,
        clientKey: `${input.clientKey}:weight`,
        observations: [
          {
            conceptId: "obs.weight",
            value: { type: "quantity", value: kg, unit: "kg" },
            context: { protocolChartId: chart.id },
          },
        ],
      });
      payload = { kg };
      break;
    }
    case "iv":
      await raiseNurseTask(ctx, {
        patientUserId: chart.patientUserId,
        encounterId: chart.encounterId,
        type: "iv_cannula",
        sourceKind: "protocol_chart",
        sourceId: chart.id,
        payload: { drugs: [view.title], first: "now" },
        dueAt: ctx.now,
        clientKey: `${input.clientKey}:iv`,
      });
      payload = {};
      break;
    case "order": {
      if (!chart.encounterId) throw conflict("The chart has no visit to order on.");
      const tests = [
        ...new Set(act.keys.flatMap((k) => (groupOf(k)?.test ? [groupOf(k)!.test!] : []))),
      ];
      const ids = tests.flatMap((t) => (TEST_UUIDS[t] ? [TEST_UUIDS[t]] : []));
      if (!ids.length) throw invalid("Nothing here is ordered from the lab.");
      const placed = await placeOrders(ctx, {
        patientUserId: chart.patientUserId,
        encounterId: chart.encounterId,
        orders: ids.map((testId, i) => ({
          clientKey: `${input.clientKey}:${i}`,
          testId,
          priority: "urgent",
          frequency: "once",
          reasonText: `For the ${view.short} chart`,
        })),
      });
      // The order ids: a value typed on the chart later answers them (chartValuesToRecord).
      payload = { keys: act.keys, orderIds: placed.orderIds };
      break;
    }
    default: {
      const { t: _t, ...rest } = act;
      payload = rest;
    }
  }
  const id = await addEvent(ctx, chart, role, {
    type: act.t,
    payload,
    clientKey: input.clientKey,
  });
  await syncTasks(ctx, chart.id);
  return { id };
}

/** "Record": the nurse charts the next slot. Only the chart's form keys; the required ones present. */
export async function recordSlot(
  ctx: WriteCtx,
  input: {
    patientUserId: string;
    chartId: string;
    values: Record<string, string>;
    clientKey: string;
  },
): Promise<WriteResult> {
  roleFor(ctx, "rn");
  const again = await savedBefore(ctx, input.chartId, input.clientKey);
  if (again) return again;
  const loaded = await loadChart(ctx, input);
  const { chart, view } = loaded;
  if (view.endedAt) throw conflict("This chart has ended.");
  if (view.blocked) throw conflict(view.blocked);
  if (view.full) throw conflict("Every slot is charted.");
  const keys = new Set(view.form.map((f) => f.key));
  const values: Record<string, string> = {};
  for (const [k, raw] of Object.entries(input.values)) {
    const x = raw.trim();
    if (!keys.has(k)) throw invalid(`${k} is not on this chart.`);
    if (x === "") continue;
    // Urine ketones are a dipstick word; everything else is a number.
    if (k !== "uket" && !NUM.test(x)) throw invalid("Enter numbers only.");
    if (x.length > 20) throw invalid("Too long.");
    values[k] = x;
  }
  for (const k of view.formReq) if (!values[k]) throw invalid("Fill in the values that are due.");
  // The module's values worked out on save (HHS osmolality) and its keys that go to results.
  const B = moduleFor(loaded.version).build(
    makeKit({
      version: loaded.version,
      c: fold(chart.startedAt.getTime(), loaded.events),
      facts: loaded.facts,
      now: ctx.now.getTime(),
    }),
  );
  Object.assign(values, B.derive?.(values) ?? {});
  const id = await addEvent(ctx, chart, "rn", {
    type: "slot",
    payload: { slot: view.nextSlot, values },
    clientKey: input.clientKey,
  });
  const lab = Object.fromEntries(Object.entries(values).filter(([k]) => B.labKeys.includes(k)));
  await chartValuesToRecord(ctx, chart, loaded.events, view.short, lab, input.clientKey);
  await syncTasks(ctx, chart.id);
  return { id };
}

const TEST_OF: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(TEST_UUIDS).map(([code, id]) => [id, code]),
);

/**
 * P5: lab values typed on a chart go to the record, tagged with the chart ("entered on the <short>
 * chart"). A value that answers an order this chart placed is entered on that order through the
 * results writer, which closes it; the writer keeps its own gates (a nurse enters bedside tests
 * only; a released result is amended, not re-entered), and a value it refuses, or one with no chart
 * order, is recorded as an observation instead. Vitals stay on the chart's events.
 */
async function chartValuesToRecord(
  ctx: WriteCtx,
  chart: ChartRow,
  events: readonly ChartEvent[],
  short: string,
  values: Record<string, string>,
  clientKey: string,
): Promise<void> {
  const left = new Set(
    Object.keys(values).filter((k) => values[k] && KEY_CONCEPTS[k] && groupOf(k)),
  );
  if (!left.size) return;
  const tag = { protocolChartId: chart.id, source: `entered on the ${short} chart` };
  const reversed = new Set(events.flatMap((e) => (e.reversesId ? [e.reversesId] : [])));
  const orderIds = new Set(
    events.flatMap((e) =>
      e.type === "order" && !reversed.has(e.id)
        ? ((e.payload.orderIds as string[] | undefined) ?? [])
        : [],
    ),
  );
  for (const orderId of orderIds) {
    const order = await loadOrder(ctx, chart.patientUserId, orderId);
    const test = TEST_OF[order.testId ?? ""];
    const keys = [...left].filter((k) => test && groupOf(k)?.test === test);
    if (!keys.length) continue;
    try {
      // A savepoint: a refusal leaves nothing half-written, and the value goes to observations.
      await ctx.tx.transaction((sp) =>
        enterResults(
          { ...ctx, tx: sp },
          {
            patientUserId: chart.patientUserId,
            orderId,
            status: "final",
            values: keys.map((k) => ({
              conceptId: KEY_CONCEPTS[k]!.concept,
              value: values[k]!,
              unit: KEY_CONCEPTS[k]!.unit,
              extraContext: tag,
            })),
            clientKey: `${clientKey}:result:${orderId}`,
          },
        ),
      );
      for (const k of keys) left.delete(k);
    } catch (e) {
      if (!(e instanceof EmrWriteError)) throw e;
    }
  }
  // One savepoint a value: the record refusing one (an unusual value it wants confirmed) never
  // loses the charting itself, which stays on the chart's events.
  for (const k of left) {
    const c = KEY_CONCEPTS[k]!;
    try {
      await ctx.tx.transaction((sp) =>
        recordObservations(
          { ...ctx, tx: sp },
          {
            patientUserId: chart.patientUserId,
            encounterId: chart.encounterId,
            clientKey: `${clientKey}:obs:${k}`,
            observations: [
              {
                conceptId: c.concept,
                value: { type: "quantity", value: Number(values[k]), unit: c.unit },
                ...(c.specimen ? { specimen: c.specimen } : {}),
                ...(c.fastingState ? { fastingState: c.fastingState } : {}),
                context: tag,
              },
            ],
          },
        ),
      );
    } catch (e) {
      if (!(e instanceof EmrWriteError)) throw e;
      console.warn("protocol_chart.value_not_recorded", k, e.code);
    }
  }
}

/** "Save vitals": BP, pulse, RR, GCS as E/V/M (the total worked out here) and the added parameters. */
export async function recordVitals(
  ctx: WriteCtx,
  input: {
    patientUserId: string;
    chartId: string;
    values: Record<string, string>;
    clientKey: string;
  },
): Promise<WriteResult> {
  roleFor(ctx, "rn");
  const again = await savedBefore(ctx, input.chartId, input.clientKey);
  if (again) return again;
  const { chart, view } = await loadChart(ctx, input);
  if (view.endedAt) throw conflict("This chart has ended.");
  const keys = new Set(view.vitals.inputs.map((i) => i.key));
  const values: Record<string, string> = {};
  for (const [k, raw] of Object.entries(input.values)) {
    const x = raw.trim();
    if (!keys.has(k)) throw invalid(`${k} is not on the vitals card.`);
    if (x === "") continue;
    if (x.length > 20) throw invalid("Too long.");
    // An added parameter may be a word (AVPU, pupils); the base vitals are numbers.
    if (!k.startsWith("cx_") && !NUM.test(x)) throw invalid("Enter numbers only.");
    values[k] = x;
  }
  const parts = GCS_PARTS.map(([k, , max]) => [k, values[k], max] as const);
  const given = parts.filter(([, x]) => x !== undefined);
  if (given.length && given.length < 3) throw invalid("Enter all three of E, V and M.");
  if (given.length === 3) {
    for (const [, x, max] of parts) {
      const n = Number(x);
      if (!Number.isInteger(n) || n < 1 || n > max) throw invalid("E 1–4, V 1–5, M 1–6.");
    }
    values.gcs = String(parts.reduce((s, [, x]) => s + Number(x), 0));
  }
  if (!Object.keys(values).length) throw invalid("Nothing to save.");
  const id = await addEvent(ctx, chart, "rn", {
    type: "vitals",
    payload: { values },
    clientKey: input.clientKey,
  });
  await syncTasks(ctx, chart.id);
  return { id };
}

/** The doctor chooses what is monitored: add or remove a parameter on the vitals card. */
export async function changeParam(
  ctx: WriteCtx,
  input: {
    patientUserId: string;
    chartId: string;
    add?: { name: string; unit: string };
    removeId?: string;
    clientKey: string;
  },
): Promise<WriteResult> {
  roleFor(ctx, "dr");
  const { chart, view } = await loadChart(ctx, input);
  if (view.endedAt) throw conflict("This chart has ended.");
  if (input.add) {
    const name = input.add.name.trim();
    if (name.length < 1 || name.length > 40) throw invalid("Name the parameter.");
    if (view.vitals.tiles.some((t) => t.label === name))
      throw conflict("That is on the card already.");
    return {
      id: await addEvent(ctx, chart, "dr", {
        type: "param_add",
        payload: { name, unit: input.add.unit.trim().slice(0, 12) },
        clientKey: input.clientKey,
      }),
    };
  }
  if (!view.vitals.tiles.some((t) => t.paramId && t.paramId === input.removeId))
    throw invalid("That parameter is not on the card.");
  return {
    id: await addEvent(ctx, chart, "dr", {
      type: "param_remove",
      payload: { id: input.removeId },
      clientKey: input.clientKey,
    }),
  };
}

export async function addChartNote(
  ctx: WriteCtx,
  input: { patientUserId: string; chartId: string; text: string; clientKey: string },
): Promise<WriteResult> {
  const role = roleFor(ctx);
  const chart = await chartRow(ctx, input.chartId, input.patientUserId);
  const text = input.text.trim();
  if (text.length < 1 || text.length > 1000) throw invalid("Write the note.");
  return {
    id: await addEvent(ctx, chart, role, {
      type: "note",
      payload: { text },
      clientKey: input.clientKey,
    }),
  };
}

/** The doctor ends the chart (with a reason) or reopens it. Its open tasks close with it. */
export async function endChart(
  ctx: WriteCtx,
  input: {
    patientUserId: string;
    chartId: string;
    reason?: string;
    reopen?: boolean;
    clientKey: string;
  },
): Promise<WriteResult> {
  roleFor(ctx, "dr");
  const chart = await chartRow(ctx, input.chartId, input.patientUserId);
  if (input.reopen) {
    if (!chart.endedAt) throw conflict("This chart is running.");
    await ctx.tx
      .update(protocolCharts)
      .set({ endedAt: null, endReason: null, reopenedAt: ctx.now })
      .where(eq(protocolCharts.id, chart.id));
    const id = await addEvent(ctx, chart, "dr", { type: "reopen", clientKey: input.clientKey });
    await syncTasks(ctx, chart.id);
    return { id };
  }
  if (chart.endedAt) throw conflict("This chart has ended already.");
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 2) throw invalid("Say why the chart ends.");
  await ctx.tx
    .update(protocolCharts)
    .set({ endedAt: ctx.now, endReason: reason.slice(0, 300) })
    .where(eq(protocolCharts.id, chart.id));
  const id = await addEvent(ctx, chart, "dr", {
    type: "end",
    payload: { reason: reason.slice(0, 300) },
    clientKey: input.clientKey,
  });
  await syncTasks(ctx, chart.id);
  return { id };
}

/** Undo an entry: a reversal event with a reason, by whoever made it or a doctor. */
export async function undoChartEvent(
  ctx: WriteCtx,
  input: {
    patientUserId: string;
    chartId: string;
    eventId: string;
    reason: string;
    clientKey: string;
  },
): Promise<WriteResult> {
  const role = roleFor(ctx);
  const chart = await chartRow(ctx, input.chartId, input.patientUserId);
  const [e] = await ctx.tx
    .select()
    .from(protocolChartEvents)
    .where(
      and(eq(protocolChartEvents.id, input.eventId), eq(protocolChartEvents.chartId, chart.id)),
    );
  if (!e) throw new EmrWriteError("not_found", "That entry is not on this chart.");
  if (["start", "reverse", "end", "reopen", "send"].includes(e.type))
    throw invalid("That entry cannot be undone here.");
  if (e.actorUserId !== ctx.actor.userId && role !== "dr")
    throw forbidden("Only who made the entry, or a doctor, undoes it.");
  const reason = input.reason.trim();
  if (reason.length < 3) throw invalid("Say why it is undone.");
  const id = await addEvent(ctx, chart, role, {
    type: "reverse",
    reversesId: e.id,
    reason,
    clientKey: input.clientKey,
  });
  await syncTasks(ctx, chart.id);
  return { id };
}

/**
 * "Sign and send to the pharmacy": the chart's medicines as one placement through P3's
 * `startProtocol` (every protocol and medicine check again, `sendPrescribed(…, protocol)`).
 */
export async function sendChartOrder(
  ctx: WriteCtx,
  input: {
    patientUserId: string;
    chartId: string;
    place: PrescribePlace;
    answers: Record<string, string>;
    witness: string | null;
    clientKey: string;
  },
): Promise<WriteResult & { prescriptionIds: string[] }> {
  roleFor(ctx, "dr");
  const chart = await chartRow(ctx, input.chartId, input.patientUserId);
  if (chart.endedAt) throw conflict("This chart has ended.");
  if (!chart.encounterId) throw conflict("The chart has no visit to prescribe on.");
  const sent = await startProtocol(ctx, {
    patientUserId: chart.patientUserId,
    encounterId: chart.encounterId,
    place: input.place,
    versionId: chart.protocolVersionId,
    typed: {},
    clientKey: input.clientKey,
    answers: input.answers,
    witness: input.witness,
  });
  await addEvent(ctx, chart, "dr", {
    type: "send",
    payload: { prescriptionIds: sent.prescriptionIds },
    clientKey: `${input.clientKey}:send`,
  });
  return sent;
}
