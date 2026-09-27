/**
 * The access matrix for 0071 (gate-a-proposal §F.3) on the PGlite lane: every new EMR table, view
 * and registry (and the reader policies on the evolved legacy tables) × ten actors × SELECT /
 * INSERT / UPDATE / DELETE, through medsync_clinical_reader (set_config identity, as lib/emr/db.ts)
 * and through authenticated/anon (JWT claim, as PostgREST). Plus direct probes of
 * private.patient_access_basis per basis, its set-form equivalence, and lib/emr/{db,access}.
 *
 * Expected: reads only with a basis at the reader's hospital (allergies across hospitals, STOP 1);
 * registries readable by any signed-in user; no client role writes anything.
 */
import type { Actor, Lane, Pg, RecordIds, RecordKey } from "./_pglite";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { allergies, clinicalNotes, clinicalPhiAccessLog } from "@/db/schema";
import { logChartAccess, resolveEmrAccess } from "@/lib/emr/access";
import { asClinicalReader, asClinicalWriter } from "@/lib/emr/db";
import {
  appointmentFixture,
  bootLane,
  breakGlass,
  clinician,
  department,
  encounter,
  hospital,
  intake,
  laneOn,
  nursingAssignment,
  patient,
  probe,
  reception,
  seedRecord,
  seedRegistries,
  staff,
  superadmin,
} from "./_pglite";

const CLINICAL = [
  "clinical_notes",
  "clinical_note_events",
  "conditions",
  "medication_statements",
  "pregnancy_episodes",
  "procedures",
  "allergies",
  "allergy_status_assertions",
  "encounter_order_events",
  "specimens",
  "specimen_events",
  "diagnostic_reports",
  "result_acknowledgements",
  "critical_result_communications",
];
const VIEWS = [
  "clinical_observations_current",
  "conditions_current",
  "medication_statements_current",
  "allergies_current",
  "clinical_notes_current",
];
const REGISTRIES = [
  "clinical_concepts",
  "drug_class_tags",
  "capabilities",
  "facility_capabilities",
  "devices",
  "test_catalogue",
  "diagnosis_terms",
];
/** Legacy tables 0071 gives a reader policy; their authenticated policies are 0028–0040's, untouched. */
const EVOLVED = [
  "encounters",
  "clinical_observations",
  "triage_records",
  "clinical_cosign_requests",
  "problem_list",
  "encounter_orders",
  "encounter_diagnoses",
  "encounter_results",
];
/** STOP 1: readable with a basis at the reader's own hospital, wherever the row was recorded. */
const CROSS_HOSPITAL = new Set(["allergies", "allergy_status_assertions", "allergies_current"]);

const OPS = ["select", "insert", "update", "delete"] as const;
type Op = (typeof OPS)[number];
type Path = "reader" | "client";

type ActorSpec = {
  key: string;
  userId: string | null;
  hospitalId: string;
  /** The patient whose H1 record this actor is probed against. */
  patientKey: "P1" | "P2" | "P3" | "P4";
  read: "all" | "cross_hospital_only" | "none";
  anon?: boolean;
};

const DENIED_WRITE = /permission denied|cannot (insert into|update|delete from) view/;

describe.skipIf(!laneOn)("EMR access matrix (PGlite lane)", () => {
  let lane: Lane;
  let pg: Pg;
  let world: {
    H1: string;
    H2: string;
    P: Record<"P1" | "P2" | "P3" | "P4", string>;
    records: Record<"P1" | "P2" | "P3" | "P4", RecordIds>;
    actors: ActorSpec[];
    u: Record<
      | "author"
      | "activeClin"
      | "nurse"
      | "intakeClin"
      | "deptClin"
      | "noBasis"
      | "otherHosp"
      | "recep"
      | "glass",
      string
    >;
    extraPatients: string[];
  };

  beforeAll(async () => {
    lane = await bootLane();
    pg = lane.pg;
    const H1 = await hospital(pg, "H1");
    const H2 = await hospital(pg, "H2");
    const D1 = await department(pg, H1, "Recent");
    const D2 = await department(pg, H1, "General");
    const D3 = await department(pg, H2, "Other");
    await seedRegistries(pg, H1);

    const author = await clinician(pg, { hospitalId: H1, departmentId: D2 });
    const activeClin = await clinician(pg, { hospitalId: H1, departmentId: D2 });
    const nurse = await clinician(pg, { hospitalId: H1, departmentId: D2, cadre: "NURSE" });
    const intakeClin = await clinician(pg, {
      hospitalId: H1,
      departmentId: D2,
      cadre: "CLINICAL_OFFICER",
    });
    const deptClin = await clinician(pg, { hospitalId: H1, departmentId: D1 });
    const noBasis = await clinician(pg, { hospitalId: H1, departmentId: D2 });
    const otherHosp = await clinician(pg, { hospitalId: H2, departmentId: D3 });
    const recep = await reception(pg, { hospitalId: H1, departmentId: D2 });
    const glass = await superadmin(pg);
    const P = {
      P1: await patient(pg),
      P2: await patient(pg),
      P3: await patient(pg),
      P4: await patient(pg),
    };

    // One basis each. Record encounters carry no department, so they create no department basis.
    const e1 = await encounter(pg, {
      hospitalId: H1,
      patientUserId: P.P1,
      clinicianUserId: activeClin.userId,
    });
    await nursingAssignment(pg, {
      hospitalId: H1,
      departmentId: D2,
      nurseUserId: nurse.userId,
      patientUserId: P.P2,
    });
    await intake(pg, { hospitalId: H1, patientUserId: P.P3 });
    const e4 = await encounter(pg, {
      hospitalId: H1,
      patientUserId: P.P4,
      clinicianUserId: author.userId,
      departmentId: D1,
      state: "completed",
      startedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    });
    await breakGlass(pg, { actorId: glass, patientId: P.P1, hospitalId: H1 });
    // The other-hospital clinician holds a real basis for P1 — at H2.
    await encounter(pg, { hospitalId: H2, patientUserId: P.P1, clinicianUserId: otherHosp.userId });

    const done = (p: string) =>
      encounter(pg, {
        hospitalId: H1,
        patientUserId: p,
        clinicianUserId: author.userId,
        state: "completed",
      });
    const rec = (p: string, e: string) =>
      seedRecord(pg, {
        hospitalId: H1,
        patientUserId: p,
        encounterId: e,
        authorId: author.userId,
        authorAffiliationId: author.affiliationId,
      });
    const records = {
      P1: await rec(P.P1, e1),
      P2: await rec(P.P2, await done(P.P2)),
      P3: await rec(P.P3, await done(P.P3)),
      P4: await rec(P.P4, e4),
    };

    const actors: ActorSpec[] = [
      {
        key: "clinician·active_encounter",
        userId: activeClin.userId,
        hospitalId: H1,
        patientKey: "P1",
        read: "all",
      },
      {
        key: "nurse·assigned",
        userId: nurse.userId,
        hospitalId: H1,
        patientKey: "P2",
        read: "all",
      },
      {
        key: "clinician·open_intake",
        userId: intakeClin.userId,
        hospitalId: H1,
        patientKey: "P3",
        read: "all",
      },
      {
        key: "clinician·department_recent",
        userId: deptClin.userId,
        hospitalId: H1,
        patientKey: "P4",
        read: "all",
      },
      {
        key: "clinician·no_basis",
        userId: noBasis.userId,
        hospitalId: H1,
        patientKey: "P1",
        read: "none",
      },
      {
        key: "other_hospital_clinician",
        userId: otherHosp.userId,
        hospitalId: H2,
        patientKey: "P1",
        read: "cross_hospital_only",
      },
      {
        key: "reception·patient_present",
        userId: recep.userId,
        hospitalId: H1,
        patientKey: "P3",
        read: "none",
      },
      { key: "anon", userId: null, hospitalId: H1, patientKey: "P1", read: "none", anon: true },
      { key: "patient·self", userId: P.P1, hospitalId: H1, patientKey: "P1", read: "none" },
      { key: "break_glass", userId: glass, hospitalId: H1, patientKey: "P1", read: "all" },
    ];
    world = {
      H1,
      H2,
      P,
      records,
      actors,
      u: {
        author: author.userId,
        activeClin: activeClin.userId,
        nurse: nurse.userId,
        intakeClin: intakeClin.userId,
        deptClin: deptClin.userId,
        noBasis: noBasis.userId,
        otherHosp: otherHosp.userId,
        recep: recep.userId,
        glass,
      },
      extraPatients: [],
    };
  }, 180_000);

  function actorFor(a: ActorSpec, path: Path): Actor {
    if (path === "reader")
      return { userId: a.userId, role: "medsync_clinical_reader", hospitalId: a.hospitalId };
    return { userId: a.userId, role: a.anon ? "anon" : "authenticated" };
  }

  function expectedRead(object: string, a: ActorSpec, path: Path): boolean {
    if (REGISTRIES.includes(object)) return path === "reader" || !a.anon;
    if (path === "client") return false;
    if (a.read === "all") return true;
    return a.read === "cross_hospital_only" && CROSS_HOSPITAL.has(object);
  }

  async function run(
    object: string,
    paths: Path[],
  ): Promise<{ probes: number; mismatches: string[] }> {
    const mismatches: string[] = [];
    let probes = 0;
    for (const a of world.actors) {
      for (const path of paths) {
        const actor = actorFor(a, path);
        for (const op of OPS) {
          probes++;
          const label = `${object} · ${a.key} · ${path} · ${op}`;
          if (op === "select") {
            const ids = REGISTRIES.includes(object)
              ? null
              : world.records[a.patientKey][object as RecordKey];
            const r = ids
              ? await probe(
                  pg,
                  actor,
                  `SELECT count(*)::int AS n FROM public.${object} WHERE id = ANY($1::uuid[])`,
                  [ids],
                )
              : await probe(pg, actor, `SELECT count(*)::int AS n FROM public.${object}`);
            const n = r.ok ? Number(r.rows[0]!.n) : 0;
            const readAll = ids ? n === ids.length : n > 0;
            const want = expectedRead(object, a, path);
            if (want !== readAll || (!want && n > 0)) {
              mismatches.push(
                `${label}: expected ${want ? "read" : "nothing"}, got ${r.ok ? `${n} rows` : r.error}`,
              );
            }
          } else {
            const statement: Record<Exclude<Op, "select">, string> = {
              insert: `INSERT INTO public.${object} DEFAULT VALUES`,
              update: `UPDATE public.${object} SET id = id`,
              delete: `DELETE FROM public.${object}`,
            };
            const r = await probe(pg, actor, statement[op]);
            if (r.ok || !DENIED_WRITE.test(r.error)) {
              mismatches.push(
                `${label}: expected denied, got ${r.ok ? `${r.affected} rows affected` : r.error}`,
              );
            }
          }
        }
      }
    }
    return { probes, mismatches };
  }

  let total = 0;
  const NEW_OBJECTS = [...CLINICAL, ...VIEWS, ...REGISTRIES];

  it.each(NEW_OBJECTS)("%s: reads need a basis, no client writes (both paths)", async (object) => {
    const { probes, mismatches } = await run(object, ["reader", "client"]);
    total += probes;
    expect(mismatches).toEqual([]);
  });

  it.each(EVOLVED)(
    "%s: the reader policy needs a basis at this hospital; the reader writes nothing",
    async (object) => {
      const { probes, mismatches } = await run(object, ["reader"]);
      total += probes;
      expect(mismatches).toEqual([]);
    },
  );

  it("covers the whole matrix", () => {
    const expected = NEW_OBJECTS.length * 10 * OPS.length * 2 + EVOLVED.length * 10 * OPS.length;
    // eslint-disable-next-line no-console -- the brief asks for the matrix size in the run output
    console.log(
      `EMR RLS matrix: ${total} probes = (${NEW_OBJECTS.length} new objects × 10 actors × 4 ops × 2 paths) + ` +
        `(${EVOLVED.length} evolved tables × 10 actors × 4 ops × reader path)`,
    );
    expect(total).toBe(expected);
  });

  it("identity cannot be half-asserted: a JWT without GUCs, or a spoofed hospital, reads nothing", async () => {
    const notes = world.records.P1.clinical_notes;
    const jwtOnly = await pg.transaction(async (tx) => {
      await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [world.u.activeClin]);
      await tx.exec(`SET LOCAL ROLE medsync_clinical_reader`);
      const r = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM public.clinical_notes WHERE id = ANY($1::uuid[])`,
        [notes],
      );
      await tx.rollback();
      return r.rows[0]!.n;
    });
    expect(jwtOnly).toBe(0);
    const spoof = await probe(
      pg,
      { userId: world.u.otherHosp, role: "medsync_clinical_reader", hospitalId: world.H1 },
      `SELECT count(*)::int AS n FROM public.clinical_notes WHERE id = ANY($1::uuid[])`,
      [notes],
    );
    expect(spoof).toMatchObject({ ok: true, rows: [{ n: 0 }] });
  });

  it("a patient reads no CFC observation row of their own through the client key", async () => {
    const { P, H1 } = world;
    const r = await probe(
      pg,
      { userId: P.P1, role: "authenticated", hospitalId: H1 },
      `SELECT count(*)::int AS n FROM public.clinical_observations
        WHERE patient_user_id = $1 AND concept_id IS NOT NULL`,
      [P.P1],
    );
    expect(r).toMatchObject({ ok: true, rows: [{ n: 0 }] });
  });

  it("a patient reads their standard order but not a restricted one through the client key", async () => {
    const { P, H1 } = world;
    const [standard] = world.records.P1.encounter_orders;
    // Events orders are immutable, so the restricted twin is a new row copied from the standard one.
    const restricted = (
      await pg.query<{ id: string }>(
        `INSERT INTO public.encounter_orders (encounter_id, patient_user_id, kind, text, authored_by_user_id, lifecycle,
           hospital_id, priority, performer, intent_source, requester_cadre, effective_at, reason_text_ciphertext, sensitivity)
         SELECT encounter_id, patient_user_id, kind, 'Restricted test', authored_by_user_id, lifecycle, hospital_id,
           priority, performer, intent_source, requester_cadre, effective_at, reason_text_ciphertext, 'restricted'
           FROM public.encounter_orders WHERE id = $1 RETURNING id`,
        [standard],
      )
    ).rows[0]!.id;
    const read = (id: string) =>
      probe(
        pg,
        { userId: P.P1, role: "authenticated", hospitalId: H1 },
        `SELECT count(*)::int AS n FROM public.encounter_orders WHERE id = $1`,
        [id],
      );
    expect(await read(standard)).toMatchObject({ ok: true, rows: [{ n: 1 }] });
    expect(await read(restricted)).toMatchObject({ ok: true, rows: [{ n: 0 }] });
  });

  describe("private.patient_access_basis", () => {
    const basis = async (user: string, patientId: string, hospitalId: string) =>
      (
        await pg.query<{ b: string | null }>(
          `SELECT private.patient_access_basis($1, $2, $3) AS b`,
          [user, patientId, hospitalId],
        )
      ).rows[0]!.b;

    it("returns each basis for its holder, strongest first, and null otherwise", async () => {
      const { u, P, H1, H2 } = world;
      expect(await basis(u.activeClin, P.P1, H1)).toBe("active_encounter");
      expect(await basis(u.nurse, P.P2, H1)).toBe("assigned");
      expect(await basis(u.intakeClin, P.P3, H1)).toBe("open_intake");
      expect(await basis(u.deptClin, P.P4, H1)).toBe("department_recent");
      expect(await basis(u.glass, P.P1, H1)).toBe("break_glass");
      expect(await basis(u.otherHosp, P.P1, H2)).toBe("active_encounter");
      expect(await basis(u.otherHosp, P.P1, H1)).toBeNull();
      expect(await basis(u.noBasis, P.P1, H1)).toBeNull();
      expect(await basis(u.recep, P.P3, H1)).toBeNull();
      expect(await basis(P.P1, P.P1, H1)).toBeNull();
      // Everyone clinical at H1 sees a patient present today; the in-progress encounter still wins.
      expect(await basis(u.noBasis, P.P3, H1)).toBe("open_intake");
      await intake(pg, { hospitalId: H1, patientUserId: P.P1 });
      expect(await basis(u.activeClin, P.P1, H1)).toBe("active_encounter");
    });

    it("stale or ineligible grounds give nothing", async () => {
      const { H1 } = world;
      const D = await department(pg, H1, "Edge");
      const p = await patient(pg);
      world.extraPatients.push(p);
      const suspended = await staff(pg, { hospitalId: H1, departmentId: D, state: "suspended" });
      await encounter(pg, { hospitalId: H1, patientUserId: p, clinicianUserId: suspended.userId });
      expect(await basis(suspended.userId, p, H1)).toBeNull();

      const receptionist = await reception(pg, { hospitalId: H1, departmentId: D });
      await encounter(pg, {
        hospitalId: H1,
        patientUserId: p,
        clinicianUserId: receptionist.userId,
      });
      expect(await basis(receptionist.userId, p, H1)).toBeNull();

      const exNurse = await clinician(pg, { hospitalId: H1, departmentId: D, cadre: "NURSE" });
      await nursingAssignment(pg, {
        hospitalId: H1,
        departmentId: D,
        nurseUserId: exNurse.userId,
        patientUserId: p,
        ended: true,
      });
      expect(await basis(exNurse.userId, p, H1)).toBeNull();

      const q = await patient(pg);
      world.extraPatients.push(q);
      const someone = await clinician(pg, { hospitalId: H1, departmentId: D });
      await intake(pg, {
        hospitalId: H1,
        patientUserId: q,
        arrivedAt: new Date(Date.now() - 36 * 3_600_000).toISOString(),
      });
      await intake(pg, { hospitalId: H1, patientUserId: q, status: "completed" });
      expect(await basis(someone.userId, q, H1)).toBeNull();

      await encounter(pg, {
        hospitalId: H1,
        patientUserId: q,
        clinicianUserId: world.u.author,
        departmentId: D,
        state: "completed",
        startedAt: new Date(Date.now() - 31 * 86_400_000).toISOString(),
      });
      expect(await basis(someone.userId, q, H1)).toBeNull();
      await appointmentFixture(pg, {
        hospitalId: H1,
        departmentId: D,
        patientUserId: q,
        clinicianUserId: world.u.author,
      });
      expect(await basis(someone.userId, q, H1)).toBe("department_recent");

      const admin = await superadmin(pg);
      await breakGlass(pg, { actorId: admin, patientId: q, hospitalId: H1, expired: true });
      expect(await basis(admin, q, H1)).toBeNull();
      await breakGlass(pg, { actorId: admin, patientId: q, hospitalId: null });
      expect(await basis(admin, q, H1)).toBe("break_glass");
    });

    it("equals its set form: basis(u,p,h) IS NOT NULL ⟺ p ∈ accessible_patient_ids() as (u,h)", async () => {
      const users = [...Object.values(world.u), ...Object.values(world.P)];
      const patients = [...Object.values(world.P), ...world.extraPatients];
      let pairs = 0;
      const drift: string[] = [];
      for (const user of users) {
        for (const h of [world.H1, world.H2]) {
          const set = await probe(
            pg,
            { userId: user, role: "medsync_clinical_reader", hospitalId: h },
            `SELECT array_agg(x)::text[] AS ids FROM private.accessible_patient_ids() x`,
          );
          const accessible = new Set<string>(
            set.ok ? ((set.rows[0]!.ids as string[] | null) ?? []) : [],
          );
          for (const p of patients) {
            pairs++;
            const one = (await basis(user, p, h)) !== null;
            if (one !== accessible.has(p))
              drift.push(`${user} ${p} ${h}: basis ${one}, set ${accessible.has(p)}`);
          }
        }
      }
      // eslint-disable-next-line no-console
      console.log(
        `patient_access_basis ⟺ accessible_patient_ids: ${pairs} (user, patient, hospital) triples`,
      );
      expect(drift).toEqual([]);
    });
  });

  describe("lib/emr/db + access on the lane", () => {
    it("asClinicalReader returns rows only where the rule allows", async () => {
      const read = (userId: string) =>
        asClinicalReader(
          { userId, hospitalId: world.H1 },
          (tx) =>
            tx
              .select({ id: clinicalNotes.id })
              .from(clinicalNotes)
              .where(eq(clinicalNotes.patientUserId, world.P.P1)),
          lane.db,
        );
      expect(await read(world.u.activeClin)).toHaveLength(1);
      // (An earlier probe put P1 in the building today, so every clinical H1 user now has open_intake.)
      expect(await read(world.u.recep)).toHaveLength(0);
      expect(await read(world.u.otherHosp)).toHaveLength(0);
    });

    it("asClinicalWriter: resolveEmrAccess gives the basis, logChartAccess logs it, audit rows carry the author", async () => {
      const scope = { userId: world.u.nurse, hospitalId: world.H1 };
      const allergyId = await asClinicalWriter(
        scope,
        async (tx) => {
          const access = await resolveEmrAccess(tx, {
            userId: scope.userId,
            patientUserId: world.P.P2,
            hospitalId: world.H1,
          });
          expect(access).toEqual({ allowed: true, basis: "assigned" });
          const none = await resolveEmrAccess(tx, {
            userId: scope.userId,
            patientUserId: world.P.P4,
            hospitalId: world.H1,
          });
          expect(none).toEqual({ allowed: false, basis: null });
          await logChartAccess(tx, {
            ...scope,
            patientUserId: world.P.P2,
            basis: access.basis!,
            surface: "emr_chart",
          });
          const [row] = await tx
            .insert(allergies)
            .values({
              logicalId: "00000000-0000-4000-8000-000000000000",
              hospitalId: world.H1,
              patientUserId: world.P.P2,
              effectiveAt: new Date(),
              recordedByUserId: scope.userId,
              source: "clinician",
              trust: 2,
              substanceKind: "drug_ingredient",
              substanceCode: "amoxicillin",
              informant: "patient",
            })
            .returning({ id: allergies.id });
          return row!.id;
        },
        lane.db,
      );
      const logged = await lane.db
        .select({ basis: clinicalPhiAccessLog.accessBasis })
        .from(clinicalPhiAccessLog)
        .where(
          and(
            eq(clinicalPhiAccessLog.clinicianUserId, world.u.nurse),
            eq(clinicalPhiAccessLog.patientUserId, world.P.P2),
          ),
        );
      expect(logged).toEqual([{ basis: "assigned" }]);
      const audit = await pg.query<{ actor_id: string }>(
        `SELECT actor_id FROM public.audit_log WHERE table_name = 'allergies' AND record_id = $1`,
        [allergyId],
      );
      expect(audit.rows).toEqual([{ actor_id: world.u.nurse }]);
    });
  });
});
