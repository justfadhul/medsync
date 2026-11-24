/**
 * Rota upkeep writes (migration 0309, ADR 0538) on the PGlite lane: templates and fill-from-template, publish and
 * unlock, cover and swap requests, delegates. Every refusal comes back in content/duty-rota.ts words, never a raw
 * Postgres error; a fill reports each refused line instead of stopping. Runs with EMR_PGLITE=1.
 */
import type { Lane } from "./_pglite";
import type { RotaActor } from "@/lib/rota/write";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DUTY_ROTA_COPY } from "@/content/duty-rota";
import { loadRotaWeek, swapsAskedOfMe } from "@/lib/rota/read";
import {
  addDelegate,
  answerSwap,
  askCoverOrSwap,
  assignDuty,
  createPost,
  decideSwap,
  endTemplateLine,
  fillWeekFromTemplates,
  publishWeek,
  revokeDelegate,
  saveTemplateLine,
  unlockWeek,
} from "@/lib/rota/write";
import { authUser, bootLane, clinician, department, hospital, laneOn } from "./_pglite";

const saved = process.env.DUTY_ROTA;
const R = DUTY_ROTA_COPY.refusal;
const W1 = "2027-03-01"; // a Monday, in the future
const W2 = "2027-03-08";

describe.skipIf(!laneOn)("rota upkeep writes (PGlite lane)", () => {
  let lane: Lane;
  let h: string;
  let med: string;
  let admin: RotaActor;
  let mo: string;
  let mo2: string;
  let c1: string;
  let post: string;
  const opts = () => ({ database: lane.db });
  const as = (userId: string): RotaActor => ({ userId, hospitalId: h });
  const ok = async <T>(p: Promise<{ ok: boolean; error?: string; data?: T }>) => {
    const r = await p;
    if (!r.ok) throw new Error(r.error);
    return r.data as T;
  };
  const refused = (r: { ok: boolean; error?: string }, words: string) =>
    expect(r).toMatchObject({ ok: false, error: words });
  const duty = (userId: string, day: string, shift: "day" | "night" = "day") =>
    ok<{ id: string }>(
      assignDuty(
        admin,
        { postId: post, userId, day, shift, kind: "rostered", coversAssignmentId: null },
        opts(),
      ),
    ).then((d) => d.id);
  const count = async (sql: string, args: unknown[] = []) =>
    Number((await lane.pg.query<{ n: string }>(sql, args)).rows[0]!.n);

  beforeAll(async () => {
    process.env.DUTY_ROTA = "1";
    lane = await bootLane();
    const pg = lane.pg;
    h = await hospital(pg, "Rota upkeep");
    med = await department(pg, h, "Medicine");
    const a = await authUser(pg, "admin");
    await pg.query(
      `INSERT INTO public.user_roles (user_id, role, hospital_id) VALUES ($1, 'hospital_admin', $2)`,
      [a, h],
    );
    admin = as(a);
    mo = (await clinician(pg, { hospitalId: h, departmentId: med })).userId;
    mo2 = (await clinician(pg, { hospitalId: h, departmentId: med })).userId;
    c1 = (await clinician(pg, { hospitalId: h, departmentId: med, cadre: "CONSULTANT" })).userId;
    for (const [id, n] of [
      [mo, "Dr Okello Upkeep"],
      [mo2, "Dr Auma Upkeep"],
      [c1, "Dr Achieng Upkeep"],
    ] as const)
      await pg.query(
        `INSERT INTO public.users (id, full_name, email) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET full_name = excluded.full_name`,
        [id, n, `${id}@lane.test`],
      );
    post = (
      await ok<{ id: string }>(
        createPost(
          admin,
          {
            departmentId: med,
            wardId: null,
            name: "Medical officer on call",
            level: "senior",
            eligibleCadres: ["MEDICAL_OFFICER"],
            takesConsults: false,
            escalatesToPostId: null,
            capacity: 1,
          },
          opts(),
        ),
      )
    ).id;
  }, 900_000);

  afterAll(() => {
    if (saved === undefined) delete process.env.DUTY_ROTA;
    else process.env.DUTY_ROTA = saved;
  });

  it("fill week writes the template's duties and reports refusals in words", async () => {
    // Fresh department week so earlier tests leave it alone: Medicine W1 holds only this fill.
    await lane.pg.query(
      `INSERT INTO public.availability_blocks (hospital_id, clinician_user_id, kind, starts_at, ends_at, state)
       VALUES ($1, $2, 'leave', '2027-03-02T00:00:00+03:00', '2027-03-03T00:00:00+03:00', 'active')`,
      [h, mo],
    );
    await ok(
      saveTemplateLine(
        admin,
        { postId: post, weekdays: [1, 2, 3], shift: "day", userId: mo },
        opts(),
      ),
    );
    // A line with no person fills nothing.
    await ok(
      saveTemplateLine(admin, { postId: post, weekdays: [4], shift: "day", userId: null }, opts()),
    );
    const r = await fillWeekFromTemplates(admin, { departmentId: med, weekStart: W1 }, opts());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data!.written).toBe(2);
    expect(r.data!.skipped).toEqual([
      { line: { postId: post, userId: mo, day: "2027-03-02", shift: "day" }, why: R.rota_leave },
    ]);
    expect(
      await count(`SELECT count(*) n FROM public.duty_assignments WHERE user_id = $1`, [mo]),
    ).toBe(2);
    // Again: what is held is not written twice; the refused day is reported again.
    const again = await fillWeekFromTemplates(admin, { departmentId: med, weekStart: W1 }, opts());
    expect(again.ok && again.data!.written).toBe(0);
    expect(again.ok && again.data!.skipped).toHaveLength(1);
    // Not a rota maker, and not a Monday.
    refused(
      await fillWeekFromTemplates(as(mo), { departmentId: med, weekStart: W1 }, opts()),
      R.rota_maker,
    );
    expect(
      await fillWeekFromTemplates(admin, { departmentId: med, weekStart: "2027-03-02" }, opts()),
    ).toMatchObject({ ok: false, code: "invalid" });
  });

  it("templates: a line is ended, never edited; an archived post is refused in words", async () => {
    const line = await ok<{ id: string }>(
      saveTemplateLine(admin, { postId: post, weekdays: [5], shift: "night", userId: mo2 }, opts()),
    );
    refused(
      await saveTemplateLine(
        as(mo),
        { postId: post, weekdays: [5], shift: "day", userId: null },
        opts(),
      ),
      R.rota_maker,
    );
    await ok(endTemplateLine(admin, { lineId: line.id }, opts()));
    expect(await endTemplateLine(admin, { lineId: line.id }, opts())).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect((await loadRotaWeek(h, med, W1, opts())).templates.some((t) => t.id === line.id)).toBe(
      false,
    );
    // A post archived by hand under the app's check: the guard's HINT, not a raw error.
    const old = await ok<{ id: string }>(
      createPost(
        admin,
        {
          departmentId: med,
          wardId: null,
          name: "Closing post",
          level: "junior",
          eligibleCadres: ["MEDICAL_OFFICER"],
          takesConsults: false,
          escalatesToPostId: null,
          capacity: 1,
        },
        opts(),
      ),
    );
    await lane.pg.query(
      `UPDATE public.duty_posts SET archived_at = now(), archived_by = $2 WHERE id = $1`,
      [old.id, admin.userId],
    );
    expect(
      await saveTemplateLine(
        admin,
        { postId: old.id, weekdays: [1], shift: "day", userId: null },
        opts(),
      ),
    ).toMatchObject({ ok: false, code: "not_found" });
  });

  it("publish then a direct edit is refused with the locked words", async () => {
    await ok(publishWeek(admin, { departmentId: med, weekStart: W2 }, opts()));
    expect((await loadRotaWeek(h, med, W2, opts())).published).toBe(true);
    const direct = await assignDuty(
      admin,
      {
        postId: post,
        userId: mo2,
        day: W2,
        shift: "day",
        kind: "rostered",
        coversAssignmentId: null,
      },
      opts(),
    );
    refused(direct, R.rota_locked);
    refused(
      await publishWeek(admin, { departmentId: med, weekStart: W2 }, opts()),
      R.rota_week_state,
    );
    refused(await publishWeek(as(mo), { departmentId: med, weekStart: W1 }, opts()), R.rota_maker);
    // Fill into a published week reports every line as locked.
    const fill = await fillWeekFromTemplates(admin, { departmentId: med, weekStart: W2 }, opts());
    expect(fill.ok && fill.data!.written).toBe(0);
    expect(fill.ok && fill.data!.skipped.every((s) => s.why === R.rota_locked)).toBe(true);
    await ok(
      unlockWeek(admin, { departmentId: med, weekStart: W2, reason: "Fix a mistake" }, opts()),
    );
    refused(
      await unlockWeek(admin, { departmentId: med, weekStart: W2, reason: "Again please" }, opts()),
      R.rota_week_state,
    );
    expect(
      await unlockWeek(admin, { departmentId: med, weekStart: W2, reason: "x" }, opts()),
    ).toMatchObject({
      ok: false,
      code: "invalid",
    });
    await duty(mo2, W2); // a draft again
  });

  it("ask, accept, approve: the colleague holds the duty", async () => {
    const mine = await duty(mo, "2027-03-15");
    // Only the holder asks; the colleague alone answers; the maker approves only after acceptance.
    refused(
      await askCoverOrSwap(
        as(mo2),
        { assignmentId: mine, kind: "cover", colleagueUserId: mo },
        opts(),
      ),
      R.rota_holder,
    );
    const req = await ok<{ id: string }>(
      askCoverOrSwap(as(mo), { assignmentId: mine, kind: "cover", colleagueUserId: mo2 }, opts()),
    );
    const toMe = await swapsAskedOfMe(mo2, h, opts());
    expect(toMe).toEqual([
      expect.objectContaining({ id: req.id, askedByName: "Dr Okello Upkeep" }),
    ]);
    refused(
      await decideSwap(admin, { requestId: req.id, decision: "approved" }, opts()),
      R.request_state,
    );
    refused(
      await answerSwap(as(mo), { requestId: req.id, answer: "accepted" }, opts()),
      R.request_state,
    );
    await ok(answerSwap(as(mo2), { requestId: req.id, answer: "accepted" }, opts()));
    expect(await swapsAskedOfMe(mo2, h, opts())).toEqual([]);
    expect((await loadRotaWeek(h, med, "2027-03-15", opts())).swapsToDecide).toEqual([
      expect.objectContaining({ id: req.id, colleagueName: "Dr Auma Upkeep" }),
    ]);
    // Published week: the approved cover still lands.
    await ok(publishWeek(admin, { departmentId: med, weekStart: "2027-03-15" }, opts()));
    refused(
      await decideSwap(as(mo2), { requestId: req.id, decision: "approved" }, opts()),
      R.request_state,
    );
    await ok(decideSwap(admin, { requestId: req.id, decision: "approved" }, opts()));
    const rows = (
      await lane.pg.query<{ user_id: string; kind: string; end_reason: string | null }>(
        `SELECT user_id, kind, end_reason FROM public.duty_assignments WHERE hospital_id = $1
          AND starts_at >= '2027-03-15T00:00:00+03:00' AND starts_at < '2027-03-16T00:00:00+03:00' ORDER BY created_at`,
        [h],
      )
    ).rows;
    expect(rows.find((r) => r.user_id === mo)?.end_reason).toBe("covered");
    expect(rows.find((r) => r.user_id === mo2)?.kind).toBe("cover");
    refused(
      await decideSwap(admin, { requestId: req.id, decision: "refused" }, opts()),
      R.request_state,
    );
    expect((await loadRotaWeek(h, med, "2027-03-15", opts())).swapsToDecide).toEqual([]);
  });

  it("a refused swap leaves the rota unchanged", async () => {
    const a = await duty(mo, "2027-03-22");
    const b = await duty(mo2, "2027-03-23");
    const req = await ok<{ id: string }>(
      askCoverOrSwap(
        as(mo),
        { assignmentId: a, kind: "swap", colleagueUserId: mo2, swapAssignmentId: b },
        opts(),
      ),
    );
    await ok(answerSwap(as(mo2), { requestId: req.id, answer: "accepted" }, opts()));
    await ok(
      decideSwap(
        admin,
        { requestId: req.id, decision: "refused", reason: "Short staffed" },
        opts(),
      ),
    );
    expect(
      await count(
        `SELECT count(*) n FROM public.duty_assignments WHERE id IN ($1, $2) AND ended_at IS NULL`,
        [a, b],
      ),
    ).toBe(2);
    expect(
      await count(
        `SELECT count(*) n FROM public.duty_assignments WHERE covers_assignment_id IN ($1, $2)`,
        [a, b],
      ),
    ).toBe(0);
    // A swap must name the colleague's own duty on this post; a declined cover ends there.
    refused(
      await askCoverOrSwap(
        as(mo),
        { assignmentId: a, kind: "swap", colleagueUserId: mo2, swapAssignmentId: a },
        opts(),
      ),
      R.rota_cover,
    );
    expect(
      await askCoverOrSwap(as(mo), { assignmentId: a, kind: "swap", colleagueUserId: mo2 }, opts()),
    ).toMatchObject({ ok: false, code: "invalid" });
    const req2 = await ok<{ id: string }>(
      askCoverOrSwap(as(mo), { assignmentId: a, kind: "cover", colleagueUserId: mo2 }, opts()),
    );
    await ok(answerSwap(as(mo2), { requestId: req2.id, answer: "declined" }, opts()));
    refused(
      await answerSwap(as(mo2), { requestId: req2.id, answer: "accepted" }, opts()),
      R.request_state,
    );
  });

  it("an approved swap trades the two duties", async () => {
    const a = await duty(mo, "2027-04-12");
    const b = await duty(mo2, "2027-04-13");
    const req = await ok<{ id: string }>(
      askCoverOrSwap(
        as(mo),
        { assignmentId: a, kind: "swap", colleagueUserId: mo2, swapAssignmentId: b },
        opts(),
      ),
    );
    await ok(answerSwap(as(mo2), { requestId: req.id, answer: "accepted" }, opts()));
    await ok(decideSwap(admin, { requestId: req.id, decision: "approved" }, opts()));
    const held = async (day: string) =>
      (
        await lane.pg.query<{ user_id: string }>(
          `SELECT user_id FROM public.duty_assignments WHERE hospital_id = $1 AND ended_at IS NULL
            AND starts_at >= $2::timestamptz AND starts_at < $2::timestamptz + interval '1 day'`,
          [h, `${day}T00:00:00+03:00`],
        )
      ).rows.map((r) => r.user_id);
    expect(await held("2027-04-12")).toEqual([mo2]);
    expect(await held("2027-04-13")).toEqual([mo]);
  });

  it("delegates: handed over, one at a time, with words for every refusal", async () => {
    const until = "2099-01-01";
    const d = await ok<{ id: string }>(
      addDelegate(admin, { departmentId: med, toUserId: c1, canPublish: false, until }, opts()),
    );
    expect((await loadRotaWeek(h, med, W1, opts())).delegates).toEqual([
      expect.objectContaining({ id: d.id, toUserId: c1, canPublish: false, until }),
    ]);
    refused(
      await addDelegate(
        admin,
        { departmentId: med, toUserId: c1, canPublish: true, until: null },
        opts(),
      ),
      R.rota_delegate_dup,
    );
    refused(
      await addDelegate(
        admin,
        { departmentId: med, toUserId: mo2, canPublish: false, until: "2020-01-01" },
        opts(),
      ),
      R.rota_delegate_until,
    );
    const stranger = await authUser(lane.pg, "stranger");
    refused(
      await addDelegate(
        admin,
        { departmentId: med, toUserId: stranger, canPublish: false, until: null },
        opts(),
      ),
      R.rota_delegate_staff,
    );
    refused(
      await addDelegate(
        as(mo),
        { departmentId: med, toUserId: mo2, canPublish: false, until: null },
        opts(),
      ),
      R.rota_maker,
    );
    // The delegate makes the rota but cannot publish without the right; a delegate does not pass it on.
    await ok(
      saveTemplateLine(as(c1), { postId: post, weekdays: [6], shift: "day", userId: null }, opts()),
    );
    refused(
      await publishWeek(as(c1), { departmentId: med, weekStart: "2027-03-29" }, opts()),
      R.rota_maker,
    );
    refused(
      await addDelegate(
        as(c1),
        { departmentId: med, toUserId: mo2, canPublish: false, until: null },
        opts(),
      ),
      R.rota_maker,
    );
    refused(await revokeDelegate(as(c1), { delegateId: d.id }, opts()), R.rota_maker);
    await ok(revokeDelegate(admin, { delegateId: d.id }, opts()));
    expect(await revokeDelegate(admin, { delegateId: d.id }, opts())).toMatchObject({
      ok: false,
      code: "not_found",
    });
    refused(
      await saveTemplateLine(
        as(c1),
        { postId: post, weekdays: [6], shift: "day", userId: null },
        opts(),
      ),
      R.rota_maker,
    );
    expect((await loadRotaWeek(h, med, W1, opts())).delegates).toEqual([]);
    // Handed over anew after the revoke.
    await ok(
      addDelegate(
        admin,
        { departmentId: med, toUserId: c1, canPublish: true, until: null },
        opts(),
      ),
    );
  });

  it("the flag off refuses every upkeep write", async () => {
    process.env.DUTY_ROTA = "";
    const r = await publishWeek(admin, { departmentId: med, weekStart: "2027-04-05" }, opts());
    process.env.DUTY_ROTA = "1";
    expect(r).toMatchObject({ ok: false, code: "config", error: DUTY_ROTA_COPY.off });
  });
});
