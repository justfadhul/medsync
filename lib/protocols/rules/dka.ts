import type { RuleModule } from "./index";
import type { Built, Kit } from "@/lib/protocols/engine/kit";
import type { Btn, ChartVersion, Item, Line } from "@/lib/protocols/engine/types";
import { z } from "zod";

import { fill } from "@/content/protocol-charts";
import { DKA_COPY as W } from "@/content/protocol-charts-rules";
import { QuickRules, supplyOf } from "@/lib/protocols/quick";

/**
 * DKA (adult, JBDS), FEATURES.md §2.1: the prototype's `dkView` on the generic kit. Every number is
 * the version's `seed` (0283); the words are DKA_COPY (draft). Blocking rules held here and so in
 * the server action (P6): the insulin is not started while the potassium is under the hold value,
 * nor without an IV line and a weight; a rise needs the nurse's lines-and-pumps check after the last
 * rise, and never twice within the lock time.
 */

const num = z.number().finite();
const Band = z.object({
  gt: num.optional(),
  gte: num.optional(),
  lt: num.optional(),
  lte: num.optional(),
  range: z.string(),
  kclMmolL: num,
  senior: z.boolean().optional(),
});
export const DkaSeed = z.object({
  phases: z.array(z.object({ id: z.string(), from: num, to: num.nullable() })).length(4),
  confirm: z.object({
    glucoseOver: num,
    ketonesOver: num,
    urineKetonesFrom: z.string(),
    phUnder: num,
    hco3Under: num,
  }),
  severe: z.object({
    ketonesOver: num,
    phUnder: num,
    hco3Under: num,
    kUnder: num,
    gcsUnder: num,
    spo2Under: num,
    sbpUnder: num,
    pulseOver: num,
    pulseUnder: num,
  }),
  anionGapOver: num,
  shock: z.object({
    sbpUnder: num,
    bolusMl: num,
    bolusMinutes: num,
    repeatUnder: num,
    boluses: num,
  }),
  insulin: z.object({
    unitsPerKgH: num,
    maxStartUnitsH: num,
    unitsPerMl: num,
    raiseUnitsH: num,
    raiseLockMinutes: num,
  }),
  kHoldUnder: num,
  kBands: z.array(Band).min(1),
  kMonitorOverMmolH: num,
  bags: z.array(z.object({ from: num, to: num, mlH: num })).min(1),
  glucose: z.object({ addUnder: num, mlH: num }),
  hypo: z.object({ under: num, ml: num, recheckMinutes: num }),
  targets: z.object({ ketonesFallH: num, hco3RiseH: num, glucoseFallH: num }),
  reassess: z.object({
    urineMlKgHUnder: num,
    spo2Under: num,
    phUnder: num,
    phFromH: num,
    gcsUnder: num,
  }),
  monitor: z.object({ gasH: z.array(num), ueH: z.array(num), vitalsMinutes: num }),
  resolve: z.object({ phOver: num, ketonesUnder: num, hco3Over: num, byH: num }),
  caution: z.object({ elderlyFrom: num, youngFrom: num, youngTo: num, eskdEgfrUnder: num }),
  hcg: z.object({ minAge: num, maxAge: num }),
  refs: z.record(z.string(), z.unknown()),
});
export type DkaSeed = z.infer<typeof DkaSeed>;

const dka: RuleModule = {
  id: "dka",
  short: () => W.short,
  check: (v: ChartVersion) =>
    DkaSeed.safeParse(v.seed).success && QuickRules.safeParse(v.rules).success
      ? null
      : W.seedMissing,
  build: (K) => buildDka(K),
};
export default dka;

const UK = ["Negative", "Trace", "1+", "2+", "3+", "4+"];
const inBand = (b: z.infer<typeof Band>, x: number) =>
  (b.gt == null || x > b.gt) &&
  (b.gte == null || x >= b.gte) &&
  (b.lt == null || x < b.lt) &&
  (b.lte == null || x <= b.lte);

export function buildDka(K: Kit): Built {
  const S = DkaSeed.parse(K.version.seed);
  const rules = QuickRules.parse(K.version.rules);
  const {
    v,
    T,
    c,
    facts: p,
    now,
    hNow,
    w,
    due,
    hh,
    dur,
    L,
    A,
    btn,
    st,
    mark,
    give,
    fld,
    it,
    row,
  } = K;
  const pf = { ageYears: p.ageYears, sex: p.sex, weightKg: p.weightKg, pregnant: p.pregnant };
  const age = p.ageYears ?? 0;

  // ─── Immediate: 0 to 60 min ───
  const val = K.val;
  const cbg = K.latest("cbg");
  const ket = K.latest("ket");
  const ph = K.latest("ph");
  const k = K.latest("k");
  const sbp = val("sbp");
  const gcs = val("gcs");
  const spo2 = val("spo2");
  const pulse = val("pulse");
  const knownDm = p.problems.some((x) => /diabetes/i.test(x)) || v.knownDm === "yes";
  const uMode = v.ketMode === "urine";
  const ketSeg = [
    ["blood", W.ketBlood],
    ["urine", W.ketUrine],
  ].map(([id, word]) => ({
    word: word!,
    on: (v.ketMode || "blood") === id,
    act: K.set("ketMode", id!),
  }));
  const ukFrom = UK.indexOf(S.confirm.urineKetonesFrom);
  const c1 = (val("cbg") !== null && val("cbg")! >= S.confirm.glucoseOver) || knownDm;
  const c2 = uMode
    ? UK.indexOf(v.uket ?? "") >= ukFrom && ukFrom >= 0
    : val("ket") !== null && val("ket")! > S.confirm.ketonesOver;
  const c3 =
    (val("ph") !== null && val("ph")! < S.confirm.phUnder) ||
    (val("hco3") !== null && val("hco3")! < S.confirm.hco3Under);
  const confirmed = c1 && c2 && c3;
  const SV = S.severe;
  const sev: string[] = [];
  const vk = val("ket");
  if (!uMode && vk !== null && vk > SV.ketonesOver) sev.push(fill(W.sevKet, { v: vk }));
  if (val("ph") !== null && val("ph")! < SV.phUnder) sev.push(fill(W.sevPh, { v: val("ph")! }));
  if (val("hco3") !== null && val("hco3")! < SV.hco3Under)
    sev.push(fill(W.sevHco3, { v: val("hco3")! }));
  if (val("k") !== null && val("k")! < SV.kUnder) sev.push(fill(W.sevK, { v: val("k")! }));
  if (gcs !== null && gcs < SV.gcsUnder) sev.push(fill(W.sevGcs, { v: gcs }));
  if (spo2 !== null && spo2 < SV.spo2Under) sev.push(fill(W.sevSpo2, { v: spo2 }));
  if (sbp !== null && sbp < SV.sbpUnder) sev.push(fill(W.sevSbp, { v: sbp }));
  if (pulse !== null && (pulse > SV.pulseOver || pulse < SV.pulseUnder))
    sev.push(fill(W.sevPulse, { v: pulse }));
  const mk = (ok: boolean, has: boolean) => K.crit("", "", ok, has).mark;
  const a1 = A(
    {
      n: 1,
      title: W.a1,
      sub: W.a1Sub,
      btns: K.orderMissing(uMode ? ["cbg", "ph", "hco3"] : ["cbg", "ket", "ph", "hco3"]),
      segs: ketSeg,
      segLabel: W.ketBy,
      segWho: "dr",
      fields: [
        fld("cbg", W.cbg, "mmol/L"),
        ...(uMode ? [] : [fld("ket", W.ket, "mmol/L")]),
        fld("ph", W.ph, ""),
        fld("hco3", W.hco3, "mmol/L"),
      ],
      chipHead: uMode ? W.uketHead : "",
      chips: uMode ? K.pick1("uket", UK) : [],
      chipWho: "dr",
      crit: [
        {
          text: fill(W.c1, { n: S.confirm.glucoseOver }),
          val:
            (val("cbg") !== null ? `${val("cbg")} mmol/L` : W.noValue) +
            (knownDm ? ` · ${W.knownDm}` : ""),
          ok: c1,
          mark: c1 ? "met" : mk(false, val("cbg") !== null),
        },
        {
          text: uMode
            ? fill(W.c2u, { n: S.confirm.urineKetonesFrom })
            : fill(W.c2, { n: S.confirm.ketonesOver }),
          val: uMode
            ? v.uket
              ? fill(W.urineIs, { v: v.uket })
              : W.noDipstick
            : val("ket") !== null
              ? `${val("ket")} mmol/L`
              : W.noValue,
          ok: c2,
          mark: c2 ? "met" : mk(false, uMode ? !!v.uket : val("ket") !== null),
        },
        {
          text: fill(W.c3, { ph: S.confirm.phUnder, hco3: S.confirm.hco3Under }),
          val:
            [
              val("ph") !== null ? `pH ${val("ph")}` : "",
              val("hco3") !== null ? `HCO₃ ${val("hco3")}` : "",
            ]
              .filter(Boolean)
              .join(" · ") || W.noValue,
          ok: c3,
          mark: c3 ? "met" : mk(false, val("ph") !== null || val("hco3") !== null),
        },
      ],
      lines: [
        confirmed ? L(W.confirmed, "ok") : L(W.notConfirmed, "warn"),
        ...(sev.length ? [L(fill(W.severe, { list: sev.join(", ") }), "alert")] : []),
        ...(uMode ? [L(W.urineNote)] : []),
        ...(sev.length && T.hdu ? [L(fill(W.hduAt, { t: hh(T.hdu) }), "ok")] : []),
      ],
    },
    st(confirmed, !confirmed && val("cbg") !== null && val("ket") !== null && val("ph") !== null),
  );
  if (sev.length && !T.hdu) a1.btns.push(btn(W.hduBtn, mark("hdu"), "dr", "main"));
  a1.brief = confirmed
    ? `${W.confirmedShort}${sev.length ? ` · ${fill(W.severeShort, { list: sev.join(", ") })}` : ""}`
    : W.notConfirmedShort;

  const na = val("na");
  const cl = val("cl");
  const ag =
    na !== null && cl !== null && val("hco3") !== null
      ? Math.round((na - (cl + val("hco3")!)) * 10) / 10
      : null;
  const eg = p.egfr;
  const a2 = A(
    {
      n: 2,
      title: W.a2,
      sub: W.a2Sub,
      btns: K.orderMissing(["na", "k", "urea", "cl", "lact", "lglu"]),
      fields: [
        fld("na", W.na, "mmol/L"),
        fld("k", W.k, "mmol/L"),
        fld("urea", W.urea, "mmol/L"),
        fld("cl", W.cl, "mmol/L"),
        fld("lact", W.lact, "mmol/L"),
        fld("lglu", W.lglu, "mmol/L"),
        fld("gcs", W.gcs, "/15"),
        fld("ews", W.ews, ""),
      ],
      rows: [
        row(W.creat, p.creatinine ? `${p.creatinine} µmol/L` : W.notOnFile),
        row(
          W.egfr,
          eg ? fill(W.egfrIs, { v: Math.round(eg) }) : W.needsCreat,
          eg && eg < 30 ? "warn" : undefined,
        ),
        row(
          W.ag,
          ag !== null
            ? fill(ag > S.anionGapOver ? W.agRaised : W.agNormal, { v: ag, n: S.anionGapOver })
            : W.agNeeds,
          ag !== null && ag > S.anionGapOver ? "warn" : undefined,
        ),
      ],
    },
    st(
      ["na", "k", "urea", "cl", "hco3", "lact", "lglu", "gcs"].every((x) => val(x) !== null),
      false,
    ),
  );
  a2.brief = [
    na !== null ? `Na ${na}` : "",
    val("k") !== null ? `K ${val("k")}` : "",
    val("urea") !== null ? `urea ${val("urea")}` : "",
    ag !== null ? fill(W.agShort, { v: ag }) : "",
    eg ? `eGFR ${Math.round(eg)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const female = p.sex === "female" && age >= S.hcg.minAge && age <= S.hcg.maxAge;
  const INV: [string, string, boolean?][] = [
    ["ecg", W.ecg],
    ["cxr", W.cxr],
    ["msu", W.msu],
    ...(female ? ([["hcg", W.hcg]] as [string, string][]) : []),
    ["stool", W.stool, true],
    ["bc", W.bc],
    ["ct", W.ct, true],
    ["vte", W.vte],
  ];
  const invItems: Item[] = K.invItems(INV).map((i, j) =>
    INV[j]![0] === "vte" && !K.inv.vte
      ? { ...i, btns: [btn(W.given, { t: "inv", key: "vte", to: "done" }, "rn", "main")] }
      : i,
  );
  const a3 = A({ n: 3, title: W.a3, sub: W.a3Sub, items: invItems }, st(K.invDone(INV), false));
  a3.brief = fill(W.invBrief, {
    done: INV.filter((y) => K.inv[y[0]] === "done").length,
    ordered: INV.filter((y) => K.inv[y[0]] === "ordered").length,
    not: INV.filter((y) => !K.inv[y[0]]).length,
  });

  const PRE = W.precip;
  const pre = K.many("precip");
  const infected = p.problems.filter((x) => /pneumonia|sepsis|infection/i.test(x));
  const a4 = A(
    {
      n: 4,
      title: W.a4,
      sub: W.a4Sub,
      chips: K.pickN("precip", PRE),
      chipWho: "dr",
      lines:
        infected.length && !pre.includes(PRE[0]!)
          ? [L(fill(W.onProblems, { list: infected.join(", ") }), "warn")]
          : [],
      btns: pre.length ? [btn(W.prescribeCause, { t: "rx" }, "dr")] : [],
    },
    st(pre.length > 0, false),
  );
  a4.brief = pre.join(", ") || W.nonePicked;

  const shocked = sbp !== null && sbp < S.shock.sbpUnder;
  const boluses = K.gv("bolus");
  const a5 = A(
    {
      n: 5,
      title: W.a5,
      sub: fill(W.a5Sub, { n: S.shock.sbpUnder }),
      fields: [fld("sbp", W.sbp, "mmHg"), fld("pulse", W.pulse, "/min"), fld("spo2", W.spo2, "%")],
      branchHead:
        sbp === null ? W.enterSbp : fill(shocked ? W.isShocked : W.notShocked, { v: sbp }),
      branches: [
        K.br(
          W.yesShocked,
          fill(W.shockText, {
            ml: S.shock.bolusMl,
            min: S.shock.bolusMinutes,
            repeat: S.shock.repeatUnder,
          }),
          shocked,
          sbp !== null,
          true,
        ),
        K.br(W.no, W.litreText, sbp !== null && !shocked, sbp !== null),
      ],
      btns: shocked
        ? [
            btn(
              boluses.length
                ? fill(W.bolusN, { ml: S.shock.bolusMl, n: boluses.length + 1 })
                : fill(W.bolus, { ml: S.shock.bolusMl }),
              give("bolus"),
              "rn",
              "main",
            ),
          ]
        : T.fluid1At
          ? []
          : [btn(W.litreStarted, mark("fluid1At"), "rn", "main")],
      lines: [
        ...(shocked
          ? boluses.map((t, i) => L(fill(W.bolusAt, { n: i + 1, t: hh(t) }), "ok"))
          : T.fluid1At
            ? [L(fill(W.litreAt, { t: hh(T.fluid1At) }), "ok")]
            : []),
        T.senior
          ? L(fill(W.seniorAt, { t: hh(T.senior) }), "ok")
          : L(
              sev.length || shocked ? W.informNow : W.informLater,
              sev.length || shocked ? "alert" : "",
            ),
      ],
    },
    st(shocked ? boluses.length > 0 : !!T.fluid1At, shocked && !boluses.length),
  );
  if (!T.senior) a5.btns.push(btn(W.seniorBtn, mark("senior"), "dr"));
  a5.brief =
    (sbp === null
      ? W.noBp
      : shocked
        ? fill(W.shockedBrief, { v: sbp, n: boluses.length })
        : fill(W.notShockedBrief, { v: sbp }) +
          (T.fluid1At ? ` · ${fill(W.litreBrief, { t: hh(T.fluid1At) })}` : "")) +
    (T.senior ? ` · ${fill(W.seniorBrief, { t: hh(T.senior) })}` : "");

  // Insulin: fixed rate by weight; a rise is +raise each, after the nurse's check (P6).
  const I = S.insulin;
  const rate0 = w ? Math.min(I.maxStartUnitsH, Math.round(I.unitsPerKgH * w * 10) / 10) : 0;
  const ups = K.c.marks.insUp ?? [];
  const rate = Math.round((rate0 + ups.length * I.raiseUnitsH) * 10) / 10;
  const insRateAt = ups.length ? ups[ups.length - 1]! : null;
  const mlH = (u: number) => Math.round((u / I.unitsPerMl) * 10) / 10;
  const kHold = k !== null && k < S.kHoldUnder;
  const LONG = W.longActs;
  const canStartIns = !T.insAt && !!w && K.hasLine && !kHold;
  const a6 = A(
    {
      n: 6,
      title: W.a6,
      sub: fill(W.a6Sub, { u: I.unitsPerKgH, max: I.maxStartUnitsH }),
      rows: [
        row(
          W.weight,
          w ? `${w} kg${p.weightFrom ? ` (${p.weightFrom})` : ""}` : W.noWeight,
          w ? undefined : "warn",
        ),
        row(
          W.startRate,
          w
            ? fill(W.startRateIs, {
                r: rate0,
                ml: mlH(rate0),
                u: I.unitsPerKgH,
                w,
                cap:
                  I.unitsPerKgH * w > I.maxStartUnitsH
                    ? fill(W.capped, { n: I.maxStartUnitsH })
                    : "",
              })
            : "—",
          "strong",
        ),
        row(W.rateNow, fill(ups.length ? W.rateChanged : W.rateIs, { r: rate, r0: rate0 })),
      ],
      btns: [
        ...K.ivBtn(W.ivTwo),
        ...(canStartIns ? [btn(W.infusionStarted, mark("insAt"), "rn", "main")] : []),
      ],
      fields: K.wtBits(W.forInsulin).fields,
      chips: K.pick1("longAct", LONG),
      chipWho: "dr",
      lines: [
        K.hasLine
          ? K.ivLine()
          : L(K.ivTask ? W.ivAskedTwo : W.ivNoneTwo, K.ivTask ? "warn" : "alert"),
        ...(kHold ? [L(fill(W.kHold, { k: k!, n: S.kHoldUnder }), "alert")] : []),
        ...(T.insAt ? [L(fill(W.insRunning, { t: hh(T.insAt) }), "ok")] : []),
        L(W.longNote),
        v.longAct && v.longAct !== LONG[0]
          ? L(fill(W.longContinues, { name: v.longAct }), "ok")
          : v.longAct
            ? L(W.notOnLong)
            : L(W.pickOne, "warn"),
      ],
    },
    st(!!T.insAt && !!v.longAct, kHold && !T.insAt),
  );
  a6.brief = `${fill(W.unitsH, { r: rate })}${T.insAt ? ` · ${fill(W.startedBrief, { t: hh(T.insAt) })}` : ` · ${W.notStarted}`}${v.longAct ? ` · ${v.longAct.toLowerCase()}` : ""}`;

  const kb = k !== null ? (S.kBands.find((b) => inBand(b, k)) ?? null) : null;
  const uoLast = K.lastObs("uo");
  const anuric = !!uoLast && parseFloat(uoLast.values.uo!) === 0;
  const bagOf = (h: number) =>
    S.bags.find((b) => h >= b.from && h < b.to) ?? S.bags[S.bags.length - 1]!;
  const kPerH = kb ? (kb.kclMmolL * bagOf(hNow).mlH) / 1000 : 0;
  const kText = (b: (typeof S.kBands)[number]) =>
    b.senior ? W.kSenior : b.kclMmolL ? fill(W.kEach, { n: b.kclMmolL }) : W.kNone;
  const a7 = A(
    {
      n: 7,
      title: W.a7,
      sub: W.a7Sub,
      branchHead:
        k === null
          ? W.needsK
          : fill(W.latestK, {
              k,
              h: K.lastObs("k") ? fill(W.hourN, { n: K.lastObs("k")!.h }) : "",
            }),
      branches: S.kBands.map((b) => ({
        ...K.br(`${b.range} mmol/L`, kText(b), b === kb, !!kb, !!b.senior),
        ...(b === kb ? { tag: W.nowTag } : {}),
      })),
      lines: [
        L(W.hypoKNote),
        kPerH > S.kMonitorOverMmolH
          ? L(fill(W.kMonitor, { r: kPerH, n: S.kMonitorOverMmolH }), "alert")
          : L(fill(W.kRunning, { r: kPerH, n: S.kMonitorOverMmolH })),
        anuric ? L(W.anuric, "alert") : L(W.anuricNote),
      ],
    },
    st(!!kb && !anuric, !!kb?.senior || anuric),
  );
  a7.brief = k !== null ? `K ${k} → ${kb ? kText(kb).toLowerCase() : ""}` : W.needsKShort;

  const R = S.reassess;
  const uoKg = uoLast && w ? parseFloat(uoLast.values.uo!) / w : null;
  const vom = v.re_vom === "yes";
  const R8 = [
    {
      trig: fill(W.trigUo, { n: R.urineMlKgHUnder }),
      now: uoKg !== null ? fill(W.uoNow, { v: K.n2(uoKg), h: uoLast!.h }) : W.noUo,
      hit: uoKg !== null && uoKg < R.urineMlKgHUnder,
      act: W.catheterise,
    },
    {
      trig: W.trigVom,
      now: vom ? W.yes : W.no,
      hit: vom,
      act: W.ngTube,
      tog: true,
    },
    {
      trig: fill(W.trigSpo2, { n: R.spo2Under }),
      now: spo2 !== null ? `${spo2}%` : W.notRecorded,
      hit: spo2 !== null && spo2 < R.spo2Under,
      act: W.gasCxr,
    },
    {
      trig: W.trigAcid,
      now:
        ph !== null
          ? `pH ${ph}${hNow >= R.phFromH ? ` · ${fill(W.atH, { n: hNow })}` : ""}`
          : W.noGas,
      hit: ph !== null && ph < R.phUnder && hNow >= R.phFromH,
      act: W.otherCauses,
    },
    {
      trig: fill(W.trigGcs, { n: R.gcsUnder }),
      now: gcs !== null ? String(gcs) : W.notRecorded,
      hit: gcs !== null && gcs < R.gcsUnder,
      act: W.ctHead,
    },
  ];
  const a8 = A(
    {
      n: 8,
      title: W.a8,
      sub: W.a8Sub,
      items: R8.map((x) =>
        it(
          x.trig,
          fill(W.nowIs, { v: x.now }),
          x.hit ? x.act : W.notNeededWord,
          x.hit ? "alert" : "na",
          x.tog
            ? [btn(vom ? W.clear : W.markPresent, K.set("re_vom", vom ? "" : "yes"), "rn", "link")]
            : [],
        ),
      ),
      btns: T.review ? [] : [btn(W.reviewBtn, mark("review"), "dr", "main")],
      lines: T.review ? [L(fill(W.reviewAt, { t: hh(T.review) }), "ok")] : [],
    },
    st(
      !!T.review,
      R8.some((x) => x.hit),
    ),
  );
  a8.brief =
    R8.filter((x) => x.hit)
      .map((x) => x.act)
      .join(" · ") ||
    W.noTriggers + (T.review ? ` · ${fill(W.reviewBrief, { t: hh(T.review) })}` : "");

  // ─── 1 to 6 hours ───
  const hourly = Array.from({ length: K.NS + 1 }, (_, i) => i);
  const gasH = S.monitor.gasH;
  const ueH = S.monitor.ueH;
  const missed = (key: string, hs: number[]) =>
    hs.filter(
      (h) => h <= hNow && h > 0 && !K.obs.some((o) => o.h === h && (o.values[key] ?? "") !== ""),
    ).length;
  const nextOf = (hs: number[]) => {
    const n = hs.find((h) => due(h) > now);
    return n === undefined
      ? W.allDone
      : fill(W.nextAtHour, { t: hh(due(n)), n, d: dur(due(n) - now) });
  };
  const lastVit = c.vit.length ? c.vit[c.vit.length - 1]!.at : null;
  const vitOk = lastVit !== null && lastVit + S.monitor.vitalsMinutes * 60000 > now;
  const b1 = A(
    {
      n: 1,
      title: W.b1,
      sub: W.b1Sub,
      items: [
        { name: W.monCbg, sub: `${W.hourly} · ${nextOf(hourly)}`, m: missed("cbg", hourly) },
        { name: W.monGas, sub: `${gasH.join(", ")} h · ${nextOf(gasH)}`, m: missed("ph", gasH) },
        { name: W.monUe, sub: `${ueH.join(", ")} h · ${nextOf(ueH)}`, m: 0 },
        { name: W.monFluid, sub: `${W.hourly} · ${nextOf(hourly)}`, m: missed("uo", hourly) },
      ].map((x) =>
        it(x.name, x.sub, x.m ? fill(W.missed, { n: x.m }) : W.onTime, x.m ? "alert" : "done"),
      ),
      btns: [btn(W.openChart, { t: "screen", to: "chart" }, null, "main")],
      lines: [
        L(vitOk ? fill(W.vitalsOk, { t: hh(lastVit!) }) : W.vitalsDue, vitOk ? "ok" : "warn"),
      ],
    },
    st(missed("cbg", hourly) === 0, missed("cbg", hourly) > 0 || missed("ph", gasH) > 0),
  );
  b1.brief = ["cbg", "ph", "uo"].some((x) => missed(x, x === "ph" ? gasH : hourly))
    ? W.checksMissed
    : fill(W.allOnTime, { t: hh(due(hNow + 1)) });

  const caution: string[] = [];
  if (age >= S.caution.elderlyFrom) caution.push(W.cElderly);
  if (age >= S.caution.youngFrom && age <= S.caution.youngTo) caution.push(W.cYoung);
  if (eg && eg < S.caution.eskdEgfrUnder) caution.push(W.cEskd);
  if (p.pregnant) caution.push(W.cPreg);
  if (p.problems.some((x) => /heart failure|CCF/i.test(x))) caution.push(W.cHf);
  const cbgNow = cbg;
  const glucOn = !!T.glucAt;
  const G = S.glucose;
  const bagHung = (i: number) => T[`bag${i}`];
  const bagRows = (from: number, to: number) =>
    S.bags.flatMap((b, i) => {
      if (i < from || i >= to) return [];
      const hung = bagHung(i);
      const running = hNow >= b.from && hNow < b.to;
      const kAdd = i === 0 ? 0 : kb ? kb.kclMmolL : null;
      return [
        it(
          fill(W.bagName, {
            n: i + 1,
            k: kAdd ? fill(W.plusK, { n: kAdd }) : kAdd === 0 && i > 0 ? W.noK : "",
          }),
          fill(W.bagSub, {
            h: b.to - b.from,
            r: b.mlH,
            from: b.from,
            to: b.to,
            t1: hh(due(b.from)),
            t2: hh(due(b.to)),
          }),
          hung
            ? fill(W.upAt, { t: hh(hung) })
            : running
              ? W.dueNowWord
              : due(b.from) < now
                ? W.overdueWord
                : W.laterWord,
          hung ? "done" : running || due(b.from) < now ? "alert" : "todo",
          hung ? [] : [btn(W.hungNow, mark(`bag${i}`), "rn", running ? "main" : undefined)],
        ),
      ];
    });
  const glucLine: Line =
    cbgNow !== null && cbgNow < G.addUnder
      ? glucOn
        ? L(fill(W.glucRunning, { r: G.mlH, t: hh(T.glucAt!) }), "ok")
        : L(fill(W.glucStart, { v: cbgNow, n: G.addUnder, r: G.mlH }), "alert")
      : L(
          fill(W.glucWhen, {
            n: G.addUnder,
            r: G.mlH,
            now: cbgNow !== null ? fill(W.nowParen, { v: cbgNow }) : "",
          }),
        );
  const glucBtn: Btn[] =
    cbgNow !== null && cbgNow < G.addUnder && !glucOn
      ? [btn(W.glucStarted, mark("glucAt"), "rn", "main")]
      : [];
  const H = S.hypo;
  const lastCbgAt = K.lastObs("cbg")?.at ?? 0;
  const hypo = cbgNow !== null && cbgNow < H.under;
  const hypoDone = hypo && !!T.hypoAt && T.hypoAt > lastCbgAt;
  const overBag = (from: number, to: number) =>
    S.bags.some((b, i) => i >= from && i < to && !bagHung(i) && due(b.from) < now);
  const b2 = A(
    {
      n: 2,
      title: W.b2,
      sub: W.b2Sub,
      items: bagRows(1, 4),
      lines: [
        ...(hypo
          ? [
              L(
                fill(W.hypoLine, { v: cbgNow!, ml: H.ml, m: H.recheckMinutes }) +
                  (hypoDone ? ` ${fill(W.treatedAt, { t: hh(T.hypoAt!) })}` : ""),
                hypoDone ? "warn" : "alert",
              ),
            ]
          : []),
        glucLine,
        caution.length
          ? L(fill(W.caution, { list: caution.join(", ") }), "warn")
          : L(W.cautionNote),
      ],
      btns: glucBtn,
    },
    st(
      S.bags.slice(1, 4).every((b, i) => bagHung(i + 1) || due(b.from) > now),
      overBag(1, 4) || (cbgNow !== null && cbgNow < G.addUnder && !glucOn) || hypo,
    ),
  );
  const nb = (i: number) => S.bags.findIndex((_, j) => j > i && !bagHung(j));
  const lastHung = S.bags
    .map((_, i) => (bagHung(i) ? i : -1))
    .filter((i) => i >= 0)
    .pop();
  b2.brief =
    lastHung !== undefined
      ? fill(W.bagUp, { n: lastHung + 1, t: hh(bagHung(lastHung)!) }) +
        (nb(lastHung) >= 0
          ? ` · ${fill(W.bagNext, { n: nb(lastHung) + 1, t: hh(due(S.bags[nb(lastHung)]!.from)) })}`
          : "")
      : W.noBags;

  const VS = W.volStatus;
  const b3 = A(
    {
      n: 3,
      head: W.check,
      title: W.b3,
      sub: W.b3Sub,
      chips: VS.map((x) => ({
        word: T[`vs_${x}`] ? `${x} · ${hh(T[`vs_${x}`]!)}` : x,
        on: !!T[`vs_${x}`],
        act: mark(`vs_${x}`),
      })),
      chipWho: "rn",
      lines: [L(W.tapEach)],
    },
    st(
      VS.every((x) => T[`vs_${x}`]),
      false,
    ),
  );
  b3.brief = VS.filter((x) => T[`vs_${x}`]).join(", ") || W.notReassessed;

  // Targets, from the chart (at least 2 readings).
  const TG = S.targets;
  const tKet = K.perH("ket", -1);
  const tHco = K.perH("hco3", 1);
  const tCbg = K.perH("cbg", -1);
  const cbgLow = cbgNow !== null && cbgNow < G.addUnder;
  const targets = [
    ...(uMode
      ? []
      : [
          {
            word: fill(W.tKet, { n: TG.ketonesFallH }),
            r: tKet,
            ok: tKet !== null && tKet >= TG.ketonesFallH,
            low: false,
          },
        ]),
    {
      word: fill(W.tHco, { n: TG.hco3RiseH }),
      r: tHco,
      ok: tHco !== null && tHco >= TG.hco3RiseH,
      low: false,
    },
    {
      word: fill(W.tCbg, { n: TG.glucoseFallH, u: G.addUnder }),
      r: tCbg,
      ok: cbgLow || (tCbg !== null && tCbg >= TG.glucoseFallH),
      low: cbgLow,
    },
  ];
  const tMet = targets.filter((t) => t.ok).length;
  const tN = targets.length;
  const tKnown = targets.filter((t) => t.r !== null || t.low).length;
  const offTarget = targets.some((t) => t.r !== null && !t.ok && !t.low);
  const insUp = Math.round((rate + I.raiseUnitsH) * 10) / 10;
  const recentUp = !!insRateAt && now - insRateAt < I.raiseLockMinutes * 60000;
  const linesOk = !!T.linesAt && (!insRateAt || T.linesAt > insRateAt);
  const b4 = A(
    {
      n: 4,
      title: W.b4,
      sub: W.b4Sub,
      rows: targets.map((t) =>
        row(
          t.word,
          t.low
            ? fill(W.tLow, { n: G.addUnder })
            : t.r === null
              ? W.needs2
              : `${t.r >= 0 ? "" : "−"}${Math.abs(t.r)} ${W.perHour}${t.ok ? ` · ${W.metWord}` : ` · ${W.notMetWord}`}`,
          t.low || t.ok ? "okv" : t.r === null ? undefined : "warn",
        ),
      ),
      lines: recentUp
        ? [L(fill(W.raisedTo, { r: rate, t: hh(insRateAt!) }), "ok")]
        : offTarget
          ? [
              L(fill(W.offTarget, { n: I.raiseUnitsH }), "alert"),
              ...(linesOk ? [L(fill(W.linesAt, { t: hh(T.linesAt!) }), "ok")] : [L(W.linesTask)]),
            ]
          : [L(fill(W.onTarget, { r: rate }), "ok")],
      btns:
        offTarget && !recentUp && T.insAt
          ? linesOk
            ? [btn(fill(W.raise, { r: insUp }), mark("insUp"), "dr", "main")]
            : [btn(W.linesBtn, mark("linesAt"), "rn", "main")]
          : [],
    },
    st(tKnown === tN && tMet === tN, offTarget),
  );
  b4.brief = fill(W.targetsBrief, { m: tMet, n: tN }) + (uMode ? ` · ${W.urineNotTarget}` : "");

  // ─── 6 to 12 hours ───
  const d1 = A(
    {
      n: 1,
      title: W.d1,
      items: bagRows(4, S.bags.length),
      lines: [
        cbgNow !== null && cbgNow < G.addUnder
          ? L(fill(W.glucSeparate, { n: G.addUnder, r: G.mlH }), glucOn ? "ok" : "alert")
          : L(fill(W.glucIfSeparate, { n: G.addUnder, r: G.mlH })),
      ],
      btns: glucBtn,
    },
    st(
      S.bags.slice(4).every((b, i) => bagHung(i + 4) || due(b.from) > now),
      overBag(4, S.bags.length),
    ),
  );
  d1.brief = glucOn ? W.glucRunningShort : cbgNow !== null ? fill(W.glucoseIs, { v: cbgNow }) : "";
  const d2 = A(
    {
      n: 2,
      title: W.d2,
      items: [
        it(
          W.cvReassess,
          W.cvSub,
          T.cv6 ? fill(W.doneAt, { t: hh(T.cv6) }) : W.toDo,
          T.cv6 ? "done" : "todo",
          T.cv6 ? [] : [btn(W.done, mark("cv6"), "rn", "main")],
        ),
        it(W.onChartItem, W.onChartSub, W.onChartWord, "na", [
          btn(W.openChart, { t: "screen", to: "chart" }, null, "link"),
        ]),
        it(
          W.refer,
          W.referSub,
          T.ref ? fill(W.referredAt, { t: hh(T.ref) }) : W.notYet,
          T.ref ? "done" : "todo",
          T.ref ? [] : [btn(W.referred, mark("ref"), "dr", "main")],
        ),
      ],
    },
    st(!!T.cv6 && !!T.ref, false),
  );
  d2.brief =
    [
      T.cv6 ? fill(W.cvBrief, { t: hh(T.cv6) }) : "",
      T.ref ? fill(W.refBrief, { t: hh(T.ref) }) : "",
    ]
      .filter(Boolean)
      .join(" · ") || W.notYet;

  // ─── Resolve: beyond 12 hours ───
  const RS = S.resolve;
  const phL = K.lastObs("ph");
  const ketL = K.lastObs("ket");
  const hcoL = K.lastObs("hco3");
  const phOk = !!phL && parseFloat(phL.values.ph!) > RS.phOver;
  const k2Ok = uMode
    ? !!hcoL && parseFloat(hcoL.values.hco3!) > RS.hco3Over
    : !!ketL && parseFloat(ketL.values.ket!) < RS.ketonesUnder;
  const resolved = phOk && k2Ok;
  const next = v.next ?? "";
  const e1 = A(
    {
      n: 1,
      title: W.e1,
      sub: fill(uMode ? W.e1SubU : W.e1Sub, {
        ph: RS.phOver,
        ket: RS.ketonesUnder,
        hco3: RS.hco3Over,
      }),
      crit: [
        K.crit(
          fill(W.rPh, { n: RS.phOver }),
          phL ? fill(W.atHour, { v: phL.values.ph!, h: phL.h }) : W.noGas,
          phOk,
          !!phL,
        ),
        uMode
          ? K.crit(
              fill(W.rHco3, { n: RS.hco3Over }),
              hcoL ? fill(W.atHour, { v: hcoL.values.hco3!, h: hcoL.h }) : W.noGas,
              k2Ok,
              !!hcoL,
            )
          : K.crit(
              fill(W.rKet, { n: RS.ketonesUnder }),
              ketL ? fill(W.atHour, { v: ketL.values.ket!, h: ketL.h }) : W.noValue,
              k2Ok,
              !!ketL,
            ),
      ],
      branchHead: resolved ? W.resolvedChoose : W.whenResolves,
      branches: [
        {
          range: W.eating,
          text: W.scText,
          on: next === "sc",
          known: !!next,
          ...(next === "sc" ? { tag: W.chosen } : {}),
        },
        {
          range: W.notEating,
          text: W.vriiText,
          on: next === "vrii",
          known: !!next,
          ...(next === "vrii" ? { tag: W.chosen } : {}),
        },
      ],
      btns: resolved
        ? [
            btn(W.toSc, K.set("next", "sc"), "dr", next === "sc" ? undefined : "main"),
            btn(W.toVrii, K.set("next", "vrii"), "dr"),
            ...(next
              ? [btn(next === "sc" ? W.rxSc : W.rxVrii, { t: "rx" }, "dr"), K.endBtn(W.short)]
              : []),
          ]
        : [],
      lines: [
        resolved
          ? L(W.resolvedLine, "ok")
          : hNow >= RS.byH
            ? L(fill(W.notResolved24, { n: RS.byH }), "alert")
            : L(fill(W.by24, { n: RS.byH })),
      ],
    },
    st(resolved, hNow >= RS.byH && !resolved),
  );
  e1.brief = resolved ? W.resolvedShort : W.notYet;

  // ─── Nurse tasks ───
  const tasks: [string, string, string, number, Btn[]][] = [];
  const tk = (key: string, title: string, sub: string, at: number, b: Btn[]) =>
    tasks.push([key, title, sub, at, b]);
  if (shocked && boluses.length < S.shock.boluses)
    tk(
      "bolus",
      fill(W.tBolus, { ml: S.shock.bolusMl, min: S.shock.bolusMinutes }),
      fill(W.tBolusSub, { v: sbp!, n: S.shock.repeatUnder }),
      c.start,
      [btn(fill(W.bolus, { ml: S.shock.bolusMl }), give("bolus"), "rn", "main")],
    );
  if (!shocked && !T.fluid1At)
    tk("fluid1", W.tLitre, fill(W.tLitreSub, { r: S.bags[0]!.mlH }), c.start, [
      btn(W.litreStarted, mark("fluid1At"), "rn", "main"),
    ]);
  if (canStartIns)
    tk("ins", fill(W.tIns, { ml: mlH(rate) }), W.tInsSub, c.start, [
      btn(W.infusionStarted, mark("insAt"), "rn", "main"),
    ]);
  const nbI = S.bags.findIndex((_, i) => i > 0 && !bagHung(i));
  if (nbI > 0) {
    const b = S.bags[nbI]!;
    tk(
      `bag${nbI}`,
      fill(W.tBag, { n: nbI + 1, k: kb && kb.kclMmolL ? fill(W.plusK, { n: kb.kclMmolL }) : "" }),
      fill(W.tBagSub, { r: b.mlH, h: b.to - b.from, anuric: anuric ? ` · ${W.noKAnuric}` : "" }),
      due(b.from),
      [btn(W.hungNow, mark(`bag${nbI}`), "rn", "main")],
    );
  }
  if (cbgNow !== null && cbgNow < G.addUnder && !glucOn)
    tk(
      "gluc",
      fill(W.tGluc, { r: G.mlH }),
      fill(W.tGlucSub, { v: cbgNow, n: G.addUnder }),
      now,
      glucBtn,
    );
  if (insRateAt && !(T.pumpAt && T.pumpAt > insRateAt))
    tk(
      `pump${ups.length}`,
      fill(W.tPump, { ml: mlH(rate) }),
      fill(W.tPumpSub, { t: hh(insRateAt) }),
      insRateAt,
      [btn(W.pumpSet, mark("pumpAt"), "rn", "main")],
    );
  if (hypo && !hypoDone)
    tk(
      `hypo${lastCbgAt}`,
      fill(W.tHypo, { v: cbgNow! }),
      fill(W.tHypoSub, { ml: H.ml, m: H.recheckMinutes }),
      lastCbgAt || c.start,
      [btn(W.hypoTreated, mark("hypoAt"), "rn", "main")],
    );
  if (offTarget && !linesOk && !recentUp && T.insAt)
    tk(`lines${ups.length}`, W.tLines, W.tLinesSub, now, [
      btn(W.linesBtn, mark("linesAt"), "rn", "main"),
    ]);
  const stale = VS.filter((x) => !T[`vs_${x}`] || now - T[`vs_${x}`]! > 3600000);
  if (stale.length) tk("vs", W.tVs, `${stale.join(", ")} · ${W.tVsSub}`, now, []);

  // ─── The monitoring chart ───
  const isGas = (h: number) => gasH.includes(h) || h === 0;
  const sG = targetStatus(tCbg, tCbg !== null && tCbg >= TG.glucoseFallH, cbgLow, G.addUnder);
  const sK = targetStatus(tKet, tKet !== null && tKet >= TG.ketonesFallH, false, G.addUnder);
  const sB = targetStatus(tHco, tHco !== null && tHco >= TG.hco3RiseH, false, G.addUnder);
  const phLast = K.lastObs("ph");
  const uoFlag = (x: string) => {
    const n = parseFloat(x);
    return w && !Number.isNaN(n) && n / w < R.urineMlKgHUnder
      ? {
          lvl: "abn" as const,
          word: W.lowWord,
          text: fill(W.trigUo, { n: R.urineMlKgHUnder }),
          ref: "",
        }
      : null;
  };
  const gRate = tCbg && tCbg > 0 ? tCbg : TG.glucoseFallH;
  const gEta = cbgNow !== null && cbgNow >= G.addUnder ? (cbgNow - G.addUnder) / gRate : 0;
  const hungN = S.bags.filter((_, i) => bagHung(i)).length;

  const supply = supplyOf(rules, pf);
  const PH = S.phases;
  const win = [W.w1, W.w2, W.w3, W.w4];
  const titles = [W.ph1, W.ph2, W.ph3, W.ph4];
  return {
    phases: [
      { ...PH[0]!, title: titles[0]!, win: win[0]!, acts: [a1, a2, a3, a4, a5, a6, a7, a8] },
      {
        ...PH[1]!,
        title: titles[1]!,
        win: fill(win[1]!, { a: PH[1]!.from, b: PH[1]!.to ?? "" }),
        acts: [b1, b2, b4],
      },
      {
        ...PH[2]!,
        title: titles[2]!,
        win: fill(win[2]!, { a: PH[2]!.from, b: PH[2]!.to ?? "" }),
        acts: [d1, d2],
      },
      { ...PH[3]!, title: titles[3]!, win: fill(win[3]!, { a: PH[3]!.from }), acts: [e1] },
    ],
    rn: { title: W.rnTitle, note: W.tapEach, acts: [b3] },
    flow: (F) => {
      const has1 = val("cbg") !== null && val("ph") !== null;
      return [
        F.P(PH[0]!.id),
        F.D("imm1", W.fConfirm, [
          F.Br(W.yes, W.fContinue, has1 ? confirmed : null),
          F.Br(W.no, W.fOther, has1 ? !confirmed : null),
        ]),
        F.D("imm1", W.fSevere, [
          F.Br(
            W.yes,
            sev.length ? fill(W.fHduList, { list: sev.join(", ") }) : W.fHdu,
            sev.length > 0,
          ),
          F.Br(W.no, W.fWard, sev.length === 0),
        ]),
        F.N("imm2", W.fBaseline),
        F.D(
          "imm5",
          fill(W.fShocked, { n: S.shock.sbpUnder }),
          [
            F.Br(W.yes, fill(W.fBoluses, { ml: S.shock.bolusMl }), sbp !== null ? shocked : null),
            F.Br(W.no, W.fLitre, sbp !== null ? !shocked : null),
          ],
          sbp !== null ? fill(W.fSystolic, { v: sbp }) : "",
        ),
        F.N(
          "imm6",
          fill(W.fInsulin, { r: rate }),
          T.insAt ? fill(W.insRunning, { t: hh(T.insAt) }) : kHold ? W.fHeld : W.notStarted,
        ),
        F.D(
          "imm7",
          W.fPotassium,
          S.kBands.map((b) => F.Br(b.range, kText(b), kb ? b === kb : null)),
          k !== null ? fill(W.fLatestK, { k }) : "",
        ),
        F.N("imm8", W.fReassess),
        F.P(PH[1]!.id),
        F.N("p22", W.fBags),
        F.D("p23", fill(W.fTargets, { m: tMet, n: tN }), [
          F.Br(W.yes, W.fKeep, tKnown === tN ? !offTarget : null),
          F.Br(W.no, fill(W.fRaise, { n: I.raiseUnitsH }), tKnown ? offTarget : null),
        ]),
        F.D("p22", fill(W.fGluc, { n: G.addUnder }), [
          F.Br(
            W.yes,
            fill(W.fGlucYes, { r: G.mlH }) + (glucOn ? ` · ${W.running}` : ""),
            cbgNow !== null ? cbgNow < G.addUnder : null,
          ),
          F.Br(
            W.no,
            W.fGlucNo + (cbgNow !== null ? ` · ${cbgNow}` : ""),
            cbgNow !== null ? cbgNow >= G.addUnder : null,
          ),
        ]),
        F.P(PH[2]!.id),
        F.N("p31", W.fContinueFluids),
        F.N("p32", W.fRefer),
        F.P(PH[3]!.id),
        F.D(
          "p41",
          fill(uMode ? W.fResolvedU : W.fResolved, {
            ph: RS.phOver,
            ket: RS.ketonesUnder,
            hco3: RS.hco3Over,
          }),
          [
            F.Br(W.yes, W.fNext, resolved ? true : hNow >= RS.byH ? false : null),
            F.Br(
              W.no,
              hNow >= RS.byH ? fill(W.fOver24, { n: RS.byH }) : fill(W.fBy24, { n: RS.byH }),
              resolved ? false : hNow >= RS.byH ? true : null,
            ),
          ],
        ),
        F.N(
          "p41",
          next === "sc" ? W.toSc : next === "vrii" ? W.toVrii : W.fEnd,
          c.ended ? W.chartEnded : W.whenResolved,
        ),
      ];
    },
    tasks: (add) => tasks.forEach(([key, title, sub, at, b]) => add(key, title, sub, at, b)),
    rows: [
      ["cbg", W.gCbg],
      uMode ? ["uket", W.gUket] : ["ket", W.gKet],
      ["ins", W.gIns],
      ["nacl", W.gNacl],
      ["gluc", W.gGluc],
      ["uo", W.gUo],
      ["ph", W.gPh],
      ["k", W.gK],
      ["hco3", W.gHco3],
    ],
    cellFlag: (key, x) => (key === "uo" ? uoFlag(x) : key === "uket" ? null : K.interp(key, x)),
    dueAt: (key, h) => ["ph", "k", "hco3"].includes(key) && gasH.includes(h),
    form: [
      { key: "cbg", label: W.fmCbg, unit: "mmol/L", dflt: "" },
      uMode
        ? { key: "uket", label: W.fmUket, unit: W.fmUketUnit, dflt: "" }
        : { key: "ket", label: W.fmKet, unit: "mmol/L", dflt: "" },
      { key: "ins", label: W.fmIns, unit: "ml/h", dflt: T.insAt ? String(mlH(rate)) : "0" },
      { key: "nacl", label: W.fmNacl, unit: "ml/h", dflt: String(bagOf(K.nextH).mlH) },
      { key: "gluc", label: W.fmGluc, unit: "ml/h", dflt: glucOn ? String(G.mlH) : "0" },
      { key: "uo", label: W.fmUo, unit: "ml", dflt: "" },
      { key: "ph", label: W.fmPh, unit: "", dflt: "", opt: !isGas(K.nextH) },
      { key: "k", label: W.fmK, unit: "mmol/L", dflt: "", opt: !isGas(K.nextH) },
      { key: "hco3", label: W.fmHco3, unit: "mmol/L", dflt: "", opt: !isGas(K.nextH) },
    ],
    formReq: ["cbg"],
    labKeys: ["cbg", "ket", "k", "ph", "hco3"],
    recWhat: (h) => W.recWhat + (isGas(h) ? `, ${W.recGas}` : ""),
    recHint: (h) => fill(W.recHint, { gas: isGas(h) ? W.gasYes : W.gasNo }),
    panels: [
      {
        key: "cbg",
        name: W.pCbg,
        unit: "mmol/L",
        min: 0,
        max: 30,
        ticks: [0, 10, 20, 30],
        thr: [[G.addUnder, fill(W.thrGluc, { n: G.addUnder }), "amb"]],
        target: (p0) => K.tLine(p0, TG.glucoseFallH, G.addUnder, -1),
        status: sG[0],
        stLvl: sG[1],
        bad: (x) => x < H.under,
      },
      uMode
        ? {
            key: "uket",
            name: W.pUket,
            unit: "",
            min: 0,
            max: 4,
            ticks: [0, 2, 4],
            status: W.notATarget,
            stLvl: "",
          }
        : {
            key: "ket",
            name: W.pKet,
            unit: "mmol/L",
            min: 0,
            max: 6,
            ticks: [0, 3, 6],
            thr: [
              [S.confirm.ketonesOver, fill(W.thrKet, { n: S.confirm.ketonesOver }), "amb"],
              [RS.ketonesUnder, fill(W.thrKetOk, { n: RS.ketonesUnder }), "grn"],
            ],
            target: (p0) => K.tLine(p0, TG.ketonesFallH, RS.ketonesUnder, -1),
            status: sK[0],
            stLvl: sK[1],
            bad: (x) => x > SV.ketonesOver,
          },
      {
        key: "hco3",
        name: W.pHco3,
        unit: "mmol/L",
        min: 0,
        max: 30,
        ticks: [0, 15, 30],
        thr: [[RS.hco3Over, fill(W.thrHco3, { n: RS.hco3Over }), "grn"]],
        target: (p0) => K.tLine(p0, TG.hco3RiseH, RS.hco3Over, 1),
        status: sB[0],
        stLvl: sB[1],
        bad: (x) => x < SV.hco3Under,
      },
      {
        key: "ph",
        name: W.pPh,
        unit: "",
        min: 6.9,
        max: 7.5,
        ticks: [7.0, 7.2, 7.4],
        fmt: K.n2,
        thr: [[RS.phOver, fill(W.thrPh, { n: RS.phOver }), "grn"]],
        status: phLast
          ? parseFloat(phLast.values.ph!) > RS.phOver
            ? fill(W.over, { n: RS.phOver })
            : W.stillAcid
          : W.noGasYet,
        stLvl: phLast ? (parseFloat(phLast.values.ph!) > RS.phOver ? "ok" : "no") : "",
        bad: (x) => x < SV.phUnder,
      },
    ],
    stats: [
      {
        k: W.sIns,
        v: fill(W.unitsH, { r: rate }),
        s: T.insAt ? fill(W.sinceAt, { t: hh(T.insAt) }) : kHold ? W.fHeld : W.notStarted,
        ...(T.insAt ? {} : { cls: "warn" as const }),
      },
      {
        k: W.sGlucose,
        v: cbgNow !== null ? `${cbgNow} mmol/L` : "—",
        s: K.lastObs("cbg") ? fill(W.hourN, { n: K.lastObs("cbg")!.h }) : W.baseline,
        ...(cbgNow !== null && cbgNow < G.addUnder && !glucOn ? { cls: "warn" as const } : {}),
      },
      uMode
        ? {
            k: W.sUket,
            v: K.lastObs("uket")?.values.uket ?? v.uket ?? "—",
            s: K.lastObs("uket") ? fill(W.hourN, { n: K.lastObs("uket")!.h }) : W.baseline,
          }
        : {
            k: W.sKet,
            v: ket !== null ? `${ket} mmol/L` : "—",
            s: K.lastObs("ket") ? fill(W.hourN, { n: K.lastObs("ket")!.h }) : W.baseline,
          },
      {
        k: W.sTargets,
        v: fill(W.ofMet, { m: tMet, n: tN }),
        s: offTarget ? W.checkLines : W.onTrack,
        ...(offTarget ? { cls: "warn" as const } : {}),
      },
      {
        k: W.sResolved,
        v: resolved ? W.yes : W.notYet,
        s: fill(uMode ? W.resolvedRuleU : W.resolvedRule, {
          ph: RS.phOver,
          ket: RS.ketonesUnder,
          hco3: RS.hco3Over,
        }),
        ...(resolved ? { cls: "ok" as const } : {}),
      },
    ],
    aims: targets.map((t) => ({ word: t.word, ok: t.low || t.ok, known: t.r !== null || t.low })),
    meds: supply.map((s) => ({ drug: s.drug, qty: s.qty ?? 0, why: s.doseText })),
    medsNote: W.medsNote,
    phRows: [
      row(
        W.sIns,
        T.insAt || rate
          ? fill(W.phIns, { r: rate, ml: mlH(rate), hrs: rate ? Math.round(50 / mlH(rate)) : "—" })
          : W.notStarted,
      ),
      row(
        W.phNacl,
        fill(W.phBags, { n: hungN, of: S.bags.length }) +
          (nbI > 0 ? ` ${fill(W.bagNext, { n: nbI + 1, t: hh(due(S.bags[nbI]!.from)) })}.` : ""),
      ),
      row(
        W.phKcl,
        kb
          ? kb.kclMmolL
            ? fill(W.phKclIs, { n: kb.kclMmolL, k: k! })
            : fill(W.phKclNone, { k: k! })
          : W.waitingK,
        kb?.senior ? "warn" : undefined,
      ),
      row(
        W.phGluc,
        glucOn
          ? fill(W.phGlucOn, { r: G.mlH, t: hh(T.glucAt!) })
          : cbgNow !== null && cbgNow < G.addUnder
            ? fill(W.phGlucDue, { v: cbgNow, n: G.addUnder })
            : cbgNow !== null
              ? fill(W.phGlucEta, {
                  v: cbgNow,
                  r: K.n1(gRate),
                  h: K.n1(gEta),
                  t: hh(now + gEta * 3600000),
                })
              : W.notYet,
        cbgNow !== null && cbgNow < G.addUnder && !glucOn ? "warn" : undefined,
      ),
      row(W.phLong, v.longAct ? v.longAct : W.notDecided),
    ],
    logWords: W.log,
  };
}

function targetStatus(
  r: number | null,
  ok: boolean,
  low: boolean,
  under: number,
): [string, "ok" | "no" | ""] {
  if (low) return [fill(W.tLow, { n: under }), "ok"];
  if (r === null) return [W.needs2, ""];
  return ok ? [W.onTargetWord, "ok"] : [W.behind, "no"];
}
