import type { RuleModule } from "./index";
import type { Built, Kit } from "@/lib/protocols/engine/kit";
import type { Btn, ChartVersion, Interp } from "@/lib/protocols/engine/types";
import { z } from "zod";

import { fill } from "@/content/protocol-charts";
import { ART_COPY } from "@/content/protocol-charts-rules";
import { QuickRules, supplyOf } from "@/lib/protocols/quick";

/**
 * Severe malaria: IV artesunate (any age), FEATURES.md §2.6: the prototype's `PC.art` on the generic
 * kit. Every number is the version's `seed` (0286); the words are ART_COPY (draft). A dose is offered
 * to the nurse only once a weight gives the dose, in order, from its early window before the time.
 */

const W = ART_COPY;

const num = z.number().finite();
const Phase = z.object({ id: z.string(), from: num, to: num.nullable() });
export const ArtSeed = z.object({
  phases: z.array(Phase).length(4),
  childUnderAge: num,
  dose: z.object({
    mgKg: num,
    childBelowKg: num,
    childMgKg: num,
    vialMg: num,
    bicarbMl: num,
    ivMl: num,
    ivMgMl: num,
    imMl: num,
    imMgMl: num,
    useWithinMinutes: num,
    ivOverMinutesFrom: num,
    ivOverMinutesTo: num,
  }),
  doses: z.object({ atH: z.array(num).length(3), thenEveryH: num, earlyMinutes: num }),
  hypo: z.object({
    under: num,
    childMlKg: num,
    adultMl: num,
    adultAltMl: num,
    recheckMinutes: num,
  }),
  transfuse: z.object({ childHbUnder: num, adultHbUnder: num }),
  tablets: z.object({ days: num, startFromH: num, startToH: num, hbDays: z.array(num).length(2) }),
  aims: z.object({ firstDoseMinutes: num }),
  gcs: z.object({ childUnder: num, adultUnder: num }),
  feverOver: num,
  refs: z.record(z.string(), z.unknown()),
});
export type ArtSeed = z.infer<typeof ArtSeed>;

const art: RuleModule = {
  id: "art",
  short: () => W.short,
  check: (v: ChartVersion) =>
    ArtSeed.safeParse(v.seed).success && QuickRules.safeParse(v.rules).success
      ? null
      : W.seedMissing,
  build: (K) => buildArt(K),
};
export default art;

const HR = 3600000;
const r1 = (x: number) => Math.round(x * 10) / 10;

export function buildArt(K: Kit): Built {
  const S = ArtSeed.parse(K.version.seed);
  const rules = QuickRules.parse(K.version.rules);
  const { v, T, c, facts: p, now, hNow, w, hh, L, A, btn, st, mark, fld, it, row, crit } = K;
  const D = S.dose;
  const slotH = K.slotMin / 60;
  const child = p.ageYears !== null && p.ageYears < S.childUnderAge;
  const [TP, TS, TN, TNEG] = W.tests;
  const [SW_YES, SW_NO] = W.swallow;
  const test = v.test ?? "";
  const pos = test === TP || test === TS;
  const sf = K.many("sf");
  const confirmed = pos && sf.length > 0;

  const a1 = A(
    {
      n: 1,
      title: W.a1,
      sub: W.a1Sub,
      segLabel: W.testLabel,
      segs: K.pick1("test", W.tests),
      segWho: "dr",
      chipHead: W.signsHead,
      chips: K.pickN("sf", W.signs),
      chipWho: "dr",
      fields: [fld("cbg", W.cbg, "mmol/L"), fld("hb", W.hb, "g/dl")],
      crit: [
        crit(W.cPos, test || W.notRecorded, pos, !!test),
        crit(W.cSign, sf.join(", ") || W.nonePicked, sf.length > 0, sf.length > 0),
      ],
      lines:
        test === TNEG ? [L(W.negLine, "warn")] : test === TN ? [L(W.notDoneLine, "alert")] : [],
    },
    st(confirmed, test === TN),
  );
  a1.brief = confirmed
    ? sf.length > 1
      ? fill(W.confirmedN, { n: sf.length })
      : W.confirmed1
    : test || W.notConfirmed;

  // ─── Dose by weight ───
  const mgkg = w ? (w < D.childBelowKg ? D.childMgKg : D.mgKg) : null;
  const dose = w && mgkg ? r1(mgkg * w) : null;
  const vials = dose ? Math.ceil(dose / D.vialMg) : null;
  const route: string = v.route || W.routes[0];
  const iv = route === W.routes[0];
  const conc = iv ? D.ivMgMl : D.imMgMl;
  const vol = dose ? r1(dose / conc) : null;
  const doses = K.gv("dose");
  const nMin = S.doses.atH.length;
  const lastAt = S.doses.atH[nMin - 1]!;
  const dueOf = (i: number) =>
    c.start + (i < nMin ? S.doses.atH[i]! : lastAt + S.doses.thenEveryH * (i - nMin + 1)) * HR;
  const giveBtn = (i: number): Btn =>
    btn(fill(W.doseGiven, { n: i + 1 }), K.give("dose"), "rn", "main");

  const a2 = A(
    {
      n: 2,
      title: W.a2,
      sub:
        (child ? fill(W.a2Child, { kg: D.childBelowKg, mgkg: D.childMgKg }) : "") +
        fill(W.a2Sub, {
          kg: D.childBelowKg,
          mgkg: D.mgKg,
          vial: D.vialMg,
          bicarb: D.bicarbMl,
          iv: D.ivMl,
          ivc: D.ivMgMl,
          im: D.imMl,
          imc: D.imMgMl,
          use: K.dur(D.useWithinMinutes * 60000),
        }),
      chipHead: W.routeHead,
      chips: K.pick1("route", W.routes),
      chipWho: "dr",
      rows: [
        row(
          W.rWeight,
          w ? fill(W.weightIs, { w, from: p.weightFrom ?? "" }) : W.weightNone,
          w ? undefined : "warn",
        ),
        row(W.rDose, dose ? fill(W.doseIs, { d: dose, mgkg: mgkg!, w }) : "—", "strong"),
        row(W.rVials, vials ? fill(W.vialsIs, { n: vials, mg: D.vialMg }) : "—"),
        row(
          W.rGive,
          vol
            ? iv
              ? fill(W.giveIv, { ml: vol, c: conc, a: D.ivOverMinutesFrom, b: D.ivOverMinutesTo })
              : fill(W.giveIm, { ml: vol, c: conc })
            : "—",
          "strong",
        ),
      ],
      lines: iv ? [K.ivLine()] : [],
    },
    st(doses.length > 0, (confirmed || test === TN) && !doses.length),
  );
  a2.fields = K.wtBits(W.weightWhy).fields;
  a2.btns = [...(iv ? K.ivBtn() : []), ...(dose && !doses.length ? [giveBtn(0)] : [])];
  a2.brief = dose
    ? fill(W.doseBrief, { d: dose, route }) +
      (doses.length ? fill(W.givenAtBrief, { t: hh(doses[0]!) }) : "")
    : W.needsWeight;

  // ─── The dangers ───
  const g = K.latest("cbg");
  const hypo = g !== null && g < S.hypo.under;
  const hb = K.val("hb");
  const txUnder = child ? S.transfuse.childHbUnder : S.transfuse.adultHbUnder;
  const txNeed = hb !== null && hb < txUnder;
  const gluBtn = hypo && !T.glu ? [btn(W.gluGiven, mark("glu"), "rn", "main")] : [];
  const fits = sf.includes(W.signs[2]);
  const a3 = A(
    {
      n: 3,
      title: W.a3,
      sub: W.a3Sub,
      items: [
        it(
          fill(W.iGlu, { n: S.hypo.under }),
          child
            ? fill(W.iGluChild, {
                mlkg: S.hypo.childMlKg,
                ml: w ? `${Math.round(S.hypo.childMlKg * w)} ml` : W.byWeight,
                m: S.hypo.recheckMinutes,
              })
            : fill(W.iGluAdult, {
                ml: S.hypo.adultMl,
                alt: S.hypo.adultAltMl,
                m: S.hypo.recheckMinutes,
              }),
          hypo ? fill(W.nowV, { v: g }) : g !== null ? fill(W.noV, { v: g }) : W.checkNow,
          hypo ? (T.glu ? "done" : "alert") : g !== null ? "na" : "todo",
          gluBtn,
        ),
        it(W.iFits, W.iFitsSub, fits ? W.present : W.no, fits ? "alert" : "na"),
        it(
          W.iAnaemia,
          fill(W.iAnaemiaSub, { n: txUnder }),
          hb !== null ? fill(txNeed ? W.hbTx : W.hbIs, { v: hb }) : W.needsHb,
          txNeed ? (T.tx ? "done" : "alert") : "na",
          txNeed && !T.tx ? [btn(W.txBtn, mark("tx"), "dr", "main")] : [],
        ),
        it(
          W.iInf,
          W.iInfSub,
          T.abx ? fill(W.prescribedAt, { t: hh(T.abx) }) : W.consider,
          T.abx ? "done" : "na",
          T.abx ? [] : [btn(W.abxBtn, mark("abx"), "dr"), btn(W.rxAbx, { t: "rx" }, "dr", "link")],
        ),
        it(W.iFluids, W.iFluidsSub, W.note, "na"),
      ],
      btns: K.orderMissing(["hb"]),
    },
    st(!hypo || !!T.glu, (hypo && !T.glu) || (txNeed && !T.tx)),
  );
  a3.brief =
    [hypo ? fill(W.glucoseV, { v: g }) : "", txNeed ? fill(W.hbIs, { v: hb }) : ""]
      .filter(Boolean)
      .join(" · ") || W.nothingUrgent;

  // ─── Doses 2 and 3, then daily ───
  const atLbl = (i: number) => (dueOf(i) - c.start) / HR;
  const doseRow = (i: number) => {
    const at = dueOf(i);
    const gvn = doses[i];
    return it(
      fill(W.doseAt, { n: i + 1, h: atLbl(i) }),
      fill(W.doseSub, {
        dose: dose ? fill(W.doseBrief, { d: dose, route }) : W.byWeight,
        t: hh(at),
      }),
      gvn ? fill(W.givenAt, { t: hh(gvn) }) : now >= at ? W.dueNow : W.later,
      gvn ? "done" : now >= at ? "alert" : "todo",
      dose && !gvn && doses.length === i && now >= at - S.doses.earlyMinutes * 60000
        ? [giveBtn(i)]
        : [],
    );
  };
  const b1 = A(
    {
      n: 1,
      title: fill(W.b1, { a: S.doses.atH[1]!, b: lastAt }),
      sub: fill(W.b1Sub, { n: nMin, h: lastAt }),
      items: [1, 2].map(doseRow),
    },
    st(
      doses.length >= nMin,
      (doses.length < 2 && now >= dueOf(1)) || (doses.length < nMin && now >= dueOf(nMin - 1)),
    ),
  );
  b1.brief = fill(W.ofDoses, { n: doses.length, of: nMin });

  const missed = Array.from({ length: Math.min(hNow, K.NS) }, (_, i) => i + 1).filter(
    (h) => !K.obs.some((o) => o.h === h && (o.values.cbg ?? "") !== ""),
  ).length;
  const temp = K.latest("temp");
  const b2 = A(
    {
      n: 2,
      title: W.b2,
      sub: fill(W.b2Sub, { h: slotH }),
      rows: [
        row(W.rGlucose, g !== null ? `${g} mmol/L` : "—", hypo ? "warn" : undefined),
        row(W.rTemp, temp !== null ? `${temp} °C` : "—"),
        row(W.rMissed, String(missed), missed ? "warn" : undefined),
      ],
    },
    st(missed === 0 && hNow > 0, missed > 0 || hypo),
  );
  b2.brief = missed ? fill(W.missed, { n: missed }) : W.onTime;

  const swallow = v.swallow === SW_YES;
  const cannot = v.swallow === SW_NO;
  const swallowChips = K.pick1("swallow", W.swallow);
  const c1 = A(
    {
      n: 1,
      title: W.c1,
      sub: fill(W.c1Sub, { n: nMin, h: S.doses.thenEveryH }),
      chipHead: W.swallowHead,
      chips: swallowChips,
      chipWho: "rn",
      // The daily doses given so far and the next one.
      items: cannot
        ? Array.from({ length: Math.max(1, doses.length - nMin + 1) }, (_, j) => nMin + j).map(
            doseRow,
          )
        : [],
    },
    st(swallow, doses.length >= nMin && !v.swallow),
  );
  c1.brief = v.swallow || W.notAssessed;

  const canSwitch = doses.length >= nMin && swallow;
  const e1 = A(
    {
      n: 1,
      title: W.e1,
      sub: fill(W.e1Sub, {
        days: S.tablets.days,
        a: S.tablets.startFromH,
        b: S.tablets.startToH,
        d1: S.tablets.hbDays[0]!,
        d2: S.tablets.hbDays[1]!,
      }),
      crit: [
        crit(
          fill(W.cDoses, { n: nMin }),
          fill(W.nGiven, { n: doses.length }),
          doses.length >= nMin,
          true,
        ),
        crit(W.cSwallow, v.swallow || W.notAssessedL, swallow, !!v.swallow),
      ],
      btns: canSwitch
        ? T.al
          ? [K.endBtn(W.short)]
          : [btn(W.rxAl, { t: "rx" }, "dr"), btn(W.alBtn, mark("al"), "dr", "main")]
        : [],
      lines: T.al ? [L(fill(W.alAt, { t: hh(T.al) }), "ok")] : [],
    },
    st(!!T.al, false),
  );
  e1.brief = T.al ? W.alBtn : canSwitch ? W.readySwitch : W.notYet;

  const rn1 = A(
    {
      n: 1,
      head: W.rnHead,
      title: fill(W.rnTitle, { h: slotH }),
      items: [
        it(
          W.rGlucose,
          g !== null ? `${g} mmol/L` : W.notChecked,
          hypo ? W.lowTreat : g !== null ? W.ok : W.check,
          hypo ? "alert" : g !== null ? "done" : "todo",
          gluBtn,
        ),
        it(W.rWatch, W.rWatchSub, W.watch, "na"),
      ],
      chipHead: W.swallowHead,
      chips: swallowChips,
      chipWho: "rn",
    },
    st(!hypo, hypo && !T.glu),
  );

  // ─── Monitoring chart ───
  const gcsUnder = child ? S.gcs.childUnder : S.gcs.adultUnder;
  const flag = (lvl: Interp["lvl"], word: string): Interp => ({ lvl, word, text: "", ref: "" });
  const PH = S.phases;
  const nx = doses.length;
  const supply = supplyOf(rules, {
    ageYears: p.ageYears,
    sex: p.sex,
    weightKg: p.weightKg,
    pregnant: p.pregnant,
  });
  const cbgPts = K.ptsOf("cbg");
  const firstMs = S.aims.firstDoseMinutes * 60000;

  return {
    phases: [
      {
        ...PH[0]!,
        title: W.ph1,
        win: fill(W.w1, { b: slotH * (PH[0]!.to ?? 1) }),
        acts: [a1, a2, a3],
      },
      {
        ...PH[1]!,
        title: W.ph2,
        win: fill(W.w2, { a: slotH * PH[1]!.from, b: lastAt }),
        acts: [b1, b2],
      },
      {
        ...PH[2]!,
        title: W.ph3,
        win: fill(W.w2, { a: lastAt, b: slotH * (PH[2]!.to ?? K.NS) }),
        acts: [c1],
      },
      { ...PH[3]!, title: W.ph4, win: W.w4, acts: [e1] },
    ],
    rn: { title: fill(W.rnTitle, { h: slotH }), note: "", acts: [rn1] },
    flow: (F) => [
      F.P(PH[0]!.id),
      F.D(`${PH[0]!.id}1`, W.fConfirm, [
        F.Br(W.yes, W.fSevere, test ? confirmed : null),
        F.Br(W.fNotDone, W.fDose1, test === TN ? true : test ? false : null),
      ]),
      F.N(`${PH[0]!.id}2`, fill(W.fArt, { d: dose ? `${dose} mg ` : "", route })),
      F.D(`${PH[0]!.id}3`, fill(W.fLow, { n: S.hypo.under }), [
        F.Br(W.yes, W.fGlucNow, g !== null ? hypo : null),
        F.Br(W.no, fill(W.fRecheck, { h: slotH }), g !== null ? !hypo : null),
      ]),
      F.P(PH[1]!.id),
      F.N(`${PH[1]!.id}1`, fill(W.fDoses, { a: S.doses.atH[1]!, b: lastAt })),
      F.N(`${PH[1]!.id}2`, fill(W.fMon, { h: slotH })),
      F.P(PH[2]!.id),
      F.D(`${PH[2]!.id}1`, fill(W.fSwallow, { n: nMin }), [
        F.Br(W.yes, W.fSwitch, v.swallow ? swallow : null),
        F.Br(W.no, W.fDaily, v.swallow ? !swallow : null),
      ]),
      F.P(PH[3]!.id),
      F.N(`${PH[3]!.id}1`, fill(W.fAl, { n: S.tablets.days })),
    ],
    tasks: (tk) => {
      if (dose && (nx < nMin || cannot))
        tk(
          `dose${nx + 1}`,
          fill(W.tDose, { d: dose, route, n: nx + 1 }),
          fill(W.tDoseSub, { ml: vol!, c: conc }),
          dueOf(nx),
          now >= dueOf(nx) - S.doses.earlyMinutes * 60000 ? [giveBtn(nx)] : [],
        );
      if (hypo && !T.glu)
        tk(
          "glu",
          fill(W.tGlu, { v: g }),
          child
            ? fill(W.tGluChild, { mlkg: S.hypo.childMlKg })
            : fill(W.tGluAdult, { ml: S.hypo.adultMl }),
          now,
          gluBtn,
        );
      if (nx >= nMin && !v.swallow) tk("swallow", W.tSwallow, W.tSwallowSub, now, []);
    },
    rows: [
      ["cbg", W.gCbg],
      ["temp", W.gTemp],
      ["gcs", child ? W.gGcsChild : W.gGcs],
      ["uo", W.gUo],
    ],
    cellFlag: (key, x) => {
      const n = parseFloat(x);
      if (Number.isNaN(n) || key === "uo") return null;
      if (key === "cbg") return n < S.hypo.under ? flag("crit", W.wLow) : null;
      if (key === "gcs") return n < gcsUnder ? flag("abn", W.wReduced) : null;
      return K.interp(key, x);
    },
    dueAt: (key) => key === "cbg" || key === "temp",
    form: [
      { key: "cbg", label: W.fmCbg, unit: "mmol/L", dflt: "" },
      { key: "temp", label: W.fmTemp, unit: "°C", dflt: "" },
      {
        key: "gcs",
        label: child ? W.fmGcsChild : W.fmGcs,
        unit: child ? W.fmGcsChildUnit : "/15",
        dflt: "",
      },
      { key: "uo", label: W.fmUo, unit: "ml", dflt: "" },
    ],
    formReq: ["cbg", "temp"],
    labKeys: ["cbg"],
    recWhat: () => W.recWhat,
    recHint: () => fill(W.recHint, { h: slotH, n: S.hypo.under }),
    panels: [
      {
        key: "cbg",
        name: W.pCbg,
        unit: "mmol/L",
        min: 0,
        max: 12,
        ticks: [0, 4, 8, 12],
        thr: [[S.hypo.under, fill(W.thrLow, { n: S.hypo.under }), "amb"]],
        bad: (x) => x < S.hypo.under,
      },
      {
        key: "temp",
        name: W.pTemp,
        unit: "°C",
        min: 35,
        max: 41,
        ticks: [36, 38, 40],
        thr: [[S.feverOver, fill(W.thrFever, { n: S.feverOver }), "amb"]],
        bad: (x) => K.interp("temp", x)?.lvl === "crit",
      },
    ],
    stats: [
      {
        k: W.sDose,
        v: dose ? `${dose} mg` : "—",
        s: vials ? fill(W.vials, { route, n: vials }) : route,
      },
      {
        k: W.sDoses,
        v: fill(W.ofN, { n: nx, of: nMin }),
        s: nx < nMin ? fill(W.nextAt, { t: hh(dueOf(nx)) }) : W.thenDaily,
      },
      {
        k: W.sGlucose,
        v: g !== null ? `${g} mmol/L` : "—",
        s: fill(W.treatUnder, { n: S.hypo.under }),
        ...(hypo ? { cls: "warn" as const } : {}),
      },
      {
        k: W.sHb,
        v: hb !== null ? `${hb} g/dl` : "—",
        s: fill(W.txUnder, { n: txUnder }),
        ...(txNeed ? { cls: "warn" as const } : {}),
      },
      {
        k: W.sTablets,
        v: T.al ? W.prescribed : W.notYet,
        s: fill(W.afterN, { n: nMin }),
        ...(T.al ? { cls: "ok" as const } : {}),
      },
    ],
    aims: [
      {
        word: fill(W.aFirst, { d: K.dur(firstMs) }),
        ok: nx > 0 && doses[0]! - c.start < firstMs,
        known: nx > 0 || now - c.start > firstMs,
      },
      {
        word: fill(W.aDoses, { n: nMin, h: lastAt }),
        ok: nx >= nMin,
        known: now >= dueOf(nMin - 1),
      },
      {
        word: fill(W.aNoLow, { n: S.hypo.under }),
        ok: cbgPts.length > 0 && !cbgPts.some((x) => x.v < S.hypo.under),
        known: cbgPts.length > 0,
      },
    ],
    meds: supply.map((s) => ({ drug: s.drug, qty: s.qty ?? 0, why: s.doseText })),
    phRows: [
      row(
        W.phArt,
        dose
          ? fill(W.phArtIs, {
              n: vials!,
              mg: D.vialMg,
              d: dose,
              g: nx,
              next: nx < nMin ? fill(W.phNextAt, { t: hh(dueOf(nx)) }) : W.phNextIf,
            })
          : W.waitingWeight,
      ),
      row(W.phTablets, T.al ? W.phAlRx : W.phAlNext),
    ],
    logWords: W.log,
  };
}
