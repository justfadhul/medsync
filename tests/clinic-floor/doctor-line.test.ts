/**
 * The doctor's Clinic line (ADR 0532): the line for you and for the whole clinic, the triage scores on the card,
 * the actions pinned, and the real MedSync encounter opened from the card on the Tether domain, without the
 * diabetes pack (owner, 23 Nov 2026: "faithful to the existing encounter system").
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { bookedFor } from "@/lib/clinic-floor/model";
import { tetherClosed } from "@/lib/landing/feature";

const read = (f: string) => readFileSync(f, "utf8");

describe("the line: for you, and the whole clinic", () => {
  const me = "d1";
  it("says who each person is booked for", () => {
    expect(bookedFor({ doctorUserId: "d1" }, me)).toBe("you");
    expect(bookedFor({ doctorUserId: null }, me)).toBe("any");
    expect(bookedFor({ doctorUserId: "d2" }, me)).toBe("other");
  });
  it("the floor passes both lines and the view offers both", () => {
    expect(read("components/clinic-floor/floor.tsx")).toContain("clinicLine={clinicLine}");
    expect(read("components/clinic-floor/line.tsx")).toMatch(
      /const shown = whole \? clinicLine : mine/,
    );
  });
});

describe("the card: scores, a tighter layout and the actions always in view", () => {
  const src = read("components/clinic-floor/line.tsx");
  it("shows the triage scores from the engine, not just the raw vitals", () => {
    expect(src).toContain("<Scores p={p} now={ctx.now} />");
    expect(src).toContain("otherScores(");
  });
  it("keeps the actions pinned at the bottom of the card", () => {
    expect(read("components/reception/desk.module.css")).toMatch(
      /\.cf-na \{[^}]*position: sticky;[^}]*bottom: 0/,
    );
  });
  it("folds trends and earlier visits away", () => {
    expect(src).toMatch(/<details[\s\S]*<Trends p=\{p\} \/>/);
  });
});

describe("the encounter is MedSync's own desk", () => {
  it("opens from the card through MedSync's own take-patient action, or links to the open one", () => {
    const src = read("components/clinic-floor/line.tsx");
    expect(src).toContain("takePatientAction({ intakeId: p.id, overrideReason })");
    expect(src).toContain("`/doctor/encounters/${p.encounter.id}`");
  });
  it("the loader finds each visit's encounter and whether the desk is on here", () => {
    const load = read("lib/clinic-floor/load.ts");
    expect(load).toMatch(/\bencounterLive[,:]/);
    expect(load).toMatch(/inArray\(\s*encounters\.triageRecordId/);
  });
  it("Tether serves an encounter page, and only that from the doctor's workspace", () => {
    expect(tetherClosed("/doctor/encounters/7c1f0d3e-0000-4000-8000-000000000001")).toBe(false);
    expect(tetherClosed("/doctor/encounters/7c1f0d3e-0000-4000-8000-000000000001/print")).toBe(
      false,
    );
    expect(tetherClosed("/doctor/encounters")).toBe(true);
    expect(tetherClosed("/doctor")).toBe(true);
    expect(tetherClosed("/doctor/patients/x")).toBe(true);
  });
  it("on Tether the desk runs without the diabetes pack and goes back to the line", () => {
    const desk = read("app/doctor/encounters/[encounterId]/_desk/desk-page.tsx");
    expect(desk).toMatch(/const tether = isTetherHost\(/);
    expect(desk).toMatch(/const dmDesk = !tether && /);
    expect(desk).toMatch(/if \(!tether && p\.flags\.ncd && p\.draft\)/);
    expect(desk).toContain('{ href: "/clinic?view=line", label: "Clinic line" }');
    // The Tether look: the same switch the Tether pages use, forced on the Tether domain.
    // Not forced light: MedSync's own desk keeps Tide Navy dark, and so does Tether's.
    expect(desk).toContain('<TideScope group="doctor" force={tether}>');
    expect(desk).toContain('data-tether-desk={tether ? "" : undefined}');
    expect(read("app/globals.css")).toContain(":root:has([data-tether-desk])");
  });
  it("the Tether layout's hooks are still on the desk", () => {
    // app/globals.css places the desk by these hooks and this order; a change here breaks the Tether layout.
    const desk = read("components/clerking/clerking-desk.tsx");
    for (const slot of ["clerking-desk", "safety-bar", "clerking-steps", "desk-actions"])
      expect(read("app/globals.css")).toContain(`[data-slot="${slot}"]`);
    expect(desk).toMatch(/data-slot="clerking-desk"/);
    expect(desk).toMatch(/data-slot="clerking-steps"/);
    expect(read("components/clerking/rail.tsx")).toMatch(
      /title="Triage"[\s\S]*title="Vital signs"[\s\S]*title="Results"[\s\S]*title="Medicines"[\s\S]*title="Problems"/,
    );
    // The grid switches with the desk's own xl: classes.
    expect(read("app/globals.css")).toContain("@media (min-width: 80rem)");
  });
});

describe("the line's fixes from review", () => {
  const line = read("components/clinic-floor/line.tsx");
  it("Call next is the doctor's own next, and another doctor's patient has no Call", () => {
    expect(line).toContain("const next = mine[0] ? byId.get(mine[0].intakeId) : undefined;");
    expect(line).toContain('viewOnly || bookedFor(r, me) === "other"');
  });
  it("a provisional NEWS2 says so, and a death on record asks for a reason", () => {
    expect(line).toMatch(/n\.provisional\s*\?\s*TD\.tiles\.provisional/);
    expect(line).toContain("<DeathConfirm");
    expect(line).toMatch(/takePatientAction\(\{ intakeId: p\.id, overrideReason \}\)/);
  });
  it("only an open or finished encounter shows on the card, the open one first", () => {
    const load = read("lib/clinic-floor/load.ts");
    expect(load).toContain('inArray(encounters.state, ["in_progress", "completed"])');
    expect(load).toContain('e.state === "in_progress"');
  });
});
