import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/auth", () => ({ getAuthState: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

/**
 * One doctor cadre set, read everywhere a doctor is routed or gated. A second
 * hand-written list in sign-in routing left out the Clinical Officer — a
 * cadre ADR 0027 puts in the doctor workspace — so they passed the generic
 * clinician gate, failed the doctor gate, and every schedule link landed on
 * /clinician/availability.
 */
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("doctor cadres — one source of truth", async () => {
  const scope = await import("@/lib/doctor/scope");
  const { CLERKING_CADRE_CODES } = await import("@/lib/encounter/access");
  const { RESUS_LEADER_CADRE_CODES } = await import("@/lib/resus/scope");

  it("is the juniors plus the seniors, Clinical Officer included (ADR 0027)", () => {
    expect([...scope.DOCTOR_CADRE_CODES].sort()).toEqual(
      [...scope.JUNIOR_CADRE_CODES, ...scope.SENIOR_CADRE_CODES].sort(),
    );
    expect(scope.DOCTOR_CADRE_CODES).toContain("CLINICAL_OFFICER");
  });

  it("every cadre that clerks or leads a resus can open the doctor workspace", () => {
    for (const c of [...CLERKING_CADRE_CODES, ...RESUS_LEADER_CADRE_CODES]) {
      expect(scope.DOCTOR_CADRE_CODES as ReadonlyArray<string>, c).toContain(c);
    }
  });

  it("sign-in routes doctors with the shared constant, never a copy", () => {
    const signIn = read("app/(auth)/sign-in/actions.ts");
    expect(signIn).toMatch(/import \{ DOCTOR_CADRE_CODES \} from "@\/lib\/doctor\/scope"/);
    expect(signIn).not.toMatch(/"SENIOR_CONSULTANT"/);
    expect(signIn.match(/DOCTOR_CADRE_CODES/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("the doctor gate and the /clinician guard share one query, so they cannot bounce a user", () => {
    const src = read("lib/doctor/scope.ts");
    expect(src).toMatch(/const me = await findDoctorAffiliation\(state\.user\.id\)/);
    expect(src).toMatch(/export async function isDoctorUser[\s\S]*findDoctorAffiliation\(userId\)/);
    expect(read("app/clinician/layout.tsx")).toMatch(
      /if \(await isDoctorUser\(scope\.userId\)\) redirect\("\/doctor\/schedule"\)/,
    );
  });

  it("every doctor cadre has a label in the doctor chrome", () => {
    for (const f of [
      "app/doctor/_components/doctor-shell.tsx",
      "app/doctor/encounters/[encounterId]/page.tsx",
    ]) {
      const src = read(f);
      for (const c of scope.DOCTOR_CADRE_CODES) expect(src, `${f}: ${c}`).toMatch(`${c}: "`);
    }
  });
});
