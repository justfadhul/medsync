import type { RuleModule } from "./index";
import type { Built, Kit } from "@/lib/protocols/engine/kit";
import type { Btn, ChartVersion, Interp } from "@/lib/protocols/engine/types";
import { z } from "zod";

import { fill } from "@/content/protocol-charts";
import { SE_COPY } from "@/content/protocol-charts-rules";
import { QuickRules, supplyOf } from "@/lib/protocols/quick";

/**
 * Status epilepticus (any age), FEATURES.md §2.7: the prototype's `PC.se` on the generic kit. Every
 * number is the version's `seed` (0286); the words are SE_COPY (draft). Blocking rules held here and
 * so in the server action (P6): diazepam at most `maxDoses` (IV `dzIv` or rectal `dzPr`), a child's
 * dose and phenobarbital only with a weight (P7). The nurse's "Fitting stopped" / "Fitting again"
 * decides every later step.
 */

const W = SE_COPY;

const num = z.number().finite();
const Phase = z.object({ id: z.string(), from: num, to: num.nullable() });
export const SeSeed = z.object({
  phases: z.array(Phase).length(4),
  childUnderAge: num,
  stabiliseDoneFrom: num,
  glucose: z.object({
    childUnder: num,
    adultUnder: num,
    childMlKg: num,
    adultMl: num,
    thiamineMg: num,
  }),
  diazepam: z.object({
    adultIvMg: num,
    adultPrMgFrom: num,
    adultPrMgTo: num,
    childIvMgKg: num,
    childPrMgKg: num,
    childMaxMg: num,
    mgPerMl: num,
    ivOverMinutes: num,
    afterMinutes: num,
    repeatMinutes: num,
    maxDoses: num,
  }),
  phenobarbital: z.object({
    mgKg: num,
    maxMg: num,
    afterMinutes: num,
    dilution: num,
    overMinutes: num,
    mgPerMl: num,
  }),
  refractory: z.object({ fromMinutes: num, toMinutes: num }),
  aims: z.object({ diazepamByMinutes: num, stoppedByMinutes: num }),
  flags: z.object({ spo2Under: num, spo2CritUnder: num, rrUnder: num }),
  monitor: z.object({ vitalsMinutes: num }),
  refs: z.record(z.string(), z.unknown()),
});
export type SeSeed = z.infer<typeof SeSeed>;

const se: RuleModule = {
  id: "se",
  short: () => W.short,
  check: (v: ChartVersion) =>
    SeSeed.safeParse(v.seed).success && QuickRules.safeParse(v.rules).success
      ? null
      : W.seedMissing,
  build: (K) => buildSe(K),
};
export default se;

const MS = 60000;
const r1 = (x: number) => Math.round(x * 10) / 10;

export function buildSe(K: Kit): Built {
  const S = SeSeed.parse(K.version.seed);
  const rules = QuickRules.parse(K.version.rules);
  const { T, c, facts: p, now, el, w, hh, L, A, btn, st, mark, fld, row, br, crit } = K;
  const DZ = S.diazepam;
  const PB = S.phenobarbital;
  const child = p.ageYears !== null && p.ageYears < S.childUnderAge;
  const stopped = !!T.stopped && !(T.again && T.again > T.stopped);
  const fitting = !stopped;

  // ─── Stabilise ───
  const abc = K.many("abc");
  const g = K.latest("cbg");
  const lowUnder = child ? S.glucose.childUnder : S.glucose.adultUnder;
  const lowG = g !== null && g < lowUnder;
  const gluBtn = lowG && !T.glu ? [btn(W.gluGiven, mark("glu"), "rn", "main")] : [];
  const a1 = A(
    {
      n: 1,
      title: W.a1,
      sub: W.a1Sub,
      chips: K.pickN("abc", W.abc),
      chipWho: "rn",
      fields: [fld("cbg", W.cbg, "mmol/L"), fld("spo2", W.spo2, "%")],
      branchHead: g === null ? W.needsGlucose : fill(W.glucoseIs, { v: g }),
      branches: [
        br(
          fill(W.low, { n: lowUnder }),
          child
            ? fill(W.lowChild, {
                mlkg: S.glucose.childMlKg,
                ml: w ? `${Math.round(S.glucose.childMlKg * w)} ml` : W.byWeight,
              })
            : fill(W.lowAdult, { ml: S.glucose.adultMl, th: S.glucose.thiamineMg }),
          lowG,
          g !== null,
          true,
        ),
        br(W.normal, W.goDiazepam, g !== null && !lowG, g !== null),
      ],
      btns: gluBtn,
      lines: p.pregnant ? [L(W.pregnant, "alert")] : [],
    },
    st(
      abc.length >= S.stabiliseDoneFrom && g !== null && (!lowG || !!T.glu),
      (lowG && !T.glu) || g === null,
    ),
  );
  a1.brief =
    fill(W.abcDone, { n: abc.length, of: W.abc.length }) +
    (g !== null ? fill(W.glucoseBrief, { v: g }) : W.noGlucoseBrief);

  // ─── Diazepam (IV `dzIv` or rectal `dzPr`), at most maxDoses ───
  const dz = [...K.gv("dzIv"), ...K.gv("dzPr")].sort((a, b) => a - b);
  const dzIV = child ? (w ? Math.min(DZ.childMaxMg, r1(DZ.childIvMgKg * w)) : null) : DZ.adultIvMg;
  const dzPR = child ? (w ? Math.min(DZ.childMaxMg, r1(DZ.childPrMgKg * w)) : null) : null;
  const ml = (mg: number, c2: number) => r1(mg / c2);
  const ivWord = dzIV !== null ? `${dzIV} mg` : W.needsWeight;
  const prWord = child
    ? dzPR !== null
      ? `${dzPR} mg`
      : W.needsWeight
    : `${DZ.adultPrMgFrom}–${DZ.adultPrMgTo} mg`;
  const dzBtns = (main: boolean): Btn[] =>
    dzIV !== null && dz.length < DZ.maxDoses
      ? [
          btn(W.givenIv, K.give("dzIv"), "rn", main ? "main" : undefined),
          btn(W.givenPr, K.give("dzPr"), "rn"),
        ]
      : [];
  const a2 = A(
    {
      n: 2,
      title: W.a2,
      sub: child
        ? fill(W.a2SubChild, { iv: DZ.childIvMgKg, max: DZ.childMaxMg, pr: DZ.childPrMgKg })
        : fill(W.a2SubAdult, {
            iv: DZ.adultIvMg,
            min: DZ.ivOverMinutes,
            a: DZ.adultPrMgFrom,
            b: DZ.adultPrMgTo,
          }),
      rows: [
        row(
          W.rWeight,
          w ? fill(W.weightIs, { w, from: p.weightFrom ?? "" }) : W.notRecorded,
          w ? undefined : "warn",
        ),
        row(
          W.rIv,
          dzIV !== null
            ? fill(W.ivIs, { d: dzIV, ml: ml(dzIV, DZ.mgPerMl), c: DZ.mgPerMl })
            : W.needsWeight,
          "strong",
        ),
        row(
          W.rPr,
          child
            ? dzPR !== null
              ? fill(W.prIs, { d: dzPR, ml: ml(dzPR, DZ.mgPerMl), c: DZ.mgPerMl })
              : W.needsWeight
            : fill(W.prRange, {
                a: DZ.adultPrMgFrom,
                b: DZ.adultPrMgTo,
                ma: ml(DZ.adultPrMgFrom, DZ.mgPerMl),
                mb: ml(DZ.adultPrMgTo, DZ.mgPerMl),
                c: DZ.mgPerMl,
              }),
        ),
      ],
      btns: dz.length ? [] : dzBtns(true),
      lines: [
        dz.length
          ? L(fill(W.givenAtLine, { t: hh(dz[0]!) }), "ok")
          : fitting
            ? L(fill(W.giveNow, { n: DZ.afterMinutes }), "alert")
            : L(W.fitStopped, "ok"),
        L(W.watchBreathing),
      ],
    },
    st(dz.length > 0 || !fitting, fitting && !dz.length),
  );
  if (!w) a2.fields = K.wtBits(W.weightWhy).fields;
  a2.brief = dz.length ? fill(W.givenBrief, { t: hh(dz[0]!) }) : fitting ? W.due : W.notNeeded;

  const d2at = dz.length ? dz[0]! + DZ.repeatMinutes * MS : null;
  const need2 = fitting && dz.length === 1 && d2at !== null && now >= d2at;
  const a3 = A(
    {
      n: 3,
      title: W.a3,
      sub: fill(W.a3Sub, { n: DZ.repeatMinutes, max: DZ.maxDoses }),
      rows: [row(W.rDue, d2at ? hh(d2at) : W.afterFirst)],
      btns: fitting && dz.length >= 1 ? dzBtns(need2) : [],
      lines:
        dz.length >= DZ.maxDoses ? [L(fill(W.noMore, { t: hh(dz[DZ.maxDoses - 1]!) }), "ok")] : [],
    },
    st(dz.length >= DZ.maxDoses || (!fitting && dz.length > 0), need2),
  );
  a3.brief =
    dz.length >= 2
      ? fill(W.givenBrief, { t: hh(dz[1]!) })
      : need2
        ? W.dueNow
        : d2at
          ? fill(W.atT, { t: hh(d2at) })
          : W.afterDose1;

  // ─── Phenobarbital ───
  const pb = w ? Math.min(PB.maxMg, Math.round(PB.mgKg * w)) : null;
  const pbWord = pb !== null ? `${pb} mg` : fill(W.mgkgWord, { n: PB.mgKg });
  const pbAt = dz.length >= DZ.maxDoses ? dz[DZ.maxDoses - 1]! + PB.afterMinutes * MS : null;
  const needPb = fitting && pbAt !== null && now >= pbAt && !T.pbAt;
  const pbBtn =
    fitting && dz.length >= DZ.maxDoses && !T.pbAt && pb !== null
      ? [btn(W.pbStarted, mark("pbAt"), "rn", needPb ? "main" : undefined)]
      : [];
  const b1 = A(
    {
      n: 1,
      title: W.b1,
      sub: fill(W.b1Sub, {
        after: PB.afterMinutes,
        mgkg: PB.mgKg,
        max: PB.maxMg,
        dil: PB.dilution,
        over: PB.overMinutes,
      }),
      rows: [
        row(
          W.rDose,
          pb !== null
            ? fill(W.pbIs, { d: pb, ml: ml(pb, PB.mgPerMl), c: PB.mgPerMl })
            : W.needsWeight,
          "strong",
        ),
        row(W.rDue, pbAt ? hh(pbAt) : W.after2),
      ],
      btns: [...(fitting && dz.length ? K.ivBtn() : []), ...pbBtn],
      lines: [
        T.pbAt ? L(fill(W.pbStartedLine, { t: hh(T.pbAt) }), "ok") : L(W.ventilation, "warn"),
        ...(K.hasLine ? [] : [K.ivLine()]),
      ],
    },
    st(!!T.pbAt || (!fitting && dz.length > 0), needPb),
  );
  if (!w) b1.fields = K.wtBits(W.weightWhy).fields;
  b1.brief = T.pbAt ? fill(W.startedBrief, { t: hh(T.pbAt) }) : needPb ? W.dueNow : W.notYet;

  const causes = K.many("cause");
  const b2 = A(
    {
      n: 2,
      title: W.b2,
      sub: W.b2Sub,
      chips: K.pickN("cause", W.causes),
      chipWho: "dr",
      items: K.invItems([
        ["mrdt", W.invMrdt],
        ["ue", W.invUe],
        ["lp", W.invLp, true],
        ["ct", W.invCt, true],
      ]),
      btns: causes.length ? [btn(W.rxCause, { t: "rx" }, "dr")] : [],
      lines: [
        ...(causes.includes(W.causes[2]) ? [L(W.malariaLine, "alert")] : []),
        ...(p.problems.length ? [L(fill(W.problems, { list: p.problems.join(", ") }))] : []),
      ],
    },
    st(causes.length > 0, false),
  );
  b2.brief = causes.join(", ") || W.notSet;

  // ─── Refractory, after the fit ───
  const refr = fitting && el >= S.refractory.fromMinutes * MS;
  const c1 = A(
    {
      n: 1,
      title: W.c1,
      sub: fill(W.c1Sub, { a: S.refractory.fromMinutes, b: S.refractory.toMinutes }),
      btns: refr && !T.anaes ? [btn(W.anaesBtn, mark("anaes"), "dr", "main")] : [],
      lines: [
        T.anaes
          ? L(fill(W.anaesAt, { t: hh(T.anaes) }), "ok")
          : refr
            ? L(fill(W.callNow, { n: Math.round(el / MS) }), "alert")
            : L(W.notNow),
      ],
    },
    st(!refr || !!T.anaes, refr && !T.anaes),
  );
  c1.brief = T.anaes ? fill(W.anaesBrief, { t: hh(T.anaes) }) : refr ? W.callNowBrief : W.notNeeded;

  const e1 = A(
    {
      n: 1,
      title: W.e1,
      sub: fill(W.e1Sub, { n: S.monitor.vitalsMinutes }),
      crit: [
        crit(
          W.cStopped,
          stopped ? fill(W.stoppedAt, { t: hh(T.stopped!) }) : W.stillFitting,
          stopped,
          true,
        ),
      ],
      btns: stopped
        ? [
            ...(T.maint
              ? []
              : [btn(W.rxMaint, { t: "rx" }, "dr"), btn(W.maintBtn, mark("maint"), "dr", "main")]),
            K.endBtn(W.short),
          ]
        : [],
      lines: T.maint ? [L(fill(W.maintAt, { t: hh(T.maint) }), "ok")] : [],
    },
    st(stopped && !!T.maint, false),
  );
  e1.brief = stopped ? fill(W.stoppedBrief, { t: hh(T.stopped!) }) : W.stillBrief;

  const rn1 = A(
    {
      n: 1,
      head: W.rnHead,
      title: W.rnTitle,
      sub: W.rnSub,
      rows: [
        row(W.rSince, K.dur(el)),
        row(
          W.rDrugs,
          [dz.length ? fill(W.dzN, { n: dz.length }) : "", T.pbAt ? W.pbWord : ""]
            .filter(Boolean)
            .join(", ") || W.none,
        ),
      ],
      btns: [
        stopped ? btn(W.again, mark("again"), "rn") : btn(W.stopped, mark("stopped"), "rn", "main"),
      ],
      lines: [
        stopped ? L(fill(W.stoppedLine, { t: hh(T.stopped!) }), "ok") : L(W.stillLine, "alert"),
      ],
    },
    st(stopped, !stopped),
  );

  // ─── Monitoring chart ───
  const PH = S.phases;
  const SM = K.slotMin;
  const flag = (lvl: Interp["lvl"], word: string): Interp => ({ lvl, word, text: "", ref: "" });
  const F_ = S.flags;
  const supply = supplyOf(rules, {
    ageYears: p.ageYears,
    sex: p.sex,
    weightKg: p.weightKg,
    pregnant: p.pregnant,
  });
  const winOf = (i: number) =>
    PH[i]!.to === null
      ? fill(W.winAfter, { a: PH[i]!.from * SM })
      : fill(W.win, { a: PH[i]!.from * SM, b: PH[i]!.to! * SM });
  const titles = [W.ph1, W.ph2, W.ph3, W.ph4];
  const acts = [[a1], [a2, a3], [b1, b2], [c1, e1]];

  return {
    phases: PH.map((ph, i) => ({ ...ph, title: titles[i]!, win: winOf(i), acts: acts[i]! })),
    rn: { title: W.rnTitle, note: "", acts: [rn1] },
    flow: (F) => [
      F.P(PH[0]!.id),
      F.D(`${PH[0]!.id}1`, W.fLow, [
        F.Br(W.yes, W.fGlucFirst, g !== null ? lowG : null),
        F.Br(W.no, W.fDz, g !== null ? !lowG : null),
      ]),
      F.P(PH[1]!.id),
      F.D(`${PH[1]!.id}1`, fill(W.fAt5, { n: DZ.afterMinutes }), [
        F.Br(
          W.yes,
          fill(W.fDzIv, { d: ivWord }),
          dz.length ? true : fitting && el >= DZ.afterMinutes * MS ? true : null,
        ),
        F.Br(W.no, W.observe, stopped && !dz.length ? true : null),
      ]),
      F.D(`${PH[1]!.id}2`, fill(W.fStill10, { n: DZ.repeatMinutes }), [
        F.Br(W.yes, W.fSecond, dz.length >= 2 ? true : null),
        F.Br(W.no, W.observe, dz.length === 1 && stopped ? true : null),
      ]),
      F.P(PH[2]!.id),
      F.D(`${PH[2]!.id}1`, W.fStill, [
        F.Br(W.yes, fill(W.fPb, { d: pbWord }), T.pbAt ? true : null),
        F.Br(W.no, W.fCause, dz.length >= 2 && stopped && !T.pbAt ? true : null),
      ]),
      F.N(`${PH[2]!.id}2`, W.fCauseN),
      F.P(PH[3]!.id),
      F.D(`${PH[3]!.id}1`, fill(W.fRefr, { n: S.refractory.toMinutes }), [
        F.Br(W.yes, W.fIcu, refr || T.anaes ? true : null),
        F.Br(W.no, W.fAfter, stopped ? true : null),
      ]),
      F.N(`${PH[3]!.id}2`, W.fAfterN),
    ],
    tasks: (tk) => {
      if (fitting && !dz.length)
        tk(
          "dz1",
          fill(W.tDz, { iv: ivWord, pr: prWord }),
          fill(W.tDzSub, { n: DZ.afterMinutes }),
          c.start,
          dzBtns(true),
        );
      if (lowG && !T.glu)
        tk(
          "glu",
          fill(W.tGlu, { v: g }),
          child
            ? fill(W.tGluChild, { mlkg: S.glucose.childMlKg })
            : fill(W.tGluAdult, { ml: S.glucose.adultMl }),
          now,
          gluBtn,
        );
      if (fitting && dz.length >= 1 && dz.length < DZ.maxDoses)
        tk("dz2", W.tDz2, fill(W.tDz2Sub, { d: ivWord }), d2at!, dzBtns(true));
      if (fitting && dz.length >= DZ.maxDoses && !T.pbAt)
        tk("pb", fill(W.tPb, { d: pbWord, n: PB.overMinutes }), W.tPbSub, pbAt!, pbBtn);
    },
    rows: [
      ["fit", W.gFit],
      ["spo2", W.gSpo2],
      ["rr", W.gRr],
      ["pulse", W.gPulse],
    ],
    cellFlag: (key, x) => {
      const n = parseFloat(x);
      if (Number.isNaN(n)) return null;
      if (key === "fit") return n >= 1 ? flag("crit", W.wFitting) : flag("ok", W.wNotFitting);
      if (key === "spo2")
        return n < F_.spo2CritUnder
          ? flag("crit", W.wLow)
          : n < F_.spo2Under
            ? flag("abn", W.wLow)
            : null;
      if (key === "rr") return n < F_.rrUnder ? flag("crit", W.wSlow) : null;
      return K.interp(key, x);
    },
    dueAt: (key) => key === "fit" || key === "spo2",
    form: [
      { key: "fit", label: W.fmFit, unit: "1/0", dflt: stopped ? "0" : "1" },
      { key: "spo2", label: W.fmSpo2, unit: "%", dflt: "" },
      { key: "rr", label: W.fmRr, unit: "/min", dflt: "" },
      { key: "pulse", label: W.fmPulse, unit: "/min", dflt: "" },
    ],
    formReq: ["spo2", "rr"],
    labKeys: [],
    recWhat: () => W.recWhat,
    recHint: () => fill(W.recHint, { n: SM, rr: F_.rrUnder }),
    panels: [
      {
        key: "spo2",
        name: W.pSpo2,
        unit: "%",
        min: 75,
        max: 100,
        ticks: [80, 90, 100],
        thr: [[F_.spo2Under, fill(W.thrSpo2, { n: F_.spo2Under }), "amb"]],
        bad: (x) => x < F_.spo2CritUnder,
      },
      {
        key: "rr",
        name: W.pRr,
        unit: "/min",
        min: 0,
        max: 50,
        ticks: [0, 25, 50],
        thr: [[F_.rrUnder, fill(W.thrRr, { n: F_.rrUnder }), "amb"]],
        bad: (x) => x < F_.rrUnder,
      },
    ],
    stats: [
      {
        k: W.sFitting,
        v: stopped ? W.sStopped : W.yes,
        s: stopped ? fill(W.stoppedAt, { t: hh(T.stopped!) }) : fill(W.forD, { d: K.dur(el) }),
        cls: stopped ? "ok" : "warn",
      },
      {
        k: W.sDz,
        v: fill(W.ofN, { n: dz.length, of: DZ.maxDoses }),
        s: fill(W.ivEach, { d: ivWord }),
      },
      { k: W.sPb, v: T.pbAt ? W.started : "—", s: pbWord },
      {
        k: W.sGlucose,
        v: g !== null ? `${g} mmol/L` : "—",
        s: W.checkedFirst,
        ...(lowG ? { cls: "warn" as const } : {}),
      },
      {
        k: W.sWeight,
        v: w ? `${w} kg` : "—",
        s: child && p.ageYears !== null ? fill(W.years, { n: p.ageYears }) : "",
      },
    ],
    aims: [
      { word: W.aGlucose, ok: g !== null, known: true },
      {
        word: fill(W.aDz, { n: S.aims.diazepamByMinutes }),
        ok: dz.length > 0 && dz[0]! - c.start <= S.aims.diazepamByMinutes * MS,
        known: dz.length > 0 || el > S.aims.diazepamByMinutes * MS,
      },
      {
        word: fill(W.aStopped, { n: S.aims.stoppedByMinutes }),
        ok: stopped && T.stopped! - c.start <= S.aims.stoppedByMinutes * MS,
        known: stopped || el > S.aims.stoppedByMinutes * MS,
      },
    ],
    meds: supply.map((s) => ({ drug: s.drug, qty: s.qty ?? 0, why: s.doseText })),
    phRows: [
      row(W.phDz, fill(W.phDzIs, { n: dz.length, of: DZ.maxDoses })),
      row(
        W.phPb,
        (pb !== null
          ? fill(W.phPbIs, { d: pb, n: Math.ceil(pb / PB.mgPerMl) })
          : fill(W.mgkgWord, { n: PB.mgKg })) +
          (T.pbAt ? fill(W.phPbStarted, { t: hh(T.pbAt) }) : W.phPbIf) +
          W.controlled,
      ),
    ],
    logWords: W.log,
  };
}
