/**
 * Migration 0310 on the PGlite lane (ADR 0539): hospital_beds takes the chair and resus spaces, and only an
 * emergency observation ward is attached to another ward, never to itself.
 * Runs only with EMR_PGLITE=1 (see _pglite.ts).
 */
import { randomUUID } from "node:crypto";
import type { Pg } from "./_pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { bootLane, hospital, laneOn, readMigration } from "./_pglite";

const BOOT_MS = 180_000;

describe.skipIf(!laneOn)("0310 — EU space types, on real SQL", () => {
  let pg: Pg;
  let h: string;
  let general: string;

  const ward = async (type: string, parent: string | null = null) => {
    const s = randomUUID().slice(0, 8);
    return (
      await pg.query<{ id: string }>(
        `INSERT INTO public.hospital_wards (hospital_id, name, slug, ward_type, parent_ward_id, bed_count)
         VALUES ($1, $2, $3, $4, $5, 4) RETURNING id`,
        [h, `Ward ${s}`, `w-${s}`, type, parent],
      )
    ).rows[0]!.id;
  };
  const bed = (wardId: string, type: string) =>
    pg.query(
      `INSERT INTO public.hospital_beds (hospital_id, ward_id, label, bed_type) VALUES ($1, $2, $3, $4)`,
      [h, wardId, `B-${randomUUID().slice(0, 6)}`, type],
    );

  beforeAll(async () => {
    pg = (await bootLane()).pg;
    h = await hospital(pg, "EU types");
    general = await ward("general");
  }, BOOT_MS);

  it("0310 takes chair and resus, refuses an unknown type", async () => {
    await expect(bed(general, "chair")).resolves.toBeDefined();
    await expect(bed(general, "resus")).resolves.toBeDefined();
    await expect(bed(general, "sofa")).rejects.toThrow(/hospital_beds_bed_type_check/);
  });

  it("only an EU is attached, never to itself", async () => {
    const eu = await ward("emergency_observation", general);
    expect(eu).toBeTruthy();
    await expect(ward("general", general)).rejects.toThrow(/hospital_wards_parent_check/);
    await expect(
      pg.query(`UPDATE public.hospital_wards SET parent_ward_id = id WHERE id = $1`, [eu]),
    ).rejects.toThrow(/not attached to itself/);
  });

  it("re-runs cleanly", async () => {
    await expect(pg.exec(readMigration("0310_eu_space_types.sql"))).resolves.toBeDefined();
  });
});

/** The refusal's HINT, which the Edge Function maps to words. */
const hintOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as { hint?: string }).hint;
  }
  return "no refusal";
};

describe.skipIf(!laneOn)("0310 — the parent guard trigger", () => {
  let pg: Pg;
  let h: string;
  const mk = async (type: string, parent: string | null = null, hosp?: string) => {
    const s = randomUUID().slice(0, 8);
    return (
      await pg.query<{ id: string }>(
        `INSERT INTO public.hospital_wards (hospital_id, name, slug, ward_type, parent_ward_id, bed_count)
         VALUES ($1, $2, $3, $4, $5, 4) RETURNING id`,
        [hosp ?? h, `Ward ${s}`, `w-${s}`, type, parent],
      )
    ).rows[0]!.id;
  };
  beforeAll(async () => {
    pg = (await bootLane()).pg;
    h = await hospital(pg, "EU guard");
  }, BOOT_MS);

  it("refuses a parent that is an EU, with a hint", async () => {
    const eu = await mk("emergency_observation");
    expect(await hintOf(mk("emergency_observation", eu))).toBe("ward_parent_not_ordinary");
  });
  it("refuses an archived parent", async () => {
    const p = await mk("general");
    await pg.query(`UPDATE public.hospital_wards SET archived_at = now() WHERE id = $1`, [p]);
    expect(await hintOf(mk("emergency_observation", p))).toBe("ward_parent_not_ordinary");
  });
  it("refuses a parent of another hospital", async () => {
    const other = await mk("general", null, await hospital(pg, "Other"));
    expect(await hintOf(mk("emergency_observation", other))).toBe("ward_parent_not_ordinary");
  });
  it("refuses itself as parent", async () => {
    const eu = await mk("emergency_observation");
    expect(
      await hintOf(
        pg.query(`UPDATE public.hospital_wards SET parent_ward_id = id WHERE id = $1`, [eu]),
      ),
    ).toBe("ward_parent_not_ordinary");
  });
  it("refuses a ward becoming an EU while unarchived units point at it; archived ones do not count", async () => {
    const p = await mk("general");
    const eu = await mk("emergency_observation", p);
    expect(
      await hintOf(
        pg.query(
          `UPDATE public.hospital_wards SET ward_type = 'emergency_observation' WHERE id = $1`,
          [p],
        ),
      ),
    ).toBe("ward_has_units");
    await pg.query(`UPDATE public.hospital_wards SET archived_at = now() WHERE id = $1`, [eu]);
    await expect(
      pg.query(
        `UPDATE public.hospital_wards SET ward_type = 'emergency_observation' WHERE id = $1`,
        [p],
      ),
    ).resolves.toBeDefined();
  });
  it("lets an ordinary parent through, and re-runs cleanly", async () => {
    const p = await mk("general");
    await expect(mk("emergency_observation", p)).resolves.toBeTruthy();
    await expect(pg.exec(readMigration("0310_eu_space_types.sql"))).resolves.toBeDefined();
  });
});
