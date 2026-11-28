/**
 * Closing the encounter, the pure rules (ADRs 0197, 0198, 0201, 0202): the Plan starts the close, Observe in EU is
 * not a closure, a changed outcome is recorded, an admission needs a ward and a bed or a reason, the follow-up
 * date, and the co-sign rule.
 */
import type { PlanDraft } from "@/lib/clerking/plan/draft";
import { describe, expect, it } from "vitest";

import {
  admissionNeedsCosign,
  closeBlocker,
  countsWords,
  dispositionDetail,
  EMPTY_CLOSE,
  euBlocker,
  euStart,
  followUpDate,
  MAX_STOPPED,
  planStart,
  startDraft,
  stoppedRxIds,
} from "@/lib/emr/closure";

const WARD = "00000000-0000-4000-8000-0000000000a1";
const RX = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const plan = (disposition: PlanDraft["disposition"]): PlanDraft => ({ disposition });

describe("planStart (ADR 0197 §1–2)", () => {
  it("maps the Plan's decision to the close's outcome", () => {
    expect(planStart(plan({ kind: "discharge" }))).toMatchObject({
      code: "home",
      said: "Discharge",
    });
    expect(planStart(plan({ kind: "admit", ward: "Ward 4B", wardId: WARD }))).toMatchObject({
      code: "admitted",
      wardId: WARD,
      said: "Admit · Ward 4B",
    });
    expect(planStart(plan({ kind: "refer", referTo: "Mulago" }))).toMatchObject({
      code: "referred_out",
      referTo: "Mulago",
      said: "Refer · Mulago",
    });
    expect(planStart(undefined)).toMatchObject({ code: null, observe: false, said: null });
  });

  it("Observe in EU is not a closure: no outcome, and the blocker says why", () => {
    const s = planStart(plan({ kind: "observe_eu" }));
    expect(s).toMatchObject({ code: null, observe: true });
    expect(closeBlocker(startDraft(s), { observe: true })).toMatch(
      /Observe in EU: the visit stays open/,
    );
  });
});

describe("Send to EU (the close's EU rules)", () => {
  it("planStart carries the Plan's emergency unit", () => {
    expect(planStart(plan({ kind: "observe_eu", ward: "OPD EU", wardId: WARD }))).toMatchObject({
      observe: true,
      code: null,
      euWardId: WARD,
      euWardName: "OPD EU",
      said: "Observe in EU · OPD EU",
    });
    expect(planStart(plan({ kind: "observe_eu" }))).toMatchObject({
      euWardId: null,
      said: "Observe in EU",
    });
  });

  it("euBlocker names what is missing", () => {
    const start = (d: PlanDraft["disposition"]) => euStart(planStart(plan(d)));
    expect(euBlocker(start({ kind: "observe_eu" }))).toBe("Choose the emergency unit.");
    const e = start({ kind: "observe_eu", ward: "OPD EU", wardId: WARD });
    expect(e.wardId).toBe(WARD);
    expect(euBlocker(e)).toBe("Choose a space, or say why the patient waits for one.");
    expect(euBlocker({ ...e, bedId: RX(1) })).toBeNull();
    expect(euBlocker({ ...e, waitReason: "floor" })).toBeNull();
    expect(euBlocker({ ...e, waitReason: "other" })).toBe("Say why the patient waits.");
    expect(euBlocker({ ...e, waitReason: "other", waitNote: "Theatre" })).toBeNull();
  });
});

describe("closeBlocker", () => {
  const admit = { ...EMPTY_CLOSE, code: "admitted" as const };
  it("an admission needs a ward, then a bed or a reason to wait (unless beds aren't tracked)", () => {
    expect(closeBlocker(admit)).toBe("Choose the ward.");
    expect(closeBlocker({ ...admit, wardId: WARD })).toMatch(/Choose a bed, or say why/);
    expect(closeBlocker({ ...admit, wardId: WARD }, { bedsLive: false })).toBeNull();
    expect(closeBlocker({ ...admit, wardId: WARD, bedId: RX(1) })).toBeNull();
    expect(closeBlocker({ ...admit, wardId: WARD, waitReason: "floor" })).toBeNull();
    expect(closeBlocker({ ...admit, wardId: WARD, waitReason: "other" })).toBe(
      "Say why the patient waits.",
    );
  });
  it("a referral needs a destination; a review date must be a date", () => {
    expect(closeBlocker({ ...EMPTY_CLOSE, code: "referred_out" })).toMatch(
      /where the patient is going/,
    );
    expect(
      closeBlocker({ ...EMPTY_CLOSE, code: "home", followUp: { kind: "review_date", date: "" } }),
    ).toBe("Choose the review date.");
    expect(
      closeBlocker({
        ...EMPTY_CLOSE,
        code: "home",
        stopRxIds: Array.from({ length: MAX_STOPPED + 1 }, (_, i) => RX(i)),
      }),
    ).toMatch(/at most/);
  });
});

describe("dispositionDetail (ADR 0197 §3–4)", () => {
  it("records the Plan's word only when the outcome changed", () => {
    const s = planStart(plan({ kind: "admit", ward: "Ward 4B", wardId: WARD }));
    expect(dispositionDetail({ ...EMPTY_CLOSE, code: "admitted" }, s)).toEqual({});
    expect(dispositionDetail({ ...EMPTY_CLOSE, code: "home" }, s)).toEqual({
      plan_said: "Admit · Ward 4B",
    });
  });
  it("carries the referral detail the printout reads, the stopped medicines and come-back words", () => {
    const none = planStart(undefined);
    expect(
      dispositionDetail(
        {
          ...EMPTY_CLOSE,
          code: "referred_out",
          destination: " Mulago ",
          reason: "Needs CT",
          urgency: "urgent",
          transport: "Ambulance",
        },
        none,
      ),
    ).toEqual({
      destination: "Mulago",
      reason: "Needs CT",
      urgency: "urgent",
      transport: "Ambulance",
    });
    const home = dispositionDetail(
      { ...EMPTY_CLOSE, code: "home", stopRxIds: [RX(1), RX(2)], comeBackIf: "fever returns" },
      none,
    );
    expect(home).toEqual({ stopped_rx: `${RX(1)},${RX(2)}`, come_back_if: "fever returns" });
    expect(stoppedRxIds(home)).toEqual([RX(1), RX(2)]);
    expect(stoppedRxIds({ stopped_rx: "x,../etc" })).toEqual([]);
    expect(dispositionDetail({ ...EMPTY_CLOSE, code: "died", comeBackIf: "x" }, none)).toEqual({});
  });
});

describe("follow-up and co-sign", () => {
  it("lands the interval on a calendar day", () => {
    expect(followUpDate("2026-10-03", "2w")).toBe("2026-10-17");
    expect(followUpDate("2026-12-28", "1w")).toBe("2027-01-04");
    expect(followUpDate("2026-10-03", "none")).toBeNull();
  });
  it("only 'allowed' skips the admission co-sign; no policy requests one (ADR 0201)", () => {
    expect(admissionNeedsCosign("allowed")).toBe(false);
    expect(admissionNeedsCosign("cosign_required")).toBe(true);
    expect(admissionNeedsCosign("blocked")).toBe(true);
    expect(admissionNeedsCosign(undefined)).toBe(true);
  });
  it("says the counts in words", () => {
    expect(countsWords({ free: 3, arriving: 1, occupied: 20, other: 2 })).toBe(
      "3 free · 1 arriving · 20 occupied",
    );
    expect(countsWords({ free: 0, arriving: 0, occupied: 4, other: 0 })).toBe(
      "0 free · 4 occupied",
    );
    expect(countsWords(null)).toBeNull();
  });
});
