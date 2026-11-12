import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Review C-3: 0289 took the superadmin's read arm off every table that holds patient data (its ARRAY lists them).
// A later migration must not put one back: the superadmin reads a patient's record through break-glass only.
const dir = join(process.cwd(), "supabase/migrations");
const read = (f: string) => readFileSync(join(dir, f), "utf8");
const phi = [
  ...read("0289_superadmin_off_phi.sql")
    .match(/ARRAY\[([\s\S]*?)\];/)![1]!
    .matchAll(/'(\w+)'/g),
].map((m) => m[1]!);

describe("no superadmin read arm returns to a patient table after 0289", () => {
  const later = readdirSync(dir).filter(
    (f) => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) > 289,
  );

  it("0289 lists the patient tables and drops the audit_log arm", () => {
    expect(phi).toEqual(
      expect.arrayContaining(["users", "patient_profiles", "encounters", "appointments"]),
    );
    expect(read("0289_superadmin_off_phi.sql")).toMatch(
      /DROP POLICY IF EXISTS audit_log_select_superadmin/,
    );
  });

  it.each(later.length ? later : ["(none yet)"])("%s", (f) => {
    if (f === "(none yet)") return;
    for (const policy of read(f).matchAll(/CREATE POLICY[\s\S]*?;/gi)) {
      const table = policy[0].match(/\bON\s+(?:public\.)?(\w+)/i)?.[1];
      if (table && [...phi, "audit_log"].includes(table))
        expect(policy[0], `${f}: ${table}`).not.toMatch(/superadmin/i);
    }
  });
});
