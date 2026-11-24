/**
 * Migration 0308 on the PGlite lane: the request response times are drafted (prefilled with D4), signed
 * by the hospital admin and then the CSO, and only then in force; placing a request sets due_at from
 * them, and with nothing signed due_at is null (ADR 0244 §1). Runs with EMR_PGLITE=1.
 */
import { randomUUID } from "node:crypto";
import type { Lane, Pg } from "./_pglite";
import type { PlanRequestLine } from "@/lib/clerking/plan/draft";
import type { EmrActor } from "@/lib/emr/actor";
import { beforeAll, describe, expect, it } from "vitest";

import { withPatientWrite } from "@/lib/emr/write/context";
import { placeRequests } from "@/lib/emr/write/requests";
import { generateKey } from "@/lib/encryption";
import { D4_DEFAULTS } from "@/lib/requests/escalation";
import { saveRequestTimesDraft, signedRequestTimes, signRequestTimes } from "@/lib/requests/times";
import { bootLane, clinician, department, encounter, hospital, laneOn, patient } from "./_pglite";

const NOW = new Date("2026-11-24T08:00:00Z");
const SOURCE = "fixture: D4 defaults, invented for tests";

describe.skipIf(!laneOn)("care request response times (0308)", () => {
  let lane: Lane;
  let pg: Pg;
  const tx = <T>(fn: (t: Parameters<Parameters<Lane["db"]["transaction"]>[0]>[0]) => Promise<T>) =>
    lane.db.transaction(fn);

  async function people(name: string) {
    const h = await hospital(pg, name);
    const d = await department(pg, h, "Medicine");
    const admin = (await clinician(pg, { hospitalId: h, departmentId: d })).userId;
    const cso = (await clinician(pg, { hospitalId: h, departmentId: d, cadre: "CONSULTANT" }))
      .userId;
    return { h, d, admin, cso };
  }

  const sign = (
    who: { userId: string; hospitalId: string; as: "admin" | "cso" },
    versionId: string,
    exceptionNote: string | null = null,
    at = NOW,
  ) => tx((t) => signRequestTimes(t, who, { versionId, exceptionNote }, at));

  beforeAll(async () => {
    process.env.MEDSYNC_PHI_KEY ??= generateKey();
    lane = await bootLane();
    pg = lane.pg;
  }, 240_000);

  it("a draft prefilled with D4 is signed by the admin then the CSO", async () => {
    const { h, admin, cso } = await people("Times A");
    const v = await tx((t) =>
      saveRequestTimesDraft(
        t,
        { userId: admin, hospitalId: h },
        { ...D4_DEFAULTS, source: SOURCE },
      ),
    );
    expect(await tx((t) => signedRequestTimes(t, h))).toBeNull();
    await expect(sign({ userId: cso, hospitalId: h, as: "cso" }, v)).rejects.toThrow(
      /admin signs first/,
    );
    await sign({ userId: admin, hospitalId: h, as: "admin" }, v);
    expect(await tx((t) => signedRequestTimes(t, h))).toBeNull(); // not in force on one signature
    await sign({ userId: cso, hospitalId: h, as: "cso" }, v);
    expect(await tx((t) => signedRequestTimes(t, h))).toEqual(D4_DEFAULTS);
    // Out-of-range minutes are refused before anything is written.
    await expect(
      tx((t) =>
        saveRequestTimesDraft(
          t,
          { userId: admin, hospitalId: h },
          { ...D4_DEFAULTS, routineReplyMin: 2881, source: SOURCE },
        ),
      ),
    ).rejects.toThrow(/1 to 2880/);
  });

  it("one person signing both needs an exception note", async () => {
    const { h, admin } = await people("Times B");
    const v = await tx((t) =>
      saveRequestTimesDraft(
        t,
        { userId: admin, hospitalId: h },
        { ...D4_DEFAULTS, source: SOURCE },
      ),
    );
    await sign({ userId: admin, hospitalId: h, as: "admin" }, v);
    await expect(sign({ userId: admin, hospitalId: h, as: "cso" }, v)).rejects.toThrow(
      /different person/,
    );
    // The table refuses it too, whatever the code does.
    await expect(
      pg.query(
        `UPDATE care_request_response_versions SET status = 'signed', cso_signed_by = $2, cso_signed_at = now()
          WHERE id = $1`,
        [v, admin],
      ),
    ).rejects.toThrow(/crrv_signed_by_two/);
    await sign(
      { userId: admin, hospitalId: h, as: "cso" },
      v,
      "Only one clinician here may sign; recorded.",
    );
    expect(await tx((t) => signedRequestTimes(t, h))).toEqual(D4_DEFAULTS);
  });

  it("a new signature supersedes the old", async () => {
    const { h, admin, cso } = await people("Times C");
    const v1 = await tx((t) =>
      saveRequestTimesDraft(
        t,
        { userId: admin, hospitalId: h },
        { ...D4_DEFAULTS, source: SOURCE },
      ),
    );
    await sign({ userId: admin, hospitalId: h, as: "admin" }, v1);
    await sign({ userId: cso, hospitalId: h, as: "cso" }, v1);
    const v2 = await tx((t) =>
      saveRequestTimesDraft(
        t,
        { userId: admin, hospitalId: h },
        { ...D4_DEFAULTS, reviewNowAcceptMin: 10, source: SOURCE },
      ),
    );
    expect(v2).not.toBe(v1); // a signature is never edited away
    await sign({ userId: admin, hospitalId: h, as: "admin" }, v2);
    expect((await tx((t) => signedRequestTimes(t, h)))?.reviewNowAcceptMin).toBe(15);
    await sign(
      { userId: cso, hospitalId: h, as: "cso" },
      v2,
      null,
      new Date(NOW.getTime() + 60_000),
    );
    expect((await tx((t) => signedRequestTimes(t, h)))?.reviewNowAcceptMin).toBe(10);
    expect(
      (
        await pg.query(
          `SELECT version, status FROM care_request_response_versions WHERE hospital_id = $1 ORDER BY version`,
          [h],
        )
      ).rows,
    ).toEqual([
      { version: 1, status: "superseded" },
      { version: 2, status: "signed" },
    ]);
    await expect(sign({ userId: cso, hospitalId: h, as: "cso" }, v2)).rejects.toThrow(
      /already signed/,
    );
  });

  it("placing with signed times sets due_at; without, it is null", async () => {
    const place = async (s: Awaited<ReturnType<typeof people>>) => {
      const me = await clinician(pg, { hospitalId: s.h, departmentId: s.d });
      await clinician(pg, { hospitalId: s.h, departmentId: s.d }); // a senior to route to
      const by: EmrActor = {
        userId: me.userId,
        affiliationId: me.affiliationId,
        fullName: null,
        hospitalId: s.h,
        departmentId: s.d,
        cadreCode: "MEDICAL_OFFICER",
        isClinical: true,
        surface: "doctor",
      };
      const p = await patient(pg);
      const enc = await encounter(pg, {
        hospitalId: s.h,
        patientUserId: p,
        clinicianUserId: me.userId,
        departmentId: s.d,
      });
      const line: PlanRequestLine = {
        clientKey: `req-${randomUUID()}`,
        kind: "review",
        targetDepartmentId: s.d,
        wardId: null,
        namedUserIds: [],
        urgency: "now",
        helpWanted: null,
        reasonConditionIds: [],
        question: "",
        phoned: null,
        display: "Request",
      };
      const [id] = await withPatientWrite(
        by,
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
      return (
        await pg.query<{ due_at: Date | null; requested_at: Date }>(
          `SELECT due_at, requested_at FROM care_requests WHERE id = $1`,
          [id],
        )
      ).rows[0]!;
    };

    const unsigned = await people("Times D");
    expect((await place(unsigned)).due_at).toBeNull();

    const signed = await people("Times E");
    const v = await tx((t) =>
      saveRequestTimesDraft(
        t,
        { userId: signed.admin, hospitalId: signed.h },
        { ...D4_DEFAULTS, source: SOURCE },
      ),
    );
    await sign({ userId: signed.admin, hospitalId: signed.h, as: "admin" }, v);
    await sign({ userId: signed.cso, hospitalId: signed.h, as: "cso" }, v);
    const row = await place(signed);
    expect(new Date(row.due_at!).getTime() - new Date(row.requested_at).getTime()).toBe(
      D4_DEFAULTS.reviewNowAcceptMin * 60_000,
    );
  });

  it("the lab heartbeats still take their sources, and care_requests is a new one", async () => {
    await pg.query(
      `INSERT INTO escalation_heartbeats (source) VALUES ('scheduler'), ('lazy'), ('care_requests')`,
    );
    await expect(
      pg.query(`INSERT INTO escalation_heartbeats (source) VALUES ('other')`),
    ).rejects.toThrow(/escalation_heartbeats_source_check/);
  });
});
