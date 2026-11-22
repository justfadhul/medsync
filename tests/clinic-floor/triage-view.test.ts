/** The floor's triage pop-up, the pure side (ADR 0531): the chart, the trend, the other scores, the two drafts. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { EVENT_KINDS, mayRecord } from "@/lib/clinic-floor/model";
import {
  bandOf,
  doctorLoad,
  gcsBand,
  gcsNote,
  gcsTotal,
  news2Chart,
  news2Classes,
  otherScores,
  pointsFor,
  temperatureWord,
  toneOfBands,
  trendOf,
} from "@/lib/clinic-floor/triage-view";
import { news2ToAcuity } from "@/lib/triage/constants";
import { runTriage } from "@/lib/triage/engine";

const ctx = {
  ageYears: 68,
  pregnancy: "not_pregnant" as const,
  reproductiveAgeFemale: false,
  spo2Scale2Enabled: false,
};
const sick = {
  respiratoryRate: 26,
  spo2: 91,
  oxygen: "air" as const,
  systolicBp: 92,
  diastolicBp: 58,
  pulse: 118,
  consciousness: "A" as const,
  temperature: 38.6,
  bloodGlucose: 7.2,
};

describe("NEWS2 chart", () => {
  const chart = news2Chart(false, "air");
  it("is drawn from the engine: every band scores what the engine scores inside it", () => {
    for (const row of chart)
      for (const b of row.bands) {
        expect(pointsFor(row.key, b.from, false, "air"), `${row.key} ${b.from}`).toBe(b.points);
        expect(pointsFor(row.key, b.to, false, "air"), `${row.key} ${b.to}`).toBe(b.points);
      }
  });
  it("lays each sign out as 3 2 1 0 1 2 3 with normal in the middle", () => {
    for (const row of chart) {
      expect(row.cells).toHaveLength(7);
      expect(row.cells[3]?.points).toBe(0);
      row.cells.forEach((c, i) => c && expect(c.points).toBe(Math.abs(i - 3)));
    }
    const rr = chart.find((r) => r.key === "respiratoryRate")!;
    expect(rr.cells.map((c) => c?.label ?? "")).toEqual([
      "≤8",
      "",
      "9–11",
      "12–20",
      "",
      "21–24",
      "≥25",
    ]);
  });
  it("finds the band a value falls in, at the edges too", () => {
    const rr = chart.find((r) => r.key === "respiratoryRate")!.bands;
    expect(bandOf(rr, 26)?.points).toBe(3);
    expect(bandOf(rr, 2)?.points).toBe(3);
    expect(bandOf(rr, 60)?.points).toBe(3);
    expect(bandOf(rr, 16)?.points).toBe(0);
  });
  it("SpO₂ scale 2 has its own chart", () => {
    const s1 = news2Chart(false, "air").find((r) => r.key === "spo2")!;
    const s2 = news2Chart(true, "air").find((r) => r.key === "spo2")!;
    expect(s2.bands).not.toEqual(s1.bands);
  });
  it("the total's meaning for the level is the engine's own mapping", () => {
    for (const [total, three] of [
      [0, false],
      [4, false],
      [3, true],
      [5, false],
      [6, true],
      [7, false],
      [12, true],
    ] as const) {
      const on = news2Classes(total, three).filter((c) => c.on);
      expect(on).toHaveLength(1);
      expect(on[0]!.level).toBe(news2ToAcuity(total, three));
    }
  });
});

describe("trend against earlier triages", () => {
  const at = { scale2: false, oxygen: "air" as const };
  it("before a new value: what it was last time, and the line of earlier readings", () => {
    expect(trendOf("respiratoryRate", [22, null, 21], null, at)).toEqual({
      last: 21,
      delta: null,
      dir: null,
      verdict: null,
      series: [22, 21],
    });
  });
  it("no earlier reading, no trend", () => {
    expect(trendOf("pulse", [], 80, at)).toBeNull();
    expect(trendOf("pulse", [null], 80, at)).toBeNull();
  });
  it("worse and better are the engine's points, not the direction of the number", () => {
    expect(trendOf("respiratoryRate", [21], 26, at)).toMatchObject({
      dir: "up",
      delta: 5,
      verdict: "worse",
    });
    expect(trendOf("spo2", [95], 97, at)).toMatchObject({ dir: "up", delta: 2, verdict: "better" });
    expect(trendOf("respiratoryRate", [12], 8, at)).toMatchObject({
      dir: "down",
      verdict: "worse",
    });
  });
  it("a move inside the same score band says only how far", () => {
    expect(trendOf("systolicBp", [142], 128, at)).toMatchObject({
      dir: "down",
      delta: -14,
      verdict: null,
    });
    expect(trendOf("pulse", [98], 98, at)).toMatchObject({ dir: "same", delta: 0, verdict: null });
  });
  it("a sign NEWS2 does not score one by one gets no verdict", () => {
    expect(trendOf("diastolicBp", [90], 60, at)).toMatchObject({ dir: "down", verdict: null });
    expect(trendOf("bloodGlucose", [6], 2.1, at)).toMatchObject({ verdict: null });
  });
});

describe("other scores", () => {
  const r = runTriage({ context: ctx, vitals: sick });
  const o = otherScores(r, sick);
  it("each score marks the band this person falls in, from the engine's own flags", () => {
    expect(o.shockIndex.bands.filter((b) => b.on).map((b) => b.word)).toEqual(["shock"]);
    expect(toneOfBands(o.shockIndex.bands)).toBe("bad");
    expect(o.modifiedShockIndex.bands.find((b) => b.on)?.word).toBe("bleeding");
    expect(o.pulsePressure.bands.find((b) => b.on)?.word).toBe("normal");
    expect(o.glucose.bands.find((b) => b.on)?.word).toBe("normal");
  });
  it("qSOFA shows which of its three criteria are met", () => {
    expect(o.qsofa.score).toBe(2);
    expect(o.qsofa.positive).toBe(true);
    expect(o.qsofa.criteria.map((c) => [c.key, c.met])).toEqual([
      ["rr", true],
      ["sbp", true],
      ["mind", false],
    ]);
  });
  it("with nothing recorded, no band is marked and nothing reads as normal", () => {
    const none = {
      ...sick,
      respiratoryRate: null,
      spo2: null,
      systolicBp: null,
      diastolicBp: null,
      pulse: null,
      temperature: null,
      bloodGlucose: null,
    };
    const e = otherScores(runTriage({ context: ctx, vitals: none }), none);
    for (const s of [e.shockIndex, e.modifiedShockIndex, e.pulsePressure, e.glucose])
      expect(toneOfBands(s.bands)).toBeNull();
    expect(e.map.value).toBeNull();
  });
});

describe("the two drafts", () => {
  it("temperature reads in plain words; the word never changes a score", () => {
    expect(
      [34.6, 35, 35.8, 36.8, 37.8, 38, 38.6, 39.4].map((t) => temperatureWord(t).word),
    ).toEqual(["hypothermia", "low", "low", "normal", "raised", "raised", "fever", "highFever"]);
    expect(temperatureWord(37.8).tone).toBe("mild");
    expect(pointsFor("temperature", 37.8, false, "air")).toBe(0);
  });
  it("Glasgow Coma Scale: a total only when all three are picked, kept in the note", () => {
    expect(gcsTotal({ e: 3, v: 4, m: null })).toBeNull();
    expect(gcsTotal({ e: 3, v: 4, m: 5 })).toBe(12);
    expect([15, 13, 12, 9, 8, 3].map(gcsBand)).toEqual([
      "mild",
      "mild",
      "moderate",
      "moderate",
      "severe",
      "severe",
    ]);
    expect(gcsNote({ e: 3, v: 4, m: 5 })).toBe("GCS 12 (E3 V4 M5)");
    expect(gcsNote({ e: null, v: null, m: null })).toBeNull();
  });
});

describe("Send to: what each doctor is doing now", () => {
  const row = (doctorUserId: string | null, step: string, departmentId = "c1") => ({
    doctorUserId,
    step,
    departmentId,
  });
  const rows = [
    row("d1", "with"),
    row("d1", "line"),
    row("d1", "called"),
    row("d2", "line"),
    row(null, "line"),
    row(null, "line", "c2"),
    row("d1", "done"),
    row("d1", "tests"),
  ];
  const NOW = 1_000_000;
  it("counts the doctor's own waiting queue and says when they are with a patient", () => {
    expect(doctorLoad(rows, new Map(), "d1", NOW)).toEqual({
      queue: 2,
      state: "with",
      until: null,
    });
    expect(doctorLoad(rows, new Map(), "d2", NOW)).toEqual({
      queue: 1,
      state: "free",
      until: null,
    });
  });
  it("a break shows until when, and ends by itself; away is away", () => {
    const st = (status: string, until: number | null) =>
      new Map([["d2", { doctorUserId: "d2", status, room: null, until }]]);
    expect(doctorLoad(rows, st("break_15", NOW + 60_000) as never, "d2", NOW)).toMatchObject({
      state: "break",
      until: NOW + 60_000,
    });
    expect(doctorLoad(rows, st("break_15", NOW - 1) as never, "d2", NOW)).toMatchObject({
      state: "free",
    });
    expect(doctorLoad(rows, st("away", null) as never, "d2", NOW)).toMatchObject({ state: "away" });
  });
  it("Any doctor is the clinic's unassigned queue", () => {
    expect(doctorLoad(rows, new Map(), null, NOW, "c1")).toMatchObject({ queue: 1 });
    expect(doctorLoad(rows, new Map(), null, NOW, "c2")).toMatchObject({ queue: 1 });
  });
  it("only clinics running today are offered, and Level 2 alerts the clinic it is sent to", () => {
    const src = readFileSync("components/clinic-floor/triage-dialog.tsx", "utf8");
    expect(src).toContain("cl.doctors.length > 0 || cl.hours");
    const act = readFileSync("app/clinic/actions.ts", "utf8");
    expect(act).toMatch(
      /notifyTriageOutcome\(\{[\s\S]*departmentId: f\.departmentId[\s\S]*alsoUserId: f\.doctorUserId/,
    );
  });
});

describe("a nurse works in triage only", () => {
  it("may record triage and re-checks, and nothing on the line", () => {
    expect(
      ["triaged", "rechecked", "user_switch"].every((k) => mayRecord("nurse", k as never)),
    ).toBe(true);
    for (const k of [
      "call",
      "call_again",
      "here",
      "didnt_come",
      "doctor_status",
      "sent_for_tests",
      "finish",
      "running_late",
      "end_session",
      "moved",
    ])
      expect(mayRecord("nurse", k as never), k).toBe(false);
  });
  it("a doctor and the in-charge are not narrowed", () => {
    for (const k of EVENT_KINDS) {
      expect(mayRecord("doctor", k)).toBe(true);
      expect(mayRecord("incharge", k)).toBe(true);
    }
  });
  it("the screen hides the doctor's controls and the server refuses them too", () => {
    const line = readFileSync("components/clinic-floor/line.tsx", "utf8");
    expect(line).toContain('const viewOnly = user.role === "nurse"');
    expect(line).toContain("<DoctorsNow ctx={ctx} />");
    expect(readFileSync("components/clinic-floor/floor.tsx", "utf8")).toContain(
      "if (!mayRecord(user.role, kind)) return say(TD.watch.viewOnly)",
    );
    const act = readFileSync("app/clinic/actions.ts", "utf8");
    expect(act).toMatch(
      /if \(!mayRecord\("nurse", e\.kind\)\) \{[\s\S]*clinician_user_id", scope\.userId[\s\S]*return \{ ok: false, error: TD\.watch\.viewOnly \}/,
    );
  });
});

describe("the pop-up keeps the floor's safety steps", () => {
  const src = readFileSync("components/clinic-floor/triage-dialog.tsx", "utf8");
  it("still asks the life-threat check with an explicit None of these, and stops at Level 1", () => {
    expect(src).toContain("P.none");
    expect(src).toContain("P.missingThreat");
    expect(src).toContain("P.openResus");
    expect(src).toMatch(/const off = busy \|\| !result \|\| isL1 \|\| still\.length > 0/);
  });
  it("saves through the floor's own port, so offline triage still queues", () => {
    expect(src).toContain("ctx.port.triage(payload,");
    expect(src).not.toContain("submitTriageAction");
  });
});
