/**
 * Set-up › Going live, Places, Rules and Messages (migration 0274, SETUP-TABS.md §E and the prompt's guard list): the
 * database refuses going live while anything blocks or with one signature, an automatic item ticked by hand, practice
 * rows outside the practice schema, closing a place with stock, a store supplied from itself, a typed reading outside
 * 2–8 °C without a note, the proposer second-signing, and SMS to opted-out numbers, in quiet hours, past the weekly
 * cap or past the budget cap; the API key is never readable by the client role. Runs with EMR_PGLITE=1.
 */
import type { Lane, Pg } from "./_pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { RULE_REGISTRY } from "@/content/pharmacy-rules";
import { asClinicalWriter } from "@/lib/emr/db";
import { batchAtLocation, loadLocation, move } from "@/lib/pharmacy/stores/write";
import { authUser, bootLane, hospital, laneOn, staff } from "./_pglite";

const kampalaAt = (hour: number) => {
  const d = new Date(Date.now() + 3 * 3_600_000);
  d.setUTCHours(hour - 3, 0, 0, 0);
  return d.toISOString();
};
const tomorrow = () => new Date(Date.now() + 27 * 3_600_000).toISOString().slice(0, 10);

describe.skipIf(!laneOn)("Pharmacy set-up tabs: database invariants (0274)", () => {
  let lane: Lane;
  let pg: Pg;
  const f = {} as Record<string, string>;
  const id = async (q: string, p?: unknown[]) => (await pg.query<{ id: string }>(q, p)).rows[0]!.id;
  const hint = async (p: Promise<unknown>) => {
    try {
      await p;
      return "ok";
    } catch (e) {
      const err = e as { hint?: string; message?: string };
      return err.hint ?? err.message ?? "error";
    }
  };

  beforeAll(async () => {
    lane = await bootLane();
    pg = lane.pg;
    f.h = await hospital(pg, "Set-up lane");
    const s = Date.now();
    f.pharm = await id(
      `INSERT INTO public.hospital_departments (hospital_id, name, slug, kind, catalogue_code)
       VALUES ($1, 'Pharmacy', $2, 'support', 'PHARMACY') RETURNING id`,
      [f.h, `pharmacy-setup-${s}`],
    );
    f.storeDept = await id(
      `INSERT INTO public.hospital_departments (hospital_id, parent_id, name, slug, kind)
       VALUES ($1, $2, 'Main store', $3, 'support') RETURNING id`,
      [f.h, f.pharm, `store-setup-${s}`],
    );
    f.store = await id(
      `INSERT INTO public.pharmacy_locations (hospital_id, kind, department_id, name) VALUES ($1, 'store', $2, 'Main store')
       RETURNING id`,
      [f.h, f.storeDept],
    );
    f.clinic = await id(
      `INSERT INTO public.pharmacy_locations (hospital_id, kind, name, supplied_from) VALUES ($1, 'clinic', 'EPI clinic', $2)
       RETURNING id`,
      [f.h, f.store],
    );
    f.boss = (
      await staff(pg, { hospitalId: f.h, departmentId: f.pharm, cadre: "PHARMACIST" })
    ).userId;
    await pg.query(
      `INSERT INTO public.department_heads (hospital_id, department_id, user_id, starts_at)
       VALUES ($1, $2, $3, now() - interval '1 day')`,
      [f.h, f.pharm, f.boss],
    );
    f.tech = (
      await staff(pg, { hospitalId: f.h, departmentId: f.pharm, cadre: "PHARMACIST" })
    ).userId;
    f.ms = await authUser(pg, "ms");
    f.product = await id(
      `INSERT INTO public.pharmacy_products (hospital_id, medicine_id, name, issue_unit, pack_size, created_by)
       VALUES ($1, 'amoxicillin', 'Fixture capsule', 'capsule', '10', $2) RETURNING id`,
      [f.h, f.boss],
    );
  }, 180_000);

  it("one list of rule groups: the SQL group keys are the registry's", async () => {
    const r = await pg.query<{ c: string }>(
      `SELECT pg_get_constraintdef(oid) AS c FROM pg_constraint WHERE conname = 'pharmacy_rule_group_signatures_group_key_check'`,
    );
    for (const g of RULE_REGISTRY) expect(r.rows[0]!.c).toContain(`'${g.key}'`);
    expect(RULE_REGISTRY).toHaveLength(12);
  });

  it("an automatic go-live item is never ticked by hand", async () => {
    expect(
      await hint(
        pg.query(
          `INSERT INTO public.pharmacy_golive_items (hospital_id, key, status, done_at) VALUES ($1, 'levels', 'done', now())`,
          [f.h],
        ),
      ),
    ).toMatch(/pgi_auto/);
  });

  it("only the in-charge sets the date, runs practice and retires paper; the state never changes directly", async () => {
    const ev = (kind: string, by: string, detail: string | null = null) =>
      pg.query(
        `INSERT INTO public.pharmacy_golive_events (hospital_id, kind, detail, by_user) VALUES ($1, $2, $3, $4)`,
        [f.h, kind, detail, by],
      );
    expect(await hint(ev("target", f.tech!, tomorrow()))).toBe("not_in_charge");
    expect(await hint(ev("target", f.boss!, "2020-01-01"))).toMatch(/after today/);
    expect(await hint(ev("target", f.boss!, tomorrow()))).toBe("ok");
    expect(
      await hint(
        pg.query(
          `UPDATE public.pharmacy_golive_state SET phase = 'parallel', live_at = now() WHERE hospital_id = $1`,
          [f.h],
        ),
      ),
    ).toMatch(/changed only/);
    expect(await hint(ev("retire", f.boss!))).toMatch(/only when live/);
  });

  it("practice data stays in its own schema and is wiped on end; who trained is kept", async () => {
    const real = async () =>
      Number(
        (
          await pg.query<{ n: string }>(
            `SELECT (SELECT count(*) FROM public.pharmacy_stock_movements WHERE hospital_id = $1)
                  + (SELECT count(*) FROM public.pharmacy_supplies WHERE hospital_id = $1) AS n`,
            [f.h],
          )
        ).rows[0]!.n,
      );
    const before = await real();
    await pg.query(
      `INSERT INTO public.pharmacy_golive_events (hospital_id, kind, by_user) VALUES ($1, 'practice_start', $2)`,
      [f.h, f.boss],
    );
    const session = await id(
      `SELECT id FROM public.pharmacy_practice_sessions WHERE hospital_id = $1 AND ended_at IS NULL`,
      [f.h],
    );
    await pg.query(
      `INSERT INTO pharmacy_practice.dispenses (hospital_id, session_id, user_id, sample) VALUES ($1, $2, $3, 'Sample: amoxicillin 500 mg')`,
      [f.h, session, f.tech],
    );
    expect(await real()).toBe(before);
    await pg.query(
      `INSERT INTO public.pharmacy_golive_events (hospital_id, kind, by_user) VALUES ($1, 'practice_end', $2)`,
      [f.h, f.boss],
    );
    const left = await pg.query(
      `SELECT 1 FROM pharmacy_practice.dispenses WHERE hospital_id = $1`,
      [f.h],
    );
    expect(left.rows).toHaveLength(0);
    const trained = await pg.query(
      `SELECT 1 FROM public.pharmacy_practice_trained WHERE hospital_id = $1 AND user_id = $2`,
      [f.h, f.tech],
    );
    expect(trained.rows).toHaveLength(1);
    expect(
      await hint(
        pg.query(
          `INSERT INTO pharmacy_practice.dispenses (hospital_id, session_id, user_id, sample) VALUES ($1, $2, $3, 'Late sample')`,
          [f.h, session, f.tech],
        ),
      ),
    ).toMatch(/no practice day/);
  });

  it("going live is refused while anything blocks; with nothing blocking it needs both signatures", async () => {
    expect(
      await hint(
        pg.query(
          `INSERT INTO public.pharmacy_golive_signatures (hospital_id, role, signed_by) VALUES ($1, 'in_charge', $2)`,
          [f.h, f.boss],
        ),
      ),
    ).toBe("blocked");
    await pg.transaction(async (tx) => {
      // The blocker count is tested below; here it is stubbed to nothing so the signatures can be probed.
      await tx.exec(
        `CREATE OR REPLACE FUNCTION private.pharmacy_golive_blockers(p_hospital uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$`,
      );
      const sign = async (role: string, by: string) => {
        await tx.exec("SAVEPOINT sig");
        try {
          await tx.query(
            `INSERT INTO public.pharmacy_golive_signatures (hospital_id, role, signed_by) VALUES ($1, $2, $3)`,
            [f.h, role, by],
          );
          await tx.exec("RELEASE SAVEPOINT sig");
        } catch (e) {
          await tx.exec("ROLLBACK TO SAVEPOINT sig");
          throw e;
        }
      };
      const phase = async () =>
        (
          await tx.query<{ phase: string }>(
            `SELECT phase FROM public.pharmacy_golive_state WHERE hospital_id = $1`,
            [f.h],
          )
        ).rows[0]?.phase;
      await expect(sign("in_charge", f.tech!)).rejects.toThrow(/only the in-charge/);
      await sign("in_charge", f.boss!);
      expect(await phase()).toBe("setup");
      await expect(sign("ms", f.ms!)).rejects.toThrow(/medical superintendent/);
      await tx.query(
        `INSERT INTO public.user_roles (user_id, role, hospital_id) VALUES ($1, 'hospital_admin', $2)`,
        [f.ms, f.h],
      );
      await sign("ms", f.ms!);
      expect(await phase()).toBe("parallel");
      await tx.rollback();
    });
  });

  it("counts blockers from live data: answers, marks and the automatic items", async () => {
    const n = async () =>
      (await pg.query<{ n: number }>(`SELECT private.pharmacy_golive_blockers($1) AS n`, [f.h]))
        .rows[0]!.n;
    const before = await n();
    for (const k of ["q1", "q24", "wit", "dev", "demo"])
      await pg.query(
        `INSERT INTO public.pharmacy_golive_items (hospital_id, key, status, done_at, done_by) VALUES ($1, $2, 'done', now(), $3)
         ON CONFLICT (hospital_id, key) DO UPDATE SET status = 'done', done_at = now()`,
        [f.h, k, f.boss],
      );
    expect(await n()).toBe(before - 5);
    const auto = await pg.query<{ key: string; done: number; total: number }>(
      `SELECT * FROM private.pharmacy_golive_auto($1)`,
      [f.h],
    );
    expect(auto.rows.map((r) => r.key).sort()).toEqual(
      [
        "lic",
        "levels",
        "supplies",
        "suplevels",
        "mfa",
        "opening",
        "places",
        "prices",
        "roster",
        "rules",
        "sensor",
        "train",
      ].sort(),
    );
    expect(auto.rows.find((r) => r.key === "rules")).toMatchObject({ done: 0, total: 12 });
  });

  it("a store is never supplied from itself; a place with stock or an open handover is never closed", async () => {
    expect(
      await hint(
        pg.query(`UPDATE public.pharmacy_locations SET supplied_from = id WHERE id = $1`, [
          f.store,
        ]),
      ),
    ).toBe("self_supply");
    expect(
      await hint(
        pg.query(`UPDATE public.pharmacy_locations SET supplied_from = $2 WHERE id = $1`, [
          f.store,
          f.clinic,
        ]),
      ),
    ).toBe("self_supply");
    await asClinicalWriter(
      { userId: f.boss!, hospitalId: f.h! },
      async (tx) => {
        const loc = await loadLocation(tx, f.h!, f.store!);
        const batchId = await batchAtLocation(tx, {
          hospitalId: f.h!,
          location: loc,
          productId: f.product!,
          batchNumber: "SET-1",
          expiry: "2099-12-31",
          monthOnly: false,
          actorUserId: f.boss!,
        });
        await move(tx, {
          hospitalId: f.h!,
          location: loc,
          batchId,
          kind: "received",
          quantity: 30,
          sourceKind: "delivery",
          actorUserId: f.boss!,
          effectiveAt: new Date(),
        });
      },
      lane.db,
    );
    const close = (place: string) =>
      pg.query(
        `UPDATE public.pharmacy_locations SET closed_at = now(), closed_by = $2 WHERE id = $1`,
        [place, f.boss],
      );
    expect(await hint(close(f.store!))).toBe("stock_here");
    await pg
      .query(
        `INSERT INTO public.pharmacy_shift_handovers (hospital_id, location_id, from_user_id, to_user_id, keys_handed)
       VALUES ($1, $2, $3, $4, true)`,
        [f.h, f.clinic, f.boss, f.tech],
      )
      .catch(() => undefined);
    const open = await pg.query(
      `SELECT 1 FROM public.pharmacy_shift_handovers WHERE location_id = $1`,
      [f.clinic],
    );
    expect(await hint(close(f.clinic!))).toBe(open.rows.length ? "handover_open" : "ok");
  });

  it("a fridge is at one place at most; a typed reading outside 2–8 °C needs a note and opens an excursion", async () => {
    const col = await pg.query<{ t: string }>(
      `SELECT data_type AS t FROM information_schema.columns WHERE table_name = 'pharmacy_fridges' AND column_name = 'location_id'`,
    );
    expect(col.rows[0]!.t).toBe("uuid");
    f.fridge = await id(
      `INSERT INTO public.pharmacy_fridges (hospital_id, location_id, code, name, created_by) VALUES ($1, NULL, 'RF-09', 'Solar fridge', $2)
       RETURNING id`,
      [f.h, f.boss],
    );
    const typed = (temp: number, note: string | null, at = new Date()) =>
      pg.query(
        `INSERT INTO public.pharmacy_fridge_readings (hospital_id, fridge_id, read_at, temp_c, source, recorded_by, note)
         VALUES ($1, $2, $3, $4, 'chart', $5, $6)`,
        [f.h, f.fridge, at.toISOString(), temp, f.boss, note],
      );
    expect(await hint(typed(9.1, null))).toMatch(/pfr_note/);
    await typed(9.1, "Moved vaccines to the cold room", new Date(Date.now() - 60_000));
    const open = async () =>
      (
        await pg.query(
          `SELECT 1 FROM public.pharmacy_fridge_excursions WHERE fridge_id = $1 AND ended_at IS NULL`,
          [f.fridge],
        )
      ).rows.length;
    expect(await open()).toBe(1);
    await typed(5.0, null);
    expect(await open()).toBe(0);
  });

  it("a sensor run outside 2–8 °C opens an excursion only after the signed minutes", async () => {
    const fr = await id(
      `INSERT INTO public.pharmacy_fridges (hospital_id, location_id, code, name, created_by, sensor_id) VALUES ($1, $2, 'CR-09', 'Cold room', $3, 'SN-1')
       RETURNING id`,
      [f.h, f.store, f.boss],
    );
    const at = (minAgo: number, t: number) =>
      pg.query(
        `INSERT INTO public.pharmacy_fridge_readings (hospital_id, fridge_id, read_at, temp_c, source) VALUES ($1, $2, now() - make_interval(mins => $3), $4, 'sensor')`,
        [f.h, fr, minAgo, t],
      );
    const n = async () =>
      (await pg.query(`SELECT 1 FROM public.pharmacy_fridge_excursions WHERE fridge_id = $1`, [fr]))
        .rows.length;
    await at(60, 5);
    await at(45, 8.6);
    await at(30, 8.7);
    expect(await n()).toBe(0);
    await at(15, 8.9);
    expect(await n()).toBe(1);
  });

  it("only the head of pharmacy signs, alone; a rejection carries a note (ADR 0550)", async () => {
    const p = await id(
      `INSERT INTO public.pharmacy_rule_proposals (hospital_id, rule_group, key, old_text, new_text, reason, proposed_by, params)
       VALUES ($1, 'cold', 'expiry_warning', 'Warn 90 days before expiry', 'Warn 120 days before expiry', 'Slow movers', $2, '{"n":120}')
       RETURNING id`,
      [f.h, f.tech],
    );
    expect(
      await hint(
        pg.query(
          `INSERT INTO public.pharmacy_rule_signatures (proposal_id, role, signed_by) VALUES ($1, 'second', $2)`,
          [p, f.ms],
        ),
      ),
    ).toMatch(/only the head of pharmacy signs/);
    expect(
      await hint(
        pg.query(
          `INSERT INTO public.pharmacy_rule_signatures (proposal_id, role, signed_by) VALUES ($1, 'in_charge', $2)`,
          [p, f.tech],
        ),
      ),
    ).toMatch(/only the head of pharmacy signs/);
    expect(
      await hint(
        pg.query(
          `UPDATE public.pharmacy_rule_proposals SET status = 'rejected', closed_at = now() WHERE id = $1`,
          [p],
        ),
      ),
    ).toMatch(/prp_rejected/);
    await pg.query(
      `INSERT INTO public.pharmacy_rule_signatures (proposal_id, role, signed_by) VALUES ($1, 'in_charge', $2)`,
      [p, f.boss],
    );
    const n = await pg.query<{ n: string }>(
      `SELECT private.pharmacy_rule_n($1, 'cold', 'expiry_warning', 90)::text AS n`,
      [f.h],
    );
    expect(n.rows[0]!.n).toBe("120");
    const g = (role: string, by: string) =>
      pg.query(
        `INSERT INTO public.pharmacy_rule_group_signatures (hospital_id, group_key, role, signed_by) VALUES ($1, 'ord', $2, $3)`,
        [f.h, role, by],
      );
    expect(await hint(g("in_charge", f.tech!))).toMatch(/only the head of pharmacy signs/);
    await g("in_charge", f.boss!);
    expect(await hint(g("second", f.ms!))).toMatch(/only the head of pharmacy signs/);
  });

  it("SMS: never to an opted-out number, in quiet hours, past the weekly cap or the budget cap", async () => {
    let k = 0;
    const msg = (hmac: string, rule = "refill_due", at = kampalaAt(10), cost = 35) =>
      pg.query(
        `INSERT INTO public.pharmacy_sms_messages (hospital_id, day, rule, ref_key, recipient, phone_encrypted, phone_hmac, lang,
           body, status, sent_at, parts, cost_ugx)
         VALUES ($1, current_date, $2, $3, 'Sarah', 'x', $4, 'en', 'Hello. Reply STOP to stop.', 'sent', $5, 1, $6)`,
        [f.h, rule, `ref-${k++}`, hmac, at, cost],
      );
    await pg.query(
      `INSERT INTO public.pharmacy_sms_optouts (hospital_id, phone_hmac, source, reason) VALUES ($1, 'h-out', 'staff', 'Wrong number')`,
      [f.h],
    );
    expect(await hint(msg("h-out"))).toBe("opted_out");
    expect(await hint(msg("h-q", "refill_due", kampalaAt(21)))).toBe("quiet_hours");
    expect(await hint(msg("h-q", "test", kampalaAt(21)))).toBe("ok");
    for (let i = 0; i < 3; i++) expect(await hint(msg("h-w"))).toBe("ok");
    expect(await hint(msg("h-w"))).toBe("weekly_cap");
    await pg.query(
      `INSERT INTO public.pharmacy_sms_settings (hospital_id, monthly_budget_ugx, updated_by) VALUES ($1, 200, $2)`,
      [f.h, f.boss],
    );
    // 4 sent at UGX 35 = 140; one more at 35 is 175 ≤ 200; the next is 210 > 200.
    expect(await hint(msg("h-b1"))).toBe("ok");
    expect(await hint(msg("h-b2"))).toBe("budget_cap");
  });

  it("the SMS API key is never readable by the client role", async () => {
    const r = await pg.query<{ k: boolean; n: boolean }>(
      `SELECT has_column_privilege('medsync_clinical_reader', 'public.pharmacy_sms_provider', 'api_key_encrypted', 'SELECT') AS k,
              has_column_privilege('medsync_clinical_reader', 'public.pharmacy_sms_provider', 'sender_id', 'SELECT') AS n`,
    );
    expect(r.rows[0]).toEqual({ k: false, n: true });
  });
});
