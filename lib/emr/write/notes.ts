import "server-only";

import { randomUUID } from "node:crypto";
import type { WriteCtx } from "./context";
import type { ObservationInput } from "./facts";
import type { WriteResult } from "./orders";
import type { ClinicalNote } from "@/db/schema/emr";
import type { NoteContent, NoteItem, SignContext } from "@/lib/emr/notes";
import { and, desc, eq, inArray, like, notInArray, sql } from "drizzle-orm";

import { clinicalCosignRequests } from "@/db/schema/doctor-workspace";
import { clinicalNoteEvents, clinicalNotes, medicationStatements } from "@/db/schema/emr";
import { clinicalObservations } from "@/db/schema/nurse-workspace";
import { encounters } from "@/db/schema/scheduling";
import { isOpen } from "@/lib/emr/encounter";
import {
  applyNoteEvent,
  getTemplate,
  NoteHmacKeyError,
  noteStatus,
  planSign,
  stableStringify,
} from "@/lib/emr/notes";
import { loadAllergyInput } from "@/lib/emr/read/allergies";
import { EMR_SETTINGS_DEFAULTS } from "@/lib/emr/settings";
import { clerkshipWriteAuthority } from "@/lib/encounter/access";
import { decrypt, encrypt } from "@/lib/encryption";
import { CONCEPTS } from "@/lib/facts/catalogue.generated";
import { conceptDef } from "@/lib/facts/project/shared";
import { captureFromNote, factsFromCapture } from "@/lib/ncd/cfc-map";
import { EmrWriteError, stampActivity } from "./context";
import {
  insertObservations,
  requireAuthorOrSupervisor,
  SENIOR_CADRES,
  voidObservation,
} from "./facts";
import { NURSE_CADRES, ORDERING_CADRES, replayed, requireCadre } from "./orders";

/**
 * Notes (PROMPT §5.9, ADR 0134). A per-author draft autosaves encrypted content with an optimistic
 * revision; signing validates the template minimum, HMACs the canonical composition and, in the SAME
 * transaction, commits the note-born findings and the NCD capture as facts (D-EMR-01). The trigger
 * makes the signed row immutable; everything afterwards is a clinical_note_events row, an addendum
 * (a new note) or a co-sign request in the existing /doctor/cosign-queue (sign_note).
 */

const invalid = (m: string) => new EmrWriteError("invalid", m);
type NoteRow = ClinicalNote;

/** Nursing and handover notes are nursing's too; every other note is a clerker's (matrix §D). */
function requireDocumenter(ctx: WriteCtx, noteType: string): void {
  const nursing = noteType === "nursing" || noteType === "handover" || noteType === "addendum";
  requireCadre(
    ctx,
    nursing ? [...ORDERING_CADRES, ...NURSE_CADRES] : ORDERING_CADRES,
    `write a ${noteType} note`,
  );
}

function hmacKey(): string {
  const key = process.env.MEDSYNC_NOTE_HMAC_KEY?.trim();
  if (!key)
    throw new EmrWriteError(
      "config",
      "Notes cannot be signed yet: the signing key (MEDSYNC_NOTE_HMAC_KEY) is not set on this deployment. Your draft is kept.",
    );
  return key;
}

const readContent = (n: Pick<NoteRow, "contentCiphertext">): NoteContent =>
  JSON.parse(decrypt(n.contentCiphertext)) as NoteContent;

async function loadNote(ctx: WriteCtx, patientUserId: string, noteId: string): Promise<NoteRow> {
  const [n] = await ctx.tx.select().from(clinicalNotes).where(eq(clinicalNotes.id, noteId));
  if (!n || n.patientUserId !== patientUserId || n.hospitalId !== ctx.actor.hospitalId)
    throw new EmrWriteError("not_found", "Note not found for this patient here.");
  return n;
}

async function eventsOf(ctx: WriteCtx, noteId: string) {
  return ctx.tx.select().from(clinicalNoteEvents).where(eq(clinicalNoteEvents.noteId, noteId));
}

/* ─── Drafts ─────────────────────────────────────────────────────── */

export interface SaveNoteDraftInput {
  patientUserId: string;
  encounterId: string;
  templateId: string;
  /** The draft being edited; omitted on the first save. */
  noteId?: string;
  /** The revision the client last saw: a different one is a conflict (another tab or device). */
  revision?: number;
  content: NoteContent;
  effectiveAt?: Date;
  restricted?: boolean;
  clientKey: string;
}

/** Autosave: one draft per encounter, author and note type (clinical_notes_one_draft). */
export async function saveNoteDraft(
  ctx: WriteCtx,
  input: SaveNoteDraftInput,
): Promise<WriteResult & { revision: number }> {
  const template = getTemplateOr(input.templateId);
  const noteType = template.noteType;
  if (!noteType || noteType === "addendum")
    throw invalid("That template is not a note of its own.");
  requireDocumenter(ctx, noteType);

  const [enc] = await ctx.tx
    .select({ id: encounters.id, state: encounters.state })
    .from(encounters)
    .where(
      and(
        eq(encounters.id, input.encounterId),
        eq(encounters.patientUserId, input.patientUserId),
        eq(encounters.hospitalId, ctx.actor.hospitalId),
      ),
    );
  if (!enc) throw new EmrWriteError("not_found", "Encounter not found for this patient here.");
  if (enc.state === "cancelled" || enc.state === "entered_in_error")
    throw new EmrWriteError("conflict", "The encounter was cancelled.");

  const byKey = await replayed(ctx.tx, clinicalNotes, input.clientKey, input.patientUserId);
  const noteId = input.noteId ?? byKey;
  const [existing] = noteId
    ? await ctx.tx.select().from(clinicalNotes).where(eq(clinicalNotes.id, noteId))
    : await ctx.tx
        .select()
        .from(clinicalNotes)
        .where(
          and(
            eq(clinicalNotes.encounterId, enc.id),
            eq(clinicalNotes.authorUserId, ctx.actor.userId),
            eq(clinicalNotes.noteType, noteType),
            eq(clinicalNotes.state, "draft"),
            sql`${clinicalNotes.addendumTo} IS NULL`,
          ),
        );

  const ciphertext = encrypt(JSON.stringify(input.content));
  if (existing) {
    if (existing.patientUserId !== input.patientUserId || existing.encounterId !== enc.id)
      throw new EmrWriteError("not_found", "Note not found for this encounter.");
    if (existing.authorUserId !== ctx.actor.userId)
      throw new EmrWriteError("forbidden", "Only the author edits a draft.");
    if (existing.state !== "draft")
      throw new EmrWriteError("conflict", "The note is signed: add an addendum instead.");
    if (existing.templateId !== template.id) throw invalid("A draft keeps its template.");
    const same = stableStringify(readContent(existing)) === stableStringify(input.content);
    // No revision: a first save. Its own create replayed (byKey) writes nothing, since anything
    // newer came after it; a draft it never saw (a late first save, a second tab) is not its to
    // overwrite.
    if (input.revision === undefined) {
      if (byKey) return { id: existing.id, revision: existing.revision };
      if (!same)
        throw new EmrWriteError(
          "conflict",
          "This note was changed in another tab or device. Reload to see the latest version.",
        );
    }
    if (input.revision !== undefined && input.revision !== existing.revision) {
      // A retried save that already landed is not a conflict.
      if (same) return { id: existing.id, revision: existing.revision };
      throw new EmrWriteError(
        "conflict",
        "This note was changed in another tab or device. Reload to see the latest version.",
      );
    }
    if (same && !input.effectiveAt) return { id: existing.id, revision: existing.revision };
    const [u] = await ctx.tx
      .update(clinicalNotes)
      .set({
        contentCiphertext: ciphertext,
        revision: existing.revision + 1,
        ...(input.effectiveAt ? { effectiveAt: input.effectiveAt } : {}),
        ...(input.restricted ? { sensitivity: "restricted" } : {}),
      })
      .where(
        and(
          eq(clinicalNotes.id, existing.id),
          eq(clinicalNotes.state, "draft"),
          eq(clinicalNotes.revision, existing.revision),
        ),
      )
      .returning({ id: clinicalNotes.id, revision: clinicalNotes.revision });
    if (!u) throw new EmrWriteError("conflict", "The note changed while saving. Reload.");
    await stampActivity(ctx, enc.id);
    return u;
  }

  if (!isOpen(enc)) throw new EmrWriteError("conflict", "The encounter is closed: no new notes.");
  const [n] = await ctx.tx
    .insert(clinicalNotes)
    .values({
      hospitalId: ctx.actor.hospitalId,
      patientUserId: input.patientUserId,
      encounterId: enc.id,
      noteType,
      templateId: template.id,
      templateVersion: template.version,
      authorUserId: ctx.actor.userId,
      authorCadre: ctx.actor.cadreCode,
      contentCiphertext: ciphertext,
      effectiveAt: input.effectiveAt ?? ctx.now,
      recordedAt: ctx.now,
      sensitivity: input.restricted ? "restricted" : "standard",
      clientKey: input.clientKey,
    })
    .returning({ id: clinicalNotes.id, revision: clinicalNotes.revision });
  await stampActivity(ctx, enc.id);
  return n!;
}

function getTemplateOr(id: string) {
  try {
    return getTemplate(id);
  } catch {
    throw invalid(`Unknown note template ${id}.`);
  }
}

/* ─── Signing ────────────────────────────────────────────────────── */

/** Finding tokens have one identity (D-CFC-11 [H]): a concept id, or a symptom_catalog code. */
const CONCEPT_BY_SYMPTOM = new Map(
  Object.entries(CONCEPTS as Record<string, { symptomCode: string | null }>)
    .filter(([, c]) => c.symptomCode)
    .map(([id, c]) => [c.symptomCode!, id]),
);

function conceptForToken(token: unknown): string | null {
  if (typeof token !== "string") return null;
  const def = conceptDef(token);
  if (def && (def.kind === "finding" || def.kind === "observation")) return token;
  return CONCEPT_BY_SYMPTOM.get(token) ?? null;
}

type FindingItem = {
  token?: unknown;
  presence?: unknown;
  code?: unknown;
  elicitedBy?: unknown;
  onset?: unknown;
  durationDays?: unknown;
  severity?: unknown;
  laterality?: unknown;
};

const QUALIFIERS = {
  severity: ["mild", "moderate", "severe"],
  laterality: ["left", "right", "bilateral"],
} as const;

/** A note-born item → the findings it asserts. "Not asked" / "not examined" is no fact (C3). */
function findingLines(
  item: NoteItem,
  effectiveAt: Date,
): { lines: ObservationInput[]; unmapped: number } {
  const elicitedBy = item.kind === "exam_finding" ? "examination" : "history";
  const entries: FindingItem[] =
    item.kind === "ros_grid" || (item.kind === "exam_finding" && Array.isArray(item.items))
      ? ((item.items as FindingItem[] | undefined) ?? [])
      : [
          (item.kind === "complaint_token"
            ? { ...item, presence: "present" }
            : item) as FindingItem,
        ];
  const lines: ObservationInput[] = [];
  let unmapped = 0;
  for (const f of entries) {
    const presence = f.presence;
    if (presence !== "present" && presence !== "absent" && typeof f.code !== "string") continue;
    const conceptId = conceptForToken(f.token);
    const def = conceptId ? conceptDef(conceptId) : undefined;
    if (!conceptId || !def) {
      unmapped++;
      continue;
    }
    const context: Record<string, unknown> = {
      elicitedBy: f.elicitedBy === "patient_self_report" ? f.elicitedBy : elicitedBy,
    };
    if (typeof f.onset === "string") context.onset = f.onset;
    if (typeof f.durationDays === "number" && f.durationDays >= 0)
      context.durationDays = f.durationDays;
    if (QUALIFIERS.severity.includes(f.severity as never)) context.severity = f.severity;
    if (QUALIFIERS.laterality.includes(f.laterality as never)) context.laterality = f.laterality;
    const value: ObservationInput["value"] | null =
      def.valueType === "presence" && (presence === "present" || presence === "absent")
        ? { type: "presence", presence }
        : (def.valueType === "coded" || def.valueType === "ordinal") && typeof f.code === "string"
          ? { type: "coded", code: f.code }
          : null;
    if (!value) {
      unmapped++;
      continue;
    }
    lines.push({ conceptId, effectiveAt, value, context });
  }
  return { lines, unmapped };
}

/** Every current medication statement has a reconciliation on this encounter. */
async function medicinesReconciled(ctx: WriteCtx, patientUserId: string, encounterId: string) {
  const rows = await ctx.tx
    .select({
      logicalId: medicationStatements.logicalId,
      version: medicationStatements.version,
      status: medicationStatements.status,
      medicationStatus: medicationStatements.medicationStatus,
      encounterId: medicationStatements.encounterId,
      reconciliation: medicationStatements.reconciliation,
    })
    .from(medicationStatements)
    .where(eq(medicationStatements.patientUserId, patientUserId));
  const current = new Map<string, (typeof rows)[number]>();
  const reconciledHere = new Set<string>();
  for (const r of rows) {
    const c = current.get(r.logicalId);
    if (!c || r.version > c.version) current.set(r.logicalId, r);
    if (r.encounterId === encounterId && r.reconciliation) reconciledHere.add(r.logicalId);
  }
  return [...current.values()]
    .filter(
      (r) =>
        r.status !== "entered_in_error" &&
        r.status !== "cancelled" &&
        (r.medicationStatus === "active" || r.medicationStatus === "on_hold"),
    )
    .every((r) => reconciledHere.has(r.logicalId));
}

export interface SignNoteInput {
  patientUserId: string;
  noteId: string;
  revision?: number;
  /** Concepts whose unit-mismatch or plausibility question the clinician confirmed at signing. */
  confirmed?: string[];
}

export async function signNote(ctx: WriteCtx, input: SignNoteInput): Promise<WriteResult> {
  const note = await loadNote(ctx, input.patientUserId, input.noteId);
  if (note.authorUserId !== ctx.actor.userId)
    throw new EmrWriteError("forbidden", "Only the author signs a note.");
  if (note.state === "signed") return { id: note.id };
  if (input.revision !== undefined && input.revision !== note.revision)
    throw new EmrWriteError("conflict", "This note was changed elsewhere. Reload before signing.");
  const key = hmacKey();
  const content = readContent(note);
  const signCtx: SignContext = {
    allergyStatus: (await loadAllergyInput(ctx.tx, input.patientUserId)).status.kind,
    medicinesReconciled: await medicinesReconciled(ctx, input.patientUserId, note.encounterId),
  };
  let plan: ReturnType<typeof planSign>;
  try {
    plan = planSign(
      { ...note, content },
      {
        signedAt: ctx.now,
        key,
        lateEntryWindowMs: EMR_SETTINGS_DEFAULTS.lateEntryWindowMs,
        ctx: signCtx,
      },
    );
  } catch (e) {
    if (e instanceof NoteHmacKeyError) throw new EmrWriteError("config", e.message);
    throw e;
  }
  if (!plan.ok) throw invalid(`Not ready to sign: ${plan.missing.map((m) => m.message).join(" ")}`);

  const [signed] = await ctx.tx
    .update(clinicalNotes)
    .set({
      state: "signed",
      signedAt: ctx.now,
      contentHmac: plan.contentHmac,
      hmacKeyId: plan.hmacKeyId,
      lateEntry: plan.lateEntry,
    })
    .where(
      and(
        eq(clinicalNotes.id, note.id),
        eq(clinicalNotes.state, "draft"),
        eq(clinicalNotes.revision, note.revision),
      ),
    )
    .returning({ id: clinicalNotes.id });
  if (!signed) throw new EmrWriteError("conflict", "The note changed while signing. Reload.");

  // D-EMR-01: note-born findings and the NCD capture become facts in this same transaction.
  const confirmed = new Set(input.confirmed ?? []);
  const lines: ObservationInput[] = [];
  let unmapped = 0;
  for (const { item } of plan.noteBorn) {
    const r = findingLines(item, note.effectiveAt);
    lines.push(...r.lines);
    unmapped += r.unmapped;
  }
  const ncd = captureFromNote(content);
  if (ncd)
    lines.push(
      ...factsFromCapture(ncd, note.effectiveAt.toISOString(), captureFromNote(content, "pulled")),
    );
  const facts = await insertObservations(ctx, {
    patientUserId: note.patientUserId,
    encounterId: note.encounterId,
    source: NURSE_CADRES.includes(ctx.actor.cadreCode) ? "poc_staff" : "clinician",
    lines: lines.map((l) => ({
      ...l,
      unitConfirmed: confirmed.has(l.conceptId),
      plausibilityConfirmed: confirmed.has(l.conceptId),
    })),
    keyOf: (i) => `${note.id}:nb:${i}`,
  });

  const warnings = [...plan.warnings.map((w) => w.message), ...facts.warnings];
  if (unmapped)
    warnings.push(
      `${unmapped} finding(s) have no catalogue concept: kept in the note, not charted.`,
    );
  if (clerkshipWriteAuthority(ctx.actor.cadreCode, ctx.actor.isClinical).requiresCosign) {
    await openCosignRequest(ctx, note, null);
    warnings.push("Signed, awaiting co-signature. Care continues meanwhile.");
  }
  await stampActivity(ctx, note.encounterId);
  return { id: note.id, warnings };
}

/* ─── Co-sign ────────────────────────────────────────────────────── */

async function openCosignRequest(
  ctx: WriteCtx,
  note: NoteRow,
  clientKey: string | null,
): Promise<string> {
  const [req] = await ctx.tx
    .insert(clinicalCosignRequests)
    .values({
      hospitalId: note.hospitalId,
      patientUserId: note.patientUserId,
      requestedByUserId: ctx.actor.userId,
      requestedByAffiliationId: ctx.actor.affiliationId,
      requestedByCadreCode: ctx.actor.cadreCode,
      actionKind: "sign_note",
      // PHI-free (gate-a-proposal A.5).
      actionPayload: { noteId: note.id, noteType: note.noteType, encounterId: note.encounterId },
      noteId: note.id,
    })
    .returning({ id: clinicalCosignRequests.id });
  const [e] = await ctx.tx
    .insert(clinicalNoteEvents)
    .values({
      noteId: note.id,
      hospitalId: note.hospitalId,
      patientUserId: note.patientUserId,
      kind: "cosign_requested",
      actorUserId: ctx.actor.userId,
      actorCadre: ctx.actor.cadreCode,
      cosignRequestId: req!.id,
      recordedAt: ctx.now,
      clientKey,
    })
    .returning({ id: clinicalNoteEvents.id });
  return e!.id;
}

/** The author asks for a co-signature on a signed note (a CO asking for review, say). */
export async function requestCosign(
  ctx: WriteCtx,
  input: { patientUserId: string; noteId: string; clientKey: string },
): Promise<WriteResult> {
  const replay = await replayed(ctx.tx, clinicalNoteEvents, input.clientKey, input.patientUserId);
  if (replay) return { id: replay };
  const note = await loadNote(ctx, input.patientUserId, input.noteId);
  if (note.authorUserId !== ctx.actor.userId)
    throw new EmrWriteError("forbidden", "Only the author asks for a co-signature.");
  const { status } = noteStatus(note, await eventsOf(ctx, note.id));
  const check = applyNoteEvent(
    status,
    { kind: "cosign_requested", actorUserId: ctx.actor.userId, cosignRequestId: null },
    { authorUserId: note.authorUserId },
  );
  if (!check.ok)
    throw new EmrWriteError("conflict", `Cannot request a co-signature: ${check.reason}.`);
  const id = await openCosignRequest(ctx, note, input.clientKey);
  await stampActivity(ctx, note.encounterId);
  return { id };
}

/** A senior co-signs: never the author, and only the open request (it leaves the co-sign queue). */
export async function cosignNote(
  ctx: WriteCtx,
  input: { patientUserId: string; noteId: string; clientKey: string; reviewNote?: string },
): Promise<WriteResult> {
  requireCadre(ctx, SENIOR_CADRES, "co-sign notes");
  const replay = await replayed(ctx.tx, clinicalNoteEvents, input.clientKey, input.patientUserId);
  if (replay) return { id: replay };
  const note = await loadNote(ctx, input.patientUserId, input.noteId);
  const events = await eventsOf(ctx, note.id);
  const { status } = noteStatus(note, events);
  const open =
    [...events]
      .filter((e) => e.kind === "cosign_requested")
      .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())[0]?.cosignRequestId ?? null;
  const check = applyNoteEvent(
    status,
    { kind: "cosigned", actorUserId: ctx.actor.userId, cosignRequestId: open },
    { authorUserId: note.authorUserId, openCosignRequestId: open },
  );
  if (!check.ok)
    throw new EmrWriteError(
      note.authorUserId === ctx.actor.userId ? "forbidden" : "conflict",
      `Cannot co-sign: ${check.reason}.`,
    );
  const [answered] = await ctx.tx
    .update(clinicalCosignRequests)
    .set({
      state: "approved",
      reviewedByUserId: ctx.actor.userId,
      reviewedAt: ctx.now,
      reviewNote: input.reviewNote?.trim() || null,
    })
    .where(
      and(eq(clinicalCosignRequests.id, open!), eq(clinicalCosignRequests.state, "pending_review")),
    )
    .returning({ id: clinicalCosignRequests.id });
  if (!answered) throw new EmrWriteError("conflict", "The co-sign request is no longer open.");
  const [e] = await ctx.tx
    .insert(clinicalNoteEvents)
    .values({
      noteId: note.id,
      hospitalId: note.hospitalId,
      patientUserId: note.patientUserId,
      kind: "cosigned",
      actorUserId: ctx.actor.userId,
      actorCadre: ctx.actor.cadreCode,
      cosignRequestId: open,
      recordedAt: ctx.now,
      clientKey: input.clientKey,
    })
    .returning({ id: clinicalNoteEvents.id });
  await stampActivity(ctx, note.encounterId);
  return { id: e!.id };
}

/* ─── Signed notes written whole (addenda, the resus handover) ───── */

export interface InsertSignedNoteInput {
  patientUserId: string;
  encounterId: string;
  templateId: string;
  content: NoteContent;
  effectiveAt?: Date;
  /** Defaults to the actor; the resus handover is authored by the resus leader. */
  author?: { userId: string; cadreCode: string };
  addendumTo?: string | null;
  sensitivity?: "standard" | "restricted";
  clientKey: string;
}

/**
 * A note composed and signed in one step, for text that is final when written (an addendum, a
 * system-composed handover). Same template minimum and HMAC as signNote; it carries no note-born
 * findings.
 */
export async function insertSignedNote(
  ctx: WriteCtx,
  input: InsertSignedNoteInput,
): Promise<string> {
  const replay = await replayed(ctx.tx, clinicalNotes, input.clientKey, input.patientUserId);
  if (replay) {
    // Only this same signed note counts as the replay: never trust a key alone.
    const [r] = await ctx.tx
      .select({ state: clinicalNotes.state, templateId: clinicalNotes.templateId })
      .from(clinicalNotes)
      .where(eq(clinicalNotes.id, replay));
    if (r?.state !== "signed" || r.templateId !== input.templateId)
      throw new EmrWriteError("conflict", "That key belongs to another note.");
    return replay;
  }
  const template = getTemplateOr(input.templateId);
  if (!template.noteType) throw invalid("That template is not a note of its own.");
  const key = hmacKey();
  const row = {
    id: randomUUID(),
    hospitalId: ctx.actor.hospitalId,
    patientUserId: input.patientUserId,
    encounterId: input.encounterId,
    noteType: template.noteType,
    templateId: template.id,
    templateVersion: template.version,
    authorUserId: input.author?.userId ?? ctx.actor.userId,
    authorCadre: input.author?.cadreCode ?? ctx.actor.cadreCode,
    addendumTo: input.addendumTo ?? null,
    effectiveAt: input.effectiveAt ?? ctx.now,
  };
  let plan: ReturnType<typeof planSign>;
  try {
    plan = planSign(
      { ...row, content: input.content, state: "draft" },
      { signedAt: ctx.now, key, lateEntryWindowMs: EMR_SETTINGS_DEFAULTS.lateEntryWindowMs },
    );
  } catch (e) {
    if (e instanceof NoteHmacKeyError) throw new EmrWriteError("config", e.message);
    throw e;
  }
  if (!plan.ok) throw invalid(`Not ready to sign: ${plan.missing.map((m) => m.message).join(" ")}`);
  await ctx.tx.insert(clinicalNotes).values({
    ...row,
    state: "signed",
    contentCiphertext: encrypt(JSON.stringify(input.content)),
    contentHmac: plan.contentHmac,
    hmacKeyId: plan.hmacKeyId,
    signedAt: ctx.now,
    lateEntry: plan.lateEntry,
    recordedAt: ctx.now,
    sensitivity: input.sensitivity ?? "standard",
    clientKey: input.clientKey,
  });
  await stampActivity(ctx, input.encounterId);
  return row.id;
}

/** An addendum: a new signed note threaded under its parent, inheriting the parent's restriction. */
export async function addAddendum(
  ctx: WriteCtx,
  input: {
    patientUserId: string;
    parentNoteId: string;
    text: string;
    reason: string;
    clientKey: string;
  },
): Promise<WriteResult> {
  requireDocumenter(ctx, "addendum");
  const replay = await replayed(ctx.tx, clinicalNotes, input.clientKey, input.patientUserId);
  if (replay) return { id: replay };
  const parent = await loadNote(ctx, input.patientUserId, input.parentNoteId);
  const { status } = noteStatus(parent, await eventsOf(ctx, parent.id));
  if (status === "draft") throw invalid("A draft is still editable: change it instead.");
  if (status === "entered_in_error")
    throw new EmrWriteError("conflict", "The note was entered in error.");
  const id = await insertSignedNote(ctx, {
    patientUserId: input.patientUserId,
    encounterId: parent.encounterId,
    templateId: "tpl.addendum",
    content: {
      sections: {
        s01: { items: [{ kind: "addendum" }], fields: { text: input.text, reason: input.reason } },
      },
    },
    addendumTo: parent.id,
    sensitivity: parent.sensitivity === "restricted" ? "restricted" : "standard",
    clientKey: input.clientKey,
  });
  await ctx.tx.insert(clinicalNoteEvents).values({
    noteId: parent.id,
    hospitalId: parent.hospitalId,
    patientUserId: parent.patientUserId,
    kind: "addendum_added",
    actorUserId: ctx.actor.userId,
    actorCadre: ctx.actor.cadreCode,
    relatedNoteId: id,
    recordedAt: ctx.now,
    clientKey: `${input.clientKey}:event`,
  });
  return { id };
}

/* ─── Entered in error ───────────────────────────────────────────── */

/**
 * The note stays visible, struck through, with its reason. What it committed reverses with it: its
 * note-born facts are voided (CFC 3.3) and an open co-sign request leaves the queue.
 */
export async function markNoteEnteredInError(
  ctx: WriteCtx,
  input: {
    patientUserId: string;
    noteId: string;
    reasonCode?: string;
    reasonText?: string;
    clientKey: string;
  },
): Promise<WriteResult> {
  if (!input.reasonCode?.trim() && !input.reasonText?.trim())
    throw invalid("A reason is required to mark a note entered in error.");
  const replay = await replayed(ctx.tx, clinicalNoteEvents, input.clientKey, input.patientUserId);
  if (replay) return { id: replay };
  const note = await loadNote(ctx, input.patientUserId, input.noteId);
  const { status } = noteStatus(note, await eventsOf(ctx, note.id));
  if (status === "draft") throw invalid("A draft is not on the record yet.");
  if (status === "entered_in_error")
    throw new EmrWriteError("conflict", "Already entered in error.");
  requireAuthorOrSupervisor(ctx, note.authorUserId);
  const [e] = await ctx.tx
    .insert(clinicalNoteEvents)
    .values({
      noteId: note.id,
      hospitalId: note.hospitalId,
      patientUserId: note.patientUserId,
      kind: "entered_in_error",
      actorUserId: ctx.actor.userId,
      actorCadre: ctx.actor.cadreCode,
      reasonCode: input.reasonCode?.trim() || null,
      reasonCiphertext: input.reasonText?.trim() ? encrypt(input.reasonText.trim()) : null,
      recordedAt: ctx.now,
      clientKey: input.clientKey,
    })
    .returning({ id: clinicalNoteEvents.id });

  const born = await ctx.tx
    .select({ id: clinicalObservations.id })
    .from(clinicalObservations)
    .where(
      and(
        eq(clinicalObservations.patientUserId, note.patientUserId),
        like(clinicalObservations.clientKey, `${note.id}:nb:%`),
        notInArray(clinicalObservations.status, ["entered_in_error"]),
        // Already voided or corrected on its own: that newer version stands.
        sql`NOT EXISTS (SELECT 1 FROM public.clinical_observations s WHERE s.supersedes_id = ${clinicalObservations.id})`,
      ),
    )
    .orderBy(desc(clinicalObservations.createdAt));
  for (const [i, o] of born.entries())
    await voidObservation(
      ctx,
      {
        patientUserId: note.patientUserId,
        id: o.id,
        reasonCode: "note_entered_in_error",
        reasonText: input.reasonText,
        clientKey: `${input.clientKey}:fact:${i}`,
      },
      { skipAuthorCheck: true },
    );
  await ctx.tx
    .update(clinicalCosignRequests)
    .set({ state: "cancelled", reviewedAt: ctx.now })
    .where(
      and(
        eq(clinicalCosignRequests.noteId, note.id),
        inArray(clinicalCosignRequests.state, ["pending_review"]),
      ),
    );
  await stampActivity(ctx, note.encounterId);
  return { id: e!.id };
}
