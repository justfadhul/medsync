/**
 * The upkeep screens' reads (ADR 0538) on the PGlite lane: swapOptions (who a holder may ask, which duties a swap
 * could take), swapsAskedOfMe (only the named colleague) and delegatedDepartments (R52: the guard's own maker rule).
 * Runs with EMR_PGLITE=1.
 */
import type { Lane } from "./_pglite";
import type { RotaActor } from "@/lib/rota/write";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { delegatedDepartments, swapOptions, swapsAskedOfMe } from "@/lib/rota/read";
import { addDelegate, askCoverOrSwap, assignDuty, createPost } from "@/lib/rota/write";
import { authUser, bootLane, clinician, department, hospital, laneOn } from "./_pglite";

const saved = process.env.DUTY_ROTA;
const NOW = new Date("2027-03-01T00:00:00Z");

describe.skipIf(!laneOn)("rota upkeep reads (PGlite lane)", () => {
  let lane: Lane;
  let h: string;
  let med: string;
  let sur: string;
  let admin: RotaActor;
  let admin2: { userId: string; hospitalId: string };
  let mo: string;
  let mo2: string;
  let c1: string;
  let post: string;
  let other: string;
  const opts = () => ({ database: lane.db });
  const ok = async <T>(p: Promise<{ ok: boolean; error?: string; data?: T }>) => {
    const r = await p;
    if (!r.ok) throw new Error(r.error);
    return r.data as T;
  };
  const duty = (as: RotaActor, postId: string, userId: string, day: string) =>
    ok<{ id: string }>(
      assignDuty(
        as,
        { postId, userId, day, shift: "day", kind: "rostered", coversAssignmentId: null },
        opts(),
      ),
    ).then((d) => d.id);
  const mkPost = (name: string, cadre: string) =>
    ok<{ id: string }>(
      createPost(
        admin,
        {
          departmentId: med,
          wardId: null,
          name,
          level: "senior",
          eligibleCadres: [cadre],
          takesConsults: false,
          escalatesToPostId: null,
          capacity: 1,
        },
        opts(),
      ),
    ).then((p) => p.id);

  beforeAll(async () => {
    process.env.DUTY_ROTA = "1";
    lane = await bootLane();
    const pg = lane.pg;
    h = await hospital(pg, "Rota screens");
    med = await department(pg, h, "Medicine");
    sur = await department(pg, h, "Surgery");
    const mkAdmin = async (n: string) => {
      const id = await authUser(pg, n);
      await pg.query(
        `INSERT INTO public.user_roles (user_id, role, hospital_id) VALUES ($1, 'hospital_admin', $2)`,
        [id, h],
      );
      return { userId: id, hospitalId: h };
    };
    admin = await mkAdmin("admin");
    admin2 = await mkAdmin("admin2");
    mo = (await clinician(pg, { hospitalId: h, departmentId: med })).userId;
    mo2 = (await clinician(pg, { hospitalId: h, departmentId: med })).userId;
    c1 = (await clinician(pg, { hospitalId: h, departmentId: med, cadre: "CONSULTANT" })).userId;
    for (const [id, n] of [
      [mo, "Dr Okello Screens"],
      [mo2, "Dr Auma Screens"],
      [c1, "Dr Achieng Screens"],
    ] as const)
      await pg.query(
        `INSERT INTO public.users (id, full_name, email) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET full_name = excluded.full_name`,
        [id, n, `${id}@lane.test`],
      );
    post = await mkPost("Medical officer on call", "MEDICAL_OFFICER");
    other = await mkPost("Consultant in charge", "CONSULTANT");
  }, 900_000);

  afterAll(() => {
    if (saved === undefined) delete process.env.DUTY_ROTA;
    else process.env.DUTY_ROTA = saved;
  });

  it("swapOptions: the post's grades, same-post live duties, 14 days, leave respected", async () => {
    const mine = await duty(admin, post, mo, "2027-03-02");
    await duty(admin, post, mo, "2027-03-20"); // beyond 14 days
    const theirs = await duty(admin, post, mo2, "2027-03-03");
    await duty(admin, post, mo2, "2027-03-25"); // beyond 14 days
    await duty(admin, other, c1, "2027-03-03"); // another post
    await lane.pg.query(
      `INSERT INTO public.availability_blocks (hospital_id, clinician_user_id, kind, starts_at, ends_at, state)
       VALUES ($1, $2, 'leave', '2027-03-02T08:00:00+03:00', '2027-03-03T08:00:00+03:00', 'active')`,
      [h, mo],
    );
    const options = await swapOptions(mo, h, NOW, opts());
    expect(options).toHaveLength(1);
    const o = options[0]!;
    expect(o).toMatchObject({
      id: mine,
      postName: "Medical officer on call",
      state: "needs_cover",
    });
    // Not the asker, not the consultant: only people the post's grade takes.
    expect(o.colleagues).toEqual([{ userId: mo2, name: "Dr Auma Screens" }]);
    expect(o.theirDuties.map((d) => d.id)).toEqual([theirs]);
  });

  it("asked of you reaches only the named colleague", async () => {
    const [o] = await swapOptions(mo, h, NOW, opts());
    await ok(
      askCoverOrSwap(
        { userId: mo, hospitalId: h },
        { assignmentId: o!.id, kind: "cover", colleagueUserId: mo2 },
        opts(),
      ),
    );
    expect(await swapsAskedOfMe(mo2, h, opts())).toHaveLength(1);
    expect(await swapsAskedOfMe(mo, h, opts())).toEqual([]);
    expect(await swapsAskedOfMe(c1, h, opts())).toEqual([]);
  });

  it("delegatedDepartments: publish right per delegation; a lapsed grantor lists nothing", async () => {
    const pg = lane.pg;
    const withPub = (await clinician(pg, { hospitalId: h, departmentId: med })).userId;
    const without = (await clinician(pg, { hospitalId: h, departmentId: sur })).userId;
    const lapsed = (await clinician(pg, { hospitalId: h, departmentId: med })).userId;
    await ok(
      addDelegate(
        admin,
        { departmentId: med, toUserId: withPub, canPublish: true, until: null },
        opts(),
      ),
    );
    await ok(
      addDelegate(
        admin,
        { departmentId: sur, toUserId: without, canPublish: false, until: null },
        opts(),
      ),
    );
    await ok(
      addDelegate(
        admin2,
        { departmentId: med, toUserId: lapsed, canPublish: true, until: null },
        opts(),
      ),
    );
    expect(await delegatedDepartments(withPub, h, opts())).toEqual([
      { id: med, name: expect.any(String), canPublish: true },
    ]);
    expect(await delegatedDepartments(without, h, opts())).toEqual([
      { id: sur, name: expect.any(String), canPublish: false },
    ]);
    expect(await delegatedDepartments(lapsed, h, opts())).toHaveLength(1);
    // The grantor steps down: the guard no longer takes the hand-over, so nothing is listed.
    await pg.query(`DELETE FROM public.user_roles WHERE user_id = $1`, [admin2.userId]);
    expect(await delegatedDepartments(lapsed, h, opts())).toEqual([]);
    expect(await delegatedDepartments(mo, h, opts())).toEqual([]);
  });
});
