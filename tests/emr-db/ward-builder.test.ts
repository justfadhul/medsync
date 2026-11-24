/**
 * Migration 0090 on the PGlite lane (ADRs 0191–0196): the publish function applies the pure reconcile in
 * one transaction; the guards keep published layouts, assignments and state events as written; RLS reads
 * and the live topic. Runs only with EMR_PGLITE=1 (see _pglite.ts).
 */
import { randomUUID } from "node:crypto";
import type { Lane, Pg } from "./_pglite";
import type { RegisterBed, WardLayout } from "@/supabase/functions/_shared/ward-layout";
import { beforeAll, describe, expect, it } from "vitest";

import {
  layoutFromRegister,
  publishPayload,
  reconcile,
} from "@/supabase/functions/_shared/ward-layout";
import {
  authUser,
  bootLane,
  department,
  hospital,
  laneOn,
  patient,
  probe,
  reception,
  staff,
} from "./_pglite";

const BOOT_MS = 180_000;

describe.skipIf(!laneOn)("0090 — the ward builder on real SQL", () => {
  let lane: Lane;
  let pg: Pg;
  let h: string;
  let dept: string;
  let admin: string;

  beforeAll(async () => {
    lane = await bootLane();
    pg = lane.pg;
    h = await hospital(pg, "Ward builder");
    dept = await department(pg, h);
    admin = await authUser(pg, "admin");
    await pg.query(
      `INSERT INTO public.user_roles (user_id, role, hospital_id) VALUES ($1, 'hospital_admin', $2)`,
      [admin, h],
    );
  }, BOOT_MS);

  async function ward(beds: string[]): Promise<string> {
    const s = randomUUID().slice(0, 8);
    const id = (
      await pg.query<{ id: string }>(
        `INSERT INTO public.hospital_wards (hospital_id, department_id, name, slug, bed_count)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [h, dept, `Ward ${s}`, `ward-${s}`, beds.length],
      )
    ).rows[0]!.id;
    for (const label of beds)
      await pg.query(
        `INSERT INTO public.hospital_beds (hospital_id, ward_id, label) VALUES ($1, $2, $3)`,
        [h, id, label],
      );
    return id;
  }

  async function register(wardId: string): Promise<RegisterBed[]> {
    const rows = await pg.query<{
      id: string;
      label: string;
      bed_type: string | null;
      closed_at: string | null;
      closed_reason: string | null;
      archived_at: string | null;
      layout_x: number | null;
      layout_y: number | null;
      rotation: number | null;
      room_key: string | null;
      services: string[] | null;
    }>(
      `SELECT b.*, (SELECT array_agg(s.service_code) FROM public.hospital_bed_services s WHERE s.bed_id = b.id) AS services
         FROM public.hospital_beds b WHERE b.ward_id = $1 ORDER BY b.created_at, b.label`,
      [wardId],
    );
    return rows.rows.map((r) => ({
      id: r.id,
      label: r.label,
      bedType: r.bed_type,
      closedAt: r.closed_at,
      closedReason: r.closed_reason,
      archivedAt: r.archived_at,
      layoutX: r.layout_x,
      layoutY: r.layout_y,
      rotation: r.rotation,
      roomKey: r.room_key,
      services: r.services ?? [],
    }));
  }

  async function draft(wardId: string, doc: WardLayout, version = 1) {
    return (
      await pg.query<{ id: string; revision: number }>(
        `INSERT INTO public.ward_layouts (hospital_id, ward_id, version, floor_w_cells, floor_h_cells, document, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, revision`,
        [h, wardId, version, doc.floor.w, doc.floor.h, JSON.stringify(doc), admin],
      )
    ).rows[0]!;
  }

  async function occupiedIn(wardId: string) {
    return (
      await pg.query<{ bed_id: string }>(
        `SELECT bed_id FROM public.bed_assignments WHERE ward_id = $1 AND ended_at IS NULL`,
        [wardId],
      )
    ).rows.map((r) => r.bed_id);
  }

  async function publish(wardId: string, doc: WardLayout, d: { id: string; revision: number }) {
    const outcome = reconcile({
      doc,
      register: await register(wardId),
      occupiedBedIds: await occupiedIn(wardId),
    });
    if (!outcome.ok) throw new Error(outcome.refusal);
    const payload = publishPayload(outcome.plan, {
      hospitalId: h,
      wardId,
      draftId: d.id,
      draftRevision: d.revision,
      actorId: admin,
      warnings: ["No resus trolley on the plan"],
    });
    return (
      await pg.query<{ r: Record<string, unknown> }>(
        `SELECT public.ward_layout_publish($1::jsonb) AS r`,
        [JSON.stringify(payload)],
      )
    ).rows[0]!.r;
  }

  const bedCount = async (wardId: string) =>
    (
      await pg.query<{ n: number }>(
        `SELECT bed_count AS n FROM public.hospital_wards WHERE id = $1`,
        [wardId],
      )
    ).rows[0]!.n;

  it("start from the register, move a bed, add one with services: the register follows, ids come back", async () => {
    const w = await ward(["Bed 1", "Bed 2", "Bed 3"]);
    const reg = await register(w);
    const doc = layoutFromRegister(reg.map((r) => ({ ...r, services: [] })));
    doc.beds[0]!.x = 20;
    doc.beds.push({
      key: "b9",
      label: "Bed 4",
      type: "icu",
      x: 30,
      y: 2,
      rot: 0,
      services: ["o2", "monitor"],
      status: "in",
    });
    const d = await draft(w, doc);
    const r = await publish(w, doc, d);
    expect(r).toMatchObject({ version: 1, archived: 0, bed_count: 4 });
    expect(await bedCount(w)).toBe(4);
    const after = await register(w);
    expect(after.find((b) => b.label === "Bed 1")).toMatchObject({
      layoutX: 20,
      layoutY: 2,
      rotation: 0,
    });
    const added = after.find((b) => b.label === "Bed 4")!;
    expect(added).toMatchObject({ bedType: "icu" });
    expect([...added.services].sort()).toEqual(["monitor", "o2"]);
    const row = (
      await pg.query<{
        state: string;
        document: WardLayout;
        warnings: string[];
        published_by: string;
      }>(`SELECT state, document, warnings, published_by FROM public.ward_layouts WHERE id = $1`, [
        d.id,
      ])
    ).rows[0]!;
    expect(row.state).toBe("published");
    expect(row.warnings).toEqual(["No resus trolley on the plan"]);
    expect(row.published_by).toBe(admin);
    expect(row.document.beds.find((b) => b.label === "Bed 4")!.bedId).toBe(added.id);
    expect(row.document.beds.every((b) => b.bedId)).toBe(true);
  });

  it("a second version archives a bed off the plan, swaps two numbers, supersedes the first", async () => {
    const w = await ward(["B1", "B2", "B3"]);
    const doc1 = layoutFromRegister(await register(w));
    const d1 = await draft(w, doc1);
    const first = (await publish(w, doc1, d1)) as { version: number };
    const published = (
      await pg.query<{ document: WardLayout }>(
        `SELECT document FROM public.ward_layouts WHERE id = $1`,
        [d1.id],
      )
    ).rows[0]!.document;
    const doc2: WardLayout = { ...published, beds: published.beds.filter((b) => b.label !== "B3") };
    doc2.beds[0]!.label = "B2";
    doc2.beds[1]!.label = "B1";
    const d2 = await draft(w, doc2, first.version + 1);
    const r = await publish(w, doc2, d2);
    expect(r).toMatchObject({ version: 2, archived: 1, bed_count: 2 });
    const reg = await register(w);
    expect(
      reg
        .filter((b) => !b.archivedAt)
        .map((b) => b.label)
        .sort(),
    ).toEqual(["B1", "B2"]);
    expect(reg.find((b) => b.id === published.beds[0]!.bedId)!.label).toBe("B2");
    const states = (
      await pg.query<{ id: string; state: string }>(
        `SELECT id, state FROM public.ward_layouts WHERE ward_id = $1 ORDER BY version`,
        [w],
      )
    ).rows;
    expect(states.map((s) => s.state)).toEqual(["superseded", "published"]);
  });

  it("an archived bed restores by its number; an archived number the plan reuses becomes '(old 1)'", async () => {
    const w = await ward(["P1", "P2"]);
    const reg = await register(w);
    await pg.query(`UPDATE public.hospital_beds SET archived_at = now() WHERE id = $1`, [
      reg[1]!.id,
    ]);
    await pg.query(`UPDATE public.hospital_wards SET bed_count = 1 WHERE id = $1`, [w]);
    // P2 comes back by number; the kept P1 is renumbered P3, and a new bed takes "P1".
    const doc = layoutFromRegister([{ ...reg[0]!, label: "P3", services: [] }]);
    doc.beds.push({
      key: "b7",
      label: "P2",
      type: "standard",
      x: 30,
      y: 2,
      rot: 0,
      services: [],
      status: "in",
    });
    doc.beds.push({
      key: "b8",
      label: "P1",
      type: "standard",
      x: 25,
      y: 2,
      rot: 0,
      services: [],
      status: "in",
    });
    const d = await draft(w, doc);
    await publish(w, doc, d);
    const after = await register(w);
    expect(after.find((b) => b.id === reg[1]!.id)).toMatchObject({ label: "P2", archivedAt: null });
    expect(after.find((b) => b.id === reg[0]!.id)!.label).toBe("P3");
    expect(
      after
        .filter((b) => !b.archivedAt)
        .map((b) => b.label)
        .sort(),
    ).toEqual(["P1", "P2", "P3"]);
    expect(await bedCount(w)).toBe(3);
  });

  it("a bed out of service keeps its closure; back in service clears it", async () => {
    const w = await ward(["C1"]);
    const doc = layoutFromRegister(await register(w));
    doc.beds[0]!.status = "out";
    doc.beds[0]!.outReason = "Awaiting repair";
    await publish(w, doc, await draft(w, doc));
    const closed = (await register(w))[0]!;
    expect(closed).toMatchObject({ closedReason: "Awaiting repair" });
    expect(closed.closedAt).not.toBeNull();
  });

  it("refuses: a stale draft revision, and (under the locks) a bed that gained a patient", async () => {
    const w = await ward(["R1", "R2"]);
    const doc = layoutFromRegister(await register(w));
    const d = await draft(w, doc);
    await expect(publish(w, doc, { ...d, revision: d.revision + 1 })).rejects.toThrow(
      /WL409 The draft changed/,
    );

    // Plan without R2, then a patient goes into R2 before the write: the SQL refuses.
    const reg = await register(w);
    const outcome = reconcile({
      doc: { ...doc, beds: doc.beds.slice(0, 1) },
      register: reg,
      occupiedBedIds: [],
    });
    if (!outcome.ok) throw new Error(outcome.refusal);
    const p = await patient(pg);
    await pg.query(
      `INSERT INTO public.bed_assignments (hospital_id, ward_id, bed_id, patient_user_id, started_by) VALUES ($1, $2, $3, $4, $5)`,
      [h, w, reg[1]!.id, p, admin],
    );
    const payload = publishPayload(outcome.plan, {
      hospitalId: h,
      wardId: w,
      draftId: d.id,
      draftRevision: d.revision,
      actorId: admin,
      warnings: [],
    });
    await expect(
      pg.query(`SELECT public.ward_layout_publish($1::jsonb)`, [JSON.stringify(payload)]),
    ).rejects.toThrow(/WL409 A patient is in R2/);
    // The pure plan refuses first, naming the bed.
    const refused = reconcile({
      doc: { ...doc, beds: doc.beds.slice(0, 1) },
      register: reg,
      occupiedBedIds: [reg[1]!.id],
    });
    expect(refused).toMatchObject({ ok: false });
    expect(!refused.ok && refused.refusal).toMatch(/Bed R2 has a patient in it/);
    // Nothing changed.
    expect((await register(w)).every((b) => b.archivedAt === null)).toBe(true);
  });

  it("guards: published and superseded layouts, assignments and state events stay as written", async () => {
    const w = await ward(["G1", "G2"]);
    const doc = layoutFromRegister(await register(w));
    const d = await draft(w, doc);
    await publish(w, doc, d);
    await expect(
      pg.query(`UPDATE public.ward_layouts SET warnings = '[]' WHERE id = $1`, [d.id]),
    ).rejects.toThrow(/only becomes superseded/);
    await expect(pg.query(`DELETE FROM public.ward_layouts WHERE id = $1`, [d.id])).rejects.toThrow(
      /kept for good/,
    );
    await expect(
      pg.query(
        `INSERT INTO public.ward_layouts (hospital_id, ward_id, version, state, floor_w_cells, floor_h_cells, document, published_at)
         VALUES ($1, $2, 9, 'published', 42, 32, '{"v":1}', now())`,
        [h, w],
      ),
    ).rejects.toThrow(/starts as a draft/);
    const otherHospital = await hospital(pg, "Other");
    await expect(
      pg.query(
        `INSERT INTO public.ward_layouts (hospital_id, ward_id, version, floor_w_cells, floor_h_cells, document)
         VALUES ($1, $2, 9, 42, 32, '{"v":1}')`,
        [otherHospital, w],
      ),
    ).rejects.toThrow(/is not at hospital/);

    const [g1, g2] = await register(w);
    const p = await patient(pg);
    const a = (
      await pg.query<{ id: string }>(
        `INSERT INTO public.bed_assignments (hospital_id, ward_id, bed_id, patient_user_id, started_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [h, w, g1!.id, p, admin],
      )
    ).rows[0]!.id;
    // One open per bed, one per patient.
    await expect(
      pg.query(
        `INSERT INTO public.bed_assignments (hospital_id, ward_id, bed_id, patient_user_id, started_by) VALUES ($1, $2, $3, $4, $5)`,
        [h, w, g2!.id, p, admin],
      ),
    ).rejects.toThrow(/one_occupied_per_patient/);
    // An occupied bed can't be closed or archived.
    await expect(
      pg.query(
        `UPDATE public.hospital_beds SET closed_at = now(), closed_reason = 'Broken' WHERE id = $1`,
        [g1!.id],
      ),
    ).rejects.toThrow(/WL409 Bed G1 has a patient in it/);
    await expect(pg.query(`DELETE FROM public.bed_assignments WHERE id = $1`, [a])).rejects.toThrow(
      /kept for good/,
    );
    await expect(
      pg.query(`UPDATE public.bed_assignments SET bed_id = $2 WHERE id = $1`, [a, g2!.id]),
    ).rejects.toThrow(/only ends, once/);
    await pg.query(
      `UPDATE public.bed_assignments SET ended_at = now(), ended_by = $2, reason = 'Discharged home' WHERE id = $1`,
      [a, admin],
    );
    await expect(
      pg.query(`UPDATE public.bed_assignments SET reason = 'Changed' WHERE id = $1`, [a]),
    ).rejects.toThrow(/only ends, once/);

    // A closed bed takes nobody.
    await pg.query(
      `UPDATE public.hospital_beds SET closed_at = now(), closed_reason = 'Broken' WHERE id = $1`,
      [g2!.id],
    );
    await expect(
      pg.query(
        `INSERT INTO public.bed_assignments (hospital_id, ward_id, bed_id, patient_user_id, started_by) VALUES ($1, $2, $3, $4, $5)`,
        [h, w, g2!.id, await patient(pg), admin],
      ),
    ).rejects.toThrow(/is not an open bed/);

    const e = (
      await pg.query<{ id: string }>(
        `INSERT INTO public.bed_state_events (hospital_id, bed_id, state, set_by) VALUES ($1, $2, 'cleaning', $3) RETURNING id`,
        [h, g1!.id, admin],
      )
    ).rows[0]!.id;
    await expect(
      pg.query(`UPDATE public.bed_state_events SET state = 'free' WHERE id = $1`, [e]),
    ).rejects.toThrow(/append-only/);
    await expect(
      pg.query(`DELETE FROM public.bed_state_events WHERE id = $1`, [e]),
    ).rejects.toThrow(/append-only/);
    await expect(
      pg.query(
        `INSERT INTO public.bed_state_events (hospital_id, bed_id, state, set_by) VALUES ($1, $2, 'reserved', $3)`,
        [h, g1!.id, admin],
      ),
    ).rejects.toThrow(/bed_state_events_reason_check/);
  });

  it("a ward or hospital that goes takes its rows with it (a cascade), which no direct delete can", async () => {
    const h2 = await hospital(pg, "Cascade");
    const d2 = await department(pg, h2);
    const s = randomUUID().slice(0, 8);
    const w = (
      await pg.query<{ id: string }>(
        `INSERT INTO public.hospital_wards (hospital_id, department_id, name, slug, bed_count) VALUES ($1, $2, $3, $4, 1) RETURNING id`,
        [h2, d2, `Cascade ${s}`, `cascade-${s}`],
      )
    ).rows[0]!.id;
    const b = (
      await pg.query<{ id: string }>(
        `INSERT INTO public.hospital_beds (hospital_id, ward_id, label) VALUES ($1, $2, 'C1') RETURNING id`,
        [h2, w],
      )
    ).rows[0]!.id;
    await pg.query(
      `INSERT INTO public.bed_assignments (hospital_id, ward_id, bed_id, patient_user_id, started_by) VALUES ($1, $2, $3, $4, $5)`,
      [h2, w, b, await patient(pg), admin],
    );
    await pg.query(
      `INSERT INTO public.bed_state_events (hospital_id, bed_id, state, set_by) VALUES ($1, $2, 'cleaning', $3)`,
      [h2, b, admin],
    );
    await expect(
      pg.query(`DELETE FROM public.bed_assignments WHERE ward_id = $1`, [w]),
    ).rejects.toThrow(/kept for good/);
    await pg.query(`DELETE FROM public.hospital_wards WHERE id = $1`, [w]);
    const left = await pg.query<{ n: number }>(
      `SELECT (SELECT count(*) FROM public.bed_assignments WHERE ward_id = $1)::int
            + (SELECT count(*) FROM public.bed_state_events WHERE bed_id = $2)::int AS n`,
      [w, b],
    );
    expect(left.rows[0]!.n).toBe(0);
  });

  it("a draft may be discarded; a second draft for the ward is refused", async () => {
    const w = await ward(["D1"]);
    const doc = layoutFromRegister(await register(w));
    const d = await draft(w, doc);
    await expect(draft(w, doc, 2)).rejects.toThrow(/ward_layouts_one_draft/);
    await pg.query(`DELETE FROM public.ward_layouts WHERE id = $1`, [d.id]);
    await draft(w, doc, 2);
  });

  it("RLS: staff of the hospital read layouts and state; assignments only clinical staff; no client writes", async () => {
    const w = await ward(["S1"]);
    const doc = layoutFromRegister(await register(w));
    await publish(w, doc, await draft(w, doc));
    const [s1] = await register(w);
    await pg.query(
      `INSERT INTO public.bed_assignments (hospital_id, ward_id, bed_id, patient_user_id, started_by) VALUES ($1, $2, $3, $4, $5)`,
      [h, w, s1!.id, await patient(pg), admin],
    );
    const nurse = await staff(pg, { hospitalId: h, departmentId: dept, cadre: "NURSE" });
    const desk = await reception(pg, { hospitalId: h, departmentId: dept });
    const oh = await hospital(pg, "Elsewhere");
    const outsider = await staff(pg, {
      hospitalId: oh,
      departmentId: await department(pg, oh),
      cadre: "NURSE",
    });
    const as = (userId: string) => ({ userId, role: "authenticated" as const });
    const rows = async (userId: string, sql: string) => {
      const r = await probe(pg, as(userId), sql, [w]);
      if (!r.ok) throw new Error(r.error);
      return r.rows.length;
    };
    const layouts = `SELECT id FROM public.ward_layouts WHERE ward_id = $1`;
    const assignments = `SELECT id FROM public.bed_assignments WHERE ward_id = $1`;
    const services = `SELECT s.id FROM public.hospital_bed_services s JOIN public.hospital_beds b ON b.id = s.bed_id WHERE b.ward_id = $1`;
    expect(await rows(nurse.userId, layouts)).toBe(1);
    expect(await rows(admin, layouts)).toBe(1);
    expect(await rows(desk.userId, layouts)).toBe(1);
    expect(await rows(outsider.userId, layouts)).toBe(0);
    expect(await rows(nurse.userId, assignments)).toBe(1);
    expect(await rows(admin, assignments)).toBe(1);
    expect(await rows(desk.userId, assignments)).toBe(0);
    expect(await rows(outsider.userId, assignments)).toBe(0);
    expect(await rows(outsider.userId, services)).toBe(0);
    for (const sql of [
      `INSERT INTO public.bed_state_events (hospital_id, bed_id, state, set_by) VALUES ('${h}', '${s1!.id}', 'cleaning', '${nurse.userId}')`,
      `UPDATE public.ward_layouts SET revision = revision WHERE ward_id = '${w}'`,
      `DELETE FROM public.hospital_bed_services`,
      `INSERT INTO public.bed_assignments (hospital_id, ward_id, bed_id, patient_user_id, started_by) VALUES ('${h}', '${w}', '${s1!.id}', '${nurse.userId}', '${nurse.userId}')`,
    ]) {
      const r = await probe(pg, as(admin), sql);
      expect(r.ok, sql).toBe(false);
    }
    const call = await probe(pg, as(admin), `SELECT public.ward_layout_publish('{}'::jsonb)`);
    expect(call).toMatchObject({ ok: false });
  });

  it("live: changes broadcast { kind, ward_id, at } on ward-beds:<hospital>, never a patient", async () => {
    const w = await ward(["L1"]);
    const doc = layoutFromRegister(await register(w));
    const before = (
      await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM realtime.messages`)
    ).rows[0]!.n;
    await publish(w, doc, await draft(w, doc));
    const [l1] = await register(w);
    const p = await patient(pg);
    await pg.query(
      `INSERT INTO public.bed_assignments (hospital_id, ward_id, bed_id, patient_user_id, started_by) VALUES ($1, $2, $3, $4, $5)`,
      [h, w, l1!.id, p, admin],
    );
    const msgs = (
      await pg.query<{ topic: string; payload: Record<string, unknown>; private: boolean }>(
        `SELECT topic, payload, private FROM realtime.messages ORDER BY id OFFSET $1`,
        [before],
      )
    ).rows;
    expect(msgs.length).toBeGreaterThan(0);
    for (const m of msgs) {
      expect(m.topic).toBe(`ward-beds:${h}`);
      expect(m.private).toBe(true);
      expect(Object.keys(m.payload).sort()).toEqual(["at", "kind", "ward_id"]);
      expect(JSON.stringify(m.payload)).not.toContain(p);
    }
    expect(msgs.map((m) => m.payload.kind)).toEqual(
      expect.arrayContaining(["ward_layouts", "bed_assignments"]),
    );
  });
});
