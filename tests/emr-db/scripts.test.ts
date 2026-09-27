/**
 * The EMR owner scripts (runbook §4, §8, §9) on the PGlite lane: each script's core driven with the
 * lane database. Dry runs write nothing, apply writes the expected rows, a second apply adds
 * nothing; a re-encrypted draft reads back identical through lib/ncd/draft.ts, and an encrypted
 * allergy version reads its text with no legacy source. The CLIs are checked separately: `--help`
 * and the `--apply` guard both exit before any env or database is touched.
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Lane } from "./_pglite";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { allergies } from "@/db/schema/emr";
import { resolveAllergyTexts } from "@/lib/emr/read/allergies";
import { decrypt, encrypt, generateKey } from "@/lib/encryption";
import { DIABETES_CATALOG } from "@/lib/ncd/catalog/diabetes";
import { loadNcdDraft } from "@/lib/ncd/draft";
import {
  backfillAllergies,
  backfillSection,
  backfillStatements,
} from "@/scripts/emr/backfill-allergies";
import { encryptBackfilledAllergies, o5Key } from "@/scripts/emr/encrypt-backfilled-allergies";
import { legacyCounts, runbookQueries } from "@/scripts/emr/legacy-counts";
import { reencryptNcdDrafts } from "@/scripts/emr/reencrypt-ncd-drafts";
import {
  bootLane,
  clinician,
  department,
  hospital,
  laneOn,
  patient,
  readMigration,
} from "./_pglite";

const held = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", () => ({
  get db() {
    return held.db;
  },
}));

describe("EMR owner script CLIs (no database)", () => {
  const run = (script: string, ...args: string[]) =>
    spawnSync("npm", ["run", "-s", script, "--", ...args], {
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: "" },
    });

  it.each([
    "emr:legacy-counts",
    "emr:backfill-allergies",
    "emr:reencrypt-drafts",
    "emr:encrypt-allergy-text",
  ])("%s --help parses and exits 0", (script) => {
    const r = run(script, "--help");
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/runbook §\d/);
  });

  it("--apply without an --actor is refused before any connection", () => {
    const r = run("emr:encrypt-allergy-text", "--apply");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/--actor/);
    expect(r.stdout).not.toMatch(/Target database/);
  });

  it("the backfill is 0071's own section, verbatim, in five statements", () => {
    const m = readMigration("0071_emr_record_spine.sql");
    expect(m).toContain(backfillSection());
    expect(backfillSection()).toMatch(
      /^-- \(a\) patient_allergies[\s\S]*DROP TABLE _emr_resus_caps;$/,
    );
    expect(backfillStatements().map((s) => s.split(/\s+/).slice(0, 2).join(" "))).toEqual([
      "INSERT INTO",
      "CREATE TEMP",
      "INSERT INTO",
      "INSERT INTO",
      "DROP TABLE",
    ]);
  });

  it("legacy counts runs the two runbook §4 blocks", () => {
    const [always, after] = runbookQueries();
    expect(always).toMatch(/^-- O-4: legacy EMR rows/);
    expect(after).toMatch(/allergies backfilled, no v2 yet/);
  });
});

describe.skipIf(!laneOn)("EMR owner scripts (PGlite lane)", () => {
  let lane: Lane;
  let h: string;
  let nurse: string;
  let owner: string;

  const count = async (q: string, p: unknown[] = []) =>
    (await lane.pg.query<{ n: number }>(q, p)).rows[0]!.n;

  beforeAll(async () => {
    process.env.MEDSYNC_PHI_KEY ??= generateKey();
    process.env.ENCOUNTER_ENGINE_LIVE = "1";
    process.env.CLERKSHIP_DRAFTS_LIVE = "1";
    lane = await bootLane();
    held.db = lane.db;
    h = await hospital(lane.pg);
    const dept = await department(lane.pg, h);
    nurse = (await clinician(lane.pg, { hospitalId: h, departmentId: dept, cadre: "NURSE" }))
      .userId;
    owner = await patient(lane.pg); // any auth user: the owner running the script
  }, 180_000);

  it("legacy counts: read only, one row per runbook line, both blocks once 0071 is in", async () => {
    await lane.pg.query(
      `INSERT INTO public.clerkship_drafts (encounter_id, author_id, payload) VALUES ($1, $2, '{"x":1}')`,
      [randomUUID(), randomUUID()],
    );
    const rows = await legacyCounts(lane.db);
    const by = new Map(rows.map((r) => [r.tbl, r.count]));
    expect(by.get("clerkship_drafts (plaintext, O-5)")).toBeGreaterThanOrEqual(1);
    expect(by.has("patient_allergies")).toBe(true);
    expect(by.has("allergies backfilled, no v2 yet (O-5)")).toBe(true);
    expect(rows).toHaveLength(17);
    await lane.pg.exec(`DELETE FROM public.clerkship_drafts`);
  });

  it("re-encrypt drafts: dry run counts, apply in batches, re-run adds nothing, reads back identical", async () => {
    const [f1, f2] = DIABETES_CATALOG.features;
    const drafts = Array.from({ length: 3 }, (_, i) => ({
      encounterId: randomUUID(),
      authorId: randomUUID(),
      payload: {
        kind: "ncd_capture",
        catalogId: DIABETES_CATALOG.id,
        catalogVersion: DIABETES_CATALOG.version,
        values: {
          [f1!.code]: { state: "not_assessed" },
          [f2!.code]: { state: "recorded", value: `synthetic ${i}` },
        },
      },
    }));
    for (const d of drafts)
      await lane.pg.query(
        `INSERT INTO public.clerkship_drafts (encounter_id, author_id, payload) VALUES ($1, $2, $3::jsonb)`,
        [d.encounterId, d.authorId, JSON.stringify(d.payload)],
      );
    const already = encrypt(JSON.stringify(drafts[0]!.payload));
    await lane.pg.query(
      `INSERT INTO public.clerkship_drafts (encounter_id, author_id, payload) VALUES ($1, $2, $3::jsonb)`,
      [randomUUID(), randomUUID(), JSON.stringify({ enc: already })],
    );
    const snapshot = async () =>
      (
        await lane.pg.query(
          `SELECT id, payload, updated_at FROM public.clerkship_drafts ORDER BY id`,
        )
      ).rows;

    const before = await snapshot();
    expect(await reencryptNcdDrafts(lane.db, { apply: false })).toEqual({
      plaintext: 3,
      encrypted: 0,
    });
    expect(await snapshot()).toEqual(before);

    expect(await reencryptNcdDrafts(lane.db, { apply: true, actor: owner, batchSize: 2 })).toEqual({
      plaintext: 3,
      encrypted: 3,
    });
    expect(
      await count(
        `SELECT count(*)::int AS n FROM public.clerkship_drafts WHERE NOT (payload ? 'enc')`,
      ),
    ).toBe(0);
    // The pre-encrypted row is untouched, and no save time moved.
    const after = await snapshot();
    expect(after.map((r) => r.updated_at)).toEqual(before.map((r) => r.updated_at));
    expect(after.some((r) => (r.payload as { enc: string }).enc === already)).toBe(true);

    expect(await reencryptNcdDrafts(lane.db, { apply: true, actor: owner })).toEqual({
      plaintext: 0,
      encrypted: 0,
    });
    for (const d of drafts)
      expect(await loadNcdDraft(d.encounterId, d.authorId, DIABETES_CATALOG)).toEqual(
        d.payload.values,
      );
  });

  // Shared by the backfill and encrypt tests below, in order.
  let pa: string;
  let events: string;
  let nkdaPatient: string;

  it("backfill: dry run reports what it would copy and writes nothing; apply copies once", async () => {
    const p = await patient(lane.pg);
    pa = (
      await lane.pg.query<{ id: string }>(
        `INSERT INTO public.patient_allergies (hospital_id, patient_user_id, substance, recorded_by_user_id)
         VALUES ($1, $2, 'Synthetic substance A', $3) RETURNING id`,
        [h, p, nurse],
      )
    ).rows[0]!.id;
    const episode = async (patientId: string) =>
      (
        await lane.pg.query<{ id: string }>(
          `INSERT INTO public.resus_episodes (hospital_id, patient_user_id, trigger_kind, state, opened_by_user_id)
           VALUES ($1, $2, 'triage_red', 'concluded', $3) RETURNING id`,
          [h, patientId, nurse],
        )
      ).rows[0]!.id;
    const capture = async (episodeId: string, substances: string[], nkda: boolean) =>
      (
        await lane.pg.query<{ id: string }>(
          `INSERT INTO public.resus_timeline_events (episode_id, kind, recorded_by_user_id, payload)
           VALUES ($1, 'note', $2, $3::jsonb) RETURNING id`,
          [episodeId, nurse, JSON.stringify({ allergyCapture: { substances, nkda } })],
        )
      ).rows[0]!.id;
    events = await capture(await episode(p), ["Synthetic B", "Synthetic C"], false);
    nkdaPatient = await patient(lane.pg);
    await capture(await episode(nkdaPatient), [], true);

    const total = () =>
      count(
        `SELECT ((SELECT count(*) FROM public.allergies) + (SELECT count(*) FROM public.allergy_status_assertions)
                 + (SELECT count(*) FROM public.audit_log))::int AS n`,
      );
    const t0 = await total();
    expect(await backfillAllergies(lane.db, { apply: false })).toEqual({
      allergies: 3,
      nkdaAssertions: 1,
    });
    expect(await total()).toBe(t0);

    expect(await backfillAllergies(lane.db, { apply: true, actor: owner })).toEqual({
      allergies: 3,
      nkdaAssertions: 1,
    });
    expect(
      await count(
        `SELECT count(*)::int AS n FROM public.audit_log WHERE table_name = 'allergies' AND actor_id = $1`,
        [owner],
      ),
    ).toBe(3);
    expect(await backfillAllergies(lane.db, { apply: true, actor: owner })).toEqual({
      allergies: 0,
      nkdaAssertions: 0,
    });
  });

  it("encrypt allergy text: next version with ciphertext, carried columns, idempotent, gone source skipped", async () => {
    // A clinician's status change on one backfilled item: the text must land on ITS successor.
    const [changed] = (
      await lane.pg.query<{ id: string }>(
        `SELECT id FROM public.allergies WHERE legacy_ref->>'id' = $1 AND legacy_ref->>'index' = '1'`,
        [events],
      )
    ).rows;
    const v2 = (
      await lane.pg.query<{ id: string }>(
        `INSERT INTO public.allergies (logical_id, version, supersedes_id, hospital_id, patient_user_id, effective_at,
           recorded_by_user_id, source, trust, informant, legacy_ref, clinical_status)
         SELECT logical_id, 2, id, hospital_id, patient_user_id, effective_at, $2, source, trust, informant, legacy_ref,
                'inactive'
           FROM public.allergies WHERE id = $1 RETURNING id`,
        [changed!.id, nurse],
      )
    ).rows[0]!.id;
    // A backfilled row whose source is gone.
    const orphan = (
      await lane.pg.query<{ id: string }>(
        `WITH n AS (SELECT gen_random_uuid() AS id)
         INSERT INTO public.allergies (id, logical_id, hospital_id, patient_user_id, effective_at, source, trust,
           informant, legacy_ref)
         SELECT n.id, n.id, $1, $2, now(), 'clinician', 3, 'record',
                jsonb_build_object('table', 'patient_allergies', 'id', gen_random_uuid()) FROM n RETURNING id`,
        [h, nkdaPatient],
      )
    ).rows[0]!.id;

    const rowCount = () => count(`SELECT count(*)::int AS n FROM public.allergies`);
    const n0 = await rowCount();
    expect(await encryptBackfilledAllergies(lane.db, { apply: false })).toEqual({
      candidates: 4,
      encrypted: 3,
      missingSource: 1,
    });
    expect(await rowCount()).toBe(n0);
    await expect(encryptBackfilledAllergies(lane.db, { apply: true })).rejects.toThrow(/actor/);

    expect(
      await encryptBackfilledAllergies(lane.db, { apply: true, actor: owner, batchSize: 2 }),
    ).toEqual({ candidates: 4, encrypted: 3, missingSource: 1 });
    expect(await rowCount()).toBe(n0 + 3);
    expect(await encryptBackfilledAllergies(lane.db, { apply: true, actor: owner })).toEqual({
      candidates: 1,
      encrypted: 0,
      missingSource: 1,
    });
    expect(await rowCount()).toBe(n0 + 3);

    const successor = async (id: string) =>
      (await lane.db.select().from(allergies).where(eq(allergies.supersedesId, id)))[0]!;
    const onV2 = await successor(v2);
    expect(onV2).toMatchObject({
      version: 3,
      clinicalStatus: "inactive",
      recordedByUserId: owner,
      clientKey: o5Key(v2),
      hospitalId: h,
    });
    expect(decrypt(onV2.substanceTextCiphertext!)).toBe("Synthetic C");
    expect(
      await lane.db.select().from(allergies).where(eq(allergies.supersedesId, orphan)),
    ).toHaveLength(0);
    expect(
      await count(
        `SELECT count(*)::int AS n FROM public.audit_log WHERE table_name = 'allergies' AND actor_id = $1
           AND record_id = $2`,
        [owner, onV2.id],
      ),
    ).toBe(1);

    // The new version reads its own text: no source table, no definer path.
    const v1 = (
      await lane.pg.query<{ id: string }>(
        `SELECT id FROM public.allergies WHERE legacy_ref->>'id' = $1 AND version = 1`,
        [pa],
      )
    ).rows[0]!.id;
    const [fromPa] = await lane.db
      .select()
      .from(allergies)
      .where(eq(allergies.clientKey, o5Key(v1)));
    const [resolved] = await resolveAllergyTexts(
      lane.db,
      [{ ...fromPa!, legacyRef: null }],
      "owner",
    );
    expect(resolved!.substanceText).toBe("Synthetic substance A");
  });
});
