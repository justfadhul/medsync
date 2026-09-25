import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { doctorWorkspace } from "@/lib/workspace/feature";

/**
 * The flag and the routes (§5.8, S7, S10). Flag off: the four old pages and
 * the shell render as before. Flag on: the old list URLs 307 into their lane,
 * the detail routes stay, and the triage sheet intercepts only from the board.
 * Source-level, like the other route suites: the rule is about which file
 * does what, and a signed-in page cannot render without a session.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("DOCTOR_WORKSPACE", () => {
  afterEach(() => vi.unstubAllEnvs());
  const on = () => {
    vi.stubEnv("ENCOUNTER_ENGINE_LIVE", "1");
    vi.stubEnv("RESUS_DESK_V2", "1");
  };

  it("is off unless set", () => {
    on();
    vi.stubEnv("DOCTOR_WORKSPACE", "");
    expect(doctorWorkspace("h1")).toBe(false);
  });

  it("1 turns it on for every hospital", () => {
    on();
    vi.stubEnv("DOCTOR_WORKSPACE", "1");
    expect(doctorWorkspace("h1")).toBe(true);
  });

  it("a list of hospital ids turns it on for those only", () => {
    on();
    vi.stubEnv("DOCTOR_WORKSPACE", " h1 , h2 ");
    expect(doctorWorkspace("h1")).toBe(true);
    expect(doctorWorkspace("h2")).toBe(true);
    expect(doctorWorkspace("h3")).toBe(false);
  });

  it("needs the encounter engine and resus v2 — without them the old pages stay", () => {
    vi.stubEnv("DOCTOR_WORKSPACE", "1");
    vi.stubEnv("ENCOUNTER_ENGINE_LIVE", "1");
    vi.stubEnv("RESUS_DESK_V2", "");
    expect(doctorWorkspace("h1")).toBe(false);
    vi.stubEnv("RESUS_DESK_V2", "1");
    vi.stubEnv("ENCOUNTER_ENGINE_LIVE", "");
    expect(doctorWorkspace("h1")).toBe(false);
  });
});

describe("the old list pages redirect into a lane (307), and only with the flag", () => {
  for (const [page, lane] of [
    ["app/doctor/triage/page.tsx", "triage"],
    ["app/doctor/assigned/page.tsx", "waiting"],
    ["app/doctor/encounters/page.tsx", "in_progress"],
    ["app/doctor/resus/page.tsx", "resus"],
  ] as const) {
    it(`${page} → /doctor?lane=${lane}`, () => {
      const src = read(page);
      expect(src).toMatch(
        new RegExp(
          `if \\(doctorWorkspace\\((?:doctor|scope)\\.hospitalId\\)\\) redirect\\("/doctor\\?lane=${lane}"\\);`,
        ),
      );
      // redirect() in a server component is a 307; the page body after it is unchanged.
      expect(src).not.toMatch(/permanentRedirect/);
    });
  }

  it("the detail routes stay where they are", () => {
    for (const p of [
      "app/doctor/triage/[intakeId]/page.tsx",
      "app/doctor/resus/[episodeId]/page.tsx",
      "app/doctor/encounters/[encounterId]/page.tsx",
    ]) {
      expect(existsSync(resolve(process.cwd(), p)), p).toBe(true);
      expect(read(p), p).not.toMatch(/redirect\("\/doctor\?lane=/);
    }
  });
});

describe("/doctor", () => {
  const home = read("app/doctor/(workspace)/page.tsx");

  it("renders the Overview unchanged with the flag off, the workspace with it on", () => {
    expect(home).toMatch(
      /if \(!doctorWorkspace\(scope\.hospitalId\)\) return <DoctorOverview \/>;/,
    );
    expect(home).toMatch(/async function DoctorOverview\(\)/);
    expect(home).toMatch(/<Workspace scope=\{scope\}/);
  });

  it("the triage sheet intercepts only inside the workspace group (E1, S10)", () => {
    expect(
      existsSync(
        resolve(process.cwd(), "app/doctor/(workspace)/@panel/(.)triage/[intakeId]/page.tsx"),
      ),
    ).toBe(true);
    // No slot at the doctor root: the old /doctor/triage worklist never opens a sheet.
    expect(existsSync(resolve(process.cwd(), "app/doctor/@panel"))).toBe(false);
    expect(existsSync(resolve(process.cwd(), "app/doctor/page.tsx"))).toBe(false);
    for (const f of ["default.tsx", "page.tsx"]) {
      expect(read(`app/doctor/(workspace)/@panel/${f}`)).toMatch(/return null;/);
    }
  });

  it("the sheet re-checks the flag and reads the intake through the audited reveal", () => {
    const sheet = read("app/doctor/(workspace)/@panel/(.)triage/[intakeId]/page.tsx");
    expect(sheet).toMatch(/if \(!doctorWorkspace\(scope\.hospitalId\)\) return null;/);
    expect(sheet).toMatch(/fetchTriageWorklistRow/);
    expect(sheet).toMatch(/requireTriageScope/);
  });
});

describe("the shell (D6, W8)", () => {
  const shell = read("app/doctor/_components/doctor-shell.tsx");
  const features = read("app/doctor/_lib/features.ts");

  it("three nav items with the flag, none of them SOON; the old list without it", () => {
    const nav = features.slice(features.indexOf("export const WORKSPACE_NAV"));
    const labels = [...nav.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
    expect(labels.slice(0, 3)).toEqual(["Workspace", "Patients", "Schedule"]);
    expect(nav.slice(0, nav.indexOf("];"))).not.toMatch(/placeholder: true/);
    expect(shell).toMatch(/const navItems = workspace\s*\? WORKSPACE_NAV\s*: DOCTOR_FEATURE_AREAS/);
  });

  it("Emergency moves into the header (and stands the floating pill down) only with the flag", () => {
    expect(shell).toMatch(/\{workspace \? <EmergencyInlineLink \/> : null\}/);
    expect(read("app/doctor/_components/emergency-inline-link.tsx")).toMatch(
      /data-emergency-inline/,
    );
    expect(read("components/emergency/emergency-pill.tsx")).toMatch(
      /\[body:has\(\[data-emergency-inline\]\)_&\]:hidden/,
    );
  });
});
