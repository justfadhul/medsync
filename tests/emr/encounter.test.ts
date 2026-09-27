import type { EncounterAction, EncounterState } from "@/lib/emr/encounter";
import { describe, expect, it, vi } from "vitest";

import {
  completionWarnings,
  DISPOSITION_CODES,
  encounterLifecycle,
  lastActivityMs,
  needsClosing,
  planTransition,
  readDisposition,
  STORED_DISPOSITIONS,
  storedDisposition,
} from "@/lib/emr/encounter";
import { CLOSURE_REASON_CODES, EMR_SETTINGS_DEFAULTS, emrSettings } from "@/lib/emr/settings";

// queries.ts is server-only and imports the db and the resus board; the idle constant is all we read.
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/resus/board-v2", () => ({ fetchResusBoardV2: vi.fn(), OPENABLE_LOOKBACK_MS: 0 }));
vi.mock("@/lib/scheduling/patient-identity", () => ({ revealPatientIdentities: vi.fn() }));

const AT = new Date("2026-09-26T10:00:00Z");
const ACTOR = "00000000-0000-4000-8000-000000000001";
const STATES: EncounterState[] = [
  "planned",
  "in_progress",
  "completed",
  "cancelled",
  "entered_in_error",
];

const start: EncounterAction = { kind: "start", at: AT };
const cancel: EncounterAction = { kind: "cancel", at: AT };
const complete: EncounterAction = {
  kind: "complete",
  at: AT,
  actorUserId: ACTOR,
  disposition: "home",
};
const closeAdmin: EncounterAction = {
  kind: "close_administrative",
  at: AT,
  actorUserId: ACTOR,
  reason: "left_before_seen",
};
const eie: EncounterAction = {
  kind: "enter_in_error",
  at: AT,
  actorUserId: ACTOR,
  reason: "opened_in_error",
};

describe("lifecycle", () => {
  it.each([
    ["planned", null, "open"],
    ["in_progress", null, "open"],
    ["completed", "clinical", "completed"],
    ["completed", "administrative", "administratively_closed"],
    ["completed", null, "legacy_completed"],
    ["cancelled", null, "cancelled"],
    ["entered_in_error", null, "entered_in_error"],
  ] as const)("%s + %s → %s", (state, closureKind, want) => {
    expect(encounterLifecycle({ state, closureKind })).toBe(want);
  });

  it("an unknown state is an error, not a guess", () => {
    expect(() => encounterLifecycle({ state: "archived", closureKind: null })).toThrow();
  });
});

describe("transitions: every valid one", () => {
  it("planned → in_progress", () => {
    expect(planTransition({ state: "planned" }, start)).toEqual({
      ok: true,
      patch: { state: "in_progress" },
    });
  });
  it("planned → cancelled", () => {
    expect(planTransition({ state: "planned" }, cancel)).toEqual({
      ok: true,
      patch: { state: "cancelled", endedAt: AT },
    });
  });
  it("in_progress → completed (clinical) writes disposition, completed_by and ended_at", () => {
    const r = planTransition(
      { state: "in_progress" },
      { ...complete, followUp: { kind: "as_needed" } },
    );
    expect(r).toEqual({
      ok: true,
      patch: {
        state: "completed",
        endedAt: AT,
        completedBy: ACTOR,
        disposition: "home",
        closureKind: "clinical",
        followUp: { kind: "as_needed" },
      },
    });
  });
  it.each(["planned", "in_progress"] as const)(
    "%s → completed (administrative) with a reason",
    (state) => {
      const r = planTransition({ state }, closeAdmin);
      expect(r).toEqual({
        ok: true,
        patch: {
          state: "completed",
          endedAt: AT,
          completedBy: ACTOR,
          closureKind: "administrative",
          closureReason: "left_before_seen",
        },
      });
    },
  );
  it.each(["planned", "in_progress"] as const)("%s → entered_in_error with a reason", (state) => {
    expect(planTransition({ state }, eie)).toEqual({
      ok: true,
      patch: { state: "entered_in_error", endedAt: AT, closureReason: "opened_in_error" },
    });
  });
  it("'other' carries its note (the caller encrypts it)", () => {
    const r = planTransition(
      { state: "in_progress" },
      { ...closeAdmin, reason: "other", note: "  patient moved ward  " },
    );
    expect(r.ok && r.patch.closureNote).toBe("patient moved ward");
  });
});

describe("transitions: every invalid one", () => {
  // The full matrix: each action from each state; only the moves above are allowed.
  const allowed: Record<string, EncounterState[]> = {
    start: ["planned"],
    cancel: ["planned"],
    complete: ["in_progress"],
    close_administrative: ["planned", "in_progress"],
    enter_in_error: ["planned", "in_progress"],
  };
  const expectedError: Record<string, string> = {
    start: "not_planned",
    cancel: "not_planned",
    complete: "not_in_progress",
    close_administrative: "not_open",
    enter_in_error: "not_open",
  };
  for (const action of [start, cancel, complete, closeAdmin, eie]) {
    for (const state of STATES) {
      if (allowed[action.kind]?.includes(state)) continue;
      it(`${action.kind} from ${state} is refused`, () => {
        expect(planTransition({ state }, action)).toEqual({
          ok: false,
          error: expectedError[action.kind],
        });
      });
    }
  }

  it("complete without a disposition is refused", () => {
    expect(planTransition({ state: "in_progress" }, { ...complete, disposition: null })).toEqual({
      ok: false,
      error: "disposition_required",
    });
  });
  it("complete with a review date but no date is refused", () => {
    const r = planTransition(
      { state: "in_progress" },
      { ...complete, followUp: { kind: "review_date", date: "" } },
    );
    expect(r).toEqual({ ok: false, error: "follow_up_date_required" });
  });
  it.each([closeAdmin, eie])("$kind without a reason is refused", (action) => {
    expect(
      planTransition({ state: "in_progress" }, { ...action, reason: null } as EncounterAction),
    ).toEqual({
      ok: false,
      error: "reason_required",
    });
  });
  it("'other' without a note is refused", () => {
    expect(
      planTransition({ state: "in_progress" }, { ...closeAdmin, reason: "other", note: " " }),
    ).toEqual({
      ok: false,
      error: "note_required_for_other",
    });
  });
  it("a reason the hospital does not offer is refused", () => {
    const settings = emrSettings({ closureReasonCodes: ["duplicate_encounter"] });
    expect(planTransition({ state: "in_progress" }, closeAdmin, settings)).toEqual({
      ok: false,
      error: "reason_not_allowed",
    });
  });
  it("administrative closure is never automatic: it needs a named user", () => {
    expect(planTransition({ state: "in_progress" }, { ...closeAdmin, actorUserId: "" })).toEqual({
      ok: false,
      error: "actor_required",
    });
    expect(planTransition({ state: "in_progress" }, { ...complete, actorUserId: "" })).toEqual({
      ok: false,
      error: "actor_required",
    });
  });
});

describe("disposition", () => {
  it("died is stored as the existing 'deceased' (ADR 0115)", () => {
    expect(storedDisposition("died")).toBe("deceased");
    const r = planTransition({ state: "in_progress" }, { ...complete, disposition: "died" });
    expect(r.ok && r.patch.disposition).toBe("deceased");
  });
  it("every completion-sheet code stores as a value the 0071 CHECK accepts", () => {
    for (const c of DISPOSITION_CODES) expect(STORED_DISPOSITIONS).toContain(storedDisposition(c));
  });
  it.each([
    ["admit", "admitted", true],
    ["discharge", "home", true],
    ["refer", "referred_out", true],
    ["transfer", "transferred", true],
    ["deceased", "died", false],
    ["observe", null, true],
  ] as const)("legacy %s reads as %s", (stored, code, legacy) => {
    expect(readDisposition(stored)).toEqual({ code, legacy, stored });
  });
  it("new codes read as themselves; null reads as null; unknown throws", () => {
    for (const c of DISPOSITION_CODES.filter((c) => c !== "died")) {
      expect(readDisposition(c)).toEqual({ code: c, legacy: false, stored: c });
    }
    expect(readDisposition(null)).toBeNull();
    expect(() => readDisposition("vanished")).toThrow();
  });
  it("round trip: every code stored then read gives the code back", () => {
    for (const c of DISPOSITION_CODES) expect(readDisposition(storedDisposition(c))?.code).toBe(c);
  });
});

describe("completion warnings (returned, never thrown)", () => {
  const dx = { status: "final", verification: "provisional" };
  const clean = { notes: [{ id: "n1", state: "signed" }], diagnoses: [dx], orders: [] };

  it("none when everything is signed, diagnosed and collected", () => {
    expect(completionWarnings(clean)).toEqual([]);
  });
  it("unsigned notes", () => {
    expect(
      completionWarnings({
        ...clean,
        notes: [
          { id: "n1", state: "draft" },
          { id: "n2", state: "signed" },
        ],
      }),
    ).toEqual([{ code: "unsigned_notes", noteIds: ["n1"] }]);
  });
  it("no diagnosis recorded; refuted and entered-in-error do not count", () => {
    for (const diagnoses of [
      [],
      [{ status: "final", verification: "refuted" }],
      [{ status: "entered_in_error", verification: "confirmed" }],
    ]) {
      expect(completionWarnings({ ...clean, diagnoses })).toEqual([{ code: "no_diagnosis" }]);
    }
  });
  it("a deferred diagnosis counts as an impression", () => {
    expect(completionWarnings({ ...clean, diagnoses: [], diagnosisDeferred: true })).toEqual([]);
  });
  it("orders not yet collected; cancelled and specimen-free orders do not warn", () => {
    const orders = [
      { id: "o1", collected: false, cancelled: false, needsSpecimen: true },
      { id: "o2", collected: true, cancelled: false, needsSpecimen: true },
      { id: "o3", collected: false, cancelled: true, needsSpecimen: true },
      { id: "o4", collected: false, cancelled: false, needsSpecimen: false },
    ];
    expect(completionWarnings({ ...clean, orders })).toEqual([
      { code: "orders_not_collected", orderIds: ["o1"] },
    ]);
  });
  it("all three together, in order", () => {
    const w = completionWarnings({
      notes: [{ id: "n1", state: "draft" }],
      diagnoses: [],
      orders: [{ id: "o1", collected: false, cancelled: false, needsSpecimen: true }],
    });
    expect(w.map((x) => x.code)).toEqual([
      "unsigned_notes",
      "no_diagnosis",
      "orders_not_collected",
    ]);
  });
});

describe("idle detection (Workspace D3 setting, reused)", () => {
  const DAY = 24 * 60 * 60_000;
  const t0 = new Date("2026-09-25T08:00:00Z");
  const enc = (state: EncounterState, lastActivityAt: Date | null = null) => ({
    state,
    updatedAt: t0,
    lastActivityAt,
  });

  it("the default idle window is the Workspace's ENCOUNTER_IDLE_MS", async () => {
    const { ENCOUNTER_IDLE_MS } = await import("@/lib/workspace/queries");
    expect(EMR_SETTINGS_DEFAULTS.encounterIdleMs).toBe(ENCOUNTER_IDLE_MS);
  });
  it("last activity is the latest of updated_at, last_activity_at and the latest document", () => {
    const later = new Date(t0.getTime() + 5_000);
    const latest = new Date(t0.getTime() + 9_000);
    expect(lastActivityMs(enc("in_progress", later))).toBe(later.getTime());
    expect(lastActivityMs(enc("in_progress", later), latest)).toBe(latest.getTime());
    expect(lastActivityMs(enc("in_progress"))).toBe(t0.getTime());
  });
  it("idle exactly at the window (the flow.ts >= comparison), not a millisecond before", () => {
    const base = { hasUnsignedNotes: false };
    expect(needsClosing(enc("in_progress"), { ...base, nowMs: t0.getTime() + DAY })).toBe("idle");
    expect(needsClosing(enc("in_progress"), { ...base, nowMs: t0.getTime() + DAY - 1 })).toBeNull();
    expect(needsClosing(enc("planned"), { ...base, nowMs: t0.getTime() + DAY })).toBe("idle");
  });
  it("autosave activity keeps active clerking out of Needs closing", () => {
    const now = t0.getTime() + DAY + 1;
    const recent = new Date(now - 60_000);
    expect(
      needsClosing(enc("in_progress", recent), { nowMs: now, hasUnsignedNotes: false }),
    ).toBeNull();
  });
  it("a hospital override of the window applies", () => {
    const s = emrSettings({ encounterIdleMs: 60_000 });
    expect(
      needsClosing(
        enc("in_progress"),
        { nowMs: t0.getTime() + 60_000, hasUnsignedNotes: false },
        s,
      ),
    ).toBe("idle");
  });
  it("completed with unsigned notes needs closing; closed states otherwise never do", () => {
    const now = t0.getTime() + 10 * DAY;
    expect(needsClosing(enc("completed"), { nowMs: now, hasUnsignedNotes: true })).toBe(
      "completed_with_unsigned_notes",
    );
    for (const s of ["completed", "cancelled", "entered_in_error"] as const) {
      expect(needsClosing(enc(s), { nowMs: now, hasUnsignedNotes: false })).toBeNull();
    }
  });
  it("idle is a report only: it never produces a transition", () => {
    // needsClosing returns a reason string; closing needs planTransition with a named user.
    expect(
      typeof needsClosing(enc("in_progress"), {
        nowMs: t0.getTime() + DAY,
        hasUnsignedNotes: false,
      }),
    ).toBe("string");
  });
});

describe("settings (pending owner confirmation, O-9)", () => {
  it("the §H.2 defaults", () => {
    expect(EMR_SETTINGS_DEFAULTS.autosaveDebounceMs).toBe(1_500);
    expect(EMR_SETTINGS_DEFAULTS.lateEntryWindowMs).toBe(24 * 60 * 60_000);
    expect(EMR_SETTINGS_DEFAULTS.closureReasonCodes).toEqual(CLOSURE_REASON_CODES);
  });
  it("overrides are validated", () => {
    expect(() => emrSettings({ lateEntryWindowMs: 0 })).toThrow();
    expect(() => emrSettings({ autosaveDebounceMs: Number.NaN })).toThrow();
    expect(() => emrSettings({ closureReasonCodes: [] })).toThrow();
    expect(emrSettings({ lateEntryWindowMs: 1 }).lateEntryWindowMs).toBe(1);
  });
});
