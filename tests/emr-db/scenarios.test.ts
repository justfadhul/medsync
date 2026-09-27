/**
 * PROMPT §11 Phase 4 scenarios A1–A9 (HARMONISATION §2 [H]: scripted integration tests, no
 * Playwright) over the real write functions on the PGlite lane, with the pure engines reading what
 * they wrote, and an audit-completeness count at the end. Every "signed" reference here is a
 * TEST-ONLY fixture proving a mechanism, never a clinical value. Runs only with EMR_PGLITE=1.
 */
import { randomUUID } from "node:crypto";
import type { Lane } from "./_pglite";
import type { EmrActor } from "@/lib/emr/actor";
import type { ChartInput, ChartNoteEventInput, ChartResultInput } from "@/lib/emr/chart";
import type { EmrTx } from "@/lib/emr/db";
import type { NoteContent } from "@/lib/emr/notes";
import type { CriticalRef } from "@/lib/emr/reference/critical";
import type { IdsrClasses } from "@/lib/emr/reference/idsr";
import type { ActionResult, WriteCtx } from "@/lib/emr/write/context";
import type { RefEntry } from "@/lib/resus/reference/ref";
import type { FlowEncounter } from "@/lib/workspace/flow";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  clinicalNoteEvents,
  clinicalNotes,
  diagnosticReports,
  resultAcknowledgements,
} from "@/db/schema/emr";
import { encounterOrders } from "@/db/schema/encounter";
import { triageRecords } from "@/db/schema/triage";
import { triagePrefill } from "@/lib/emr/carry-forward";
import { buildChartPayload } from "@/lib/emr/chart";
import { asClinicalWriter } from "@/lib/emr/db";
import { deriveOrderStatus } from "@/lib/emr/orders";
import { loadAllergyInput } from "@/lib/emr/read/allergies";
import { loadDeskFor } from "@/lib/emr/read/desk";
import { CRITICAL_REFS, REF_CRIT_TIMEFRAME } from "@/lib/emr/reference/critical";
import { REF_IDSR_CLASSES } from "@/lib/emr/reference/idsr";
import { ackState, escalationState } from "@/lib/emr/results";
import { bannerText, createWriteQueue, guardUnload } from "@/lib/emr/sync/queue";
import { actionError, withPatientWrite } from "@/lib/emr/write/context";
import { planAdministrativeClosure, planCompletion } from "@/lib/emr/write/encounter";
import { IPC_PROMPT, recordAllergy, recordEncounterDiagnosis } from "@/lib/emr/write/facts";
import { consumeResusHandoff } from "@/lib/emr/write/handoff";
import { acceptSuggestedOrder, dismissSuggestedOrder } from "@/lib/emr/write/intents";
import * as notes from "@/lib/emr/write/notes";
import { loadOrderRecords, placeOrders } from "@/lib/emr/write/orders";
import {
  acknowledgeResults,
  enterResults,
  recordCriticalCommunication,
} from "@/lib/emr/write/results";
import { collectSpecimen, receiveSpecimen } from "@/lib/emr/write/specimens";
import { decrypt, encrypt, generateKey } from "@/lib/encryption";
import { loadFactSnapshot } from "@/lib/facts/loader";
import { recordedAllergiesFromTimeline } from "@/lib/prescribing/administration";
import { allergyRecheck, mergeAllergyLists } from "@/lib/prescribing/allergy-merge";
import { EMERGENCY_DRUGS } from "@/lib/prescribing/reference/emergency-drug-catalog";
import { computeFlow } from "@/lib/workspace/flow";
import { input as flowInput, identity } from "../workspace/fixtures";
import {
  bootLane,
  department,
  encounter,
  hospital,
  intake,
  laneOn,
  patient,
  staff,
} from "./_pglite";

// The app modules driven for real (the resus AMPLE action, the lane loader) read the app's db; the
// lane hands them its own. Identity is the only other stub.
const held = vi.hoisted(() => ({
  db: undefined as unknown,
  pg: undefined as unknown,
  resusScope: undefined as unknown,
}));
vi.mock("@/db", () => ({
  get db() {
    return held.db;
  },
}));
vi.mock("@/lib/resus/scope", () => ({ requireResusScope: async () => held.resusScope }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
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
// The v1 resus desk appends through the Supabase service client: the lane stands in for it.
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        const run = async () => {
          if (table !== "resus_timeline_events") return { data: null, error: null };
          const keys = Object.keys(row);
          const vals = keys.map((k) =>
            row[k] !== null && typeof row[k] === "object" ? JSON.stringify(row[k]) : row[k],
          );
          const r = await (
            held.pg as { query: (s: string, p: unknown[]) => Promise<{ rows: { id: string }[] }> }
          ).query(
            `INSERT INTO public.${table} (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
            vals,
          );
          return { data: r.rows[0] ?? null, error: null };
        };
        return {
          select: () => ({ single: run }),
          then: (f: (v: unknown) => unknown) => run().then(f),
        };
      },
    }),
  }),
}));
vi.mock("@/lib/scheduling/patient-identity", () => ({
  revealPatientIdentities: vi.fn(async () => new Map()),
}));
const { loadEmrTasks } = await import("@/lib/workspace/queries");

const HMAC_KEY = Buffer.alloc(32, 5).toString("base64");
const GLUCOSE_FASTING = "79a7098d-6585-5bff-ab14-3a4a09b3bf68";
const MALARIA_RDT = "461e61e7-1f95-589b-a8e4-87e9e007d16e";
const GLUCOSE_RANDOM = "c2ba5229-00b1-5233-96b9-7c2a730e4400";
const MALARIA_UNCOMPLICATED = "08c91b1d-8305-53ef-9ccd-6c829c87aae5";
const key = () => `k-${randomUUID()}`;
const drug = (k: string) => EMERGENCY_DRUGS.find((d) => d.drugKey === k)!;

/** TEST-ONLY signed entries: the numbers are fixtures, never a clinical limit or time frame. */
const TEST_CRIT: CriticalRef[] = [
  {
    ...CRITICAL_REFS.find((r) => r.conceptId === "obs.glucose" && r.operator === ">")!,
    id: "REF-CRIT-TEST",
    status: "signed",
    value: "5",
  },
];
const TEST_TIMEFRAME: RefEntry = { ...REF_CRIT_TIMEFRAME, status: "signed", value: "1" };
const TEST_IDSR: RefEntry & { data: IdsrClasses } = {
  ...REF_IDSR_CLASSES,
  status: "signed",
  data: {
    classes: [
      {
        id: "test.class",
        label: "Test class",
        immediatelyReportable: true,
        actionText: "TEST action text",
      },
    ],
    map: { [MALARIA_UNCOMPLICATED]: "test.class" },
  },
};

const CLERKING: NoteContent = {
  sections: {
    s01: { items: [{ kind: "complaint_token", token: "sx.polyuria", durationDays: 14 }] },
    s13: { items: [{ kind: "diagnosis_deferred", reason: "Awaiting glucose" }] },
    s14: { items: [{ kind: "plan_statement", text: "Review with results" }] },
  },
};

describe.skipIf(!laneOn)("Phase 4 scenarios A1–A9 (PGlite lane)", () => {
  let lane: Lane;
  let h: string;
  let dept: string;
  let mo: EmrActor;
  let consultant: EmrActor;
  let intern: EmrActor;
  let nurse: EmrActor;
  let lab: EmrActor;
  let receptionist: EmrActor;
  let elsewhere: EmrActor;
  const patients: string[] = [];
  const savedHmac = process.env.MEDSYNC_NOTE_HMAC_KEY;

  const as = <T>(a: EmrActor, p: string, fn: (ctx: WriteCtx) => Promise<T>) =>
    withPatientWrite(a, p, fn, { database: lane.db });
  const code = (pr: Promise<unknown>) =>
    pr.then(
      () => "ok",
      (e: { code?: string }) => e.code ?? String(e),
    );
  const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    lane.pg.query<T>(sql, params).then((r) => r.rows);
  const snapshot = (p: string, manifest: string[]) =>
    asClinicalWriter(
      { userId: mo.userId, hospitalId: h },
      (tx) => loadFactSnapshot(tx as EmrTx, p, { manifest, purpose: "interactive" }),
      lane.db,
    );
  const chart = (over: Partial<ChartInput> & Pick<ChartInput, "snapshot">) =>
    buildChartPayload({
      patient: { name: "Test Patient", mrn: "MRN-TEST", ageYears: 40, sex: "female" },
      encounters: [],
      orders: [],
      results: [],
      notes: [],
      death: null,
      ...over,
    });

  async function actorOf(
    cadre: string,
    hospitalId = h,
    departmentId = dept,
    surface: EmrActor["surface"] = "doctor",
  ): Promise<EmrActor> {
    const s = await staff(lane.pg, { hospitalId, departmentId, cadre });
    return {
      userId: s.userId,
      fullName: null,
      hospitalId,
      departmentId,
      affiliationId: s.affiliationId,
      cadreCode: cadre,
      isClinical: cadre !== "RECEPTION",
      surface,
    };
  }

  /** A walk-in present today, with an in-progress encounter with the MO (the Edge start's row). */
  async function present(o: { p?: string; triageRecordId?: string; visitId?: string } = {}) {
    const p = o.p ?? (await patient(lane.pg));
    patients.push(p);
    const visit = o.visitId ?? (await intake(lane.pg, { hospitalId: h, patientUserId: p }));
    const enc = await encounter(lane.pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: mo.userId,
      departmentId: dept,
    });
    await lane.pg.query(
      `UPDATE public.encounters SET visit_id = $2, triage_record_id = $3 WHERE id = $1`,
      [enc, visit, o.triageRecordId ?? null],
    );
    return { p, enc, visit };
  }

  /** The update ha-complete-encounter makes with a planned body (write-encounter.test.ts). */
  async function applyAsEdge(body: Record<string, unknown>, callerId: string): Promise<void> {
    await lane.pg.query(
      `UPDATE public.encounters SET state = 'completed', ended_at = now(), completion_reason = $2, completed_by = $3,
         closure_kind = $4, disposition = $5, follow_up = $6::jsonb, closure_reason = $7, closure_note_ciphertext = $8
       WHERE id = $1 AND state = ANY($9::text[])`,
      [
        body.encounter_id,
        body.completion_reason,
        callerId,
        body.closure_kind,
        body.disposition === "died" ? "deceased" : (body.disposition ?? null),
        body.follow_up ? JSON.stringify(body.follow_up) : null,
        body.closure_reason ?? null,
        body.closure_note_ciphertext ?? null,
        body.closure_kind === "administrative" ? ["planned", "in_progress"] : ["in_progress"],
      ],
    );
  }

  /** The chart's view of one report chain: its current version's acknowledgement state. */
  async function chartResult(logicalId: string, critical: boolean): Promise<ChartResultInput> {
    const chain = await lane.db
      .select()
      .from(diagnosticReports)
      .where(eq(diagnosticReports.logicalId, logicalId));
    const ids = chain.map((c) => c.id);
    const acks = (await lane.db.select().from(resultAcknowledgements)).filter((a) =>
      ids.includes(a.reportId),
    );
    const cur = chain.sort((a, b) => b.version - a.version)[0]!;
    return {
      reportId: cur.id,
      display: "Glucose",
      issuedAt: cur.issuedAt,
      ack: ackState(chain, acks),
      critical,
      sensitivity: cur.sensitivity,
    };
  }

  beforeAll(async () => {
    process.env.MEDSYNC_PHI_KEY ??= generateKey();
    process.env.MEDSYNC_NOTE_HMAC_KEY = HMAC_KEY;
    lane = await bootLane();
    held.db = lane.db;
    held.pg = lane.pg;
    h = await hospital(lane.pg);
    dept = await department(lane.pg, h);
    const labDept = await department(lane.pg, h, "Laboratory");
    const h2 = await hospital(lane.pg, "Elsewhere");
    mo = await actorOf("MEDICAL_OFFICER");
    consultant = await actorOf("CONSULTANT");
    intern = await actorOf("INTERN_DOCTOR");
    nurse = await actorOf("NURSE", h, dept, "nurse");
    lab = await actorOf("LAB_TECH", h, labDept, "lab");
    receptionist = await actorOf("RECEPTION");
    elsewhere = await actorOf("MEDICAL_OFFICER", h2, await department(lane.pg, h2));
  }, 180_000);

  afterAll(() => {
    vi.unstubAllEnvs();
    if (savedHmac === undefined) delete process.env.MEDSYNC_NOTE_HMAC_KEY;
    else process.env.MEDSYNC_NOTE_HMAC_KEY = savedHmac;
  });

  it("A1 walk-in → triage → start → prefill → diagnosis + mRDT → fasting chip → result → ack → home", async () => {
    const p0 = await patient(lane.pg);
    const visit = await intake(lane.pg, { hospitalId: h, patientUserId: p0 });
    await lane.pg.query(
      `UPDATE public.patient_intakes SET presenting_complaint = 'Fever for three days' WHERE id = $1`,
      [visit],
    );
    const [t] = await q<{ id: string }>(
      `INSERT INTO public.triage_records (hospital_id, patient_user_id, intake_id, ruleset, vitals_snapshot,
         computed_level, computed_breakdown, assigned_level)
       VALUES ($1, $2, $3, 'adult_news2', '{"pulse": 96, "temperature": 38.4}'::jsonb, 3,
               '{"firedDiscriminators": [{"code": "fever", "label": "Fever"}]}'::jsonb, 3) RETURNING id`,
      [h, p0, visit],
    );
    // Take & start (the Edge function's insert): one encounter on the visit, linked to triage.
    const { p, enc } = await present({ p: p0, triageRecordId: t!.id, visitId: visit });

    // Prefill: acuity, complaint and discriminators from triage; vitals shown from the record.
    const [tr] = await lane.db.select().from(triageRecords).where(eq(triageRecords.id, t!.id));
    const pre = triagePrefill(tr!, "Fever for three days");
    expect(pre).toMatchObject({
      acuity: { level: 3, source: { kind: "triage", triageRecordId: t!.id } },
      complaint: { text: "Fever for three days" },
      discriminators: [{ code: "fever", label: "Fever" }],
      vitals: { mode: "shown_from_record", triageRecordId: t!.id },
    });
    const vit = await snapshot(p, ["obs.heart_rate"]);
    expect(vit.facts.map((f) => [f.concept, f.source])).toEqual([["obs.heart_rate", "poc_staff"]]);

    const draft = await as(mo, p, (ctx) =>
      notes.saveNoteDraft(ctx, {
        patientUserId: p,
        encounterId: enc,
        templateId: "tpl.clerking.adult_opd",
        content: CLERKING,
        clientKey: key(),
      }),
    );
    const dx = await as(mo, p, (ctx) =>
      recordEncounterDiagnosis(ctx, {
        patientUserId: p,
        encounterId: enc,
        termId: MALARIA_UNCOMPLICATED,
        verification: "provisional",
        clientKey: key(),
      }),
    );
    expect(dx.notifiable).toBeUndefined(); // REF-IDSR-CLASSES is pending: no sheet on a guess
    const placed = await as(mo, p, (ctx) =>
      placeOrders(ctx, {
        patientUserId: p,
        encounterId: enc,
        orders: [
          { clientKey: key(), testId: MALARIA_RDT, priority: "routine", reasonText: "Fever" },
          { clientKey: key(), testId: GLUCOSE_FASTING, priority: "routine", reasonText: "Screen" },
        ],
      }),
    );
    const [rdtOrder, glucoseOrder] = placed.orderIds;
    const collect = (orderId: string, fasting?: "fasting") =>
      as(nurse, p, (ctx) =>
        collectSpecimen(ctx, {
          patientUserId: p,
          orderId,
          identifiersConfirmed: true,
          ...(fasting ? { fastingState: fasting, fastingHours: 9 } : {}),
          clientKey: key(),
        }),
      );
    // The fasting chip: a fasting test is not collected without the state.
    expect(await code(collect(glucoseOrder!))).toBe("invalid");
    const gs = await collect(glucoseOrder!, "fasting");
    expect((await q(`SELECT fasting_state FROM specimens WHERE id = $1`, [gs.id]))[0]).toEqual({
      fasting_state: "fasting",
    });
    await collect(rdtOrder!);

    // Bedside mRDT entered by the nurse (point of care), acknowledged by the MO.
    const r = await as(nurse, p, (ctx) =>
      enterResults(ctx, {
        patientUserId: p,
        orderId: rdtOrder!,
        status: "final",
        values: [{ conceptId: "obs.malaria_test", code: "positive" }],
        clientKey: key(),
      }),
    );
    await as(mo, p, (ctx) =>
      acknowledgeResults(ctx, {
        patientUserId: p,
        items: [{ reportId: r.id, action: "acted" }],
        clientKey: key(),
      }),
    );
    const snap = await snapshot(p, ["obs.malaria_test"]);
    expect(snap.facts).toHaveLength(1);

    const plan = await as(mo, p, (ctx) =>
      planCompletion(ctx, { patientUserId: p, encounterId: enc, disposition: "home" }),
    );
    // Warnings are returned, never thrown: here only the unsigned clerking draft.
    expect(plan.warnings).toEqual([expect.stringMatching(/1 note is not signed/)]);
    expect(draft.id).toBeTruthy();
    await applyAsEdge(plan.body, mo.userId);
    expect(
      (await q(`SELECT state, disposition, closure_kind FROM encounters WHERE id = $1`, [enc]))[0],
    ).toEqual({ state: "completed", disposition: "home", closure_kind: "clinical" });
  });

  it("A2 an OPD allergy blocks the resus prescribe; a resus AMPLE allergy shows in the OPD safety bar", async () => {
    const { p, enc } = await present();
    await as(mo, p, (ctx) =>
      recordAllergy(ctx, {
        patientUserId: p,
        encounterId: enc,
        clientKey: key(),
        substance: { kind: "drug_ingredient", code: "amiodarone" },
        manifestations: ["rash"],
      }),
    );
    // The resus desk (any episode) reads the record, merged with its own captures.
    const resusList = mergeAllergyLists(
      recordedAllergiesFromTimeline([]),
      (await loadAllergyInput(lane.db, p)).allergies,
    );
    expect(allergyRecheck(drug("amiodarone"), resusList, undefined).refusal).toMatch(
      /Documented allergy/,
    );

    // Resus AMPLE (the real v2 action, EMR on): the capture writes through to the record.
    vi.stubEnv("ENCOUNTER_ENGINE_LIVE", "1");
    vi.stubEnv("EMR_V1", h);
    vi.stubEnv("SKIP_ENV_VALIDATION", "1"); // the action's import graph validates the app env
    const [ep] = await q<{ id: string }>(
      `INSERT INTO public.resus_episodes (hospital_id, department_id, patient_user_id, trigger_kind, state, opened_by_user_id)
       VALUES ($1, $2, $3, 'triage_red', 'active', $4) RETURNING id`,
      [h, dept, p, nurse.userId],
    );
    held.resusScope = {
      userId: nurse.userId,
      fullName: null,
      affiliationId: nurse.affiliationId,
      hospitalId: h,
      hospitalName: "Lane",
      departmentId: dept,
      departmentName: "Medicine",
      cadreCode: "NURSE",
      cadreName: "Nurse",
      roleName: "nurse",
      leaderRecommended: false,
    };
    const { recordStepFindingsV2 } = await import("@/app/nurse/resus/_v2/actions-survey");
    const r = await recordStepFindingsV2({
      episodeId: ep!.id,
      clientEventId: randomUUID(),
      step: "E",
      findings: { present: [], ample: { allergies: ["Lidocaine"] } },
    });
    expect(r).toMatchObject({ ok: true });
    vi.unstubAllEnvs();
    const ample = await q<{ legacy_ref: { table: string } }>(
      `SELECT legacy_ref FROM allergies WHERE patient_user_id = $1 AND legacy_ref IS NOT NULL`,
      [p],
    );
    expect(ample).toHaveLength(1);
    expect(ample[0]!.legacy_ref.table).toBe("resus_timeline_events");

    const bar = chart({ snapshot: await snapshot(p, ["allergy"]) }).safetyBar;
    expect(bar.allergy.state).toBe("listed");
    expect(bar.allergy.items.map((i) => i.byNameOnly).sort()).toEqual([false, true]);
    // The record names it; the loader passes no decrypted text to the snapshot yet (open item),
    // so the bar's words come from the reader until the chart route supplies them.
    expect((await loadAllergyInput(lane.db, p)).allergies).toEqual(
      expect.arrayContaining(["amiodarone", "Lidocaine"]),
    );
  });

  it("A2b the v1 desk's captures (prescribe dialog, exposure AMPLE) reach the record, with EMR off at this hospital", async () => {
    const { p } = await present();
    // EMR v1 is on only at another hospital: the allergy record crosses hospitals, so the resus
    // desk here still writes to it and reads it (STOP 1).
    vi.stubEnv("ENCOUNTER_ENGINE_LIVE", "1");
    vi.stubEnv("EMR_V1", randomUUID());
    vi.stubEnv("SKIP_ENV_VALIDATION", "1");
    const [ep] = await q<{ id: string }>(
      `INSERT INTO public.resus_episodes (hospital_id, department_id, patient_user_id, trigger_kind, state, opened_by_user_id)
       VALUES ($1, $2, $3, 'triage_red', 'active', $4) RETURNING id`,
      [h, dept, p, nurse.userId],
    );
    held.resusScope = {
      userId: nurse.userId,
      fullName: null,
      affiliationId: nurse.affiliationId,
      hospitalId: h,
      hospitalName: "Lane",
      departmentId: dept,
      departmentName: "Medicine",
      cadreCode: "NURSE",
      cadreName: "Nurse",
      roleName: "nurse",
      leaderRecommended: false,
    };
    const v1 = await import("@/app/nurse/resus/actions");
    expect(
      await v1.recordResusAllergies({ episodeId: ep!.id, substances: ["Penicillin"] }),
    ).toEqual({ ok: true });
    expect(
      await v1.recordExposureFindings({
        episodeId: ep!.id,
        findingSet: {
          state: null,
          present: [],
          coreTempC: null,
          ample: { allergies: ["Ceftriaxone"] },
        },
      }),
    ).toMatchObject({ ok: true });
    const read = await v1.loadPersistentAllergiesForEpisode(ep!.id);
    vi.unstubAllEnvs();
    const rows = await q<{ legacy_ref: { table: string } }>(
      `SELECT legacy_ref FROM allergies WHERE patient_user_id = $1 AND legacy_ref IS NOT NULL`,
      [p],
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.legacy_ref.table === "resus_timeline_events")).toBe(true);
    expect(read.allergies).toEqual(expect.arrayContaining(["Penicillin", "Ceftriaxone"]));
    expect((await loadAllergyInput(lane.db, p)).allergies).toEqual(
      expect.arrayContaining(["Penicillin", "Ceftriaxone"]),
    );
  });

  it("A3 critical: style + communication + Critical lane; unacknowledged past the TEST time frame escalates; ack clears", async () => {
    const { p, enc } = await present();
    const placed = await as(mo, p, (ctx) =>
      placeOrders(ctx, {
        patientUserId: p,
        encounterId: enc,
        orders: [
          { clientKey: key(), testId: GLUCOSE_FASTING, priority: "urgent", reasonText: "Check" },
        ],
      }),
    );
    const orderId = placed.orderIds[0]!;
    const s = await as(nurse, p, (ctx) =>
      collectSpecimen(ctx, {
        patientUserId: p,
        orderId,
        identifiersConfirmed: true,
        // Known: the chart only styles an interpretable glucose as critical (open item).
        fastingState: "fasting",
        clientKey: key(),
      }),
    );
    await as(lab, p, (ctx) =>
      receiveSpecimen(ctx, { patientUserId: p, specimenId: s.id, clientKey: key() }),
    );
    const r = await as(lab, p, (ctx) =>
      enterResults(
        ctx,
        {
          patientUserId: p,
          orderId,
          status: "final",
          values: [{ conceptId: "obs.glucose", value: "5.1", unit: "mmol/L" }],
          clientKey: key(),
        },
        TEST_CRIT,
      ),
    );
    expect(r).toMatchObject({ critical: true, warnings: [expect.stringMatching(/critical/)] });
    const [rep] = await lane.db
      .select()
      .from(diagnosticReports)
      .where(eq(diagnosticReports.id, r.id));

    // The critical style in the chart payload.
    const glucose = await snapshot(p, ["obs.glucose"]);
    const before = chart({
      snapshot: glucose,
      criticalRefs: TEST_CRIT,
      results: [await chartResult(rep!.logicalId, true)],
    });
    expect(before.summary.results[0]).toMatchObject({ conceptId: "obs.glucose", critical: true });
    expect(before.safetyBar.criticalText).toBe("1 critical result awaiting acknowledgement");

    const comm = await as(lab, p, (ctx) =>
      recordCriticalCommunication(ctx, {
        patientUserId: p,
        reportId: r.id,
        communicatedToUserId: mo.userId,
        communicatedToRole: "orderer",
        method: "phone",
        readBack: true,
        clientKey: key(),
      }),
    );
    expect(comm.id).toBeTruthy();

    // The Critical results lane for the orderer.
    const viewer = {
      userId: mo.userId,
      hospitalId: h,
      departmentId: dept,
      cadreCode: mo.cadreCode,
    };
    const tasks = (await loadEmrTasks(lane.db, viewer)).filter((x) => x.patientId === p);
    expect(tasks.map((x) => [x.id, x.kind])).toEqual([[r.id, "critical_result"]]);
    const flow = computeFlow(
      flowInput({
        viewer: { userId: mo.userId, departmentId: dept, scope: "mine", mayAssign: true },
        patients: { [p]: identity("A3") },
        tasks,
      }),
    );
    expect(flow.rows.find((x) => x.patientId === p)?.lane).toBe("critical_results");

    // Escalation: shipped time frame unsigned → no clock; TEST-signed and elapsed → escalate.
    const chain = [rep!];
    const late = new Date(rep!.recordedAt.getTime() + 2 * 60_000);
    expect(escalationState({ isCritical: true, chain, acks: [], now: late }).kind).toBe(
      "timeframe_not_signed",
    );
    expect(
      escalationState({ isCritical: true, chain, acks: [], now: late, timeframe: TEST_TIMEFRAME }),
    ).toMatchObject({ kind: "escalate", to: "in_charge" });

    await as(mo, p, (ctx) =>
      acknowledgeResults(ctx, {
        patientUserId: p,
        items: [{ reportId: r.id, action: "acted" }],
        clientKey: key(),
      }),
    );
    expect((await loadEmrTasks(lane.db, viewer)).some((x) => x.patientId === p)).toBe(false);
    const after = chart({
      snapshot: glucose,
      criticalRefs: TEST_CRIT,
      results: [await chartResult(rep!.logicalId, true)],
    });
    expect(after.safetyBar.criticalText).toBeNull();
    const acks = await lane.db
      .select()
      .from(resultAcknowledgements)
      .where(eq(resultAcknowledgements.reportId, r.id));
    expect(
      escalationState({ isCritical: true, chain, acks, now: late, timeframe: TEST_TIMEFRAME }).kind,
    ).toBe("acknowledged");
  });

  it("A4 signed note immutable; addendum threads; entered in error visible with reason; its facts reverse", async () => {
    const { p, enc } = await present();
    const d = await as(mo, p, (ctx) =>
      notes.saveNoteDraft(ctx, {
        patientUserId: p,
        encounterId: enc,
        templateId: "tpl.clerking.adult_opd",
        content: CLERKING,
        clientKey: key(),
      }),
    );
    await as(mo, p, (ctx) => notes.signNote(ctx, { patientUserId: p, noteId: d.id }));
    await expect(
      lane.pg.query(`UPDATE public.clinical_notes SET revision = revision + 1 WHERE id = $1`, [
        d.id,
      ]),
    ).rejects.toThrow(/refused/);
    expect((await snapshot(p, ["sx.polyuria"])).facts).toHaveLength(1);

    const add = await as(nurse, p, (ctx) =>
      notes.addAddendum(ctx, {
        patientUserId: p,
        parentNoteId: d.id,
        text: "Seen again later",
        reason: "Later review",
        clientKey: key(),
      }),
    );
    await as(consultant, p, (ctx) =>
      notes.markNoteEnteredInError(ctx, {
        patientUserId: p,
        noteId: d.id,
        reasonText: "Wrong patient",
        clientKey: key(),
      }),
    );
    // The note-born finding reverses: an entered-in-error version, so the snapshot drops it.
    expect((await snapshot(p, ["sx.polyuria"])).facts).toHaveLength(0);

    const rows = await lane.db
      .select()
      .from(clinicalNotes)
      .where(eq(clinicalNotes.patientUserId, p));
    const events = await lane.db
      .select()
      .from(clinicalNoteEvents)
      .where(eq(clinicalNoteEvents.patientUserId, p));
    const noteEvents: ChartNoteEventInput[] = events.map((e) => ({
      ...e,
      reasonText: e.reasonCiphertext ? decrypt(e.reasonCiphertext) : null,
    }));
    const payload = chart({ snapshot: await snapshot(p, ["allergy"]), notes: rows, noteEvents });
    const item = payload.notes.find((n) => n.id === d.id)!;
    expect(item).toMatchObject({ struck: true, eieReason: "Wrong patient" });
    expect(item.addenda.map((a) => a.id)).toEqual([add.id]);
  });

  it("A5 resus handover consumed: encounter + ISBAR note + flag cleared + 2 proposed orders; accept one, dismiss one; re-consume adds nothing", async () => {
    const p = await patient(lane.pg);
    patients.push(p);
    await intake(lane.pg, { hospitalId: h, patientUserId: p });
    const [ep] = await q<{ id: string }>(
      `INSERT INTO public.resus_episodes (hospital_id, department_id, patient_user_id, trigger_kind, state, opened_by_user_id,
         outcome_code, closure_kind, ended_at, pending_encounter_handoff)
       VALUES ($1, $2, $3, 'triage_red', 'concluded', $4, 'stabilised', 'bedside', now(), true) RETURNING id`,
      [h, dept, p, nurse.userId],
    );
    await lane.pg.query(
      `INSERT INTO public.resus_role_assignments (episode_id, user_id, role) VALUES ($1, $2, 'leader')`,
      [ep!.id, mo.userId],
    );
    await lane.pg.query(
      `INSERT INTO public.resus_timeline_events (episode_id, kind, step, recorded_by_user_id, payload)
       VALUES ($1, 'handover', 'post', $2, $3::jsonb)`,
      [
        ep!.id,
        mo.userId,
        JSON.stringify({
          sbar: {
            situation: "Stabilised.",
            background: "Known diabetic.",
            assessment: "Perfusing.",
            recommendation: "Repeat glucose.",
          },
          // The close-out's two outstanding tests (test ids and a reason, as the SBAR is kept).
          outstandingTests: [
            { testId: GLUCOSE_RANDOM, reason: "Recheck after dextrose" },
            { testId: MALARIA_RDT, reason: null },
          ],
        }),
      ],
    );
    const consume = () =>
      as(nurse, p, (ctx) => consumeResusHandoff(ctx, { patientUserId: p, episodeId: ep!.id }));
    const r = await consume();
    expect(
      (
        await q(`SELECT note_type, template_id, state FROM clinical_notes WHERE id = $1`, [r.id])
      )[0],
    ).toEqual({ note_type: "handover", template_id: "tpl.handover.isbar", state: "signed" });
    expect(
      (
        await q(
          `SELECT pending_encounter_handoff, encounter_id FROM resus_episodes WHERE id = $1`,
          [ep!.id],
        )
      )[0],
    ).toEqual({ pending_encounter_handoff: false, encounter_id: r.encounterId });

    // Two PROPOSED orders on the encounter, not active: nothing is ordered without an accept.
    const proposed = () =>
      q<{ id: string; test_id: string; source_intent_id: string }>(
        `SELECT id, test_id, source_intent_id FROM encounter_orders
          WHERE encounter_id = $1 AND intent_source = 'resus_handover' ORDER BY created_at, test_id`,
        [r.encounterId],
      );
    const rows = await proposed();
    expect(rows.map((o) => o.source_intent_id).sort()).toEqual(
      [`${ep!.id}:${GLUCOSE_RANDOM}`, `${ep!.id}:${MALARIA_RDT}`].sort(),
    );
    const byTest = Object.fromEntries(rows.map((o) => [o.test_id, o.id]));
    const eventKinds = async (orderId: string) =>
      (
        await q<{ kind: string }>(
          `SELECT kind FROM encounter_order_events WHERE order_id = $1 ORDER BY recorded_at`,
          [orderId],
        )
      ).map((e) => e.kind);
    expect(await eventKinds(byTest[GLUCOSE_RANDOM]!)).toEqual(["proposed"]);

    // The desk Plan shows them as the resus handover's suggestions, with accept and dismiss.
    await lane.pg.query(
      `INSERT INTO public.patient_profiles (id, first_name_encrypted, surname_encrypted, sex, date_of_birth, id_type,
         phone_encrypted, district_id)
       VALUES ($1, $2, $3, 'female', '1988-07-01', 'none', $4, (SELECT id FROM public.districts LIMIT 1))`,
      [p, encrypt("Test"), encrypt("Patient"), encrypt("0700000000")],
    );
    const planOf = async () =>
      (await loadDeskFor(mo, r.encounterId, { database: lane.db }))!.payload.suggestions
        .filter((x) => x.source === "resus_handover")
        .map((x) => ({ key: x.key, state: x.state, rationale: x.rationale }))
        .sort((a, b) => a.key.localeCompare(b.key));
    const expected = (states: Record<string, string>) =>
      [
        { key: byTest[GLUCOSE_RANDOM]!, state: states.g, rationale: "Recheck after dextrose" },
        { key: byTest[MALARIA_RDT]!, state: states.m, rationale: "" },
      ].sort((a, b) => a.key.localeCompare(b.key));
    expect(await planOf()).toEqual(expected({ g: "open", m: "open" }));
    // A suggestion is not an order: completing now warns of no uncollected specimen.
    const uncollected = async () =>
      (
        await as(mo, p, (ctx) =>
          planCompletion(ctx, {
            patientUserId: p,
            encounterId: r.encounterId,
            disposition: "home",
          }),
        )
      ).warnings.filter((w) => /no specimen collected/.test(w));
    expect(await uncollected()).toEqual([]);

    // The clinician accepts one (it becomes the active order) and dismisses the other (recorded).
    const ref = (id: string) => ({
      patientUserId: p,
      encounterId: r.encounterId,
      proposedOrderId: id,
    });
    await as(mo, p, (ctx) => acceptSuggestedOrder(ctx, ref(byTest[GLUCOSE_RANDOM]!)));
    await as(mo, p, (ctx) => dismissSuggestedOrder(ctx, ref(byTest[MALARIA_RDT]!)));
    expect(await eventKinds(byTest[GLUCOSE_RANDOM]!)).toEqual(["proposed", "placed"]);
    expect(await eventKinds(byTest[MALARIA_RDT]!)).toEqual(["proposed", "dismissed"]);
    const [orderRow] = await lane.db
      .select()
      .from(encounterOrders)
      .where(eq(encounterOrders.id, byTest[GLUCOSE_RANDOM]!));
    const records = await lane.db.transaction((tx) =>
      loadOrderRecords(tx as EmrTx, [byTest[GLUCOSE_RANDOM]!, byTest[MALARIA_RDT]!]),
    );
    expect(deriveOrderStatus(orderRow!, records).status).toEqual({
      state: "active",
      rejection: null,
    });

    expect(await planOf()).toEqual(expected({ g: "accepted", m: "dismissed" }));
    // The accepted one is now an order to collect; the dismissed one never is.
    expect(await uncollected()).toEqual(["1 order has no specimen collected yet."]);

    // Re-consumed (the chart's "Bring in resus handover"): no second note, encounter or proposal.
    expect(await consume()).toEqual(r);
    expect(await proposed()).toHaveLength(2);
    expect(await eventKinds(byTest[MALARIA_RDT]!)).toEqual(["proposed", "dismissed"]);

    // The clerking form (clinical reference §2.2): this emergency visit came through resus, so the
    // emergency clerking; without the resus (and no top-level triage) the full clerkship; the switch
    // picks before a draft exists, and the author's draft then keeps its form.
    const form = async (template?: string) =>
      (await loadDeskFor(mo, r.encounterId, { database: lane.db, template }))!.payload.template.id;
    expect(await form()).toBe("tpl.clerking.emergency");
    expect(await form("tpl.clerking.adult_opd")).toBe("tpl.clerking.adult_opd");
    await q(`UPDATE public.resus_episodes SET encounter_id = NULL WHERE id = $1`, [ep!.id]);
    expect(
      await q(`SELECT encounter_type FROM public.encounters WHERE id = $1`, [r.encounterId]),
    ).toEqual([{ encounter_type: "emergency" }]);
    expect(await form()).toBe("tpl.clerking.adult_opd");
    await as(mo, p, (ctx) =>
      notes.saveNoteDraft(ctx, {
        patientUserId: p,
        encounterId: r.encounterId,
        templateId: "tpl.clerking.emergency",
        content: { sections: { s01: { narrative: "Collapsed at home" } } },
        clientKey: key(),
      }),
    );
    expect(await form()).toBe("tpl.clerking.emergency");
    expect(await form("tpl.clerking.adult_opd")).toBe("tpl.clerking.emergency");
  });

  it("A6 a stale encounter sits in Needs closing, never closes itself, and closes administratively with a reason", async () => {
    const { p, enc } = await present();
    const stale = Date.now() - 3 * 86_400_000;
    await lane.pg.query(`UPDATE public.encounters SET last_activity_at = $2 WHERE id = $1`, [
      enc,
      new Date(stale),
    ]);
    const e: FlowEncounter = {
      id: enc,
      patientId: p,
      clinicianId: mo.userId,
      clinicianName: null,
      departmentId: dept,
      state: "in_progress",
      triageRecordId: null,
      appointmentId: null,
      createdAtMs: stale,
      startedAtMs: stale,
      endedAtMs: null,
      lastActivityAtMs: stale,
    };
    const flow = computeFlow(
      flowInput({
        nowMs: Date.now(),
        dayStartMs: Date.now() - 3_600_000,
        viewer: { userId: mo.userId, departmentId: dept, scope: "mine", mayAssign: true },
        patients: { [p]: identity("A6") },
        encounters: [e],
      }),
    );
    expect(flow.rows.find((x) => x.patientId === p)?.lane).toBe("needs_closing");
    expect((await q(`SELECT state FROM encounters WHERE id = $1`, [enc]))[0]).toEqual({
      state: "in_progress",
    });

    const close = (reason: "other" | "left_before_seen", note?: string) =>
      as(mo, p, (ctx) =>
        planAdministrativeClosure(ctx, { patientUserId: p, encounterId: enc, reason, note }),
      );
    expect(await code(close("other"))).toBe("invalid"); // 'other' needs the note
    const plan = await close("left_before_seen");
    await applyAsEdge(plan.body, mo.userId);
    expect(
      (
        await q(`SELECT state, closure_kind, closure_reason FROM encounters WHERE id = $1`, [enc])
      )[0],
    ).toEqual({
      state: "completed",
      closure_kind: "administrative",
      closure_reason: "left_before_seen",
    });
  });

  it("A7 reception and another hospital denied; the intern's note awaits co-sign while their orders commit", async () => {
    const { p, enc } = await present();
    const draft = (a: EmrActor) =>
      as(a, p, (ctx) =>
        notes.saveNoteDraft(ctx, {
          patientUserId: p,
          encounterId: enc,
          templateId: "tpl.clerking.adult_opd",
          content: CLERKING,
          clientKey: key(),
        }),
      );
    expect(await code(draft(receptionist))).toBe("forbidden");
    // Even flagged clinical, the one SQL rule gives reception no basis.
    expect(await code(draft({ ...receptionist, isClinical: true }))).toBe("forbidden");
    expect(await code(draft(elsewhere))).toBe("forbidden");

    const d = await draft(intern);
    const signed = await as(intern, p, (ctx) =>
      notes.signNote(ctx, { patientUserId: p, noteId: d.id }),
    );
    expect(signed.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/awaiting co-signature/)]),
    );
    expect(
      (
        await q(`SELECT action_kind, state FROM clinical_cosign_requests WHERE note_id = $1`, [
          d.id,
        ])
      )[0],
    ).toEqual({ action_kind: "sign_note", state: "pending_review" });
    const o = await as(intern, p, (ctx) =>
      placeOrders(ctx, {
        patientUserId: p,
        encounterId: enc,
        orders: [
          { clientKey: key(), testId: MALARIA_RDT, priority: "routine", reasonText: "Fever" },
        ],
      }),
    );
    expect(
      (
        await q(`SELECT authored_by_user_id FROM encounter_orders WHERE id = $1`, [o.orderIds[0]])
      )[0],
    ).toEqual({ authored_by_user_id: intern.userId });
    const dx = await as(intern, p, (ctx) =>
      recordEncounterDiagnosis(ctx, {
        patientUserId: p,
        encounterId: enc,
        text: "Working diagnosis",
        verification: "confirmed",
        clientKey: key(),
      }),
    );
    expect(dx.warnings).toEqual([expect.stringMatching(/senior confirms/)]);
  });

  it("A8 a 30 s offline drop mid-typing loses nothing and the queue flushes in order", async () => {
    const { p, enc } = await present();
    let clock = Date.now();
    const queue = createWriteQueue({ now: () => clock });
    const sent: string[] = [];
    let dropOnce = true;
    const allergy = (text: string, drop = false) => ({
      label: text,
      run: async ({ clientKey }: { clientKey: string }): Promise<ActionResult> => {
        sent.push(text);
        try {
          const r = await as(nurse, p, (ctx) =>
            recordAllergy(ctx, {
              patientUserId: p,
              encounterId: enc,
              clientKey,
              substance: { text },
            }),
          );
          if (drop && dropOnce) {
            // Saved on the server, but the connection drops before the reply arrives.
            dropOnce = false;
            queue.setOnline(false);
            throw new Error("network");
          }
          return { ok: true, id: r.id, serverTime: new Date().toISOString() };
        } catch (e) {
          if ((e as Error).message === "network") throw e;
          return actionError(e);
        }
      },
    });
    const draft = (text: string) => ({
      label: "Note",
      coalesceKey: "note",
      run: async ({ clientKey }: { clientKey: string }): Promise<ActionResult> => {
        sent.push(text);
        const r = await as(mo, p, (ctx) =>
          notes.saveNoteDraft(ctx, {
            patientUserId: p,
            encounterId: enc,
            templateId: "tpl.progress",
            content: { sections: { s03: { narrative: text } } },
            clientKey,
          }),
        );
        return { ok: true, id: r.id, serverTime: new Date().toISOString() };
      },
    });
    const settled = async () => {
      for (let i = 0; i < 400 && queue.getSnapshot().some((e) => e.status === "sending"); i++)
        await new Promise((r) => setTimeout(r, 10));
    };

    queue.submit(allergy("Substance 1"));
    queue.submit(allergy("Substance 2", true));
    await settled();
    // Offline: typing goes on; entries wait, autosaves coalesce.
    queue.submit(allergy("Substance 3"));
    queue.submit(draft("typed a"));
    queue.submit(draft("typed ab"));
    queue.submit(draft("typed abc"));
    queue.submit(allergy("Substance 4"));
    expect(bannerText(queue.getSnapshot(), false)).toBe("Offline, 4 entries waiting");
    expect(guardUnload(queue.getSnapshot())).toBe(true);
    clock += 30_000;
    queue.setOnline(true);
    for (let i = 0; i < 400 && queue.getSnapshot().length > 0; i++)
      await new Promise((r) => setTimeout(r, 10));
    expect(queue.getSnapshot()).toEqual([]);

    expect(sent).toEqual([
      "Substance 1",
      "Substance 2",
      "Substance 2",
      "Substance 3",
      "typed abc",
      "Substance 4",
    ]);
    // Nothing doubled (the resend replayed on its client key), nothing lost, commit order kept.
    const saved = await q<{ id: string; t: string }>(
      `SELECT a.id, a.substance_text_ciphertext AS t FROM allergies a
         JOIN audit_log l ON l.record_id = a.id::text AND l.table_name = 'allergies' AND l.action = 'insert'
        WHERE a.patient_user_id = $1 ORDER BY l.id`,
      [p],
    );
    expect(saved.map((s) => decrypt(s.t))).toEqual([
      "Substance 1",
      "Substance 2",
      "Substance 3",
      "Substance 4",
    ]);
    const n = await q<{ content_ciphertext: string }>(
      `SELECT content_ciphertext FROM clinical_notes WHERE patient_user_id = $1`,
      [p],
    );
    expect(n.map((x) => JSON.parse(decrypt(x.content_ciphertext)))).toEqual([
      { sections: { s03: { narrative: "typed abc" } } },
    ]);
  });

  it("A9 a notifiable diagnosis (TEST-signed IDSR class): confirm payload, pending intent, IPC prompt; never blocks", async () => {
    const { p, enc } = await present();
    const dx = await as(mo, p, (ctx) =>
      recordEncounterDiagnosis(
        ctx,
        {
          patientUserId: p,
          encounterId: enc,
          termId: MALARIA_UNCOMPLICATED,
          verification: "confirmed",
          clientKey: key(),
        },
        TEST_IDSR,
      ),
    );
    expect(dx.notifiable).toMatchObject({ id: "test.class", actionText: "TEST action text" });
    expect(dx.warnings).toEqual(["Notifiable (Test class): TEST action text", IPC_PROMPT]);
    expect(
      (await q(`SELECT verification, rank FROM conditions WHERE id = $1`, [dx.id]))[0],
    ).toEqual({ verification: "confirmed", rank: "primary" });
    expect(
      await q(`SELECT kind, label FROM encounter_events WHERE encounter_id = $1 AND ref_id = $2`, [
        enc,
        dx.id,
      ]),
    ).toEqual([{ kind: "diagnosis", label: "Notification pending (IDSR)" }]);
  });

  it("audit completeness: every EMR row the scenarios wrote has its insert audit row", async () => {
    const tables = [
      "clinical_notes",
      "clinical_note_events",
      "conditions",
      "allergies",
      "encounter_orders",
      "encounter_order_events",
      "specimens",
      "specimen_events",
      "diagnostic_reports",
      "result_acknowledgements",
      "critical_result_communications",
      "clinical_observations",
    ];
    const counts: Record<string, { rows: number; audited: number; withActor: number }> = {};
    for (const t of tables) {
      const [c] = await q<{ rows: number; audited: number; with_actor: number }>(
        `SELECT count(*)::int AS rows,
                count(l.record_id)::int AS audited,
                count(l.actor_id)::int AS with_actor
           FROM public.${t} x
           LEFT JOIN LATERAL (SELECT record_id, actor_id FROM public.audit_log a
                               WHERE a.table_name = '${t}' AND a.record_id = x.id::text AND a.action = 'insert'
                               LIMIT 1) l ON true
          WHERE x.patient_user_id = ANY($1::uuid[])`,
        [patients],
      );
      counts[t] = { rows: c!.rows, audited: c!.audited, withActor: c!.with_actor };
    }
    for (const [t, c] of Object.entries(counts)) {
      expect(c.rows, t).toBeGreaterThan(0);
      expect(c.audited, t).toBe(c.rows);
    }
  });
});
