import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ADR 0101 R1: the desk routes an arrival to triage (default) or straight to
 * the clinic. A clinic-routed intake (`routed_to = 'clinic'`) waits on the
 * doctor's queue and must not also sit on the triage worklist; a legacy row
 * (`routed_to IS NULL`, everything before the route existed) went to triage
 * and must stay there. An intake with no receiving department reached no
 * worklist at all, so every department's triage staff now see it.
 *
 * The WHERE clause is captured from the real query builder call and rendered
 * with Postgres's dialect — no database. The ORDER BY is pinned by source, as
 * tests/triage/presence-order.test.ts pins it: this change must not touch it.
 */

let where: SQL | undefined;
const chain: Record<string, unknown> = {};
for (const m of ["select", "from", "innerJoin", "leftJoin", "orderBy"]) chain[m] = () => chain;
chain.where = (w: SQL) => {
  where = w;
  return chain;
};
chain.limit = async () => [];
vi.mock("@/db", () => ({ db: chain }));

const { fetchTriageWorklist } = await import("@/lib/triage/worklist");

const rendered = () => {
  const q = new PgDialect().sqlToQuery(where!);
  return { sql: q.sql.replace(/\s+/g, " "), params: q.params };
};

beforeEach(() => {
  where = undefined;
});

describe("fetchTriageWorklist — the desk's route", () => {
  it("excludes clinic-routed arrivals and keeps legacy NULL rows", async () => {
    await fetchTriageWorklist({ hospitalId: "h", clinicianUserId: "c" });
    const { sql, params } = rendered();
    expect(sql).toContain(
      `("patient_intakes"."routed_to" is null or "patient_intakes"."routed_to" <> $`,
    );
    expect(params).toContain("clinic");
  });

  it("includes intakes with no receiving department for a department's staff", async () => {
    await fetchTriageWorklist({ hospitalId: "h", departmentId: "d", clinicianUserId: "c" });
    const { sql, params } = rendered();
    expect(sql).toMatch(
      /\("patient_intakes"\."receiving_department_id" = \$\d+ or "patient_intakes"\."receiving_department_id" is null\)/,
    );
    expect(params).toContain("d");
  });

  it("leaves the ORDER BY exactly as presence-order pins it", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/triage/worklist.ts"), "utf8").replace(
      /\s+/g,
      " ",
    );
    expect(src).toContain(
      ".orderBy(sql`${patientIntakes.triageLevel} IS NOT NULL`, priorityHintRank, presenceAt)",
    );
    // …and nothing orders by the route: it filters, it never ranks.
    expect(src).not.toMatch(/orderBy\([^)]*routedTo/);
  });
});
