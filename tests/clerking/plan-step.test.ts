// @vitest-environment jsdom
import type { PlacePlanRequest } from "@/components/clerking/plan/plan-step";
import type { DeskPayload } from "@/components/emr/desk/model";
import type { PlanDraft } from "@/lib/clerking/plan/draft";
import type { NoteContent } from "@/lib/emr/note-rules";
import { act, createElement as h, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { syncRecorded } from "@/components/emr/desk/model";
import {
  DX_CATALOGUE,
  DX_NAMES,
  DX_SIGNOFF,
  DX_TERM_IDS,
  TEST_NAMES,
  TEST_SPECIMENS,
  TEST_UUIDS,
} from "@/lib/clerking/impression/load";
import { ecat } from "./exam-fixtures";
import { cat, v2Payload } from "./fixtures";
import { PLAN_DX, PLAN_REQUESTS, withPlanFixture } from "./plan-fixtures";

/**
 * Step 10 Plan by problem in the v2 desk (ADR 0184): the four questions in order, a test to the
 * basket with its priority, frequency and problem, Emergency the one red with its word, one Place
 * action, Mark plan done waiting for the checklist and then signing, and the prescribing dialog's
 * chips announced as pressed with the disabled reason in words. Synthetic patient only.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh() {}, push() {} }),
  useSearchParams: () => new URLSearchParams(),
}));
const { ClerkingDesk } = await import("@/components/clerking/clerking-desk");
const { placeWords } = await import("@/components/clerking/plan/plan-step");

const dx = {
  cat: DX_CATALOGUE,
  termIds: DX_TERM_IDS,
  names: DX_NAMES,
  tests: TEST_NAMES,
  testIds: TEST_UUIDS,
  specimens: TEST_SPECIMENS,
};

function payload(plan = true, requests = false): DeskPayload {
  const p = v2Payload();
  p.clerking!.dx = {
    catalogueUrl: "/api/clerking/dx-catalogue?v=test",
    catalogueVersion: DX_CATALOGUE.version,
    signoff: DX_SIGNOFF,
  };
  const out = withPlanFixture(p, { requests });
  if (!plan) delete out.plan;
  return out;
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let latest: NoteContent;
let placed: PlacePlanRequest[] = [];

function Harness({ p }: { p: DeskPayload }) {
  const [content, setContent] = useState(p.draft!.content);
  const [plan, setPlan] = useState(p.plan);
  const now = useMemo(() => ({ ...p, ...(plan ? { plan } : {}) }), [p, plan]);
  const shown = useMemo(() => syncRecorded(content, now), [content, now]);
  let seq = 0;
  const on = {
    onContent: (c: NoteContent) => setContent(() => (latest = c)),
    onSection() {},
    onPlacePlan: async (r: PlacePlanRequest) => {
      placed.push(r);
      setPlan((x) =>
        x
          ? {
              ...x,
              record: {
                ...x.record,
                orders: [
                  ...x.record.orders,
                  ...r.orders.map((o) => ({
                    id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "9")}`,
                    display: o.display,
                    testKey: o.testKey,
                    testId: o.testId,
                    priority: o.priority,
                    frequency: o.frequency,
                    reasonConditionIds: o.reasonConditionIds,
                    at: "2026-09-27T20:16:00.000Z",
                    statusText: "To collect",
                    open: true,
                  })),
                ],
                requests: [
                  ...x.record.requests,
                  ...r.requests.map((q) => ({
                    id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "8")}`,
                    kind: q.kind,
                    urgency: q.urgency,
                    helpWanted: q.helpWanted,
                    targetWords: "Medicine",
                    stateWord: "Sent",
                    at: "2026-09-27T20:16:00.000Z",
                  })),
                ],
              },
            }
          : x,
      );
      return true;
    },
    onSyncCharts: async () => true,
    onMedicine: (id: string, answer: "continued" | "stopped" | "changed" | "held") =>
      setPlan((x) =>
        x
          ? {
              ...x,
              record: {
                ...x.record,
                medicines: x.record.medicines.map((m) => (m.id === id ? { ...m, answer } : m)),
              },
            }
          : x,
      ),
  };
  return h(ClerkingDesk, {
    p: now,
    cat,
    ecat,
    dx,
    content: shown,
    current: "plan",
    save: { tone: "neutral", text: "Saved 08:19" },
    actor: "u-1",
    on,
    loaders: { findings: async () => [], terms: async () => [] },
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = ((q: string) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    const max = /max-width:\s*(\d+(?:\.\d+)?)px/.exec(q);
    return {
      matches: min ? 1440 >= +min[1]! : max ? 1440 <= +max[1]! : false,
      media: q,
      addEventListener() {},
      removeEventListener() {},
    };
  }) as unknown as typeof window.matchMedia;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  placed = [];
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const mount = (p: DeskPayload) => act(() => root.render(h(Harness, { p })));
const tap = (el: Element | null | undefined) => {
  if (!el) throw new Error("nothing to tap");
  act(() => (el as HTMLElement).click());
};
const buttons = (name: string | RegExp, within: ParentNode = document) =>
  [...within.querySelectorAll("button")].filter((b) =>
    typeof name === "string" ? b.textContent?.trim() === name : name.test(b.textContent ?? ""),
  );
const button = (name: string | RegExp, within: ParentNode = document) => buttons(name, within)[0];
const radio = (group: string, name: string) =>
  [
    ...(document
      .querySelector(`[role="radiogroup"][aria-label="${group}"]`)
      ?.querySelectorAll('[role="radio"]') ?? []),
  ].find((b) => b.textContent?.trim() === name) as HTMLButtonElement | undefined;
const type = (el: Element | null | undefined, value: string) =>
  act(() => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const plan = () => (latest.plan ?? {}) as PlanDraft;
const headings = () => [...host.querySelectorAll("h3")].map((x) => x.textContent?.trim());

describe("step 10, Plan by problem", () => {
  it("asks the four questions in order, with the problems in Impression order", async () => {
    mount(payload());
    await act(async () => {});
    const hs = headings();
    const order = [
      "Where, and how closely",
      "By problem",
      "Medicines",
      "Monitoring charts",
      "Talked through",
      "Before you sign",
    ];
    expect(order.map((x) => hs.indexOf(x))).toEqual(
      [...order.map((x) => hs.indexOf(x))].sort((a, b) => a - b),
    );
    expect(order.every((x) => hs.includes(x))).toBe(true);
    const cards = [...host.querySelectorAll("h4 button")].map(
      (b) => b.querySelector(".sr-only")?.textContent,
    );
    expect(cards).toEqual([
      "Leading. Sepsis",
      "1. Bacterial meningitis",
      "Hypothermia, cause not yet known",
    ]);
    expect(host.textContent).toMatch(/to do before signing/);
    expect(host.textContent).toMatch(/Draft map, not CSO-signed/);
    expect(host.textContent).toMatch(/No signed care items for this problem yet/);
  });

  it("a test goes to the basket with its priority, frequency and problem; nothing is sent until placed", async () => {
    mount(payload());
    await act(async () => {});
    const emergency = radio("Priority, Blood culture", "Emergency")!;
    tap(emergency);
    expect(emergency.getAttribute("aria-checked")).toBe("true");
    // The one red in the Plan, with its word.
    expect(emergency.className).toMatch(/bg-status-critical-bg/);
    expect(radio("Priority, Lactate", "Routine")!.className).not.toMatch(/critical/);
    tap(radio("Priority, Lactate", "Routine"));
    tap(radio("How often, Lactate", "6-hourly"));
    const adds = buttons("Add", host);
    tap(adds[0]);
    tap(adds[1]);
    expect(plan().basket!.orders).toMatchObject([
      {
        testKey: "test.blood_culture",
        priority: "emergency",
        frequency: null,
        reasonConditionIds: [PLAN_DX[0]!.id],
      },
      {
        testKey: "test.lactate",
        priority: "routine",
        frequency: "6h",
        reasonConditionIds: [PLAN_DX[0]!.id],
      },
    ]);
    expect(placed).toEqual([]);
    const place = button(/^Place 2 orders and 0 prescriptions$/)!;
    await act(async () => {
      (place as HTMLElement).click();
    });
    expect(placed).toHaveLength(1);
    expect(placed[0]!.orders.map((o) => o.testKey)).toEqual(["test.blood_culture", "test.lactate"]);
    expect(plan().basket).toEqual({ orders: [], prescriptions: [] });
    expect(host.textContent).toMatch(/Placed \d\d:\d\d/);
  });

  it("Mark plan done waits for the checklist; then the plan is done and signing may go ahead", async () => {
    mount(payload());
    await act(async () => {});
    const markDone = () => button(/^(Mark plan done|Plan done)$/)! as HTMLButtonElement;
    expect(markDone().disabled).toBe(true);
    tap(radio("Disposition", "Observe in EU"));
    tap(radio("Observations", "Hourly"));
    tap(radio("Senior review", "Within 1 hour"));
    tap(buttons("Add", host)[0]);
    await act(async () => {
      button(/^Place 1 order and 0 prescriptions$/)!.click();
    });
    // Bacterial meningitis is a must-not-miss (its card opens by itself): a reason of three words.
    const box = [...host.querySelectorAll("label")].find((l) =>
      /^Must not miss/.test(l.textContent ?? ""),
    )!;
    type(document.getElementById(box.htmlFor), "no neck stiffness, alert");
    tap(radio("Decision for Metformin", "Continue"));
    expect(markDone().disabled).toBe(false);
    expect(host.textContent).toMatch(/Ready to mark done/);
    await act(async () => markDone().click());
    expect(plan().done).toMatchObject({ by: "u-1" });
    expect(host.textContent).toMatch(/Plan done/);
    // A later change reopens it.
    tap(radio("Senior review", "Now"));
    expect(host.textContent).toMatch(/Ready to mark done/);
  });

  it("the prescribing dialog: chips announce pressed, the disabled reason is in words", async () => {
    mount(payload());
    await act(async () => {});
    tap(button("Ceftriaxone", host));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toMatch(/Prescribe · for Sepsis/);
    expect(dialog.textContent).toMatch(/No verified regimen yet: type the dose/);
    expect(dialog.textContent).toMatch(/Choose the route\./);
    const iv = [...dialog.querySelectorAll('[aria-label="Route"] button')].find(
      (b) => b.textContent?.trim() === "IV",
    )!;
    expect(iv.getAttribute("aria-pressed")).toBe("false");
    tap(iv);
    expect(iv.getAttribute("aria-pressed")).toBe("true");
    expect(dialog.textContent).toMatch(/Type the dose\./);
    type(dialog.querySelector("input[inputmode=decimal]"), "2");
    tap(
      [...dialog.querySelectorAll('[aria-label="Unit"] button')].find(
        (b) => b.textContent?.trim() === "g",
      ),
    );
    tap(
      [...dialog.querySelectorAll('[aria-label="How often"] button')].find(
        (b) => b.textContent?.trim() === "Once daily",
      ),
    );
    // No blood culture ordered for a sepsis-type problem: an answer is needed before adding.
    expect(dialog.textContent).toMatch(/Answer "Cultures before antibiotics" to continue\./);
    const add = button("Add to basket", dialog) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    tap(
      [...dialog.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === "Aware; will monitor",
      ),
    );
    expect(add.disabled).toBe(false);
    tap(add);
    expect(plan().basket!.prescriptions).toMatchObject([
      {
        drugId: "ceftriaxone",
        doseNum: 2,
        unit: "g",
        route: "iv",
        frequency: "daily",
        conditionId: PLAN_DX[0]!.id,
      },
    ]);
  });

  it("Show all medicines: every class by body system; choosing one prescribes it", async () => {
    mount(payload());
    await act(async () => {});
    tap(button("Ceftriaxone", host));
    const rx = document.querySelector('[role="dialog"]')!;
    const showAll = [...rx.querySelectorAll("button")].find(
      (b) => b.textContent === "Show all medicines",
    )!;
    expect(showAll.getAttribute("aria-haspopup")).toBe("dialog");
    tap(showAll);
    const all = [...document.querySelectorAll('[role="dialog"]')].find((d) =>
      /All medicines/.test(d.textContent ?? ""),
    )!;
    expect(all).toBeTruthy();
    expect(all.textContent).toMatch(/192 medicines in \d+ classes, by body system/);
    const systems = [...all.querySelectorAll("h3")].map((x) => x.firstChild?.textContent);
    expect(systems[0]).toBe("Anti-infectives");
    expect(systems).toContain("Cardiovascular");
    const classes = [...all.querySelectorAll("h4")].map((x) => x.firstChild?.textContent);
    expect(classes).toContain("Penicillins");
    expect(classes).toContain("Cephalosporins, third generation");
    // The medicine the dialog is on is ticked.
    const ceftriaxone = [...all.querySelectorAll("button[aria-pressed]")].find((b) =>
      /^Ceftriaxone/.test(b.textContent ?? ""),
    )!;
    expect(ceftriaxone.getAttribute("aria-pressed")).toBe("true");
    // The filter narrows to the class typed, and says how many match.
    type(all.querySelector('input[placeholder^="Name, class"]'), "penicillin");
    const rows = [...all.querySelectorAll("button[aria-pressed]")].map((b) => b.textContent);
    expect(rows.some((t) => /^Amoxicillin/.test(t ?? ""))).toBe(true);
    expect(rows.some((t) => /^Ceftriaxone/.test(t ?? ""))).toBe(false);
    expect(all.textContent).toMatch(/\d+ medicines match/);
    tap(
      [...all.querySelectorAll("button[aria-pressed]")].find((b) =>
        /^Amoxicillin(?!–)/.test(b.textContent ?? ""),
      ),
    );
    await act(async () => {});
    const open = [...document.querySelectorAll('[role="dialog"]')];
    expect(open.some((d) => /All medicines/.test(d.textContent ?? ""))).toBe(false);
    expect(open[0]!.textContent).toMatch(/Amoxicillin · Penicillins/);
  });

  it("off (no Plan payload), step 10 is the v1 Plan", async () => {
    mount(payload(false));
    await act(async () => {});
    expect(headings()).not.toContain("By problem");
  });
});

describe("requests in the Plan (CARE_REQUESTS, ADR 0537)", () => {
  const MEDICINE = PLAN_REQUESTS.departments[0]!.id;
  const NEPHROLOGY = PLAN_REQUESTS.departments[1]!.id;
  const consult = {
    clientKey: "req-key-0001",
    kind: "consult" as const,
    targetDepartmentId: NEPHROLOGY,
    wardId: null,
    namedUserIds: [],
    urgency: "routine" as const,
    helpWanted: "advice" as const,
    reasonConditionIds: [PLAN_DX[0]!.id],
    question: "Is this nephrotic?",
    phoned: null,
    display: "Consult, Nephrology",
  };
  const typeText = (el: Element | null | undefined, value: string) =>
    act(() => {
      const t = el as HTMLTextAreaElement;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(t, value);
      t.dispatchEvent(new Event("input", { bubbles: true }));
    });

  it("placeWords keeps today's words without requests", () => {
    expect(placeWords(2, 0, 0)).toBe("Place 2 orders and 0 prescriptions");
    expect(placeWords(1, 1, 0)).toBe("Place 1 order and 1 prescription");
    expect(placeWords(1, 2, 1)).toBe("Place 1 order, 2 prescriptions and 1 request");
    expect(placeWords(0, 0, 2)).toBe("Place 0 orders, 0 prescriptions and 2 requests");
  });

  it("requests are placed with the basket", async () => {
    const p = payload(true, true);
    p.draft!.content = {
      ...p.draft!.content,
      plan: { basket: { orders: [], prescriptions: [], requests: [consult] } },
    } as NoteContent;
    mount(p);
    await act(async () => {});
    expect(host.textContent).toMatch(/Consult, Nephrology/);
    await act(async () => {
      button(/^Place 0 orders, 0 prescriptions and 1 request$/)!.click();
    });
    expect(placed).toHaveLength(1);
    expect(placed[0]!.requests).toHaveLength(1);
    expect(plan().basket).toEqual({ orders: [], prescriptions: [] });
  });

  it("no request controls with the flag off", async () => {
    mount(payload());
    await act(async () => {});
    expect(button("Ask another team")).toBeUndefined();
    expect(radio("Senior review", "Not needed")).toBeUndefined();
  });

  it("a time adds the one review line; Not needed asks why and clears it", async () => {
    const p = payload(true, true);
    p.plan!.requests = { ...PLAN_REQUESTS, ownDepartmentId: null };
    mount(p);
    await act(async () => {});
    tap(radio("Disposition", "Admit"));
    tap(button(/^Medical ward/, host));
    tap(radio("Senior review", "Now"));
    const [line] = plan().basket!.requests!;
    expect(line).toMatchObject({
      kind: "review",
      urgency: "now",
      targetDepartmentId: MEDICINE,
      wardId: "00000000-0000-4000-8000-0000000000a3",
    });
    tap(radio("Senior review", "Within 1 hour"));
    expect(plan().basket!.requests).toEqual([
      { ...line, urgency: "within_1h", display: expect.any(String) },
    ]);
    expect(host.textContent).toMatch(/The requesting team stays responsible for the patient/);
    tap(radio("Senior review", "Not needed"));
    expect(plan().basket!.requests).toEqual([]);
    expect(plan().seniorReview).toBeUndefined();
    const why = [...host.querySelectorAll("label")].find((l) =>
      /^Why no senior review/.test(l.textContent ?? ""),
    )!;
    type(document.getElementById(why.htmlFor), "seen by consultant today");
    expect(plan().seniorReviewNotNeeded).toBe("seen by consultant today");
  });

  it("Ask another team adds a consult once it is complete", async () => {
    mount(payload(true, true));
    await act(async () => {});
    tap(button("Ask another team"));
    const dialog = [...document.querySelectorAll('[role="dialog"]')].find((d) =>
      /Ask another team/.test(d.textContent ?? ""),
    )!;
    expect(dialog.textContent).toMatch(/The requesting team stays responsible for the patient/);
    const add = button("Add to basket", dialog) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(dialog.textContent).toMatch(/Choose the team\./);
    const chip = (group: string, name: string) =>
      [...dialog.querySelectorAll(`[aria-label="${group}"] button`)].find(
        (b) => b.textContent?.trim() === name,
      );
    tap(chip("Team", "Nephrology"));
    tap(chip("Urgency", "Routine"));
    tap(chip("Help wanted", "Advice only"));
    tap(chip("Problems", "Sepsis"));
    expect(add.disabled).toBe(true);
    typeText(dialog.querySelector("textarea"), "Is this nephrotic?");
    expect(add.disabled).toBe(false);
    tap(add);
    expect(plan().basket!.requests).toMatchObject([
      {
        kind: "consult",
        targetDepartmentId: NEPHROLOGY,
        urgency: "routine",
        helpWanted: "advice",
        reasonConditionIds: [PLAN_DX[0]!.id],
        question: "Is this nephrotic?",
        phoned: null,
      },
    ]);
  });

  const seniorItem = () =>
    [...host.querySelectorAll("li")]
      .map((l) => l.textContent ?? "")
      .find((t) => /^(Done|To do): Senior review/.test(t)) ?? "";

  it("after a review is placed, the row queues no second review and the checklist stays done", async () => {
    mount(payload(true, true));
    await act(async () => {});
    tap(radio("Senior review", "Now"));
    await act(async () => {
      button(/^Place 0 orders, 0 prescriptions and 1 request$/)!.click();
    });
    expect(placed[0]!.requests).toHaveLength(1);
    expect(seniorItem()).toMatch(/^Done/);
    tap(radio("Senior review", "Now"));
    tap(radio("Senior review", "Within 1 hour"));
    expect(plan().basket?.requests ?? []).toEqual([]);
    expect(plan().seniorReview).toBe("within_1h");
    expect(seniorItem()).toMatch(/^Done/);
  });

  it("removing a review line keeps the senior review when one is placed", async () => {
    const p = payload(true, true);
    p.plan!.record.requests = [
      {
        id: "00000000-0000-4000-8000-0000000000e1",
        kind: "review",
        urgency: "now",
        helpWanted: null,
        targetWords: "Medicine",
        stateWord: "Sent",
        at: "2026-09-27T20:16:00.000Z",
      },
    ];
    p.draft!.content = {
      ...p.draft!.content,
      plan: {
        seniorReview: "now",
        basket: {
          orders: [],
          prescriptions: [],
          requests: [
            {
              ...consult,
              kind: "review",
              urgency: "now",
              helpWanted: null,
              reasonConditionIds: [],
              question: "",
              display: "Senior review, Medicine",
            },
          ],
        },
      },
    } as NoteContent;
    mount(p);
    await act(async () => {});
    tap(host.querySelector('[aria-label="Remove Senior review, Medicine"]'));
    expect(plan().basket?.requests ?? []).toEqual([]);
    expect(plan().seniorReview).toBe("now");
    expect(seniorItem()).toMatch(/^Done/);
  });

  it("says when no review request can be sent", async () => {
    const p = payload(true, true);
    p.plan!.requests = { ...PLAN_REQUESTS, ownDepartmentId: null };
    mount(p);
    await act(async () => {});
    expect(host.textContent).toMatch(/No review request will be sent/);
    tap(radio("Disposition", "Admit"));
    tap(button(/^Medical ward/, host));
    expect(host.textContent).not.toMatch(/No review request will be sent/);
  });
});
