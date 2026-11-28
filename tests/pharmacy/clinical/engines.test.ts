import type { Entry, Payload } from "@/lib/pharmacy/clinical/content";
import type { QueryFact } from "@/lib/pharmacy/clinical/interventions";
import { describe, expect, it } from "vitest";

import {
  cannotSend,
  planImport,
  signRefusal,
  statusAfterSigning,
} from "@/lib/pharmacy/clinical/content";
import {
  checkInteractions,
  currentMedicines,
  interactionsChecked,
  maskFor,
} from "@/lib/pharmacy/clinical/interactions";
import {
  checksWorthSigning,
  countsCsv,
  interventionReport,
  outcomeOf,
} from "@/lib/pharmacy/clinical/interventions";

/** Fixture content only: pairs, levels and windows are invented for the test and are not signed values. */
const now = new Date("2026-10-25T10:00:00Z");
const pair = (
  id: string,
  a: string,
  b: string,
  over: Partial<Payload<"interaction_pair">> = {},
  status: Entry["status"] = "in_force",
): Entry<"interaction_pair"> => ({
  id,
  pack: "interaction_pair",
  key: [a, b].sort().join("+"),
  version: 1,
  source: "Fixture source, s1",
  status,
  blocked: null,
  authorUserId: "u1",
  payload: {
    a,
    b,
    severity: "contraindicated",
    effect: "e",
    management: "m",
    byDesign: false,
    restricted: null,
    route: null,
    ...over,
  },
});
const levels: Payload<"alert_levels"> = {
  dialog: { contraindicated: "stop", serious: "note", monitor: "hidden" },
  review: { contraindicated: "stop", serious: "check", monitor: "note" },
  suppressionDays: 7,
};
const run = (
  entries: Entry<"interaction_pair">[],
  adding: string[],
  current: string[] = [],
  extra = {},
) =>
  checkInteractions({
    entries,
    levels,
    current: current.map((m) => ({ medicineId: m, source: "active_line" as const, since: now })),
    adding,
    mode: "dialog",
    earlier: [],
    now,
    ...extra,
  });

describe("IX: interactions", () => {
  const e = pair("e1", "drug_a", "drug_b");
  it("IX-3, IX-10: unordered, once, against current or added", () => {
    expect(run([e], ["drug_a"], ["drug_b"]).map((f) => f.entryId)).toEqual(["e1"]);
    expect(run([e], ["drug_b"], ["drug_a"]).map((f) => f.entryId)).toEqual(["e1"]);
    expect(run([e], ["drug_a", "drug_b"])).toHaveLength(1);
    expect(run([e], ["drug_a"], [])).toEqual([]);
  });
  it("S6, Law 3: draft, signed-not-in-force and withdrawn entries never fire", () => {
    for (const s of ["draft", "reviewer_signed", "withdrawn"] as const)
      expect(run([pair("x", "drug_a", "drug_b", {}, s)], ["drug_a"], ["drug_b"])).toEqual([]);
  });
  it("IX-4: no signed levels, nothing fires; hidden severities do not show in the dialog", () => {
    expect(
      checkInteractions({
        entries: [e],
        levels: null,
        current: [],
        adding: ["drug_a", "drug_b"],
        mode: "dialog",
        earlier: [],
        now,
      }),
    ).toEqual([]);
    expect(
      run([pair("m", "drug_a", "drug_b", { severity: "monitor" })], ["drug_a"], ["drug_b"]),
    ).toEqual([]);
  });
  it("IX-4a: a by-design pair is never above Note in the dialog", () => {
    expect(
      run([pair("d", "drug_a", "drug_b", { byDesign: true })], ["drug_a"], ["drug_b"])[0]!.level,
    ).toBe("note");
  });
  it("S7, IX-7: answered within the window returns at Note naming the answer; outside, at its level", () => {
    const earlier = [
      {
        entryId: "e1",
        key: e.key,
        answeredAt: new Date(now.getTime() - 3 * 86_400_000),
        cadre: "Medical officer",
        reason: "r",
      },
    ];
    expect(run([e], ["drug_a"], ["drug_b"], { earlier })[0]).toMatchObject({
      level: "note",
      suppressedBy: { reason: "r" },
    });
    const old = [{ ...earlier[0]!, answeredAt: new Date(now.getTime() - 8 * 86_400_000) }];
    expect(run([e], ["drug_a"], ["drug_b"], { earlier: old })[0]!.level).toBe("stop");
  });
  it("S5, IX-10: order of medicines never changes the fired set; add then remove restores it", () => {
    const es = [e, pair("e2", "drug_c", "drug_a"), pair("e3", "drug_b", "drug_c")];
    const base = run(es, ["drug_a", "drug_c"], ["drug_b"])
      .map((f) => f.entryId)
      .sort();
    expect(
      run(es, ["drug_c", "drug_a"], ["drug_b"])
        .map((f) => f.entryId)
        .sort(),
    ).toEqual(base);
    expect(run(es, ["drug_a"], ["drug_b"]).map((f) => f.entryId)).toEqual(
      run(es, ["drug_a"], ["drug_b"]).map((f) => f.entryId),
    );
  });
  it("IX-2, S18: supplied within the signed look-back counts; outside or unsigned, it does not", () => {
    const rows = [
      {
        medicineId: "drug_b",
        source: "supplied" as const,
        since: new Date(now.getTime() - 5 * 86_400_000),
      },
    ];
    const w = { chartedHours: 24, suppliedDays: 7, suppliedDaysByMedicine: {} };
    expect(currentMedicines(rows, w, now)).toHaveLength(1);
    expect(currentMedicines(rows, { ...w, suppliedDays: 3 }, now)).toHaveLength(0);
    expect(currentMedicines(rows, null, now)).toHaveLength(0);
  });
  it("IX-8: a restricted pair hides the medicine and the text from a viewer without the class", () => {
    const f = run(
      [pair("r", "drug_a", "drug_b", { restricted: "hiv" })],
      ["drug_a"],
      ["drug_b"],
    )[0]!;
    expect(maskFor(f, () => false)).toMatchObject({
      other: "restricted",
      effect: "",
      management: "",
    });
    expect(maskFor(f, () => true)).toEqual(f);
  });
  it("IX-9: none or partial, never complete", () => {
    expect(interactionsChecked([e], false, now)).toEqual({ state: "none" });
    expect(interactionsChecked([e], true, now)).toMatchObject({ state: "partial", pairs: 1 });
  });
});

describe("CC: content", () => {
  it("S13: no source, no sending; the author is not the only signer where another exists", () => {
    expect(
      cannotSend({ pack: "interaction_pair", source: null, blocked: null, payload: {} as never }),
    ).toBe("no_source");
    expect(
      signRefusal({
        authorUserId: "a",
        signerUserId: "a",
        alreadySigned: [],
        otherEligibleSigners: 1,
        exception: null,
      }),
    ).toBe("author_first");
    expect(
      signRefusal({
        authorUserId: "a",
        signerUserId: "a",
        alreadySigned: [],
        otherEligibleSigners: 0,
        exception: null,
      }),
    ).toBe("exception_needed");
    expect(
      signRefusal({
        authorUserId: "a",
        signerUserId: "a",
        alreadySigned: [],
        otherEligibleSigners: 0,
        exception: "CSO signs alone",
      }),
    ).toBeNull();
    // ADR 0550: the head of pharmacy signs alone, their own entry too, without writing an exception.
    expect(
      signRefusal({
        authorUserId: "a",
        signerUserId: "a",
        alreadySigned: [],
        otherEligibleSigners: 1,
        exception: null,
        head: true,
      }),
    ).toBeNull();
    expect(
      signRefusal({
        authorUserId: "b",
        signerUserId: "a",
        alreadySigned: ["a"],
        otherEligibleSigners: 1,
        exception: null,
        head: true,
      }),
    ).toBe("already_signed");
    expect(statusAfterSigning(1, false)).toBe("reviewer_signed");
    expect(statusAfterSigning(2, false)).toBe("in_force");
  });
  it("S12, S15, CC-3: exact match; classes wait; unknown is not matched; a second import skips", () => {
    const cands = [
      {
        id: "C1",
        a: "Rifampicin",
        b: "dolutegravir",
        aClass: null,
        bClass: null,
        severity: "serious",
        effect: "e",
        management: "m",
        sources: [{ id: "S1", where: "p1" }],
      },
      {
        id: "C2",
        a: "x",
        b: "y",
        aClass: "statins",
        bClass: null,
        severity: "monitor",
        effect: "e",
        management: "m",
        sources: [],
      },
      {
        id: "C3",
        a: "notalist",
        b: "rifampicin",
        aClass: null,
        bClass: null,
        severity: "contraindicated",
        effect: "e",
        management: "m",
        sources: [],
      },
    ];
    const meds = [
      { id: "rifampicin", generic: "Rifampicin" },
      { id: "dolutegravir", generic: "Dolutegravir" },
    ];
    const first = planImport(cands, meds, { S1: "Source one" }, new Set());
    expect(first.counts).toEqual({
      matched: 1,
      not_matched: 1,
      waits_for_class_map: 1,
      skipped: 0,
    });
    expect(first.drafts[0]!.source).toBe("Source one, p1");
    expect(planImport(cands, meds, {}, new Set(["C1", "C2", "C3"])).counts.skipped).toBe(3);
    expect(() => planImport([{ ...cands[0]!, severity: "bad" }], meds, {}, new Set())).toThrow();
  });
});

describe("IV: interventions", () => {
  const t = (h: number) => new Date(now.getTime() + h * 3_600_000);
  const qs: QueryFact[] = [
    {
      id: "q-1",
      typeCode: "allergy",
      ward: "Ward A",
      intent: "proposes_change",
      sentAt: t(0),
      closed: { kind: "answered", answer: "changed", at: t(1) },
    },
    {
      id: "q-2",
      typeCode: "allergy",
      ward: "Ward A",
      intent: "proposes_change",
      sentAt: t(0),
      closed: { kind: "answered", answer: "stopped", at: t(3) },
    },
    {
      id: "q-3",
      typeCode: "dose",
      ward: "Ward B",
      intent: "asks_question",
      sentAt: t(0),
      closed: { kind: "answered", answer: "keep", at: t(2) },
    },
    {
      id: "q-4",
      typeCode: "dose",
      ward: null,
      intent: "proposes_change",
      sentAt: t(0),
      closed: { kind: "withdrawn", at: t(1) },
    },
    {
      id: "q-5",
      typeCode: "dose",
      ward: "Ward B",
      intent: "proposes_change",
      sentAt: t(-1),
      closed: null,
    },
  ];
  it("S24: figures equal a hand count", () => {
    const r = interventionReport(qs, t(-24), t(24));
    expect(r.total).toMatchObject({
      sent: 5,
      answered: 3,
      changed: 1,
      stopped: 1,
      kept: 0,
      clarified: 1,
      withdrawn: 1,
      open: 1,
    });
    expect(r.byType.find((x) => x.key === "allergy")).toMatchObject({
      sent: 2,
      medianMinutes: 120,
    });
    expect(r.waiting).toEqual(["q-5"]);
    expect(outcomeOf(qs[2]!)).toBe("clarified");
  });
  it("S25: worth signing only at or above the signed minimum; nothing while unsigned", () => {
    const r = interventionReport(qs, t(-24), t(24));
    expect(checksWorthSigning(r.byType, null)).toEqual([]);
    expect(checksWorthSigning(r.byType, 2)).toEqual([{ key: "allergy", actedOn: 2 }]);
  });
  it("S27: the CSV holds counts only, no query ids", () => {
    const csv = countsCsv(qs);
    expect(csv.split("\n")[0]).toBe(
      "type,ward,month,sent,answered,changed,stopped,kept,clarified,withdrawn,open",
    );
    for (const q of qs) expect(csv).not.toMatch(new RegExp(`(^|,)${q.id}(,|$)`, "m"));
  });
});

describe("5.1 the notice (S22)", () => {
  it("with signed pairs, the interaction clause becomes the partial sentence; without, the text is unchanged", async () => {
    const { withSignedPairs } = await import("@/content/pharmacy-clinical");
    const { REVIEW } = await import("@/content/pharmacy-review");
    const base = REVIEW.noticeQueueNoCounts;
    expect(withSignedPairs(base, null)).toBe(base);
    const out = withSignedPairs(base, 12);
    expect(out).toMatch(/^MedSync checks 12 signed interaction pairs/);
    expect(out).toMatch(
      /No alert does not mean no interaction\. Its dose references are still being signed/,
    );
    expect(out).not.toMatch(/does not check drug interactions/);
  });
});
