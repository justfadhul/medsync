/**
 * Notes on the PGlite lane (lib/emr/write/notes.ts over the real 0071 tables and the draft guard):
 * autosave with revisions, encrypted content, signing (HMAC, template minimum, the key missing),
 * note-born findings and the NCD capture committed with the note, immutability after signing, the
 * intern co-sign flow through clinical_cosign_requests, addenda and entered in error. EMR_PGLITE=1.
 */
import type { Lane } from "./_pglite";
import type { EmrActor } from "@/lib/emr/actor";
import type { NoteContent } from "@/lib/emr/notes";
import type { WriteCtx } from "@/lib/emr/write/context";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { canonicalNote, noteStatus, verifyNoteHmac } from "@/lib/emr/notes";
import { withPatientWrite } from "@/lib/emr/write/context";
import * as notes from "@/lib/emr/write/notes";
import { decrypt, generateKey } from "@/lib/encryption";
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

type Pg = Lane["pg"];
const key = () => `k-${crypto.randomUUID()}`;
const HMAC_KEY = Buffer.alloc(32, 7).toString("base64");
const savedKey = process.env.MEDSYNC_NOTE_HMAC_KEY;

async function actorOf(
  pg: Pg,
  cadre: string,
  hospitalId: string,
  departmentId: string,
): Promise<EmrActor> {
  const s = await staff(pg, { hospitalId, departmentId, cadre });
  return {
    userId: s.userId,
    fullName: null,
    hospitalId,
    departmentId,
    affiliationId: s.affiliationId,
    cadreCode: cadre,
    isClinical: cadre !== "RECEPTION",
    surface: "doctor",
  };
}

const CLERKING: NoteContent = {
  sections: {
    s01: { items: [{ kind: "complaint_token", token: "sx.polyuria", durationDays: 14 }] },
    s02: {
      narrative: "Two weeks of passing a lot of urine.",
      items: [
        { kind: "finding", token: "fatigue", presence: "absent" },
        { kind: "finding", token: "sx.polydipsia", presence: "not_asked" },
        { kind: "finding", token: "not.a.concept", presence: "present" },
      ],
    },
    s11: { items: [{ kind: "exam_finding", token: "sign.pallor", presence: "absent" }] },
    s13: { items: [{ kind: "diagnosis_deferred", reason: "Awaiting glucose" }] },
    s14: { items: [{ kind: "plan_statement", text: "Review with results" }] },
    ncd: {
      items: [
        { kind: "ncd_capture", values: { capillary_glucose: { state: "recorded", value: 11.2 } } },
      ],
    },
  },
};

describe.skipIf(!laneOn)("note writes (PGlite lane)", () => {
  let lane: Lane;
  let h: string;
  let mo: EmrActor;
  let intern: EmrActor;
  let nurse: EmrActor;
  let consultant: EmrActor;
  let reception: EmrActor;
  let elsewhere: EmrActor;
  let p: string;
  let enc: string;

  const as = <T>(a: EmrActor, fn: (ctx: WriteCtx) => Promise<T>, patientUserId = p) =>
    withPatientWrite(a, patientUserId, fn, { database: lane.db });
  const draft = (a: EmrActor, extra: Partial<notes.SaveNoteDraftInput> = {}) =>
    as(a, (ctx) =>
      notes.saveNoteDraft(ctx, {
        patientUserId: p,
        encounterId: enc,
        templateId: "tpl.clerking.adult_opd",
        content: CLERKING,
        clientKey: key(),
        ...extra,
      }),
    );
  const sign = (a: EmrActor, noteId: string) =>
    as(a, (ctx) => notes.signNote(ctx, { patientUserId: p, noteId }));
  const statusOf = async (noteId: string) => {
    const note = (await lane.db.query.clinicalNotes.findFirst({
      where: (n, { eq }) => eq(n.id, noteId),
    }))!;
    const events = await lane.db.query.clinicalNoteEvents.findMany({
      where: (e, { eq }) => eq(e.noteId, noteId),
    });
    return noteStatus(note, events).status;
  };

  beforeAll(async () => {
    process.env.MEDSYNC_PHI_KEY ??= generateKey();
    process.env.MEDSYNC_NOTE_HMAC_KEY = HMAC_KEY;
    lane = await bootLane();
    h = await hospital(lane.pg);
    const dept = await department(lane.pg, h);
    const h2 = await hospital(lane.pg, "Elsewhere");
    const dept2 = await department(lane.pg, h2);
    mo = await actorOf(lane.pg, "MEDICAL_OFFICER", h, dept);
    intern = await actorOf(lane.pg, "INTERN_DOCTOR", h, dept);
    nurse = await actorOf(lane.pg, "NURSE", h, dept);
    consultant = await actorOf(lane.pg, "CONSULTANT", h, dept);
    reception = await actorOf(lane.pg, "RECEPTION", h, dept);
    elsewhere = await actorOf(lane.pg, "MEDICAL_OFFICER", h2, dept2);
    p = await patient(lane.pg);
    enc = await encounter(lane.pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: mo.userId,
      departmentId: dept,
    });
    await intake(lane.pg, { hospitalId: h, patientUserId: p });
  }, 180_000);

  afterAll(() => {
    if (savedKey === undefined) delete process.env.MEDSYNC_NOTE_HMAC_KEY;
    else process.env.MEDSYNC_NOTE_HMAC_KEY = savedKey;
  });

  it("autosaves one encrypted draft with an optimistic revision", async () => {
    const k = key();
    const first = await draft(mo, { clientKey: k });
    expect(first.revision).toBe(0);
    expect((await draft(mo, { clientKey: k })).id).toBe(first.id); // replayed create
    const changed = { sections: { ...CLERKING.sections, s12: { narrative: "Summary" } } };
    const second = await draft(mo, { noteId: first.id, revision: 0, content: changed });
    expect(second).toEqual({ id: first.id, revision: 1 });
    // A retried save that already landed is not a conflict; a stale different one is.
    expect(await draft(mo, { noteId: first.id, revision: 0, content: changed })).toEqual(second);
    await expect(draft(mo, { noteId: first.id, revision: 0 })).rejects.toMatchObject({
      code: "conflict",
    });
    // Without a note id the author's open draft is found: still one draft.
    expect((await draft(mo, { content: changed })).id).toBe(first.id);

    const row = (
      await lane.pg.query(
        `SELECT content_ciphertext, revision FROM public.clinical_notes WHERE id = $1`,
        [first.id],
      )
    ).rows[0]!;
    expect(String(row.content_ciphertext)).not.toMatch(/passing a lot/);
    expect(JSON.parse(decrypt(String(row.content_ciphertext)))).toEqual(changed);
  });

  it("a save that never saw the draft cannot overwrite it (a late first save, a second tab)", async () => {
    const e = await encounter(lane.pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: mo.userId,
    });
    const say = (s: string) => ({ sections: { s01: { narrative: s } } });
    const save = (clientKey: string, content: ReturnType<typeof say>, extra = {}) =>
      draft(mo, { encounterId: e, clientKey, content, ...extra });
    const stored = async (id: string) =>
      JSON.parse(
        decrypt(
          String(
            (
              await lane.pg.query(
                `SELECT content_ciphertext FROM public.clinical_notes WHERE id = $1`,
                [id],
              )
            ).rows[0]!.content_ciphertext,
          ),
        ),
      );
    // First save A timed out; the queue coalesced it into B, which created the draft.
    const a = key();
    const b = await save(key(), say("B, newer"));
    // A's delayed request runs now: it never saw B's draft.
    await expect(save(a, say("A, older"))).rejects.toMatchObject({ code: "conflict" });
    // Tab 2, opened before any draft existed, makes its first save.
    await expect(save(key(), say("tab 2"))).rejects.toMatchObject({ code: "conflict" });
    expect(await stored(b.id)).toEqual(say("B, newer"));
    // B's own resend after a later save replays its create, and writes nothing.
    const bKey = key();
    const e2 = await encounter(lane.pg, {
      hospitalId: h,
      patientUserId: p,
      clinicianUserId: mo.userId,
    });
    const first = await draft(mo, { encounterId: e2, clientKey: bKey, content: say("one") });
    await draft(mo, { encounterId: e2, noteId: first.id, revision: 0, content: say("two") });
    expect(await draft(mo, { encounterId: e2, clientKey: bKey, content: say("one") })).toEqual({
      id: first.id,
      revision: 1,
    });
    expect(await stored(first.id)).toEqual(say("two"));
  });

  it("refuses the wrong cadre, reception, another hospital and no basis", async () => {
    await expect(draft(nurse)).rejects.toMatchObject({ code: "forbidden" });
    expect(
      (
        await draft(nurse, {
          templateId: "tpl.nursing",
          content: { sections: { s01: { narrative: "Comfortable." } } },
        })
      ).id,
    ).toBeTruthy();
    await expect(draft(reception)).rejects.toMatchObject({ code: "forbidden" });
    await expect(draft(elsewhere)).rejects.toMatchObject({ code: "forbidden" });
    const stranger = await patient(lane.pg);
    await expect(
      as(
        mo,
        (ctx) =>
          notes.saveNoteDraft(ctx, {
            patientUserId: stranger,
            encounterId: enc,
            templateId: "tpl.progress",
            content: CLERKING,
            clientKey: key(),
          }),
        stranger,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("signs: key required, minimum enforced, HMAC over the canonical note, findings and NCD values committed", async () => {
    const q = await patient(lane.pg);
    const e = await encounter(lane.pg, {
      hospitalId: h,
      patientUserId: q,
      clinicianUserId: consultant.userId,
    });
    const d = await as(
      consultant,
      (ctx) =>
        notes.saveNoteDraft(ctx, {
          patientUserId: q,
          encounterId: e,
          templateId: "tpl.clerking.adult_opd",
          content: { sections: { s01: CLERKING.sections.s01! } },
          clientKey: key(),
        }),
      q,
    );
    const signQ = () =>
      as(consultant, (ctx) => notes.signNote(ctx, { patientUserId: q, noteId: d.id }), q);

    delete process.env.MEDSYNC_NOTE_HMAC_KEY;
    await expect(signQ()).rejects.toMatchObject({
      code: "config",
      message: expect.stringMatching(/MEDSYNC_NOTE_HMAC_KEY/),
    });
    process.env.MEDSYNC_NOTE_HMAC_KEY = HMAC_KEY;
    await expect(signQ()).rejects.toMatchObject({
      code: "invalid",
      message: expect.stringMatching(/diagnosis/),
    });

    await as(
      consultant,
      (ctx) =>
        notes.saveNoteDraft(ctx, {
          patientUserId: q,
          encounterId: e,
          templateId: "tpl.clerking.adult_opd",
          noteId: d.id,
          revision: 0,
          content: CLERKING,
          clientKey: key(),
        }),
      q,
    );
    const signed = await signQ();
    expect(signed.warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Allergy status/),
        expect.stringMatching(/1 finding/),
      ]),
    );
    expect(signed.warnings?.some((w) => /co-signature/.test(w))).toBe(false);

    const note = (await lane.db.query.clinicalNotes.findFirst({
      where: (n, { eq }) => eq(n.id, d.id),
    }))!;
    expect(note.state).toBe("signed");
    expect(
      verifyNoteHmac(
        canonicalNote({ ...note, signedAt: note.signedAt!, content: CLERKING }),
        note.contentHmac!,
        HMAC_KEY,
      ),
    ).toBe(true);

    const { rows } = await lane.pg.query(
      `SELECT concept_id, presence, value_canonical, context->>'elicitedBy' AS by FROM public.clinical_observations
        WHERE client_key LIKE $1 ORDER BY concept_id`,
      [`${d.id}:nb:%`],
    );
    expect(rows.map((r) => [r.concept_id, r.presence ?? Number(r.value_canonical), r.by])).toEqual([
      ["obs.glucose", 11.2, null],
      ["sign.pallor", "absent", "examination"],
      ["sx.fatigue", "absent", "history"],
      ["sx.polyuria", "present", "history"],
    ]);

    // Signing again is a replay; the signed row can no longer change.
    expect((await signQ()).id).toBe(d.id);
    expect(
      (
        await lane.pg.query(
          `SELECT count(*)::int n FROM public.clinical_observations WHERE client_key LIKE $1`,
          [`${d.id}:nb:%`],
        )
      ).rows[0]!.n,
    ).toBe(4);
    await expect(
      lane.pg.query(`UPDATE public.clinical_notes SET revision = revision + 1 WHERE id = $1`, [
        d.id,
      ]),
    ).rejects.toThrow(/refused/);
    await expect(
      lane.pg.query(`DELETE FROM public.clinical_notes WHERE id = $1`, [d.id]),
    ).rejects.toThrow();
    await expect(
      as(
        consultant,
        (ctx) =>
          notes.saveNoteDraft(ctx, {
            patientUserId: q,
            encounterId: e,
            templateId: "tpl.clerking.adult_opd",
            noteId: d.id,
            content: CLERKING,
            clientKey: key(),
          }),
        q,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("an intern's note awaits co-signature in the co-sign queue; a senior (never the author) co-signs", async () => {
    const d = await draft(intern);
    const r = await sign(intern, d.id);
    expect(r.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/awaiting co-signature/)]),
    );
    expect(await statusOf(d.id)).toBe("awaiting_cosign");
    const req = (
      await lane.pg.query(`SELECT * FROM public.clinical_cosign_requests WHERE note_id = $1`, [
        d.id,
      ])
    ).rows[0]!;
    expect(req).toMatchObject({
      action_kind: "sign_note",
      state: "pending_review",
      requested_by_user_id: intern.userId,
    });
    expect(req.action_payload).toEqual({ noteId: d.id, noteType: "clerking", encounterId: enc });

    await expect(
      as(intern, (ctx) =>
        notes.cosignNote(ctx, { patientUserId: p, noteId: d.id, clientKey: key() }),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    const k = key();
    const c = await as(consultant, (ctx) =>
      notes.cosignNote(ctx, { patientUserId: p, noteId: d.id, clientKey: k }),
    );
    expect(
      (
        await as(consultant, (ctx) =>
          notes.cosignNote(ctx, { patientUserId: p, noteId: d.id, clientKey: k }),
        )
      ).id,
    ).toBe(c.id);
    expect(await statusOf(d.id)).toBe("cosigned");
    expect(
      (
        await lane.pg.query(`SELECT state FROM public.clinical_cosign_requests WHERE id = $1`, [
          req.id,
        ])
      ).rows[0]!.state,
    ).toBe("approved");
    await expect(
      as(mo, (ctx) => notes.cosignNote(ctx, { patientUserId: p, noteId: d.id, clientKey: key() })),
    ).rejects.toMatchObject({ code: "conflict" });

    // A senior asked to review their own note cannot co-sign it.
    const own = await draft(mo, {
      templateId: "tpl.progress",
      content: { sections: { s03: { narrative: "Better" }, s04: { narrative: "Home" } } },
    });
    await sign(mo, own.id);
    await as(mo, (ctx) =>
      notes.requestCosign(ctx, { patientUserId: p, noteId: own.id, clientKey: key() }),
    );
    await expect(
      as(mo, (ctx) =>
        notes.cosignNote(ctx, { patientUserId: p, noteId: own.id, clientKey: key() }),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("addendum threads under the parent and inherits its restriction", async () => {
    const d = await draft(mo, {
      templateId: "tpl.ward_round",
      restricted: true,
      content: { sections: { s03: { narrative: "Stable" }, s04: { narrative: "Continue" } } },
    });
    await sign(mo, d.id);
    const k = key();
    const a = await as(nurse, (ctx) =>
      notes.addAddendum(ctx, {
        patientUserId: p,
        parentNoteId: d.id,
        text: "Seen again at 18:00",
        reason: "Later review",
        clientKey: k,
      }),
    );
    expect(
      (
        await as(nurse, (ctx) =>
          notes.addAddendum(ctx, {
            patientUserId: p,
            parentNoteId: d.id,
            text: "x",
            reason: "y",
            clientKey: k,
          }),
        )
      ).id,
    ).toBe(a.id);
    const row = (
      await lane.pg.query(
        `SELECT note_type, addendum_to, state, sensitivity, author_user_id FROM public.clinical_notes WHERE id = $1`,
        [a.id],
      )
    ).rows[0]!;
    expect(row).toMatchObject({
      note_type: "addendum",
      addendum_to: d.id,
      state: "signed",
      sensitivity: "restricted",
      author_user_id: nurse.userId,
    });
    const ev = (
      await lane.pg.query(
        `SELECT kind, related_note_id FROM public.clinical_note_events WHERE note_id = $1`,
        [d.id],
      )
    ).rows;
    expect(ev).toEqual([{ kind: "addendum_added", related_note_id: a.id }]);
  });

  it("entered in error: reason, author or senior; its findings are voided with the concept kept", async () => {
    const q = await patient(lane.pg);
    const e = await encounter(lane.pg, {
      hospitalId: h,
      patientUserId: q,
      clinicianUserId: intern.userId,
    });
    await intake(lane.pg, { hospitalId: h, patientUserId: q });
    const d = await as(
      intern,
      (ctx) =>
        notes.saveNoteDraft(ctx, {
          patientUserId: q,
          encounterId: e,
          templateId: "tpl.clerking.adult_opd",
          content: CLERKING,
          clientKey: key(),
        }),
      q,
    );
    await as(intern, (ctx) => notes.signNote(ctx, { patientUserId: q, noteId: d.id }), q);
    const eie = (a: EmrActor, extra: { reasonText?: string } = { reasonText: "Wrong patient" }) =>
      as(
        a,
        (ctx) =>
          notes.markNoteEnteredInError(ctx, {
            patientUserId: q,
            noteId: d.id,
            clientKey: key(),
            ...extra,
          }),
        q,
      );
    await expect(eie(intern, {})).rejects.toMatchObject({ code: "invalid" });
    await expect(eie(nurse)).rejects.toMatchObject({ code: "forbidden" });
    await eie(consultant);
    await expect(eie(intern)).rejects.toMatchObject({ code: "conflict" });

    const { rows } = await lane.pg.query(
      `SELECT v.concept_id, o.concept_id AS original, v.status FROM public.clinical_observations v
         JOIN public.clinical_observations o ON o.id = v.supersedes_id
        WHERE o.client_key LIKE $1 ORDER BY v.concept_id`,
      [`${d.id}:nb:%`],
    );
    expect(rows).toHaveLength(4);
    for (const r of rows)
      expect(r).toMatchObject({ status: "entered_in_error", concept_id: r.original });
    expect(
      (
        await lane.pg.query(
          `SELECT state FROM public.clinical_cosign_requests WHERE note_id = $1`,
          [d.id],
        )
      ).rows[0]!.state,
    ).toBe("cancelled");
  });
});
