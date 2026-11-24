/**
 * Reading care requests (ADR 0537) on the PGlite lane: Asked of you, For your department, Sent by
 * you, one request's detail, and the two workspace lanes. Visibility is the reader's RLS
 * (private.care_request_visible); names come as the owner, never for a restricted request the viewer
 * has no chart basis for. Runs with EMR_PGLITE=1.
 */
import { randomUUID } from "node:crypto";
import type { Lane, Pg } from "./_pglite";
import type { PlanRequestLine } from "@/lib/clerking/plan/draft";
import type { EmrActor } from "@/lib/emr/actor";
import type { RequestRow } from "@/lib/emr/read/requests";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { withPatientWrite } from "@/lib/emr/write/context";
import {
  acceptRequest,
  cancelRequest,
  declineRequest,
  placeRequests,
  withRequestWrite,
} from "@/lib/emr/write/requests";
import { encrypt, generateKey } from "@/lib/encryption";
import { bootLane, clinician, department, encounter, hospital, laneOn, patient } from "./_pglite";

// identitiesFor reveals names through the app's db: hand it the lane's.
const held = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", () => ({
  get db() {
    return held.db;
  },
}));
vi.mock("@/lib/resus/board-v2", () => ({ OPENABLE_LOOKBACK_MS: 0, fetchResusBoardV2: vi.fn() }));

const { askedOfMe, askedOrder, forMyDepartment, requestDetail, sentByMe } =
  await import("@/lib/emr/read/requests");
const { loadEmrTasks } = await import("@/lib/workspace/queries");

const FLAGS = ["CARE_REQUESTS", "EMR_V1", "ENCOUNTER_ENGINE_LIVE"] as const;
const saved = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));

describe.skipIf(!laneOn)("reading care requests (PGlite lane)", () => {
  let lane: Lane;
  let pg: Pg;
  let h: string;
  let home: string;
  let renal: string;
  let other: string;
  let requester: EmrActor;
  let consultant: EmrActor;

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
  const member = async (dept: string, cadre = "MEDICAL_OFFICER") =>
    actor(await clinician(pg, { hospitalId: h, departmentId: dept, cadre }), cadre, dept);
  const key = () => `k-${randomUUID()}`;
  const viewerOf = (a: EmrActor) => ({
    userId: a.userId,
    hospitalId: h,
    departmentId: a.departmentId!,
    cadreCode: a.cadreCode,
  });
  const opts = () => ({ database: lane.db });
  const ours = (rows: RequestRow[], ids: string[]) =>
    rows.map((r) => r.id).filter((id) => ids.includes(id));

  /** One consult (or review) placed by the requester for a new named patient. */
  async function placed(o: {
    kind?: "review" | "consult";
    target?: string;
    named?: string[];
    urgency?: string;
    restricted?: boolean;
  }): Promise<{ id: string; p: string }> {
    const kind = o.kind ?? "consult";
    const p = await patient(pg);
    await pg.query(
      `INSERT INTO public.patient_profiles (id, first_name_encrypted, surname_encrypted, sex, date_of_birth, id_type,
         phone_encrypted, district_id)
       VALUES ($1, $2, $3, 'female', '1980-01-01', 'none', $4, (SELECT id FROM public.districts LIMIT 1))`,
      [p, encrypt("Fixture"), encrypt("Patient"), encrypt("0700000000")],
    );
    const enc = await encounter(pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: requester.userId,
      departmentId: home,
    });
    const cond = randomUUID();
    await pg.query(
      `INSERT INTO public.conditions (id, logical_id, hospital_id, patient_user_id, encounter_id, effective_at,
         recorded_by_user_id, source, trust, category, text_ciphertext, clinical_status, verification, asserted_by,
         sensitivity, rank)
       VALUES ($1, $1, $2, $3, $4, now(), $5, 'clinician', 3, 'encounter_diagnosis', $6, 'active',
         'confirmed', 'clinician', $7, 'secondary')`,
      [
        cond,
        h,
        p,
        enc,
        requester.userId,
        encrypt("Nephrotic syndrome"),
        o.restricted ? "restricted" : "standard",
      ],
    );
    const line: PlanRequestLine = {
      clientKey: key(),
      kind,
      targetDepartmentId: o.target ?? renal,
      wardId: null,
      namedUserIds: o.named ?? [],
      urgency: (o.urgency ??
        (kind === "consult" ? "routine" : "now")) as PlanRequestLine["urgency"],
      helpWanted: kind === "consult" ? "advice" : null,
      reasonConditionIds: kind === "consult" ? [cond] : [],
      question: kind === "consult" ? "Is this nephrotic syndrome?\nUrine is frothy." : "",
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
      opts(),
    );
    return { id: id!, p };
  }

  beforeAll(async () => {
    process.env.MEDSYNC_PHI_KEY ??= generateKey();
    for (const k of FLAGS) process.env[k] = "1";
    lane = await bootLane();
    held.db = lane.db;
    pg = lane.pg;
    h = await hospital(pg, "Reads");
    home = await department(pg, h, "Home");
    renal = await department(pg, h, "Renal");
    other = await department(pg, h, "Other");
    requester = await member(home);
    consultant = await member(renal, "CONSULTANT");
  }, 180_000);

  afterAll(() => {
    for (const k of FLAGS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("asked of you lists my open requests, overdue first", async () => {
    const named = [consultant.userId];
    const oldRoutine = await placed({ named });
    const newRoutine = await placed({ named });
    const urgent = await placed({ named, urgency: "urgent_today" });
    const declined = await placed({ named });
    const cancelled = await placed({ named });
    await withRequestWrite(
      consultant,
      declined.id,
      (c) => declineRequest(c, { clientKey: key(), reasonCode: "not_our_specialty" }),
      opts(),
    );
    await withRequestWrite(
      requester,
      cancelled.id,
      (c) => cancelRequest(c, { clientKey: key(), reasonCode: "no_longer_needed" }),
      opts(),
    );
    const all = [oldRoutine, newRoutine, urgent, declined, cancelled].map((r) => r.id);
    const rows = await askedOfMe(consultant, opts());
    // Urgency before age, then the oldest first; declined and cancelled are no longer asked of me.
    expect(ours(rows, all)).toEqual([urgent.id, oldRoutine.id, newRoutine.id]);
    const row = rows.find((r) => r.id === urgent.id)!;
    expect(row).toMatchObject({
      kind: "consult",
      urgency: "urgent_today",
      stateWord: "Sent",
      patientName: "Fixture Patient",
      questionFirstLine: "Is this nephrotic syndrome?",
      mine: true,
      restricted: false,
    });
    expect(row.departmentName).toMatch(/^Renal/);
    // Nothing is signed yet, so nothing is overdue in the database; the order puts overdue first.
    const r = (o: Partial<RequestRow>) => ({ ...row, ...o });
    const sorted = [
      r({ id: "routine", urgency: "routine", askedAtMs: 1 }),
      r({ id: "late", urgency: "routine", askedAtMs: 2, overdue: true }),
      r({ id: "now", urgency: "now", askedAtMs: 3 }),
    ].sort(askedOrder);
    expect(sorted.map((x) => x.id)).toEqual(["late", "now", "routine"]);
  });

  it("asked of you ignores the scope department", async () => {
    const asked = await placed({ named: [consultant.userId] });
    // requireDoctorScope picked another of the consultant's departments today.
    const elsewhere = { ...consultant, departmentId: other };
    expect(ours(await askedOfMe(elsewhere, opts()), [asked.id])).toEqual([asked.id]);
    expect(ours(await forMyDepartment(elsewhere, opts()), [asked.id])).toEqual([]);
  });

  it("department list shows names to members, unclaimed first", async () => {
    const claimed = await placed({});
    const unclaimed = await placed({});
    await withRequestWrite(
      consultant,
      claimed.id,
      (c) => acceptRequest(c, { clientKey: key(), expectInMin: null }),
      opts(),
    );
    // Joined the department after both were routed: not asked, but the department's to pick up (D6).
    const late = await member(renal);
    const rows = await forMyDepartment(late, opts());
    expect(ours(rows, [claimed.id, unclaimed.id])).toEqual([unclaimed.id, claimed.id]);
    for (const r of rows.filter((x) => [claimed.id, unclaimed.id].includes(x.id))) {
      expect(r.patientName).toBe("Fixture Patient");
      expect(r.mine).toBe(false);
    }
    expect(rows.find((r) => r.id === claimed.id)).toMatchObject({
      stateWord: "Accepted",
      claimed: true,
    });
    expect(rows.find((r) => r.id === unclaimed.id)!.claimed).toBe(false);
    // R30: the board offers "Pick up" only on what nobody has taken; the list keeps both.
    const board = (await loadEmrTasks(lane.db, viewerOf(late))).map((t) => t.id);
    expect(board).toContain(unclaimed.id);
    expect(board).not.toContain(claimed.id);
  });

  it("restricted request is never named on a lane", async () => {
    const hidden = await placed({ named: [consultant.userId], restricted: true });
    const shown = await placed({ named: [consultant.userId] });
    const tasks = await loadEmrTasks(lane.db, viewerOf(consultant));
    // The routed recipient's board keeps their restricted request, unlabelled; they hold the chart basis.
    expect(tasks.find((t) => t.id === hidden.id)).toMatchObject({
      kind: "request_mine",
      label: null,
      unnamed: false,
    });
    expect(tasks.find((t) => t.id === shown.id)!.label).toMatch(/^Consult · Renal/);
    // A member with no chart basis reads the request, but not who it is about or why.
    const late = await member(renal);
    const row = (await forMyDepartment(late, opts())).find((r) => r.id === hidden.id)!;
    expect(row).toMatchObject({
      restricted: true,
      chart: false,
      patientName: null,
      mrn: null,
      questionFirstLine: null,
    });
    // R29: never on their board, where the workspace would reveal the patient's name.
    const board = (await loadEmrTasks(lane.db, viewerOf(late))).map((t) => t.id);
    expect(board).not.toContain(hidden.id);
    expect(board).toContain(shown.id);
    const detail = (await requestDetail(late, hidden.id, opts()))!;
    expect(detail.mrn).toBeNull();
    expect(detail.question).toBeNull();
    expect(detail.canOpenChart).toBe(false);
    expect(detail.problems).not.toContain("Nephrotic syndrome");
  });

  it("sent by me and the detail: open first, the question, the history and what may be done", async () => {
    const sent = await placed({ named: [consultant.userId] });
    expect(ours(await sentByMe(requester, opts()), [sent.id])).toEqual([sent.id]);
    const detail = (await requestDetail(consultant, sent.id, opts()))!;
    expect(detail.question).toBe("Is this nephrotic syndrome?\nUrine is frothy.");
    expect(detail.problems).toEqual(["Nephrotic syndrome"]);
    expect(detail.history.map((e) => e.words)).toEqual([expect.stringMatching(/^Sent to /)]);
    expect(detail.canAct.accept).toBe(true);
    expect(detail.canAct.cancel).not.toBe(true);
    expect(detail.canOpenChart).toBe(true);
  });

  it("a nurse in another department sees nothing", async () => {
    const r = await placed({ named: [consultant.userId] });
    const nurse = await member(other, "NURSE");
    expect(ours(await askedOfMe(nurse, opts()), [r.id])).toEqual([]);
    expect(ours(await forMyDepartment(nurse, opts()), [r.id])).toEqual([]);
    expect(ours(await sentByMe(nurse, opts()), [r.id])).toEqual([]);
    expect(await requestDetail(nurse, r.id, opts())).toBeNull();
  });
});
