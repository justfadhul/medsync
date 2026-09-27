import type { CriticalRef } from "@/lib/emr/reference/critical";
import type { PlausibilityRef } from "@/lib/emr/reference/plausibility";
import type { Ack, ReportStatus, ReportVersion, ResultValue } from "@/lib/emr/results";
import type { RefEntry } from "@/lib/resus/reference/ref";
import { describe, expect, it } from "vitest";

import {
  CRITICAL_REF_INDEX,
  CRITICAL_REFS,
  REF_CRIT_TIMEFRAME,
} from "@/lib/emr/reference/critical";
import { checkPlausibility, PLAUSIBILITY_REFS } from "@/lib/emr/reference/plausibility";
import {
  ackState,
  canTransitionReport,
  currentVersion,
  detectCritical,
  escalationState,
  interpretResult,
  isInterpretable,
  labFlag,
  readLabContext,
  resultTrust,
} from "@/lib/emr/results";
import { CONCEPTS } from "@/lib/facts/catalogue.generated";

/**
 * lib/emr/results.ts + reference/{critical,plausibility}.ts. Every threshold below is a
 * TEST-ONLY fixture (absurd on purpose) that proves a mechanism; no real clinical number exists
 * in the repo, and the shipped entries are all pending_cso.
 */

const t = (min: number) => new Date(Date.UTC(2026, 8, 26, 8, 0) + min * 60_000);

const v = (over: Partial<ResultValue> = {}): ResultValue => ({
  conceptId: "obs.potassium",
  valueNum: "5",
  valueComparator: null,
  valueUnit: "mmol/L",
  valueCanonical: "5",
  context: {},
  ...over,
});
const range = (low: number | undefined, high: number | undefined, unit = "mmol/L") => ({
  referenceRange: { low, high, unit, source: "lab" },
});

const TEST_SIGNED = { status: "signed" as const, confidence: "design" as const };
const crit = (id: string, operator: CriticalRef["operator"], value: string): CriticalRef => ({
  id,
  text: "TEST-ONLY",
  value,
  unit: "mmol/L",
  source: "TEST",
  url: "test",
  verifiedOn: "2026-09-26",
  ...TEST_SIGNED,
  conceptId: "obs.potassium",
  operator,
});
const LOW = crit("TEST-CRIT-LOW", "<", "100");
const HIGH = crit("TEST-CRIT-HIGH", ">", "200");

const rep = (id: string, version: number, status: ReportStatus, at: number): ReportVersion => ({
  id,
  logicalId: "L1",
  version,
  status,
  recordedAt: t(at),
});
const ack = (
  reportId: string,
  action: string,
  at: number,
  forwardedToUserId: string | null = null,
): Ack => ({
  reportId,
  action,
  acknowledgedByUserId: "dr-1",
  forwardedToUserId,
  recordedAt: t(at),
});

describe("report status transitions", () => {
  it.each<[ReportStatus | null, ReportStatus, boolean]>([
    [null, "preliminary", true],
    [null, "final", true],
    [null, "amended", false],
    [null, "entered_in_error", false],
    ["preliminary", "preliminary", true],
    ["preliminary", "final", true],
    ["preliminary", "cancelled", true],
    ["preliminary", "amended", false],
    ["final", "amended", true],
    ["final", "corrected", true],
    ["final", "entered_in_error", true],
    ["final", "preliminary", false],
    ["final", "cancelled", false],
    ["amended", "amended", true],
    ["corrected", "amended", true],
    ["cancelled", "final", false],
    ["entered_in_error", "final", false],
  ])("%s → %s is %s", (from, to, ok) => {
    expect(canTransitionReport(from, to)).toBe(ok);
  });

  it("current version is the highest version; recorded time breaks a tie", () => {
    expect(currentVersion([rep("a", 1, "final", 0), rep("b", 2, "amended", 5)])?.id).toBe("b");
    expect(currentVersion([rep("b", 2, "amended", 9), rep("c", 2, "amended", 3)])?.id).toBe("b");
    expect(currentVersion([])).toBeNull();
  });
});

describe("trust (D-EMR-08)", () => {
  const r = (
    entryMode: string,
    status: string,
    source = "lab",
    verifiedByUserId: string | null = null,
  ) => resultTrust({ entryMode, status, source, verifiedByUserId });
  it("direct final is T4, direct preliminary T3", () => {
    expect(r("direct", "final")).toBe(4);
    expect(r("direct", "preliminary")).toBe(3);
  });
  it("interface is T4", () => expect(r("interface", "preliminary")).toBe(4));
  it("transcription is T3 until lab staff verify it", () => {
    expect(r("transcribed", "final", "clinician")).toBe(3);
    expect(r("transcribed", "final", "clinician", "lab-1")).toBe(4);
  });
  it("point of care by staff is T3", () => expect(r("direct", "final", "poc_staff")).toBe(3));
});

describe("lab context", () => {
  it("ignores a MedSync range: MedSync never supplies one", () => {
    expect(
      readLabContext({ referenceRange: { low: 1, high: 2, unit: "x", source: "medsync" } })
        .referenceRange,
    ).toBeNull();
  });
  it("ignores a malformed range and an unknown interpretation", () => {
    const c = readLabContext({
      referenceRange: { low: 5, high: 1, unit: "x", source: "lab" },
      labInterpretation: "Q",
    });
    expect(c).toEqual({ referenceRange: null, labInterpretation: null });
  });
  it("tolerates a non-object context", () => {
    expect(readLabContext(null)).toEqual({ referenceRange: null, labInterpretation: null });
    expect(readLabContext("x")).toEqual({ referenceRange: null, labInterpretation: null });
  });
});

describe("abnormal flag from the laboratory's own range", () => {
  it("no range and no lab flag → no flag (never a MedSync range)", () => {
    expect(labFlag(v())).toEqual({ flag: null, basis: "no_range", text: null });
  });
  it("below the lab's low → L", () =>
    expect(labFlag(v({ valueNum: "2", context: range(3, 6) })).flag).toBe("L"));
  it("above the lab's high → H", () => {
    const f = labFlag(v({ valueNum: "7", context: range(3, 6) }));
    expect(f).toEqual({ flag: "H", basis: "lab_range", text: "High (laboratory range)" });
  });
  it("inside, and on the boundary → N", () => {
    expect(labFlag(v({ valueNum: "4", context: range(3, 6) })).flag).toBe("N");
    expect(labFlag(v({ valueNum: "3", context: range(3, 6) })).flag).toBe("N");
    expect(labFlag(v({ valueNum: "6", context: range(3, 6) })).flag).toBe("N");
  });
  it("a one-sided range flags only its side", () => {
    expect(labFlag(v({ valueNum: "1", context: range(undefined, 6) })).flag).toBe("N");
    expect(labFlag(v({ valueNum: "9", context: range(undefined, 6) })).flag).toBe("H");
  });
  it("the lab's interpretation takes precedence over the range", () => {
    const f = labFlag(v({ valueNum: "4", context: { ...range(3, 6), labInterpretation: "H" } }));
    expect(f).toEqual({ flag: "H", basis: "lab_interpretation", text: "Lab flag: high" });
  });
  it("comparator entirely below the low → L", () => {
    expect(labFlag(v({ valueNum: "0.5", valueComparator: "<", context: range(1, 6) })).flag).toBe(
      "L",
    );
    expect(labFlag(v({ valueNum: "1", valueComparator: "<", context: range(1, 6) })).flag).toBe(
      "L",
    );
  });
  it("comparator straddling a limit → no flag (indeterminate)", () => {
    expect(labFlag(v({ valueNum: "2", valueComparator: "<", context: range(1, 6) })).basis).toBe(
      "indeterminate",
    );
    expect(labFlag(v({ valueNum: "1", valueComparator: "<=", context: range(1, 6) })).basis).toBe(
      "indeterminate",
    );
  });
  it("> above the high → H; < under a high-only range → N", () => {
    expect(labFlag(v({ valueNum: "100", valueComparator: ">", context: range(1, 50) })).flag).toBe(
      "H",
    );
    expect(
      labFlag(v({ valueNum: "0.5", valueComparator: "<", context: range(undefined, 5) })).flag,
    ).toBe("N");
  });
  it("a range in another unit is not compared", () => {
    expect(labFlag(v({ valueNum: "2", context: range(3, 6, "mg/dL") })).basis).toBe(
      "unit_mismatch",
    );
  });
  it("no number or an unknown comparator → not numeric", () => {
    expect(labFlag(v({ valueNum: null, context: range(3, 6) })).basis).toBe("not_numeric");
    expect(labFlag(v({ valueComparator: "~", context: range(3, 6) })).basis).toBe("not_numeric");
  });
});

describe("critical detection (signed entries only)", () => {
  it("every shipped REF-CRIT entry is pending with its value withheld", () => {
    expect(CRITICAL_REFS.length).toBeGreaterThan(0);
    for (const r of [...CRITICAL_REFS, REF_CRIT_TIMEFRAME]) {
      expect(r.status).toBe("pending_cso");
      expect(r.value).toBeUndefined();
    }
    expect(Object.keys(CRITICAL_REF_INDEX)).toContain("REF-CRIT-TIMEFRAME");
  });
  it("each draft entry names a catalogued concept and carries its canonical unit", () => {
    for (const r of CRITICAL_REFS) expect(r.unit).toBe(CONCEPTS[r.conceptId].canonicalUnit);
  });
  it("with nothing signed, no value is critical, however extreme", () => {
    for (const x of ["-1000", "0", "1e9"])
      expect(detectCritical(v({ valueNum: x, valueCanonical: x }))).toEqual({
        isCritical: false,
        ruleId: null,
        basis: "no_signed_entry",
      });
  });
  it("with nothing signed, the lab's own critical flag is surfaced as text only", () => {
    const r = interpretResult(v({ valueCanonical: "1", context: { labInterpretation: "LL" } }));
    expect(r.critical.isCritical).toBe(false);
    expect(r.flag.text).toContain("Lab flag: critical");
  });
  it("a signed low entry marks a value below it critical", () => {
    expect(detectCritical(v({ valueCanonical: "50" }), [LOW, HIGH])).toEqual({
      isCritical: true,
      ruleId: "TEST-CRIT-LOW",
      basis: "critical",
    });
    expect(detectCritical(v({ valueCanonical: "250" }), [LOW, HIGH]).ruleId).toBe("TEST-CRIT-HIGH");
  });
  it("between the signed limits → not critical", () => {
    expect(detectCritical(v({ valueCanonical: "150" }), [LOW, HIGH]).basis).toBe("not_critical");
  });
  it("the signed operator decides the boundary", () => {
    expect(detectCritical(v({ valueCanonical: "100" }), [LOW]).isCritical).toBe(false);
    expect(detectCritical(v({ valueCanonical: "100" }), [crit("T", "<=", "100")]).isCritical).toBe(
      true,
    );
  });
  it("compares the canonical value, not the value as reported", () => {
    expect(detectCritical(v({ valueNum: "50", valueCanonical: "150" }), [LOW]).isCritical).toBe(
      false,
    );
  });
  it("a comparator wholly past the limit is critical; one straddling it is indeterminate", () => {
    expect(
      detectCritical(v({ valueCanonical: "90", valueComparator: "<" }), [LOW]).isCritical,
    ).toBe(true);
    const r = detectCritical(v({ valueCanonical: "120", valueComparator: "<" }), [LOW]);
    expect(r).toEqual({ isCritical: false, ruleId: "TEST-CRIT-LOW", basis: "indeterminate" });
  });
  it("an entry for another concept, or a signed entry with no readable number, does not apply", () => {
    expect(detectCritical(v({ conceptId: "obs.sodium", valueCanonical: "1" }), [LOW]).basis).toBe(
      "no_signed_entry",
    );
    expect(detectCritical(v({ valueCanonical: "1" }), [crit("T", "<", "n/a")]).basis).toBe(
      "no_signed_entry",
    );
  });
  it("a pending entry is never applied, even when a value is present", () => {
    expect(
      detectCritical(v({ valueCanonical: "1" }), [{ ...LOW, status: "pending_cso" }]).isCritical,
    ).toBe(false);
  });
  it("no canonical value → not numeric", () => {
    expect(detectCritical(v({ valueCanonical: null }), [LOW]).basis).toBe("not_numeric");
  });
});

describe("uncatalogued results: displayable, never interpretable", () => {
  it("isInterpretable", () => {
    expect(isInterpretable("obs.potassium")).toBe(true);
    expect(isInterpretable("obs.uncatalogued")).toBe(false);
    expect(isInterpretable(null)).toBe(false);
    expect(isInterpretable("obs.not_a_concept")).toBe(false);
    expect(isInterpretable("obs.potassium", true)).toBe(false);
  });
  it("no range flag and no critical, even under a signed entry; the lab's text is kept", () => {
    const r = interpretResult(
      v({
        conceptId: "obs.uncatalogued",
        valueCanonical: "1",
        context: { ...range(3, 6), labInterpretation: "A" },
      }),
      { criticalRefs: [LOW] },
    );
    expect(r.interpretable).toBe(false);
    expect(r.critical).toEqual({ isCritical: false, ruleId: null, basis: "not_interpretable" });
    expect(r.flag).toEqual({ flag: "A", basis: "lab_interpretation", text: "Lab flag: abnormal" });
  });
  it("a report marked uncatalogued is not interpreted even for a known concept", () => {
    const r = interpretResult(v({ valueNum: "1", context: range(3, 6) }), { uncatalogued: true });
    expect(r.flag.flag).toBeNull();
  });
});

describe("acknowledgement per version", () => {
  it("preliminary, unacknowledged → not released", () => {
    expect(ackState([rep("a", 1, "preliminary", 0)], [])).toEqual({ kind: "not_released" });
  });
  it("final, unacknowledged → needs review", () => {
    expect(ackState([rep("a", 1, "preliminary", 0), rep("b", 2, "final", 5)], []).kind).toBe(
      "needs_review",
    );
  });
  it.each(["seen", "acted"])("acknowledged: %s", (action) => {
    const s = ackState([rep("a", 1, "final", 0)], [ack("a", action, 3)]);
    expect(s).toMatchObject({ kind: "acknowledged", action, byUserId: "dr-1", at: t(3) });
  });
  it("forwarded names the colleague and stays open until seen or acted", () => {
    const s = ackState([rep("a", 1, "final", 0)], [ack("a", "forwarded", 3, "dr-2")]);
    expect(s).toMatchObject({ kind: "forwarded", toUserId: "dr-2" });
    const closed = ackState(
      [rep("a", 1, "final", 0)],
      [ack("a", "forwarded", 3, "dr-2"), ack("a", "seen", 5)],
    );
    expect(closed).toMatchObject({ kind: "acknowledged", action: "seen" });
  });
  it("the latest acknowledgement wins", () => {
    const s = ackState([rep("a", 1, "final", 0)], [ack("a", "acted", 9), ack("a", "seen", 3)]);
    expect(s).toMatchObject({ action: "acted" });
  });
  it.each<ReportStatus>(["amended", "corrected"])(
    "%s after an acknowledgement needs re-acknowledgement",
    (status) => {
      const chain = [rep("a", 1, "final", 0), rep("b", 2, status, 10)];
      expect(ackState(chain, [ack("a", "seen", 5)])).toEqual({
        kind: "needs_re_ack",
        previousAction: "seen",
      });
      expect(ackState(chain, [ack("a", "seen", 5), ack("b", "acted", 12)]).kind).toBe(
        "acknowledged",
      );
    },
  );
  it.each<ReportStatus>(["entered_in_error", "cancelled"])("%s → withdrawn", (status) => {
    expect(
      ackState([rep("a", 1, "final", 0), rep("b", 2, status, 1)], [ack("a", "seen", 0)]),
    ).toEqual({
      kind: "withdrawn",
      status,
    });
  });
  it("an acknowledgement of another report, or with an unknown action, does not count", () => {
    expect(
      ackState([rep("a", 1, "final", 0)], [ack("zz", "seen", 1), ack("a", "liked", 2)]).kind,
    ).toBe("needs_review");
  });
  it("an empty chain is a programming error", () => {
    expect(() => ackState([], [])).toThrow();
  });
});

describe("critical escalation", () => {
  const TF: RefEntry = { ...REF_CRIT_TIMEFRAME, ...TEST_SIGNED, value: "30" };
  const chain = [rep("a", 1, "final", 0)];
  it("not critical → not applicable", () => {
    expect(
      escalationState({ isCritical: false, chain, acks: [], now: t(999), timeframe: TF }).kind,
    ).toBe("not_applicable");
  });
  it("with the timeframe unsigned → timeframe_not_signed, never silently fine", () => {
    for (const now of [t(0), t(10_000)])
      expect(escalationState({ isCritical: true, chain, acks: [], now })).toEqual({
        kind: "timeframe_not_signed",
      });
  });
  it("acknowledged → no escalation", () => {
    expect(
      escalationState({
        isCritical: true,
        chain,
        acks: [ack("a", "seen", 1)],
        now: t(999),
        timeframe: TF,
      }).kind,
    ).toBe("acknowledged");
  });
  it("within a signed timeframe → due time; past it → escalate to the in-charge", () => {
    expect(
      escalationState({ isCritical: true, chain, acks: [], now: t(29), timeframe: TF }),
    ).toEqual({
      kind: "within_timeframe",
      dueAt: t(30),
    });
    expect(
      escalationState({ isCritical: true, chain, acks: [], now: t(30), timeframe: TF }),
    ).toEqual({
      kind: "escalate",
      to: "in_charge",
      dueAt: t(30),
    });
  });
  it("an amendment restarts the clock and needs a fresh acknowledgement", () => {
    const amended = [...chain, rep("b", 2, "amended", 100)];
    const s = escalationState({
      isCritical: true,
      chain: amended,
      acks: [ack("a", "seen", 1)],
      now: t(110),
      timeframe: TF,
    });
    expect(s).toEqual({ kind: "within_timeframe", dueAt: t(130) });
  });
  it("a signed timeframe in another unit is not applied", () => {
    expect(
      escalationState({
        isCritical: true,
        chain,
        acks: [],
        now: t(999),
        timeframe: { ...TF, unit: "h" },
      }).kind,
    ).toBe("timeframe_not_signed");
  });
  it("a withdrawn report → not applicable", () => {
    const eie = [...chain, rep("b", 2, "entered_in_error", 5)];
    expect(
      escalationState({ isCritical: true, chain: eie, acks: [], now: t(999), timeframe: TF }).kind,
    ).toBe("not_applicable");
  });
});

describe("plausibility bounds", () => {
  const quantity = Object.values(CONCEPTS).filter((c) => c.valueType === "quantity").length;
  const p = (bound: "soft" | "hard", side: "low" | "high", value?: string): PlausibilityRef => ({
    id: `TEST-PLAUS-${bound}-${side}`,
    text: "TEST-ONLY",
    ...(value === undefined ? {} : { value }),
    source: "TEST",
    url: "test",
    verifiedOn: "2026-09-26",
    confidence: "design",
    status: value === undefined ? "pending_cso" : "signed",
    conceptId: "obs.glucose",
    bound,
    side,
  });
  const SIGNED = [
    p("soft", "high", "100"),
    p("hard", "high", "200"),
    p("soft", "low", "10"),
    p("hard", "low", "1"),
  ];

  it("ships four pending entries per quantity concept, ids unique, no value", () => {
    expect(PLAUSIBILITY_REFS).toHaveLength(quantity * 4);
    expect(new Set(PLAUSIBILITY_REFS.map((r) => r.id)).size).toBe(PLAUSIBILITY_REFS.length);
    expect(
      PLAUSIBILITY_REFS.every((r) => r.status === "pending_cso" && r.value === undefined),
    ).toBe(true);
  });
  it("with nothing signed → unbounded (no bound applied)", () => {
    expect(checkPlausibility("obs.glucose", 1e9)).toEqual({ kind: "unbounded" });
  });
  it("past a signed soft bound → confirm", () => {
    expect(checkPlausibility("obs.glucose", 150, SIGNED)).toEqual({
      kind: "confirm",
      ruleId: "TEST-PLAUS-soft-high",
    });
    expect(checkPlausibility("obs.glucose", 5, SIGNED)).toEqual({
      kind: "confirm",
      ruleId: "TEST-PLAUS-soft-low",
    });
  });
  it("past a signed hard bound → reject (outranks the soft bound)", () => {
    expect(checkPlausibility("obs.glucose", 250, SIGNED)).toEqual({
      kind: "reject",
      ruleId: "TEST-PLAUS-hard-high",
    });
    expect(checkPlausibility("obs.glucose", 0.5, SIGNED)).toEqual({
      kind: "reject",
      ruleId: "TEST-PLAUS-hard-low",
    });
  });
  it("inside signed bounds → ok; another concept → unbounded", () => {
    expect(checkPlausibility("obs.glucose", 50, SIGNED)).toEqual({ kind: "ok" });
    expect(checkPlausibility("obs.sodium", 1e9, SIGNED)).toEqual({ kind: "unbounded" });
  });
  it("only the signed entries of a partly signed set apply", () => {
    const partial = [p("soft", "high"), p("hard", "high", "200")];
    expect(checkPlausibility("obs.glucose", 150, partial)).toEqual({ kind: "ok" });
    expect(checkPlausibility("obs.glucose", 250, partial).kind).toBe("reject");
  });
});
