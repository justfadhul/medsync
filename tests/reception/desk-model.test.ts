/** The desk's pure rules (lib/reception/desk/model.ts): age, code entry, arrivals grouping, tone, shortcuts. */
import { describe, expect, it } from "vitest";

import { busyMorning } from "@/lib/reception/desk/fixture";
import {
  ageOf,
  arrivals,
  codeHasBadChar,
  codeInput,
  codeSpoken,
  shortcut,
  tone,
} from "@/lib/reception/desk/model";

const T = { y: 2026, m: 11, d: 13 };

describe("age (RD8)", () => {
  it("year of birth gives about N and refuses under 18", () => {
    expect(ageOf({ mode: "year", yob: "1990" }, T)).toMatchObject({
      ok: true,
      age: 36,
      exact: false,
    });
    expect(ageOf({ mode: "year", yob: "2009" }, T).err).toBe(true); // may still be 17
    expect(ageOf({ mode: "year", yob: "2030" }, T).err).toBe(true);
  });
  it("a full date gives the exact age and the date", () => {
    expect(ageOf({ mode: "date", dd: "14", mm: "11", yy: "1990" }, T)).toMatchObject({
      ok: true,
      age: 35,
      dob: "1990-11-14",
    });
    expect(ageOf({ mode: "date", dd: "31", mm: "02", yy: "1990" }, T).err).toBe(true);
  });
  it("age only is flagged and bounded", () => {
    expect(ageOf({ mode: "age", ag: "40" }, T)).toMatchObject({
      ok: true,
      age: 40,
      show: "about 40",
    });
    expect(ageOf({ mode: "age", ag: "121" }, T).err).toBe(true);
  });
});

describe("check in by code (D-RD-10)", () => {
  it("keeps letters and digits, upper case, six at most", () => {
    expect(codeInput("k7m-42 qx")).toBe("K7M42Q");
    expect(codeSpoken("K7M42Q")).toBe("K7M 42Q");
    expect(codeHasBadChar("K7L42Q")).toBe(true);
    expect(codeHasBadChar("K7M42Q")).toBe(false);
  });
});

describe("arrivals", () => {
  const d = busyMorning();
  const on = Object.fromEntries(d.mine.map((id) => [id, true]));
  it("groups Expected by arrival window and counts each stage", () => {
    const v = arrivals(d.rows, { on, tab: "expected", clinic: "", qf: "", sort: "time", q: "" });
    expect(v.groups[0]!.label).toBe("Arriving 08:00–09:00");
    expect(v.counts.expected).toBe(d.rows.filter((r) => r.stage === "expected").length);
  });
  it("closest first puts the nearest on the way at the top", () => {
    const v = arrivals(d.rows, { on, tab: "expected", clinic: "", qf: "", sort: "near", q: "" });
    expect(v.groups[0]!.label).toBe("On the way, nearest first");
    expect(v.shown[0]!.name).toBe("Agnes Nakato");
  });
  it("search ignores the stage tab", () => {
    expect(
      arrivals(d.rows, {
        on,
        tab: "done",
        clinic: "",
        qf: "",
        sort: "time",
        q: "k7m42q",
      }).shown.map((r) => r.name),
    ).toEqual(["Agnes Nakato"]);
  });
});

describe("calendar tone and shortcuts", () => {
  it("colours by order: past, running, next, future", () => {
    const today = "2026-11-13";
    expect(tone({ date: "2026-11-12", st: 8, en: 12 }, today, 8.7)).toBe("done");
    expect(tone({ date: today, st: 8, en: 12 }, today, 8.7)).toBe("run");
    expect(tone({ date: today, st: 9, en: 12 }, today, 8.7)).toBe("next");
    expect(tone({ date: "2026-11-14", st: 8, en: 12 }, today, 8.7)).toBe("fut");
  });
  it("pauses while typing and inside a dialog", () => {
    expect(shortcut({ key: "c" }, false)).toBe("code");
    expect(
      shortcut({ key: "c", target: { tagName: "INPUT" } as unknown as EventTarget }, false),
    ).toBeNull();
    expect(shortcut({ key: "c" }, true)).toBeNull();
    expect(shortcut({ key: "?" }, true)).toBe("keys");
    expect(shortcut({ key: "c", metaKey: true }, false)).toBeNull();
  });
});
