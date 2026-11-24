/**
 * The care-request escalation runner (Task 23, ADR 0536) on the PGlite lane, on a fixed clock: an
 * unaccepted request past its signed window is escalated up the ladder (D7: the escalates-to post's
 * holders, else the department head; then the hospital contacts), the requester is told (place only),
 * an empty level is passed at once, runs are idempotent and never double-escalate, only the scheduler
 * writes a heartbeat, and nothing escalates without signed times or after a cancel or close. A missing
 * table is nothing to do (R13). Runs with EMR_PGLITE=1.
 */
import { randomUUID } from "node:crypto";
import type { Lane, Pg } from "./_pglite";
import type { PlanRequestLine } from "@/lib/clerking/plan/draft";
import type { EmrActor } from "@/lib/emr/actor";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { careRequestEvents, careRequests } from "@/db/schema/care-requests";
import { sentByMe } from "@/lib/emr/read/requests";
import { withPatientWrite } from "@/lib/emr/write/context";
import {
  acceptRequest,
  cancelRequest,
  declineRequest,
  placeRequests,
  redirectRequest,
  replyToRequest,
  withRequestWrite,
} from "@/lib/emr/write/requests";
import { generateKey } from "@/lib/encryption";
import { heartbeatStale } from "@/lib/lab/criticals/escalation";
import { logger } from "@/lib/logger";
import { D4_DEFAULTS, overdue } from "@/lib/requests/escalation";
import {
  lastRequestHeartbeat,
  openRequestOf,
  runCareRequestEscalations,
} from "@/lib/requests/escalation-run";
import { saveRequestTimesDraft, signRequestTimes } from "@/lib/requests/times";
import {
  authUser,
  bootEmpty,
  bootLane,
  clinician,
  department,
  drizzleFor,
  encounter,
  hospital,
  laneOn,
  patient,
} from "./_pglite";

const MIN = 60_000;
// A variable, not a literal: the specifier stays invisible to tsc and the bundler (as in ./_pglite).
const DRIZZLE_PGLITE = "drizzle-orm/pglite";
// After the real clock: department_heads.starts_at defaults to now().
const T0 = new Date(Math.ceil((Date.now() + 5 * MIN) / MIN) * MIN);
const at = (m: number) => new Date(T0.getTime() + m * MIN);

describe.skipIf(!laneOn)("care request escalation runner (PGlite lane)", () => {
  let lane: Lane;
  let pg: Pg;
  const key = () => `k-${randomUUID()}`;
  const patientOf = new Map<string, string>();

  interface World {
    h: string;
    home: string;
    target: string;
    requester: EmrActor;
    member: string;
    head: string;
    contact: string;
    admin: string;
    cso: string;
  }

  const actorOf = (
    s: { userId: string; affiliationId: string },
    h: string,
    departmentId: string,
    cadreCode = "MEDICAL_OFFICER",
  ): EmrActor => ({
    userId: s.userId,
    affiliationId: s.affiliationId,
    fullName: null,
    hospitalId: h,
    departmentId,
    cadreCode,
    isClinical: true,
    surface: "doctor",
  });

  async function sign(w: Pick<World, "h" | "admin" | "cso">, when: Date): Promise<void> {
    const v = await lane.db.transaction((t) =>
      saveRequestTimesDraft(
        t,
        { userId: w.admin, hospitalId: w.h },
        { ...D4_DEFAULTS, source: "fixture: D4 defaults, invented for tests" },
      ),
    );
    await lane.db.transaction((t) =>
      signRequestTimes(
        t,
        { userId: w.admin, hospitalId: w.h, as: "admin" },
        { versionId: v, exceptionNote: null },
        when,
      ),
    );
    await lane.db.transaction((t) =>
      signRequestTimes(
        t,
        { userId: w.cso, hospitalId: w.h, as: "cso" },
        { versionId: v, exceptionNote: null },
        when,
      ),
    );
  }

  /** Its own hospital: a requester at home, one senior on the target team, a head and a level-2 contact
   *  outside the team, and the D4 times signed an hour before T0 (unless `signed: false`). */
  async function world(
    name: string,
    o: { member?: boolean; head?: boolean; contact?: boolean; signed?: boolean } = {},
  ): Promise<World> {
    const h = await hospital(pg, name);
    const home = await department(pg, h, "Home");
    const target = await department(pg, h, "Medicine");
    const requester = actorOf(await clinician(pg, { hospitalId: h, departmentId: home }), h, home);
    const member = (
      await clinician(pg, {
        hospitalId: h,
        departmentId: o.member === false ? home : target,
        cadre: "CONSULTANT",
      })
    ).userId;
    const head = (await clinician(pg, { hospitalId: h, departmentId: home, cadre: "CONSULTANT" }))
      .userId;
    const contact = (
      await clinician(pg, { hospitalId: h, departmentId: home, cadre: "CONSULTANT" })
    ).userId;
    if (o.head !== false)
      await pg.query(
        `INSERT INTO department_heads (hospital_id, department_id, user_id, acting) VALUES ($1, $2, $3, false)`,
        [h, target, head],
      );
    if (o.contact !== false)
      await pg.query(
        `INSERT INTO critical_contacts (hospital_id, level, user_id, position) VALUES ($1, 2, $2, 0)`,
        [h, contact],
      );
    const admin = await authUser(pg, "admin");
    const cso = await authUser(pg, "cso");
    const w = { h, home, target, requester, member, head, contact, admin, cso };
    if (o.signed !== false) await sign(w, at(-60));
    return w;
  }

  const line = (w: World, o: Partial<PlanRequestLine> = {}): PlanRequestLine => ({
    clientKey: key(),
    kind: "review",
    targetDepartmentId: w.target,
    wardId: null,
    namedUserIds: [],
    urgency: "now",
    helpWanted: null,
    reasonConditionIds: [],
    question: "",
    phoned: null,
    display: "Request",
    ...o,
  });

  async function place(w: World, o: Partial<PlanRequestLine> = {}, when = T0): Promise<string> {
    const p = await patient(pg);
    const enc = await encounter(pg, {
      hospitalId: w.h,
      patientUserId: p,
      clinicianUserId: w.requester.userId,
      departmentId: w.home,
    });
    const [id] = await withPatientWrite(
      w.requester,
      p,
      (ctx) =>
        placeRequests(ctx, {
          patientUserId: p,
          encounterId: enc,
          placementId: randomUUID(),
          lines: [line(w, o)],
        }),
      { database: lane.db, now: when },
    );
    patientOf.set(id!, p);
    return id!;
  }

  const run = (w: World, m: number, source: "scheduler" | "lazy" = "scheduler") =>
    runCareRequestEscalations(lane.db, { now: at(m), source, hospitalId: w.h });

  const act = <T>(
    who: EmrActor,
    id: string,
    m: number,
    fn: Parameters<typeof withRequestWrite<T>>[2],
  ) => withRequestWrite(who, id, fn, { database: lane.db, now: at(m) });

  const events = async (id: string) =>
    (
      await pg.query<{
        kind: string;
        level: number;
        step: string | null;
        recipient_user_id: string | null;
        post_id: string | null;
        skipped_user_ids: string[];
      }>(
        `SELECT kind, level, step, recipient_user_id, post_id, skipped_user_ids FROM care_request_events
          WHERE request_id = $1 AND kind IN ('escalated','routed') AND level > 0
          ORDER BY level, kind, recipient_user_id`,
        [id],
      )
    ).rows;

  const notices = async (userId: string, id: string) =>
    (
      await pg.query<{ kind: string; subject: string; body: string }>(
        `SELECT kind, subject, body FROM sa_notifications WHERE recipient_user_id = $1 AND related_id = $2
          ORDER BY delivered_at, body`,
        [userId, id],
      )
    ).rows;

  beforeAll(async () => {
    process.env.MEDSYNC_PHI_KEY ??= generateKey();
    // The replied fixture signs a note; a test key, never a real one.
    process.env.MEDSYNC_NOTE_HMAC_KEY ??= Buffer.alloc(32, 7).toString("base64");
    lane = await bootLane();
    pg = lane.pg;
  }, 240_000);

  afterEach(() => {
    delete process.env.DUTY_ROTA;
  });

  it("an unaccepted review now escalates to the head after 15 minutes and the requester is told", async () => {
    const w = await world("Esc head");
    const id = await place(w);
    expect((await run(w, 14)).escalated).toBe(0);
    expect(await events(id)).toEqual([]);
    expect((await run(w, 15)).escalated).toBe(1);
    expect(await events(id)).toEqual([
      expect.objectContaining({ kind: "escalated", level: 1, step: null, recipient_user_id: null }),
      {
        kind: "routed",
        level: 1,
        step: "department_head",
        recipient_user_id: w.head,
        post_id: null,
        skipped_user_ids: [],
      },
    ]);
    expect(await notices(w.head, id)).toEqual([
      expect.objectContaining({
        kind: "care_request",
        subject: expect.stringMatching(/^New request · Medicine/),
      }),
    ]);
    expect(await notices(w.requester.userId, id)).toEqual([
      {
        kind: "care_request_update",
        subject: expect.stringMatching(/^Request update · Medicine/),
        body: "Not accepted after 15 min; asked the head of department.",
      },
    ]);
  });

  it("with a rota, level 1 is the escalates-to post holder", async () => {
    process.env.DUTY_ROTA = "1";
    const w = await world("Esc rota");
    await pg.query(
      `INSERT INTO public.user_roles (user_id, role, hospital_id) VALUES ($1, 'hospital_admin', $2)`,
      [w.admin, w.h],
    );
    const mo = (await clinician(pg, { hospitalId: w.h, departmentId: w.target })).userId;
    const cons = (
      await clinician(pg, { hospitalId: w.h, departmentId: w.target, cadre: "CONSULTANT" })
    ).userId;
    const post = async (level: string, cadre: string, escalatesTo: string | null) =>
      (
        await pg.query<{ id: string }>(
          `INSERT INTO public.duty_posts (hospital_id, department_id, scope_kind, name, level, eligible_cadres,
             takes_consults, escalates_to_post_id, created_by)
           VALUES ($1, $2, 'department', $3, $4, $5, $6, $7, $8) RETURNING id`,
          [
            w.h,
            w.target,
            level === "consultant" ? "Consultant on call" : "Registrar on call",
            level,
            [cadre],
            level !== "consultant",
            escalatesTo,
            w.admin,
          ],
        )
      ).rows[0]!.id;
    const top = await post("consultant", "CONSULTANT", null);
    const first = await post("senior", "MEDICAL_OFFICER", top);
    for (const [p, u] of [
      [first, mo],
      [top, cons],
    ] as const)
      await pg.query(
        `INSERT INTO public.duty_assignments (hospital_id, post_id, user_id, starts_at, ends_at, kind, created_by)
         VALUES ($1, $2, $3, $4, $5, 'rostered', $6)`,
        [w.h, p, u, at(-60), at(480), w.admin],
      );
    const id = await place(w);
    expect((await run(w, 15)).escalated).toBe(1);
    expect((await events(id)).filter((e) => e.kind === "routed")).toEqual([
      {
        kind: "routed",
        level: 1,
        step: "post",
        recipient_user_id: cons,
        post_id: top,
        skipped_user_ids: [],
      },
    ]);
    expect((await notices(w.requester.userId, id)).map((n) => n.body)).toEqual([
      "Not accepted after 15 min; asked the Consultant on call.",
    ]);
  });

  it("running twice at the same now escalates once", async () => {
    const w = await world("Esc twice");
    const id = await place(w);
    expect((await run(w, 15)).escalated).toBe(1);
    expect((await run(w, 15, "lazy")).escalated).toBe(0);
    expect((await run(w, 29)).escalated).toBe(0);
    expect((await events(id)).filter((e) => e.kind === "escalated")).toHaveLength(1);
  });

  // PGlite has one connection: the two runs queue, so this proves the re-run, not real concurrency.
  it("a lazy run queued behind the scheduler's at the same now adds nothing", async () => {
    const w = await world("Esc race");
    const id = await place(w);
    const [x, y] = await Promise.all([run(w, 15), run(w, 15, "lazy")]);
    expect(x.escalated + y.escalated).toBe(1);
    expect((await events(id)).filter((e) => e.kind === "escalated")).toHaveLength(1);
    expect(await notices(w.requester.userId, id)).toHaveLength(1);
  });

  it("the scheduler writes a care_requests heartbeat; a lazy run writes none", async () => {
    const w = await world("Esc heartbeat");
    const far = 10_000_000;
    const beats = async (m: number) =>
      (
        await pg.query(`SELECT source, escalated FROM escalation_heartbeats WHERE ran_at = $1`, [
          at(m),
        ])
      ).rows;
    await run(w, far - 1, "lazy");
    expect(await beats(far - 1)).toEqual([]);
    await run(w, far);
    expect(await beats(far)).toEqual([{ source: "care_requests", escalated: 0 }]);
    const last = await lane.db.transaction((t) => lastRequestHeartbeat(t));
    expect(last).toEqual(at(far));
    expect(heartbeatStale(last, at(far + 1))).toBe(false);
    expect(heartbeatStale(last, at(far + 4))).toBe(true);
  });

  it("a read runs the lazy escalation first, with no heartbeat", async () => {
    const w = await world("Esc lazy read");
    const id = await place(w);
    const before = await pg.query(`SELECT 1 FROM escalation_heartbeats WHERE ran_at = $1`, [
      at(15),
    ]);
    await sentByMe(w.requester, { database: lane.db, now: at(15), names: false });
    expect((await events(id)).filter((e) => e.kind === "escalated")).toHaveLength(1);
    expect(
      (await pg.query(`SELECT 1 FROM escalation_heartbeats WHERE ran_at = $1`, [at(15)])).rows,
    ).toHaveLength(before.rows.length);
  });

  it("level 2 stays open and overdue", async () => {
    const w = await world("Esc level 2");
    const id = await place(w);
    await run(w, 15);
    expect((await run(w, 29)).escalated).toBe(0);
    expect((await run(w, 30)).escalated).toBe(1);
    expect((await events(id)).filter((e) => e.level === 2)).toEqual([
      expect.objectContaining({ kind: "escalated", level: 2 }),
      expect.objectContaining({
        kind: "routed",
        step: "hospital_contacts",
        recipient_user_id: w.contact,
      }),
    ]);
    expect((await run(w, 500)).escalated).toBe(0);
    const [req] = await lane.db.select().from(careRequests).where(eq(careRequests.id, id));
    const rows = await lane.db
      .select()
      .from(careRequestEvents)
      .where(eq(careRequestEvents.requestId, id));
    expect(rows.some((e) => ["closed", "cancelled"].includes(e.kind))).toBe(false);
    const open = openRequestOf(req!, rows, at(-60), at(500));
    expect(open.level).toBe(2);
    expect(overdue(open, D4_DEFAULTS, at(500))).toBe(true);
    expect((await notices(w.requester.userId, id)).map((n) => n.body)).toEqual([
      "Not accepted after 15 min; asked the head of department.",
      "Not accepted after 15 min; asked the hospital contacts.",
    ]);
  });

  it("an empty level is passed at once in the same run", async () => {
    const w = await world("Esc empty", { head: false });
    const id = await place(w);
    expect((await run(w, 15)).escalated).toBe(1);
    expect(await events(id)).toEqual([
      expect.objectContaining({ kind: "escalated", level: 1 }),
      expect.objectContaining({ kind: "routed", level: 1, step: "none", recipient_user_id: null }),
      expect.objectContaining({ kind: "escalated", level: 2 }),
      expect.objectContaining({ kind: "routed", level: 2, step: "hospital_contacts" }),
    ]);
    expect((await notices(w.requester.userId, id)).map((n) => n.body)).toEqual([
      "Not accepted after 15 min; asked the hospital contacts.",
    ]);
  });

  it("never asks the requester or a pharmacist; the skips are recorded", async () => {
    const w = await world("Esc skips", { contact: false });
    await pg.query(`UPDATE department_heads SET user_id = $2 WHERE hospital_id = $1`, [
      w.h,
      w.requester.userId,
    ]);
    const pharmacist = (
      await clinician(pg, { hospitalId: w.h, departmentId: w.home, cadre: "PHARMACIST" })
    ).userId;
    for (const [u, pos] of [
      [pharmacist, 0],
      [w.contact, 1],
    ] as const)
      await pg.query(
        `INSERT INTO critical_contacts (hospital_id, level, user_id, position) VALUES ($1, 2, $2, $3)`,
        [w.h, u, pos],
      );
    const id = await place(w);
    await run(w, 15);
    expect((await events(id)).filter((e) => e.kind === "routed")).toEqual([
      expect.objectContaining({
        level: 1,
        step: "none",
        recipient_user_id: null,
        skipped_user_ids: [w.requester.userId],
      }),
      expect.objectContaining({
        level: 2,
        step: "hospital_contacts",
        recipient_user_id: w.contact,
        skipped_user_ids: [pharmacist],
      }),
    ]);
    expect(await notices(pharmacist, id)).toEqual([]);
  });

  it("accepted, cancelled and closed requests never escalate", async () => {
    const w = await world("Esc stops");
    const accepted = await place(w);
    const cancelled = await place(w);
    const member = actorOf({ userId: w.member, affiliationId: "" }, w.h, w.target, "CONSULTANT");
    await act(member, accepted, 5, (c) =>
      acceptRequest(c, { clientKey: key(), expectInMin: null }),
    );
    await act(w.requester, cancelled, 5, (c) =>
      cancelRequest(c, { clientKey: key(), reasonCode: "no_longer_needed" }),
    );
    expect((await run(w, 1000)).escalated).toBe(0);
    expect(await events(accepted)).toEqual([]);
    expect(await events(cancelled)).toEqual([]);
  });

  it("a fully declined round never escalates (R42); a redirect starts a fresh clock", async () => {
    const w = await world("Esc redirect");
    const cardio = await department(pg, w.h, "Cardiology");
    await clinician(pg, { hospitalId: w.h, departmentId: cardio, cadre: "CONSULTANT" });
    const id = await place(w);
    const member = actorOf({ userId: w.member, affiliationId: "" }, w.h, w.target, "CONSULTANT");
    await act(member, id, 5, (c) =>
      declineRequest(c, { clientKey: key(), reasonCode: "not_our_specialty" }),
    );
    expect((await run(w, 100)).escalated).toBe(0);
    expect(await events(id)).toEqual([]);
    await act(w.requester, id, 110, (c) =>
      redirectRequest(c, { clientKey: key(), departmentId: cardio, reasonCode: "other" }),
    );
    expect((await run(w, 124)).escalated).toBe(0);
    expect((await run(w, 125)).escalated).toBe(1);
  });

  it("only due requests are locked; a replied request is never a candidate (R43)", async () => {
    const w = await world("Esc locks");
    const due = await place(w);
    const later = await place(w, {}, at(10));
    const replied = await place(w);
    const member = actorOf({ userId: w.member, affiliationId: "" }, w.h, w.target, "CONSULTANT");
    await act(member, replied, 5, (c) => acceptRequest(c, { clientKey: key(), expectInMin: null }));
    await withPatientWrite(
      member,
      patientOf.get(replied)!,
      (ctx) =>
        replyToRequest(ctx, {
          patientUserId: patientOf.get(replied)!,
          requestId: replied,
          clientKey: key(),
          assessment: "Synthetic assessment.",
          recommendations: "Synthetic plan.",
          followUp: true,
        }),
      { database: lane.db, now: at(6) },
    );
    const queries: { q: string; p: unknown[] }[] = [];
    const { drizzle } = await import(/* @vite-ignore */ DRIZZLE_PGLITE);
    const logged = drizzle(pg, {
      schema,
      logger: { logQuery: (q: string, p: unknown[]) => queries.push({ q, p }) },
    }) as Lane["db"];
    expect(
      (await runCareRequestEscalations(logged, { now: at(15), source: "lazy", hospitalId: w.h }))
        .escalated,
    ).toBe(1);
    const locks = queries.filter((x) => /for update skip locked/i.test(x.q));
    expect(locks).toHaveLength(1);
    expect(locks[0]!.p).toContain(due);
    expect(locks[0]!.p).not.toContain(later);
    expect(queries.some((x) => x.p.includes(replied))).toBe(false);
    expect(await events(later)).toEqual([]);
  });

  it("level 1 skips whoever this round already asked, and passes on at once (R44)", async () => {
    const w = await world("Esc repeats", { member: false });
    const id = await place(w);
    const level0 = await pg.query<{ step: string; recipient_user_id: string }>(
      `SELECT step, recipient_user_id FROM care_request_events WHERE request_id = $1 AND kind = 'routed'`,
      [id],
    );
    expect(level0.rows).toEqual([{ step: "department_head", recipient_user_id: w.head }]);
    expect((await run(w, 15)).escalated).toBe(1);
    expect((await events(id)).filter((e) => e.kind === "routed")).toEqual([
      expect.objectContaining({
        level: 1,
        step: "none",
        recipient_user_id: null,
        skipped_user_ids: [w.head],
      }),
      expect.objectContaining({
        level: 2,
        step: "hospital_contacts",
        recipient_user_id: w.contact,
      }),
    ]);
  });

  it("a failing request is logged and skipped; the others still escalate (R45)", async () => {
    const w = await world("Esc broken");
    const broken = await place(w);
    const good = await place(w);
    const spy = vi.spyOn(logger, "error");
    await pg.exec(`
      CREATE FUNCTION public.test_break_escalation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.request_id = '${broken}'::uuid AND NEW.kind = 'escalated' THEN
          RAISE EXCEPTION 'broken for the test';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER test_break_escalation BEFORE INSERT ON public.care_request_events
        FOR EACH ROW EXECUTE FUNCTION public.test_break_escalation();`);
    try {
      expect((await run(w, 15)).escalated).toBe(1);
    } finally {
      await pg.exec(`DROP TRIGGER test_break_escalation ON public.care_request_events;
        DROP FUNCTION public.test_break_escalation();`);
    }
    const calls = [...spy.mock.calls];
    spy.mockRestore();
    expect(await events(broken)).toEqual([]);
    expect((await events(good)).filter((e) => e.kind === "escalated")).toHaveLength(1);
    expect(calls).toContainEqual([
      "care_request.escalation_failed",
      { requestId: broken, reason: expect.any(String), code: "P0001" },
    ]);
    expect(JSON.stringify(calls)).not.toContain("broken for the test");
  });

  it("no signed times: no automatic escalation at all", async () => {
    const w = await world("Esc unsigned", { signed: false });
    const id = await place(w);
    expect((await run(w, 100_000)).escalated).toBe(0);
    expect(await events(id)).toEqual([]);
  });

  it("signing the times never bursts escalations for open requests (R40)", async () => {
    const w = await world("Esc R40", { signed: false });
    const id = await place(w);
    await sign(w, at(10));
    expect((await run(w, 24)).escalated).toBe(0);
    expect((await run(w, 25)).escalated).toBe(1);
    expect((await events(id)).filter((e) => e.kind === "escalated")).toHaveLength(1);
  });

  it("an urgent consult's day-end overdue counts from the original request time (R39)", () => {
    const requestedAt = new Date("2026-11-24T08:00:00Z");
    const redirectAt = new Date("2026-11-25T06:00:00Z");
    const ev = (kind: string, when: Date, extra: object = {}) => ({
      kind,
      at: when,
      actorUserId: null,
      recipientUserId: null,
      level: 0,
      step: null,
      postId: null,
      reasonCode: null,
      noteId: null,
      redirectDepartmentId: null,
      ...extra,
    });
    const open = openRequestOf(
      {
        kind: "consult",
        urgency: "urgent_today",
        hospitalId: randomUUID(),
        id: randomUUID(),
        requesterUserId: randomUUID(),
        requestedAt,
        phonedUserId: null,
        phonedAt: null,
        targetDepartmentId: randomUUID(),
      },
      [
        ev("routed", requestedAt, { step: "team", recipientUserId: randomUUID() }),
        ev("redirected", redirectAt, { redirectDepartmentId: randomUUID(), reasonCode: "other" }),
        ev("routed", redirectAt, { step: "team", recipientUserId: randomUUID() }),
      ],
      null,
      new Date("2026-11-25T06:30:00Z"),
    );
    expect(open.levelSince).toEqual(redirectAt);
    expect(open.requestedAt).toEqual(requestedAt);
    // Accepted in the new round: the accept clock stops, but the consult was due on its own day.
    expect(
      overdue({ ...open, accepted: true }, D4_DEFAULTS, new Date("2026-11-25T06:30:00Z")),
    ).toBe(true);
  });

  it("a missing table is nothing to do, never an error (R13)", async () => {
    const empty = await drizzleFor(await bootEmpty());
    await expect(
      runCareRequestEscalations(empty, { now: T0, source: "scheduler" }),
    ).resolves.toEqual({ escalated: 0 });
  });
});
