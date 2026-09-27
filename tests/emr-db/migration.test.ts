/**
 * 0071 on a real Postgres (PGlite lane): replay, the immutability guards, the observation guard's
 * legacy exception, the backfill (and that it touches no existing row), and the *_current views.
 * Runs only with EMR_PGLITE=1 (see _pglite.ts).
 */
import type { Lane, Pg, RecordIds } from "./_pglite";
import { beforeAll, describe, expect, it } from "vitest";

import {
  authUser,
  bootEmpty,
  bootLane,
  clinician,
  department,
  encounter,
  hospital,
  laneOn,
  migrate,
  patient,
  readMigration,
  seedRecord,
  seedRegistries,
} from "./_pglite";

const BOOT_MS = 180_000;
const INSERT_ONLY = [
  "clinical_note_events",
  "encounter_order_events",
  "specimens",
  "specimen_events",
  "diagnostic_reports",
  "conditions",
  "medication_statements",
  "pregnancy_episodes",
  "procedures",
  "allergies",
  "allergy_status_assertions",
  "result_acknowledgements",
  "critical_result_communications",
] as const;

/** Run `sql` as the owner and roll back; resolve to the error message, or null when it succeeded. */
async function attempt(pg: Pg, sql: string, params?: unknown[]): Promise<string | null> {
  try {
    await pg.transaction(async (tx) => {
      await tx.query(sql, params);
      await tx.rollback();
    });
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

async function rows<T = Record<string, unknown>>(pg: Pg, sql: string, params?: unknown[]) {
  return (await pg.query<T>(sql, params)).rows;
}

describe.skipIf(!laneOn)("0071 on the PGlite lane", () => {
  let lane: Lane;
  let ids: RecordIds;
  let ctx: { h: string; p: string; e: string; author: string };

  beforeAll(async () => {
    lane = await bootLane();
    const { pg } = lane;
    const h = await hospital(pg);
    const d = await department(pg, h);
    const author = await clinician(pg, { hospitalId: h, departmentId: d });
    const p = await patient(pg);
    const e = await encounter(pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: author.userId,
    });
    await seedRegistries(pg, h);
    ids = await seedRecord(pg, {
      hospitalId: h,
      patientUserId: p,
      encounterId: e,
      authorId: author.userId,
      authorAffiliationId: author.affiliationId,
    });
    ctx = { h, p, e, author: author.userId };
  }, BOOT_MS);

  it("replays every migration, 0071 included", () => {
    expect(lane.applied).toContain("0071_emr_record_spine.sql");
    expect(lane.applied.length).toBeGreaterThanOrEqual(72);
  });

  it("0071 re-runs over itself without error (idempotent-safe)", async () => {
    await lane.pg.exec(readMigration("0071_emr_record_spine.sql"));
  });

  it.each(INSERT_ONLY)("%s refuses UPDATE and DELETE", async (table) => {
    const id = ids[table][0];
    expect(
      await attempt(lane.pg, `UPDATE public.${table} SET id = id WHERE id = $1`, [id]),
    ).toMatch(/append-only/);
    expect(await attempt(lane.pg, `DELETE FROM public.${table} WHERE id = $1`, [id])).toMatch(
      /append-only/,
    );
  });

  it("clinical_notes: a draft updates, its identity does not, and signing is the last mutation", async () => {
    const { pg } = lane;
    const note = ids.clinical_notes[0];
    expect(
      await attempt(
        pg,
        `UPDATE public.clinical_notes SET content_ciphertext = 'a:b:c', revision = revision + 1 WHERE id = $1`,
        [note],
      ),
    ).toBeNull();
    expect(
      await attempt(pg, `UPDATE public.clinical_notes SET patient_user_id = $2 WHERE id = $1`, [
        note,
        ctx.author,
      ]),
    ).toMatch(/identity columns/);
    expect(await attempt(pg, `DELETE FROM public.clinical_notes WHERE id = $1`, [note])).toMatch(
      /DELETE of a draft note refused/,
    );

    // Sign a second draft for real, then every further change is refused.
    const signed = (
      await rows<{ id: string }>(
        pg,
        `INSERT INTO public.clinical_notes (hospital_id, patient_user_id, encounter_id, note_type, template_id, template_version,
           author_user_id, author_cadre, content_ciphertext, effective_at)
         VALUES ($1, $2, $3, 'progress', 'lane', '1', $4, 'MEDICAL_OFFICER', 'iv:tag:ct', now()) RETURNING id`,
        [ctx.h, ctx.p, ctx.e, ctx.author],
      )
    )[0]!.id;
    await pg.query(
      `UPDATE public.clinical_notes SET state = 'signed', signed_at = now(), content_hmac = 'h', hmac_key_id = 'v1' WHERE id = $1`,
      [signed],
    );
    expect(
      await attempt(
        pg,
        `UPDATE public.clinical_notes SET content_ciphertext = 'x:y:z' WHERE id = $1`,
        [signed],
      ),
    ).toMatch(/UPDATE of a signed note refused/);
    expect(await attempt(pg, `DELETE FROM public.clinical_notes WHERE id = $1`, [signed])).toMatch(
      /signed note refused/,
    );
    // The signed shape is all-or-nothing.
    expect(
      await attempt(pg, `UPDATE public.clinical_notes SET state = 'signed' WHERE id = $1`, [note]),
    ).toMatch(/clinical_notes_signed_shape/);
  });

  it("clinical_observations: CFC rows immutable; legacy rows allow only active → corrected; CFC rows stay out of legacy reads", async () => {
    const { pg } = lane;
    const cfc = ids.clinical_observations[0];
    expect(
      await attempt(
        pg,
        `UPDATE public.clinical_observations SET status = 'amended' WHERE id = $1`,
        [cfc],
      ),
    ).toMatch(/CFC rows are insert-only/);
    expect(
      await attempt(pg, `DELETE FROM public.clinical_observations WHERE id = $1`, [cfc]),
    ).toMatch(/DELETE refused/);

    const legacy = async () =>
      (
        await rows<{ id: string }>(
          pg,
          `INSERT INTO public.clinical_observations (hospital_id, patient_user_id, recorded_by_user_id, observation_kind, numeric_value_1, unit)
           VALUES ($1, $2, $3, 'hr', 88, 'bpm') RETURNING id`,
          [ctx.h, ctx.p, ctx.author],
        )
      )[0]!.id;
    const a = await legacy();
    const b = await legacy();
    // resus retractMirror: active → corrected with the pointer, nothing else.
    expect(
      await attempt(
        pg,
        `UPDATE public.clinical_observations SET state = 'corrected', corrected_by_observation_id = $2 WHERE id = $1`,
        [a, b],
      ),
    ).toBeNull();
    expect(
      await attempt(
        pg,
        `UPDATE public.clinical_observations SET numeric_value_1 = 90 WHERE id = $1`,
        [a],
      ),
    ).toMatch(/only active → corrected/);
    expect(
      await attempt(
        pg,
        `UPDATE public.clinical_observations SET state = 'corrected', notes = 'edited' WHERE id = $1`,
        [a],
      ),
    ).toMatch(/only active → corrected/);
    expect(
      await attempt(pg, `DELETE FROM public.clinical_observations WHERE id = $1`, [a]),
    ).toMatch(/DELETE refused/);
    // A legacy-shaped row cannot pose as a fact.
    expect(
      await attempt(
        pg,
        `INSERT INTO public.clinical_observations (hospital_id, patient_user_id, recorded_by_user_id, observation_kind, state)
         VALUES ($1, $2, $3, 'fact', 'fact')`,
        [ctx.h, ctx.p, ctx.author],
      ),
    ).toMatch(/obs_fact_tagging/);
    // The three legacy readers filter state = 'active' (worklist, NCD vitals, nurse page).
    const legacyRead = await rows<{ id: string }>(
      pg,
      `SELECT id FROM public.clinical_observations WHERE patient_user_id = $1 AND state = 'active'`,
      [ctx.p],
    );
    expect(legacyRead.map((r) => r.id).sort()).toEqual([a, b].sort());
    expect(legacyRead.map((r) => r.id)).not.toContain(cfc);
  });

  it("encounter_orders: events orders immutable, legacy orders keep the /lab status update", async () => {
    const [events, legacy = ""] = ids.encounter_orders;
    expect(
      await attempt(
        lane.pg,
        `UPDATE public.encounter_orders SET status = 'collected' WHERE id = $1`,
        [events],
      ),
    ).toMatch(/events-lifecycle orders are immutable/);
    expect(
      await attempt(
        lane.pg,
        `UPDATE public.encounter_orders SET status = 'collected' WHERE id = $1`,
        [legacy],
      ),
    ).toBeNull();
    expect(
      await attempt(
        lane.pg,
        `UPDATE public.encounter_orders SET lifecycle = 'events' WHERE id = $1`,
        [legacy],
      ),
    ).toMatch(/cannot become an events order/);
  });

  describe("*_current views", () => {
    const FACT_VIEWS = [
      ["conditions", "conditions_current"],
      ["medication_statements", "medication_statements_current"],
      ["allergies", "allergies_current"],
      ["clinical_observations", "clinical_observations_current"],
    ] as const;

    it.each(FACT_VIEWS)(
      "%s → newest version only; an entered-in-error version replaces the live one",
      async (table, view) => {
        const { pg } = lane;
        const v1 = ids[table][0];
        // Version n+1 = a copy of version n with the chain columns moved on.
        const next = async (prev: string, status: string, extra: string) =>
          (
            await rows<{ id: string }>(
              pg,
              `INSERT INTO public.${table}
             SELECT (jsonb_populate_record(NULL::public.${table},
                       to_jsonb(t) || jsonb_build_object('id', gen_random_uuid(), 'version', t.version + 1,
                         'supersedes_id', t.id, 'status', $2::text, 'client_key', NULL) || $3::jsonb)).*
             FROM public.${table} t WHERE t.id = $1 RETURNING id`,
              [prev, status, extra],
            )
          )[0]!.id;
        const reason =
          table === "clinical_observations"
            ? `{"note_ciphertext":"iv:tag:ct"}`
            : `{"reason_code":"lane"}`;
        const v2 = await next(v1, "amended", "{}");
        const current = async () =>
          (
            await rows<{ id: string; status: string }>(
              pg,
              `SELECT id, status FROM public.${view} WHERE logical_id = $1`,
              [v1],
            )
          ).map((r) => `${r.id === v2 ? "v2" : r.id === v1 ? "v1" : "v3"}:${r.status}`);
        expect(await current()).toEqual(["v2:amended"]);
        await next(v2, "entered_in_error", reason);
        // Per 0071 §12: "current" is the newest version, any status — the voided item surfaces as
        // entered_in_error (struck through in the chart; the loader drops it), never as its old live version.
        expect(await current()).toEqual(["v3:entered_in_error"]);
      },
    );

    it("clinical_notes_current derives draft → signed → awaiting co-sign → co-signed → entered in error", async () => {
      const { pg } = lane;
      const note = (
        await rows<{ id: string }>(
          pg,
          `INSERT INTO public.clinical_notes (hospital_id, patient_user_id, encounter_id, note_type, template_id, template_version,
             author_user_id, author_cadre, content_ciphertext, effective_at)
           VALUES ($1, $2, $3, 'ward_round', 'lane', '1', $4, 'INTERN_DOCTOR', 'iv:tag:ct', now()) RETURNING id`,
          [ctx.h, ctx.p, ctx.e, ctx.author],
        )
      )[0]!.id;
      const status = async () =>
        (
          await rows<{ status: string; addenda: number }>(
            pg,
            `SELECT status, addenda FROM public.clinical_notes_current WHERE id = $1`,
            [note],
          )
        )[0]!;
      expect((await status()).status).toBe("draft");
      await pg.query(
        `UPDATE public.clinical_notes SET state = 'signed', signed_at = now(), content_hmac = 'h', hmac_key_id = 'v1' WHERE id = $1`,
        [note],
      );
      expect((await status()).status).toBe("signed");
      const affiliation = (
        await rows<{ id: string }>(
          pg,
          `SELECT id FROM public.staff_affiliations WHERE user_id = $1`,
          [ctx.author],
        )
      )[0]!.id;
      const cosign = (
        await rows<{ id: string }>(
          pg,
          `INSERT INTO public.clinical_cosign_requests (hospital_id, patient_user_id, requested_by_user_id, requested_by_affiliation_id,
             requested_by_cadre_code, action_kind, action_payload, note_id)
           VALUES ($1, $2, $3, $4, 'INTERN_DOCTOR', 'sign_note', '{}'::jsonb, $5) RETURNING id`,
          [ctx.h, ctx.p, ctx.author, affiliation, note],
        )
      )[0]!.id;
      const event = (kind: string, extra = "NULL") =>
        pg.query(
          `INSERT INTO public.clinical_note_events (note_id, hospital_id, patient_user_id, kind, actor_user_id, actor_cadre,
             cosign_request_id, reason_code)
           VALUES ($1, $2, $3, $4, $5, 'MEDICAL_OFFICER', $6, ${extra})`,
          [note, ctx.h, ctx.p, kind, ctx.author, cosign],
        );
      await event("cosign_requested");
      expect((await status()).status).toBe("awaiting_cosign");
      await event("cosigned");
      expect((await status()).status).toBe("cosigned");
      await event("entered_in_error", "'wrong_patient'");
      expect((await status()).status).toBe("entered_in_error");
      // A sign_note co-sign must point at a note, and only a sign_note may.
      expect(
        await attempt(
          pg,
          `INSERT INTO public.clinical_cosign_requests (hospital_id, patient_user_id, requested_by_user_id, requested_by_affiliation_id,
             requested_by_cadre_code, action_kind, action_payload)
           VALUES ($1, $2, $3, $4, 'INTERN_DOCTOR', 'sign_note', '{}'::jsonb)`,
          [ctx.h, ctx.p, ctx.author, affiliation],
        ),
      ).toMatch(/cosign_note_link/);
    });
  });
});

/** A separate instance stopped at 0070, so the backfill meets real legacy rows. */
describe.skipIf(!laneOn)("0071 backfill over legacy rows", () => {
  let pg: Pg;
  const legacyHashes = new Map<string, { cols: string[]; hash: string }>();
  type Severity = "anaphylaxis" | "mild" | "unknown" | "null";
  let fx: { h: string; sevs: Record<Severity, string>; recorder: string; latestCapture: string };

  async function tableHash(table: string, cols: string[]): Promise<string> {
    const r = await pg.query<{ h: string }>(
      `SELECT md5(coalesce(string_agg(r, '|' ORDER BY r), '')) AS h FROM (
         SELECT (SELECT jsonb_object_agg(k, v) FROM jsonb_each(to_jsonb(t)) e(k, v) WHERE k = ANY($1))::text AS r
         FROM public."${table}" t) s`,
      [cols],
    );
    return r.rows[0]!.h;
  }

  beforeAll(async () => {
    pg = await bootEmpty();
    await migrate(pg, { upTo: "0070_zzz" });
    const h = await hospital(pg);
    const d = await department(pg, h);
    const recorder = (await clinician(pg, { hospitalId: h, departmentId: d })).userId;
    const p = await patient(pg);

    const sevs = {} as Record<Severity, string>;
    for (const severity of ["anaphylaxis", "mild", "unknown", null] as const) {
      const r = await pg.query<{ id: string }>(
        `INSERT INTO public.patient_allergies (hospital_id, patient_user_id, substance, severity, recorded_by_user_id)
         VALUES ($1, $2, 'Penicillin', $3, $4) RETURNING id`,
        [h, p, severity, recorder],
      );
      sevs[String(severity) as Severity] = r.rows[0]!.id;
    }

    const episode = async (patientId: string | null) =>
      (
        await pg.query<{ id: string }>(
          `INSERT INTO public.resus_episodes (hospital_id, patient_user_id, trigger_kind, state, started_at)
           VALUES ($1, $2, 'triage_red', 'active', now() - interval '1 hour') RETURNING id`,
          [h, patientId],
        )
      ).rows[0]!.id;
    const capture = async (
      ep: string,
      payload: unknown,
      minutesAgo: number,
      by: string | null = recorder,
    ) =>
      (
        await pg.query<{ id: string }>(
          `INSERT INTO public.resus_timeline_events (episode_id, kind, step, recorded_by_user_id, recorded_at, created_at, payload)
           VALUES ($1, 'note', 'pre', $2, now() - make_interval(mins => $3), now() - make_interval(mins => $3), $4::jsonb) RETURNING id`,
          [ep, by, minutesAgo, JSON.stringify(payload)],
        )
      ).rows[0]!.id;

    const epLatest = await episode(p);
    await capture(epLatest, { allergyCapture: { substances: ["Aspirin"], nkda: false } }, 30);
    const latestCapture = await capture(
      epLatest,
      { allergyCapture: { substances: ["Ceftriaxone", " ", "Sulfa"], nkda: false } },
      10,
    );
    await capture(await episode(p), { allergyCapture: { substances: [], nkda: true } }, 5);
    await capture(await episode(p), { allergyCapture: { substances: [], nkda: true } }, 5, null);
    const epSuperseded = await episode(p);
    const old = await capture(
      epSuperseded,
      { allergyCapture: { substances: ["Latex"], nkda: false } },
      20,
    );
    await pg.query(
      `INSERT INTO public.resus_timeline_events (episode_id, kind, step, recorded_by_user_id, payload, supersedes_event_id)
       VALUES ($1, 'note', 'pre', $2, '{}'::jsonb, $3)`,
      [epSuperseded, recorder, old],
    );
    const epUnknown = await episode(null);
    await capture(epUnknown, { allergyCapture: { substances: ["Morphine"], nkda: false } }, 5);
    await capture(
      await episode(p),
      { allergyCapture: { substances: "not-a-list", nkda: "yes" } },
      5,
    );

    fx = { h, sevs, recorder, latestCapture };

    const tables = await pg.query<{ table_name: string; cols: string[] }>(
      `SELECT table_name, array_agg(column_name::text) AS cols FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name IN
         (SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'audit_log')
       GROUP BY table_name`,
    );
    for (const t of tables.rows)
      legacyHashes.set(t.table_name, { cols: t.cols, hash: await tableHash(t.table_name, t.cols) });

    await migrate(pg, { from: "0071", upTo: "0071_zzz" });
  }, BOOT_MS);

  it("adds no row to, and changes no row in, any existing table (audit_log aside)", async () => {
    const changed: string[] = [];
    for (const [table, { cols, hash }] of legacyHashes) {
      if ((await tableHash(table, cols)) !== hash) changed.push(table);
    }
    expect(legacyHashes.size).toBeGreaterThan(100);
    expect(changed).toEqual([]);
  });

  async function counts() {
    const r = await pg.query<{ pa: number; resus: number; asa: number }>(
      `SELECT (SELECT count(*)::int FROM public.allergies WHERE legacy_ref->>'table' = 'patient_allergies') AS pa,
              (SELECT count(*)::int FROM public.allergies WHERE legacy_ref->>'table' = 'resus_timeline_events') AS resus,
              (SELECT count(*)::int FROM public.allergy_status_assertions WHERE legacy_ref IS NOT NULL) AS asa`,
    );
    return r.rows[0];
  }

  it("copies patient_allergies with the mapped severity and criticality", async () => {
    const r = await pg.query<{
      src: string;
      severity: string | null;
      criticality: string | null;
      manifestations: string[];
      informant: string;
    }>(
      `SELECT legacy_ref->>'id' AS src, severity, criticality, manifestations, informant
       FROM public.allergies WHERE legacy_ref->>'table' = 'patient_allergies'`,
    );
    const by = Object.fromEntries(r.rows.map((x) => [x.src, x]));
    expect(by[fx.sevs.anaphylaxis]).toMatchObject({
      severity: "severe",
      criticality: "high",
      manifestations: ["anaphylaxis"],
      informant: "record",
    });
    expect(by[fx.sevs.mild]).toMatchObject({
      severity: "mild",
      criticality: null,
      manifestations: [],
    });
    expect(by[fx.sevs.unknown]).toMatchObject({ severity: null });
    expect(by[fx.sevs.null]).toMatchObject({ severity: null });
  });

  it("copies the latest resus capture per episode, NKDA as an assertion, and skips what it cannot attribute", async () => {
    const allergies = await pg.query<{ id: string; idx: string }>(
      `SELECT legacy_ref->>'id' AS id, legacy_ref->>'index' AS idx
       FROM public.allergies WHERE legacy_ref->>'table' = 'resus_timeline_events' ORDER BY idx`,
    );
    // Latest capture only; the blank entry (index 1) is dropped, indexes keep their source position.
    expect(allergies.rows.map((r) => [r.id, r.idx])).toEqual([
      [fx.latestCapture, "0"],
      [fx.latestCapture, "2"],
    ]);
    const asa = await pg.query<{ asserted_by_user_id: string; source: string }>(
      `SELECT asserted_by_user_id, source FROM public.allergy_status_assertions WHERE legacy_ref IS NOT NULL`,
    );
    // One NKDA: the one with a named recorder. Superseded, unknown-patient and malformed captures add nothing.
    expect(asa.rows).toEqual([
      { asserted_by_user_id: fx.recorder, source: "resus_ample_migration" },
    ]);
    expect(await counts()).toEqual({ pa: 4, resus: 2, asa: 1 });
  });

  it("is re-runnable: a second 0071 adds nothing", async () => {
    const before = await counts();
    await pg.exec(readMigration("0071_emr_record_spine.sql"));
    expect(await counts()).toEqual(before);
    // An author-less allergy row is only possible with provenance.
    const p = await authUser(pg, "p");
    expect(
      await attempt(
        pg,
        `INSERT INTO public.allergies (logical_id, hospital_id, patient_user_id, effective_at, source, trust, substance_code,
           substance_kind, informant)
         VALUES (gen_random_uuid(), $1, $2, now(), 'clinician', 3, 'penicillin', 'drug_ingredient', 'patient')`,
        [fx.h, p],
      ),
    ).toMatch(/allergies_version_chain|allergies_author/);
  });
});
