/**
 * The E8 lane loader (lib/workspace/queries.ts loadEmrTasks) on the PGlite lane: its SQL decides
 * who answers a result (the orderer or whoever covers them, D-EMR-07), which version counts (the
 * current one; an amendment needs re-acknowledgement), that legacy and unreleased results never
 * enter, that a restricted result is never named, and who may co-sign a note. Runs only with
 * EMR_PGLITE=1.
 */
import { randomUUID } from "node:crypto";
import type { Lane } from "../emr-db/_pglite";
import type { WorkspaceViewer } from "@/lib/workspace/queries";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  bootLane,
  department,
  encounter,
  hospital,
  laneOn,
  patient,
  staff,
} from "../emr-db/_pglite";

// queries.ts reads the app's db (and modules that validate the app env) at import; this suite
// hands loadEmrTasks the lane's database instead.
const laneDb = vi.hoisted(() => ({ current: {} as unknown }));
vi.mock("@/db", () => ({
  get db() {
    return laneDb.current;
  },
}));
vi.mock("@/lib/resus/board-v2", () => ({
  OPENABLE_LOOKBACK_MS: 24 * 3_600_000,
  fetchResusBoardV2: vi.fn(async () => ({
    hospitalId: "h",
    nowIso: new Date().toISOString(),
    arrest: [],
    active: [],
    boarding: [],
    needsClosing: [],
    openable: [],
    ended: [],
  })),
}));
vi.mock("@/lib/scheduling/patient-identity", () => ({
  revealPatientIdentities: vi.fn(async () => new Map()),
}));

const { loadEmrTasks, loadWorkspace } = await import("@/lib/workspace/queries");

describe.skipIf(!laneOn)("E8 lane sources on the PGlite lane", () => {
  let lane: Lane;
  let h: string;
  let medicine: string;
  let p: string;
  let enc: string;
  const who: Record<string, WorkspaceViewer> = {};

  beforeAll(async () => {
    lane = await bootLane();
    laneDb.current = lane.db;
    h = await hospital(lane.pg);
    medicine = await department(lane.pg, h);
    const surgery = await department(lane.pg, h, "Surgery");
    const add = async (key: string, cadre: string, departmentId: string) => {
      const s = await staff(lane.pg, { hospitalId: h, departmentId, cadre });
      who[key] = { userId: s.userId, hospitalId: h, departmentId, cadreCode: cadre };
      return s;
    };
    await add("orderer", "MEDICAL_OFFICER", medicine);
    await add("cover", "MEDICAL_OFFICER", medicine);
    await add("outsider", "MEDICAL_OFFICER", surgery);
    const intern = await add("intern", "INTERN_DOCTOR", medicine);
    p = await patient(lane.pg);
    enc = await encounter(lane.pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: who.orderer!.userId,
      departmentId: medicine,
    });

    // A note by the intern, awaiting co-signature.
    const note = await one(
      `INSERT INTO public.clinical_notes (hospital_id, patient_user_id, encounter_id, note_type, template_id,
         template_version, author_user_id, author_cadre, content_ciphertext, effective_at)
       VALUES ($1, $2, $3, 'clerking', 'lane', '1', $4, 'INTERN_DOCTOR', 'iv:tag:ct', now()) RETURNING id`,
      [h, p, enc, who.intern!.userId],
    );
    await lane.pg.query(
      `INSERT INTO public.clinical_cosign_requests (hospital_id, patient_user_id, requested_by_user_id,
         requested_by_affiliation_id, requested_by_cadre_code, action_kind, action_payload, note_id)
       VALUES ($1, $2, $3, $4, 'INTERN_DOCTOR', 'sign_note', '{}'::jsonb, $5)`,
      [h, p, who.intern!.userId, intern.affiliationId, note],
    );
  }, 180_000);

  async function one(sql: string, params: unknown[]): Promise<string> {
    return (await lane.pg.query<{ id: string }>(sql, params)).rows[0]!.id;
  }

  async function order(o: { legacy?: boolean; text?: string; sensitivity?: string } = {}) {
    return o.legacy
      ? one(
          `INSERT INTO public.encounter_orders (encounter_id, patient_user_id, kind, text, authored_by_user_id, status)
           VALUES ($1, $2, 'bloods', 'FBC', $3, 'resulted') RETURNING id`,
          [enc, p, who.orderer!.userId],
        )
      : one(
          // kind 'ecg' needs no test_id (a 'lab' order must name its catalogue test); a reason is required.
          `INSERT INTO public.encounter_orders (encounter_id, patient_user_id, kind, text, authored_by_user_id, lifecycle,
             hospital_id, priority, performer, intent_source, requester_cadre, effective_at, sensitivity,
             reason_text_ciphertext)
           VALUES ($1, $2, 'ecg', $4, $3, 'events', $5, 'routine', 'in_house', 'clinician', 'MEDICAL_OFFICER', now(), $6,
             'iv:tag:ct')
           RETURNING id`,
          [enc, p, who.orderer!.userId, o.text ?? "Potassium", h, o.sensitivity ?? "standard"],
        );
  }

  async function report(
    orderId: string,
    o: {
      status?: string;
      critical?: boolean;
      sensitivity?: string;
      logicalId?: string;
      version?: number;
      supersedesId?: string;
    } = {},
  ): Promise<string> {
    const id = randomUUID();
    await lane.pg.query(
      `INSERT INTO public.diagnostic_reports (id, logical_id, version, supersedes_id, hospital_id, patient_user_id,
         encounter_id, recorded_by_user_id, effective_at, source, trust, status, sensitivity, order_id, kind, issued_at,
         performer, entry_mode, entered_by_user_id, critical)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), 'lab', 4, $9, $10, $11, 'lab', now(), 'in_house', 'direct', $8, $12)`,
      [
        id,
        o.logicalId ?? id,
        o.version ?? 1,
        o.supersedesId ?? null,
        h,
        p,
        enc,
        who.orderer!.userId,
        o.status ?? "final",
        o.sensitivity ?? "standard",
        orderId,
        o.critical ?? false,
      ],
    );
    return id;
  }

  const ack = (reportId: string) =>
    lane.pg.query(
      `INSERT INTO public.result_acknowledgements (report_id, hospital_id, patient_user_id, acknowledged_by_user_id,
         acknowledger_cadre, action) VALUES ($1, $2, $3, $4, 'MEDICAL_OFFICER', 'seen')`,
      [reportId, h, p, who.orderer!.userId],
    );

  const tasksOf = async (key: string) =>
    (await loadEmrTasks(lane.db, who[key]!)).sort((a, b) => a.id.localeCompare(b.id));
  const idsOf = async (key: string, kind?: string) =>
    (await tasksOf(key)).filter((t) => !kind || t.kind === kind).map((t) => t.id);

  it("a released result reaches the orderer and whoever covers them, never another department", async () => {
    const r = await report(await order());
    expect(await idsOf("orderer")).toContain(r);
    expect(await idsOf("cover")).toContain(r);
    expect(await idsOf("outsider")).not.toContain(r);
    const t = (await tasksOf("orderer")).find((x) => x.id === r)!;
    expect(t).toMatchObject({
      kind: "result_to_review",
      patientId: p,
      encounterId: enc,
      label: "Potassium",
    });
  });

  it("a critical result is its own lane source", async () => {
    const r = await report(await order({ text: "Sodium" }), { critical: true });
    expect(await idsOf("orderer", "critical_result")).toContain(r);
  });

  it("acknowledged → gone; amended after acknowledgement → back, as the new version only", async () => {
    const o = await order({ text: "Creatinine" });
    const v1 = await report(o);
    await ack(v1);
    expect(await idsOf("orderer")).not.toContain(v1);
    const v2 = await report(o, { status: "amended", logicalId: v1, version: 2, supersedesId: v1 });
    const ids = await idsOf("orderer");
    expect(ids).toContain(v2);
    expect(ids).not.toContain(v1);
  });

  it("an unacknowledged v1 superseded by v2 shows once, as v2", async () => {
    const o = await order({ text: "Urea" });
    const v1 = await report(o);
    const v2 = await report(o, {
      status: "corrected",
      logicalId: v1,
      version: 2,
      supersedesId: v1,
    });
    const ids = await idsOf("orderer");
    expect(ids).toContain(v2);
    expect(ids).not.toContain(v1);
  });

  it("preliminary, withdrawn and legacy results never enter", async () => {
    const prelim = await report(await order(), { status: "preliminary" });
    const withdrawn = await report(await order(), { status: "cancelled" });
    const legacy = await report(await order({ legacy: true }));
    const ids = await idsOf("orderer");
    for (const r of [prelim, withdrawn, legacy]) expect(ids).not.toContain(r);
  });

  it("a restricted result is never named", async () => {
    const byReport = await report(await order({ text: "HIV" }), { sensitivity: "restricted" });
    const byOrder = await report(await order({ text: "HIV", sensitivity: "restricted" }));
    const tasks = await tasksOf("orderer");
    for (const r of [byReport, byOrder]) expect(tasks.find((t) => t.id === r)?.label).toBeNull();
  });

  it("a note co-sign reaches a senior of the requester's department, never the requester", async () => {
    const [c] = await idsOf("orderer", "cosign");
    expect(c).toBeDefined();
    expect((await tasksOf("orderer")).find((t) => t.id === c)).toMatchObject({
      encounterId: enc,
      label: "Clerking note",
    });
    expect(await idsOf("intern", "cosign")).toEqual([]);
    expect(await idsOf("outsider", "cosign")).toEqual([]);
  });

  it("loadWorkspace under EMR v1: the whole read runs on 0071's schema and fills the lanes", async () => {
    vi.stubEnv("ENCOUNTER_ENGINE_LIVE", "1");
    vi.stubEnv("EMR_V1", h);
    try {
      // A second patient whose visit ended days ago with the orderer's note still a draft.
      const q = await patient(lane.pg);
      const done = await encounter(lane.pg, {
        hospitalId: h,
        patientUserId: q,
        clinicianUserId: who.orderer!.userId,
        departmentId: medicine,
        state: "completed",
        startedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      });
      await lane.pg.query(
        `INSERT INTO public.clinical_notes (hospital_id, patient_user_id, encounter_id, note_type, template_id,
           template_version, author_user_id, author_cadre, content_ciphertext, effective_at)
         VALUES ($1, $2, $3, 'clerking', 'lane', '1', $4, 'MEDICAL_OFFICER', 'iv:tag:ct', now())`,
        [h, q, done, who.orderer!.userId],
      );
      const data = await loadWorkspace({ viewer: who.orderer!, scope: "mine" });
      expect(data.emr).toBe(true);
      const row = (id: string) => data.flow.rows.find((r) => r.patientId === id);
      // p: my clerking is in progress, the critical result outranks it.
      expect(row(p)?.lane).toBe("critical_results");
      expect(row(q)?.lane).toBe("needs_closing");
      expect(row(q)?.alsoOpen[0]?.detail).toBe("Visit ended with an unsigned note");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("someone else's draft on my visit is not my unsigned note (only its author can sign it)", async () => {
    vi.stubEnv("ENCOUNTER_ENGINE_LIVE", "1");
    vi.stubEnv("EMR_V1", h);
    try {
      // A senior opened the orderer's visit to review it; the desk left the senior a draft.
      const r = await patient(lane.pg);
      const done = await encounter(lane.pg, {
        hospitalId: h,
        patientUserId: r,
        clinicianUserId: who.orderer!.userId,
        departmentId: medicine,
        state: "completed",
        startedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      });
      await lane.pg.query(
        `INSERT INTO public.clinical_notes (hospital_id, patient_user_id, encounter_id, note_type, template_id,
           template_version, author_user_id, author_cadre, content_ciphertext, effective_at)
         VALUES ($1, $2, $3, 'clerking', 'lane', '1', $4, 'MEDICAL_OFFICER', 'iv:tag:ct', now())`,
        [h, r, done, who.cover!.userId],
      );
      const data = await loadWorkspace({ viewer: who.orderer!, scope: "mine" });
      expect(data.flow.rows.find((x) => x.patientId === r)).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
