/**
 * 0286 on the PGlite lane (prescribing kit P5): the four seed versions (art, se, op, nac) carry
 * their named numbers, still drafts, and each rule module reads the seed as the database holds it,
 * so the chart is not blocked. Runs only with EMR_PGLITE=1.
 */
import type { Lane } from "./_pglite";
import type { ChartVersion } from "@/lib/protocols/engine/types";
import { beforeAll, describe, expect, it } from "vitest";

import { RULE_MODULES } from "@/lib/protocols/rules";
import { bootLane, laneOn } from "./_pglite";

describe.skipIf(!laneOn)("0286 protocol seeds (PGlite lane)", () => {
  let lane: Lane;
  beforeAll(async () => {
    lane = await bootLane();
  }, 180_000);

  it("art, se, op and nac: seeded drafts their modules can chart", async () => {
    const { rows } = await lane.pg.query<{
      protocol_id: string;
      status: string;
      signer1_user_id: string | null;
      rules: unknown;
      seed: Record<string, unknown>;
    }>(
      `SELECT protocol_id, status, signer1_user_id, rules, seed FROM public.protocol_versions
        WHERE hospital_id IS NULL AND protocol_id IN ('art', 'se', 'op', 'nac') ORDER BY protocol_id`,
    );
    expect(rows.map((r) => r.protocol_id)).toEqual(["art", "nac", "op", "se"]);
    for (const r of rows) {
      expect(r.status).toBe("draft");
      expect(r.signer1_user_id).toBeNull();
      const v = { rules: r.rules, seed: r.seed } as ChartVersion;
      expect(RULE_MODULES[r.protocol_id]!.check(v), r.protocol_id).toBeNull();
    }
    const by = Object.fromEntries(rows.map((r) => [r.protocol_id, r.seed]));
    expect((by.art!.dose as { mgKg: number }).mgKg).toBe(2.4);
    expect((by.se!.diazepam as { maxDoses: number }).maxDoses).toBe(2);
    expect((by.op!.atropine as { adultMg: number }).adultMg).toBe(2);
    expect((by.nac!.weightCapKg as number) ?? 0).toBe(110);
  });
});
