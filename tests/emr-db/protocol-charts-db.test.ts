/**
 * Protocol charts, the database rules of 0283 (prescribing kit P4; P1 [DB], P3 [DB]) on the PGlite
 * lane: a chart starts only from a signed version unless the transaction is marked for local
 * development; chart events can never be updated or deleted (a mistake is a reversal, once, with a
 * reason); one running chart per patient and protocol; a chart is never deleted. Runs only with
 * EMR_PGLITE=1.
 */
import type { Lane } from "./_pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { bootLane, clinician, department, hospital, laneOn, patient } from "./_pglite";

describe.skipIf(!laneOn)("protocol charts: database rules (PGlite lane)", () => {
  let lane: Lane;
  let h: string;
  let user: string;
  let p: string;
  let versionId: string;

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await lane.pg.query<T>(sql, params)).rows;
  const draftStart = (on: boolean) =>
    q(`SELECT set_config('medsync.protocol_draft_start', $1, false)`, [on ? "on" : ""]);
  const chart = () =>
    q<{ id: string }>(
      `INSERT INTO public.protocol_charts (hospital_id, patient_user_id, protocol_id, protocol_version_id,
         started_by_user_id) VALUES ($1, $2, 'dka', $3, $4) RETURNING id`,
      [h, p, versionId, user],
    );
  const event = (chartId: string, type = "mark", extra = "") =>
    q<{ id: string }>(
      `INSERT INTO public.protocol_chart_events (chart_id, hospital_id, patient_user_id, protocol_version_id,
         type, payload, actor_user_id, actor_role, actor_cadre${extra ? ", reverses_id, reason" : ""})
       VALUES ($1, $2, $3, $4, $5, '{"key":"hdu"}', $6, 'dr', 'MEDICAL_OFFICER'${extra ? `, ${extra}` : ""})
       RETURNING id`,
      [chartId, h, p, versionId, type, user],
    );

  beforeAll(async () => {
    lane = await bootLane();
    h = await hospital(lane.pg);
    const dept = await department(lane.pg, h);
    user = (
      await clinician(lane.pg, { hospitalId: h, departmentId: dept, cadre: "MEDICAL_OFFICER" })
    ).userId;
    p = await patient(lane.pg);
    versionId = (
      await q<{ id: string }>(
        `SELECT id FROM public.protocol_versions WHERE protocol_id = 'dka' AND hospital_id IS NULL`,
      )
    )[0]!.id;
  }, 180_000);

  it("the DKA seed carries its named numbers, still a draft", async () => {
    const [v] = await q<{ status: string; seed: { kHoldUnder: number; bags: unknown[] } }>(
      `SELECT status, seed FROM public.protocol_versions WHERE id = $1`,
      [versionId],
    );
    expect(v!.status).toBe("draft");
    expect(v!.seed.kHoldUnder).toBe(3.3);
    expect(v!.seed.bags).toHaveLength(6);
  });

  it("P1 [DB]: a draft version starts a chart only when the transaction is marked for local development", async () => {
    await draftStart(false);
    await expect(chart()).rejects.toThrow(/signed version/);
    await draftStart(true);
    const [c] = await chart();
    expect(c!.id).toBeTruthy();
    // One running chart per patient and protocol.
    await expect(chart()).rejects.toThrow(/protocol_charts_one_running|duplicate key/);
    await draftStart(false);
  });

  it("P3 [DB]: chart events are append-only; a reversal names one event, once, with a reason", async () => {
    await draftStart(true);
    const p2 = await patient(lane.pg);
    const prev = p;
    p = p2;
    const [c] = await chart();
    await draftStart(false);
    const [e] = await event(c!.id);
    await expect(
      q(`UPDATE public.protocol_chart_events SET payload = '{}' WHERE id = $1`, [e!.id]),
    ).rejects.toThrow(/append-only/);
    await expect(
      q(`DELETE FROM public.protocol_chart_events WHERE id = $1`, [e!.id]),
    ).rejects.toThrow(/append-only/);
    // A reversal needs a reason.
    await expect(event(c!.id, "reverse", `'${e!.id}', ''`)).rejects.toThrow(/reverse_shape/);
    await event(c!.id, "reverse", `'${e!.id}', 'Wrong patient'`);
    await expect(event(c!.id, "reverse", `'${e!.id}', 'Again'`)).rejects.toThrow(
      /reversed_once|duplicate key/,
    );
    // A chart is never deleted, and keeps what it started with.
    await expect(q(`DELETE FROM public.protocol_charts WHERE id = $1`, [c!.id])).rejects.toThrow(
      /never deleted/,
    );
    await expect(
      q(`UPDATE public.protocol_charts SET started_at = now() - interval '1 day' WHERE id = $1`, [
        c!.id,
      ]),
    ).rejects.toThrow(/keeps what it started/);
    await q(
      `UPDATE public.protocol_charts SET ended_at = now(), end_reason = 'Resolved' WHERE id = $1`,
      [c!.id],
    );
    p = prev;
  });
});
