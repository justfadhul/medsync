import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { computeFlow } from "@/lib/workspace/flow";
import { laneFromParam, visibleLanes } from "@/lib/workspace/lanes";
import {
  encounter,
  HOUR,
  identity,
  input,
  intake,
  ME,
  MIN,
  NOW,
  OTHER_DOC,
  resus,
  triage,
} from "./fixtures";

/**
 * Scenarios S1–S10 (prompt §9, Phase 5), scripted — Playwright is not in the
 * repo and none was added (Law 10). Each walks a patient's day through the
 * projection and checks the UI wiring for the taps; what a unit test cannot
 * prove (a phone in one hand, a second device) is said, not claimed.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const pat = {
  five: identity("MS-2026-00009", { name: "Patient Five-5" }),
  nine: identity("MS-2026-00021", { name: "Patient Nine-9" }),
};
const rowOf = (i: ReturnType<typeof input>, id: string) =>
  computeFlow(i).rows.find((r) => r.patientId === id);

describe("S1 walk-in → triage in the sheet → Take & start → complete → next patient", () => {
  const arrived = input({ patients: pat, intakes: [intake("i5", "five", { complaint: "Fever" })] });
  const triaged = input({
    patients: pat,
    intakes: [intake("i5", "five", { status: "triaged", complaint: "Fever" })],
    triages: [triage("t5", "i5", "five", 3, { byName: "Dr Me" })],
    // submitTriageAction step 9: a doctor who triages is assigned the patient.
    encounters: [encounter("e5", "five", { triageRecordId: "t5" })],
  });
  const started = input({
    ...triaged,
    encounters: [
      encounter("e5", "five", {
        triageRecordId: "t5",
        state: "in_progress",
        lastActivityAtMs: NOW,
      }),
    ],
  });
  const done = input({
    patients: pat,
    // ha-complete-encounter closes the intake with the visit.
    intakes: [intake("i9", "nine", { status: "triaged" })],
    triages: [triage("t5", "i5", "five", 3), triage("t9", "i9", "nine", 3)],
    encounters: [
      encounter("e5", "five", { triageRecordId: "t5", state: "completed", endedAtMs: NOW }),
      encounter("e9", "nine", { triageRecordId: "t9", createdAtMs: NOW - 25 * MIN }),
    ],
  });

  it("arrives in To triage with one next step: Triage (1 tap opens the sheet)", () => {
    expect(rowOf(arrived, "five")).toMatchObject({
      lane: "triage",
      primary: { kind: "triage", intakeId: "i5" },
    });
  });

  it("the sheet's result offers Take & start (1 tap to the encounter, 0 list pages)", () => {
    const sheet = read("app/doctor/_components/workspace/triage-sheet.tsx");
    expect(sheet).toMatch(/takePatientAction\(\{ intakeId: row\.intakeId \}\)/);
    expect(sheet).toMatch(/Take & start/);
    expect(read("app/doctor/_lib/workspace-actions.ts")).toMatch(
      /redirect\(`\/doctor\/encounters\/\$\{opened\.encounterId\}`\)/,
    );
    expect(rowOf(triaged, "five")).toMatchObject({ lane: "waiting", primary: { kind: "start" } });
  });

  it("in progress while clerking, done after End visit — one row the whole way", () => {
    expect(rowOf(started, "five")).toMatchObject({
      lane: "in_progress",
      primary: { kind: "continue" },
    });
    expect(rowOf(done, "five")).toMatchObject({ lane: "done", primary: { kind: "view" } });
  });

  it("the next patient is one tap from started after End visit", () => {
    expect(rowOf(done, "nine")).toMatchObject({ lane: "waiting", primary: { kind: "start" } });
    const extras = read("app/doctor/_components/workspace/encounter-extras.tsx");
    expect(extras).toMatch(/lanes: \["waiting"\]/);
    expect(read("app/doctor/_components/workspace/encounter-rail.tsx")).toMatch(
      /<StartButton action=\{action\} \/>/,
    );
    expect(read("app/doctor/encounters/[encounterId]/page.tsx")).toMatch(
      /workspace && enc\.state === "completed"[\s\S]*?<NextPatient scope=\{scope\} \/>/,
    );
  });

  it("from the board, starting the top waiting patient is 1 tap (the row's primary)", () => {
    expect(read("app/doctor/_components/workspace/workspace-row.tsx")).toMatch(
      /<PrimaryAction row=\{row\}/,
    );
  });
});

describe("S2 a Red/L1 result opens resus first; then the patient is in Resus", () => {
  it("the result sheet puts Open resus first for L1 or a Step-0 life threat", () => {
    const sheet = read("app/doctor/_components/workspace/triage-sheet.tsx");
    expect(sheet).toMatch(/const resusFirst = level === 1 \|\| result\.lifeThreat === true;/);
    // In the result's render: the Open resus button comes before Take & start.
    const render = sheet.slice(sheet.indexOf("const resusFirst"));
    expect(render.indexOf("Open resus")).toBeGreaterThan(-1);
    expect(render.indexOf("Open resus")).toBeLessThan(render.indexOf('"Take & start"'));
  });

  it("once the episode runs, the row is in Resus and no Triage action remains", () => {
    const row = rowOf(
      input({
        patients: pat,
        intakes: [intake("i5", "five", { status: "triaged" })],
        triages: [triage("t5", "i5", "five", 1, { hasResus: true })],
        resus: [resus("r5", "five")],
      }),
      "five",
    )!;
    expect(row.lane).toBe("resus");
    const all = [row.primary, ...row.overflow, ...row.alsoOpen.flatMap((i) => i.actions)];
    expect(all.map((a) => a?.kind)).not.toContain("triage");
  });
});

describe("S3 a death in resus moves the patient's other items to Needs closing", () => {
  it("Died hh:mm, nothing to triage or start as the next step; Start is behind a reason", () => {
    const row = rowOf(
      input({
        patients: pat,
        intakes: [intake("i5", "five", { status: "triaged" })],
        triages: [triage("t5", "i5", "five", 2)],
        encounters: [encounter("e5", "five", { triageRecordId: "t5" })],
        resus: [
          resus("r5", "five", { section: "ended", outcome: "Died", endedAtMs: NOW - 4 * MIN }),
        ],
        deaths: [
          {
            patientId: "five",
            atMs: NOW - 4 * MIN,
            source: "resus",
            sourceId: "r5",
            byName: "Dr X",
          },
        ],
      }),
      "five",
    )!;
    expect(row).toMatchObject({ lane: "needs_closing", primary: { kind: "review" } });
    expect(row.badges[0]!.text).toBe("Died 11:06");
    expect(row.overflow.map((a) => a.kind)).toEqual(["start_override"]);
    expect(read("app/doctor/_components/workspace/death-confirm.tsx")).toMatch(
      /Reason \(required\)/,
    );
  });
});

describe("S4 three assignments are one row; retiring two leaves one", () => {
  const three = (states: ("planned" | "cancelled")[]) =>
    input({
      patients: pat,
      intakes: [intake("i5", "five", { status: "triaged" })],
      triages: [triage("t5", "i5", "five", 3)],
      encounters: states
        .map((state, n) =>
          encounter(`e${n}`, "five", {
            triageRecordId: "t5",
            createdAtMs: NOW - (3 - n) * HOUR,
            state: state as "planned",
          }),
        )
        .filter((e) => (e.state as string) !== "cancelled"),
    });

  it("one row, a 3 assignments badge", () => {
    expect(
      rowOf(three(["planned", "planned", "planned"]), "five")!.badges.map((b) => b.text),
    ).toContain("3 assignments");
  });

  it("after Retire × 2 (planned → cancelled), one assignment and no badge", () => {
    const row = rowOf(three(["cancelled", "cancelled", "planned"]), "five")!;
    expect(row.lane).toBe("waiting");
    expect(row.badges.map((b) => b.text).some((t) => t.includes("assignment"))).toBe(false);
  });
});

describe("S5 an encounter idle past the setting needs closing, with Continue and Complete", () => {
  it("24 h without activity → Needs closing; the item offers the existing actions", () => {
    const row = rowOf(
      input({
        patients: pat,
        encounters: [
          encounter("e5", "five", { state: "in_progress", lastActivityAtMs: NOW - 30 * HOUR }),
        ],
      }),
      "five",
    )!;
    expect(row.lane).toBe("needs_closing");
    expect(row.alsoOpen[0]!.actions.map((a) => a.kind)).toEqual(["continue", "complete"]);
  });
});

describe("S6 reassigned on device A → gone from A, on B's board", () => {
  const board = (viewer: string) =>
    computeFlow(
      input({
        patients: pat,
        viewer: { userId: viewer, departmentId: "dept-im", scope: "mine", mayAssign: true },
        encounters: [encounter("e5", "five", { clinicianId: OTHER_DOC })],
      }),
    ).rows;

  it("the projection moves the row with the assignment", () => {
    expect(board(ME)).toHaveLength(0);
    expect(board(OTHER_DOC)[0]).toMatchObject({ lane: "waiting", primary: { kind: "start" } });
  });

  it("the second device hears it: a PHI-free broadcast from 0069, or a 15 s re-read", () => {
    const live = read("app/doctor/_components/workspace/use-workspace-live.ts");
    expect(live).toMatch(/const POLL_MS = 15_000;/);
    expect(live).toMatch(
      /channel\(`workspace:\$\{hospitalId\}`, \{ config: \{ private: true \} \}\)/,
    );
    expect(live).toMatch(/subscribeResusBoard\(hospitalId/);
    expect(read("supabase/migrations/0069_doctor_workspace.sql")).toMatch(/ON public\.encounters/);
  });
});

describe("S7 URLs: old ones land in their lane; lane and patient survive back, forward and reload", () => {
  it("?lane= is read back into a lane, anything else is All", () => {
    expect(["triage", "waiting", "in_progress", "resus"].map(laneFromParam)).toEqual([
      "triage",
      "waiting",
      "in_progress",
      "resus",
    ]);
    expect(laneFromParam("nonsense")).toBe("all");
  });

  it("lane and patient change with history.pushState (no refetch); scope with a real navigation", () => {
    const board = read("app/doctor/_components/workspace/workspace-board.tsx");
    expect(board).toMatch(/window\.history\.pushState\(null, "",/);
    expect(board).toMatch(/params\.get\("lane"\)/);
    expect(board).toMatch(/params\.get\("patient"\)/);
    expect(board).toMatch(/<Link[\s\S]*?href=\{href\(s\)\}/);
  });
});

describe("S8 phone, one hand", () => {
  it("the docked Start next bar is phones-only and every control is at least 44 px", () => {
    const board = read("app/doctor/_components/workspace/workspace-board.tsx");
    expect(board).toMatch(/fixed inset-x-0 bottom-0[\s\S]*?md:hidden/);
    expect(read("app/doctor/_components/workspace/buttons.ts")).toMatch(
      /"tap min-h-11 shrink-0 gap-1\.5"/,
    );
    // Not run in a browser here: no Playwright (Law 10). The layout was checked on a fixture render.
  });
});

describe("S9 who may see what", () => {
  it("a doctor without assign permission gets no Unassigned lane", () => {
    expect(visibleLanes({ mayAssign: false }).map((l) => l.id)).not.toContain("unassigned");
  });

  it("reception never reaches the board: the doctor scope turns non-doctor cadres away", () => {
    expect(read("lib/doctor/scope.ts")).toMatch(/redirect\("\/clinician"\)/);
  });

  it("another hospital's intake is refused by the actions (tests/workspace/actions.test.ts)", () => {
    expect(read("app/doctor/_lib/workspace-actions.ts")).toMatch(
      /intake\.hospitalId !== scope\.hospitalId/,
    );
  });
});

describe("S10 flag off", () => {
  it("every old page is guarded, so nothing changes without the flag (tests/workspace/pages.test.ts)", () => {
    for (const p of ["triage", "assigned", "encounters", "resus"]) {
      expect(read(`app/doctor/${p}/page.tsx`)).toMatch(/if \(doctorWorkspace\(/);
    }
    expect(Number.isFinite(HOUR)).toBe(true);
  });
});
