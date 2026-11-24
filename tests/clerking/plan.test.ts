/**
 * Step 10 Plan by problem (ADR 0184): observations against the signed NEWS2 response, priority and
 * frequency, the checklist and "plan done", the server's sign gate, the draft at the trust
 * boundary, and the note's Plan block.
 */
import type { PlanDraft } from "@/lib/clerking/plan/draft";
import type { ProblemCard } from "@/lib/clerking/plan/problems";
import type { PlanRecord } from "@/lib/clerking/plan/record";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ContentV2Keys } from "@/lib/clerking/payload";
import { checklist, planFingerprint, planStatus, statusWord } from "@/lib/clerking/plan/checklist";
import { composePlanLines } from "@/lib/clerking/plan/compose";
import { basketOf, PlanRequestLineSchema, PlanSchema } from "@/lib/clerking/plan/draft";
import {
  lessOftenThanRequired,
  requiredObservation,
  urgentBandLine,
} from "@/lib/clerking/plan/observations";
import { planSignBlocks } from "@/lib/clerking/plan/sign";
import { checkRule } from "@/lib/emr/note-rules";
import { ORDER_PRIORITY_DEFINITION, orderFrequencyFor } from "@/lib/emr/orders";

const LEAD = "11111111-1111-4111-8111-111111111111";
const LEAD_V = "11111111-1111-4111-8111-1111111111aa";
const MNM = "22222222-2222-4222-8222-222222222222";
const MNM_V = "22222222-2222-4222-8222-2222222222aa";

const card = (over: Partial<ProblemCard>): ProblemCard => ({
  logicalId: LEAD,
  versionId: LEAD_V,
  display: "Sepsis",
  slot: "leading",
  marker: "★",
  profileId: "dx.sepsis",
  mustNotMiss: false,
  timeCritical: true,
  tests: [],
  classes: [],
  supportive: [],
  ...over,
});
const cards = [
  card({}),
  card({
    logicalId: MNM,
    versionId: MNM_V,
    display: "Meningitis",
    slot: "differential",
    marker: "1",
    mustNotMiss: true,
  }),
];
const empty: PlanRecord = {
  orders: [],
  prescriptions: [],
  medicines: [],
  charts: [],
  requests: [],
};

describe("observations against NEWS2 (CO-NEWS-01..05)", () => {
  const req = (total: number, singleThree = false) =>
    requiredObservation({ total, singleThree, provisional: false })!;

  it("maps each signed band to the least often the plan may choose", () => {
    expect(
      [req(8), req(7), req(5), req(2, true), req(3), req(0)].map((r) => [r.frequency, r.ref.id]),
    ).toEqual([
      ["continuous", "CO-NEWS-01"],
      ["continuous", "CO-NEWS-01"],
      ["hourly", "CO-NEWS-02"],
      ["hourly", "CO-NEWS-03"],
      ["4h", "CO-NEWS-04"],
      ["12h", "CO-NEWS-05"],
    ]);
  });

  it("less often than NEWS2 calls for asks why; the RCP line shows for 5–6", () => {
    expect(lessOftenThanRequired("4h", req(5))).toBe(true);
    expect(lessOftenThanRequired("hourly", req(5))).toBe(false);
    expect(lessOftenThanRequired("continuous", req(0))).toBe(false);
    expect(urgentBandLine({ total: 6, singleThree: false, provisional: false })?.id).toBe(
      "CO-NEWS-02",
    );
    expect(urgentBandLine({ total: 7, singleThree: false, provisional: false })).toBeNull();
  });
});

describe("priority and frequency (ADR 0185)", () => {
  it("routine needs a frequency: none given becomes once; other priorities keep theirs", () => {
    expect(orderFrequencyFor("routine", undefined)).toBe("once");
    expect(orderFrequencyFor("routine", "6h")).toBe("6h");
    expect(orderFrequencyFor("emergency", undefined)).toBeNull();
    expect(orderFrequencyFor("urgent", "daily")).toBe("daily");
  });

  it("every priority has a one-line definition", () => {
    expect(Object.keys(ORDER_PRIORITY_DEFINITION)).toEqual([
      "routine",
      "urgent",
      "immediate",
      "emergency",
    ]);
  });

  it("the draft refuses an order line with no problem", () => {
    const line = {
      clientKey: "plan-order-1",
      testId: "33333333-3333-4333-8333-333333333333",
      testKey: "test.fbc",
      display: "FBC",
      priority: "routine",
      frequency: "once",
      reasonConditionIds: [],
    };
    expect(PlanSchema.safeParse({ basket: { orders: [line], prescriptions: [] } }).success).toBe(
      false,
    );
    expect(
      PlanSchema.safeParse({
        basket: { orders: [{ ...line, reasonConditionIds: [LEAD_V] }], prescriptions: [] },
      }).success,
    ).toBe(true);
  });
});

describe("the checklist", () => {
  const full: PlanDraft = {
    disposition: { kind: "admit", ward: "Medical ward" },
    observations: { frequency: "hourly" },
    seniorReview: "within_1h",
    problems: { [MNM]: { mnmReason: "no neck stiffness and alert" } },
  };
  const orders = [
    {
      id: "o1",
      display: "Blood culture",
      testKey: "test.blood_culture",
      testId: null,
      priority: "emergency" as const,
      frequency: null,
      reasonConditionIds: [LEAD_V],
      at: "",
      statusText: "",
      open: true,
    },
  ];

  it("computes each item from the draft and the record", () => {
    const items = checklist({ plan: {}, cards, record: empty, obsRequired: null });
    expect(items.map((i) => [i.id, i.done])).toEqual([
      ["disposition", false],
      ["observations", false],
      ["senior_review", false],
      ["leading", false],
      ["must_not_miss", false],
      ["basket", true],
    ]);
    const done = checklist({ plan: full, cards, record: { ...empty, orders }, obsRequired: null });
    expect(done.every((i) => i.done)).toBe(true);
  });

  it("admit needs a ward; discharge adds follow-up; a pending medicine holds it", () => {
    const admit = checklist({
      plan: { ...full, disposition: { kind: "admit" } },
      cards,
      record: { ...empty, orders },
      obsRequired: null,
    });
    expect(admit.find((i) => i.id === "disposition")!.detail).toBe("Choose the ward.");
    const discharge = checklist({
      plan: { ...full, disposition: { kind: "discharge" } },
      cards,
      record: { ...empty, orders },
      obsRequired: null,
    });
    expect(discharge.find((i) => i.id === "follow_up")!.done).toBe(false);
    const meds = checklist({
      plan: full,
      cards,
      record: {
        ...empty,
        orders,
        medicines: [{ id: "m1", display: "Metformin", answer: "pending" }],
      },
      obsRequired: null,
    });
    expect(meds.find((i) => i.id === "medicines")).toMatchObject({
      done: false,
      detail: "Metformin",
    });
  });

  it("less often than NEWS2 needs a reason of three words", () => {
    const req = requiredObservation({ total: 5, singleThree: false, provisional: false });
    const plan = { ...full, observations: { frequency: "4h" as const, reason: "stable" } };
    expect(
      checklist({ plan, cards, record: { ...empty, orders }, obsRequired: req }).find(
        (i) => i.id === "observations",
      )!.done,
    ).toBe(false);
    const why = {
      ...full,
      observations: { frequency: "4h" as const, reason: "senior reviewed, improving trend" },
    };
    expect(
      checklist({ plan: why, cards, record: { ...empty, orders }, obsRequired: req }).find(
        (i) => i.id === "observations",
      )!.done,
    ).toBe(true);
  });

  it("the basket must be empty", () => {
    const plan: PlanDraft = {
      ...full,
      basket: {
        orders: [
          {
            clientKey: "k-00000001",
            testId: LEAD_V,
            testKey: "test.fbc",
            display: "FBC",
            priority: "urgent",
            frequency: null,
            reasonConditionIds: [LEAD_V],
          },
        ],
        prescriptions: [],
      },
    };
    expect(
      checklist({ plan, cards, record: empty, obsRequired: null }).find((i) => i.id === "basket"),
    ).toMatchObject({ done: false, detail: "1 not placed" });
  });

  it("status: to do, ready, done; a later change reopens it", () => {
    const record = { ...empty, orders };
    const items = checklist({ plan: full, cards, record, obsRequired: null });
    expect(
      statusWord(
        planStatus({}, checklist({ plan: {}, cards, record: empty, obsRequired: null }), empty),
      ),
    ).toBe("5 to do before signing");
    expect(planStatus(full, items, record).kind).toBe("ready");
    const marked = { ...full, done: { by: "u", at: "t", hash: planFingerprint(full, record) } };
    expect(planStatus(marked, items, record).kind).toBe("done");
    const changed = { ...marked, seniorReview: "now" as const };
    expect(
      planStatus(changed, checklist({ plan: changed, cards, record, obsRequired: null }), record)
        .kind,
    ).toBe("ready");
    const newOrder = { ...record, orders: [...orders, { ...orders[0]!, id: "o2" }] };
    expect(planStatus(marked, items, newOrder).kind).toBe("ready");
  });
});

describe("signing waits for plan done", () => {
  it("the server's gate", () => {
    expect(planSignBlocks(undefined)).toEqual(["mark the plan done"]);
    expect(planSignBlocks({ done: { by: "u", at: "t", hash: "h" } })).toEqual([]);
    expect(
      planSignBlocks({
        done: { by: "u", at: "t", hash: "h" },
        basket: { orders: [{}], prescriptions: [] },
      }),
    ).toEqual(["place or remove what is in the basket"]);
  });

  it("a plan marked done counts for s14's sign rule", () => {
    const rule = {
      id: "req.plan",
      check: "section_has_any" as const,
      message: "",
      section: "s14",
      itemKinds: ["order"],
    };
    expect(checkRule(rule, { sections: {} }, {})).toBe(false);
    expect(checkRule(rule, { sections: {}, plan: { done: { hash: "h" } } }, {})).toBe(true);
  });

  it("the draft passes the trust boundary; unknown keys are stripped", () => {
    const Content = z.object({ ...ContentV2Keys });
    const out = Content.parse({ plan: { ...{ seniorReview: "now" }, extra: 1 } });
    expect(out.plan).toEqual({ seniorReview: "now" });
  });
});

describe("the note's Plan block", () => {
  it("disposition, monitoring, one line per problem, medicines, talked through, follow-up", () => {
    const plan: PlanDraft = {
      disposition: { kind: "discharge" },
      observations: { frequency: "4h", reason: "senior reviewed, improving trend" },
      seniorReview: "routine",
      problems: {
        [MNM]: { mnmReason: "alert, no neck stiffness", note: "Review if headache returns" },
      },
      talkedThrough: { diagnosis: true, come_back: true },
      followUp: { when: "2w", where: "Medical clinic", comeBackAdvice: true },
      basket: {
        orders: [
          {
            clientKey: "k-00000002",
            testId: LEAD_V,
            testKey: "test.lactate",
            display: "Lactate",
            priority: "urgent",
            frequency: null,
            reasonConditionIds: [LEAD_V],
          },
        ],
        prescriptions: [],
      },
    };
    const record: PlanRecord = {
      orders: [
        {
          id: "o1",
          display: "Blood culture",
          testKey: null,
          testId: null,
          priority: "emergency",
          frequency: null,
          reasonConditionIds: [LEAD_V],
          at: "",
          statusText: "",
          open: true,
        },
        {
          id: "o2",
          display: "U&E",
          testKey: null,
          testId: null,
          priority: "routine",
          frequency: "daily",
          reasonConditionIds: [LEAD_V],
          at: "",
          statusText: "",
          open: true,
        },
      ],
      prescriptions: [
        {
          id: "r1",
          drugId: "ceftriaxone",
          drugName: "Ceftriaxone",
          display: "Ceftriaxone 2 g IV, Once daily, 5 days, give now",
          conditionId: LEAD_V,
          kind: "drug",
          state: "active",
          awaitingCosign: false,
          cosignWithheld: false,
          answered: ["Override allergy: Previous reaction was not allergic"],
          edits: [],
          at: "",
        },
        {
          id: "r2",
          drugId: "glucose_10",
          drugName: "Glucose 10%",
          display: "Glucose 10% 200 mL of 10% IV, Once (stat), give now",
          conditionId: LEAD_V,
          kind: "drug",
          state: "active",
          awaitingCosign: true,
          cosignWithheld: false,
          answered: [],
          edits: [{ field: "dose", from: "150 mL", to: "200 mL" }],
          at: "",
        },
      ],
      medicines: [
        { id: "m1", display: "Metformin", answer: "held", reason: "Sepsis, poor intake" },
      ],
      charts: [
        {
          id: "c1",
          kind: "fluid_balance",
          frequency: "hourly",
          measureUrine: true,
          openedByLabel: "",
        },
        { id: "c2", kind: "mar", frequency: null, measureUrine: false, openedByLabel: "" },
      ],
      // Flag off: no requests, and the Plan block is unchanged.
      requests: [],
    };
    const lines = composePlanLines({
      plan,
      cards,
      record,
      obsRequired: requiredObservation({ total: 5, singleThree: false, provisional: false }),
      news2Total: 5,
    });
    expect(lines).toEqual([
      "Discharge.",
      "Observations 4-hourly (NEWS2 5), less often than NEWS2 calls for: senior reviewed, improving trend; fluid balance chart hourly, urine output measured; senior review routine.",
      "1. Sepsis: ordered Blood culture (emergency), U&E (routine, daily); not yet ordered Lactate (urgent); Ceftriaxone 2 g IV, Once daily, 5 days, give now (override allergy: Previous reaction was not allergic); Glucose 10% 200 mL of 10% IV, Once (stat), give now (changed from default: dose 150 mL → 200 mL; awaiting senior co-sign).",
      "2. Meningitis: no test or treatment: alert, no neck stiffness; Review if headache returns.",
      "Medicines on admission: Metformin held (Sepsis, poor intake).",
      "Talked through: what we think is wrong, when to come back.",
      "Follow-up: 2 weeks, Medical clinic; when-to-come-back advice given.",
    ]);
  });
});

describe("request lines in the basket (ADR 0537)", () => {
  const DEPT = "33333333-3333-4333-8333-333333333333";
  const consult = {
    clientKey: "req-key-0001",
    kind: "consult",
    targetDepartmentId: DEPT,
    wardId: null,
    namedUserIds: [],
    urgency: "routine",
    helpWanted: "advice",
    reasonConditionIds: [LEAD_V],
    question: "Is this nephrotic?",
    phoned: null,
    display: "Nephrology consult",
  };
  const review = {
    ...consult,
    kind: "review",
    helpWanted: null,
    reasonConditionIds: [],
    question: "",
  };

  it("drafts saved before requests still parse", () => {
    const d = PlanSchema.parse({ basket: { orders: [], prescriptions: [] } });
    expect(basketOf(d).requests).toEqual([]);
  });

  it("a consult line needs help wanted, a problem and a question", () => {
    expect(PlanRequestLineSchema.safeParse(consult).success).toBe(true);
    expect(PlanRequestLineSchema.safeParse({ ...consult, helpWanted: null }).success).toBe(false);
    expect(PlanRequestLineSchema.safeParse({ ...consult, reasonConditionIds: [] }).success).toBe(
      false,
    );
    expect(PlanRequestLineSchema.safeParse({ ...consult, question: "  " }).success).toBe(false);
  });

  it("a review takes only review urgencies", () => {
    expect(PlanRequestLineSchema.safeParse(review).success).toBe(true);
    expect(PlanRequestLineSchema.safeParse({ ...review, urgency: "now" }).success).toBe(true);
    expect(PlanRequestLineSchema.safeParse({ ...review, urgency: "urgent_today" }).success).toBe(
      false,
    );
    expect(PlanRequestLineSchema.safeParse({ ...consult, urgency: "now" }).success).toBe(false);
    // R17: the database refuses help wanted on a review.
    expect(PlanRequestLineSchema.safeParse({ ...review, helpWanted: "advice" }).success).toBe(
      false,
    );
  });
});

describe("requests in the Plan (ADR 0537)", () => {
  const placed = (
    over: Partial<PlanRecord["requests"][number]>,
  ): PlanRecord["requests"][number] => ({
    id: "r-1",
    kind: "review",
    urgency: "within_1h",
    helpWanted: null,
    targetWords: "Medicine",
    stateWord: "Sent",
    at: "2026-09-27T20:16:00.000Z",
    ...over,
  });
  const senior = (plan: PlanDraft, notNeededOption?: boolean, record = empty) =>
    checklist({ plan, cards, record, obsRequired: null, notNeededOption }).find(
      (i) => i.id === "senior_review",
    )!;

  it("a placed review settles senior review", () => {
    expect(senior({}, true, { ...empty, requests: [placed({})] })).toMatchObject({
      done: true,
      detail: null,
    });
  });

  it("senior review is met by not needed with a reason", () => {
    expect(senior({ seniorReviewNotNeeded: "stable" }, true)).toMatchObject({
      done: false,
      detail: "Choose when, or say why not.",
    });
    expect(senior({ seniorReviewNotNeeded: "seen by consultant today" }, true)).toMatchObject({
      done: true,
      detail: null,
    });
    // Flag off: the words are today's.
    expect(senior({})).toMatchObject({ done: false, detail: "Choose when." });
  });

  it("a placed review writes who it went to", () => {
    const lines = composePlanLines({
      plan: { seniorReview: "within_1h" },
      cards: [],
      record: {
        ...empty,
        requests: [
          placed({}),
          placed({
            id: "r-2",
            kind: "consult",
            urgency: "urgent_today",
            helpWanted: "see_patient",
            targetWords: "Nephrology",
          }),
        ],
      },
      obsRequired: null,
      news2Total: null,
    });
    expect(lines.join("\n")).toMatch(/senior review requested from Medicine, within 1 hour/i);
    expect(lines).toContain(
      "Consult requested from Nephrology (please see the patient, urgent, today).",
    );
  });

  it("a review still in the basket is not yet sent; not needed gives its reason", () => {
    const line = {
      clientKey: "req-key-0001",
      kind: "review" as const,
      targetDepartmentId: "33333333-3333-4333-8333-333333333333",
      wardId: null,
      namedUserIds: [],
      urgency: "now" as const,
      helpWanted: null,
      reasonConditionIds: [],
      question: "",
      phoned: null,
      display: "Senior review, Medicine",
    };
    const compose = (plan: PlanDraft) =>
      composePlanLines({ plan, cards: [], record: empty, obsRequired: null, news2Total: null });
    expect(
      compose({
        seniorReview: "now",
        basket: { orders: [], prescriptions: [], requests: [line] },
      }),
    ).toEqual(["Senior review now (not yet sent)."]);
    expect(compose({ seniorReviewNotNeeded: "seen by consultant today" })).toEqual([
      "No senior review needed: seen by consultant today.",
    ]);
  });

  it("flag off, the Plan block is unchanged", () => {
    expect(
      composePlanLines({
        plan: { seniorReview: "routine" },
        cards: [],
        record: empty,
        obsRequired: null,
        news2Total: null,
      }),
    ).toEqual(["Senior review routine."]);
  });
});
