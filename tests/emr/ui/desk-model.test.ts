import type { NoteContent } from "@/lib/emr/note-rules";
import { describe, expect, it } from "vitest";

import {
  addComplaint,
  atEmptyLineStart,
  committedWords,
  deskIndex,
  deskKey,
  deskValidation,
  durationWords,
  findingState,
  gridState,
  initialContent,
  markSystemAbsent,
  parseDuration,
  requiredCount,
  saveWords,
  sectionPosition,
  sectionWith,
  setFinding,
  setGrid,
  syncRecorded,
} from "@/components/emr/desk/model";
import { keystrokesFor, rank } from "@/components/emr/desk/search";
import raw from "@/data/emr/diagnosis-terms.v1.json";
import { noteBornItems } from "@/lib/emr/notes";
import { internAwaitingCosign, standardVisitMidway } from "./desk-fixtures";

/** The desk's pure model: keys, content edits, signing check, index, save words, search. */

const at = { current: 3, count: 14 };
const empty: NoteContent = { sections: {} };

describe("keyboard (UI-BRIEF §4): a pure map, off inside text fields but for the sign chord", () => {
  it("j and k move one section, clamped at the ends", () => {
    expect(deskKey({ key: "j", inField: false }, at)).toEqual({ type: "section", index: 4 });
    expect(deskKey({ key: "k", inField: false }, at)).toEqual({ type: "section", index: 2 });
    expect(deskKey({ key: "k", inField: false }, { current: 0, count: 14 })).toBeNull();
    expect(deskKey({ key: "j", inField: false }, { current: 13, count: 14 })).toBeNull();
  });
  it("j, k and ? do nothing inside a text field", () => {
    for (const key of ["j", "k", "?"]) expect(deskKey({ key, inField: true }, at)).toBeNull();
  });
  it("Ctrl+Enter and Cmd+Enter sign, even inside a text field", () => {
    expect(deskKey({ key: "Enter", ctrlKey: true, inField: true }, at)).toEqual({ type: "sign" });
    expect(deskKey({ key: "Enter", metaKey: true, inField: false }, at)).toEqual({ type: "sign" });
    expect(deskKey({ key: "Enter", inField: false }, at)).toBeNull();
  });
  it("/ opens the insert menu outside a field, or at the start of an empty line", () => {
    expect(deskKey({ key: "/", inField: false }, at)).toEqual({ type: "insert" });
    expect(deskKey({ key: "/", inField: true, atEmptyLineStart: true }, at)).toEqual({
      type: "insert",
    });
    expect(deskKey({ key: "/", inField: true, atEmptyLineStart: false }, at)).toBeNull();
  });
  it("? opens help; modifiers other than the sign chord pass through", () => {
    expect(deskKey({ key: "?", inField: false }, at)).toEqual({ type: "help" });
    expect(deskKey({ key: "j", ctrlKey: true, inField: false }, at)).toBeNull();
    expect(deskKey({ key: "Enter", ctrlKey: true, altKey: true, inField: false }, at)).toBeNull();
  });
  it("atEmptyLineStart reads the caret against its line", () => {
    expect(atEmptyLineStart("", 0)).toBe(true);
    expect(atEmptyLineStart("fever\n", 6)).toBe(true);
    expect(atEmptyLineStart("fever\nchills", 6)).toBe(false);
    expect(atEmptyLineStart("fever", 5)).toBe(false);
  });
});

describe("content edits", () => {
  const chills = { token: "chills", label: "Chills" };
  it("a finding cycles through present and absent; not asked leaves no item (CFC C3)", () => {
    let c = setFinding(empty, "s02", chills, "present");
    expect(findingState(c, "s02", chills)).toBe("present");
    c = setFinding(c, "s02", chills, "absent");
    expect(c.sections.s02!.items).toHaveLength(1);
    c = setFinding(c, "s02", chills, "not_asked");
    expect(c.sections.s02!.items).toEqual([]);
  });
  it("words typed with no token keep their own identity", () => {
    let c = addComplaint(empty, "s01", { token: "", label: "Back pain" });
    c = addComplaint(c, "s01", { token: "", label: "Dizziness" }, 2);
    expect(c.sections.s01!.items).toHaveLength(2);
    expect(c.sections.s01!.items![0]).not.toHaveProperty("token");
  });
  it("the review of systems grid defaults to not asked; Mark the rest as absent keeps answers", () => {
    const sys = standardVisitMidway().ros[0]!;
    let c = setGrid(empty, "s03", "ros_grid", [{ t: sys.items[0]!, state: "present" }]);
    expect(gridState(c, "s03", "ros_grid", sys.items[1]!.token)).toBe("not_asked");
    c = markSystemAbsent(c, "s03", sys);
    expect(sys.items.map((t) => gridState(c, "s03", "ros_grid", t.token))).toEqual([
      "present",
      "absent",
      "absent",
    ]);
  });
  it("note-born items are the shapes signing commits (lib/emr/notes noteBornItems)", () => {
    const p = standardVisitMidway();
    const born = noteBornItems(p.draft!.content).map((b) => b.item.kind);
    expect(born).toEqual([
      "complaint_token",
      "complaint_token",
      "finding",
      "finding",
      "finding",
      "exam_finding",
    ]);
    expect(committedWords(p.draft!.content)).toBe("5 findings, 7 examination signs");
  });
  it("durations read days, weeks and months, and say them back in words", () => {
    expect(parseDuration("3")).toBe(3);
    expect(parseDuration("2w")).toBe(14);
    expect(parseDuration("1 month")).toBe(30);
    expect(parseDuration("soon")).toBeNull();
    expect(durationWords(14)).toBe("2 weeks");
    expect(durationWords(1)).toBe("1 day");
  });
  it("a new draft starts with the triage complaint, marked, zero taps; vitals are not copied", () => {
    const t = standardVisitMidway().template;
    const c = initialContent(t, "Fever for three days");
    expect(c.sections.s01!.items).toEqual([
      { kind: "complaint_token", label: "Fever for three days", source: "triage" },
    ]);
    expect(JSON.stringify(c)).not.toMatch(/vital/);
    expect(initialContent(t, "  ")).toEqual({ sections: {} });
  });
  it("the chart's diagnoses and orders are mirrored into the note, once", () => {
    const p = standardVisitMidway();
    const c = syncRecorded(empty, p);
    expect(c.sections.s13!.items![0]).toMatchObject({
      kind: "encounter_diagnosis",
      rank: "primary",
    });
    expect(c.sections.s14!.items![0]).toMatchObject({ kind: "order" });
    expect(syncRecorded(c, p)).toBe(c);
  });
});

describe("signing check and the index", () => {
  it("the standard visit midway is signable: required 3/3, allergy status recorded", () => {
    const p = standardVisitMidway();
    const v = deskValidation(p, p.draft!.content);
    expect(v.canSign).toBe(true);
    expect(requiredCount(p, v)).toEqual({ met: 3, of: 3 });
    expect(v.warnings).toEqual([]);
  });
  it("an empty note misses the complaint, impression and plan, and says so", () => {
    const p = standardVisitMidway();
    const v = deskValidation(p, empty);
    expect(v.canSign).toBe(false);
    expect(v.missing.map((m) => m.id)).toEqual(["req.complaint", "req.impression", "req.plan"]);
    expect(v.warnings.map((w) => w.id)).toEqual(["warn.examination"]);
  });
  it("unreconciled medicines and a missing allergy status mark the index amber in words", () => {
    const p = standardVisitMidway();
    p.carried.medicines[0]!.answer = "pending";
    p.safetyBar = {
      ...p.safetyBar,
      allergy: {
        state: "not_recorded",
        text: "Allergy status not recorded",
        tone: "caution",
        items: [],
      },
    };
    const idx = deskIndex(p, p.draft!.content);
    expect(idx.find((e) => e.id === "s06")!.caution).toBe("Not reconciled");
    expect(idx.find((e) => e.id === "s07")!.caution).toBe("Not recorded");
    expect(idx.filter((e) => e.required).map((e) => e.id)).toEqual(["s01", "s13", "s14"]);
    expect(deskValidation(p, p.draft!.content).warnings.map((w) => w.id)).toContain(
      "warn.allergy_status",
    );
  });
  it("the phone's section position counts the visible sections, never the template's numbering", () => {
    const p = standardVisitMidway(); // male: s10 (obstetric) hidden, so s11 is the tenth shown
    const idx = deskIndex(p, p.draft!.content);
    expect(idx).toHaveLength(13);
    expect(sectionPosition(idx, "s02")).toBe("02 of 13");
    expect(sectionPosition(idx, "s11")).toBe("10 of 13");
  });

  it("sections come from the template: the obstetric history only for a female patient", () => {
    expect(standardVisitMidway().template.sections.map((s) => s.id)).not.toContain("s10");
    expect(internAwaitingCosign().template.sections.map((s) => s.id)).toContain("s10");
    expect(sectionWith(standardVisitMidway().template, "exam_finding:general")).toBe("s11");
  });
});

describe("save words (no motion: a text swap)", () => {
  const time = () => "10:42";
  const s = { online: true, waiting: 0, failed: null, savedAt: null, dirty: false };
  it("neutral when saved or saving, amber when offline or failed", () => {
    expect(saveWords({ ...s, savedAt: "x" }, time)).toEqual({
      tone: "neutral",
      text: "Saved 10:42",
    });
    expect(saveWords({ ...s, dirty: true }, time).text).toBe("Saving");
    expect(saveWords({ ...s, online: false, waiting: 3 }, time)).toEqual({
      tone: "caution",
      text: "Offline, changes kept on this page (3 waiting)",
    });
    expect(saveWords({ ...s, failed: "conflict" }, time).tone).toBe("caution");
  });
});

describe("diagnosis search (≤ 4 keystrokes + Enter for the top 50)", () => {
  const terms = (
    raw as {
      terms: { id: string; display: string; synonyms: string[]; icd11: { code: string } | null }[];
    }
  ).terms.map((t) => ({
    id: t.id,
    display: t.display,
    synonyms: t.synonyms,
    icd11: t.icd11?.code ?? null,
  }));
  const index = [...terms].sort((a, b) => a.display.localeCompare(b.display));
  it("every one of the first 50 terms is under the cursor within 4 keystrokes", () => {
    const over = terms.slice(0, 50).filter((t) => keystrokesFor(index, t) > 4);
    expect(over.map((t) => t.display)).toEqual([]);
  });
  it("ranks display prefix first, then synonyms, then codes; every query word must match", () => {
    expect(rank(index, "malar")[0]!.display).toMatch(/^Malaria/);
    expect(rank(index, "omusujja").map((t) => t.display)).toContain("Fever, cause not yet known");
    expect(rank(index, "MG26")[0]!.display).toBe("Fever, cause not yet known");
    expect(rank(index, "malaria zzz")).toEqual([]);
  });
});
