import type { RuleModule } from "./index";
import type { Built, Kit } from "@/lib/protocols/engine/kit";
import type { Btn, ChartVersion, Interp, Step } from "@/lib/protocols/engine/types";
import { z } from "zod";

import { fill } from "@/content/protocol-charts";
import { HYPERK_COPY } from "@/content/protocol-charts-rules";
import { QuickRules, supplyOf } from "@/lib/protocols/quick";

/**
 * Adult hyperkalaemia (UKKA), FEATURES.md §2.3: the prototype's `PC.hyperk` on the generic kit.
 * Every number is the version's `seed` (0285); the words are HYPERK_COPY (draft). Blocking rules
 * held here and so in the server action (P6): calcium only while the ECG has changed and never past
 * its dose count; insulin with glucose only at the grade that needs it.
 */

/** The words, in the prototype's wording. No number lives here: every `{n}` comes from the seed. */
const W = HYPERK_COPY;

const num = z.number().finite();
const Phase = z.object({ id: z.string(), from: num, to: num.nullable() });
export const HyperkSeed = z.object({
  phases: z.array(Phase).length(4),
  grade: z.object({ mildFrom: num, moderateFrom: num, severeFrom: num }),
  calcium: z.object({
    g: num,
    ml: num,
    overMinutesFrom: num,
    overMinutesTo: num,
    everyMinutes: num,
    maxDoses: num,
    digoxinMinutes: num,
  }),
  insulin: z.object({
    units: num,
    glucoseMl: num,
    overMinutes: num,
    fromK: num,
    lowGlucoseUnder: num,
    d10MlH: num,
    d10Hours: num,
  }),
  salbutamol: z.object({ mg: z.array(num).min(1), fastPulseOver: num }),
  hypo: z.object({ under: num, d10Ml: num, d20Ml: num, recheckMinutes: num }),
  watch: z.object({
    glucoseMinutes: z.array(num).min(1),
    potassiumMinutes: z.array(num).min(1),
  }),
  recheck: z.object({ repeatFrom: num, renalFrom: num }),
  remove: z.object({ renalEgfrUnder: num, renalUrgentEgfrUnder: num, acidHco3Under: num }),
  resolve: z.object({ kUnder: num, recheckWithinH: num }),
  refs: z.record(z.string(), z.unknown()),
});
export type HyperkSeed = z.infer<typeof HyperkSeed>;

const hyperk: RuleModule = {
  id: "hyperk",
  short: () => W.short,
  check: (v: ChartVersion) =>
    (v.rules as { module?: string | null } | null)?.module === "hyperk" &&
    HyperkSeed.safeParse(v.seed).success &&
    QuickRules.safeParse(v.rules).success
      ? null
      : W.seedMissing,
  build: (K) => buildHyperk(K),
};
export default hyperk;

const flag = (lvl: Interp["lvl"], word: string): Interp => ({ lvl, word, text: "", ref: "" });

export function buildHyperk(K: Kit): Built {
  const S = HyperkSeed.parse(K.version.seed);
  const rules = QuickRules.parse(K.version.rules);
  const { v, T, c, facts: p, now, hNow, hh, L, A, btn, st, mark, give, fld, it, row, br, crit } = K;
  const { val, latest, lastObs, ptsOf, many, gv, lbl } = K;
  const G = S.grade;
  const CA = S.calcium;
  const IG = S.insulin;
  const H = S.hypo;
  const R = S.recheck;
  const RS = S.resolve;
  const RM = S.remove;
  const slots = (mins: readonly number[]) => mins.map((m) => Math.round(m / K.slotMin));
  const GH = slots(S.watch.glucoseMinutes);
  const KH = slots(S.watch.potassiumMinutes);
  const minWord = (m: number) => lbl(m / K.slotMin);
  const timesWord = (mins: readonly number[]) => mins.map(minWord).join(", ");
  const watchEnd = minWord(S.watch.glucoseMinutes[S.watch.glucoseMinutes.length - 1]!);
  const firstK = minWord(S.watch.potassiumMinutes[0]!);
  /** "6.0 to 6.4": a band's words, its top one decimal under the next band. */
  const range = (a: number, next: number) => fill(W.range, { a, b: K.n1(next - 0.1) });

  const k0 = val("k");
  const kL = latest("k");
  const cbg0 = val("cbg");
  const ecgCh = many("ecg").some((x) => x !== W.noChanges) && !T.ecgOk;
  const ecgKnown = many("ecg").length > 0;
  const grade = (x: number) =>
    x >= G.severeFrom
      ? W.severe
      : x >= G.moderateFrom
        ? W.moderate
        : x >= G.mildFrom
          ? W.mild
          : W.normal;
  const emerg = (k0 !== null && k0 >= G.severeFrom) || ecgCh;
  const needIg = emerg || (k0 !== null && k0 >= IG.fromK);

  // ─── Protect the heart ───
  const a1 = A(
    {
      n: 1,
      title: W.a1,
      sub: W.a1Sub,
      fields: [fld("k", W.k, "mmol/L"), fld("cbg", W.cbg, "mmol/L")],
      chipHead: W.ecg,
      chips: K.pickN("ecg", W.ecgOpts),
      chipWho: "dr",
      branchHead:
        k0 === null
          ? W.needsK
          : fill(W.gradeHead, {
              k: k0,
              grade: grade(k0).toLowerCase(),
              ecg: ecgCh ? W.withEcg : "",
            }),
      branches: [
        br(
          fill(W.brEmerg, { n: G.severeFrom }),
          fill(W.brEmergText, { t: firstK }),
          emerg,
          k0 !== null,
          true,
        ),
        br(
          range(G.moderateFrom, G.severeFrom) + W.ecgNormal,
          fill(W.brModText, { t: firstK }),
          !emerg && k0 !== null && k0 >= G.moderateFrom,
          k0 !== null,
        ),
        br(
          range(G.mildFrom, G.moderateFrom),
          fill(W.brMildText, { h: RS.recheckWithinH }),
          !emerg && k0 !== null && k0 >= G.mildFrom && k0 < G.moderateFrom,
          k0 !== null,
        ),
      ],
      btns: [
        ...K.orderMissing(["k"]),
        ...(T.mon ? [] : [btn(W.monitor, mark("mon"), "rn", "main")]),
      ],
      lines: [
        T.mon
          ? L(fill(W.monitorOn, { t: hh(T.mon) }), "ok")
          : L(W.monitorPut, emerg ? "alert" : "warn"),
        ...(ecgKnown ? [] : [L(W.ecgRecord, "warn")]),
      ],
    },
    st(k0 !== null && ecgKnown && !!T.mon, emerg && !T.mon),
  );
  a1.brief =
    k0 !== null
      ? `K ${k0} · ${grade(k0)}${ecgCh ? ` · ${W.ecgChBrief}` : ecgKnown ? ` · ${W.ecgOkBrief}` : ""}`
      : W.needsKBrief;

  const ca = gv("ca");
  const caDue = ca.length ? ca[ca.length - 1]! + CA.everyMinutes * 60000 : c.start;
  const caMaxG = CA.g * CA.maxDoses;
  const caBtn = btn(fill(W.caBtn, { n: ca.length + 1 }), give("ca"), "rn", "main");
  const a2 = A(
    {
      n: 2,
      title: W.a2,
      sub: fill(W.a2Sub, {
        ml: CA.ml,
        g: CA.g,
        a: CA.overMinutesFrom,
        b: CA.overMinutesTo,
        every: CA.everyMinutes,
        max: caMaxG,
      }),
      rows: [
        row(
          W.rEcg,
          ecgCh
            ? W.ecgChanges
            : T.ecgOk
              ? fill(W.ecgBack, { t: hh(T.ecgOk) })
              : ecgKnown
                ? W.ecgNone
                : W.notRecorded,
          ecgCh ? "warn" : undefined,
        ),
        row(
          W.rGiven,
          ca.length
            ? fill(W.caGiven, { n: ca.length, g: CA.g, times: ca.map(hh).join(", ") })
            : W.none,
        ),
      ],
      // P6: calcium only while the ECG has changed, never past the dose count.
      btns:
        ecgCh && ca.length < CA.maxDoses
          ? [caBtn, ...(ca.length ? [btn(W.ecgOkBtn, mark("ecgOk"), "dr")] : [])]
          : [],
      lines: [
        ecgCh && ca.length >= CA.maxDoses
          ? L(fill(W.caMax, { max: caMaxG }), "alert")
          : ecgCh && ca.length
            ? L(fill(W.caNext, { t: hh(caDue) }), "warn")
            : !ecgCh
              ? L(W.caNotNeeded)
              : L(W.caNow, "alert"),
        L(fill(W.digoxin, { n: CA.digoxinMinutes })),
      ],
    },
    st(!ecgCh || ca.length > 0, ecgCh && !ca.length),
  );
  a2.brief =
    !ecgCh && !ca.length
      ? W.notNeeded
      : ca.length === 1
        ? W.dose1
        : fill(W.doses, { n: ca.length });

  // ─── Shift ───
  const lowG = cbg0 !== null && cbg0 < IG.lowGlucoseUnder;
  const a3 = A(
    {
      n: 3,
      title: W.a3,
      sub: fill(W.a3Sub, { u: IG.units, ml: IG.glucoseMl, min: IG.overMinutes, k: IG.fromK }),
      fields: [fld("cbg", W.glucBefore, "mmol/L")],
      branchHead: cbg0 === null ? W.needsGluc : fill(W.glucHead, { v: cbg0 }),
      branches: [
        br(
          fill(W.brUnder, { n: IG.lowGlucoseUnder }),
          fill(W.brLowGText, { r: IG.d10MlH, h: IG.d10Hours }),
          lowG,
          cbg0 !== null,
        ),
        br(
          fill(W.brOrMore, { n: IG.lowGlucoseUnder }),
          W.brOkGText,
          cbg0 !== null && !lowG,
          cbg0 !== null,
        ),
      ],
      btns: [
        ...K.ivBtn(),
        ...(!needIg
          ? []
          : [
              ...(T.ig ? [] : [btn(W.igBtn, mark("ig"), "rn", "main")]),
              ...(lowG && T.ig && !T.d10 ? [btn(W.d10Btn, mark("d10"), "rn", "main")] : []),
            ]),
      ],
      lines: [
        needIg
          ? T.ig
            ? L(fill(W.igGivenAt, { t: hh(T.ig), times: timesWord(S.watch.glucoseMinutes) }), "ok")
            : L(W.giveNow, "alert")
          : L(W.igNotNeeded),
        ...(K.hasLine ? [] : [K.ivLine()]),
      ],
    },
    st(needIg ? !!T.ig && (!lowG || !!T.d10) : k0 !== null, needIg && !T.ig),
  );
  a3.brief = T.ig
    ? fill(W.igBrief, { t: hh(T.ig) }) + (T.ig2 ? fill(W.igRepeated, { t: hh(T.ig2) }) : "")
    : needIg
      ? W.dueNow
      : W.notNeeded;

  const pulse = val("pulse");
  const fast = pulse !== null && pulse > S.salbutamol.fastPulseOver;
  const salbOpts = [...S.salbutamol.mg.map((mg) => fill(W.salbGive, { n: mg })), W.salbNo];
  const salbMg =
    v.salb && v.salb !== W.salbNo
      ? (S.salbutamol.mg.find((mg) => fill(W.salbGive, { n: mg }) === v.salb) ?? null)
      : null;
  const a4 = A(
    {
      n: 4,
      title: W.a4,
      sub: W.a4Sub,
      chipHead: W.drChoice,
      chips: K.pick1("salb", salbOpts),
      chipWho: "dr",
      btns: salbMg !== null && !T.salb ? [btn(W.salbBtn, mark("salb"), "rn", "main")] : [],
      lines: [
        fast ? L(fill(W.fast, { v: pulse! }), "warn") : L(W.salbAlone),
        ...(T.salb ? [L(fill(W.givenAt, { t: hh(T.salb) }), "ok")] : []),
      ],
    },
    st(v.salb === W.salbNo || !!T.salb || !needIg, needIg && !v.salb),
  );
  a4.brief = T.salb ? fill(W.igBrief, { t: hh(T.salb) }) : v.salb || W.notChosen;

  // ─── Recheck and remove ───
  const missed = (key: string, hs: number[]) =>
    hs.filter(
      (h) =>
        h <= hNow &&
        h > 0 &&
        !K.obs.some((o) => o.h === h && o.values[key] !== undefined && o.values[key] !== ""),
    ).length;
  const gL = latest("cbg");
  const gObs = lastObs("cbg");
  const hypo = gL !== null && gL < H.under && !((T.hypo ?? 0) > (gObs?.at ?? 0));
  const gMissed = missed("cbg", GH);
  const b1 = A(
    {
      n: 1,
      title: W.b1,
      sub: fill(W.b1Sub, { t: watchEnd }),
      rows: [
        row(
          W.latestG,
          gL !== null ? `${gL} mmol/L${gObs ? ` · ${lbl(gObs.h)}` : ""}` : W.noneYet,
          gL !== null && gL < H.under ? "warn" : undefined,
        ),
        row(W.missed, String(gMissed)),
      ],
      lines: hypo
        ? [L(fill(W.hypo, { v: gL!, ml: H.d10Ml, min: H.recheckMinutes, ml20: H.d20Ml }), "alert")]
        : [L(fill(W.checksAt, { times: timesWord(S.watch.glucoseMinutes) }))],
      btns: hypo ? [btn(W.hypoBtn, mark("hypo"), "rn", "main")] : [],
    },
    st(gMissed === 0 && hNow >= GH[GH.length - 1]!, hypo || gMissed > 0),
  );
  b1.brief = gL !== null ? fill(W.gBrief, { v: gL }) : W.noChecks;

  const kP = ptsOf("k");
  const kLast = kP.length ? kP[kP.length - 1]! : null;
  const kR = kLast ? kLast.v : null;
  const kMissed = missed("k", KH);
  const kHigh = kR !== null && kR >= R.repeatFrom;
  const b2 = A(
    {
      n: 2,
      title: W.b2,
      sub: fill(W.b2Sub, { times: timesWord(S.watch.potassiumMinutes) }),
      rows: [
        row(
          W.k,
          kP.length ? kP.map((x) => fill(W.kAt, { v: x.v, t: lbl(x.h) })).join(" · ") : W.noRecheck,
          kHigh ? "warn" : undefined,
        ),
        row(W.missed, String(kMissed)),
      ],
      branchHead: kR === null ? W.afterFirst : fill(W.latestK, { v: kR }),
      branches: [
        br(
          fill(W.brOrMore, { n: R.renalFrom }),
          W.brRenalText,
          kR !== null && kR >= R.renalFrom,
          kR !== null,
          true,
        ),
        br(
          range(R.repeatFrom, R.renalFrom),
          W.brRepeatText,
          kHigh && kR! < R.renalFrom,
          kR !== null,
        ),
        br(fill(W.brUnder, { n: R.repeatFrom }), W.brKeepText, kR !== null && !kHigh, kR !== null),
      ],
      btns: kHigh && !T.ig2 ? [btn(W.ig2Btn, mark("ig2"), "rn", "main")] : [],
    },
    st(kR !== null && !kHigh, (kHigh && !T.ig2) || kMissed > 0),
  );
  b2.brief = kR !== null ? fill(W.kBrief, { v: kR }) : W.noRecheck;

  const eg = K.eg;
  const hco3 = val("hco3");
  const acid = hco3 !== null && hco3 < RM.acidHco3Under;
  const creat = val("creat") ?? p.creatinine;
  const renalNeeded = !!eg && eg < RM.renalEgfrUnder;
  const b3 = A(
    {
      n: 3,
      title: W.b3,
      sub: W.b3Sub,
      rows: [
        row(
          W.kidney,
          (creat !== null ? fill(W.creat, { v: creat }) : W.noCreat) +
            (eg ? fill(W.egfr, { v: Math.round(eg) }) : ""),
          renalNeeded ? "warn" : undefined,
        ),
        ...(acid ? [row(W.bicarb, fill(W.acidRow, { v: hco3! }))] : []),
      ],
      chipHead: W.stopped,
      chips: K.pickN("stop", W.stopOpts),
      chipWho: "dr",
      items: [
        it(W.binder, W.binderSub, W.prescribe, "na", [btn(W.prescribe, { t: "rx" }, "dr", "link")]),
        it(W.diet, W.dietSub, many("stop").length ? W.withStops : W.toDo, "na"),
        it(
          W.renal,
          fill(W.renalSub, { eg: RM.renalEgfrUnder, k: R.renalFrom }),
          T.renal ? fill(W.renalAt, { t: hh(T.renal) }) : W.notYet,
          T.renal
            ? "done"
            : (eg && eg < RM.renalUrgentEgfrUnder) || (kR !== null && kR >= R.renalFrom)
              ? "alert"
              : "todo",
          T.renal ? [] : [btn(W.renalBtn, mark("renal"), "dr", renalNeeded ? "main" : undefined)],
        ),
      ],
      lines: acid ? [L(W.acid, "warn")] : [],
    },
    st(many("stop").length > 0 && (!!T.renal || !renalNeeded), false),
  );
  b3.brief =
    (many("stop").join(", ") || W.nothingStopped) +
    (T.renal ? fill(W.renalBrief, { t: hh(T.renal) }) : "");

  // ─── Resolve ───
  const resolved = kR !== null && kR < RS.kUnder && !ecgCh;
  const e1 = A(
    {
      n: 1,
      title: W.e1,
      sub: fill(W.e1Sub, { n: RS.kUnder }),
      crit: [
        crit(
          fill(W.cK, { n: RS.kUnder }),
          kLast ? fill(W.kAt, { v: kLast.v, t: lbl(kLast.h) }) : W.noRecheckW,
          kR !== null && kR < RS.kUnder,
          kR !== null,
        ),
        crit(
          W.cEcg,
          ecgCh ? W.changes : ecgKnown ? W.normalW : W.notRecordedW,
          ecgKnown && !ecgCh,
          ecgKnown,
        ),
      ],
      btns: resolved ? [K.endBtn(W.short)] : [],
      lines: [
        resolved
          ? L(fill(W.resolvedLine, { h: RS.recheckWithinH }), "ok")
          : L(fill(W.keepGoing, { times: timesWord(S.watch.potassiumMinutes) })),
      ],
    },
    st(resolved, hNow >= K.NS && !resolved),
  );
  e1.brief = resolved ? fill(W.brUnder, { n: RS.kUnder }) : W.notYet;

  const r1 = A(
    {
      n: 1,
      head: W.check,
      title: W.rnTitle,
      items: [
        it(
          W.monItem,
          fill(W.monSub, { n: R.repeatFrom }),
          T.mon ? fill(W.onSince, { t: hh(T.mon) }) : W.notYet,
          T.mon ? "done" : "alert",
          T.mon ? [] : [btn(W.monitor, mark("mon"), "rn", "main")],
        ),
        it(
          W.ecg2,
          W.ecg2Sub,
          T.ecg2 ? fill(W.doneAt, { t: hh(T.ecg2) }) : W.toDo,
          T.ecg2 ? "done" : "todo",
          [btn(W.ecg2Btn, mark("ecg2"), "rn", "main")],
        ),
      ],
    },
    st(!!T.mon && !!T.ecg2, !T.mon),
  );

  // ─── Nurse tasks ───
  const tasks: [string, string, string, number, Btn[]][] = [];
  if (!T.mon)
    tasks.push(["mon", W.tMon, W.tMonSub, c.start, [btn(W.monitor, mark("mon"), "rn", "main")]]);
  if (ecgCh && ca.length < CA.maxDoses)
    tasks.push([
      `ca${ca.length}`,
      fill(W.tCa, { ml: CA.ml, a: CA.overMinutesFrom, b: CA.overMinutesTo }),
      fill(W.tCaSub, { n: ca.length + 1 }),
      caDue,
      [caBtn],
    ]);
  if (needIg && !T.ig)
    tasks.push([
      "ig",
      fill(W.tIg, { u: IG.units, ml: IG.glucoseMl, min: IG.overMinutes }),
      fill(W.tIgSub, { t: watchEnd }),
      c.start,
      [btn(W.igBtn, mark("ig"), "rn", "main")],
    ]);
  if (lowG && T.ig && !T.d10)
    tasks.push([
      "d10",
      fill(W.tD10, { r: IG.d10MlH, h: IG.d10Hours }),
      fill(W.tD10Sub, { v: cbg0! }),
      T.ig,
      [btn(W.d10Btn, mark("d10"), "rn", "main")],
    ]);
  if (salbMg !== null && !T.salb)
    tasks.push([
      "salb",
      fill(W.tSalb, { n: salbMg }),
      W.tSalbSub,
      c.start,
      [btn(W.salbBtn, mark("salb"), "rn", "main")],
    ]);
  if (hypo)
    tasks.push([
      "hypo",
      fill(W.tHypo, { v: gL! }),
      fill(W.tHypoSub, { ml: H.d10Ml, min: H.recheckMinutes }),
      now,
      [btn(W.hypoBtn, mark("hypo"), "rn", "main")],
    ]);
  if (kHigh && !T.ig2)
    tasks.push([
      "ig2",
      W.tIg2,
      fill(W.tIg2Sub, { v: kR! }),
      now,
      [btn(W.ig2Btn, mark("ig2"), "rn", "main")],
    ]);

  const dueKeys = (h: number) => [
    ...(GH.includes(h) ? ["cbg"] : []),
    ...(KH.includes(h) ? ["k"] : []),
  ];
  const dueWords = (h: number) => [
    ...(GH.includes(h) ? [W.recGlucose] : []),
    ...(KH.includes(h) ? [W.recK] : []),
  ];
  const nextDue = dueKeys(K.nextH);
  const cbgPts = ptsOf("cbg");
  const PH = S.phases;
  const titles = [W.ph1, W.ph2, W.ph3, W.ph4];
  const acts: Step[][] = [[a1, a2], [a3, a4], [b1, b2, b3], [e1]];
  const supply = supplyOf(rules, {
    ageYears: p.ageYears,
    sex: p.sex,
    weightKg: p.weightKg,
    pregnant: p.pregnant,
  });

  return {
    phases: PH.map((ph, i) => ({
      ...ph,
      title: titles[i]!,
      win:
        ph.to === null
          ? fill(W.winAfter, { a: lbl(ph.from) })
          : fill(W.win, { a: lbl(ph.from), b: lbl(ph.to) }),
      acts: acts[i]!,
    })),
    rn: { title: W.rnTitle, note: W.rnNote, acts: [r1] },
    flow: (F) => [
      F.P(PH[0]!.id),
      F.D(
        "heart1",
        fill(W.fHeart, { n: G.severeFrom }),
        [
          F.Br(W.yes, W.fEmerg, k0 !== null ? emerg : null),
          F.Br(
            range(G.moderateFrom, G.severeFrom),
            W.fIg,
            k0 !== null ? !emerg && k0 >= G.moderateFrom : null,
          ),
          F.Br(
            range(G.mildFrom, G.moderateFrom),
            W.fCause,
            k0 !== null ? !emerg && k0 < G.moderateFrom : null,
          ),
        ],
        k0 !== null ? fill(W.kNote, { k: k0 }) : "",
      ),
      F.D("heart2", W.fEcg, [
        F.Br(
          W.yes,
          fill(W.fCa, { g: CA.g, max: caMaxG }),
          ecgKnown ? ecgCh || ca.length > 0 : null,
        ),
        F.Br(W.no, W.fNoCa, ecgKnown ? !ecgCh && !ca.length : null),
      ]),
      F.P(PH[1]!.id),
      F.D("shift1", fill(W.fLowG, { n: IG.lowGlucoseUnder }), [
        F.Br(W.yes, fill(W.fLowGYes, { r: IG.d10MlH }), cbg0 !== null ? lowG : null),
        F.Br(W.no, W.fLowGNo, cbg0 !== null ? !lowG : null),
      ]),
      F.N("shift2", W.fSalb),
      F.P(PH[2]!.id),
      F.N("watch1", fill(W.fWatch, { t: watchEnd })),
      F.D("watch2", W.fRecheck, [
        F.Br(
          fill(W.brOrMore, { n: R.renalFrom }),
          W.fRenal,
          kR !== null ? kR >= R.renalFrom : null,
        ),
        F.Br(
          range(R.repeatFrom, R.renalFrom),
          W.fRepeat,
          kR !== null ? kHigh && kR < R.renalFrom : null,
        ),
        F.Br(fill(W.brUnder, { n: R.repeatFrom }), W.fKeep, kR !== null ? !kHigh : null),
      ]),
      F.N("watch3", W.fRemove),
      F.P(PH[3]!.id),
      F.D("end1", fill(W.fResolved, { n: RS.kUnder }), [
        F.Br(W.yes, fill(W.fRecheck24, { h: RS.recheckWithinH }), resolved ? true : null),
        F.Br(W.no, W.fContinue, resolved ? false : null),
      ]),
    ],
    tasks: (add) => tasks.forEach(([key, title, sub, at, b]) => add(key, title, sub, at, b)),
    rows: [
      ["k", W.gK],
      ["cbg", W.gCbg],
      ["ecg", W.gEcg],
    ],
    cellFlag: (key, x) => {
      const n = parseFloat(x);
      if (Number.isNaN(n)) return null;
      if (key === "k")
        return n >= G.severeFrom
          ? flag("crit", W.severe)
          : n >= G.mildFrom
            ? flag("abn", grade(n))
            : K.interp(key, x);
      if (key === "cbg" && n < H.under) return flag("crit", W.low);
      if (key === "ecg") return n >= 1 ? flag("abn", W.changesW) : flag("ok", W.normal);
      return K.interp(key, x);
    },
    dueAt: (key, h) => dueKeys(h).includes(key),
    form: [
      { key: "cbg", label: W.fmCbg, unit: "mmol/L", dflt: "", opt: !nextDue.includes("cbg") },
      { key: "k", label: W.fmK, unit: "mmol/L", dflt: "", opt: !nextDue.includes("k") },
      { key: "ecg", label: W.fmEcg, unit: "1/0", dflt: "", opt: true },
    ],
    // Only what is due at the slot being recorded is required.
    formReq: nextDue,
    labKeys: ["cbg", "k"],
    recWhat: (h) => dueWords(h).join(", ") || W.recAnything,
    recHint: (h) => fill(W.recHint, { what: dueWords(h).join(W.and) || W.recNothing }),
    panels: [
      {
        key: "k",
        name: W.pK,
        unit: "mmol/L",
        min: 3,
        max: 8,
        ticks: [4, 6, 8],
        thr: [
          [G.severeFrom, fill(W.thrSevere, { n: G.severeFrom }), "amb"],
          [RS.kUnder, fill(W.thrResolved, { n: RS.kUnder }), "grn"],
        ],
        status:
          kR === null
            ? W.noRecheck
            : kR < RS.kUnder
              ? fill(W.brUnder, { n: RS.kUnder })
              : !kHigh
                ? W.falling
                : W.stillHigh,
        stLvl: kR === null ? "" : !kHigh ? "ok" : "no",
        bad: (x) => x >= G.severeFrom,
      },
      {
        key: "cbg",
        name: W.pCbg,
        unit: "mmol/L",
        min: 0,
        max: 16,
        ticks: [0, 8, 16],
        thr: [[H.under, fill(W.thrHypo, { n: H.under }), "amb"]],
        status: gL === null ? W.noChecks : gL < H.under ? W.low : W.safe,
        stLvl: gL === null ? "" : gL < H.under ? "no" : "ok",
        bad: (x) => x < H.under,
      },
    ],
    stats: [
      {
        k: W.k,
        v: kL !== null ? `${kL} mmol/L` : "—",
        s: kLast ? lbl(kLast.h) : W.baseline,
        ...(kL !== null && kL >= G.severeFrom ? { cls: "warn" as const } : {}),
      },
      {
        k: W.ecg,
        v: ecgCh ? W.changesW : ecgKnown ? W.normal : "—",
        s: fill(W.sCa, { n: ca.length }),
        ...(ecgCh ? { cls: "warn" as const } : {}),
      },
      {
        k: W.sIg,
        v: T.ig ? W.given : needIg ? W.due : W.notNeeded,
        s: T.ig ? hh(T.ig) : "",
        ...(needIg && !T.ig ? { cls: "warn" as const } : {}),
      },
      {
        k: W.sGlucose,
        v: gL !== null ? `${gL} mmol/L` : "—",
        s: fill(W.watchTo, { t: watchEnd }),
        ...(gL !== null && gL < H.under ? { cls: "warn" as const } : {}),
      },
      {
        k: W.sResolved,
        v: resolved ? W.yes : W.notYet,
        s: fill(W.brUnder, { n: RS.kUnder }),
        ...(resolved ? { cls: "ok" as const } : {}),
      },
    ],
    aims: [
      {
        word: fill(W.aim1, { k: R.repeatFrom, t: firstK }),
        ok: kP.some((x) => x.h <= KH[0]! && x.v < R.repeatFrom),
        known: kP.some((x) => x.h <= KH[0]!),
      },
      {
        word: fill(W.aim2, { k: RS.kUnder }),
        ok: kR !== null && kR < RS.kUnder,
        known: kR !== null,
      },
      {
        word: fill(W.aim3, { n: H.under }),
        ok: cbgPts.length > 0 && !cbgPts.some((x) => x.v < H.under),
        known: cbgPts.length > 0,
      },
    ],
    meds: supply.map((s) => ({ drug: s.drug, qty: s.qty ?? 0, why: s.doseText })),
    medsNote: W.medsNote,
    phRows: [
      row(W.phNow, W.phNowText),
      row(
        W.sIg,
        T.ig
          ? kHigh
            ? fill(W.phIgRepeat, { t: hh(T.ig), v: kR! })
            : fill(W.phIgGiven, { t: hh(T.ig) })
          : needIg
            ? W.dueNow
            : W.igNotNeeded,
        kHigh ? "warn" : undefined,
      ),
      row(W.phBinder, W.phBinderText),
    ],
    logWords: W.log,
  };
}
