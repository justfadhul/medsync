import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ClinicSession, DayOption, ServiceLineLite } from "@patient-core/book-days";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { attachmentPath, storedMime } from "@patient-core/book-attachments";
import {
  addDays,
  clinicDays,
  dayState,
  firstOpenDay,
  mergeDays,
  monthGrid,
  resolveDay,
  slotDays,
} from "@patient-core/book-days";
import { interruptOf } from "@patient-core/symptoms";
import { describe, expect, it } from "vitest";

import { WhyComing } from "@/app/pw/patient/book/_components/why-coming";
import { BOOK_COPY, PLANNED_GROUPS } from "@/content/patient/book";
import { PATIENT_REASON_CODES } from "@/supabase/functions/_shared/sessions-sql";
import { CATALOG } from "@/supabase/functions/_shared/symptom-catalog/catalog.v0.1";
import { classify } from "@/supabase/functions/_shared/symptom-catalog/classify";

/** Book (Step 4): the planned reasons, the honesty sentence, the open days and the S10 interrupt. */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const free = { posture: "free", baseFeeUgx: null, lineName: "General", cadreFees: [] };
const paid = (ugx: number) => ({
  posture: "paid",
  baseFeeUgx: ugx,
  lineName: "Paid",
  cadreFees: [],
});
const line = (id: string, reasons: string[], fee: object = free): ServiceLineLite => ({
  id,
  name: `Line ${id}`,
  departmentId: "dep",
  departmentName: "Outpatients",
  reasonCodes: reasons,
  fee: fee as ServiceLineLite["fee"],
});
const session = (id: string, iso: string, extra: Partial<ClinicSession> = {}): ClinicSession => ({
  id,
  serviceLineId: "L1",
  startsAtIso: iso,
  clinicianUserId: "doc-1",
  clinicianName: "Dr A",
  venue: null,
  placesLeft: 3,
  ...extra,
});

describe("Book a visit", () => {
  it("lists the twelve planned-care reasons, every one a real code and none of them new_concern", () => {
    const reasons = PLANNED_GROUPS.flatMap((g) => g.reasons.map((r) => r.reason));
    expect(reasons).toHaveLength(12);
    expect(new Set(reasons).size).toBe(12);
    expect(reasons).not.toContain("new_concern");
    for (const r of reasons) expect(PATIENT_REASON_CODES).toContain(r);
  });

  it("S12: the honesty sentence is the phone's, word for word", () => {
    expect(read("mobile/src/features/visits/parts.tsx")).toContain(`"${BOOK_COPY.honest}"`);
    expect(BOOK_COPY.honest).toBe("We save your place in line. We cannot tell you the hour.");
  });

  it("S9: Come today is off for someone else, with its sentence", () => {
    const src = read("app/pw/patient/book/_components/book-form.tsx");
    expect(src).toMatch(/todayOff = who !== null/);
    expect(src).toMatch(/todayOff \? C\.comeTodayOff : C\.honest/);
  });
});

describe("Why are you coming?", () => {
  const why = (areas: { key: string; label: string }[] | null) =>
    renderToStaticMarkup(
      h(WhyComing, {
        door: null,
        onDoor: () => {},
        reason: null,
        onReason: () => {},
        areas,
        wrongHref: () => "/patient/book/wrong",
      }),
    );

  it("G1: with the catalogue off there is no Something is wrong door, only the planned list", () => {
    const off = why(null);
    expect(off).not.toContain(BOOK_COPY.doorWrong);
    expect(off).toContain(PLANNED_GROUPS[0]!.reasons[0]!.label);
  });

  it("with the catalogue on, both doors and nothing chosen yet", () => {
    const on = why([{ key: "head", label: "Head" }]);
    expect(on).toContain(BOOK_COPY.doorWrong);
    expect(on).not.toContain(PLANNED_GROUPS[0]!.reasons[0]!.label);
  });
});

describe("Ask for a day", () => {
  const today = "2026-10-25";

  it("groups clinic days by day, only for lines that take the reason and days that name a clinician", () => {
    const days = clinicDays(
      [
        session("a", "2026-10-27T06:00:00Z"),
        session("b", "2026-10-27T11:00:00Z"),
        session("c", "2026-10-28T06:00:00Z", { clinicianUserId: null }),
        session("d", "2026-10-29T06:00:00Z", { serviceLineId: "L2" }),
      ],
      [line("L1", ["follow_up"]), line("L2", ["antenatal"])],
      "follow_up",
    );
    expect(days.map((d) => d.key)).toEqual(["2026-10-27"]);
    expect(days[0]!.sessions.map((s) => s.part)).toEqual(["Morning", "Afternoon"]);
    expect(days[0]!.sessions[0]!.doors).toBe("09:00");
  });

  it("the calendar opens the first open day within the window, never before today or past 60 days", () => {
    const open = new Set(["2026-10-20", "2026-10-30", addDays(today, 61)]);
    expect(firstOpenDay(today, open)).toBe("2026-10-30");
    expect(dayState("2026-10-20", today, open)).toBe("out");
    expect(dayState("2026-10-26", today, open)).toBe("closed");
    expect(monthGrid("2026-10-01").length % 7).toBe(0);
  });

  it("resolves a full morning to the afternoon, and Any doctor to the cheapest open place", () => {
    const days: DayOption[] = clinicDays(
      [
        session("m", "2026-10-27T06:00:00Z", { placesLeft: 0 }),
        session("p1", "2026-10-27T11:00:00Z", { clinicianName: "Dr B" }),
        session("p2", "2026-10-27T11:30:00Z", { serviceLineId: "L3", clinicianName: "Dr C" }),
      ],
      [line("L1", ["follow_up"], paid(30_000)), line("L3", ["follow_up"], paid(10_000))],
      "follow_up",
    );
    const r = resolveDay(days, today, false, {
      picked: null,
      part: "Morning",
      whoId: null,
      slotId: null,
    });
    expect(r.chosenPart).toBe("Afternoon");
    expect(r.session?.id).toBe("p2");
    const named = resolveDay(days, today, false, {
      picked: null,
      part: null,
      whoId: "p1",
      slotId: null,
    });
    expect(named.session?.id).toBe("p1");
  });

  it("a named doctor's day offers each slot, the first until another is chosen", () => {
    const doc = {
      userId: "doc-9",
      fullName: "Dr Z",
      cadreId: null,
      departmentId: "dep",
      departmentName: "Outpatients",
      slotsByDate: {
        "2026-10-28": [
          { startsAtIso: "2026-10-28T07:20:00Z", endsAtIso: "2026-10-28T07:40:00Z" },
          { startsAtIso: "2026-10-28T07:00:00Z", endsAtIso: "2026-10-28T07:20:00Z" },
        ],
      },
    };
    const days = mergeDays(slotDays(doc, [line("L1", ["follow_up"])], "follow_up"), []);
    const r = resolveDay(days, today, true, {
      picked: null,
      part: null,
      whoId: null,
      slotId: null,
    });
    expect(r.slots.map((s) => s.slot?.startsAtIso)).toEqual([
      "2026-10-28T07:00:00Z",
      "2026-10-28T07:20:00Z",
    ]);
    expect(r.session?.slot?.serviceLineId).toBe("L1");
  });

  it("attachments: the bucket's types only, in the uploader's folder", () => {
    expect(storedMime("voice", "audio/webm;codecs=opus")).toBe("audio/webm");
    expect(storedMime("photo", "image/gif")).toBeNull();
    expect(storedMime("photo", "")).toBe("image/jpeg");
    expect(attachmentPath("u", "a", "image/png", "x")).toBe("u/a/x.png");
  });
});

const flagsOf = (i: { flags?: readonly string[] }) => i.flags ?? [];

describe("Something is wrong", () => {
  const emergency = CATALOG.items.find(
    (i) => i.tier === "E" && !flagsOf(i).includes("crisis_route"),
  )!;
  const crisis = CATALOG.items.find((i) => flagsOf(i).includes("crisis_route"));

  it("S10: an emergency sign opens the panel; unticked, it closes", () => {
    const sel = {
      audience: "adult" as const,
      pregnant: false,
      items: [emergency.key],
      qualifiers: {},
    };
    expect(interruptOf(sel, [], CATALOG)?.key).toBe(emergency.key);
    expect(interruptOf({ ...sel, items: [] }, [], CATALOG)).toBeNull();
  });

  it("S10: a self-harm sign is the calm route, not the red one", () => {
    if (!crisis) return;
    expect(flagsOf(crisis)).toContain("crisis_route");
  });

  it("the red panel and the calm panel live in one allow-listed file; the steps never paint red", () => {
    const steps = read("app/pw/patient/book/wrong/_components/wrong-steps.tsx");
    expect(steps).not.toMatch(/pw-(emergency|critical)/);
    expect(read("components/tide/book-danger.tsx")).toMatch(/if \(calm\)/);
  });

  it("the local tier is advisory: the steps take the server's tier once it answers (S11)", () => {
    const src = read("app/pw/patient/book/wrong/_components/wrong-steps.tsx");
    expect(src).toMatch(/tier: s\.tier/);
    expect(src).toMatch(/if \(submissionRef\.current\) return submissionRef\.current/);
    expect(
      classify({ audience: "adult", items: [emergency.key], qualifiers: {} }, CATALOG).tier,
    ).toBe("E");
  });
});
