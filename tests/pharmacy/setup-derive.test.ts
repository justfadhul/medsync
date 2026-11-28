/**
 * Set-up › Going live, Places, Rules and Messages: the pure derivations (SETUP-TABS §F; PROMPT-SETUP step 3), every
 * branch, with the edges the prompt names (GSM-7/UCS-2 at 160/153/70/67, fridge 2.0/2.5/7.5/8.0, ±90 minutes,
 * slot + 29 / + 31, pluralising, the second signer, readiness, phone normalising).
 */
import { describe, expect, it } from "vitest";

import { RULE_REGISTRY } from "@/content/pharmacy-rules";
import { CHECKLIST } from "@/content/pharmacy-setup";
import * as G from "@/lib/pharmacy/derive/setup/golive";
import * as M from "@/lib/pharmacy/derive/setup/messages";
import * as P from "@/lib/pharmacy/derive/setup/places";
import * as R from "@/lib/pharmacy/derive/setup/rules";

const st = (o: Partial<G.ItemState> = {}): G.ItemState => ({
  status: "todo",
  prog: null,
  dueOn: null,
  ...o,
});

describe("Going live", () => {
  const auto = { kind: "auto" as const };
  const mark = { kind: "mark" as const };
  it("itemStatus: auto done, doing, todo; an empty total is not done; marks are what was recorded", () => {
    expect(G.itemStatus(auto, st({ prog: [47, 47] }))).toBe("done");
    expect(G.itemStatus(auto, st({ prog: [41, 47] }))).toBe("doing");
    expect(G.itemStatus(auto, st({ prog: [0, 47] }))).toBe("todo");
    expect(G.itemStatus(auto, st({ prog: [0, 0] }))).toBe("todo");
    expect(G.itemStatus(mark, st({ status: "done" }))).toBe("done");
    expect(G.itemStatus(mark, st())).toBe("todo");
  });
  it("readiness is the average of each item's fraction", () => {
    const two = CHECKLIST.filter((i) => i.key === "levels" || i.key === "dev");
    expect(
      G.readiness(two, (k) => (k === "levels" ? st({ prog: [1, 2] }) : st({ status: "done" }))),
    ).toBe(75);
    expect(G.readiness(two, () => st())).toBe(0);
    expect(G.readiness([], () => st())).toBe(0);
  });
  it("blockers, overdue and blockers due after the go-live date", () => {
    const s = (k: string) =>
      k === "q1"
        ? st({ dueOn: "2026-11-20" })
        : k === "q24"
          ? st({ dueOn: "2026-11-01" })
          : st({ status: "done", prog: [1, 1] });
    expect(G.blockersLeft(CHECKLIST, s).map((i) => i.key)).toEqual(["q1", "q24"]);
    expect(G.overdue(CHECKLIST, s, "2026-11-03").map((i) => i.key)).toEqual(["q24"]);
    expect(G.blockersLate(CHECKLIST, s, "2026-11-16").map((i) => i.key)).toEqual(["q1"]);
    expect(G.blockersLate(CHECKLIST, s, null)).toEqual([]);
  });
  it("canGoLive, phaseIndex, days and the urgent countdown", () => {
    expect(G.canGoLive(0, "setup")).toBe(true);
    expect(G.canGoLive(0, "practice")).toBe(true);
    expect(G.canGoLive(1, "setup")).toBe(false);
    expect(G.canGoLive(0, "parallel")).toBe(false);
    expect([
      G.phaseIndex("setup"),
      G.phaseIndex("practice"),
      G.phaseIndex("parallel"),
      G.phaseIndex("retired"),
    ]).toEqual([0, 1, 2, 4]);
    expect(G.daysBetween("2026-11-03", "2026-11-16")).toBe(13);
    expect(G.countdownUrgent(3, 1)).toBe(true);
    expect(G.countdownUrgent(3, 0)).toBe(false);
    expect(G.countdownUrgent(4, 2)).toBe(false);
  });
  it("the checklist is 22 items in 4 groups, 12 blocking", () => {
    expect(CHECKLIST).toHaveLength(22);
    expect(new Set(CHECKLIST.map((i) => i.group)).size).toBe(4);
    expect(CHECKLIST.filter((i) => i.blocks)).toHaveLength(12);
  });
});

describe("Places", () => {
  it("handoverToday: done, missed at slot + missed minutes, now, due", () => {
    const at8 = P.toMin("08:00");
    const chip = (now: number, missed = 30) => P.handoverToday(["08:00"], [], now, missed)[0]!.st;
    expect(chip(at8 - 1)).toBe("due");
    expect(chip(at8)).toBe("now");
    expect(chip(at8 + 29)).toBe("now");
    expect(chip(at8 + 31)).toBe("missed");
    expect(chip(at8 + 31, 45)).toBe("now");
    const done = P.handoverToday(
      ["08:00"],
      [{ slot: "08:00", from: "A", to: "B", at: "08:12", differences: 1 }],
      at8 + 60,
      30,
    )[0]!;
    expect(done).toMatchObject({ st: "done", differences: 1 });
  });
  it("fridgeState at 2.0, 2.5, 7.5, 8.0 and outside", () => {
    expect(P.fridgeState(1.9, 0.5)).toBe("out");
    expect(P.fridgeState(2.0, 0.5)).toBe("near");
    expect(P.fridgeState(2.5, 0.5)).toBe("ok");
    expect(P.fridgeState(5, 0.5)).toBe("ok");
    expect(P.fridgeState(7.5, 0.5)).toBe("ok");
    expect(P.fridgeState(8.0, 0.5)).toBe("near");
    expect(P.fridgeState(8.1, 0.5)).toBe("out");
    expect(P.fridgeState(7.6, 1)).toBe("near");
  });
  it("readingSlot within ±90 minutes", () => {
    expect(P.readingSlot("06:30")).toBe("08:00");
    expect(P.readingSlot("06:29")).toBeNull();
    expect(P.readingSlot("09:30")).toBe("08:00");
    expect(P.readingSlot("09:31")).toBeNull();
    expect(P.readingSlot("18:30")).toBe("17:00");
  });
  it("typedDue: read, due, late", () => {
    const r = P.typedDue({ "08:00": 6.1 }, P.toMin("17:31"), 30);
    expect(r.map((c) => c.st)).toEqual(["ok", "late"]);
    expect(P.typedDue({}, P.toMin("16:00"), 30).map((c) => c.st)).toEqual(["late", "due"]);
  });
  it("deviceStatus: online under 15 minutes, offline, not in use", () => {
    const now = 10_000_000;
    expect(P.deviceStatus(now - 60_000, now)).toEqual({ k: "online", min: 1 });
    expect(P.deviceStatus(now - 15 * 60_000, now)).toEqual({ k: "offline", min: 15 });
    expect(P.deviceStatus(now - 600 * 60_000, now)).toEqual({ k: "none" });
    expect(P.deviceStatus(null, now)).toEqual({ k: "none" });
  });
  it("orderDue from the signed days, its tone, budget", () => {
    expect(P.orderDue("2026-11-16", "2026-11-03", 7)).toBe(6);
    expect(P.orderDue(null, "2026-11-03", 7)).toBeNull();
    expect([
      P.orderDueTone(6),
      P.orderDueTone(3),
      P.orderDueTone(15),
      P.orderDueTone(null),
    ]).toEqual(["warn", "bad", null, null]);
    expect(P.budgetPct(31_200_000, 48_000_000)).toBe(65);
    expect(P.budgetPct(5, 0)).toBe(0);
    expect(P.budgetPct(200, 100)).toBe(100);
    expect([P.budgetTone(65, 75, 90), P.budgetTone(75, 75, 90), P.budgetTone(90, 75, 90)]).toEqual([
      "ok",
      "warn",
      "bad",
    ]);
  });
  it("stockFlow from each place's supplier", () => {
    const f = P.stockFlow([
      { id: "s", name: "Main store", kind: "store", suppliedFrom: null, suppliers: ["NMS", "JMS"] },
      { id: "o", name: "OPD", kind: "dispensing_point", suppliedFrom: "s", suppliers: [] },
      { id: "e", name: "EPI clinic", kind: "clinic", suppliedFrom: null, suppliers: ["UNEPI"] },
    ]);
    expect(f.map((n) => n.label)).toEqual([
      "NMS · JMS",
      "Main store",
      "OPD",
      "UNEPI",
      "EPI clinic",
    ]);
    expect(f.find((n) => n.label === "OPD")!.sep).toBe(true);
  });
  it("canClose, cold without a fridge, slots from hours", () => {
    expect(P.canClose(94, false)).toBe("stock");
    expect(P.canClose(0, true)).toBe("handover");
    expect(P.canClose(0, false)).toBeNull();
    expect(P.coldWithoutFridge(1, 0)).toBe(true);
    expect(P.coldWithoutFridge(1, 1)).toBe(false);
    expect(P.coldWithoutFridge(0, 0)).toBe(false);
    expect(P.slotsForHours("24h")).toEqual(["08:00", "17:00"]);
    expect(P.slotsForHours("day")).toEqual(["08:00"]);
    expect(P.kampalaNow(Date.UTC(2026, 10, 3, 21, 30))).toEqual({ date: "2026-11-04", min: 30 });
  });
});

describe("Rules", () => {
  const rule = (g: string, k: string) =>
    RULE_REGISTRY.find((x) => x.key === g)!.rules.find((r) => r.key === k)!;
  it("ruleText pluralises units and puts no space before %", () => {
    expect(R.ruleText(rule("cold", "expiry_warning"))).toBe("Warn 90 days before expiry");
    expect(R.ruleText(rule("cold", "expiry_warning"), 1)).toBe("Warn 1 day before expiry");
    expect(R.ruleText(rule("price", "markup"))).toMatch(/25%/);
    expect(R.ruleText(rule("cold", "near_limit"))).toMatch(/0\.5 °C/);
  });
  it("validateParam: not a number, out of range, the same", () => {
    const p = rule("cold", "expiry_warning").param!;
    expect(R.validateParam("x", p, 90)).toBe("nan");
    expect(R.validateParam("400", p, 90)).toBe("range");
    expect(R.validateParam("90", p, 90)).toBe("same");
    expect(R.validateParam("120", p, 90)).toBeNull();
  });
  it("the proposer never second-signs; nobody signs twice", () => {
    const p = { proposedBy: "a", signedBy: ["b"], roles: ["in_charge"] as const };
    expect(R.canSecondSign(p, "a")).toBe(false);
    expect(R.canSecondSign(p, "b")).toBe(false);
    expect(R.canSecondSign(p, "c")).toBe(true);
    expect(R.canInChargeSign(p, "c")).toBe(false);
    expect(R.canInChargeSign({ proposedBy: "a", signedBy: [], roles: [] }, "a")).toBe(true);
    // ADR 0550: the head of pharmacy's signature alone applies the change.
    expect(R.applies(["in_charge", "second"])).toBe(true);
    expect(R.applies(["in_charge"])).toBe(true);
    expect(R.applies(["second"])).toBe(false);
    expect(R.applyProposal(90, { n: 120, applied: true })).toBe(120);
    expect(R.applyProposal(90, { n: 120, applied: false })).toBe(90);
  });
  it("searchRules by name, wording, applies-to and group", () => {
    expect(R.searchRules(RULE_REGISTRY, "").length).toBe(12);
    expect(
      R.searchRules(RULE_REGISTRY, "expiry").flatMap((g) => g.rules.map((r) => r.key)),
    ).toContain("expiry_warning");
    expect(R.searchRules(RULE_REGISTRY, "Messages")[0]!.rules.length).toBe(4);
    expect(R.searchRules(RULE_REGISTRY, "zzzz")).toEqual([]);
  });
});

describe("Messages", () => {
  it("smsParts at the GSM-7 and UCS-2 boundaries", () => {
    expect(M.smsParts("a".repeat(160))).toMatchObject({ gsm: true, parts: 1 });
    expect(M.smsParts("a".repeat(161)).parts).toBe(2);
    expect(M.smsParts("a".repeat(306)).parts).toBe(2);
    expect(M.smsParts("a".repeat(307)).parts).toBe(3);
    expect(M.smsParts(`—${"a".repeat(69)}`)).toMatchObject({ gsm: false, parts: 1 });
    expect(M.smsParts(`—${"a".repeat(70)}`).parts).toBe(2);
    expect(M.smsParts(`’${"a".repeat(133)}`).parts).toBe(2);
    expect(M.smsParts(`’${"a".repeat(134)}`).parts).toBe(3);
    expect(M.smsParts("").parts).toBe(0);
  });
  it("fillSample and the warnings: long, curly quote, no STOP, no Luganda", () => {
    expect(
      M.fillSample("{first name} on {date} {x}", { "first name": "Sarah", date: "Fri 6 Nov" }),
    ).toBe("Sarah on Fri 6 Nov {x}");
    expect(M.templateWarnings("Hi’ Reply STOP", "Hi’ Reply STOP", "patients", "en")).toEqual([
      "unicode",
    ]);
    expect(M.templateWarnings("Hi", "Hi", "patients", "en")).toEqual(["stop"]);
    expect(M.templateWarnings("Hi", "Hi", "staff", "en")).toEqual([]);
    expect(M.templateWarnings("", "", "patients", "lg")).toEqual(["noLuganda"]);
    const long = `${"a".repeat(310)} STOP`;
    expect(M.templateWarnings(long, long, "patients", "en")).toEqual(["long"]);
  });
  it("quiet hours, spend, budget tone at the signed cap", () => {
    expect([M.isQuiet(1199), M.isQuiet(1200), M.isQuiet(419), M.isQuiet(420)]).toEqual([
      false,
      true,
      true,
      false,
    ]);
    expect(
      M.spend([
        { parts: 2, costUgx: 35 },
        { parts: 1, costUgx: 35 },
      ]),
    ).toBe(105);
    expect([
      M.smsBudgetTone(60, 100),
      M.smsBudgetTone(80, 100),
      M.smsBudgetTone(100, 100),
      M.smsBudgetTone(90, 90),
    ]).toEqual(["ok", "warn", "bad", "bad"]);
  });
  it("normalisePhoneUG, maskPhone, Luganda only when checked, sender ID", () => {
    expect(M.normalisePhoneUG("0772418093")).toBe("+256 772 418 093");
    expect(M.normalisePhoneUG("+256 772 418 093")).toBe("+256 772 418 093");
    expect(M.normalisePhoneUG("256772418093")).toBe("+256 772 418 093");
    expect(M.normalisePhoneUG("0412345678")).toBeNull();
    expect(M.normalisePhoneUG("12345")).toBeNull();
    expect(M.e164UG("+256 772 418 093")).toBe("+256772418093");
    expect(M.maskPhone("+256 772 418 093")).toBe("+256 7•• ••• 093");
    expect(M.canSendLuganda({ lg: "x", lgCheckedAt: null })).toBe(false);
    expect(M.canSendLuganda({ lg: "x", lgCheckedAt: "2026-11-03" })).toBe(true);
    expect(M.canSendLuganda({ lg: null, lgCheckedAt: "2026-11-03" })).toBe(false);
    expect(M.senderId("medsync hq!-12345")).toBe("MEDSYNC HQ1");
  });
});
