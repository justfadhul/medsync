/**
 * Migration 0309 on the PGlite lane: week templates, publish and unlock, cover and swap requests, and
 * delegates. A published week refuses edits (rota_locked) except through an approved request, which still
 * passes the full 0307 guard; a request is asked by the holder, answered by the colleague and approved by a
 * rota maker only after acceptance; a delegate makes the rota until revoked, and publishes only with
 * publish rights. R8: one private.duty_rota_maker, four arguments, the fourth defaulted, so every
 * three-argument caller (0307's guard, lib/rota/write.ts mustMakeRota) keeps working. Runs with EMR_PGLITE=1.
 */
import type { Pg } from "./_pglite";
import { beforeAll, describe, expect, it } from "vitest";

import {
  authUser,
  bootLane,
  clinician,
  department,
  hospital,
  laneOn,
  probe,
  readMigration,
} from "./_pglite";

const at = (day: string, hour: number) => `${day}T${String(hour).padStart(2, "0")}:00:00+03:00`;

/** The HINT a refusal carries, or the message when it has none. */
const refusal = (p: Promise<unknown>) =>
  p.then(
    () => "allowed",
    (e: { hint?: string; message: string }) => e.hint ?? e.message,
  );

describe.skipIf(!laneOn)("0309 — duty rota upkeep", () => {
  let pg: Pg;
  let hA: string;
  let medicine: string;
  let surgery: string;
  let admin: string;
  let head: string;
  let mo: string;
  let c1: string;
  let c2: string;
  let c3: string;
  let onCall: string;
  let ward: string;

  async function post(name: string, departmentId = medicine, capacity = 1): Promise<string> {
    const r = await pg.query<{ id: string }>(
      `INSERT INTO public.duty_posts (hospital_id, department_id, scope_kind, name, level, eligible_cadres,
         capacity, created_by)
       VALUES ($1, $2, 'department', $3, 'senior', '{CONSULTANT,MEDICAL_OFFICER}', $4, $5) RETURNING id`,
      [hA, departmentId, name, capacity, admin],
    );
    return r.rows[0]!.id;
  }

  const assign = (o: { postId: string; userId: string; from: string; to: string; by?: string }) =>
    pg
      .query<{ id: string }>(
        `INSERT INTO public.duty_assignments (hospital_id, post_id, user_id, starts_at, ends_at, kind, created_by)
         VALUES ($1, $2, $3, $4, $5, 'rostered', $6) RETURNING id`,
        [hA, o.postId, o.userId, o.from, o.to, o.by ?? admin],
      )
      .then((r) => r.rows[0]!.id);

  const end = (id: string, by = admin) =>
    pg.query(
      `UPDATE public.duty_assignments SET ended_at = starts_at, ended_by = $2, end_reason = 'Cancelled' WHERE id = $1`,
      [id, by],
    );

  const week = (o: {
    weekStart: string;
    kind: "publish" | "unlock";
    by?: string;
    reason?: string | null;
    departmentId?: string;
  }) =>
    pg.query(
      `INSERT INTO public.duty_rota_week_events (hospital_id, department_id, week_start, kind, reason, actor_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [hA, o.departmentId ?? medicine, o.weekStart, o.kind, o.reason ?? null, o.by ?? admin],
    );

  const ask = (o: {
    kind: "cover" | "swap";
    assignmentId: string;
    askedBy: string;
    colleague: string;
    swapAssignmentId?: string | null;
  }) =>
    pg
      .query<{ id: string }>(
        `INSERT INTO public.duty_swap_requests (hospital_id, kind, assignment_id, asked_by, colleague_user_id,
           swap_assignment_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [hA, o.kind, o.assignmentId, o.askedBy, o.colleague, o.swapAssignmentId ?? null],
      )
      .then((r) => r.rows[0]!.id);

  const answer = (requestId: string, kind: string, actor: string, reason: string | null = null) =>
    pg.query(
      `INSERT INTO public.duty_swap_request_events (request_id, kind, actor_id, reason) VALUES ($1, $2, $3, $4)`,
      [requestId, kind, actor, reason],
    );

  const row = (id: string) =>
    pg
      .query<{
        ended_at: Date | null;
        end_reason: string | null;
      }>(`SELECT ended_at, end_reason FROM public.duty_assignments WHERE id = $1`, [id])
      .then((r) => r.rows[0]!);

  const coverOf = (id: string) =>
    pg
      .query<{ user_id: string; kind: string; starts_at: Date; ends_at: Date; created_by: string }>(
        `SELECT user_id, kind, starts_at, ends_at, created_by FROM public.duty_assignments
          WHERE covers_assignment_id = $1`,
        [id],
      )
      .then((r) => r.rows);

  beforeAll(async () => {
    ({ pg } = await bootLane());
    hA = await hospital(pg, "Upkeep A");
    medicine = await department(pg, hA, "Medicine");
    surgery = await department(pg, hA, "Surgery");
    admin = await authUser(pg, "admin");
    await pg.query(
      `INSERT INTO public.user_roles (user_id, role, hospital_id) VALUES ($1, 'hospital_admin', $2)`,
      [admin, hA],
    );
    head = (await clinician(pg, { hospitalId: hA, departmentId: medicine, cadre: "CONSULTANT" }))
      .userId;
    await pg.query(
      `INSERT INTO public.department_heads (hospital_id, department_id, user_id) VALUES ($1, $2, $3)`,
      [hA, medicine, head],
    );
    mo = (await clinician(pg, { hospitalId: hA, departmentId: medicine })).userId;
    c1 = (await clinician(pg, { hospitalId: hA, departmentId: medicine, cadre: "CONSULTANT" }))
      .userId;
    c2 = (await clinician(pg, { hospitalId: hA, departmentId: medicine, cadre: "CONSULTANT" }))
      .userId;
    c3 = (await clinician(pg, { hospitalId: hA, departmentId: medicine, cadre: "CONSULTANT" }))
      .userId;
    onCall = await post("Medical on call");
    ward = await post("Ward 5 senior");
  }, 180_000);

  it("a published week is locked until unlocked with a reason", async () => {
    const monday = "2027-02-01";
    const held = await assign({
      postId: onCall,
      userId: c1,
      from: at(monday, 8),
      to: at(monday, 17),
    });
    await week({ weekStart: monday, kind: "publish" });
    // Inserting or ending inside the published week is refused…
    expect(
      await refusal(
        assign({ postId: ward, userId: c2, from: at("2027-02-03", 8), to: at("2027-02-03", 17) }),
      ),
    ).toBe("rota_locked");
    expect(await refusal(end(held))).toBe("rota_locked");
    // …a Sunday night belongs to its own week, and the next week is a draft.
    expect(
      await refusal(
        assign({ postId: ward, userId: c2, from: at("2027-01-31", 17), to: at(monday, 8) }),
      ),
    ).toBe("allowed");
    expect(
      await refusal(
        assign({ postId: ward, userId: c2, from: at("2027-02-08", 8), to: at("2027-02-08", 17) }),
      ),
    ).toBe("allowed");
    // Another department's week is its own.
    const surgical = await post("Surgical on call", surgery);
    expect(
      await refusal(
        assign({ postId: surgical, userId: c3, from: at(monday, 8), to: at(monday, 17) }),
      ),
    ).toBe("allowed");
    // Publishing twice, unlocking without a reason, or a week that is not a Monday: refused.
    await expect(week({ weekStart: monday, kind: "publish" })).rejects.toThrow(/already published/);
    await expect(week({ weekStart: monday, kind: "unlock" })).rejects.toThrow(
      /duty_rota_week_events_reason/,
    );
    await expect(week({ weekStart: "2027-02-02", kind: "publish" })).rejects.toThrow(/week_start/);
    // Only a rota maker publishes or unlocks.
    await expect(
      week({ weekStart: monday, kind: "unlock", reason: "Fix", by: mo }),
    ).rejects.toThrow(/publish/);
    await week({ weekStart: monday, kind: "unlock", reason: "Dr B is on study leave" });
    expect(await refusal(end(held))).toBe("allowed");
    // The full guard still holds in an unlocked week.
    await pg.query(
      `INSERT INTO public.availability_blocks (hospital_id, clinician_user_id, kind, starts_at, ends_at, state)
       VALUES ($1, $2, 'leave', $3, $4, 'active')`,
      [hA, c3, at("2027-02-04", 0), at("2027-02-05", 0)],
    );
    expect(
      await refusal(
        assign({ postId: onCall, userId: c3, from: at("2027-02-04", 8), to: at("2027-02-04", 17) }),
      ),
    ).toBe("rota_leave");
    // Week events are append-only.
    await expect(
      pg.query(`DELETE FROM public.duty_rota_week_events WHERE week_start = $1`, [monday]),
    ).rejects.toThrow();
  });

  it("only the holder asks; only the colleague accepts", async () => {
    const d = "2027-03-01";
    const a = await assign({ postId: onCall, userId: c1, from: at(d, 8), to: at(d, 17) });
    const other = await assign({ postId: ward, userId: c2, from: at(d, 8), to: at(d, 17) });
    await expect(
      ask({ kind: "cover", assignmentId: a, askedBy: c2, colleague: c3 }),
    ).rejects.toThrow(/holder/);
    await expect(
      ask({ kind: "cover", assignmentId: a, askedBy: c1, colleague: c1 }),
    ).rejects.toThrow(/duty_swap_requests_colleague/);
    await expect(
      ask({ kind: "cover", assignmentId: a, askedBy: c1, colleague: c2, swapAssignmentId: other }),
    ).rejects.toThrow(/duty_swap_requests_swap_shape/);
    await expect(
      ask({ kind: "swap", assignmentId: a, askedBy: c1, colleague: c2 }),
    ).rejects.toThrow(/duty_swap_requests_swap_shape/);
    // R35: the swapped duty is the colleague's, on the same post.
    await expect(
      ask({ kind: "swap", assignmentId: a, askedBy: c1, colleague: c3, swapAssignmentId: other }),
    ).rejects.toThrow(/colleague's duty on the same post/);
    await expect(
      ask({ kind: "swap", assignmentId: a, askedBy: c1, colleague: c2, swapAssignmentId: other }),
    ).rejects.toThrow(/colleague's duty on the same post/);

    const req = await ask({ kind: "cover", assignmentId: a, askedBy: c1, colleague: c2 });
    for (const who of [c1, c3, admin])
      expect(await refusal(answer(req, "accepted", who))).toBe("request_state");
    expect(await refusal(answer(req, "withdrawn", c2))).toBe("request_state");
    expect(await refusal(answer(req, "declined", c2, "On nights"))).toBe("allowed");
    // Declined is final.
    expect(await refusal(answer(req, "accepted", c2))).toBe("request_state");
    expect(await refusal(answer(req, "approved", admin))).toBe("request_state");
    // Requests and their events are append-only.
    await expect(
      pg.query(`DELETE FROM public.duty_swap_request_events WHERE request_id = $1`, [req]),
    ).rejects.toThrow();
    await expect(
      pg.query(`UPDATE public.duty_swap_requests SET colleague_user_id = $2 WHERE id = $1`, [
        req,
        c3,
      ]),
    ).rejects.toThrow();
    // The asker withdraws an open request.
    const again = await ask({ kind: "cover", assignmentId: a, askedBy: c1, colleague: c3 });
    expect(await refusal(answer(again, "withdrawn", c1))).toBe("allowed");
    expect(await refusal(answer(again, "accepted", c3))).toBe("request_state");
  });

  it("a swap is approved only after the colleague accepts", async () => {
    const mine = await assign({
      postId: ward,
      userId: c1,
      from: at("2027-03-08", 8),
      to: at("2027-03-08", 17),
    });
    const theirs = await assign({
      postId: ward,
      userId: c2,
      from: at("2027-03-09", 8),
      to: at("2027-03-09", 17),
    });
    const req = await ask({
      kind: "swap",
      assignmentId: mine,
      askedBy: c1,
      colleague: c2,
      swapAssignmentId: theirs,
    });
    expect(await refusal(answer(req, "approved", admin))).toBe("request_state");
    expect(await refusal(answer(req, "accepted", c2))).toBe("allowed");
    // Only a rota maker approves.
    expect(await refusal(answer(req, "approved", mo))).toBe("request_state");
    expect(await refusal(answer(req, "approved", head))).toBe("allowed");
    // The mirror pair: each takes the other's duty, and both old duties ended as covered.
    expect((await row(mine)).end_reason).toBe("covered");
    expect((await row(theirs)).end_reason).toBe("covered");
    const [x] = await coverOf(mine);
    const [y] = await coverOf(theirs);
    expect(x).toMatchObject({ user_id: c2, kind: "swap", created_by: head });
    expect(y).toMatchObject({ user_id: c1, kind: "swap", created_by: head });
    expect(new Date(x!.starts_at).toISOString()).toBe(new Date(at("2027-03-08", 8)).toISOString());
    expect(new Date(y!.ends_at).toISOString()).toBe(new Date(at("2027-03-09", 17)).toISOString());
    // Approved is final.
    expect(await refusal(answer(req, "approved", admin))).toBe("request_state");
    expect(await refusal(answer(req, "withdrawn", c1))).toBe("request_state");
  });

  it("approval ends the old duty and writes the cover in one step", async () => {
    const monday = "2027-03-15";
    const a = await assign({ postId: onCall, userId: c1, from: at(monday, 8), to: at(monday, 17) });
    const b = await assign({
      postId: ward,
      userId: c1,
      from: at("2027-03-16", 8),
      to: at("2027-03-16", 17),
    });
    await week({ weekStart: monday, kind: "publish" });

    // c3 is on leave on the 16th: the cover fails the guard and nothing changes (one step, all or nothing).
    await pg.query(
      `INSERT INTO public.availability_blocks (hospital_id, clinician_user_id, kind, starts_at, ends_at, state)
       VALUES ($1, $2, 'leave', $3, $4, 'active')`,
      [hA, c3, at("2027-03-16", 0), at("2027-03-17", 0)],
    );
    const blocked = await ask({ kind: "cover", assignmentId: b, askedBy: c1, colleague: c3 });
    await answer(blocked, "accepted", c3);
    expect(await refusal(answer(blocked, "approved", admin))).toBe("rota_leave");
    expect((await row(b)).ended_at).toBeNull();
    expect(await coverOf(b)).toHaveLength(0);

    // In the published week, the approved request is the way through.
    const req = await ask({ kind: "cover", assignmentId: a, askedBy: c1, colleague: c2 });
    await answer(req, "accepted", c2);
    expect(await refusal(answer(req, "approved", admin))).toBe("allowed");
    const old = await row(a);
    expect(old.end_reason).toBe("covered");
    expect(new Date(old.ended_at!).toISOString()).toBe(new Date(at(monday, 8)).toISOString());
    const covers = await coverOf(a);
    expect(covers).toHaveLength(1);
    expect(covers[0]).toMatchObject({ user_id: c2, kind: "cover", created_by: admin });
    expect(new Date(covers[0]!.ends_at).toISOString()).toBe(new Date(at(monday, 17)).toISOString());
    // The bypass lasts only for the request: a plain insert into the week is still locked.
    expect(
      await refusal(
        assign({ postId: ward, userId: c2, from: at("2027-03-17", 8), to: at("2027-03-17", 17) }),
      ),
    ).toBe("rota_locked");
  });

  it("a delegate can make the rota; a revoked one cannot", async () => {
    const d = "2027-04-05";
    const delegate = (
      from: string,
      to: string,
      o: { until?: string | null; canPublish?: boolean } = {},
    ) =>
      pg
        .query<{ id: string }>(
          `INSERT INTO public.duty_rota_delegates (hospital_id, department_id, from_user, to_user, can_publish, until)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [hA, medicine, from, to, o.canPublish ?? false, o.until ?? null],
        )
        .then((r) => r.rows[0]!.id);
    expect(
      await refusal(assign({ postId: onCall, userId: c1, from: at(d, 8), to: at(d, 17), by: mo })),
    ).toBe("rota_maker");
    // Only the admin or the head hands it over; a delegate does not pass it on.
    expect(await refusal(delegate(c1, mo))).toBe("rota_maker");
    await expect(delegate(head, head)).rejects.toThrow(/duty_rota_delegates_self/);
    const id = await delegate(head, mo);
    expect(await refusal(delegate(mo, c2))).toBe("rota_maker");
    await expect(delegate(admin, c2, { until: "2020-01-01" })).rejects.toThrow(/passed/);
    const made = await assign({
      postId: onCall,
      userId: c1,
      from: at(d, 8),
      to: at(d, 17),
      by: mo,
    });
    // Templates follow the same maker rule.
    const template = (by: string, weekdays = "{1,2,3}") =>
      pg.query<{ id: string }>(
        `INSERT INTO public.duty_rota_templates (hospital_id, department_id, post_id, weekdays, shift, user_id, created_by)
         VALUES ($1, $2, $3, $4, 'day', $5, $6) RETURNING id`,
        [hA, medicine, onCall, weekdays, c1, by],
      );
    expect(await refusal(template(mo))).toBe("allowed");
    expect(await refusal(template(c2))).toBe("rota_maker");
    await expect(template(mo, "{0,1}")).rejects.toThrow(/duty_rota_templates_weekdays/);
    await expect(template(mo, "{}")).rejects.toThrow(/duty_rota_templates_weekdays/);
    const t = (await template(mo)).rows[0]!.id;
    await expect(
      pg.query(`UPDATE public.duty_rota_templates SET shift = 'night' WHERE id = $1`, [t]),
    ).rejects.toThrow(/only ending/);
    await expect(
      pg.query(`DELETE FROM public.duty_rota_templates WHERE id = $1`, [t]),
    ).rejects.toThrow(/never deleted/);
    await pg.query(
      `UPDATE public.duty_rota_templates SET ended_at = now(), ended_by = $2 WHERE id = $1`,
      [t, mo],
    );

    // Revoked, never deleted; only the admin or the head revokes.
    await expect(
      pg.query(`DELETE FROM public.duty_rota_delegates WHERE id = $1`, [id]),
    ).rejects.toThrow(/never deleted/);
    expect(
      await refusal(
        pg.query(
          `UPDATE public.duty_rota_delegates SET revoked_at = now(), revoked_by = $2 WHERE id = $1`,
          [id, mo],
        ),
      ),
    ).toBe("rota_maker");
    await pg.query(
      `UPDATE public.duty_rota_delegates SET revoked_at = now(), revoked_by = $2 WHERE id = $1`,
      [id, head],
    );
    expect(await refusal(end(made, mo))).toBe("rota_maker");
    expect(
      await refusal(
        assign({
          postId: onCall,
          userId: c2,
          from: at("2027-04-06", 8),
          to: at("2027-04-06", 17),
          by: mo,
        }),
      ),
    ).toBe("rota_maker");
  });

  it("a delegate without publish rights cannot publish", async () => {
    const monday = "2027-05-03";
    const del = (canPublish: boolean, to: string) =>
      pg.query(
        `INSERT INTO public.duty_rota_delegates (hospital_id, department_id, from_user, to_user, can_publish)
         VALUES ($1, $2, $3, $4, $5)`,
        [hA, medicine, admin, to, canPublish],
      );
    await del(false, c2);
    await del(true, c3);
    // Both make the rota…
    expect(
      await refusal(
        assign({ postId: onCall, userId: c1, from: at(monday, 8), to: at(monday, 17), by: c2 }),
      ),
    ).toBe("allowed");
    // …only the one with publish rights publishes.
    await expect(week({ weekStart: monday, kind: "publish", by: c2 })).rejects.toThrow(/publish/);
    await week({ weekStart: monday, kind: "publish", by: c3 });
    expect(
      await refusal(
        assign({ postId: ward, userId: c1, from: at(monday, 8), to: at(monday, 17), by: c3 }),
      ),
    ).toBe("rota_locked");
  });

  it("staff of the hospital read the upkeep tables, anon does not", async () => {
    for (const t of [
      "duty_rota_week_events",
      "duty_swap_requests",
      "duty_swap_request_events",
      "duty_rota_delegates",
    ]) {
      const staff = await probe(
        pg,
        { userId: mo, role: "medsync_clinical_reader", hospitalId: hA },
        `SELECT count(*)::int AS n FROM public.${t}`,
      );
      expect(staff.ok && (staff.rows[0]!.n as number), t).toBeGreaterThan(0);
      const anon = await probe(
        pg,
        { userId: null, role: "anon" },
        `SELECT count(*)::int AS n FROM public.${t}`,
      );
      expect(anon.ok && (anon.rows[0]!.n as number), t).toBeFalsy();
    }
  });

  it("R8: one rota maker, and three-argument callers still pass; 0307 then 0309 re-run cleanly", async () => {
    const overloads = () =>
      pg
        .query<{ args: string }>(
          `SELECT pg_get_function_identity_arguments(p.oid) AS args FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'private' AND p.proname = 'duty_rota_maker'`,
        )
        .then((r) => r.rows.map((x) => x.args));
    const expected = ["p_hospital uuid, p_user uuid, p_department uuid, p_publish boolean"];
    expect(await overloads()).toEqual(expected);
    const three = () =>
      pg
        .query<{
          ok: boolean;
        }>(`SELECT private.duty_rota_maker($1::uuid, $2::uuid, $3::uuid) AS ok`, [hA, head, medicine])
        .then((r) => r.rows[0]!.ok);
    expect(await three()).toBe(true);
    // Re-running 0307 brings back its overload; re-running 0309 after it drops it again.
    await pg.exec(readMigration("0307_duty_rota.sql"));
    await pg.exec(readMigration("0309_duty_rota_upkeep.sql"));
    expect(await overloads()).toEqual(expected);
    expect(await three()).toBe(true);
    // And the guard after the re-run is 0309's, calling the maker with three arguments.
    expect(
      await refusal(
        assign({ postId: ward, userId: c1, from: at("2027-05-04", 8), to: at("2027-05-04", 17) }),
      ),
    ).toBe("rota_locked");
  });
});
