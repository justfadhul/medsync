/**
 * The care request lifecycle (ADR 0533) on the PGlite lane: seen, accept, decline, redirect, reply by
 * signed note, close and cancel. Runs with EMR_PGLITE=1.
 */
import { randomUUID } from "node:crypto";
import type { Lane, Pg } from "./_pglite";
import type { PlanRequestLine } from "@/lib/clerking/plan/draft";
import type { EmrActor } from "@/lib/emr/actor";
import type { RequestCtx } from "@/lib/emr/write/requests";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CARE_REQUEST_COPY } from "@/content/care-requests";
import { declineRequestAction } from "@/lib/emr/actions/requests";
import { withPatientWrite } from "@/lib/emr/write/context";
import {
  acceptRequest,
  cancelRequest,
  closeRequest,
  declineRequest,
  markSeen,
  placeRequests,
  redirectRequest,
  replyToRequest,
  withRequestWrite,
} from "@/lib/emr/write/requests";
import { generateKey } from "@/lib/encryption";
import {
  bootLane,
  clinician,
  department,
  encounter,
  hospital,
  laneOn,
  patient,
  probe,
} from "./_pglite";

const HMAC_KEY = Buffer.alloc(32, 7).toString("base64");
const savedKey = process.env.MEDSYNC_NOTE_HMAC_KEY;

describe.skipIf(!laneOn)("the care request lifecycle (PGlite lane)", () => {
  let lane: Lane;
  let pg: Pg;
  let h: string;
  let home: string;
  let requester: EmrActor;

  const actor = (
    s: { userId: string; affiliationId: string },
    cadreCode: string,
    departmentId: string,
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

  /** A clinician in `dept` and their actor. */
  const member = async (dept: string, cadre = "MEDICAL_OFFICER") =>
    actor(await clinician(pg, { hospitalId: h, departmentId: dept, cadre }), cadre, dept);

  const key = () => `k-${randomUUID()}`;

  /** One request placed by the requester; its patient and encounter. */
  async function placed(
    kind: "review" | "consult",
    targetDepartmentId: string,
    namedUserIds: string[] = [],
  ): Promise<{ id: string; p: string; enc: string }> {
    const p = await patient(pg);
    const enc = await encounter(pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: requester.userId,
      departmentId: home,
    });
    let reasonConditionIds: string[] = [];
    if (kind === "consult") {
      const cond = randomUUID();
      await pg.query(
        `INSERT INTO public.conditions (id, logical_id, hospital_id, patient_user_id, encounter_id, effective_at,
           recorded_by_user_id, source, trust, category, text_ciphertext, clinical_status, verification, asserted_by,
           sensitivity, rank)
         VALUES ($1, $1, $2, $3, $4, now(), $5, 'clinician', 3, 'encounter_diagnosis', 'iv:tag:ct', 'active',
           'confirmed', 'clinician', 'standard', 'secondary')`,
        [cond, h, p, enc, requester.userId],
      );
      reasonConditionIds = [cond];
    }
    const line: PlanRequestLine = {
      clientKey: key(),
      kind,
      targetDepartmentId,
      wardId: null,
      namedUserIds,
      urgency: kind === "consult" ? "urgent_today" : "now",
      helpWanted: kind === "consult" ? "advice" : null,
      reasonConditionIds,
      question: kind === "consult" ? "Is this nephrotic syndrome?" : "",
      phoned: null,
      display: "Request",
    };
    const [id] = await withPatientWrite(
      requester,
      p,
      (ctx) =>
        placeRequests(ctx, {
          patientUserId: p,
          encounterId: enc,
          placementId: randomUUID(),
          lines: [line],
        }),
      { database: lane.db },
    );
    return { id: id!, p, enc };
  }

  const as = <T>(who: EmrActor, id: string, fn: (c: RequestCtx) => Promise<T>) =>
    withRequestWrite(who, id, fn, { database: lane.db });

  const reply = (
    who: EmrActor,
    r: { id: string; p: string },
    followUp: boolean,
    clientKey = key(),
  ) =>
    withPatientWrite(
      who,
      r.p,
      (ctx) =>
        replyToRequest(ctx, {
          patientUserId: r.p,
          requestId: r.id,
          clientKey,
          findings: "Oedema to the knees.",
          assessment: "Likely nephrotic syndrome.",
          recommendations: "Urine protein to creatinine ratio; albumin.",
          followUp,
        }),
      { database: lane.db },
    );

  const stateOf = (id: string) => as(requester, id, async (c) => c.derived.state);
  const code = (p: Promise<unknown>) =>
    p.then(
      () => "done",
      (e: { code?: string }) => e.code ?? String(e),
    );
  const events = async (id: string) =>
    (
      await pg.query<{ kind: string; note_id: string | null; actor_user_id: string | null }>(
        `SELECT kind, note_id, actor_user_id FROM care_request_events WHERE request_id = $1 ORDER BY at`,
        [id],
      )
    ).rows;
  const basis = async (user: string, p: string) =>
    (
      await pg.query<{ b: string | null }>(`SELECT private.patient_access_basis($1, $2, $3) AS b`, [
        user,
        p,
        h,
      ])
    ).rows[0]!.b;

  const readable = async (user: string, id: string) => {
    const r = await probe(
      pg,
      { userId: user, role: "medsync_clinical_reader", hospitalId: h },
      `SELECT id FROM care_requests WHERE id = $1`,
      [id],
    );
    if (!r.ok) throw new Error(r.error);
    return r.rows.length === 1;
  };
  const noticesOf = async (id: string, user: string) =>
    (
      await pg.query<{ kind: string }>(
        `SELECT kind FROM sa_notifications WHERE related_id = $1 AND recipient_user_id = $2
          ORDER BY delivered_at, kind`,
        [id, user],
      )
    ).rows.map((n) => n.kind);

  beforeAll(async () => {
    process.env.MEDSYNC_PHI_KEY ??= generateKey();
    process.env.MEDSYNC_NOTE_HMAC_KEY = HMAC_KEY;
    lane = await bootLane();
    pg = lane.pg;
    h = await hospital(pg, "Lifecycle");
    home = await department(pg, h, "Home");
    requester = await member(home);
  }, 180_000);

  afterAll(() => {
    if (savedKey === undefined) delete process.env.MEDSYNC_NOTE_HMAC_KEY;
    else process.env.MEDSYNC_NOTE_HMAC_KEY = savedKey;
  });

  it("seen is recorded once per person", async () => {
    const neph = await department(pg, h, "Nephrology");
    const mo = await member(neph);
    const r = await placed("consult", neph);
    await as(mo, r.id, markSeen);
    await as(mo, r.id, markSeen);
    expect((await events(r.id)).filter((e) => e.kind === "seen")).toHaveLength(1);
    expect(await stateOf(r.id)).toBe("seen");
  });

  it("accept by a target-department member who was not routed is allowed and grants chart access", async () => {
    const med = await department(pg, h, "Medicine");
    await member(med); // the senior the review routes to
    const intern = await member(med, "INTERN_DOCTOR");
    const r = await placed("review", med);
    expect(await as(intern, r.id, async (c) => c.who.recipient)).toBe(false);
    expect(await basis(intern.userId, r.p)).toBeNull();
    await as(intern, r.id, (c) => acceptRequest(c, { clientKey: key(), expectInMin: 30 }));
    expect(await stateOf(r.id)).toBe("accepted");
    expect(await basis(intern.userId, r.p)).toBe("care_team");
  });

  it("an unrelated clinician cannot accept", async () => {
    const neph = await department(pg, h, "Nephrology");
    await member(neph);
    const stranger = await member(await department(pg, h, "Elsewhere"));
    const r = await placed("consult", neph);
    expect(
      await code(
        as(stranger, r.id, (c) => acceptRequest(c, { clientKey: key(), expectInMin: null })),
      ),
    ).toBe("forbidden");
  });

  it("decline needs a reason and returns the request", async () => {
    const neph = await department(pg, h, "Nephrology");
    const mo = await member(neph);
    const r = await placed("consult", neph);
    const refused = await declineRequestAction({
      surface: "doctor",
      requestId: r.id,
      clientKey: key(),
    });
    expect(refused).toMatchObject({ ok: false, code: "invalid" });

    await as(mo, r.id, (c) =>
      declineRequest(c, { clientKey: key(), reasonCode: "not_our_specialty", note: "Try renal." }),
    );
    expect(await stateOf(r.id)).toBe("declined");
    const notice = await pg.query<{ kind: string }>(
      `SELECT kind FROM sa_notifications WHERE related_id = $1 AND recipient_user_id = $2`,
      [r.id, requester.userId],
    );
    expect(notice.rows.map((n) => n.kind)).toEqual(["care_request_update"]);
    const stored = await pg.query<{ c: string }>(
      `SELECT note_ciphertext AS c FROM care_request_events WHERE request_id = $1 AND kind = 'declined'`,
      [r.id],
    );
    expect(stored.rows[0]!.c).toBeTruthy();
    expect(stored.rows[0]!.c).not.toContain("Try renal.");
  });

  it("redirect starts a new round", async () => {
    const neph = await department(pg, h, "Nephrology");
    const nephUnrouted = await member(neph); // named routing wins, so the team is not asked
    // Named and outside both departments: their read can only come through the event arm.
    const decliner = await member(await department(pg, h, "Elsewhere"));
    const cardio = await department(pg, h, "Cardiology");
    const cardiologist = await member(cardio);
    const r = await placed("consult", neph, [decliner.userId]);
    await as(decliner, r.id, (c) =>
      declineRequest(c, { clientKey: key(), reasonCode: "needs_other_team" }),
    );
    await as(requester, r.id, (c) =>
      redirectRequest(c, {
        clientKey: key(),
        departmentId: cardio,
        reasonCode: "better_placed_team",
        note: "Murmur on review.",
      }),
    );
    const cardioUnrouted = await member(cardio); // joined after the routing

    const now = await as(requester, r.id, async (c) => c.derived);
    expect(now.round).toBe(1);
    expect(now.state).toBe("sent");
    expect(now.recipients).toEqual([cardiologist.userId]);

    // The old recipient leaves "asked of you" but still reads the request (R26: the current department reads).
    expect(await as(decliner, r.id, async (c) => c.who.recipient)).toBe(false);
    expect(await readable(decliner.userId, r.id)).toBe(true);
    expect(await readable(cardioUnrouted.userId, r.id)).toBe(true);
    expect(await readable(nephUnrouted.userId, r.id)).toBe(false);
    expect(
      await code(
        as(decliner, r.id, (c) => acceptRequest(c, { clientKey: key(), expectInMin: null })),
      ),
    ).toBe("forbidden");
    await as(cardiologist, r.id, (c) => acceptRequest(c, { clientKey: key(), expectInMin: 15 }));
    expect(await stateOf(r.id)).toBe("accepted");
  });

  it("a person declines once per round, and a key replays only its own act", async () => {
    const neph = await department(pg, h, "Nephrology");
    const a = await member(neph);
    const b = await member(neph);
    const r = await placed("consult", neph);
    const k = key();
    const first = await as(a, r.id, (c) =>
      declineRequest(c, { clientKey: k, reasonCode: "not_our_specialty" }),
    );
    expect(
      await code(as(a, r.id, (c) => declineRequest(c, { clientKey: key(), reasonCode: "other" }))),
    ).toBe("conflict");
    expect(
      await code(as(a, r.id, (c) => acceptRequest(c, { clientKey: k, expectInMin: null }))),
    ).toBe("conflict");
    expect(
      await code(as(b, r.id, (c) => declineRequest(c, { clientKey: k, reasonCode: "other" }))),
    ).toBe("conflict");
    expect(
      await as(a, r.id, (c) =>
        declineRequest(c, { clientKey: k, reasonCode: "not_our_specialty" }),
      ),
    ).toEqual(first);
    // Accepting after one's own decline stays allowed.
    await as(a, r.id, (c) => acceptRequest(c, { clientKey: key(), expectInMin: 30 }));
    expect(await stateOf(r.id)).toBe("accepted");
    expect((await events(r.id)).filter((e) => e.kind === "declined")).toHaveLength(1);
  });

  it("reply signs a consult note and closes on no follow-up", async () => {
    const neph = await department(pg, h, "Nephrology");
    const mo = await member(neph);
    const r = await placed("consult", neph);
    await as(mo, r.id, (c) => acceptRequest(c, { clientKey: key(), expectInMin: 60 }));
    const k = key();
    const out = await reply(mo, r, false, k);
    const note = await pg.query<{ note_type: string; state: string; encounter_id: string }>(
      `SELECT note_type, state, encounter_id FROM clinical_notes WHERE id = $1`,
      [out.noteId],
    );
    expect(note.rows).toEqual([{ note_type: "consult", state: "signed", encounter_id: r.enc }]);
    const ev = await events(r.id);
    expect(ev.find((e) => e.kind === "replied")?.note_id).toBe(out.noteId);
    expect(ev.filter((e) => e.kind === "closed")).toHaveLength(1);
    expect(await stateOf(r.id)).toBe("closed");
    // The same key replays: one note, one reply.
    expect((await reply(mo, r, false, k)).noteId).toBe(out.noteId);
    expect((await events(r.id)).filter((e) => e.kind === "replied")).toHaveLength(1);
  });

  it("a review reply signs", async () => {
    const med = await department(pg, h, "Medicine");
    const senior = await member(med);
    const r = await placed("review", med);
    await as(senior, r.id, (c) => acceptRequest(c, { clientKey: key(), expectInMin: 15 }));
    const out = await reply(senior, r, true);
    const note = await pg.query<{ note_type: string; state: string }>(
      `SELECT note_type, state FROM clinical_notes WHERE id = $1`,
      [out.noteId],
    );
    expect(note.rows).toEqual([{ note_type: "ward_round", state: "signed" }]);
    expect(await stateOf(r.id)).toBe("replied");
    await as(requester, r.id, (c) => closeRequest(c, { clientKey: key() }));
    expect(await stateOf(r.id)).toBe("closed");
  });

  it("reply signs onto a completed encounter", async () => {
    const neph = await department(pg, h, "Nephrology");
    const mo = await member(neph);
    const r = await placed("consult", neph);
    await as(mo, r.id, (c) => acceptRequest(c, { clientKey: key(), expectInMin: null }));
    await pg.query(`UPDATE encounters SET state = 'completed', ended_at = now() WHERE id = $1`, [
      r.enc,
    ]);
    const out = await reply(mo, r, true);
    const note = await pg.query<{ encounter_id: string; state: string }>(
      `SELECT encounter_id, state FROM clinical_notes WHERE id = $1`,
      [out.noteId],
    );
    expect(note.rows).toEqual([{ encounter_id: r.enc, state: "signed" }]);
    expect(await stateOf(r.id)).toBe("replied");
  });

  it("a cancelled request refuses every act", async () => {
    const neph = await department(pg, h, "Nephrology");
    const mo = await member(neph);
    const r = await placed("consult", neph);
    const owner = await member(neph); // joined after the routing: the owner is no recipient
    await as(owner, r.id, (c) => acceptRequest(c, { clientKey: key(), expectInMin: null }));
    // Chart access that outlives the request, so the reply is refused for being finished.
    await encounter(pg, {
      hospitalId: h,
      patientUserId: r.p,
      clinicianUserId: owner.userId,
      departmentId: neph,
    });
    await as(requester, r.id, (c) =>
      cancelRequest(c, { clientKey: key(), reasonCode: "no_longer_needed" }),
    );
    expect(await stateOf(r.id)).toBe("cancelled");
    expect(await noticesOf(r.id, owner.userId)).toEqual(["care_request_update"]);
    expect(await basis(owner.userId, r.p)).not.toBeNull();

    const tries: (() => Promise<unknown>)[] = [
      () => as(mo, r.id, markSeen),
      () => as(mo, r.id, (c) => acceptRequest(c, { clientKey: key(), expectInMin: null })),
      () => as(mo, r.id, (c) => declineRequest(c, { clientKey: key(), reasonCode: "other" })),
      () =>
        as(requester, r.id, (c) =>
          redirectRequest(c, { clientKey: key(), departmentId: neph, reasonCode: "other" }),
        ),
      () => as(requester, r.id, (c) => closeRequest(c, { clientKey: key() })),
      () => as(requester, r.id, (c) => cancelRequest(c, { clientKey: key(), reasonCode: "other" })),
      () => reply(owner, r, false),
    ];
    for (const t of tries)
      expect(
        await t().then(
          () => "done",
          (e: Error) => e.message,
        ),
      ).toBe(CARE_REQUEST_COPY.refusal.final);
    expect((await events(r.id)).map((e) => e.kind).sort()).toEqual([
      "accepted",
      "cancelled",
      "routed",
    ]);
  });

  it("only the requester cancels", async () => {
    const neph = await department(pg, h, "Nephrology");
    const mo = await member(neph);
    const r = await placed("consult", neph);
    await as(mo, r.id, (c) => acceptRequest(c, { clientKey: key(), expectInMin: 15 }));
    expect(
      await code(as(mo, r.id, (c) => cancelRequest(c, { clientKey: key(), reasonCode: "other" }))),
    ).toBe("forbidden");
    await as(requester, r.id, (c) =>
      cancelRequest(c, { clientKey: key(), reasonCode: "entered_in_error" }),
    );
    expect(await stateOf(r.id)).toBe("cancelled");
    // The owner is also a recipient: one notice, not two.
    expect(await noticesOf(r.id, mo.userId)).toEqual(["care_request", "care_request_update"]);
  });
});
