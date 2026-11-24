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
    ).rejects.toThrow(/hospital_wards_parent_check/);
  });

  it("re-runs cleanly", async () => {
    await expect(pg.exec(readMigration("0310_eu_space_types.sql"))).resolves.toBeDefined();
  });
});
