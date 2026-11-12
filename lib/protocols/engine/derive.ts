import type { Built, Kit, PanelSpec } from "./kit";
import type {
  Act,
  Btn,
  ChartEvent,
  ChartFacts,
  ChartVersion,
  ChartView,
  FlowItem,
  FlowSt,
  Grid,
  LogLine,
  Panel,
  Role,
  Step,
  Task,
  Vitals,
  VitalTile,
} from "./types";

import { CHART_COPY as C, fill } from "@/content/protocol-charts";
import { moduleFor } from "@/lib/protocols/rules";
import { buildSteps } from "@/lib/protocols/rules/steps";
import { fold } from "./fold";
import { GCS_PARTS, groupOf, PARAM_REF } from "./keys";
import { hh, makeKit } from "./kit";

/**
 * `deriveChart(version, chart, events, facts, now)`: the whole chart, recomputed from the events
 * every time (P8). The prototype's `pcView`, without the screen: phases and steps with their status,
 * briefs, the flow chart path, nurse tasks with due times, targets and aims, the grid, the trend
 * series, the vitals card, the pharmacy rows and the drug order lines. No I/O.
 */
export function deriveChart(
  version: ChartVersion,
  chart: { startedAt: Date | number },
  events: readonly ChartEvent[],
  facts: ChartFacts,
  now: Date | number,
): ChartView {
  const start = typeof chart.startedAt === "number" ? chart.startedAt : chart.startedAt.getTime();
  const nowMs = typeof now === "number" ? now : now.getTime();
  const c = fold(start, events);
  const mod = moduleFor(version);
  const K = makeKit({ version, c, facts, now: nowMs });
  const blocked = mod.check(version);
  // A version its module cannot read charts as the plain step list, blocked (nothing is offered).
  const B = blocked ? buildSteps(K) : mod.build(K);
  return assemble(version, K, B, mod.short(version), blocked);
}

function assemble(
  version: ChartVersion,
  K: Kit,
  B: Built,
  short: string,
  blocked: string | null,
): ChartView {
  const { c, hNow, NS, now, due, lbl, num, isH } = K;
  const signed = version.status === "signed";

  // Number the steps; the current phase.
  const phases = B.phases.map((p) => ({
    ...p,
    acts: p.acts.map((a, i) => ({ ...a, n: i + 1, key: `${p.id}${i + 1}` })),
  }));
  const rnActs = B.rn.acts.map((a, i) => ({ ...a, n: i + 1, key: `rn${i + 1}` }));
  const cur =
    phases.find((x) => hNow >= x.from && (x.to === null || hNow < x.to)) ??
    phases[phases.length - 1]!;

  // The flow chart: status by step key; later phases are greyed.
  const byKey = new Map<string, Step>();
  const order = new Map<string, number>();
  phases.forEach((p, i) => {
    order.set(p.id, i);
    for (const a of p.acts) byKey.set(a.key, a);
  });
  const curO = order.get(cur.id) ?? 0;
  const stOf = (key: string): FlowSt => {
    const ph = key.replace(/\d+$/, "");
    if ((order.get(ph) ?? 0) > curO) return "later";
    const a = byKey.get(key);
    return a ? (a.status === "done" ? "done" : a.status === "needs" ? "needs" : "todo") : "todo";
  };
  const flow = B.flow({
    N: (key, title, sub) => ({
      kind: "node",
      key,
      title,
      sub: sub ?? byKey.get(key)?.brief ?? "",
      st: stOf(key),
    }),
    D: (key, q, brs, note) => ({ kind: "dec", key, q, brs, note: note ?? "", st: stOf(key) }),
    Br: (label, sub, state) => ({ label, sub, state }),
    P: (id) => {
      const p = phases.find((x) => x.id === id)!;
      return { kind: "phase", title: `${p.title} · ${p.win}`, now: p === cur };
    },
  });

  // Nurse tasks: the module's, then the chart's own (record, vitals, tests, samples, the cannula).
  const tasks: Task[] = [];
  const overdueMs =
    Number((K.seed.monitor as { overdueMinutes?: number } | undefined)?.overdueMinutes ?? 10) *
    60000;
  const tk = (key: string, title: string, sub: string, at: number, btns: Btn[] = []) =>
    tasks.push({
      key,
      title,
      sub,
      at,
      btns,
      when:
        at <= now
          ? now - at > overdueMs
            ? fill(C.overdue, { d: K.dur(now - at) })
            : C.dueNow
          : fill(C.at, { t: hh(at) }),
      lvl: at <= now ? (now - at > overdueMs ? "alert" : "todo") : "na",
    });
  B.tasks(tk);
  if (K.ivTask) tk("iv", C.ivTaskTitle, C.ivTaskSub, c.start);
  const full = K.nextH > NS;
  if (!full)
    tk(
      `slot${K.nextH}`,
      fill(C.recordSlot, {
        slot: (isH ? C.hour : C.minute).toLowerCase(),
        n: num(K.nextH),
        what: B.recWhat(K.nextH),
      }),
      C.inRecord,
      due(K.nextH),
    );
  const vitals = vitalsCard(K);
  tk(
    "vitals",
    fill(C.recordVitals, {
      extra: c.custom.length ? `, ${c.custom.map((x) => x.name).join(", ")}` : "",
    }),
    `${vitals.last ? fill(C.lastSet, { t: hh(vitals.last) }) : C.noneYet} · ${C.onVitals}`,
    vitals.due,
    [K.btn(C.openChart, { t: "screen", to: "chart" }, null, "link")],
  );
  for (const [k, s] of Object.entries(c.inv))
    if (s === "ordered")
      tk(`inv:${k}`, invName(B, k), C.orderedByDoctor, c.start, [
        K.btn(C.markDone, { t: "inv", key: k, to: "done" }, "rn", "main"),
      ]);
  for (const [k, at] of Object.entries(K.facts.pending)) {
    const g = groupOf(k);
    tk(
      `sample:${g?.name ?? k}`,
      fill(C.sendSample, { test: g?.name ?? k }),
      fill(C.orderedAt, { t: hh(at) }),
      now,
    );
  }
  const seen = new Set<string>();
  const nTasks = c.ended
    ? []
    : tasks
        .filter((t) => (seen.has(t.key) ? false : (seen.add(t.key), true)))
        .sort((a, b) => a.at - b.at);

  // The time grid.
  const lastH = K.obs.length ? K.obs[K.obs.length - 1]!.h : -1;
  const cols = Math.min(NS, Math.max(lastH + 1, hNow, 6));
  const hours = Array.from({ length: cols + 1 }, (_, i) => i);
  const grid: Grid = {
    head: hours.map((h) => ({ t: num(h), now: h === hNow })),
    rows: [
      {
        key: "time",
        label: C.time,
        cells: hours.map((h) => ({ t: hh(due(h)), flag: null, now: h === hNow, due: false })),
      },
      ...B.rows.map(([key, label]) => ({
        key,
        label,
        cells: hours.map((h) => {
          const x = K.obs.find((o) => o.h === h)?.values[key] ?? "";
          return {
            t: x,
            flag: x === "" ? null : B.cellFlag ? B.cellFlag(key, x) : K.interp(key, x),
            now: h === hNow,
            due: x === "" && !!B.dueAt?.(key, h),
          };
        }),
      })),
    ],
  };

  const panels = B.panels.map((o) => panel(K, o));

  // The log: every live event in words.
  const words = { ...C.logWords, ...(B.logWords ?? {}) } as Record<string, string>;
  const log: LogLine[] = c.events.map((e) => ({
    at: e.at,
    text: logText(e, words, isH),
    eventId: e.id,
    role: e.role,
    type: e.type,
  }));

  return {
    protocolId: version.protocolId,
    module: (version.rules as { module?: string | null } | null)?.module ?? "steps",
    title: version.name,
    short,
    over: signed ? version.source : `${version.source} · ${C.prototypeValues}`,
    signed,
    slotMinutes: version.slotMinutes,
    slotCount: NS,
    startedAt: c.start,
    endedAt: c.ended,
    endReason: c.endReason,
    hNow,
    slotWord: isH ? C.hour : C.minute,
    nowWord: isH ? fill(C.hourNow, { n: num(hNow) }) : fill(C.inNow, { t: lbl(hNow) }),
    phase: { id: cur.id, title: cur.title, win: cur.win },
    stats: [
      { k: C.onChart, v: K.dur(K.el), s: fill(C.startedAt, { t: hh(c.start) }) },
      { k: C.phaseWord, v: cur.win, s: cur.title },
      ...B.stats,
    ],
    aims: B.aims,
    phases,
    rn: { ...B.rn, acts: rnActs },
    flow,
    tasks: nTasks,
    grid,
    panels,
    form: B.form,
    formReq: B.formReq,
    nextSlot: K.nextH,
    nextDue: due(K.nextH),
    recHint: B.recHint(K.nextH),
    full,
    vitals,
    meds: B.meds,
    medsNote: B.medsNote ?? C.medsNote,
    phRows: B.phRows,
    log,
    notes: c.notes,
    sentAt: c.sentAt,
    blocked,
  };
}

function invName(B: Built, key: string): string {
  for (const p of B.phases)
    for (const a of p.acts)
      for (const i of a.items)
        if (i.btns.some((b) => b.act.t === "inv" && b.act.key === key)) return i.name;
  return key;
}

function logText(e: ChartEvent, words: Record<string, string>, isH: boolean): string {
  const p = e.payload as Record<string, unknown>;
  const key = typeof p.key === "string" ? p.key : "";
  switch (e.type) {
    case "mark":
    case "give":
      return words[key] ?? (typeof p.word === "string" ? p.word : key);
    case "set":
    case "toggle":
    case "value":
      return fill(C.logSet, { what: words[key] ?? key, value: String(p.value ?? "") });
    case "slot":
      return fill(C.logSlot, { slot: isH ? C.hour : C.minute, n: String(p.label ?? p.slot) });
    case "end":
      return fill(C.logEnd, { reason: String(p.reason ?? "") });
    case "param_add":
      return fill(C.logParam, { name: String(p.name ?? "") });
    case "inv":
      return fill(C.logSet, { what: key, value: String(p.to ?? "") });
    default:
      return (C.logWords as Record<string, string>)[e.type] ?? e.type;
  }
}

function panel(K: Kit, o: PanelSpec): Panel {
  const q = K.ptsOf(o.key);
  const f = o.fmt ?? K.n1;
  const last = q[q.length - 1];
  return {
    key: o.key,
    name: o.name,
    unit: o.unit,
    min: Math.min(o.min, ...q.map((x) => x.v)),
    max: Math.max(o.max, ...q.map((x) => x.v)),
    ticks: o.ticks,
    thr: (o.thr ?? []).map(([v, label, lvl]) => ({ v, label, lvl })),
    points: q.map((x) => ({ h: x.h, v: x.v, at: x.at, bad: !!o.bad?.(x.v) })),
    target: o.target && q.length ? o.target(q[0]!) : [],
    status: o.status ?? "",
    stLvl: o.stLvl ?? "",
    latest: last ? `${f(last.v)}${o.unit ? ` ${o.unit}` : ""} · ${K.lbl(last.h)}` : C.noValues,
  };
}

/** The vitals card (the prototype's `dkVitals`): BP, pulse, RR, GCS (E/V/M) and added parameters. */
function vitalsCard(K: Kit): Vitals {
  const { c, now } = K;
  const vit = c.vit;
  const every =
    Number((K.seed.monitor as { vitalsMinutes?: number } | undefined)?.vitalsMinutes ?? K.slotMin) *
    60000;
  const refOf = (k: string) => {
    if (K.refs[k]) return k;
    const p = c.custom.find((x) => `cx_${x.id}` === k);
    return p ? (PARAM_REF[p.name] ?? null) : null;
  };
  const num = (x: string | undefined) => (x === undefined || x === "" ? NaN : parseFloat(x));
  const lastV = (k: string) => vit.findLast((x) => (x.values[k] ?? "") !== "") ?? null;
  const series = (k: string, k2?: string) =>
    vit
      .filter((x) => !Number.isNaN(num(x.values[k])))
      .slice(-8)
      .map((x) => {
        const rk = refOf(k);
        return {
          at: x.at,
          v: num(x.values[k]),
          v2: k2 && !Number.isNaN(num(x.values[k2])) ? num(x.values[k2]) : null,
          lvl: rk ? (K.interp(rk, x.values[k]!)?.lvl ?? null) : null,
        };
      });
  const bandOf = (rk: string | null): [number, number] | null => {
    if (!rk) return null;
    const bands = K.refs[rk]?.bands ?? [];
    const i = bands.findIndex((b) => b.lvl === "ok");
    if (i < 0) return null;
    const lo = i > 0 ? (bands[i - 1]!.lt ?? bands[i - 1]!.lte ?? null) : null;
    const hi = bands[i]!.lt ?? bands[i]!.lte ?? null;
    return lo !== null && hi !== null ? [lo, hi] : hi !== null ? [hi, hi] : null;
  };
  const deltaOf = (s: { at: number; v: number }[]) => {
    if (s.length < 2) return s.length ? C.firstReading : "";
    const d = Math.round((s[s.length - 1]!.v - s[0]!.v) * 10) / 10;
    const from = hh(s[0]!.at);
    return d === 0
      ? fill(C.noChange, { t: from })
      : fill(d > 0 ? C.up : C.down, { d: Math.abs(d), t: from });
  };
  const tile = (
    key: string,
    label: string,
    unit: string,
    paramId: string | null = null,
    k2?: string,
  ): VitalTile => {
    const l = lastV(key);
    const raw = l?.values[key] ?? "";
    const rk = refOf(key);
    const flag = rk && raw !== "" ? K.interp(rk, raw) : null;
    const s = series(key, k2);
    let value = raw === "" ? "—" : raw;
    if (k2 && l?.values[k2]) value = `${raw}/${l.values[k2]}`;
    let word = flag ? flag.word : raw === "" ? C.noReading : paramId ? C.addedByYou : "";
    if (key === "gcs" && l?.values.gcsE)
      word = `${word} · E${l.values.gcsE} V${l.values.gcsV} M${l.values.gcsM}`;
    return {
      key,
      label,
      unit,
      value,
      word,
      flag,
      series: s,
      band: bandOf(rk),
      delta: deltaOf(s),
      paramId,
    };
  };
  const tiles = [
    tile("sbp", C.bp, "mmHg", null, "dbp"),
    tile("pulse", C.pulse, "/min"),
    tile("rr", C.rr, "/min"),
    tile("gcs", C.gcs, "/15"),
    ...c.custom.map((x) => tile(`cx_${x.id}`, x.name, x.unit, x.id)),
  ];
  const last = vit.length ? vit[vit.length - 1]!.at : null;
  const dueAt = last ? last + every : now;
  const cell = (k: string, x: string | undefined) => {
    if (x === undefined || x === "") return { t: "", flag: null };
    const rk = refOf(k);
    return { t: x, flag: rk ? K.interp(rk, x) : null };
  };
  return {
    tiles,
    head: [
      C.time,
      C.bpHead,
      C.pulseHead,
      C.rrHead,
      C.gcsHead,
      ...c.custom.map((x) => (x.unit ? `${x.name}, ${x.unit}` : x.name)),
    ],
    rows: vit
      .slice(-8)
      .reverse()
      .map((x) => ({
        at: x.at,
        cells: [
          { t: hh(x.at), flag: null },
          {
            ...cell("sbp", x.values.sbp),
            t: x.values.sbp ? `${x.values.sbp}${x.values.dbp ? `/${x.values.dbp}` : ""}` : "",
          },
          cell("pulse", x.values.pulse),
          cell("rr", x.values.rr),
          x.values.gcsE
            ? {
                ...cell("gcs", x.values.gcs),
                t: `${x.values.gcs} (E${x.values.gcsE} V${x.values.gcsV} M${x.values.gcsM})`,
              }
            : cell("gcs", x.values.gcs),
          ...c.custom.map((p) => cell(`cx_${p.id}`, x.values[`cx_${p.id}`])),
        ],
      })),
    inputs: [
      { key: "sbp", label: C.sys, unit: "mmHg" },
      { key: "dbp", label: C.dia, unit: "mmHg" },
      { key: "pulse", label: C.pulse, unit: "/min" },
      { key: "rr", label: C.rr, unit: "/min" },
      ...GCS_PARTS.map(([key, letter, max]) => ({ key, label: letter, unit: `1–${max}` })),
      ...c.custom.map((x) => ({ key: `cx_${x.id}`, label: x.name, unit: x.unit })),
    ],
    last,
    due: dueAt,
    overdue: dueAt < now,
    suggest: C.paramSuggest.filter((x) => !c.custom.some((y) => y.name === x.name)),
  };
}

/* ─── What a role may press (P2, P6 on the server) ───────────────── */

// Acts are plain data the client echoes back; a give carries the checks it ticked (P6: all of them).
const canon = (a: Act) => JSON.stringify(a, Object.keys(a).sort());
const sameAct = (a: Act, b: Act) => canon(a) === canon(b);

/** Every act the chart offers this role now: buttons, chips and segments it may press, fields it types. */
export function offeredActs(view: ChartView, role: Role): Act[] {
  if (role === "ph" || view.endedAt || view.blocked) return [];
  const mine = (who: Role | null) => who === null || who === role;
  const out: Act[] = [];
  const steps = [...view.phases.flatMap((p) => p.acts), ...view.rn.acts];
  for (const s of steps) {
    for (const b of [...s.btns, ...s.items.flatMap((i) => i.btns)])
      if (mine(b.who)) out.push(b.act);
    if (mine(s.chipWho)) for (const ch of s.chips) if (ch.act) out.push(ch.act);
    if (mine(s.segWho)) for (const sg of s.segs) if (sg.act) out.push(sg.act);
    for (const f of s.fields) {
      if (f.who === role)
        out.push(f.key === "weight" ? { t: "weight" } : { t: "value", key: f.key });
      if (f.order && mine(f.order.who)) out.push(f.order.act);
    }
  }
  for (const t of view.tasks) for (const b of t.btns) if (mine(b.who)) out.push(b.act);
  return out.filter((a) => !["rx", "screen", "proto"].includes(a.t));
}

export function isOffered(view: ChartView, role: Role, act: Act): boolean {
  return offeredActs(view, role).some((a) => sameAct(a, act));
}

/** The words a button that belongs to another cadre shows: "Nurse · Hung now" (F7). */
export function lockedWord(b: Btn, role: Role): string | null {
  const who = role === "ph" ? (b.who ?? "dr") : b.who;
  if (!who || who === role) return null;
  return `${who === "rn" ? C.nurseDot : who === "dr" ? C.doctorDot : ""}${b.word}`;
}

export type { FlowItem };
