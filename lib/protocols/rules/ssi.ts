import type { RuleModule } from "./index";
import type { Built, Kit } from "@/lib/protocols/engine/kit";
import type { Btn, ChartVersion, Interp } from "@/lib/protocols/engine/types";
import { z } from "zod";

import { fill } from "@/content/protocol-charts";
import { SSI_COPY } from "@/content/protocol-charts-rules";
import { QuickRules, supplyOf } from "@/lib/protocols/quick";

/**
 * Correctional (sliding-scale) insulin (adult), FEATURES.md §2.10: the prototype's `PC.ssi.build(K)`.
 * The scale is the version's own table (`seed.bands`, hospital-editable, FEATURES §5; 0284 seeds the
 * example). The suggested dose is read from the table for the chosen scale and the newest glucose:
 * a glucose typed on the card after the last recorded slot fills "Units given" in the record form;
 * the nurse can change it, and what is saved is what was given.
 */

const W = SSI_COPY;

const num = z.number().finite();
const Band = z.object({
  gt: num.optional(),
  gte: num.optional(),
  lt: num.optional(),
  lte: num.optional(),
  range: z.string(),
  hypo: z.boolean().optional(),
  call: z.boolean().optional(),
  units: z.record(z.string(), num.nonnegative()),
});
export const SsiSeed = z
  .object({
    phases: z.array(z.object({ id: z.string(), from: num, to: num.nullable() })).length(3),
    scales: z.array(z.string().min(1)).min(1),
    bands: z.array(Band).min(1),
    suggest: z.object({ lowEgfrUnder: num, lowAgeFrom: num }),
    dka: z.object({ ketonesFrom: num, glucoseOver: num }),
    metforminHoldEgfrUnder: num,
    ketonesCheckOver: num,
    review: z.object({ highOver: num, highCount: num, lowUnder: num }),
    aim: z.object({ from: num, to: num }),
    refs: z.record(z.string(), z.unknown()),
  })
  // Every band names a dose for every scale: a hole in the table never reads as "no insulin".
  .refine((s) => s.bands.every((b) => s.scales.every((x) => b.units[x] !== undefined)));
export type SsiSeed = z.infer<typeof SsiSeed>;
type SsiBand = SsiSeed["bands"][number];

const ssi: RuleModule = {
  id: "ssi",
  short: () => W.short,
  check: (v: ChartVersion) =>
    (v.rules as { module?: string | null } | null)?.module === "ssi" &&
    SsiSeed.safeParse(v.seed).success &&
    QuickRules.safeParse(v.rules).success
      ? null
      : W.seedMissing,
  build: (K) => buildSsi(K),
};
export default ssi;

const inBand = (b: SsiBand, x: number) =>
  (b.gt == null || x > b.gt) &&
  (b.gte == null || x >= b.gte) &&
  (b.lt == null || x < b.lt) &&
  (b.lte == null || x <= b.lte);

/** The band and the units on this scale for a glucose (pure; the tests and the screen share it). */
export function doseFor(S: SsiSeed, scale: string, g: number | null) {
  if (!S.scales.includes(scale) || g === null) return null;
  const band = S.bands.find((b) => inBand(b, g));
  return band ? { band, units: band.hypo ? 0 : band.units[scale]! } : null;
}

export function buildSsi(K: Kit): Built {
  const S = SsiSeed.parse(K.version.seed);
  const rules = QuickRules.parse(K.version.rules);
  const { v, T, c, facts: p, now, hNow, NS, due, hh, L, A, btn, st, mark, fld, row, val } = K;
  const pf = { ageYears: p.ageYears, sex: p.sex, weightKg: p.weightKg, pregnant: p.pregnant };
  const hrs = (slots: number) => (slots * K.slotMin) / 60;
  const lc1 = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
  const scale = S.scales.includes(v.scale ?? "") ? v.scale! : "";
  const eg = p.egfr;

  // ─── Set up ───
  const eat = v.eat ?? "";
  const infected = p.problems.filter((x) => /pneumonia|sepsis|infection|steroid/i.test(x));
  const little = eat === W.eats[1];
  const sug =
    (eg !== null && eg < S.suggest.lowEgfrUnder) ||
    (p.ageYears ?? 0) >= S.suggest.lowAgeFrom ||
    little
      ? S.scales[0]!
      : infected.length
        ? S.scales[S.scales.length - 1]!
        : S.scales[Math.floor(S.scales.length / 2)]!;
  const bandWord = (b: SsiBand, s: string) =>
    b.hypo
      ? W.hypoBand
      : !b.units[s]
        ? W.noInsulinBand
        : fill(b.call ? W.callBand : W.unitsBand, { u: b.units[s]! });
  const a1 = A(
    {
      n: 1,
      title: W.a1,
      sub: W.a1Sub,
      segLabel: W.scale,
      segs: K.pick1("scale", S.scales),
      segWho: "dr",
      rows: [
        row(
          W.suggested,
          sug +
            (eg !== null ? fill(W.egfrTag, { v: Math.round(eg) }) : "") +
            (infected.length ? W.infectionTag : "") +
            (little ? W.eatingLittleTag : ""),
        ),
        ...(scale ? S.bands.map((b) => row(b.range, bandWord(b, scale))) : []),
      ],
    },
    st(!!scale, false),
  );
  a1.brief = scale ? fill(W.scaleShort, { s: scale }) : W.notChosen;

  const g0 = val("cbg");
  const k0 = val("ket");
  const dkaRisk = k0 !== null && k0 >= S.dka.ketonesFrom && g0 !== null && g0 > S.dka.glucoseOver;
  const nbm = eat === W.eats[2];
  const a2 = A(
    {
      n: 2,
      title: W.a2,
      sub: W.a2Sub,
      fields: [fld("cbg", W.cbg, "mmol/L"), fld("ket", W.ket, "mmol/L")],
      chipHead: W.eatHead,
      chips: K.pick1("eat", W.eats),
      chipWho: "dr",
      lines: [
        dkaRisk ? L(fill(W.dkaRisk, { k: k0!, g: g0! }), "alert") : L(W.type1),
        ...(nbm ? [L(W.nbm, "alert")] : []),
      ],
      btns: [
        ...K.orderMissing(["cbg", "ket"]),
        ...(dkaRisk ? [btn(W.openDka, { t: "proto", id: "dka" }, "dr", "main")] : []),
      ],
    },
    st(!!eat && !nbm && !dkaRisk, dkaRisk || nbm),
  );
  a2.brief = dkaRisk ? W.checkDka : eat || W.eatNotSet;

  const unwell = p.problems.filter((x) => /pneumonia|sepsis/i.test(x));
  const a3 = A(
    {
      n: 3,
      title: W.a3,
      sub: fill(W.a3Sub, { n: S.metforminHoldEgfrUnder }),
      lines: [
        ...(eg !== null && eg < S.metforminHoldEgfrUnder
          ? [L(fill(W.holdMetf, { v: Math.round(eg), n: S.metforminHoldEgfrUnder }), "warn")]
          : []),
        ...(unwell.length ? [L(fill(W.unwell, { list: unwell.join(", ") }), "warn")] : []),
        L(W.type1),
        ...(T.usual ? [L(fill(W.usualAt, { t: hh(T.usual) }), "ok")] : []),
      ],
      btns: [
        btn(W.usualRx, { t: "rx" }, "dr"),
        ...(T.usual ? [] : [btn(W.usualBtn, mark("usual"), "dr", "main")]),
      ],
    },
    st(!!T.usual, false),
  );
  a3.brief = T.usual ? W.decided : W.notDecided;

  // ─── Before meals and bedtime ───
  const lastG = K.lastObs("cbg");
  const gL = K.latest("cbg");
  // A glucose typed on the card after the last recorded slot is the one to dose by.
  const typedEv = [...c.events]
    .reverse()
    .find((e) => e.type === "value" && e.payload.key === "cbg");
  const typedNew =
    !!typedEv && K.typed("cbg") && (!lastG || typedEv.at > lastG.at) ? parseFloat(v.cbg!) : null;
  const gUse = typedNew ?? gL;
  const dNow = scale ? doseFor(S, scale, gUse) : null;
  const sugW = (g: number | null) => {
    if (!scale) return W.chooseFirst;
    if (g === null) return W.checkGlucose;
    const d = doseFor(S, scale, g);
    if (!d) return W.checkGlucose;
    if (d.band.hypo) return W.sugHypo;
    return d.units ? fill(d.band.call ? W.sugCall : W.sugUnits, { u: d.units }) : W.sugNone;
  };
  const lastUnits =
    lastG && lastG.values.units !== undefined && lastG.values.units !== ""
      ? lastG.values.units
      : null;
  const sugFrom =
    gUse === null
      ? ""
      : typedNew !== null
        ? fill(W.fromTyped, { g: typedNew })
        : fill(W.fromLatest, {
            g: gL!,
            at: lastG ? fill(W.atSlot, { s: K.lbl(lastG.h) }) : W.baselineTag,
          });
  const bandOf = (g: number | null) => (g === null ? null : S.bands.find((b) => inBand(b, g)));
  const bL = bandOf(gL);
  const scaleBr = scale
    ? S.bands.map((b) =>
        K.br(
          b.range,
          bandWord(b, scale),
          gUse !== null && b === dNow?.band,
          gUse !== null,
          !!(b.hypo || b.call),
        ),
      )
    : [];
  const alertLines = [
    ...(bL?.hypo ? [L(fill(W.hypoLine, { r: bL.range }), "alert" as const)] : []),
    ...(bL?.call ? [L(fill(W.callLine, { r: bL.range }), "alert" as const)] : []),
  ];
  const b1 = A(
    {
      n: 1,
      title: W.b1,
      sub: W.b1Sub,
      rows: [
        row(
          W.rSuggested,
          sugW(gUse) + sugFrom + (scale ? fill(W.scaleTag, { s: scale.toLowerCase() }) : ""),
          "strong",
        ),
        row(
          W.rLast,
          lastUnits !== null && lastG
            ? fill(W.lastIs, { u: lastUnits, s: K.lbl(lastG.h) })
            : W.noneYet,
        ),
      ],
      branchHead: scale ? fill(W.scaleGlucose, { s: scale }) : "",
      branches: scaleBr,
      lines: [
        ...alertLines,
        ...(gUse !== null && gUse > S.ketonesCheckOver && !bL?.call
          ? [L(fill(W.ketLine, { n: S.ketonesCheckOver }), "warn")]
          : []),
      ],
    },
    st(lastUnits !== null, alertLines.length > 0),
  );
  b1.brief =
    scale && gUse !== null
      ? fill(W.sugShort, { d: sugW(gUse).replace(/ soluble insulin SC/, "") })
      : W.needsBoth;

  const RV = S.review;
  const perDay = Math.max(1, Math.round(1440 / K.slotMin));
  const days = Math.max(1, Math.ceil(NS / perDay));
  const dayVals = Array.from({ length: days }, (_, d) =>
    K.ptsOf("cbg")
      .filter((o) => o.h >= d * perDay && o.h < (d + 1) * perDay)
      .map((o) => o.v),
  );
  const hiN = (a: number[]) => a.filter((x) => x > RV.highOver).length;
  const anyHighDay = dayVals.some((a) => hiN(a) >= RV.highCount);
  const allG = K.ptsOf("cbg").map((x) => x.v);
  const lows = allG.filter((x) => x < RV.lowUnder).length;
  const b2 = A(
    {
      n: 2,
      title: W.b2,
      sub: fill(W.b2Sub, { c: RV.highCount, n: RV.highOver, l: RV.lowUnder }),
      rows: dayVals.map((a, d) =>
        row(
          fill(W.day, { n: d + 1 }),
          a.length
            ? a.join(", ") +
                (hiN(a) >= RV.highCount
                  ? fill(W.manyHigh, { c: RV.highCount, n: RV.highOver })
                  : "")
            : W.noReadings,
          hiN(a) >= RV.highCount ? "warn" : undefined,
        ),
      ),
      btns: [
        ...(T.rev
          ? []
          : [btn(W.revBtn, mark("rev"), "dr", anyHighDay || lows ? "main" : undefined)]),
        btn(W.changeRegimen, { t: "rx" }, "dr", "link"),
      ],
      lines: [
        ...(lows ? [L(fill(W.lowLine, { n: RV.lowUnder }), "alert")] : []),
        ...(T.rev ? [L(fill(W.revAt, { t: hh(T.rev) }), "ok")] : []),
      ],
    },
    st(!!T.rev, (anyHighDay || lows > 0) && !T.rev),
  );
  b2.brief =
    fill(W.revShort, { h: dayVals.reduce((a, x) => a + hiN(x), 0), n: RV.highOver }) +
    (lows ? fill(W.revLowShort, { l: lows, n: RV.lowUnder }) : "");

  // ─── Review ───
  const PH = S.phases;
  const endH = hrs(PH[2]!.from);
  const avg = allG.length
    ? Math.round((allG.reduce((a, x) => a + x, 0) / allG.length) * 10) / 10
    : null;
  const totU = K.obs.reduce((a, o) => a + (parseFloat(o.values.units!) || 0), 0);
  const e1 = A(
    {
      n: 1,
      title: fill(W.e1, { h: endH }),
      sub: W.e1Sub,
      rows: [
        row(W.avg, avg !== null ? fill(W.avgIs, { v: avg, n: allG.length }) : "—"),
        row(W.used, fill(W.usedIs, { u: totU })),
      ],
      btns: [btn(W.regimen, { t: "rx" }, "dr"), K.endBtn(W.short)],
    },
    st(false, hNow >= PH[2]!.from),
  );
  e1.brief = avg !== null ? fill(W.avgShort, { v: avg }) : fill(W.atEnd, { h: endH });

  // ─── The nurse's card ───
  const rn1 = A(
    {
      n: 1,
      head: W.rnHead,
      title: W.rnTitle,
      fields: [fld("cbg", W.cbg, "mmol/L", "rn")],
      rows: [
        row(
          W.rnGlucose,
          typedNew !== null
            ? fill(W.justTyped, { g: typedNew })
            : gUse !== null
              ? `${gUse} mmol/L`
              : W.checkNow,
        ),
        row(W.rnGive, scale ? sugW(gUse) : W.waitScale, "strong"),
      ],
      branchHead: scale ? fill(W.scaleShort, { s: scale }) : "",
      branches: scaleBr,
      lines: [...alertLines, L(W.rnLine)],
    },
    st(lastUnits !== null && typedNew === null, alertLines.length > 0),
  );

  // ─── Nurse tasks ───
  const meal = (h: number) => W.meals[h % W.meals.length]!;
  const tasks: [string, string, string, number, Btn[]][] = [];
  if (K.nextH < NS && scale)
    tasks.push([
      `dose${K.nextH}`,
      W.tDose,
      fill(W.tDoseSub, {
        meal: meal(K.nextH),
        what:
          gUse !== null && typedNew !== null
            ? fill(W.tNow, { d: lc1(sugW(gUse)), g: gUse })
            : fill(W.tFill, { s: scale.toLowerCase() }),
      }),
      due(K.nextH),
      [],
    ]);
  if (bL?.hypo)
    tasks.push([`hypo${lastG?.at ?? 0}`, fill(W.tHypo, { v: gL! }), W.tHypoSub, now, []]);

  // ─── The monitoring chart ───
  const hypoBand = S.bands.find((b) => b.hypo);
  const corrFrom = S.bands.find((b) => S.scales.some((x) => (b.units[x] ?? 0) > 0) && !b.hypo);
  const maxU = Math.max(...S.bands.flatMap((b) => S.scales.map((x) => b.units[x] ?? 0)), 1);
  const flag = (lvl: Interp["lvl"], word: string, text: string): Interp => ({
    lvl,
    word,
    text,
    ref: "",
  });
  const cellFlag = (key: string, x: string): Interp | null => {
    const n = parseFloat(x);
    if (Number.isNaN(n)) return null;
    if (key !== "cbg") return key === "units" ? null : K.interp(key, x);
    const b = bandOf(n);
    if (!b) return null;
    if (b.hypo) return flag("crit", W.hypoWord, b.range);
    if (b.call) return flag("crit", W.callWord, b.range);
    if (n > S.ketonesCheckOver)
      return flag("abn", W.highWord, fill(W.ketLine, { n: S.ketonesCheckOver }));
    return S.scales.every((s) => !b.units[s]) ? flag("ok", W.okWord, b.range) : null;
  };
  const supply = supplyOf(rules, pf);
  const thrNum = (b: SsiBand | undefined, k: "gt" | "lt") =>
    b?.[k] ?? b?.[k === "gt" ? "gte" : "lte"];
  const thr = (n: number, label: string): [number, string, "amb"] => [n, label, "amb"];
  const corrN = thrNum(corrFrom, "gt");
  const hypoN = thrNum(hypoBand, "lt");
  const inAim = allG.filter((x) => x >= S.aim.from && x <= S.aim.to).length;

  const win = [
    fill(W.w1, { h: hrs(PH[0]!.to ?? 1) }),
    fill(W.w2, { h: hrs(PH[1]!.to ?? NS) }),
    fill(W.w3, { h: endH }),
  ];
  const titles = [W.ph1, W.ph2, W.ph3];
  const acts = [[a1, a2, a3], [b1, b2], [e1]];
  const [p1, p2, p3] = PH.map((x) => x.id);
  return {
    phases: PH.map((x, i) => ({ ...x, title: titles[i]!, win: win[i]!, acts: acts[i]! })),
    rn: { title: W.rnTitle, note: "", acts: [rn1] },
    flow: (F) => [
      F.P(p1!),
      F.N(`${p1}1`, fill(W.fScale, { s: scale || W.notChosen.toLowerCase() })),
      F.D(`${p1}2`, W.fSuitable, [
        F.Br(W.fYes, W.fUse, eat ? !nbm && !dkaRisk : null),
        F.Br(W.fNbm, W.fVrii, eat ? nbm : null),
        F.Br(fill(W.fKet, { n: S.dka.ketonesFrom }), W.fDka, k0 !== null ? dkaRisk : null),
      ]),
      F.N(`${p1}3`, W.fUsual),
      F.P(p2!),
      F.D(
        `${p2}1`,
        W.fBand,
        S.bands.map((b) =>
          F.Br(
            b.range,
            b.hypo ? W.sugHypo : S.scales.every((s) => !b.units[s]) ? W.fBandNo : W.fBandUnits,
            gL !== null ? b === bL : null,
          ),
        ),
        gL !== null ? fill(W.fLatest, { v: gL }) : "",
      ),
      F.D(`${p2}2`, fill(W.fPattern, { c: RV.highCount, n: RV.highOver }), [
        F.Br(W.fYes, W.fBasal, allG.length ? anyHighDay : null),
        F.Br(W.fNo, W.fKeep, allG.length ? !anyHighDay : null),
      ]),
      F.P(p3!),
      F.N(`${p3}1`, fill(W.fRegimen, { h: endH })),
    ],
    tasks: (add) => tasks.forEach(([key, title, sub, at, b]) => add(key, title, sub, at, b)),
    rows: [
      ["cbg", W.gCbg],
      ["units", W.gUnits],
      ["ket", W.gKet],
    ],
    cellFlag,
    dueAt: (key) => key === "cbg",
    form: [
      {
        key: "cbg",
        label: W.fmCbg,
        unit: "mmol/L",
        dflt: typedNew !== null ? String(typedNew) : "",
      },
      {
        key: "units",
        label: W.fmUnits,
        unit: "",
        dflt: typedNew !== null && dNow ? String(dNow.units) : "",
      },
      { key: "ket", label: W.fmKet, unit: "mmol/L", dflt: "", opt: true },
    ],
    formReq: ["cbg"],
    labKeys: ["cbg", "ket"],
    recWhat: (h) => fill(W.recWhat, { meal: meal(h) }),
    recHint: () =>
      (scale
        ? typedNew !== null
          ? fill(W.recTyped, { g: typedNew, s: scale.toLowerCase(), d: lc1(sugW(typedNew)) })
          : fill(W.recType, { s: scale.toLowerCase() })
        : W.recNoScale) + fill(W.recKet, { n: S.ketonesCheckOver }),
    panels: [
      {
        key: "cbg",
        name: W.pCbg,
        unit: "mmol/L",
        min: 0,
        max: 30,
        ticks: [0, 10, 20, 30],
        thr: [
          ...(corrN != null ? [thr(corrN, fill(W.thrCorr, { n: corrN }))] : []),
          ...(hypoN != null ? [thr(hypoN, fill(W.thrHypo, { n: hypoN }))] : []),
        ],
        bad: (x) => {
          const b = bandOf(x);
          return !!(b?.hypo || b?.call);
        },
      },
      {
        key: "units",
        name: W.pUnits,
        unit: "units",
        min: 0,
        max: maxU,
        ticks: [0, maxU / 2, maxU],
        thr: [],
      },
    ],
    stats: [
      {
        k: W.sScale,
        v: scale || "—",
        s: fill(W.sugIs, { s: sug }),
        ...(scale ? {} : { cls: "warn" as const }),
      },
      {
        k: W.sGlucose,
        v: gL !== null ? `${gL} mmol/L` : "—",
        s: lastG ? K.lbl(lastG.h) : W.baseline,
        ...(bL?.hypo || bL?.call ? { cls: "warn" as const } : {}),
      },
      {
        k: W.sDose,
        v: dNow ? (dNow.band.hypo ? W.noInsulin : fill(W.unitsIs, { u: dNow.units })) : "—",
        s:
          dNow && gUse !== null
            ? fill(W.glucoseOn, { g: gUse, s: scale.toLowerCase() })
            : W.byScale,
        ...(dNow?.band.hypo || dNow?.band.call ? { cls: "warn" as const } : {}),
      },
      {
        k: W.sAvg,
        v: avg !== null ? String(avg) : "—",
        s: fill(W.readings, { n: allG.length }),
      },
      { k: W.sUsed, v: fill(W.usedIs, { u: totU }), s: W.correctionOnly },
    ],
    aims: [
      {
        word: fill(W.aimMost, { a: S.aim.from, b: S.aim.to }),
        ok: allG.length > 0 && inAim >= allG.length / 2,
        known: allG.length > 1,
      },
      { word: fill(W.aimNoLow, { n: RV.lowUnder }), ok: !lows, known: allG.length > 0 },
      { word: fill(W.aimRev, { h: endH }), ok: !!T.rev, known: hNow >= PH[2]!.from },
    ],
    meds: supply.map((s) => ({ drug: s.drug, qty: s.qty ?? 0, why: s.doseText })),
    medsNote: W.medsNote,
    phRows: [
      row(W.phIns, fill(W.phInsIs, { u: totU })),
      row(W.phScale, scale ? fill(W.phScaleIs, { s: scale }) : W.phNone),
    ],
    logWords: W.log,
  };
}
