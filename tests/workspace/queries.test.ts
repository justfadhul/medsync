import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * STOP 3's query budget: the workspace reads in a fixed number of round trips
 * whatever the row count (prompt §6, §11). A counting fake `db` answers every
 * awaited query from the table it reads and the fields it selects, so the same
 * load runs with 1 row per table and with 50.
 */

const NOW = Date.parse("2026-09-24T08:10:00Z");
let rowsPerQuery = 1;
const calls: string[] = [];

function fakeValue(key: string, table: string, i: number): unknown {
  // A profile's id IS the patient's user id.
  if (key === "id") return table === "patient_profiles" ? `p-${i}` : `${table}-${i}`;
  if (key === "patientUserId") return `p-${i}`;
  if (key === "intakeId") return `patient_intakes-${i}`;
  if (key === "triageRecordId") return `triage_records-${i}`;
  if (key === "clinicianUserId") return "doc-me";
  if (key.endsWith("At"))
    return key === "endedAt" || key === "deathConfirmedAt" ? null : new Date(NOW - i * 60_000);
  if (key === "status") return "triaged";
  if (key === "state") return "planned";
  if (key === "level") return 3;
  if (key === "requirement") return "allowed";
  if (key === "actionKind") return "triage_patient";
  if (key === "cadreCode") return "CONSULTANT";
  if (key === "dateOfBirth") return "1980-01-01";
  if (key === "code") return `MS-2026-${String(i).padStart(5, "0")}`;
  if (key === "breakdown") return { reasoning: ["RR 28"] };
  if (key === "isEmergency" || key === "lifeThreat" || key === "hasResus") return false;
  return null;
}

function query(fields: Record<string, unknown>) {
  let table = "?";
  const chain: Record<string, unknown> = {};
  for (const m of ["innerJoin", "leftJoin", "where", "limit", "orderBy"]) chain[m] = () => chain;
  chain.from = (t: Parameters<typeof getTableName>[0]) => {
    table = getTableName(t);
    return chain;
  };
  chain.then = (resolve: (rows: unknown[]) => unknown, reject: (e: unknown) => unknown) => {
    calls.push(table);
    try {
      return Promise.resolve(
        Array.from({ length: rowsPerQuery }, (_, i) =>
          Object.fromEntries(Object.keys(fields).map((k) => [k, fakeValue(k, table, i)])),
        ),
      ).then(resolve, reject);
    } catch (e) {
      return Promise.reject(e).then(resolve, reject);
    }
  };
  return chain;
}

vi.mock("@/db", () => ({ db: { select: (fields: Record<string, unknown>) => query(fields) } }));
vi.mock("@/lib/resus/board-v2", () => ({
  OPENABLE_LOOKBACK_MS: 24 * 3_600_000,
  fetchResusBoardV2: vi.fn(async () => {
    calls.push("resus-board");
    const row = (i: number) => ({
      episodeId: `r-${i}`,
      patientUserId: `p-${i}`,
      displayName: null,
      ageYears: null,
      trigger: "Triage Red",
      phase: "survey",
      inArrest: false,
      mode: "Survey",
      startedAtIso: new Date(NOW - 10 * 60_000).toISOString(),
      lastActivityAtIso: new Date(NOW - 60_000).toISOString(),
      idleLabel: null,
      adminCloseOpen: false,
      arrest: null,
      worst: null,
      lastVitals: null,
      leader: null,
      boarding: null,
    });
    return {
      hospitalId: "h",
      nowIso: new Date(NOW).toISOString(),
      arrest: [],
      active: Array.from({ length: rowsPerQuery }, (_, i) => row(i)),
      boarding: [],
      needsClosing: [],
      openable: [],
      ended: [],
    };
  }),
}));
vi.mock("@/lib/scheduling/patient-identity", () => ({
  revealPatientIdentities: vi.fn(async (args: { patients: { patientUserId: string }[] }) => {
    calls.push("reveal");
    return new Map(
      args.patients.map((p) => [p.patientUserId, { displayName: `Name ${p.patientUserId}` }]),
    );
  }),
}));

const { loadWorkspace } = await import("@/lib/workspace/queries");
const viewer = {
  userId: "doc-me",
  hospitalId: "h",
  departmentId: "dept-im",
  cadreCode: "CONSULTANT",
};

describe("the workspace query budget", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("is the same for one row per table and for fifty", async () => {
    rowsPerQuery = 1;
    await loadWorkspace({ viewer, scope: "mine", nowMs: NOW });
    const small = [...calls];
    calls.length = 0;
    rowsPerQuery = 50;
    const { flow } = await loadWorkspace({ viewer, scope: "mine", nowMs: NOW });
    expect(calls).toEqual(small);
    expect(flow.rows.length).toBeGreaterThan(10);
  });

  it("is three phases: four reads with the board, four more, one audited reveal", async () => {
    rowsPerQuery = 5;
    await loadWorkspace({ viewer, scope: "department", nowMs: NOW });
    expect(calls.slice(0, 4).sort()).toEqual(
      ["clinical_cosign_policies", "encounters", "patient_intakes", "resus-board"].sort(),
    );
    expect(calls.slice(4, 8).sort()).toEqual(
      ["encounters", "patient_profiles", "resus_episodes", "triage_records"].sort(),
    );
    expect(calls.slice(8)).toEqual(["reveal"]);
  });

  it("gives the Department scope only to whoever may assign (D8)", async () => {
    rowsPerQuery = 3;
    const intern = { ...viewer, cadreCode: "INTERN" };
    const refused = await loadWorkspace({ viewer: intern, scope: "department", nowMs: NOW });
    expect(refused).toMatchObject({ mayAssign: false, scope: "mine" });
    const allowed = await loadWorkspace({ viewer, scope: "department", nowMs: NOW });
    expect(allowed).toMatchObject({ mayAssign: true, scope: "department" });
  });

  it("reveals names only for the patients on the board, then shows them", async () => {
    rowsPerQuery = 3;
    const { flow } = await loadWorkspace({ viewer, scope: "mine", nowMs: NOW });
    const { revealPatientIdentities } = await import("@/lib/scheduling/patient-identity");
    const call = vi.mocked(revealPatientIdentities).mock.calls.at(-1)![0];
    const onBoard = new Set(flow.rows.map((r) => r.patientId));
    for (const p of call.patients) expect(onBoard.has(p.patientUserId)).toBe(true);
    expect(call).toMatchObject({ surface: "doctor_workspace", clinical: true });
    expect(flow.rows.find((r) => r.patientId === "p-0")?.identity.name).toBe("Name p-0");
  });
});
