/**
 * Migration 0307 on the PGlite lane: duty posts, duty assignments and the guard trigger. Grade, leave,
 * double booking and capacity are refused with the HINTs content/duty-rota.ts words; only the hospital
 * admin or the department head makes the rota; assignments are ended, never edited or deleted; staff of
 * the hospital read it, patients and anon do not. Windows are half-open (end exclusive), as lib/rota/cover.ts.
 * The post lock (pg_advisory_xact_lock) cannot race on PGlite's one connection: the static test checks it
 * is taken before the counts, as 0273's roster guard does. Runs with EMR_PGLITE=1.
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
  patient,
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

describe.skipIf(!laneOn)("0307 — duty rota", () => {
  let pg: Pg;
  let hA: string;
  let hB: string;
  let medicine: string;
  let surgery: string;
  let admin: string;
  let head: string;
  let mo: string;
  let intern: string;
  let c1: string;
  let c2: string;
  let doctorB: string;
  let consultantPost: string;
  let onCallPost: string;

  async function post(o: {
    name: string;
    level: string;
    cadres: string[];
    capacity?: number;
    departmentId?: string;
  }): Promise<string> {
    const r = await pg.query<{ id: string }>(
      `INSERT INTO public.duty_posts (hospital_id, department_id, scope_kind, name, level, eligible_cadres,
         capacity, created_by)
       VALUES ($1, $2, 'department', $3, $4, $5, $6, $7) RETURNING id`,
      [hA, o.departmentId ?? medicine, o.name, o.level, o.cadres, o.capacity ?? 1, admin],
    );
    return r.rows[0]!.id;
  }

  const assign = (o: {
    postId: string;
    userId: string;
    from: string;
    to: string;
    kind?: string;
    covers?: string;
    by?: string;
  }) =>
    pg
      .query<{ id: string }>(
        `INSERT INTO public.duty_assignments (hospital_id, post_id, user_id, starts_at, ends_at, kind,
           covers_assignment_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          hA,
          o.postId,
          o.userId,
          o.from,
          o.to,
          o.kind ?? "rostered",
          o.covers ?? null,
          o.by ?? admin,
        ],
      )
      .then((r) => r.rows[0]!.id);

  beforeAll(async () => {
    ({ pg } = await bootLane());
    hA = await hospital(pg, "Rota A");
    hB = await hospital(pg, "Rota B");
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
    intern = (
      await clinician(pg, { hospitalId: hA, departmentId: medicine, cadre: "INTERN_DOCTOR" })
    ).userId;
    c1 = (await clinician(pg, { hospitalId: hA, departmentId: medicine, cadre: "CONSULTANT" }))
      .userId;
    c2 = (await clinician(pg, { hospitalId: hA, departmentId: medicine, cadre: "CONSULTANT" }))
      .userId;
    doctorB = (await clinician(pg, { hospitalId: hB, departmentId: await department(pg, hB) }))
      .userId;
    consultantPost = await post({
      name: "Consultant in charge",
      level: "consultant",
      cadres: ["CONSULTANT"],
    });
    onCallPost = await post({
      name: "Medical on call",
      level: "senior",
      cadres: ["CONSULTANT", "MEDICAL_OFFICER"],
      capacity: 2,
    });
  }, 180_000);

  it("an intern cannot fill a consultant post", async () => {
    const d = "2027-01-04";
    expect(
      await refusal(
        assign({ postId: consultantPost, userId: intern, from: at(d, 8), to: at(d, 17) }),
      ),
    ).toBe("rota_grade");
    expect(
      await refusal(assign({ postId: consultantPost, userId: c1, from: at(d, 8), to: at(d, 17) })),
    ).toBe("allowed");
  });

  it("nobody on approved leave is rostered", async () => {
    const d = "2027-01-05";
    const leave = (state: string, userId: string) =>
      pg.query(
        `INSERT INTO public.availability_blocks (hospital_id, clinician_user_id, kind, starts_at, ends_at, state)
         VALUES ($1, $2, 'leave', $3, $4, $5)`,
        [hA, userId, at(d, 0), at(d, 12), state],
      );
    await leave("active", mo);
    await leave("requested", c2);
    expect(
      await refusal(assign({ postId: onCallPost, userId: mo, from: at(d, 8), to: at(d, 17) })),
    ).toBe("rota_leave");
    expect(
      await refusal(assign({ postId: onCallPost, userId: c2, from: at(d, 8), to: at(d, 17) })),
    ).toBe("allowed");
    // Half-open: a duty starting as the leave ends does not overlap it.
    expect(
      await refusal(assign({ postId: onCallPost, userId: mo, from: at(d, 12), to: at(d, 17) })),
    ).toBe("allowed");
  });

  it("double booking is refused, two posts at once are allowed", async () => {
    const d = "2027-01-06";
    await assign({ postId: onCallPost, userId: c1, from: at(d, 8), to: at(d, 17) });
    expect(
      await refusal(assign({ postId: onCallPost, userId: c1, from: at(d, 12), to: at(d, 20) })),
    ).toBe("rota_double");
    expect(
      await refusal(assign({ postId: consultantPost, userId: c1, from: at(d, 8), to: at(d, 17) })),
    ).toBe("allowed");
  });

  it("capacity counts, a cover does not double count", async () => {
    const d = "2027-01-07";
    const first = await assign({
      postId: consultantPost,
      userId: c1,
      from: at(d, 8),
      to: at(d, 17),
    });
    expect(
      await refusal(assign({ postId: consultantPost, userId: c2, from: at(d, 8), to: at(d, 17) })),
    ).toBe("rota_full");
    expect(
      await refusal(
        assign({
          postId: consultantPost,
          userId: c2,
          from: at(d, 8),
          to: at(d, 17),
          kind: "cover",
          covers: first,
        }),
      ),
    ).toBe("allowed");
    // End exclusive: the night after the day is not an overlap.
    expect(
      await refusal(
        assign({ postId: consultantPost, userId: head, from: at(d, 17), to: at("2027-01-08", 8) }),
      ),
    ).toBe("allowed");
    // An assignment ended early frees the rest of its window.
    const ended = await assign({
      postId: consultantPost,
      userId: c1,
      from: at("2027-01-09", 8),
      to: at("2027-01-09", 17),
    });
    await pg.query(
      `UPDATE public.duty_assignments SET ended_at = $2, ended_by = $3, end_reason = 'Unwell' WHERE id = $1`,
      [ended, at("2027-01-09", 12), admin],
    );
    expect(
      await refusal(
        assign({
          postId: consultantPost,
          userId: c2,
          from: at("2027-01-09", 12),
          to: at("2027-01-09", 17),
        }),
      ),
    ).toBe("allowed");
  });

  it("only the admin or the head makes the rota", async () => {
    const d = "2027-01-11";
    expect(
      await refusal(
        assign({ postId: onCallPost, userId: c1, from: at(d, 8), to: at(d, 17), by: mo }),
      ),
    ).toBe("rota_maker");
    expect(
      await refusal(
        assign({ postId: onCallPost, userId: c1, from: at(d, 8), to: at(d, 17), by: admin }),
      ),
    ).toBe("allowed");
    expect(
      await refusal(
        assign({ postId: onCallPost, userId: c2, from: at(d, 8), to: at(d, 17), by: head }),
      ),
    ).toBe("allowed");
    // The head of Medicine does not make Surgery's rota.
    const surgical = await post({
      name: "Surgical on call",
      level: "senior",
      cadres: ["CONSULTANT"],
      departmentId: surgery,
    });
    expect(
      await refusal(
        assign({ postId: surgical, userId: c1, from: at(d, 8), to: at(d, 17), by: head }),
      ),
    ).toBe("rota_maker");
  });

  it("assignments are ended, never edited or deleted", async () => {
    const d = "2027-01-12";
    const id = await assign({ postId: onCallPost, userId: c1, from: at(d, 8), to: at(d, 17) });
    await expect(
      pg.query(`UPDATE public.duty_assignments SET ends_at = $2 WHERE id = $1`, [id, at(d, 20)]),
    ).rejects.toThrow(/only ending/);
    await expect(
      pg.query(`DELETE FROM public.duty_assignments WHERE id = $1`, [id]),
    ).rejects.toThrow(/never deleted/);
    await expect(
      pg.query(`UPDATE public.duty_assignments SET ended_at = now(), ended_by = $2 WHERE id = $1`, [
        id,
        admin,
      ]),
    ).rejects.toThrow(/duty_assignments_end_shape/);
    expect(
      await refusal(
        pg.query(
          `UPDATE public.duty_assignments SET ended_at = now(), ended_by = $2, end_reason = 'Sick' WHERE id = $1`,
          [id, mo],
        ),
      ),
    ).toBe("rota_maker");
    await pg.query(
      `UPDATE public.duty_assignments SET ended_at = now(), ended_by = $2, end_reason = 'Sick' WHERE id = $1`,
      [id, admin],
    );
    await expect(
      pg.query(
        `UPDATE public.duty_assignments SET ended_at = now(), end_reason = 'Again' WHERE id = $1`,
        [id],
      ),
    ).rejects.toThrow(/only ending/);

    // Posts: archived, never edited; an archived post takes no one.
    await expect(
      pg.query(`UPDATE public.duty_posts SET name = 'Renamed' WHERE id = $1`, [onCallPost]),
    ).rejects.toThrow(/only archiving/);
    const old = await post({ name: "Old post", level: "junior", cadres: ["INTERN_DOCTOR"] });
    await pg.query(
      `UPDATE public.duty_posts SET archived_at = now(), archived_by = $2 WHERE id = $1`,
      [old, admin],
    );
    expect(
      await refusal(assign({ postId: old, userId: intern, from: at(d, 8), to: at(d, 17) })),
    ).toMatch(/archived/);
  });

  it("staff read the rota, patients and anon do not", async () => {
    const read = (
      userId: string | null,
      role: "medsync_clinical_reader" | "authenticated" | "anon",
      hospitalId?: string,
    ) =>
      probe(
        pg,
        { userId, role, hospitalId, aal: "aal2" },
        `SELECT count(*)::int AS n FROM public.duty_assignments`,
      ).then((r) => (r.ok ? (r.rows[0]!.n as number) : 0));
    expect(await read(mo, "medsync_clinical_reader", hA)).toBeGreaterThan(0);
    expect(await read(doctorB, "medsync_clinical_reader", hB)).toBe(0);
    expect(await read(await patient(pg), "authenticated")).toBe(0);
    expect(await read(null, "anon")).toBe(0);
    const posts = await probe(
      pg,
      { userId: mo, role: "medsync_clinical_reader", hospitalId: hA },
      `SELECT count(*)::int AS n FROM public.duty_posts`,
    );
    expect(posts.ok && (posts.rows[0]!.n as number)).toBeGreaterThan(0);
  });

  it("re-runs cleanly, and care_request_events.post_id gains its FK", async () => {
    await expect(pg.exec(readMigration("0307_duty_rota.sql"))).resolves.toBeTruthy();
    const fk = await pg.query(`SELECT 1 FROM pg_constraint WHERE conname = 'cre_post_fk'`);
    expect(fk.rows.length).toBe(1);
  });
});
