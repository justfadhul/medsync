import type { RuleModule } from "./index";
import type { Built, Kit } from "@/lib/protocols/engine/kit";
import type { Btn, ChartVersion, Interp, Step } from "@/lib/protocols/engine/types";
import { z } from "zod";

import { fill } from "@/content/protocol-charts";
import { HTN_COPY } from "@/content/protocol-charts-rules";
import { QuickRules, supplyOf } from "@/lib/protocols/quick";

/**
 * Hypertensive emergency, IV labetalol (adult), FEATURES.md §2.4: the prototype's `PC.htn` on the
 * generic kit. Every number is the version's `seed` (0285); the words are HTN_COPY (draft). Blocking
 * rules held here and so in the server action (P6): no bolus while the pulse is under the hold
 * value, the MAP is at or under the aim (so never under the floor), a wheeze is marked, labetalol is
 * not safe, or an infusion replaced the boluses; a bolus never takes the total over the maximum.
 */

/** The words, in the prototype's wording. No number lives here: every `{n}` comes from the seed. */
const W = HTN_COPY;

const num = z.number().finite();
const Phase = z.object({ id: z.string(), from: num, to: num.nullable() });
export const HtnSeed = z.object({
  phases: z.array(Phase).length(4),
  emergency: z.object({ sbpFrom: num, dbpFrom: num }),
  pulseUnder: num,
  target: z.object({
    aimFall: num,
    floorFall: num,
    firstMinutes: num,
    thenSbp: num,
    thenDbp: num,
    thenFromH: num,
    thenByH: num,
  }),
  dissection: z.object({ sbpUnder: num, withinMinutes: num, pulseUnder: num }),
  pregnancy: z.object({ sbpFrom: num, sbpTo: num, dbpFrom: num, dbpTo: num }),
  boluses: z.object({
    mg: z.array(num).min(1),
    everyMinutes: num,
    overMinutes: num,
    maxTotalMg: num,
  }),
  infusion: z.object({ mgMin: z.array(num).min(1), mgPerMl: num }),
  controlled: z.object({
    sbpAtMost: num,
    dbpAtMost: num,
    afterMinutes: num,
    thenEveryMinutes: num,
    thenHours: num,
  }),
  refs: z.record(z.string(), z.unknown()),
});
export type HtnSeed = z.infer<typeof HtnSeed>;

const htn: RuleModule = {
  id: "htn",
  short: () => W.short,
  check: (v: ChartVersion) =>
    (v.rules as { module?: string | null } | null)?.module === "htn" &&
    HtnSeed.safeParse(v.seed).success &&
    QuickRules.safeParse(v.rules).success
      ? null
      : W.seedMissing,
  build: (K) => buildHtn(K),
};
export default htn;

const flag = (lvl: Interp["lvl"], word: string): Interp => ({ lvl, word, text: "", ref: "" });
const pct = (x: number) => Math.round(x * 100);
/** Mean arterial pressure: (systolic + 2 × diastolic) / 3, §2.4. */
export const mapOf = (s: number | null, d: number | null) =>
  s !== null && d !== null && !Number.isNaN(s) && !Number.isNaN(d)
    ? Math.round((s + 2 * d) / 3)
    : null;

export function buildHtn(K: Kit): Built {
  const S = HtnSeed.parse(K.version.seed);
  const rules = QuickRules.parse(K.version.rules);
  const { v, T, c, facts: p, now, hNow, hh, L, A, btn, st, mark, give, fld, it, row, br, crit } = K;
  const { val, latest, lastObs, ptsOf, many, gv, lbl } = K;
  const E = S.emergency;
  const TG = S.target;
  const B = S.boluses;
  const IN = S.infusion;
  const CT = S.controlled;
  const PU = S.pulseUnder;
  const slotOf = (min: number) => Math.round(min / K.slotMin);
  const minWord = (m: number) => lbl(m / K.slotMin);

  // ─── Assess ───
  const sbp0 = val("sbp");
  const dbp0 = val("dbp");
  const hr0 = val("pulse");
  const map0 = mapOf(sbp0, dbp0);
  const tod = many("tod").filter((x) => x !== W.noneFound);
  const todKnown = many("tod").length > 0;
  const high = (sbp0 !== null && sbp0 >= E.sbpFrom) || (dbp0 !== null && dbp0 >= E.dbpFrom);
  const emerg = high && tod.length > 0;
  const assessed = todKnown && sbp0 !== null;
  const a1 = A(
    {
      n: 1,
      title: W.a1,
      sub: fill(W.a1Sub, { s: E.sbpFrom, d: E.dbpFrom }),
      fields: [fld("sbp", W.sbp, "mmHg"), fld("dbp", W.dbp, "mmHg"), fld("pulse", W.pulse, "/min")],
      chipHead: W.todHead,
      chips: K.pickN("tod", W.todOpts),
      chipWho: "dr",
      branchHead: !assessed ? W.needsBp : W.thisPatient,
      branches: [
        br(W.brEmerg, W.brEmergText, emerg, assessed, true),
        br(W.brUrg, W.brUrgText, assessed && !emerg, assessed),
      ],
      btns: assessed && !emerg ? [btn(W.rxOral, { t: "rx" }, "dr"), K.endBtn(W.short)] : [],
    },
    st(emerg, false),
  );
  a1.brief =
    sbp0 !== null
      ? `${sbp0}/${dbp0 ?? "?"}` +
        (emerg
          ? fill(W.emergBrief, { list: tod.join(", ").toLowerCase() })
          : todKnown
            ? W.noDamage
            : "")
      : W.needsBpBrief;

  const ci = [
    ...many("ci").filter((x) => x !== W.ciNone),
    ...(hr0 !== null && hr0 < PU ? [fill(W.heartRate, { v: hr0 })] : []),
  ];
  const a2 = A(
    {
      n: 2,
      title: W.a2,
      sub: W.a2Sub,
      chips: K.pickN("ci", W.ciOpts),
      chipWho: "dr",
      rows: [
        row(
          W.pulse,
          hr0 !== null ? fill(W.pulseRow, { v: hr0 }) + (hr0 < PU ? W.tooSlow : "") : W.notRecorded,
          hr0 !== null && hr0 < PU ? "warn" : undefined,
        ),
      ],
      lines: [
        ci.length
          ? L(fill(W.notSafe, { list: ci.join(", ") }), "alert")
          : many("ci").length
            ? L(W.safe, "ok")
            : L(W.checkEach, "warn"),
      ],
    },
    st(many("ci").length > 0 && !ci.length, ci.length > 0),
  );
  a2.brief = ci.length
    ? fill(W.notSafeBrief, { list: ci.join(", ") })
    : many("ci").length
      ? W.safeBrief
      : W.notChecked;

  const floor = map0 !== null ? Math.round(map0 * (1 - TG.floorFall)) : null;
  const goal = map0 !== null ? Math.round(map0 * (1 - TG.aimFall)) : null;
  const dissect = tod.includes(W.dissection);
  const stroke = tod.includes(W.stroke);
  const DS = S.dissection;
  const PG = S.pregnancy;
  const a3 = A(
    {
      n: 3,
      title: W.a3,
      sub: fill(W.a3Sub, {
        floor: pct(TG.floorFall),
        first: minWord(TG.firstMinutes),
        s: TG.thenSbp,
        d: TG.thenDbp,
        a: TG.thenFromH,
        b: TG.thenByH,
      }),
      rows: [
        row(W.mapNow, map0 !== null ? fill(W.mapNowV, { m: map0, s: sbp0!, d: dbp0! }) : W.needsSd),
        row(
          W.firstAim,
          goal !== null
            ? fill(W.firstAimV, {
                aim: goal,
                a: pct(TG.aimFall),
                floor: floor!,
                f: pct(TG.floorFall),
              })
            : "—",
          "strong",
        ),
        row(
          W.then,
          fill(W.thenV, { s: TG.thenSbp, d: TG.thenDbp, a: TG.thenFromH, b: TG.thenByH }),
        ),
      ],
      lines: [
        ...(dissect
          ? [
              L(
                fill(W.dissectLine, { s: DS.sbpUnder, min: DS.withinMinutes, p: DS.pulseUnder }),
                "alert",
              ),
            ]
          : []),
        ...(stroke ? [L(W.strokeLine, "warn")] : []),
        ...(p.pregnant
          ? [
              L(
                fill(W.pregLine, {
                  s1: PG.sbpFrom,
                  s2: PG.sbpTo,
                  d1: PG.dbpFrom,
                  d2: PG.dbpTo,
                }),
                "warn",
              ),
            ]
          : []),
      ],
    },
    st(map0 !== null, false),
  );
  a3.brief =
    goal !== null ? fill(W.targetBrief, { m: map0!, aim: goal, floor: floor! }) : W.needsBpBrief;

  // ─── Boluses ───
  const doseAt = (i: number) => B.mg[Math.min(i, B.mg.length - 1)]!;
  const given = gv("lab");
  const tot = given.reduce((a, _, i) => a + doseAt(i), 0);
  const nextD = Math.min(doseAt(given.length), B.maxTotalMg - tot);
  const sL = latest("sbp");
  const dL = latest("dbp");
  const mL = mapOf(sL, dL);
  const hrL = latest("pulse");
  const bpObs = lastObs("sbp");
  const lastG = given.length ? given[given.length - 1]! : null;
  const nextAt = lastG ? lastG + B.everyMinutes * 60000 : c.start;
  const tooLow = mL !== null && floor !== null && mL < floor;
  const atGoal = mL !== null && goal !== null && mL <= goal;
  const slow = hrL !== null && hrL < PU;
  const wz = v.wz === "Yes";
  // P6: held at a slow pulse, at or under the aim (so under the floor), with a wheeze, when not
  // safe, after a switch to an infusion or a stop; never over the maximum total.
  const canGive =
    emerg && !ci.length && !atGoal && !slow && !wz && tot < B.maxTotalMg && !T.inf && !T.stopB;
  const giveBtn = btn(fill(W.giveBtn, { mg: nextD }), give("lab"), "rn", "main");
  const b1 = A(
    {
      n: 1,
      title: W.b1,
      sub: fill(W.b1Sub, {
        over: B.overMinutes,
        doses: B.mg.join(", "),
        every: B.everyMinutes,
        max: B.maxTotalMg,
        i1: IN.mgMin[0]!,
        i2: IN.mgMin[IN.mgMin.length - 1]!,
      }),
      rows: [
        row(
          W.given,
          given.length
            ? given.map((t, i) => fill(W.givenAt, { mg: doseAt(i), t: hh(t) })).join(" · ")
            : W.noneYet,
        ),
        row(
          W.total,
          fill(W.totalV, { n: tot, max: B.maxTotalMg }),
          tot >= B.maxTotalMg ? "warn" : undefined,
        ),
        row(
          W.bpNow,
          sL !== null
            ? fill(W.bpNowV, { s: sL, d: dL ?? "?", m: mL ?? "?" }) +
                (bpObs ? ` · ${lbl(bpObs.h)}` : "")
            : W.noReading,
        ),
      ],
      btns: [
        ...K.ivBtn(),
        ...(canGive ? [now >= nextAt ? giveBtn : btn(giveBtn.word, giveBtn.act, "rn")] : []),
        ...(emerg && !ci.length && !T.inf ? [btn(W.infBtn, mark("inf"), "dr")] : []),
        ...(given.length && !T.stopB && !T.inf
          ? [btn(W.stopBtn, mark("stopB"), "dr", "link")]
          : []),
      ],
      lines: [
        tooLow
          ? L(fill(W.tooLow, { m: mL!, floor: floor! }), "alert")
          : slow
            ? L(fill(W.slow, { v: hrL!, n: PU }), "alert")
            : wz
              ? L(W.wheeze, "alert")
              : atGoal
                ? L(fill(W.atGoal, { n: K.slotMin }), "ok")
                : tot >= B.maxTotalMg
                  ? L(fill(W.maxed, { max: B.maxTotalMg }), "alert")
                  : canGive
                    ? L(
                        now >= nextAt
                          ? fill(W.nextNow, { mg: nextD })
                          : fill(W.nextAt, { mg: nextD, t: hh(nextAt) }),
                        "warn",
                      )
                    : L(W.waiting),
        ...(K.hasLine ? [] : [K.ivLine()]),
      ],
    },
    st(atGoal || !!T.inf || !!T.stopB, tooLow || slow || wz || (canGive && now >= nextAt)),
  );
  b1.brief = given.length
    ? (given.length === 1
        ? fill(W.doseBrief, { mg: tot })
        : fill(W.dosesBrief, { n: given.length, mg: tot })) + (atGoal ? W.atAim : "")
    : W.noneYet;

  const bpPts = ptsOf("sbp");
  const missed = Array.from({ length: Math.min(hNow, K.NS) }, (_, i) => i + 1).filter(
    (h) => !K.obs.some((o) => o.h === h && o.values.sbp !== undefined && o.values.sbp !== ""),
  ).length;
  const wzBtn = (word: string) => btn(word, K.set("wz", wz ? "" : "Yes"), "rn", "link");
  const b2 = A(
    {
      n: 2,
      title: W.b2,
      sub: fill(W.b2Sub, { n: K.slotMin, m: CT.thenEveryMinutes }),
      items: [
        it(
          W.hFast,
          fill(W.hFastSub, { floor: floor ?? "—" }),
          tooLow ? W.hFastYes : W.no,
          tooLow ? "alert" : "na",
        ),
        it(W.hSlow, fill(W.hSlowSub, { n: PU }), slow ? W.hSlowYes : W.no, slow ? "alert" : "na"),
        it(W.hWz, W.hWzSub, wz ? W.hWzYes : W.no, wz ? "alert" : "na", [
          wzBtn(wz ? W.clear : W.markPresent),
        ]),
        it(
          W.hMissed,
          fill(W.hMissedSub, { n: K.slotMin }),
          String(missed),
          missed ? "alert" : "done",
        ),
      ],
    },
    st(!tooLow && !slow && !wz && bpPts.length > 2, tooLow || slow || wz || missed > 0),
  );
  b2.brief = tooLow
    ? W.harmFast
    : slow
      ? W.harmSlow
      : missed
        ? fill(W.harmMissed, { n: missed })
        : W.harmNone;

  // ─── Continue ───
  const rates = IN.mgMin.map((n) => fill(W.mgMin, { n }));
  const infR = v.infR && rates.includes(v.infR) ? v.infR : rates[0]!;
  const infMg = IN.mgMin[rates.indexOf(infR)]!;
  const infMl = Math.round((infMg * 60) / IN.mgPerMl);
  const c1 = A(
    {
      n: 1,
      title: W.c1,
      sub: fill(W.c1Sub, {
        c: IN.mgPerMl,
        a: IN.mgMin[0]!,
        b: IN.mgMin[IN.mgMin.length - 1]!,
      }),
      chips: T.inf ? K.pick1("infR", rates) : [],
      chipWho: "dr",
      rows: T.inf
        ? [row(W.rate, fill(W.rateV, { r: infR, ml: infMl, c: IN.mgPerMl }))]
        : [row(W.statusRow, W.notChosen)],
      btns:
        T.inf && !T.infAt
          ? [btn(W.infAtBtn, mark("infAt"), "rn", "main")]
          : T.infAt && !T.infStop
            ? [btn(W.infStopBtn, mark("infStop"), "dr")]
            : [],
      lines: T.infAt
        ? [
            L(
              fill(W.running, {
                t: hh(T.infAt),
                stop: T.infStop ? fill(W.stoppedAt, { t: hh(T.infStop) }) : "",
              }),
              "ok",
            ),
          ]
        : [],
    },
    st(!T.inf || !!T.infAt, false),
  );
  c1.brief = T.infAt
    ? T.infStop
      ? fill(W.stoppedBrief, { t: hh(T.infStop) })
      : infR
    : T.inf
      ? W.chosenNot
      : W.notUsed;

  const c2 = A(
    {
      n: 2,
      title: W.c2,
      sub: W.c2Sub,
      btns: [
        ...(T.oral ? [] : [btn(W.oralBtn, mark("oral"), "dr", "main")]),
        btn(W.openRx, { t: "rx" }, "dr", "link"),
      ],
      lines: T.oral ? [L(fill(W.oralAt, { t: hh(T.oral) }), "ok")] : [],
    },
    st(!!T.oral, false),
  );
  c2.brief = T.oral ? fill(W.oralAt, { t: hh(T.oral) }) : W.notYet;

  // ─── Controlled ───
  const ok160 = sL !== null && dL !== null && sL <= CT.sbpAtMost && dL <= CT.dbpAtMost;
  const doneH = slotOf(CT.afterMinutes);
  const done = ok160 && hNow >= doneH;
  const e1 = A(
    {
      n: 1,
      title: W.e1,
      sub: fill(W.e1Sub, { s: CT.sbpAtMost, d: CT.dbpAtMost, t: minWord(CT.afterMinutes) }),
      crit: [
        crit(
          fill(W.cBp, { s: CT.sbpAtMost, d: CT.dbpAtMost }),
          sL !== null ? `${sL}/${dL ?? "?"}` : W.noReadingW,
          ok160,
          sL !== null,
        ),
        crit(fill(W.cTime, { t: minWord(CT.afterMinutes) }), lbl(hNow), hNow >= doneH, true),
      ],
      btns: done ? [K.endBtn(W.short)] : [],
      lines: [L(fill(W.handOver, { n: CT.thenEveryMinutes, h: CT.thenHours }))],
    },
    st(done, false),
  );
  e1.brief = done ? W.e1 : W.notYet;

  const fresh = !!bpObs && now - bpObs.at < K.SL;
  const r1 = A(
    {
      n: 1,
      head: W.check,
      title: W.rnTitle,
      items: [
        it(
          fill(W.rBp, { n: K.slotMin }),
          sL !== null ? fill(W.rBpV, { s: sL, d: dL ?? "?", p: hrL ?? "?" }) : W.noReading,
          fresh ? W.yes : W.recordNow,
          fresh ? "done" : "alert",
        ),
        it(
          fill(W.rPulse, { n: PU }),
          hrL !== null ? String(hrL) : "—",
          slow ? W.hold : W.yes,
          slow ? "alert" : "done",
        ),
        it(W.rWz, "", wz ? W.wzHold : W.yes, wz ? "alert" : "done", [
          wzBtn(wz ? W.clear : W.wzBtn),
        ]),
      ],
    },
    st(!slow && !wz, slow || wz),
  );

  // ─── Nurse tasks ───
  const tasks: [string, string, string, number, Btn[]][] = [];
  if (canGive)
    tasks.push([
      `lab${given.length}`,
      fill(W.tGive, { mg: nextD, over: B.overMinutes }),
      fill(W.tGiveSub, { n: tot }),
      nextAt,
      [giveBtn],
    ]);
  if (T.inf && !T.infAt)
    tasks.push([
      "infAt",
      fill(W.tInf, { r: infR }),
      fill(W.tInfSub, { ml: infMl, c: IN.mgPerMl }),
      T.inf,
      [btn(W.infAtBtn, mark("infAt"), "rn", "main")],
    ]);
  if (tooLow) tasks.push(["low", W.tLow, fill(W.mapNote, { m: mL! }), now, []]);

  const mapPts = ptsOf("map");
  const PH = S.phases;
  const titles = [W.ph1, W.ph2, W.ph3, W.ph4];
  const acts: Step[][] = [[a1, a2, a3], [b1, b2], [c1, c2], [e1]];
  const supply = supplyOf(rules, {
    ageYears: p.ageYears,
    sex: p.sex,
    weightKg: p.weightKg,
    pregnant: p.pregnant,
  });
  const ciKnown = many("ci").length > 0 || ci.length > 0;

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
      F.D("assess1", fill(W.fEmerg, { s: E.sbpFrom, d: E.dbpFrom }), [
        F.Br(W.yes, W.fIv, assessed ? emerg : null),
        F.Br(W.no, W.fTablets, assessed ? !emerg : null),
      ]),
      F.D("assess2", W.fSafe, [
        F.Br(W.yes, W.fContinue, ciKnown ? !ci.length : null),
        F.Br(W.no, W.fOther, ciKnown ? ci.length > 0 : null),
      ]),
      F.N("assess3", fill(W.fTarget, { a: pct(TG.aimFall), f: pct(TG.floorFall) })),
      F.P(PH[1]!.id),
      F.D(
        "bolus1",
        W.fAbove,
        [
          F.Br(W.yes, fill(W.fNext, { doses: B.mg.join(" → ") }), mL !== null ? !atGoal : null),
          F.Br(W.no, W.fStop, mL !== null ? atGoal : null),
        ],
        mL !== null ? fill(W.mapNote, { m: mL }) : "",
      ),
      F.N("bolus2", W.fWatch),
      F.P(PH[2]!.id),
      F.N("cont1", W.fInf),
      F.N("cont2", W.fTabs),
      F.P(PH[3]!.id),
      F.N("end1", fill(W.fControlled, { s: CT.sbpAtMost, d: CT.dbpAtMost })),
    ],
    tasks: (add) => tasks.forEach(([key, title, sub, at, b]) => add(key, title, sub, at, b)),
    rows: [
      ["sbp", W.gSbp],
      ["dbp", W.gDbp],
      ["map", W.gMap],
      ["pulse", W.gPulse],
    ],
    cellFlag: (key, x) => {
      const n = parseFloat(x);
      if (Number.isNaN(n)) return null;
      if (key === "sbp")
        return n >= E.sbpFrom
          ? flag("crit", W.severe)
          : n > CT.sbpAtMost
            ? flag("abn", W.high)
            : K.interp(key, x);
      if (key === "map")
        return floor !== null && n < floor
          ? flag("crit", W.underFloor)
          : goal !== null && n <= goal
            ? flag("ok", W.atAimW)
            : null;
      if (key === "pulse" && n < PU) return flag("abn", W.slowW);
      return K.interp(key, x);
    },
    dueAt: (key) => ["sbp", "dbp", "pulse"].includes(key),
    form: [
      { key: "sbp", label: W.gSbp, unit: "mmHg", dflt: "" },
      { key: "dbp", label: W.gDbp, unit: "mmHg", dflt: "" },
      { key: "pulse", label: W.gPulse, unit: "/min", dflt: "" },
    ],
    formReq: ["sbp"],
    labKeys: [],
    derive: (o): Record<string, string> => {
      const m = mapOf(parseFloat(o.sbp ?? ""), parseFloat(o.dbp ?? ""));
      return m !== null ? { map: String(m) } : {};
    },
    recWhat: () => W.recWhat,
    recHint: () => fill(W.recHint, { n: K.slotMin }),
    panels: [
      {
        key: "sbp",
        name: W.pSbp,
        unit: "mmHg",
        min: 100,
        max: 240,
        ticks: [120, 160, 200, 240],
        thr: [
          [TG.thenSbp, fill(W.thrThen, { n: TG.thenSbp, a: TG.thenFromH, b: TG.thenByH }), "grn"],
        ],
        bad: (x) => x >= E.sbpFrom,
      },
      {
        key: "map",
        name: W.pMap,
        unit: "mmHg",
        min: 70,
        max: 180,
        ticks: [80, 120, 160],
        thr:
          floor !== null && goal !== null
            ? [
                [floor, fill(W.thrFloor, { n: floor, f: pct(TG.floorFall) }), "amb"],
                [goal, fill(W.thrAim, { n: goal, a: pct(TG.aimFall) }), "grn"],
              ]
            : [],
        status: mL === null ? W.noReading : tooLow ? W.tooLowW : atGoal ? W.atAimW : W.aboveAim,
        stLvl: mL === null ? "" : tooLow ? "no" : atGoal ? "ok" : "",
        bad: (x) => floor !== null && x < floor,
      },
      {
        key: "pulse",
        name: W.pPulse,
        unit: "/min",
        min: 40,
        max: 130,
        ticks: [60, 100],
        thr: [[PU, fill(W.thrHold, { n: PU }), "amb"]],
        bad: (x) => x < PU,
      },
    ],
    stats: [
      {
        k: W.bpNow,
        v: sL !== null ? `${sL}/${dL ?? "?"}` : "—",
        s: bpObs ? lbl(bpObs.h) : W.baseline,
      },
      {
        k: W.sMap,
        v: mL !== null ? String(mL) : "—",
        s: goal !== null ? fill(W.sMapS, { aim: goal, floor: floor! }) : "",
        ...(tooLow ? { cls: "warn" as const } : atGoal ? { cls: "ok" as const } : {}),
      },
      {
        k: W.sLab,
        v: fill(W.sLabV, { n: tot }),
        s: fill(W.sLabS, { n: given.length, max: B.maxTotalMg }),
        ...(tot >= B.maxTotalMg ? { cls: "warn" as const } : {}),
      },
      {
        k: W.pulse,
        v: hrL !== null ? String(hrL) : "—",
        s: fill(W.sPulseS, { n: PU }),
        ...(slow ? { cls: "warn" as const } : {}),
      },
      {
        k: W.sControlled,
        v: done ? W.yes : W.notYet,
        s: fill(W.sControlledS, { s: CT.sbpAtMost, d: CT.dbpAtMost }),
        ...(done ? { cls: "ok" as const } : {}),
      },
    ],
    aims: [
      {
        word: fill(W.aim1, {
          a: pct(TG.aimFall),
          f: pct(TG.floorFall),
          t: minWord(TG.firstMinutes),
        }),
        ok: atGoal && !tooLow,
        known: mL !== null && hNow >= 1,
      },
      {
        word: fill(W.aim2, { f: pct(TG.floorFall) }),
        ok: !mapPts.some((x) => floor !== null && x.v < floor),
        known: mapPts.length > 0,
      },
      {
        word: fill(W.aim3, { s: TG.thenSbp, d: TG.thenDbp, a: TG.thenFromH, b: TG.thenByH }),
        ok: sL !== null && dL !== null && sL <= TG.thenSbp && dL <= TG.thenDbp,
        known: hNow >= slotOf(TG.thenFromH * 60),
      },
    ],
    meds: supply.map((s) => ({ drug: s.drug, qty: s.qty ?? 0, why: s.doseText })),
    medsNote: W.medsNote,
    phRows: [
      row(
        W.phLab,
        T.inf
          ? fill(W.phInfV, { n: tot, max: B.maxTotalMg, r: infR, mgh: infMg * 60 })
          : fill(W.phLabV, { n: tot, max: B.maxTotalMg }),
      ),
      row(W.phOral, T.oral ? fill(W.phOralV, { t: hh(T.oral) }) : W.notYet),
    ],
    logWords: W.log,
  };
}
