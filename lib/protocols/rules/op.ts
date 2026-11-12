import type { RuleModule } from "./index";
import type { Built, Kit } from "@/lib/protocols/engine/kit";
import type { ChartVersion, Interp } from "@/lib/protocols/engine/types";
import { z } from "zod";

import { fill } from "@/content/protocol-charts";
import { OP_COPY } from "@/content/protocol-charts-rules";
import { QuickRules, supplyOf } from "@/lib/protocols/quick";

/**
 * Organophosphate poisoning (any age), FEATURES.md §2.8: the prototype's `PC.op` on the generic kit.
 * Every number is the version's `seed` (0286); the words are OP_COPY (draft). Atropine doubles each
 * dose until the 5 signs from the last check are met (or the doctor calls it); then an infusion of a
 * share of the total each hour. Too much atropine stops it; the doctor restarts it at the lower rate
 * only after the stop time. A child's dose needs a weight (P7).
 */

const W = OP_COPY;

const num = z.number().finite();
const Phase = z.object({ id: z.string(), from: num, to: num.nullable() });
export const OpSeed = z.object({
  phases: z.array(Phase).length(4),
  childUnderAge: num,
  signsToTreat: num,
  abcDoneFrom: num,
  airway: z.object({ intubateGcsAtOrUnder: num, spo2Under: num, lavageWithinH: num }),
  atropine: z.object({
    adultMg: num,
    childMgKg: num,
    childMinMg: num,
    factor: num,
    everyMinutes: num,
    mgPerMl: num,
  }),
  atropinised: z.object({ pulseOver: num, sbpOver: num, doctorCallFrom: num }),
  infusion: z.object({
    pctOptions: z.array(num).min(1),
    pctDefault: num,
    restartPct: num,
    stopMinutes: num,
    signsEveryMinutes: num,
  }),
  weakness: z.object({ everyH: num, fromDays: num, toDays: num }),
  reviewH: num,
  aims: z.object({ firstDoseMinutes: num, atropinisedMinutes: num }),
  pulseTooFastOver: num,
  pulseSlowUnder: num,
  pharmacyWarnOverMg: num,
  monitor: z.object({ vitalsMinutes: num }),
  refs: z.record(z.string(), z.unknown()),
});
export type OpSeed = z.infer<typeof OpSeed>;

const op: RuleModule = {
  id: "op",
  short: () => W.short,
  check: (v: ChartVersion) =>
    OpSeed.safeParse(v.seed).success && QuickRules.safeParse(v.rules).success
      ? null
      : W.seedMissing,
  build: (K) => buildOp(K),
};
export default op;

const MS = 60000;
const r2 = (x: number) => Math.round(x * 100) / 100;

export function buildOp(K: Kit): Built {
  const S = OpSeed.parse(K.version.seed);
  const rules = QuickRules.parse(K.version.rules);
  const { v, T, c, facts: p, now, hNow, w, hh, L, A, btn, st, mark, fld, row, it, crit, n1 } = K;
  const AT = S.atropine;
  const AS = S.atropinised;
  const INF = S.infusion;
  const child = p.ageYears !== null && p.ageYears < S.childUnderAge;
  const pctWords = INF.pctOptions.map((x) => `${x}%`);
  const pLo = Math.min(...INF.pctOptions);
  const pHi = Math.max(...INF.pctOptions);

  // ─── Recognise, airway ───
  const sx = K.many("sx");
  const a1 = A(
    {
      n: 1,
      title: W.a1,
      sub: W.a1Sub,
      chipHead: W.signsHead,
      chips: K.pickN("sx", W.signs),
      chipWho: "dr",
      segLabel: W.agentLabel,
      segs: K.pick1("agent", W.agents),
      segWho: "dr",
      fields: [
        fld("pulse", W.pulse, "/min"),
        fld("sbp", W.sbp, "mmHg"),
        fld("spo2", W.spo2, "%"),
        fld("rr", W.rr, "/min"),
        fld("gcs", W.gcs, "/15"),
      ],
      lines: [
        sx.length >= S.signsToTreat
          ? L(fill(W.treatLine, { n: sx.length }), "ok")
          : L(W.pickSigns, "warn"),
      ],
    },
    st(sx.length >= S.signsToTreat, false),
  );
  a1.brief = sx.length
    ? fill(W.signsBrief, { n: sx.length }) + (v.agent ? ` · ${v.agent.toLowerCase()}` : "")
    : W.notAssessed;

  const abc = K.many("abc");
  const gcs = K.val("gcs");
  const spo2 = K.val("spo2");
  const lowO2 = spo2 !== null && spo2 < S.airway.spo2Under;
  const a2 = A(
    {
      n: 2,
      title: W.a2,
      sub: fill(W.a2Sub, { h: S.airway.lavageWithinH }),
      chips: K.pickN("abc", W.abc),
      chipWho: "rn",
      lines: [
        (gcs !== null && gcs <= S.airway.intubateGcsAtOrUnder) || lowO2
          ? L(fill(W.intubate, { gcs: gcs ?? W.noValue, spo2: spo2 ?? W.noValue }), "alert")
          : L(fill(W.intubateIf, { n: S.airway.intubateGcsAtOrUnder })),
        K.ivLine(),
      ],
      btns: K.ivBtn(),
    },
    st(abc.length >= S.abcDoneFrom, lowO2 && !abc.includes(W.abc[1])),
  );
  a2.brief = fill(W.abcDone, { n: abc.length, of: W.abc.length });

  // ─── Atropine, doubling ───
  const d0 = child ? (w ? Math.max(AT.childMinMg, r2(AT.childMgKg * w)) : null) : AT.adultMg;
  const at = K.gv("atro");
  const amt = (i: number) => r2((d0 ?? 0) * Math.pow(AT.factor, i));
  const tot = r2(at.reduce((a, _, i) => a + amt(i), 0));
  const nextAmt = amt(at.length);
  const nextAt = at.length ? at[at.length - 1]! + AT.everyMinutes * MS : c.start;
  const lst = (k: string) => {
    const o = K.lastObs(k);
    return o ? parseFloat(o.values[k]!) : null;
  };
  const yn = (k: string, yes: string, no: string) =>
    lst(k) === null ? W.notChecked : lst(k) === 1 ? yes : no;
  const startOr = (k: string) =>
    lst(k) !== null
      ? String(lst(k))
      : K.val(k) !== null
        ? fill(W.atStart, { v: K.val(k)! })
        : W.noValueW;
  const S5 = [
    { t: W.sChest, ok: lst("chest") === 1, v: yn("chest", W.clear, W.crackles) },
    {
      t: fill(W.sPulse, { n: AS.pulseOver }),
      ok: lst("pulse") !== null && lst("pulse")! > AS.pulseOver,
      v: startOr("pulse"),
    },
    {
      t: fill(W.sSbp, { n: AS.sbpOver }),
      ok: lst("sbp") !== null && lst("sbp")! > AS.sbpOver,
      v: startOr("sbp"),
    },
    { t: W.sAxil, ok: lst("axil") === 1, v: yn("axil", W.dry, W.wet) },
    { t: W.sPupil, ok: lst("pupil") === 1, v: yn("pupil", W.normal, W.pinpoint) },
  ];
  const nOk = S5.filter((x) => x.ok).length;
  const atropinised = at.length > 0 && (nOk === S5.length || !!T.atrOk);
  const canGive = !atropinised && sx.length >= S.signsToTreat && d0 !== null;
  const giveBtn = btn(
    fill(W.giveNow, { d: nextAmt }),
    K.give("atro"),
    "rn",
    now >= nextAt ? "main" : undefined,
  );
  const crits = S5.map((x) => crit(x.t, x.v, x.ok, x.v !== W.notChecked && x.v !== W.noValueW));
  const b1 = A(
    {
      n: 1,
      title: fill(W.b1, { n: AT.everyMinutes }),
      sub:
        (child
          ? d0 !== null
            ? fill(W.b1Child, { mgkg: AT.childMgKg, d: d0 })
            : fill(W.b1ChildNoWeight, { mgkg: AT.childMgKg })
          : fill(W.b1Adult, { d: AT.adultMg })) + fill(W.b1Sub, { n: AT.everyMinutes }),
      rows: [
        row(
          W.rGiven,
          at.length
            ? at.map((t, i) => fill(W.givenEach, { d: amt(i), t: hh(t) })).join(" · ")
            : W.noneYet,
        ),
        row(W.rTotal, `${n1(tot)} mg`, "strong"),
        row(
          W.rNext,
          canGive
            ? fill(now >= nextAt ? W.nextNow : W.nextAt, { d: nextAmt, t: hh(nextAt) })
            : atropinised
              ? W.toInfusion
              : W.confirmFirst,
          canGive ? "strong" : undefined,
        ),
      ],
      btns: canGive ? [giveBtn] : [],
      lines: [
        K.hasLine
          ? L(fill(W.volLine, { c: AT.mgPerMl, d: nextAmt, ml: r2(nextAmt / AT.mgPerMl) }))
          : K.ivLine(),
      ],
    },
    st(atropinised, canGive && now >= nextAt),
  );
  if (child && !w) b1.fields = K.wtBits(W.weightWhy).fields;
  b1.brief =
    fill(at.length === 1 ? W.doses1 : W.dosesN, { n: at.length, t: n1(tot) }) +
    (atropinised ? W.atropinisedBrief : "");

  const b2 = A(
    {
      n: 2,
      title: W.b2,
      sub: W.b2Sub,
      crit: crits,
      btns:
        !atropinised && at.length > 0 && nOk >= AS.doctorCallFrom && S5[0]!.ok
          ? [btn(W.callIt, mark("atrOk"), "dr")]
          : [],
      lines: [
        atropinised ? L(W.atropinisedLine, "ok") : L(fill(W.keepDoubling, { n: nOk }), "warn"),
      ],
    },
    st(atropinised, !atropinised && at.length > 0 && now >= nextAt),
  );
  b2.brief = fill(W.ofFive, { n: nOk }) + (atropinised ? W.atropinisedBrief : "");

  // ─── Keep atropinised ───
  const pct = v.pct ? parseFloat(v.pct) : INF.pctDefault;
  const low = !!T.inf80;
  const rate = Math.round(tot * (pct / 100) * (low ? INF.restartPct / 100 : 1) * 10) / 10;
  const rateWord = low
    ? fill(W.rateLow, { r: rate, p: INF.restartPct })
    : fill(W.rate, { r: rate });
  const infBtn = atropinised && !T.infAt ? [btn(W.infStarted, mark("infAt"), "rn", "main")] : [];
  const c1 = A(
    {
      n: 1,
      title: W.c1,
      sub: fill(W.c1Sub, { a: pLo, b: pHi, n: INF.signsEveryMinutes }),
      chipHead: W.pctHead,
      chips: atropinised ? K.pick1("pct", pctWords) : [],
      chipWho: "dr",
      rows: [
        row(W.rTotalTo, `${n1(tot)} mg`),
        row(W.rInfusion, atropinised ? rateWord : W.afterAtropinised, "strong"),
      ],
      btns: infBtn,
      lines: T.infAt ? [L(fill(W.runningSince, { t: hh(T.infAt) }), "ok")] : [],
    },
    st(!!T.infAt, atropinised && !T.infAt),
  );
  c1.brief = T.infAt ? fill(W.rateBrief, { r: rate }) : atropinised ? W.startNow : W.notYet;

  const tox = K.many("tox");
  const restartAt = T.infHold ? T.infHold + INF.stopMinutes * MS : null;
  const stopBtn =
    tox.length && T.infAt && !T.infHold ? [btn(W.infStopped, mark("infHold"), "rn", "main")] : [];
  const c2 = A(
    {
      n: 2,
      title: W.c2,
      sub: fill(W.c2Sub, { n: INF.stopMinutes, p: INF.restartPct }),
      chips: K.pickN("tox", W.tox),
      chipWho: "rn",
      btns: [
        ...stopBtn,
        ...(T.infHold && !T.inf80 && now >= restartAt!
          ? [btn(fill(W.restart, { p: INF.restartPct }), mark("inf80"), "dr", "main")]
          : []),
      ],
      lines: [
        tox.length
          ? L(fill(W.tooMuch, { list: tox.join(", ").toLowerCase() }), "alert")
          : L(W.noneNow, "ok"),
        ...(T.infHold && !T.inf80
          ? [L(fill(W.restartFrom, { t: hh(T.infHold), at: hh(restartAt!) }), "warn")]
          : []),
      ],
    },
    st(!tox.length, tox.length > 0 && !T.infHold),
  );
  c2.brief = tox.length ? tox.join(", ") : W.none;

  const c3 = A(
    {
      n: 3,
      title: W.c3,
      sub: fill(W.c3Sub, {
        a: S.weakness.fromDays,
        b: S.weakness.toDays,
        h: S.weakness.everyH,
      }),
      items: [
        it(W.iNeck, fill(W.everyH, { h: S.weakness.everyH }), W.onVitals, "na"),
        it(
          W.iIcu,
          W.iIcuSub,
          T.icu ? fill(W.informedAt, { t: hh(T.icu) }) : W.notYet,
          T.icu ? "done" : "todo",
          T.icu ? [] : [btn(W.icuBtn, mark("icu"), "dr")],
        ),
      ],
    },
    st(true, false),
  );
  c3.brief = T.icu ? W.icuBrief : W.watching;

  const e1 = A(
    {
      n: 1,
      title: W.e1,
      sub: fill(W.e1Sub, { h: S.reviewH }),
      btns: T.infAt ? [K.endBtn(W.short)] : [],
    },
    st(false, false),
  );
  e1.brief = fill(W.atH, { h: S.reviewH });

  const rn1 = A(
    {
      n: 1,
      head: W.rnHead,
      title: W.rnTitle,
      crit: crits,
      lines: [L(fill(W.rnLine, { n: K.slotMin }))],
    },
    st(atropinised, false),
  );

  // ─── Monitoring chart ───
  const PH = S.phases;
  const SM = K.slotMin;
  const winOf = (i: number) =>
    PH[i]!.to === null
      ? fill(W.winAt, { h: S.reviewH })
      : fill(W.win, { a: K.dur(PH[i]!.from * SM * MS), b: K.dur(PH[i]!.to! * SM * MS) });
  const titles = [W.ph1, W.ph2, W.ph3, W.ph4];
  const acts = [[a1, a2], [b1, b2], [c1, c2, c3], [e1]];
  const flag = (lvl: Interp["lvl"], word: string): Interp => ({ lvl, word, text: "", ref: "" });
  const supply = supplyOf(rules, {
    ageYears: p.ageYears,
    sex: p.sex,
    weightKg: p.weightKg,
    pregnant: p.pregnant,
  });
  const dWord = d0 !== null ? `${d0} mg` : W.byWeight;

  return {
    phases: PH.map((ph, i) => ({ ...ph, title: titles[i]!, win: winOf(i), acts: acts[i]! })),
    rn: { title: W.rnTitle, note: "", acts: [rn1] },
    flow: (F) => [
      F.P(PH[0]!.id),
      F.N(`${PH[0]!.id}1`, W.fRecognise),
      F.N(`${PH[0]!.id}2`, W.fAirway),
      F.P(PH[1]!.id),
      F.N(`${PH[1]!.id}1`, fill(W.fAtro, { d: dWord })),
      F.D(
        `${PH[1]!.id}2`,
        W.fAll5,
        [
          F.Br(W.no, fill(W.fDouble, { n: AT.everyMinutes }), at.length ? !atropinised : null),
          F.Br(W.yes, W.fInfusion, at.length ? atropinised : null),
        ],
        fill(W.ofFive, { n: nOk }),
      ),
      F.P(PH[2]!.id),
      F.N(`${PH[2]!.id}1`, fill(W.fInf, { a: pLo, b: pHi })),
      F.D(`${PH[2]!.id}2`, W.fTooMuch, [
        F.Br(
          W.yes,
          fill(W.fStop, { n: INF.stopMinutes, p: INF.restartPct }),
          tox.length ? true : T.infAt ? false : null,
        ),
        F.Br(W.no, W.fContinue, T.infAt ? !tox.length : null),
      ]),
      F.N(`${PH[2]!.id}3`, W.fWeak),
      F.P(PH[3]!.id),
      F.N(`${PH[3]!.id}1`, W.fTaper),
    ],
    tasks: (tk) => {
      if (canGive)
        tk(
          `atro${at.length + 1}`,
          fill(W.tGive, { d: nextAmt }),
          fill(W.tGiveSub, { n: AT.everyMinutes }),
          nextAt,
          [giveBtn],
        );
      if (atropinised && !T.infAt) tk("inf", fill(W.tInf, { r: rate }), "", now, infBtn);
      if (stopBtn.length) tk("stop", W.tStop, tox.join(", "), now, stopBtn);
    },
    rows: [
      ["pulse", W.gPulse],
      ["sbp", W.gSbp],
      ["chest", W.gChest],
      ["axil", W.gAxil],
      ["pupil", W.gPupil],
    ],
    cellFlag: (key, x) => {
      const n = parseFloat(x);
      if (Number.isNaN(n)) return null;
      if (key === "pulse") return n > AS.pulseOver ? null : flag("abn", W.wLow);
      if (key === "sbp") return n > AS.sbpOver ? null : flag("crit", W.wLow);
      if (["chest", "axil", "pupil"].includes(key))
        return n >= 1 ? flag("ok", W.wYes) : flag("abn", W.wNo);
      return K.interp(key, x);
    },
    dueAt: (key) => ["pulse", "sbp", "chest"].includes(key),
    form: [
      { key: "pulse", label: W.fmPulse, unit: "/min", dflt: "" },
      { key: "sbp", label: W.fmSbp, unit: "mmHg", dflt: "" },
      { key: "chest", label: W.fmChest, unit: "1/0", dflt: "" },
      { key: "axil", label: W.fmAxil, unit: "1/0", dflt: "" },
      { key: "pupil", label: W.fmPupil, unit: "1/0", dflt: "" },
    ],
    formReq: ["pulse", "sbp"],
    labKeys: [],
    recWhat: () => W.recWhat,
    recHint: () => fill(W.recHint, { n: SM }),
    panels: [
      {
        key: "pulse",
        name: W.pPulse,
        unit: "/min",
        min: 40,
        max: 160,
        ticks: [60, 100, 140],
        thr: [
          [AS.pulseOver, fill(W.thrTarget, { n: AS.pulseOver }), "grn"],
          [S.pulseTooFastOver, fill(W.thrTooMuch, { n: S.pulseTooFastOver }), "amb"],
        ],
        bad: (x) => x < S.pulseSlowUnder,
      },
      {
        key: "sbp",
        name: W.pSbp,
        unit: "mmHg",
        min: 60,
        max: 160,
        ticks: [80, 120, 160],
        thr: [[AS.sbpOver, fill(W.thrTarget, { n: AS.sbpOver }), "grn"]],
        bad: (x) => x < AS.sbpOver,
      },
    ],
    stats: [
      { k: W.sAtropine, v: `${n1(tot)} mg`, s: fill(W.nDoses, { n: at.length }) },
      {
        k: W.sSigns,
        v: fill(W.ofFive, { n: nOk }),
        s: atropinised ? W.atropinised : W.keepGoing,
        cls: atropinised ? "ok" : "warn",
      },
      {
        k: W.sNext,
        v: canGive ? `${nextAmt} mg` : "—",
        s: canGive ? (now >= nextAt ? W.now : fill(W.atT, { t: hh(nextAt) })) : "",
      },
      {
        k: W.sInfusion,
        v: T.infAt ? fill(W.rateBrief, { r: rate }) : "—",
        s: T.infAt ? fill(W.sinceT, { t: hh(T.infAt) }) : "",
      },
      {
        k: W.sSpo2,
        v: spo2 !== null ? `${spo2}%` : "—",
        s: W.start,
        ...(lowO2 ? { cls: "warn" as const } : {}),
      },
    ],
    aims: [
      {
        word: fill(W.aFirst, { n: S.aims.firstDoseMinutes }),
        ok: at.length > 0 && at[0]! - c.start <= S.aims.firstDoseMinutes * MS,
        known: at.length > 0 || now - c.start > S.aims.firstDoseMinutes * MS,
      },
      {
        word: fill(W.aAtropinised, { n: S.aims.atropinisedMinutes }),
        ok: atropinised && hNow * SM <= S.aims.atropinisedMinutes,
        known: atropinised || hNow * SM > S.aims.atropinisedMinutes,
      },
      { word: W.aNoTox, ok: !tox.length, known: !!T.infAt },
    ],
    meds: supply.map((s) => ({ drug: s.drug, qty: s.qty ?? 0, why: s.doseText })),
    phRows: [
      row(
        W.phAtro,
        fill(W.phUsed, { t: n1(tot) }) +
          (canGive ? fill(W.phNext, { d: nextAmt }) : "") +
          (T.infAt ? fill(W.phInf, { r: rate, n: Math.ceil((rate * 24) / AT.mgPerMl) }) : "") +
          W.phLarge,
        tot > S.pharmacyWarnOverMg ? "warn" : undefined,
      ),
    ],
    logWords: W.log,
  };
}
