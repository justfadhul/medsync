import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { appointmentBookedVia, byBookedAt, intakeBookedVia } from "@/lib/reception/booked-via";

/**
 * The desk's arrivals (ADR 0101): "Expected today" in the order people
 * booked, labelled by how they booked, and a route — triage or clinic — for
 * each arrival. The rules: the label is words and never a sort key (PRD
 * equity rule — the app must not outrank anyone); nothing clinical orders the
 * list; every read stays pinned to the caller's hospital; the polling queue
 * panel stays codes-only; and the clerk's choice of door reaches the Edge
 * Function unchanged.
 */

const callEdge = vi.fn();
const requireReceptionScope = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/supabase/edge", () => ({ callEdge }));
vi.mock("@/lib/reception/scope", () => ({ requireReceptionScope }));
vi.mock("next/cache", () => ({ revalidatePath }));

const { checkInPatientAction, checkInDeclaredIntakeAction } =
  await import("@/app/reception/actions");
const { RouteControl } = await import("@/app/reception/_components/route-control");

const ROOT = process.cwd();
const queries = readFileSync(resolve(ROOT, "lib/reception/queries.ts"), "utf8");

/** The body of one top-level `export async function`, to its closing brace at column 0. */
function fn(name: string): string {
  const start = queries.indexOf(`export async function ${name}(`);
  expect(start, `${name} is exported`).toBeGreaterThan(-1);
  return queries.slice(start, queries.indexOf("\n}\n", start));
}

const APPT = "7b0f6c1e-3a52-4d8e-9a1b-2c3d4e5f6a7b";
const INTAKE = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const DEPT = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeEach(() => {
  callEdge.mockReset().mockResolvedValue({ ok: true, data: { ok: true, data: {} } });
  requireReceptionScope.mockReset().mockResolvedValue({ userId: "clerk", hospitalId: "h1" });
  revalidatePath.mockReset();
});

describe("How booked — words for the Expected list", () => {
  it("reads origin before channel: a system-urgent booking is written with channel 'web'", () => {
    expect(appointmentBookedVia("system_urgent", "web")).toBe("Urgent (system)");
  });

  it.each([
    ["ussd", "web", "USSD"],
    ["patient", "ussd", "USSD"],
    ["reception", "web", "At the desk"],
    ["patient", "desk", "At the desk"],
    ["clinician", "web", "By a clinician"],
    ["nurse", "web", "By a clinician"],
    ["patient", "app", "Phone app"],
    ["patient", "web", "Web"],
    ["walk_in", "system", "Web"],
  ])("origin %s, channel %s → %s", (origin, channel, label) => {
    expect(appointmentBookedVia(origin, channel)).toBe(label);
  });

  it("labels a ticket with no booking behind it", () => {
    expect(intakeBookedVia(true, "walk_in")).toBe("Same day (patient)");
    expect(intakeBookedVia(false, "self_presentation_prealerted")).toBe("Pre-alert");
    expect(intakeBookedVia(false, "walk_in")).toBe("Walk-in");
  });
});

describe("Expected today — ordered by when people booked, never by how", () => {
  const rows = [
    { id: "b", bookedAtIso: "2026-09-23T06:00:00.000Z", bookedVia: "Phone app" },
    { id: "c", bookedAtIso: "2026-09-21T09:30:00.000Z", bookedVia: "USSD" },
    { id: "a", bookedAtIso: "2026-09-23T06:00:00.000Z", bookedVia: "At the desk" },
    { id: "d", bookedAtIso: "2026-09-23T05:10:00.000Z", bookedVia: "Same day (patient)" },
  ];

  it("booked-at ascending, then id", () => {
    expect([...rows].sort(byBookedAt).map((r) => r.id)).toEqual(["c", "d", "a", "b"]);
  });

  it("the channel cannot move a row: relabelling everyone changes nothing", () => {
    const relabelled = rows.map((r) => ({ ...r, bookedVia: "Phone app" }));
    expect(relabelled.sort(byBookedAt).map((r) => r.id)).toEqual(
      [...rows].sort(byBookedAt).map((r) => r.id),
    );
  });

  it("the comparator reads the booking time and the id, and nothing else", () => {
    const src = readFileSync(resolve(ROOT, "lib/reception/booked-via.ts"), "utf8");
    const body = src.slice(src.indexOf("export function byBookedAt("));
    expect(body).toMatch(
      /a\.bookedAtIso\.localeCompare\(b\.bookedAtIso\) \|\| a\.id\.localeCompare\(b\.id\)/,
    );
    expect(src).not.toMatch(/^import /m);
  });

  it("fetchExpectedToday sorts only with byBookedAt, and no sort or order names a channel or anything clinical", () => {
    const src = fn("fetchExpectedToday");
    expect(src).toMatch(/expected\.sort\(byBookedAt\)/);
    for (const m of src.matchAll(/\.(sort|orderBy)\(([^)]*)\)/g)) {
      expect(m[2], m[0]).not.toMatch(
        /channel|origin|bookedVia|symptom|complaint|tier|priority|triage/i,
      );
    }
  });

  it("fetchExpectedArrivals orders by start, clinic-day position (nulls last), then booking time", () => {
    const src = fn("fetchExpectedArrivals");
    const order = src.slice(
      src.indexOf(".orderBy("),
      src.indexOf(".limit(", src.indexOf(".orderBy(")),
    );
    expect(order).toMatch(/asc\(appointments\.startsAt\)/);
    expect(order).toMatch(/positionNumber\} asc nulls last/);
    expect(order).toMatch(/asc\(appointments\.createdAt\)/);
    expect(order).not.toMatch(/channel|origin|symptom|priority/i);
  });
});

describe("Hospital scoping — every read restates the caller's hospital", () => {
  it("fetchExpectedToday hands the hospital to each of its three reads", () => {
    const src = fn("fetchExpectedToday");
    expect(src.match(/hospitalId: args\.hospitalId/g)).toHaveLength(3);
  });

  it("the reads it reuses filter on it, and the unrouted test pins the intake to the booking's hospital", () => {
    expect(fn("fetchExpectedArrivals")).toMatch(/eq\(appointments\.hospitalId, args\.hospitalId\)/);
    expect(fn("fetchDeclaredIntakesToday")).toMatch(
      /eq\(patientIntakes\.hospitalId, args\.hospitalId\)/,
    );
    const unrouted = queries.slice(
      queries.indexOf("const unroutedSql"),
      queries.indexOf("export async function fetchExpectedArrivals("),
    );
    expect(unrouted).toMatch(/patientIntakes\.hospitalId\} = \$\{appointments\.hospitalId\}/);
    expect(unrouted).toMatch(/not exists/);
  });

  it("the new reads reveal names only through the audited path", () => {
    // fetchExpectedToday decrypts nothing itself; it composes the audited reads.
    const src = fn("fetchExpectedToday");
    expect(src).not.toMatch(/decrypt|Encrypted/);
    expect(src).toMatch(/fetchExpectedArrivals\(/);
    expect(src).toMatch(/fetchDeclaredIntakesToday\(/);
  });
});

describe("The polling queue panel stays codes-only", () => {
  it("fetchQueueForDay gains the source and the route, and still decrypts nothing", () => {
    const src = fn("fetchQueueForDay");
    expect(src).toMatch(/declaredByPatient: patientIntakes\.declaredByPatient/);
    expect(src).toMatch(/routedTo: patientIntakes\.routedTo/);
    expect(src).not.toMatch(/decrypt|Encrypted/);
  });

  it("the panel says both in words", () => {
    const panel = readFileSync(
      resolve(ROOT, "app/reception/expected/_components/queue-panel.tsx"),
      "utf8",
    );
    for (const word of ['"From the app"', '"To clinic"', '"To triage"']) {
      expect(panel).toContain(word);
    }
  });
});

describe("Routing at check-in — the clerk's door reaches ha-check-in-patient", () => {
  it("a booking sent to the clinic carries route and department", async () => {
    const r = await checkInPatientAction(
      {},
      form({ appointment_id: APPT, route: "clinic", department_id: DEPT }),
    );
    expect(r).toEqual({ ok: true, route: "clinic" });
    expect(callEdge).toHaveBeenCalledWith(
      "ha-check-in-patient",
      expect.objectContaining({ appointment_id: APPT, route: "clinic", department_id: DEPT }),
      "reception",
    );
  });

  it("a declared ticket defaults to triage, and an empty department select sends none", async () => {
    const r = await checkInDeclaredIntakeAction({}, form({ intake_id: INTAKE, department_id: "" }));
    expect(r.ok).toBe(true);
    const body = callEdge.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).toMatchObject({ intake_id: INTAKE, route: "triage" });
    expect(body.department_id).toBeUndefined();
  });

  it("the clinic door needs a department — refused before any write", async () => {
    const r = await checkInDeclaredIntakeAction({}, form({ intake_id: INTAKE, route: "clinic" }));
    expect(r.error).toMatch(/department/i);
    expect(callEdge).not.toHaveBeenCalled();
  });

  it("a route the desk does not have is refused", async () => {
    const r = await checkInPatientAction({}, form({ appointment_id: APPT, route: "resus" }));
    expect(r.ok).toBeUndefined();
    expect(callEdge).not.toHaveBeenCalled();
  });

  it("reports the door the function says it used (an emergency is always triaged)", async () => {
    callEdge.mockResolvedValue({ ok: true, data: { ok: true, data: { route: "triage" } } });
    const r = await checkInPatientAction(
      {},
      form({ appointment_id: APPT, route: "clinic", department_id: DEPT }),
    );
    expect(r.route).toBe("triage");
  });

  it("the control offers both doors in words, triage first, with the declared department preselected", () => {
    const html = renderToStaticMarkup(
      createElement(RouteControl, {
        intakeId: INTAKE,
        departments: [
          { id: "d-other", name: "Surgery" },
          { id: DEPT, name: "Medicine" },
        ],
        defaultDepartmentId: DEPT,
        patientLabel: "Nakato Sarah",
      }),
    );
    expect(html).toMatch(/name="intake_id" value="[^"]+"/);
    expect(html).toMatch(new RegExp(`<option value="${DEPT}" selected="">Medicine</option>`));
    const triage = html.indexOf(">Send to triage<");
    const clinic = html.indexOf(">Send to clinic<");
    expect(triage).toBeGreaterThan(-1);
    expect(clinic).toBeGreaterThan(triage);
    // Each door is a submit button carrying route=<door> (attribute order is the primitive's).
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    for (const door of ["triage", "clinic"]) {
      expect(
        buttons.some(
          (b) =>
            b.includes('type="submit"') &&
            b.includes('name="route"') &&
            b.includes(`value="${door}"`),
        ),
        door,
      ).toBe(true);
    }
    // With a department declared, "none" is not offered — it would queue them nowhere.
    expect(html).not.toContain("Triage decides the department");
  });
});
