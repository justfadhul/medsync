/**
 * Set-up › People and roster (migration 0273, PEOPLE-ROSTER.md §16): the database enforces the roster invariants —
 * one place per person per shift, slot capacity from the signed rule, only the roster maker writes pharmacy places,
 * a published week is locked, leave approval frees the shifts, a swap is approved only after the colleague accepts,
 * nobody on approved leave or past their licence is rostered, the proposer never second-signs. Runs with EMR_PGLITE=1.
 */
import type { Lane, Pg } from "./_pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { authUser, bootLane, hospital, laneOn, staff } from "./_pglite";

const one = async (pg: Pg, q: string, p?: unknown[]) =>
  (await pg.query<{ id: string }>(q, p)).rows[0]!.id;
const day = (n: number) => {
  const d = new Date(Date.now() + 3 * 3_600_000);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** A Monday at least `weeks` weeks ahead, so publishing never touches today. */
const monday = (weeks: number) => {
  const d = new Date(`${day(weeks * 7)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
const plus = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

describe.skipIf(!laneOn)("Pharmacy roster: database invariants (0273)", () => {
  let lane: Lane;
  let pg: Pg;
  const f = {} as Record<string, string>;

  const duty = (user: string, place: string, date: string, shift = "day", by = f.boss!) =>
    pg.query(
      `INSERT INTO public.pharmacy_duty_roster (hospital_id, user_id, location_id, role, shift, date_from, date_to, created_by)
       VALUES ($1, $2, $3, 'technician', $4, $5, $5, $6)`,
      [f.h, user, place, shift, date, by],
    );
  const active = async (user: string, date: string) =>
    (
      await pg.query(
        `SELECT 1 FROM public.pharmacy_duty_roster WHERE user_id = $1 AND date_from = $2 AND ended_at IS NULL`,
        [user, date],
      )
    ).rows.length;
  const listed = (user: string, cadre: string, places: string[]) =>
    pg.query(
      `INSERT INTO public.pharmacy_roster_people (hospital_id, user_id, cadre, places, added_by) VALUES ($1, $2, $3, $4, $5)`,
      [f.h, user, cadre, places, f.boss],
    );
  const licence = (user: string, expires: string) =>
    pg.query(
      `INSERT INTO public.pharmacy_staff_licences (hospital_id, user_id, body, number, expires_on, recorded_by)
       VALUES ($1, $2, 'AHPC', 'AHPC/T/1', $3, $4)`,
      [f.h, user, expires, f.boss],
    );

  beforeAll(async () => {
    lane = await bootLane();
    pg = lane.pg;
    f.h = await hospital(pg, "Roster lane");
    f.dept = await one(
      pg,
      `INSERT INTO public.hospital_departments (hospital_id, name, slug, kind, catalogue_code)
       VALUES ($1, 'Pharmacy', $2, 'support', 'PHARMACY') RETURNING id`,
      [f.h, `pharmacy-roster-${Date.now()}`],
    );
    const place = (name: string, kind = "store") =>
      one(
        pg,
        `INSERT INTO public.pharmacy_locations (hospital_id, kind, department_id, name)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [f.h, kind, kind === "store" ? f.dept : null, name],
      );
    f.store = await place("Main store");
    f.opd = await place("OPD store");
    f.quar = await place("Quarantine", "quarantine");
    f.boss = (
      await staff(pg, { hospitalId: f.h, departmentId: f.dept, cadre: "PHARMACIST" })
    ).userId;
    await pg.query(
      `INSERT INTO public.department_heads (hospital_id, department_id, user_id, starts_at)
       VALUES ($1, $2, $3, now() - interval '1 day')`,
      [f.h, f.dept, f.boss],
    );
    for (const k of ["a", "b", "c", "keeper", "deleg"]) f[k] = await authUser(pg, `roster-${k}`);
  }, 120_000);

  it("keeps the 0265 range lines until the hospital lists its people", async () => {
    await pg.query(
      `INSERT INTO public.pharmacy_duty_roster (hospital_id, user_id, location_id, role, shift, date_from, date_to, created_by)
       VALUES ($1, $2, NULL, 'pharmacist', 'day', $3, $4, $2)`,
      [f.h, f.boss, day(-30), day(-20)],
    );
  });

  it("one duty, one place, the roster maker, a listed person, a licence, room in the slot", async () => {
    await listed(f.a!, "technician", [f.store!, f.opd!]);
    await listed(f.b!, "technician", [f.store!, f.opd!]);
    await listed(f.c!, "technician", [f.store!]);
    await listed(f.keeper!, "store_keeper", [f.store!]);
    await listed(f.deleg!, "technician", [f.opd!]);
    const d = day(3);
    await expect(
      pg.query(
        `INSERT INTO public.pharmacy_duty_roster (hospital_id, user_id, location_id, role, shift, date_from, date_to, created_by)
         VALUES ($1, $2, $3, 'technician', 'day', $4, $5, $6)`,
        [f.h, f.keeper, f.store, d, day(4), f.boss],
      ),
    ).rejects.toThrow(/one duty is one date/);
    await expect(duty(f.keeper!, f.quar!, d)).rejects.toThrow(/only pharmacy places/);
    await expect(duty(f.keeper!, f.store!, d, "day", f.a!)).rejects.toThrow(
      /not making the roster/,
    );
    await expect(duty(f.deleg!, f.store!, d)).rejects.toThrow(/not listed at this place/);
    await expect(duty(f.a!, f.store!, d)).rejects.toThrow(/licence/);
    // A store keeper needs no licence.
    await duty(f.keeper!, f.store!, d);
    await licence(f.a!, day(5));
    await licence(f.b!, day(60));
    await licence(f.c!, day(60));
    await licence(f.deleg!, day(60));
    await expect(duty(f.a!, f.store!, day(6))).rejects.toThrow(/licence expired/);
    await duty(f.a!, f.store!, d);
    await expect(duty(f.b!, f.store!, d)).rejects.toThrow(/full/);
    // One place per shift per date.
    await expect(duty(f.a!, f.opd!, d)).rejects.toThrow(/pdr_one_duty|duplicate/);
    // On call holds one person.
    await duty(f.a!, f.store!, d, "call");
    await expect(duty(f.b!, f.store!, d, "call")).rejects.toThrow(/full/);
  });

  it("a delegate edits only their places, and only until the end date", async () => {
    await expect(
      pg.query(
        `INSERT INTO public.pharmacy_roster_delegations (hospital_id, from_user, to_user, places) VALUES ($1, $2, $3, $4)`,
        [f.h, f.a, f.deleg, [f.opd]],
      ),
    ).rejects.toThrow(/only the in-charge/);
    await expect(
      pg.query(
        `INSERT INTO public.pharmacy_roster_delegations (hospital_id, from_user, to_user, places, can_publish)
         VALUES ($1, $2, $3, $4, true)`,
        [f.h, f.boss, f.deleg, [f.opd]],
      ),
    ).rejects.toThrow(/prd_publish/);
    const id = await one(
      pg,
      `INSERT INTO public.pharmacy_roster_delegations (hospital_id, from_user, to_user, places, until)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [f.h, f.boss, f.deleg, [f.opd], day(30)],
    );
    await duty(f.deleg!, f.opd!, day(4), "day", f.deleg!);
    await expect(duty(f.c!, f.store!, day(4), "day", f.deleg!)).rejects.toThrow(
      /not making the roster/,
    );
    await pg.query(
      `UPDATE public.pharmacy_roster_delegations SET revoked_at = now(), revoked_by = $2 WHERE id = $1`,
      [id, f.boss],
    );
    await expect(duty(f.b!, f.opd!, day(4), "day", f.deleg!)).rejects.toThrow(
      /not making the roster/,
    );
  });

  it("a published week is locked; publishing and unlocking need the in-charge; unlocking needs a reason", async () => {
    const w = monday(3);
    const ev = (action: string, actor: string, reason: string | null = null) =>
      pg.query(
        `INSERT INTO public.pharmacy_roster_week_events (hospital_id, week_start, action, reason, actor_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [f.h, w, action, reason, actor],
      );
    await expect(ev("publish", f.a!)).rejects.toThrow(/only the in-charge/);
    await ev("publish", f.boss!);
    await expect(ev("publish", f.boss!)).rejects.toThrow(/already published/);
    await expect(duty(f.b!, f.store!, plus(w, 1))).rejects.toThrow(/published/);
    await expect(ev("unlock", f.boss!)).rejects.toThrow(/prwe_reason/);
    await ev("unlock", f.boss!, "Cover for sick leave");
    await duty(f.b!, f.store!, plus(w, 1));
  });

  it("approving leave frees the shifts; nobody is rostered on approved leave", async () => {
    const d = day(10);
    await duty(f.c!, f.store!, d);
    const id = await one(
      pg,
      `INSERT INTO public.pharmacy_staff_leave (hospital_id, user_id, kind, date_from, date_to)
       VALUES ($1, $2, 'annual', $3, $4) RETURNING id`,
      [f.h, f.c, d, plus(d, 2)],
    );
    const decide = (status: string, by: string) =>
      pg.query(
        `UPDATE public.pharmacy_staff_leave SET status = $2, decided_by = $3, decided_at = now() WHERE id = $1`,
        [id, status, by],
      );
    await expect(decide("approved", f.a!)).rejects.toThrow(/only the in-charge/);
    await decide("approved", f.boss!);
    expect(await active(f.c!, d)).toBe(0);
    await expect(duty(f.c!, f.store!, plus(d, 1))).rejects.toThrow(/on leave/);
    await expect(decide("withdrawn", f.c!)).rejects.toThrow(/never changes/);
  });

  it("a swap is approved only after the colleague accepts, by the roster maker; the roster changes then", async () => {
    const d = day(12);
    const t = day(13);
    // A renewal: the latest licence wins.
    await licence(f.a!, day(60));
    await duty(f.a!, f.store!, d);
    await duty(f.b!, f.store!, t);
    const ev = (req: string, action: string, actor: string) =>
      pg.query(
        `INSERT INTO public.pharmacy_roster_request_events (request_id, actor_id, action) VALUES ($1, $2, $3)`,
        [req, actor, action],
      );
    await expect(
      pg.query(
        `INSERT INTO public.pharmacy_roster_requests (hospital_id, from_user, to_user, kind, give_date, give_place,
           give_shift, status) VALUES ($1, $2, $3, 'cover', $4, $5, 'day', 'incharge')`,
        [f.h, f.a, f.b, d, f.store],
      ),
    ).rejects.toThrow(/starts with the colleague/);
    const req = await one(
      pg,
      `INSERT INTO public.pharmacy_roster_requests (hospital_id, from_user, to_user, kind, give_date, give_place,
         give_shift, take_date, take_place, take_shift)
       VALUES ($1, $2, $3, 'swap', $4, $5, 'day', $6, $5, 'day') RETURNING id`,
      [f.h, f.a, f.b, d, f.store, t],
    );
    await ev(req, "asked", f.a!);
    await expect(ev(req, "approved", f.boss!)).rejects.toThrow(/not allowed while colleague/);
    await expect(ev(req, "accepted", f.c!)).rejects.toThrow(/not allowed/);
    await expect(
      pg.query(`UPDATE public.pharmacy_roster_requests SET status = 'approved' WHERE id = $1`, [
        req,
      ]),
    ).rejects.toThrow(/only through its events/);
    await ev(req, "accepted", f.b!);
    await expect(ev(req, "approved", f.a!)).rejects.toThrow(/not allowed/);
    await ev(req, "approved", f.boss!);
    expect(await active(f.a!, d)).toBe(0);
    expect(await active(f.b!, d)).toBe(1);
    expect(await active(f.a!, t)).toBe(1);
    expect(await active(f.b!, t)).toBe(0);
  });

  it("the proposer is not the second signer, and a signed number changes the check", async () => {
    const p = await one(
      pg,
      `INSERT INTO public.pharmacy_rule_proposals (hospital_id, rule_group, key, new_text, reason, proposed_by, params)
       VALUES ($1, 'roster', 'per_shift', 'At most 1 person on a shift at one place', 'Short staffed', $2,
         '{"n": 1}') RETURNING id`,
      [f.h, f.b],
    );
    const sign = (role: string, by: string) =>
      pg.query(
        `INSERT INTO public.pharmacy_rule_signatures (proposal_id, role, signed_by) VALUES ($1, $2, $3)`,
        [p, role, by],
      );
    // ADR 0550: no second signer; the head of pharmacy's signature applies the change.
    await expect(sign("second", f.a!)).rejects.toThrow(/only the head of pharmacy signs/);
    await expect(sign("in_charge", f.a!)).rejects.toThrow(/only the head of pharmacy signs/);
    await sign("in_charge", f.boss!);
    const d = day(20);
    await duty(f.b!, f.opd!, d);
    await expect(duty(f.deleg!, f.opd!, d)).rejects.toThrow(/full/);
  });
});
