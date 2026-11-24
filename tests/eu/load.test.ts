import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * Task 22: who sees names on the EU list (D10), the rota seam (R63) and the read's audit. The read itself runs on
 * real SQL in tests/emr-db/eu-board-read.test.ts.
 */
// A plain function, not vi.fn: Vitest 4 reports a reset vi.fn's rejection even when the code under test catches it.
const held = vi.hoisted(() => {
  const h = {
    rota: false,
    calls: 0,
    transaction: async () => {
      h.calls++;
      throw new Error("down");
    },
  };
  return h;
});
vi.mock("@/lib/rota/feature", () => ({ dutyRotaLiveFor: () => held.rota }));
vi.mock("@/db", () => ({
  get db() {
    return { transaction: held.transaction };
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const { euDoctorOnDuty, mayReadEuNames } = await import("@/lib/eu/cover");
const { euNameBasis, planObsFrequency } = await import("@/lib/eu/load");

const src = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

describe("mayReadEuNames (D10: EU staff only)", () => {
  const nobody = { admin: false, inChargeWardIds: [], assignedWardIds: [], onDutyDoctor: false };
  it.each([
    ["the admin", { ...nobody, admin: true }, true],
    ["the in-charge of this EU", { ...nobody, inChargeWardIds: ["eu"] }, true],
    ["a nurse assigned to this EU", { ...nobody, assignedWardIds: ["eu"] }, true],
    ["a nurse assigned elsewhere", { ...nobody, assignedWardIds: ["ward-4"] }, false],
    ["the in-charge of another ward", { ...nobody, inChargeWardIds: ["ward-4"] }, false],
    ["the EU doctor on the rota", { ...nobody, onDutyDoctor: true }, true],
    ["a plain doctor", nobody, false],
  ])("%s → %s", (_, who, yes) => {
    expect(mayReadEuNames(who, "eu")).toBe(yes);
  });
});

describe("the basis logged for a name is one the viewer holds", () => {
  it("their chart basis for the patient, when they hold one", () => {
    expect(euNameBasis("admin", "department_recent")).toBe("department_recent");
    expect(euNameBasis("nurse", "active_encounter")).toBe("active_encounter");
  });
  it("EU nurses and the rota's EU doctor are assigned to the ward", () => {
    expect(euNameBasis("nurse", null)).toBe("assigned");
    expect(euNameBasis("doctor", null)).toBe("assigned");
  });
  it("an admin with no chart basis holds none: no name", () => {
    expect(euNameBasis("admin", null)).toBeNull();
  });
});

describe("the Plan's obs frequency, as the desk reads content.plan", () => {
  it("reads a chosen frequency", () => {
    expect(planObsFrequency({ plan: { observations: { frequency: "4h" } } })).toBe("4h");
  });
  it("anything else is no frequency", () => {
    expect(planObsFrequency({ plan: { observations: { frequency: "2h" } } })).toBeNull();
    expect(planObsFrequency({ plan: {} })).toBeNull();
    expect(planObsFrequency(null)).toBeNull();
  });
});

describe("euDoctorOnDuty, the rota seam (R63)", () => {
  const at = new Date("2026-11-24T20:00:00Z");

  it("rota off: nobody, and no query", async () => {
    held.rota = false;
    expect(await euDoctorOnDuty("h", "w", at)).toEqual([]);
    expect(held.calls).toBe(0);
  });
  it("a rota read that fails never breaks the board: nobody", async () => {
    held.rota = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await euDoctorOnDuty("h", "w", at)).toEqual([]);
    expect(held.calls).toBe(1);
  });
  it("the ward's own doctor posts only, through whoCovers, read softly", () => {
    const s = src("lib/eu/cover.ts");
    expect(s).toMatch(/if \(!dutyRotaLiveFor\(hospitalId\)\) return \[\];/);
    expect(s).toContain("soft(");
    expect(s).toContain("whoCovers(");
    expect(s).toContain('step === "ward_post"');
    expect(s).not.toMatch(/nurse_in_charge|allied/);
  });
});

describe("the EU board read (source)", () => {
  const s = src("lib/eu/load.ts");
  it("is off with the flag, before any query", () => {
    expect(s).toMatch(/if \(!euObservationLiveFor\(hospitalId\)\) return null;/);
  });
  it("the board's names only for names; nothing for the rest", () => {
    expect(s).toContain('patients: viewer.names ? "names" : "none"');
  });
  it("logs a name only inside the names branch, surface eu_board", () => {
    expect(s.match(/insert\(clinicalPhiAccessLog\)/g)).toHaveLength(1);
    expect(s).toContain('surface: "eu_board"');
    expect(s).toMatch(/viewer\.names\s*\?\s*await auditEuNames\(/);
  });
  it("reads the stays under RLS (eu_stays_select_scoped) before any owner lookup", () => {
    expect(s).toContain('.from("eu_stays")');
  });
});
