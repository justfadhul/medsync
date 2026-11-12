import type { RuleModule } from "./index";
import type { Built, Kit } from "@/lib/protocols/engine/kit";
import type { Btn, ChartVersion, Step } from "@/lib/protocols/engine/types";
import type { Step as RuleStep } from "@/lib/protocols/quick";

import { fill } from "@/content/protocol-charts";
import { STEPS_COPY as W } from "@/content/protocol-charts-rules";
import { bandOf, doseOf, QuickRules, relTime, stepTimes, supplyOf } from "@/lib/protocols/quick";

/**
 * The generic chart over a version's step list (P3's `QuickRules`): what a protocol charts until its
 * own rule module ports the full rule sheet (P5), and what a hospital's builder protocols chart with.
 * Give steps: a "Given" per administration at its time, with the checks before each dose (P6: the
 * dose is refused until every check is ticked); infusions: "Started"; result steps: a value in the
 * record form, read against the version's bands; check steps: a task at each time; rules: lines.
 * Every number comes from the version.
 */

const parse = (v: ChartVersion) => QuickRules.safeParse(v.rules);

export const stepsModule: RuleModule = {
  id: "steps",
  short: (v) => v.name,
  check: (v) => (parse(v).success ? null : W.unreadable),
  build: (K) => buildSteps(K),
};

function facts(K: Kit) {
  return {
    ageYears: K.facts.ageYears,
    sex: K.facts.sex,
    weightKg: K.facts.weightKg,
    pregnant: K.facts.pregnant,
  };
}

export function buildSteps(K: Kit): Built {
  const parsed = parse(K.version);
  const rules = parsed.success ? parsed.data : null;
  const steps = rules?.steps ?? [];
  const pf = facts(K);
  const { T, now } = K;
  const at = (min: number) => K.c.start + min * 60000;
  const giveAct = (st: RuleStep) => ({
    t: "give" as const,
    key: st.id,
    ...(st.checks?.length ? { checks: [...st.checks] } : {}),
  });

  const acts: Step[] = [];
  const tasks: { key: string; title: string; sub: string; at: number; btns: Btn[] }[] = [];
  const results = steps.filter((s) => s.kind === "result");
  const lines = steps
    .filter((s) => s.kind === "rule")
    .map((s) => K.L(`${s.title}: ${s.text ?? ""}`));

  for (const st of steps) {
    if (st.kind === "rule") continue;
    const times = stepTimes(st).map(at);
    if (st.kind === "give") {
      const given = K.gv(st.id);
      const n = given.length;
      const left = times.length ? n < times.length : n === 0;
      const d = doseOf(st, pf, n);
      const nextAt = times[n] ?? null;
      const late = left && nextAt !== null && nextAt < now;
      const b: Btn[] = left && !d.needWeight ? [K.btn(W.given, giveAct(st), "rn", "main")] : [];
      acts.push(
        K.A(
          {
            n: 0,
            title: st.title,
            sub: st.text ?? "",
            rows: [
              K.row(W.dose, d.text || "—", "strong"),
              K.row(W.given2, times.length ? fill(W.ofN, { n, of: times.length }) : String(n)),
              ...(nextAt !== null && left ? [K.row(W.next, K.hh(nextAt))] : []),
            ],
            items: (st.checks ?? []).map((ch) => K.it(ch, W.beforeDose, W.check, "todo")),
            btns: b,
            fields: d.needWeight ? K.wtBits(st.title).fields : [],
            lines: given.map((g, i) => K.L(fill(W.givenAt, { n: i + 1, t: K.hh(g) }), "ok")),
            brief: left
              ? nextAt !== null
                ? fill(W.nextAt, { t: K.hh(nextAt) })
                : W.notYet
              : W.allGiven,
          },
          K.st(!left, late),
        ),
      );
      if (left && nextAt !== null && !d.needWeight)
        tasks.push({
          key: `give:${st.id}:${n}`,
          title: `${st.title}: ${d.text}`,
          sub: (st.checks ?? []).join(" · "),
          at: nextAt,
          btns: b,
        });
    } else if (st.kind === "infusion") {
      const on = T[st.id];
      const startAt = times[0] ?? K.c.start;
      const d = doseOf(st, pf, 0);
      const b = on || d.needWeight ? [] : [K.btn(W.started, K.mark(st.id), "rn", "main")];
      acts.push(
        K.A(
          {
            n: 0,
            title: st.title,
            sub: st.text ?? "",
            rows: [
              K.row(W.dose, d.text || "—", "strong"),
              K.row(W.starts, relTime(stepTimes(st)[0] ?? 0)),
            ],
            fields: d.needWeight ? K.wtBits(st.title).fields : [],
            btns: b,
            brief: on ? fill(W.startedAt, { t: K.hh(on) }) : fill(W.nextAt, { t: K.hh(startAt) }),
          },
          K.st(!!on, !on && startAt < now),
        ),
      );
      if (!on && !d.needWeight)
        tasks.push({
          key: `inf:${st.id}`,
          title: `${st.title}: ${d.text}`,
          sub: st.text ?? "",
          at: startAt,
          btns: b,
        });
    } else if (st.kind === "result") {
      const v = K.latest(st.id);
      const list = Array.isArray(st.bands) ? st.bands : [];
      const hit = v !== null ? bandOf(list, v) : null;
      acts.push(
        K.A(
          {
            n: 0,
            title: st.title,
            sub: st.text ?? "",
            branchHead:
              v === null ? W.needsValue : fill(W.latest, { v, unit: st.input?.unit ?? "" }),
            branches: list.map((b) => K.br(b.range, b.text, b === hit, v !== null, !!b.stop)),
            brief: v === null ? W.needsValue : `${v} ${st.input?.unit ?? ""}`.trim(),
          },
          K.st(v !== null, !!hit?.stop),
        ),
      );
    } else {
      const doneN = times.filter((t, i) => T[`${st.id}@${i}`] || t > now).length;
      const nextI = times.findIndex((_, i) => !T[`${st.id}@${i}`]);
      const b = nextI >= 0 ? [K.btn(W.done, K.mark(`${st.id}@${nextI}`), "rn", "main")] : [];
      acts.push(
        K.A(
          {
            n: 0,
            title: st.title,
            sub: st.text ?? "",
            rows: times.length ? [K.row(W.times, stepTimes(st).map(relTime).join(", "))] : [],
            btns: b,
            brief:
              nextI >= 0 && times[nextI] ? fill(W.nextAt, { t: K.hh(times[nextI]!) }) : W.allDone,
          },
          K.st(
            nextI < 0,
            doneN < times.length && times.some((t, i) => t < now && !T[`${st.id}@${i}`]),
          ),
        ),
      );
      if (nextI >= 0 && times[nextI] !== undefined)
        tasks.push({
          key: `chk:${st.id}:${nextI}`,
          title: st.title,
          sub: st.text ?? "",
          at: times[nextI]!,
          btns: b,
        });
    }
  }
  if (lines.length)
    acts.push(K.A({ n: 0, title: W.rules, lines, brief: W.rules }, K.st(true, false)));
  acts.push(K.A({ n: 0, title: W.endTitle, btns: [K.endBtn(K.version.name)], brief: W.endBrief }));

  const supply = rules ? supplyOf(rules, pf) : [];
  const giveBtns = acts.filter((a) => a.items.length);
  return {
    phases: [{ id: "run", title: W.phase, win: W.phaseWin, from: 0, to: null, acts }],
    rn: {
      title: W.rnTitle,
      note: W.rnNote,
      acts: giveBtns.length
        ? giveBtns.map((a) => ({ ...a, head: W.check }))
        : [K.A({ n: 0, title: W.rnNone, brief: "" }, K.st(true, false))],
    },
    flow: (F) => [
      F.P("run"),
      ...acts.map((a, i) =>
        a.branches.length
          ? F.D(
              `run${i + 1}`,
              a.title,
              a.branches.map((b) => F.Br(b.range, b.text, b.known ? b.on : null)),
            )
          : F.N(`run${i + 1}`, a.title),
      ),
    ],
    tasks: (tk) => tasks.forEach((t) => tk(t.key, t.title, t.sub, t.at, t.btns)),
    rows: results.map((s) => [
      s.id,
      `${s.input?.label ?? s.title}${s.input?.unit ? `, ${s.input.unit}` : ""}`,
    ]),
    dueAt: (key, h) => {
      const st = results.find((s) => s.id === key);
      return !!st && stepTimes(st).some((m) => Math.round(m / K.slotMin) === h);
    },
    form: results.map((s) => ({
      key: s.id,
      label: s.input?.label ?? s.title,
      unit: s.input?.unit ?? "",
      dflt: "",
    })),
    formReq: results.map((s) => s.id),
    labKeys: [],
    recWhat: () =>
      results.map((s) => (s.input?.label ?? s.title).toLowerCase()).join(", ") || W.notes,
    recHint: () => W.recHint,
    panels: results.map((s) => ({
      key: s.id,
      name: s.input?.label ?? s.title,
      unit: s.input?.unit ?? "",
      min: 0,
      max: 1,
      ticks: [],
    })),
    stats: [],
    aims: [],
    meds: supply.map((s) => ({ drug: s.drug, qty: s.qty ?? 0, why: s.doseText })),
    phRows: supply.map((s) => K.row(s.drug, `${s.qty ?? "—"} ${s.unit} · ${s.doseText}`)),
    logWords: Object.fromEntries(steps.map((s) => [s.id, s.title])),
  };
}
