import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "End visit" (ADR 0101 R3). The doctor ends a visit through the EXISTING
 * ha-complete-encounter with a fixed completion code, from two places: the
 * queue rail's Now-seeing chips and the encounter page's top bar. What must
 * hold: the audit row always says the same thing whatever the client sends,
 * the server's refusal reaches the doctor word for word, and the control is
 * offered only where there is an in-progress encounter to end.
 */

const callEdge = vi.fn();
const requireDoctorScope = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/supabase/edge", () => ({ callEdge }));
vi.mock("@/lib/doctor/scope", () => ({ requireDoctorScope }));
vi.mock("next/cache", () => ({ revalidatePath }));

const { completeEncounterAction } = await import("@/app/doctor/schedule/actions");
const { QueueRail } = await import("@/app/doctor/schedule/_components/queue-rail");
const { VisitStatus } =
  await import("@/app/doctor/encounters/[encounterId]/_components/visit-status");

const ENCOUNTER = "7b0f6c1e-3a52-4d8e-9a1b-2c3d4e5f6a7b";

beforeEach(() => {
  callEdge.mockReset();
  requireDoctorScope.mockReset().mockResolvedValue({ userId: "doc" });
  revalidatePath.mockReset();
});

describe("completeEncounterAction", () => {
  it("calls ha-complete-encounter with the fixed code and reason", async () => {
    callEdge.mockResolvedValue({ ok: true, data: {} });
    expect(await completeEncounterAction(ENCOUNTER)).toEqual({ ok: true });
    expect(requireDoctorScope).toHaveBeenCalledOnce();
    expect(callEdge).toHaveBeenCalledWith(
      "ha-complete-encounter",
      {
        encounter_id: ENCOUNTER,
        completion_reason: "ended_by_clinician",
        reason: "Visit ended by the clinician.",
      },
      "doctor.schedule",
    );
    const paths = revalidatePath.mock.calls.map(([p]) => p);
    for (const p of [
      "/doctor/schedule",
      "/doctor/encounters",
      "/reception/expected",
      "/nurse/triage",
    ]) {
      expect(paths).toContain(p);
    }
  });

  it("returns the server's refusal verbatim", async () => {
    const refusal = "Encounter is in 'completed' — only in-progress can complete.";
    callEdge.mockResolvedValue({ ok: false, error: refusal });
    expect(await completeEncounterAction(ENCOUNTER)).toEqual({ error: refusal });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses a non-id before touching scope or the function", async () => {
    expect((await completeEncounterAction("not-an-id")).error).toBeTruthy();
    expect(requireDoctorScope).not.toHaveBeenCalled();
    expect(callEdge).not.toHaveBeenCalled();
  });
});

const identity = {
  patientCode: "MS-0001",
  displayName: null,
  photoUrl: null,
  ageYears: null,
  sex: null,
  complaint: null,
};
const row = (over: Record<string, unknown>) => ({
  id: crypto.randomUUID(),
  kind: "walk_in",
  state: "waiting",
  arrivedAtIso: new Date().toISOString(),
  sequenceNumber: 1,
  priorityLabel: null,
  patientCode: "MS-0001",
  identity,
  appointmentId: null,
  encounterId: null,
  notes: null,
  ...over,
});

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("the queue rail", () => {
  const entries = [
    row({ state: "being_seen", encounterId: ENCOUNTER }),
    // Called before the encounter id was stamped: nothing to end.
    row({ state: "being_seen", encounterId: null }),
    // Waiting rows are called, not ended — even with a stray encounter id.
    row({ state: "waiting", encounterId: crypto.randomUUID() }),
  ];

  it("offers End visit only on a being_seen row with an encounter", () => {
    const html = renderToStaticMarkup(createElement(QueueRail, { entries }));
    expect(count(html, ">End visit<")).toBe(1);
    // The walk-in (no appointment) keeps its Call button.
    expect(count(html, "and start the encounter")).toBe(1);
  });

  it("links to the encounter only when the engine is live", () => {
    const off = renderToStaticMarkup(createElement(QueueRail, { entries }));
    expect(off).not.toContain(`/doctor/encounters/${ENCOUNTER}`);
    const on = renderToStaticMarkup(
      createElement(QueueRail, { entries, encounterEngineLive: true }),
    );
    expect(count(on, `/doctor/encounters/${ENCOUNTER}`)).toBe(1);
  });

  it("is never red — ending a visit is not an emergency", () => {
    const html = renderToStaticMarkup(createElement(QueueRail, { entries }));
    const button = html.slice(html.lastIndexOf("<button", html.indexOf(">End visit<")));
    expect(button.slice(0, button.indexOf(">"))).not.toMatch(/destructive|emergency|red-|rose-/);
  });
});

describe("the encounter page's top bar", () => {
  const render = (state: string, endedAt: Date | null = null) =>
    renderToStaticMarkup(createElement(VisitStatus, { encounterId: ENCOUNTER, state, endedAt }));

  it("shows End visit only while the encounter is in progress", () => {
    expect(render("in_progress")).toContain(">End visit<");
    for (const state of ["planned", "completed", "cancelled"]) {
      expect(render(state)).not.toContain("End visit");
    }
  });

  it("shows when it ended on the hospital's clock", () => {
    // 11:05 UTC is 14:05 in Kampala (EAT, UTC+3).
    expect(render("completed", new Date("2026-09-23T11:05:00Z"))).toContain("Completed · 14:05");
  });
});
