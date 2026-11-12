import { z } from "zod";

import { PROTOCOLS_COPY as C, fill } from "@/content/protocols";

/**
 * Quick protocols inside Prescribe (prescribing kit P3, F6): the protocol version's `rules` (data,
 * signed by two clinicians) and the pure functions over it. Ported from the prototype's `PROTOS`,
 * `protoChecks`, `planOf`, `pdose`, `pinBand`/`applyPins` and `fromBuilder`. No clinical number lives
 * here: every dose, band, time and age comes from the version. No I/O.
 */

/* ─── The version's rules ────────────────────────────────────────── */

const num = z.number().finite();
const words = (n: number) => z.string().trim().min(1).max(n);

/** A range of a result: the first band that holds wins. "Over 5.5" = {gt: 5.5}. */
export const Band = z.object({
  gt: num.optional(),
  gte: num.optional(),
  lt: num.optional(),
  lte: num.optional(),
  range: words(60),
  text: words(400),
  /** A blocking band: the prescriber answers it before the protocol starts (F6, P6). */
  stop: z.boolean().optional(),
  /** Steps this band puts on hold (DKA potassium under 3.3 holds the insulin). */
  hold: z.array(z.string()).optional(),
  /** How this band changes other steps' words. */
  change: z
    .record(z.string(), z.object({ title: words(160).optional(), note: words(300).optional() }))
    .optional(),
});
export type Band = z.infer<typeof Band>;

/** A starting value: from results (a fact concept), orderable (a lab test id), or a choice. */
export const Start = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/),
  label: words(60),
  unit: z.string().max(20).default(""),
  fact: z.string().max(60).optional(),
  test: z.string().max(80).optional(),
  options: z.array(words(40)).max(8).optional(),
  bands: z.array(Band).max(12).optional(),
});
export type Start = z.infer<typeof Start>;

const DoseCore = z.object({
  amt: num.positive(),
  /** "mg", "g", "units", "ml", "mmol", or per kg / per hour: "mg/kg", "units/kg/h". */
  unit: z.string().regex(/^(mg|g|units|ml|mmol|micrograms)(\/kg)?(\/h)?$/),
  max: num.positive().optional(),
  min: num.positive().optional(),
});
export const Dose = DoseCore.extend({
  /** Weight used is capped (acetylcysteine: 110 kg). */
  wcap: num.positive().optional(),
  /** The child dose: under this weight or age. */
  child: DoseCore.extend({
    belowKg: num.positive().optional(),
    belowAge: num.positive().optional(),
  }).optional(),
});
export type Dose = z.infer<typeof Dose>;

export const STEP_KINDS = ["give", "infusion", "result", "check", "rule"] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export const Step = z.object({
  id: z.string().regex(/^[a-z0-9_]{1,20}$/),
  kind: z.enum(STEP_KINDS),
  title: words(160),
  /** A formulary drug id. */
  drug: z.string().max(80).optional(),
  dose: Dose.optional(),
  double: z.boolean().optional(),
  vol: num.positive().optional(),
  over: num.positive().optional(),
  conc: z.object({ amt: num.positive(), label: words(80) }).optional(),
  /** Minutes from the start; or `times` for an irregular list. No time: when needed. */
  at: num.min(0).optional(),
  every: num.positive().optional(),
  count: z.number().int().positive().max(100).optional(),
  times: z.array(num.min(0)).max(50).optional(),
  checks: z.array(words(160)).max(8).optional(),
  text: z.string().max(600).optional(),
  input: z.object({ label: words(60), unit: z.string().max(20).default("") }).optional(),
  bands: z.union([z.array(Band), z.record(z.string(), z.array(Band))]).optional(),
  /** Bands chosen by a starting value (sliding scale: by the scale). */
  bandsBy: z.string().optional(),
});
export type Step = z.infer<typeof Step>;

/**
 * What the pharmacy supplies for the first period. `qty` fixed, or worked out from the doses of
 * `steps` for this patient: each dose takes ceil(dose / per) (vials are not shared across doses);
 * no `per`: one a dose. The line's dose words come from `steps[0]`.
 */
export const SupplyItem = z.object({
  drug: z.string().min(1).max(80),
  route: z.string().min(1).max(20),
  unit: words(40),
  qty: z.number().int().positive().max(999).optional(),
  steps: z.array(z.string()).max(10).optional(),
  per: num.positive().optional(),
});
export type SupplyItem = z.infer<typeof SupplyItem>;

export const QuickRules = z.object({
  /** The P4 rule module (`lib/protocols/rules/<module>.ts`); null for a hospital's own protocol. */
  module: z.string().nullable(),
  intro: z.string().max(600).default(""),
  who: z.object({
    label: words(60),
    minAge: num.optional(),
    maxAge: num.optional(),
    sex: z.enum(["female", "male"]).optional(),
    pregnant: z.boolean().optional(),
  }),
  confirm: z.array(words(300)).max(10).default([]),
  start: z.array(Start).max(6).default([]),
  steps: z.array(Step).min(1).max(40),
  supply: z.array(SupplyItem).max(20).default([]),
});
export type QuickRules = z.infer<typeof QuickRules>;

/* ─── Starting values and bands ──────────────────────────────────── */

export const inBand = (b: Band, v: number) =>
  (b.gt == null || v > b.gt) &&
  (b.gte == null || v >= b.gte) &&
  (b.lt == null || v < b.lt) &&
  (b.lte == null || v <= b.lte);

/** The band this value falls in (numbers) or the option's bands (choices: none). */
export function bandOf(
  bands: readonly Band[] | undefined,
  raw: string | number | null | undefined,
): Band | null {
  const v = typeof raw === "number" ? raw : parseFloat(String(raw ?? "").replace(",", "."));
  if (!bands || Number.isNaN(v)) return null;
  return bands.find((b) => inBand(b, v)) ?? null;
}

export type StartValues = Record<string, string | number | null | undefined>;

/** The holds and word changes the starting values make to the plan. */
export function effectsOf(rules: QuickRules, start: StartValues) {
  const hold = new Set<string>();
  const change: Record<string, { title?: string; note?: string }> = {};
  const bands: Record<string, Band> = {};
  for (const s of rules.start) {
    const b = bandOf(s.bands, start[s.key]);
    if (!b) continue;
    bands[s.key] = b;
    for (const id of b.hold ?? []) hold.add(id);
    Object.assign(change, b.change ?? {});
  }
  return { hold, change, bands };
}

/* ─── Doses ──────────────────────────────────────────────────────── */

export interface PatientFacts {
  ageYears: number | null;
  sex: "female" | "male" | null;
  weightKg: number | null;
  pregnant: boolean | null;
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const n = (x: number) => r1(x).toLocaleString("en-GB");

function amountWords(v: number, unit: string) {
  if (unit === "mg" && v >= 1000) return `${n(v / 1000)} g`;
  return `${n(v)} ${unit}`;
}

/** One administration of a step for this patient (the prototype's `pdose`), i = 0 for the first. */
export function doseOf(
  st: Step,
  p: PatientFacts,
  i = 0,
): { amount: number | null; text: string; needWeight: boolean } {
  let amount: number | null = null;
  let text = "";
  const d = st.dose;
  if (d) {
    const c = d.child;
    const child =
      !!c &&
      ((c.belowKg != null && p.weightKg != null && p.weightKg < c.belowKg) ||
        (c.belowAge != null && p.ageYears != null && p.ageYears < c.belowAge));
    const use = child ? c! : d;
    let amt = use.amt;
    if (st.double) amt *= 2 ** i;
    if (use.unit.includes("/kg")) {
      if (p.weightKg == null) return { amount: null, text: C.needWeight, needWeight: true };
      const w = d.wcap ? Math.min(p.weightKg, d.wcap) : p.weightKg;
      const base = use.unit.replace("/kg", "");
      let v = amt * w;
      const capped = use.max != null && v > use.max;
      const floored = use.min != null && v < use.min;
      if (capped) v = use.max!;
      if (floored) v = use.min!;
      amount = v;
      const bare = base.replace("/h", "");
      text = `${amountWords(v, bare)}${base.endsWith("/h") ? "/h" : ""} (${amt} ${use.unit} × ${n(w)} kg${capped ? `, capped at ${use.max}` : ""}${floored ? `, at least ${use.min}` : ""})`;
    } else {
      amount = amt;
      text = amountWords(amt, use.unit);
    }
    if (st.conc && amount != null) text += ` = ${n(amount / st.conc.amt)} ml/h (${st.conc.label})`;
  }
  if (st.vol && st.over) {
    const mlh = st.vol / (st.over / 60);
    text += `${text ? " in " : ""}${n(st.vol)} ml over ${minutesWords(st.over)} = ${n(mlh)} ml/h`;
  }
  return { amount, text, needWeight: false };
}

const minutesWords = (m: number) =>
  m >= 60 ? `${n(m / 60)} ${m === 60 ? "hour" : "hours"}` : `${n(m)} minutes`;

/** The minutes from the start of each administration (rules and untimed steps: none). */
export function stepTimes(st: Step): number[] {
  if (st.times?.length) return [...st.times];
  if (st.kind === "rule" || st.at == null) return [];
  const count = st.every ? (st.count ?? 1) : 1;
  return Array.from({ length: count }, (_, i) => st.at! + i * (st.every ?? 0));
}

export const relTime = (min: number) =>
  min === 0
    ? C.start
    : min < 60
      ? `+${min} min`
      : `+${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`;

/* ─── The plan (a step list; the flow chart is P4) ───────────────── */

export interface PlanStep {
  id: string;
  kind: StepKind;
  title: string;
  when: string;
  detail: string;
  checks: string[];
  bands: { range: string; text: string; on: boolean }[];
  held: boolean;
  note: string | null;
}

export function planOf(rules: QuickRules, p: PatientFacts, start: StartValues): PlanStep[] {
  const fx = effectsOf(rules, start);
  return rules.steps.map((st) => {
    const t = stepTimes(st);
    const every = st.every ? (st.every >= 60 ? `${n(st.every / 60)} h` : `${st.every} min`) : "";
    const when =
      st.kind === "rule"
        ? C.always
        : !t.length
          ? C.whenNeeded
          : st.times?.length
            ? t.map(relTime).join(", ")
            : `${relTime(t[0]!)}${every ? ` · ${fill(C.every, { n: every })} ${fill(C.times, { n: t.length })}` : ""}`;
    const d = st.dose || st.vol ? doseOf(st, p, 0) : null;
    const list = st.bandsBy
      ? !Array.isArray(st.bands) && st.bands
        ? (st.bands[String(start[st.bandsBy] ?? "")] ?? [])
        : []
      : Array.isArray(st.bands)
        ? st.bands
        : [];
    const ch = fx.change[st.id];
    return {
      id: st.id,
      kind: st.kind,
      title: ch?.title ?? st.title,
      when,
      detail: [st.double && d ? `${d.text}, doubling each time` : d?.text, st.text]
        .filter(Boolean)
        .join(" · "),
      checks: st.checks ?? [],
      bands: list.map((b) => ({ range: b.range, text: b.text, on: false })),
      held: fx.hold.has(st.id),
      note: ch?.note ?? null,
    };
  });
}

/* ─── Supply for the first period ────────────────────────────────── */

export interface SupplyRow {
  drug: string;
  route: string;
  qty: number | null;
  unit: string;
  /** The dose words of its first step for this patient, for the line the pharmacy reads. */
  doseText: string;
  step: string | null;
}

export function supplyOf(rules: QuickRules, p: PatientFacts): SupplyRow[] {
  const byId = new Map(rules.steps.map((s) => [s.id, s]));
  return rules.supply.map((it) => {
    const steps = (it.steps ?? []).flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
    let qty: number | null = it.qty ?? null;
    if (qty == null && steps.length) {
      const per = it.per;
      const each = steps.flatMap((st) =>
        stepTimes(st).map((_, i) => (per == null ? 1 : doseOf(st, p, i).amount)),
      );
      qty = each.some((x) => x == null)
        ? null
        : Math.max(
            1,
            each.reduce<number>((t, x) => t + (per == null ? x! : Math.ceil(x! / per - 1e-9)), 0),
          );
    }
    const first = steps[0] ?? null;
    const doseText = first && (first.dose || first.vol) ? doseOf(first, p, 0).text : "";
    return {
      drug: it.drug,
      route: it.route,
      qty,
      unit: it.unit,
      doseText,
      step: first?.id ?? null,
    };
  });
}

/* ─── Checks (F6) ────────────────────────────────────────────────── */

export type ProtoLevel = "stop" | "check" | "note" | "passed";
export const PROTO_ANSWERS = [
  "confirmed",
  "on_purpose",
  "plan_changed",
  "checked",
  "senior_agreed",
  "no_alternative",
  "aware_monitor",
  "result_awaited",
] as const;
export type ProtoAnswer = (typeof PROTO_ANSWERS)[number];

export interface ProtoCheck {
  id: string;
  level: ProtoLevel;
  title: string;
  message: string;
  /** The answers that let it pass; empty: nothing to answer (a hard stop, or information). */
  answers: ProtoAnswer[];
  /** A stop no answer passes. */
  hard: boolean;
}

export interface ProtoCheckContext {
  facts: PatientFacts;
  start: StartValues;
  /** The same protocol already has lines running for this patient. */
  running: boolean;
  /** An IV line is recorded on this visit, or an IV task is open. */
  ivLine: boolean;
  /** canStart(version, env). */
  startable: boolean;
  /** The version is signed (else: prototype values). */
  signed: boolean;
}

const IV_ROUTES = new Set(["iv", "infusion", "io"]);

/** The protocol's own checks (the prototype's `protoChecks`); the medicines' checks are added by the server. */
export function protocolChecks(rules: QuickRules, ctx: ProtoCheckContext): ProtoCheck[] {
  const out: ProtoCheck[] = [];
  const add = (
    c: Omit<ProtoCheck, "hard" | "answers"> & Partial<Pick<ProtoCheck, "hard" | "answers">>,
  ) => out.push({ answers: [], hard: false, ...c });
  if (!ctx.signed)
    add({
      id: "signed",
      level: ctx.startable ? "check" : "stop",
      hard: !ctx.startable,
      title: C.draft,
      message: ctx.startable ? C.draftDev : C.draftWarn,
    });
  const { facts: p, start } = ctx;
  const w = rules.who;
  const ageOff =
    p.ageYears != null &&
    ((w.minAge != null && p.ageYears < w.minAge) || (w.maxAge != null && p.ageYears > w.maxAge));
  const sexOff = !!w.sex && p.sex !== w.sex;
  const pregOff = !!w.pregnant && p.pregnant !== true;
  if (ageOff || sexOff || pregOff || (p.ageYears == null && (w.minAge != null || w.maxAge != null)))
    add({
      id: "who",
      level: "check",
      title: w.label,
      message: `This protocol is for: ${w.label.toLowerCase()}. Check each dose for this patient.`,
      answers: ["checked"],
    });
  const needWt = rules.steps.some((st) => {
    const u = st.dose ? `${st.dose.unit} ${st.dose.child?.unit ?? ""}` : "";
    return u.includes("/kg");
  });
  if (needWt && p.weightKg == null)
    add({
      id: "weight",
      level: "stop",
      hard: true,
      title: "Weight",
      message: "Doses in this protocol are worked out from the weight. Record it.",
    });
  else if (needWt)
    add({ id: "weight", level: "passed", title: "Weight", message: `${n(p.weightKg!)} kg.` });
  const missing = rules.start.filter((s) => start[s.key] == null || start[s.key] === "");
  if (missing.length)
    add({
      id: "start",
      level: "stop",
      hard: true,
      title: C.startTitle,
      message: `No ${missing.map((s) => s.label.toLowerCase()).join(" or ")} on file. Order it or enter it.`,
    });
  for (const s of rules.start) {
    const b = bandOf(s.bands, start[s.key]);
    if (b?.stop)
      add({
        id: `band_${s.key}`,
        level: "stop",
        title: `${s.label} ${b.range.toLowerCase()}`,
        message: b.text,
        answers: ["plan_changed"],
      });
  }
  if (rules.confirm.length)
    add({
      id: "indication",
      level: "check",
      title: "Indication",
      message: rules.confirm.join("; "),
      answers: ["confirmed"],
    });
  if (ctx.running)
    add({
      id: "running",
      level: "check",
      title: "Already running",
      message:
        "This protocol is already running for this patient. Starting it again begins a second one.",
      answers: ["on_purpose"],
    });
  const iv =
    rules.steps.some((st) => st.kind === "infusion") ||
    rules.supply.some((s) => IV_ROUTES.has(s.route));
  if (iv && !ctx.ivLine)
    add({
      id: "iv",
      level: "note",
      title: "IV access",
      message: "No IV line recorded. When you send this, the nurses get a task to insert one.",
    });
  else if (iv) add({ id: "iv", level: "passed", title: "IV access", message: "IV line recorded." });
  const rank: Record<ProtoLevel, number> = { stop: 0, check: 1, note: 2, passed: 3 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

/** Whether every check has what it needs. Answers are keyed by check id. */
export function verifyProtocol(
  checks: readonly ProtoCheck[],
  answers: Readonly<Record<string, string>>,
): { ok: boolean; reason: string | null } {
  const hard = checks.find((c) => c.hard);
  if (hard) return { ok: false, reason: hard.message };
  const open = checks.find(
    (c) => c.answers.length && !c.answers.includes(answers[c.id] as ProtoAnswer),
  );
  if (open) return { ok: false, reason: `Answer "${open.title}" to continue.` };
  return { ok: true, reason: null };
}

/* ─── Starting (P1, P4) ──────────────────────────────────────────── */

/** The environment `canStart` reads (a subset of `process.env`). */
export type StartEnv = Partial<Record<"NODE_ENV" | "VERCEL" | "VERCEL_ENV", string>>;

/**
 * Only a signed version starts (two clinician signatures, P1). An unsigned draft starts ONLY in
 * local development and tests: not a production build, and not on any Vercel deployment (previews
 * included, which may use the real database). Elsewhere it previews, labelled "prototype values".
 */
export function canStart(version: { status: string }, env: StartEnv = process.env): boolean {
  if (version.status === "signed") return true;
  return env.NODE_ENV !== "production" && !env.VERCEL && !env.VERCEL_ENV;
}

/** Local development and tests only (never production or a Vercel preview): the chart's dev clock. */
export const isLocalDev = (env: StartEnv = process.env) => canStart({ status: "draft" }, env);

/* ─── The builder ────────────────────────────────────────────────── */

export const BuilderStep = z.object({
  kind: z.enum(STEP_KINDS),
  title: z.string().trim().max(160).default(""),
  drug: z.string().max(80).nullable().default(null),
  amt: num.positive().nullable().default(null),
  unit: z.string().max(20).default(""),
  at: num.min(0).max(100_000).default(0),
  every: num.min(0).max(100_000).default(0),
  count: z.number().int().min(0).max(100).default(0),
  vol: num.min(0).max(10_000).default(0),
  over: num.min(0).max(100_000).default(0),
  conc: num.min(0).max(100_000).default(0),
  checks: z.string().max(800).default(""),
  double: z.boolean().default(false),
  input: z.string().max(60).default(""),
  inUnit: z.string().max(20).default(""),
  bands: z.string().max(1200).default(""),
  note: z.string().max(600).default(""),
});
export type BuilderStep = z.infer<typeof BuilderStep>;

export const BuilderInput = z.object({
  name: z.string().trim().min(3, "Name the protocol.").max(120),
  intro: z.string().trim().max(600).default(""),
  who: z.enum(["any", "adult"]),
  steps: z.array(BuilderStep).min(1, "Add a step.").max(40),
});
export type BuilderInput = z.infer<typeof BuilderInput>;

/** "<4: …", "4-10: …", "4 to 10: …", ">22: …" → bands. Lines that do not read are dropped. */
export function parseBands(text: string): Band[] {
  return text.split("\n").flatMap((ln): Band[] => {
    const m = ln.match(/^\s*(<|>)?\s*([\d.]+)\s*(?:(?:-|to)\s*([\d.]+))?\s*:\s*(.+)$/);
    if (!m) return [];
    const a = parseFloat(m[2]!);
    const t = m[4]!.trim();
    if (m[1] === "<") return [{ lt: a, range: `Under ${a}`, text: t }];
    if (m[1] === ">") return [{ gt: a, range: `Over ${a}`, text: t }];
    const b = m[3] !== undefined ? parseFloat(m[3]) : a;
    return [{ gte: a, lte: b, range: b === a ? `${a}` : `${a} to ${b}`, text: t }];
  });
}

const BUILDER_ADULT_FROM = 12; // ponytail: the prototype's adult/child line for builder protocols; a hospital setting when one exists.

/** The builder's fields → a version's rules (the prototype's `fromBuilder`). Supply: one a dose. */
export function fromBuilder(
  b: BuilderInput,
  drugName: (id: string) => string | undefined,
  drugRoutes: (id: string) => readonly string[] | undefined,
): QuickRules {
  const steps: Step[] = b.steps.map((s, i) => {
    const st: Step = {
      id: `c${i}`,
      kind: s.kind,
      title:
        s.title ||
        (s.kind === "result" && s.input
          ? s.input
          : s.drug
            ? (drugName(s.drug) ?? `Step ${i + 1}`)
            : `Step ${i + 1}`),
      ...(s.drug ? { drug: s.drug } : {}),
      ...(s.kind !== "rule" ? { at: s.at } : {}),
      ...(s.note ? { text: s.note } : {}),
    };
    if (s.amt && s.unit) st.dose = Dose.parse({ amt: s.amt, unit: s.unit });
    if (s.kind === "infusion" && s.conc)
      st.conc = { amt: s.conc, label: `${s.conc} ${s.unit.replace(/\/kg|\/h/g, "")} per ml` };
    if (s.vol && s.over) {
      st.vol = s.vol;
      st.over = s.over;
    }
    if (s.kind !== "rule" && s.every) {
      st.every = s.every;
      st.count = s.count || 1;
    }
    if (s.kind === "give" && s.double) st.double = true;
    const checks = s.checks
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
    if (checks.length) st.checks = checks;
    if (s.kind === "result") {
      st.input = { label: s.input || "Result", unit: s.inUnit };
      st.bands = parseBands(s.bands);
    }
    return Step.parse(st);
  });
  const drugs = [...new Set(steps.flatMap((s) => (s.drug && s.kind !== "rule" ? [s.drug] : [])))];
  return QuickRules.parse({
    module: null,
    intro: b.intro,
    who: b.who === "adult" ? { label: "Adults", minAge: BUILDER_ADULT_FROM } : { label: "Any age" },
    confirm: [],
    start: [],
    steps,
    supply: drugs.map((d) => {
      const routes = drugRoutes(d) ?? [];
      const inf = steps.some((s) => s.drug === d && s.kind === "infusion");
      const route = inf
        ? (["infusion", "iv"].find((r) => routes.includes(r)) ?? routes[0])
        : routes[0];
      return {
        drug: d,
        route: route ?? "oral",
        unit: "doses",
        steps: steps.filter((s) => s.drug === d).map((s) => s.id),
      };
    }),
  });
}
