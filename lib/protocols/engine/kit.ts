import type { Refs } from "./fold";
import type {
  Act,
  Aim,
  Branch,
  Btn,
  ChartFacts,
  ChartState,
  ChartVersion,
  Crit,
  Field,
  FlowItem,
  FormField,
  Interp,
  Item,
  Line,
  MedLine,
  ResultValue,
  Role,
  Row,
  Slot,
  Stat,
  Step,
  StepStatus,
} from "./types";

import { CHART_COPY as C, fill } from "@/content/protocol-charts";
import { formatClock } from "@/lib/emr/charts/scale";
import { interp } from "./fold";
import { BEDSIDE, groupOf, LAB_GROUPS } from "./keys";

/**
 * The kit a rule module builds its chart with: the prototype's `K` (pcView), as pure functions over
 * the folded chart, the patient's facts and the time. A module reads every clinical number from its
 * version's seed; the kit holds none.
 */

export const hh = (ms: number) => formatClock(new Date(ms));
export function dur(ms: number) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return fill(C.min, { n: m });
  const h = Math.floor(m / 60);
  return m % 60 ? fill(C.hMin, { h, m: m % 60 }) : fill(C.h, { h });
}
export const n1 = (x: number) => String(Math.round(x * 10) / 10);
export const n2 = (x: number) => String(Math.round(x * 100) / 100);

/** What a module's `build` returns (the prototype's `S.build(K)`). */
export interface Built {
  phases: {
    id: string;
    title: string;
    win: string;
    from: number;
    to: number | null;
    acts: Step[];
  }[];
  rn: { title: string; note: string; acts: Step[] };
  flow: (F: FlowKit) => FlowItem[];
  tasks: (tk: TaskAdd) => void;
  rows: [string, string][];
  /** The reference a grid row reads ("uo" by weight: the module's own). */
  cellFlag?: (key: string, x: string) => Interp | null;
  dueAt?: (key: string, h: number) => boolean;
  form: FormField[];
  formReq: string[];
  /** Slot keys saved to results too (P5). */
  labKeys: string[];
  /** Values worked out on save (HHS osmolality). */
  derive?: (o: Record<string, string>) => Record<string, string>;
  recWhat: (h: number) => string;
  recHint: (h: number) => string;
  panels: PanelSpec[];
  stats: Stat[];
  aims: Aim[];
  meds: MedLine[];
  medsNote?: string;
  phRows: Row[];
  logWords?: Record<string, string>;
}

export interface PanelSpec {
  key: string;
  name: string;
  unit: string;
  min: number;
  max: number;
  ticks: number[];
  thr?: [number, string, "amb" | "grn"][];
  target?: (p0: { h: number; v: number }) => [number, number][];
  status?: string;
  stLvl?: "ok" | "no" | "";
  bad?: (x: number) => boolean;
  fmt?: (x: number) => string;
}

export interface FlowKit {
  N: (key: string, title: string, sub?: string) => FlowItem;
  D: (
    key: string,
    q: string,
    brs: { label: string; sub: string; state: boolean | null }[],
    note?: string,
  ) => FlowItem;
  Br: (
    label: string,
    sub: string,
    state: boolean | null,
  ) => {
    label: string;
    sub: string;
    state: boolean | null;
  };
  P: (id: string) => FlowItem;
}

export type TaskAdd = (key: string, title: string, sub: string, at: number, btns?: Btn[]) => void;

export interface KitInput {
  version: ChartVersion;
  c: ChartState;
  facts: ChartFacts;
  now: number;
}

export type Kit = ReturnType<typeof makeKit>;

export function makeKit({ version, c, facts, now }: KitInput) {
  const seed = version.seed;
  const refs = (seed.refs ?? {}) as Refs;
  const NS = version.slotCount;
  const slotMin = version.slotMinutes;
  const SL = slotMin * 60000;
  const isH = slotMin >= 60;
  const el = now - c.start;
  const hNow = Math.max(0, Math.floor(el / SL));
  const { v, obs, inv, t: T } = c;
  const w = facts.weightKg ?? 0;

  const num = (i: number) => (isH ? n1((i * slotMin) / 60) : String(i * slotMin));
  const lbl = (i: number) => {
    const m = i * slotMin;
    if (isH) return fill(C.h, { h: num(i) });
    if (m >= 60)
      return m % 60 ? fill(C.hMin, { h: Math.floor(m / 60), m: m % 60 }) : fill(C.h, { h: m / 60 });
    return fill(C.min, { n: m });
  };
  const due = (i: number) => c.start + i * SL;

  const res = (k: string): ResultValue | null => facts.results[k] ?? null;
  const typed = (k: string) =>
    v[k] !== undefined && v[k] !== "" && !Number.isNaN(parseFloat(v[k]!));
  const val = (k: string): number | null => {
    if (typed(k)) return parseFloat(v[k]!);
    return res(k)?.value ?? null;
  };
  const lastObs = (k: string): Slot | null => {
    for (let i = obs.length - 1; i >= 0; i--) {
      const x = obs[i]!.values[k];
      if (x !== undefined && x !== "" && !Number.isNaN(parseFloat(x))) return obs[i]!;
    }
    return null;
  };
  const latest = (k: string): number | null => {
    const o = lastObs(k);
    return o ? parseFloat(o.values[k]!) : val(k);
  };
  const ptsOf = (k: string) =>
    obs
      .filter(
        (o) =>
          o.values[k] !== undefined &&
          o.values[k] !== "" &&
          !Number.isNaN(parseFloat(o.values[k]!)),
      )
      .map((o) => ({ h: o.h, v: parseFloat(o.values[k]!), at: o.at }));

  const btn = (word: string, act: Act, who: Role | null, kind?: "main" | "link"): Btn => ({
    word,
    act,
    who,
    ...(kind ? { kind } : {}),
  });
  const st = (done: boolean, alert: boolean): { status: StepStatus } => ({
    status: alert ? "needs" : done ? "done" : "todo",
  });
  const L = (text: string, kind: Line["kind"] = ""): Line => ({ text, kind });
  const A = (
    o: Partial<Step> & { n: number; title: string },
    s?: { status: StepStatus },
  ): Step => ({
    key: "",
    sub: "",
    status: "todo",
    brief: "",
    fields: [],
    crit: [],
    rows: [],
    branchHead: "",
    branches: [],
    items: [],
    chipHead: "",
    chips: [],
    chipWho: null,
    segLabel: "",
    segs: [],
    segWho: null,
    btns: [],
    lines: [],
    ...s,
    ...o,
  });

  const orderAct = (keys: string[]): Act => ({ t: "order", keys });
  const orderable = (k: string) => val(k) === null && !facts.pending[k] && !!groupOf(k)?.test;
  /** "Order what is missing: U&Es, Lab glucose" for the keys with a lab test. */
  const orderMissing = (keys: string[]): Btn[] => {
    const missing = keys.filter(orderable);
    const gs = LAB_GROUPS.filter((g) => g.test && g.keys.some((k) => missing.includes(k)));
    return gs.length
      ? [
          btn(
            fill(C.orderMissing, { groups: gs.map((g) => g.name).join(", ") }),
            orderAct(gs.flatMap((g) => g.keys.filter((k) => val(k) === null))),
            "dr",
            "main",
          ),
        ]
      : [];
  };

  const fld = (k: string, label: string, unit: string, who: Role = "dr"): Field => {
    const ty = v[k] !== undefined && v[k] !== "";
    const r = res(k);
    const shown = ty ? v[k]! : r ? String(r.value) : "";
    const pend = facts.pending[k];
    const g = groupOf(k);
    return {
      key: k,
      label,
      unit,
      value: shown,
      source: ty
        ? C.entered
        : r
          ? fill(C.fromResults, { src: r.source, at: hh(r.at) })
          : pend
            ? fill(C.orderedWaiting, { at: hh(pend) })
            : BEDSIDE.has(k) || !g
              ? C.bedside
              : C.notOnFile,
      flag: interp(refs, k, shown),
      who,
      order:
        !ty && !r && !pend && g?.test
          ? btn(
              fill(C.orderGroup, { group: g.name }),
              orderAct(g.keys.filter((x) => val(x) === null)),
              "dr",
            )
          : null,
    };
  };

  const mark = (key: string): Act => ({ t: "mark", key });
  const give = (key: string): Act => ({ t: "give", key });
  const set = (key: string, value: string): Act => ({ t: "set", key, value });
  const gv = (key: string) => c.gives[key] ?? [];
  const many = (key: string) => c.many[key] ?? [];
  const pick1 = (key: string, opts: readonly string[]) =>
    opts.map((x) => ({ word: x, on: v[key] === x, act: set(key, v[key] === x ? "" : x) }));
  const pickN = (key: string, opts: readonly string[]) =>
    opts.map((x) => ({
      word: x,
      on: many(key).includes(x),
      act: { t: "toggle", key, value: x } as Act,
    }));

  /** Investigations: [key, name, only if indicated?]. */
  const invItems = (list: readonly (readonly [string, string, boolean?])[]): Item[] =>
    list.map(([k, name, ifInd]) => {
      const sv = inv[k] ?? "";
      const to = (x: "" | "ordered" | "done" | "na"): Act => ({ t: "inv", key: k, to: x });
      return {
        name,
        sub: ifInd ? C.ifIndicated : "",
        word:
          sv === "done"
            ? C.done
            : sv === "ordered"
              ? C.ordered
              : sv === "na"
                ? C.notNeeded
                : C.notYet,
        lvl: sv === "done" ? "done" : sv === "na" ? "na" : "todo",
        btns:
          sv === "done"
            ? [btn(C.undo, to(""), "dr", "link")]
            : sv === "ordered"
              ? [btn(C.markDone, to("done"), "rn", "main")]
              : [
                  btn(C.order, to("ordered"), "dr", "main"),
                  ...(ifInd ? [btn(C.notNeeded, to("na"), "dr", "link")] : []),
                ],
      };
    });
  const invDone = (list: readonly (readonly [string, string, boolean?])[]) =>
    list.filter((x) => !x[2]).every((x) => inv[x[0]] === "done");

  /** Change per slot-hour from the first to the last charted value (dir −1: a fall). */
  const perH = (key: string, dir: 1 | -1): number | null => {
    const q = ptsOf(key);
    if (q.length < 2) return null;
    const a = q[0]!;
    const b = q[q.length - 1]!;
    if (b.h === a.h) return null;
    return Math.round((((b.v - a.v) * dir) / (((b.h - a.h) * slotMin) / 60)) * 100) / 100;
  };
  const br = (range: string, text: string, on: boolean, known: boolean, stop = false): Branch => ({
    range,
    text,
    on,
    known,
    stop,
    ...(on ? { tag: C.thisPatient } : {}),
  });
  const crit = (text: string, valTxt: string, ok: boolean, has: boolean): Crit => ({
    text,
    val: valTxt,
    ok,
    mark: ok ? "met" : has ? "not" : "need",
  });
  const row = (k: string, vv: string, cls?: Row["cls"]): Row => ({
    k,
    v: vv,
    ...(cls ? { cls } : {}),
  });
  const it = (
    name: string,
    sub: string,
    word: string,
    lvl: Item["lvl"],
    btns: Btn[] = [],
  ): Item => ({
    name,
    sub,
    word,
    lvl,
    btns,
  });

  const hasLine = facts.ivLines.length > 0;
  const ivTask = facts.ivTaskOpen;
  const ivLine = (): Line =>
    hasLine
      ? L(fill(C.ivAccess, { lines: facts.ivLines.join(" · ") }), "ok")
      : L(ivTask ? C.ivAsked : C.ivNone, ivTask ? "warn" : "alert");
  const ivBtn = (word: string = C.ivRequest): Btn[] =>
    !hasLine && !ivTask ? [btn(word, { t: "iv" }, "dr", "main")] : [];
  const wtBits = (why: string): { fields: Field[]; btns: Btn[] } =>
    w
      ? { fields: [], btns: [] }
      : {
          fields: [
            {
              key: "weight",
              label: C.weight,
              unit: "kg",
              value: "",
              source: fill(C.weightNeeded, { why }),
              flag: null,
              who: "dr",
              order: null,
            },
          ],
          btns: [],
        };
  /** A target line from the first value at `ratePerH` to `stop` (dir −1: falling), across the chart. */
  const tLine = (p0: { h: number; v: number }, ratePerH: number, stop: number, dir: 1 | -1) => {
    const r = (ratePerH * slotMin) / 60;
    if ((stop - p0.v) * dir <= 0) return [] as [number, number][];
    const out: [number, number][] = [[p0.h, p0.v]];
    const hEnd = p0.h + Math.abs(p0.v - stop) / r;
    if (hEnd <= NS) out.push([hEnd, stop], [NS, stop]);
    else out.push([NS, p0.v + dir * r * (NS - p0.h)]);
    return out;
  };
  const endBtn = (short: string) => btn(fill(C.endChart, { short }), { t: "end" }, "dr", "main");
  const lastH = obs.length ? obs[obs.length - 1]!.h : -1;

  return {
    version,
    seed,
    refs,
    facts,
    c,
    v,
    obs,
    inv,
    T,
    now,
    el,
    hNow,
    NS,
    SL,
    slotMin,
    isH,
    w,
    nextH: lastH + 1,
    num,
    lbl,
    due,
    res,
    typed,
    val,
    latest,
    lastObs,
    ptsOf,
    btn,
    st,
    L,
    A,
    orderMissing,
    fld,
    mark,
    give,
    set,
    gv,
    many,
    pick1,
    pickN,
    invItems,
    invDone,
    perH,
    br,
    crit,
    row,
    it,
    hasLine,
    ivTask,
    ivLine,
    ivBtn,
    wtBits,
    tLine,
    endBtn,
    interp: (k: string, x: unknown) => interp(refs, k, x),
    eg: facts.egfr,
    hh,
    dur,
    n1,
    n2,
  };
}
